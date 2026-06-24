// World.js — 50 stages, 5 themes, mixed obstacles, disappearing platforms, secrets
import * as THREE from 'three';

const THEMES = [
  { name: 'Meadow',     sky: ['#9ed8ff', '#e8f7ff'], fog: 0xcfeaff, hemi: 0xeaf3ff, hemiG: 0x6a7a55, sun: 0xfff3df, voidC: 0x7fb6ff, hue: 0.33, light: 0.56 },
  { name: 'Sunset',     sky: ['#ff9e6b', '#ffe6cc'], fog: 0xffcfa8, hemi: 0xffe0c0, hemiG: 0x7a5a3a, sun: 0xffd9a0, voidC: 0xff9a5a, hue: 0.06, light: 0.56 },
  { name: 'Candy',      sky: ['#ff9ed8', '#ffe0f4'], fog: 0xffd0ee, hemi: 0xffe0f5, hemiG: 0x7a5a70, sun: 0xffe6f2, voidC: 0xff9ed8, hue: 0.86, light: 0.6 },
  { name: 'Neon Night', sky: ['#0c1740', '#27306a'], fog: 0x12204a, hemi: 0x3a4878, hemiG: 0x222a4a, sun: 0x9fb0ff, voidC: 0x2a3a7a, hue: 0.6, light: 0.5 },
  { name: 'Lava',       sky: ['#3a1212', '#7a3018'], fog: 0x5a2414, hemi: 0xffb070, hemiG: 0x5a2a18, sun: 0xffd0a0, voidC: 0xc24016, hue: 0.02, light: 0.54 },
];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.platforms = []; this.movers = []; this.rotators = []; this.lasers = [];
    this.hazardBalls = []; this.conveyors = []; this.fades = []; this.coins = []; this.checkpoints = [];
    this.killY = -16; this.PH = 0.6; this.totalStages = 50; this._matCache = new Map(); this._z = 4;
    this._skyTex = {};
    this.themes = THEMES;

    this._lights();
    this._void();
    this._clouds();
    this._generate();

    this.spawn = new THREE.Vector3(0, 0.25, 0);
    this.winZone = this.platforms.find(p => p.type === 'win');
    this.curTheme = -1;
    this.setTheme(0);
  }

  themeForStage(stage) { return Math.min(THEMES.length - 1, Math.floor((stage - 1) / 10)); }

  _skyTexture(i) {
    if (this._skyTex[i]) return this._skyTex[i];
    const th = THEMES[i], c = document.createElement('canvas'); c.width = 16; c.height = 256;
    const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this._skyTex[i] = t; return t;
  }
  setTheme(i) {
    if (i === this.curTheme) return; this.curTheme = i; const th = THEMES[i];
    this.scene.background = this._skyTexture(i);
    this.scene.fog = new THREE.Fog(th.fog, 80, 240);
    this.hemi.color.setHex(th.hemi); this.hemi.groundColor.setHex(th.hemiG);
    this.sun.color.setHex(th.sun);
    if (this.voidMesh) this.voidMesh.material.color.setHex(th.voidC);
  }

  // ---------- visuals ----------
  _mat(color, opts) {
    if (!opts) { if (!this._matCache.has(color)) this._matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.7 })); return this._matCache.get(color); }
    return new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
  }
  _stageColor(stage) { const th = THEMES[this.themeForStage(stage)]; return new THREE.Color().setHSL((th.hue + (stage % 10) * 0.018) % 1, 0.6, th.light).getHex(); }
  _lights() {
    this.hemi = new THREE.HemisphereLight(0xeaf3ff, 0x6a7a55, 1.1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3df, 1.4); this.sun.position.set(20, 44, 12); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004;
    const s = this.sun.shadow.camera; s.near = 1; s.far = 130; s.left = -28; s.right = 28; s.top = 28; s.bottom = -28;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    const fill = new THREE.DirectionalLight(0xbcd6ff, 0.4); fill.position.set(-18, 22, -10); this.scene.add(fill);
  }
  updateShadow(p) { this.sun.position.set(p.x + 20, p.y + 44, p.z + 12); this.sun.target.position.set(p.x, p.y, p.z); this.sun.target.updateMatrixWorld(); }
  _void() {
    this.voidMesh = new THREE.Mesh(new THREE.CircleGeometry(360, 48), new THREE.MeshBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.45 }));
    this.voidMesh.rotation.x = -Math.PI / 2; this.voidMesh.position.y = this.killY - 2; this.scene.add(this.voidMesh);
  }
  _clouds() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    for (let i = 0; i < 28; i++) { const g = new THREE.Group(); for (let j = 0; j < 3; j++) { const b = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 2.4, 8, 6), m); b.position.set(j * 2.6 - 2.6, Math.random(), Math.random()); g.add(b); } g.position.set((Math.random() - 0.5) * 130, 22 + Math.random() * 24, Math.random() * 1200 - 20); this.scene.add(g); }
  }
  _numberSprite(text, size = 1.5) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(10,14,30,0.82)'; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(14, 30, 100, 68, 16) : ctx.rect(14, 30, 100, 68)); ctx.fill();
    ctx.fillStyle = '#ffd54a'; ctx.font = 'bold 52px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 64, 66);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); spr.scale.set(size, size, 1); return spr;
  }

  // ---------- factory ----------
  _plat(cx, top, cz, w, d, color, type = 'normal', opts = {}) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, this.PH, d), this._mat(color, opts.matOpts));
    box.position.set(cx, top - this.PH / 2, cz); box.castShadow = true; box.receiveShadow = true; this.scene.add(box);
    const p = { mesh: box, type, color, hw: w / 2, hd: d / 2, cx, cz, top, dx: 0, dz: 0, stage: 0, solid: true, offPath: !!opts.offPath,
      minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
    this.platforms.push(p);
    if (type === 'checkpoint') this.checkpoints.push(p);
    if (type === 'jumppad') this._padDeco(cx, top, cz, w, d);
    if (type === 'boost') this._boostDeco(cx, top, cz, w, d);
    if (type === 'win') this._winDeco(cx, top, cz);
    return p;
  }
  _mover(cx, top, cz, w, d, color, range, speed, phase = 0) {
    const p = this._plat(cx, top, cz, w, d, color, 'moving', { matOpts: { emissive: 0x101a33, emissiveIntensity: 0.4 } });
    p.base = { x: cx, z: cz }; p.range = range; p.speed = speed; p.phase = phase; this.movers.push(p); return p;
  }
  _rotator(cx, top, cz, platSize, arms, speed) {
    this._plat(cx, top, cz, platSize, platSize, 0xff6b6b, 'normal');
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 10), this._mat(0x333344)); post.position.set(cx, top + 0.6, cz); this.scene.add(post);
    const grp = new THREE.Group(); grp.position.set(cx, top + 0.55, cz); this.scene.add(grp); const reach = platSize / 2 + 0.4;
    for (let a = 0; a < arms; a++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(reach * 2, 0.3, 0.3), this._mat(0xffd54a, { emissive: 0x6a4a00, emissiveIntensity: 0.5 })); bar.rotation.y = (a / arms) * Math.PI; bar.castShadow = true; grp.add(bar); }
    this.rotators.push({ grp, x: cx, z: cz, y: top + 0.55, reach, angle: 0, angVel: speed, arms });
  }
  _flag(cx, top, cz, stage) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), this._mat(0xeeeeee)); pole.position.set(cx - 1.85, top + 0.9, cz); this.scene.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.05), this._mat(0x9bff8a, { emissive: 0x1a4d1a, emissiveIntensity: 0.5 })); flag.position.set(cx - 1.5, top + 1.5, cz); this.scene.add(flag);
    const spr = this._numberSprite(String(stage)); spr.position.set(cx, top + 2.8, cz); this.scene.add(spr);
  }
  _padDeco(cx, top, cz, w, d) { const pad = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.4, Math.min(w, d) * 0.45, 0.18, 16), this._mat(0xff5ec4, { emissive: 0x80104d, emissiveIntensity: 0.7 })); pad.position.set(cx, top + 0.09, cz); this.scene.add(pad); }
  _boostDeco(cx, top, cz, w, d) { for (let i = -1; i <= 1; i++) { const a = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.5, 4), this._mat(0x5fe0ff, { emissive: 0x0a4a66, emissiveIntensity: 0.7 })); a.rotation.x = -Math.PI / 2; a.position.set(cx, top + 0.06, cz + i * 0.9); this.scene.add(a); } }
  _winDeco(cx, top, cz) {
    for (const sx of [-2.6, 2.6]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4.2, 12), this._mat(0xffd54a, { emissive: 0x5a4400, emissiveIntensity: 0.5 })); post.position.set(cx + sx, top + 2.1, cz); this.scene.add(post); }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.2), this._mat(0x39d98a, { emissive: 0x0c5a32, emissiveIntensity: 0.6 })); banner.position.set(cx, top + 4, cz); this.scene.add(banner);
    const spr = this._numberSprite('🏁', 2.4); spr.position.set(cx, top + 4, cz + 0.2); this.scene.add(spr);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.2, 12, 28), this._mat(0xffd54a, { emissive: 0x6a5200, emissiveIntensity: 0.8 })); ring.position.set(cx, top + 1.7, cz); this.scene.add(ring); this.winRing = ring;
  }
  _coin(x, y, z, value = 3, secret = false) {
    const col = secret ? 0xff5ec4 : 0xffd54a;
    const m = new THREE.Mesh(new THREE.TorusGeometry(secret ? 0.42 : 0.32, 0.13, 10, 18), this._mat(col, { emissive: secret ? 0x7a1050 : 0x7a5a00, emissiveIntensity: 0.85, metalness: 0.3 }));
    m.rotation.x = Math.PI / 2; m.position.set(x, y, z); m.castShadow = true; this.scene.add(m);
    this.coins.push({ mesh: m, pos: new THREE.Vector3(x, y, z), collected: false, value, secret });
  }
  _maybeCoin(cx, cz) { if (Math.random() < 0.55) this._coin(cx, 1.3, cz); }

  // ---------- cursor builders ----------
  _cp(stage) {
    const sz = 4.6, cz = this._z + 1.8 + sz / 2;
    const cp = this._plat(0, 0, cz, sz, sz, 0xffd54a, 'checkpoint', { matOpts: { emissive: 0x4a3a00, emissiveIntensity: 0.35 } });
    cp.stage = stage; this._flag(0, 0, cz, stage); this._coin(0, 1.3, cz); this._z = cz + sz / 2;
    if (stage % 7 === 0) this._secret(cz, stage);
  }
  _blk(cx, sz, gap, stage) { const cz = this._z + gap + sz / 2; this._plat(cx, 0, cz, sz, sz, this._stageColor(stage)); this._z = cz + sz / 2; this._maybeCoin(cx, cz); }
  _pad(cx, sz, gap) { const cz = this._z + gap + sz / 2; this._plat(cx, 0, cz, sz, sz, 0xff5ec4, 'jumppad'); this._z = cz + sz / 2; }
  _bst(cx, sz, gap) { const cz = this._z + gap + sz / 2; this._plat(cx, 0, cz, sz + 1.2, sz, 0x9b6fff, 'boost'); this._z = cz + sz / 2; }
  _mov(cx, sz, gap, range, speed) { const cz = this._z + gap + sz / 2; this._mover(cx, 0, cz, sz + 0.3, sz, 0x6f8cff, range, speed); this._z = cz + sz / 2; }
  _rot(gap, size, arms, speed) { const cz = this._z + gap + size / 2; this._rotator(0, 0, cz, size, arms, speed); this._z = cz + size / 2; }
  _ball(cx, gap, r = 0.95) {
    const top = 1.5, cy = top - r, cz = this._z + gap + r;
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), this._mat(0xff8c3d, { emissive: 0x5a2a00, emissiveIntensity: 0.35 })); s.position.set(cx, cy, cz); s.castShadow = true; this.scene.add(s);
    const cap = this._plat(cx, top, cz, r * 1.7, r * 1.7, 0xffd54a, 'bouncy'); cap.mesh.visible = false; this._z = cz + r;
  }
  // disappearing platform: auto-cycles solid -> warn -> gone -> back
  _fade(cx, sz, gap, stage, phase = 0) {
    const cz = this._z + gap + sz / 2;
    const p = this._plat(cx, 0, cz, sz, sz, 0x8fa4c8, 'fade', { matOpts: { transparent: true } });
    p.phase = phase; this.fades.push(p); this._z = cz + sz / 2;
  }
  _laserRun(stage, len, beams, gap) {
    const w = 4.4, cz = this._z + gap + len / 2; this._plat(0, 0, cz, w, len, this._stageColor(stage));
    beams.forEach((b, i) => this._laser(0, cz + b.z, w - 0.2, b.y, b, i)); this._z = cz + len / 2; this._coin(0, 1.3, cz);
  }
  _laser(cx, cz, width, y, opts, idx) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff2233, emissiveIntensity: 1.1, transparent: true });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, 0.16), mat); mesh.position.set(cx, y, cz); this.scene.add(mesh);
    for (const sx of [-1, 1]) { const node = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), this._mat(0x888899)); node.position.set(cx + sx * width / 2, y, cz); this.scene.add(node); }
    const L = { mesh, y, minX: cx - width / 2, maxX: cx + width / 2, base: { z: cz }, minZ: cz - 0.24, maxZ: cz + 0.24, active: true };
    if (opts.blink) { L.on = opts.blink[0]; L.off = opts.blink[1]; L.phase = (idx || 0) * 0.7; }
    if (opts.sweep && opts.sweep.range > 0) L.sweep = opts.sweep;
    this.lasers.push(L);
  }
  _hazardFloor(stage, len, balls, gap) {
    const w = 5.2, cz = this._z + gap + len / 2; this._plat(0, 0, cz, w, len, this._stageColor(stage));
    for (const b of balls) this._hazardBall(cz + b.z, b.range, b.speed); this._z = cz + len / 2; this._coin(0, 1.3, cz);
  }
  _hazardBall(cz, range, speed, r = 0.7, y = 0.7) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), this._mat(0xff4444, { emissive: 0x5a0000, emissiveIntensity: 0.55 })); m.castShadow = true; this.scene.add(m);
    this.hazardBalls.push({ mesh: m, base: { z: cz }, range, speed, r, y, x: 0 });
  }
  // hidden side platform with a big secret coin (off the main path)
  _secret(cz, stage) {
    const sx = Math.random() < 0.5 ? -1 : 1, x = sx * (4.6 + Math.random() * 0.8);
    this._plat(x, 0, cz, 2.0, 2.0, 0x6a4bbf, 'normal', { offPath: true, matOpts: { emissive: 0x2a1060, emissiveIntensity: 0.5 } });
    this._coin(x, 1.4, cz, 25, true);
  }

  // ---------- 50-stage generator (themed, mixed elements, reachable) ----------
  _placeOne(stage, tier) {
    const r = Math.random();
    const zig = (m) => (Math.random() < 0.5 ? -1 : 1) * m * (Math.random() < 0.7 ? 1 : 0);
    if (tier === 0) {
      if (r < 0.18) this._pad(0, 2.8, 1.9);
      else if (r < 0.38) this._ball(zig(0.6), 2.0);
      else this._blk(zig(0.6), 2.7, 1.7, stage);
    } else if (tier === 1) {
      if (r < 0.16) this._mov(zig(0.6), 2.5, 1.9, 2.4 + Math.random(), 1.1 + Math.random() * 0.5);
      else if (r < 0.30) this._ball(zig(0.7), 2.0);
      else if (r < 0.42) this._bst(0, 2.6, 1.7);
      else if (r < 0.54) this._laserRun(stage, 8, [{ z: -2, y: 0.55 }, { z: 2, y: 0.55, sweep: { range: 2.3, speed: 1.6 } }], 1.8);
      else if (r < 0.62) this._fade(zig(0.5), 2.3, 1.8, stage, Math.random() * 2);
      else this._blk(zig(0.8), 2.4, 1.9, stage);
    } else {
      if (r < 0.16) this._rot(1.9, 5, Math.random() < 0.5 ? 2 : 3, (Math.random() < 0.5 ? 1 : -1) * (1.6 + Math.random()));
      else if (r < 0.30) this._mov(zig(0.8), 2.4, 2.0, 2.8 + Math.random() * 1.2, 1.5 + Math.random());
      else if (r < 0.42) this._ball(zig(0.7), 2.0);
      else if (r < 0.56) this._laserRun(stage, 11, [{ z: -3, y: 1.3, blink: [1.0, 1.0] }, { z: 0, y: 1.3, blink: [1.0, 1.0] }, { z: 3, y: 1.3, blink: [1.0, 1.0] }], 1.8);
      else if (r < 0.70) this._fade(zig(0.6), 2.1, 1.9, stage, Math.random() * 2);
      else if (r < 0.80) this._hazardFloor(stage, 12, [{ z: -3.5, range: 3, speed: 1.6 }, { z: 0, range: 3.5, speed: 2.0 }, { z: 3.5, range: 3, speed: -1.8 }], 1.8);
      else this._blk(zig(1.1), 2.2, 2.0, stage);
    }
  }
  _generate() {
    const start = this._plat(0, 0, 0, 8, 8, 0x59c36a, 'checkpoint'); start.stage = 1; this._flag(0, 0, 3.4, 1); this._coin(0, 1.3, 2);
    this._z = 4;
    for (let s = 2; s <= this.totalStages; s++) {
      const tier = s <= 12 ? 0 : s <= 32 ? 1 : 2;
      const count = tier === 0 ? 3 : tier === 1 ? 4 : 5;     // bigger stages
      for (let o = 0; o < count; o++) this._placeOne(s, tier);
      this._cp(s);
    }
    const wz = this._z + 2.2 + 3; this._plat(0, 0, wz, 6, 6, 0xffd54a, 'win'); this._coin(0, 1.4, wz); this.endZ = wz;
  }

  // ---------- per-frame ----------
  update(dt, time) {
    for (const m of this.movers) { const px = m.mesh.position.x; m.mesh.position.x = m.base.x + Math.sin(time * m.speed + m.phase) * m.range; m.cx = m.mesh.position.x; m.minX = m.cx - m.hw; m.maxX = m.cx + m.hw; m.dx = m.mesh.position.x - px; m.dz = 0; }
    for (const cv of this.conveyors) { cv.dx = cv.push.x * dt; cv.dz = cv.push.z * dt; }
    for (const r of this.rotators) { r.angle += r.angVel * dt; r.grp.rotation.y = r.angle; }
    for (const L of this.lasers) { if (L.on !== undefined) { const p = (time + L.phase) % (L.on + L.off); L.active = p < L.on; L.mesh.visible = L.active; } if (L.sweep) { const z = L.base.z + Math.sin(time * L.sweep.speed) * L.sweep.range; L.mesh.position.z = z; L.minZ = z - 0.24; L.maxZ = z + 0.24; } }
    for (const b of this.hazardBalls) { b.x = b.base.x + Math.sin(time * b.speed) * b.range; b.mesh.position.set(b.x, b.y, b.base.z); b.mesh.rotation.x += dt * 4; }
    // disappearing platforms: solid (2.4s) -> warn flash (0.7s) -> gone (1.1s)
    for (const f of this.fades) {
      const T = 4.2, t = (time + f.phase) % T;
      if (t < 2.4) { f.solid = true; f.mesh.visible = true; f.mesh.material.opacity = 1; }
      else if (t < 3.1) { f.solid = true; f.mesh.visible = true; f.mesh.material.opacity = 0.55 + 0.35 * Math.sin(time * 30); } // warning flash
      else { f.solid = false; f.mesh.visible = true; f.mesh.material.opacity = 0.12; }
    }
    for (const c of this.coins) { if (c.collected) continue; c.mesh.rotation.z += dt * 3; c.mesh.position.y = c.pos.y + Math.sin(time * 3 + c.pos.z) * 0.13; }
    if (this.winRing) this.winRing.rotation.z += dt * 1.5;
  }
}
