// Crumpled paper balls. The shape is a low-poly polyhedron whose faces are split again with
// small off-plane folds, so it has a few big flat panels, finer creases inside them and deep
// pinched crevices, like a real crumpled sheet. Each face is mapped to a patch of a printed page
// with its own print direction. Geometry variants and per-style materials are cached and shared.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PHYS } from './config.js';
import { rng, makeCanvasTexture, valueNoise2D } from './utils/canvasTexture.js';

const VARIANTS = 5;
const BASE_DETAIL = 1; // icosahedron detail of the coarse shape: 42 corners, 80 panels
// Per subdivision level: chance that an edge midpoint is folded off the panel plane, and how far.
const FOLD_CHANCE = [0.6, 0.2];
const FOLD_DEPTH = [0.09, 0.025];
const CORNER_JITTER = 0.3; // tangential jitter of the coarse corners, in edge lengths
const CORNER_SPREAD = 0.1; // radial spread of the coarse corners
const PINCH_CHANCE = 0.3; // corners pushed deep into the ball, making the dark crevices
const UV_REGIONS = 11; // patches of the sheet, each with its own print orientation
const UV_SCALE = 0.16 / PHYS.ballRadius; // ~15 printed digits across the ball
const GRAIN_AMOUNT = 5; // max +/- per channel of the fine paper grain

const geometryCache = [];
const materialCache = new Map();

/**
 * A crumpled paper ball mesh of radius ≈ PHYS.ballRadius (castShadow on).
 * @param {{seed?: number, style?: 'office'|'beach'}} [opts]
 * @returns {THREE.Mesh}
 */
export function createPaperBall({ seed = 0, style = 'office' } = {}) {
  // Build every variant on first use so later spawns never hitch.
  if (geometryCache.length === 0) {
    for (let i = 0; i < VARIANTS; i++) geometryCache.push(buildCrumpleGeometry(1009 + i * 7919));
  }
  const s = Math.abs(Math.floor(seed)) || 0;
  const mesh = new THREE.Mesh(geometryCache[s % VARIANTS], getMaterial(style));
  mesh.name = 'paperBall';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.style = style;
  // Same geometry, different face forward: balls sharing a variant still look different.
  const r = rng(s * 2654435761 + 97);
  mesh.quaternion.setFromEuler(new THREE.Euler(r() * Math.PI * 2, r() * Math.PI * 2, r() * Math.PI * 2));
  return mesh;
}

// ---------------------------------------------------------------- geometry

function randomUnit(r, out = new THREE.Vector3()) {
  const z = r() * 2 - 1;
  const a = r() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return out.set(Math.cos(a) * s, z, Math.sin(a) * s);
}

/** Roughly even points on the unit sphere (jittered Fibonacci spiral). */
function spreadPoints(r, n, jitter) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const rad = Math.sqrt(1 - y * y);
    const a = i * golden;
    const p = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad);
    p.add(randomUnit(r).multiplyScalar(jitter)).normalize();
    pts.push(p);
  }
  return pts;
}

