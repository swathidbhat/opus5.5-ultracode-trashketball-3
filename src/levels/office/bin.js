import * as THREE from 'three';
import { wireMeshTexture } from './textures.js';

/**
 * Gunmetal wire-mesh office wastebasket. The visual follows the BinDef collision profile
 * (docs/ARCHITECTURE.md) exactly: the mesh wall sits on the wall centreline, the rolled rim is the rim torus,
 * and the solid foot band + floor pan are exactly wallThickness / floorThickness thick.
 * @param {object} spec { height, radiusTop, radiusBottom, wallThickness, floorThickness, rimTube }
 * @param {number} maxAnisotropy
 * @returns {{ object: THREE.Group, dispose: () => void }}
 */
export function createWireBin(spec, maxAnisotropy = 8) {
  const { height, radiusTop, radiusBottom, wallThickness, floorThickness, rimTube } = spec;
  const t = wallThickness / 2;
  const yRim = height - rimTube;
  const R = radiusTop - t; // rim major radius = wall centreline at the top
  const rb = radiusBottom - t; // wall centreline at the base
  const rAt = (y) => rb + ((R - rb) * y) / yRim;

  const group = new THREE.Group();
  group.name = 'office-bin';

  const steel = new THREE.MeshStandardMaterial({
    color: 0x34373c,
    metalness: 0.85,
    roughness: 0.36,
  });

  // Mesh wall: diamond expanded metal from the top of the foot band to the rim.
  const bandTop = 0.05;
  const cells = 48;
  const meshTex = wireMeshTexture([cells / 4, ((yRim - bandTop) / ((2 * Math.PI * R) / cells)) / 4]);
  meshTex.anisotropy = Math.min(8, maxAnisotropy);
  const meshMat = new THREE.MeshStandardMaterial({
    color: 0x2f3237,
    metalness: 0.8,
    roughness: 0.42,
    alphaMap: meshTex,
    transparent: true,
    alphaTest: 0.02,
    side: THREE.DoubleSide,
  });
  const wallGeo = new THREE.CylinderGeometry(R, rAt(bandTop), yRim - bandTop, 72, 1, true);
  const wall = new THREE.Mesh(wallGeo, meshMat);
  wall.position.y = (yRim + bandTop) / 2;
  wall.castShadow = true;
  wall.receiveShadow = true;
  // Shadow keeps the mesh pattern instead of a solid silhouette.
  wall.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaMap: meshTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  wall.renderOrder = 1;
  group.add(wall);

  // Rolled rim bead: exactly the physics rim torus.
  const rimGeo = new THREE.TorusGeometry(R, rimTube, 12, 96);
  const rim = new THREE.Mesh(rimGeo, steel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = yRim;
  rim.castShadow = true;
  group.add(rim);

  // Foot band + floor pan as one lathe: inner floor at floorThickness, band walls +-t around the centreline.
  const lip = t;
  const profile = [
    [0, floorThickness],
    [rAt(floorThickness) - t, floorThickness],
    [rAt(bandTop) - t, bandTop - lip * 0.5],
    [rAt(bandTop) - t * 0.4, bandTop],
    [rAt(bandTop) + t * 0.4, bandTop],
    [rAt(bandTop) + t, bandTop - lip * 0.5],
    [rAt(0.004) + t, 0.004],
    [rAt(0) + t - 0.003, 0],
    [0, 0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const baseGeo = new THREE.LatheGeometry(profile.reverse(), 72);
  const base = new THREE.Mesh(baseGeo, steel);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Thin wire hoop half-way up: stiffener ring, sits inside the wall band.
  const hoopY = bandTop + (yRim - bandTop) * 0.52;
  const hoopGeo = new THREE.TorusGeometry(rAt(hoopY), 0.0022, 6, 96);
  const hoop = new THREE.Mesh(hoopGeo, steel);
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = hoopY;
  group.add(hoop);

  return {
    object: group,
    dispose() {
      for (const g of [wallGeo, rimGeo, baseGeo, hoopGeo]) g.dispose();
      for (const m of [steel, meshMat, wall.customDepthMaterial]) m.dispose();
      meshTex.dispose();
    },
  };
}
