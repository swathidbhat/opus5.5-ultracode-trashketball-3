import * as THREE from 'three';
import { rng } from '../../utils/canvasTexture.js';
import {
  ROOM,
  RUG,
  COFFEE_TABLE,
  SIDE_TABLES,
  ARC_LAMP,
  CREDENZA,
  SIDEBOARD,
  ART,
  BAR_CART,
  CONSOLE,
  PENDANTS,
} from './layout.js';
import { mbox, mlathe, mcylinder, sweepTube, tint, fluted, bookGeometries, foliageCards } from './geom.js';
import { buildPlants } from './plants.js';
import { buildLibrary } from './library.js';
import { buildPiano } from './piano.js';

// Living-room decor: rug, marble coffee table, travertine side tables, lamps, rattan pendants,
// walnut cabinets with styling, framed canvases and a brass bar cart. Plain meshes; the level
// batches them by material.

function put(parent, geom, mat, x = 0, y = 0, z = 0, o = {}) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
  mesh.castShadow = o.cast ?? true;
  mesh.receiveShadow = o.receive ?? true;
  parent.add(mesh);
  return mesh;
}

/** Merge several geometries (already positioned) into the parent as one mesh. */
function putAll(parent, geoms, mat, o = {}) {
  for (const g of geoms) put(parent, g, mat, 0, 0, 0, o);
}

// ---------------------------------------------------------------------------------------------
// Small styling pieces (local coordinates; y = 0 is the surface they stand on).

/** A stack of hardbacks, each turned a little. Colours are [cover, w, t, d]. */
function bookStack(parent, m, x, y, z, yaw, books) {
  let h = 0;
  const r = rng(Math.round((x + z) * 1000));
  for (const [cover, w, t, d] of books) {
    const turn = yaw + (r() - 0.5) * 0.18;
    for (const g of bookGeometries(w, t, d, cover)) {
      g.rotateY(turn);
      g.translate(x, y + h, z);
      put(parent, g, m.colored);
    }
    h += t;
  }
  return h;
}

/** Glazed gourd lamp with a glowing linen drum shade. */
function tableLamp(parent, m, x, y, z, s = 1, glaze = 'ceramicBlue') {
  const base = [
    [0, 0],
    [0.07, 0],
    [0.1, 0.025],
    [0.128, 0.085],
    [0.124, 0.16],
    [0.085, 0.235],
    [0.045, 0.285],
    [0.032, 0.31],
    [0.034, 0.33],
    [0, 0.33],
  ].map(([r, h]) => [r * s, h * s]);
  put(parent, mlathe(base, 40), m[glaze], x, y, z);
  put(parent, mcylinder(0.008 * s, 0.1 * s, 10), m.brass, x, y + 0.33 * s, z);
  const shade = mlathe(
    [
      [0.2 * s, 0],
      [0.2 * s, 0.012 * s],
      [0.165 * s, 0.25 * s],
      [0.165 * s, 0.262 * s],
    ],
    48,
  );
  put(parent, shade, m.lampShade, x, y + 0.34 * s, z);
  put(parent, new THREE.SphereGeometry(0.035 * s, 12, 8), m.bulb, x, y + 0.43 * s, z, { cast: false });
}

/** Low glazed bud vase with a couple of olive sprigs. */
function budVase(parent, m, x, y, z, r, glaze = 'ceramicDark') {
  const prof = [
    [0, 0],
    [0.045, 0],
    [0.07, 0.04],
    [0.068, 0.09],
    [0.03, 0.13],
    [0.022, 0.15],
    [0.026, 0.155],
    [0.018, 0.155],
    [0.016, 0.13],
  ];
  put(parent, mlathe(prof, 32), m[glaze], x, y, z);
  const pts = [];
  for (let i = 0; i < 4; i++) {
    pts.push(new THREE.Vector3(x + (r() - 0.5) * 0.14, y + 0.24 + r() * 0.12, z + (r() - 0.5) * 0.14));
  }
  putAll(parent, foliageCards(pts, 0.2, new THREE.Vector3(x, y + 0.2, z), r), m.oliveLeaf, { cast: false });
}

/** Shallow turned-walnut bowl. */
function woodBowl(parent, m, x, y, z, rad) {
  const prof = [
    [0, 0],
    [rad * 0.45, 0],
    [rad * 0.5, 0.01],
    [rad * 0.85, 0.045],
    [rad, 0.08],
    [rad - 0.012, 0.082],
    [rad * 0.82, 0.05],
    [rad * 0.42, 0.018],
    [0, 0.018],
  ];
  put(parent, mlathe(prof, 48), m.walnut, x, y, z);
}

