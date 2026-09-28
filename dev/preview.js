// Standalone level viewer for level authors.
// ?level=office|beach  &view=overview|spot0|spot1…  &debug=1 (collider wireframes)  &orbit=1 (mouse orbit)
// &cam=x,y,z&look=x,y,z (custom camera)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildColliderDebug } from '../src/utils/debugColliders.js';

const params = new URLSearchParams(location.search);
const levelId = params.get('level') || 'office';
const view = params.get('view') || 'spot0';
const debug = params.get('debug') === '1';
const errBox = document.getElementById('err');
const info = document.getElementById('info');

function showError(msg) {
  errBox.style.display = 'block';
  errBox.textContent += msg + '\n';
  console.error(msg);
}
window.addEventListener('error', (e) => showError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => showError(`Unhandled: ${e.reason?.stack || e.reason}`));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.02, 600);
const pmrem = new THREE.PMREMGenerator(renderer);

// Resolved at runtime so the page loads even before a level file exists.
const factoryName = { office: 'createOfficeLevel', beach: 'createBeachLevel' }[levelId];
const modulePath = `../src/levels/${levelId}.js`;

const t0 = performance.now();
const create = (await import(/* @vite-ignore */ modulePath))[factoryName];
const level = await create({ renderer, pmrem, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
const buildMs = Math.round(performance.now() - t0);
renderer.toneMappingExposure = level.exposure ?? 1;
const scene = level.scene;
scene.add(camera);

const bin = level.bin;
const rimCenter = new THREE.Vector3(bin.position.x, bin.position.y + bin.height - bin.rimTube, bin.position.z);

function vec(s) {
  const [x, y, z] = s.split(',').map(Number);
  return new THREE.Vector3(x, y, z);
}

if (params.get('cam')) {
  camera.position.copy(vec(params.get('cam')));
  camera.lookAt(params.get('look') ? vec(params.get('look')) : rimCenter);
} else if (view.startsWith('spot')) {
  const spot = level.shotSpots[Number(view.slice(4)) || 0];
  camera.position.copy(spot.eye);
  camera.lookAt(rimCenter);
} else {
  const { min, max } = level.colliders.room;
  camera.position.set(max.x - 0.3, max.y - 0.2, max.z - 0.3);
  camera.fov = 75;
  camera.updateProjectionMatrix();
  camera.lookAt((min.x + max.x) / 2, 0.4, (min.z + max.z) / 2);
}

if (params.get('orbit') === '1') {
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(rimCenter);
  controls.update();
}

if (debug) scene.add(buildColliderDebug(level));

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let last = performance.now();
let frames = 0;
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  elapsed += dt;
  level.update?.(dt, elapsed);
  renderer.render(scene, camera);
  frames++;
  if (frames === 30) document.title = 'READY';
  if (frames % 20 === 0) {
    const r = renderer.info.render;
    info.textContent = `${level.name} — ${level.subtitle}\nview=${view} build=${buildMs}ms\ndraw calls=${r.calls} tris=${r.triangles}\nspots=${level.shotSpots.length} boxes=${level.colliders.boxes.length} cyl=${(level.colliders.cylinders || []).length}`;
  }
});
