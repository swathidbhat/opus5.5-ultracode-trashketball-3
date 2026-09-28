import * as THREE from 'three';
import { rng } from '../../utils/canvasTexture.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sweepTube } from './geom.js';
import { terrainHeight, DECK } from './layout.js';
import { COVERAGE_ALPHA_TEST } from './materials.js';

// Coconut palms (procedural trunks + folded fronds that sway) and wind-blown dune grass.

const PALMS = [
  { x: -9.6, z: -13.2, h: 9.5, lean: [-0.9, -0.5], seed: 1 },
  { x: -13.4, z: -17.5, h: 11.2, lean: [0.6, -1.4], seed: 2 },
  { x: 9.8, z: -14.0, h: 10.2, lean: [1.6, -0.8], seed: 3 },
  { x: 14.5, z: -19.0, h: 8.4, lean: [-0.4, -1.0], seed: 4 },
  { x: -23.0, z: -22.0, h: 10.5, lean: [-1.2, -0.7], seed: 5 },
  { x: 25.0, z: -24.5, h: 11.5, lean: [1.1, -1.2], seed: 6 },
  { x: 5.6, z: -18.6, h: 9.0, lean: [2.3, -1.5], seed: 7 },
];

/**
 * Hook a wind sway into a standard material. `sway` is a per-vertex (weight, phase) attribute.
 * Also swaps in the centred alpha-to-coverage test (see materials.js) for the leaflet edges.
 */
