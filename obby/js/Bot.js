// Bot.js — AI runner. Follows the course waypoints, jumps gaps, makes occasional mistakes.
import * as THREE from 'three';
import { Character } from './Character.js';
import { resolveGround, rotatorHit, hazardHit } from './Physics.js';

const GRAV = 26, JUMP = 10.5, PAD = 19, BOUNCE = 9, R = 0.32;

export class Bot {
  constructor(scene, world, name) {
    this.world = world; this.name = name;
    this.char = new Character({ name, tagColor: '#bfe0ff' });
    scene.add(this.char.group);
    this.pos = this.char.group.position;

    // ordered path = main-line platforms (skip off-path secrets), sorted along the course
    this.path = world.platforms.filter(p => !p.offPath).sort((a, b) => a.cz - b.cz);
    this.startIdx = 0;
    this.respawnIdx = 0;
    this.wp = 1;
    this.stage = 1;

    const s = this.path[0];
    this.pos.set(s.cx + (Math.random() * 4 - 2), s.top + 0.2, s.cz + (Math.random() * 2 - 1));
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.targetYaw = 0; this.moveAmt = 0;
    this.grounded = false; this.ground = null; this.jumps = 0;
    this.jumpCd = Math.random(); this.mistakeT = 0; this.veer = { x: 0, z: 0 };
    this.speed = 4.0 + Math.random() * 1.4;
    this.skill = 0.12 + Math.random() * 0.16;     // mistake probability
  }

  _toIdx(i) {
    const p = this.path[i];
    this.pos.set(p.cx, p.top + 0.2, p.cz);
    this.vel.set(0, 0, 0); this.mistakeT = 0; this.wp = Math.min(i + 1, this.path.length - 1);
  }

  update(dt) {
    // carry on movers
    if (this.ground && (this.ground.dx || this.ground.dz)) { this.pos.x += this.ground.dx; this.pos.z += this.ground.dz; }

    const tgt = this.path[this.wp] || this.path[this.path.length - 1];
    let dx = tgt.cx - this.pos.x, dz = tgt.cz - this.pos.z;
    if (this.mistakeT > 0) { this.mistakeT -= dt; dx += this.veer.x; dz += this.veer.z; }
    const distXZ = Math.hypot(tgt.cx - this.pos.x, tgt.cz - this.pos.z);
    const len = Math.hypot(dx, dz) || 1;
    this.pos.x += (dx / len) * this.speed * dt;
    this.pos.z += (dz / len) * this.speed * dt;
    this.targetYaw = Math.atan2(dx, dz);
    this.moveAmt = 1;

    // vertical
    const prevY = this.pos.y;
    this.vel.y -= GRAV * dt;
    this.pos.y += this.vel.y * dt;
    this.ground = resolveGround(this.world, this.pos, this.vel, prevY, R);
    this.grounded = !!this.ground;

    if (this.grounded) {
      this.jumps = 0;
      const t = this.ground.type;
      if (t === 'jumppad' || t === 'bouncy') { this.vel.y = (t === 'bouncy' ? BOUNCE : PAD); this.grounded = false; this.ground = null; }
      else if (t === 'checkpoint') {
        const i = this.path.indexOf(this.ground); if (i > this.respawnIdx) this.respawnIdx = i;
        if (this.ground.stage > this.stage) this.stage = this.ground.stage;
      }
      else if (t === 'win') { this.stage = 1; this.respawnIdx = this.startIdx; this._toIdx(this.startIdx); return; }   // finished -> climb again

      // decide to jump as it nears the next platform
      this.jumpCd -= dt;
      if (this.jumpCd <= 0 && distXZ > 0.8 && distXZ < 3.4) {
        if (Math.random() < this.skill) {            // a mistake: weak/wrong jump
          this.vel.y = JUMP * (0.45 + Math.random() * 0.3);
          this.mistakeT = 0.5; const ang = Math.random() * Math.PI * 2;
          this.veer = { x: Math.cos(ang) * 3, z: Math.sin(ang) * 3 };
        } else {
          this.vel.y = JUMP;
        }
        this.grounded = false; this.ground = null; this.jumps = 1;
        this.jumpCd = 0.45 + Math.random() * 0.4;
      }
    }

    // reached the waypoint
    if (distXZ < 1.2) {
      if (tgt.type === 'win') { this._toIdx(this.startIdx); return; }
      this.wp = Math.min(this.wp + 1, this.path.length - 1);
    }

    // spinner knocks the bot off
    const k = rotatorHit(this.world, this.pos);
    if (k) { this.vel.y = 6; this.pos.x += k.x * 0.6; this.pos.z += k.z * 0.6; this.mistakeT = 0.4; this.veer = { x: k.x * 5, z: k.z * 5 }; }
    const hz = hazardHit(this.world, this.pos, false);   // bots dodge rolling balls but ignore lasers
    if (hz && hz.effect === 'knock') { this.vel.y = 5; this.mistakeT = 0.4; this.veer = { x: hz.x * 5, z: hz.z * 5 }; }

    if (this.pos.y < this.world.killY) this._toIdx(this.respawnIdx);

    this.yaw += (((this.targetYaw - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10);
    this.char.group.rotation.y = this.yaw;
    this.char.animate(dt, this.moveAmt, this.grounded);
  }

  getState() {
    return { name: this.name, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, color: this.char.color, anim: this.grounded ? 'run' : 'jump' };
  }
}
