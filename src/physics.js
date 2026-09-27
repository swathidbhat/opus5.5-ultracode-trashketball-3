// Paper-ball physics: fixed-step semi-implicit Euler with gravity and quadratic drag, colliding
// spheres against the room, furniture boxes/cylinders, the bin (meridian-plane model, see
// docs/ARCHITECTURE.md) and each other. DOM-free so it runs in Node for the unit tests.
import * as THREE from 'three';
import { PHYS } from './config.js';

const DT = PHYS.dt;
// Max distance a ball centre may travel per collision sub-step. Well under the thinnest contact
// band (ball radius + half the bin wall ≈ 4.9 cm) so a ball can never jump past the middle of a
// wall between two checks, which is what would make it tunnel.
const MAX_MOVE = 0.018;
const MAX_SUBSTEPS = 8;
const BOUNCE_EVENT_SPEED = 0.3; // m/s of normal impact speed; quieter contacts are rolling/resting
const RESTING_VN = 0.12; // approach speeds below this are absorbed instead of bounced (kills jitter)
const WAKE_SPEED = 0.15; // a sleeping ball hit harder than this wakes up
const WAKE_PEN = 0.004; // …or pushed into by more than this
// Ball-ball contacts get up to this many relaxation passes per fixed step, each followed by the
// static re-collide. With a single pass a deep pile in the narrow office basket keeps ~1 cm of
// overlap (more than WAKE_PEN), so it keeps waking itself and never sleeps; a few passes let the
// floor's push reach the balls above and leave well under a millimetre.
const PAIR_ITERATIONS = 4;
const PAIR_SLOP = 0.0005; // m; stop relaxing once no pair overlaps by more than this
const SCORE_MAX_UP_SPEED = 0.5; // a ball still rising fast inside the bin is not conclusive yet
const RIM_ROLL_ACCEL = 1.5; // m/s², tips a ball off the top of the rim instead of letting it balance
const RIM_PERCH_NY = 0.9; // rim contact normal this close to vertical = ball balanced on top of the tube
const RIM_PERCH_MAX = 1.5; // s; after this long a perched ball (e.g. wedged against a wall) may sleep anyway
const BOUNCE_EVENT_GAP = 0.06; // s, min spacing of bounce events per ball and material
const REST_DRIFT = 0.004; // m; a touching ball that stays this close to one spot is settling…
const SETTLE_TIME_FACTOR = 1.5; // …and sleeps after this many PHYS.restTime
const AIR_SPIN_DAMPING = 0.35; // 1/s, visual only
const SAMPLE_EVERY = 2; // predictTrajectory records a point every N fixed steps
const GRID_CELL = 0.5; // m, broadphase cell size for furniture colliders
const EMPTY = Object.freeze([]);

let nextBallId = 1;

/** One paper ball. Physics owns pos/vel; sync() mirrors them onto the mesh. */
export class Ball {
  /** @param {THREE.Object3D|null} [mesh] visual from createPaperBall(), or null (tests) */
  constructor(mesh = null) {
    this.id = nextBallId++;
    this.mesh = mesh;
    this.radius = PHYS.ballRadius;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion(); // integrated orientation, written to the mesh
    if (mesh) {
      this.pos.copy(mesh.position);
      this.quaternion.copy(mesh.quaternion);
    }
    this.prevPos = this.pos.clone(); // position at the start of the last fixed step
    this.renderPos = this.pos.clone(); // interpolated position written to the mesh
    /** @type {'flying'|'rolling'|'resting'|'scored'} */
    this.state = 'flying';
    this.age = 0;
    this.touchedRim = false;
    this.touchedBinWall = false;
    this.scored = false;
    this.resolved = false;
    this.sleeping = false;
    this.contact = false; // touched anything during the last fixed step
    this.restTimer = 0;
    this._settleTimer = 0;
    this._restAnchor = new THREE.Vector3();
    this._pairContact = false;
    this._rimContact = false;
    this._perchTime = 0;
    this._lastBounce = {};
    this._fresh = true;
  }

  /**
   * Copy the (interpolated) position and integrated rotation onto the mesh.
   * @param {number} [alpha=1] blend between the previous and current fixed step
   */
  sync(alpha = 1) {
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    if (this.mesh) {
      this.mesh.position.copy(this.renderPos);
      this.mesh.quaternion.copy(this.quaternion);
    }
  }
}

/** Rigid-sphere world. Call setLevel() once per level, then step() every frame. */
export class PhysicsWorld {
  constructor() {
    /** @type {Ball[]} */
    this.balls = [];
    this.level = null;
    this.time = 0;
    this._acc = 0;
    this._events = [];
    this._room = null;
    this._boxes = [];
    this._cylinders = [];
    this._grid = buildGrid([], null);
    this._bin = null;
    this._c = makeContact();
    this._cur = null;
    this._h = DT;
    this._onContact = (c) => {
      this._resolveStatic(this._cur, c, this._h);
      return false;
    };
    this._prediction = makePrediction();
  }

