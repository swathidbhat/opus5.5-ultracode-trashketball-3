import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { THROW } from '../src/config.js';
import { framingFor, aimPitch, flightFollow, releaseOrigin, throwVelocity, rimCenter } from '../src/aim.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const deg = (d) => (d * Math.PI) / 180;
const bin = { position: V(-2.15, 0, -2.95), height: 0.36, rimTube: 0.006 };
const HAND = V(THROW.handOffset.x, THROW.handOffset.y, THROW.handOffset.z);
const FOV = 62;

test('releaseOrigin matches camera.localToWorld for the same yaw and pitch', () => {
  const cam = new THREE.PerspectiveCamera();
  cam.rotation.order = 'YXZ';
  cam.position.set(1, 1.6, 2);
  for (const [yaw, pitch] of [[0, 0], [0.7, -0.2], [-2.5, 0.4], [3, 0.1]]) {
    cam.rotation.set(pitch, yaw, 0);
    cam.updateMatrixWorld();
    const expected = cam.localToWorld(HAND.clone());
    const got = releaseOrigin(cam.position, yaw, pitch, HAND);
    assert.ok(got.distanceTo(expected) < 1e-9, `yaw ${yaw} pitch ${pitch}`);
  }
});

test('aimPitch never tilts below the base framing and never loses the rim', () => {
  const tanHalf = Math.tan(deg(FOV / 2));
  for (const eye of [V(2.45, 1.6, -1.95), V(-0.3, 1.17, 0.9), V(0.45, 1.6, -2.6)]) {
    const view = framingFor(bin, { eye });
    const rimElev = Math.atan2(view.rimY - eye.y, view.dist);
    for (let p = 0; p <= 70; p += 5) {
      for (let power = 0; power <= 1; power += 0.1) {
        const cam = aimPitch(view, deg(p), power, FOV, 0.6);
        assert.ok(cam >= view.pitch - 1e-12);
        // The rim stays above the bottom ~14% of the frame.
        assert.ok(rimElev - cam >= -Math.atan(0.72 * tanHalf) - 1e-9 || cam === view.pitch);
        // Deterministic: the same aim always gives the same camera.
        assert.equal(aimPitch(view, deg(p), power, FOV, 0.6), cam);
      }
    }
  }
});

test('aimPitch tilts up for high arcs and not for flat ones', () => {
  const view = framingFor(bin, { eye: V(2.45, 1.6, -1.95) });
  assert.equal(aimPitch(view, deg(15), 0.3, FOV, 0.6), view.pitch);
  assert.ok(aimPitch(view, deg(55), 0.6, FOV, 0.6) > view.pitch + deg(5));
});

test('flightFollow is zero for a low ball and capped so the rim stays in frame', () => {
  const view = framingFor(bin, { eye: V(2.45, 1.6, -1.95) });
  assert.equal(flightFollow(view, view.pitch, V(1.5, 1.4, -2.2), FOV), 0);
  const high = flightFollow(view, view.pitch, V(0, 9, -2.5), FOV);
  const rimElev = Math.atan2(view.rimY - 1.6, view.dist);
  assert.ok(high > 0);
  assert.ok(rimElev - (view.pitch + high) >= -Math.atan(0.85 * Math.tan(deg(FOV / 2))) - 1e-9);
});

test('throwVelocity converges on the view centre at the bin distance', () => {
  for (const eye of [V(2.45, 1.6, -1.95), V(-3.6, 1.6, 1.5)]) {
    const view = framingFor(bin, { eye });
    const origin = releaseOrigin(view.eye, view.yaw, view.pitch, HAND);
    const vel = throwVelocity(view, origin, view.yaw, deg(40), 0.5);
    // Follow the horizontal direction from the hand for the bin distance: it should reach the rim centre line.
    const dir = V(vel.x, 0, vel.z).normalize();
    const rim = rimCenter(bin);
    const toRim = V(rim.x - origin.x, 0, rim.z - origin.z);
    const lateral = toRim.clone().sub(dir.clone().multiplyScalar(toRim.dot(dir))).length();
    assert.ok(lateral < 0.01, `lateral miss ${lateral.toFixed(4)} m`);
  }
});
