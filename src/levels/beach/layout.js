import * as THREE from 'three';
import { deg } from '../../config.js';

// Floor plan of the beach house great room. Pure data + pure functions (no DOM), so the
// geometry builders and offline validation scripts share the same numbers.
// Units: meters. +Y up. The glass wall with the ocean view is at -Z; the player mostly faces it.

export const ROOM = {
  minX: -7.2,
  maxX: 7.2,
  minZ: -5.0,
  maxZ: 6.8,
  height: 6.6,
};

// Floor-to-ceiling glass wall (z = ROOM.minZ): five bays in slim black steel.
export const GLASS = {
  z: ROOM.minZ,
  mullionXs: [-7.2, -4.32, -1.44, 1.44, 4.32, 7.2],
  transomYs: [2.95, 4.8],
  mullionWidth: 0.055,
  mullionDepth: 0.14,
  // Sliding door in the right-hand bay, below the first transom, pushed most of the way open.
  slider: { fixedX0: 4.32, fixedX1: 5.76, openX0: 5.0, openX1: 6.46, trackZ: ROOM.minZ + 0.075 },
};

// Woven seagrass basket (BinDef numbers, see docs/ARCHITECTURE.md). ~1.3 m in front of the centre bay.
export const BIN = {
  x: 0,
  z: -3.7,
  height: 0.46,
  radiusTop: 0.19,
  radiusBottom: 0.15,
  wallThickness: 0.02,
  floorThickness: 0.02,
  rimTube: 0.014,
};

// Golden-hour sun over the ocean, a little left of the view axis (azimuth measured from -Z toward -X).
export const SUN = { elevation: deg(4), azimuth: deg(27) };
export const SUN_DIR = new THREE.Vector3(
  -Math.sin(SUN.azimuth) * Math.cos(SUN.elevation),
  Math.sin(SUN.elevation),
  -Math.cos(SUN.azimuth) * Math.cos(SUN.elevation),
).normalize();

// ---------------------------------------------------------------------------------------------
// Furniture placement. Yaw 0 means the piece faces -Z (toward the glass); positive yaw turns it left.

export const RUG = { x: 0.1, z: -1.1, w: 5.2, d: 4.2, h: 0.014 };
export const COFFEE_TABLE = { x: 0.05, z: -1.25, r: 0.68, h: 0.38 };

// Curved bouclé sofa: an arc around (cx, cz) opening toward +X, facing the sectional.
export const ARC_SOFA = {
  cx: 0.3,
  cz: -1.3,
  r1: 1.9, // seat front
  r2: 2.9, // outside of the back
  halfAngle: deg(38),
  seatH: 0.44,
  backH: 0.78,
  backDepth: 0.3,
};

// L-shaped sectional: a run along Z facing -X, a corner, and a return along X facing -Z.
export const SECTIONAL = {
  runX0: 1.65,
  runX1: 2.75,
  runZ0: -2.7,
  cornerZ0: 0.5,
  cornerZ1: 1.6,
  returnX0: 0.15,
  seatH: 0.44,
  backH: 0.76,
  backDepth: 0.25,
  armH: 0.58,
  armW: 0.24,
};

export const LOUNGE_CHAIRS = [
  { x: -4.0, z: -3.55, yaw: deg(14) },
  { x: -5.55, z: -3.3, yaw: deg(-12) },
  // reading pair in front of the library wall, turned toward each other
  { x: -2.75, z: 5.25, yaw: deg(-24) },
  { x: -1.05, z: 5.25, yaw: deg(24) },
];
export const LOUNGE_CHAIR = { w: 0.82, d: 0.9, seatH: 0.4, backH: 0.8 };
export const SIDE_TABLES = [
  { x: -4.8, z: -3.95, r: 0.24, h: 0.5, lamp: false }, // between the lounge chairs
  { x: 2.3, z: -3.12, r: 0.24, h: 0.52, lamp: true }, // window end of the sectional
  { x: -1.9, z: 5.62, r: 0.22, h: 0.5, lamp: true }, // between the reading chairs
];

