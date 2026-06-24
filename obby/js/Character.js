// Character.js — animated low-poly humanoid (shared by the player and bots)
import * as THREE from 'three';

const SHIRTS = [0xff5ec4, 0x5fe0ff, 0x9bff8a, 0xffd54a, 0xff8c3d, 0xb18cff, 0x4ad0a0];
const PANTS  = [0x2e3b66, 0x3a3a4a, 0x224466, 0x553322, 0x334022];
const SKINS  = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac];

function mat(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.65 }); }
const rand = arr => arr[(Math.random() * arr.length) | 0];

function nameSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,14,30,0.78)';
  ctx.beginPath();
  const r = 16; ctx.roundRect ? ctx.roundRect(6, 8, 244, 44, r) : ctx.rect(6, 8, 244, 44);
  ctx.fill();
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text.slice(0, 14), 128, 31);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(2.0, 0.5, 1);
  spr.position.y = 2.35;
  spr.renderOrder = 999;
  return spr;
}

export class Character {
  constructor(opts = {}) {
    this.group = new THREE.Group();
    const shirt = opts.shirt ?? rand(SHIRTS);
    const pants = opts.pants ?? rand(PANTS);
    const skin = opts.skin ?? rand(SKINS);
    this.color = shirt;

    const shirtMat = mat(shirt), pantMat = mat(pants), skinMat = mat(skin), shoeMat = mat(0x222222);
    this.shirtMat = shirtMat; this.pantMat = pantMat;

    // torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.66, 0.36), shirtMat);
    torso.position.y = 1.18; torso.castShadow = true; this.group.add(torso);

    // hips
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.36), pantMat);
    hips.position.y = 0.84; hips.castShadow = true; this.group.add(hips);

    // head + face
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.44), skinMat);
    head.position.y = 1.74; head.castShadow = true; this.group.add(head); this.head = head;
    const eyeMat = mat(0x1a1a1a);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.04), eyeMat);
      eye.position.set(sx * 0.11, 1.78, 0.225); this.group.add(eye);
    }
    // hair cap
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.48), mat(rand([0x1c1c1c, 0x3a2a1a, 0x000000, 0x5a3a22])));
    hair.position.y = 2.0; this.group.add(hair);

    // arms (shoulder pivots)
    const armGeo = new THREE.BoxGeometry(0.2, 0.66, 0.24);
    this.armL = new THREE.Group(); this.armL.position.set(-0.42, 1.46, 0);
    const aL = new THREE.Mesh(armGeo, shirtMat); aL.position.y = -0.3; aL.castShadow = true; this.armL.add(aL);
    const handL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.24), skinMat); handL.position.y = -0.66; this.armL.add(handL);
    this.group.add(this.armL);

    this.armR = new THREE.Group(); this.armR.position.set(0.42, 1.46, 0);
    const aR = new THREE.Mesh(armGeo, shirtMat); aR.position.y = -0.3; aR.castShadow = true; this.armR.add(aR);
    const handR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.24), skinMat); handR.position.y = -0.66; this.armR.add(handR);
    this.group.add(this.armR);

    // legs (hip pivots)
    const legGeo = new THREE.BoxGeometry(0.24, 0.7, 0.3);
    this.legL = new THREE.Group(); this.legL.position.set(-0.16, 0.84, 0);
    const lL = new THREE.Mesh(legGeo, pantMat); lL.position.y = -0.38; lL.castShadow = true; this.legL.add(lL);
    const footL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.4), shoeMat); footL.position.set(0, -0.74, 0.05); this.legL.add(footL);
    this.group.add(this.legL);

    this.legR = new THREE.Group(); this.legR.position.set(0.16, 0.84, 0);
    const lR = new THREE.Mesh(legGeo, pantMat); lR.position.y = -0.38; lR.castShadow = true; this.legR.add(lR);
    const footR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.4), shoeMat); footR.position.set(0, -0.74, 0.05); this.legR.add(footR);
    this.group.add(this.legR);

    this.accessory = new THREE.Group(); this.group.add(this.accessory);

    if (opts.name) { this.tag = nameSprite(opts.name, opts.tagColor); this.group.add(this.tag); }

    this.phase = 0;
  }

  setColors(shirt, pants) { this.shirtMat.color.setHex(shirt); this.pantMat.color.setHex(pants); this.color = shirt; }

  // apply a full skin "style": body colours + emissive/metal + a distinct accessory
  applyStyle(def) {
    const ei = def.emissiveInt || 0;
    this.shirtMat.color.setHex(def.shirt); this.pantMat.color.setHex(def.pants); this.color = def.shirt;
    this.shirtMat.emissive.setHex(def.emissive || 0x000000); this.shirtMat.emissiveIntensity = ei;
    this.pantMat.emissive.setHex(def.emissive || 0x000000); this.pantMat.emissiveIntensity = ei * 0.5;
    this.shirtMat.metalness = def.metal || 0; this.shirtMat.roughness = def.metal ? 0.3 : 0.65;
    this.pantMat.metalness = def.metal || 0; this.pantMat.roughness = def.metal ? 0.35 : 0.7;
    while (this.accessory.children.length) this.accessory.remove(this.accessory.children[0]);
    this._buildAccessory(def.accessory);
  }
  _acc(geo, color, x, y, z, opts = {}) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts }));
    m.position.set(x, y, z); m.castShadow = true; this.accessory.add(m); return m;
  }
  _buildAccessory(kind) {
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), C = (r1, r2, h, s = 10) => new THREE.CylinderGeometry(r1, r2, h, s),
      CONE = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s), SPH = (r) => new THREE.SphereGeometry(r, 12, 10);
    switch (kind) {
      case 'ninja': {
        this._acc(B(0.5, 0.5, 0.49), 0x0d0d16, 0, 1.74, 0);                            // full balaclava over the head
        this._acc(B(0.46, 0.11, 0.02), 0xf2f2f2, 0, 1.79, 0.245);                       // eye slit
        this._acc(B(0.54, 0.09, 0.51), 0xcc2233, 0, 1.88, 0);                            // headband
        this._acc(B(0.08, 0.4, 0.05), 0xcc2233, 0.16, 1.74, -0.3).rotation.z = 0.5;      // band tails
        this._acc(B(0.08, 0.34, 0.05), 0xcc2233, -0.16, 1.76, -0.3).rotation.z = -0.5;
        const blade = this._acc(B(0.05, 1.05, 0.05), 0x9aa6b5, 0.28, 1.5, -0.27, { metalness: 0.7, roughness: 0.3 }); // katana on back
        blade.rotation.z = 0.5; blade.rotation.x = 0.12;
        this._acc(B(0.07, 0.26, 0.07), 0x111111, 0.5, 1.02, -0.27).rotation.z = 0.5;     // hilt
        break;
      }
      case 'robot':
        this._acc(C(0.03, 0.03, 0.3), 0x999999, 0, 2.12, 0);                          // antenna
        this._acc(SPH(0.07), 0x33ddff, 0, 2.3, 0, { emissive: 0x33ddff, emissiveIntensity: 1 });
        this._acc(B(0.5, 0.15, 0.46), 0x1199ff, 0, 1.78, 0.0, { emissive: 0x1199ff, emissiveIntensity: 0.9 }); // visor
        this._acc(B(0.22, 0.22, 0.05), 0x33ddff, 0, 1.5, 0.2, { emissive: 0x33ddff, emissiveIntensity: 0.8 }); // chest
        break;
      case 'knight':
        this._acc(SPH(0.27), 0x8a8f9c, 0, 1.82, 0, { metalness: 0.7, roughness: 0.35 }).scale.set(1, 1.05, 1); // helmet
        this._acc(B(0.34, 0.07, 0.04), 0x222222, 0, 1.76, 0.23);                       // visor slit
        this._acc(CONE(0.1, 0.5), 0xff5a1e, 0, 2.25, 0, { emissive: 0xff3300, emissiveIntensity: 0.7 });       // plume
        this._acc(SPH(0.1), 0xff5a1e, 0.45, 1.5, 0, { emissive: 0xff3300, emissiveIntensity: 0.8 });           // shoulder fire
        this._acc(SPH(0.1), 0xff5a1e, -0.45, 1.5, 0, { emissive: 0xff3300, emissiveIntensity: 0.8 });
        break;
      case 'mage':
        this._acc(C(0.42, 0.42, 0.06), 0x244a8a, 0, 1.98, 0);                          // hat brim
        this._acc(CONE(0.3, 0.75, 12), 0x2a55a0, 0, 2.4, 0, { emissive: 0x66ccff, emissiveIntensity: 0.3 });   // hat
        this._acc(SPH(0.07), 0xaef0ff, 0, 2.8, 0, { emissive: 0x99eaff, emissiveIntensity: 1 });               // tip glow
        break;
      case 'assassin': {
        const hood = this._acc(CONE(0.42, 0.6, 8), 0x140a20, 0, 2.0, -0.04); hood.rotation.x = 0.2;            // hood
        this._acc(B(0.7, 0.95, 0.08), 0x100818, 0, 1.35, -0.27);                       // cloak
        this._acc(SPH(0.04), 0xb060ff, 0.11, 1.78, 0.23, { emissive: 0xb060ff, emissiveIntensity: 1 });        // glowing eyes
        this._acc(SPH(0.04), 0xb060ff, -0.11, 1.78, 0.23, { emissive: 0xb060ff, emissiveIntensity: 1 });
        break;
      }
      case 'galaxy':
        this._acc(B(0.5, 0.16, 0.46), 0x9b5cff, 0, 1.78, 0.0, { emissive: 0xb070ff, emissiveIntensity: 1 });   // visor
        this._acc(new THREE.TorusGeometry(0.34, 0.04, 8, 18), 0xb070ff, 0, 1.5, 0, { emissive: 0xb070ff, emissiveIntensity: 0.9 }).rotation.x = Math.PI / 2;
        this._acc(SPH(0.05), 0xffffff, 0.2, 2.0, 0.1, { emissive: 0xffffff, emissiveIntensity: 1 });
        break;
      case 'gold':
        this._acc(new THREE.TorusGeometry(0.24, 0.05, 8, 16), 0xffd54a, 0, 2.02, 0, { metalness: 0.9, roughness: 0.2, emissive: 0xffaa00, emissiveIntensity: 0.4 }).rotation.x = Math.PI / 2;
        for (const a of [0, 1, 2, 3, 4]) { const ang = a / 5 * Math.PI * 2; this._acc(CONE(0.05, 0.16, 6), 0xffe27a, Math.cos(ang) * 0.22, 2.1, Math.sin(ang) * 0.22, { metalness: 0.9, roughness: 0.2 }); }
        this._acc(B(0.66, 0.85, 0.06), 0xffcf3a, 0, 1.4, -0.24, { metalness: 0.8, roughness: 0.3, emissive: 0xffaa00, emissiveIntensity: 0.2 }); // cape
        break;
    }
  }

  // moveAmt 0..1 (how fast moving), grounded bool
  animate(dt, moveAmt, grounded) {
    if (!grounded) {
      // tuck pose in the air
      this.legL.rotation.x = -0.5; this.legR.rotation.x = 0.3;
      this.armL.rotation.x = -2.2; this.armR.rotation.x = -2.2;
      return;
    }
    if (moveAmt > 0.05) {
      this.phase += dt * (6 + moveAmt * 7);
      const a = Math.sin(this.phase) * (0.5 + moveAmt * 0.6);
      this.legL.rotation.x = a; this.legR.rotation.x = -a;
      this.armL.rotation.x = -a; this.armR.rotation.x = a;
    } else {
      // ease back to idle
      for (const p of [this.legL, this.legR, this.armL, this.armR])
        p.rotation.x += (0 - p.rotation.x) * Math.min(1, dt * 10);
    }
  }
}
