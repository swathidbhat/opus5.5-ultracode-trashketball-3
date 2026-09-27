// Aiming guide (dotted predicted arc + impact marker) and flight trail (ribbon of the real path).
// Both use small custom shaders so they stay crisp and readable on bright and dark backgrounds:
// a light core, a saturated body and a thin dark outline.
import * as THREE from 'three';

// near/far colour the guide from the hand to the end of the arc; trailA/trailB colour the trail
// from the throw to the landing. The far ends are the more saturated colours because they are drawn
// smallest. good = the swish marker drawn in the bin opening.
const THEMES = {
  office: {
    core: '#effffd',
    near: '#2ee6dc', // Lumon terminal teal…
    far: '#1f9fe0', // …cooling to blue down the arc
    outline: '#06283a',
    good: '#5dffb0',
    trailA: '#4eeee6',
    trailB: '#1590d8',
  },
  beach: {
    core: '#fff7e0',
    near: '#ffc247', // gold…
    far: '#ff6b57', // …to coral
    outline: '#4a1a10',
    good: '#ffe45c',
    trailA: '#ffc54d',
    trailB: '#ff5746',
  },
};

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ guide

const DOT_SPACING = 0.105; // metres of arc between dots
const DOT_SIZE = 0.03; // world-space diameter of the nearest dots
const DOT_MIN_PX = 11; // CSS pixels: distant dots never get smaller than this…
const DOT_MAX_PX = 30; // …or bigger than this
const START_SKIP = 0.22; // keep the first bit of arc clear so dots don't crowd the hand
const MARCH_SPEED = 0.3; // m/s the dots drift along the arc, showing direction
const MAX_DOTS = 200;

// aSize is a world-space diameter, but distant dots are held to a minimum on-screen size so the
// far end of the arc stays readable (the shrink toward the end still applies proportionally).
const DOT_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aMix;
uniform float uPxScale;
uniform float uBaseSize;
uniform float uMinPx;
uniform float uMaxPx;
varying float vAlpha;
varying float vMix;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * uPxScale / max(-mv.z, 0.05);
  gl_PointSize = clamp(px, uMinPx * aSize / uBaseSize, uMaxPx);
  vAlpha = aAlpha;
  vMix = aMix;
}`;

const DOT_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uNear;
uniform vec3 uFar;
uniform vec3 uOutline;
varying float vAlpha;
varying float vMix;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0 || vAlpha < 0.004) discard;
  float aa = fwidth(d) * 1.2;
  vec3 body = mix(uNear, uFar, vMix);
  // Saturated disc with a small bright highlight, a dark outline, then a soft glow.
  vec3 inner = mix(uCore, body, smoothstep(0.0, 0.34, d));
  float disc = 1.0 - smoothstep(0.58 - aa, 0.58 + aa, d);
  float ring = 1.0 - smoothstep(0.76 - aa, 0.76 + aa, d);
  float glow = pow(1.0 - clamp((d - 0.74) / 0.26, 0.0, 1.0), 2.0) * 0.35;
  vec4 c = vec4(body, glow);
  c = mix(c, vec4(uOutline, 0.88), ring);
  c = mix(c, vec4(inner, 1.0), disc);
  gl_FragColor = vec4(c.rgb, c.a * vAlpha);
  #include <colorspace_fragment>
}`;

/** Dotted predicted arc shown while aiming, plus an impact marker in full-guide mode. */
export class TrajectoryGuide {
  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'TrajectoryGuide';

