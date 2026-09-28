import * as THREE from 'three';
import { rng } from '../../utils/canvasTexture.js';
import { ROOM, OLIVE, FIG, PAMPAS } from './layout.js';
import { mlathe, sweepTube, foliageCards } from './geom.js';

// Indoor plants: a multi-stem olive tree in a stone planter, a fiddle-leaf fig in a white
// ceramic pot, and dried pampas in a tall floor vase.

function put(parent, geom, mat, x = 0, y = 0, z = 0, cast = true) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function soil(parent, m, x, y, z, r) {
  const d = new THREE.CircleGeometry(r, 32);
  d.rotateX(-Math.PI / 2);
  put(parent, d, m.soil, x, y, z, false);
}

/** Gnarled multi-stem olive: three trunks splitting into branches, silvery leaf clusters. */
function oliveTree(m) {
  const O = OLIVE;
  const g = new THREE.Group();
  const r = rng(71);
  const pot = [
    [0, 0],
    [0.3, 0],
    [0.33, 0.02],
    [0.4, 0.46],
    [O.potR, O.potH - 0.02],
    [O.potR - 0.005, O.potH],
    [O.potR - 0.035, O.potH],
    [O.potR - 0.04, O.potH - 0.05],
  ];
  put(g, mlathe(pot, 56), m.stone, O.x, 0, O.z);
  soil(g, m, O.x, O.potH - 0.05, O.z, O.potR - 0.04);

  const center = new THREE.Vector3(O.x + 0.1, 2.3, O.z + 0.05);
  // Keep the crown off the side wall and the glass.
  const clampCrown = (p) => {
    p.x = Math.max(p.x, ROOM.minX + 0.18);
    p.z = Math.max(p.z, ROOM.minZ + 0.18);
    return p;
  };
  const tips = [];
  for (let s = 0; s < 3; s++) {
    const a0 = (s / 3) * Math.PI * 2 + 0.4;
    const base = new THREE.Vector3(O.x + Math.cos(a0) * 0.06, O.potH - 0.06, O.z + Math.sin(a0) * 0.06);
    const lean = new THREE.Vector3(Math.cos(a0) * 0.22, 0, Math.sin(a0) * 0.22);
    const fork = new THREE.Vector3(O.x + 0.1, 1.25 + s * 0.12, O.z + 0.05).add(lean);
    const trunk = new THREE.CatmullRomCurve3([
      base,
      base.clone().add(new THREE.Vector3(-lean.x * 0.4, 0.35, -lean.z * 0.4)),
      base.clone().lerp(fork, 0.65).add(new THREE.Vector3(lean.z * 0.3, 0, -lean.x * 0.3)),
      fork,
    ]);
    put(g, sweepTube(trunk, (t) => 0.05 - 0.018 * t, 20, 9), m.bark);
    for (let b = 0; b < 3; b++) {
      const a = a0 + (b - 1) * 0.9 + (r() - 0.5) * 0.4;
      const reach = 0.45 + r() * 0.35;
      const tip = clampCrown(new THREE.Vector3(center.x + Math.cos(a) * reach, 1.85 + r() * 0.75, center.z + Math.sin(a) * reach));
      const mid = fork.clone().lerp(tip, 0.5).add(new THREE.Vector3((r() - 0.5) * 0.12, 0.08, (r() - 0.5) * 0.12));
      put(g, sweepTube(new THREE.CatmullRomCurve3([fork, mid, tip]), (t) => 0.03 * (1 - 0.65 * t), 14, 7), m.bark);
      tips.push(tip);
    }
  }
  const pts = [];
  for (const t of tips) {
    for (let k = 0; k < 5; k++) {
      pts.push(clampCrown(t.clone().add(new THREE.Vector3((r() - 0.5) * 0.5, (r() - 0.3) * 0.4, (r() - 0.5) * 0.5))));
    }
  }
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 0.8;
    pts.push(clampCrown(new THREE.Vector3(center.x + Math.cos(a) * rad, center.y + (r() - 0.45) * 1.0, center.z + Math.sin(a) * rad)));
  }
  for (const q of foliageCards(pts, 0.55, center, r)) put(g, q, m.oliveLeaf);
  return g;
}

