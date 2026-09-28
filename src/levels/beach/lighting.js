import * as THREE from 'three';
import { ROOM, SUN_DIR, PENDANTS } from './layout.js';
import { makeCanvasTexture } from '../../utils/canvasTexture.js';

/**
 * Sun (shadow-casting, fitted to the room), sky/bounce hemisphere fill and warm pendant lights.
 * @returns {{ objects: THREE.Object3D[], dispose(): void }}
 */
export function createLights() {
  const objects = [];

  const sun = new THREE.DirectionalLight(0xffb878, 4.2);
  const target = new THREE.Vector3(0, 1.5, 0.4);
  sun.position.copy(target).addScaledVector(SUN_DIR, 40);
  sun.target.position.copy(target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
  fitShadowCamera(sun, target);
  objects.push(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xc9dcf0, 0xc28f60, 0.4);
  objects.push(hemi);

  // Warm glow under the pendants (no shadows, short range).
  const lamp = (x, y, z, intensity, distance) => {
    const l = new THREE.PointLight(0xffb672, intensity, distance, 2);
    l.position.set(x, y, z);
    objects.push(l);
  };
  const lounge = PENDANTS[0];
  lamp(lounge.x, lounge.y + lounge.r * 0.8, lounge.z, 3.2, 7);
  const island = PENDANTS[2];
  lamp(island.x, island.y + 0.2, island.z, 3.0, 6);
  const dining = PENDANTS[4];
  lamp(dining.x, dining.y + 0.15, dining.z, 3.0, 6);

  return {
    sun,
    objects,
    dispose() {
      sun.shadow.map?.dispose();
    },
  };
}

/** Fit the orthographic shadow frustum tightly around the room (plus the deck just outside). */
function fitShadowCamera(light, target) {
  // A camera (not a plain Object3D) so lookAt uses the same -Z-forward convention as the shadow camera.
  const eye = new THREE.OrthographicCamera();
  eye.position.copy(light.position);
  eye.lookAt(target);
  eye.updateMatrixWorld(true);
  const inv = eye.matrixWorld.clone().invert();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (const x of [ROOM.minX - 0.3, ROOM.maxX + 0.3]) {
    for (const y of [0, ROOM.height + 0.3]) {
      for (const z of [ROOM.minZ - 2.6, ROOM.maxZ + 0.3]) {
        p.set(x, y, z).applyMatrix4(inv);
        min.min(p);
        max.max(p);
      }
    }
  }
  const cam = light.shadow.camera;
  cam.left = min.x;
  cam.right = max.x;
  cam.bottom = min.y;
  cam.top = max.y;
  cam.near = Math.max(0.1, -max.z - 1);
  cam.far = -min.z + 1;
  cam.updateProjectionMatrix();
}

/**
 * A small stand-in of the sunlit room (bright glass wall at -Z, warm floor, white walls) captured
 * into a PMREM so glossy materials reflect the window, and diffuse surfaces get soft directional fill.
 */
export function createRoomEnvironment(pmrem) {
  const scene = new THREE.Scene();
  const windowTex = makeCanvasTexture(16, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    // canvas top = ceiling. Horizon at about eye height (~1.3 m of 6.6 m).
    grd.addColorStop(0, '#7fa6d6');
    grd.addColorStop(0.55, '#b9cbe0');
    grd.addColorStop(0.76, '#ffd9a6');
    grd.addColorStop(0.8, '#ffe2b8');
    grd.addColorStop(0.83, '#8a9fb0');
    grd.addColorStop(0.9, '#c9ad86');
    grd.addColorStop(1, '#a5825e');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  const basic = (color, k, map = null) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.BackSide, map });
    return m;
  };
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const mats = [
    basic(0xf3e6d4, 1.05), // right wall, catches the sun
    basic(0xe9e0d4, 0.55),
    basic(0xf1eee8, 0.45), // ceiling
    basic(0xc49a6c, 0.75), // oak floor in sun
    basic(0xf0e4d4, 0.85), // back wall, sunlit
    basic(0xffffff, 2.6, windowTex), // the glass wall
  ];
  const room = new THREE.Mesh(new THREE.BoxGeometry(W, ROOM.height, D), mats);
  room.position.set((ROOM.minX + ROOM.maxX) / 2, ROOM.height / 2, (ROOM.minZ + ROOM.maxZ) / 2);
  scene.add(room);
  // A sofa-ish dark mass low in the room so reflections are not uniformly bright below the horizon.
  const block = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb8a78f).multiplyScalar(0.5) }));
  block.position.set(0, 0.4, -0.5);
  scene.add(block);

  const rt = pmrem.fromScene(scene, 0.03, 0.1, 50, { position: new THREE.Vector3(0, 1.3, -1.2) });
  room.geometry.dispose();
  block.geometry.dispose();
  block.material.dispose();
  for (const m of mats) m.dispose();
  windowTex.dispose();
  return rt;
}