  /** Use level.bin + level.colliders for collisions. Removes all balls. */
  setLevel(level) {
    this.level = level;
    const col = level?.colliders ?? {};
    this._room = col.room ? normalizeRoom(col.room) : null;
    this._boxes = (col.boxes ?? []).map(normalizeBox);
    this._cylinders = (col.cylinders ?? []).map(normalizeCylinder);
    this._grid = buildGrid([...this._boxes, ...this._cylinders], this._room);
    this._bin = level?.bin ? deriveBin(level.bin) : null;
    this.clear();
  }

  /** Add a ball at its current pos/vel (set them before or right after; the first step picks them up). */
  addBall(ball) {
    if (!this.balls.includes(ball)) this.balls.push(ball);
    ball.sleeping = false;
    ball._fresh = true;
    ball.prevPos.copy(ball.pos);
    ball.renderPos.copy(ball.pos);
    resetRest(ball);
  }

  /** @param {Ball} ball */
  removeBall(ball) {
    const i = this.balls.indexOf(ball);
    if (i < 0) return;
    this.balls.splice(i, 1);
    // Anything that was resting on it has lost its support.
    this._wakeNeighbours(ball);
  }

  clear() {
    this.balls.length = 0;
    this._acc = 0;
  }

  /** Wake every sleeping ball, e.g. after colliders or neighbours changed under them. */
  wakeAll() {
    for (const b of this.balls) this._wake(b);
  }

  /**
   * Advance by a frame's worth of time in fixed PHYS.dt steps.
   * @param {number} frameDt seconds since the last call
   * @returns {Array<object>} events raised during this frame (see docs/ARCHITECTURE.md)
   */
  step(frameDt) {
    const events = (this._events = []);
    for (const b of this.balls) if (b._fresh) this._prepare(b);
    let n = 0;
    if (frameDt > 0) {
      this._acc += Math.min(frameDt, 0.25);
      n = Math.floor(this._acc / DT + 1e-6);
      if (n > PHYS.maxStepsPerFrame) {
        n = PHYS.maxStepsPerFrame;
        this._acc = 0;
      } else {
        this._acc = Math.max(0, this._acc - n * DT);
      }
    }
    for (let i = 0; i < n; i++) this._fixedStep();
    const alpha = Math.min(1, this._acc / DT);
    for (const b of this.balls) b.sync(alpha);
    return events;
  }

  // ---------------------------------------------------------------- internals

  _prepare(b) {
    b._fresh = false;
    b.prevPos.copy(b.pos);
    b.renderPos.copy(b.pos);
    // A thrown crumple tumbles. Give it backspin plus a little wobble unless the caller set a spin.
    if (b.angVel.lengthSq() === 0 && b.vel.lengthSq() > 0.01) {
      const v = b.vel;
      b.angVel.set(-v.z, 0, v.x); // cross(vel, up): the backspin axis
      if (b.angVel.lengthSq() < 1e-6) b.angVel.set(1, 0, 0);
      const wobble = ((b.id * 7919) % 13) / 13 - 0.5;
      b.angVel.normalize().multiplyScalar(7 + 3 * Math.abs(wobble));
      b.angVel.y += 4 * wobble;
    }
  }

  _fixedStep() {
    this.time += DT;
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      b.prevPos.copy(b.pos);
      if (b.sleeping) continue;
      b.contact = false;
      b._rimContact = false;
      b._pairContact = false;
      const n = substepCount(b.vel);
      this._cur = b;
      this._h = DT / n;
      for (let k = 0; k < n; k++) {
        integrate(b.pos, b.vel, this._h);
        collideStatic(this, b.pos, b.radius, this._c, this._onContact);
      }
    }
    if (balls.length > 1) {
      this._h = DT;
      for (let it = 0; it < PAIR_ITERATIONS; it++) {
        const deepest = this._collideBalls();
        // Ball-ball separation can push a ball into the bin wall or floor; settle that now rather
        // than showing it for a frame. The next pass then carries that support on up the pile.
        for (let i = 0; i < balls.length; i++) {
          const b = balls[i];
          if (b.sleeping || !b._pairContact) continue;
          this._cur = b;
          collideStatic(this, b.pos, b.radius, this._c, this._onContact);
        }
        if (deepest < PAIR_SLOP) break;
      }
    }
    this._cur = null;

    const restSpeed2 = PHYS.restSpeed * PHYS.restSpeed;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      b.age += DT;
      if (b.sleeping) continue;
      integrateRotation(b, DT);
      if (this._updateRest(b, restSpeed2)) {
        this._sleep(b);
        continue;
      }

