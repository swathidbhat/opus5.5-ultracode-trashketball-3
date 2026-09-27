import * as THREE from 'three';
import { ROOM, GLASS, BEAMS } from './layout.js';
import { mbox, mplane } from './geom.js';

const W = ROOM.maxX - ROOM.minX;
const D = ROOM.maxZ - ROOM.minZ;
const H = ROOM.height;
const CX = (ROOM.minX + ROOM.maxX) / 2;
const CZ = (ROOM.minZ + ROOM.maxZ) / 2;
export const SOFFIT_Z = ROOM.minZ - 2.4; // roof overhang edge outside the glass

function put(parent, geom, mat, x, y, z, o = {}) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  if (o.rx || o.ry || o.rz) mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  mesh.castShadow = o.cast ?? true;
  mesh.receiveShadow = o.receive ?? true;
  parent.add(mesh);
  return mesh;
}

/**
 * Static shell: floor, plaster walls, T&G ceiling with oak beams, the steel-and-glass wall and the
 * roof overhang. Returns a Group for the static batcher plus the glass (kept separate for sorting).
 */
export function buildRoomShell(m) {
  const g = new THREE.Group();

  // Floor (slightly oversize so it tucks under the walls).
  put(g, mplane(W + 0.2, D + 0.2), m.oakFloor, CX, 0, CZ, { rx: -Math.PI / 2, cast: false });

  // Walls are thick boxes so they cast clean shadows (only the glass lets the sun in).
  const t = 0.3;
  put(g, mbox(t, H + 0.3, D + 0.6), m.plaster, ROOM.minX - t / 2, H / 2, CZ);
  put(g, mbox(t, H + 0.3, D + 0.6), m.plaster, ROOM.maxX + t / 2, H / 2, CZ);
  put(g, mbox(W + 0.6, H + 0.3, t), m.plaster, CX, H / 2, ROOM.maxZ + t / 2);
  // Ceiling slab continues outside as the soffit of the roof overhang.
  const ceilZ0 = SOFFIT_Z;
  const ceilZ1 = ROOM.maxZ + 0.3;
  put(g, mbox(W + 4, 0.3, ceilZ1 - ceilZ0), m.ceiling, CX, H + 0.15, (ceilZ0 + ceilZ1) / 2);
  // Fascia along the overhang edge.
  put(g, mbox(W + 4, 0.42, 0.08), m.trim, CX, H + 0.12, ceilZ0 - 0.04);

  // Skirting.
  const sk = 0.09;
  put(g, mbox(0.02, sk, D), m.trim, ROOM.minX + 0.01, sk / 2, CZ, { cast: false });
  put(g, mbox(0.02, sk, D), m.trim, ROOM.maxX - 0.01, sk / 2, CZ, { cast: false });
  put(g, mbox(W, sk, 0.02), m.trim, CX, sk / 2, ROOM.maxZ - 0.01, { cast: false });

  // Exposed pale-oak beams (along Z, into the overhang) and a perimeter beam over the glass.
  for (const x of BEAMS.xs) {
    put(g, mbox(BEAMS.w, BEAMS.depth, ceilZ1 - ceilZ0 - 0.3), m.paleOak, x, H - BEAMS.depth / 2, (ceilZ0 + 0.1 + ROOM.maxZ) / 2);
  }
  put(g, mbox(W, 0.24, 0.26), m.paleOak, CX, H - 0.12, ROOM.minZ + 0.2);

  // --- Steel-and-glass wall -----------------------------------------------------------------
  const mw = GLASS.mullionWidth;
  const md = GLASS.mullionDepth;
  const gz = GLASS.z;
  const xs = GLASS.mullionXs;
  for (let i = 0; i < xs.length; i++) {
    let x = xs[i];
    if (i === 0) x += mw / 2;
    if (i === xs.length - 1) x -= mw / 2;
    put(g, mbox(mw, H, md), m.steel, x, H / 2, gz);
  }
  for (const y of GLASS.transomYs) put(g, mbox(W, mw, md), m.steel, CX, y, gz);
  put(g, mbox(W, 0.035, 0.22), m.steel, CX, 0.0175, gz, { cast: false }); // threshold
  put(g, mbox(W, 0.05, md), m.steel, CX, H - 0.025, gz); // head

  // Sliding door (right bay): fixed leaf in the outer track, sliding leaf on the inner track.
  const s = GLASS.slider;
  const doorH = GLASS.transomYs[0] - mw / 2;
  const leafFrame = (x0, x1, z) => {
    const fw = 0.045;
    put(g, mbox(fw, doorH, 0.05), m.steel, x0 + fw / 2, doorH / 2, z);
    put(g, mbox(fw, doorH, 0.05), m.steel, x1 - fw / 2, doorH / 2, z);
    put(g, mbox(x1 - x0, fw, 0.05), m.steel, (x0 + x1) / 2, doorH - fw / 2, z);
    put(g, mbox(x1 - x0, 0.07, 0.05), m.steel, (x0 + x1) / 2, 0.035 + 0.02, z);
  };
  leafFrame(s.fixedX0 + mw / 2, s.fixedX1, gz - 0.02);
  leafFrame(s.openX0, s.openX1, s.trackZ);
  // pull handle on the sliding leaf
  put(g, mbox(0.025, 0.9, 0.03), m.steel, s.openX1 - 0.09, 1.05, s.trackZ + 0.05);
  put(g, mbox(0.022, 0.022, 0.05), m.steel, s.openX1 - 0.09, 0.62, s.trackZ + 0.03);
  put(g, mbox(0.022, 0.022, 0.05), m.steel, s.openX1 - 0.09, 1.48, s.trackZ + 0.03);

  // Curtain track (ceiling mounted, full width).
  put(g, mbox(W - 0.1, 0.03, 0.05), m.steel, CX, H - 0.36, gz + 0.2, { cast: false });

  // Glass panes: one quad per bay and row; the right bay's lower row is the door.
  const glass = new THREE.Group();
  const rows = [0, ...GLASS.transomYs, H];
  const pane = (x0, x1, y0, y1, z) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), m.glass);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    glass.add(mesh);
  };
  for (let i = 0; i < xs.length - 1; i++) {
    for (let r = 0; r < rows.length - 1; r++) {
      const x0 = xs[i];
      const x1 = xs[i + 1];
      if (r === 0 && i === xs.length - 2) {
        pane(s.fixedX0, s.fixedX1, 0.03, doorH, gz - 0.02);
        pane(s.openX0, s.openX1, 0.05, doorH, s.trackZ);
      } else {
        pane(x0, x1, rows[r], rows[r + 1], gz);
      }
    }
  }
  return { group: g, glass };
}

