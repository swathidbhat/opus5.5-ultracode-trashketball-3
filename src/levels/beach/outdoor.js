import * as THREE from 'three';
import { rng } from '../../utils/canvasTexture.js';
import { ROOM, DECK, POOL, SEA_LEVEL, terrainHeight } from './layout.js';
import { mbox, mplane, mcylinder, pillow } from './geom.js';

// Everything past the glass except the water and the palms: teak deck, the pool basin, sun
// loungers and a parasol, the dune and beach, a hazy headland and a couple of sailboats.

function put(parent, geom, mat, x, y, z, o = {}) {
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  mesh.castShadow = o.cast ?? true;
  mesh.receiveShadow = o.receive ?? true;
  parent.add(mesh);
  return mesh;
}

/**
 * @param {object} tex textures from createBeachTextures
 * @param {THREE.Texture} envMap outdoor (sky) environment
 * @returns {{ statics: THREE.Group, dynamic: THREE.Group, materials: THREE.Material[], update(t:number): void }}
 */
export function createOutdoor(tex, envMap) {
  const std = (o) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 1, ...o });
  const mat = {
    teak: std({ map: tex.teak, roughness: 0.78, color: 0xe8ddd0 }),
    coping: std({ map: tex.travertine, roughness: 0.7 }),
    tile: std({ map: tex.tile, roughness: 0.25 }),
    render: std({ map: tex.mottle, color: 0xf2eee7, roughness: 0.9 }),
    cushion: std({ map: tex.voile, color: 0xf6f3ec, roughness: 0.95 }),
    towel: std({ map: tex.linen, color: 0x7fb3c8, roughness: 0.95 }),
    teakDark: std({ map: tex.walnut, roughness: 0.6, color: 0xd9b48a }),
    canvas: std({ color: 0xf3efe6, roughness: 0.9, side: THREE.DoubleSide }),
    sand: std({ map: tex.sand, vertexColors: true, roughness: 1, envMapIntensity: 0.7 }),
    // Seen from barely above sea level, much of the ridge is viewed from below its crest, so
    // render both sides; the faint emissive stands in for aerial haze in its shadowed flank.
    headland: std({ vertexColors: true, roughness: 1, envMapIntensity: 0.35, side: THREE.DoubleSide, emissive: 0x6f7888, emissiveIntensity: 0.08 }),
    sail: std({ color: 0xfbf8f2, roughness: 0.8, side: THREE.DoubleSide }),
    hull: std({ color: 0xf0ede6, roughness: 0.5 }),
    lanternDark: std({ color: 0x2b2a2a, roughness: 0.6 }),
    lantern: std({ color: 0xfff2d0, emissive: 0xffd08a, emissiveIntensity: 2.2 }),
  };
  const statics = new THREE.Group();
  const dynamic = new THREE.Group();

  // --- Deck ---------------------------------------------------------------------------------
  const deckT = 0.35;
  const deckPiece = (x0, x1, z0, z1) => put(statics, mbox(x1 - x0, deckT, z0 - z1), mat.teak, (x0 + x1) / 2, -deckT / 2, (z0 + z1) / 2, { cast: false });
  const cop = 0.32;
  deckPiece(DECK.x0, DECK.x1, ROOM.minZ, POOL.z0 + cop);
  deckPiece(DECK.x0, POOL.x0 - cop, POOL.z0 + cop, DECK.z1);
  deckPiece(POOL.x1 + cop, DECK.x1, POOL.z0 + cop, DECK.z1);
  // Travertine coping on the near side and the two ends (the far edge is the infinity edge).
  put(statics, mbox(POOL.x1 - POOL.x0 + cop * 2, 0.06, cop), mat.coping, (POOL.x0 + POOL.x1) / 2, -0.03, POOL.z0 + cop / 2, { cast: false });
  put(statics, mbox(cop, 0.06, POOL.z0 - POOL.z1), mat.coping, POOL.x0 - cop / 2, -0.03, (POOL.z0 + POOL.z1) / 2, { cast: false });
  put(statics, mbox(cop, 0.06, POOL.z0 - POOL.z1), mat.coping, POOL.x1 + cop / 2, -0.03, (POOL.z0 + POOL.z1) / 2, { cast: false });
  // Pool basin (tiled, facing inward) and the knife edge of the infinity wall.
  const pw = POOL.x1 - POOL.x0;
  const pd = POOL.z0 - POOL.z1;
  const px = (POOL.x0 + POOL.x1) / 2;
  const pz = (POOL.z0 + POOL.z1) / 2;
  const floorY = POOL.water - POOL.depth;
  put(statics, mplane(pw, pd), mat.tile, px, floorY, pz, { rx: -Math.PI / 2, cast: false });
  put(statics, mplane(pw, POOL.depth), mat.tile, px, floorY + POOL.depth / 2, POOL.z0, { ry: Math.PI, cast: false });
  put(statics, mplane(pw, POOL.depth), mat.tile, px, floorY + POOL.depth / 2, POOL.z1, { cast: false });
  put(statics, mplane(pd, POOL.depth), mat.tile, POOL.x0, floorY + POOL.depth / 2, pz, { ry: Math.PI / 2, cast: false });
  put(statics, mplane(pd, POOL.depth), mat.tile, POOL.x1, floorY + POOL.depth / 2, pz, { ry: -Math.PI / 2, cast: false });
  put(statics, mbox(pw, 0.9, 0.12), mat.render, px, POOL.water - 0.46, POOL.z1 - 0.06, { cast: false });
  // Deck fascia and the catch basin below the infinity edge, facing the beach.
  put(statics, mbox(DECK.x1 - DECK.x0, 1.2, 0.2), mat.render, 0, -0.6 - 0.01, DECK.z1 - 0.1, { cast: false });

  // --- Sun loungers + parasol -----------------------------------------------------------------
  const lounger = (x, z, yaw) => {
    const g = new THREE.Group();
    const frame = mat.teakDark;
    put(g, mbox(0.72, 0.08, 2.0), frame, 0, 0.26, 0);
    for (const sx of [-0.31, 0.31]) for (const sz of [-0.9, 0.9]) put(g, mbox(0.06, 0.26, 0.06), frame, sx, 0.13, sz);
    put(g, pillow(0.68, 0.1, 1.28, { crown: 0.25, p: 0.35 }), mat.cushion, 0, 0.35, 0.34);
    const back = put(g, pillow(0.68, 0.1, 0.66, { crown: 0.25, p: 0.35 }), mat.cushion, 0, 0.5, -0.54);
    back.rotation.x = -0.62;
    const towel = put(g, mbox(0.5, 0.012, 0.9), mat.towel, 0.02, 0.42, 0.3);
    towel.rotation.y = 0.08;
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    statics.add(g);
  };
  lounger(-8.1, -8.35, 0);
  lounger(-9.5, -8.35, 0.05);
  lounger(5.2, -8.4, -0.05);
  lounger(6.6, -8.4, 0);
  const parasol = (x, z) => {
    const g = new THREE.Group();
    put(g, mcylinder(0.025, 2.55, 10), mat.teakDark, 0, 0, 0);
    put(g, mcylinder(0.28, 0.06, 20), mat.render, 0, 0, 0);
    const cone = new THREE.ConeGeometry(1.45, 0.42, 8, 1, true);
    put(g, cone, mat.canvas, 0, 2.45, 0);
    g.position.set(x, 0, z);
    statics.add(g);
  };
  parasol(-8.8, -9.6);
  parasol(5.9, -9.6);

  // --- Dune and beach terrain -------------------------------------------------------------------
  {
    const x0 = -220;
    const x1 = 220;
    const z0 = DECK.z1 + 0.6;
    const z1 = -110;
    const nx = 140;
    const nz = 70;
    const geo = new THREE.PlaneGeometry(x1 - x0, z0 - z1, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const colors = new Float32Array(pos.count * 3);
    const dry = new THREE.Color(0xf0dfbd);
    const dune = new THREE.Color(0xd9c7a0);
    const grassy = new THREE.Color(0xa8a276);
    const wet = new THREE.Color(0xa38a66);
    const under = new THREE.Color(0xc2b08a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      uv.setXY(i, x, z);
      const s = -z;
      if (s < 22) {
        const patch = 0.5 + 0.5 * Math.sin(x * 0.19 + 1.3) * Math.sin(z * 0.23 + 0.4);
        c.copy(dune).lerp(grassy, Math.max(0, patch - 0.35) * 0.9);
      } else c.copy(dry);
      // darker, wetter sand in the swash zone just above the waterline
      const wetK = THREE.MathUtils.smoothstep(SEA_LEVEL + 0.18 - y, 0, 0.14);
      c.lerp(wet, wetK * 0.85);
      if (y < SEA_LEVEL - 0.05) c.lerp(under, 0.6);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = put(statics, geo, mat.sand, 0, 0, 0, { cast: false });
    mesh.receiveShadow = false;
  }

  // --- Headland on the far right: a hazy wooded promontory running out to sea ------------------
  // Its spine runs mostly seaward, so from the house it is seen side-on: a ridge that steps down
  // to a sea cliff, with a small lighthouse near the tip.
  {
    const r = rng(611);
    // Kept inside the camera's 600 m far plane.
    const A = new THREE.Vector2(185, -175);
    const B = new THREE.Vector2(105, -440);
    const len = A.distanceTo(B);
    const dir = B.clone().sub(A).normalize();
    const side = new THREE.Vector2(-dir.y, dir.x);
    const bumps = Array.from({ length: 7 }, () => [0.05 + r() * 0.85, 0.04 + r() * 0.07, 0.4 + r() * 0.6]);
    const crest = (t) => {
      let h = 30 * Math.pow(1 - t, 0.45) + 4;
      for (const [c, w, k] of bumps) h += 7 * k * Math.exp(-((t - c) ** 2) / (w * w));
      h += 2.2 * Math.sin(t * 31 + 0.7) + 1.2 * Math.sin(t * 73 + 2.1);
      return h * (1 - Math.pow(Math.max(0, (t - 0.93) / 0.07), 2)); // the cliff at the tip
    };
    const heightAt = (t, d) => {
      // t along the spine (0..1), d across it in meters
      const width = 78 - 42 * t;
      const across = 1 - (Math.abs(d) / width) ** 1.6;
      if (across <= 0) return -4;
      return crest(t) * Math.pow(across, 0.7) + 1.2 * Math.sin(t * 47 + d * 0.11) - 4;
    };
    const nu = 120;
    const nv = 32;
    const pos = [];
    const col = [];
    const idx = [];
    const haze = new THREE.Color(0x8a93a3);
    const green = new THREE.Color(0x2a3a1c);
    const scrub = new THREE.Color(0x5b5a34);
    const rock = new THREE.Color(0x8a7458);
    const c = new THREE.Color();
    for (let j = 0; j <= nv; j++) {
      const d = (j / nv - 0.5) * 2 * 80;
      for (let i = 0; i <= nu; i++) {
        const t = i / nu;
        const p = A.clone().addScaledVector(dir, t * len).addScaledVector(side, d);
        const h = heightAt(t, d);
        pos.push(p.x, SEA_LEVEL + h, p.y);
        // Rocky toe near the water, scrub above; everything hazier with distance.
        const patch = 0.5 + 0.5 * Math.sin(t * 57 + d * 0.21) * Math.sin(t * 23 - d * 0.13 + 1.7);
        c.copy(green).lerp(scrub, patch * 0.7);
        c.lerp(rock, THREE.MathUtils.clamp(1 - (h - 1) / 6, 0, 1));
        c.multiplyScalar(0.8 + 0.4 * r());
        c.lerp(haze, 0.12 + 0.28 * t);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a0 = j * (nu + 1) + i;
        const b0 = a0 + nu + 1;
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    statics.add(new THREE.Mesh(geo, mat.headland));

    // Lighthouse on the crest near the tip.
    const t = 0.86;
    const lp = A.clone().addScaledVector(dir, t * len);
    const base = SEA_LEVEL + heightAt(t, 0) - 1;
    const tower = new THREE.Group();
    put(tower, new THREE.CylinderGeometry(1.5, 2.1, 12, 12), mat.hull, 0, 6, 0, { cast: false });
    put(tower, new THREE.CylinderGeometry(2.3, 2.3, 0.5, 12), mat.lanternDark, 0, 12.2, 0, { cast: false });
    put(tower, new THREE.CylinderGeometry(1.2, 1.2, 1.8, 10), mat.lantern, 0, 13.3, 0, { cast: false });
    put(tower, new THREE.ConeGeometry(1.6, 1.6, 10), mat.lanternDark, 0, 15, 0, { cast: false });
    tower.position.set(lp.x, base, lp.y);
    statics.add(tower);
  }

  // --- Sailboats (bob gently) -------------------------------------------------------------------
  const boats = [];
  const boat = (x, z, s, yaw) => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 7, 8, 1), mat.hull);
    hull.rotation.z = Math.PI / 2;
    hull.scale.set(1, 1, 0.55);
    hull.position.y = 0.3;
    g.add(hull);
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0.6, 0.9, 0, 0.6, 10.5, 0, -3.0, 1.0, 0, 0.9, 0.9, 0, 0.9, 8.8, 0, 3.4, 1.0, 0], 3));
    sail.computeVertexNormals();
    g.add(new THREE.Mesh(sail, mat.sail));
    g.position.set(x, SEA_LEVEL, z);
    g.rotation.y = yaw;
    g.scale.setScalar(s);
    dynamic.add(g);
    boats.push({ g, phase: x * 0.1 });
  };
  boat(-48, -190, 1, 0.4);
  boat(70, -300, 1.1, -0.3);
  boat(-150, -330, 1, 1.2);

  return {
    statics,
    dynamic,
    materials: Object.values(mat),
    update(t) {
      for (const b of boats) {
        b.g.position.y = SEA_LEVEL + Math.sin(t * 0.8 + b.phase) * 0.12;
        b.g.rotation.z = Math.sin(t * 0.6 + b.phase) * 0.04;
      }
    },
  };
}
