// Music.js — synthesized background music (richer) + game sound effects. No audio files.
export class Music {
  constructor() {
    this.ac = null; this.master = null; this.musicGain = null; this.sfxGain = null;
    this.timer = null; this.on = true; this.step = 0; this.bpm = 134;
  }

  ensure() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ac = new AC();
    this.master = this.ac.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ac.destination);
    this.musicGain = this.ac.createGain(); this.musicGain.gain.value = 0.2; this.musicGain.connect(this.master);
    this.sfxGain = this.ac.createGain(); this.sfxGain.gain.value = 0.5; this.sfxGain.connect(this.master);
  }

  _midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  _note(freq, t, dur, type, gain, dest, glideTo) {
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.musicGain); o.start(t); o.stop(t + dur + 0.03);
  }
  _drum(t, kind) {
    const dur = kind === 'kick' ? 0.18 : 0.07;
    if (kind === 'kick') { this._note(150, t, dur, 'sine', 0.55, this.musicGain, 45); return; }
    const n = Math.floor(this.ac.sampleRate * dur), buf = this.ac.createBuffer(1, n, this.ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ac.createBufferSource(); src.buffer = buf;
    const g = this.ac.createGain(); g.gain.value = kind === 'snare' ? 0.22 : 0.1;
    const hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = kind === 'snare' ? 1200 : 6500;
    src.connect(hp); hp.connect(g); g.connect(this.musicGain); src.start(t); src.stop(t + dur);
  }

  // 8 bars (two 4-bar phrases) for variety
  _tick() {
    if (!this.on) return;
    const t = this.ac.currentTime + 0.02;
    const s = this.step % 64, bar = s >> 3, beat = s & 7;
    const PROG = [
      { bass: 48, mel: [60, 64, 67, 72] }, { bass: 43, mel: [59, 62, 67, 71] },
      { bass: 45, mel: [60, 64, 69, 72] }, { bass: 41, mel: [60, 65, 69, 72] },
      { bass: 48, mel: [64, 67, 72, 76] }, { bass: 50, mel: [62, 66, 69, 74] },
      { bass: 45, mel: [60, 64, 69, 72] }, { bass: 43, mel: [62, 67, 71, 74] },
    ][bar];

    if (beat % 2 === 0) { const m = (beat === 2 || beat === 6) ? PROG.bass + 12 : PROG.bass; this._note(this._midi(m), t, 0.22, 'triangle', 0.45); }
    if (beat === 0) { for (const off of [0, 7, 12]) this._note(this._midi(PROG.bass + 12 + off), t, 0.9, 'sawtooth', 0.05); } // soft pad chord
    const pat = [0, 1, 2, 3, 2, 3, 1, 2]; let mm = PROG.mel[pat[beat]]; if (beat === 7) mm += 12;
    this._note(this._midi(mm), t, 0.2, 'square', 0.14); this._note(this._midi(mm), t, 0.2, 'triangle', 0.09);
    if (beat === 0 || beat === 4) this._drum(t, 'kick');
    if (beat === 2 || beat === 6) this._drum(t, 'snare');
    this._drum(t, 'hat');
    this.step++;
  }

  start() {
    this.ensure(); this.on = true;
    if (this.timer) return; this.step = 0;
    this.timer = setInterval(() => this._tick(), (60 / this.bpm) / 2 * 1000); this._tick();
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  toggle() { this.on = !this.on; if (this.on) this.start(); else this.stop(); return this.on; }

  // ---------- SFX ----------
  _seq(notes, type = 'triangle', gap = 0.06, dur = 0.12, gain = 0.4) {
    this.ensure(); const t0 = this.ac.currentTime;
    notes.forEach((n, i) => this._note(this._midi(n), t0 + i * gap, dur, type, gain, this.sfxGain));
  }
  sfxCoin() { this._seq([84, 91], 'square', 0.05, 0.1, 0.32); }
  sfxCheckpoint() { this._seq([72, 76, 79, 84], 'triangle', 0.07, 0.18, 0.4); }
  sfxUnlock() { this._seq([67, 71, 74, 79, 83, 86], 'triangle', 0.08, 0.25, 0.4); }
  sfxWin() { this._seq([72, 76, 79, 84, 88, 84, 88, 91], 'square', 0.12, 0.3, 0.4); }
  sfxJump() { this.ensure(); this._note(this._midi(72), this.ac.currentTime, 0.1, 'sine', 0.18, this.sfxGain, this._midi(84)); }
  sfxEvent() { this._seq([60, 67, 72, 79], 'sawtooth', 0.08, 0.3, 0.25); }
}
