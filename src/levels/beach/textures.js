import * as THREE from 'three';
import { rng, makeCanvasTexture, addNoise } from '../../utils/canvasTexture.js';
import { makeYielder } from './yield.js';

// Procedural canvas textures for the beach house. Every texture is drawn at load time.
// Most are tileable and meant for "metric" UVs (1 UV unit = 1 m): each entry's repeat is
// 1 / (physical size the texture covers).

const TAU = Math.PI * 2;

/** Draw fn(ctx, dx, dy) at the 9 wrap offsets so shapes crossing an edge tile seamlessly. */
function wrapDraw(w, h, fn) {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) fn(dx, dy);
}

function rgba(c, a) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function jitter(c, r, amt) {
  const k = (r() - 0.5) * 2 * amt;
  return [c[0] + k, c[1] + k * 0.9, c[2] + k * 0.8];
}

/** Soft blotches for large-scale tonal variation. */
function blotches(g, w, h, r, count, radius, colorA, colorB, alpha) {
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = radius * (0.4 + r());
    const col = r() < 0.5 ? colorA : colorB;
    wrapDraw(w, h, (dx, dy) => {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      grd.addColorStop(0, rgba(col, alpha * r()));
      grd.addColorStop(1, rgba(col, 0));
      g.fillStyle = grd;
      g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
}

/**
 * Long wavy grain lines inside a rect (vertical = along canvas y). Lines are sorted into a few
 * tone/width buckets and each bucket is stroked as one path: thousands of separate strokes are
 * what made the wood textures slow to generate.
 */
function grainLines(g, x, y, w, h, r, count, dark, light, vertical = true) {
  const len = vertical ? h : w;
  const across = vertical ? w : h;
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const amp = 0.5 + r() * 2.5;
    const o = amp * 1.3 + r() * Math.max(0, across - amp * 2.6); // stays inside the rect, no clip needed
    const f = ((0.5 + r() * 2) / len) * TAU;
    const ph = r() * TAU;
    const isDark = r() < 0.7;
    const a = Math.round((0.05 + r() * 0.16) * 20) / 20;
    const lw = Math.round((0.6 + r() * 1.8) * 2) / 2;
    const key = `${isDark ? 1 : 0}|${a}|${lw}`;
    let path = buckets.get(key);
    if (!path) {
      path = { style: rgba(isDark ? dark : light, a), lw, pts: [] };
      buckets.set(key, path);
    }
    const line = [];
    for (let t = 0; t <= len + 0.01; t += Math.min(24, len / 2)) {
      const d = o + Math.sin(t * f + ph) * amp + Math.sin(t * f * 3.7 + ph * 2) * amp * 0.3;
      line.push(vertical ? [x + d, y + t] : [x + t, y + d]);
    }
    path.pts.push(line);
  }
  for (const p of buckets.values()) {
    g.strokeStyle = p.style;
    g.lineWidth = p.lw;
    g.beginPath();
    for (const line of p.pts) {
      g.moveTo(line[0][0], line[0][1]);
      for (let k = 1; k < line.length; k++) g.lineTo(line[k][0], line[k][1]);
    }
    g.stroke();
  }
}

// ---------------------------------------------------------------------------------------------

/** Wide-plank light oak. Covers 2.4 m (u) x 4.8 m (v); planks run along v. */
function oakFloor() {
  const W = 2048;
  const H = 2048;
  const planks = 12; // 0.2 m wide
  const pw = W / planks;
  const pxPerM = H / 4.8;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(101);
    const base = [205, 170, 128];
    g.fillStyle = '#6b5238';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < planks; i++) {
      let y = -r() * 2.0 * pxPerM;
      while (y < H) {
        const len = (1.4 + r() * 1.6) * pxPerM;
        const col = jitter(base, r, 16);
        // slight warm / cool drift per plank
        col[0] += (r() - 0.5) * 10;
        const x0 = i * pw + 1.5;
        for (const off of [0, H]) {
          const yy = y + off;
          if (yy > H || yy + len < 0) continue;
          g.fillStyle = rgba(col, 1);
          g.fillRect(x0, yy + 1.5, pw - 3, len - 3);
          // tone gradient across the plank
          const grd = g.createLinearGradient(x0, 0, x0 + pw, 0);
          grd.addColorStop(0, 'rgba(90,60,30,0.10)');
          grd.addColorStop(0.5, 'rgba(255,240,210,0.06)');
          grd.addColorStop(1, 'rgba(90,60,30,0.12)');
          g.fillStyle = grd;
          g.fillRect(x0, yy + 1.5, pw - 3, len - 3);
          grainLines(g, x0, yy + 1.5, pw - 3, len - 3, rng((i + 1) * 977 + Math.floor(y)), 70, [120, 82, 45], [238, 212, 170]);
          // an occasional small knot
          if (r() < 0.35) {
            const kx = x0 + pw * (0.2 + r() * 0.6);
            const ky = yy + len * (0.2 + r() * 0.6);
            g.fillStyle = 'rgba(110,72,38,0.45)';
            g.beginPath();
            g.ellipse(kx, ky, 3 + r() * 4, 7 + r() * 9, 0, 0, TAU);
            g.fill();
          }
        }
        y += len;
      }
    }
    addNoise(g, W, H, 7, 5);
  }, { anisotropy: 16 });
}

