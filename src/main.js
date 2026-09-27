import * as THREE from 'three';
import './styles.css';
import { THROW, RULES } from './config.js';
import { PhysicsWorld, Ball, predictTrajectory } from './physics.js';
import { ARC_TOP, framingFor, rimCenter, aimPitch, flightFollow, releaseOrigin, throwVelocity } from './aim.js';
import { createPaperBall } from './paperBall.js';
import { TrajectoryGuide, FlightTrail } from './trajectory.js';
import { UI } from './ui.js';
import { ThrowInput, releaseGameLock } from './input.js';
import { AudioFX } from './audio.js';
import { Confetti } from './effects.js';
import { buildColliderDebug } from './utils/debugColliders.js';

// Levels are code-split: the beach house is only built when the office is cleared.
const LEVEL_FACTORIES = {
  office: () => import('./levels/office.js').then((m) => m.createOfficeLevel),
  beach: () => import('./levels/beach.js').then((m) => m.createBeachLevel),
};
// Shown on the level-complete card before the next level has been built.
const LEVEL_TITLES = { office: 'Macrodata Refinement', beach: 'Casa Marea' };
const MAX_BALLS_IN_BIN = 22;
// Render scale cap: 2x on Retina costs ~40% of the frame on the beach for little visible gain with MSAA.
const MAX_PIXEL_RATIO = 1.5;
// The controls hint retires once the player has the idea.
const HINT_THROWS = 3;

const params = new URLSearchParams(location.search);
const DEBUG = params.get('debug') === '1';
const START_LEVEL = clamp((parseInt(params.get('level'), 10) || 1) - 1, 0, RULES.levelIds.length - 1);

// ---------------------------------------------------------------------------
// Renderer, camera, shared objects

const canvas = document.getElementById('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  fatal('Trashketball needs WebGL, and this browser could not start it.');
  throw err;
}
let pixelRatioCap = MAX_PIXEL_RATIO;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // soft (PCFSoftShadowMap is deprecated in r18x)
// Almost every shadow caster is static, so shadow maps are only redrawn when something moves (see frame).
renderer.shadowMap.autoUpdate = false;

const pmrem = new THREE.PMREMGenerator(renderer);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.02, 600);
camera.rotation.order = 'YXZ';
// The player's hand: a fixed point in camera space. The ball in it animates (wind-up, bob) as a child,
// but throws always leave from the hand itself, so a tap and a long wind-up throw the same arc.
const hand = new THREE.Group();
camera.add(hand);

const world = new PhysicsWorld();
const guide = new TrajectoryGuide();
const trail = new FlightTrail();
const confetti = new Confetti();
const ui = new UI(document.getElementById('ui-root') ?? document.body);
ui.onGuideToggle = toggleGuide;
const audio = new AudioFX();
const input = new ThrowInput(canvas, {
  onThrow: () => throwBall(),
  onToggleGuide: toggleGuide,
  onTogglePause: () => setPaused(!game.paused),
  onToggleMute: toggleMute,
  onFirstGesture: () => audio.unlock(),
});
input.setEnabled(false);

// Where the hand sits in camera space. x is pulled in on narrow screens so the ball stays in view.
const HAND = new THREE.Vector3(THROW.handOffset.x, THROW.handOffset.y, THROW.handOffset.z);

const game = {
  phase: 'loading', // loading | title | aiming | flight | resolving | moving | menu
  paused: false,
  levelIndex: 0,
  level: null,
  scene: null,
  debugOverlay: null,
  score: 0,
  shots: 0,
  makes: 0,
  swishes: 0,
  streak: 0,
  bestStreak: 0,
  tally: { shots: 0, makes: 0, swishes: 0, bestStreak: 0 }, // current level only
  spotIndex: 0,
  guideFull: false,
  endless: false,
  hintRetired: false,
  held: null, // paper ball mesh in the player's hand
  heldAge: 0,
  activeBall: null, // Ball currently in flight
  loose: [], // missed balls lying around
  inBin: [], // scored balls
  fading: [], // meshes shrinking away
  timers: [],
  view: null, // current framing (see aim.js framingFor), animated while gliding
  glide: null, // { from, to, t, dur, done } while moving between shot spots
  kick: 0, // camera recoil after a throw
  windup: 0, // 0..1 eased "button held" amount for the hand animation
  follow: 0, // extra camera pitch (radians) that keeps a high lob in frame
  wobble: { amp: 0, t: 0, axis: new THREE.Vector3() },
  shadowsDirty: true,
  anyAwake: false,
  ballSeed: 1,
  elapsed: 0,
};

