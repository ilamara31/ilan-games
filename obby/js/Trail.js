// Trail.js — long ribbon trail that follows the player and lingers behind
import * as THREE from 'three';

const N = 44;          // segments (long)
const STEP = 0.28;     // distance between recorded points -> spans ~12 units
const HEADW = 0.6;     // ribbon width at the head

export class Trail {
  constructor(scene) {
    this.points = [];
    this.color = null; this.effect = null;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    this.col = new Float32Array(N * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
    this._c = new THREE.Color();
  }

  setStyle(color, effect) {
    this.color = color; this.effect = effect || null; this.points = [];
    this.mesh.visible = !!color;
  }

  update(p, time) {
    if (!this.color) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const head = { x: p.x, y: p.y + 0.45, z: p.z };
    if (this.points.length === 0) for (let i = 0; i < N; i++) this.points.push({ ...head });
    else {
      this.points[0] = head;
      const d = this.points[1] ? Math.hypot(head.x - this.points[1].x, head.z - this.points[1].z) : 0;
      if (d > STEP) { this.points.unshift({ ...head }); if (this.points.length > N) this.points.pop(); }
    }
    const pts = this.points, n = pts.length;
    for (let i = 0; i < N; i++) {
      const pi = Math.min(i, n - 1), a = pts[Math.max(0, pi - 1)], b = pts[Math.min(n - 1, pi + 1)], c = pts[pi];
      let tx = a.x - b.x, tz = a.z - b.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const px = -tz, pz = tx;                            // perpendicular in XZ
      const fade = 1 - i / N, w = HEADW * fade * 0.5;
      const o = i * 6;
      this.pos[o] = c.x + px * w; this.pos[o + 1] = c.y; this.pos[o + 2] = c.z + pz * w;
      this.pos[o + 3] = c.x - px * w; this.pos[o + 4] = c.y; this.pos[o + 5] = c.z - pz * w;
      // colour
      if (this.color === 'rainbow') this._c.setHSL((i * 0.03 + time * 0.4) % 1, 0.9, 0.55);
      else if (this.effect === 'fire') this._c.setHex(0xffd54a).lerp(new THREE.Color(this.color), Math.min(1, i / N * 1.6));
      else this._c.setHex(this.color);
      const r = this._c.r * fade, g = this._c.g * fade, bl = this._c.b * fade;
      this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = bl;
      this.col[o + 3] = r; this.col[o + 4] = g; this.col[o + 5] = bl;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}
