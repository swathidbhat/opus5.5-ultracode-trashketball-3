import * as THREE from 'three';
import { SEA_LEVEL, SUN_DIR, POOL } from './layout.js';

// Animated water: the open ocean (with shore wash and foam) and the infinity pool.
// Both reflect an HDR cube capture of the sky and add an analytic sun glint whose spread comes
// from the wave slopes too small to resolve at that distance, so the glitter path reaches the horizon.

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform samplerCube uSky;
  uniform float uSkyGain;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  varying vec3 vWorld;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // One directional deep-water wave. Adds its slope to g (resolved part) and, when it is too
  // small for the pixel footprint, its slope variance to sig2 (unresolved part).
  void wave(vec2 p, float ang, float len, float amp, float ph, float fp, inout vec2 g, inout float sig2) {
    vec2 d = vec2(sin(ang), cos(ang));
    float k = 6.2831853 / len;
    float w = sqrt(9.81 * k);
    float f = k * dot(d, p) - w * uTime + ph;
    float fade = 1.0 - smoothstep(len * 0.08, len * 0.45, fp);
    float slope = amp * k;
    g += d * (slope * cos(f) * fade);
    sig2 += 0.5 * slope * slope * (1.0 - fade);
  }

  vec3 skyLookup(vec3 dir) {
    dir.y = abs(dir.y) + 0.002;
    return textureCube(uSky, normalize(dir)).rgb * uSkyGain;
  }

  // Beckmann-style sun glint with slope variance s2.
  float sunGlint(vec3 N, vec3 V, vec3 L, float s2) {
    vec3 H = normalize(V + L);
    float c = max(dot(N, H), 1e-3);
    float c2 = c * c;
    float tan2 = (1.0 - c2) / c2;
    float D = exp(-tan2 / (2.0 * s2)) / (6.2831853 * s2 * c2 * c2);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    return D * F / (4.0 * max(dot(N, V), 0.08));
  }