function addFrondSway(material, timeUniform) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', COVERAGE_ALPHA_TEST);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec2 aSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float sw = aSway.x;
        float ph = aSway.y;
        transformed.y += sw * (0.22 * sin(uTime * 1.3 + ph) + 0.08 * sin(uTime * 3.1 + ph * 1.7));
        transformed.x += sw * 0.16 * sin(uTime * 0.9 + ph * 0.7);
        transformed.z += sw * 0.1 * cos(uTime * 1.1 + ph);`,
      );
  };
  material.customProgramCacheKey = () => 'beach-frond';
}

function frondGeometry(base, azimuth, elev, length, droop, width, phase, dead) {
  const steps = 12;
  const pts = [];
  const p = base.clone();
  const h = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
  pts.push(p.clone());
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const a = elev - droop * Math.pow(t, 1.4);
    p.addScaledVector(h, (length / steps) * Math.cos(a));
    p.y += (length / steps) * Math.sin(a);
    pts.push(p.clone());
  }
  const pos = [];
  const uv = [];
  const sway = [];
  const col = [];
  const idx = [];
  const fold = dead ? 0.9 : 0.42; // V-fold of the leaflets (radians below the frond plane)
  const tint = dead ? [0.62, 0.48, 0.3] : [1, 1, 1];
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const P = pts[k];
    const T = (k < steps ? pts[k + 1].clone().sub(P) : P.clone().sub(pts[k - 1])).normalize();
    const S = new THREE.Vector3().crossVectors(T, up).normalize();
    const U = new THREE.Vector3().crossVectors(S, T).normalize();
    const w = width * (0.25 + 0.75 * Math.min(1, t * 3));
    const L = P.clone().addScaledVector(S, w * Math.cos(fold)).addScaledVector(U, -w * Math.sin(fold));
    const R = P.clone().addScaledVector(S, -w * Math.cos(fold)).addScaledVector(U, -w * Math.sin(fold));
    for (const [v, u] of [
      [L, 0],
      [P, 0.5],
      [R, 1],
    ]) {
      pos.push(v.x, v.y, v.z);
      uv.push(u, t);
      sway.push(t * t * (dead ? 0.4 : 1), phase);
      col.push(...tint);
    }
  }
  for (let k = 0; k < steps; k++) {
    const a = k * 3;
    const b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/**
 * @returns {{ group: THREE.Group, dispose(): void }}
 */
export function createPalms(tex, envMap, timeUniform) {
  const trunkMat = new THREE.MeshStandardMaterial({ map: tex.bark, roughness: 0.95, envMap, envMapIntensity: 0.8 });
  const frondMat = new THREE.MeshStandardMaterial({
    map: tex.frond,
    alphaTest: 0.5,
    alphaToCoverage: true, // MSAA-smoothed leaflet edges; hard alpha-test edges crawl as the fronds sway
    side: THREE.DoubleSide,
    roughness: 0.7,
    vertexColors: true,
    envMap,
    envMapIntensity: 0.9,
  });
  addFrondSway(frondMat, timeUniform);
  const nutMat = new THREE.MeshStandardMaterial({ color: 0x5b4a26, roughness: 0.7, envMap });
  tex.bark.wrapS = tex.bark.wrapT = THREE.RepeatWrapping;
  tex.bark.repeat.set(1, 1 / 3);

  const trunks = [];
  const fronds = [];
  const nuts = [];
  const nutGeo = new THREE.SphereGeometry(0.13, 10, 8);
  for (const P of PALMS) {
    const r = rng(P.seed * 97);
    const y0 = terrainHeight(P.x, P.z) - 0.3;
    const base = new THREE.Vector3(P.x, y0, P.z);
    const top = new THREE.Vector3(P.x + P.lean[0], y0 + P.h, P.z + P.lean[1]);
    // Gentle S-curve: the trunk leans at the bottom and straightens toward the crown.
    const mid1 = base.clone().lerp(top, 0.35).add(new THREE.Vector3(P.lean[0] * 0.28, 0, P.lean[1] * 0.28));
    const mid2 = base.clone().lerp(top, 0.7).add(new THREE.Vector3(P.lean[0] * 0.18, 0, P.lean[1] * 0.18));
    const curve = new THREE.CatmullRomCurve3([base, mid1, mid2, top]);
    trunks.push(sweepTube(curve, (t) => 0.2 * (1 - 0.35 * t) + 0.12 * Math.max(0, 1 - t * 8), 40, 12, false, true));

    const crown = top.clone();
    const n = 15;
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + r() * 0.35;
      const tier = i % 3; // upper, middle, lower rings
      const elev = [0.75, 0.35, -0.05][tier] + (r() - 0.5) * 0.2;
      const len = 3.0 + r() * 0.9 - tier * 0.15;
      const droop = 1.3 + r() * 0.5 + tier * 0.25;
      fronds.push(frondGeometry(crown, az, elev, len, droop, 0.62, r() * 6.28, false));
    }
    // two dead, hanging fronds
    for (let i = 0; i < 2; i++) {
      fronds.push(frondGeometry(crown.clone().add(new THREE.Vector3(0, -0.25, 0)), r() * 6.28, -0.9, 2.2, 0.4, 0.4, r() * 6.28, true));
    }
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2;
      const g = nutGeo.clone();
      g.translate(crown.x + Math.cos(a) * 0.2, crown.y - 0.28 - r() * 0.12, crown.z + Math.sin(a) * 0.2);
      nuts.push(g);
    }
  }
  nutGeo.dispose();

  const group = new THREE.Group();
  const trunkGeo = mergeGeometries(trunks);
  const frondGeo = mergeGeometries(fronds);
  const nutsGeo = mergeGeometries(nuts);
  for (const g of [...trunks, ...fronds, ...nuts]) g.dispose();
  const trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
  const frondMesh = new THREE.Mesh(frondGeo, frondMat);
  const nutMesh = new THREE.Mesh(nutsGeo, nutMat);
  frondMesh.frustumCulled = false;
  group.add(trunkMesh, frondMesh, nutMesh);
  return {
    group,
    dispose() {
      for (const o of [trunkMesh, frondMesh, nutMesh]) o.geometry.dispose();
      trunkMat.dispose();
      frondMat.dispose();
      nutMat.dispose();
    },
  };
}

/** A clump of 11 curved grass blades (local, up = +Y, ~0.7 m tall). */
function tuftGeometry() {
  const r = rng(404);
  const pos = [];
  const col = [];
  const base = new THREE.Color(0x5d6b3a);
  const tip = new THREE.Color(0xd8c68c);
  const blades = 9;
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2;
    const lean = 0.25 + r() * 0.5;
    const h = 0.45 + r() * 0.4;
    const w = 0.018 + r() * 0.01;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    const seg = 3;
    const ring = [];
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const off = lean * h * t * t;
      const y = h * t * (1 - 0.15 * t);
      const ww = w * (1 - t);
      ring.push([
        [dx * off + px * ww, y, dz * off + pz * ww],
        [dx * off - px * ww, y, dz * off - pz * ww],
        t,
      ]);
    }
    for (let s = 0; s < seg; s++) {
      const [a0, a1, t0] = ring[s];
      const [b0, b1, t1] = ring[s + 1];
      const c0 = base.clone().lerp(tip, t0);
      const c1 = base.clone().lerp(tip, t1);
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      col.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c0.r, c0.g, c0.b, c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c1.r, c1.g, c1.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Grass normals point mostly up so the clump is lit like foliage, not like flat cards.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(n.getX(i) * 0.4, 1, n.getZ(i) * 0.4).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** Dune grass: one instanced mesh, clumped by a noise mask, swaying after instancing. */
export function createDuneGrass(envMap, timeUniform) {
  const geo = tuftGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, envMap, envMapIntensity: 0.9 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float hgt = max(transformed.y, 0.0);
        float gust = 0.6 + 0.4 * sin(uTime * 0.45 + ip.x * 0.05);
        mvPosition.x += hgt * hgt * gust * (0.28 + 0.12 * sin(uTime * 2.1 + ip.x * 0.7 + ip.y * 0.4));
        mvPosition.z += hgt * hgt * 0.1 * sin(uTime * 1.7 + ip.y * 0.9);
      #endif
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.customProgramCacheKey = () => 'beach-grass';

  const r = rng(505);
  const mats = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const clump = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.19 + 1.3) * Math.sin(z * 0.23 + 0.4) + 0.25 * Math.sin(x * 0.61 - z * 0.37);
  let tries = 0;
  while (mats.length < 850 && tries < 20000) {
    tries++;
    const x = (r() - 0.5) * 70;
    const z = DECK.z1 - 0.4 - r() * 17;
    if (clump(x, z) < 0.45 + r() * 0.3) continue;
    const y = 0;
    p.set(x, terrainHeight(x, z) - 0.03 + y, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    const k = 0.7 + r() * 0.8;
    s.set(k, k * (0.8 + r() * 0.5), k);
    m.compose(p, q, s);
    mats.push(m.clone());
  }
  const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
  const c = new THREE.Color();
  for (let i = 0; i < mats.length; i++) {
    c.setHSL(0.13 + r() * 0.05, 0.25 + r() * 0.2, 0.5 + r() * 0.25);
    mesh.setColorAt(i, c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
