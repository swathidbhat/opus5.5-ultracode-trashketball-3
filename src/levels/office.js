import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Batcher } from './office/batch.js';
import { buildRoom, lightPanelLayout } from './office/room.js';
import { buildFurniture } from './office/furniture.js';
import { buildDecor, buildContactShadows } from './office/decor.js';
import { createWireBin } from './office/bin.js';
import { BIN, ROOM, buildColliders, shotSpots } from './office/layout.js';
import {
  carpetTextures,
  wallTexture,
  ceilingTexture,
  ceilingFixtureTexture,
  lightPanelTexture,
  fabricTexture,
  blobTexture,
  screenAtlasTexture,
  lumonLogoTexture,
  decorAtlasTexture,
} from './office/textures.js';

// Level 1: Lumon Industries' Macrodata Refinement room from "Severance".
// Clinical off-white room, low drop ceiling with square troffers, vivid green carpet,
// the four-desk MDR island with retro terminals, and a gunmetal wire-mesh wastebasket.

/**
 * Build the office level.
 * @param {{ renderer: THREE.WebGLRenderer, pmrem: THREE.PMREMGenerator, maxAnisotropy: number }} ctx
 * @returns {Promise<object>} LevelDef (see docs/ARCHITECTURE.md)
 */
export async function createOfficeLevel(ctx) {
  const aniso = Math.max(1, Math.min(ctx.maxAnisotropy ?? 8, 16));
  const scene = new THREE.Scene();
  scene.name = 'office';
  scene.background = new THREE.Color(0xdfe2dd);
  // A breath of haze so the long corridor recedes.
  scene.fog = new THREE.Fog(0xe4e7e2, 9, 34);

  // ------------------------------------------------------------ textures + materials
  const carpet = carpetTextures([1, 1]);
  const tex = {
    carpet: carpet.map,
    carpetBump: carpet.bump,
    wall: wallTexture(),
    ceiling: ceilingTexture(),
    fixture: ceilingFixtureTexture(),
    panel: lightPanelTexture(),
    fabric: fabricTexture(),
    blob: blobTexture(),
    screens: screenAtlasTexture(),
    logo: lumonLogoTexture(),
    atlas: decorAtlasTexture(),
  };
  for (const k of ['carpet', 'carpetBump', 'wall', 'ceiling', 'fixture', 'fabric', 'atlas', 'logo']) tex[k].anisotropy = aniso;

  const std = (params) => new THREE.MeshStandardMaterial({ vertexColors: true, ...params });
  const mats = {
    carpet: std({ map: tex.carpet, bumpMap: tex.carpetBump, bumpScale: 1.4, roughness: 1, metalness: 0 }),
    wall: std({ map: tex.wall, roughness: 0.9 }),
    // Lit only by bounce in reality; a little self-light keeps the tiles clean white instead of grey-green.
    ceiling: std({ map: tex.ceiling, roughness: 0.95, emissive: 0xffffff, emissiveMap: tex.ceiling, emissiveIntensity: 0.28 }),
    fixture: std({ map: tex.fixture, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex.fixture, emissiveIntensity: 0.28 }),
    trim: std({ roughness: 0.42 }),
    plastic: std({ roughness: 0.46 }),
    metal: std({ roughness: 0.3, metalness: 0.9 }),
    fabric: std({ map: tex.fabric, roughness: 0.96 }),
    atlas: std({ map: tex.atlas, roughness: 0.6 }),
    leaf: std({ roughness: 0.48, side: THREE.DoubleSide }),
    screen: new THREE.MeshStandardMaterial({
      color: 0x030607,
      emissive: 0xffffff,
      emissiveMap: tex.screens,
      emissiveIntensity: 1.15,
      roughness: 0.1,
      metalness: 0,
    }),
    logo: new THREE.MeshStandardMaterial({
      map: tex.logo,
      transparent: true,
      roughness: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  };

  // ------------------------------------------------------------ static geometry
  const batch = new Batcher();
  buildRoom(batch);
  buildFurniture(batch);
  buildDecor(batch);
  const noCast = { cast: false, receive: true };
  const meshes = batch.build(mats, {
    carpet: noCast,
    wall: noCast,
    ceiling: { cast: false, receive: false },
    fixture: { cast: false, receive: false },
    trim: noCast,
    screen: { cast: false, receive: false },
    logo: noCast,
  });
  for (const m of meshes) scene.add(m);

  // Ceiling troffers: one instanced mesh. Colour > 1 so they read as light sources after tone mapping.
  const panelLayout = lightPanelLayout();
  const panelGeo = new THREE.PlaneGeometry(1, 1);
  const panelMat = new THREE.MeshBasicMaterial({ map: tex.panel, color: new THREE.Color().setRGB(2.5, 2.56, 2.66) });
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, panelLayout.matrices.length);
  panels.name = 'office-light-panels';
  const white = new THREE.Color(1, 1, 1);
  panelLayout.matrices.forEach((m, i) => {
    panels.setMatrixAt(i, m);
    panels.setColorAt(i, white);
  });
  panels.computeBoundingSphere();
  scene.add(panels);

  const contactShadows = buildContactShadows(tex.blob);
  scene.add(contactShadows);

  // ------------------------------------------------------------ the wastebasket
  const wire = createWireBin(BIN, aniso);
  wire.object.position.set(BIN.x, 0, BIN.z);
  scene.add(wire.object);

  // ------------------------------------------------------------ lighting
  scene.add(new THREE.HemisphereLight(0xf2f5fa, 0x98a894, 1.05));

  const key = new THREE.DirectionalLight(0xf5f8ff, 1.55);
  key.position.set(0.8, 9, 2.9);
  key.target.position.set(0, 0, 0.3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  // Frustum hugs the room (x +-5.4, z -3.6..4.2) with a margin for the light's slight tilt.
  Object.assign(key.shadow.camera, { left: -5.9, right: 5.9, top: 4.6, bottom: -4.6, near: 2, far: 14 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  // Troffer light is broad and diffuse: soft-edged, not-quite-black shadows.
  key.shadow.radius = 3;
  key.shadow.intensity = 0.85;
  scene.add(key, key.target);

  // Down-light over the wastebasket corner: crisp local shadows for the bin and its mesh.
  const binLight = new THREE.SpotLight(0xf3f6ff, 9, 7, THREE.MathUtils.degToRad(48), 0.9, 1.6);
  binLight.position.set(BIN.x - 0.4, ROOM.height - 0.05, BIN.z + 1.6);
  binLight.target.position.set(BIN.x, 0, BIN.z);
  binLight.castShadow = true;
  binLight.shadow.mapSize.set(1024, 1024);
  binLight.shadow.bias = -0.0006;
  binLight.shadow.normalBias = 0.015;
  binLight.shadow.camera.near = 0.5;
  binLight.shadow.camera.far = 6;
  scene.add(binLight, binLight.target);

  // Corridor light that stutters, plus the troffer instance it belongs to.
  const flickerLight = new THREE.PointLight(0xeef4ff, 5, 6, 1.6);
  flickerLight.position.copy(panelLayout.flickerPos);
  scene.add(flickerLight);

  const env = new RoomEnvironment();
  const envRT = ctx.pmrem.fromScene(env, 0.04);
  env.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.5;

  // ------------------------------------------------------------ animation
  const flickerColor = new THREE.Color();
  let lastLevel = -1;
  const baseFlicker = flickerLight.intensity;
  function update(dt, elapsed) {
    const level = flickerLevel(elapsed);
    if (Math.abs(level - lastLevel) > 0.01) {
      lastLevel = level;
      panels.setColorAt(panelLayout.flickerIndex, flickerColor.setScalar(level));
      panels.instanceColor.needsUpdate = true;
      flickerLight.intensity = baseFlicker * level;
    }
  }

  // Frees exactly what this level created. main.js parents its own objects (camera, aiming guide,
  // trail, confetti, balls) to this scene too, so walking the scene graph would free those as well.
  function dispose() {
    for (const m of meshes) m.geometry.dispose();
    for (const m of Object.values(mats)) m.dispose();
    for (const t of Object.values(tex)) t.dispose();
    panelGeo.dispose();
    panelMat.dispose();
    panels.dispose();
    contactShadows.geometry.dispose();
    contactShadows.material.dispose();
    wire.dispose();
    for (const light of [key, binLight, flickerLight]) light.dispose(); // frees their shadow maps
    envRT.dispose();
    scene.environment = null;
  }

  return {
    id: 'office',
    name: 'Macrodata Refinement',
    subtitle: 'Lumon Industries · Severed Floor',
    theme: 'office',
    scene,
    exposure: 1.0,
    // The aiming guide shows the predicted arc until it has covered this fraction of the
    // horizontal distance to the bin (G shows all of it).
    guideReach: 0.6,
    // Steeper lobs would bank off the ceiling; see ROOM.height.
    maxPitch: THREE.MathUtils.degToRad(55),
    bin: {
      position: new THREE.Vector3(BIN.x, 0, BIN.z),
      height: BIN.height,
      radiusTop: BIN.radiusTop,
      radiusBottom: BIN.radiusBottom,
      wallThickness: BIN.wallThickness,
      floorThickness: BIN.floorThickness,
      rimTube: BIN.rimTube,
      object: wire.object,
      sound: 'metal',
      kind: 'wireMesh',
    },
    colliders: buildColliders(),
    shotSpots: shotSpots(),
    update,
    dispose,
  };
}

/** Mostly steady; every few seconds a short, irregular stutter like a dying ballast. */
function flickerLevel(t) {
  const period = 6.3;
  const phase = (t + 2) % period;
  let level = 1;
  if (phase < 1.2) {
    const h = hash(Math.floor(t * 22));
    if (h < 0.5) level = 0.08 + h * 0.5;
  } else if (phase < 1.6) {
    level = 0.55 + 0.45 * ((phase - 1.2) / 0.4); // warms back up
  }
  return level;
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
