// Aura.js — animated glowing aura that surrounds the player (shell + ring + orbiting sparks)
import * as THREE from 'three';

export class Aura {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    const add = (geo, op) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); this.group.add(m); return m; };
    this.shell = add(new THREE.SphereGeometry(0.95, 16, 12), 0.14); this.shell.position.y = 1.0;
    this.ring = add(new THREE.TorusGeometry(0.7, 0.06, 8, 22), 0.7); this.ring.rotation.x = Math.PI / 2; this.ring.position.y = 0.12;
    this.orbs = [];
    for (let i = 0; i < 9; i++) { const o = add(new THREE.SphereGeometry(0.085, 8, 8), 0.95); this.orbs.push(o); }
    this.mats = [this.shell.material, this.ring.material, ...this.orbs.map(o => o.material)];
    this.color = null;
  }

  setStyle(color) {
    this.color = color; this.group.visible = !!color;
    if (color) for (const m of this.mats) m.color.setHex(color);
  }

  update(p, time) {
    if (!this.color) { this.group.visible = false; return; }
    this.group.visible = true;
    this.group.position.set(p.x, p.y, p.z);
    this.shell.scale.setScalar(1 + 0.09 * Math.sin(time * 4));
    this.shell.material.opacity = 0.12 + 0.06 * Math.sin(time * 3);
    this.ring.rotation.z += 0.04;
    for (let i = 0; i < this.orbs.length; i++) {
      const a = time * 1.6 + i * (Math.PI * 2 / this.orbs.length);
      const rad = 0.85 + 0.12 * Math.sin(time * 2 + i);
      this.orbs[i].position.set(Math.cos(a) * rad, 1.0 + Math.sin(time * 2.4 + i) * 0.55, Math.sin(a) * rad);
    }
  }
}
