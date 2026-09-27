import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { T, atlasBox } from './batch.js';
import { ROOM, DOOR, BIN, CABINET, PLANT, DESK, chairPlacements } from './layout.js';
import { atlasUV } from './textures.js';

// Wall dressing (Lumon emblem, founder portrait, motivational poster, department plaque)
// and soft contact shadows.

const GOLD = 0xc39a45;
const GOLD_DARK = 0x8a6a2c;
const FRAME_BLACK = 0x1d1e20;

export const LOGO = { z: CABINET.z, y: 1.74, width: 1.15 };
export const PORTRAIT = { x: BIN.x, y: 1.72, width: 0.6, height: 0.8 };
export const POSTER = { x: -3.75, y: 1.48, width: 0.62, height: 0.868 };
export const PLAQUE = { x: DOOR.x1 + 0.075 + 0.36, y: 1.52, width: 0.4, height: 0.16 };

/** Matrix for a flat item hung on the north wall (facing +Z) or the west wall (facing +X). */
function onWall(wall, u, y, off = 0) {
  if (wall === 'north') return new THREE.Matrix4().setPosition(u, y, ROOM.minZ + off);
  return new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(ROOM.minX + off, y, u);
}

/**
 * @param {import('./batch.js').Batcher} b
 */
export function buildDecor(b) {
  // Lumon emblem painted on the west wall above the filing cabinet.
  const logoH = LOGO.width * (640 / 1024);
  b.add('logo', new THREE.PlaneGeometry(LOGO.width, logoH), onWall('west', LOGO.z, LOGO.y, 0.003));

  // Department plaque beside the door.
  b.add('atlas', atlasBox(PLAQUE.width, PLAQUE.height, 0.008, { pz: atlasUV('plaque'), all: atlasUV('white') }), onWall('north', PLAQUE.x, PLAQUE.y, 0.004));

  // North wall: the gilt-framed founder keeps watch over the wastebasket.
  const { width: pw, height: ph } = PORTRAIT;
  const portraitAt = (x, y, z) => onWall('north', PORTRAIT.x, PORTRAIT.y).multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  b.add('atlas', atlasBox(pw, ph, 0.02, { pz: atlasUV('portrait'), all: atlasUV('canvasEdge') }), portraitAt(0, 0, 0.03));
  const gilt = new THREE.Color(GOLD);
  const giltShadow = new THREE.Color(GOLD_DARK);
  b.add('metal', moldedFrame(pw, ph, GILT_PROFILE), portraitAt(0, 0, 0), {
    // Antique gilding: bright on the beads, darker down in the cove.
    colorFn: (p, out) => {
      const d = Math.max(Math.abs(p.x) - pw / 2, Math.abs(p.y) - ph / 2);
      const cove = THREE.MathUtils.smoothstep(d, 0.004, 0.02) * (1 - THREE.MathUtils.smoothstep(d, 0.04, 0.058));
      out.copy(gilt).lerp(giltShadow, cove * 0.75);
    },
  });
  // Brass picture light over the portrait: wall plate, arm and a flattened tubular hood.
  const brass = { color: 0xb08d4a };
  const lightY = ph / 2 + 0.2;
  b.add('metal', new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20).rotateX(Math.PI / 2), portraitAt(0, lightY, 0.006), brass);
  b.add('metal', new THREE.CylinderGeometry(0.008, 0.008, 0.15, 10).rotateX(Math.PI / 2), portraitAt(0, lightY, 0.08), brass);
  b.add('metal', new THREE.CylinderGeometry(0.03, 0.03, 0.36, 20).rotateZ(Math.PI / 2).scale(1, 0.7, 1).rotateX(0.35), portraitAt(0, lightY, 0.16), brass);

  // North wall: motivational poster in a slim black frame, between the plant and the portrait.
  const { width: sw, height: sh } = POSTER;
  const posterAt = (x, y, z) => onWall('north', POSTER.x, POSTER.y).multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  b.add('atlas', atlasBox(sw, sh, 0.01, { pz: atlasUV('poster'), all: atlasUV('white') }), posterAt(0, 0, 0.012));
  addFrame(b, posterAt, sw, sh, 0.022, 0.028, FRAME_BLACK);
}