export const OLIVE = { x: -6.45, z: -4.3, potR: 0.42, potH: 0.62 };
export const FIG = { x: 3.75, z: -4.3, potR: 0.33, potH: 0.56 };
export const PAMPAS = { x: 6.9, z: -0.32, r: 0.19, h: 0.74 }; // floor vase at the end of the sideboard
export const ARC_LAMP = { baseX: -6.5, baseZ: -2.75, shadeX: -5.45, shadeZ: -3.35, shadeY: 1.72, apexY: 2.25 };

// Low walnut cabinets against the side walls, each with a big canvas above.
export const CREDENZA = { x0: -7.2, x1: -6.74, z0: -1.55, z1: 1.15, h: 0.7 };
export const SIDEBOARD = { x0: 6.74, x1: 7.2, z0: -3.45, z1: -0.8, h: 0.7 };
export const ART = [
  { wall: 'nx', z: -0.2, y: 1.95, w: 2.3, h: 1.55, tex: 'artCoastal' },
  { wall: 'px', z: -2.12, y: 1.95, w: 2.2, h: 1.5, tex: 'artTide' },
  { wall: 'px', z: 0.72, y: 1.78, w: 0.86, h: 1.1, tex: 'artArches' },
];
export const BAR_CART = { x0: 6.74, x1: 7.16, z0: 0.28, z1: 1.12, h: 0.86 };
// Slim console behind the sectional's return.
export const CONSOLE = { x0: 0.45, x1: 2.55, z0: 1.72, z1: 2.1, h: 0.78 };
// Baby grand in the library corner. (x, z) is the middle of the case's keyboard edge; the tail
// points along local -Z, the keyboard and bench along +Z. Yaw turns it like everything else.
export const PIANO = { x: -4.5, z: 3.6, yaw: deg(38), length: 1.72, width: 1.48, caseTop: 0.99 };

export const KITCHEN = {
  counter: { x0: 6.55, x1: 7.2, z0: 1.3, z1: 5.55, h: 0.92 },
  pantry: { x0: 6.55, x1: 7.2, z0: 5.55, z1: 6.8, h: 2.55 },
  hood: { x0: 6.62, x1: 7.2, z0: 2.95, z1: 4.05, y0: 1.62, y1: 2.9 },
  island: { x0: 4.45, x1: 5.5, z0: 1.9, z1: 4.9, h: 0.93 },
  stools: [2.55, 3.4, 4.25].map((z) => ({ x: 4.02, z, r: 0.2, h: 0.68 })),
};

// Dining by the window: a long oak table perpendicular to the glass, six chairs.
export const DINING = {
  table: { x: 4.75, z: -2.1, w: 1.0, d: 2.4, h: 0.75 },
  chairs: [-2.9, -2.1, -1.3].flatMap((z) => [
    { x: 4.75 - 0.8, z, yaw: -Math.PI / 2 },
    { x: 4.75 + 0.8, z, yaw: Math.PI / 2 },
  ]),
};
// Chair local frame: faces -Z (toward the table), back at +Z.
export const DINING_CHAIR = { w: 0.5, d: 0.54, seatH: 0.47, backH: 0.84 };

// Double-height library wall at the back, with a rolling ladder.
export const SHELVES = { x0: -7.05, x1: -0.7, z0: 6.42, z1: 6.8, h: 6.1 };

// Ceiling beams run along Z.
export const BEAMS = { xs: [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4], w: 0.2, depth: 0.34 };

// Oversized rattan pendants. y = bottom of the shade. Order matters (see lighting.js).
export const PENDANTS = [
  { x: -4.75, z: -3.55, r: 0.55, y: 2.45, kind: 'globe' }, // over the lounge chairs
  { x: 4.98, z: 2.6, r: 0.3, y: 1.85, kind: 'globe' }, // island trio
  { x: 4.98, z: 3.4, r: 0.3, y: 1.85, kind: 'globe' },
  { x: 4.98, z: 4.2, r: 0.3, y: 1.85, kind: 'globe' },
  { x: 4.75, z: -2.1, r: 0.62, y: 1.6, kind: 'dome' }, // over the dining table
];