      if (!b.resolved) {
        if (this._insideBin(b, false) && b.vel.y < SCORE_MAX_UP_SPEED) this._score(b);
        else if (this._cannotReachBin(b)) this._miss(b, 'unreachable');
        else if (b.age >= PHYS.maxFlightTime) this._resolveUnsettled(b, 'timeout');
      }
      b.state = b.scored ? 'scored' : b.contact ? 'rolling' : 'flying';
    }
  }

  /**
   * Two ways to come to rest while touching something: moving slower than PHYS.restSpeed, or
   * staying within REST_DRIFT of one spot. The second catches balls in a pile, whose velocity
   * never quite reaches zero because gravity re-adds a little every step that contacts cancel.
   */
  _updateRest(b, restSpeed2) {
    if (b._rimContact) b._perchTime += DT;
    else if (!b.contact) b._perchTime = 0;
    if (!b.contact || (b._rimContact && b._perchTime < RIM_PERCH_MAX)) {
      resetRest(b);
      return false;
    }
    b.restTimer = b.vel.lengthSq() < restSpeed2 ? b.restTimer + DT : 0;
    if (b.pos.distanceToSquared(b._restAnchor) < REST_DRIFT * REST_DRIFT) {
      b._settleTimer += DT;
    } else {
      b._restAnchor.copy(b.pos);
      b._settleTimer = 0;
    }
    return b.restTimer >= PHYS.restTime || b._settleTimer >= PHYS.restTime * SETTLE_TIME_FACTOR;
  }

  _sleep(b) {
    b.sleeping = true;
    b.vel.set(0, 0, 0);
    b.angVel.set(0, 0, 0);
    resetRest(b);
    if (!b.resolved) this._resolveUnsettled(b, 'settled');
    b.state = b.scored ? 'scored' : 'resting';
  }

  // A ball that stopped (or ran out of time) without passing the deep-inside test still scores when
  // it sits in the opening, e.g. on top of a pile of earlier baskets.
  _resolveUnsettled(b, reason) {
    if (this._insideBin(b, true)) this._score(b);
    else this._miss(b, reason);
  }

  _miss(b, reason) {
    b.resolved = true;
    this._events.push({ type: 'rest', ball: b, reason });
  }

  /**
   * A ball outside the bin and below the rim whose total energy can't lift it back over the rim is
   * a certain miss even while it is still bouncing or rolling, so the throw resolves without
   * waiting for it to stop. Contacts only ever remove energy, and the ball's centre would have to
   * clear yRim + rimTube + radius to get in, so testing against yRim leaves a wide margin.
   */
  _cannotReachBin(b) {
    const bin = this._bin;
    if (!bin) return false;
    const ly = b.pos.y - bin.y;
    if (ly >= bin.yRim || ly + b.vel.lengthSq() / (2 * PHYS.gravity) >= bin.yRim) return false;
    const rc = Math.hypot(b.pos.x - bin.x, b.pos.z - bin.z);
    const outer = bin.rb + (bin.R - bin.rb) * (Math.max(0, ly) / bin.yRim) + bin.t;
    return rc > outer;
  }

  _score(b) {
    b.scored = true;
    b.resolved = true;
    b.state = 'scored';
    this._events.push({ type: 'score', ball: b, swish: !b.touchedRim && !b.touchedBinWall });
  }

  /**
   * strict: centre fully below the rim and inside the inner wall surface. The wall is solid, so
   * the only way there is through the opening.
   * loose: also accepts a centre within the opening radius up to one ball diameter above the rim
   * line. Nothing but other balls can hold a ball up there, so it is resting on a pile that crests
   * the rim.
   */
  _insideBin(b, loose) {
    const bin = this._bin;
    if (!bin) return false;
    const lx = b.pos.x - bin.x;
    const ly = b.pos.y - bin.y;
    const lz = b.pos.z - bin.z;
    if (ly < 0) return false;
    const rc = Math.sqrt(lx * lx + lz * lz);
    if (loose && ly < bin.yRim + 2 * b.radius && rc < bin.opening) return true;
    if (ly > bin.yRim - b.radius) return false;
    const mid = bin.rb + (bin.R - bin.rb) * (ly / bin.yRim);
    return rc < mid - bin.t;
  }

  _wake(b) {
    if (!b.sleeping) return;
    b.sleeping = false;
    resetRest(b); // a stale settle timer would put a gently nudged ball straight back to sleep
    b.state = b.scored ? 'scored' : 'rolling';
    this._wakeNeighbours(b);
  }

  _wakeNeighbours(b) {
    const reach = 2 * b.radius + 0.01;
    for (const o of this.balls) {
      if (o !== b && o.sleeping && o.pos.distanceToSquared(b.pos) < reach * reach) this._wake(o);
    }
  }

  /** Contact against something immovable: push out, bounce the normal velocity, drag the tangential. */
  _resolveStatic(b, c, h) {
    const { nx, ny, nz, pen, material } = c;
    const p = b.pos;
    const v = b.vel;
    p.x += nx * pen;
    p.y += ny * pen;
    p.z += nz * pen;
    b.contact = true;
    if (material === 'rim') {
      b.touchedRim = true;
      // Perched on top of the tube: not a real resting place, so it must not fall asleep there.
      if (ny > RIM_PERCH_NY) b._rimContact = true;
    } else if (material === 'binWall') {
      b.touchedBinWall = true;
    }
    const vn = v.x * nx + v.y * ny + v.z * nz;
    if (vn >= 0) return;
    const vIn = -vn;
    let tx = v.x - vn * nx;
    let ty = v.y - vn * ny;
    let tz = v.z - vn * nz;
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    let vOut = 0;
    let spinBlend = 1;
    if (vIn > RESTING_VN) {
      const e = PHYS.restitution[material] ?? 0.3;
      vOut = e * vIn;
      // Coulomb-like: a grazing hit keeps most of its tangential speed, a square hit loses the full fraction.
      const f = (PHYS.friction[material] ?? 0.3) * Math.min(1, (2 * (1 + e) * vIn) / Math.max(tLen, 1e-6));
      tx *= 1 - f;
      ty *= 1 - f;
      tz *= 1 - f;
      spinBlend = 0.5;
      if (vIn > BOUNCE_EVENT_SPEED && this._bounceAllowed(b, material)) {
        this._events.push({
          type: 'bounce',
          ball: b,
          material,
          speed: vIn,
          point: new THREE.Vector3(p.x - nx * b.radius, p.y - ny * b.radius, p.z - nz * b.radius),
          normal: new THREE.Vector3(nx, ny, nz),
        });
      }
    } else {
      const damp = Math.exp(-PHYS.rollingDamping * h);
      tx *= damp;
      ty *= damp;
      tz *= damp;
      if (material === 'rim' && ny > RIM_PERCH_NY) {
        // Balanced on a 6 mm tube is not a real resting state: roll it off.
        // Downhill is the normal's horizontal part; dead centre falls back to the current drift, then +X.
        let hx = nx;
        let hz = nz;
        if (hx * hx + hz * hz < 1e-8) {
          hx = tx;
          hz = tz;
        }
        const hl = Math.sqrt(hx * hx + hz * hz);
        if (hl > 1e-9) {
          tx += (hx / hl) * RIM_ROLL_ACCEL * h;
          tz += (hz / hl) * RIM_ROLL_ACCEL * h;
        } else {
          tx += RIM_ROLL_ACCEL * h;
        }
      }
    }
    v.set(tx + nx * vOut, ty + ny * vOut, tz + nz * vOut);
    // Spin toward rolling without slipping: w = n x v_t / r. Visual only.
    const inv = 1 / b.radius;
    const w = b.angVel;
    const rx = (ny * tz - nz * ty) * inv;
    const ry = (nz * tx - nx * tz) * inv;
    const rz = (nx * ty - ny * tx) * inv;
    w.x += (rx - w.x) * spinBlend;
    w.y += (ry - w.y) * spinBlend;
    w.z += (rz - w.z) * spinBlend;
  }

  /** One bounce sound per ball and material per BOUNCE_EVENT_GAP, so rattles and pile jostles don't spam. */
  _bounceAllowed(b, material) {
    const last = b._lastBounce[material];
    if (last !== undefined && this.time - last < BOUNCE_EVENT_GAP) return false;
    b._lastBounce[material] = this.time;
    return true;
  }

  /** One pass over every ball pair. Returns the deepest overlap it found (before resolving it). */
  _collideBalls() {
    const balls = this.balls;
    const c = this._c;
    let deepest = 0;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (a.sleeping && b.sleeping) continue;
        const minD = a.radius + b.radius;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= minD * minD) continue;
        const d = Math.sqrt(d2);
        // Coincident centres: separate vertically.
        const nx = d > 1e-9 ? dx / d : 0;
        const ny = d > 1e-9 ? dy / d : 1;
        const nz = d > 1e-9 ? dz / d : 0;
        const pen = minD - d;
        if (pen > deepest) deepest = pen;
        // Normal speed of b relative to a; negative = closing.
        const vn = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny + (b.vel.z - a.vel.z) * nz;
        if (a.sleeping && (-vn > WAKE_SPEED || pen > WAKE_PEN)) this._wake(a);
        if (b.sleeping && (-vn > WAKE_SPEED || pen > WAKE_PEN)) this._wake(b);
        // A ball that stays asleep acts as a static obstacle, which keeps piles stable.
        if (a.sleeping || b.sleeping) {
          const mover = a.sleeping ? b : a;
          const s = a.sleeping ? 1 : -1;
          c.nx = nx * s;
          c.ny = ny * s;
          c.nz = nz * s;
          c.pen = pen;
          c.material = 'ball';
          this._resolveStatic(mover, c, DT);
          mover._pairContact = true;
          continue;
        }
        this._resolvePair(a, b, nx, ny, nz, pen, vn);
      }
    }
    return deepest;
  }

  _resolvePair(a, b, nx, ny, nz, pen, vn) {
    const half = pen / 2;
    a.pos.x -= nx * half;
    a.pos.y -= ny * half;
    a.pos.z -= nz * half;
    b.pos.x += nx * half;
    b.pos.y += ny * half;
    b.pos.z += nz * half;
    a.contact = true;
    b.contact = true;
    a._pairContact = true;
    b._pairContact = true;
    if (vn >= 0) return;
    const vIn = -vn;
    const e = vIn > RESTING_VN ? PHYS.restitution.ball : 0;
    const jn = ((1 + e) * vIn) / 2; // equal masses split the impulse
    // Relative tangential velocity, reduced by the friction fraction (shared between the two).
    const rx = b.vel.x - a.vel.x - vn * nx;
    const ry = b.vel.y - a.vel.y - vn * ny;
    const rz = b.vel.z - a.vel.z - vn * nz;
    const tLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const f = (PHYS.friction.ball * Math.min(1, (2 * (1 + e) * vIn) / Math.max(tLen, 1e-6))) / 2;
    a.vel.x += -nx * jn + rx * f;
    a.vel.y += -ny * jn + ry * f;
    a.vel.z += -nz * jn + rz * f;
    b.vel.x += nx * jn - rx * f;
    b.vel.y += ny * jn - ry * f;
    b.vel.z += nz * jn - rz * f;
    if (vIn > BOUNCE_EVENT_SPEED && this._bounceAllowed(a, 'ball') && this._bounceAllowed(b, 'ball')) {
      const lead = a.vel.lengthSq() >= b.vel.lengthSq() ? a : b;
      this._events.push({
        type: 'bounce',
        ball: lead,
        other: lead === a ? b : a,
        material: 'ball',
        speed: vIn,
        point: new THREE.Vector3(a.pos.x + nx * a.radius, a.pos.y + ny * a.radius, a.pos.z + nz * a.radius),
        normal: new THREE.Vector3(nx, ny, nz),
      });
    }
  }
}

