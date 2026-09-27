import * as THREE from 'three';

/**
 * Wireframe overlay of a level's collision shapes (room, boxes, cylinders, the bin profile, shot spots).
 * Used by the dev preview and by the game with ?debug=1.
 * @param {object} level LevelDef (see docs/ARCHITECTURE.md)
 * @returns {THREE.Group}
 */
export function buildColliderDebug(level) {
  const g = new THREE.Group();
  g.name = 'collider-debug';
  const { room, boxes = [], cylinders = [] } = level.colliders;
  g.add(new THREE.Box3Helper(new THREE.Box3(room.min, room.max), 0x00ffff));
  for (const b of boxes) {
    g.add(new THREE.Box3Helper(new THREE.Box3(b.min, b.max), b.material === 'soft' ? 0xff8800 : 0xffff00));
  }
  const cylMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
  for (const c of cylinders) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, c.yMax - c.yMin, 20, 1, true), cylMat);
    m.position.set(c.x, (c.yMin + c.yMax) / 2, c.z);
    g.add(m);
  }

  // Bin collider profile in its meridian plane: wall band (both faces), bottom plate, rim torus.
  const bin = level.bin;
  const t = bin.wallThickness / 2;
  const R = bin.radiusTop - t;
  const rb = bin.radiusBottom - t;
  const yRim = bin.height - bin.rimTube;
  const binMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
  const lathe = (pts) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 24), binMat);
  const binG = new THREE.Group();
  binG.add(lathe([[rb - t, 0], [R - t, yRim]]));
  binG.add(lathe([[rb + t, 0], [R + t, yRim]]));
  binG.add(lathe([[0.0001, bin.floorThickness], [rb, bin.floorThickness]]));
  const torus = new THREE.Mesh(new THREE.TorusGeometry(R, bin.rimTube, 8, 32), binMat);
  torus.rotation.x = Math.PI / 2;
  torus.position.y = yRim;
  binG.add(torus);
  binG.position.copy(bin.position);
  g.add(binG);

  const rimCenter = new THREE.Vector3(bin.position.x, bin.position.y + yRim, bin.position.z);
  const spotMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
  const lineMat = new THREE.LineBasicMaterial({ color: 0xff3333 });
  for (const s of level.shotSpots) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), spotMat);
    m.position.copy(s.eye);
    g.add(m);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([s.eye, rimCenter]), lineMat));
  }
  return g;
}
