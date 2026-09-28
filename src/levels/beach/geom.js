import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry helpers for the beach house. All UVs are "metric" (1 UV unit = 1 m) unless noted,
// so a tileable texture looks the same scale on every piece of furniture.

/** Box with metric UVs on every face. */
export function mbox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
  return g;
}

/** Plane (XY, facing +Z) with metric UVs. */
export function mplane(w, h, sx = 1, sy = 1) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return g;
}

/**
 * Lathe around +Y with metric UVs (u = arc length at the mean radius, v = profile length).
 * @param {Array<[number, number]>} pts profile as [radius, y] pairs, bottom to top
 */
export function mlathe(pts, segments = 48, phiStart = 0, phiLength = Math.PI * 2) {
  const v2 = pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const g = new THREE.LatheGeometry(v2, segments, phiStart, phiLength);
  let meanR = 0;
  for (const [r] of pts) meanR += r;
  meanR /= pts.length;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const uv = g.attributes.uv;
  const n = pts.length;
  for (let i = 0; i < uv.count; i++) {
    const j = i % n;
    uv.setXY(i, uv.getX(i) * phiLength * meanR, cum[j]);
  }
  return g;
}

/** Cylinder as a closed lathe (metric UVs), optional rounded top edge. */
export function mcylinder(r, h, segments = 40, bevel = 0) {
  const pts = [
    [0, 0],
    [r, 0],
    [r, h - bevel],
  ];
  if (bevel > 0) {
    for (let i = 1; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      pts.push([r - bevel + Math.cos(a) * bevel, h - bevel + Math.sin(a) * bevel]);
    }
  }
  pts.push([0, h]);
  return mlathe(pts, segments);
}

/**
 * Soft cushion / pillow: a super-ellipsoid (boxy with round edges) with a plump crown.
 * Poles sit on the ±X ends so the top face has clean UVs.
 * @param {number} w width (x)  @param {number} h height (y)  @param {number} d depth (z)
 * @param {object} [o]
 * @param {number} [o.p=0.28] shape exponent (smaller = boxier)
 * @param {number} [o.crown=0.18] extra puff on the top face, as a fraction of h
 * @param {number} [o.pinch=0] pinches the corners in (throw pillows)
 */
