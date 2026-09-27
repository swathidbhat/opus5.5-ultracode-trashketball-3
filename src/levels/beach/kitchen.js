import * as THREE from 'three';
import { rng } from '../../utils/canvasTexture.js';
import { ROOM, KITCHEN, DINING, DINING_CHAIR } from './layout.js';
import { mbox, mlathe, mcylinder, sweepTube, tint, pillow, reededPanel, bookGeometries, foliageCards } from './geom.js';

// Kitchen along the right-hand wall (oak cabinetry, marble counters, plaster hood), a marble
// waterfall island with leather counter stools, and the dining table by the window.

function put(parent, geom, mat, x = 0, y = 0, z = 0, o = {}) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
  mesh.castShadow = o.cast ?? true;
  mesh.receiveShadow = o.receive ?? true;
  parent.add(mesh);
  return mesh;
}

/** Row of slab doors facing -X at x = faceX, spanning z0..z1, between y0 and y1. */
function doorRow(g, m, faceX, z0, z1, y0, y1, width = 0.6) {
  const n = Math.max(1, Math.round((z1 - z0) / width));
  const dw = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + dw * (i + 0.5);
    put(g, mbox(0.02, y1 - y0 - 0.006, dw - 0.006), m.oakWarm, faceX - 0.01, (y0 + y1) / 2, z);
    // slim brass edge pull on the top rail
    put(g, mbox(0.014, 0.012, Math.min(0.22, dw * 0.45)), m.brass, faceX - 0.027, y1 - 0.03, z, { cast: false });
  }
}

function counterRun(m) {
  const g = new THREE.Group();
  const K = KITCHEN;
  const c = K.counter;
  const toe = 0.1;
  const topT = 0.04;
  const zc = (c.z0 + c.z1) / 2;
  const len = c.z1 - c.z0;
  put(g, mbox(c.x1 - c.x0 - 0.08, toe, len), m.blackMetal, (c.x0 + c.x1) / 2 + 0.04, toe / 2, zc, { cast: false });
  put(g, mbox(c.x1 - c.x0 - 0.02, c.h - topT - toe, len), m.oakWarm, (c.x0 + c.x1) / 2 + 0.01, toe + (c.h - topT - toe) / 2, zc);
  const face = c.x0 + 0.02;
  // doors either side of the range, a bank of drawers under the cooktop
  const hz0 = K.hood.z0 + 0.05;
  const hz1 = K.hood.z1 - 0.05;
  doorRow(g, m, face, c.z0, hz0, toe, c.h - topT);
  doorRow(g, m, face, hz1, c.z1, toe, c.h - topT);
  const drawerH = (c.h - topT - toe) / 3;
  for (let k = 0; k < 3; k++) doorRow(g, m, face, hz0, hz1, toe + k * drawerH, toe + (k + 1) * drawerH, 1.2);
  // marble top with a slight overhang, and a full-height marble splash up to the hood
  put(g, mbox(c.x1 - c.x0 + 0.02, topT, len), m.marble, (c.x0 + c.x1) / 2 - 0.01, c.h - topT / 2, zc);
  put(g, mbox(0.02, K.hood.y0 - c.h, len), m.marble, ROOM.maxX - 0.01, (c.h + K.hood.y0) / 2, zc, { cast: false });
  // cooktop + brass knobs
  const hc = (K.hood.z0 + K.hood.z1) / 2;
  put(g, mbox(0.5, 0.006, 0.78), m.blackMetal, c.x0 + 0.33, c.h + 0.003, hc, { cast: false });
  for (let k = 0; k < 5; k++) {
    put(g, mcylinder(0.02, 0.025, 14), m.brass, face - 0.03, c.h - topT - 0.06, hc - 0.36 + k * 0.18, { rz: Math.PI / 2, cast: false });
  }
  // sink (dark basin inset) and a brass gooseneck tap
  const sz = c.z1 - 0.95;
  put(g, mbox(0.42, 0.004, 0.62), m.ceramicDark, c.x0 + 0.3, c.h + 0.002, sz, { cast: false });
  const tapBase = new THREE.Vector3(c.x0 + 0.58, c.h, sz);
  const tap = new THREE.CatmullRomCurve3([
    tapBase,
    tapBase.clone().add(new THREE.Vector3(0, 0.3, 0)),
    tapBase.clone().add(new THREE.Vector3(-0.08, 0.4, 0)),
    tapBase.clone().add(new THREE.Vector3(-0.2, 0.3, 0)),
  ]);
  put(g, sweepTube(tap, () => 0.012, 24, 8, true), m.brass);
  // tall pantry
  const p = K.pantry;
  put(g, mbox(p.x1 - p.x0 - 0.02, p.h, p.z1 - p.z0), m.oakWarm, (p.x0 + p.x1) / 2 + 0.01, p.h / 2, (p.z0 + p.z1) / 2);
  doorRow(g, m, p.x0 + 0.02, p.z0, p.z1, toe, p.h - 0.02, 0.62);
  return g;
}

