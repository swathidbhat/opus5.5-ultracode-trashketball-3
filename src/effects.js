import * as THREE from 'three';

// Saturated colours only: the office walls are white, so pale confetti disappears against them.
const PALETTES = {
  office: [0x1fc7b8, 0x1d7fd6, 0xf2b632, 0x2f9e5b, 0xe2553f],
  beach: [0xff7f5c, 0xffc56b, 0x3fb8c9, 0xff5f8f, 0x7bd389],
};

/**
 * Confetti burst for a made basket. One InstancedMesh, recycled across bursts.
 */
export class Confetti {
  constructor(count = 120) {
    this.count = count;
    const geo = new THREE.PlaneGeometry(0.026, 0.04);
    this.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.object = this.mesh;
    this.parts = Array.from({ length: count }, () => ({
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rot: new THREE.Euler(),
      spin: new THREE.Vector3(),
    }));
    this.life = 0;
    this.palette = PALETTES.office;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }

  setTheme(theme) {
    this.palette = PALETTES[theme] ?? PALETTES.office;
  }

  /** @param {THREE.Vector3} origin where the burst starts (the bin opening) */
  burst(origin) {
    this.life = 1.8;
    this.mesh.visible = true;
    this.material.opacity = 1;
    this.parts.forEach((p, i) => {
      p.pos.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const up = 2.2 + Math.random() * 2.2;
      const out = 0.4 + Math.random() * 1.1;
      p.vel.set(Math.cos(a) * out, up, Math.sin(a) * out);
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      this.mesh.setColorAt(i, this._c.setHex(this.palette[i % this.palette.length]));
    });
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.material.opacity = Math.min(1, this.life / 0.6);
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      // Paper confetti flutters: strong drag, gentle gravity.
      p.vel.y -= 4.5 * dt;
      p.vel.multiplyScalar(Math.exp(-2.6 * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.005) {
        p.pos.y = 0.005;
        p.vel.set(0, 0, 0);
        p.spin.multiplyScalar(0.8);
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      this._q.setFromEuler(p.rot);
      this._m.compose(p.pos, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
