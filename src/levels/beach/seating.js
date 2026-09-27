import * as THREE from 'three';
import { ARC_SOFA, SECTIONAL, LOUNGE_CHAIRS, LOUNGE_CHAIR } from './layout.js';
import { arcSlab, pillow, sweepTube } from './geom.js';

// Upholstered seating: the curved bouclé sofa, the deep linen sectional and the cognac leather
// lounge chairs. Everything is authored as plain meshes; the caller batches them by material.

function put(parent, geom, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz, 'YXZ');
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const throwPillow = (s = 0.5, d = 0.17) => pillow(s, s, d, { p: 0.45, crown: 0.0, pinch: 0.45, segU: 24, segV: 16 });

/** Curved bouclé sofa, arc opening toward +X (see ARC_SOFA). */
function arcSofa(m) {
  const g = new THREE.Group();
  const A = ARC_SOFA;
  const a0 = Math.PI - A.halfAngle;
  const a1 = Math.PI + A.halfAngle;
  // recessed dark plinth
  put(g, arcSlab(A.r1 + 0.1, A.r2 - 0.1, a0, a1, 0.05, 0.01, 0.5), m.walnut, 0, 0, 0);
  // upholstered base
  put(g, arcSlab(A.r1, A.r2, a0, a1, 0.25, 0.05, 0.5), m.boucle, 0, 0.04, 0);
  // back: one continuous curved bolster
  put(g, arcSlab(A.r2 - A.backDepth, A.r2, a0, a1, A.backH - 0.04, 0.12, 1), m.boucle, 0, 0.04, 0);
  // three plump seat cushions
  const n = 3;
  const gap = 0.012;
  const span = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    const s0 = a0 + i * span + (i === 0 ? 0 : gap);
    const s1 = a0 + (i + 1) * span - (i === n - 1 ? 0 : gap);
    const capK = 0.6;
    // Inner cushions have near-square ends; the outer two round off with the base.
    const geo = arcSlab(A.r1 + 0.02, A.r2 - A.backDepth + 0.03, s0, s1, 0.17, 0.065, i === 1 ? 0.25 : capK);
    put(g, geo, m.boucle, 0, 0.27, 0);
  }
  // Throw pillows leaning on the back, facing the arc centre.
  const pillows = [
    { t: -0.56, mat: m.pillowOcean, s: 0.5 },
    { t: -0.45, mat: m.pillowSand, s: 0.46 },
    { t: 0.12, mat: m.pillowTerracotta, s: 0.52 },
    { t: 0.4, mat: m.pillowOcean, s: 0.48 },
  ];
  for (const p of pillows) {
    const r = A.r2 - A.backDepth - 0.1;
    const x = -r * Math.cos(p.t);
    const z = r * Math.sin(p.t);
    // facing the centre: local +Z of the pillow points toward (0,0)
    const yaw = Math.atan2(-x, -z);
    put(g, throwPillow(p.s), p.mat, x, 0.44 + p.s * 0.45, z, -0.28, yaw, (p.t * 7) % 0.2);
  }
  g.position.set(A.cx, 0, A.cz);
  return g;
}

