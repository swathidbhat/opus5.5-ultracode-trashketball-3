// Physics unit tests (node:test). Run with `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Ball, PhysicsWorld, launchVelocity, predictTrajectory } from '../src/physics.js';
import { PHYS, THROW } from '../src/config.js';
import { BIN as OFFICE_BIN } from '../src/levels/office/layout.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FRAME = 1 / 60;
const R = PHYS.ballRadius;

// Office-sized wire basket at (0, 0, -3) in a 6 x 3 x 7 m room with a desk and a planter.
function makeLevel(binOverrides = {}) {
  const bin = {
    position: V(0, 0, -3),
    height: 0.36,
    radiusBottom: 0.13,
    radiusTop: 0.165,
    wallThickness: 0.008,
    floorThickness: 0.01,
    rimTube: 0.006,
    object: null,
    sound: 'metal',
    kind: 'wireMesh',
    ...binOverrides,
  };
  return {
    id: 'test',
    bin,
    colliders: {
      room: {
        min: V(-3, 0, -5),
        max: V(3, 3, 2),
        materials: { floor: 'carpet', ceiling: 'wall', px: 'wall', nx: 'glass', pz: 'wall', nz: 'wall' },
      },
      boxes: [{ min: V(1.2, 0, -3.5), max: V(2.2, 0.75, -2.7), material: 'furniture' }],
      cylinders: [{ x: -1.5, z: -3, radius: 0.2, yMin: 0, yMax: 0.6, material: 'furniture' }],
    },
  };
}

function binGeom(bin) {
  const t = bin.wallThickness / 2;
  return {
    t,
    Rm: bin.radiusTop - t,
    rb: bin.radiusBottom - t,
    yRim: bin.position.y + bin.height - bin.rimTube,
  };
}

function makeWorld(level = makeLevel()) {
  const world = new PhysicsWorld();
  world.setLevel(level);
  return world;
}

function throwBall(world, pos, vel) {
  const b = new Ball(null);
  b.pos.copy(pos);
  b.vel.copy(vel);
  world.addBall(b);
  return b;
}

/** Step until `until(events)` is true or `seconds` elapse. Returns every event raised. */
function run(world, seconds, onFrame) {
  const all = [];
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i++) {
    const ev = world.step(FRAME);
    all.push(...ev);
    if (onFrame && onFrame(ev, i) === true) break;
  }
  return all;
}

// Radial distance of p from the bin axis and height above the bin base.
function binLocal(bin, p) {
  return { rc: Math.hypot(p.x - bin.position.x, p.z - bin.position.z), y: p.y - bin.position.y };
}

// Signed distance (in the meridian plane) from the wall mid-surface; > 0 = outside.
function wallSide(bin, p) {
  const g = binGeom(bin);
  const { rc, y } = binLocal(bin, p);
  const midR = g.rb + ((g.Rm - g.rb) * y) / (g.yRim - bin.position.y);
  return rc - midR;
}

/**
 * Find a throw whose predicted first contact is the bin floor, as close to the bin axis as possible.
 * For each pitch, bisect the speed on where the first contact lands along the throw direction
 * (short of the axis vs past it); no contact at all counts as long.
 */
function solveSwish(world, origin, bin) {
  const target = V(bin.position.x, 0, bin.position.z);
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(-dx, -dz);
  const along = (p) => ((p.x - target.x) * dx + (p.z - target.z) * dz) / len;
  let best = null;
  for (let pitchDeg = 25; pitchDeg <= 65; pitchDeg += 2.5) {
    const pitch = (pitchDeg * Math.PI) / 180;
    let lo = THROW.minSpeed;
    let hi = THROW.maxSpeed;
    for (let it = 0; it < 24; it++) {
      const speed = (lo + hi) / 2;
      const v = launchVelocity(yaw, pitch, speed);
      const p = predictTrajectory(world, origin, v, { maxTime: 3 });
      if (p.hit?.material === 'binFloor') {
        const off = Math.hypot(p.hit.point.x - target.x, p.hit.point.z - target.z);
        if (!best || off < best.off) best = { v: v.clone(), off, pitchDeg, speed };
      }
      if (!p.hit || along(p.hit.center) > 0) hi = speed;
      else lo = speed;
    }
  }
  return best;
}

