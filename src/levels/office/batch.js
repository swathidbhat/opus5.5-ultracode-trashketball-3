import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static geometry batching: every prop part is baked into world space with a vertex colour and
// merged into one mesh per material, so the whole room costs a handful of draw calls.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Matrix from position, Euler rotation (XYZ) and scale.
 * @returns {THREE.Matrix4}
 */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Matrix for rotation about Y then translation (the common "place on the floor" case). */
export function TY(x, y, z, yaw = 0) {
  return T(x, y, z, 0, yaw, 0);
}

export class Batcher {
  constructor() {
    /** @type {Map<string, THREE.BufferGeometry[]>} */
    this.parts = new Map();
  }

  /**
   * Add a geometry (not consumed; it is copied) to a material bucket.
   * @param {string} key material bucket
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Matrix4} [matrix]
   * @param {object} [opts]
   * @param {THREE.ColorRepresentation} [opts.color=0xffffff] vertex colour (sRGB hex)
   * @param {(p: THREE.Vector3, out: THREE.Color) => void} [opts.colorFn] per-vertex colour from the local position
   * @param {(p: THREE.Vector3, out: THREE.Color) => void} [opts.worldColorFn] per-vertex multiplier from the world
   *   position, applied on top of color/colorFn (used to bake soft occlusion into the room shell)
   * @param {{u0,v0,u1,v1}} [opts.uvRect] squeeze the geometry's 0..1 UVs into this atlas rect
   * @param {[number, number]} [opts.uvScale] multiply UVs (for tiling textures)
   */
  add(key, geometry, matrix = null, opts = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const uv = g.attributes.uv;
    if (opts.uvScale) {
      for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * opts.uvScale[0], uv.getY(i) * opts.uvScale[1]);
    }
    if (opts.uvRect) {
      const r = opts.uvRect;
      for (let i = 0; i < n; i++) uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    }
    const colors = new Float32Array(n * 3);
    const pos = g.attributes.position;
    if (opts.colorFn) {
      for (let i = 0; i < n; i++) {
        opts.colorFn(_p.fromBufferAttribute(pos, i), _c);
        colors.set([_c.r, _c.g, _c.b], i * 3);
      }
    } else {
      _c.set(opts.color ?? 0xffffff);
      for (let i = 0; i < n; i++) colors.set([_c.r, _c.g, _c.b], i * 3);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (matrix) g.applyMatrix4(matrix);
    if (opts.worldColorFn) {
      const wpos = g.attributes.position;
      const col = g.attributes.color;
      for (let i = 0; i < n; i++) {
        opts.worldColorFn(_p.fromBufferAttribute(wpos, i), _c);
        col.setXYZ(i, col.getX(i) * _c.r, col.getY(i) * _c.g, col.getZ(i) * _c.b);
      }
    }
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }

  /**
   * Merge each bucket into one mesh.
   * @param {Record<string, THREE.Material>} materials
   * @param {Record<string, {cast?: boolean, receive?: boolean}>} shadows
   * @returns {THREE.Mesh[]}
   */
  build(materials, shadows = {}) {
    const meshes = [];
    for (const [key, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) throw new Error(`office: failed to merge bucket "${key}"`);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.name = `office-${key}`;
      mesh.castShadow = shadows[key]?.cast ?? true;
      mesh.receiveShadow = shadows[key]?.receive ?? true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}

/**
 * Box whose UVs are in world units / tile, so tiling textures keep their scale on any box.
 * @returns {THREE.BoxGeometry}
 */
export function tiledBox(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // px nx py ny pz nz
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return g;
}

/**
 * Box with an atlas rect per face: faces = { px, nx, py, ny, pz, nz, all }.
 * Faces without an entry use `all`.
 */
export function atlasBox(w, h, d, faces) {
  return applyFaceUVs(new THREE.BoxGeometry(w, h, d), faces);
}

/**
 * Remap a (1-segment) BoxGeometry-derived geometry's per-face 0..1 UVs into atlas rects.
 * @param {THREE.BufferGeometry} g indexed box geometry (24 vertices, faces px nx py ny pz nz)
 * @param {object} faces { px, nx, py, ny, pz, nz, all }
 */
export function applyFaceUVs(g, faces) {
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const uv = g.attributes.uv;
  order.forEach((name, f) => {
    const r = faces[name] ?? faces.all;
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
    }
  });
  return g;
}

/**
 * Plane with UVs scaled to world units / tile.
 * @param {number} [cell] optional subdivision size (m), so baked vertex colours have somewhere to live
 */
export function tiledPlane(w, h, tile = 1, cell = 0) {
  const g = cell > 0 ? new THREE.PlaneGeometry(w, h, Math.max(1, Math.ceil(w / cell)), Math.max(1, Math.ceil(h / cell))) : new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

/**
 * Tapered box: a box whose back face (-Z) is scaled and shifted. Used for CRT housings.
 * @param {number} w front width
 * @param {number} h front height
 * @param {number} d depth
 * @param {number} kx back width factor
 * @param {number} ky back height factor
 * @param {number} dy vertical shift of the back face
 */
export function taperedBox(w, h, d, kx, ky, dy = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) < 0) p.setXYZ(i, p.getX(i) * kx, p.getY(i) * ky + dy, p.getZ(i));
  }
  g.computeVertexNormals();
  return g;
}

/** Keyboard-like wedge: a box whose top slopes from hFront (at +Z) to hBack (at -Z); origin at bottom centre. */
export function wedge(w, hFront, hBack, d) {
  const g = new THREE.BoxGeometry(w, 1, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    const hz = p.getZ(i) > 0 ? hFront : hBack;
    p.setY(i, top ? hz : 0);
  }
  g.computeVertexNormals();
  return g;
}

/** Turn a closed surface inside out (mirror + inward normals), e.g. the inner wall of a mug. */
export function insideOut(g) {
  g.scale(-1, 1, 1);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}
