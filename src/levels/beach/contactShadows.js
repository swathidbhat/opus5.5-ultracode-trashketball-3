import * as THREE from 'three';
import { makeCanvasTexture } from '../../utils/canvasTexture.js';
import {
  BIN,
  RUG,
  COFFEE_TABLE,
  SIDE_TABLES,
  OLIVE,
  FIG,
  PAMPAS,
  ARC_LAMP,
  LOUNGE_CHAIRS,
  LOUNGE_CHAIR,
  KITCHEN,
  DINING,
  DINING_CHAIR,
} from './layout.js';

// Soft contact shadows. The only shadow-casting light is a sun 4 degrees above the sea, so pieces
// standing on the floor get long grazing slivers and nothing under their feet, and they read as
// hovering. A dark blob under each stands in for the ambient occlusion there. The blobs live in
// the scene (not in the bin group) so the bin's wobble does not tilt its shadow.

/** Blob sprites on white: radial (left half) and soft rectangle (right half). Alpha carries the shape. */
function blobTexture() {
  return makeCanvasTexture(256, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.82)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.3)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    // Soft rectangle, drawn per pixel (canvas blur filters are not available everywhere).
    const img = g.getImageData(128, 0, 128, 128);
    const fall = (t) => {
      const e = Math.min(1, Math.max(0, (Math.abs(t) - 0.45) / 0.55));
      return 1 - e * e * (3 - 2 * e);
    };
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const a = fall((x + 0.5) / 64 - 1) * fall((y + 0.5) / 64 - 1);
        const i = (y * 128 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 128, 0);
  });
}

/** Rotate a local (x, z) offset by yaw like Object3D.rotation.y and add it to (cx, cz). */
function place(cx, cz, yaw, lx, lz) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
}

/** @returns {{ mesh: THREE.Mesh, dispose(): void }} */
export function createContactShadows() {
  const blobs = [];
  const onRug = (x, z) => Math.abs(x - RUG.x) < RUG.w / 2 && Math.abs(z - RUG.z) < RUG.d / 2;
  // rx, rz: half extents of the quad; a: peak opacity.
  const radial = (x, z, r, a) => blobs.push({ x, z, rx: r, rz: r, a, yaw: 0, rect: false });
  const rect = (x, z, rx, rz, a, yaw = 0) => blobs.push({ x, z, rx, rz, a, yaw, rect: true });

  radial(BIN.x, BIN.z, BIN.radiusBottom * 2.3, 0.8);
  radial(COFFEE_TABLE.x, COFFEE_TABLE.z, 0.62, 0.55);
  for (const t of SIDE_TABLES) radial(t.x, t.z, t.r * 1.55, 0.62);
  radial(OLIVE.x, OLIVE.z, OLIVE.potR * 1.45, 0.6);
  radial(FIG.x, FIG.z, FIG.potR * 1.45, 0.6);
  radial(PAMPAS.x, PAMPAS.z, PAMPAS.r * 1.6, 0.5);
  radial(ARC_LAMP.baseX, ARC_LAMP.baseZ, 0.3, 0.45);

  // Lounge chairs: a faint pool under the seat plus a dot at each end of the bent-walnut runners.
  const hw = LOUNGE_CHAIR.w / 2 - 0.04;
  for (const ch of LOUNGE_CHAIRS) {
    rect(...place(ch.x, ch.z, ch.yaw, 0, 0), LOUNGE_CHAIR.w * 0.55, LOUNGE_CHAIR.d * 0.55, 0.32, ch.yaw);
    for (const lx of [-hw, hw]) {
      for (const lz of [-0.4, 0.42]) radial(...place(ch.x, ch.z, ch.yaw, lx, lz), 0.075, 0.55);
    }
  }
  for (const s of KITCHEN.stools) radial(s.x, s.z, 0.3, 0.42);
  const T = DINING.table;
  for (const sz of [-1, 1]) rect(T.x, T.z + sz * (T.d / 2 - 0.42), (T.w - 0.1) * 0.6, 0.12, 0.5);
  for (const c of DINING.chairs) rect(c.x, c.z, DINING_CHAIR.w * 0.62, DINING_CHAIR.d * 0.62, 0.34, c.yaw);

  const n = blobs.length;
  const pos = new Float32Array(n * 12);
  const uv = new Float32Array(n * 8);
  const col = new Float32Array(n * 16);
  const idx = [];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  blobs.forEach((b, i) => {
    // Just above whatever the piece stands on; a hair apart so overlapping blobs never z-fight.
    const y = (onRug(b.x, b.z) ? RUG.h : 0) + 0.003 + i * 0.00002;
    corners.forEach(([cx, cz], k) => {
      const v = i * 4 + k;
      const [x, z] = place(b.x, b.z, b.yaw, cx * b.rx, cz * b.rz);
      pos.set([x, y, z], v * 3);
      uv.set([(b.rect ? 0.5 : 0) + ((cx + 1) / 2) * 0.5, (cz + 1) / 2], v * 2);
      col.set([0.05, 0.03, 0.016, b.a], v * 4); // warm umber over the oak
    });
    const o = i * 4;
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const tex = blobTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'beach-contact-shadows';
  mesh.renderOrder = -3; // first of the transparents: they only ever darken the opaque floor under them
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