test('launchVelocity follows the yaw/pitch convention', () => {
  const s = 5;
  const fwd = launchVelocity(0, 0, s);
  assert.ok(Math.abs(fwd.z + s) < 1e-9 && Math.abs(fwd.x) < 1e-9 && Math.abs(fwd.y) < 1e-9);
  const left = launchVelocity(Math.PI / 2, 0, s); // positive yaw turns left: -Z -> -X
  assert.ok(Math.abs(left.x + s) < 1e-9 && Math.abs(left.z) < 1e-9);
  const up = launchVelocity(0.3, Math.PI / 4, s);
  assert.ok(Math.abs(up.length() - s) < 1e-9);
  assert.ok(Math.abs(up.y - s * Math.SQRT1_2) < 1e-9);
});

test('Ball accepts a null mesh and syncs without one', () => {
  const b = new Ball(null);
  assert.equal(b.mesh, null);
  assert.equal(b.radius, R);
  assert.equal(b.state, 'flying');
  b.pos.set(1, 2, 3);
  b.sync();
  assert.ok(b.renderPos.equals(V(1, 2, 3)));
});

test('a ball dropped into the bin centre scores with a swish', () => {
  const level = makeLevel();
  const world = makeWorld(level);
  const b = throwBall(world, V(0, 1.0, -3), V(0, 0, 0));
  const events = run(world, 3);
  const scores = events.filter((e) => e.type === 'score');
  assert.equal(scores.length, 1);
  assert.equal(scores[0].ball, b);
  assert.equal(scores[0].swish, true);
  assert.equal(events.filter((e) => e.type === 'rest').length, 0);
  assert.ok(b.scored && b.resolved);
  // Settles on the bottom plate, inside the basket.
  assert.ok(Math.abs(b.pos.y - (level.bin.floorThickness + R)) < 0.003, `rest height ${b.pos.y}`);
  assert.equal(b.state, 'scored');
  assert.ok(b.sleeping);
});

test('a ball dropped onto the rim touches it and does not pass through it', () => {
  const level = makeLevel();
  const bin = level.bin;
  const g = binGeom(bin);
  for (const offset of [-0.02, -0.005, 0.005, 0.02]) {
    const world = makeWorld(level);
    const b = throwBall(world, V(g.Rm + offset, 0.9, -3), V(0, 0, 0));
    let minRimDist = Infinity;
    let minWall = Infinity;
    const events = run(world, 4, () => {
      const { rc, y } = binLocal(bin, b.pos);
      minRimDist = Math.min(minRimDist, Math.hypot(rc - g.Rm, y - g.yRim));
      if (y < g.yRim) minWall = Math.min(minWall, Math.abs(wallSide(bin, b.pos)));
    });
    assert.ok(b.touchedRim, `offset ${offset}: rim touched`);
    assert.ok(events.some((e) => e.type === 'bounce' && e.material === 'rim'), 'rim bounce event');
    // Never sinks meaningfully into the rim or the wall.
    assert.ok(minRimDist > bin.rimTube + R - 0.004, `offset ${offset}: rim penetration ${minRimDist}`);
    assert.ok(minWall > g.t + R - 0.004, `offset ${offset}: wall penetration ${minWall}`);
    // Resolved one way or the other, and the result agrees with which side it ended on.
    const resolved = events.filter((e) => e.type === 'score' || e.type === 'rest');
    assert.equal(resolved.length, 1, `offset ${offset}: one resolution`);
    const inside = binLocal(bin, b.pos).rc < g.rb + 0.02;
    assert.equal(resolved[0].type === 'score', inside, `offset ${offset}: result matches final position`);
    if (resolved[0].type === 'score') assert.equal(resolved[0].swish, false);
  }
});

test('max-speed horizontal shots into the outer wall never end up inside', () => {
  const level = makeLevel();
  const bin = level.bin;
  for (const speed of [THROW.maxSpeed, 13]) {
    for (const h of [0.06, 0.12, 0.2, 0.28, 0.33]) {
      for (const lateral of [0, 0.06, 0.12]) {
        const world = makeWorld(level);
        const b = throwBall(world, V(-1.2, h, -3 + lateral), V(speed, 0, 0));
        let crossed = false;
        const events = run(world, 2.5, () => {
          const { y } = binLocal(bin, b.pos);
          if (y < binGeom(bin).yRim && wallSide(bin, b.pos) < 0) crossed = true;
        });
        assert.equal(crossed, false, `speed ${speed} h ${h} lateral ${lateral}: crossed the wall`);
        assert.equal(events.filter((e) => e.type === 'score').length, 0);
        assert.ok(b.touchedBinWall || b.touchedRim, 'hit the bin');
      }
    }
  }
});

