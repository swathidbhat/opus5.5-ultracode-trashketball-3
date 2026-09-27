import * as THREE from 'three';

// Small helpers for procedural textures drawn on 2D canvases.
// Everything in the game is generated at load time, so there are no image assets.

/** Deterministic PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw into a fresh canvas and wrap it as a texture.
 * @param {number} width
 * @param {number} height
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} draw
 * @param {object} [opts]
 * @param {[number, number]} [opts.repeat]  sets RepeatWrapping and repeat
 * @param {boolean} [opts.color=true]       true for albedo/emissive maps (sRGB), false for data maps (roughness, bump, normal)
 * @param {number} [opts.anisotropy=8]
 */
export function makeCanvasTexture(width, height, draw, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.color !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.anisotropy = opts.anisotropy ?? 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Fill the whole canvas with per-pixel grain around a base color.
 * amount is the max +/- change per channel (0-255).
 */
export function addNoise(ctx, w, h, amount = 12, seed = 7) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 2 * amount;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

/** Tileable 2D value noise in [0, 1], `period` cells across the tile. */
export function valueNoise2D(seed = 1, period = 8) {
  const r = rng(seed);
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x, y) => grid[((y % period) + period) % period * period + (((x % period) + period) % period)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return function noise(u, v) {
    // u, v in [0, 1) tile space
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
