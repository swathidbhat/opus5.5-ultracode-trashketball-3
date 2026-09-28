import { rng } from '../../utils/canvasTexture.js';

// Oil portrait of the company founder, painted procedurally: a stern old man with a receding
// white mane and mutton chops, black frock coat and wing collar, lit from the upper left against
// a dark umber ground. The broad masses are painted at a third of the resolution and upscaled,
// which softens their edges like a blur (canvas blur filters are far too slow on CPU canvases),
// then the features go on at full resolution and the whole canvas is re-brushed with colour
// sampled from itself so it reads as paint rather than vector shapes.

const LOW_RES = 3;

/**
 * Paint the portrait into ctx (already translated/clipped to its w x h rect).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
export function drawPortrait(ctx, w, h) {
  const r = rng(1865);
  const face = { cx: w * 0.5, cy: h * 0.35, fw: w * 0.15, fh: h * 0.145 };

  const lo = document.createElement('canvas');
  lo.width = Math.ceil(w / LOW_RES);
  lo.height = Math.ceil(h / LOW_RES);
  const l = lo.getContext('2d');
  l.scale(lo.width / w, lo.height / h);
  paintGround(l, w, h, r, face);
  paintCoat(l, w, h, face.cx);
  paintNeckAndEars(l, face);
  paintFaceMasses(l, face);
  paintHairMasses(l, face);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lo, 0, 0, w, h);
  ctx.restore();

  paintFeatures(ctx, face);
  paintHairStrokes(ctx, r, face);
  rebrush(ctx, w, h, r);
  varnish(ctx, w, h, r);
}

function ellipse(ctx, x, y, rx, ry, color, rot = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function radial(ctx, x, y, rad, inner, outer = 'rgba(0,0,0,0)') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}

function line(ctx, pts, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === 4) ctx.lineTo(pts[2], pts[3]);
  else ctx.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]);
  ctx.stroke();
}

/** Short curved strokes scattered in an elliptical region. */
function strokes(ctx, r, { n, x, y, rx, ry, colors, len, width, alpha, angle = Math.PI * 0.25, spread = 1.2 }) {
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const px = x + Math.cos(a) * rx * d;
    const py = y + Math.sin(a) * ry * d;
    const ang = angle + (r() - 0.5) * spread;
    const l = len * (0.5 + r());
    ctx.strokeStyle = colors[Math.floor(r() * colors.length)];
    ctx.globalAlpha = alpha * (0.5 + r() * 0.5);
    ctx.lineWidth = width * (0.5 + r());
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + Math.cos(ang) * l * 0.5 + (r() - 0.5) * l * 0.3, py + Math.sin(ang) * l * 0.5, px + Math.cos(ang) * l, py + Math.sin(ang) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- broad masses (low resolution)

function paintGround(ctx, w, h, r, { cx, cy }) {
  const bg = ctx.createRadialGradient(cx - w * 0.08, cy - h * 0.04, 20, cx, h * 0.5, h * 0.78);
  bg.addColorStop(0, '#6f5a37');
  bg.addColorStop(0.4, '#3d2f1c');
  bg.addColorStop(1, '#110c07');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  strokes(ctx, r, { n: 700, x: w / 2, y: h / 2, rx: w * 0.75, ry: h * 0.75, colors: ['#4d3d25', '#2b2216', '#5f4b2d', '#1c150d', '#6a5634'], len: 80, width: 20, alpha: 0.3 });
}

function paintCoat(ctx, w, h, cx) {
  const neckY = h * 0.545;
  ctx.fillStyle = '#16131a';
  ctx.beginPath();
  ctx.moveTo(-10, h + 10);
  ctx.lineTo(-10, h * 0.86);
  ctx.bezierCurveTo(w * 0.06, h * 0.74, w * 0.2, h * 0.66, cx - w * 0.11, neckY);
  ctx.lineTo(cx + w * 0.11, neckY);
  ctx.bezierCurveTo(w * 0.8, h * 0.66, w * 0.94, h * 0.74, w + 10, h * 0.86);
  ctx.lineTo(w + 10, h + 10);
  ctx.closePath();
  ctx.fill();
  // Light catching the left shoulder and sleeve.
  radial(ctx, w * 0.2, h * 0.74, w * 0.26, 'rgba(92,84,92,0.55)');
  radial(ctx, w * 0.78, h * 0.78, w * 0.2, 'rgba(50,45,52,0.35)');

  // Shirt front between the lapels, then the wing collar.
  ctx.fillStyle = '#e4dccb';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.1, neckY - h * 0.012);
  ctx.lineTo(cx + w * 0.1, neckY - h * 0.012);
  ctx.lineTo(cx + w * 0.065, h * 0.7);
  ctx.lineTo(cx, h * 0.8);
  ctx.lineTo(cx - w * 0.065, h * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f1ebdc';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.1, neckY - h * 0.03);
    ctx.lineTo(cx + s * w * 0.02, neckY + h * 0.012);
    ctx.lineTo(cx + s * w * 0.075, neckY + h * 0.03);
    ctx.closePath();
    ctx.fill();
  }
  radial(ctx, cx + w * 0.07, h * 0.66, w * 0.08, 'rgba(90,80,70,0.35)');

  // Black silk stock tied at the throat.
  ellipse(ctx, cx, neckY + h * 0.022, w * 0.055, h * 0.02, '#1f1a22');
  ellipse(ctx, cx - w * 0.045, neckY + h * 0.028, w * 0.035, h * 0.022, '#221c26', -0.3);
  ellipse(ctx, cx + w * 0.045, neckY + h * 0.028, w * 0.035, h * 0.022, '#1a151d', 0.3);
  ctx.fillStyle = '#1d1820';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.03, neckY + h * 0.04);
  ctx.lineTo(cx + w * 0.03, neckY + h * 0.04);
  ctx.lineTo(cx + w * 0.012, h * 0.69);
  ctx.lineTo(cx - w * 0.012, h * 0.69);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, cx - w * 0.008, neckY + h * 0.02, 4, 4, 'rgba(210,190,140,0.8)'); // pin

  // Lapels: a shade lighter than the coat with a lit edge on the left.
  ctx.fillStyle = '#231f27';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * w * 0.1, neckY + h * 0.005);
    ctx.lineTo(cx + s * w * 0.066, h * 0.7);
    ctx.lineTo(cx + s * w * 0.02, h * 0.86);
    ctx.lineTo(cx + s * w * 0.2, h * 0.74);
    ctx.lineTo(cx + s * w * 0.15, h * 0.66);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(120,110,118,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.1, neckY + h * 0.005);
  ctx.lineTo(cx - w * 0.066, h * 0.7);
  ctx.lineTo(cx - w * 0.02, h * 0.86);
  ctx.stroke();
}