/**
 * Launch velocity for a throw.
 * @param {number} yaw   0 = towards -Z, positive turns left (like camera.rotation.y)
 * @param {number} pitch elevation above horizontal
 * @param {number} speed m/s
 * @param {THREE.Vector3} [out]
 * @returns {THREE.Vector3}
 */
export function launchVelocity(yaw, pitch, speed, out = new THREE.Vector3()) {
  const h = Math.cos(pitch) * speed;
  return out.set(-Math.sin(yaw) * h, Math.sin(pitch) * speed, -Math.cos(yaw) * h);
}

/**
 * Predict a throw with exactly the integrator the world uses, stopping at the first contact with
 * any static collider or the bin (other balls are ignored). Allocation-free after warm-up: unless
 * opts.out is given, the returned object belongs to `world` and is overwritten by the next call.
 *
 * Besides the contract fields, `hit.center` is the ball centre at contact and `entry` is set when
 * the path drops through the bin opening's plane inside the opening (so a first contact on
 * 'binFloor' means a clean swish): { point, center (rim centre), radius (opening), time }.
 * @param {PhysicsWorld|null} world
 * @param {THREE.Vector3} origin
 * @param {THREE.Vector3} velocity
 * @param {{maxTime?: number, out?: object}} [opts]
 * @returns {{points: THREE.Vector3[], times: number[], hit: null|{point: THREE.Vector3,
 *   normal: THREE.Vector3, center: THREE.Vector3, material: string, time: number},
 *   entry: null|{point: THREE.Vector3, center: THREE.Vector3, radius: number, time: number}}}
 */
