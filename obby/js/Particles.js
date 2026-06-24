// Particles.js — small pooled burst effects (coins, jumps, respawn)
import * as THREE from 'three';

export class Particles {
  constructor(scene, size = 160) {
    this.pool = [];
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.visible = false; scene.add(m);
      this.pool.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 1, baseScale: 1 });
    }
    this.i = 0;
    this.grav = -16;
  }

  burst(pos, { color = 0xffffff, count = 12, speed = 4, up = 3, scale = 1 } = {}) {
    for (let n = 0; n < count; n++) {
      const p = this.pool[this.i = (this.i + 1) % this.pool.length];
      p.mesh.visible = true;
      p.mesh.position.copy(pos);
      p.mesh.material.color.setHex(color);
      p.mesh.material.opacity = 1;
      const a = Math.random() * Math.PI * 2, r = Math.random() * speed;
      p.vel.set(Math.cos(a) * r, up * (0.5 + Math.random()), Math.sin(a) * r);
      p.max = p.life = 0.5 + Math.random() * 0.5;
      p.baseScale = scale * (0.6 + Math.random() * 0.8);
      p.mesh.scale.setScalar(p.baseScale);
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y += this.grav * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.mesh.scale.setScalar(p.baseScale * k);
      p.mesh.material.opacity = k;
      p.mesh.rotation.x += dt * 6; p.mesh.rotation.y += dt * 6;
    }
  }
}