// ---------------------------------------------------------------------------------------------

function rug(m) {
  const g = new THREE.Group();
  // Box UVs run 0..1 across the top, so the hand-drawn lattice spans the whole rug.
  put(g, new THREE.BoxGeometry(RUG.w, RUG.h, RUG.d), m.rug, RUG.x, RUG.h / 2, RUG.z, { cast: false });
  return g;
}

function coffeeTable(m) {
  const g = new THREE.Group();
  const T = COFFEE_TABLE;
  const pedestal = [
    [0, 0],
    [0.4, 0],
    [0.405, 0.012],
    [0.392, 0.028],
    [0.27, 0.07],
    [0.2, 0.13],
    [0.176, 0.19],
    [0.196, 0.25],
    [0.27, 0.3],
    [0.36, 0.326],
    [0.37, 0.336],
    [0, 0.336],
  ];
  put(g, mlathe(pedestal, 72), m.brass);
  put(g, mcylinder(T.r, 0.044, 96, 0.014), m.marble, 0, T.h - 0.044, 0);
  const top = T.h;
  const r = rng(5);
  bookStack(g, m, -0.24, top, 0.1, 0.35, [
    [0x2c4658, 0.27, 0.036, 0.34],
    [0xd9ccb4, 0.24, 0.03, 0.3],
    [0xb5653c, 0.2, 0.026, 0.25],
  ]);
  woodBowl(g, m, 0.24, top, -0.14, 0.17);
  budVase(g, m, 0.05, top, 0.36, r, 'ceramicDark');
  g.position.set(T.x, 0, T.z);
  return g;
}

function sideTable(m, t) {
  const g = new THREE.Group();
  put(g, fluted(t.r - 0.012, t.h - 0.03, 22, 0.014), m.travertine);
  put(g, mcylinder(t.r, 0.03, 48, 0.008), m.travertine, 0, t.h - 0.03, 0);
  const r = rng(Math.round(t.x * 100));
  if (t.lamp) {
    tableLamp(g, m, 0.02, t.h, -0.02, 1, 'ceramicBlue');
  } else {
    bookStack(g, m, -0.04, t.h, 0.03, 0.6, [
      [0xe6dccb, 0.2, 0.03, 0.26],
      [0x6f7f63, 0.18, 0.025, 0.23],
    ]);
    budVase(g, m, 0.1, t.h + 0.055, -0.02, r, 'terracotta');
  }
  g.position.set(t.x, 0, t.z);
  return g;
}

/** Arc floor lamp: marble base, a long brass arc, and a brass dome glowing inside. */
function arcLamp(m) {
  const A = ARC_LAMP;
  const g = new THREE.Group();
  put(g, mcylinder(0.2, 0.075, 48, 0.012), m.marble, A.baseX, 0, A.baseZ);
  const dx = A.shadeX - A.baseX;
  const dz = A.shadeZ - A.baseZ;
  const at = (k, y) => new THREE.Vector3(A.baseX + dx * k, y, A.baseZ + dz * k);
  const shadeTop = A.shadeY + 0.21;
  const curve = new THREE.CatmullRomCurve3([at(0, 0.07), at(0.02, 1.0), at(0.12, 1.85), at(0.42, A.apexY), at(0.82, A.apexY - 0.12), at(0.99, shadeTop + 0.16), at(1, shadeTop)], false, 'centripetal');
  put(g, sweepTube(curve, () => 0.011, 96, 8, true), m.brass);
  const outer = [
    [0.24, 0],
    [0.232, 0.03],
    [0.19, 0.11],
    [0.12, 0.175],
    [0.04, 0.205],
    [0.012, 0.21],
  ];
  put(g, mlathe(outer, 48), m.brass, A.shadeX, A.shadeY, A.shadeZ);
  put(g, mlathe(outer.map(([r, y]) => [r * 0.97, y - 0.004]), 48), m.shadeInner, A.shadeX, A.shadeY, A.shadeZ, { cast: false });
  put(g, new THREE.SphereGeometry(0.05, 14, 10), m.bulb, A.shadeX, A.shadeY + 0.08, A.shadeZ, { cast: false });
  return g;
}