export function predictTrajectory(world, origin, velocity, opts = {}) {
  const maxTime = opts.maxTime ?? 3;
  const out = opts.out ?? world?._prediction ?? makePrediction();
  if (!out._pool) Object.assign(out, makePrediction());
  const pos = out._pos.copy(origin);
  const vel = out._vel.copy(velocity);
  const c = out._c;
  const r = PHYS.ballRadius;
  out.points.length = 0;
  out.times.length = 0;
  out.hit = null;
  out.entry = null;
  const bin = world?._bin ?? null;
  const rimY = bin ? bin.y + bin.yRim : 0;
  pushPoint(out, pos, 0);
  const steps = Math.ceil(maxTime / DT - 1e-9);
  for (let i = 1; i <= steps; i++) {
    const n = substepCount(vel);
    const h = DT / n;
    for (let k = 1; k <= n; k++) {
      const y0 = pos.y;
      integrate(pos, vel, h);
      if (bin && !out.entry && y0 > rimY && pos.y <= rimY) {
        // Crossing point on the rim plane; the step moved by exactly vel * h.
        const back = ((rimY - pos.y) / (y0 - pos.y)) * h;
        const x = pos.x - vel.x * back;
        const z = pos.z - vel.z * back;
        if (Math.hypot(x - bin.x, z - bin.z) < bin.opening) {
          const e = out._entry;
          e.point.set(x, rimY, z);
          e.center.set(bin.x, rimY, bin.z);
          e.radius = bin.opening;
          e.time = (i - 1) * DT + k * h - back;
          out.entry = e;
        }
      }
      if (world && collideStatic(world, pos, r, c, stopAtFirst)) {
        // Same push-out the simulation applies, so hit.point equals the simulated contact point.
        const hit = out._hit;
        hit.center.set(pos.x + c.nx * c.pen, pos.y + c.ny * c.pen, pos.z + c.nz * c.pen);
        hit.normal.set(c.nx, c.ny, c.nz);
        hit.point.copy(hit.center).addScaledVector(hit.normal, -r);
        hit.material = c.material;
        hit.time = (i - 1) * DT + k * h;
        out.hit = hit;
        pushPoint(out, hit.center, hit.time);
        return out;
      }
    }
    if (i % SAMPLE_EVERY === 0) pushPoint(out, pos, i * DT);
  }
  return out;
}