/** Tapered plaster range hood with a chimney breast to the ceiling. */
function hood(m) {
  const g = new THREE.Group();
  const H = KITCHEN.hood;
  const d = H.x1 - H.x0;
  const w = H.z1 - H.z0;
  const band = 0.16;
  put(g, mbox(d, band, w), m.plaster, (H.x0 + H.x1) / 2, H.y0 + band / 2, (H.z0 + H.z1) / 2);
  const h = H.y1 - H.y0 - band;
  const geo = new THREE.BoxGeometry(d, h, w);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, d / 2 - (d / 2 - pos.getX(i)) * 0.55); // pull the front back toward the wall
      pos.setZ(i, pos.getZ(i) * 0.74);
    }
  }
  geo.computeVertexNormals();
  put(g, geo, m.plaster, (H.x0 + H.x1) / 2, H.y0 + band + h / 2, (H.z0 + H.z1) / 2);
  const cd = d * 0.55;
  put(g, mbox(cd, ROOM.height - H.y1, w * 0.74), m.plaster, ROOM.maxX - cd / 2, (H.y1 + ROOM.height) / 2, (H.z0 + H.z1) / 2);
  return g;
}

/** Floating oak shelves either side of the hood, styled with plates, bowls and jars. */
function openShelves(m) {
  const g = new THREE.Group();
  const K = KITCHEN;
  const r = rng(19);
  const depth = 0.26;
  const x = ROOM.maxX - depth / 2;
  const runs = [
    [K.counter.z0 + 0.12, K.hood.z0 - 0.12],
    [K.hood.z1 + 0.12, K.counter.z1 - 0.1],
  ];
  // A stack of n plates as one lathe: a rim ridge per plate.
  const plateStack = (n) => {
    const prof = [
      [0, 0],
      [0.1, 0],
    ];
    for (let k = 0; k < n; k++) prof.push([0.13, k * 0.02 + 0.016], [0.122, k * 0.02 + 0.02]);
    prof.push([0.09, n * 0.02 - 0.012], [0, n * 0.02 - 0.012]);
    return mlathe(prof, 24);
  };
  const bowl = mlathe([[0, 0], [0.04, 0], [0.08, 0.05], [0.085, 0.07], [0.078, 0.07], [0.035, 0.012], [0, 0.012]], 18);
  const jar = mlathe([[0, 0], [0.05, 0], [0.05, 0.16], [0.035, 0.18], [0.035, 0.2], [0, 0.2]], 14);
  for (const [z0, z1] of runs) {
    for (const y of [1.95, 2.42]) {
      put(g, mbox(depth, 0.04, z1 - z0), m.oakWarm, x, y, (z0 + z1) / 2);
      let z = z0 + 0.08;
      while (z < z1 - 0.15) {
        const k = r();
        if (k < 0.35) {
          const n = 3 + Math.floor(r() * 5);
          put(g, plateStack(n), r() < 0.8 ? m.ceramic : m.ceramicSand, x - 0.01, y + 0.02, z + 0.13, { cast: false });
          z += 0.3;
        } else if (k < 0.6) {
          put(g, bowl.clone(), r() < 0.5 ? m.ceramicSand : m.ceramicBlue, x - 0.02, y + 0.02, z + 0.09, { cast: false });
          put(g, bowl.clone(), m.ceramic, x - 0.02, y + 0.09, z + 0.09, { cast: false });
          z += 0.22;
        } else if (k < 0.85) {
          for (let i = 0; i < 2; i++) put(g, tint(jar.clone(), 0xe9efe9), m.glassware, x - 0.02, y + 0.02, z + 0.06 + i * 0.11, { cast: false });
          z += 0.28;
        } else {
          z += 0.15;
        }
      }
    }
  }
  bowl.dispose();
  jar.dispose();
  return g;
}