// The aim the guide drew last frame; a throw uses exactly this, so what you saw is what you throw.
const aim = { valid: false, yaw: 0, launchPitch: 0, power: 0, camPitch: 0, origin: new THREE.Vector3(), vel: new THREE.Vector3() };
const lastAim = { ...aim, origin: new THREE.Vector3(), vel: new THREE.Vector3() };

// Where the top HUD row ends, so the camera keeps arcs below it and the score panel can step aside.
const hud = { arcTop: ARC_TOP, score: null, ghost: false };

// Scratch objects reused every frame.
const tmpQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Level lifecycle

async function buildLevel(index) {
  const id = RULES.levelIds[index];
  const create = await LEVEL_FACTORIES[id]();
  return create({ renderer, pmrem, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
}

async function activateLevel(level, index) {
  const old = game.level;
  if (old) {
    // Take everything main.js owns out of the old scene first, so the level's dispose() can't touch it.
    old.scene.remove(camera, guide.object, trail.object, confetti.object);
    for (const b of world.balls) b.mesh?.removeFromParent();
    for (const f of game.fading) f.mesh.removeFromParent();
    world.clear();
    game.held?.removeFromParent();
    game.held = null;
    game.debugOverlay?.removeFromParent();
    old.dispose?.();
  }
  game.level = level;
  game.levelIndex = index;
  game.scene = level.scene;
  game.activeBall = null;
  game.loose = [];
  game.inBin = [];
  game.fading = [];
  game.timers = [];
  game.tally = { shots: 0, makes: 0, swishes: 0, bestStreak: 0 };
  game.spotIndex = 0;
  game.glide = null;
  game.follow = 0;
  game.wobble.amp = 0;
  game.wobble.t = 0;
  level.bin.object.userData.baseQuat = level.bin.object.quaternion.clone();
  game.shadowsDirty = true;

  const scene = level.scene;
  scene.add(camera, guide.object, trail.object, confetti.object);
  trail.clear();
  if (DEBUG) {
    game.debugOverlay = buildColliderDebug(level);
    scene.add(game.debugOverlay);
  }
  renderer.toneMappingExposure = level.exposure ?? 1;
  world.setLevel(level);

  guide.setTheme(level.theme);
  trail.setTheme(level.theme);
  confetti.setTheme(level.theme);
  ui.setTheme(level.theme);
  ui.setLevel(index, level.name, level.subtitle);
  updateScoreUI();
  audio.setAmbience(level.theme);
  document.documentElement.dataset.theme = level.theme;

  game.view = framingFor(level.bin, level.shotSpots[0]);
  input.maxPitch = level.maxPitch ?? THROW.maxPitch;
  input.resetAim();
  ui.setAim({ pitchDeg: THREE.MathUtils.radToDeg(input.pitch), guideFull: game.guideFull });
  requestAnimationFrame(measureHud); // the themes size the HUD differently
  applyCamera(0);
  await warmUpShaders(scene);
}

/** Compile every material the first throw and first basket will need, so neither hitches. */
async function warmUpShaders(scene) {
  const ball = createPaperBall({ seed: 0, style: game.level.theme });
  ball.position.set(0, -50, 0);
  scene.add(ball);
  // compileAsync only visits visible objects.
  const hidden = [guide.object, trail.object, confetti.object].filter((o) => !o.visible);
  hidden.forEach((o) => (o.visible = true));
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    // an optimisation only
  }
  hidden.forEach((o) => (o.visible = false));
  ball.removeFromParent();
}

function levelTarget(index = game.levelIndex) {
  return (index + 1) * RULES.pointsPerLevel;
}

function binRimCenter(out = new THREE.Vector3()) {
  return rimCenter(game.level.bin, out);
}

// ---------------------------------------------------------------------------
// Camera, aim, held ball

function currentYaw() {
  return game.view.yaw + input.yaw;
}

/** Share of the distance to the bin the short guide reveals (the level's tuning; G shows all of it). */
function guideReach() {
  return game.level.guideReach ?? 0.5;
}

/** Camera pitch while aiming: a pure function of the spot and the current aim (see aim.js). */
function aimingPitch(power = input.power) {
  return aimPitch(game.view, input.pitch, power, camera.fov, guideReach(), hud.arcTop);
}

/** Release point and launch velocity for the current aim, written into `aim`. */
function computeAim(power = input.power) {
  aim.yaw = currentYaw();
  aim.launchPitch = input.pitch;
  aim.power = power;
  aim.camPitch = aimingPitch(power);
  releaseOrigin(game.view.eye, aim.yaw, aim.camPitch, HAND, aim.origin);
  throwVelocity(game.view, aim.origin, aim.yaw, aim.launchPitch, power, aim.vel);
  aim.valid = true;
  return aim;
}

function applyCamera(dt) {
  if (game.glide) {
    const g = game.glide;
    g.t = Math.min(1, g.t + dt / g.dur);
    const k = g.t * g.t * (3 - 2 * g.t);
    game.view.eye.lerpVectors(g.from.eye, g.to.eye, k);
    game.view.yaw = g.from.yaw + shortestAngle(g.from.yaw, g.to.yaw) * k;
    game.view.pitch = THREE.MathUtils.lerp(g.from.pitch, g.to.pitch, k);
    game.view.dist = THREE.MathUtils.lerp(g.from.dist, g.to.dist, k);
    if (g.t >= 1) {
      game.glide = null;
      g.done?.();
    }
  }
  const v = game.view;
  let yaw = currentYaw();
  let pitch = aimingPitch();
  if (game.phase === 'title') {
    // Attract mode: a slow look around while the title card is up.
    pitch = v.pitch + Math.sin(game.elapsed * 0.17) * 0.03;
    yaw += Math.sin(game.elapsed * 0.25) * 0.18;
  }
  // Tilt up to keep a high lob in frame (never losing the rim), then settle back.
  const ball = game.activeBall;
  const follow = ball && game.phase === 'flight' ? flightFollow(v, pitch, ball.pos, camera.fov, hud.arcTop) : 0;
  const rate = follow > game.follow ? 9 : game.phase === 'aiming' ? 12 : 3;
  game.follow += (follow - game.follow) * Math.min(1, dt * rate);
  game.kick = Math.max(0, game.kick - dt * 4);
  camera.position.copy(v.eye);
  camera.rotation.set(pitch + game.follow + game.kick * 0.035, yaw, 0);
  camera.updateMatrixWorld();
}

function spawnHeldBall() {
  const mesh = createPaperBall({ seed: game.ballSeed++, style: game.level.theme });
  mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  mesh.scale.setScalar(0.001);
  mesh.castShadow = false; // it bobs every frame; shadow maps only redraw when something in the room moves
  hand.add(mesh);
  game.held = mesh;
  game.heldAge = 0;
}

function updateHeldBall(dt) {
  const m = game.held;
  if (!m) return;
  game.heldAge += dt;
  m.scale.setScalar(easeOutBack(Math.min(1, game.heldAge / 0.25)));
  // Cosmetic wind-up: the ball draws back while the button is held, further for more power.
  game.windup += ((input.charging ? 1 : 0) - game.windup) * Math.min(1, dt * 12);
  const draw = game.windup * (0.35 + 0.65 * input.power);
  const bob = Math.sin(game.elapsed * 2.1) * 0.004;
  // On narrow screens the ball stays put sideways and in depth, so it never grows over the bin.
  const narrow = HAND.x < THROW.handOffset.x;
  m.position.set(narrow ? 0 : draw * 0.02, -draw * 0.05 + bob, narrow ? 0 : draw * 0.1);
  m.rotation.y += dt * 0.4;
}

// ---------------------------------------------------------------------------
// Throwing

/**
 * Throw the ball in hand. With no argument it throws exactly the aim the guide drew last frame; the test
 * hook passes an explicit power.
 */
function throwBall(power) {
  if (game.phase !== 'aiming' || game.paused || !game.held) return;
  const a = power === undefined && lastAim.valid ? lastAim : computeAim(power ?? input.power);
  const mesh = game.held;
  mesh.getWorldQuaternion(tmpQuat);
  mesh.removeFromParent();
  mesh.scale.setScalar(1);
  mesh.position.copy(a.origin);
  mesh.quaternion.copy(tmpQuat);
  mesh.castShadow = true;
  game.scene.add(mesh);

  const ball = new Ball(mesh);
  ball.pos.copy(a.origin);
  ball.vel.copy(a.vel);
  // Backspin around the camera's right axis plus a little wobble.
  const right = tmpVec.set(1, 0, 0).applyQuaternion(camera.quaternion);
  ball.angVel.copy(right).multiplyScalar(-(6 + Math.random() * 5));
  ball.angVel.y += (Math.random() - 0.5) * 4;
  ball.quaternion.copy(tmpQuat);
  world.addBall(ball);
  trail.begin(ball);
  guide.setVisible(false);

  game.held = null;
  game.activeBall = ball;
  game.phase = 'flight';
  input.setEnabled(false); // back on with the next ball; hides the touch throw button meanwhile
  game.shots++;
  game.tally.shots++;
  game.kick = 1;
  lastAim.valid = false;
  audio.play('throw', { intensity: 0.35 + a.power * 0.65 });
  if (game.shots >= HINT_THROWS) retireHint();
  else ui.setHint('');
  updateStatsUI();
}

function updateGuide() {
  if (game.phase !== 'aiming' || !game.held) {
    guide.setVisible(false);
    lastAim.valid = false;
    return;
  }
  const a = computeAim();
  const pred = predictTrajectory(world, a.origin, a.vel, { maxTime: 3.5 });
  let visibleTime = Infinity;
  if (!game.guideFull) {
    // Reveal the arc until it has covered a fixed share of the distance to the bin.
    const reach = guideReach() * game.view.dist;
    const { points, times } = pred;
    visibleTime = times[times.length - 1] ?? 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (Math.hypot(p.x - a.origin.x, p.z - a.origin.z) >= reach) {
        visibleTime = times[i];
        break;
      }
    }
  }
  guide.setVisible(true);
  guide.update(pred, { visibleTime, full: game.guideFull });
  let behindScore = false;
  for (let i = 0; i < pred.points.length && pred.times[i] <= visibleTime && !behindScore; i += 2) {
    behindScore = behindScorePanel(pred.points[i]);
  }
  setScoreGhost(behindScore);
  Object.assign(lastAim, { valid: true, yaw: a.yaw, launchPitch: a.launchPitch, power: a.power, camPitch: a.camPitch });
  lastAim.origin.copy(a.origin);
  lastAim.vel.copy(a.vel);
}