/** Oversized woven rattan pendants on black cords with ceiling canopies. */
function pendants(m) {
  const g = new THREE.Group();
  const scaleUV = (geo, su, sv) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  };
  const ring = (R, tube, y, x, z) => {
    const t = new THREE.TorusGeometry(R, tube, 8, Math.max(24, Math.round(R * 90)));
    t.rotateX(Math.PI / 2);
    put(g, t, m.rattanSolid, x, y, z);
  };
  for (const p of PENDANTS) {
    let top;
    if (p.kind === 'globe') {
      const cap = 0.32; // polar openings (radians)
      const geo = new THREE.SphereGeometry(p.r, 40, 20, 0, Math.PI * 2, cap, Math.PI - 2 * cap);
      scaleUV(geo, Math.max(3, Math.round(p.r * 13)), Math.max(2, Math.round(p.r * 7)));
      const cy = p.y + p.r;
      put(g, geo, m.rattan, p.x, cy, p.z);
      ring(p.r * Math.sin(cap), 0.012, cy + p.r * Math.cos(cap), p.x, p.z);
      ring(p.r * Math.sin(cap), 0.012, cy - p.r * Math.cos(cap), p.x, p.z);
      ring(p.r, 0.009, cy, p.x, p.z);
      put(g, new THREE.SphereGeometry(p.r * 0.26, 20, 14), m.bulb, p.x, cy, p.z, { cast: false });
      top = cy + p.r * Math.cos(cap);
    } else {
      const h = p.r * 0.75;
      const geo = new THREE.SphereGeometry(p.r, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      geo.scale(1, 0.75, 1);
      scaleUV(geo, Math.round(p.r * 14), Math.round(p.r * 9));
      put(g, geo, m.rattan, p.x, p.y, p.z);
      ring(p.r, 0.018, p.y, p.x, p.z);
      ring(p.r * 0.72, 0.01, p.y + h * 0.69, p.x, p.z);
      put(g, new THREE.SphereGeometry(0.075, 16, 12), m.bulb, p.x, p.y + h * 0.42, p.z, { cast: false });
      top = p.y + h;
    }
    put(g, mcylinder(0.006, ROOM.height - top, 8), m.blackMetal, p.x, top, p.z, { cast: false });
    put(g, mcylinder(0.075, 0.03, 32, 0.008), m.trim, p.x, ROOM.height - 0.03, p.z, { cast: false });
  }
  return g;
}

/**
 * Low walnut cabinet with slab doors, brass pulls, a black plinth and a travertine top.
 * Built facing local +Z, then turned to face into the room from its wall.
 */
function cabinet(m, c) {
  const g = new THREE.Group();
  const onLeftWall = c.x0 <= ROOM.minX + 0.01;
  const L = c.z1 - c.z0;
  const D = c.x1 - c.x0;
  const plinth = 0.07;
  const topT = 0.03;
  const bodyH = c.h - plinth - topT;
  put(g, mbox(L - 0.08, plinth, D - 0.08), m.blackMetal, 0, plinth / 2, -0.02, { cast: false });
  put(g, mbox(L - 0.04, bodyH, D - 0.04), m.ceramicDark, 0, plinth + bodyH / 2, -0.01);
  for (const s of [-1, 1]) put(g, mbox(0.022, bodyH, D - 0.01), m.walnut, s * (L / 2 - 0.011), plinth + bodyH / 2, -0.005);
  const n = Math.max(2, Math.round((L - 0.044) / 0.62));
  const dw = (L - 0.044) / n;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.022 + dw * (i + 0.5);
    put(g, mbox(dw - 0.006, bodyH - 0.008, 0.022), m.walnut, x, plinth + bodyH / 2, D / 2 - 0.016);
    const px = x + (i % 2 === 0 ? 1 : -1) * (dw / 2 - 0.045);
    put(g, mbox(0.012, 0.15, 0.014), m.brass, px, plinth + bodyH * 0.62, D / 2 + 0.002);
  }
  put(g, mbox(L + 0.02, topT, D + 0.012), m.travertine, 0, c.h - topT / 2, 0);
  g.rotation.y = onLeftWall ? Math.PI / 2 : -Math.PI / 2;
  g.position.set((c.x0 + c.x1) / 2, 0, (c.z0 + c.z1) / 2);
  return g;
}