function buildCrumpleGeometry(seed) {
  const r = rng(seed);
  const bell = () => (r() + r() + r() - 1.5) / 1.5; // roughly bell-shaped in [-1, 1]

  // Coarse polyhedron: jittered icosphere corners at random depths.
  let base = new THREE.IcosahedronGeometry(1, BASE_DETAIL);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  base = mergeVertices(base, 1e-4);
  const src = base.getAttribute('position');
  const P = [];
  for (let i = 0; i < src.count; i++) P.push(new THREE.Vector3().fromBufferAttribute(src, i));
  let F = Array.from(base.index.array);
  base.dispose();
  const edge = 1.1 / (BASE_DETAIL + 1);
  const jitter = new THREE.Vector3();
  for (const p of P) {
    p.addScaledVector(randomUnit(r, jitter), CORNER_JITTER * edge).normalize();
    let rad = 1 + bell() * CORNER_SPREAD;
    if (r() < PINCH_CHANCE) rad -= 0.08 + r() * 0.12;
    p.multiplyScalar(rad);
  }

  // Split every triangle in four. A midpoint left on its edge keeps the panel flat; one pushed
  // in or out folds the panel along the lines to the neighbouring midpoints.
  for (let level = 0; level < FOLD_CHANCE.length; level++) {
    const mids = new Map();
    const next = [];
    const midpoint = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let m = mids.get(key);
      if (m === undefined) {
        const v = P[a].clone().add(P[b]).multiplyScalar(0.5);
        if (r() < FOLD_CHANCE[level]) {
          const depth = (r() < 0.6 ? -1 : 1) * FOLD_DEPTH[level] * (0.5 + r());
          v.addScaledVector(v.clone().normalize(), depth);
        }
        m = P.push(v) - 1;
        mids.set(key, m);
      }
      return m;
    };
    for (let f = 0; f < F.length; f += 3) {
      const a = F[f];
      const b = F[f + 1];
      const c = F[f + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    F = next;
  }

  const ao = crevices(P, F);
  let sum = 0;
  for (const p of P) sum += p.length();
  // Match the collision sphere on average so resting balls sit on surfaces, not in or above them.
  const scale = PHYS.ballRadius / (sum / P.length);

  // Flat-shaded, so un-index: each face gets its own vertices, UVs from its sheet patch.
  const regions = spreadPoints(r, UV_REGIONS, 0.5).map((p) => {
    const t1 = new THREE.Vector3().crossVectors(p, randomUnit(r)).normalize();
    return { p, t1, t2: new THREE.Vector3().crossVectors(p, t1), u: r(), v: r() };
  });
  const n = F.length;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  const centroid = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let f = 0; f < n; f += 3) {
    centroid.copy(P[F[f]]).add(P[F[f + 1]]).add(P[F[f + 2]]).normalize();
    let region = regions[0];
    let best = -2;
    for (const rg of regions) {
      const d = centroid.dot(rg.p);
      if (d > best) {
        best = d;
        region = rg;
      }
    }
    for (let k = 0; k < 3; k++) {
      const i = f + k;
      v.copy(P[F[i]]).multiplyScalar(scale);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = v.z;
      uv[i * 2] = region.u + v.dot(region.t1) * UV_SCALE;
      uv[i * 2 + 1] = region.v + v.dot(region.t2) * UV_SCALE;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao[F[i]];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Baked occlusion per corner, stored as a vertex colour. Two cues multiplied: how far a corner
 * sits below its ring of neighbours (sharp valleys), and how much of the ball rises above its
 * tangent plane nearby (wide crevices and pinches).
 */
function crevices(P, F) {
  const count = P.length;
  const ringSum = new Float32Array(count);
  const ringCount = new Float32Array(count);
  const normals = P.map(() => new THREE.Vector3());
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f];
    const b = F[f + 1];
    const c = F[f + 2];
    e1.subVectors(P[b], P[a]);
    e2.subVectors(P[c], P[a]);
    e1.cross(e2); // area-weighted face normal
    for (const i of [a, b, c]) normals[i].add(e1);
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      ringSum[i] += P[j].length();
      ringCount[i]++;
      ringSum[j] += P[i].length();
      ringCount[j]++;
    }
  }
  const REACH = 0.4;
  const w = new THREE.Vector3();
  const ao = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = P[i];
    const nrm = normals[i].normalize();
    const valley = Math.min(1, Math.max(0.35, 1.02 - (ringSum[i] / ringCount[i] - p.length()) * 9));
    let above = 0;
    for (let j = 0; j < count; j++) {
      w.subVectors(P[j], p);
      const d = w.length();
      if (d > REACH || d < 1e-6) continue;
      const up = w.dot(nrm) / d;
      if (up > 0.15) above += (up - 0.15) * (1 - d / REACH);
    }
    const open = Math.min(1, Math.max(0.3, 1 - (above / count) * 120));
    ao[i] = Math.max(0.3, Math.pow(valley, 0.8) * open);
  }
  return ao;
}

// ---------------------------------------------------------------- materials

function getMaterial(style) {
  const key = style === 'beach' ? 'beach' : 'office';
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: key === 'beach' ? makeBeachPaperTexture() : makeOfficePaperTexture(),
      vertexColors: true,
      flatShading: true,
      roughness: 0.86,
      metalness: 0,
    });
    mat.name = `paper-${key}`;
    materialCache.set(key, mat);
  }
  return mat;
}