test('a ball inside the bin thrown outward at max speed stays inside', () => {
  const level = makeLevel();
  const bin = level.bin;
  for (const dir of [V(1, 0, 0), V(0.6, 0, -0.8), V(-0.7, -0.2, 0.7)]) {
    const world = makeWorld(level);
    const b = throwBall(world, V(0, 0.12, -3), dir.normalize().multiplyScalar(THROW.maxSpeed));
    let escaped = false;
    run(world, 1.5, () => {
      const { y } = binLocal(bin, b.pos);
      if (y < binGeom(bin).yRim - 0.01 && wallSide(bin, b.pos) > 0) escaped = true;
    });
    assert.equal(escaped, false);
  }
});

test('predictTrajectory matches the simulation up to the first contact', () => {
  const level = makeLevel();
  const cases = [
    { origin: V(0.2, 1.25, 0.5), v: launchVelocity(0.05, 0.5, 6.5) }, // lands on the carpet
    { origin: V(0, 1.4, 0.5), v: launchVelocity(-0.35, 0.3, 8) }, // desk top
    { origin: V(0, 1.2, 0), v: launchVelocity(0, 0.9, THROW.maxSpeed) }, // ceiling
    { origin: V(0, 1.2, 0), v: launchVelocity(0.4, 0.2, 9) }, // cylinder / far wall
  ];
  for (const { origin, v } of cases) {
    const world = makeWorld(level);
    const pred = predictTrajectory(world, origin, v, { maxTime: 3 });
    assert.ok(pred.hit, 'prediction hits something');
    const hit = { point: pred.hit.point.clone(), material: pred.hit.material, time: pred.hit.time };
    const samples = pred.points.map((p, i) => ({ p: p.clone(), t: pred.times[i] }));
    assert.ok(samples[0].p.equals(origin));

    const b = throwBall(world, origin, v);
    let first = null;
    let t = 0;
    const sim = new Map();
    for (let i = 0; i < 1000 && !first; i++) {
      const ev = world.step(PHYS.dt);
      t += PHYS.dt;
      sim.set(i + 1, b.pos.clone());
      first = ev.find((e) => e.type === 'bounce') ?? null;
    }
    assert.ok(first, 'simulation hits something');
    assert.equal(first.material, hit.material);
    const err = first.point.distanceTo(hit.point);
    assert.ok(err < 0.003, `hit point error ${err}`);
    assert.ok(Math.abs(t - hit.time) <= PHYS.dt + 1e-9, `hit time ${hit.time} vs ${t}`);
    // Sampled points before the contact are the simulated positions, bit for bit.
    for (const s of samples.slice(1, -1)) {
      const step = Math.round(s.t / PHYS.dt);
      const q = sim.get(step);
      assert.ok(q && q.distanceTo(s.p) < 1e-9, `sample at step ${step}`);
    }
  }
});

test('predictTrajectory is allocation-light and bounded', () => {
  const world = makeWorld();
  const a = predictTrajectory(world, V(0, 1.2, 0), launchVelocity(0, 0.5, 7));
  const firstPoint = a.points[1];
  const b = predictTrajectory(world, V(0, 1.2, 0), launchVelocity(0.1, 0.6, 6));
  assert.equal(a, b, 'result object is reused');
  assert.equal(b.points[1], firstPoint, 'point vectors are reused');
  assert.equal(b.points.length, b.times.length);
  const free = predictTrajectory(null, V(0, 100, 0), V(0, 5, 0), { maxTime: 3 });
  assert.equal(free.hit, null);
  assert.ok(free.points.length <= Math.ceil(3 / PHYS.dt / 2) + 2);
  for (let i = 1; i < free.times.length; i++) assert.ok(free.times[i] > free.times[i - 1]);
});