// ---------------------------------------------------------------------------
// Physics events and throw resolution

function handleEvent(ev) {
  const theme = game.level.bin.sound;
  if (ev.type === 'bounce') {
    const intensity = clamp(ev.speed / 5, 0.08, 1);
    switch (ev.material) {
      case 'rim':
        audio.play('rim', { intensity, material: theme });
        wobbleBin(ev.ball, intensity);
        break;
      case 'binWall':
        audio.play('binWall', { intensity, material: theme });
        wobbleBin(ev.ball, intensity * 0.5);
        break;
      case 'binFloor':
        audio.play('binIn', { intensity });
        break;
      default:
        audio.play('bounce', { intensity, material: ev.material });
    }
    return;
  }
  if (ev.type === 'score') {
    if (!game.inBin.includes(ev.ball)) game.inBin.push(ev.ball);
    game.loose = game.loose.filter((b) => b !== ev.ball);
    if (ev.ball === game.activeBall) resolveThrow(true, ev.swish);
    trimBin();
    return;
  }
  if (ev.type === 'rest') {
    if (ev.ball === game.activeBall) resolveThrow(false, false);
  }
}

function resolveThrow(made, swish) {
  const ball = game.activeBall;
  game.activeBall = null;
  game.phase = 'resolving';
  if (made) {
    game.score += RULES.pointsPerBasket;
    game.makes++;
    game.tally.makes++;
    game.streak++;
    game.bestStreak = Math.max(game.bestStreak, game.streak);
    game.tally.bestStreak = Math.max(game.tally.bestStreak, game.streak);
    if (swish) {
      game.swishes++;
      game.tally.swishes++;
    }
    ui.flash(swish ? `Swish! +${RULES.pointsPerBasket}` : `+${RULES.pointsPerBasket}`, swish ? 'swish' : 'score');
    audio.play(swish ? 'swish' : 'score');
    confetti.burst(binRimCenter().add(tmpVec.set(0, 0.05, 0)));
    retireHint();
    updateScoreUI();
    const cleared = !game.endless && game.score >= levelTarget();
    after(cleared ? 1.2 : 0.9, cleared ? () => onLevelCleared().catch(failHard) : advanceSpot);
  } else {
    game.streak = 0;
    game.loose.push(ball);
    trimLoose();
    ui.flash(ball?.touchedRim ? 'Rim out' : 'Miss', ball?.touchedRim ? 'rim' : 'miss');
    audio.play('miss', { intensity: 0.6 });
    after(RULES.nextBallDelay, readyNextBall);
  }
  updateStatsUI();
}

