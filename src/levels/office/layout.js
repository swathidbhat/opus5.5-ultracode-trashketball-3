import * as THREE from 'three';

// Floor plan of Lumon's Macrodata Refinement room. Pure data (no DOM) so the geometry builders and
// offline validation scripts share the same numbers.
// Units: meters. +Y up. -Z is "north": the wall with the door, the founder portrait and the wastebasket.
//
//            north wall:  plant · poster · portrait/bin · door → corridor · plaque
//   west wall:            +------------------------------------------+
//   LUMON +               |   bin                                    |
//   cabinet               |          [Helly][Mark ]                  |
//                         |          [Dylan][Irving]                 |
//                         +------------------------------------------+

export const ROOM = {
  minX: -5.4,
  maxX: 5.4,
  // Grid-aligned with the 60 cm ceiling tiles: both walls sit on tile seams.
  minZ: -3.6,
  maxZ: 4.2,
  // 3.4 m keeps lobs under the ceiling from every spot (with the office's 55° launch cap). A lower
  // ceiling turns steep throws into ceiling banks that drop in at almost any power.
  height: 3.4,
  wallThickness: 0.15,
};

// Doorway in the north wall, leading to the long white corridor.
export const DOOR = { x0: -1.2, x1: -0.2, height: 2.15 };

export const CORRIDOR = {
  x0: -1.6,
  x1: 0.2,
  zStart: ROOM.minZ - ROOM.wallThickness,
  zEnd: -12.6,
  height: 2.45,
  // The hall turns left at the far end, so it reads as "long" rather than a dead end.
  crossX0: -4.8,
  crossDepth: 1.8,
};

// The MDR island: a 2.5 m square split into four desks by a plus-shaped partition.
export const DESK = {
  half: 1.25,
  top: 0.74, // top surface height
  topThickness: 0.036,
  partitionTop: 1.24,
  partitionThickness: 0.05,
  chairOffset: 0.55, // seat centre distance from the desk's outer edge
};

// Each desk has a local frame: origin at the midpoint of its outer edge, the worker faces local -Z,
// the front partition is at local z = -DESK.half, the side partition at local x = -DESK.half / 2.
// The four desks form a pinwheel, each at the right-hand end of its partition arm.
export const DESKS = [
  { name: 'MARK S.', origin: [DESK.half, -DESK.half / 2], yaw: Math.PI / 2, file: 'Cold Harbor', pct: 97, seed: 11 },
  { name: 'HELLY R.', origin: [-DESK.half / 2, -DESK.half], yaw: Math.PI, file: 'Siena', pct: 23, seed: 23 },
  { name: 'IRVING B.', origin: [DESK.half / 2, DESK.half], yaw: 0, file: 'Tumwater', pct: 61, seed: 37 },
  { name: 'DYLAN G.', origin: [-DESK.half, DESK.half / 2], yaw: -Math.PI / 2, file: 'Allentown', pct: 88, seed: 41 },
];

// Wire-mesh wastebasket (BinDef numbers, see docs/ARCHITECTURE.md). North-west of the pod, under the founder's
// portrait and 65 cm off the wall: close enough to read as "by the wall", far enough that lobbing
// balls off the wall above it is not a free basket.
export const BIN = {
  x: -2.15,
  z: -2.95,
  height: 0.36,
  radiusTop: 0.165,
  radiusBottom: 0.13,
  wallThickness: 0.008,
  floorThickness: 0.012,
  rimTube: 0.006,
};

// Lateral filing cabinet against the west wall (local front faces +Z; yaw turns it to face +X).
export const CABINET = { x: ROOM.minX + 0.25, z: -2.05, yaw: Math.PI / 2, width: 0.92, depth: 0.5, height: 1.02 };
export const PLANT = { x: ROOM.minX + 0.45, z: ROOM.minZ + 0.45, potRadius: 0.21, potHeight: 0.46, foliageRadius: 0.26, foliageTop: 1.3 };