/** Marble waterfall island: reeded oak front toward the stools, slab doors on the kitchen side. */
function island(m) {
  const g = new THREE.Group();
  const I = KITCHEN.island;
  const over = 0.3; // counter overhang on the stool side
  const topT = 0.05;
  const endT = 0.05;
  const len = I.z1 - I.z0;
  const zc = (I.z0 + I.z1) / 2;
  const bodyX0 = I.x0 + 0.04;
  put(g, mbox(I.x1 - bodyX0, I.h - topT, len - 2 * endT), m.oakWarm, (bodyX0 + I.x1) / 2, (I.h - topT) / 2, zc);
  const reeds = reededPanel(len - 2 * endT, I.h - topT - 0.02, Math.round((len - 2 * endT) / 0.034), 0.009);
  put(g, reeds, m.oakWarm, bodyX0, 0.01, zc, { ry: -Math.PI / 2 });
  doorRow(g, m, I.x1 + 0.02, I.z0 + endT, I.z1 - endT, 0.08, I.h - topT - 0.01, 0.6);
  put(g, mbox(I.x1 - I.x0 + over, topT, len), m.marble, (I.x0 - over + I.x1) / 2, I.h - topT / 2, zc);
  for (const z of [I.z0 + endT / 2, I.z1 - endT / 2]) {
    put(g, mbox(I.x1 - I.x0 + over, I.h - topT, endT), m.marble, (I.x0 - over + I.x1) / 2, (I.h - topT) / 2, z);
  }
  // styling: a bowl of lemons, cookbooks, olive branches in a stoneware jug
  const r = rng(29);
  const top = I.h;
  const bx = (I.x0 + I.x1) / 2;
  const bowl = mlathe([[0, 0], [0.09, 0], [0.2, 0.07], [0.22, 0.1], [0.205, 0.1], [0.08, 0.02], [0, 0.02]], 40);
  put(g, bowl, m.walnut, bx, top, I.z0 + 0.75);
  const lemons = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r();
    const rad = i === 0 ? 0 : 0.08 + r() * 0.04;
    const s = new THREE.SphereGeometry(0.038, 12, 9);
    s.scale(1, 0.82, 0.82);
    s.rotateY(r() * 3);
    s.translate(bx + Math.cos(a) * rad, top + 0.06 + (i === 0 ? 0.05 : 0), I.z0 + 0.75 + Math.sin(a) * rad);
    lemons.push(tint(s, 0xe8c547));
  }
  for (const l of lemons) put(g, l, m.colored);
  for (const bg of bookGeometries(0.22, 0.03, 0.28, 0x2c4658)) {
    bg.rotateY(0.3);
    bg.translate(bx + 0.1, top, I.z1 - 0.7);
    put(g, bg, m.colored);
  }
  const jug = mlathe([[0, 0], [0.07, 0], [0.1, 0.07], [0.095, 0.18], [0.06, 0.25], [0.065, 0.27], [0.055, 0.27]], 32);
  const jz = zc + 0.25;
  put(g, jug, m.ceramicSand, bx, top, jz);
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2;
    const rad = 0.08 + r() * 0.2;
    pts.push(new THREE.Vector3(bx + Math.cos(a) * rad, top + 0.4 + r() * 0.35, jz + Math.sin(a) * rad));
  }
  for (const q of foliageCards(pts, 0.3, new THREE.Vector3(bx, top + 0.5, jz), r)) put(g, q, m.oliveLeaf);
  return g;
}

/** Backless counter stool: cognac leather seat, splayed brass legs, a footrest ring. */
function stool(m, s) {
  const g = new THREE.Group();
  const seatY = s.h - 0.07;
  put(g, pillow(0.4, 0.07, 0.4, { p: 0.6, crown: 0.2 }), m.leather, 0, seatY + 0.035, 0);
  put(g, mcylinder(0.17, 0.02, 28), m.blackMetal, 0, seatY - 0.02, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * 0.13, seatY - 0.02, Math.sin(a) * 0.13);
    const foot = new THREE.Vector3(Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19);
    put(g, sweepTube(new THREE.LineCurve3(foot, top), () => 0.011, 1, 8, true), m.brass);
  }
  const ring = new THREE.TorusGeometry(0.165, 0.009, 8, 40);
  ring.rotateX(Math.PI / 2);
  put(g, ring, m.brass, 0, 0.26, 0);
  g.position.set(s.x, 0, s.z);
  return g;
}