test('a thrown ball that misses eventually emits rest', () => {
  const world = makeWorld();
  const b = throwBall(world, V(0.3, 1.2, 0), launchVelocity(0.3, 0.4, 6));
  let restAt = null;
  run(world, PHYS.maxFlightTime + 1, (ev, i) => {
    if (ev.some((e) => e.type === 'rest')) {
      restAt = i * FRAME;
      return true;
    }
    return false;
  });
  assert.ok(restAt !== null, 'rest emitted');
  assert.ok(restAt <= PHYS.maxFlightTime + FRAME);
  assert.ok(b.resolved && !b.scored);
  // It keeps simulating after the miss is called and comes to rest on its own.
  run(world, 4);
  assert.equal(b.state, 'resting');
  assert.ok(b.sleeping);
});

test('a miss is called as soon as the ball can no longer reach the opening', () => {
  const level = makeLevel();
  const world = makeWorld(level);
  // Rolling along the floor straight at the bin: it can bump the wall but never climb the rim.
  const roller = throwBall(world, V(0, R, -1.5), V(0, 0, -2.5));
  let rest = null;
  const events = run(world, 3, (ev) => {
    rest ??= ev.find((e) => e.type === 'rest') ?? null;
  });
  assert.ok(rest && rest.ball === roller && rest.reason === 'unreachable', 'called early');
  assert.equal(events.filter((e) => e.type === 'rest').length, 1, 'only once');
  assert.equal(events.filter((e) => e.type === 'score').length, 0);

  // Low but still energetic enough to clear the rim: not called while it could still go in.
  const world2 = makeWorld(level);
  const hopper = throwBall(world2, V(0, 0.2, -2.2), V(0, 3.2, -1.6));
  const ev2 = run(world2, 0.25);
  assert.equal(ev2.filter((e) => e.type === 'rest' || e.type === 'score').length, 0);
  assert.equal(hopper.resolved, false);
});

test('every throw resolves exactly once and the call matches where the ball ends up', () => {
  const level = makeLevel();
  const bin = level.bin;
  const g = binGeom(bin);
  const world = makeWorld(level);
  const rand = mulberry(99);
  let made = 0;
  for (let k = 0; k < 250; k++) {
    world.clear();
    const dist = 2 + rand() * 3;
    const ang = (rand() - 0.5) * 1.2;
    const origin = V(Math.sin(ang) * dist, 1 + rand() * 0.6, -3 + Math.cos(ang) * dist);
    const yaw = Math.atan2(origin.x, origin.z + 3) + (rand() - 0.5) * 0.08;
    const pitch = 0.35 + rand() * 0.7;
    // Rough ballistic speed for this pitch, jittered so throws land short, long and on the rim.
    const hd = Math.hypot(origin.x, origin.z + 3);
    const dy = g.yRim - origin.y;
    const c = Math.cos(pitch);
    const speed = Math.min(THROW.maxSpeed, Math.sqrt((PHYS.gravity * hd * hd) / (2 * c * c * (hd * Math.tan(pitch) - dy))) * (0.97 + rand() * 0.12));
    const b = throwBall(world, origin, launchVelocity(yaw, pitch, speed));
    const calls = run(world, PHYS.maxFlightTime + 1).filter((e) => e.type === 'score' || e.type === 'rest');
    assert.equal(calls.length, 1, `throw ${k}: one call`);
    run(world, 3);
    const { rc, y } = binLocal(bin, b.pos);
    const inside = rc < g.Rm && y < bin.height;
    assert.equal(calls[0].type === 'score', inside, `throw ${k}: ${calls[0].type} but inside=${inside}`);
    if (inside) made++;
  }
  assert.ok(made > 20 && made < 230, `a real mix of makes and misses (${made})`);
});

test('a ball stuck bouncing past maxFlightTime still resolves', () => {
  // Zero-gravity-like situation: a ball that never settles because it keeps flying in a huge empty room.
  const world = new PhysicsWorld();
  world.setLevel({ bin: null, colliders: { room: { min: V(-500, 0, -500), max: V(500, 900, 500), materials: {} } } });
  const b = throwBall(world, V(0, 1, 0), V(0, 60, 0));
  const events = run(world, PHYS.maxFlightTime + 0.5);
  assert.equal(events.filter((e) => e.type === 'rest').length, 1);
  assert.ok(b.resolved);
});

