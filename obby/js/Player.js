// Player.js — local player controller (also exposes serializable state for multiplayer)
import * as THREE from 'three';
import { Character } from './Character.js';
import { Trail } from './Trail.js';
import { Aura } from './Aura.js';
import { resolveGround, rotatorHit, hazardHit } from './Physics.js';

const GRAV = 26, JUMP = 10.5, PAD = 19, BOUNCE = 9, MOVE = 6.2, SPRINT = 1.6, BOOST_MUL = 1.55, BOOST_TIME = 2.4, R = 0.32;

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

export class Player {
  constructor(scene, world, particles, hud, name, opts = {}) {
    this.world = world; this.particles = particles; this.hud = hud; this.name = name;
    this.audio = opts.audio || null;
    this.char = new Character({ name, tagColor: '#ffe28a' });
    scene.add(this.char.group);
    if (opts.skin) this.char.applyStyle(opts.skin);
    this.trail = new Trail(scene); this.aura = new Aura(scene);
    if (opts.trail) this.trail.setStyle(opts.trail.color, opts.trail.effect);
    if (opts.aura) this.aura.setStyle(opts.aura.color);
    this.power = opts.power ? { speed: opts.power.speed, grav: opts.power.grav, jump: opts.power.jump } : { speed: 1, grav: 1, jump: 1 };
    this.pos = this.char.group.position;
    const start = opts.startPos || world.spawn;
    this.pos.copy(start);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.targetYaw = 0; this.moveAmt = 0; this.t = 0;
    this.jumps = 0; this.grounded = false; this.ground = null;
    this.boostTimer = 0; this.knockTimer = 0; this.knockVel = { x: 0, z: 0 };
    this.respawn = start.clone(); this.stage = opts.startStage || 1;
    this.coins = 0; this.won = false;
    this.onWin = null; this.onCoin = null; this.onCheckpoint = null; this.onSecret = null;
    this.fx = { grav: 1, speed: 1, coinMul: 1 };   // modified by random events
  }
  setSkin(def) { this.char.applyStyle(def); }
  setTrail(def) { this.trail.setStyle(def.color, def.effect); }
  setAura(def) { this.aura.setStyle(def.color); }
  setPower(def) { this.power = { speed: def.speed, grav: def.grav, jump: def.jump }; }