/** Warm white lime plaster. Covers 3 m. */
function plaster() {
  const S = 1024;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(7);
    g.fillStyle = '#ece6dc';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, r, 260, 120, [255, 252, 246], [214, 204, 190], 0.35);
    blotches(g, S, S, r, 500, 30, [255, 253, 248], [205, 196, 182], 0.18);
    addNoise(g, S, S, 5, 3);
  });
}

/** White-painted tongue-and-groove boards along u. Covers 1.5 m. */
function ceilingBoards() {
  const S = 1024;
  const boards = 12;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(19);
    g.fillStyle = '#f2efe9';
    g.fillRect(0, 0, S, S);
    const bh = S / boards;
    for (let i = 0; i < boards; i++) {
      const c = jitter([242, 238, 231], r, 5);
      g.fillStyle = rgba(c, 1);
      g.fillRect(0, i * bh + 2, S, bh - 3);
      grainLines(g, 0, i * bh + 2, S, bh - 3, rng(i * 31 + 3), 18, [200, 192, 178], [255, 255, 255], false);
      g.fillStyle = 'rgba(120,110,95,0.55)';
      g.fillRect(0, i * bh, S, 2);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(0, i * bh + 2, S, 1);
    }
    addNoise(g, S, S, 4, 11);
  });
}

/** Whitewashed pale oak for beams, mostly tonal. Covers 1.2 m. */
function paleOak() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(23);
    g.fillStyle = '#cdb694';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, r, 80, 70, [228, 212, 186], [176, 150, 116], 0.4);
    grainLines(g, 0, 0, S, S, r, 90, [150, 122, 88], [236, 222, 198], false);
    addNoise(g, S, S, 8, 13);
  });
}

/** Cream bouclé: dense little loops. Covers 0.25 m. */
function boucle() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(31);
    g.fillStyle = '#ddd4c4';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 2.2 + r() * 3.2;
      const a0 = r() * TAU;
      wrapDraw(S, S, (dx, dy) => {
        if (x + dx < -8 || x + dx > S + 8 || y + dy < -8 || y + dy > S + 8) return;
        g.strokeStyle = 'rgba(150,138,118,0.5)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(x + dx + 0.8, y + dy + 1.2, rad, a0, a0 + 4.6);
        g.stroke();
        g.strokeStyle = r() < 0.15 ? 'rgba(236,228,212,0.95)' : 'rgba(250,247,240,0.95)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x + dx, y + dy, rad, a0, a0 + 4.6);
        g.stroke();
      });
    }
    addNoise(g, S, S, 6, 17);
  }, { repeat: [4, 4] });
}

/** Oatmeal linen weave. Covers 0.2 m. */
function linen() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(37);
    g.fillStyle = '#cbbda6';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 3) {
      g.fillStyle = rgba(jitter([214, 201, 180], r, 14), 0.55);
      g.fillRect(0, y, S, 1.6);
    }
    for (let x = 0; x < S; x += 3) {
      g.fillStyle = rgba(jitter([186, 172, 150], r, 12), 0.45);
      g.fillRect(x, 0, 1.4, S);
    }
    for (let i = 0; i < 240; i++) {
      const y = Math.floor(r() * S / 3) * 3;
      const x = r() * S;
      const len = 20 + r() * 90;
      g.fillStyle = rgba(r() < 0.5 ? [228, 218, 200] : [168, 154, 132], 0.5);
      g.fillRect(x, y, len, 2);
      if (x + len > S) g.fillRect(x - S, y, len, 2);
    }
    addNoise(g, S, S, 7, 41);
  }, { repeat: [5, 5] });
}

/** Cognac leather with soft mottling and creases. Covers 0.5 m. */
function leather() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(43);
    g.fillStyle = '#8f4c24';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, r, 120, 60, [176, 104, 58], [96, 46, 20], 0.35);
    for (let i = 0; i < 70; i++) {
      const x = r() * S;
      const y = r() * S;
      const len = 20 + r() * 60;
      const a = r() * TAU;
      g.strokeStyle = 'rgba(70,32,14,0.25)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 10, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 10, x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    addNoise(g, S, S, 9, 47);
  }, { repeat: [2, 2] });
}