// ------------------------------------------------------------------ helpers

function resetRest(b) {
  b.restTimer = 0;
  b._settleTimer = 0;
  b._restAnchor.copy(b.pos);
}

function makeContact() {
  return { nx: 0, ny: 1, nz: 0, pen: 0, material: 'floor' };
}

function makePrediction() {
  return {
    points: [],
    times: [],
    hit: null,
    entry: null,
    _pool: [],
    _pos: new THREE.Vector3(),
    _vel: new THREE.Vector3(),
    _c: makeContact(),
    _hit: { point: new THREE.Vector3(), normal: new THREE.Vector3(), center: new THREE.Vector3(), material: '', time: 0 },
    _entry: { point: new THREE.Vector3(), center: new THREE.Vector3(), radius: 0, time: 0 },
  };
}

function pushPoint(out, p, t) {
  const i = out.points.length;
  const v = out._pool[i] ?? (out._pool[i] = new THREE.Vector3());
  out.points.push(v.copy(p));
  out.times.push(t);
}

function stopAtFirst() {
  return true;
}

function substepCount(vel) {
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  return Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * DT) / MAX_MOVE)));
}

/** Semi-implicit Euler: update velocity from gravity + quadratic drag, then move with the new velocity. */
function integrate(pos, vel, h) {
  const k = PHYS.dragK * Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z) * h;
  vel.x -= vel.x * k;
  vel.y -= vel.y * k + PHYS.gravity * h;
  vel.z -= vel.z * k;
  pos.x += vel.x * h;
  pos.y += vel.y * h;
  pos.z += vel.z * h;
}

const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();
function integrateRotation(b, dt) {
  const w = b.angVel;
  if (!b.contact) w.multiplyScalar(Math.exp(-AIR_SPIN_DAMPING * dt));
  const len = w.length();
  if (len < 1e-5) return;
  _dq.setFromAxisAngle(_axis.copy(w).divideScalar(len), len * dt);
  b.quaternion.premultiply(_dq).normalize();
}

function setContact(c, nx, ny, nz, pen, material) {
  c.nx = nx;
  c.ny = ny;
  c.nz = nz;
  c.pen = pen;
  c.material = material;
}

/**
 * Test the sphere against every static collider. Each contact is handed to onContact immediately
 * (which may move `pos`), so later tests see the corrected position. The room goes last so it
 * always wins. Returns true as soon as onContact returns true.
 */
function collideStatic(world, pos, r, c, onContact) {
  if (world._bin && binContacts(world._bin, pos, r, c, onContact)) return true;
  const shapes = gridCell(world._grid, pos.x, pos.z);
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if ((s.isBox ? boxContact(s, pos, r, c) : cylinderContact(s, pos, r, c)) && onContact(c)) return true;
  }
  return !!world._room && roomContacts(world._room, pos, r, c, onContact);
}

/**
 * Uniform grid over the floor plan listing the boxes and cylinders near each cell, so a ball only
 * tests the handful of furniture pieces around it. Shapes are padded by more than a ball radius
 * plus a sub-step's push-out, and the grid covers every padded shape, so a ball centre outside the
 * grid cannot be touching any of them.
 */
function buildGrid(shapes, room) {
  const pad = PHYS.ballRadius + 0.03;
  let x0 = room ? room.minX : Infinity;
  let z0 = room ? room.minZ : Infinity;
  let x1 = room ? room.maxX : -Infinity;
  let z1 = room ? room.maxZ : -Infinity;
  for (const s of shapes) {
    x0 = Math.min(x0, s.minX - pad);
    z0 = Math.min(z0, s.minZ - pad);
    x1 = Math.max(x1, s.maxX + pad);
    z1 = Math.max(z1, s.maxZ + pad);
  }
  if (!(x1 > x0 && z1 > z0)) return { x0: 0, z0: 0, nx: 0, nz: 0, inv: 1, cells: [] };
  const nx = Math.max(1, Math.min(256, Math.ceil((x1 - x0) / GRID_CELL)));
  const nz = Math.max(1, Math.min(256, Math.ceil((z1 - z0) / GRID_CELL)));
  const inv = Math.min(nx / (x1 - x0), nz / (z1 - z0));
  const cells = new Array(nx * nz).fill(EMPTY);
  const cellOf = (v, lo, n) => clamp(Math.floor((v - lo) * inv), 0, n - 1);
  for (const s of shapes) {
    const ix0 = cellOf(s.minX - pad, x0, nx);
    const ix1 = cellOf(s.maxX + pad, x0, nx);
    const iz0 = cellOf(s.minZ - pad, z0, nz);
    const iz1 = cellOf(s.maxZ + pad, z0, nz);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const k = iz * nx + ix;
        if (cells[k] === EMPTY) cells[k] = [];
        cells[k].push(s);
      }
    }
  }
  return { x0, z0, nx, nz, inv, cells };
}

