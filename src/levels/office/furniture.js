import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { T, TY, atlasBox, applyFaceUVs, insideOut, taperedBox, wedge } from './batch.js';
import { DESK, DESKS, MONITOR, CHAIR, CABINET, PLANT, chairPlacements } from './layout.js';
import { atlasUV, screenRect } from './textures.js';
import { rng } from '../../utils/canvasTexture.js';

// The MDR island (four desks, plus-shaped partition, terminals and desk clutter), chairs,
// the lateral filing cabinet and a snake plant. Everything goes into the shared batcher.

const COLORS = {
  laminate: 0xe7e3d9,
  laminateEdge: 0xd2cdc0,
  partition: 0x5f8068,
  modesty: 0xdcd8cd,
  terminal: 0xdcd3ba,
  terminalDark: 0xc9bea2,
  screenSurround: 0x1a1d1f,
  chairFabric: 0x1b1c1f,
  chairPlastic: 0x1f2023,
  chrome: 0x9a9da2,
  trackball: 0x3b2226,
  pencil: 0xe0ac2f,
  pencilCup: 0x2b2d31,
  cabinet: 0xd3cbb5,
  cabinetShadow: 0xb9b19c,
  potWhite: 0xf0eee8,
  soil: 0x2e2419,
};

// Shared geometry built once and baked into many places.
const GEO = {};
function geo(name, make) {
  if (!GEO[name]) GEO[name] = make();
  return GEO[name];
}

/**
 * @param {import('./batch.js').Batcher} b
 */
export function buildFurniture(b) {
  buildIsland(b);
  DESKS.forEach((desk, i) => buildDeskSet(b, desk, i));
  for (const ch of chairPlacements()) buildChair(b, TY(ch.x, 0, ch.z, ch.yaw));
  buildCabinet(b);
  buildPlant(b);
  for (const g of Object.values(GEO)) g.dispose();
  for (const k of Object.keys(GEO)) delete GEO[k];
}

function deskMatrix(desk) {
  return TY(desk.origin[0], 0, desk.origin[1], desk.yaw);
}

// ---------------------------------------------------------------- island

function buildIsland(b) {
  const H = DESK.half;
  const q = H - 0.003; // tiny gap between the four tops
  const top = new RoundedBoxGeometry(q, DESK.topThickness, q, 2, 0.009);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add('plastic', top, T((sx * H) / 2, DESK.top - DESK.topThickness / 2, (sz * H) / 2), { color: COLORS.laminate });
    }
  }
  top.dispose();

  // Plus-shaped upholstered partition (the Z arm is split so the two arms never overlap).
  const ph = DESK.partitionTop - DESK.top;
  const pt = DESK.partitionThickness;
  const armX = new RoundedBoxGeometry(2 * H, ph + 0.02, pt, 3, 0.022);
  b.add('fabric', armX, T(0, DESK.top + ph / 2 - 0.01, 0), { color: COLORS.partition, uvScale: [10, 2] });
  const halfLen = H - pt / 2;
  const armZ = new RoundedBoxGeometry(pt, ph + 0.02, halfLen, 3, 0.022);
  for (const s of [-1, 1]) b.add('fabric', armZ, T(0, DESK.top + ph / 2 - 0.01, s * (pt / 2 + halfLen / 2)), { color: COLORS.partition, uvScale: [1, 2] });
  armX.dispose();
  armZ.dispose();

  // Modesty panels under the island: the same plus, down to the carpet.
  const mh = DESK.top - DESK.topThickness;
  b.add('plastic', new THREE.BoxGeometry(2 * H - 0.12, mh, 0.03), T(0, mh / 2, 0), { color: COLORS.modesty });
  for (const s of [-1, 1]) {
    b.add('plastic', new THREE.BoxGeometry(0.03, mh, H - 0.075), T(0, mh / 2, s * (0.015 + (H - 0.075) / 2)), { color: COLORS.modesty });
  }
  // Each desk's right-hand end panel (a pinwheel of gables around the island).
  for (const desk of DESKS) {
    const m = deskMatrix(desk).multiply(T(H / 2 - 0.02, mh / 2, -H / 2 + 0.02));
    b.add('plastic', new THREE.BoxGeometry(0.03, mh, H - 0.06), m, { color: COLORS.modesty });
  }
}