/** Stretched canvas in a thin oak floater frame, hung on a side wall. */
function artwork(m, a) {
  const g = new THREE.Group();
  const depth = 0.045;
  const fw = 0.022;
  const fd = 0.062;
  const gap = 0.012;
  put(g, mbox(a.w, a.h, depth), m.trim, 0, 0, depth / 2, { cast: false });
  put(g, new THREE.PlaneGeometry(a.w, a.h), m[a.tex], 0, 0, depth + 0.001, { cast: false });
  put(g, mbox(a.w + 2 * gap, a.h + 2 * gap, 0.004), m.blackMetal, 0, 0, 0.002, { cast: false });
  const ow = a.w + 2 * (gap + fw);
  for (const s of [-1, 1]) {
    put(g, mbox(ow, fw, fd), m.oakWarm, 0, s * (a.h / 2 + gap + fw / 2), fd / 2);
    put(g, mbox(fw, a.h + 2 * gap, fd), m.oakWarm, s * (a.w / 2 + gap + fw / 2), 0, fd / 2);
  }
  const left = a.wall === 'nx';
  g.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
  g.position.set(left ? ROOM.minX : ROOM.maxX, a.y, a.z);
  return g;
}

/** Styling on the credenza (left wall) and the dining sideboard (right wall). */
function cabinetStyling(m) {
  const g = new THREE.Group();
  const r = rng(77);
  // Credenza: lamp at the window end, books, a pair of vases.
  {
    const x = (CREDENZA.x0 + CREDENZA.x1) / 2;
    const y = CREDENZA.h;
    tableLamp(g, m, x, y, CREDENZA.z0 + 0.3, 1.05, 'ceramicSand');
    bookStack(g, m, x + 0.02, y, 0.25, 1.4, [
      [0xe9e1d2, 0.25, 0.035, 0.32],
      [0x33485a, 0.23, 0.028, 0.3],
    ]);
    const tall = [
      [0, 0],
      [0.06, 0],
      [0.1, 0.06],
      [0.105, 0.2],
      [0.05, 0.36],
      [0.035, 0.42],
      [0.04, 0.44],
      [0.03, 0.44],
    ];
    put(g, mlathe(tall, 36), m.ceramicDark, x - 0.03, y, CREDENZA.z1 - 0.34);
    put(g, mlathe(tall.map(([a, b]) => [a * 0.8, b * 0.62]), 36), m.ceramic, x + 0.06, y, CREDENZA.z1 - 0.56);
  }
  // Sideboard: big turned bowl, brass candlesticks, olive branches in a jug.
  {
    const x = (SIDEBOARD.x0 + SIDEBOARD.x1) / 2;
    const y = SIDEBOARD.h;
    woodBowl(g, m, x - 0.02, y, SIDEBOARD.z0 + 0.62, 0.22);
    for (const [dz, h] of [
      [0, 0.34],
      [0.13, 0.26],
    ]) {
      const cz = SIDEBOARD.z0 + 1.15 + dz;
      put(g, mlathe([[0, 0], [0.045, 0], [0.04, 0.02], [0.012, 0.05], [0.01, h - 0.03], [0.022, h - 0.02], [0.022, h], [0, h]], 24), m.brass, x, y, cz);
      put(g, mcylinder(0.011, 0.12, 12), m.ceramic, x, y + h, cz, { cast: false });
    }
    const jug = [
      [0, 0],
      [0.08, 0],
      [0.12, 0.08],
      [0.11, 0.2],
      [0.07, 0.28],
      [0.075, 0.3],
      [0.065, 0.3],
    ];
    const jz = SIDEBOARD.z1 - 0.45;
    put(g, mlathe(jug, 36), m.terracotta, x, y, jz);
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const rad = 0.1 + r() * 0.28;
      pts.push(new THREE.Vector3(x + Math.cos(a) * rad * 0.6, y + 0.45 + r() * 0.45, jz + Math.sin(a) * rad));
    }
    putAll(g, foliageCards(pts, 0.34, new THREE.Vector3(x, y + 0.6, jz), r), m.oliveLeaf);
  }
  return g;
}