    const geo = new THREE.BufferGeometry();
    this._aPos = new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this._aSize = new THREE.BufferAttribute(new Float32Array(MAX_DOTS), 1).setUsage(THREE.DynamicDrawUsage);
    this._aAlpha = new THREE.BufferAttribute(new Float32Array(MAX_DOTS), 1).setUsage(THREE.DynamicDrawUsage);
    this._aMix = new THREE.BufferAttribute(new Float32Array(MAX_DOTS), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._aPos);
    geo.setAttribute('aSize', this._aSize);
    geo.setAttribute('aAlpha', this._aAlpha);
    geo.setAttribute('aMix', this._aMix);
    geo.setDrawRange(0, 0);
    this._dotUniforms = {
      uPxScale: { value: 500 },
      uBaseSize: { value: DOT_SIZE },
      uMinPx: { value: DOT_MIN_PX },
      uMaxPx: { value: DOT_MAX_PX },
      uCore: { value: new THREE.Color() },
      uNear: { value: new THREE.Color() },
      uFar: { value: new THREE.Color() },
      uOutline: { value: new THREE.Color() },
    };
    this._dotMat = new THREE.ShaderMaterial({
      uniforms: this._dotUniforms,
      vertexShader: DOT_VERT,
      fragmentShader: DOT_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this._dots = new THREE.Points(geo, this._dotMat);
    this._dots.frustumCulled = false;
    this._dots.renderOrder = 20;
    const size = new THREE.Vector2();
    this._dots.onBeforeRender = (renderer, scene, camera) => {
      // Pixels per metre at unit distance, so aSize is a world-space diameter.
      renderer.getDrawingBufferSize(size);
      const u = this._dotUniforms;
      u.uPxScale.value = size.y * 0.5 * camera.projectionMatrix.elements[5];
      u.uMinPx.value = DOT_MIN_PX * renderer.getPixelRatio();
      u.uMaxPx.value = DOT_MAX_PX * renderer.getPixelRatio();
    };
    this.object.add(this._dots);

    this._marker = this._buildMarker();
    this.object.add(this._marker);
    this._entry = this._buildEntryMarker();
    this.object.add(this._entry);
    this._clock = 0;
    this._lastNow = 0;
    this.setTheme('office');
  }

  _buildMarker() {
    const g = new THREE.Group();
    g.name = 'impactMarker';
    g.visible = false;
    const mat = (opacity) =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
    this._mkFill = new THREE.Mesh(new THREE.CircleGeometry(0.052, 40), mat(0.22));
    this._mkOutline = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.068, 48), mat(0.75));
    this._mkRing = new THREE.Mesh(new THREE.RingGeometry(0.054, 0.064, 48), mat(1));
    this._mkDot = new THREE.Mesh(new THREE.CircleGeometry(0.011, 20), mat(1));
    this._mkPulse = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.066, 48), mat(0.8));
    for (const m of [this._mkFill, this._mkOutline, this._mkRing, this._mkDot, this._mkPulse]) {
      m.renderOrder = 19;
      g.add(m);
    }
    return g;
  }

  /** Ring laid in the bin opening when the full guide predicts a clean swish. */
  _buildEntryMarker() {
    const g = new THREE.Group();
    g.name = 'entryMarker';
    g.visible = false;
    g.quaternion.setFromUnitVectors(Z_AXIS, Y_AXIS);
    const mat = (opacity) =>
      new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this._enFill = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.2));
    this._enOutline = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.8));
    this._enRing = new THREE.Mesh(new THREE.BufferGeometry(), mat(1));
    this._enPulse = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.8));
    for (const m of [this._enFill, this._enOutline, this._enRing, this._enPulse]) {
      m.renderOrder = 19;
      g.add(m);
    }
    this._entryRadius = 0;
    return g;
  }

  /** Rebuild the entry rings for a new opening radius, keeping the line widths fixed in metres. */
  _sizeEntryMarker(radius) {
    if (Math.abs(radius - this._entryRadius) < 1e-5) return;
    this._entryRadius = radius;
    const r = radius - 0.004; // just inside the rim bead
    const set = (mesh, geo) => {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    };
    set(this._enFill, new THREE.CircleGeometry(r, 64));
    set(this._enOutline, new THREE.RingGeometry(r - 0.02, r + 0.002, 96));
    set(this._enRing, new THREE.RingGeometry(r - 0.016, r - 0.002, 96));
    set(this._enPulse, new THREE.RingGeometry(r - 0.008, r, 96));
  }

  /**
   * Redraw from a predictTrajectory() result.
   * @param {{points: THREE.Vector3[], times: number[], hit: object|null}|null} prediction
   * @param {{visibleTime?: number, full?: boolean}} [opts]
   */
  update(prediction, { visibleTime = 0.65, full = false } = {}) {
    const now = performance.now() / 1000;
    const frameDt = this._lastNow ? Math.min(0.1, now - this._lastNow) : 0;
    this._lastNow = now;
    this._clock += frameDt;

    const pts = prediction?.points;
    const times = prediction?.times;
    const geo = this._dots.geometry;
    if (!pts || pts.length < 2) {
      geo.setDrawRange(0, 0);
      this._marker.visible = false;
      return;
    }
    const last = pts.length - 1;
    const tEnd = full ? times[last] : Math.min(visibleTime, times[last]);
    const pos = this._aPos.array;
    const sizes = this._aSize.array;
    const alphas = this._aAlpha.array;
    const mixes = this._aMix.array;

    let count = 0;
    let travelled = 0; // arc length at the start of the current segment
    let next = START_SKIP + ((this._clock * MARCH_SPEED) % DOT_SPACING);
    for (let i = 0; i < last && count < MAX_DOTS; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = a.distanceTo(b);
      if (times[i] > tEnd) break;
      while (next <= travelled + segLen && count < MAX_DOTS) {
        const f = segLen > 1e-9 ? (next - travelled) / segLen : 0;
        const t = times[i] + (times[i + 1] - times[i]) * f;
        if (t > tEnd) break;
        const u = tEnd > 0 ? t / tEnd : 1;
        let alpha;
        let scale;
        if (full) {
          alpha = 1 - 0.35 * u;
          scale = 1 - 0.3 * u;
        } else {
          alpha = 1 - smoothstep(0.45, 1, u);
          scale = 1 - 0.55 * u;
        }
        // The dot that just marched in grows from small, and is already solid for most of that
        // growth. Fading alone left a pale, full-size disc (glow ring and all) hovering by the hand
        // like a smudge.
        const grow = smoothstep(START_SKIP, START_SKIP + DOT_SPACING, next);
        alpha *= smoothstep(START_SKIP, START_SKIP + DOT_SPACING * 0.45, next);
        scale *= 0.25 + 0.75 * grow;
        pos[count * 3] = a.x + (b.x - a.x) * f;
        pos[count * 3 + 1] = a.y + (b.y - a.y) * f;
        pos[count * 3 + 2] = a.z + (b.z - a.z) * f;
        sizes[count] = DOT_SIZE * scale;
        alphas[count] = alpha;
        mixes[count] = full ? Math.min(1, t / 1.2) : u;
        count++;
        next += DOT_SPACING;
      }
      travelled += segLen;
    }
    geo.setDrawRange(0, count);
    this._aPos.needsUpdate = true;
    this._aSize.needsUpdate = true;
    this._aAlpha.needsUpdate = true;
    this._aMix.needsUpdate = true;

    const hit = full ? prediction.hit : null;
    const entry = prediction.entry;
    const phase = (this._clock * 1.1) % 1;
    // First contact on the bin floor after dropping through the opening = a clean swish.
    const swish = !!(hit && entry && hit.material === 'binFloor');
    this._entry.visible = swish;
    this._marker.visible = !!hit && !swish;
    if (swish) {
      this._sizeEntryMarker(entry.radius);
      this._entry.position.copy(entry.center).y += 0.002;
      this._enPulse.scale.setScalar(1 + phase * 0.3);
      this._enPulse.material.opacity = 0.9 * (1 - phase);
    } else if (hit) {
      const m = this._marker;
      m.position.copy(hit.point).addScaledVector(hit.normal, 0.002);
      m.quaternion.setFromUnitVectors(Z_AXIS, hit.normal);
      this._mkPulse.scale.setScalar(1 + phase * 0.9);
      this._mkPulse.material.opacity = 0.85 * (1 - phase);
    }
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this.object.visible = visible;
  }

  /** @param {'office'|'beach'} theme */
  setTheme(theme) {
    const t = THEMES[theme] ?? THEMES.office;
    const u = this._dotUniforms;
    u.uCore.value.set(t.core);
    u.uNear.value.set(t.near);
    u.uFar.value.set(t.far);
    u.uOutline.value.set(t.outline);
    this._mkRing.material.color.set(t.near);
    this._mkFill.material.color.set(t.near);
    this._mkPulse.material.color.set(t.near);
    this._mkDot.material.color.set(t.core);
    this._mkOutline.material.color.set(t.outline);
    this._enRing.material.color.set(t.good);
    this._enFill.material.color.set(t.good);
    this._enPulse.material.color.set(t.good);
    this._enOutline.material.color.set(t.outline);
  }

  dispose() {
    this._dots.geometry.dispose();
    this._dotMat.dispose();
    for (const group of [this._marker, this._entry]) {
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    }
    this.object.removeFromParent();
  }
}