/**
 * Double-height sheer linen curtains stacked at both ends of the glass. The right one is half
 * drawn across the open slider and billows in the breeze (vertex shader, driven by uTime).
 */
export function buildCurtains(material, timeUniform) {
  const parts = [
    { x0: -7.1, x1: -6.05, billow: 0.25, seed: 0.3 },
    { x0: 5.72, x1: 7.1, billow: 1.0, seed: 2.1 },
  ];
  const top = ROOM.height - 0.38;
  const z0 = GLASS.z + 0.2;
  const geoms = [];
  for (const p of parts) {
    const w = p.x1 - p.x0;
    const geo = new THREE.PlaneGeometry(w, top - 0.01, Math.round(w * 40), 30);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const billow = new Float32Array(pos.count);
    const foldW = 0.2;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + w / 2;
      const ly = pos.getY(i) + (top - 0.01) / 2;
      const fold = 0.055 * Math.sin((lx / foldW) * Math.PI * 2 + p.seed) + 0.015 * Math.sin(lx * 37 + p.seed);
      pos.setXYZ(i, p.x0 + lx, 0.01 + ly, z0 + 0.06 + fold);
      uv.setXY(i, lx, ly);
      billow[i] = p.billow;
    }
    geo.setAttribute('aBillow', new THREE.BufferAttribute(billow, 1));
    geo.computeVertexNormals();
    geoms.push(geo);
  }
  const geo = geoms[0];
  const merged = mergeTwo(geoms[0], geoms[1]);
  geo.dispose();
  geoms[1].dispose();

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uTop = { value: top };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uTop;\nattribute float aBillow;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hang = clamp((uTop - position.y) / uTop, 0.0, 1.0);
        float w = hang * hang * aBillow;
        float gust = 0.55 + 0.45 * sin(uTime * 0.37 + position.x * 0.3);
        transformed.z += w * gust * (0.16 + 0.12 * sin(uTime * 1.1 + position.x * 2.3 + position.y * 0.35));
        transformed.x += w * gust * 0.06 * sin(uTime * 0.8 + position.y * 0.9);`,
      );
  };
  material.customProgramCacheKey = () => 'beach-curtain';
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // vertex animation moves it outside its static bounds
  return mesh;
}

function mergeTwo(a, b) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'aBillow']) {
    const A = a.attributes[name];
    const B = b.attributes[name];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array, 0);
    arr.set(B.array, A.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.index.array;
  const ib = b.index.array;
  const idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + a.attributes.position.count;
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