// ---------------------------------------------------------------- desk sets

function buildDeskSet(b, desk, i) {
  const M = deskMatrix(desk);
  const at = (x, y, z, rx = 0, ry = 0, rz = 0) => M.clone().multiply(T(x, y, z, rx, ry, rz));
  const y0 = DESK.top;

  buildTerminal(b, at(MONITOR.x, y0, MONITOR.z + 0.015, 0, 0.04 * (i % 2 ? 1 : -1)), i);

  // Keyboard (atlas top), trackball to its right.
  const kb = geo('keyboard', () => {
    const g = wedge(0.46, 0.028, 0.052, 0.18);
    return applyFaceUVs(g, { py: atlasUV('keyboard'), all: atlasUV('cream') });
  });
  b.add('atlas', kb, at(-0.06, y0, -0.36, 0, 0.03 * (i - 1.5)));
  const tbBase = geo('tbBase', () => new RoundedBoxGeometry(0.12, 0.045, 0.14, 2, 0.016));
  b.add('plastic', tbBase, at(0.26, y0 + 0.0225, -0.35), { color: COLORS.terminal });
  const tbBall = geo('tbBall', () => new THREE.SphereGeometry(0.029, 20, 14));
  b.add('plastic', tbBall, at(0.26, y0 + 0.05, -0.365), { color: COLORS.trackball });
  const btn = geo('tbBtn', () => new RoundedBoxGeometry(0.036, 0.012, 0.028, 1, 0.005));
  for (const s of [-1, 1]) b.add('plastic', btn, at(0.26 + s * 0.035, y0 + 0.047, -0.3), { color: COLORS.terminalDark });

  // Pencil cup with pencils, in the back-left corner by the partitions.
  const cup = geo('cup', () => new THREE.CylinderGeometry(0.036, 0.032, 0.1, 18));
  b.add('plastic', cup, at(-0.46, y0 + 0.05, -0.98), { color: COLORS.pencilCup });
  const pencil = geo('pencil', () => new THREE.CylinderGeometry(0.0038, 0.0038, 0.18, 6));
  const r = rng(desk.seed);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + r();
    const tilt = 0.12 + r() * 0.12;
    b.add('plastic', pencil, at(-0.46 + Math.cos(a) * 0.012, y0 + 0.095, -0.98 + Math.sin(a) * 0.012, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt), {
      color: k === 3 ? 0x2d5d8a : COLORS.pencil,
    });
  }

  // Nameplate facing the aisle at the desk's outer edge.
  const plate = atlasBox(0.2, 0.05, 0.012, { pz: atlasUV(`nameplate${i}`), all: atlasUV('walnut') });
  b.add('atlas', plate, at(0.42, y0 + 0.028, -0.07, -0.3));
  plate.dispose();
  b.add('atlas', geo('plateFoot', () => atlasBox(0.2, 0.008, 0.05, { all: atlasUV('walnut') })), at(0.42, y0 + 0.004, -0.075));

  // A few personal touches per desk.
  const paper = geo('paper', () => atlasBox(0.21, 0.014, 0.297, { py: atlasUV('paper'), all: atlasUV('white') }));
  if (i !== 3) b.add('atlas', paper, at(0.4, y0 + 0.007, -0.9, 0, 0.25 - i * 0.2));
  if (i === 0 || i === 2 || i === 3) buildMug(b, at(i === 2 ? 0.46 : -0.36, y0, i === 2 ? -0.6 : -0.62, 0, i * 1.3));
  if (i === 0) {
    const trap = geo('trap', () => new THREE.CylinderGeometry(0.0085, 0.0085, 0.1, 12, 1, true).rotateZ(Math.PI / 2));
    b.add('atlas', trap, at(0.2, y0 + 0.009, -0.16, 0, 0.5), { uvRect: atlasUV('fingerTrap') });
  }
  if (i === 2) {
    // Irving's handbook
    const book = atlasBox(0.16, 0.03, 0.23, { all: atlasUV('walnut') });
    b.add('atlas', book, at(0.38, y0 + 0.015 + 0.014, -0.9, 0, 0.35));
    book.dispose();
  }
}