test('balls cannot escape the room at max speed', () => {
  const level = makeLevel();
  const { min, max } = level.colliders.room;
  const world = makeWorld(level);
  const rand = mulberry(42);
  const balls = [];
  for (let i = 0; i < 40; i++) {
    const yaw = rand() * Math.PI * 2;
    const pitch = (rand() - 0.3) * Math.PI;
    balls.push(throwBall(world, V(rand() * 2 - 1, 1 + rand(), rand() * 2 - 2), launchVelocity(yaw, pitch, THROW.maxSpeed * 1.3)));
  }
  let ok = true;
  run(world, 6, () => {
    for (const b of balls) {
      const p = b.pos;
      if (!Number.isFinite(p.x + p.y + p.z)) ok = false;
      if (p.x < min.x || p.x > max.x || p.y < min.y || p.y > max.y || p.z < min.z || p.z > max.z) ok = false;
    }
  });
  assert.ok(ok, 'all balls stayed inside the room');
});

test('a throw solved with predictTrajectory from ~3.5 m drops through the opening and scores', () => {
  const level = makeLevel();
  const world = makeWorld(level);
  const origin = V(0.17, 1.1, 0.5); // 3.5 m from the bin, seated hand height
  const sol = solveSwish(world, origin, level.bin);
  assert.ok(sol, 'found a throw');
  // The prediction reports where the path drops through the opening.
  const pred = predictTrajectory(world, origin, sol.v, { maxTime: 3 });
  const g = binGeom(level.bin);
  assert.ok(pred.entry, 'entry through the opening');
  assert.ok(Math.abs(pred.entry.center.y - g.yRim) < 1e-9 && Math.abs(pred.entry.radius - (g.Rm - level.bin.rimTube)) < 1e-9);
  assert.ok(binLocal(level.bin, pred.entry.point).rc < pred.entry.radius);
  assert.ok(pred.entry.time > 0 && pred.entry.time < pred.hit.time);
  const b = throwBall(world, origin, sol.v);
  const events = run(world, 4);
  const score = events.find((e) => e.type === 'score');
  assert.ok(score, `scored (pitch ${sol.pitchDeg}°, ${sol.speed.toFixed(2)} m/s)`);
  assert.equal(score.ball, b);
  assert.equal(score.swish, true);
});

test('a ball landing on the rim from a real throw is not a swish', () => {
  const level = makeLevel();
  const world = makeWorld(level);
  const origin = V(0, 1.1, 0.5);
  // Aim a little long so the ball clips the far rim.
  const g = binGeom(level.bin);
  let chosen = null;
  for (let speed = 5; speed < 9 && !chosen; speed += 0.005) {
    const v = launchVelocity(0, (40 * Math.PI) / 180, speed);
    const p = predictTrajectory(world, origin, v);
    if (p.hit?.material === 'rim' && p.hit.point.z < level.bin.position.z) chosen = v;
  }
  assert.ok(chosen);
  const b = throwBall(world, origin, chosen);
  const events = run(world, 5);
  assert.ok(b.touchedRim);
  const score = events.find((e) => e.type === 'score');
  if (score) assert.equal(score.swish, false);
  assert.ok(g.Rm > 0);
});

test('several balls pile up in the bin without exploding', () => {
  const level = makeLevel();
  const bin = level.bin;
  const world = makeWorld(level);
  const balls = [];
  const scores = new Set();
  const rand = mulberry(7);
  for (let i = 0; i < 9; i++) {
    const b = throwBall(world, V((rand() - 0.5) * 0.12, 1.0, -3 + (rand() - 0.5) * 0.12), V(0, -1, 0));
    balls.push(b);
    run(world, 1.2, (ev) => {
      for (const e of ev) if (e.type === 'score') scores.add(e.ball);
    });
  }
  run(world, 3, (ev) => {
    for (const e of ev) if (e.type === 'score') scores.add(e.ball);
  });
  assert.equal(scores.size, balls.length, 'every ball scored once');
  const g = binGeom(bin);
  for (const b of balls) {
    assert.ok(b.vel.length() < 0.2, `settled (v=${b.vel.length()})`);
    const { rc, y } = binLocal(bin, b.pos);
    assert.ok(rc < g.Rm && y > 0 && y < bin.height + R, 'still in the bin');
  }
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const d = balls[i].pos.distanceTo(balls[j].pos);
      assert.ok(d > 2 * R - 0.006, `overlap ${2 * R - d}`);
    }
  }
  assert.ok(balls.filter((b) => b.sleeping).length >= balls.length - 1, 'pile goes to sleep');
});

