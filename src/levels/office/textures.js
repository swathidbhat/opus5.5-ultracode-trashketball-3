import { makeCanvasTexture, rng, valueNoise2D } from '../../utils/canvasTexture.js';
import { DESKS } from './layout.js';
import { drawPortrait } from './portrait.js';

// Procedural canvas textures for the MDR room. Everything is drawn at load time.

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const WIDE_SANS = 'Futura, "Avenir Next", Avenir, "Century Gothic", "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Didot, "Bodoni 72", Georgia, "Times New Roman", serif';
const MONO = 'Menlo, "SF Mono", Monaco, Consolas, "Courier New", monospace';

const LUMON_BLUE = '#2b6a86';

// ---------------------------------------------------------------- surfaces

/** Wall-to-wall low-pile carpet: tufted fibre noise with faint mottling. Returns { map, bump }. */
export function carpetTextures(repeat) {
  const size = 512;
  const tuft = valueNoise2D(5, 128);
  const fine = valueNoise2D(9, 256);
  const mottle = valueNoise2D(3, 4);
  const r = rng(77);
  const lum = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const t = tuft(u, v) * 0.55 + fine(u, v) * 0.3 + r() * 0.15;
      lum[y * size + x] = t + (mottle(u, v) - 0.5) * 0.35;
    }
  }
  const map = makeCanvasTexture(size, size, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      const k = 0.8 + lum[i] * 0.34; // ~0.8 .. 1.2 around the base colour
      d[i * 4] = clamp(44 * k);
      d[i * 4 + 1] = clamp(121 * k);
      d[i * 4 + 2] = clamp(60 * k);
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat });
  const bump = makeCanvasTexture(size, size, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      const g = clamp(lum[i] * 200);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat, color: false });
  return { map, bump };
}

/** Flat off-white wall paint with a whisper of roller texture. */
export function wallTexture() {
  const mottle = valueNoise2D(12, 6);
  const grain = valueNoise2D(13, 128);
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const r = rng(4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = (mottle(x / w, y / h) - 0.5) * 5 + (grain(x / w, y / h) - 0.5) * 4 + (r() - 0.5) * 3;
        d[i] = clamp(234 + n);
        d[i + 1] = clamp(233 + n);
        d[i + 2] = clamp(226 + n);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [1, 1] });
}

/** Two-by-two block of 60 cm acoustic tiles with the T-bar grid on the tile edges. */
export function ceilingTexture() {
  return makeCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#efefea';
    ctx.fillRect(0, 0, w, h);
    const r = rng(21);
    // Fissured mineral-fibre speckle.
    for (let i = 0; i < 5200; i++) {
      const g = 196 + Math.floor(r() * 30);
      ctx.fillStyle = `rgba(${g},${g},${g - 4},${0.35 + r() * 0.4})`;
      const s = r() < 0.85 ? 1 : 2;
      ctx.fillRect(Math.floor(r() * w), Math.floor(r() * h), s + (r() < 0.2 ? 2 : 0), s);
    }
    const half = w / 2;
    const bar = 7;
    for (const p of [0, half, w]) {
      // shadow line beside each bar, then the bar
      ctx.fillStyle = 'rgba(150,150,145,0.55)';
      ctx.fillRect(p - bar - 1, 0, 1, h);
      ctx.fillRect(p + bar, 0, 1, h);
      ctx.fillRect(0, p - bar - 1, w, 1);
      ctx.fillRect(0, p + bar, w, 1);
      ctx.fillStyle = '#e4e4df';
      ctx.fillRect(p - bar, 0, bar * 2, h);
      ctx.fillRect(0, p - bar, w, bar * 2);
    }
  }, { repeat: [1, 1] });
}

