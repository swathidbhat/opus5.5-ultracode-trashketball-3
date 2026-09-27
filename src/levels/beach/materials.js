import * as THREE from 'three';

/**
 * Interior materials for the beach house. Everything is PBR (MeshStandard / MeshPhysical) lit by
 * the sun, a hemisphere fill and the room environment map.
 * @param {Awaited<ReturnType<import('./textures.js').createBeachTextures>>} tex
 */
export function createInteriorMaterials(tex) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);

  const m = {
    oakFloor: std({ map: tex.oak, bumpMap: tex.oak, bumpScale: 0.9, roughness: 0.46, color: 0xf2ece4 }),
    plaster: std({ map: tex.plaster, bumpMap: tex.plaster, bumpScale: 0.35, roughness: 0.94 }),
    ceiling: std({ map: tex.ceiling, bumpMap: tex.ceiling, bumpScale: 0.5, roughness: 0.88 }),
    paleOak: std({ map: tex.paleOak, roughness: 0.72 }),
    trim: std({ color: 0xf1ede6, roughness: 0.6 }),
    steel: std({ color: 0x1c1c1c, roughness: 0.38, metalness: 0.65 }),
    glass: std({
      color: 0xe4f1ee,
      transparent: true,
      opacity: 0.1,
      roughness: 0.04,
      metalness: 0,
      depthWrite: false,
      envMapIntensity: 1.6,
    }),

    boucle: phys({
      map: tex.boucle,
      bumpMap: tex.boucle,
      bumpScale: 2.2,
      roughness: 0.96,
      sheen: 0.7,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(0xfff8ee),
    }),
    linen: phys({
      map: tex.linen,
      bumpMap: tex.linen,
      bumpScale: 1.2,
      roughness: 0.92,
      sheen: 0.4,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(0xf4ead8),
    }),
    pillowTerracotta: phys({ map: tex.linen, color: 0xd9744a, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0xffc9a8) }),
    pillowOcean: phys({ map: tex.linen, color: 0x3f7fa6, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0xbfe0f2) }),
    pillowSand: phys({ map: tex.linen, color: 0xf0e2c8, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) }),
    leather: phys({
      map: tex.leather,
      bumpMap: tex.leather,
      bumpScale: 0.5,
      roughness: 0.48,
      clearcoat: 0.25,
      clearcoatRoughness: 0.45,
    }),
    marble: phys({ map: tex.marble, roughness: 0.14, clearcoat: 0.5, clearcoatRoughness: 0.12 }),
    brass: std({ color: 0xcaa15c, metalness: 1, roughness: 0.26 }),
    lacquer: phys({ color: 0x0b0b0c, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
    blackMetal: std({ color: 0x1a1918, metalness: 0.5, roughness: 0.45 }),
    walnut: std({ map: tex.walnut, roughness: 0.5 }),
    travertine: std({ map: tex.travertine, roughness: 0.62 }),
    rug: std({ map: tex.rug, bumpMap: tex.rug, bumpScale: 2.5, roughness: 1 }),
    rattan: std({ map: tex.rattan, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 }),
    terracotta: std({ map: tex.mottle, color: 0xc07a52, roughness: 0.92 }),
    ceramic: std({ map: tex.mottle, color: 0xefe9de, roughness: 0.5 }),
    ceramicDark: std({ map: tex.mottle, color: 0x46403a, roughness: 0.55 }),
    ceramicBlue: std({ map: tex.mottle, color: 0x2f5b78, roughness: 0.22 }),
    ceramicSand: std({ map: tex.mottle, color: 0xd9c3a0, roughness: 0.7 }),
    stone: std({ map: tex.mottle, color: 0xbdb3a4, roughness: 0.85 }),
    bark: std({ map: tex.mottle, color: 0x7a6a58, roughness: 0.95 }),
    figLeaf: std({ map: tex.figLeaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.42 }),
    oliveLeaf: std({ map: tex.olive, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }),
    plume: std({ map: tex.plume, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 1 }),
    colored: std({ vertexColors: true, roughness: 0.62 }),
    artCoastal: std({ map: tex.artCoastal, roughness: 0.85 }),
    artArches: std({ map: tex.artArches, roughness: 0.85 }),
    artTide: std({ map: tex.artTide, roughness: 0.85 }),
    oakWarm: std({ map: tex.paleOak, color: 0xf4d9b4, roughness: 0.55 }),
    rattanSolid: std({ map: tex.mottle, color: 0xb88a56, roughness: 0.8 }),
    soil: std({ map: tex.mottle, color: 0x3a2c22, roughness: 1 }),
    glassware: std({ vertexColors: true, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.62, envMapIntensity: 1.8 }),
    lampShade: std({
      map: tex.linen,
      color: 0xf6ecdc,
      emissive: 0xffc890,
      emissiveMap: tex.linen,
      emissiveIntensity: 0.75,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
    // Lamps: warm bulbs + glowing shade interiors (no bloom pass, so emissive just reads bright).
    bulb: std({ color: 0xffffff, emissive: 0xffc98a, emissiveIntensity: 4 }),
    shadeInner: std({ color: 0xfff4e4, emissive: 0xffd9a8, emissiveIntensity: 0.9, roughness: 0.9, side: THREE.DoubleSide }),
    curtain: std({
      map: tex.voile,
      color: 0xf5f0e6,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 1,
      emissive: 0xffe3bd,
      emissiveIntensity: 0.22,
    }),
  };
  // Thin, open-sided parts cast shadows from both faces.
  for (const k of ['rattan', 'figLeaf', 'oliveLeaf', 'plume', 'shadeInner']) m[k].shadowSide = THREE.DoubleSide;
  for (const k of ['rattan', 'figLeaf', 'oliveLeaf', 'plume']) antialiasCutout(m[k]);
  return m;
}

/**
 * Alpha test for alpha-to-coverage, centred on the cut-off: coverage is 50% where alpha crosses
 * alphaTest and ramps over one pixel either side. three's stock version ramps from the cut-off
 * upward, which only thins cut-outs (fine leaflets break up) instead of smoothing their edges.
 */
export const COVERAGE_ALPHA_TEST = `#ifdef USE_ALPHATEST
  #ifdef ALPHA_TO_COVERAGE
  diffuseColor.a = clamp( ( diffuseColor.a - alphaTest ) / max( fwidth( diffuseColor.a ), 1e-4 ) + 0.5, 0.0, 1.0 );
  if ( diffuseColor.a == 0.0 ) discard;
  #else
  if ( diffuseColor.a < alphaTest ) discard;
  #endif
#endif`;

/**
 * Let MSAA smooth an alpha-tested cut-out's edges (a plain alpha test leaves hard stair-steps).
 * The material stays opaque (no sorting); three's shadow pass still cuts it out with a plain
 * alpha test (at 0.5). For materials without their own onBeforeCompile.
 * @param {THREE.Material} material
 */
export function antialiasCutout(material) {
  material.alphaToCoverage = true;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', COVERAGE_ALPHA_TEST);
  };
  material.customProgramCacheKey = () => 'beach-coverage-alpha';
}
