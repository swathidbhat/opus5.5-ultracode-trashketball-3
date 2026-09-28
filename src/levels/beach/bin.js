import * as THREE from 'three';
import { BIN } from './layout.js';

// Woven seagrass basket with a rope-wrapped rim and a stitched leather band. The visible surfaces
// follow the physics profile in docs/ARCHITECTURE.md (BinDef) to within a few millimetres:
//   outer wall  = collider centre line + wallThickness/2, from (radiusBottom, 0) to (radiusTop, yRim)
//   inner wall  = centre line - wallThickness/2, down to the floor plate at y = floorThickness
//   rim         = torus (R = radiusTop - wallThickness/2, tube = rimTube) centred at yRim

/**
 * @param {object} tex textures (weave, weaveBump, rope, strap)
 * @returns {{ object: THREE.Group, def: object, dispose(): void }}
 */
export function createRattanBin(tex) {
  const { height, radiusTop, radiusBottom, wallThickness, floorThickness, rimTube } = BIN;
  const t = wallThickness / 2;
  const R = radiusTop - t;
  const yRim = height - rimTube;
  const rOut = (y) => radiusBottom + ((radiusTop - radiusBottom) * y) / yRim;
  const rIn = (y) => rOut(y) - wallThickness;

  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };

  const rope = tex.rope;
  rope.wrapS = rope.wrapT = THREE.RepeatWrapping;
  rope.repeat.set(3, 1);
  const strap = tex.strap;
  strap.wrapS = strap.wrapT = THREE.RepeatWrapping;
  strap.repeat.set(1.8, 1);

  const weaveMat = keep(new THREE.MeshStandardMaterial({ map: tex.weave, bumpMap: tex.weaveBump, bumpScale: 3, roughness: 0.82 }));
  const innerMat = keep(new THREE.MeshStandardMaterial({ map: tex.weave, bumpMap: tex.weaveBump, bumpScale: 3, roughness: 0.9, color: 0x9a8a74 }));
  const ropeMat = keep(new THREE.MeshStandardMaterial({ map: rope, roughness: 0.75 }));
  const strapMat = keep(new THREE.MeshStandardMaterial({ map: strap, roughness: 0.5 }));
  const baseMat = keep(new THREE.MeshStandardMaterial({ map: tex.weave, roughness: 0.9, color: 0x6f5a40 }));

  const group = new THREE.Group();
  const add = (geo, mat, cast = true) => {
    keep(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // Outer wall (evenly spaced profile points so the weave rows keep their height).
  const n = 16;
  const outer = [];
  outer.push(new THREE.Vector2(radiusBottom - 0.006, 0));
  for (let i = 0; i <= n; i++) {
    const y = 0.006 + ((yRim - 0.006) * i) / n;
    outer.push(new THREE.Vector2(rOut(y), y));
  }
  const outerGeo = new THREE.LatheGeometry(outer, 96);
  // v spans 0..1 over the profile; the extra chamfer point is tiny, so rows stay even.
  add(outerGeo, weaveMat);

  // Inner wall, profile top -> bottom so its faces point inward.
  const inner = [];
  for (let i = n; i >= 0; i--) {
    const y = floorThickness + ((yRim - floorThickness) * i) / n;
    inner.push(new THREE.Vector2(rIn(y), y));
  }
  add(new THREE.LatheGeometry(inner, 96), innerMat, false);

  // Floor plate (top face) and the underside.
  const floorTop = new THREE.CircleGeometry(rIn(floorThickness), 48);
  floorTop.rotateX(-Math.PI / 2);
  floorTop.translate(0, floorThickness, 0);
  add(floorTop, baseMat, false);
  const floorBottom = new THREE.CircleGeometry(radiusBottom - 0.006, 48);
  floorBottom.rotateX(Math.PI / 2);
  floorBottom.translate(0, 0.001, 0);
  add(floorBottom, baseMat, false);

  // Rope-wrapped rim bead: exactly the physics torus.
  const rim = new THREE.TorusGeometry(R, rimTube, 14, 128);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, yRim, 0);
  add(rim, ropeMat);

  // Stitched leather band a hand's width under the rim (3 mm proud of the weave).
  const b0 = yRim - 0.1;
  const b1 = yRim - 0.045;
  const band = new THREE.LatheGeometry(
    [
      new THREE.Vector2(rOut(b0) - 0.001, b0),
      new THREE.Vector2(rOut(b0) + 0.003, b0 + 0.003),
      new THREE.Vector2(rOut(b1) + 0.003, b1 - 0.003),
      new THREE.Vector2(rOut(b1) - 0.001, b1),
    ],
    96,
  );
  add(band, strapMat);

  // Two flush leather tabs where handles would be.
  for (const phi of [Math.PI / 2, (3 * Math.PI) / 2]) {
    const w = 0.07;
    const y0 = b0 - 0.07;
    const y1 = b1 + 0.02;
    const pl = w / rOut((y0 + y1) / 2);
    const tab = new THREE.LatheGeometry(
      [
        new THREE.Vector2(rOut(y0) + 0.001, y0),
        new THREE.Vector2(rOut(y0) + 0.004, y0 + 0.004),
        new THREE.Vector2(rOut(y1) + 0.004, y1 - 0.004),
        new THREE.Vector2(rOut(y1) + 0.001, y1),
      ],
      8,
      phi - pl / 2,
      pl,
    );
    add(tab, strapMat, false);
  }

  group.position.set(BIN.x, 0, BIN.z);
  group.name = 'rattanBin';

  const def = {
    position: new THREE.Vector3(BIN.x, 0, BIN.z),
    height,
    radiusBottom,
    radiusTop,
    wallThickness,
    floorThickness,
    rimTube,
    object: group,
    sound: 'wicker',
    kind: 'rattan',
  };

  return {
    object: group,
    def,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