/** Calacatta marble with soft clouds and gold-grey veins. Covers 1.4 m. */
function marble() {
  const S = 1024;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(53);
    g.fillStyle = '#f1efea';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, r, 90, 160, [226, 222, 214], [250, 249, 246], 0.5);
    const vein = (x, y, ang, steps, width, col, alpha) => {
      g.strokeStyle = rgba(col, alpha);
      g.lineWidth = width;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < steps; i++) {
        ang += (r() - 0.5) * 0.5;
        x += Math.cos(ang) * 14;
        y += Math.sin(ang) * 14;
        g.lineTo(x, y);
      }
      g.stroke();
    };
    for (let i = 0; i < 9; i++) {
      const x = r() * S;
      const y = r() * S;
      const a = -0.6 + (r() - 0.5) * 0.8;
      const seed = r() * 1e6;
      const steps = 40 + r() * 60;
      const gold = r() < 0.35;
      for (const [w, al] of [
        [14, 0.05],
        [6, 0.12],
        [1.8, 0.55],
      ]) {
        const rr = rng(seed | 0);
        let ax = x;
        let ay = y;
        let ang = a;
        g.strokeStyle = rgba(gold ? [176, 150, 108] : [128, 124, 120], al);
        g.lineWidth = w;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(ax, ay);
        for (let k = 0; k < steps; k++) {
          ang += (rr() - 0.5) * 0.5;
          ax += Math.cos(ang) * 14;
          ay += Math.sin(ang) * 14;
          g.lineTo(ax, ay);
        }
        g.stroke();
      }
      // fine branches
      if (r() < 0.8) vein(x + (r() - 0.5) * 200, y + (r() - 0.5) * 200, r() * TAU, 12 + r() * 20, 1, [140, 136, 130], 0.35);
    }
    addNoise(g, S, S, 3, 59);
  });
}

/**
 * Beni Ourain style wool rug: ivory pile with a hand-knotted charcoal diamond lattice (not tiling).
 * The canvas matches the rug's 5.2 x 4.2 m aspect so the lattice is not stretched.
 */
function rug() {
  const W = 1280;
  const H = 1024;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(61);
    g.fillStyle = '#e6dfd0';
    g.fillRect(0, 0, W, H);
    blotches(g, W, H, r, 220, 60, [244, 239, 229], [212, 202, 186], 0.4);
    // Hand-knotted lines: short wobbly segments, slightly uneven width and tone.
    const knot = (x0, y0, x1, y1) => {
      const n = 10;
      let px = x0;
      let py = y0;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t + (r() - 0.5) * 3.5;
        const y = y0 + (y1 - y0) * t + (r() - 0.5) * 3.5;
        g.strokeStyle = `rgba(${58 + r() * 14},${50 + r() * 10},${44 + r() * 8},${0.62 + r() * 0.2})`;
        g.lineWidth = 3.2 + r() * 1.8;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(x, y);
        g.stroke();
        px = x;
        py = y;
      }
    };
    g.lineCap = 'round';
    const margin = 58;
    const cols = 9;
    const rows = 6;
    const cw = (W - margin * 2) / cols;
    const ch = (H - margin * 2) / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = margin + i * cw;
        const y = margin + j * ch;
        // one diamond per cell: its four edges
        knot(x + cw / 2, y, x + cw, y + ch / 2);
        knot(x + cw, y + ch / 2, x + cw / 2, y + ch);
        knot(x + cw / 2, y + ch, x, y + ch / 2);
        knot(x, y + ch / 2, x + cw / 2, y);
      }
    }
    // Small filled diamonds where the lattice meets, on alternate rows.
    g.fillStyle = 'rgba(62,54,46,0.7)';
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i < cols; i++) {
        if ((i + j) % 2) continue;
        const x = margin + i * cw + cw / 2;
        const y = margin + j * ch;
        g.beginPath();
        g.moveTo(x, y - 7);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 7);
        g.lineTo(x - 5, y);
        g.fill();
      }
    }
    // Wool pile: tiny light and dark tufts over everything, lines included.
    // (two batched paths: one fill per tone instead of one per tuft)
    const tufts = [new Path2D(), new Path2D()];
    for (let i = 0; i < 42000; i++) {
      const x = r() * W;
      const y = r() * H;
      tufts[r() < 0.55 ? 0 : 1].rect(x, y, 1.2 + r() * 2.2, 1.2 + r() * 2.2);
    }
    g.fillStyle = 'rgba(252,249,242,0.32)';
    g.fill(tufts[0]);
    g.fillStyle = 'rgba(150,138,122,0.2)';
    g.fill(tufts[1]);
    addNoise(g, W, H, 8, 67);
  });
}