function facePath(ctx, { cx, cy, fw, fh }) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - fh * 1.05);
  ctx.bezierCurveTo(cx + fw * 0.75, cy - fh * 1.05, cx + fw * 1.02, cy - fh * 0.55, cx + fw * 1.0, cy - fh * 0.05);
  ctx.bezierCurveTo(cx + fw * 0.98, cy + fh * 0.45, cx + fw * 0.62, cy + fh * 0.95, cx, cy + fh * 1.0);
  ctx.bezierCurveTo(cx - fw * 0.62, cy + fh * 0.95, cx - fw * 0.98, cy + fh * 0.45, cx - fw * 1.0, cy - fh * 0.05);
  ctx.bezierCurveTo(cx - fw * 1.02, cy - fh * 0.55, cx - fw * 0.75, cy - fh * 1.05, cx, cy - fh * 1.05);
  ctx.closePath();
}

function paintNeckAndEars(ctx, { cx, cy, fw, fh }) {
  ctx.fillStyle = '#946650';
  ctx.fillRect(cx - fw * 0.5, cy + fh * 0.5, fw * 1.0, fh * 0.9);
  // Ears, half hidden by the whiskers later.
  ellipse(ctx, cx - fw * 1.02, cy + fh * 0.02, fw * 0.16, fh * 0.26, '#c8977a', 0.15);
  ellipse(ctx, cx + fw * 1.02, cy + fh * 0.02, fw * 0.15, fh * 0.25, '#9c6c52', -0.15);
  // Shadow the chin throws on the neck.
  radial(ctx, cx + fw * 0.1, cy + fh * 1.1, fw * 0.7, 'rgba(55,32,22,0.75)');
}