test('a deep pile in the narrow office basket goes to sleep and stays in the bin', () => {
  // Real office basket numbers. It is only ~3.4 balls across, so a single contact pass per step
  // used to leave the pile overlapping by ~1 cm, which kept re-waking it forever.
  const { x, z, ...dims } = OFFICE_BIN;
  const level = makeLevel(dims);
  const bin = level.bin;
  const g = binGeom(bin);
  const world = makeWorld(level);
  const rand = mulberry(20);
  const scored = new Set();
  const opening = g.Rm - bin.rimTube;
  const balls = [];
  for (let i = 0; i < 20; i++) {
    // One basket at a time, dropped through a random point of the opening.
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * (opening - R - 0.01);
    const p = V(Math.cos(a) * rr, g.yRim + 0.35, -3 + Math.sin(a) * rr);
    balls.push(throwBall(world, p, V((rand() - 0.5) * 0.4, -2, (rand() - 0.5) * 0.4)));
    run(world, 2, (ev) => {
      for (const e of ev) if (e.type === 'score') scored.add(e.ball);
    });
  }
  assert.equal(scored.size, 20, 'every ball scored');
  world.wakeAll(); // what main.js does when it retires a ball
  let asleepAt = null;
  run(world, 3, (ev, i) => {
    if (balls.every((b) => b.sleeping)) {
      asleepAt = (i + 1) * FRAME;
      return true;
    }
    return false;
  });
  assert.ok(asleepAt !== null, `asleep within 3 s (awake: ${balls.filter((b) => !b.sleeping).length})`);
  const settled = balls.map((b) => b.pos.clone());
  run(world, 5);
  assert.ok(balls.every((b) => b.sleeping), 'stays asleep');
  for (let i = 0; i < balls.length; i++) {
    assert.ok(balls[i].pos.distanceTo(settled[i]) < 1e-9, 'no drift while asleep');
    const { rc, y } = binLocal(bin, balls[i].pos);
    assert.ok(y > 0 && y < g.yRim + bin.rimTube + R, `ball ${i} below the rim (${y})`);
    assert.ok(wallSide(bin, balls[i].pos) < -(g.t + R) + 0.002, `ball ${i} inside the wall (rc ${rc})`);
    for (let j = i + 1; j < balls.length; j++) {
      const ov = 2 * R - balls[i].pos.distanceTo(balls[j].pos);
      assert.ok(ov < 0.002, `balls ${i}/${j} overlap by ${(ov * 1000).toFixed(1)} mm`);
    }
  }
});

test('a ball landing on a pile in the bin still counts', () => {
  // A shallow bin so the pile reaches the opening: later balls rest on top, above the strict test height.
  const level = makeLevel({ height: 0.14, radiusTop: 0.1, radiusBottom: 0.09 });
  const world = makeWorld(level);
  const scored = new Set();
  const balls = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    balls.push(throwBall(world, V(Math.cos(a) * 0.02, 0.8, -3 + Math.sin(a) * 0.02), V(0, 0, 0)));
    run(world, 1.5, (ev) => {
      for (const e of ev) if (e.type === 'score') scored.add(e.ball);
    });
  }
  // The last ball can slide off the top of the pile and settle against the rim; let it come to rest.
  run(world, 3, (ev) => {
    for (const e of ev) if (e.type === 'score') scored.add(e.ball);
  });
  assert.ok(balls.every((b) => b.resolved), 'every ball called');
  const g = binGeom(level.bin);
  const high = balls.filter((b) => b.pos.y > g.yRim - R && binLocal(level.bin, b.pos).rc < g.Rm);
  assert.ok(high.length > 0, 'the pile reaches the opening');
  for (const b of high) assert.ok(scored.has(b), 'ball resting on the pile scored');
  for (const b of balls) {
    if (binLocal(level.bin, b.pos).rc < g.Rm - 0.02) assert.ok(scored.has(b));
  }
});