// ---------------------------------------------------------------------------------------------
// Outdoors. Deck + infinity pool, then the dune drops to the beach and the sea.

export const DECK = { z0: ROOM.minZ, z1: -10.4, x0: -18, x1: 18 };
export const POOL = { x0: -6.4, x1: 3.4, z0: -7.1, z1: -10.4, water: -0.07, depth: 1.3 };
export const SEA_LEVEL = -2.45;

/** Height of the outdoor ground (dune, beach, sea floor). Mirrored in the ocean shader (GLSL). */
export function terrainHeight(x, z) {
  const s = -z; // meters seaward of the house (the glass is at s = 5)
  const wig = shoreWiggle(x);
  if (s < 11) return -0.55;
  if (s < 22) {
    const t = (s - 11) / 11;
    const e = t * t * (3 - 2 * t);
    const bumps = 0.35 * Math.sin(x * 0.21 + 0.7) * Math.sin(z * 0.17 + 1.1) + 0.2 * Math.sin(x * 0.53 - z * 0.31);
    return -0.55 + (-1.45 + wig) * e + bumps * Math.sin(Math.PI * t);
  }
  if (s < 42) return -2.0 - (s - 22) * 0.03 + wig;
  return Math.max(-2.6 - (s - 42) * 0.08 + wig, -9);
}

export function shoreWiggle(x) {
  return 0.08 * Math.sin(x * 0.031) + 0.05 * Math.sin(x * 0.073 + 1.3);
}

// ---------------------------------------------------------------------------------------------
// Shot spots, easy -> hard (horizontal distance to the bin in the label comments).

export const SHOT_SPOTS = [
  { eye: [2.15, 1.15, -1.25], label: 'Sectional · window end' }, // 3.3 m
  { eye: [-1.93, 1.15, -0.74], label: 'Curved bouclé sofa' }, // 3.5 m
  { eye: [-3.98, 1.12, -3.42], label: 'Cognac lounge chair' }, // 4.0 m
  { eye: [0.95, 1.15, 0.95], label: 'Sectional · sofa return' }, // 4.7 m
  { eye: [-3.35, 1.6, 0.55], label: 'Behind the bouclé sofa' }, // 5.4 m
  { eye: [4.1, 1.6, 0.95], label: 'Kitchen island' }, // 6.2 m
];

// ---------------------------------------------------------------------------------------------
// Colliders (coarse approximations of the visuals; see docs/ARCHITECTURE.md).

/** Axis-aligned bounds of a w x d rectangle centred at (x, z), rotated by yaw. */
export function rotatedRectBounds(x, z, w, d, yaw, dx = 0, dz = 0) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [lx, lz] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ]) {
    const px = lx + dx;
    const pz = lz + dz;
    // rotation about +Y by yaw: x' = x cos + z sin, z' = -x sin + z cos
    const wx = x + px * c + pz * s;
    const wz = z - px * s + pz * c;
    x0 = Math.min(x0, wx);
    x1 = Math.max(x1, wx);
    z0 = Math.min(z0, wz);
    z1 = Math.max(z1, wz);
  }
  return { x0, x1, z0, z1 };
}

function box(x0, y0, z0, x1, y1, z1, material) {
  return { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), material };
}

/** Point on the arc sofa at radius r and angle t (t = 0 points to -X from the arc centre). */
export function arcPoint(r, t) {
  return [ARC_SOFA.cx - r * Math.cos(t), ARC_SOFA.cz + r * Math.sin(t)];
}