`;

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const OCEAN_FRAG = /* glsl */ `
  uniform float uSeaLevel;
  ${COMMON}

  float wig(float x) { return 0.08 * sin(x * 0.031) + 0.05 * sin(x * 0.073 + 1.3); }
  // Mirrors terrainHeight() in layout.js for the beach and sea floor.
  float groundY(vec2 p) {
    float s = -p.y;
    float w = wig(p.x);
    if (s < 42.0) return -2.0 - (s - 22.0) * 0.03 + w;
    return max(-2.6 - (s - 42.0) * 0.08 + w, -9.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    float fp = length(fwidth(p));

    // Shoreline: the water level surges up and down the beach.
    float swash = 0.04 * sin(uTime * 0.42 + p.x * 0.045) + 0.022 * sin(uTime * 0.77 + p.x * 0.12 + 1.7);
    float depth = uSeaLevel + swash - groundY(p);
    if (depth < -0.06) discard;

    vec2 g = vec2(0.0);
    float sig2 = 0.0018;
    wave(p, 0.08, 17.0, 0.20, 0.0, fp, g, sig2);
    wave(p, -0.42, 9.3, 0.10, 1.7, fp, g, sig2);
    wave(p, 0.61, 5.7, 0.055, 4.1, fp, g, sig2);
    wave(p, -0.9, 3.4, 0.028, 2.3, fp, g, sig2);
    wave(p, 0.33, 2.1, 0.015, 5.9, fp, g, sig2);
    wave(p, -0.18, 1.25, 0.0085, 0.7, fp, g, sig2);
    wave(p, 1.15, 0.74, 0.0046, 3.3, fp, g, sig2);
    wave(p, -1.35, 0.43, 0.0026, 1.9, fp, g, sig2);
    // Calmer in the shallows.
    float calm = smoothstep(0.0, 1.2, depth);
    g *= mix(0.35, 1.0, calm);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    float NdV = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    vec3 refl = skyLookup(R);

    // Water body: turquoise over sand, deep teal offshore, lit by the low sun and the sky.
    float shallow = exp(-max(depth, 0.0) * 0.55);
    vec3 deep = vec3(0.004, 0.032, 0.05);
    vec3 shoal = vec3(0.035, 0.19, 0.18);
    vec3 body = mix(deep, shoal, shallow) * (0.55 + 0.9 * uSunColor.g);

    vec3 col = mix(body, refl, F);
    col += uSunColor * sunGlint(N, V, uSunDir, sig2) * max(dot(N, uSunDir), 0.0) * 2.2;

    // Foam: the swash edge plus broken lines of spilling breakers running up the beach.
    float edge = 1.0 - smoothstep(0.0, 0.05, depth);
    float fromShore = max(depth, 0.0) / 0.03;
    float crest = sin(fromShore * 0.55 + uTime * 1.25 + vnoise(p * 0.12) * 5.0);
    float breakers = smoothstep(0.78, 1.0, crest) * smoothstep(0.5, 0.12, depth) * smoothstep(0.02, 0.09, depth);
    float lace = smoothstep(0.35, 0.75, vnoise(p * vec2(0.55, 2.4) + vec2(uTime * 0.1, -uTime * 0.35)));
    float foam = clamp(edge * (0.55 + 0.45 * lace) + breakers * lace, 0.0, 1.0);
    vec3 foamCol = vec3(0.92, 0.9, 0.86) * (0.35 + uSunColor * 0.55);
    col = mix(col, foamCol, foam * 0.9);

    float alpha = smoothstep(0.0, 0.28, depth) * 0.92 + 0.08;
    alpha = max(alpha, foam * 0.95);

    // Just-wetted sand above the waterline: a dark, glossy band.
    if (depth < 0.0) {
      float wet = smoothstep(-0.06, 0.0, depth);
      col = vec3(0.07, 0.055, 0.04) + refl * 0.08;
      alpha = wet * 0.4;
    }

    // Distance haze into the horizon colour of the sky in this direction.
    vec3 hz = skyLookup(normalize(vec3(-V.x, 0.012, -V.z)));
    col = mix(col, hz, smoothstep(90.0, 580.0, dist) * 0.85);

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const POOL_FRAG = /* glsl */ `
  ${COMMON}
  void main() {
    vec2 p = vWorld.xz;
    vec3 toCam = cameraPosition - vWorld;
    vec3 V = normalize(toCam);
    float fp = length(fwidth(p));
    vec2 g = vec2(0.0);
    float sig2 = 0.0012;
    wave(p, 0.3, 1.6, 0.006, 0.0, fp, g, sig2);
    wave(p, -0.8, 0.9, 0.0035, 2.0, fp, g, sig2);
    wave(p, 1.4, 0.55, 0.002, 4.0, fp, g, sig2);
    wave(p, -2.1, 0.33, 0.0012, 1.0, fp, g, sig2);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    float NdV = max(dot(N, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 refl = skyLookup(reflect(-V, N));
    vec3 tint = vec3(0.03, 0.22, 0.24) * (0.6 + uSunColor.g);
    vec3 col = mix(tint, refl, F);
    col += uSunColor * sunGlint(N, V, uSunDir, sig2) * max(dot(N, uSunDir), 0.0) * 1.6;
    float alpha = mix(0.5, 1.0, F);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function waterMaterial(frag, skyCube, timeUniform, skyGain, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uSky: { value: skyCube },
      uSkyGain: { value: skyGain },
      uSunDir: { value: SUN_DIR.clone() },
      uSunColor: { value: new THREE.Color(1.0, 0.72, 0.46) },
      ...extra,
    },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: true,
  });
}

/** The sea: one huge quad from just up the beach to the far plane. */
export function createOcean(skyCube, timeUniform, skyGain) {
  const mat = waterMaterial(OCEAN_FRAG, skyCube, timeUniform, skyGain, { uSeaLevel: { value: SEA_LEVEL } });
  const z0 = -31;
  const z1 = -612;
  const geo = new THREE.PlaneGeometry(1500, z0 - z1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, SEA_LEVEL, (z0 + z1) / 2);
  mesh.renderOrder = -2; // before the window glass
  mesh.frustumCulled = false;
  return mesh;
}

/** Infinity-pool water surface. */
export function createPoolWater(skyCube, timeUniform, skyGain) {
  const mat = waterMaterial(POOL_FRAG, skyCube, timeUniform, skyGain);
  const geo = new THREE.PlaneGeometry(POOL.x1 - POOL.x0, POOL.z0 - POOL.z1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((POOL.x0 + POOL.x1) / 2, POOL.water, (POOL.z0 + POOL.z1) / 2);
  mesh.renderOrder = -2;
  return mesh;
}
