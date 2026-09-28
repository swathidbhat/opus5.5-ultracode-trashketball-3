import * as THREE from 'three';
import { PIANO } from './layout.js';
import { mbox, mlathe, pillow, tint } from './geom.js';

// Black lacquer baby grand with its lid propped open, and a leather-topped bench.
// Local frame: the keyboard edge of the case is at z = 0, the tail points along -Z, the keys and
// the bench along +Z. The straight bass side is at -X; the lid hinges there and opens toward +X.

function put(parent, geom, mat, x = 0, y = 0, z = 0, o = {}) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  mesh.castShadow = o.cast ?? true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Top-view outline of the case in shape space: x across, y = distance toward the tail. */
function caseOutline(W, L) {
  const hw = W / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw, 0);
  s.lineTo(hw, 0);
  s.lineTo(hw, L * 0.3);
  // the treble "bentside" swings in, then the tail rounds off
  s.bezierCurveTo(hw, L * 0.54, hw * 0.12, L * 0.53, hw * 0.03, L * 0.78);
  s.bezierCurveTo(-hw * 0.05, L * 0.99, -hw * 0.68, L * 1.03, -hw * 0.92, L * 0.94);
  s.bezierCurveTo(-hw * 0.99, L * 0.91, -hw, L * 0.87, -hw, L * 0.82);
  s.lineTo(-hw, 0);
  return s;
}

/** The same outline shrunk toward its middle (for the inner rim and the iron plate). */
function insetPoints(shape, k) {
  const pts = shape.getPoints(24);
  const c = new THREE.Vector2();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  return pts.map((p) => p.clone().sub(c).multiplyScalar(k).add(c));
}

/** Extrude a shape upward (shape y -> world -z) between y0 and y0 + h. */
function slab(shape, y0, h, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, h - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  return g;
}

/**
 * @param {Record<string, THREE.Material>} m interior materials (uses lacquer, brass, colored, leather)
 * @returns {THREE.Group}
 */