function readyNextBall() {
  spawnHeldBall();
  game.phase = 'aiming';
  input.setEnabled(true);
  audio.play('crumple', { intensity: 0.6 });
  ui.setHint(game.hintRetired ? '' : aimHint());
}

function retireHint() {
  game.hintRetired = true;
  ui.setHint('');
}

function advanceSpot() {
  const spots = game.level.shotSpots;
  moveToSpot((game.spotIndex + 1) % spots.length, readyNextBall);
}

function moveToSpot(index, done) {
  game.spotIndex = index;
  const to = framingFor(game.level.bin, game.level.shotSpots[index]);
  const from = { ...game.view, eye: game.view.eye.clone(), yaw: currentYaw() };
  input.yaw = 0;
  game.phase = 'moving';
  game.glide = { from, to, t: 0, dur: 1.15, done };
  game.view = { ...from, eye: from.eye.clone() };
  ui.flash(game.level.shotSpots[index].label ?? `Spot ${index + 1}`, 'info');
}

function trimLoose() {
  while (game.loose.length > RULES.maxLooseBalls) retireBall(game.loose.shift());
}

function trimBin() {
  while (game.inBin.length > MAX_BALLS_IN_BIN) retireBall(game.inBin.shift());
}

function retireBall(ball) {
  if (!ball) return;
  world.removeBall(ball);
  world.wakeAll();
  if (ball.mesh) game.fading.push({ mesh: ball.mesh, t: 0 });
}