/** Deep, low L-shaped sectional in oatmeal linen. */
function sectional(m) {
  const g = new THREE.Group();
  const S = SECTIONAL;
  const seatTop = S.seatH;
  const baseTop = 0.27;
  const frontX = S.runX0;
  const backX = S.runX1;
  const cushionDepth = backX - S.backDepth - frontX; // 0.85
  const up = (w, h, d) => pillow(w, h, d, { p: 0.16, crown: 0 });

  // Plinth + base under the whole L.
  put(g, up(backX - frontX - 0.12, 0.05, S.cornerZ1 - S.runZ0 - 0.12), m.walnut, (frontX + backX) / 2, 0.025, (S.runZ0 + S.cornerZ1) / 2);
  put(g, up(S.runX0 - S.returnX0, 0.05, S.cornerZ1 - S.cornerZ0 - 0.12), m.walnut, (S.returnX0 + S.runX0) / 2 + 0.06, 0.025, (S.cornerZ0 + S.cornerZ1) / 2);
  put(g, up(backX - frontX, baseTop - 0.04, S.cornerZ1 - (S.runZ0 + S.armW)), m.linen, (frontX + backX) / 2, 0.04 + (baseTop - 0.04) / 2, (S.runZ0 + S.armW + S.cornerZ1) / 2);
  put(g, up(S.runX0 - (S.returnX0 + S.armW), baseTop - 0.04, S.cornerZ1 - S.cornerZ0), m.linen, (S.returnX0 + S.armW + S.runX0) / 2, 0.04 + (baseTop - 0.04) / 2, (S.cornerZ0 + S.cornerZ1) / 2);

  // Arms (run end near the window, return end).
  put(g, up(backX - frontX, S.armH - 0.04, S.armW), m.linen, (frontX + backX) / 2, 0.04 + (S.armH - 0.04) / 2, S.runZ0 + S.armW / 2);
  put(g, up(S.armW, S.armH - 0.04, S.cornerZ1 - S.cornerZ0), m.linen, S.returnX0 + S.armW / 2, 0.04 + (S.armH - 0.04) / 2, (S.cornerZ0 + S.cornerZ1) / 2);

  // Low back frame behind the cushions.
  const frameH = 0.56;
  put(g, up(0.1, frameH, S.cornerZ1 - (S.runZ0 + S.armW)), m.linen, backX - 0.05, 0.04 + frameH / 2, (S.runZ0 + S.armW + S.cornerZ1) / 2);
  put(g, up(backX - (S.returnX0 + S.armW), frameH, 0.1), m.linen, (S.returnX0 + S.armW + backX) / 2, 0.04 + frameH / 2, S.cornerZ1 - 0.05);

  // Seat cushions: three along the run, the corner, one long one on the return.
  const cushion = (w, d) => pillow(w, seatTop - baseTop + 0.02, d, { p: 0.3, crown: 0.28 });
  const cy = baseTop + (seatTop - baseTop) / 2 - 0.02;
  const runStart = S.runZ0 + S.armW;
  const runLen = S.cornerZ0 - runStart;
  for (let i = 0; i < 3; i++) {
    const z = runStart + runLen * ((i + 0.5) / 3);
    put(g, cushion(runLen / 3 - 0.015, cushionDepth), m.linen, frontX + cushionDepth / 2, cy, z, 0, Math.PI / 2);
  }
  const cornerD = S.cornerZ1 - S.backDepth - S.cornerZ0;
  put(g, cushion(cushionDepth, cornerD), m.linen, frontX + cushionDepth / 2, cy, S.cornerZ0 + cornerD / 2);
  const retLen = frontX - (S.returnX0 + S.armW);
  put(g, cushion(retLen - 0.015, cornerD), m.linen, S.returnX0 + S.armW + retLen / 2, cy, S.cornerZ0 + cornerD / 2);

  // Back cushions, leaning back ~12°.
  const backCushion = (w) => pillow(w, S.backH - seatTop + 0.1, S.backDepth, { p: 0.34, crown: 0.0 });
  const by = seatTop + (S.backH - seatTop + 0.1) / 2 - 0.08;
  for (let i = 0; i < 3; i++) {
    const z = runStart + runLen * ((i + 0.5) / 3);
    put(g, backCushion(runLen / 3 - 0.02), m.linen, backX - S.backDepth / 2 - 0.02, by, z, -0.2, -Math.PI / 2);
  }
  put(g, backCushion(0.86), m.linen, backX - S.backDepth / 2 - 0.02, by, S.cornerZ0 + 0.43, -0.2, -Math.PI / 2);
  put(g, backCushion(retLen - 0.02), m.linen, S.returnX0 + S.armW + retLen / 2, by, S.cornerZ1 - S.backDepth / 2 - 0.02, -0.2, Math.PI);
  put(g, backCushion(0.62), m.linen, frontX + 0.28, by, S.cornerZ1 - S.backDepth / 2 - 0.02, -0.2, Math.PI);

  // Throw pillows.
  const tp = [
    [backX - 0.38, S.runZ0 + 0.55, -Math.PI / 2 + 0.25, m.pillowTerracotta, 0.5],
    [backX - 0.4, S.runZ0 + 0.98, -Math.PI / 2 - 0.1, m.pillowSand, 0.46],
    [backX - 0.36, 0.72, -Math.PI / 2 - Math.PI / 4, m.pillowOcean, 0.55],
    [backX - 0.52, 0.95, -Math.PI / 2 - Math.PI / 4 + 0.2, m.pillowTerracotta, 0.42],
    [S.returnX0 + 0.62, S.cornerZ1 - 0.4, Math.PI + 0.15, m.pillowOcean, 0.5],
  ];
  for (const [x, z, yaw, mat, s] of tp) put(g, throwPillow(s), mat, x, seatTop + s * 0.42, z, -0.3, yaw, 0.05);
  // Folded throw blanket on the window-end arm.
  const throwBlanket = pillow(0.72, 0.05, 0.42, { p: 0.2, crown: 0.4 });
  put(g, throwBlanket, m.pillowSand, (frontX + backX) / 2 - 0.05, S.armH + 0.02, S.runZ0 + S.armW / 2 + 0.01, 0, 0.08);
  return g;
}

