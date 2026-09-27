import * as THREE from 'three';
import { PHYS, THROW } from './config.js';
import { launchVelocity } from './physics.js';

// Aiming math shared by the game and the offline tuning scripts. DOM-free.
//
// Everything here is a pure function of the shot spot and the current aim (yaw, launch pitch, power),
// never of how long a button has been held, so the arc the guide draws is exactly the arc a tap or a
// long wind-up throws.

// While aiming, keep the top of the revealed arc below this share of the half-frame above centre
// (about the top 19% of the screen stays clear for the HUD; the game passes the measured value)...
export const ARC_TOP = 0.62;
// ...but never tilt so far that the rim drops below this share of the half-frame under centre.
const RIM_FLOOR = 0.72;
// In flight the camera may let the rim sink a little lower to keep a high lob in view.
const RIM_FLOOR_FLIGHT = 0.85;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();

/** Centre of the bin's rim bead. */
export function rimCenter(bin, out = new THREE.Vector3()) {
  return out.set(bin.position.x, bin.position.y + bin.height - bin.rimTube, bin.position.z);
}

/**
 * Base framing for a shot spot: face the bin and look slightly above its rim.
 * @returns {{eye: THREE.Vector3, yaw: number, pitch: number, dist: number, rimY: number}}
 */
export function framingFor(bin, spot) {
  const rim = rimCenter(bin);
  const dx = rim.x - spot.eye.x;
  const dz = rim.z - spot.eye.z;
  const dist = Math.hypot(dx, dz);
  return {
    eye: spot.eye.clone(),
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(rim.y - spot.eye.y, dist) + THREE.MathUtils.degToRad(6),
    dist,
    rimY: rim.y,
  };
}

export function throwSpeed(power) {
  return THROW.minSpeed + (THROW.maxSpeed - THROW.minSpeed) * THREE.MathUtils.clamp(power, 0, 1);
}

/**
 * Camera pitch while aiming. Starts from the spot's base framing and tilts up only as far as needed to
 * keep the revealed part of the arc (`reachShare` of the distance to the bin) below the HUD, without
 * pushing the rim out of the bottom of the frame.
 * @param {object} view framing (see framingFor); may be mid-glide
 * @param {number} launchPitch radians above horizontal
 * @param {number} power 0..1
 * @param {number} fovDeg vertical field of view
 * @param {number} reachShare share of the horizontal distance to the bin the guide reveals
 * @param {number} [arcTop] highest point the arc may reach, as a share of the half-frame above centre
 */
export function aimPitch(view, launchPitch, power, fovDeg, reachShare, arcTop = ARC_TOP) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const v = throwSpeed(power);
  const vy = v * Math.sin(launchPitch);
  const vh = Math.max(0.2, v * Math.cos(launchPitch));
  // Vacuum arc from roughly hand height; drag only lowers the real one, so this errs toward tilting.
  const dApex = (vh * vy) / PHYS.gravity;
  const dTop = Math.max(0.3, Math.min(dApex, reachShare * view.dist));
  const t = dTop / vh;
  const rise = THROW.handOffset.y + vy * t - 0.5 * PHYS.gravity * t * t;
  const topElev = Math.atan2(rise, dTop);
  const rimElev = Math.atan2(view.rimY - view.eye.y, view.dist);
  const need = topElev - Math.atan(arcTop * tanHalf) - view.pitch;
  const room = rimElev + Math.atan(RIM_FLOOR * tanHalf) - view.pitch;
  return view.pitch + THREE.MathUtils.clamp(need, 0, Math.max(0, room));
}

/**
 * Extra camera pitch during flight that keeps the ball below the HUD row, capped so the rim stays in frame.
 * @param {object} view framing
 * @param {number} pitch the camera pitch before following
 * @param {THREE.Vector3} ballPos
 * @param {number} fovDeg vertical field of view
 * @param {number} [arcTop] see aimPitch
 */
export function flightFollow(view, pitch, ballPos, fovDeg, arcTop = ARC_TOP) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const elev = Math.atan2(ballPos.y - view.eye.y, Math.hypot(ballPos.x - view.eye.x, ballPos.z - view.eye.z));
  const rimElev = Math.atan2(view.rimY - view.eye.y, view.dist);
  const need = elev - Math.atan(arcTop * tanHalf) - pitch;
  const room = rimElev + Math.atan(RIM_FLOOR_FLIGHT * tanHalf) - pitch;
  return THREE.MathUtils.clamp(need, 0, Math.max(0, room));
}

/**
 * The release point: the hand's camera-space offset placed in the world for a camera at `eye` looking
 * along (yaw, pitch). Identical to camera.localToWorld(hand) for camera.rotation = (pitch, yaw, 0, 'YXZ').
 */
export function releaseOrigin(eye, yaw, pitch, hand, out = new THREE.Vector3()) {
  _quat.setFromEuler(_euler.set(pitch, yaw, 0, 'YXZ'));
  return out.copy(hand).applyQuaternion(_quat).add(eye);
}

/**
 * Launch velocity. The throw's yaw converges on the view centre at the bin's distance, so the reticle means
 * what it says even though the hand is off to the right.
 */
export function throwVelocity(view, origin, yaw, launchPitch, power, out = new THREE.Vector3()) {
  const ax = view.eye.x - Math.sin(yaw) * view.dist;
  const az = view.eye.z - Math.cos(yaw) * view.dist;
  const throwYaw = Math.atan2(-(ax - origin.x), -(az - origin.z));
  return launchVelocity(throwYaw, launchPitch, throwSpeed(power), out);
}