function updateFading(dt) {
  game.fading = game.fading.filter((f) => {
    f.t += dt / 0.4;
    f.mesh.scale.setScalar(Math.max(0.001, 1 - f.t));
    if (f.t >= 1) {
      f.mesh.removeFromParent();
      return false;
    }
    return true;
  });
}

function wobbleBin(ball, intensity) {
  const w = game.wobble;
  const bin = game.level.bin;
  // Tilt away from the impact side.
  w.axis.set(ball.pos.z - bin.position.z, 0, -(ball.pos.x - bin.position.x)).normalize();
  w.amp = Math.min(0.08, w.amp + 0.05 * intensity);
  w.t = 0;
}

function updateWobble(dt) {
  const w = game.wobble;
  const obj = game.level?.bin.object;
  const base = obj?.userData.baseQuat;
  if (!base || w.amp <= 0) return;
  w.t += dt;
  const angle = w.amp * Math.exp(-w.t * 7) * Math.sin(w.t * 32);
  obj.quaternion.copy(base).premultiply(tmpQuat.setFromAxisAngle(w.axis, angle));
  if (w.t > 1) {
    w.amp = 0;
    obj.quaternion.copy(base);
  }
}

// ---------------------------------------------------------------------------
// Level flow

async function onLevelCleared() {
  game.phase = 'menu';
  input.setEnabled(false);
  releasePointer();
  guide.setVisible(false);
  const index = game.levelIndex;
  const isFinal = index >= RULES.levelIds.length - 1;
  const stats = levelStats();

  if (!isFinal) {
    audio.play('levelUp');
    const nextId = RULES.levelIds[index + 1];
    // Build while the card is up; a failure surfaces after Continue (and is retried there).
    const building = buildLevel(index + 1);
    building.catch(() => {});
    await ui.showLevelComplete({ index, name: game.level.name, stats, nextName: LEVEL_TITLES[nextId] });
    ui.setLoading('Checking in…');
    await delay(450); // let the card finish fading before the HUD switches theme under it
    let next;
    try {
      next = await buildWithRetry(index + 1, building);
    } catch (err) {
      failHard(err, index + 2);
      return;
    }
    await activateLevel(next, index + 1);
    ui.setLoading(null);
    await ui.showLevelIntro({ index: index + 1, name: next.name, subtitle: next.subtitle, goal: goalText() });
    readyNextBall();
    return;
  }

  audio.play('victory');
  const choice = await ui.showVictory({ stats: totalStats() });
  if (choice === 'again') {
    await restart();
  } else {
    game.endless = true;
    updateScoreUI();
    moveToSpot((game.spotIndex + 1) % game.level.shotSpots.length, readyNextBall);
  }
}