/** Bent-walnut frame lounge chair with cognac leather seat and back cushions. Faces local -Z. */
function loungeChair(m) {
  const g = new THREE.Group();
  const C = LOUNGE_CHAIR;
  const hw = C.w / 2 - 0.04;
  for (const sx of [-hw, hw]) {
    const pts = [
      [-0.4, 0.0],
      [-0.39, 0.3],
      [-0.36, 0.56],
      [-0.2, 0.6],
      [0.18, 0.6],
      [0.3, 0.52],
      [0.36, 0.25],
      [0.42, 0.0],
    ].map(([z, y]) => new THREE.Vector3(sx, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    put(g, sweepTube(curve, () => 0.026, 48, 8, true), m.walnut, 0, 0, 0);
  }
  // stretchers
  const bar = (y, z) => {
    const c = new THREE.LineCurve3(new THREE.Vector3(-hw, y, z), new THREE.Vector3(hw, y, z));
    put(g, sweepTube(c, () => 0.018, 2, 8, true), m.walnut, 0, 0, 0);
  };
  bar(0.14, -0.395);
  bar(0.14, 0.4);
  bar(0.3, 0.12);
  // leather sling under the cushions
  put(g, pillow(C.w - 0.1, 0.03, 0.72, { p: 0.2, crown: 0 }), m.leather, 0, 0.27, -0.02, 0.1);
  // seat and back cushions
  put(g, pillow(C.w - 0.14, 0.15, 0.66, { p: 0.3, crown: 0.3 }), m.leather, 0, C.seatH - 0.06, -0.06, 0.08);
  put(g, pillow(C.w - 0.14, 0.52, 0.16, { p: 0.34, crown: 0.0 }), m.leather, 0, 0.6, 0.28, 0.32);
  // headrest roll
  put(g, pillow(C.w - 0.2, 0.12, 0.12, { p: 0.5, crown: 0 }), m.leather, 0, C.backH - 0.02, 0.37, 0.2);
  return g;
}

/** All seating as one Group. */
export function buildSeating(m) {
  const g = new THREE.Group();
  g.add(arcSofa(m));
  g.add(sectional(m));
  for (const c of LOUNGE_CHAIRS) {
    const chair = loungeChair(m);
    chair.position.set(c.x, 0, c.z);
    chair.rotation.y = c.yaw;
    g.add(chair);
  }
  return g;
}
