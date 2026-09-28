import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SUN_DIR } from './layout.js';

/**
 * Golden-hour Preetham sky with drifting clouds, plus an HDR cube capture of it (sun disc hidden)
 * used for ocean / pool reflections and as the outdoor environment map.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.PMREMGenerator} pmrem
 * @param {{ gain: number }} opts  overall sky brightness multiplier (balances the view against the interior)
 */
export function createSky(renderer, pmrem, { gain = 1 } = {}) {
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const mat = sky.material;
  // Add a brightness gain so the view through the glass can be balanced against the interior.
  mat.uniforms.skyGain = { value: gain };
  mat.fragmentShader = mat.fragmentShader
    .replace('uniform float time;', 'uniform float time;\nuniform float skyGain;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyGain, 1.0 );');
  const u = mat.uniforms;
  u.turbidity.value = 10;
  u.rayleigh.value = 3;
  u.mieCoefficient.value = 0.0035;
  u.mieDirectionalG.value = 0.84;
  u.cloudCoverage.value = 0.32;
  u.cloudDensity.value = 0.45;
  u.cloudScale.value = 0.00018;
  u.cloudSpeed.value = 0.00003;
  u.cloudElevation.value = 0.55;
  u.sunPosition.value.copy(SUN_DIR).multiplyScalar(450000);
  sky.castShadow = false;
  sky.receiveShadow = false;
  sky.frustumCulled = false;

  // HDR cube capture for reflections (no sun disc: the water shaders add their own sun glint).
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCam = new THREE.CubeCamera(0.1, 5000, cubeRT);
  const capture = new THREE.Scene();
  capture.add(sky);
  u.showSunDisc.value = 0;
  cubeCam.update(renderer, capture);
  u.showSunDisc.value = 1;
  capture.remove(sky);

  const envRT = pmrem.fromCubemap(cubeRT.texture);

  return {
    sky,
    cube: cubeRT.texture,
    env: envRT.texture,
    update(elapsed) {
      u.time.value = elapsed;
    },
    dispose() {
      sky.geometry.dispose();
      mat.dispose();
      cubeRT.dispose();
      envRT.dispose();
    },
  };
}