/**
 * Await a level build, retrying a failed build twice. A failed code-split import is not retried: the
 * browser caches that failure for the life of the page, so only a reload can fetch the chunk again.
 */
async function buildWithRetry(index, first) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await (attempt === 0 && first ? first : buildLevel(index));
    } catch (err) {
      lastErr = err;
      console.error(err);
      if (/dynamically imported module|importing a module script failed/i.test(String(err?.message))) break;
    }
  }
  throw lastErr;
}

async function restart() {
  ui.setLoading('Reporting to the severed floor…');
  Object.assign(game, { score: 0, shots: 0, makes: 0, swishes: 0, streak: 0, bestStreak: 0, endless: false });
  let level;
  try {
    level = await buildWithRetry(0);
  } catch (err) {
    failHard(err, 1);
    return;
  }
  await activateLevel(level, 0);
  ui.setLoading(null);
  updateStatsUI();
  await ui.showLevelIntro({ index: 0, name: level.name, subtitle: level.subtitle, goal: goalText() });
  readyNextBall();
}

/**
 * Show a load failure with a way back in. A reload lands directly in `levelNumber` (1-based) with the
 * score the player had when entering it.
 */
function failHard(err, levelNumber = game.levelIndex + 1) {
  console.error(err);
  releasePointer();
  ui.setLoading(null);
  fatal('The next room could not be loaded. Check your connection, then reload to carry on from here.', {
    label: 'Reload',
    run: () => {
      location.search = `?level=${levelNumber}`;
    },
  });
}

function goalText() {
  const need = levelTarget() - game.score;
  return `Sink ${need / RULES.pointsPerBasket} baskets · reach ${levelTarget()} points`;
}

function levelStats() {
  const l = game.tally;
  return {
    score: game.score,
    shots: l.shots,
    makes: l.makes,
    swishes: l.swishes,
    accuracy: l.shots ? Math.round((100 * l.makes) / l.shots) : 0,
    bestStreak: l.bestStreak,
  };
}

function totalStats() {
  return {
    score: game.score,
    shots: game.shots,
    makes: game.makes,
    swishes: game.swishes,
    accuracy: game.shots ? Math.round((100 * game.makes) / game.shots) : 0,
    bestStreak: game.bestStreak,
  };
}

function updateScoreUI() {
  const start = game.levelIndex * RULES.pointsPerLevel;
  ui.setScore(game.score, start, game.endless ? Infinity : levelTarget());
}

function updateStatsUI() {
  ui.setStats({ shots: game.shots, makes: game.makes, streak: game.streak });
}

function aimHint() {
  return input.mode === 'touch'
    ? 'Drag to aim · hold the throw button and slide up for power · release to throw'
    : 'Mouse aims · hold click and pull back for power · release to throw · [G] full arc';
}

// ---------------------------------------------------------------------------
// Pause, mute, guide

const PLAYING = new Set(['aiming', 'flight', 'resolving', 'moving']);

function setPaused(paused) {
  if (paused && !PLAYING.has(game.phase)) return;
  if (game.paused === paused) return;
  game.paused = paused;
  drewPaused = false;
  ui.showPause(paused);
  input.setEnabled(!paused && game.phase === 'aiming');
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  ui.setMuted(audio.muted);
  ui.flash(audio.muted ? 'Sound off' : 'Sound on', 'info');
}