function gridCell(grid, x, z) {
  const ix = Math.floor((x - grid.x0) * grid.inv);
  const iz = Math.floor((z - grid.z0) * grid.inv);
  if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) return EMPTY;
  return grid.cells[iz * grid.nx + ix];
}

function roomContacts(room, pos, r, c, onContact) {
  if (pos.y - r < room.minY) {
    setContact(c, 0, 1, 0, room.minY + r - pos.y, room.floor);
    if (onContact(c)) return true;
  }
  if (pos.y + r > room.maxY) {
    setContact(c, 0, -1, 0, pos.y + r - room.maxY, room.ceiling);
    if (onContact(c)) return true;
  }
  if (pos.x - r < room.minX) {
    setContact(c, 1, 0, 0, room.minX + r - pos.x, room.nx);
    if (onContact(c)) return true;
  }
  if (pos.x + r > room.maxX) {
    setContact(c, -1, 0, 0, pos.x + r - room.maxX, room.px);
    if (onContact(c)) return true;
  }
  if (pos.z - r < room.minZ) {
    setContact(c, 0, 0, 1, room.minZ + r - pos.z, room.nz);
    if (onContact(c)) return true;
  }
  if (pos.z + r > room.maxZ) {
    setContact(c, 0, 0, -1, pos.z + r - room.maxZ, room.pz);
    if (onContact(c)) return true;
  }
  return false;
}

function boxContact(bx, pos, r, c) {
  const px = pos.x;
  const py = pos.y;
  const pz = pos.z;
  if (px < bx.minX - r || px > bx.maxX + r || py < bx.minY - r || py > bx.maxY + r || pz < bx.minZ - r || pz > bx.maxZ + r) {
    return false;
  }
  const dx = px - clamp(px, bx.minX, bx.maxX);
  const dy = py - clamp(py, bx.minY, bx.maxY);
  const dz = pz - clamp(pz, bx.minZ, bx.maxZ);
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-14) {
    const d = Math.sqrt(d2);
    setContact(c, dx / d, dy / d, dz / d, r - d, bx.material);
    return true;
  }
  // Centre inside the box: leave through the nearest face (ties prefer the top).
  let best = bx.maxY - py;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  const cand = [
    [px - bx.minX, -1, 0, 0],
    [bx.maxX - px, 1, 0, 0],
    [pz - bx.minZ, 0, 0, -1],
    [bx.maxZ - pz, 0, 0, 1],
    [py - bx.minY, 0, -1, 0],
  ];
  for (const [dist, ax, ay, az] of cand) {
    if (dist < best) {
      best = dist;
      nx = ax;
      ny = ay;
      nz = az;
    }
  }
  setContact(c, nx, ny, nz, best + r, bx.material);
  return true;
}

function cylinderContact(cy, pos, r, c) {
  const py = pos.y;
  if (py < cy.yMin - r || py > cy.yMax + r) return false;
  const dx = pos.x - cy.x;
  const dz = pos.z - cy.z;
  const rc2 = dx * dx + dz * dz;
  const lim = cy.radius + r;
  if (rc2 >= lim * lim) return false;
  const rc = Math.sqrt(rc2);
  const ux = rc > 1e-9 ? dx / rc : 1;
  const uz = rc > 1e-9 ? dz / rc : 0;
  const inRad = rc <= cy.radius;
  if (inRad && py >= cy.yMin && py <= cy.yMax) {
    const side = cy.radius - rc;
    const top = cy.yMax - py;
    const bot = py - cy.yMin;
    if (top <= side && top <= bot) setContact(c, 0, 1, 0, top + r, cy.material);
    else if (bot <= side) setContact(c, 0, -1, 0, bot + r, cy.material);
    else setContact(c, ux, 0, uz, side + r, cy.material);
    return true;
  }
  // Closest point on the solid in the (r, y) half-plane covers side, caps and edges alike.
  const mr = inRad ? 0 : rc - cy.radius;
  const my = py - clamp(py, cy.yMin, cy.yMax);
  const d2 = mr * mr + my * my;
  if (d2 >= r * r) return false;
  const d = Math.sqrt(d2);
  setContact(c, (mr / d) * ux, my / d, (mr / d) * uz, r - d, cy.material);
  return true;
}

// Bin-local coordinates of the ball centre, refreshed after every resolved feature.
let bRc = 0;
let bLy = 0;
let bUx = 1;
let bUz = 0;
function binLocal(bin, pos) {
  const lx = pos.x - bin.x;
  const lz = pos.z - bin.z;
  bLy = pos.y - bin.y;
  bRc = Math.sqrt(lx * lx + lz * lz);
  // On the axis every direction is radial; only the bottom plate can be touched there and its normal is +Y.
  bUx = bRc > 1e-9 ? lx / bRc : 1;
  bUz = bRc > 1e-9 ? lz / bRc : 0;
}