/** Abstract coastal painting (landscape). */
function artCoastal() {
  const W = 1024;
  const H = 720;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(71);
    g.fillStyle = '#efe8dc';
    g.fillRect(0, 0, W, H);
    const stroke = (x, y, w, h, col, a, n = 26) => {
      for (let i = 0; i < n; i++) {
        g.fillStyle = rgba(jitter(col, r, 12), a * (0.4 + r() * 0.6));
        const yy = y + (r() - 0.5) * h * 0.3;
        g.beginPath();
        g.ellipse(x + (r() - 0.5) * w * 0.15 + w / 2, yy + h / 2, w / 2 * (0.7 + r() * 0.3), h / 2 * (0.3 + r() * 0.5), (r() - 0.5) * 0.06, 0, TAU);
        g.fill();
      }
    };
    stroke(40, 40, 950, 230, [168, 196, 212], 0.25, 60); // sky
    stroke(80, 250, 880, 110, [36, 64, 96], 0.28, 50); // deep sea band
    stroke(60, 330, 920, 90, [72, 128, 150], 0.22, 40);
    stroke(40, 420, 950, 250, [214, 186, 140], 0.22, 60); // sand
    // gestural white strokes
    for (let i = 0; i < 16; i++) {
      g.strokeStyle = `rgba(252,250,244,${0.35 + r() * 0.4})`;
      g.lineWidth = 4 + r() * 16;
      g.lineCap = 'round';
      g.beginPath();
      const x = 80 + r() * 800;
      const y = 280 + r() * 200;
      g.moveTo(x, y);
      g.bezierCurveTo(x + 60, y - 20 - r() * 30, x + 120, y + 20, x + 160 + r() * 120, y - 10);
      g.stroke();
    }
    // a thin gold horizon
    g.strokeStyle = 'rgba(196,158,80,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(90, 262);
    g.bezierCurveTo(400, 258, 700, 266, 940, 260);
    g.stroke();
    addNoise(g, W, H, 10, 73);
  });
}

/** Mid-century arches and sun (portrait). */
function artArches() {
  const W = 640;
  const H = 820;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(79);
    g.fillStyle = '#eee4d3';
    g.fillRect(0, 0, W, H);
    const fillTextured = (path, col) => {
      g.save();
      path();
      g.clip();
      g.fillStyle = rgba(col, 1);
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = rgba(jitter(col, r, 22), 0.25);
        g.fillRect(r() * W, r() * H, 20 + r() * 60, 2 + r() * 4);
      }
      g.restore();
    };
    // terracotta arch
    fillTextured(() => {
      g.beginPath();
      g.moveTo(90, 760);
      g.lineTo(90, 430);
      g.arc(270, 430, 180, Math.PI, 0);
      g.lineTo(450, 760);
      g.closePath();
    }, [184, 94, 58]);
    // sage half circle
    fillTextured(() => {
      g.beginPath();
      g.arc(430, 760, 150, Math.PI, 0);
      g.closePath();
    }, [142, 156, 124]);
    // mustard sun
    fillTextured(() => {
      g.beginPath();
      g.arc(430, 250, 95, 0, TAU);
    }, [214, 160, 64]);
    // navy thin arch outline
    g.strokeStyle = 'rgba(40,52,74,0.9)';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(150, 760);
    g.lineTo(150, 520);
    g.arc(260, 520, 110, Math.PI, 0);
    g.lineTo(370, 760);
    g.stroke();
    addNoise(g, W, H, 10, 83);
  });
}