test('a ball dropped on a desk rests on top; one dropped on a cylinder rests on its cap', () => {
  const level = makeLevel();
  const world = makeWorld(level);
  const onDesk = throwBall(world, V(1.7, 1.2, -3.1), V(0, 0, 0));
  const onCyl = throwBall(world, V(-1.5, 1.2, -3), V(0, 0, 0));
  run(world, 3);
  assert.ok(Math.abs(onDesk.pos.y - (0.75 + R)) < 0.002, `desk ${onDesk.pos.y}`);
  assert.ok(Math.abs(onCyl.pos.y - (0.6 + R)) < 0.002, `cyl ${onCyl.pos.y}`);
  assert.ok(onDesk.sleeping && onCyl.sleeping);
});

test('a sleeping ball wakes when another ball knocks it', () => {
  const world = makeWorld();
  const a = throwBall(world, V(0.5, R, -1), V(0, 0, 0));
  run(world, 1);
  assert.ok(a.sleeping);
  throwBall(world, V(-0.5, R + 0.002, -1), V(3, 0, 0));
  let woke = false;
  run(world, 1, () => {
    if (!a.sleeping) woke = true;
  });
  assert.ok(woke);
  assert.ok(a.pos.x > 0.53, `knocked along (${a.pos.x})`);
});

test('removing a ball wakes the one resting on it', () => {
  const world = makeWorld();
  const low = throwBall(world, V(0, R, -1), V(0, 0, 0));
  run(world, 1);
  // Stacked dead centre, so it balances on the first ball.
  const top = throwBall(world, V(0, 3 * R + 0.001, -1), V(0, 0, 0));
  run(world, 2);
  assert.ok(top.sleeping && low.sleeping, 'stack sleeps');
  assert.ok(Math.abs(top.pos.y - 3 * R) < 0.003, `supported by the first ball (${top.pos.y})`);
  world.removeBall(low);
  assert.equal(world.balls.length, 1);
  assert.equal(top.sleeping, false, 'woken by the removal');
  run(world, 2);
  assert.ok(Math.abs(top.pos.y - R) < 0.003, `fell to the floor (${top.pos.y})`);
});

test('bounce events carry material and are throttled for rolling', () => {
  const world = makeWorld();
  const b = throwBall(world, V(0, 1.5, 0), V(0.8, 0, -1));
  const events = run(world, 4);
  const bounces = events.filter((e) => e.type === 'bounce');
  assert.ok(bounces.length > 0 && bounces.length < 20, `bounces ${bounces.length}`);
  assert.equal(bounces[0].material, 'carpet');
  assert.ok(bounces[0].speed > 5);
  for (const e of bounces) assert.ok(e.speed > 0.3 && e.ball === b);
});

test('step performance: 15 balls for 1000 frames', () => {
  const level = makeLevel();
  const world = makeWorld(level);
  const rand = mulberry(3);
  for (let i = 0; i < 15; i++) {
    throwBall(world, V(rand() * 2 - 1, 1.2, rand()), launchVelocity(rand() - 0.5, 0.2 + rand() * 0.8, 3 + rand() * 7));
  }
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) world.step(FRAME);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `1000 frames took ${ms.toFixed(1)} ms`);
  // And a prediction per frame stays cheap.
  const t1 = performance.now();
  for (let i = 0; i < 200; i++) predictTrajectory(world, V(0, 1.2, 0.5), launchVelocity(i * 0.001, 0.6, 7), { maxTime: 3 });
  const pms = (performance.now() - t1) / 200;
  assert.ok(pms < 4, `prediction ${pms.toFixed(3)} ms`);
});

test('the frame accumulator runs fixed steps and clamps long frames', () => {
  const world = makeWorld();
  throwBall(world, V(0, 2, 0), V(0, 0, 0));
  const t0 = world.time;
  world.step(PHYS.dt * 2.5);
  assert.ok(Math.abs(world.time - t0 - 2 * PHYS.dt) < 1e-12);
  world.step(PHYS.dt * 0.5);
  assert.ok(Math.abs(world.time - t0 - 3 * PHYS.dt) < 1e-12);
  const t1 = world.time;
  world.step(5);
  assert.ok(Math.abs(world.time - t1 - PHYS.maxStepsPerFrame * PHYS.dt) < 1e-9);
});

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