/** Chunky cream CRT-style terminal: rounded bezel with a recessed bulging screen, tapered housing. */
function buildTerminal(b, M, i) {
  const at = (x, y, z, rx = 0) => M.clone().multiply(T(x, y, z, rx));
  const plinthH = 0.045;
  b.add('plastic', geo('plinth', () => new RoundedBoxGeometry(0.3, plinthH, 0.28, 2, 0.01)), at(0, plinthH / 2, -0.03), { color: COLORS.terminalDark });
  b.add('plastic', geo('neck', () => new THREE.BoxGeometry(0.14, 0.03, 0.12)), at(0, plinthH + 0.012, -0.03), { color: COLORS.terminalDark });

  // Everything above the neck tilts back a touch.
  const head = M.clone().multiply(T(0, plinthH + 0.02 + 0.185, 0.12, -0.06));
  const on = (x, y, z) => head.clone().multiply(T(x, y, z));
  const bezel = geo('bezel', () => {
    const W = 0.44;
    const Hh = 0.37;
    const shape = roundedRectShape(W, Hh, 0.03);
    shape.holes.push(roundedRectPath(0.318, 0.246, 0.022, 0, 0.012));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -0.055);
    return g;
  });
  b.add('plastic', bezel, on(0, 0, 0), { color: COLORS.terminal });
  // Dark screen surround inside the recess
  b.add('plastic', geo('surround', () => new THREE.BoxGeometry(0.33, 0.26, 0.02)), on(0, 0.012, -0.052), { color: COLORS.screenSurround });
  // Housing tapering to the back
  b.add('plastic', geo('housing', () => taperedBox(0.41, 0.35, 0.3, 0.72, 0.66, -0.035)), on(0, 0, -0.065 - 0.15), { color: COLORS.terminal });
  // Glowing, slightly convex screen
  const screen = new THREE.PlaneGeometry(0.3, 0.228, 8, 6);
  const p = screen.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const u = p.getX(k) / 0.15;
    const v = p.getY(k) / 0.114;
    p.setZ(k, 0.007 * (1 - 0.5 * (u * u + v * v)));
  }
  screen.computeVertexNormals();
  b.add('screen', screen, on(0, 0.012, -0.04), { uvRect: screenRect(i) });
  screen.dispose();
  // Tiny brand badge + power lamp under the screen
  b.add('metal', geo('badge', () => new THREE.BoxGeometry(0.05, 0.008, 0.004)), on(-0.14, -0.163, 0.002), { color: 0x9aa0a6 });
  b.add('plastic', geo('lamp', () => new THREE.CylinderGeometry(0.004, 0.004, 0.004, 8).rotateX(Math.PI / 2)), on(0.17, -0.163, 0.002), { color: 0x65d17a });
}

function roundedRectPath(w, h, r, cx = 0, cy = 0, path = new THREE.Path()) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

function roundedRectShape(w, h, r) {
  return roundedRectPath(w, h, r, 0, 0, new THREE.Shape());
}

function buildMug(b, M) {
  const at = (x, y, z, rx = 0, ry = 0, rz = 0) => M.clone().multiply(T(x, y, z, rx, ry, rz));
  b.add('atlas', geo('mugSide', () => new THREE.CylinderGeometry(0.04, 0.037, 0.095, 24, 1, true)), at(0, 0.0475, 0), { uvRect: atlasUV('mug') });
  b.add('plastic', geo('mugIn', () => insideOut(new THREE.CylinderGeometry(0.036, 0.036, 0.016, 24, 1, true))), at(0, 0.087, 0), { color: 0xe9e6de });
  b.add('plastic', geo('mugLip', () => new THREE.TorusGeometry(0.038, 0.002, 4, 24).rotateX(Math.PI / 2)), at(0, 0.095, 0), { color: 0xf1efe8 });
  b.add('plastic', geo('coffee', () => new THREE.CircleGeometry(0.036, 24).rotateX(-Math.PI / 2)), at(0, 0.079, 0), { color: 0x3a2418 });
  b.add('plastic', geo('mugHandle', () => new THREE.TorusGeometry(0.024, 0.0065, 8, 16, Math.PI)), at(0.04, 0.05, 0, 0, 0, -Math.PI / 2), { color: 0xf1efe8 });
}

// ---------------------------------------------------------------- chairs

