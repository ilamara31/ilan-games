/* ============================================================================
   Meme Studio — creation wizard (window.MemeCreate)
   A 6-step, mobile-first flow that builds a scene "recipe" and saves it.

   Contract (called by app.js):
     MemeCreate.open(container, { onSaved(newMemeId), onExit() })

   Builds incrementally:
     scene = { bg:{type,value}, cap:{mode,top,bottom,center}, fx, audio:{type,value}, dur }
   Depends on: MemeEngine (TEMPLATES/SOUNDS/EFFECTS/play/playSound/stopAll/thumb),
               MemeDB (me/uploadMedia/saveMeme), MemeApp (toast).
   Everything stays in-app: no export/download/share.
   ============================================================================ */
(function () {
  "use strict";

  var STEPS = 6;
  var CATEGORIES = ["Funny", "Animals", "Sports", "School", "Gaming", "Random"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }
  function attr(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function toast(msg) { try { if (window.MemeApp && MemeApp.toast) MemeApp.toast(msg); } catch (e) {} }
  function ENG() { return window.MemeEngine || {}; }

  /* ---------------- recorder capability check ---------------- */
  function recorderSupported() {
    try {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
        window.MediaRecorder && typeof MediaRecorder.isTypeSupported === "function");
    } catch (e) { return false; }
  }
  function pickAudioMime() {
    var cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (var i = 0; i < cands.length; i++) {
      try { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {}
    }
    return "";
  }

  /* ============================================================================
     open() — the entry point. Owns `container`.
     ============================================================================ */
  function open(container, opts) {
    opts = opts || {};
    var onSaved = typeof opts.onSaved === "function" ? opts.onSaved : function () {};
    var onExit = typeof opts.onExit === "function" ? opts.onExit : function () {};

    var scene = {
      bg: null,                                   // {type:'template'|'image', value}
      cap: { mode: "tb", top: "", bottom: "", center: "" },
      fx: "zoomin",
      audio: { type: "none" },
      dur: 4
    };

    // step-local working state that must survive re-renders
    var state = {
      step: 1,
      bgBusy: false,                              // uploading an image
      bgPreview: null,                            // last object URL for preview (image)
      rec: {
        blob: null, mime: "", url: null, uploadedUrl: null,
        recording: false, seconds: 0,
        recorder: null, stream: null, chunks: [], timer: null
      },
      saveTitle: "",
      saveCategory: "",
      saving: false
    };

    var player = null;   // MemeEngine controller on the preview step

    /* ---- small helpers bound to this instance ---- */
    function stopPlayer() {
      if (player) { try { player.stop(); } catch (e) {} player = null; }
      try { ENG().stopAll && ENG().stopAll(); } catch (e) {}
    }
    function stopRecording(auto) {
      var r = state.rec;
      if (r.timer) { clearInterval(r.timer); r.timer = null; }
      try { if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop(); } catch (e) {}
      r.recording = false;
      if (auto) { /* onstop handler finalizes */ }
    }
    function releaseStream() {
      var r = state.rec;
      try { if (r.stream) r.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      r.stream = null;
    }
    function cleanup() {
      stopPlayer();
      stopRecording(false);
      releaseStream();
      if (state.rec.timer) { clearInterval(state.rec.timer); state.rec.timer = null; }
    }

    /* ---- step indicator ---- */
    function dotsHtml() {
      var h = '<div class="steps">';
      for (var i = 1; i <= STEPS; i++) h += '<div class="dot' + (i <= state.step ? " on" : "") + '"></div>';
      return h + "</div>";
    }
    function titleFor(n) {
      return ["", "Background", "Caption", "Effect", "Sound", "Preview", "Save"][n] || "";
    }
    function shell(bodyHtml) {
      return dotsHtml() +
        '<div class="muted" style="text-align:center;margin-bottom:4px">Step ' + state.step + ' of ' + STEPS + ' · ' + esc(titleFor(state.step)) + '</div>' +
        bodyHtml;
    }
    function navRow(nextLabel, nextEnabled, nextClass) {
      return '<div class="row" style="margin-top:4px">' +
        '<button class="btn ghost" id="wzBack" style="flex:1">← Back</button>' +
        '<button class="btn ' + (nextClass || "grad") + '" id="wzNext" style="flex:2"' + (nextEnabled ? "" : " disabled") + '>' + esc(nextLabel || "Next →") + '</button>' +
        '</div>';
    }

    /* ---- navigation ---- */
    function goNext() {
      if (state.step < STEPS) { state.step++; render(); }
    }
    function goBack() {
      if (state.step === 1) { cleanup(); onExit(); return; }
      state.step--; render();
    }

    /* ---- master render (leaving a step cleans transient resources) ---- */
    function render() {
      stopPlayer();
      // stop any in-progress recording UI when navigating away from audio step
      if (state.step !== 4 && state.rec.recording) stopRecording(false);

      if (state.step === 1) return renderBg();
      if (state.step === 2) return renderCaption();
      if (state.step === 3) return renderEffect();
      if (state.step === 4) return renderAudio();
      if (state.step === 5) return renderPreview();
      if (state.step === 6) return renderSave();
    }

    /* ========================================================================
       STEP 1 — Background
       ======================================================================== */
    function renderBg() {
      var templates = ENG().TEMPLATES || [];
      var chips = templates.map(function (t) {
        var on = scene.bg && scene.bg.type === "template" && scene.bg.value === t.id;
        return '<button class="chip' + (on ? " on" : "") + '" data-tpl="' + attr(t.id) + '">' +
          '<span class="em">' + esc(t.emoji || "🎬") + '</span>' + esc(t.label || t.id) + '</button>';
      }).join("");

      var previewHtml = "";
      if (state.bgBusy) {
        previewHtml = '<div class="center" style="padding:18px"><div class="spin"></div><div>Uploading image…</div></div>';
      } else if (scene.bg && scene.bg.type === "image") {
        previewHtml = '<div style="margin-top:12px"><div class="label">Your image</div>' +
          '<img src="' + attr(scene.bg.value) + '" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:14px;border:1px solid var(--line)"></div>';
      }

      var canNext = !!scene.bg && !state.bgBusy;
      container.innerHTML = shell(
        '<div class="card">' +
          '<div class="label">Pick a background</div>' +
          '<div class="grid3">' + chips + '</div>' +
          '<div class="label" style="margin-top:16px">Or use your own photo</div>' +
          '<div class="row">' +
            '<button class="btn grad2 sm" id="wzUpload" style="flex:1">🖼️ Upload Image</button>' +
            '<button class="btn grad2 sm" id="wzCamera" style="flex:1">📷 Camera Photo</button>' +
          '</div>' +
          previewHtml +
          '<input type="file" id="wzFileUp" accept="image/*" style="display:none">' +
          '<input type="file" id="wzFileCam" accept="image/*" capture="environment" style="display:none">' +
        '</div>' +
        navRow("Next →", canNext)
      );

      // template chips
      Array.prototype.forEach.call(container.querySelectorAll("[data-tpl]"), function (b) {
        b.onclick = function () {
          scene.bg = { type: "template", value: b.getAttribute("data-tpl") };
          renderBg();
        };
      });

      var upBtn = container.querySelector("#wzUpload");
      var camBtn = container.querySelector("#wzCamera");
      var fileUp = container.querySelector("#wzFileUp");
      var fileCam = container.querySelector("#wzFileCam");
      if (upBtn) upBtn.onclick = function () { if (!state.bgBusy) fileUp.click(); };
      if (camBtn) camBtn.onclick = function () { if (!state.bgBusy) fileCam.click(); };
      if (fileUp) fileUp.onchange = function () { handleFile(fileUp.files && fileUp.files[0]); };
      if (fileCam) fileCam.onchange = function () { handleFile(fileCam.files && fileCam.files[0]); };

      container.querySelector("#wzBack").onclick = goBack;
      var nx = container.querySelector("#wzNext");
      nx.onclick = function () { if (canNext) goNext(); };
    }

    function handleFile(file) {
      if (!file) return;
      state.bgBusy = true;
      renderBg();
      downscale(file, 1024, 0.85).then(function (blob) {
        return MemeDB.uploadMedia(blob, "img", "jpg", "image/jpeg");
      }).then(function (url) {
        scene.bg = { type: "image", value: url };
        state.bgBusy = false;
        renderBg();
      }).catch(function (e) {
        state.bgBusy = false;
        toast((e && e.message) || "Couldn't upload that image. Try again.");
        renderBg();
      });
    }

    // Load an image file, draw to a canvas scaled to max side, export JPEG blob.
    function downscale(file, maxSide, quality) {
      return new Promise(function (resolve, reject) {
        try {
          var url = URL.createObjectURL(file);
          var img = new Image();
          img.onload = function () {
            try {
              var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
              if (!w || !h) { URL.revokeObjectURL(url); return reject(new Error("That image looked empty.")); }
              var scale = Math.min(1, maxSide / Math.max(w, h));
              var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
              var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
              var ctx = cv.getContext("2d");
              ctx.drawImage(img, 0, 0, cw, ch);
              URL.revokeObjectURL(url);
              if (cv.toBlob) {
                cv.toBlob(function (blob) {
                  if (blob && blob.size) resolve(blob);
                  else reject(new Error("Couldn't process that image."));
                }, "image/jpeg", quality);
              } else {
                // very old fallback
                try {
                  var data = cv.toDataURL("image/jpeg", quality);
                  var bin = atob(data.split(",")[1]); var arr = new Uint8Array(bin.length);
                  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                  resolve(new Blob([arr], { type: "image/jpeg" }));
                } catch (e2) { reject(new Error("Couldn't process that image.")); }
              }
            } catch (e) { try { URL.revokeObjectURL(url); } catch (_) {} reject(new Error("Couldn't process that image.")); }
          };
          img.onerror = function () { try { URL.revokeObjectURL(url); } catch (_) {} reject(new Error("Couldn't read that image.")); };
          img.src = url;
        } catch (e) { reject(new Error("Couldn't read that file.")); }
      });
    }

    /* ========================================================================
       STEP 2 — Caption
       ======================================================================== */
    function renderCaption() {
      var mode = scene.cap.mode === "center" ? "center" : "tb";
      var body =
        '<div class="card">' +
          '<div class="label">Caption style</div>' +
          '<div class="row" style="margin-bottom:14px">' +
            '<button class="chip' + (mode === "tb" ? " on" : "") + '" id="wzModeTb" style="flex:1">Top & Bottom</button>' +
            '<button class="chip' + (mode === "center" ? " on" : "") + '" id="wzModeCenter" style="flex:1">Single Center</button>' +
          '</div>';
      if (mode === "tb") {
        body +=
          '<div class="label">Top text</div>' +
          '<input id="wzTop" maxlength="60" placeholder="WHEN YOU FINALLY…" value="' + attr(scene.cap.top) + '" style="margin-bottom:12px">' +
          '<div class="label">Bottom text</div>' +
          '<input id="wzBottom" maxlength="60" placeholder="…GET IT RIGHT" value="' + attr(scene.cap.bottom) + '">';
      } else {
        body +=
          '<div class="label">Center text</div>' +
          '<input id="wzCenter" maxlength="60" placeholder="ME EVERY MONDAY" value="' + attr(scene.cap.center) + '">';
      }
      body += '<div class="muted" style="margin-top:10px">You can leave the caption empty if you like.</div></div>';

      container.innerHTML = shell(body + navRow("Next →", true));

      container.querySelector("#wzModeTb").onclick = function () { syncCaption(); scene.cap.mode = "tb"; renderCaption(); };
      container.querySelector("#wzModeCenter").onclick = function () { syncCaption(); scene.cap.mode = "center"; renderCaption(); };
      container.querySelector("#wzBack").onclick = function () { syncCaption(); goBack(); };
      container.querySelector("#wzNext").onclick = function () { syncCaption(); goNext(); };
    }
    function syncCaption() {
      var t = container.querySelector("#wzTop"),
          b = container.querySelector("#wzBottom"),
          c = container.querySelector("#wzCenter");
      if (t) scene.cap.top = t.value.slice(0, 60);
      if (b) scene.cap.bottom = b.value.slice(0, 60);
      if (c) scene.cap.center = c.value.slice(0, 60);
    }

    /* ========================================================================
       STEP 3 — Effect
       ======================================================================== */
    function renderEffect() {
      var effects = ENG().EFFECTS || [];
      if (!scene.fx && effects.length) scene.fx = effects[0].id;
      var chips = effects.map(function (e) {
        var on = scene.fx === e.id;
        return '<button class="chip' + (on ? " on" : "") + '" data-fx="' + attr(e.id) + '">' + esc(e.label || e.id) + '</button>';
      }).join("");

      container.innerHTML = shell(
        '<div class="card">' +
          '<div class="label">Pick an effect</div>' +
          '<div id="wzFxPrev" style="margin-bottom:14px"></div>' +
          '<div class="grid3">' + chips + '</div>' +
        '</div>' +
        navRow("Next →", true)
      );

      // live static preview of the current scene
      try {
        var prev = container.querySelector("#wzFxPrev");
        if (prev && ENG().thumb) ENG().thumb(scene, prev);
      } catch (e) {}

      Array.prototype.forEach.call(container.querySelectorAll("[data-fx]"), function (b) {
        b.onclick = function () { scene.fx = b.getAttribute("data-fx"); renderEffect(); };
      });
      container.querySelector("#wzBack").onclick = goBack;
      container.querySelector("#wzNext").onclick = goNext;
    }

    /* ========================================================================
       STEP 4 — Audio
       ======================================================================== */
    function renderAudio() {
      var sounds = ENG().SOUNDS || [];
      var a = scene.audio || { type: "none" };
      var soundChips = sounds.map(function (s) {
        var on = a.type === "builtin" && a.value === s.id;
        return '<button class="chip' + (on ? " on" : "") + '" data-snd="' + attr(s.id) + '">' + esc(s.label || s.id) + '</button>';
      }).join("");

      var recHtml = "";
      if (recorderSupported()) {
        var r = state.rec;
        if (r.recording) {
          recHtml =
            '<button class="btn grad" id="wzRecBtn">⏺ Stop (' + r.seconds + 's)</button>' +
            '<div class="muted" style="margin-top:8px">Recording… auto-stops at 5s.</div>';
        } else if (r.blob) {
          recHtml =
            '<div class="muted" style="margin-bottom:8px">✅ Voice clip ready.</div>' +
            '<div class="row">' +
              '<button class="btn grad2 sm" id="wzReplay" style="flex:1">▶ Replay</button>' +
              '<button class="btn ghost sm" id="wzDelRec" style="flex:1">🗑 Delete</button>' +
              '<button class="btn sm" id="wzReRec" style="flex:1;background:var(--panel2)">⏺ Re-record</button>' +
            '</div>';
        } else {
          recHtml = '<button class="btn grad" id="wzRecBtn">⏺ Record Voice (max 5s)</button>';
        }
      } else {
        recHtml = '<div class="muted">Voice recording isn\'t supported on this device.</div>';
      }

      var noneOn = a.type === "none";
      container.innerHTML = shell(
        '<div class="card">' +
          '<div class="label">Built-in sounds</div>' +
          '<div class="muted" style="margin-bottom:8px">Tap to preview & pick.</div>' +
          '<div class="grid3">' + soundChips + '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="label">Record your voice</div>' +
          recHtml +
        '</div>' +
        '<div class="card">' +
          '<div class="label">No sound</div>' +
          '<button class="chip' + (noneOn ? " on" : "") + '" id="wzNoSound" style="width:100%">🔇 No sound</button>' +
        '</div>' +
        navRow("Next →", true)
      );

      Array.prototype.forEach.call(container.querySelectorAll("[data-snd]"), function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-snd");
          clearRecording();                       // built-in selection wins over a stale recording
          scene.audio = { type: "builtin", value: id };
          try { ENG().playSound && ENG().playSound(id); } catch (e) {}
          renderAudio();
        };
      });

      var noBtn = container.querySelector("#wzNoSound");
      if (noBtn) noBtn.onclick = function () { clearRecording(); scene.audio = { type: "none" }; renderAudio(); };

      var recBtn = container.querySelector("#wzRecBtn");
      if (recBtn) recBtn.onclick = function () { state.rec.recording ? stopRecording(false) : startRecording(); };
      var replay = container.querySelector("#wzReplay");
      if (replay) replay.onclick = replayRecording;
      var del = container.querySelector("#wzDelRec");
      if (del) del.onclick = deleteRecording;
      var rerec = container.querySelector("#wzReRec");
      if (rerec) rerec.onclick = function () { deleteRecording(); startRecording(); };

      container.querySelector("#wzBack").onclick = goBack;
      container.querySelector("#wzNext").onclick = onAudioNext;
    }

    function startRecording() {
      var r = state.rec;
      var mime = pickAudioMime();
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        r.stream = stream;
        r.chunks = [];
        try {
          r.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (e) {
          try { r.recorder = new MediaRecorder(stream); } catch (e2) { releaseStream(); toast("Couldn't start recording."); return; }
        }
        r.mime = (r.recorder && r.recorder.mimeType) || mime || "audio/webm";
        r.recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) r.chunks.push(ev.data); };
        r.recorder.onstop = function () {
          if (r.timer) { clearInterval(r.timer); r.timer = null; }
          releaseStream();
          try {
            var type = (r.mime || "audio/webm").split(";")[0];
            var blob = new Blob(r.chunks, { type: type });
            r.blob = (blob && blob.size) ? blob : null;
            r.uploadedUrl = null;                       // fresh clip — not uploaded yet
            if (r.url) { try { URL.revokeObjectURL(r.url); } catch (e) {} r.url = null; }
            // A finished recording becomes the active audio intent (voice wins until changed).
            if (r.blob) scene.audio = { type: "voice", value: null };
          } catch (e) { r.blob = null; }
          r.recording = false;
          if (state.step === 4) renderAudio();
        };
        r.seconds = 0;
        r.recording = true;
        r.recorder.start();
        r.timer = setInterval(function () {
          r.seconds++;
          if (r.seconds >= 5) { stopRecording(true); }
          else if (state.step === 4) {
            var btn = container.querySelector("#wzRecBtn");
            if (btn) btn.textContent = "⏺ Stop (" + r.seconds + "s)";
          }
        }, 1000);
        if (state.step === 4) renderAudio();
      }).catch(function () {
        toast("Microphone permission is needed to record.");
      });
    }

    function replayRecording() {
      var r = state.rec;
      if (!r.blob) return;
      try {
        if (!r.url) r.url = URL.createObjectURL(r.blob);
        var au = new Audio(r.url);
        au.play().catch(function () {});
      } catch (e) {}
    }
    // Drop any pending recording + its local/uploaded URLs (does NOT touch scene.audio).
    function clearRecording() {
      var r = state.rec;
      r.blob = null;
      r.uploadedUrl = null;
      if (r.url) { try { URL.revokeObjectURL(r.url); } catch (e) {} r.url = null; }
    }
    function deleteRecording() {
      clearRecording();
      // A recording is the active voice intent — dropping it means "no sound".
      if (scene.audio && scene.audio.type === "voice") scene.audio = { type: "none" };
      if (state.step === 4) renderAudio();
    }

    function onAudioNext() {
      var r = state.rec;
      // Only touch voice when the active intent is voice; a built-in/none selection wins.
      if (scene.audio && scene.audio.type === "voice" && r.blob) {
        // Already uploaded this exact clip? Reuse the URL, don't upload again.
        if (r.uploadedUrl) { scene.audio = { type: "voice", value: r.uploadedUrl }; goNext(); return; }
        var ext = /mp4/.test(r.mime) ? "mp4" : "webm";
        var contentType = ext === "mp4" ? "audio/mp4" : "audio/webm";  // clean base type, no ;codecs
        var nx = container.querySelector("#wzNext");
        if (nx) { nx.disabled = true; nx.textContent = "Uploading voice…"; }
        MemeDB.uploadMedia(r.blob, "voice", ext, contentType).then(function (url) {
          r.uploadedUrl = url;                    // remember — upload only once per recording
          scene.audio = { type: "voice", value: url };
          goNext();
        }).catch(function (e) {
          toast((e && e.message) || "Couldn't upload your voice clip. Try again.");
          if (nx) { nx.disabled = false; nx.textContent = "Next →"; }
        });
        return;
      }
      goNext();
    }

    /* ========================================================================
       STEP 5 — Preview
       ======================================================================== */
    function renderPreview() {
      container.innerHTML = shell(
        '<div class="card" style="padding:12px">' +
          '<div id="wzStage"></div>' +
          '<button class="btn grad sm" id="wzReplayPrev" style="margin-top:12px">▶ Replay</button>' +
        '</div>' +
        '<div class="muted" style="text-align:center">Looks good? Continue to name & save it.</div>' +
        navRow("Next →", true)
      );

      var stage = container.querySelector("#wzStage");
      try {
        if (ENG().play) player = ENG().play(scene, stage, {});
      } catch (e) {
        try { if (ENG().thumb) ENG().thumb(scene, stage); } catch (e2) {}
      }
      var rp = container.querySelector("#wzReplayPrev");
      if (rp) rp.onclick = function () { if (player && player.replay) player.replay(); };

      container.querySelector("#wzBack").onclick = goBack;   // render() stops player
      container.querySelector("#wzNext").onclick = goNext;   // render() stops player
    }

    /* ========================================================================
       STEP 6 — Save
       ======================================================================== */
    function renderSave() {
      var cat = state.saveCategory;
      var chips = CATEGORIES.map(function (c) {
        var on = cat === c.toLowerCase();
        return '<button class="chip' + (on ? " on" : "") + '" data-cat="' + attr(c.toLowerCase()) + '">' + esc(c) + '</button>';
      }).join("");

      container.innerHTML = shell(
        '<div class="card">' +
          '<div class="label">Meme title</div>' +
          '<input id="wzTitle" maxlength="80" placeholder="e.g. Monday Morning Me" value="' + attr(state.saveTitle) + '">' +
          '<div class="label" style="margin-top:16px">Category</div>' +
          '<div class="grid3">' + chips + '</div>' +
        '</div>' +
        '<div class="row" style="margin-top:4px">' +
          '<button class="btn ghost" id="wzBack" style="flex:1">← Back</button>' +
          '<button class="btn grad" id="wzSave" style="flex:2">💾 Save Meme</button>' +
        '</div>'
      );

      var titleEl = container.querySelector("#wzTitle");
      titleEl.oninput = function () { state.saveTitle = titleEl.value; };

      Array.prototype.forEach.call(container.querySelectorAll("[data-cat]"), function (b) {
        b.onclick = function () {
          state.saveTitle = titleEl.value;      // preserve typed title across re-render
          state.saveCategory = b.getAttribute("data-cat");
          renderSave();
        };
      });

      container.querySelector("#wzBack").onclick = function () { state.saveTitle = titleEl.value; goBack(); };
      container.querySelector("#wzSave").onclick = doSave;
    }

    function doSave() {
      if (state.saving) return;
      var titleEl = container.querySelector("#wzTitle");
      var title = (titleEl ? titleEl.value : state.saveTitle || "").trim();
      state.saveTitle = title;
      if (!title) { toast("Give your meme a title first."); if (titleEl) titleEl.focus(); return; }
      var category = state.saveCategory || "random";

      state.saving = true;
      var btn = container.querySelector("#wzSave");
      if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

      var payload = {
        bg: scene.bg || { type: "template", value: "random" },
        cap: scene.cap,
        fx: scene.fx || "zoomin",
        audio: scene.audio || { type: "none" },
        dur: Math.min(5, Math.max(3, +scene.dur || 4))
      };

      Promise.resolve()
        .then(function () { return MemeDB.saveMeme({ title: title, category: category, scene: payload }); })
        .then(function (r) {
          if (r && r.ok) {
            cleanup();
            onSaved(r.id);
          } else {
            state.saving = false;
            if (btn) { btn.disabled = false; btn.textContent = "💾 Save Meme"; }
            toast((r && r.msg) || "Couldn't save. Try again.");
          }
        })
        .catch(function (e) {
          state.saving = false;
          if (btn) { btn.disabled = false; btn.textContent = "💾 Save Meme"; }
          toast((e && e.message) || "Couldn't save. Try again.");
        });
    }

    /* ---- kick off ---- */
    render();
  }

  window.MemeCreate = { open: open };
})();