/** Tidal abstract (landscape): layered sea washes under a pale sun, raw linen border. */
function artTide() {
  const W = 1024;
  const H = 700;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(227);
    g.fillStyle = '#f1ebe0';
    g.fillRect(0, 0, W, H);
    const m = 46; // unpainted linen border
    g.save();
    g.beginPath();
    g.rect(m, m, W - m * 2, H - m * 2);
    g.clip();
    const sky = g.createLinearGradient(0, m, 0, H * 0.5);
    sky.addColorStop(0, '#e9dccb');
    sky.addColorStop(1, '#f3e4cf');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // pale sun
    const sun = g.createRadialGradient(W * 0.64, H * 0.34, 0, W * 0.64, H * 0.34, 120);
    sun.addColorStop(0, 'rgba(236,168,110,0.95)');
    sun.addColorStop(0.72, 'rgba(232,160,104,0.85)');
    sun.addColorStop(1, 'rgba(232,160,104,0)');
    g.fillStyle = sun;
    g.beginPath();
    g.arc(W * 0.64, H * 0.34, 120, 0, TAU);
    g.fill();
    // sea washes: wobbly horizontal bands, dark to light toward the shore
    const bands = [
      [0.46, [34, 70, 96], 0.95],
      [0.53, [48, 98, 122], 0.9],
      [0.6, [80, 134, 150], 0.85],
      [0.67, [128, 170, 172], 0.8],
      [0.73, [196, 206, 196], 0.75],
      [0.78, [214, 190, 150], 0.95],
      [0.88, [196, 164, 120], 0.95],
    ];
    for (const [y0, col, a] of bands) {
      for (let k = 0; k < 5; k++) {
        g.fillStyle = rgba(jitter(col, r, 10), a * 0.35);
        g.beginPath();
        const yy = H * y0 + (r() - 0.5) * 10;
        g.moveTo(0, yy);
        for (let x = 0; x <= W; x += 32) g.lineTo(x, yy + Math.sin(x * 0.012 + k + y0 * 9) * 6 + (r() - 0.5) * 5);
        g.lineTo(W, H);
        g.lineTo(0, H);
        g.fill();
      }
    }
    // dry-brush highlights
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(250,246,236,${0.12 + r() * 0.25})`;
      g.fillRect(r() * W, H * (0.45 + r() * 0.35), 30 + r() * 140, 1 + r() * 2.5);
    }
    g.restore();
    addNoise(g, W, H, 9, 229);
  });
}

/** Open rattan lattice for pendant shades (alpha). Covers one UV repeat. */
function rattanLattice() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    g.clearRect(0, 0, S, S);
    const n = 4;
    const step = S / n;
    const strand = (dir) => {
      for (let i = -n; i <= n * 2; i++) {
        const off = i * step;
        g.strokeStyle = 'rgba(92,60,28,1)';
        g.lineWidth = 34;
        g.beginPath();
        if (dir > 0) {
          g.moveTo(off - S, 0);
          g.lineTo(off, S);
        } else {
          g.moveTo(off + S, 0);
          g.lineTo(off, S);
        }
        g.stroke();
        g.strokeStyle = 'rgba(196,146,82,1)';
        g.lineWidth = 26;
        g.stroke();
        g.strokeStyle = 'rgba(226,184,120,0.9)';
        g.lineWidth = 8;
        g.stroke();
      }
    };
    strand(1);
    strand(-1);
    // horizontal binding rings
    for (let y = step / 2; y < S; y += step) {
      g.fillStyle = 'rgba(120,80,40,1)';
      g.fillRect(0, y - 6, S, 12);
      g.fillStyle = 'rgba(206,160,98,1)';
      g.fillRect(0, y - 4, S, 6);
    }
  });
}

/**
 * Seagrass basket weave for the bin: u wraps once around, v spans the full height.
 * Returns { map, bump }.
 */
function basketWeave(rows = 36, stakes = 64) {
  const W = 1024;
  const H = 512;
  const rh = H / rows;
  const sw = W / stakes;
  const r = rng(89);
  const rowColor = [];
  for (let j = 0; j < rows; j++) {
    // dyed chocolate stripes near the base and just under the rim band
    const dyed = j === 4 || j === 5 || j === 7;
    rowColor.push(dyed ? [70, 48, 32] : jitter([182, 154, 98], r, 14));
  }
  const draw = (g, bump) => {
    g.fillStyle = bump ? '#000' : '#3a2a18';
    g.fillRect(0, 0, W, H);
    for (let j = 0; j < rows; j++) {
      const y = H - (j + 1) * rh; // row 0 at the bottom (v = 0)
      for (let i = 0; i < stakes; i++) {
        const x = i * sw;
        const over = (i + j) % 2 === 0; // weaver passes over this stake
        const col = rowColor[j];
        if (over) {
          // twisted weaver segment
          if (bump) {
            const grd = g.createLinearGradient(0, y, 0, y + rh);
            grd.addColorStop(0, '#222');
            grd.addColorStop(0.5, '#fff');
            grd.addColorStop(1, '#222');
            g.fillStyle = grd;
          } else g.fillStyle = rgba(col, 1);
          g.fillRect(x - 1, y + 1, sw + 2, rh - 2);
          if (!bump) {
            g.strokeStyle = rgba([col[0] * 0.72, col[1] * 0.72, col[2] * 0.72], 0.8);
            g.lineWidth = 1.4;
            for (let k = -2; k < 4; k++) {
              g.beginPath();
              g.moveTo(x + k * 5, y + rh - 1);
              g.lineTo(x + k * 5 + rh * 0.8, y + 1);
              g.stroke();
            }
            g.fillStyle = 'rgba(255,240,200,0.18)';
            g.fillRect(x, y + rh * 0.3, sw, rh * 0.18);
          }
        } else {
          // flat stake crossing over the weaver
          const sx = x + sw * 0.18;
          const w = sw * 0.64;
          if (bump) {
            const grd = g.createLinearGradient(sx, 0, sx + w, 0);
            grd.addColorStop(0, '#333');
            grd.addColorStop(0.5, '#eee');
            grd.addColorStop(1, '#333');
            g.fillStyle = grd;
          } else {
            const sc = jitter([160, 128, 76], r, 10);
            g.fillStyle = rgba(sc, 1);
          }
          g.fillRect(sx, y - 1, w, rh + 2);
          if (!bump) {
            g.fillStyle = 'rgba(40,24,10,0.35)';
            g.fillRect(sx - 1.5, y, 1.5, rh);
            g.fillRect(sx + w, y, 1.5, rh);
          }
        }
      }
    }
    if (!bump) addNoise(g, W, H, 8, 97);
  };
  const map = makeCanvasTexture(W, H, (g) => draw(g, false), { anisotropy: 8 });
  const bump = makeCanvasTexture(W, H, (g) => draw(g, true), { color: false });
  for (const t of [map, bump]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return { map, bump };
}

/** Twisted rope, strands diagonal. u along the rope. */
function rope() {
  const W = 512;
  const H = 64;
  return makeCanvasTexture(W, H, (g) => {
    g.fillStyle = '#2e1e12';
    g.fillRect(0, 0, W, H);
    const n = 48;
    for (let i = -4; i < n + 4; i++) {
      const x = (i / n) * W;
      g.fillStyle = i % 3 === 0 ? '#6b4428' : i % 3 === 1 ? '#5a3820' : '#77502f';
      g.beginPath();
      g.moveTo(x, H);
      g.lineTo(x + 7, H);
      g.lineTo(x + 7 + 26, 0);
      g.lineTo(x + 26, 0);
      g.fill();
      g.fillStyle = 'rgba(255,220,170,0.18)';
      g.fillRect(x + 12, H * 0.45, 6, 3);
    }
    addNoise(g, W, H, 10, 101);
  });
}

/** Cognac leather strap with edge stitching. u along the strap. */
function strap() {
  const W = 1024;
  const H = 64;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(103);
    g.fillStyle = '#7a3f1d';
    g.fillRect(0, 0, W, H);
    blotches(g, W, H, r, 60, 24, [150, 86, 44], [80, 36, 14], 0.35);
    g.fillStyle = 'rgba(40,18,6,0.6)';
    g.fillRect(0, 0, W, 3);
    g.fillRect(0, H - 3, W, 3);
    g.fillStyle = 'rgba(236,214,176,0.85)';
    for (let x = 0; x < W; x += 12) {
      g.fillRect(x, 10, 7, 2.5);
      g.fillRect(x, H - 13, 7, 2.5);
    }
    addNoise(g, W, H, 8, 107);
  });
}

/** Teak decking, planks along v. Covers 2 m. */
function teak() {
  const S = 1024;
  const planks = 14;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(109);
    g.fillStyle = '#3b2c1f';
    g.fillRect(0, 0, S, S);
    const pw = S / planks;
    for (let i = 0; i < planks; i++) {
      let y = -r() * S;
      while (y < S) {
        const len = S * (0.6 + r() * 0.8);
        const col = jitter([150, 116, 84], r, 18);
        for (const off of [0, S]) {
          const yy = y + off;
          if (yy > S || yy + len < 0) continue;
          g.fillStyle = rgba(col, 1);
          g.fillRect(i * pw + 2, yy + 1, pw - 4, len - 2);
          grainLines(g, i * pw + 2, yy + 1, pw - 4, len - 2, rng(i * 131 + Math.floor(yy)), 30, [96, 68, 44], [196, 170, 140]);
        }
        y += len;
      }
    }
    addNoise(g, S, S, 9, 113);
  }, { anisotropy: 16 });
}

/** Fine sand. Covers 3 m. */
function sand() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(127);
    g.fillStyle = '#e4d2ad';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, r, 80, 80, [240, 226, 196], [206, 186, 148], 0.35);
    for (let i = 0; i < 18; i++) {
      g.strokeStyle = `rgba(190,168,128,${0.08 + r() * 0.08})`;
      g.lineWidth = 3 + r() * 5;
      const y0 = r() * S;
      g.beginPath();
      for (let x = -10; x <= S + 10; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.03 + i) * 10);
      g.stroke();
    }
    addNoise(g, S, S, 22, 131);
  });
}

/** Palm trunk rings. u around, v along ~3 m. */
function palmBark() {
  const W = 256;
  const H = 512;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(137);
    g.fillStyle = '#8c7b66';
    g.fillRect(0, 0, W, H);
    blotches(g, W, H, r, 60, 40, [170, 156, 136], [104, 90, 74], 0.4);
    for (let y = 0; y < H; y += 9 + r() * 8) {
      g.fillStyle = `rgba(70,56,42,${0.35 + r() * 0.3})`;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 2 + r() * 1.5);
      g.lineTo(W, y + 3.5);
      g.lineTo(0, y + 3.5);
      g.fill();
      g.fillStyle = 'rgba(200,188,170,0.25)';
      g.fillRect(0, y + 4, W, 1.5);
    }
    addNoise(g, W, H, 12, 139);
  });
}

/** Coconut palm frond: midrib + leaflets on transparent. u across (0..1), v base (0) -> tip (1). */
function palmFrond() {
  const W = 256;
  const H = 1024;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(149);
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    // canvas y = 0 is the tip (v = 1)
    const n = 46;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n; // 0 base -> 1 tip
        const y = H * (1 - t) - 8;
        const len = (W / 2 - 6) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.08)), 0.6);
        const ang = 0.55 + (r() - 0.5) * 0.15; // radians toward the tip
        const ex = cx + side * len * Math.cos(ang);
        const ey = y - len * Math.sin(ang) * 0.9;
        const w0 = 5 + 4 * Math.sin(Math.PI * t);
        const col = r() < 0.2 ? [128, 138, 64] : jitter([66, 96, 40], r, 16);
        g.fillStyle = rgba(col, 1);
        g.beginPath();
        g.moveTo(cx, y - w0);
        g.quadraticCurveTo((cx + ex) / 2, (y + ey) / 2 - w0 * 1.1, ex, ey);
        g.quadraticCurveTo((cx + ex) / 2, (y + ey) / 2 + w0 * 0.6, cx, y + w0);
        g.fill();
        g.strokeStyle = 'rgba(160,170,90,0.5)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx, y);
        g.quadraticCurveTo((cx + ex) / 2, (y + ey) / 2 - w0 * 0.2, ex, ey);
        g.stroke();
      }
    }
    // midrib
    g.fillStyle = '#9a9a5a';
    g.beginPath();
    g.moveTo(cx - 6, H);
    g.lineTo(cx + 6, H);
    g.lineTo(cx + 1, 0);
    g.lineTo(cx - 1, 0);
    g.fill();
  });
}

/** Olive twigs with slim silver-green leaves on transparent (for foliage cards). */
function oliveLeaves() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(151);
    g.clearRect(0, 0, S, S);
    const leaf = (x, y, a, len) => {
      const col = r() < 0.4 ? [168, 176, 146] : jitter([104, 118, 80], r, 14);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.fillStyle = rgba(col, 1);
      g.beginPath();
      g.ellipse(len / 2, 0, len / 2, len * 0.11, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(220,226,200,0.35)';
      g.fillRect(2, -0.6, len - 4, 1.2);
      g.restore();
    };
    for (let b = 0; b < 12; b++) {
      let x = S / 2 + (r() - 0.5) * 60;
      let y = S * 0.95;
      let a = -Math.PI / 2 + (r() - 0.5) * 1.8;
      g.strokeStyle = 'rgba(92,80,60,1)';
      g.lineWidth = 2.5;
      const pts = [];
      for (let k = 0; k < 16; k++) {
        a += (r() - 0.5) * 0.3;
        const nx = x + Math.cos(a) * 22;
        const ny = y + Math.sin(a) * 22;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(nx, ny);
        g.stroke();
        x = nx;
        y = ny;
        pts.push([x, y, a]);
        if (x < 10 || x > S - 10 || y < 10) break;
      }
      for (const [px, py, pa] of pts) {
        for (let q = 0; q < 3; q++) leaf(px, py, pa + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7), 26 + r() * 20);
      }
    }
  });
}

/** Fiddle-leaf fig leaf (violin shape, veins) on transparent. v base -> tip. */
function figLeaf() {
  const W = 256;
  const H = 256;
  return makeCanvasTexture(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    const outline = () => {
      g.beginPath();
      g.moveTo(cx, H - 6);
      g.bezierCurveTo(cx - 60, H - 30, cx - 70, H * 0.55, cx - 88, H * 0.34);
      g.bezierCurveTo(cx - 100, H * 0.12, cx - 30, 4, cx, 10);
      g.bezierCurveTo(cx + 30, 4, cx + 100, H * 0.12, cx + 88, H * 0.34);
      g.bezierCurveTo(cx + 70, H * 0.55, cx + 60, H - 30, cx, H - 6);
      g.closePath();
    };
    outline();
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, '#2c4a1f');
    grd.addColorStop(0.5, '#3f6329');
    grd.addColorStop(1, '#2a451c');
    g.fillStyle = grd;
    g.fill();
    g.save();
    outline();
    g.clip();
    g.strokeStyle = 'rgba(150,176,98,0.75)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, H);
    g.lineTo(cx, 12);
    g.stroke();
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(140,168,92,0.5)';
    for (let i = 0; i < 9; i++) {
      const y = H - 30 - i * 24;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx, y);
        g.quadraticCurveTo(cx + s * 40, y - 14, cx + s * 95, y - 36);
        g.stroke();
      }
    }
    g.restore();
  });
}

/** Glass mosaic pool tiles. Covers 1 m. */
function poolTile() {
  const S = 512;
  const n = 20;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(163);
    g.fillStyle = '#e8f0ee';
    g.fillRect(0, 0, S, S);
    const t = S / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const pick = r();
        const col = pick < 0.5 ? [52, 170, 176] : pick < 0.8 ? [86, 196, 196] : [36, 132, 150];
        g.fillStyle = rgba(jitter(col, r, 12), 1);
        g.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3);
      }
    }
    addNoise(g, S, S, 6, 167);
  });
}

/** Travertine: warm beige with horizontal veining and pits. Covers 1.2 m. */
function travertine() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(173);
    g.fillStyle = '#d8c7a8';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const y = r() * S;
      g.fillStyle = rgba(r() < 0.5 ? [232, 220, 198] : [190, 172, 142], 0.25 + r() * 0.3);
      g.fillRect(0, y, S, 2 + r() * 10);
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(150,128,96,0.5)';
      g.beginPath();
      g.ellipse(r() * S, r() * S, 1 + r() * 4, 0.6 + r() * 1.2, 0, 0, TAU);
      g.fill();
    }
    addNoise(g, S, S, 6, 179);
  });
}

/** Dark walnut grain along u. Covers 1.2 m. */
function walnut() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(181);
    g.fillStyle = '#5a3c26';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, r, 40, 80, [110, 76, 50], [60, 38, 24], 0.4);
    grainLines(g, 0, 0, S, S, r, 110, [40, 24, 14], [140, 100, 66], false);
    addNoise(g, S, S, 7, 191);
  });
}

/** Neutral mottled noise to tint via material.color (ceramics, concrete, terracotta). Covers 0.8 m. */
function mottle() {
  const S = 512;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(193);
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, S, S);
    blotches(g, S, S, r, 120, 60, [245, 245, 245], [170, 170, 170], 0.35);
    addNoise(g, S, S, 14, 197);
  });
}

/** Sheer linen voile for curtains (tinted in the material). Covers 0.4 m. */
function voile() {
  const S = 256;
  return makeCanvasTexture(S, S, (g) => {
    const r = rng(199);
    g.fillStyle = '#f6f2ea';
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) {
      g.fillStyle = `rgba(210,200,184,${0.1 + r() * 0.15})`;
      g.fillRect(0, y, S, 1);
    }
    for (let x = 0; x < S; x += 2) {
      g.fillStyle = `rgba(214,204,188,${0.08 + r() * 0.1})`;
      g.fillRect(x, 0, 1, S);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(200,188,168,0.3)';
      g.fillRect(r() * S, 0, 1.5, S);
    }
  });
}

/** Soft pampas plume (alpha): feathery wisps. v base -> tip. */
function plume() {
  const W = 128;
  const H = 512;
  return makeCanvasTexture(W, H, (g) => {
    const r = rng(211);
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      const t = r();
      const y = H * (1 - t);
      const spread = Math.sin(Math.PI * Math.min(1, t * 1.15)) * (W * 0.45);
      const x = W / 2 + (r() - 0.5) * 2 * spread;
      g.strokeStyle = `rgba(${236 + r() * 14},${222 + r() * 16},${196 + r() * 20},${0.25 + r() * 0.35})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(W / 2 + (x - W / 2) * 0.2, y + 14);
      g.lineTo(x, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(190,170,130,1)';
    g.fillRect(W / 2 - 1, H * 0.15, 2, H * 0.85);
  });
}

