/* Time Duel — sound, vibration and music.
 *
 * Everything is synthesised: no audio files to download, so the countdown
 * beep is never late on a slow connection. That matters here — a beep that
 * arrives 200ms after the frame would teach the player the wrong timing.
 */
window.TDSound = (function () {
  "use strict";

  var KEY = "timeDuel_settings_v1";
  var set = { sound: true, vibe: true, music: false };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === "object") {
      if (typeof saved.sound === "boolean") set.sound = saved.sound;
      if (typeof saved.vibe === "boolean") set.vibe = saved.vibe;
      if (typeof saved.music === "boolean") set.music = saved.music;
    }
  } catch (e) {}

  function save() { try { localStorage.setItem(KEY, JSON.stringify(set)); } catch (e) {} }

  var ac = null;
  function ctx() {
    if (!ac) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
    }
    // iOS parks the context until a user gesture; every play attempt nudges it.
    if (ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
    return ac;
  }

  function blip(freq, dur, type, vol, when) {
    if (!set.sound) return;
    var c = ctx(); if (!c) return;
    try {
      var t = (when == null ? c.currentTime : when);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol == null ? 0.22 : vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  function buzz(ms) {
    if (!set.vibe) return;
    try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {}
  }

  /* ---- the game's voice ---- */
  var api = {
    click:  function () { blip(560, 0.05, "sine", 0.15); buzz(10); },
    tickDown: function (n) {                       // 3, 2, 1
      blip(440 + (3 - n) * 90, 0.11, "triangle", 0.2); buzz(18);
    },
    go:     function () { blip(880, 0.16, "square", 0.2); buzz(38); },
    stop:   function () { blip(330, 0.09, "sine", 0.24); buzz(26); },
    dot:    function () {                          // perfect
      var c = ctx(); if (!c) return;
      [0, 0.1, 0.2, 0.34].forEach(function (d, i) {
        blip([784, 988, 1175, 1568][i], 0.24, "triangle", 0.22, c.currentTime + d);
      });
      buzz([40, 50, 40, 90]);
    },
    win:    function () {
      var c = ctx(); if (!c) return;
      [0, 0.11, 0.23].forEach(function (d, i) {
        blip([659, 831, 988][i], 0.26, "sine", 0.22, c.currentTime + d);
      });
      buzz([30, 60, 90]);
    },
    lose:   function () { blip(196, 0.4, "sine", 0.16); buzz(60); },
    join:   function () { blip(700, 0.08, "sine", 0.14); },
    error:  function () { blip(180, 0.18, "sawtooth", 0.13); buzz(40); }
  };

  /* ---- music: a slow four-note pad, deliberately forgettable ---- */
  var musicTimer = null, step = 0;
  var PAD = [261.63, 329.63, 392.00, 329.63];
  function musicTick() {
    if (!set.music) return;
    var c = ctx(); if (!c) return;
    var f = PAD[step % PAD.length]; step++;
    try {
      var o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f / 2, c.currentTime);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.linearRampToValueAtTime(0.045, c.currentTime + 0.6);
      g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 1.9);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + 2);
    } catch (e) {}
  }
  function musicOn() {
    if (musicTimer) return;
    musicTick();
    musicTimer = setInterval(musicTick, 2000);
  }
  function musicOff() { clearInterval(musicTimer); musicTimer = null; }

  // The pad is silenced for the round itself: this game is about a beat, and
  // a background pulse would give players something to count against.
  function duck(on) { if (on) musicOff(); else if (set.music) musicOn(); }

  api.get = function (k) { return set[k]; };
  api.set = function (k, v) {
    set[k] = !!v; save();
    if (k === "music") { if (set.music) musicOn(); else musicOff(); }
  };
  api.duck = duck;
  api.startMusic = function () { if (set.music) musicOn(); };
  api.buzz = buzz;
  return api;
})();