export function pillow(w, h, d, o = {}) {
  const p = o.p ?? 0.28;
  const crown = o.crown ?? 0.18;
  const pinch = o.pinch ?? 0;
  const su = o.segU ?? 20;
  const sv = o.segV ?? 12;
  const f = (c) => Math.sign(c) * Math.pow(Math.abs(c), p);
  const pos = [];
  const uvs = [];
  const idx = [];
  const around = 2 * (h + d);
  for (let j = 0; j <= sv; j++) {
    const phi = (j / sv) * Math.PI;
    const cx = -Math.cos(phi);
    const s = Math.sin(phi);
    for (let i = 0; i <= su; i++) {
      const th = (i / su) * Math.PI * 2;
      const cy = -Math.cos(th) * s;
      const cz = Math.sin(th) * s;
      let x = (w / 2) * f(cx);
      let y = (h / 2) * f(cy);
      let z = (d / 2) * f(cz);
      const nx = (2 * x) / w;
      const nz = (2 * z) / d;
      if (y > 0) y *= 1 + crown * (1 - nx ** 4) * (1 - nz ** 4);
      if (pinch > 0) {
        const ny = (2 * y) / h;
        const k = 1 - pinch * (nx * nx) * (ny * ny);
        z *= k;
      }
      pos.push(x, y, z);
      uvs.push((i / su) * around, (j / sv) * w);
    }
  }
  for (let j = 0; j < sv; j++) {
    for (let i = 0; i < su; i++) {
      const a = j * (su + 1) + i;
      const b = a + su + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Annular sector slab (curved sofa parts), flat on y = 0, extruded up to `height`, with rounded ends
 * that bulge capK * (r2 - r1) / 2 past the end angles.
 * Angles are in the XZ plane: point = (cx + r cos a, cz - r sin a).
 */
export function arcSlab(r1, r2, a0, a1, height, bevel = 0.04, capK = 0.35) {
  const shape = new THREE.Shape();
  const rm = (r1 + r2) / 2;
  const rc = (r2 - r1) / 2;
  const P = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
  shape.moveTo(...P(r2, a0));
  shape.absarc(0, 0, r2, a0, a1, false);
  // Rounded ends: half-ellipses that bulge capK * rc past the end angles.
  const [ex, ey] = P(rm, a1);
  shape.absellipse(ex, ey, rc, rc * capK, 0, Math.PI, false, a1);
  shape.absarc(0, 0, r1, a1, a0, true);
  const [sx, sy] = P(rm, a0);
  shape.absellipse(sx, sy, rc, rc * capK, Math.PI, Math.PI * 2, false, a0);
  const b = Math.min(bevel, height / 2 - 0.001, rc - 0.001);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, height - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: 3,
    curveSegments: 28,
  });
  // Shape XY -> world XZ (shape y maps to -z), extrusion -> +y.
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  g.computeVertexNormals();
  return g;
}

/**
 * Tube swept along a curve with a varying radius (UVs: u around, metric or 0..1 when unitU; v = meters along).
 * @param {THREE.Curve} curve
 * @param {(t:number)=>number} radius
 */
export function sweepTube(curve, radius, tubular = 32, radial = 10, closeEnds = false, unitU = false) {
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  const len = curve.getLength();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, p);
    const r = radius(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      // Same convention as THREE.TubeGeometry (-N cos + B sin) so the winding faces outward.
      n.set(0, 0, 0).addScaledVector(N, -Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      uvs.push(unitU ? j / radial : (j / radial) * Math.PI * 2 * Math.max(r, 0.02), t * len);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (closeEnds) {
    for (const [i, start] of [
      [0, true],
      [tubular, false],
    ]) {
      curve.getPointAt(i / tubular, p);
      const T = frames.tangents[i];
      const c = pos.length / 3;
      pos.push(p.x, p.y, p.z);
      const s = start ? -1 : 1;
      nor.push(T.x * s, T.y * s, T.z * s);
      uvs.push(0, 0);
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        if (start) idx.push(c, a, a + 1);
        else idx.push(c, a + 1, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Add a constant vertex colour attribute (for merging with vertexColors materials). */
export function tint(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// ---------------------------------------------------------------------------------------------

/**
 * Collects static meshes and merges them into one draw per (material, shadow flags).
 * Author furniture as ordinary Object3D hierarchies, then `bake()` flattens them.
 */
export class StaticBatcher {
  constructor() {
    this.buckets = new Map();
  }

  /** Add every mesh under `root` (its current world transform is baked in). */
  addObject(root) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh) this.add(o.geometry, o.material, o.matrixWorld, o.castShadow, o.receiveShadow);
    });
  }

  /** Add a single geometry with a world matrix. */
  add(geometry, material, matrix, castShadow = true, receiveShadow = true) {
    const key = `${material.uuid}|${castShadow ? 1 : 0}${receiveShadow ? 1 : 0}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { material, castShadow, receiveShadow, parts: [] };
      this.buckets.set(key, b);
    }
    // Parts stay indexed so the merged buckets share vertices (de-indexing tripled vertex memory and
    // vertex-shader work). A part without normals is expanded first so it still gets flat normals.
    let g = geometry.index && !geometry.attributes.normal ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    if (matrix.determinant() < 0) flipWinding(g);
    g = normalizeAttributes(g, material.vertexColors);
    b.parts.push(g);
  }

  /** Merge and return the meshes (caller adds them to the scene). Source geometries are not disposed. */
  bake() {
    const meshes = [];
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.parts, false);
      for (const p of b.parts) p.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = b.receiveShadow;
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/** Reverse every triangle (after a mirroring transform), in the index when there is one. */
function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    return;
  }
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    const s = a.itemSize;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const t = a.array[(i + 1) * s + k];
        a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
        a.array[(i + 2) * s + k] = t;
      }
    }
  }
}

/** Same attribute set on every part (mergeGeometries requires it), always indexed. */
function normalizeAttributes(g, withColor) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  // Non-indexed parts (the extruded sofa and piano pieces) get a trivial index. Welding them with
  // mergeVertices would save ~30k more vertices but adds ~0.2 s to the build.
  if (!g.index) {
    const seq = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) seq[i] = i;
    g.setIndex(new THREE.BufferAttribute(seq, 1));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position);
  out.setAttribute('normal', g.attributes.normal);
  out.setAttribute('uv', g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (withColor) {
    out.setAttribute('color', g.attributes.color ?? new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  out.setIndex(g.index);
  return out;
}

// ---------------------------------------------------------------------------------------------

/**
 * Closed reeded (fluted) drum: `reeds` rounded ribs around the side, flat top and bottom.
 * Metric UVs on the side (u = arc length, v = height).
 */
export function fluted(r, h, reeds = 28, depth = 0.012, perReed = 6) {
  const seg = reeds * perReed;
  const radius = (a) => {
    const f = ((a / (Math.PI * 2)) * reeds) % 1;
    return r - depth * (1 - Math.sqrt(Math.sin(Math.PI * f)));
  };
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const rr = radius(a);
    const x = Math.sin(a) * rr;
    const z = Math.cos(a) * rr;
    pos.push(x, 0, z, x, h, z);
    uv.push(a * r, 0, a * r, h);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  side.setIndex(idx);
  side.computeVertexNormals();
  const top = new THREE.CircleGeometry(r, seg); // a hair proud of the reeds, closing the top
  top.rotateX(-Math.PI / 2);
  top.translate(0, h, 0);
  const bottom = new THREE.CircleGeometry(r - depth * 0.5, seg);
  bottom.rotateX(Math.PI / 2);
  const out = mergeGeometries([side, top, bottom]);
  side.dispose();
  top.dispose();
  bottom.dispose();
  return out;
}

/**
 * A hardback lying flat (w along x, t thick, d along z): two cover boards and a spine in the cover
 * colour around a cream page block. Returns geometries tinted for a vertexColors material.
 */
export function bookGeometries(w, t, d, cover, pages = 0xefe6d2) {
  const b = 0.003; // board thickness
  const parts = [];
  const add = (g, x, y, z, col) => {
    g.translate(x, y, z);
    parts.push(tint(g, col));
  };
  add(new THREE.BoxGeometry(w, b, d), 0, b / 2, 0, cover);
  add(new THREE.BoxGeometry(w, b, d), 0, t - b / 2, 0, cover);
  add(new THREE.BoxGeometry(b, t, d), -w / 2 + b / 2, t / 2, 0, cover);
  add(new THREE.BoxGeometry(w - b - 0.004, t - 2 * b, d - 0.006), b / 2 - 0.002, t / 2, 0, pages);
  return parts;
}

/**
 * Crossed foliage cards (two quads at 90 degrees) with normals bent away from `center`,
 * so a clump of cards shades like a soft volume instead of flat planes.
 */
export function foliageCards(positions, size, center, r) {
  const parts = [];
  const v = new THREE.Vector3();
  for (const p of positions) {
    const yaw = r() * Math.PI;
    const tilt = (r() - 0.5) * 0.8;
    const s = size * (0.75 + r() * 0.5);
    for (let k = 0; k < 2; k++) {
      const q = new THREE.PlaneGeometry(s, s);
      q.rotateZ(tilt);
      q.rotateY(yaw + (k * Math.PI) / 2);
      q.translate(p.x, p.y, p.z);
      const pos = q.attributes.position;
      const n = q.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center).normalize();
        n.setXYZ(i, v.x, v.y * 0.8 + 0.2, v.z);
      }
      parts.push(q);
    }
  }
  return parts;
}

/** Flat reeded panel in the XY plane facing +Z (vertical reeds across x), bottom at y = 0. Metric UVs. */
export function reededPanel(w, h, reeds, depth = 0.008, perReed = 6) {
  const seg = reeds * perReed;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const f = (i % perReed) / perReed;
    const x = -w / 2 + (w * i) / seg;
    const z = -depth * (1 - Math.sqrt(Math.sin(Math.PI * f)));
    pos.push(x, 0, z, x, h, z);
    uv.push(x + w / 2, 0, x + w / 2, h);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