/** Brass bar cart with marble shelves, bottles and glasses. */
function barCart(m) {
  const g = new THREE.Group();
  const B = BAR_CART;
  const cx = (B.x0 + B.x1) / 2;
  const cz = (B.z0 + B.z1) / 2;
  const w = B.x1 - B.x0;
  const d = B.z1 - B.z0;
  const post = 0.011;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(g, mcylinder(post, B.h - 0.06, 10), m.brass, cx + sx * (w / 2 - post), 0.06, cz + sz * (d / 2 - post));
      put(g, mcylinder(0.028, 0.02, 14), m.blackMetal, cx + sx * (w / 2 - post), 0.028, cz + sz * (d / 2 - post), { rx: Math.PI / 2 });
    }
  }
  for (const y of [0.2, 0.7]) {
    put(g, mbox(w - 0.01, 0.018, d - 0.01), m.marble, cx, y, cz);
    for (const sz of [-1, 1]) put(g, mbox(w, 0.012, 0.012), m.brass, cx, y + 0.03, cz + sz * (d / 2 - post));
  }
  // handle rail
  put(g, mcylinder(0.01, d + 0.06, 10), m.brass, cx, B.h - 0.02, cz - d / 2 - 0.03, { rx: Math.PI / 2 });
  const bottle = (x, z, h, rr, color, y0) => {
    const prof = [
      [0, 0],
      [rr, 0],
      [rr, h * 0.62],
      [rr * 0.45, h * 0.78],
      [rr * 0.32, h * 0.84],
      [rr * 0.3, h],
      [0, h],
    ];
    put(g, tint(mlathe(prof, 20), color), m.glassware, x, y0, z);
  };
  const top = 0.709;
  bottle(cx - 0.08, cz - 0.24, 0.3, 0.04, 0x8a4a1c, top);
  bottle(cx + 0.06, cz - 0.16, 0.28, 0.036, 0x2f5a3a, top);
  bottle(cx - 0.05, cz - 0.07, 0.32, 0.038, 0xd8e6e2, top);
  bottle(cx + 0.08, cz + 0.02, 0.24, 0.045, 0x9a6a2a, top);
  bottle(cx - 0.06, cz + 0.02, 0.26, 0.042, 0x2e4c6e, 0.209);
  bottle(cx + 0.07, cz - 0.1, 0.3, 0.04, 0x6b2a20, 0.209);
  const tumbler = [
    [0, 0],
    [0.034, 0],
    [0.038, 0.09],
    [0.034, 0.09],
    [0.03, 0.006],
    [0, 0.006],
  ];
  for (const [x, z] of [
    [0.06, 0.2],
    [-0.06, 0.24],
    [0.07, 0.3],
    [-0.04, 0.33],
  ]) {
    put(g, tint(mlathe(tumbler, 20), 0xeaf2f0), m.glassware, cx + x, top, cz + z, { cast: false });
  }
  put(g, mlathe([[0, 0], [0.08, 0], [0.09, 0.16], [0.095, 0.17], [0, 0.17]], 28), m.brass, cx, 0.209, cz + 0.22);
  return g;
}

/** Slim walnut console behind the sectional: travertine top, open shelf, a pair of lamps. */
function consoleTable(m) {
  const g = new THREE.Group();
  const C = CONSOLE;
  const L = C.x1 - C.x0;
  const D = C.z1 - C.z0;
  const cx = (C.x0 + C.x1) / 2;
  const cz = (C.z0 + C.z1) / 2;
  const topT = 0.04;
  put(g, mbox(L, topT, D), m.travertine, cx, C.h - topT / 2, cz);
  for (const s of [-1, 1]) put(g, mbox(0.06, C.h - topT, D - 0.04), m.walnut, cx + s * (L / 2 - 0.05), (C.h - topT) / 2, cz);
  put(g, mbox(L - 0.16, 0.03, D - 0.06), m.walnut, cx, 0.16, cz);
  const y = C.h;
  tableLamp(g, m, C.x0 + 0.28, y, cz, 1.05, 'ceramicSand');
  tableLamp(g, m, C.x1 - 0.28, y, cz, 1.05, 'ceramicSand');
  bookStack(g, m, cx - 0.35, y, cz, 0.1, [
    [0xd9ccb4, 0.26, 0.034, 0.33],
    [0x3b3733, 0.23, 0.03, 0.3],
    [0xb5653c, 0.2, 0.024, 0.26],
  ]);
  woodBowl(g, m, cx + 0.3, y, cz, 0.16);
  // baskets on the lower shelf
  for (const dx of [-0.42, 0.42]) {
    put(g, mlathe([[0, 0], [0.16, 0], [0.17, 0.2], [0.162, 0.2], [0.15, 0.012], [0, 0.012]], 32), m.rattanSolid, cx + dx, 0.175, cz);
  }
  return g;
}

/**
 * All living-room decor as one Group (the plants and the library wall come from their own modules).
 * @param {Record<string, THREE.Material>} m interior materials
 */
export function buildDecor(m) {
  const g = new THREE.Group();
  g.add(rug(m), coffeeTable(m), arcLamp(m), pendants(m), cabinetStyling(m), barCart(m));
  for (const t of SIDE_TABLES) g.add(sideTable(m, t));
  for (const c of [CREDENZA, SIDEBOARD]) g.add(cabinet(m, c));
  for (const a of ART) g.add(artwork(m, a));
  g.add(consoleTable(m), buildPlants(m), buildLibrary(m), buildPiano(m));
  return g;
}