/**
 * Build every texture the level needs. The returned object is also the dispose list.
 * @param {number} [maxAnisotropy=8]
 * @param {() => Promise<void>} [checkpoint] awaited between textures so the build can yield
 */
export async function createBeachTextures(maxAnisotropy = 8, checkpoint = makeYielder()) {
  const builders = {
    oak: oakFloor,
    plaster,
    ceiling: ceilingBoards,
    paleOak,
    boucle,
    linen,
    leather,
    marble,
    rug,
    artCoastal,
    artArches,
    artTide,
    rattan: rattanLattice,
    rope,
    strap,
    teak,
    sand,
    bark: palmBark,
    frond: palmFrond,
    olive: oliveLeaves,
    figLeaf,
    tile: poolTile,
    travertine,
    walnut,
    mottle,
    voile,
    plume,
  };
  const t = {};
  for (const [key, build] of Object.entries(builders)) {
    t[key] = build();
    await checkpoint();
  }
  const weave = basketWeave();
  t.weave = weave.map;
  t.weaveBump = weave.bump;

  // Metric repeats (1 / meters covered) for the tileable ones.
  const metric = {
    oak: [1 / 2.4, 1 / 4.8],
    plaster: [1 / 3, 1 / 3],
    ceiling: [1 / 1.5, 1 / 1.5],
    paleOak: [1 / 1.2, 1 / 1.2],
    boucle: [1 / 0.25, 1 / 0.25],
    linen: [1 / 0.2, 1 / 0.2],
    leather: [1 / 0.5, 1 / 0.5],
    marble: [1 / 1.4, 1 / 1.4],
    teak: [1 / 2, 1 / 2],
    sand: [1 / 3, 1 / 3],
    tile: [1, 1],
    travertine: [1 / 1.2, 1 / 1.2],
    walnut: [1 / 1.2, 1 / 1.2],
    mottle: [1 / 0.8, 1 / 0.8],
    voile: [1 / 0.4, 1 / 0.4],
  };
  for (const [k, rep] of Object.entries(metric)) {
    const tex = t[k];
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rep[0], rep[1]);
  }
  t.rattan.wrapS = t.rattan.wrapT = THREE.RepeatWrapping; // tiled by the shade geometry's UVs
  for (const k of ['oak', 'teak', 'rug', 'sand']) t[k].anisotropy = maxAnisotropy;
  return t;
}