const SEATED_EYE = 1.17;
const STANDING_EYE = 1.6;

// Shot spots in the order the camera glides through them (a loop). Every spot has a similar make
// window, so the level opens on the most recognisable view: Mark's desk, his terminal in frame on
// the left. Consecutive spots never glide through the pod at seated height: the only pass over it
// is standing -> standing. Seated spots sit in that desk's chair, swivelled to face the bin.
export const SPOT_DEFS = [
  { label: "Mark S.'s desk", desk: 0 },
  { label: 'Beside the door', eye: [0.45, STANDING_EYE, -2.6] },
  { label: 'By the filing cabinet', eye: [-4.5, STANDING_EYE, -1.3] },
  { label: "Dylan G.'s desk", desk: 3 },
  { label: 'The west aisle', eye: [-3.6, STANDING_EYE, 1.5] },
  { label: 'Across the pod', eye: [2.45, STANDING_EYE, -1.95] },
];

// Idle chairs: [desk-local x, desk-local z of the seat centre, extra yaw]. Helly's is tucked under
// her desk so it stays out of the Mark -> bin sight line.
const IDLE_CHAIRS = { 1: [0.02, 0.08, 0.05], 2: [0.07, 0.62, 0.22] };

/** Local (x, z) in a desk frame -> world (x, z). */
export function deskToWorld(desk, lx, lz) {
  const c = Math.cos(desk.yaw);
  const s = Math.sin(desk.yaw);
  return [desk.origin[0] + lx * c + lz * s, desk.origin[1] - lx * s + lz * c];
}

/** Yaw that turns an object's local -Z toward the world point (tx, tz). */
export function yawToward(fromX, fromZ, tx, tz) {
  return Math.atan2(-(tx - fromX), -(tz - fromZ));
}

/**
 * Chair placements: one per desk. Chairs at seated shot spots are swivelled toward the bin
 * and centred slightly ahead of the eye (a seated head sits over the back half of the seat).
 * @returns {{x:number, z:number, yaw:number, desk:number, spot:number}[]}
 */
export function chairPlacements() {
  return DESKS.map((desk, i) => {
    const spotIndex = SPOT_DEFS.findIndex((s) => s.desk === i);
    if (spotIndex < 0) {
      const [lx, lz, dyaw] = IDLE_CHAIRS[i] ?? [0, DESK.chairOffset, 0];
      const [x, z] = deskToWorld(desk, lx, lz);
      return { x, z, yaw: desk.yaw + dyaw, desk: i, spot: -1 };
    }
    const [ex, ez] = deskToWorld(desk, 0, DESK.chairOffset);
    const yaw = yawToward(ex, ez, BIN.x, BIN.z);
    const ahead = 0.07;
    return { x: ex - Math.sin(yaw) * ahead, z: ez - Math.cos(yaw) * ahead, yaw, desk: i, spot: spotIndex };
  });
}

/** Shot spots as the contract wants them: [{ eye: Vector3, label }]. */
export function shotSpots() {
  return SPOT_DEFS.map((s) => {
    if (s.desk === undefined) return { eye: new THREE.Vector3(...s.eye), label: s.label };
    const [x, z] = deskToWorld(DESKS[s.desk], 0, DESK.chairOffset);
    return { eye: new THREE.Vector3(x, SEATED_EYE, z), label: s.label };
  });
}

// Chair collider dimensions (local frame, chair faces -Z): seat slab and backrest.
export const CHAIR = {
  seatW: 0.52,
  seatD: 0.5,
  seatY0: 0.4,
  seatY1: 0.53,
  backW: 0.48,
  backD: 0.1,
  backY0: 0.56,
  backY1: 1.1,
  backZ: 0.25,
};

// Terminal footprint on the desk (local desk frame): centred at (MONITOR.x, MONITOR.z).
export const MONITOR = { x: -0.02, z: -0.86, width: 0.46, depth: 0.44, height: 0.47 };