function toggleGuide() {
  game.guideFull = !game.guideFull;
  ui.flash(game.guideFull ? 'Full trajectory guide' : 'Partial trajectory guide', 'info');
}

function releasePointer() {
  releaseGameLock(); // an expected unlock, so input doesn't read it as the player pausing
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

// ---------------------------------------------------------------------------
// Timers (game time, so they freeze while paused)

function after(seconds, fn) {
  game.timers.push({ t: seconds, fn });
}

function runTimers(dt) {
  if (!game.timers.length) return;
  const due = [];
  game.timers = game.timers.filter((tm) => {
    tm.t -= dt;
    if (tm.t <= 0) {
      due.push(tm.fn);
      return false;
    }
    return true;
  });
  due.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Main loop

let last = performance.now();
let drewPaused = false;

function frame(now) {
  const rawMs = now - last;
  last = now;
  // Up to 0.1 s per frame keeps real-time speed down to 10 fps (physics sub-steps cap the rest).
  const dt = Math.min(rawMs / 1000, 0.1);
  if (!game.level) return;

  if (game.paused) {
    // The canvas keeps its last image; nothing moves, so draw once and idle.
    if (drewPaused) return;
    drewPaused = true;
  } else {
    game.elapsed += dt;
    input.update(dt);
    runTimers(dt);
    const events = world.step(dt);
    for (const ev of events) handleEvent(ev);
    // Safety net: never leave a throw hanging.
    if (game.activeBall && game.activeBall.age > 9) resolveThrow(false, false);
    applyCamera(dt);
    updateHeldBall(dt);
    updateGuide();
    if (game.phase === 'flight' && game.activeBall) setScoreGhost(behindScorePanel(game.activeBall.pos));
    else if (game.phase !== 'aiming') setScoreGhost(false);
    trail.update(dt);
    confetti.update(dt);
    updateWobble(dt);
    updateFading(dt);
    game.level.update?.(dt, game.elapsed);

    const aiming = game.phase === 'aiming';
    ui.setPower(input.power, aiming, aiming && input.charging);
    if (aiming) ui.setAim({ pitchDeg: THREE.MathUtils.radToDeg(input.pitch), guideFull: game.guideFull });
    adaptResolution(rawMs);
  }
  updateShadows();
  renderer.render(game.scene, camera);
}

/** Redraw shadow maps only while something that casts a shadow is moving (or just stopped). */
function updateShadows() {
  const awake = world.balls.some((b) => !b.sleeping) || game.wobble.amp > 0 || game.fading.length > 0;
  if (awake || game.anyAwake || game.shadowsDirty) renderer.shadowMap.needsUpdate = true;
  game.anyAwake = awake;
  game.shadowsDirty = false;
}

// Adaptive resolution: if frames stay slow, step the render scale down (never below 1). A step that
// doesn't make frames faster is undone and adaptation stops: that is a browser frame cap (battery
// saver pacing at 30 Hz), not a busy GPU, and lowering the resolution would only blur the picture.
const frameTimes = [];
const adapt = { lastStep: null, frozen: false };
function adaptResolution(ms) {
  if (adapt.frozen || document.hidden || ms > 100) return;
  frameTimes.push(ms);
  if (frameTimes.length < 120) return;
  frameTimes.sort((a, b) => a - b);
  const median = frameTimes[60];
  frameTimes.length = 0;
  if (adapt.lastStep) {
    const helped = median < adapt.lastStep.median * 0.85;
    if (!helped) {
      pixelRatioCap = adapt.lastStep.from;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
      adapt.frozen = true;
      return;
    }
    adapt.lastStep = null;
  }
  const current = renderer.getPixelRatio();
  if (median > 20 && current > 1) {
    adapt.lastStep = { from: pixelRatioCap, median };
    pixelRatioCap = Math.max(1, current - 0.25);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  }
}

/** Measure the top HUD row: arcs are kept below it, and the score panel fades when one passes behind. */
function measureHud() {
  const top = document.querySelectorAll('.tk-top > *');
  let bottom = 0;
  for (const el of top) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  const h = window.innerHeight;
  hud.arcTop = bottom > 0 ? clamp(1 - (2 * (bottom + 10)) / h, 0.3, ARC_TOP) : ARC_TOP;
  const score = document.querySelector('.tk-score')?.getBoundingClientRect();
  hud.score = score && score.width > 0 ? { left: score.left - 8, right: score.right + 8, bottom: score.bottom + 8 } : null;
}

function behindScorePanel(point) {
  if (!hud.score) return false;
  tmpVec.copy(point).project(camera);
  if (tmpVec.z > 1) return false;
  const x = ((tmpVec.x + 1) / 2) * window.innerWidth;
  const y = ((1 - tmpVec.y) / 2) * window.innerHeight;
  return y < hud.score.bottom && x > hud.score.left && x < hud.score.right;
}

function setScoreGhost(on) {
  if (hud.ghost === on) return;
  hud.ghost = on;
  document.documentElement.classList.toggle('tk-score-ghost', on);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep roughly the same horizontal view on portrait screens.
  camera.fov = camera.aspect < 1 ? 62 + (1 - camera.aspect) * 30 : 62;
  camera.updateProjectionMatrix();
  // Keep the held ball inside the frame; on portrait screens keep it clear of the right-hand controls.
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * -THROW.handOffset.z;
  HAND.x = Math.min(THROW.handOffset.x, halfWidth * (camera.aspect < 1 ? 0.5 : 0.6));
  hand.position.copy(HAND);
  drewPaused = false;
  measureHud();
}
window.addEventListener('resize', onResize);
onResize();
// Moving the window to a display with a different density doesn't always fire a resize.
function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      onResize();
      watchPixelRatio();
    },
    { once: true },
  );
}
watchPixelRatio();

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  ui.setLoading(START_LEVEL === 0 ? 'Reporting to the severed floor…' : 'Checking in…');
  game.score = START_LEVEL * RULES.pointsPerLevel;
  const level = await buildLevel(START_LEVEL);
  await activateLevel(level, START_LEVEL);
  updateStatsUI();
  game.phase = 'title';
  renderer.setAnimationLoop(frame);
  ui.setLoading(null);

  await ui.showStart();
  audio.unlock();
  game.phase = 'menu';
  applyCamera(0);
  await ui.showLevelIntro({ index: START_LEVEL, name: level.name, subtitle: level.subtitle, goal: goalText() });
  readyNextBall();
  // Fetch the other level's code now so the level change doesn't depend on the network later.
  for (const id of RULES.levelIds) {
    LEVEL_FACTORIES[id]().catch((err) => console.warn(`Prefetch of the ${id} level failed`, err));
  }
}