  update(dt, input, cam) {
    this.t += dt;
    if (this.won) { this.char.animate(dt, 0, true); this.trail.update(this.pos, this.t); this.aura.update(this.pos, this.t); return; }

    // carry on moving platforms
    if (this.ground && (this.ground.dx || this.ground.dz)) { this.pos.x += this.ground.dx; this.pos.z += this.ground.dz; }

    // ---- horizontal ----
    let speed = MOVE * (input.sprint ? SPRINT : 1) * this.fx.speed * this.power.speed;
    if (this.boostTimer > 0) { speed *= BOOST_MUL; this.boostTimer -= dt; }

    if (this.knockTimer > 0) {
      this.knockTimer -= dt;
      this.pos.x += this.knockVel.x * dt; this.pos.z += this.knockVel.z * dt;
      this.moveAmt = 1;
    } else {
      const f = cam.forward(), rt = cam.right();
      let dx = f.x * input.y + rt.x * input.x;
      let dz = f.z * input.y + rt.z * input.x;
      const len = Math.hypot(dx, dz);
      this.moveAmt = Math.min(1, len);
      if (len > 0.001) {
        dx /= len; dz /= len;
        this.pos.x += dx * speed * dt; this.pos.z += dz * speed * dt;
        this.targetYaw = Math.atan2(dx, dz);
      }
    }

    // ---- vertical ----
    const prevY = this.pos.y;
    this.vel.y -= GRAV * this.fx.grav * this.power.grav * dt;
    this.pos.y += this.vel.y * dt;
    this.ground = resolveGround(this.world, this.pos, this.vel, prevY, R);
    this.grounded = !!this.ground;

    if (this.grounded) {
      this.jumps = 0;
      const t = this.ground.type;
      if (t === 'jumppad' || t === 'bouncy') { this.vel.y = (t === 'bouncy' ? BOUNCE : PAD); this.grounded = false; this.ground = null; this.jumps = 1; this._puff(t === 'bouncy' ? 0xff8c3d : 0xff5ec4); }
      else if (t === 'boost') { this.boostTimer = BOOST_TIME; }
      else if (t === 'checkpoint') {
        const st = this.ground.stage || 1;
        if (st > this.stage) {
          this.stage = st;
          this.respawn.set(this.ground.cx, this.ground.top + 0.05, this.ground.cz);
          this.hud.setProgress(this.stage, this.world.totalStages);
          this.hud.toast('STAGE ' + st + ' ✓', '#9bff8a');
          this.particles.burst(this.pos.clone().setY(this.pos.y + 0.4), { color: 0x9bff8a, count: 22, up: 5 });
          if (this.audio) this.audio.sfxCheckpoint();
          if (this.onCheckpoint) this.onCheckpoint(st);
        }
      } else if (t === 'win') { this._win(); }
    }

    // ---- rotating bar knockback ----
    const k = rotatorHit(this.world, this.pos);
    if (k && this.knockTimer <= 0) {
      this.knockTimer = 0.45; this.knockVel.x = k.x * 9; this.knockVel.z = k.z * 9;
      this.vel.y = 6; this.jumps = 1;
      this.hud.toast('OUCH! 💥', '#ff6b6b');
      this._puff(0xffd54a);
    }

    // lasers (respawn) + rolling hazard balls (knock)
    const hz = hazardHit(this.world, this.pos, true);
    if (hz) {
      if (hz.effect === 'kill') { this.hud.toast('ZAPPED ⚡', '#ff5e5e'); this._puff(0xff3344, 18); this.doRespawn(); }
      else if (this.knockTimer <= 0) {
        this.knockTimer = 0.45; this.knockVel.x = hz.x * 9; this.knockVel.z = hz.z * 9; this.vel.y = 6; this.jumps = 1;
        this.hud.toast('OUCH! 💥', '#ff6b6b');
      }
    }

    // ---- jump (edge-triggered) ----
    if (input.jump) {
      if (this.grounded) { this.vel.y = JUMP * this.power.jump; this.grounded = false; this.ground = null; this.jumps = 1; this._puff(0xffffff); if (this.audio) this.audio.sfxJump(); }
      else if (this.jumps < 2) { this.vel.y = JUMP * this.power.jump; this.jumps = 2; this._puff(0xa0e0ff, 8); if (this.audio) this.audio.sfxJump(); }
    }

    // ---- coins ----
    for (const c of this.world.coins) {
      if (c.collected) continue;
      const dx = this.pos.x - c.pos.x, dy = (this.pos.y + 1) - c.pos.y, dz = this.pos.z - c.pos.z;
      if (dx * dx + dy * dy + dz * dz < (c.secret ? 2.4 : 1.25)) {
        c.collected = true; c.mesh.visible = false;
        const amt = Math.round((c.value || 1) * this.fx.coinMul);
        this.coins += amt;
        this.particles.burst(c.pos.clone(), { color: c.secret ? 0xff5ec4 : 0xffd54a, count: c.secret ? 32 : 16, up: c.secret ? 6 : 4, speed: 5 });
        if (this.audio) this.audio.sfxCoin();
        if (c.secret) { this.hud.toast('SECRET! +' + amt + ' 💎', '#ff5ec4'); if (this.onSecret) this.onSecret(amt); }
        else if (this.onCoin) this.onCoin(amt);
      }
    }

    // ---- fell off ----
    if (this.pos.y < this.world.killY) this.doRespawn();

    // ---- visuals ----
    if (this.moveAmt > 0.05 || this.knockTimer > 0) this.yaw = lerpAngle(this.yaw, this.targetYaw, dt * 12);
    this.char.group.rotation.y = this.yaw;
    this.char.animate(dt, this.moveAmt, this.grounded);
    this.trail.update(this.pos, this.t);
    this.aura.update(this.pos, this.t);
  }

  _puff(color, count = 12) {
    this.particles.burst(this.pos.clone().setY(this.pos.y + 0.1), { color, count, up: 2.5, speed: 3, scale: 0.8 });
  }
  doRespawn() {
    this.pos.copy(this.respawn); this.vel.set(0, 0, 0);
    this.jumps = 0; this.knockTimer = 0; this.boostTimer = 0;
    this.hud.flash(); this.hud.toast('RESPAWN', '#5fe0ff');
  }
  _win() {
    if (this.won) return; this.won = true;
    this.particles.burst(this.pos.clone().setY(this.pos.y + 1), { color: 0xffd54a, count: 50, up: 8, speed: 8 });
    if (this.audio) this.audio.sfxWin();
    if (this.onWin) this.onWin();
  }

  // ---- multiplayer-ready snapshot ----
  getState() {
    return {
      name: this.name, x: this.pos.x, y: this.pos.y, z: this.pos.z,
      yaw: this.yaw, color: this.char.color,
      anim: !this.grounded ? 'jump' : this.moveAmt > 0.1 ? 'run' : 'idle',
    };
  }
}
