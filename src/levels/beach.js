import * as THREE from 'three';
import { createBeachTextures } from './beach/textures.js';
import { createInteriorMaterials } from './beach/materials.js';
import { StaticBatcher } from './beach/geom.js';
import { buildRoomShell, buildCurtains } from './beach/room.js';
import { buildSeating } from './beach/seating.js';
import { buildDecor } from './beach/decor.js';
import { buildKitchenAndDining } from './beach/kitchen.js';
import { createRattanBin } from './beach/bin.js';
import { createSky } from './beach/sky.js';
import { createOcean, createPoolWater } from './beach/ocean.js';
import { createOutdoor } from './beach/outdoor.js';
import { createPalms, createDuneGrass } from './beach/palms.js';
import { createLights, createRoomEnvironment } from './beach/lighting.js';
import { createContactShadows } from './beach/contactShadows.js';
import { buildColliders, SHOT_SPOTS } from './beach/layout.js';
import { makeYielder } from './beach/yield.js';

// Level 2: a luxury beach house great room at golden hour. A double-height room with a wall of
// steel-framed glass onto a teak deck, an infinity pool, dunes, palms and the sea.

const SKY_GAIN = 0.5; // sky brightness relative to its physical model; balances view vs. interior
const EXPOSURE = 0.92;
// Steeper lobs leave the aiming guide and, in flight, the bin off screen (same cap as the office).
const MAX_PITCH = THREE.MathUtils.degToRad(55);

/**
 * Build the beach level.
 * @param {{ renderer: THREE.WebGLRenderer, pmrem: THREE.PMREMGenerator, maxAnisotropy: number }} ctx
 * @returns {Promise<object>} LevelDef (see docs/ARCHITECTURE.md)
 */
export async function createBeachLevel(ctx) {
  const { renderer, pmrem } = ctx;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9c7b0);
  const time = { value: 0 };
  const cleanup = [];
  // The build is ~0.5-1.5 s of main-thread work; main.js runs it while the level-complete card is
  // up, so it yields every ~40 ms to keep that screen animating and responsive.
  const checkpoint = makeYielder(40);

  const tex = await createBeachTextures(ctx.maxAnisotropy ?? 8, checkpoint);
  const mats = createInteriorMaterials(tex);
  await checkpoint();

  // Sky, reflections and the interior environment.
  const sky = createSky(renderer, pmrem, { gain: SKY_GAIN });
  scene.add(sky.sky);
  await checkpoint();
  const roomEnv = createRoomEnvironment(pmrem);
  scene.environment = roomEnv.texture;
  scene.environmentIntensity = 0.45;
  await checkpoint();

  // Static interior + deck: authored as ordinary meshes, then merged per material.
  const batcher = new StaticBatcher();
  const authored = [];
  const author = (group) => {
    batcher.addObject(group);
    authored.push(group);
  };
  const shell = buildRoomShell(mats);
  author(shell.group);
  author(shell.glass);
  author(buildSeating(mats));
  await checkpoint();
  author(buildDecor(mats));
  await checkpoint();
  author(buildKitchenAndDining(mats));
  await checkpoint();
  const outdoor = createOutdoor(tex, sky.env);
  author(outdoor.statics);
  await checkpoint();
  const merged = batcher.bake();
  for (const mesh of merged) {
    if (mesh.material === mats.glass) {
      mesh.renderOrder = -1; // after the water, before everything else transparent
      mesh.castShadow = false;
    }
    scene.add(mesh);
  }
  // The authored source geometries were copied into the merged meshes.
  const seen = new Set();
  for (const g of authored) {
    g.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
    });
  }

  await checkpoint();

  const curtains = buildCurtains(mats.curtain, time);
  scene.add(curtains);
  scene.add(outdoor.dynamic);

  const ocean = createOcean(sky.cube, time, SKY_GAIN);
  const pool = createPoolWater(sky.cube, time, SKY_GAIN);
  scene.add(ocean, pool);
  const palms = createPalms(tex, sky.env, time);
  scene.add(palms.group);
  const grass = createDuneGrass(sky.env, time);
  scene.add(grass.mesh);

  const bin = createRattanBin(tex);
  scene.add(bin.object);
  const contact = createContactShadows();
  scene.add(contact.mesh);

  const lights = createLights();
  scene.add(...lights.objects);

  cleanup.push(
    () => sky.dispose(),
    () => roomEnv.dispose(),
    () => palms.dispose(),
    () => grass.dispose(),
    () => bin.dispose(),
    () => contact.dispose(),
    () => lights.dispose(),
    () => {
      for (const m of [ocean, pool, curtains]) {
        m.geometry.dispose();
        m.material.dispose();
      }
      outdoor.dynamic.traverse((o) => o.geometry?.dispose());
      for (const m of outdoor.materials) m.dispose();
      for (const m of Object.values(mats)) m.dispose();
      for (const t of Object.values(tex)) t.dispose();
      for (const m of merged) m.geometry.dispose();
    },
  );

  return {
    id: 'beach',
    name: 'Casa Marea',
    subtitle: 'Oceanfront Airbnb · Golden Hour',
    theme: 'beach',
    scene,
    exposure: EXPOSURE,
    // The short guide reveals the arc for this share of the distance to the bin.
    guideReach: 0.45,
    maxPitch: MAX_PITCH,
    bin: bin.def,
    colliders: buildColliders(),
    shotSpots: SHOT_SPOTS.map((s) => ({ eye: new THREE.Vector3(...s.eye), label: s.label })),
    update(dt, elapsed) {
      time.value = elapsed;
      sky.update(elapsed);
      outdoor.update(elapsed);
    },
    dispose() {
      for (const fn of cleanup) fn();
      cleanup.length = 0;
    },
  };
}