// ------------------------------------------------------------------ trail

const TRAIL_POINTS = 720;
const TRAIL_SPACING = 0.03; // metres between recorded points
const TRAIL_WIDTH = 0.022; // metres
const TRAIL_MIN_PX = 7; // CSS pixels
const TRAIL_TAPER = 0.35; // metres over which the start of the ribbon widens from nothing
const TRAIL_HOLD = 0.7; // seconds at full strength after the ball resolves…
const TRAIL_FADE = 1.8; // …then fade out over this long
const TRAIL_MAX_RECORD = 9; // seconds, a safety stop if a ball never resolves
const TRAIL_POOL = 3; // overlapping trails (a new throw while the last one fades)

const TRAIL_VERT = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aDist;
uniform float uWidth;
uniform float uTaper;
uniform float uTotal;
uniform float uPxScale;
uniform float uMinPx;
varying float vSide;
varying float vAlong;
void main() {
  vec3 p = position;
  vec3 tangent = aNext - aPrev;
  vec3 toCam = cameraPosition - p;
  vec3 side = cross(tangent, toCam);
  if (dot(side, side) < 1e-12) side = cross(tangent, vec3(0.0, 1.0, 0.0));
  if (dot(side, side) < 1e-12) side = vec3(1.0, 0.0, 0.0);
  // World-space width, but never thinner than uMinPx on screen.
  float depth = max(-(viewMatrix * vec4(p, 1.0)).z, 0.05);
  float w = max(uWidth, uMinPx * depth / uPxScale);
  w *= smoothstep(0.0, uTaper, aDist) * (0.8 + 0.2 * smoothstep(0.0, uTotal, aDist));
  p += normalize(side) * aSide * w * 0.5;
  vSide = aSide;
  vAlong = uTotal > 0.0 ? aDist / uTotal : 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uCore;
uniform vec3 uOutline;
uniform float uOpacity;
uniform float uLive;
varying float vSide;
varying float vAlong;
void main() {
  float s = abs(vSide);
  float aa = fwidth(s) * 1.5;
  vec3 body = mix(uColorA, uColorB, vAlong);
  // Bright tinted centre line, saturated body, thin dark edge: reads on white walls and in shade.
  vec3 col = mix(mix(body, uCore, 0.4), body, smoothstep(0.04, 0.34, s));
  col = mix(col, uOutline, smoothstep(0.66 - aa, 0.66 + aa, s));
  float alpha = 1.0 - smoothstep(0.86 - aa, 1.0, s);
  alpha *= mix(0.92, 0.55 + 0.45 * vAlong, uLive); // older part of a live trail is a little fainter
  gl_FragColor = vec4(col, alpha * uOpacity);
  #include <colorspace_fragment>
}`;

/** Ribbon tracing the actual flight of the last throw(s). */
export class FlightTrail {
  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'FlightTrail';
    this._index = this._buildIndex();
    this._trails = [];
    for (let i = 0; i < TRAIL_POOL; i++) this._trails.push(this._buildTrail());
    this._serial = 0;
    this.setTheme('office');
  }

  _buildIndex() {
    const idx = new Uint16Array((TRAIL_POINTS - 1) * 6);
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    return new THREE.BufferAttribute(idx, 1);
  }

  _buildTrail() {
    const n = TRAIL_POINTS * 2;
    const geo = new THREE.BufferGeometry();
    const attr = (size) => new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    const position = attr(3);
    const aPrev = attr(3);
    const aNext = attr(3);
    const aDist = attr(1);
    const aSide = new THREE.BufferAttribute(new Float32Array(n), 1);
    for (let i = 0; i < n; i++) aSide.array[i] = i % 2 === 0 ? -1 : 1;
    geo.setAttribute('position', position);
    geo.setAttribute('aPrev', aPrev);
    geo.setAttribute('aNext', aNext);
    geo.setAttribute('aDist', aDist);
    geo.setAttribute('aSide', aSide);
    geo.setIndex(this._index);
    geo.setDrawRange(0, 0);
    const uniforms = {
      uWidth: { value: TRAIL_WIDTH },
      uPxScale: { value: 500 },
      uMinPx: { value: TRAIL_MIN_PX },
      uTaper: { value: TRAIL_TAPER },
      uTotal: { value: 1 },
      uColorA: { value: new THREE.Color() },
      uColorB: { value: new THREE.Color() },
      uCore: { value: new THREE.Color() },
      uOutline: { value: new THREE.Color() },
      uOpacity: { value: 1 },
      uLive: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;
    mesh.visible = false;
    const size = new THREE.Vector2();
    mesh.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(size);
      uniforms.uPxScale.value = size.y * 0.5 * camera.projectionMatrix.elements[5];
      uniforms.uMinPx.value = TRAIL_MIN_PX * renderer.getPixelRatio();
    };
    this.object.add(mesh);
    return { mesh, geo, uniforms, position, aPrev, aNext, aDist, ball: null, count: 0, length: 0, state: 'idle', timer: 0, age: 0, serial: 0 };
  }

  /** Start tracing a freshly thrown ball. */
  begin(ball) {
    let tr = this._trails.find((t) => t.state === 'idle');
    if (!tr) tr = this._trails.reduce((a, b) => (a.serial < b.serial ? a : b));
    tr.ball = ball;
    tr.state = 'recording';
    tr.timer = 0;
    tr.age = 0;
    tr.count = 0;
    tr.length = 0;
    tr.serial = ++this._serial;
    tr.uniforms.uOpacity.value = 1;
    tr.uniforms.uLive.value = 1;
    const p = ballPosition(ball);
    this._append(tr, p.x, p.y, p.z);
    this._append(tr, p.x, p.y, p.z); // live head, moved every frame
    this._commit(tr);
  }

  /** Record the balls' positions and fade finished trails. Call once per frame. */
  update(dt) {
    for (const tr of this._trails) {
      if (tr.state === 'idle') continue;
      if (tr.state === 'recording') {
        tr.age += dt;
        const p = ballPosition(tr.ball);
        this._moveHead(tr, p.x, p.y, p.z);
        if (tr.ball.resolved || tr.age > TRAIL_MAX_RECORD) {
          tr.state = 'holding';
          tr.timer = 0;
          tr.uniforms.uLive.value = 0;
        }
        this._commit(tr);
        continue;
      }
      tr.timer += dt;
      // A miss is called while the ball may still be rolling; keep tracing it until the fade starts.
      if (tr.timer <= TRAIL_HOLD && tr.ball && !tr.ball.sleeping) {
        const p = ballPosition(tr.ball);
        this._moveHead(tr, p.x, p.y, p.z);
        this._commit(tr);
      }
      if (tr.timer > TRAIL_HOLD) {
        const k = 1 - (tr.timer - TRAIL_HOLD) / TRAIL_FADE;
        if (k <= 0) this._reset(tr);
        else tr.uniforms.uOpacity.value = smoothstep(0, 1, k);
      }
    }
  }

  clear() {
    for (const tr of this._trails) this._reset(tr);
  }

  /** @param {'office'|'beach'} theme */
  setTheme(theme) {
    const t = THEMES[theme] ?? THEMES.office;
    for (const tr of this._trails) {
      tr.uniforms.uColorA.value.set(t.trailA);
      tr.uniforms.uColorB.value.set(t.trailB);
      tr.uniforms.uCore.value.set(t.core);
      tr.uniforms.uOutline.value.set(t.outline);
    }
  }

  dispose() {
    for (const tr of this._trails) {
      tr.geo.dispose();
      tr.mesh.material.dispose();
    }
    this.object.removeFromParent();
  }

  _reset(tr) {
    tr.state = 'idle';
    tr.ball = null;
    tr.count = 0;
    tr.mesh.visible = false;
    tr.geo.setDrawRange(0, 0);
  }

  _append(tr, x, y, z) {
    if (tr.count >= TRAIL_POINTS) return false;
    const i = tr.count++;
    const prevDist = i > 0 ? tr.aDist.array[(i - 1) * 2] : 0;
    let d = prevDist;
    if (i > 0) {
      const pa = tr.position.array;
      const j = (i - 1) * 6;
      d += Math.hypot(x - pa[j], y - pa[j + 1], z - pa[j + 2]);
    }
    this._writePoint(tr, i, x, y, z, d);
    return true;
  }

  // The last point follows the ball; once it is TRAIL_SPACING past the previous point it is
  // committed and a new head starts there.
  _moveHead(tr, x, y, z) {
    const head = tr.count - 1;
    const pa = tr.position.array;
    const j = (head - 1) * 6;
    const gap = Math.hypot(x - pa[j], y - pa[j + 1], z - pa[j + 2]);
    this._writePoint(tr, head, x, y, z, tr.aDist.array[(head - 1) * 2] + gap);
    if (gap >= TRAIL_SPACING) this._append(tr, x, y, z);
  }

  _writePoint(tr, i, x, y, z, dist) {
    const pos = tr.position.array;
    const dst = tr.aDist.array;
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      dst[v] = dist;
    }
    tr.length = Math.max(tr.length, dist);
  }

  /** Rebuild prev/next neighbours for the tail end and upload. */
  _commit(tr) {
    const n = tr.count;
    const pos = tr.position.array;
    const prev = tr.aPrev.array;
    const next = tr.aNext.array;
    // Only the last few points change between frames; earlier neighbours are already correct.
    const from = Math.max(0, n - 4);
    for (let i = from; i < n; i++) {
      const ip = Math.max(0, i - 1) * 6;
      const inx = Math.min(n - 1, i + 1) * 6;
      for (let s = 0; s < 2; s++) {
        const v = (i * 2 + s) * 3;
        prev[v] = pos[ip];
        prev[v + 1] = pos[ip + 1];
        prev[v + 2] = pos[ip + 2];
        next[v] = pos[inx];
        next[v + 1] = pos[inx + 1];
        next[v + 2] = pos[inx + 2];
      }
    }
    tr.length = tr.aDist.array[(n - 1) * 2];
    tr.uniforms.uTotal.value = Math.max(tr.length, 1e-4);
    tr.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    tr.mesh.visible = n > 1 && tr.length > 1e-3;
    tr.position.needsUpdate = true;
    tr.aPrev.needsUpdate = true;
    tr.aNext.needsUpdate = true;
    tr.aDist.needsUpdate = true;
  }
}

function ballPosition(ball) {
  return ball.renderPos ?? ball.pos;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
