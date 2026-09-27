import * as THREE from 'three';
import { T, tiledBox, tiledPlane } from './batch.js';
import { ROOM, DOOR, CORRIDOR } from './layout.js';

// Room shell: carpet, walls (with the MDR doorway), drop ceiling, trim, the open door,
// and the long white corridor beyond it. Light panels are returned separately (instanced).

export const CARPET_TILE = 1.4; // metres covered by one carpet texture tile
export const WALL_TILE = 2.5;
export const CEILING_TILE = 1.2; // the ceiling texture holds 2 x 2 tiles of 60 cm
const BAKE_CELL = 0.3; // vertex spacing for the baked occlusion on big surfaces

const TRIM = 0xf1efe8;
const DOOR_FRAME = 0xc9c5b8; // painted steel frame, a shade darker so the doorway reads
const DOOR_PAINT = 0xe9e6dc;
const STEEL = 0xb9bcc0;
const HALL_FLOOR = 0xd6d6d0;

const { minX, maxX, minZ, maxZ, height: H, wallThickness: WT } = ROOM;

/**
 * Soft "baked" light for the inside of an axis-aligned box: darkening into the corners and along
 * the floor/ceiling junctions, and walls that brighten a touch toward the light panels. The real-time
 * lights are all overhead, so without this the walls read as flat grey cards.
 * @param {'floor'|'ceiling'|'wall'} kind which surface the vertices lie on (it doesn't occlude itself)
 * @returns {(p: THREE.Vector3, out: THREE.Color) => void}
 */
function boxShade(x0, x1, z0, z1, h, kind, strength = 1) {
  return (p, out) => {
    const dx = Math.max(0, Math.min(p.x - x0, x1 - p.x));
    const dz = Math.max(0, Math.min(p.z - z0, z1 - p.z));
    const y = THREE.MathUtils.clamp(p.y, 0, h);
    let k = 1;
    const occ = (dist, amount, range) => (k *= 1 - amount * strength * Math.exp(-dist / range));
    if (kind === 'wall') {
      occ(Math.max(dx, dz), 0.2, 0.32); // the other wall in a corner (this wall's own distance is ~0)
      k *= 0.92 + 0.1 * Math.pow(y / h, 0.8); // lighter toward the ceiling
    } else {
      occ(dx, 0.2, 0.32);
      occ(dz, 0.2, 0.32);
    }
    if (kind !== 'floor') occ(y, 0.3, 0.16);
    if (kind !== 'ceiling') occ(h - y, 0.16, 0.26);
    out.setScalar(k);
  };
}

const shades = (x0, x1, z0, z1, h, strength) => ({
  floor: { worldColorFn: boxShade(x0, x1, z0, z1, h, 'floor', strength) },
  ceiling: { worldColorFn: boxShade(x0, x1, z0, z1, h, 'ceiling', strength) },
  wall: { worldColorFn: boxShade(x0, x1, z0, z1, h, 'wall', strength) },
});
const ROOM_SHADE = shades(minX, maxX, minZ, maxZ, H, 1);
// The hall box runs 2 m past its doorway end so the threshold isn't darkened.
const HALL_SHADE = shades(CORRIDOR.x0, CORRIDOR.x1, CORRIDOR.zEnd, CORRIDOR.zStart + 2, CORRIDOR.height, 0.8);
const CROSS_SHADE = shades(CORRIDOR.crossX0, CORRIDOR.x1, CORRIDOR.zEnd, CORRIDOR.zEnd + CORRIDOR.crossDepth, CORRIDOR.height, 0.8);

/**
 * Add the room shell to the batcher.
 * @param {import('./batch.js').Batcher} b
 */