/** Oak dining chair with a cane back and a linen seat pad. Local frame: faces -Z. */
function diningChair(m, c, jitter) {
  const g = new THREE.Group();
  const C = DINING_CHAIR;
  const hw = C.w / 2 - 0.03;
  const hd = C.d / 2 - 0.03;
  const seatFrameY = C.seatH - 0.08;
  for (const sx of [-1, 1]) {
    put(g, mbox(0.036, seatFrameY, 0.036), m.oakWarm, sx * hw, seatFrameY / 2, -hd);
    // rear legs continue up into the back posts, raked slightly
    const post = mbox(0.036, C.backH, 0.036);
    post.translate(0, C.backH / 2, 0);
    put(g, post, m.oakWarm, sx * hw, 0, hd, { rx: 0.08 });
  }
  put(g, mbox(C.w - 0.03, 0.04, C.d - 0.04), m.oakWarm, 0, seatFrameY + 0.02, -0.01);
  put(g, pillow(C.w - 0.06, 0.06, C.d - 0.1, { p: 0.35, crown: 0.25 }), m.linen, 0, seatFrameY + 0.07, -0.03);
  // cane panel and curved top rail between the posts (following their rake)
  const back = new THREE.Group();
  const cane = new THREE.PlaneGeometry(2 * hw - 0.036, 0.24);
  const uv = cane.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3.2, uv.getY(i) * 1.8);
  put(back, cane, m.rattan, 0, 0.66, 0);
  const rail = new THREE.CatmullRomCurve3([new THREE.Vector3(-hw, 0, 0), new THREE.Vector3(0, 0, 0.03), new THREE.Vector3(hw, 0, 0)]);
  put(back, sweepTube(rail, () => 0.022, 16, 8, true), m.oakWarm, 0, C.backH - 0.03, 0);
  put(back, sweepTube(rail, () => 0.014, 16, 6, true), m.oakWarm, 0, 0.53, 0);
  back.position.z = hd;
  back.rotation.x = 0.08;
  g.add(back);
  g.rotation.y = c.yaw + jitter.yaw;
  g.position.set(c.x + jitter.x, 0, c.z + jitter.z);
  return g;
}

function diningSet(m) {
  const g = new THREE.Group();
  const T = DINING.table;
  const topT = 0.05;
  // Top built long along x (grain along the length), then turned to run along z.
  const top = mbox(T.d, topT, T.w);
  top.rotateY(Math.PI / 2);
  put(g, top, m.oakWarm, T.x, T.h - topT / 2, T.z);
  for (const s of [-1, 1]) {
    const lz = T.z + s * (T.d / 2 - 0.42);
    put(g, mbox(T.w - 0.26, T.h - topT - 0.05, 0.07), m.oakWarm, T.x, (T.h - topT - 0.05) / 2 + 0.05, lz);
    put(g, mbox(T.w - 0.1, 0.05, 0.1), m.oakWarm, T.x, 0.025, lz);
    put(g, mbox(T.w - 0.2, 0.05, 0.09), m.oakWarm, T.x, T.h - topT - 0.025, lz);
  }
  put(g, mbox(0.07, 0.08, T.d - 0.9), m.oakWarm, T.x, 0.32, T.z);
  const r = rng(41);
  for (const c of DINING.chairs) {
    g.add(diningChair(m, c, { yaw: (r() - 0.5) * 0.12, x: (r() - 0.5) * 0.04, z: (r() - 0.5) * 0.04 }));
  }
  // centrepiece: stoneware bowl, a pair of brass candlesticks
  const y = T.h;
  put(g, mlathe([[0, 0], [0.08, 0], [0.18, 0.06], [0.2, 0.09], [0.185, 0.09], [0.07, 0.02], [0, 0.02]], 40), m.ceramicSand, T.x, y, T.z + 0.2);
  for (const [dz, h] of [
    [-0.3, 0.3],
    [-0.44, 0.24],
  ]) {
    put(g, mlathe([[0, 0], [0.04, 0], [0.036, 0.02], [0.01, 0.05], [0.009, h - 0.03], [0.02, h - 0.02], [0.02, h], [0, h]], 20), m.brass, T.x + 0.05, y, T.z + dz);
    put(g, mcylinder(0.01, 0.16, 10), m.ceramic, T.x + 0.05, y + h, T.z + dz, { cast: false });
  }
  return g;
}

/**
 * Kitchen, island, stools and the dining set as one Group of plain meshes.
 * @param {Record<string, THREE.Material>} m interior materials
 */
export function buildKitchenAndDining(m) {
  const g = new THREE.Group();
  g.add(counterRun(m), hood(m), openShelves(m), island(m), diningSet(m));
  for (const s of KITCHEN.stools) g.add(stool(m, s));
  return g;
}