function paperGrain(ctx, w, h, seed, strength) {
  // Soft fibre mottling, then fine per-pixel grain, in a single readback: reading the canvas back
  // twice makes Chrome warn about willReadFrequently and copies the 4 MB image one extra time.
  const noise = valueNoise2D(seed, 16);
  const grain = rng(seed + 1);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (noise(x / w, y / h) - 0.5) * strength;
      const i = (y * w + x) * 4;
      data[i] += n;
      data[i + 1] += n;
      data[i + 2] += n;
      // Separate writes on purpose: the clamped array rounds and clamps each one, as two passes did.
      const g = (grain() - 0.5) * 2 * GRAIN_AMOUNT;
      data[i] += g;
      data[i + 1] += g;
      data[i + 2] += g;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Lumon printer paper: rows of monospaced digits, like a Macrodata Refinement printout. */
function makeOfficePaperTexture() {
  return makeCanvasTexture(1024, 1024, (ctx, w, h) => {
    const r = rng(4417);
    ctx.fillStyle = '#eceee9';
    ctx.fillRect(0, 0, w, h);
    paperGrain(ctx, w, h, 31, 14);

    const mono = '"Courier New", Courier, monospace';
    const files = ['COLD HARBOR', 'SIENA', 'TUMWATER', 'DRANESVILLE', 'CHESAPEAKE', 'ALLENTOWN'];
    const rowH = 30;
    const colW = 21;
    ctx.textBaseline = 'middle';
    for (let row = 0, y = 22; y < h; row++, y += rowH) {
      if (row % 9 === 0) {
        // Section header: file name and completion, then a rule, in darker ink.
        ctx.fillStyle = 'rgba(38, 56, 78, 0.78)';
        ctx.font = `bold 20px ${mono}`;
        const file = files[Math.floor(r() * files.length)];
        ctx.fillText(`LUMON  MDR  ${file}  ${String(Math.floor(r() * 99)).padStart(2, '0')}%`, 28, y);
        ctx.fillStyle = 'rgba(38, 56, 78, 0.35)';
        ctx.fillRect(24, y + 14, w - 48, 2);
        continue;
      }
      for (let col = 0, x = 30; x < w - 20; col++, x += colW) {
        if (col % 12 === 11) continue; // column gutters
        const scary = r() < 0.035; // the odd bold digit, as if it felt wrong
        ctx.fillStyle = scary ? 'rgba(20, 44, 70, 0.95)' : `rgba(62, 84, 108, ${0.5 + r() * 0.25})`;
        ctx.font = scary ? `bold 21px ${mono}` : `20px ${mono}`;
        ctx.fillText(String(Math.floor(r() * 10)), x, y);
      }
    }
    // Faint tractor-feed holes along the edge.
    ctx.fillStyle = 'rgba(120, 130, 140, 0.18)';
    for (let y = 16; y < h; y += 42) {
      ctx.beginPath();
      ctx.arc(10, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Beach house stationery: warm cream paper, pastel rules, a sun stamp and loose handwriting. */
function makeBeachPaperTexture() {
  return makeCanvasTexture(1024, 1024, (ctx, w, h) => {
    const r = rng(9021);
    ctx.fillStyle = '#f4e2c1';
    ctx.fillRect(0, 0, w, h);
    paperGrain(ctx, w, h, 57, 16);

    const teal = 'rgba(110, 185, 185, 0.55)';
    const coral = 'rgba(240, 140, 125, 0.55)';
    const rowH = 44;
    for (let i = 0, y = 40; y < h; i++, y += rowH) {
      ctx.fillStyle = i % 3 === 2 ? coral : teal;
      ctx.fillRect(0, y, w, 2);
    }
    ctx.fillStyle = coral;
    ctx.fillRect(120, 0, 3, h); // margin

    drawSunStamp(ctx, 62, 70, 26);
    drawSunStamp(ctx, 62, 590, 22);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let y = 40 - 4; y < h; y += rowH) {
      if (r() < 0.3) continue;
      ctx.strokeStyle = r() < 0.72 ? 'rgba(46, 66, 116, 0.6)' : 'rgba(168, 72, 66, 0.55)';
      ctx.lineWidth = 1.8 + r() * 0.5;
      const start = 140 + r() * 30;
      const end = 140 + (0.45 + r() * 0.5) * (w - 160);
      drawHandwriting(ctx, r, start, y, end, 9 + r() * 2);
    }
  });
}

/** A little coral sun with rays over teal waves, the rental's letterhead. */
function drawSunStamp(ctx, x, y, radius) {
  ctx.save();
  ctx.fillStyle = 'rgba(244, 146, 110, 0.75)';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(244, 146, 110, 0.75)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * radius * 0.68, y + Math.sin(a) * radius * 0.68);
    ctx.lineTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(80, 170, 175, 0.8)';
  for (let k = 0; k < 2; k++) {
    const wy = y + radius * (1.35 + k * 0.4);
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const wx = x - radius + (i / 16) * radius * 2;
      const yy = wy + Math.sin((i / 16) * Math.PI * 4) * 3;
      if (i === 0) ctx.moveTo(wx, yy);
      else ctx.lineTo(wx, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Joined-up scribble that reads as cursive at a glance: words of looped, humped and round
 * letters on a slanted baseline. `xh` is the x-height in pixels.
 */
function drawHandwriting(ctx, r, x0, y, x1, xh) {
  ctx.save();
  ctx.setTransform(1, 0, -0.28, 1, 0.28 * y, 0); // forward slant, pivoting on the baseline
  let x = x0;
  while (x < x1) {
    const letters = 2 + Math.floor(r() * 6);
    ctx.beginPath();
    ctx.moveTo(x, y - xh * 0.3);
    for (let i = 0; i < letters && x < x1; i++) {
      const w = xh * (0.75 + r() * 0.45);
      const kind = r();
      if (kind < 0.22) {
        // Tall loop (l, h, b): up past the x-height, over and back down across itself.
        const top = y - xh * (2.1 + r() * 0.5);
        ctx.bezierCurveTo(x + w * 0.6, y - xh * 0.6, x + w * 0.95, top, x + w * 0.55, top);
        ctx.bezierCurveTo(x + w * 0.2, top, x + w * 0.3, y - xh * 0.3, x + w * 0.45, y);
        ctx.quadraticCurveTo(x + w * 0.8, y + 1, x + w, y - xh * 0.35);
      } else if (kind < 0.34) {
        // Descender loop (g, y): down below the line and back up.
        const bottom = y + xh * (1.3 + r() * 0.4);
        ctx.quadraticCurveTo(x + w * 0.3, y - xh, x + w * 0.6, y - xh * 0.2);
        ctx.bezierCurveTo(x + w * 0.75, bottom, x + w * 0.1, bottom, x + w * 0.45, y);
        ctx.quadraticCurveTo(x + w * 0.8, y - xh * 0.2, x + w, y - xh * 0.4);
      } else if (kind < 0.6) {
        // Arcade (n, m): one or two humps.
        const humps = r() < 0.4 ? 2 : 1;
        const hw = w / humps;
        for (let k = 0; k < humps; k++) {
          const hx = x + k * hw;
          ctx.quadraticCurveTo(hx + hw * 0.1, y - xh * 1.1, hx + hw * 0.5, y - xh * 0.9);
          ctx.quadraticCurveTo(hx + hw * 0.85, y - xh * 0.6, hx + hw, y);
        }
      } else if (kind < 0.8) {
        // Round letter (o, a): a small oval, then a connector.
        const cx = x + w * 0.45;
        ctx.quadraticCurveTo(x + w * 0.2, y - xh, cx, y - xh);
        ctx.bezierCurveTo(x - w * 0.1, y - xh, x + w * 0.05, y + 1, cx, y);
        ctx.bezierCurveTo(x + w * 0.85, y, x + w * 0.8, y - xh, cx + w * 0.15, y - xh * 0.9);
        ctx.quadraticCurveTo(x + w * 0.75, y, x + w, y - xh * 0.35);
      } else {
        // Small loop (e) or cup (u, i).
        ctx.bezierCurveTo(x + w * 0.9, y - xh * 0.5, x + w * 0.5, y - xh * 1.05, x + w * 0.3, y - xh * 0.6);
        ctx.quadraticCurveTo(x + w * 0.2, y + 1, x + w * 0.65, y);
        ctx.quadraticCurveTo(x + w * 0.9, y - xh * 0.1, x + w, y - xh * 0.4);
      }
      x += w;
    }
    ctx.stroke();
    x += xh * (1.2 + r() * 0.9); // word space
  }
  ctx.restore();
}