export function buildRoom(b) {
  const W = maxX - minX;
  const D = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // Floor + ceiling
  b.add('carpet', tiledPlane(W, D, CARPET_TILE, BAKE_CELL), T(cx, 0, cz, -Math.PI / 2), ROOM_SHADE.floor);
  b.add('ceiling', tiledPlane(W, D, CEILING_TILE, BAKE_CELL), T(cx, H, cz, Math.PI / 2), ROOM_SHADE.ceiling);

  // Walls (planes facing into the room)
  const wall = (w, h, m) => b.add('wall', tiledPlane(w, h, WALL_TILE, BAKE_CELL), m, ROOM_SHADE.wall);
  wall(W, H, T(cx, H / 2, maxZ, 0, Math.PI));
  wall(D, H, T(minX, H / 2, cz, 0, Math.PI / 2));
  wall(D, H, T(maxX, H / 2, cz, 0, -Math.PI / 2));
  // North wall around the doorway
  const leftW = DOOR.x0 - minX;
  const rightW = maxX - DOOR.x1;
  wall(leftW, H, T(minX + leftW / 2, H / 2, minZ));
  wall(rightW, H, T(DOOR.x1 + rightW / 2, H / 2, minZ));
  wall(DOOR.x1 - DOOR.x0, H - DOOR.height, T((DOOR.x0 + DOOR.x1) / 2, (H + DOOR.height) / 2, minZ));
  // Door reveals through the wall thickness
  const reveal = (w, h, m) => b.add('wall', tiledPlane(w, h, WALL_TILE), m, { color: DOOR_FRAME });
  reveal(WT, DOOR.height, T(DOOR.x0, DOOR.height / 2, minZ - WT / 2, 0, Math.PI / 2));
  reveal(WT, DOOR.height, T(DOOR.x1, DOOR.height / 2, minZ - WT / 2, 0, -Math.PI / 2));
  reveal(DOOR.x1 - DOOR.x0, WT, T((DOOR.x0 + DOOR.x1) / 2, DOOR.height, minZ - WT / 2, Math.PI / 2));

  // Baseboards and the ceiling wall-angle
  const base = 0.1;
  const bt = 0.014;
  const casing = 0.075;
  const trim = (x, z, len, yaw, h = base, y = h / 2, t = bt, color = TRIM) =>
    b.add('trim', new THREE.BoxGeometry(len, h, t), T(x, y, z, 0, yaw), { color });
  trim(cx, maxZ - bt / 2, W, 0);
  trim(minX + bt / 2, cz, D, Math.PI / 2);
  trim(maxX - bt / 2, cz, D, Math.PI / 2);
  const l1 = DOOR.x0 - casing;
  const r0 = DOOR.x1 + casing;
  trim((minX + l1) / 2, minZ + bt / 2, l1 - minX, 0);
  trim((r0 + maxX) / 2, minZ + bt / 2, maxX - r0, 0);
  const angle = 0.025;
  trim(cx, maxZ - 0.006, W, 0, angle, H - angle / 2, 0.012);
  trim(cx, minZ + 0.006, W, 0, angle, H - angle / 2, 0.012);
  trim(minX + 0.006, cz, D, Math.PI / 2, angle, H - angle / 2, 0.012);
  trim(maxX - 0.006, cz, D, Math.PI / 2, angle, H - angle / 2, 0.012);

  // Door casing (room side)
  const cd = 0.022;
  const ch = DOOR.height + casing;
  trim(DOOR.x0 - casing / 2, minZ + cd / 2, casing, 0, ch, ch / 2, cd, DOOR_FRAME);
  trim(DOOR.x1 + casing / 2, minZ + cd / 2, casing, 0, ch, ch / 2, cd, DOOR_FRAME);
  trim((DOOR.x0 + DOOR.x1) / 2, minZ + cd / 2, DOOR.x1 - DOOR.x0 + casing * 2, 0, casing, DOOR.height + casing / 2, cd, DOOR_FRAME);

  buildDoorLeaf(b);
  buildCorridor(b);
  buildCeilingFixtures(b);
}

// Tile centres (60 cm grid) that sit clear of the light panels.
const SUPPLY_DIFFUSERS = [[-2.1, -1.5], [2.1, -1.5], [-2.1, 1.5], [2.1, 1.5]];
const RETURN_GRILLES = [[-4.5, -2.7], [0.3, 0.3], [4.5, -0.9]];

/** Square supply diffusers and egg-crate return grilles set into the drop ceiling. */
function buildCeilingFixtures(b) {
  const place = (list, rect) => {
    for (const [x, z] of list) {
      b.add('fixture', new THREE.PlaneGeometry(0.6, 0.6), T(x, H - 0.003, z, Math.PI / 2), { uvRect: rect });
    }
  };
  place(SUPPLY_DIFFUSERS, { u0: 0, u1: 0.5, v0: 0, v1: 1 });
  place(RETURN_GRILLES, { u0: 0.5, u1: 1, v0: 0, v1: 1 });
}

/** The MDR door, swung open ~100 degrees into the corridor. */
function buildDoorLeaf(b) {
  const w = DOOR.x1 - DOOR.x0 - 0.02;
  const h = DOOR.height - 0.02;
  const th = 0.042;
  const hinge = new THREE.Vector3(DOOR.x1 - 0.015, 0, minZ - WT - th / 2);
  const yaw = THREE.MathUtils.degToRad(-100);
  const leaf = new THREE.Matrix4().makeRotationY(yaw).setPosition(hinge);
  const local = (x, y, z) => leaf.clone().multiply(T(x, y, z));
  b.add('trim', tiledBox(w, h, th, 1), local(-w / 2, h / 2 + 0.008, 0), { color: DOOR_PAINT });
  // Lever handles on both faces + escutcheons
  for (const s of [1, -1]) {
    b.add('metal', new THREE.CylinderGeometry(0.028, 0.028, 0.012, 20), local(-w + 0.07, 1.02, s * (th / 2 + 0.006)).multiply(T(0, 0, 0, Math.PI / 2)), { color: STEEL });
    b.add('metal', new THREE.BoxGeometry(0.13, 0.018, 0.018), local(-w + 0.115, 1.02, s * (th / 2 + 0.035)), { color: STEEL });
    b.add('metal', new THREE.CylinderGeometry(0.009, 0.009, 0.03, 10), local(-w + 0.07, 1.02, s * (th / 2 + 0.02)).multiply(T(0, 0, 0, Math.PI / 2)), { color: STEEL });
  }
  // Kick plate
  b.add('metal', new THREE.BoxGeometry(w - 0.08, 0.22, 0.003), local(-w / 2, 0.14, th / 2 + 0.0015), { color: 0xc9ccd0 });
}