/** One fiddle-leaf fig leaf: a folded, drooping 3x3 grid (u across, v base -> tip). */
function figLeafGeometry(L, W) {
  const pos = [];
  const uv = [];
  const idx = [];
  const n = 3;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const v = j / (n - 1);
      const x = (u - 0.5) * W;
      const z = v * L;
      const y = -Math.abs(u - 0.5) * W * 0.32 - v * v * L * 0.28;
      pos.push(x, y, z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Fiddle-leaf fig: a tall main stem and a shorter one, big glossy leaves in a spiral. */
function figTree(m) {
  const F = FIG;
  const g = new THREE.Group();
  const r = rng(83);
  const pot = [
    [0, 0],
    [0.24, 0],
    [0.27, 0.03],
    [F.potR, 0.2],
    [F.potR, F.potH - 0.03],
    [F.potR - 0.01, F.potH],
    [F.potR - 0.03, F.potH],
    [F.potR - 0.03, F.potH - 0.05],
  ];
  put(g, mlathe(pot, 48), m.ceramic, F.x, 0, F.z);
  soil(g, m, F.x, F.potH - 0.05, F.z, F.potR - 0.03);
  const stems = [
    { top: new THREE.Vector3(F.x - 0.08, 2.4, F.z + 0.1), bend: new THREE.Vector3(0.1, 0, -0.04), from: 0.95, leaves: 30 },
    { top: new THREE.Vector3(F.x + 0.22, 1.72, F.z + 0.06), bend: new THREE.Vector3(-0.05, 0, 0.08), from: 0.8, leaves: 16 },
  ];
  for (const s of stems) {
    const base = new THREE.Vector3(F.x, F.potH - 0.05, F.z);
    const curve = new THREE.CatmullRomCurve3([base, base.clone().lerp(s.top, 0.4).add(s.bend), base.clone().lerp(s.top, 0.75).sub(s.bend.clone().multiplyScalar(0.4)), s.top]);
    put(g, sweepTube(curve, (t) => 0.024 - 0.012 * t, 24, 7), m.bark);
    const y0 = s.from;
    for (let i = 0; i < s.leaves; i++) {
      const t = i / (s.leaves - 1);
      const y = y0 + (s.top.y - y0) * t;
      const ct = (y - base.y) / (s.top.y - base.y);
      const p = curve.getPoint(Math.min(1, Math.max(0, ct)));
      const leaf = figLeafGeometry(0.26 + r() * 0.12 - t * 0.04, 0.22 + r() * 0.07);
      // Lower leaves reach out and droop; the top ones stand up.
      leaf.rotateX(-(0.25 + t * 0.75 + (r() - 0.5) * 0.3));
      leaf.rotateY(i * 2.4 + r() * 0.5);
      leaf.translate(p.x, p.y, p.z);
      put(g, leaf, m.figLeaf);
    }
    // a terminal leaf bud pointing up
    const bud = figLeafGeometry(0.2, 0.14);
    bud.rotateX(-1.35);
    bud.translate(s.top.x, s.top.y - 0.02, s.top.z);
    put(g, bud, m.figLeaf);
  }
  return g;
}

/** Tall ribbed floor vase of dried pampas plumes. */
function pampasVase(m) {
  const P = PAMPAS;
  const g = new THREE.Group();
  const r = rng(97);
  const prof = [
    [0, 0],
    [0.11, 0],
    [0.15, 0.08],
    [P.r, 0.3],
    [0.165, 0.54],
    [0.09, 0.68],
    [0.08, P.h - 0.02],
    [0.088, P.h],
    [0.072, P.h],
    [0.068, P.h - 0.05],
  ];
  put(g, mlathe(prof, 48), m.terracotta, P.x, 0, P.z);
  const top = new THREE.Vector3(P.x, P.h - 0.04, P.z);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.5;
    const spread = 0.12 + r() * 0.28;
    const h = 1.35 + r() * 0.55;
    // lean away from the wall (x = ROOM.maxX)
    const dir = new THREE.Vector3(Math.cos(a) * spread - 0.08, 0, Math.sin(a) * spread);
    const end = new THREE.Vector3(P.x + dir.x * 1.6, h, P.z + dir.z * 1.6);
    const mid = top.clone().lerp(end, 0.5).add(new THREE.Vector3(dir.x * 0.3, 0.1, dir.z * 0.3));
    const curve = new THREE.CatmullRomCurve3([top.clone(), mid, end]);
    put(g, sweepTube(curve, () => 0.0045, 12, 5), m.rattanSolid, 0, 0, 0, false);
    // plume: two crossed cards along the last 0.5 m of the stem
    const tan = curve.getTangent(1);
    for (let k = 0; k < 2; k++) {
      const card = new THREE.PlaneGeometry(0.15, 0.52);
      card.translate(0, 0.2, 0);
      card.rotateY((k * Math.PI) / 2 + a);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      card.applyQuaternion(q);
      card.translate(end.x - tan.x * 0.2, end.y - tan.y * 0.2, end.z - tan.z * 0.2);
      put(g, card, m.plume);
    }
  }
  return g;
}

/**
 * @param {Record<string, THREE.Material>} m interior materials
 * @returns {THREE.Group}
 */
export function buildPlants(m) {
  const g = new THREE.Group();
  g.add(oliveTree(m), figTree(m), pampasVase(m));
  return g;
}