boot().catch((err) => {
  console.error(err);
  releasePointer();
  fatal(`Something went wrong while loading: ${err?.message ?? err}`, { label: 'Reload', run: () => location.reload() });
});

// ---------------------------------------------------------------------------
// Helpers

/** Full-screen error with an optional action button. */
function fatal(message, action) {
  const el = document.getElementById('fatal');
  if (!el) return;
  const text = document.createElement('p');
  text.textContent = message;
  el.replaceChildren(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', action.run);
    el.append(btn);
  }
  el.style.display = 'flex';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Test hooks for automated play-testing from the console / headless runs.
window.__trashketball = {
  game,
  world,
  camera,
  input,
  /** Throw with explicit aim (radians) and power 0..1, bypassing the mouse. */
  throwWith({ yaw = 0, pitch = THROW.defaultPitch, power = 0.5 } = {}) {
    input.yaw = yaw;
    input.pitch = pitch;
    input.power = power;
    applyCamera(0);
    throwBall(power);
  },
  /** Predicted path for the current aim at the given power (same math as the guide and the throw). */
  predict(power = input.power) {
    if (!game.held) return null;
    const a = computeAim(power);
    return predictTrajectory(world, a.origin.clone(), a.vel.clone(), { maxTime: 3.5, out: {} });
  },
  binRim: () => binRimCenter(),
  /** Jump straight to shot spot i (no glide). */
  gotoSpot(i) {
    game.spotIndex = i % game.level.shotSpots.length;
    game.glide = null;
    game.view = framingFor(game.level.bin, game.level.shotSpots[game.spotIndex]);
    input.yaw = 0;
    applyCamera(0);
  },
  skipTo(score) {
    game.score = score;
    updateScoreUI();
  },
};