/** Troffer diffuser: bright prismatic face, darker metal frame (it is lit x2.4 by the material). */
export function lightPanelTexture() {
  return makeCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5a5c60';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8d9096';
    ctx.fillRect(4, 4, w - 8, h - 8);
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.62);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#eef1f5');
    ctx.fillStyle = g;
    ctx.fillRect(12, 12, w - 24, h - 24);
    ctx.strokeStyle = 'rgba(200,206,214,0.35)';
    ctx.lineWidth = 1;
    for (let p = 12; p < w - 12; p += 8) {
      ctx.beginPath();
      ctx.moveTo(p + 0.5, 12);
      ctx.lineTo(p + 0.5, h - 12);
      ctx.moveTo(12, p + 0.5);
      ctx.lineTo(w - 12, p + 0.5);
      ctx.stroke();
    }
  });
}

/**
 * Ceiling fixtures seen from below, side by side: a four-cone square supply diffuser (left half)
 * and an egg-crate return-air grille (right half). Lit like the ceiling tiles.
 */
export function ceilingFixtureTexture() {
  return makeCanvasTexture(512, 256, (ctx) => {
    // Supply diffuser: concentric square cones, each step with a lit and a shaded bevel.
    const s = 256;
    ctx.fillStyle = '#ecece7';
    ctx.fillRect(0, 0, s, s);
    const steps = 5;
    for (let k = 0; k < steps; k++) {
      const inset = 10 + k * 22;
      const w = s - inset * 2;
      ctx.fillStyle = 'rgba(70,72,74,0.55)';
      ctx.fillRect(inset, inset, w, w);
      const bevel = 7;
      ctx.fillStyle = k % 2 ? '#e2e2dc' : '#f1f1ec';
      ctx.fillRect(inset + 2, inset + 2, w - 4, w - 4);
      // Shaded far bevel on two sides, so the cones read as recessed steps.
      ctx.fillStyle = 'rgba(120,122,122,0.35)';
      ctx.fillRect(inset + 2, inset + 2, w - 4, bevel);
      ctx.fillRect(inset + 2, inset + 2, bevel, w - 4);
    }
    ctx.fillStyle = '#f4f4ef';
    ctx.fillRect(s / 2 - 16, s / 2 - 16, 32, 32);

    // Return grille: white frame around a fine egg-crate grid.
    ctx.save();
    ctx.translate(s, 0);
    ctx.fillStyle = '#ecece7';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#44484b';
    ctx.fillRect(14, 14, s - 28, s - 28);
    ctx.fillStyle = '#dcdcd6';
    const cell = (s - 28) / 16;
    for (let p = 14; p <= s - 13; p += cell) {
      ctx.fillRect(p - 1.5, 14, 3, s - 28);
      ctx.fillRect(14, p - 1.5, s - 28, 3);
    }
    ctx.restore();
  });
}

/** Near-white upholstery weave; multiplied by vertex colour so it tints partitions and chairs alike. */
export function fabricTexture() {
  return makeCanvasTexture(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const r = rng(8);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const warp = (x % 4 < 2) !== (y % 4 < 2) ? 10 : -8;
        const v = 225 + warp + (r() - 0.5) * 18;
        d[i] = d[i + 1] = d[i + 2] = clamp(v);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [1, 1] });
}

/** Soft contact-shadow sprites: radial blob (left half) and rounded-rect blob (right half). */
export function blobTexture() {
  return makeCanvasTexture(256, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    // Rounded rect: blur a filled rect.
    ctx.filter = 'blur(14px)';
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(128 + 30, 30, 68, 68);
    ctx.filter = 'none';
  }, { color: true });
}

// ---------------------------------------------------------------- the wastebasket

