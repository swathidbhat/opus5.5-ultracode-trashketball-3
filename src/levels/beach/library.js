import * as THREE from 'three';
import { rng } from '../../utils/canvasTexture.js';
import { SHELVES } from './layout.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mbox, mlathe, mcylinder, tint } from './geom.js';

// Double-height built-in library on the back wall: white shelving, rows of books with the odd
// ceramic, and a rolling oak ladder on a brass rail.

/** An upright book as just the faces seen from the room: the spine (facing -Z) and the top. */
function bookFaces(w, h, d, color) {
  const spine = new THREE.PlaneGeometry(w, h);
  spine.rotateY(Math.PI);
  spine.translate(0, h / 2, 0);
  const top = new THREE.PlaneGeometry(w, d);
  top.rotateX(-Math.PI / 2);
  top.translate(0, h, d / 2);
  const g = mergeGeometries([spine, top]);
  spine.dispose();
  top.dispose();
  return tint(g, color);
}

const PALETTE = [0xe9e1d2, 0xd8c7a6, 0xb5653c, 0x2c4658, 0x6f7f63, 0x3b3733, 0xf4f0e8, 0x9c7b58, 0x7f97a6, 0xc9a66b];

/**
 * @param {Record<string, THREE.Material>} m interior materials
 * @returns {THREE.Group}
 */
export function buildLibrary(m) {
  const g = new THREE.Group();
  const S = SHELVES;
  const r = rng(313);
  const put = (geom, mat, x, y, z, cast = true) => {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const W = S.x1 - S.x0;
  const D = S.z1 - S.z0;
  const t = 0.035; // board thickness
  const bays = 5;
  const bayW = (W - t) / bays;
  const rowH = 0.4;
  const plinth = 0.12;
  const rows = Math.floor((S.h - plinth - t) / rowH);

  // Carcass: back panel, uprights, shelves, plinth and crown.
  put(mbox(W, S.h, 0.02), m.trim, (S.x0 + S.x1) / 2, S.h / 2, S.z1 - 0.01, false);
  for (let i = 0; i <= bays; i++) put(mbox(t, S.h, D), m.trim, S.x0 + t / 2 + i * bayW, S.h / 2, (S.z0 + S.z1) / 2);
  for (let j = 0; j <= rows; j++) {
    const y = plinth + j * rowH;
    put(mbox(W, t, D - 0.02), m.trim, (S.x0 + S.x1) / 2, y + t / 2, (S.z0 + S.z1) / 2 + 0.01);
  }
  put(mbox(W, plinth, D - 0.03), m.trim, (S.x0 + S.x1) / 2, plinth / 2, (S.z0 + S.z1) / 2 + 0.015);
  put(mbox(W + 0.06, 0.08, D + 0.04), m.trim, (S.x0 + S.x1) / 2, S.h - 0.04, (S.z0 + S.z1) / 2);

  // Books and objects, shelf by shelf.
  const front = S.z0 + 0.03;
  for (let j = 0; j < rows; j++) {
    const y = plinth + j * rowH + t;
    for (let i = 0; i < bays; i++) {
      let x = S.x0 + t + i * bayW + 0.02;
      const x1 = S.x0 + (i + 1) * bayW - 0.02;
      while (x < x1 - 0.05) {
        const roll = r();
        if (roll < 0.1) {
          // a ceramic vase
          const h = 0.14 + r() * 0.12;
          const rad = 0.05 + r() * 0.03;
          const prof = [
            [0, 0],
            [rad * 0.7, 0],
            [rad, h * 0.35],
            [rad * 0.55, h * 0.85],
            [rad * 0.6, h],
            [0, h],
          ];
          put(mlathe(prof, 18), r() < 0.5 ? m.ceramic : m.ceramicDark, x + rad, y, front + 0.14, false);
          x += rad * 2 + 0.06;
        } else if (roll < 0.18) {
          // a horizontal stack
          let h = 0;
          const n = 2 + Math.floor(r() * 3);
          for (let k = 0; k < n; k++) {
            const bt = 0.025 + r() * 0.02;
            const geo = tint(mbox(0.2 + r() * 0.05, bt, 0.2 + r() * 0.05), PALETTE[Math.floor(r() * PALETTE.length)]);
            put(geo, m.colored, x + 0.12, y + h + bt / 2, front + 0.14, false);
            h += bt;
          }
          x += 0.3;
        } else if (roll < 0.26) {
          x += 0.08 + r() * 0.15; // breathing room
        } else {
          // a run of upright books
          const n = 4 + Math.floor(r() * 9);
          const base = PALETTE[Math.floor(r() * PALETTE.length)];
          for (let k = 0; k < n && x < x1 - 0.03; k++) {
            const bw = 0.022 + r() * 0.03;
            const bh = 0.21 + r() * 0.13;
            const bd = 0.16 + r() * 0.08;
            const col = r() < 0.55 ? base : PALETTE[Math.floor(r() * PALETTE.length)];
            put(bookFaces(bw, bh, bd, col), m.colored, x + bw / 2, y, front + 0.02, false);
            x += bw + 0.002;
          }
          // the last one leans on its neighbours
          x += 0.01;
        }
      }
    }
  }

  // Rolling ladder on a brass rail.
  const railY = 4.6;
  const railZ = S.z0 - 0.12;
  put(mcylinder(0.014, W - 0.3, 10), m.brass, S.x0 + 0.15, railY, railZ).rotation.z = -Math.PI / 2;
  const lx = S.x0 + bayW * 2.4;
  const footZ = S.z0 - 1.45;
  const len = Math.hypot(railY + 0.1, railZ - footZ);
  const tiltX = Math.atan2(railZ - footZ, railY + 0.1);
  const ladder = new THREE.Group();
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(mbox(0.05, len, 0.03), m.oakWarm);
    rail.position.set(s * 0.22, len / 2, 0);
    rail.castShadow = true;
    ladder.add(rail);
  }
  for (let k = 1; k < len / 0.3; k++) {
    const rung = new THREE.Mesh(mcylinder(0.014, 0.44, 10), m.brass);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(0.22, k * 0.3, 0);
    ladder.add(rung);
  }
  ladder.rotation.x = tiltX;
  ladder.position.set(lx, 0, footZ);
  g.add(ladder);
  return g;
}