export function buildPiano(m) {
  const g = new THREE.Group();
  const W = PIANO.width;
  const L = PIANO.length;
  const hw = W / 2;
  const top = PIANO.caseTop;
  const outline = caseOutline(W, L);

  // Case body, then a raised rim around the gold plate.
  const bodyY = 0.64;
  put(g, slab(outline, bodyY, 0.27, 0.012), m.lacquer);
  const inner = insetPoints(outline, 0.94);
  const rim = caseOutline(W, L);
  rim.holes.push(new THREE.Path([...inner].reverse()));
  put(g, slab(rim, bodyY + 0.27, top - bodyY - 0.27, 0.006), m.lacquer);
  const plate = new THREE.ShapeGeometry(new THREE.Shape(inner));
  plate.rotateX(-Math.PI / 2);
  put(g, plate, m.brass, 0, bodyY + 0.272, 0, { cast: false });
  // A few bass and treble strings as tinted slivers over the plate.
  const strings = [];
  for (let i = 0; i < 26; i++) {
    const x = -hw + 0.12 + i * 0.045;
    const len = x < 0 ? L * 0.72 : Math.max(0.3, L * (0.62 - x * 0.55));
    const s = new THREE.PlaneGeometry(0.004, len);
    s.rotateX(-Math.PI / 2);
    s.translate(x, bodyY + 0.276, -0.2 - len / 2);
    strings.push(tint(s, 0xd8d2c4));
  }
  for (const s of strings) put(g, s, m.colored, 0, 0, 0, { cast: false });

  // Lid, hinged along the straight bass side and propped open.
  const lidAngle = 0.6;
  const lid = slab(outline, 0, 0.018);
  lid.translate(hw, 0, 0);
  lid.rotateZ(lidAngle);
  lid.translate(-hw, top, 0);
  put(g, lid, m.lacquer);
  // Prop stick from the treble rim up to the underside of the lid.
  const propZ = -L * 0.42;
  const lidAt = (s) => new THREE.Vector3(-hw + s * Math.cos(lidAngle), top + s * Math.sin(lidAngle) - 0.01, propZ);
  const a = new THREE.Vector3(hw - 0.07, top, propZ);
  const b = lidAt(W * 0.8);
  const stick = new THREE.CylinderGeometry(0.009, 0.009, a.distanceTo(b), 8);
  stick.translate(0, a.distanceTo(b) / 2, 0);
  stick.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  put(g, stick, m.lacquer, a.x, a.y, a.z);

  // Keybed, cheek blocks, fallboard and music desk.
  const keyW = 1.22;
  put(g, mbox(keyW + 0.2, 0.09, 0.32), m.lacquer, 0, bodyY + 0.03, 0.14);
  for (const s of [-1, 1]) put(g, mbox(0.075, 0.2, 0.32), m.lacquer, s * (keyW / 2 + 0.05), bodyY + 0.08, 0.14);
  put(g, mbox(keyW + 0.03, 0.1, 0.05), m.lacquer, 0, bodyY + 0.16, 0.03);
  const desk = mbox(0.78, 0.3, 0.018);
  desk.translate(0, 0.15, 0);
  put(g, desk, m.lacquer, 0, top + 0.02, -0.06, { rx: -0.22 });
  const sheet = tint(new THREE.PlaneGeometry(0.42, 0.28), 0xf3eee2);
  sheet.translate(0, 0.16, 0.011);
  put(g, sheet, m.colored, 0, top + 0.02, -0.06, { rx: -0.22, cast: false });

  // Keys: 52 white, 36 black (A0 to C8).
  const whites = 52;
  const kw = keyW / whites;
  const keyTop = bodyY + 0.105;
  const kz0 = 0.075;
  const kz1 = 0.29;
  const keys = [];
  for (let i = 0; i < whites; i++) {
    const k = new THREE.BoxGeometry(kw - 0.0014, 0.03, kz1 - kz0);
    k.translate(-keyW / 2 + (i + 0.5) * kw, keyTop - 0.015, (kz0 + kz1) / 2);
    keys.push(tint(k, 0xf2eee6));
    const name = 'ABCDEFG'[i % 7];
    if (i < whites - 1 && 'ACDFG'.includes(name)) {
      const bk = new THREE.BoxGeometry(kw * 0.58, 0.02, 0.095);
      bk.translate(-keyW / 2 + (i + 1) * kw, keyTop + 0.006, kz0 + 0.0475);
      keys.push(tint(bk, 0x141414));
    }
  }
  for (const k of keys) put(g, k, m.colored, 0, 0, 0, { cast: false });

  // Three tapered legs on brass casters.
  const leg = [
    [0, 0],
    [0.034, 0],
    [0.034, 0.03],
    [0.04, 0.05],
    [0.056, bodyY - 0.08],
    [0.07, bodyY - 0.03],
    [0.07, bodyY],
    [0, bodyY],
  ];
  for (const [x, z] of [
    [-keyW / 2 - 0.04, 0.12],
    [keyW / 2 + 0.04, 0.12],
    [-hw * 0.35, -L * 0.82],
  ]) {
    put(g, mlathe(leg.slice(2), 20), m.lacquer, x, 0, z);
    put(g, mlathe(leg.slice(0, 3).concat([[0, 0.03]]), 16), m.brass, x, 0, z);
  }

  // Pedal lyre.
  for (const s of [-1, 1]) put(g, mbox(0.03, bodyY - 0.06, 0.03), m.lacquer, s * 0.1, 0.06 + (bodyY - 0.06) / 2, -0.12);
  put(g, mbox(0.3, 0.08, 0.1), m.lacquer, 0, 0.06, -0.12);
  for (const x of [-0.06, 0, 0.06]) put(g, mbox(0.028, 0.012, 0.11), m.brass, x, 0.07, -0.02, { cast: false });

  // Bench: lacquer frame, tufted leather top.
  const bench = new THREE.Group();
  put(bench, mbox(0.78, 0.07, 0.34), m.lacquer, 0, 0.44, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(bench, mbox(0.04, 0.44, 0.04), m.lacquer, sx * 0.35, 0.22, sz * 0.14);
  put(bench, pillow(0.76, 0.07, 0.33, { p: 0.3, crown: 0.2 }), m.leather, 0, 0.5, 0);
  bench.position.set(0, 0, 0.78);
  g.add(bench);

  g.position.set(PIANO.x, 0, PIANO.z);
  g.rotation.y = PIANO.yaw;
  return g;
}