/** A long white hall behind the door with a cross corridor turning left at the far end. */
function buildCorridor(b) {
  const { x0, x1, zStart, zEnd, height: ch, crossX0, crossDepth } = CORRIDOR;
  const cw = x1 - x0;
  const len = zStart - zEnd;
  const mx = (x0 + x1) / 2;
  const mz = (zStart + zEnd) / 2;
  const crossZ1 = zEnd + crossDepth; // south edge of the cross corridor
  const crossW = x0 - crossX0;

  // Pale semi-gloss hall floor from the doorway on; an aluminium threshold strip in the door reveal.
  const floorLen = minZ - zEnd;
  const hallFloor = { color: HALL_FLOOR };
  b.add('trim', tiledPlane(cw, floorLen, 1, 0.45), T(mx, 0, zEnd + floorLen / 2, -Math.PI / 2), { ...hallFloor, ...HALL_SHADE.floor });
  b.add('trim', tiledPlane(crossW, crossDepth, 1, 0.45), T(crossX0 + crossW / 2, 0, zEnd + crossDepth / 2, -Math.PI / 2), { ...hallFloor, ...CROSS_SHADE.floor });
  b.add('metal', new THREE.BoxGeometry(DOOR.x1 - DOOR.x0, 0.008, WT), T((DOOR.x0 + DOOR.x1) / 2, 0.004, minZ - WT / 2), { color: STEEL });
  b.add('ceiling', tiledPlane(cw, len, CEILING_TILE, 0.45), T(mx, ch, mz, Math.PI / 2), HALL_SHADE.ceiling);
  b.add('ceiling', tiledPlane(crossW, crossDepth, CEILING_TILE, 0.45), T(crossX0 + crossW / 2, ch, zEnd + crossDepth / 2, Math.PI / 2), CROSS_SHADE.ceiling);

  const wall = (w, m, opts) => b.add('wall', tiledPlane(w, ch, WALL_TILE, 0.45), m, opts);
  wall(len, T(x1, ch / 2, mz, 0, -Math.PI / 2), HALL_SHADE.wall); // east side
  const westLen = zStart - crossZ1;
  wall(westLen, T(x0, ch / 2, crossZ1 + westLen / 2, 0, Math.PI / 2), HALL_SHADE.wall); // west side, up to the turn
  wall(x1 - crossX0, T((crossX0 + x1) / 2, ch / 2, zEnd), CROSS_SHADE.wall); // far end (also the cross corridor's north wall)
  wall(crossW, T(crossX0 + crossW / 2, ch / 2, crossZ1, 0, Math.PI), CROSS_SHADE.wall); // cross corridor south wall
  wall(crossDepth, T(crossX0, ch / 2, zEnd + crossDepth / 2, 0, Math.PI / 2), CROSS_SHADE.wall); // cross corridor end

  // Baseboards
  const bt = 0.014;
  const base = 0.1;
  const trim = (x, z, l, yaw) => b.add('trim', new THREE.BoxGeometry(l, base, bt), T(x, base / 2, z, 0, yaw), { color: TRIM });
  trim(x1 - bt / 2, mz, len, Math.PI / 2);
  trim(x0 + bt / 2, crossZ1 + westLen / 2, westLen, Math.PI / 2);
  trim((crossX0 + x1) / 2, zEnd + bt / 2, x1 - crossX0, 0);
  trim(crossX0 + crossW / 2, crossZ1 - bt / 2, crossW, 0);
}

/**
 * Ceiling light layout: square 1.2 m troffers in the room, 0.6 x 1.2 m panels down the corridor.
 * @returns {{ matrices: THREE.Matrix4[], flickerIndex: number, flickerPos: THREE.Vector3 }}
 */
export function lightPanelLayout() {
  const matrices = [];
  for (const x of [-3.6, -1.2, 1.2, 3.6]) {
    for (const z of [-2.4, 0, 2.4]) matrices.push(T(x, H - 0.004, z, Math.PI / 2, 0, 0, 1.2, 1.2, 1));
  }
  const roomCount = matrices.length;
  const cxm = (CORRIDOR.x0 + CORRIDOR.x1) / 2;
  const hallZ = [];
  for (let z = CORRIDOR.zStart - 1.6; z > CORRIDOR.zEnd + CORRIDOR.crossDepth; z -= 2) hallZ.push(z);
  for (const z of hallZ) matrices.push(T(cxm, CORRIDOR.height - 0.004, z, Math.PI / 2, 0, 0, 0.6, 1.2, 1));
  matrices.push(T(CORRIDOR.x0 - 1.8, CORRIDOR.height - 0.004, CORRIDOR.zEnd + CORRIDOR.crossDepth / 2, Math.PI / 2, 0, Math.PI / 2, 0.6, 1.2, 1));
  // The eerie one: third panel down the hall.
  const flickerIndex = roomCount + 2;
  return { matrices, flickerIndex, flickerPos: new THREE.Vector3(cxm, CORRIDOR.height - 0.3, hallZ[2]) };
}