/** Black ergonomic task chair; local -Z is where the sitter faces. */
function buildChair(b, M) {
  const at = (x, y, z, rx = 0, ry = 0, rz = 0) => M.clone().multiply(T(x, y, z, rx, ry, rz));
  // Five-star base with casters
  b.add('plastic', geo('hub', () => new THREE.CylinderGeometry(0.05, 0.06, 0.06, 16)), at(0, 0.1, 0), { color: COLORS.chairPlastic });
  const leg = geo('leg', () => new THREE.BoxGeometry(0.036, 0.032, 0.3).translate(0, 0, 0.16));
  const caster = geo('caster', () => new THREE.CylinderGeometry(0.024, 0.024, 0.02, 14).rotateZ(Math.PI / 2));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    b.add('plastic', leg, at(0, 0.085, 0, 0, a, 0).multiply(T(0, 0, 0, 0.1)), { color: COLORS.chairPlastic });
    b.add('plastic', caster, at(Math.sin(a) * 0.3, 0.024, Math.cos(a) * 0.3, 0, a + 0.6, 0), { color: 0x151517 });
  }
  b.add('metal', geo('lift', () => new THREE.CylinderGeometry(0.022, 0.022, 0.26, 14)), at(0, 0.26, 0), { color: COLORS.chrome });
  b.add('plastic', geo('mech', () => new THREE.BoxGeometry(0.2, 0.05, 0.22)), at(0, 0.41, 0.02), { color: COLORS.chairPlastic });
  // Seat and backrest
  b.add('fabric', geo('seat', () => new RoundedBoxGeometry(CHAIR.seatW - 0.02, 0.085, CHAIR.seatD - 0.01, 3, 0.036)), at(0, 0.47, 0), { color: COLORS.chairFabric, uvScale: [3, 3] });
  b.add('plastic', geo('spine', () => new THREE.BoxGeometry(0.07, 0.36, 0.03)), at(0, 0.55, 0.265, 0.12), { color: COLORS.chairPlastic });
  b.add('fabric', geo('back', () => new RoundedBoxGeometry(CHAIR.backW - 0.02, 0.54, 0.07, 3, 0.03)), at(0, 0.84, CHAIR.backZ, 0.12), { color: COLORS.chairFabric, uvScale: [3, 3] });
  b.add('plastic', geo('lumbar', () => new RoundedBoxGeometry(0.4, 0.1, 0.02, 2, 0.008)), at(0, 0.72, CHAIR.backZ - 0.045, 0.12), { color: 0x2a2b2f });
  // Armrests
  const post = geo('armPost', () => new THREE.BoxGeometry(0.03, 0.2, 0.05));
  const pad = geo('armPad', () => new RoundedBoxGeometry(0.075, 0.03, 0.26, 2, 0.012));
  for (const s of [-1, 1]) {
    b.add('plastic', post, at(s * 0.262, 0.56, 0.03), { color: COLORS.chairPlastic });
    b.add('plastic', pad, at(s * 0.262, 0.672, 0.0), { color: COLORS.chairPlastic });
  }
}

// ---------------------------------------------------------------- filing cabinet

function buildCabinet(b) {
  const { width: W, depth: D, height: Hc } = CABINET;
  // Local frame: front faces +Z; CABINET.yaw turns it to face into the room. Sits 4 mm off the wall.
  const M = TY(CABINET.x + Math.sin(CABINET.yaw) * 0.004, 0, CABINET.z + Math.cos(CABINET.yaw) * 0.004, CABINET.yaw);
  const at = (x, y, z) => M.clone().multiply(T(x, y, z));
  b.add('plastic', new THREE.BoxGeometry(W, Hc - 0.07, D - 0.02), at(0, (Hc - 0.07) / 2 + 0.05, -0.01), { color: COLORS.cabinet });
  b.add('plastic', new THREE.BoxGeometry(W - 0.04, 0.05, D - 0.06), at(0, 0.025, -0.02), { color: 0x3b3a37 });
  b.add('plastic', new RoundedBoxGeometry(W + 0.012, 0.022, D + 0.006, 2, 0.006), at(0, Hc - 0.011, 0), { color: COLORS.cabinet });
  const drawerH = (Hc - 0.07 - 0.022 - 0.02) / 3;
  const front = new RoundedBoxGeometry(W - 0.03, drawerH - 0.012, 0.022, 2, 0.005);
  const handle = new THREE.BoxGeometry(0.24, 0.018, 0.02);
  const label = atlasBox(0.1, 0.036, 0.004, { pz: atlasUV('cabinetLabel'), all: atlasUV('white') });
  for (let k = 0; k < 3; k++) {
    const y = 0.06 + drawerH * (k + 0.5);
    b.add('plastic', front, at(0, y, D / 2 - 0.01), { color: 0xd8d0ba });
    b.add('metal', handle, at(0, y + drawerH * 0.22, D / 2 + 0.01), { color: 0xa8a9a6 });
    b.add('atlas', label, at(0, y - drawerH * 0.05, D / 2 + 0.002));
  }
  front.dispose();
  handle.dispose();
  label.dispose();
  // On top: a stack of report binders.
  const binder = new THREE.BoxGeometry(0.3, 0.04, 0.24);
  [0x2f4a5c, 0xe8e4d8, 0x5f8068].forEach((c, k) => b.add('plastic', binder, at(-0.18, Hc + 0.02 + k * 0.041, -0.02).multiply(T(0, 0, 0, 0, k * 0.08 - 0.05)), { color: c }));
  binder.dispose();
}