function paintFaceMasses(ctx, f) {
  const { cx, cy, fw, fh } = f;
  ctx.fillStyle = '#cf9f80';
  facePath(ctx, f);
  ctx.fill();

  ctx.save();
  facePath(ctx, f);
  ctx.clip();
  // Form shadow on the far (right) side, light from the upper left.
  const side = ctx.createLinearGradient(cx - fw * 0.3, 0, cx + fw * 1.05, 0);
  side.addColorStop(0, 'rgba(90,50,35,0)');
  side.addColorStop(1, 'rgba(85,45,30,0.62)');
  ctx.fillStyle = side;
  ctx.fillRect(cx - fw * 1.2, cy - fh * 1.2, fw * 2.4, fh * 2.4);
  const under = ctx.createLinearGradient(0, cy + fh * 0.4, 0, cy + fh * 1.05);
  under.addColorStop(0, 'rgba(90,50,35,0)');
  under.addColorStop(1, 'rgba(80,45,30,0.45)');
  ctx.fillStyle = under;
  ctx.fillRect(cx - fw * 1.2, cy - fh * 1.2, fw * 2.4, fh * 2.4);
  // High, bald forehead and the lit cheek.
  radial(ctx, cx - fw * 0.3, cy - fh * 0.62, fw * 0.8, 'rgba(250,226,200,0.6)');
  radial(ctx, cx - fw * 0.52, cy + fh * 0.12, fw * 0.45, 'rgba(244,206,180,0.4)');
  radial(ctx, cx + fw * 0.5, cy + fh * 0.2, fw * 0.4, 'rgba(180,85,70,0.22)');
  radial(ctx, cx - fw * 0.1, cy + fh * 0.72, fw * 0.3, 'rgba(236,196,168,0.35)'); // chin
  // Deep-set eye sockets under a heavy brow.
  ellipse(ctx, cx - fw * 0.4, cy - fh * 0.14, fw * 0.27, fh * 0.1, 'rgba(90,50,38,0.7)');
  ellipse(ctx, cx + fw * 0.4, cy - fh * 0.14, fw * 0.27, fh * 0.1, 'rgba(70,38,28,0.8)');
  // Nose: lit bridge, shadowed right flank, dark underside.
  line(ctx, [cx - fw * 0.05, cy + fh * 0.02, cx - fw * 0.07, cy + fh * 0.3], 'rgba(248,218,192,0.55)', 7);
  line(ctx, [cx + fw * 0.1, cy + fh * 0.05, cx + fw * 0.13, cy + fh * 0.32], 'rgba(105,60,44,0.5)', 9);
  ellipse(ctx, cx + fw * 0.02, cy + fh * 0.37, fw * 0.2, fh * 0.045, 'rgba(85,45,34,0.6)');
  // Nasolabial folds.
  for (const s of [-1, 1]) {
    line(ctx, [cx + s * fw * 0.22, cy + fh * 0.3, cx + s * fw * 0.42, cy + fh * 0.5, cx + s * fw * 0.36, cy + fh * 0.66], 'rgba(110,64,50,0.5)', 5);
  }
  ctx.restore();
}

function paintHairMasses(ctx, { cx, cy, fw, fh }) {
  // Receding white mane swept back over the ears.
  ctx.fillStyle = '#d8d4cb';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * fw * 0.55, cy - fh * 0.95);
    ctx.bezierCurveTo(cx + s * fw * 1.05, cy - fh * 1.0, cx + s * fw * 1.32, cy - fh * 0.6, cx + s * fw * 1.22, cy - fh * 0.05);
    ctx.lineTo(cx + s * fw * 0.98, cy - fh * 0.2);
    ctx.bezierCurveTo(cx + s * fw * 1.0, cy - fh * 0.6, cx + s * fw * 0.85, cy - fh * 0.85, cx + s * fw * 0.5, cy - fh * 0.88);
    ctx.closePath();
    ctx.fill();
  }
  // Mutton chops down both jaws, stopping short of a clean-shaven chin.
  for (const s of [-1, 1]) {
    ctx.fillStyle = s < 0 ? '#d3cec4' : '#a8a398';
    ctx.beginPath();
    ctx.moveTo(cx + s * fw * 1.08, cy - fh * 0.22);
    ctx.bezierCurveTo(cx + s * fw * 1.18, cy + fh * 0.3, cx + s * fw * 0.95, cy + fh * 0.85, cx + s * fw * 0.55, cy + fh * 0.92);
    ctx.bezierCurveTo(cx + s * fw * 0.5, cy + fh * 0.72, cx + s * fw * 0.66, cy + fh * 0.5, cx + s * fw * 0.78, cy + fh * 0.2);
    ctx.bezierCurveTo(cx + s * fw * 0.84, cy + fh * 0.0, cx + s * fw * 0.86, cy - fh * 0.15, cx + s * fw * 0.86, cy - fh * 0.24);
    ctx.closePath();
    ctx.fill();
  }
}

// ---------------------------------------------------------------- features (full resolution)