/** Meridian-plane bin: wall band (both faces), rim torus, bottom plate. */
function binContacts(bin, pos, r, c, onContact) {
  const ly = pos.y - bin.y;
  if (ly > bin.height + r || ly < -r) return false;
  const lx = pos.x - bin.x;
  const lz = pos.z - bin.z;
  const bound = bin.bound + r;
  if (lx * lx + lz * lz > bound * bound) return false;
  binLocal(bin, pos);

  // Rim first: the wall's top end sits at the rim centre and is thinner than the tube, so anything
  // touching that end is really touching the rim.
  let mr = bRc - bin.R;
  let my = bLy - bin.yRim;
  let d2 = mr * mr + my * my;
  let lim = bin.rimTube + r;
  if (d2 < lim * lim) {
    const d = Math.sqrt(d2);
    const nr = d > 1e-9 ? mr / d : 0;
    const ny = d > 1e-9 ? my / d : 1;
    setContact(c, nr * bUx, ny, nr * bUz, lim - d, 'rim');
    if (onContact(c)) return true;
    binLocal(bin, pos);
  }

  // Side wall: capsule band around the segment (rb, 0) -> (R, yRim), hit from inside or outside.
  let s = ((bRc - bin.rb) * bin.ex + bLy * bin.ey) * bin.invLen2;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  mr = bRc - (bin.rb + s * bin.ex);
  my = bLy - s * bin.ey;
  d2 = mr * mr + my * my;
  lim = bin.t + r;
  if (d2 < lim * lim) {
    const d = Math.sqrt(d2);
    const nr = d > 1e-9 ? mr / d : bin.wallNr;
    const ny = d > 1e-9 ? my / d : bin.wallNy;
    setContact(c, nr * bUx, ny, nr * bUz, lim - d, 'binWall');
    if (onContact(c)) return true;
    binLocal(bin, pos);
  }

  // Bottom plate: band around the segment (0, ft) -> (rb, ft).
  mr = bRc > bin.rb ? bRc - bin.rb : 0;
  my = bLy - bin.ft;
  d2 = mr * mr + my * my;
  lim = bin.ft + r;
  if (d2 < lim * lim) {
    const d = Math.sqrt(d2);
    const nr = d > 1e-9 ? mr / d : 0;
    const ny = d > 1e-9 ? my / d : 1;
    setContact(c, nr * bUx, ny, nr * bUz, lim - d, 'binFloor');
    if (onContact(c)) return true;
  }
  return false;
}

/** Precompute the bin's meridian-plane profile (see docs/ARCHITECTURE.md, BinDef). */
function deriveBin(bin) {
  const t = bin.wallThickness / 2;
  const R = bin.radiusTop - t;
  const rb = bin.radiusBottom - t;
  const yRim = bin.height - bin.rimTube;
  const ex = R - rb;
  const ey = yRim;
  const len = Math.hypot(ex, ey);
  return {
    x: bin.position.x,
    y: bin.position.y,
    z: bin.position.z,
    height: bin.height,
    t,
    R,
    rb,
    yRim,
    rimTube: bin.rimTube,
    ft: bin.floorThickness / 2,
    opening: R - bin.rimTube,
    ex,
    ey,
    invLen2: 1 / (len * len),
    wallNr: ey / len, // outward normal of the wall segment
    wallNy: -ex / len,
    bound: Math.max(bin.radiusTop + bin.rimTube, bin.radiusBottom + t) + 0.005,
  };
}

function normalizeRoom(room) {
  const m = room.materials ?? {};
  return {
    minX: room.min.x,
    minY: room.min.y,
    minZ: room.min.z,
    maxX: room.max.x,
    maxY: room.max.y,
    maxZ: room.max.z,
    floor: m.floor ?? 'floor',
    ceiling: m.ceiling ?? 'wall',
    nx: m.nx ?? 'wall',
    px: m.px ?? 'wall',
    nz: m.nz ?? 'wall',
    pz: m.pz ?? 'wall',
  };
}

function normalizeBox(b) {
  return {
    minX: Math.min(b.min.x, b.max.x),
    minY: Math.min(b.min.y, b.max.y),
    minZ: Math.min(b.min.z, b.max.z),
    maxX: Math.max(b.min.x, b.max.x),
    maxY: Math.max(b.min.y, b.max.y),
    maxZ: Math.max(b.min.z, b.max.z),
    material: b.material ?? 'furniture',
    isBox: true,
  };
}

function normalizeCylinder(cy) {
  return {
    x: cy.x,
    z: cy.z,
    radius: cy.radius,
    yMin: cy.yMin,
    yMax: cy.yMax,
    material: cy.material ?? 'furniture',
    isBox: false,
    // Floor-plan bounds, for the broadphase grid.
    minX: cy.x - cy.radius,
    maxX: cy.x + cy.radius,
    minZ: cy.z - cy.radius,
    maxZ: cy.z + cy.radius,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