export function buildColliders() {
  const boxes = [];
  const cylinders = [];

  // Curved sofa: six segments, each a seat box and a back box.
  const a = ARC_SOFA;
  const segs = 6;
  // The rounded ends bulge ~0.24 m past the end angles.
  const half = a.halfAngle + 0.24 / ((a.r1 + a.r2) / 2);
  for (let i = 0; i < segs; i++) {
    const t0 = -half + (2 * half * i) / segs;
    const t1 = -half + (2 * half * (i + 1)) / segs;
    const bounds = (r0, r1) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const r of [r0, r1]) {
        for (const t of [t0, (t0 + t1) / 2, t1]) {
          const [x, z] = arcPoint(r, t);
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
      }
      return { x0, x1, z0, z1 };
    };
    const s = bounds(a.r1, a.r2 - a.backDepth);
    boxes.push(box(s.x0, 0, s.z0, s.x1, a.seatH, s.z1, 'soft'));
    const b = bounds(a.r2 - a.backDepth, a.r2);
    boxes.push(box(b.x0, 0, b.z0, b.x1, a.backH, b.z1, 'soft'));
  }

  // Sectional.
  const S = SECTIONAL;
  boxes.push(box(S.runX0, 0, S.runZ0 + S.armW, S.runX1, S.seatH, S.cornerZ0, 'soft')); // run seat
  boxes.push(box(S.runX0, 0, S.runZ0, S.runX1, S.armH, S.runZ0 + S.armW, 'soft')); // run arm
  boxes.push(box(S.runX1 - S.backDepth, 0, S.runZ0 + S.armW, S.runX1, S.backH, S.cornerZ1, 'soft')); // run back
  boxes.push(box(S.returnX0 + S.armW, 0, S.cornerZ0, S.runX1, S.seatH, S.cornerZ1, 'soft')); // return seat
  boxes.push(box(S.returnX0, 0, S.cornerZ1 - S.backDepth, S.runX1, S.backH, S.cornerZ1, 'soft')); // return back
  boxes.push(box(S.returnX0, 0, S.cornerZ0, S.returnX0 + S.armW, S.armH, S.cornerZ1, 'soft')); // return arm

  // Lounge chairs: seat block and back.
  const C = LOUNGE_CHAIR;
  for (const ch of LOUNGE_CHAIRS) {
    const seat = rotatedRectBounds(ch.x, ch.z, C.w, C.d * 0.72, ch.yaw, 0, -C.d * 0.14);
    boxes.push(box(seat.x0, 0, seat.z0, seat.x1, C.seatH + 0.06, seat.z1, 'soft'));
    const back = rotatedRectBounds(ch.x, ch.z, C.w, C.d * 0.3, ch.yaw, 0, C.d * 0.35);
    boxes.push(box(back.x0, 0, back.z0, back.x1, C.backH, back.z1, 'soft'));
  }

  // Rug: a thin carpet slab so balls thud instead of skid on it.
  const rg = RUG;
  boxes.push(box(rg.x - rg.w / 2, 0, rg.z - rg.d / 2, rg.x + rg.w / 2, rg.h, rg.z + rg.d / 2, 'carpet'));

  // Tables and planters.
  const T = COFFEE_TABLE;
  cylinders.push({ x: T.x, z: T.z, radius: T.r, yMin: 0, yMax: T.h, material: 'furniture' });
  for (const t of SIDE_TABLES) {
    cylinders.push({ x: t.x, z: t.z, radius: t.r, yMin: 0, yMax: t.h, material: 'furniture' });
    if (t.lamp) cylinders.push({ x: t.x + 0.02, z: t.z - 0.02, radius: 0.2, yMin: t.h, yMax: t.h + 0.62, material: 'soft' });
  }
  cylinders.push({ x: OLIVE.x, z: OLIVE.z, radius: OLIVE.potR, yMin: 0, yMax: OLIVE.potH, material: 'furniture' });
  cylinders.push({ x: OLIVE.x + 0.1, z: OLIVE.z + 0.05, radius: 0.85, yMin: 1.55, yMax: 3.0, material: 'soft' });
  cylinders.push({ x: FIG.x, z: FIG.z, radius: FIG.potR, yMin: 0, yMax: FIG.potH, material: 'furniture' });
  cylinders.push({ x: FIG.x, z: FIG.z, radius: 0.55, yMin: 1.0, yMax: 2.45, material: 'soft' });
  cylinders.push({ x: PAMPAS.x, z: PAMPAS.z, radius: PAMPAS.r, yMin: 0, yMax: PAMPAS.h, material: 'furniture' });

  // Wall furniture and the console.
  for (const c of [CREDENZA, SIDEBOARD, BAR_CART, CONSOLE]) boxes.push(box(c.x0, 0, c.z0, c.x1, c.h, c.z1, 'furniture'));

  // Piano: the case (legs included) and the bench. The propped lid is left out.
  const pc = rotatedRectBounds(PIANO.x, PIANO.z, PIANO.width, PIANO.length + 0.3, PIANO.yaw, 0, -PIANO.length / 2 + 0.15);
  boxes.push(box(pc.x0, 0, pc.z0, pc.x1, PIANO.caseTop, pc.z1, 'furniture'));
  const pb = rotatedRectBounds(PIANO.x, PIANO.z, 0.8, 0.36, PIANO.yaw, 0, 0.78);
  boxes.push(box(pb.x0, 0, pb.z0, pb.x1, 0.52, pb.z1, 'soft'));

  // Kitchen.
  const K = KITCHEN;
  for (const k of [K.counter, K.pantry, K.island]) boxes.push(box(k.x0, 0, k.z0, k.x1, k.h, k.z1, 'furniture'));
  boxes.push(box(K.hood.x0, K.hood.y0, K.hood.z0, K.hood.x1, K.hood.y1, K.hood.z1, 'wall'));
  // Island counter overhang on the stool side and its marble waterfall ends.
  const I = K.island;
  boxes.push(box(I.x0 - 0.3, I.h - 0.05, I.z0, I.x0, I.h, I.z1, 'furniture'));
  boxes.push(box(I.x0 - 0.3, 0, I.z0, I.x0, I.h, I.z0 + 0.05, 'furniture'));
  boxes.push(box(I.x0 - 0.3, 0, I.z1 - 0.05, I.x0, I.h, I.z1, 'furniture'));
  for (const s of K.stools) cylinders.push({ x: s.x, z: s.z, radius: s.r, yMin: 0, yMax: s.h, material: 'furniture' });

  // Dining: the table top, and each chair's seat and back.
  const D = DINING.table;
  boxes.push(box(D.x - D.w / 2, D.h - 0.05, D.z - D.d / 2, D.x + D.w / 2, D.h, D.z + D.d / 2, 'furniture'));
  for (const c of DINING.chairs) {
    const seat = rotatedRectBounds(c.x, c.z, DINING_CHAIR.w, DINING_CHAIR.d - 0.06, c.yaw, 0, -0.03);
    boxes.push(box(seat.x0, 0, seat.z0, seat.x1, DINING_CHAIR.seatH, seat.z1, 'soft'));
    const back = rotatedRectBounds(c.x, c.z, DINING_CHAIR.w, 0.08, c.yaw, 0, DINING_CHAIR.d / 2 - 0.04);
    boxes.push(box(back.x0, 0, back.z0, back.x1, DINING_CHAIR.backH, back.z1, 'furniture'));
  }

  // Library wall.
  const sh = SHELVES;
  boxes.push(box(sh.x0, 0, sh.z0, sh.x1, sh.h, sh.z1, 'furniture'));

  // Ceiling beams.
  for (const x of BEAMS.xs) {
    boxes.push(box(x - BEAMS.w / 2, ROOM.height - BEAMS.depth, ROOM.minZ, x + BEAMS.w / 2, ROOM.height, ROOM.maxZ, 'furniture'));
  }

  // Pendants: an upright cylinder inscribed in each shade.
  for (const p of PENDANTS) {
    const h = p.kind === 'dome' ? p.r * 0.75 : p.r * 1.7;
    cylinders.push({ x: p.x, z: p.z, radius: p.r * 0.85, yMin: p.y + (p.kind === 'dome' ? 0 : p.r * 0.15), yMax: p.y + h, material: 'soft' });
  }

  return {
    room: {
      min: new THREE.Vector3(ROOM.minX, 0, ROOM.minZ),
      max: new THREE.Vector3(ROOM.maxX, ROOM.height, ROOM.maxZ),
      materials: { floor: 'floor', ceiling: 'wall', px: 'wall', nx: 'wall', pz: 'wall', nz: 'glass' },
    },
    boxes,
    cylinders,
  };
}