function paintFeatures(ctx, { cx, cy, fw, fh }) {
  const eyeY = cy - fh * 0.14;
  for (const s of [-1, 1]) {
    const ex = cx + s * fw * 0.4;
    ellipse(ctx, ex, eyeY + 1, fw * 0.14, fh * 0.035, 'rgba(210,190,170,0.7)');
    ellipse(ctx, ex + fw * 0.02, eyeY + 1, fw * 0.055, fh * 0.034, '#2a211c');
    line(ctx, [ex - fw * 0.16, eyeY + 2, ex, eyeY - fh * 0.05, ex + fw * 0.16, eyeY + 1], 'rgba(60,35,28,0.9)', 3);
    ellipse(ctx, ex - fw * 0.01, eyeY - 1, 1.6, 1.6, 'rgba(255,245,230,0.85)');
  }
  // Thin, turned-down mouth with a lit lower lip.
  line(ctx, [cx - fw * 0.3, cy + fh * 0.58, cx, cy + fh * 0.54, cx + fw * 0.3, cy + fh * 0.59], '#5e342a', 4);
  line(ctx, [cx - fw * 0.18, cy + fh * 0.63, cx + fw * 0.1, cy + fh * 0.63], 'rgba(232,190,165,0.45)', 3);
  // Brow wrinkles.
  for (const k of [-0.62, -0.5]) {
    line(ctx, [cx - fw * 0.5, cy + fh * k, cx, cy + fh * (k - 0.05), cx + fw * 0.5, cy + fh * k], 'rgba(120,75,58,0.3)', 2.5);
  }
}

function paintHairStrokes(ctx, r, { cx, cy, fw, fh }) {
  const white = ['#f3f1ea', '#e2dfd6', '#cdc9c0', '#b5b0a6', '#fbfaf5'];
  strokes(ctx, r, { n: 110, x: cx - fw * 0.98, y: cy - fh * 0.55, rx: fw * 0.22, ry: fh * 0.36, colors: white, len: 26, width: 4, alpha: 0.55, angle: Math.PI * 0.6, spread: 0.25 });
  strokes(ctx, r, { n: 110, x: cx + fw * 0.98, y: cy - fh * 0.55, rx: fw * 0.22, ry: fh * 0.36, colors: white.slice(1), len: 26, width: 4, alpha: 0.45, angle: Math.PI * 0.4, spread: 0.25 });
  // Thin wisps across the crown.
  strokes(ctx, r, { n: 40, x: cx, y: cy - fh * 0.98, rx: fw * 0.6, ry: fh * 0.05, colors: white, len: 26, width: 2, alpha: 0.4, angle: 0, spread: 0.6 });
  // Whiskers.
  strokes(ctx, r, { n: 140, x: cx - fw * 0.9, y: cy + fh * 0.32, rx: fw * 0.16, ry: fh * 0.45, colors: white, len: 18, width: 3, alpha: 0.45, angle: Math.PI * 0.55, spread: 0.4 });
  strokes(ctx, r, { n: 140, x: cx + fw * 0.9, y: cy + fh * 0.32, rx: fw * 0.16, ry: fh * 0.45, colors: white.slice(2), len: 18, width: 3, alpha: 0.35, angle: Math.PI * 0.45, spread: 0.4 });
  // Bushy white brows, knitted toward the nose.
  for (const s of [-1, 1]) {
    strokes(ctx, r, {
      n: 45,
      x: cx + s * fw * 0.4,
      y: cy - fh * 0.3,
      rx: fw * 0.22,
      ry: fh * 0.035,
      colors: white,
      len: 11,
      width: 3,
      alpha: 0.75,
      angle: s < 0 ? 0.25 : Math.PI - 0.25,
      spread: 0.5,
    });
  }
}

// ---------------------------------------------------------------- finish

/** Re-brush the whole canvas with short strokes of its own colour: turns shapes into paint. */
function rebrush(ctx, w, h, r) {
  const { e: ox, f: oy } = ctx.getTransform();
  const img = ctx.getImageData(ox, oy, w, h).data;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6000; i++) {
    const x = r() * w;
    const y = r() * h;
    const k = (Math.floor(y) * w + Math.floor(x)) * 4;
    const ang = (r() - 0.5) * 1.6 + Math.PI * 0.3;
    const len = 5 + r() * 12;
    ctx.strokeStyle = `rgb(${img[k]},${img[k + 1]},${img[k + 2]})`;
    ctx.globalAlpha = 0.35 + r() * 0.3;
    ctx.lineWidth = 2 + r() * 3.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Yellowed varnish, canvas weave, fine craquelure and a dark vignette. */
function varnish(ctx, w, h, r) {
  ctx.fillStyle = 'rgba(125,92,30,0.13)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  ctx.fillStyle = 'rgba(255,240,210,0.03)';
  for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
  ctx.strokeStyle = 'rgba(20,12,6,0.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    let x = r() * w;
    let y = r() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const vig = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.22, w / 2, h / 2, h * 0.74);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.58)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}
