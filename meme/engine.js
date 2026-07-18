/* ============================================================================
   Meme Studio — scene engine (window.MemeEngine)
   Renders a meme "recipe" in real time (no video). Self-contained: templates are
   emoji + gradients, built-in sounds are synthesized with Web Audio.

   scene = {
     bg:   { type:'template'|'image', value:<templateId | public image URL> },
     cap:  { mode:'tb'|'center', top:'', bottom:'', center:'' },
     fx:   'zoomin'|'zoomout'|'shake'|'bounce'|'spin'|'slowzoom'|'fastzoom'|'pulse',
     audio:{ type:'none'|'builtin'|'voice', value:<soundId | public audio URL> },
     dur:  3..5
   }

   API:
     MemeEngine.TEMPLATES / SOUNDS / EFFECTS   -> arrays of {id,label,emoji?}
     MemeEngine.play(scene, mountEl, {onEnd})  -> { replay(), stop() }
     MemeEngine.playSound(id)                   -> preview a built-in sound
     MemeEngine.stopAll()                        -> stop audio + animations
   ============================================================================ */
(function () {
  "use strict";

  var TEMPLATES = [
    { id: "cat",       label: "Cat",         emoji: "🐱", grad: ["#ffd36e", "#ff8a3d"] },
    { id: "dog",       label: "Dog",         emoji: "🐶", grad: ["#8ecbff", "#3a6cf0"] },
    { id: "classroom", label: "Classroom",   emoji: "🏫", grad: ["#b6f0c2", "#1e9e5a"] },
    { id: "football",  label: "Football",    emoji: "⚽", grad: ["#9be89b", "#0e7a34"] },
    { id: "cricket",   label: "Cricket",     emoji: "🏏", grad: ["#ffe08a", "#e0552b"] },
    { id: "office",    label: "Office",      emoji: "💼", grad: ["#c9d4e8", "#3a4a6b"] },
    { id: "funny",     label: "Funny Faces", emoji: "🤪", grad: ["#ff9bd0", "#a12dff"] },
    { id: "random",    label: "Random",      emoji: "🎲", grad: ["#9fe0ff", "#5b2a86"] }
  ];
  var SOUNDS = [
    { id: "bruh",     label: "Bruh" },
    { id: "aiyo",     label: "Aiyo" },
    { id: "laugh",    label: "Laugh" },
    { id: "wow",      label: "Wow" },
    { id: "boom",     label: "Boom" },
    { id: "violin",   label: "Sad Violin" },
    { id: "victory",  label: "Victory" },
    { id: "clap",     label: "Clap" }
  ];
  var EFFECTS = [
    { id: "zoomin",   label: "Zoom In" },
    { id: "zoomout",  label: "Zoom Out" },
    { id: "shake",    label: "Shake" },
    { id: "bounce",   label: "Bounce" },
    { id: "spin",     label: "Spin" },
    { id: "slowzoom", label: "Slow Zoom" },
    { id: "fastzoom", label: "Fast Zoom" },
    { id: "pulse",    label: "Pulse" }
  ];
  function tmpl(id) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return TEMPLATES[0]; }

  /* ---------- one-time CSS (keyframes + stage styles) ---------- */
  function injectCSS() {
    if (document.getElementById("ms-engine-css")) return;
    var css =
      ".ms-stage{position:relative;width:100%;aspect-ratio:1/1;max-height:70vh;border-radius:18px;overflow:hidden;background:#0a0e1a;box-shadow:0 10px 30px rgba(0,0,0,.4)}" +
      ".ms-bg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background-size:cover;background-position:center;transform-origin:center;will-change:transform}" +
      ".ms-bg .ms-emoji{font-size:min(46vw,300px);line-height:1;filter:drop-shadow(0 8px 18px rgba(0,0,0,.35))}" +
      ".ms-cap{position:absolute;left:0;right:0;padding:0 4%;text-align:center;font-family:'Anton','Arial Black',Impact,sans-serif;" +
        "text-transform:uppercase;color:#fff;font-weight:900;letter-spacing:.5px;line-height:1.05;word-break:break-word;pointer-events:none;" +
        "-webkit-text-stroke:2px #000;paint-order:stroke fill;text-shadow:0 3px 8px rgba(0,0,0,.6)}" +
      ".ms-cap.top{top:3.5%}.ms-cap.bottom{bottom:3.5%}.ms-cap.center{top:50%;transform:translateY(-50%)}" +
      ".ms-cap.big{font-size:clamp(22px,8.5vw,52px)}.ms-cap.mid{font-size:clamp(18px,7vw,42px)}" +
      "@keyframes ms-zoomin{from{transform:scale(1)}to{transform:scale(1.35)}}" +
      "@keyframes ms-zoomout{from{transform:scale(1.35)}to{transform:scale(1)}}" +
      "@keyframes ms-slowzoom{from{transform:scale(1)}to{transform:scale(1.16)}}" +
      "@keyframes ms-fastzoom{0%{transform:scale(1)}50%{transform:scale(1.5)}100%{transform:scale(1)}}" +
      "@keyframes ms-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}" +
      "@keyframes ms-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}" +
      "@keyframes ms-bounce{0%,100%{transform:translateY(0)}25%{transform:translateY(-9%)}50%{transform:translateY(0)}75%{transform:translateY(-4%)}}" +
      "@keyframes ms-shake{0%,100%{transform:translate(0,0)}20%{transform:translate(-3%,2%)}40%{transform:translate(3%,-2%)}60%{transform:translate(-2%,-2%)}80%{transform:translate(2%,2%)}}";
    var st = document.createElement("style"); st.id = "ms-engine-css"; st.textContent = css; document.head.appendChild(st);
  }

  // effect id -> {name, period (s) for repeating fx, or null for one-shot}
  var FX = {
    zoomin: { k: "ms-zoomin", once: true }, zoomout: { k: "ms-zoomout", once: true },
    slowzoom: { k: "ms-slowzoom", once: true }, fastzoom: { k: "ms-fastzoom", period: 1.2 },
    pulse: { k: "ms-pulse", period: 1.0 }, spin: { k: "ms-spin", period: 2.2 },
    bounce: { k: "ms-bounce", period: 1.0 }, shake: { k: "ms-shake", period: 0.5 }
  };

  /* ---------- Web Audio built-in sounds ---------- */
  var AC = null;
  function ac() { try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); } catch (e) { AC = null; } return AC; }
  function tone(a, t0, f0, f1, dur, type, gain) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(a, t0, dur, gain) {
    var n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = a.createBufferSource(); src.buffer = buf; var g = a.createGain();
    g.gain.setValueAtTime(gain || 0.3, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g); g.connect(a.destination); src.start(t0);
  }
  var SYNTH = {
    bruh:    function (a, t) { tone(a, t, 150, 70, 0.45, "sawtooth", 0.35); },
    aiyo:    function (a, t) { tone(a, t, 620, 880, 0.18, "square", 0.25); tone(a, t + 0.2, 880, 420, 0.28, "square", 0.25); },
    laugh:   function (a, t) { for (var i = 0; i < 5; i++) tone(a, t + i * 0.13, 400 + (i % 2 ? 120 : 0), 300, 0.1, "triangle", 0.28); },
    wow:     function (a, t) { tone(a, t, 300, 900, 0.28, "sine", 0.3); tone(a, t + 0.28, 900, 500, 0.25, "sine", 0.25); },
    boom:    function (a, t) { tone(a, t, 140, 40, 0.6, "sine", 0.5); noise(a, t, 0.25, 0.4); },
    violin:  function (a, t) { tone(a, t, 440, 220, 1.1, "sawtooth", 0.22); tone(a, t + 0.03, 445, 223, 1.1, "sawtooth", 0.16); },
    victory: function (a, t) { [523, 659, 784, 1046].forEach(function (f, i) { tone(a, t + i * 0.13, f, f, 0.3, "triangle", 0.32); }); },
    clap:    function (a, t) { for (var i = 0; i < 4; i++) noise(a, t + i * 0.12, 0.09, 0.4); }
  };
  function playSound(id) { var a = ac(); if (!a || !SYNTH[id]) return; try { SYNTH[id](a, a.currentTime + 0.02); } catch (e) {} }

  /* ---------- voice playback ---------- */
  var curAudio = null;
  function stopVoice() { if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; } }
  function playVoice(url) {
    stopVoice();
    try { curAudio = new Audio(url); curAudio.play().catch(function () {}); } catch (e) { curAudio = null; }
  }

  function stopAll() { stopVoice(); }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  /* ---------- render + play ---------- */
  function buildStage(scene, mount) {
    injectCSS();
    mount.innerHTML = "";
    var stage = document.createElement("div"); stage.className = "ms-stage";
    var bg = document.createElement("div"); bg.className = "ms-bg";
    var b = scene.bg || {};
    if (b.type === "image" && b.value) {
      bg.style.backgroundImage = "url('" + String(b.value).replace(/['"()\\]/g, "") + "')";
    } else {
      var t = tmpl(b.value || "random");
      if (t.id === "random") t = TEMPLATES[Math.floor(Math.random() * (TEMPLATES.length - 1))];
      bg.style.background = "linear-gradient(150deg," + t.grad[0] + "," + t.grad[1] + ")";
      var em = document.createElement("div"); em.className = "ms-emoji"; em.textContent = t.emoji; bg.appendChild(em);
    }
    stage.appendChild(bg);
    var cap = scene.cap || {};
    if (cap.mode === "center") {
      if (cap.center) stage.appendChild(capEl(cap.center, "center", "big"));
    } else {
      if (cap.top) stage.appendChild(capEl(cap.top, "top", "big"));
      if (cap.bottom) stage.appendChild(capEl(cap.bottom, "bottom", "big"));
    }
    mount.appendChild(stage);
    return { stage: stage, bg: bg };
  }
  function capEl(text, pos, size) {
    var d = document.createElement("div"); d.className = "ms-cap " + pos + " " + size; d.innerHTML = esc(text); return d;
  }

  function applyEffect(bg, fx, dur) {
    var def = FX[fx] || FX.pulse;
    // reset
    bg.style.animation = "none"; void bg.offsetWidth;
    if (def.once) {
      bg.style.animation = def.k + " " + dur + "s ease-in-out forwards";
    } else {
      var iters = Math.max(1, Math.round(dur / def.period));
      bg.style.animation = def.k + " " + def.period + "s ease-in-out " + iters;
      bg.style.animationFillMode = "forwards";
    }
  }

  function play(scene, mount, opt) {
    opt = opt || {};
    stopAll();
    var refs = buildStage(scene, mount);
    var dur = Math.min(5, Math.max(3, +scene.dur || 4));
    var endT = null;
    function run() {
      applyEffect(refs.bg, scene.fx || "pulse", dur);
      var a = scene.audio || {};
      if (a.type === "builtin" && a.value) playSound(a.value);
      else if (a.type === "voice" && a.value) playVoice(a.value);
      if (endT) clearTimeout(endT);
      endT = setTimeout(function () { stopVoice(); if (opt.onEnd) try { opt.onEnd(); } catch (e) {} }, dur * 1000);
    }
    run();
    return {
      replay: run,
      stop: function () { if (endT) clearTimeout(endT); stopVoice(); refs.bg.style.animation = "none"; }
    };
  }

  // static first-frame preview (no animation, no audio) — for gallery cards
  function thumb(scene, mount) { buildStage(scene || {}, mount); }

  window.MemeEngine = {
    TEMPLATES: TEMPLATES, SOUNDS: SOUNDS, EFFECTS: EFFECTS,
    play: play, playSound: playSound, stopAll: stopAll, thumb: thumb
  };
})();