function orientedAABB(cx, cz, halfW, halfD, yaw, y0, y1, material) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = halfW * c + halfD * s;
  const hz = halfW * s + halfD * c;
  return {
    min: new THREE.Vector3(cx - hx, y0, cz - hz),
    max: new THREE.Vector3(cx + hx, y1, cz + hz),
    material,
  };
}

/** Collision proxies (docs/ARCHITECTURE.md: Colliders). Coarse boxes/cylinders that follow the visuals. */
export function buildColliders() {
  const H = DESK.half;
  const t = DESK.partitionThickness / 2;
  const underTop = DESK.top - DESK.topThickness;
  const boxes = [
    // Island top and the plus-shaped partition above it.
    { min: new THREE.Vector3(-H, underTop, -H), max: new THREE.Vector3(H, DESK.top, H), material: 'furniture' },
    { min: new THREE.Vector3(-H, DESK.top, -t), max: new THREE.Vector3(H, DESK.partitionTop, t), material: 'soft' },
    { min: new THREE.Vector3(-t, DESK.top, -H), max: new THREE.Vector3(t, DESK.partitionTop, H), material: 'soft' },
    // Modesty panels under the island (same plus shape, down to the carpet).
    { min: new THREE.Vector3(-H + 0.06, 0, -0.02), max: new THREE.Vector3(H - 0.06, underTop, 0.02), material: 'furniture' },
    { min: new THREE.Vector3(-0.02, 0, -H + 0.06), max: new THREE.Vector3(0.02, underTop, H - 0.06), material: 'furniture' },
  ];

  // Each desk's right-hand end panel under the top.
  for (const desk of DESKS) {
    const [x, z] = deskToWorld(desk, H / 2 - 0.02, -H / 2 + 0.02);
    boxes.push(orientedAABB(x, z, 0.015, (H - 0.06) / 2, desk.yaw, 0, underTop, 'furniture'));
  }

  for (const desk of DESKS) {
    const [x, z] = deskToWorld(desk, MONITOR.x, MONITOR.z);
    boxes.push(orientedAABB(x, z, MONITOR.width / 2, MONITOR.depth / 2, desk.yaw, DESK.top, DESK.top + MONITOR.height, 'furniture'));
  }

  for (const ch of chairPlacements()) {
    boxes.push(orientedAABB(ch.x, ch.z, CHAIR.seatW / 2, CHAIR.seatD / 2, ch.yaw, CHAIR.seatY0, CHAIR.seatY1, 'soft'));
    const bx = ch.x + Math.sin(ch.yaw) * CHAIR.backZ;
    const bz = ch.z + Math.cos(ch.yaw) * CHAIR.backZ;
    boxes.push(orientedAABB(bx, bz, CHAIR.backW / 2, CHAIR.backD / 2, ch.yaw, CHAIR.backY0, CHAIR.backY1, 'soft'));
  }

  boxes.push(orientedAABB(CABINET.x, CABINET.z, CABINET.width / 2, CABINET.depth / 2, CABINET.yaw, 0, CABINET.height, 'furniture'));

  const cylinders = [
    { x: PLANT.x, z: PLANT.z, radius: PLANT.potRadius, yMin: 0, yMax: PLANT.potHeight, material: 'furniture' },
    { x: PLANT.x, z: PLANT.z, radius: PLANT.foliageRadius, yMin: PLANT.potHeight, yMax: PLANT.foliageTop, material: 'soft' },
  ];

  return {
    room: {
      min: new THREE.Vector3(ROOM.minX, 0, ROOM.minZ),
      max: new THREE.Vector3(ROOM.maxX, ROOM.height, ROOM.maxZ),
      // Mineral-fibre acoustic tiles: dead and slippery (see PHYS 'ceiling'), so a ceiling bank keeps its
      // sideways speed and stays a skill shot instead of dropping the ball onto one spot.
      materials: { floor: 'carpet', ceiling: 'ceiling', px: 'wall', nx: 'wall', pz: 'wall', nz: 'wall' },
    },
    boxes,
    cylinders,
  };
}
