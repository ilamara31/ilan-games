// Controls.js — unified input: keyboard + touch joystick + jump/sprint buttons
export class Controls {
  constructor() {
    this.keys = {};
    this.joy = { active: false, x: 0, y: 0 };   // y: +1 = forward
    this.sprintHeld = false;
    this.jumpQueued = false;

    // ---- keyboard ----
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.jumpQueued = true; }
      if (k === 'shift') this.sprintHeld = true;
    });
    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      this.keys[k] = false;
      if (k === 'shift') this.sprintHeld = false;
    });

    this._joystick();
    this._buttons();
  }

  _joystick() {
    const base = document.getElementById('joy');
    const knob = document.getElementById('joyKnob');
    const R = 42;                       // max knob travel (px)
    let id = null;
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    const reset = () => { id = null; this.joy.active = false; this.joy.x = 0; this.joy.y = 0; setKnob(0, 0); };

    const onMove = (cx, cy) => {
      const r = base.getBoundingClientRect();
      let dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      setKnob(dx, dy);
      this.joy.x = dx / R;
      this.joy.y = -dy / R;            // screen-up -> forward
      this.joy.active = true;
    };

    base.addEventListener('pointerdown', e => { id = e.pointerId; base.setPointerCapture(id); onMove(e.clientX, e.clientY); });
    base.addEventListener('pointermove', e => { if (e.pointerId === id) onMove(e.clientX, e.clientY); });
    base.addEventListener('pointerup', e => { if (e.pointerId === id) reset(); });
    base.addEventListener('pointercancel', () => reset());
  }

  _buttons() {
    const jump = document.getElementById('jumpBtn');
    const sprint = document.getElementById('sprintBtn');
    const press = (el, down, up) => {
      el.addEventListener('pointerdown', e => { e.preventDefault(); down(); });
      el.addEventListener('pointerup', e => { e.preventDefault(); up && up(); });
      el.addEventListener('pointercancel', () => up && up());
      el.addEventListener('pointerleave', e => { if (e.buttons) up && up(); });
    };
    press(jump, () => { this.jumpQueued = true; });
    press(sprint, () => { this.sprintHeld = true; }, () => { this.sprintHeld = false; });
  }

  // returns {x, y, sprint, jump} ; jump is edge-triggered (consumed once)
  read() {
    let x = 0, y = 0;
    if (this.joy.active) { x = this.joy.x; y = this.joy.y; }
    else {
      if (this.keys['a'] || this.keys['arrowleft']) x -= 1;
      if (this.keys['d'] || this.keys['arrowright']) x += 1;
      if (this.keys['w'] || this.keys['arrowup']) y += 1;
      if (this.keys['s'] || this.keys['arrowdown']) y -= 1;
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    }
    const jump = this.jumpQueued; this.jumpQueued = false;
    return { x, y, sprint: this.sprintHeld, jump };
  }
}