// Gilt moulding cross-section: [distance out from the sight edge, height off the wall] (m).
const GILT_PROFILE = [
  [-0.008, 0.042], [-0.006, 0.05], [-0.001, 0.056], [0.004, 0.054], [0.008, 0.048], [0.02, 0.052],
  [0.034, 0.062], [0.048, 0.072], [0.06, 0.08], [0.07, 0.082], [0.079, 0.078], [0.086, 0.068],
  [0.09, 0.052], [0.092, 0.034], [0.092, 0],
];

/**
 * Picture-frame moulding: the profile swept around a w x h opening with mitred corners.
 * Local frame: wall at z = 0, facing +Z, centred on the opening.
 * @param {number[][]} profile [[d, z], ...] from the sight edge outward
 * @returns {THREE.BufferGeometry}
 */
function moldedFrame(w, h, profile) {
  const pos = [];
  const idx = [];
  const corner = (c, d, z) => [(c === 1 || c === 2 ? 1 : -1) * (w / 2 + d), (c >= 2 ? 1 : -1) * (h / 2 + d), z];
  for (let side = 0; side < 4; side++) {
    const base = pos.length / 3;
    for (const [d, z] of profile) pos.push(...corner(side, d, z), ...corner((side + 1) % 4, d, z));
    for (let k = 0; k < profile.length - 1; k++) {
      const a = base + k * 2;
      idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Picture frame of four mitred-looking rails around a w x h opening (local frame: wall at z = 0, facing +Z). */
function addFrame(b, place, w, h, rail, depth, color) {
  const rails = [
    [w + 2 * rail, rail, 0, (h + rail) / 2],
    [w + 2 * rail, rail, 0, -(h + rail) / 2],
    [rail, h, (w + rail) / 2, 0],
    [rail, h, -(w + rail) / 2, 0],
  ];
  const r = Math.min(rail, depth) * 0.3;
  for (const [rw, rh, x, y] of rails) {
    b.add('metal', new RoundedBoxGeometry(rw, rh, depth, 2, r), place(x, y, depth / 2), { color });
  }
}

/**
 * Soft blob shadows (ambient occlusion stand-ins) as one transparent mesh.
 * @param {THREE.Texture} tex blob texture (left half radial, right half rounded rect)
 * @returns {THREE.Mesh}
 */
export function buildContactShadows(tex) {
  const blobs = [];
  const radial = (x, z, rx, rz, a, yaw = 0) => blobs.push({ x, z, rx, rz, a, yaw, rect: false });
  const rect = (x, z, rx, rz, a, yaw = 0) => blobs.push({ x, z, rx, rz, a, yaw, rect: true });

  radial(BIN.x, BIN.z, 0.3, 0.3, 0.7);
  radial(PLANT.x, PLANT.z, 0.36, 0.36, 0.55);
  rect(CABINET.x, CABINET.z, CABINET.width * 0.85, CABINET.depth * 0.95, 0.5, CABINET.yaw);
  rect(0, 0, DESK.half * 1.45, DESK.half * 1.45, 0.42);
  for (const ch of chairPlacements()) radial(ch.x, ch.z, 0.46, 0.46, 0.42);

  const n = blobs.length;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const col = new Float32Array(n * 4 * 4);
  const idx = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  blobs.forEach((bl, i) => {
    const c = Math.cos(bl.yaw);
    const s = Math.sin(bl.yaw);
    corners.forEach(([cx, cz], k) => {
      const lx = cx * bl.rx;
      const lz = cz * bl.rz;
      const v = i * 4 + k;
      pos.set([bl.x + lx * c + lz * s, 0.003 + i * 0.0002, bl.z - lx * s + lz * c], v * 3);
      const u0 = bl.rect ? 0.5 : 0;
      uv.set([u0 + ((cx + 1) / 2) * 0.5, (cz + 1) / 2], v * 2);
      col.set([0.02, 0.035, 0.02, bl.a], v * 4);
    });
    const o = i * 4;
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'office-contact-shadows';
  mesh.renderOrder = -1;
  return mesh;
}