// ---------------------------------------------------------------- plant

/** Sansevieria in a tall white ceramic cylinder. */
function buildPlant(b) {
  const { x, z, potRadius: pr, potHeight: ph } = PLANT;
  const M = TY(x, 0, z, 0.4);
  const at = (px, py, pz, rx = 0, ry = 0, rz = 0) => M.clone().multiply(T(px, py, pz, rx, ry, rz));
  const profile = [
    [0, 0],
    [pr - 0.03, 0],
    [pr - 0.012, 0.012],
    [pr - 0.004, ph * 0.5],
    [pr, ph - 0.01],
    [pr - 0.004, ph],
    [pr - 0.018, ph],
    [pr - 0.02, ph - 0.05],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pot = new THREE.LatheGeometry(profile, 40);
  b.add('plastic', pot, M, { color: COLORS.potWhite });
  pot.dispose();
  b.add('plastic', new THREE.CircleGeometry(pr - 0.02, 32).rotateX(-Math.PI / 2), at(0, ph - 0.05, 0), { color: COLORS.soil });

  const r = rng(314);
  const leaf = new THREE.PlaneGeometry(1, 1, 4, 10);
  const dark = new THREE.Color(0x24461f);
  const mid = new THREE.Color(0x3d6a2c);
  const band = new THREE.Color(0x6f8d4b);
  const edge = new THREE.Color(0xc2b75a);
  for (let k = 0; k < 17; k++) {
    const hgt = 0.5 + r() * 0.36;
    const wid = 0.055 + r() * 0.03;
    const g = leaf.clone();
    const p = g.attributes.position;
    const bend = (r() - 0.5) * 0.16;
    // Sword leaf: widest a third of the way up, pointed tip, folded into a shallow V.
    const halfWidth = (t) => 0.5 * wid * Math.sin(Math.PI * (0.12 + 0.88 * t)) * (t > 0.85 ? (1 - t) / 0.15 : 1);
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) + 0.5; // 0 at the base, 1 at the tip
      const x0 = p.getX(i);
      p.setXYZ(i, x0 * 2 * halfWidth(t), t * hgt, bend * t * t + Math.abs(x0) * wid * 0.35);
    }
    g.computeVertexNormals();
    const a = r() * Math.PI * 2;
    const rad = r() * (pr - 0.07);
    const tilt = 0.06 + r() * 0.2;
    const stripe = r() * 10;
    b.add('leaf', g, at(Math.cos(a) * rad, ph - 0.05, Math.sin(a) * rad, Math.cos(a) * tilt, r() * Math.PI, -Math.sin(a) * tilt), {
      colorFn: (pos, out) => {
        const e = Math.abs(pos.x) / Math.max(1e-4, halfWidth(pos.y / hgt));
        const s = Math.sin(pos.y * 34 + stripe) * 0.5 + 0.5;
        out.copy(dark).lerp(s > 0.6 ? band : mid, s * 0.8);
        if (e > 0.78) out.lerp(edge, Math.min(1, (e - 0.78) * 4));
      },
    });
    g.dispose();
  }
  leaf.dispose();
}