/** Diamond expanded-metal mesh as an alpha map (white = wire; the material supplies the colour). */
export function wireMeshTexture(repeat) {
  const tex = makeCanvasTexture(256, 256, (ctx, w) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, w);
    const cells = 4;
    const s = w / cells;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = s * 0.13;
    ctx.lineCap = 'round';
    for (let k = -cells; k <= cells * 2; k++) {
      ctx.beginPath();
      ctx.moveTo(k * s, 0);
      ctx.lineTo(k * s + w, w);
      ctx.moveTo(k * s, w);
      ctx.lineTo(k * s + w, 0);
      ctx.stroke();
    }
    // Welded knuckles where the strands cross.
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y <= cells; y++) {
      for (let x = 0; x <= cells; x++) {
        for (const [ox, oy] of [[0, 0], [0.5, 0.5]]) {
          ctx.beginPath();
          ctx.arc((x + ox) * s, (y + oy) * s, s * 0.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }, { repeat, color: false, anisotropy: 4 });
  return tex;
}

// ---------------------------------------------------------------- MDR terminal screens

const SCREEN_W = 640;
const SCREEN_H = 480;

/** 2x2 atlas of glowing MDR screens (one per desk). UV rect for desk i: screenRect(i). */
export function screenAtlasTexture() {
  return makeCanvasTexture(SCREEN_W * 2, SCREEN_H * 2, (ctx) => {
    DESKS.forEach((desk, i) => {
      ctx.save();
      ctx.translate((i % 2) * SCREEN_W, Math.floor(i / 2) * SCREEN_H);
      ctx.beginPath();
      ctx.rect(0, 0, SCREEN_W, SCREEN_H);
      ctx.clip();
      drawMdrScreen(ctx, SCREEN_W, SCREEN_H, desk);
      ctx.restore();
    });
  });
}

/** UV rect { u0, v0, u1, v1 } of desk i's screen in the screen atlas. */
export function screenRect(i) {
  const col = i % 2;
  const row = Math.floor(i / 2);
  return { u0: col / 2, u1: (col + 1) / 2, v0: 1 - (row + 1) / 2, v1: 1 - row / 2 };
}

function drawMdrScreen(ctx, w, h, desk) {
  const r = rng(desk.seed);
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.48, 20, w * 0.5, h * 0.5, w * 0.72);
  bg.addColorStop(0, '#0f4153');
  bg.addColorStop(0.6, '#0a2c3c');
  bg.addColorStop(1, '#041621');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const ink = '#a9eef5';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(120,230,245,0.9)';
  ctx.shadowBlur = 6;

  // Header: file name + completion, Lumon globe on the right.
  ctx.strokeRect(22, 18, w - 44, 50);
  ctx.font = `600 24px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(desk.file, 38, 44);
  ctx.textAlign = 'right';
  ctx.fillText(`${desk.pct}% Complete`, w - 112, 44);
  drawGlobe(ctx, w - 70, 43, 20, ink, 1.6);

  // Number field. A few neighbours around a "scary" cluster are drawn big.
  const cols = 15;
  const rows = 7;
  const x0 = 44;
  const y0 = 108;
  const dx = (w - 88) / (cols - 1);
  const dy = 36;
  const cx = 3 + Math.floor(r() * (cols - 6));
  const cy = 1 + Math.floor(r() * (rows - 3));
  ctx.textAlign = 'center';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dist = Math.hypot(col - cx - 1, (row - cy - 0.5) * 1.3);
      const scary = dist < 1.9;
      const size = scary ? 30 + (1.9 - dist) * 12 : 20 + r() * 2;
      const jx = (r() - 0.5) * 5;
      const jy = (r() - 0.5) * 5;
      ctx.font = `${scary ? 600 : 400} ${size.toFixed(1)}px ${MONO}`;
      ctx.globalAlpha = scary ? 1 : 0.78 + r() * 0.22;
      ctx.fillText(String(Math.floor(r() * 10)), x0 + col * dx + jx, y0 + row * dy + jy);
    }
  }
  ctx.globalAlpha = 1;

  // Divider and the five refinement bins.
  ctx.beginPath();
  ctx.moveTo(22, h - 128);
  ctx.lineTo(w - 22, h - 128);
  ctx.stroke();
  const bw = (w - 44 - 4 * 16) / 5;
  ctx.font = `600 20px ${SANS}`;
  for (let b = 0; b < 5; b++) {
    const bx = 22 + b * (bw + 16);
    ctx.strokeRect(bx, h - 110, bw, 34);
    ctx.fillText(`0${b + 1}`, bx + bw / 2, h - 92);
    ctx.strokeRect(bx, h - 68, bw, 18);
    ctx.fillRect(bx + 3, h - 65, (bw - 6) * (0.15 + r() * 0.8), 12);
  }
  ctx.font = `400 15px ${MONO}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText(`0x${hex(r)} : 0x${hex(r)}`, w / 2, h - 26);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  // CRT scanlines and corner falloff.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, w * 0.66);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

function hex(r) {
  return Math.floor(r() * 0xffffff).toString(16).toUpperCase().padStart(6, '0');
}

/** Lumon globe: circle with meridians and parallels. */
function drawGlobe(ctx, cx, cy, rad, color, lw) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.stroke();
  for (const k of [0.34, 0.72]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad * k, rad, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const k of [-0.5, 0, 0.5]) {
    const y = cy + k * rad;
    const hw = Math.sqrt(1 - k * k) * rad;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx + hw, y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- wall emblem

/** Lumon globe with the LUMON wordmark across its equator, on a transparent background. */
export function lumonLogoTexture() {
  return makeCanvasTexture(1024, 640, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const rad = 285;
    const band = 64; // half-height of the clear band behind the wordmark
    ctx.strokeStyle = LUMON_BLUE;
    ctx.fillStyle = LUMON_BLUE;
    ctx.lineWidth = 13;
    ctx.lineCap = 'butt';

    ctx.save();
    // Clip away the equatorial band so the lines stop short of the letters.
    ctx.beginPath();
    ctx.rect(0, 0, w, cy - band);
    ctx.rect(0, cy + band, w, h - cy - band);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 10;
    for (const k of [0.3, 0.66]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad * k, rad, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - rad);
    ctx.lineTo(cx, cy + rad);
    ctx.stroke();
    for (const k of [-0.62, 0.62]) {
      const y = cy + k * rad;
      const hw = Math.sqrt(1 - k * k) * rad;
      ctx.beginPath();
      ctx.moveTo(cx - hw, y);
      ctx.lineTo(cx + hw, y);
      ctx.stroke();
    }
    ctx.restore();

    // Band rules and wordmark.
    ctx.lineWidth = 7;
    for (const y of [cy - band + 6, cy + band - 6]) {
      const k = (y - cy) / rad;
      const hw = Math.sqrt(1 - k * k) * rad + 70;
      ctx.beginPath();
      ctx.moveTo(cx - hw, y);
      ctx.lineTo(cx + hw, y);
      ctx.stroke();
    }
    ctx.font = `500 96px ${WIDE_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawSpaced(ctx, 'LUMON', cx, cy + 3, 34);
  }, { anisotropy: 8 });
}

function drawSpaced(ctx, text, cx, cy, spacing) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = cx - total / 2;
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, cy);
    x += widths[i] + spacing;
  });
  ctx.textAlign = align;
}

// ---------------------------------------------------------------- decor + props atlas

const ATLAS = 2048;
/** Pixel rects in the 2048² decor atlas. */
export const ATLAS_RECTS = {
  portrait: [0, 0, 768, 1024],
  poster: [768, 0, 640, 896],
  plaque: [1408, 0, 640, 256],
  nameplate0: [1408, 256, 512, 96],
  nameplate1: [1408, 352, 512, 96],
  nameplate2: [1408, 448, 512, 96],
  nameplate3: [1408, 544, 512, 96],
  keyboard: [0, 1024, 1024, 384],
  paper: [1024, 1024, 512, 512],
  fingerTrap: [1536, 1024, 256, 128],
  mug: [1536, 1152, 256, 128],
  cabinetLabel: [1792, 1024, 256, 96],
  gold: [1408, 700, 32, 32],
  cream: [1448, 700, 32, 32],
  brass: [1488, 700, 32, 32],
  black: [1528, 700, 32, 32],
  white: [1568, 700, 32, 32],
  walnut: [1608, 700, 32, 32],
  canvasEdge: [1648, 700, 32, 32],
};

/** Convert a pixel rect to a UV rect (canvas textures are flipped: v = 1 at the top). */
export function atlasUV(name) {
  const [x, y, w, h] = ATLAS_RECTS[name];
  const inset = w <= 32 ? 8 : 0; // sample swatches from their middle so mips don't bleed
  return {
    u0: (x + inset) / ATLAS,
    u1: (x + w - inset) / ATLAS,
    v0: 1 - (y + h - inset) / ATLAS,
    v1: 1 - (y + inset) / ATLAS,
  };
}

export function decorAtlasTexture() {
  return makeCanvasTexture(ATLAS, ATLAS, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ATLAS, ATLAS);
    const swatch = { gold: '#b08a3e', cream: '#ddd4bd', brass: '#b89b5e', black: '#1a1a1b', white: '#f4f3ee', walnut: '#3b2a1f', canvasEdge: '#2a2119' };
    for (const [k, c] of Object.entries(swatch)) {
      const [x, y, w, h] = ATLAS_RECTS[k];
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    }
    inRect(ctx, 'portrait', drawPortrait);
    inRect(ctx, 'poster', drawPoster);
    inRect(ctx, 'plaque', drawPlaque);
    DESKS.forEach((desk, i) => inRect(ctx, `nameplate${i}`, (c, w, h) => drawNameplate(c, w, h, desk.name)));
    inRect(ctx, 'keyboard', drawKeyboard);
    inRect(ctx, 'paper', drawPaper);
    inRect(ctx, 'fingerTrap', drawFingerTrap);
    inRect(ctx, 'mug', drawMug);
    inRect(ctx, 'cabinetLabel', drawCabinetLabel);
  });
}

function inRect(ctx, name, draw) {
  const [x, y, w, h] = ATLAS_RECTS[name];
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  draw(ctx, w, h);
  ctx.restore();
}

/** Corporate motivational poster in Lumon livery. */
function drawPoster(ctx, w, h) {
  // Black frame + white mat are drawn here; the 3D frame adds depth around it.
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(0, 0, w, h);
  const m = 46;
  // Soft pastel illustration: a sunrise over rolling hills, very Lumon.
  const ix = m;
  const iy = m;
  const iw = w - 2 * m;
  const ih = h * 0.47;
  const sky = ctx.createLinearGradient(0, iy, 0, iy + ih);
  sky.addColorStop(0, '#bcd6d8');
  sky.addColorStop(1, '#eadfc4');
  ctx.fillStyle = sky;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();
  ctx.fillStyle = '#f3c989';
  ctx.beginPath();
  ctx.arc(ix + iw * 0.5, iy + ih * 0.72, iw * 0.2, 0, Math.PI * 2);
  ctx.fill();
  const hills = [
    ['#8fb3a0', 0.66, 0.1],
    ['#6d9985', 0.76, 0.08],
    ['#4f7f6c', 0.86, 0.06],
  ];
  for (const [c, base, amp] of hills) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(ix, iy + ih);
    for (let x = 0; x <= iw; x += 8) {
      const y = iy + ih * base - Math.sin((x / iw) * Math.PI * 2 + base * 9) * ih * amp - Math.sin((x / iw) * Math.PI * 5 + base * 3) * ih * amp * 0.3;
      ctx.lineTo(ix + x, y);
    }
    ctx.lineTo(ix + iw, iy + ih);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = '#23405a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const ty = iy + ih + 80;
  ctx.font = `600 60px ${SERIF}`;
  ctx.fillText('THE WORK IS', w / 2, ty);
  ctx.font = `italic 600 66px ${SERIF}`;
  ctx.fillText('Mysterious', w / 2, ty + 74);
  ctx.font = `600 44px ${SERIF}`;
  ctx.fillText('&', w / 2, ty + 124);
  ctx.font = `italic 600 66px ${SERIF}`;
  ctx.fillText('Important', w / 2, ty + 190);
  drawGlobe(ctx, w / 2, h - m - 60, 20, LUMON_BLUE, 3);
  ctx.font = `500 16px ${WIDE_SANS}`;
  ctx.fillStyle = LUMON_BLUE;
  drawSpaced(ctx, 'LUMON INDUSTRIES', w / 2, h - m - 12, 5);
}

function drawPlaque(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#c9ccce');
  g.addColorStop(0.5, '#e6e8e9');
  g.addColorStop(1, '#b7babd');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Brushed lines
  const r = rng(5);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,95,100'},${r() * 0.12})`;
    ctx.fillRect(0, r() * h, w, 1);
  }
  ctx.strokeStyle = 'rgba(60,65,70,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = '#1d2024';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 54px ${WIDE_SANS}`;
  drawSpaced(ctx, 'MACRODATA', w / 2, h * 0.37, 8);
  drawSpaced(ctx, 'REFINEMENT', w / 2, h * 0.68, 8);
}

function drawNameplate(ctx, w, h, name) {
  ctx.fillStyle = '#20252a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#b89b5e';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = '#e8dcc0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 46px ${WIDE_SANS}`;
  drawSpaced(ctx, name, w / 2, h / 2 + 2, 6);
}

/** Chunky cream keyboard seen from above: keycaps with grey gaps. */
function drawKeyboard(ctx, w, h) {
  ctx.fillStyle = '#d9d0b8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#a79f8a';
  ctx.fillRect(24, 26, w - 48, h - 52);
  const rows = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
    [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
    [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
    [1.5, 1.25, 7, 1.25, 1.5, 1.5],
  ];
  const kx0 = 30;
  const ky0 = 32;
  const unit = (w - 60 - 180) / 15;
  const kh = (h - 64) / rows.length;
  rows.forEach((row, ri) => {
    let x = kx0;
    for (const u of row) {
      const kw = u * unit;
      const y = ky0 + ri * kh;
      ctx.fillStyle = ri === 4 && u === 7 ? '#e4dcc6' : u > 1.2 ? '#c5bba1' : '#e9e1cb';
      roundRect(ctx, x + 3, y + 3, kw - 6, kh - 6, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, x + 7, y + 6, kw - 14, kh - 16, 5);
      ctx.fill();
      x += kw;
    }
  });
  // Numeric keypad: MDR refiners live on it.
  const px = w - 30 - 170;
  for (let ry = 0; ry < 5; ry++) {
    for (let cx = 0; cx < 3; cx++) {
      ctx.fillStyle = '#e9e1cb';
      roundRect(ctx, px + cx * 57 + 3, ky0 + ry * kh + 3, 51, kh - 6, 6);
      ctx.fill();
    }
  }
}

/** Printed MDR report page: header and rows of numbers. */
function drawPaper(ctx, w, h) {
  ctx.fillStyle = '#f6f5f0';
  ctx.fillRect(0, 0, w, h);
  const r = rng(99);
  ctx.fillStyle = '#6a6f78';
  ctx.font = `600 22px ${SANS}`;
  ctx.fillText('LUMON INDUSTRIES — MDR', 36, 50);
  ctx.fillRect(36, 62, w - 72, 2);
  ctx.font = `400 16px ${MONO}`;
  ctx.fillStyle = 'rgba(70,75,85,0.8)';
  for (let y = 96; y < h - 30; y += 24) {
    let line = '';
    for (let i = 0; i < 26; i++) line += r() < 0.18 ? ' ' : Math.floor(r() * 10);
    ctx.fillText(line, 36, y);
  }
}

function drawFingerTrap(ctx, w, h) {
  const cols = ['#c8352b', '#e8c33a', '#2f8f4e', '#2c5ca8'];
  ctx.fillStyle = '#c8352b';
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 7;
  for (let i = -20; i < 40; i++) {
    ctx.strokeStyle = cols[((i % 4) + 4) % 4];
    ctx.beginPath();
    ctx.moveTo(i * 12, 0);
    ctx.lineTo(i * 12 + h, h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,220,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(i * 12 + h, 0);
    ctx.lineTo(i * 12, h);
    ctx.stroke();
    ctx.lineWidth = 7;
  }
}

function drawMug(ctx, w, h) {
  ctx.fillStyle = '#f1efe8';
  ctx.fillRect(0, 0, w, h);
  drawGlobe(ctx, w * 0.25, h * 0.5, 22, LUMON_BLUE, 3);
  drawGlobe(ctx, w * 0.75, h * 0.5, 22, LUMON_BLUE, 3);
}

function drawCabinetLabel(ctx, w, h) {
  ctx.fillStyle = '#f4f1e6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#34383d';
  ctx.font = `600 34px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MDR · 1–4', w / 2, h / 2);
}

function roundRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

