/* Ilan's Arcade — Friends 2.0 (profiles · avatars · chat · bell · search) over Supabase.
   - Friend requests + friendships persist in the DB, so a request reaches the other
     player WHENEVER they next come online (no need to be online together).
   - Every player has a PROFILE: avatar (emoji or uploaded image), bio, and their
     scores across every game (read from the leaderboard).
   - Per-friend CHAT with live delivery + profanity moderation (mask + strike + mute).
   - A BELL shows incoming friend-requests and unread messages with a red count badge.
   - Online status + "what they're playing" come from Supabase Realtime presence.
   Requires the tables in friends2-setup.sql. Fully guarded: if the DB/Realtime is
   unavailable it degrades quietly. */
(function () {
  "use strict";
  function S(fn, d) { try { return fn(); } catch (e) { return d; } }

  /* ---------- identity ---------- */
  function myDisplayName() {
    let n = S(function () { return window.IGAuth && IGAuth.displayName && IGAuth.displayName(); });
    if (n) return n;
    n = S(function () { const s = JSON.parse(localStorage.getItem("soc_store_v1")); const a = s && s.accounts && (s.accounts.find(x => x.id === s.activeId) || s.accounts[0]); return a && a.name; });
    if (n) return n;
    n = S(function () { return localStorage.getItem("iglb_guestname"); });
    return n || null;
  }
  function nameKey(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40); }

  const GN = { home: "the menu", stack: "Stack Tower", archer: "Archer Duel", paper: "Paper Territory", cricket: "Super Over Cricket",
    catch: "Basket Catch", f1: "Grand Prix", football: "Penalty Kings", obby: "Rainbow Obby", puzzles: "Puzzle Pad",
    try: "One More Try", "anime-tycoon": "Anime Tycoon", tennis: "Tennis Tour", pptour: "Ping Pong Tour", karate: "Karate",
    "fruit-arena": "Fruit Arena", rescue: "Rescue Bounce", airhockey: "Air Hockey Arena", codebreaker: "Codebreaker", thisorthat: "This or That",
    scoop: "Basket Scoop" };
  // maps used to show a player's scores on their profile (mirrors auth.js)
  const GAME_TITLES = { catch: "Basket Catch", cricket: "Super Over Cricket", f1: "Grand Prix", football: "Penalty Kings",
    try: "One More Try", puzzles: "Puzzle Pad", obby: "Rainbow Obby", "anime-tycoon": "Anime Tycoon",
    tennis: "Tennis Tour", karate: "Karate", rescue: "Rescue Bounce", "fruit-arena": "Fruit Arena", pptour: "Ping Pong Tour",
    paper: "Paper Territory", stack: "Stack Tower", archer: "Archer Duel", airhockey: "Air Hockey Arena",
    scoop: "Basket Scoop" };
  const GAME_METRIC = { catch: "Best score", cricket: "Career runs", f1: "Points", football: "Matches won",
    try: "Best level", puzzles: "Puzzles solved", obby: "Best stage", "anime-tycoon": "Net worth",
    tennis: "Trophies", karate: "Wins", rescue: "Best rescues", "fruit-arena": "Best score", pptour: "Matches won",
    paper: "Territory %", stack: "Tallest stack", archer: "Best level", airhockey: "Matches won",
    scoop: "Best in 60s" };
  const GAME_EMOJI = { catch: "🧺", cricket: "🏏", f1: "🏎️", football: "⚽", try: "🎯", puzzles: "🧩", obby: "🌈",
    "anime-tycoon": "💴", tennis: "🎾", karate: "🥋", rescue: "🚑", "fruit-arena": "🍉", pptour: "🏓", paper: "🟦",
    stack: "🧱", archer: "🏹", airhockey: "🏒", scoop: "🏀" };
  const HIDDEN_GAMES = { cricket2bowl: 1, cricket2bat: 1 };

  function gameSlug() {
    if (S(function () { return document.body && document.body.hasAttribute("data-arcade-home"); })) return "home";
    const segs = location.pathname.split("/").filter(Boolean);
    let g = segs.pop() || ""; if (/\.html$/.test(g) || g === "index") g = segs.pop() || "";
    return g || "home";
  }
  function gname(slug) { return GN[slug] || slug; }
  function rd(k, d) { return S(function () { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }, d); }
  function wr(k, v) { S(function () { localStorage.setItem(k, JSON.stringify(v)); }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  let myName = null, myKey = "", sb = null, presCh = null, presState = {}, started = false;
  let _friends = rd("ig_friends_cache", []) || [], _in = [], _out = [];
  let _myProfile = rd("ig_my_profile", null);
  let _unread = {};                 // from_key -> { count, name }
  let _profiles = {};               // key -> profile (cache)
  let _chatOpenWith = null;         // key of the friend whose chat modal is open
  let _groups = [];                 // my groups: {id,name,avatar_emoji,avatar_url,owner_key,role}
  let _groupUnread = {};            // group_id -> unread count
  let _boardRows = null;            // leaderboard cache (for "leading N games")
  let _pauser = null;               // lazy game-pause engine
  const CHAT_MUTE_LIMIT = 6;        // this many bad words → chat disabled
  const listeners = []; function onUpdate(cb) { listeners.push(cb); } function fire() { listeners.forEach(function (cb) { S(function () { cb(); }); }); refreshBell(); }

  /* ---------- Supabase client ---------- */
  function loadSDK() { return new Promise(function (res) {
    if (window.supabase && window.supabase.createClient) return res(true);
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = function () { res(true); }; s.onerror = function () { res(false); }; document.head.appendChild(s);
  }); }
  async function ensureSb() {
    if (sb) return sb;
    if (!window.SUPABASE_URL || !window.SUPABASE_KEY) return null;
    const ok = await loadSDK(); if (!ok) return null;
    try { sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 8 } } }); } catch (e) { sb = null; }
    return sb;
  }

  /* ================= PROFANITY MODERATION ================= */
  /* igModerate(text) → { masked, badCount }.  Catches real profanity + common
     evasions (leetspeak, repeats, spacing) while avoiding false positives on
     innocent words (the "Scunthorpe problem"). Unit-tested with node. */
  function igModerate(text) {
    if (text == null) return { masked: text, badCount: 0 };
    var str = String(text);
    var leet = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '+': 't', '(': 'c' };
    // offensive roots matched as a substring of a normalized token (catches inflections)
    var subs = ['motherfuck', 'fuck', 'fock', 'shit', 'bitch', 'asshole', 'dumbass', 'jackass', 'bullshit', 'dipshit', 'dick', 'pussy', 'faggot', 'nigger', 'nigga', 'chink', 'kike', 'tranny', 'whore', 'slut', 'bastard', 'wank', 'piss'];
    // short collision-prone words: whole token (optionally +s) only
    var exact = ['ass', 'cock', 'fag'];
    function norm(w) {
      w = ('' + w).toLowerCase(); var out = '';
      for (var i = 0; i < w.length; i++) { var c = w.charAt(i); if (leet[c] !== undefined) c = leet[c]; if (c >= 'a' && c <= 'z') out += c; }
      return out.replace(/([a-z])\1{2,}/g, '$1');   // fuuuck->fuck, keep doubles (shiitake, mississippi)
    }
    function bad(n) {
      if (!n) return false;
      for (var i = 0; i < subs.length; i++) { if (n.indexOf(subs[i]) >= 0) return true; }
      if (n.indexOf('cunt') === 0) return true;      // start-only so "Scunthorpe" is safe
      for (var j = 0; j < exact.length; j++) { if (n === exact[j] || n === exact[j] + 's') return true; }
      return false;
    }
    var tokens = []; var re = /\S+/g, m;
    while ((m = re.exec(str))) { tokens.push({ start: m.index, end: m.index + m[0].length, norm: norm(m[0]) }); }
    var ranges = [], count = 0, consumed = {};
    // Phase A: spaced single-letter evasions ("f u c k")
    var i = 0;
    while (i < tokens.length) {
      if (tokens[i].norm.length === 1) {
        var j = i; while (j < tokens.length && tokens[j].norm.length === 1) j++;
        if (j - i >= 2) {
          var cand = ''; for (var k = i; k < j; k++) cand += tokens[k].norm; cand = cand.replace(/([a-z])\1{2,}/g, '$1');
          if (bad(cand)) { ranges.push({ start: tokens[i].start, end: tokens[j - 1].end }); count++; for (var c2 = i; c2 < j; c2++) consumed[c2] = true; }
        }
        i = j;
      } else { i++; }
    }
    // Phase B: normal per-token check
    for (var t = 0; t < tokens.length; t++) { if (consumed[t]) continue; if (bad(tokens[t].norm)) { ranges.push({ start: tokens[t].start, end: tokens[t].end }); count++; } }
    var arr = str.split('');
    for (var r = 0; r < ranges.length; r++) { for (var p = ranges[r].start; p < ranges[r].end; p++) arr[p] = '*'; }
    return { masked: arr.join(''), badCount: count };
  }

  /* ================= FUZZY NAME SEARCH ================= */
  /* igMatchNames(query, names) → [{name, score}] best-first. Case-insensitive,
     prefix-priority ("Bob"→Bob,Bobs,Bobby), substring, and typo-tolerant. Unit-tested. */
  function igMatchNames(query, names) {
    var q = (query == null ? '' : String(query)).toLowerCase().trim();
    if (!q || !names || !names.length) return [];
    function lev(a, b) {
      var al = a.length, bl = b.length; if (al === 0) return bl; if (bl === 0) return al;
      var prev = new Array(bl + 1), cur = new Array(bl + 1), i, j;
      for (j = 0; j <= bl; j++) prev[j] = j;
      for (i = 1; i <= al; i++) {
        cur[0] = i; var ac = a.charCodeAt(i - 1);
        for (j = 1; j <= bl; j++) { var cost = ac === b.charCodeAt(j - 1) ? 0 : 1; var del = prev[j] + 1, ins = cur[j - 1] + 1, sub = prev[j - 1] + cost; var mn = del < ins ? del : ins; cur[j] = mn < sub ? mn : sub; }
        var tmp = prev; prev = cur; cur = tmp;
      }
      return prev[bl];
    }
    var seen = {}, results = [];
    for (var k = 0; k < names.length; k++) {
      var original = names[k]; if (original == null) continue;
      var name = String(original), n = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(seen, n)) continue; seen[n] = true;
      var score = null;
      if (n === q) score = 10000;
      else if (n.indexOf(q) === 0) score = 8000 - (n.length - q.length);              // prefix ("Bob"->Bobs)
      else if (q.length >= 2 && n.indexOf(q) > 0) { var pos = n.indexOf(q); score = 6000 - pos * 10 - (n.length - q.length); }
      else {
        var maxDist = q.length <= 3 ? 1 : (q.length <= 6 ? 2 : 3);
        var d = lev(q, n), dPrefix = Infinity;
        if (n.length > q.length) dPrefix = lev(q, n.substring(0, q.length));
        var best = d < dPrefix ? d : dPrefix;
        if (best <= maxDist && best < q.length) score = 4000 - best * 100 - Math.abs(n.length - q.length);
      }
      if (score != null) results.push({ name: name, score: score });
    }
    results.sort(function (a, b) { if (b.score !== a.score) return b.score - a.score; if (a.name.length !== b.name.length) return a.name.length - b.name.length; return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    return results;
  }

  /* ================= game-pause engine (unit-tested 13/13) ================= */
  function makeGamePause() {
    var paused = false, queue = [], origRAF = null, origCAF = null, fakeIdCounter = 0, pausedMedia = [];
    function getWin() { return (typeof window !== 'undefined') ? window : null; }
    function pauseMedia() {
      pausedMedia = [];
      try { if (typeof document === 'undefined' || !document.querySelectorAll) return;
        var els = document.querySelectorAll('audio, video'); if (!els) return;
        for (var i = 0; i < els.length; i++) { var el = els[i]; try { if (el && el.paused === false) { el.pause(); pausedMedia.push(el); } } catch (e) {} }
      } catch (e) {}
    }
    function resumeMedia() {
      try { for (var i = 0; i < pausedMedia.length; i++) { var el = pausedMedia[i]; try { if (el && typeof el.play === 'function') { var p = el.play(); if (p && typeof p.catch === 'function') p.catch(function () {}); } } catch (e) {} } } catch (e) {}
      pausedMedia = [];
    }
    function dispatch(type) {
      try { var win = getWin(); if (!win || typeof win.dispatchEvent !== 'function') return; var evt = null;
        try { if (typeof win.Event === 'function') evt = new win.Event(type); else if (typeof Event === 'function') evt = new Event(type); } catch (e) { evt = null; }
        if (!evt) evt = { type: type }; win.dispatchEvent(evt);
      } catch (e) {}
    }
    function pause() {
      if (paused) return; var win = getWin(); if (!win) return; paused = true;
      origRAF = win.requestAnimationFrame; origCAF = win.cancelAnimationFrame;
      win.requestAnimationFrame = function (cb) { var id = ++fakeIdCounter; queue.push({ id: id, cb: cb }); return id; };
      win.cancelAnimationFrame = function (id) { for (var i = 0; i < queue.length; i++) { if (queue[i].id === id) { queue.splice(i, 1); break; } } };
      pauseMedia(); dispatch('blur');
    }
    function resume() {
      if (!paused) return; var win = getWin(); if (!win) { paused = false; return; } paused = false;
      if (origRAF !== null && typeof origRAF !== 'undefined') win.requestAnimationFrame = origRAF;
      if (origCAF !== null && typeof origCAF !== 'undefined') win.cancelAnimationFrame = origCAF;
      var pending = queue; queue = []; var realRAF = win.requestAnimationFrame;
      for (var i = 0; i < pending.length; i++) { try { if (typeof realRAF === 'function') realRAF(pending[i].cb); } catch (e) {} }
      origRAF = null; origCAF = null; resumeMedia(); dispatch('focus');
    }
    function isPaused() { return paused === true; }
    return { pause: pause, resume: resume, isPaused: isPaused };
  }
  function pauser() { if (!_pauser) _pauser = makeGamePause(); return _pauser; }
  function inGame() { return gameSlug() !== "home"; }

  /* ---- refcounted game-pause (chat/inbox open in a game freezes it, resume button on last close) ---- */
  let _pauseRefs = 0, _resumeT = null;
  function armPause() { if (!inGame()) return; if (_pauseRefs === 0) { pauser().pause(); _pausedByChat = true; } _pauseRefs++; if (_resumeT) { clearTimeout(_resumeT); _resumeT = null; } }
  function disarmPause() { if (!inGame()) return; _pauseRefs = Math.max(0, _pauseRefs - 1); if (_pauseRefs === 0 && _pausedByChat) { if (_resumeT) clearTimeout(_resumeT); _resumeT = setTimeout(function () { if (_pauseRefs === 0 && _pausedByChat) { _pausedByChat = false; showResumeOverlay(); } }, 90); } }

  /* ---- chat blocking (live multiplayer matches call IGFriends.blockChat(true) so you can't chat mid-match) ---- */
  let _chatBlocked = false;
  function blockChat(b) { _chatBlocked = !!b; S(function () { const btn = document.getElementById("igf-bell"); if (btn) btn.style.display = _chatBlocked ? "none" : "flex"; }); if (_chatBlocked) S(function () { document.querySelectorAll(".igf-ov").forEach(function (o) { if (o.__stopRec) o.__stopRec(); o.remove(); }); }); }

  /* ---- media messages (voice + photo) — encoded in the text body, stored in the avatars bucket (no schema change) ---- */
  const MED = "\u0001";   // invisible sentinel prefixing media message bodies
  function mkImg(url) { return MED + "IMG" + MED + url; }
  function mkAud(url, dur) { return MED + "AUD" + MED + url + MED + (dur || ""); }
  function isMediaBody(b) { return typeof b === "string" && b.charAt(0) === MED; }
  function parseMedia(b) {
    if (!isMediaBody(b)) return { type: "text", text: b };
    const p = b.split(MED);   // ["", "IMG"/"AUD", url, dur?]
    if (p[1] === "IMG") return { type: "img", url: p[2] || "" };
    if (p[1] === "AUD") return { type: "aud", url: p[2] || "", dur: p[3] || "" };
    return { type: "text", text: b };
  }
  function mediaPreview(b) { const m = parseMedia(b); return m.type === "img" ? "📷 Photo" : m.type === "aud" ? "🎤 Voice message" : b; }
  async function uploadBlob(blob, prefix, ext, contentType) {
    const s = await ensureSb(); if (!s) throw new Error("Not connected — try again.");
    if (!blob || !blob.size) throw new Error("Nothing was recorded — hold the mic a moment longer.");
    const path = prefix + "/" + myKey + "/" + Date.now() + "." + ext;
    const upP = s.storage.from("avatars").upload(path, blob, { upsert: true, contentType: contentType, cacheControl: "3600" });
    const up = await Promise.race([upP, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("Upload timed out — check your connection.")); }, 20000); })]);
    if (up.error) throw new Error("Upload failed: " + (up.error.message || "storage error"));
    const pub = s.storage.from("avatars").getPublicUrl(path);
    const url = pub && pub.data && pub.data.publicUrl; if (!url) throw new Error("Couldn't get the URL.");
    return url;
  }
  function recordSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mime = ""; try { if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm"; else if (MediaRecorder.isTypeSupported("audio/mp4")) mime = "audio/mp4"; } catch (e) {}
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = []; mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    mr.start();
    return { mr: mr, stream: stream, chunks: chunks, mime: mr.mimeType || mime || "audio/webm" };
  }
  function stopRecording(rec) { return new Promise(function (res) { rec.mr.onstop = function () { try { rec.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} res(new Blob(rec.chunks, { type: rec.mime })); }; try { rec.mr.stop(); } catch (e) { res(new Blob(rec.chunks, { type: rec.mime })); } }); }
  // wire the 📷 + 🎤 buttons inside a chat overlay; onMediaReady(markerBody) sends it
  function wireAttachments(ov, onMediaReady, muted) {
    const photoBtn = ov.querySelector("#igf-photo"), micBtn = ov.querySelector("#igf-mic"), warnEl = ov.querySelector("#igf-chat-warn");
    function warn(t) { if (warnEl) warnEl.textContent = t || ""; }
    if (muted) { if (photoBtn) photoBtn.style.display = "none"; if (micBtn) micBtn.style.display = "none"; return; }
    if (photoBtn) {
      const fi = document.createElement("input"); fi.type = "file"; fi.accept = "image/*"; fi.setAttribute("capture", "environment"); fi.style.display = "none"; ov.appendChild(fi);
      photoBtn.onclick = function () { fi.click(); };
      fi.onchange = async function () { const f = fi.files && fi.files[0]; fi.value = ""; if (!f) return;
        warn("📷 Sending photo…"); photoBtn.disabled = true;
        try { const blob = await downscale(f, 1024); const url = await uploadBlob(blob, "photo", "jpg", "image/jpeg"); await onMediaReady(mkImg(url)); warn(""); }
        catch (e) { warn(e.message || "Couldn't send that photo."); }
        photoBtn.disabled = false; };
    }
    if (micBtn) {
      if (!recordSupported()) { micBtn.style.display = "none"; return; }
      // "■" (U+25A0) renders on virtually every font — unlike the emoji ⏹ (U+23F9),
      // which shows as a blank/tofu glyph on many phones (looks like "no button to tap").
      const sendBtn = ov.querySelector("#igf-csend");
      let rec = null, starting = false, t0 = 0, timerInt = null, prevSendTxt = "", prevSendBg = "", prevSendClick = null;
      let prevPhotoTxt = "", prevPhotoTitle = "", prevPhotoClick = null;
      // restore the chat bar to its normal (not-recording) look — shared by send & discard
      function resetRecUI() {
        micBtn.textContent = "🎤"; micBtn.classList.remove("rec"); micBtn.disabled = false;
        if (sendBtn) { sendBtn.textContent = prevSendTxt || "Send"; sendBtn.style.background = prevSendBg; sendBtn.onclick = prevSendClick; }
        if (photoBtn) { photoBtn.textContent = prevPhotoTxt || "📷"; photoBtn.title = prevPhotoTitle || "Send a photo"; photoBtn.onclick = prevPhotoClick; photoBtn.disabled = false; }
        if (timerInt) { clearInterval(timerInt); timerInt = null; }
      }
      async function beginRecording() {
        if (rec || starting) return;   // guard against a double-tap during the getUserMedia gap (would corrupt saved button state)
        starting = true;
        try {
          rec = await startRecording(); t0 = Date.now();
          micBtn.textContent = "■"; micBtn.classList.add("rec");
          if (sendBtn) {   // repurpose the big, obvious Send button as the stop-and-send control
            prevSendTxt = sendBtn.textContent; prevSendBg = sendBtn.style.background; prevSendClick = sendBtn.onclick;
            sendBtn.textContent = "■ Send voice"; sendBtn.style.background = "#ff3b5c"; sendBtn.onclick = finishRecording;
          }
          if (photoBtn) {   // repurpose the 📷 button as a WhatsApp-style discard (delete) button while recording
            prevPhotoTxt = photoBtn.textContent; prevPhotoTitle = photoBtn.title; prevPhotoClick = photoBtn.onclick;
            photoBtn.textContent = "🗑️"; photoBtn.title = "Delete this recording (don't send)"; photoBtn.onclick = discardRecording; photoBtn.disabled = false;
          }
          timerInt = setInterval(function () { warn("🔴 Recording " + Math.floor((Date.now() - t0) / 1000) + "s — tap ■ to send, or 🗑️ to delete"); }, 300);
        } catch (e) { warn("Allow microphone access to record a voice message."); rec = null; }
        finally { starting = false; }
      }
      // stop recording and throw the audio away — nothing is uploaded or sent
      function discardRecording() {
        if (!rec) return;
        const cur = rec; rec = null;
        try { cur.mr.onstop = function () { try { cur.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }; cur.mr.stop(); }
        catch (e) { try { cur.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) {} }
        resetRecUI();
        warn("🗑️ Voice message deleted."); setTimeout(function () { if (!rec) warn(""); }, 1600);
      }
      async function finishRecording() {
        if (!rec) return;
        const cur = rec; rec = null;
        resetRecUI();
        const dur = Math.max(1, Math.round((Date.now() - t0) / 1000)); warn("🎤 Sending…"); micBtn.disabled = true;
        try { const blob = await stopRecording(cur); const ext = cur.mime.indexOf("mp4") >= 0 ? "mp4" : "webm"; const ctype = ext === "mp4" ? "audio/mp4" : "audio/webm"; const url = await uploadBlob(blob, "voice", ext, ctype); await onMediaReady(mkAud(url, dur)); warn(""); }
        catch (e) { warn(e.message || "Couldn't send that voice message."); }
        micBtn.disabled = false;
      }
      micBtn.onclick = function () { if (!rec) beginRecording(); else finishRecording(); };
      ov.__stopRec = function () { if (rec) discardRecording(); };   // release the mic if the chat is closed mid-recording
    }
  }

  /* ================= "leading N games" counter (unit-tested 14/14) ================= */
  function igCountLeading(rows, targetName) {
    function key(name) { return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, ''); }
    var result = { count: 0, games: [] };
    if (!rows || !rows.length) return result;
    var targetKey = key(targetName); if (targetKey === '') return result;
    var effective = {}, i, r, g, k, s;
    for (i = 0; i < rows.length; i++) {
      r = rows[i]; if (!r) continue; g = r.game; k = key(r.name); s = Number(r.score);
      if (g == null || k === '' || isNaN(s)) continue;
      if (!effective[g]) effective[g] = {};
      if (!(k in effective[g]) || s > effective[g][k]) effective[g][k] = s;
    }
    var games = [];
    for (g in effective) {
      if (!effective.hasOwnProperty(g)) continue;
      var byPlayer = effective[g]; if (!(targetKey in byPlayer)) continue;
      var targetScore = byPlayer[targetKey], maxScore = -Infinity;
      for (k in byPlayer) { if (byPlayer.hasOwnProperty(k) && byPlayer[k] > maxScore) maxScore = byPlayer[k]; }
      if (targetScore >= maxScore) games.push(g);
    }
    games.sort(); return { count: games.length, games: games };
  }
  // render the "leading" block: a headline count + a chip per game (emoji + name). Always shows,
  // so a player who leads nothing reads "🥇 Leading 0 games".
  function leadingHTML(lead) {
    var games = (lead && lead.games ? lead.games : []).filter(function (g) { return !HIDDEN_GAMES[g]; });
    var n = games.length;
    var h = '<div class="igf-lead' + (n === 0 ? ' zero' : '') + '">🥇 Leading ' + n + ' game' + (n === 1 ? '' : 's') + '</div>';
    if (n > 0) h += '<div class="igf-leadgs">' + games.map(function (g) {
      var t = GAME_TITLES[g] || g;
      return '<span class="igf-leadg" title="' + esc(t) + '">' + (GAME_EMOJI[g] || '🎮') + ' ' + esc(t) + '</span>';
    }).join('') + '</div>';
    return h;
  }
  async function fetchAllBoard() {
    if (_boardRows) return _boardRows;
    const s = await ensureSb(); if (!s) return [];
    try { const r = await s.from("leaderboard").select("name,game,score,is_guest").limit(2000); if (!r.error && r.data) { _boardRows = r.data; return _boardRows; } } catch (e) {}
    return [];
  }

  /* ================= PROFILES ================= */
  const BASE_AVATARS = ["🙂", "😀", "😎", "🐱", "🐶", "🦊", "🐼", "🐵", "🦁", "🐯", "🐨", "🐸", "🐷", "🐹", "🦄", "🐙", "🐢", "🐬", "🦉", "🐧", "🐙", "🦖", "🐳", "🦋"];
  const AV_COLORS = ["#3a6cf0", "#7c3aed", "#db2777", "#ea580c", "#0d9488", "#16a34a", "#ca8a04", "#dc2626", "#0891b2", "#4f46e5"];
  function hashKey(k) { var h = 0, s = String(k || ""); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function baseEmoji(k) { return BASE_AVATARS[hashKey(k) % BASE_AVATARS.length]; }
  function avColor(k) { return AV_COLORS[hashKey(k) % AV_COLORS.length]; }
  // avatar HTML for a profile-ish object {user_key,name,avatar_url,avatar_emoji}
  function avatarHTML(p, size) {
    size = size || 40; var k = (p && (p.user_key || p.key)) || nameKey(p && p.name);
    var st = "width:" + size + "px;height:" + size + "px;border-radius:50%;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;font-size:" + Math.round(size * 0.58) + "px;line-height:1;vertical-align:middle";
    if (p && p.avatar_url) return '<span style="' + st + ';background:#0c1426"><img src="' + esc(p.avatar_url) + '" style="width:100%;height:100%;object-fit:cover" alt=""></span>';
    var emo = (p && p.avatar_emoji) || baseEmoji(k);
    return '<span style="' + st + ';background:' + avColor(k) + '">' + esc(emo) + "</span>";
  }
  async function fetchProfiles(keys) {
    const s = await ensureSb(); if (!s || !keys || !keys.length) return {};
    try {
      const r = await s.from("ig_profile").select("user_key,name,bio,avatar_emoji,avatar_url,chat_muted").in("user_key", keys);
      if (!r.error && r.data) r.data.forEach(function (p) { _profiles[p.user_key] = p; });
    } catch (e) {}
    return _profiles;
  }
  async function getProfile(key, name) {
    const s = await ensureSb(); if (!s) return null;
    try {
      const r = await s.from("ig_profile").select("user_key,name,bio,avatar_emoji,avatar_url,chat_muted,chat_strikes").eq("user_key", key).maybeSingle();
      if (!r.error && r.data) { _profiles[key] = r.data; return r.data; }
    } catch (e) {}
    return { user_key: key, name: name || key, bio: "", avatar_emoji: "", avatar_url: "" };
  }
  async function ensureMyProfile() {
    const s = await ensureSb(); if (!s || !myKey) return;
    try {
      const r = await s.from("ig_profile").select("user_key,name,bio,avatar_emoji,avatar_url,chat_muted,chat_strikes").eq("user_key", myKey).maybeSingle();
      if (!r.error && r.data) { _myProfile = r.data; wr("ig_my_profile", _myProfile); }
      else { await s.from("ig_profile").upsert({ user_key: myKey, name: myName }, { onConflict: "user_key" }); _myProfile = { user_key: myKey, name: myName, bio: "", avatar_emoji: "", avatar_url: "" }; wr("ig_my_profile", _myProfile); }
    } catch (e) {}
    fire();
  }
  async function saveMyProfile(patch) {
    const s = await ensureSb(); if (!s || !myKey) return false;
    try {
      const row = Object.assign({ user_key: myKey, name: myName, updated_at: new Date().toISOString() }, patch);
      const r = await s.from("ig_profile").upsert(row, { onConflict: "user_key" }); if (r.error) return false;
      _myProfile = Object.assign(_myProfile || { user_key: myKey, name: myName }, patch); wr("ig_my_profile", _myProfile); fire();
      return true;
    } catch (e) { return false; }
  }
  // scores across all games for a given display name (from the leaderboard)
  async function scoresFor(name) {
    const s = await ensureSb(); if (!s) return [];
    try {
      const r = await s.from("leaderboard").select("game,score,is_guest").ilike("name", name).limit(200);
      if (r.error || !r.data) return [];
      const best = {};
      r.data.forEach(function (row) { if (HIDDEN_GAMES[row.game]) return; if (!(row.game in best) || row.score > best[row.game]) best[row.game] = row.score; });
      return Object.keys(best).sort(function (a, b) { return (best[b]) - (best[a]); }).map(function (g) { return { game: g, score: best[g] }; });
    } catch (e) { return []; }
  }

  /* ---------- avatar image upload (downscaled, browser → Supabase Storage) ---------- */
  function downscale(file, max) {
    return new Promise(function (res, rej) {
      try {
        const fr = new FileReader();
        fr.onload = function () {
          const img = new Image();
          img.onload = function () {
            let w = img.width, h = img.height; const scale = Math.min(1, max / Math.max(w, h));
            w = Math.round(w * scale); h = Math.round(h * scale);
            const c = document.createElement("canvas"); c.width = w; c.height = h;
            const cx = c.getContext("2d"); cx.drawImage(img, 0, 0, w, h);
            c.toBlob(function (b) { b ? res(b) : rej(new Error("encode failed")); }, "image/jpeg", 0.85);
          };
          img.onerror = function () { rej(new Error("That file isn't a valid image.")); };
          img.src = fr.result;
        };
        fr.onerror = function () { rej(new Error("Couldn't read that file.")); };
        fr.readAsDataURL(file);
      } catch (e) { rej(e); }
    });
  }
  async function uploadAvatar(file, prefix) {
    const s = await ensureSb(); if (!s) throw new Error("Not connected — try again.");
    if (!file) throw new Error("No file chosen.");
    if (!/^image\//.test(file.type)) throw new Error("Please choose an image file (JPG, PNG…).");
    if (file.size > 12 * 1024 * 1024) throw new Error("That image is too big (max 12 MB).");
    const blob = await downscale(file, 256);
    const path = (prefix || myKey) + "/" + Date.now() + ".jpg";
    const up = await s.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
    if (up.error) throw new Error("Upload failed: " + (up.error.message || "storage error") + ". Make sure the 'avatars' bucket exists.");
    const pub = s.storage.from("avatars").getPublicUrl(path);
    const url = pub && pub.data && pub.data.publicUrl; if (!url) throw new Error("Couldn't get the image URL.");
    return url;
  }

  /* ================= FRIENDS / REQUESTS ================= */
  async function dbLoad() {
    const s = await ensureSb(); if (!s || !myKey) return;
    try {
      const fr = await s.from("ig_friend").select("bname,bkey").eq("akey", myKey);
      if (!fr.error && fr.data) { _friends = fr.data.map(function (r) { return { name: r.bname, key: r.bkey }; }); wr("ig_friends_cache", _friends); wr("ig_friend_keys", _friends.map(function (f) { return f.key; })); }
      const ins = await s.from("ig_friend_req").select("from_name,from_key").eq("to_key", myKey);
      if (!ins.error && ins.data) _in = ins.data.map(function (r) { return { name: r.from_name, key: r.from_key }; });
      const outs = await s.from("ig_friend_req").select("to_name,to_key").eq("from_key", myKey);
      if (!outs.error && outs.data) _out = outs.data.map(function (r) { return { name: r.to_name, key: r.to_key }; });
      for (const r of _in.slice()) { if (_out.some(function (o) { return o.key === r.key; })) { await doAccept(r.name, r.key, true); } }
      // warm profile cache for everyone we show
      const keys = _friends.map(function (f) { return f.key; }).concat(_in.map(function (r) { return r.key; }));
      if (keys.length) fetchProfiles(keys);
      fire();
    } catch (e) {}
  }
  async function dbRequest(name, key) {
    const s = await ensureSb(); if (!s) return false; const k = key || nameKey(name);
    try { const r = await s.from("ig_friend_req").upsert({ from_key: myKey, from_name: myName, to_key: k, to_name: name }, { onConflict: "from_key,to_key" }); return !r.error; } catch (e) { return false; }
  }
  async function doAccept(name, key, silent) {
    const s = await ensureSb(); if (!s) return;
    try {
      await s.from("ig_friend").upsert([{ akey: myKey, aname: myName, bkey: key, bname: name }, { akey: key, aname: name, bkey: myKey, bname: myName }], { onConflict: "akey,bkey" });
      await s.from("ig_friend_req").delete().or("and(from_key.eq." + key + ",to_key.eq." + myKey + "),and(from_key.eq." + myKey + ",to_key.eq." + key + ")");
      if (!silent) toast("🤝 You and " + name + " are now friends!");
    } catch (e) {}
    await dbLoad();
  }
  async function doDeny(name, key) { const s = await ensureSb(); if (!s) return; try { await s.from("ig_friend_req").delete().eq("from_key", key).eq("to_key", myKey); } catch (e) {} await dbLoad(); }
  async function doUnfriend(name, key) { const s = await ensureSb(); if (!s) return;
    try { await s.from("ig_friend").delete().or("and(akey.eq." + myKey + ",bkey.eq." + key + "),and(akey.eq." + key + ",bkey.eq." + myKey + ")"); } catch (e) {} await dbLoad(); }
  function isFriend(name) { const k = nameKey(name); const keys = rd("ig_friend_keys", []); return (keys || []).indexOf(k) >= 0; }

  // resolve a typed username to the REAL player (case-insensitive), or null
  async function lookupUser(name) {
    const s = await ensureSb(); if (!s) return null; const key = nameKey(name);
    try { const v = presState && presState[key]; if (v && v.length) return v[0].name || name; } catch (e) {}
    try { const r = await s.from("ig_profile").select("name").eq("user_key", key).maybeSingle(); if (!r.error && r.data && r.data.name) return r.data.name; } catch (e) {}
    try { const r = await s.from("leaderboard").select("name").ilike("name", name).limit(8); if (!r.error && r.data) { for (const row of r.data) if (nameKey(row.name) === key) return row.name; } } catch (e) {}
    try { const r2 = await s.from("ig_friend").select("aname").ilike("aname", name).limit(8); if (!r2.error && r2.data) { for (const row of r2.data) if (nameKey(row.aname) === key) return row.aname; } } catch (e) {}
    return null;
  }
  async function sendRequest(name) {
    name = (name || "").trim(); if (!name) return { ok: false, msg: "Enter a username." };
    if (!myName) return { ok: false, msg: "Set your player name first (top of the home page)." };
    if (nameKey(name) === myKey) return { ok: false, msg: "You can't add yourself! 😄" };
    if (isFriend(name)) return { ok: false, msg: "You're already friends with " + name + "." };
    if (_out.some(function (o) { return o.key === nameKey(name); })) return { ok: false, msg: "⏳ You already sent " + name + " a request — it's pending." };
    const canon = await lookupUser(name);
    if (!canon) return { ok: false, msg: 'No player named "' + name + '" found. Capitals don’t matter, but the spelling must match someone who has played.' };
    if (nameKey(canon) === myKey) return { ok: false, msg: "You can't add yourself! 😄" };
    if (isFriend(canon)) return { ok: false, msg: "You're already friends with " + canon + "." };
    if (_out.some(function (o) { return o.key === nameKey(canon); })) return { ok: false, msg: "⏳ You already sent " + canon + " a request — it's pending." };
    const ok = await dbRequest(canon, nameKey(canon)); if (!ok) return { ok: false, msg: "Couldn't reach the server — try again." };
    _out.push({ name: canon, key: nameKey(canon) }); fire();
    return { ok: true, msg: "✅ Request sent to " + canon + " — pending until they accept." };
  }
  async function sendRequestKey(name, key) {
    if (isFriend(name)) return { ok: false, msg: "Already friends." };
    if (_out.some(function (o) { return o.key === key; })) return { ok: false, msg: "⏳ Request already pending." };
    const ok = await dbRequest(name, key); if (!ok) return { ok: false, msg: "Couldn't reach the server." };
    _out.push({ name: name, key: key }); fire();
    return { ok: true, msg: "✅ Request sent to " + name + "." };
  }
  function accept(name, key) { doAccept(name, key || nameKey(name)); }
  function deny(name, key) { doDeny(name, key || nameKey(name)); }
  function unfriend(name, key) { doUnfriend(name, key || nameKey(name)); }

  /* ================= CHAT (1:1) ================= */
  function pairKey(a, b) { return [a, b].sort().join("__"); }
  async function loadThread(otherKey) {
    const s = await ensureSb(); if (!s) return [];
    try {
      // load the LATEST 300 (descending), then flip to chronological — otherwise a thread with
      // >300 messages would only ever show the OLDEST 300 and never the recent ones.
      const r = await s.from("ig_chat").select("id,from_key,from_name,body,created_at,read_at,reply_to,reply_name,reply_body").eq("pair_key", pairKey(myKey, otherKey)).order("created_at", { ascending: false }).limit(300);
      if (!r.error && r.data) return r.data.slice().reverse();
      // reply columns not migrated yet? fall back to base columns so chat still works
      const r2 = await s.from("ig_chat").select("id,from_key,from_name,body,created_at,read_at").eq("pair_key", pairKey(myKey, otherKey)).order("created_at", { ascending: false }).limit(300);
      if (!r2.error && r2.data) return r2.data.slice().reverse();
    } catch (e) {}
    return [];
  }
  async function markRead(otherKey) {
    const s = await ensureSb(); if (!s) return;
    try { await s.from("ig_chat").update({ read_at: new Date().toISOString() }).eq("to_key", myKey).eq("from_key", otherKey).is("read_at", null); } catch (e) {}
    delete _unread[otherKey]; fire();
  }
  // shared moderation (1:1 + groups): { blocked, msg?, warn?, masked, badCount }
  async function moderateAndStrike(text) {
    const mod = igModerate(text);
    if (_myProfile && _myProfile.chat_muted) return { blocked: true, msg: "🚫 Your chat is disabled for repeated bad language.", masked: mod.masked, badCount: mod.badCount };
    let warn = null;
    if (mod.badCount > 0) {
      const s = await ensureSb();
      try {
        const r = await s.rpc("ig_chat_strike", { p_key: myKey, p_name: myName, p_add: mod.badCount, p_limit: CHAT_MUTE_LIMIT });
        const st = r && r.data;
        if (st) {
          if (_myProfile) { _myProfile.chat_strikes = st.strikes; _myProfile.chat_muted = st.muted; wr("ig_my_profile", _myProfile); }
          if (st.muted) { fire(); return { blocked: true, msg: "🚫 Your chat has been disabled for repeated inappropriate language.", masked: mod.masked, badCount: mod.badCount }; }
          const left = CHAT_MUTE_LIMIT - st.strikes;
          warn = "⚠️ Please keep it friendly — bad words are hidden." + (left <= 2 ? " Chat disabled after " + left + " more." : "");
        }
      } catch (e) {}
    }
    return { blocked: false, warn: warn, masked: mod.masked, badCount: mod.badCount };
  }
  // reply = null or { id, name, body }
  async function sendChat(otherKey, otherName, text, reply) {
    const s = await ensureSb(); if (!s) return { ok: false, msg: "Not connected." };
    const media = isMediaBody(text);
    if (!media) { text = String(text || "").trim().slice(0, 400); if (!text) return { ok: false }; }
    let body = text, warn = null;
    if (!media) { const mod = await moderateAndStrike(text); if (mod.blocked) return { ok: false, blocked: true, msg: mod.msg }; body = mod.masked; warn = mod.warn; }
    const row = { pair_key: pairKey(myKey, otherKey), from_key: myKey, from_name: myName, to_key: otherKey, body: body };
    if (reply && reply.id) { row.reply_to = reply.id; row.reply_name = String(reply.name || "").slice(0, 40); row.reply_body = String(reply.body || "").slice(0, 120); }
    try {
      let r = await s.from("ig_chat").insert(row).select("id,from_key,from_name,body,created_at").maybeSingle();
      if (r.error && row.reply_to) { delete row.reply_to; delete row.reply_name; delete row.reply_body; r = await s.from("ig_chat").insert(row).select("id,from_key,from_name,body,created_at").maybeSingle(); }
      if (r.error) return { ok: false, msg: "Message didn't send — try again." };
      const outRow = r.data || row; if (reply && reply.id) { outRow.reply_name = reply.name; outRow.reply_body = reply.body; }
      return { ok: true, warn: warn, row: outRow };
    } catch (e) { return { ok: false, msg: "Message didn't send — try again." }; }
  }
  async function loadUnread() {
    const s = await ensureSb(); if (!s || !myKey) return;
    try {
      const r = await s.from("ig_chat").select("from_key,from_name").eq("to_key", myKey).is("read_at", null).limit(500);
      if (!r.error && r.data) { _unread = {}; r.data.forEach(function (m) { const e = _unread[m.from_key] || { count: 0, name: m.from_name }; e.count++; e.name = m.from_name; _unread[m.from_key] = e; }); }
    } catch (e) {}
    fire();
  }
  function unreadTotal() { let n = 0; for (const k in _unread) n += _unread[k].count; return n; }
  function groupUnreadTotal() { let n = 0; for (const k in _groupUnread) n += _groupUnread[k]; return n; }
  function bellCount() { return _in.length + unreadTotal() + groupUnreadTotal(); }

  /* ================= GROUPS (data) ================= */
  async function loadGroups() {
    const s = await ensureSb(); if (!s || !myKey) return;
    try {
      const mem = await s.from("ig_group_member").select("group_id,role,last_read_at").eq("user_key", myKey);
      if (mem.error || !mem.data || !mem.data.length) { _groups = []; _groupUnread = {}; fire(); return; }
      const ids = mem.data.map(function (m) { return m.group_id; });
      const roleBy = {}, lastBy = {}; mem.data.forEach(function (m) { roleBy[m.group_id] = m.role; lastBy[m.group_id] = m.last_read_at; });
      const gr = await s.from("ig_group").select("id,name,avatar_emoji,avatar_url,owner_key,owner_name").in("id", ids);
      _groups = (gr.data || []).map(function (g) { return { id: g.id, name: g.name, avatar_emoji: g.avatar_emoji, avatar_url: g.avatar_url, owner_key: g.owner_key, owner_name: g.owner_name, role: roleBy[g.id], last_read_at: lastBy[g.id] }; });
      // unread per group = messages after my last_read_at not sent by me
      _groupUnread = {};
      for (const g of _groups) {
        try {
          const c = await s.from("ig_group_msg").select("id", { count: "exact", head: true }).eq("group_id", g.id).neq("from_key", myKey).gt("created_at", g.last_read_at || "1970-01-01");
          if (typeof c.count === "number" && c.count > 0) _groupUnread[g.id] = c.count;
        } catch (e) {}
      }
      fire();
    } catch (e) {}
  }
  async function loadGroupMsgs(groupId) {
    const s = await ensureSb(); if (!s) return [];
    // latest 300 (descending) then flip to chronological — a group with >300 messages must still
    // show the most RECENT ones, not the oldest 300.
    try { const r = await s.from("ig_group_msg").select("id,from_key,from_name,body,created_at,reply_to,reply_name,reply_body").eq("group_id", groupId).order("created_at", { ascending: false }).limit(300); if (!r.error && r.data) return r.data.slice().reverse(); } catch (e) {}
    return [];
  }
  async function markGroupRead(groupId) {
    const s = await ensureSb(); if (!s) return;
    try { await s.from("ig_group_member").update({ last_read_at: new Date().toISOString() }).eq("group_id", groupId).eq("user_key", myKey); } catch (e) {}
    delete _groupUnread[groupId]; fire();
  }
  async function sendGroupMsg(groupId, text, reply) {
    const s = await ensureSb(); if (!s) return { ok: false, msg: "Not connected." };
    const media = isMediaBody(text);
    if (!media) { text = String(text || "").trim().slice(0, 400); if (!text) return { ok: false }; }
    let body = text, warn = null;
    if (!media) { const mod = await moderateAndStrike(text); if (mod.blocked) return { ok: false, blocked: true, msg: mod.msg }; body = mod.masked; warn = mod.warn; }
    const row = { group_id: groupId, from_key: myKey, from_name: myName, body: body };
    if (reply && reply.id) { row.reply_to = reply.id; row.reply_name = String(reply.name || "").slice(0, 40); row.reply_body = String(reply.body || "").slice(0, 120); }
    try {
      const r = await s.from("ig_group_msg").insert(row).select("id,from_key,from_name,body,created_at,reply_to,reply_name,reply_body").maybeSingle();
      if (r.error) return { ok: false, msg: "Message didn't send — try again." };
      return { ok: true, warn: warn, row: r.data || row };
    } catch (e) { return { ok: false, msg: "Message didn't send — try again." }; }
  }
  async function groupMembers(groupId) {
    const s = await ensureSb(); if (!s) return [];
    try { const r = await s.from("ig_group_member").select("user_key,name,role").eq("group_id", groupId); if (!r.error && r.data) return r.data; } catch (e) {}
    return [];
  }
  async function createGroup(name, memberKeys, memberNames, avatar) {
    const s = await ensureSb(); if (!s) return { ok: false, msg: "Not connected." };
    name = String(name || "").trim().slice(0, 40); if (!name) return { ok: false, msg: "Enter a group name." };
    try {
      const g = await s.from("ig_group").insert({ name: name, owner_key: myKey, owner_name: myName, avatar_emoji: (avatar && avatar.emoji) || "", avatar_url: (avatar && avatar.url) || "" }).select("id").maybeSingle();
      if (g.error || !g.data) return { ok: false, msg: "Couldn't create the group." };
      const gid = g.data.id;
      const rows = [{ group_id: gid, user_key: myKey, name: myName, role: "owner" }];
      (memberKeys || []).forEach(function (k, i) { if (k && k !== myKey) rows.push({ group_id: gid, user_key: k, name: (memberNames && memberNames[i]) || k, role: "member" }); });
      await s.from("ig_group_member").upsert(rows, { onConflict: "group_id,user_key" });
      await loadGroups();
      return { ok: true, id: gid };
    } catch (e) { return { ok: false, msg: "Couldn't create the group." }; }
  }
  async function addGroupMember(groupId, key, name) {
    const s = await ensureSb(); if (!s) return false;
    try { const r = await s.from("ig_group_member").upsert({ group_id: groupId, user_key: key, name: name, role: "member" }, { onConflict: "group_id,user_key" }); return !r.error; } catch (e) { return false; }
  }
  async function removeGroupMember(groupId, key) {
    const s = await ensureSb(); if (!s) return false;
    try { const r = await s.from("ig_group_member").delete().eq("group_id", groupId).eq("user_key", key); return !r.error; } catch (e) { return false; }
  }
  async function leaveGroup(groupId) {
    const s = await ensureSb(); if (!s) return;
    const g = _groups.find(function (x) { return x.id === groupId; });
    try {
      await s.from("ig_group_member").delete().eq("group_id", groupId).eq("user_key", myKey);
      // owner leaving with members left → hand ownership to another member; if empty, delete group
      if (g && g.owner_key === myKey) {
        const rest = await s.from("ig_group_member").select("user_key,name").eq("group_id", groupId).limit(1);
        if (rest.data && rest.data.length) { await s.from("ig_group").update({ owner_key: rest.data[0].user_key, owner_name: rest.data[0].name }).eq("id", groupId); await s.from("ig_group_member").update({ role: "owner" }).eq("group_id", groupId).eq("user_key", rest.data[0].user_key); }
        else { await s.from("ig_group_msg").delete().eq("group_id", groupId); await s.from("ig_group").delete().eq("id", groupId); }
      }
    } catch (e) {}
    await loadGroups();
  }
  async function saveGroupMeta(groupId, patch) {
    const s = await ensureSb(); if (!s) return false;
    try { const r = await s.from("ig_group").update(patch).eq("id", groupId); if (!r.error) { const g = _groups.find(function (x) { return x.id === groupId; }); if (g) Object.assign(g, patch); fire(); } return !r.error; } catch (e) { return false; }
  }

  /* ================= presence ================= */
  function presenceOf(name) { const v = presState && presState[nameKey(name)]; if (v && v.length) return { online: true, game: v[0].game }; return { online: false }; }
  function presenceOfKey(key) { const v = presState && presState[key]; if (v && v.length) return { online: true, game: v[0].game }; return { online: false }; }

  /* ================= User of the Week (unchanged) ================= */
  function weekMeta() {
    const d = new Date();
    const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayNum = Math.round(localMidnight / 86400000);
    const sinceFri = (d.getDay() - 5 + 7) % 7;
    return { week: dayNum - sinceFri, daysLeft: 7 - sinceFri };
  }
  async function bumpPlay() {
    try {
      if (gameSlug() === "home") return;
      const now = Date.now(); if (now - (+rd("ig_lastbump", 0)) < 60000) return; wr("ig_lastbump", now);
      const s = await ensureSb(); if (!s || !myKey) return;
      await s.rpc("ig_play_bump", { p_name: myName, p_key: myKey, p_week: weekMeta().week });
    } catch (e) {}
  }
  /* Anti-spam: a play only counts toward User of the Week after the player has
     actually stayed on the game for IG_DWELL_MS. Opening then quickly closing a
     game (to farm plays) no longer counts. Time spent with the tab hidden /
     backgrounded is NOT counted, so leaving the tab open in the background
     doesn't game it either. */
  var IG_DWELL_MS = 25000;
  function afterDwell(ms, cb) {
    try {
      var acc = 0, last = Date.now(), done = false;
      var iv = setInterval(function () {
        if (done) return;
        var t = Date.now();
        if (!document.hidden) acc += t - last;
        last = t;
        if (acc >= ms) { done = true; clearInterval(iv); try { cb(); } catch (e) {} }
      }, 1000);
      document.addEventListener("visibilitychange", function () { last = Date.now(); });
    } catch (e) {}
  }
  function scheduleBumpPlay() {
    if (gameSlug() === "home") return;
    afterDwell(IG_DWELL_MS, function () { bumpPlay(); });
  }
  var _weekWinnerKey = rd("ig_week_winner", "") || "";
  function isWeekWinner(n) { return !!_weekWinnerKey && nameKey(n) === _weekWinnerKey; }
  async function weeklyInfo() {
    const s = await ensureSb(); if (!s) return null;
    const wm = weekMeta(), wk = wm.week, daysLeft = wm.daysLeft;
    const info = { daysLeft: daysLeft, leader: null, leaderPlays: 0, prev: null };
    try { const r = await s.from("ig_weekly").select("user_name,plays").eq("week", wk).neq("user_key", "ilan").order("plays", { ascending: false }).limit(1); if (!r.error && r.data && r.data.length) { info.leader = r.data[0].user_name; info.leaderPlays = r.data[0].plays; } } catch (e) {}
    try { const p = await s.from("ig_weekly").select("user_name,plays").eq("week", wk - 7).neq("user_key", "ilan").order("plays", { ascending: false }).limit(1); if (!p.error && p.data && p.data.length) info.prev = p.data[0].user_name; } catch (e) {}
    const holder = info.prev || info.leader;
    _weekWinnerKey = holder ? nameKey(holder) : "";
    wr("ig_week_winner", _weekWinnerKey);
    if (info.prev && myKey && nameKey(info.prev) === myKey && (+rd("ig_uotw_shown", 0)) !== wk) { wr("ig_uotw_shown", wk); winnerPopup(); }
    return info;
  }
  function winnerPopup() {
    try {
      if (document.getElementById("ig-uotw-pop")) return;
      const css = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(6,4,20,.72);backdrop-filter:blur(4px);animation:igPopFade .3s ease";
      const card = "max-width:340px;margin:18px;background:linear-gradient(150deg,#3a2470,#160f34);border:1px solid rgba(200,160,255,.4);border-radius:22px;padding:26px 24px 20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);animation:igPopIn .45s cubic-bezier(.2,1.3,.4,1)";
      const o = document.createElement("div"); o.id = "ig-uotw-pop"; o.setAttribute("style", css);
      o.innerHTML =
        '<style>@keyframes igPopFade{from{opacity:0}to{opacity:1}}@keyframes igPopIn{from{opacity:0;transform:scale(.7) translateY(20px)}to{opacity:1;transform:none}}@keyframes igMedal{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}</style>' +
        '<div style="' + card + '">' +
        '<div style="font-size:64px;line-height:1;animation:igMedal 1.2s ease-in-out infinite">🏅</div>' +
        '<div style="font-size:22px;font-weight:900;color:#fff;margin-top:12px">You’re the User of the Week!</div>' +
        '<div style="font-size:14px;color:#d7c9ff;margin-top:8px">You played the most games last week. Your crown 👑 now shows on every leaderboard — enjoy it, champion!</div>' +
        '<button id="ig-uotw-ok" style="margin-top:18px;width:100%;padding:12px;border:0;border-radius:12px;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(90deg,#8b5cf6,#c026d3);cursor:pointer">Awesome! 🎉</button>' +
        "</div>";
      document.body.appendChild(o);
      function close() { o.remove(); }
      o.querySelector("#ig-uotw-ok").onclick = close;
      o.addEventListener("click", function (e) { if (e.target === o) close(); });
    } catch (e) {}
  }

  /* ================= init ================= */
  async function init() {
    if (started) return; myName = myDisplayName();
    if (!myName) { setTimeout(init, 1500); return; }
    started = true; myKey = nameKey(myName);
    injectCSS(); injectBell(); maybeBanner();
    const s = await ensureSb(); if (!s) return;
    try {
      presCh = s.channel("ig-presence", { config: { presence: { key: myKey } } });
      presCh.on("presence", { event: "sync" }, function () { presState = S(function () { return presCh.presenceState(); }, {}) || {}; fire(); });
      presCh.subscribe(function (st) { if (st === "SUBSCRIBED") S(function () { presCh.track({ name: myName, game: gameSlug(), ts: Date.now() }); }); });
    } catch (e) {}
    try {
      const fc = s.channel("igfr-" + myKey);
      fc.on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_friend_req", filter: "to_key=eq." + myKey }, function () { dbLoad().then(function () { toast("👋 New friend request!"); }); });
      fc.on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_friend", filter: "akey=eq." + myKey }, function () { dbLoad(); });
      fc.on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_chat", filter: "to_key=eq." + myKey }, function (payload) { onIncomingChat(payload && payload.new); });
      fc.on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_group_member", filter: "user_key=eq." + myKey }, function () { loadGroups().then(function () { toast("👥 You were added to a group!"); }); });
      fc.subscribe();
    } catch (e) {}
    ensureMyProfile();
    dbLoad(); loadUnread(); loadGroups();
    setInterval(function () { dbLoad(); loadUnread(); loadGroups(); }, 15000);
    scheduleBumpPlay(); weeklyInfo();
  }
  function onIncomingChat(msg) {
    if (!msg) { loadUnread(); return; }
    if (_chatOpenWith && msg.from_key === _chatOpenWith) { appendChatBubble(msg); markRead(_chatOpenWith); return; }
    const e = _unread[msg.from_key] || { count: 0, name: msg.from_name }; e.count++; e.name = msg.from_name; _unread[msg.from_key] = e;
    toast("💬 " + msg.from_name + ": " + mediaPreview(msg.body || "").slice(0, 40)); fire();
  }

  /* ================= UI: toast + CSS ================= */
  function toast(msg) {
    S(function () {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9600;background:#0f1d36;border:1px solid #2a3c63;color:#fff;padding:12px 16px;border-radius:14px;font:14px -apple-system,system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:92vw;text-align:center";
      t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 5000);
    });
  }
  function injectCSS() {
    if (document.getElementById("igf-css")) return;
    const c = document.createElement("style"); c.id = "igf-css";
    c.textContent =
      ".igf-ov{position:fixed;inset:0;background:rgba(6,10,22,.72);backdrop-filter:blur(4px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:18px;font-family:-apple-system,'Segoe UI',system-ui,sans-serif}"
      + ".igf-box{background:#0f1d36;border:1px solid #2a3c63;border-radius:18px;padding:20px;max-width:420px;width:100%;color:#fff;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)}"
      + ".igf-box h2{font-size:21px;margin:0 0 4px;display:flex;align-items:center;gap:8px}.igf-box .s{font-size:12px;color:#9fb3d8;margin:0 0 12px}"
      + ".igf-add{display:flex;gap:6px;margin-bottom:6px}.igf-add input{flex:1;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:11px 12px;border-radius:10px;font-size:15px}"
      + ".igf-btn{border:none;border-radius:10px;padding:11px 14px;font-weight:800;cursor:pointer;font-size:14px}.igf-p{background:linear-gradient(135deg,#39ff88,#1ea85a);color:#04220f}.igf-g{background:#26344f;color:#cfe0ff}.igf-d{background:#5a2330;color:#ffb4b4}.igf-b{background:linear-gradient(135deg,#7dc4ff,#3a6cf0);color:#06122a}"
      + ".igf-sec{font-size:12px;color:#7e90b5;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px}"
      + ".igf-row{display:flex;align-items:center;gap:10px;background:#16243f;border-radius:12px;padding:9px 11px;margin:5px 0}"
      + ".igf-row .n{flex:1;text-align:left;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.igf-row .n small{display:block;color:#8aa0c6;font-size:11px;overflow:hidden;text-overflow:ellipsis}"
      + ".igf-row.tap{cursor:pointer}.igf-row.tap:active{background:#1c2b4a}"
      + ".igf-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}.igf-dot.on{background:#39ff88;box-shadow:0 0 8px #39ff88}.igf-dot.off{background:#566}"
      + ".igf-x{background:transparent;color:#7e90b5;border:none;font-weight:700;cursor:pointer;width:100%;padding:12px;font-size:15px}"
      + ".igf-bell{position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);right:calc(env(safe-area-inset-right,0px) + 10px);z-index:8800;width:44px;height:44px;border-radius:50%;border:none;background:rgba(15,29,54,.92);color:#fff;font-size:21px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}"
      + ".igf-bell .cnt{position:absolute;top:-4px;right:-4px;background:#ff3b5c;color:#fff;font-size:11px;font-weight:800;min-width:18px;height:18px;border-radius:9px;display:none;align-items:center;justify-content:center;padding:0 4px;box-shadow:0 0 0 2px #0f1d36}"
      + ".igf-chat{display:flex;flex-direction:column;height:70vh;max-height:560px}"
      + ".igf-msgs{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:6px 2px}"
      + ".igf-bub{max-width:78%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.35;word-wrap:break-word;white-space:pre-wrap}"
      + ".igf-bub.me{align-self:flex-end;background:linear-gradient(135deg,#3a6cf0,#2a4fc0);color:#fff;border-bottom-right-radius:4px}"
      + ".igf-bub.them{align-self:flex-start;background:#1c2b4a;background:#1c2b4a;color:#eaf1ff;border-bottom-left-radius:4px}"
      + ".igf-bub small{display:block;font-size:10px;opacity:.6;margin-top:2px}"
      + ".igf-cin{display:flex;gap:6px;margin-top:8px}.igf-cin input{flex:1;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:11px 12px;border-radius:20px;font-size:15px}"
      + ".igf-prof-top{display:flex;align-items:center;gap:14px;margin-bottom:10px}.igf-prof-top .nm{font-size:20px;font-weight:900}.igf-prof-top .st{font-size:12px;color:#9fb3d8;margin-top:2px}"
      + ".igf-bio{background:#0c1426;border:1px solid #22345c;border-radius:12px;padding:10px 12px;font-size:14px;color:#cfe0ff;margin:8px 0;white-space:pre-wrap;word-wrap:break-word}"
      + ".igf-emopick{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.igf-emopick button{width:40px;height:40px;font-size:22px;border-radius:10px;border:1px solid #2a3c63;background:#16243f;cursor:pointer}"
      + ".igf-score{display:flex;align-items:center;gap:8px;background:#16243f;border-radius:10px;padding:8px 11px;margin:4px 0;font-size:14px}.igf-score .g{flex:1}.igf-score .v{font-weight:800;color:#ffd54a}"
      + ".igf-banner{background:linear-gradient(135deg,#1ea85a,#0e7a6f);color:#eafff4;border-radius:14px;padding:10px 14px;margin:0 auto 16px;max-width:460px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;justify-content:center;box-shadow:0 6px 18px rgba(20,160,90,.3)}"
      + ".igf-banner b{color:#fff}.igf-banner .x{cursor:pointer;opacity:.8;font-weight:800}"
      + ".igf-bub{position:relative}.igf-bub .rt{cursor:pointer;opacity:0;position:absolute;top:2px;font-size:12px;color:#9fb3d8}.igf-bub:hover .rt{opacity:.9}.igf-bub.me .rt{left:-18px}.igf-bub.them .rt{right:-18px}"
      + ".igf-quote{border-left:3px solid rgba(255,255,255,.5);padding:2px 8px;margin-bottom:4px;font-size:12px;opacity:.85;background:rgba(0,0,0,.18);border-radius:5px;white-space:normal}"
      + ".igf-quote b{display:block;font-size:11px;opacity:.9}"
      + ".igf-sender{font-size:11px;font-weight:800;color:#8fd0ff;margin-bottom:1px}"
      + ".igf-replybar{display:flex;align-items:center;gap:8px;background:#0c1426;border-left:3px solid #3a6cf0;border-radius:8px;padding:6px 10px;margin-bottom:6px;font-size:12px}"
      + ".igf-replybar .rb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cfe0ff}.igf-replybar .rb b{color:#8fd0ff}.igf-replybar .rx{cursor:pointer;color:#9fb3d8;font-weight:800}"
      + ".igf-typing{font-size:12px;color:#8aa0c6;min-height:16px;padding:2px 4px;font-style:italic}"
      + ".igf-zoom{position:fixed;inset:0;z-index:9700;background:rgba(2,4,10,.92);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;padding:20px}"
      + ".igf-zoom img{max-width:86vw;max-height:74vh;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.6)}"
      + ".igf-zoom .ze{font-size:min(46vw,300px);line-height:1}.igf-zoom .zn{color:#fff;font-size:20px;font-weight:800}"
      + ".igf-resume{position:fixed;inset:0;z-index:8700;background:rgba(4,8,18,.86);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#fff;font-family:-apple-system,system-ui,sans-serif}"
      + ".igf-resume .rb2{font-size:22px;font-weight:900}.igf-resume button{background:linear-gradient(135deg,#39ff88,#1ea85a);color:#04220f;border:none;border-radius:30px;padding:15px 40px;font-size:19px;font-weight:900;cursor:pointer;box-shadow:0 8px 24px rgba(40,220,120,.4)}"
      + ".igf-lead{display:inline-flex;align-items:center;gap:4px;background:rgba(255,213,74,.16);color:#ffd54a;border-radius:10px;padding:2px 9px;font-size:12px;font-weight:800;margin-top:4px}"
      + ".igf-lead.zero{background:rgba(255,255,255,.08);color:#9fb3d8}"
      + ".igf-leadgs{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}"
      + ".igf-leadg{display:inline-flex;align-items:center;gap:4px;background:rgba(255,213,74,.12);border:1px solid rgba(255,213,74,.32);color:#ffe6a3;border-radius:9px;padding:3px 8px;font-size:11px;font-weight:700;line-height:1.1}"
      + ".igf-clickav{cursor:zoom-in}"
      + ".igf-pick{display:flex;align-items:center;gap:8px;background:#16243f;border-radius:10px;padding:8px 11px;margin:4px 0;cursor:pointer}.igf-pick .ck{width:20px;height:20px;border-radius:6px;border:2px solid #3a6cf0;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff}.igf-pick.on .ck{background:#3a6cf0}"
      + ".igf-att{background:#26344f;color:#fff;border:none;border-radius:50%;width:38px;height:38px;font-size:17px;cursor:pointer;flex:0 0 auto;padding:0}.igf-att:disabled{opacity:.5}.igf-att.rec{background:#ff3b5c;animation:igpulse 1s infinite}@keyframes igpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}"
      + ".igf-cimg{max-width:210px;max-height:230px;border-radius:12px;cursor:zoom-in;display:block;margin:2px 0}"
      + ".igf-aud{display:flex;flex-direction:column;gap:1px}.igf-aud audio{max-width:230px;height:38px}.igf-aud .d{opacity:.7}";
    document.head.appendChild(c);
  }

  /* ================= chat button + inbox ================= */
  function injectBell() {
    if (document.getElementById("igf-bell")) return;
    const b = document.createElement("button"); b.id = "igf-bell"; b.className = "igf-bell"; b.title = "Chats";
    b.innerHTML = '💬<span class="cnt" id="igf-bell-cnt">0</span>';
    b.onclick = openInbox;
    S(function () { document.body.appendChild(b); if (_chatBlocked) b.style.display = "none"; });
    refreshBell();
  }
  function refreshBell() {
    S(function () {
      const cnt = document.getElementById("igf-bell-cnt"); if (!cnt) return;
      const n = bellCount(); cnt.textContent = n > 99 ? "99+" : n; cnt.style.display = n > 0 ? "flex" : "none";
      // also keep the home Friends button badge in sync
      const fb = document.getElementById("friendsBadge"); if (fb) { const rn = _in.length; fb.textContent = rn; fb.style.display = rn > 0 ? "inline-block" : "none"; }
    });
  }
  // Chat-first inbox: chat directly with friends + groups (requests handled inline too).
  function openInbox() {
    if (_chatBlocked) { toast("Chat is paused during a live match."); return; }
    injectCSS(); dbLoad(); loadUnread(); loadGroups();
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2>💬 Chats</h2><div id="igf-bell-body"></div>'
      + '<div style="display:flex;gap:6px;margin-top:10px"><button class="igf-btn igf-b" id="igf-inbox-newg" style="flex:1">➕ New group</button><button class="igf-btn igf-g" id="igf-inbox-friends" style="flex:1">👥 Friends</button></div>'
      + '<button class="igf-x" id="igf-bell-close">Close</button></div>';
    document.body.appendChild(ov); armPause();
    function close() { ov.remove(); disarmPause(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector("#igf-bell-close").onclick = close;
    ov.querySelector("#igf-inbox-newg").onclick = function () { close(); openCreateGroup(); };
    ov.querySelector("#igf-inbox-friends").onclick = function () { close(); openPanel(); };
    function render() {
      let h = "";
      if (_in.length) {
        h += '<div class="igf-sec">Friend requests</div>';
        _in.forEach(function (r) { const p = _profiles[r.key] || { user_key: r.key, name: r.name };
          h += '<div class="igf-row">' + avatarHTML(p, 36) + '<span class="n tapp" data-open="' + esc(r.name) + '" data-k="' + esc(r.key) + '" style="cursor:pointer">' + esc(r.name) + '<small>wants to be friends</small></span><button class="igf-btn igf-p" data-acc="' + esc(r.name) + '" data-k="' + esc(r.key) + '">Accept</button><button class="igf-btn igf-d" data-den="' + esc(r.name) + '" data-k="' + esc(r.key) + '">✕</button></div>'; });
      }
      // friends, unread first then online then the rest
      const fl = _friends.slice().sort(function (a, b) {
        const ua = _unread[a.key] ? 1 : 0, ub = _unread[b.key] ? 1 : 0; if (ua !== ub) return ub - ua;
        const oa = presenceOfKey(a.key).online ? 1 : 0, ob = presenceOfKey(b.key).online ? 1 : 0; if (oa !== ob) return ob - oa;
        return 0;
      });
      h += '<div class="igf-sec">Friends</div>';
      if (!fl.length) h += '<div class="s">No friends yet — tap 👥 Friends to add some.</div>';
      fl.forEach(function (f) { const pr = presenceOfKey(f.key); const p = _profiles[f.key] || { user_key: f.key, name: f.name };
        const sub = pr.online ? (pr.game === "home" ? "Online" : "Playing " + gname(pr.game)) : "Offline";
        const u = _unread[f.key] ? '<span style="background:#ff3b5c;color:#fff;border-radius:9px;padding:1px 7px;font-size:12px;font-weight:800">' + _unread[f.key].count + "</span>" : "";
        h += '<div class="igf-row tap" data-msg="' + esc(f.name) + '" data-k="' + esc(f.key) + '"><span class="igf-dot ' + (pr.online ? "on" : "off") + '"></span>' + avatarHTML(p, 36) + '<span class="n">' + esc(f.name) + "<small>" + sub + "</small></span>" + u + "</div>"; });
      h += '<div class="igf-sec">Groups</div>';
      if (!_groups.length) h += '<div class="s">No groups yet.</div>';
      _groups.forEach(function (g) { const c = _groupUnread[g.id]; const u = c ? '<span style="background:#ff3b5c;color:#fff;border-radius:9px;padding:1px 7px;font-size:12px;font-weight:800">' + c + "</span>" : "";
        h += '<div class="igf-row tap" data-grp="' + esc(g.id) + '">' + avatarHTML(grpAvatar(g), 36) + '<span class="n">' + esc(g.name) + "<small>" + (g.owner_key === myKey ? "You're the admin 👑" : "Group") + "</small></span>" + u + "</div>"; });
      const body = ov.querySelector("#igf-bell-body"); body.innerHTML = h;
      body.querySelectorAll("[data-acc]").forEach(function (el) { el.onclick = function (e) { e.stopPropagation(); accept(el.getAttribute("data-acc"), el.getAttribute("data-k")); }; });
      body.querySelectorAll("[data-den]").forEach(function (el) { el.onclick = function (e) { e.stopPropagation(); deny(el.getAttribute("data-den"), el.getAttribute("data-k")); }; });
      body.querySelectorAll(".tapp[data-open]").forEach(function (el) { el.onclick = function () { close(); openProfile(el.getAttribute("data-open"), el.getAttribute("data-k")); }; });
      body.querySelectorAll("[data-msg]").forEach(function (el) { el.onclick = function () { close(); openChat(el.getAttribute("data-k"), el.getAttribute("data-msg")); }; });
      body.querySelectorAll("[data-grp]").forEach(function (el) { el.onclick = function () { close(); openGroupChat(parseInt(el.getAttribute("data-grp"), 10)); }; });
    }
    render(); onUpdate(function () { if (document.body.contains(ov)) render(); });
  }
  function openBell() { return openInbox(); }

  /* ================= profile modal ================= */
  async function openProfile(name, key) {
    key = key || nameKey(name); injectCSS();
    const mine = key === myKey;
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><div id="igf-prof">Loading…</div><button class="igf-x" id="igf-prof-close">Close</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector("#igf-prof-close").onclick = function () { ov.remove(); };
    const p = mine ? (await ensureMyProfileObj()) : (await getProfile(key, name));
    const realName = (p && p.name) || name;
    const pres = presenceOfKey(key);
    let st = pres.online ? (pres.game === "home" ? "🟢 Online — in the menu" : "🟢 Online — playing " + gname(pres.game)) : "⚪ Offline";
    if (mine) st = "This is you";
    const wk = isWeekWinner(realName) ? ' <span title="User of the Week">🏅</span>' : "";
    const friend = isFriend(realName);
    const incoming = _in.some(function (r) { return r.key === key; });
    const pending = _out.some(function (o) { return o.key === key; });
    const board = await fetchAllBoard();
    const lead = igCountLeading(board, realName);
    const leadH = leadingHTML(lead);
    const scores = await scoresFor(realName);
    let scoreH = "";
    if (scores.length) scoreH = '<div class="igf-sec">Scores</div>' + scores.map(function (r) {
      return '<div class="igf-score"><span>' + (GAME_EMOJI[r.game] || "🎮") + '</span><span class="g">' + esc(GAME_TITLES[r.game] || r.game) + ' <small style="color:#8aa0c6">' + esc(GAME_METRIC[r.game] || "") + '</small></span><span class="v">' + r.score + "</span></div>"; }).join("");
    else scoreH = '<div class="igf-sec">Scores</div><div class="s">No game scores yet.</div>';
    let actions = "";
    if (mine) actions = '<button class="igf-btn igf-b" id="igf-edit" style="width:100%">✏️ Edit profile</button>';
    else if (friend) actions = '<div style="display:flex;gap:6px"><button class="igf-btn igf-p" id="igf-chat" style="flex:1">💬 Chat</button><button class="igf-btn igf-d" id="igf-unf">Unfriend</button></div>';
    else if (incoming) actions = '<div style="display:flex;gap:6px"><button class="igf-btn igf-p" id="igf-acc" style="flex:1">✅ Accept request</button><button class="igf-btn igf-d" id="igf-den">Deny</button></div>';
    else if (pending) actions = '<button class="igf-btn igf-g" style="width:100%;opacity:.85;cursor:default">⏳ Request pending</button>';
    else actions = '<button class="igf-btn igf-b" id="igf-add" style="width:100%">➕ Add friend</button>';
    const bioH = (p && p.bio) ? '<div class="igf-bio">' + esc(p.bio) + "</div>" : (mine ? '<div class="s">No bio yet — tap Edit profile to add one.</div>' : "");
    const avObj = Object.assign({ user_key: key, name: realName }, p || {});
    ov.querySelector("#igf-prof").innerHTML =
      '<div class="igf-prof-top"><span class="igf-clickav" id="igf-prof-av">' + avatarHTML(avObj, 66) + "</span>" +
      '<div><div class="nm">' + esc(realName) + wk + '</div><div class="st">' + st + "</div>" + leadH + "</div></div>" +
      bioH + '<div style="margin:12px 0">' + actions + "</div>" + scoreH;
    const q = function (id) { return ov.querySelector(id); };
    if (q("#igf-prof-av")) q("#igf-prof-av").onclick = function () { openAvatarZoom(avObj, realName); };
    if (q("#igf-edit")) q("#igf-edit").onclick = function () { ov.remove(); openEditProfile(); };
    if (q("#igf-chat")) q("#igf-chat").onclick = function () { ov.remove(); openChat(key, realName); };
    if (q("#igf-add")) q("#igf-add").onclick = function () { q("#igf-add").disabled = true; sendRequestKey(realName, key).then(function (r) { toast(r.msg); if (r.ok) { ov.remove(); } else q("#igf-add").disabled = false; }); };
    if (q("#igf-acc")) q("#igf-acc").onclick = function () { accept(realName, key); ov.remove(); };
    if (q("#igf-den")) q("#igf-den").onclick = function () { deny(realName, key); ov.remove(); };
    if (q("#igf-unf")) q("#igf-unf").onclick = function () { if (confirm("Remove " + realName + " as a friend?")) { unfriend(realName, key); ov.remove(); } };
  }
  async function ensureMyProfileObj() { if (_myProfile && _myProfile.user_key) return _myProfile; await ensureMyProfile(); return _myProfile || { user_key: myKey, name: myName, bio: "" }; }

  /* ================= edit-profile modal (bio + emoji + image upload) ================= */
  const EMOJI_CHOICES = ["🙂", "😎", "😀", "🤩", "😇", "🥳", "😜", "🤠", "👑", "🔥", "⭐", "⚡", "🎮", "🏆", "🚀", "🐱", "🐶", "🦊", "🐼", "🦁", "🐯", "🐸", "🐵", "🦄", "🐉", "🦖", "🐙", "🦋", "🌈", "💎", "⚽", "🏀", "🏏", "🎯", "🍕", "🍩"];
  async function openEditProfile() {
    injectCSS(); const p = await ensureMyProfileObj();
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2>✏️ Edit profile</h2>'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><span id="igf-ep-av">' + avatarHTML(p, 60) + '</span><div style="flex:1"><button class="igf-btn igf-b" id="igf-ep-up" style="width:100%">📷 Upload image</button><input type="file" accept="image/*" id="igf-ep-file" style="display:none"></div></div>'
      + '<div class="s">Or pick an emoji avatar:</div><div class="igf-emopick" id="igf-ep-emo"></div>'
      + '<div class="igf-sec">Bio</div><textarea id="igf-ep-bio" maxlength="160" rows="3" placeholder="Say something about yourself…" style="width:100%;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:10px 12px;border-radius:10px;font-size:15px;resize:vertical;font-family:inherit">' + esc(p.bio || "") + "</textarea>"
      + '<div class="iga-msg" id="igf-ep-msg" style="font-size:13px;min-height:16px;margin:6px 0;color:#9fb3d8"></div>'
      + '<button class="igf-btn igf-p" id="igf-ep-save" style="width:100%">Save</button><button class="igf-x" id="igf-ep-cancel">Cancel</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    let pending = { avatar_emoji: p.avatar_emoji || "", avatar_url: p.avatar_url || "" };
    const emo = ov.querySelector("#igf-ep-emo");
    emo.innerHTML = EMOJI_CHOICES.map(function (e) { return '<button data-e="' + e + '">' + e + "</button>"; }).join("");
    emo.querySelectorAll("button").forEach(function (bt) { bt.onclick = function () { pending.avatar_emoji = bt.getAttribute("data-e"); pending.avatar_url = ""; ov.querySelector("#igf-ep-av").innerHTML = avatarHTML({ user_key: myKey, name: myName, avatar_emoji: pending.avatar_emoji }, 60); }; });
    const msg = function (t, err) { const m = ov.querySelector("#igf-ep-msg"); m.textContent = t; m.style.color = err ? "#ff8088" : "#7CFFB2"; };
    const fileI = ov.querySelector("#igf-ep-file");
    ov.querySelector("#igf-ep-up").onclick = function () { fileI.click(); };
    fileI.onchange = async function () {
      const f = fileI.files && fileI.files[0]; if (!f) return;
      msg("Uploading…"); ov.querySelector("#igf-ep-up").disabled = true;
      try { const url = await uploadAvatar(f); pending.avatar_url = url; pending.avatar_emoji = ""; ov.querySelector("#igf-ep-av").innerHTML = avatarHTML({ user_key: myKey, name: myName, avatar_url: url }, 60); msg("Image ready — tap Save."); }
      catch (e) { msg(e.message || "Upload failed.", true); }
      ov.querySelector("#igf-ep-up").disabled = false;
    };
    ov.querySelector("#igf-ep-cancel").onclick = function () { ov.remove(); };
    ov.querySelector("#igf-ep-save").onclick = async function () {
      const bio = ov.querySelector("#igf-ep-bio").value.slice(0, 160);
      msg("Saving…"); ov.querySelector("#igf-ep-save").disabled = true;
      const ok = await saveMyProfile({ bio: bio, avatar_emoji: pending.avatar_emoji, avatar_url: pending.avatar_url });
      if (ok) { toast("✅ Profile saved!"); ov.remove(); } else { msg("Couldn't save — try again.", true); ov.querySelector("#igf-ep-save").disabled = false; }
    };
  }

  /* ================= chat shared helpers (zoom · typing · pause · bubbles) ================= */
  function fmtTime(iso) { try { const d = new Date(iso); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }
  let _chatOv = null, _chatOpts = null, _pausedByChat = false;
  function grpAvatar(g) { return { user_key: "g" + g.id, name: g.name, avatar_url: g.avatar_url || "", avatar_emoji: g.avatar_emoji || "👥" }; }
  function openAvatarZoom(p, name) {
    injectCSS();
    const ov = document.createElement("div"); ov.className = "igf-zoom";
    let inner;
    if (p && p.avatar_url) inner = '<img src="' + esc(p.avatar_url) + '" alt="">';
    else { const k = (p && (p.user_key || p.key)) || nameKey(p && p.name); const emo = (p && p.avatar_emoji) || baseEmoji(k); inner = '<div class="ze">' + esc(emo) + '</div>'; }
    ov.innerHTML = inner + '<div class="zn">' + esc(name || (p && p.name) || "") + '</div>';
    ov.onclick = function () { ov.remove(); };
    document.body.appendChild(ov);
  }
  function makeTypingChannel(topic, onEvent) {
    let ch = null, stopT = null;
    ensureSb().then(function (s) { if (!s) return; try {
      ch = s.channel(topic, { config: { broadcast: { self: false } } });
      ch.on("broadcast", { event: "typing" }, function (p) { const d = (p && p.payload) || {}; onEvent(d.typing ? (d.name || "Someone") : null); });
      ch.subscribe();
    } catch (e) {} });
    function send(t) { if (!ch) return; try { ch.send({ type: "broadcast", event: "typing", payload: { typing: t, name: myName, key: myKey } }); } catch (e) {} }
    return {
      typing: function () { send(true); if (stopT) clearTimeout(stopT); stopT = setTimeout(function () { send(false); }, 1500); },
      stop: function () { if (stopT) clearTimeout(stopT); send(false); },
      close: function () { try { if (stopT) clearTimeout(stopT); send(false); if (ch) ensureSb().then(function (s) { try { s.removeChannel(ch); } catch (e) {} }); } catch (e) {} }
    };
  }
  function showResumeOverlay() {
    if (!inGame() || !_pauser) { if (_pauser) _pauser.resume(); return; }
    if (document.getElementById("igf-resume")) { _pauser.resume(); return; }
    const o = document.createElement("div"); o.id = "igf-resume"; o.className = "igf-resume";
    o.innerHTML = '<div class="rb2">⏸ Game paused</div><div style="color:#9fb3d8;font-size:14px;max-width:280px;text-align:center">You were chatting — your game is frozen and waiting. Tap to jump back in.</div><button>▶ Resume game</button>';
    document.body.appendChild(o);
    o.querySelector("button").onclick = function () { if (_pauser) _pauser.resume(); o.remove(); };
  }
  function renderBubble(box, m, opts) {
    opts = opts || {};
    const me = m.from_key === myKey;
    const div = document.createElement("div"); div.className = "igf-bub " + (me ? "me" : "them");
    let h = "";
    if (opts.group && !me) h += '<div class="igf-sender">' + esc(m.from_name) + "</div>";
    if (m.reply_body) h += '<div class="igf-quote"><b>' + esc(m.reply_name || "") + "</b>" + esc(mediaPreview(m.reply_body)) + "</div>";
    const pm = parseMedia(m.body);
    if (pm.type === "img") h += '<img class="igf-cimg" src="' + esc(pm.url) + '" alt="photo" loading="lazy">';
    else if (pm.type === "aud") h += '<span class="igf-aud"><audio controls preload="none" src="' + esc(pm.url) + '"></audio><small class="d">🎤 ' + (pm.dur ? esc(pm.dur) + "s" : "voice") + "</small></span>";
    else h += '<span class="bd">' + esc(m.body) + "</span>";
    h += "<small>" + fmtTime(m.created_at || new Date().toISOString()) + "</small>";
    if (opts.onReply) h += '<span class="rt" title="Reply">↩</span>';
    div.innerHTML = h;
    if (pm.type === "img") { const im = div.querySelector(".igf-cimg"); if (im) im.onclick = function () { openAvatarZoom({ avatar_url: pm.url }, ""); }; }
    if (opts.onReply) { const rt = div.querySelector(".rt"); if (rt) rt.onclick = function (e) { e.stopPropagation(); opts.onReply(m); }; }
    box.appendChild(div); box.scrollTop = box.scrollHeight;
    return div;
  }
  function appendChatBubble(m) { showOpenBubble(m); }

  /* ---- resilient open-chat delivery ----
     Realtime channels can silently drop (phone sleep, network blip, idle timeout) with no
     reconnect — after which the open chat just stops receiving. To guarantee messages ALWAYS
     arrive, the currently-open chat (direct or group) is also polled every few seconds and any
     unseen messages are appended, de-duplicated by id so realtime + poll never double-render. */
  let _openChat = null;         // {kind:'direct'|'group', key, groupId, box, opts, shownIds:Set, lastTs}
  let _openPollT = null;
  function registerShown(m) { if (!_openChat || !m) return; if (m.id != null) _openChat.shownIds.add(m.id); const t = m.created_at; if (t && (!_openChat.lastTs || t > _openChat.lastTs)) _openChat.lastTs = t; }
  function showOpenBubble(m) {
    if (!_openChat || !m) return null;
    if (m.id != null && _openChat.shownIds.has(m.id)) return null;   // already displayed
    const box = _openChat.box; if (!box || !document.body.contains(box)) return null;
    if (box.querySelector(".s")) box.innerHTML = "";                 // clear "no messages yet" placeholder
    const d = renderBubble(box, m, _openChat.opts); registerShown(m); return d;
  }
  function setOpenChat(ctx, initialMsgs) { _openChat = ctx; ctx.shownIds = new Set(); ctx.lastTs = ""; (initialMsgs || []).forEach(registerShown); startOpenPoll(); }
  function clearOpenChat() { _openChat = null; stopOpenPoll(); }
  function startOpenPoll() { stopOpenPoll(); _openPollT = setInterval(pollOpenChat, 2500); }
  function stopOpenPoll() { if (_openPollT) { clearInterval(_openPollT); _openPollT = null; } }
  // fetch the most RECENT window of the open thread. We de-dup by shown id (not a timestamp
  // high-water mark) — otherwise a newer message delivered by realtime would advance the cursor
  // past our own still-unshown earlier messages and they'd be skipped forever.
  async function fetchRecent(oc) {
    const s = await ensureSb(); if (!s) return [];
    const tbl = oc.kind === "direct" ? "ig_chat" : "ig_group_msg";
    const eqCol = oc.kind === "direct" ? "pair_key" : "group_id";
    const eqVal = oc.kind === "direct" ? pairKey(myKey, oc.key) : oc.groupId;
    const full = "id,from_key,from_name,body,created_at,reply_to,reply_name,reply_body";
    try {
      const r = await s.from(tbl).select(full).eq(eqCol, eqVal).order("created_at", { ascending: false }).limit(200);
      if (!r.error && r.data) return r.data.slice().reverse();
      const r2 = await s.from(tbl).select("id,from_key,from_name,body,created_at").eq(eqCol, eqVal).order("created_at", { ascending: false }).limit(200);
      if (!r2.error && r2.data) return r2.data.slice().reverse();
    } catch (e) {}
    return [];
  }
  async function pollOpenChat() {
    const oc = _openChat;
    if (!oc || !oc.box || !document.body.contains(oc.box)) { if (oc) clearOpenChat(); return; }
    const rows = await fetchRecent(oc);
    if (_openChat !== oc) return;                                    // chat changed while awaiting
    let appended = false;
    rows.forEach(function (m) { if (showOpenBubble(m)) appended = true; });
    if (appended) { if (oc.kind === "direct") markRead(oc.key); else markGroupRead(oc.groupId); }
  }

  /* ================= 1:1 chat modal ================= */
  async function openChat(key, name) {
    if (_chatBlocked) { toast("Chat is paused during a live match."); return; }
    injectCSS();
    _chatOpenWith = key;
    let reply = null;
    const ov = document.createElement("div"); ov.className = "igf-ov"; _chatOv = ov;
    ov.innerHTML = '<div class="igf-box"><h2 style="cursor:pointer" id="igf-chat-hd">💬 ' + esc(name) + '</h2>'
      + '<div class="igf-chat"><div class="igf-msgs" id="igf-msgs">Loading…</div>'
      + '<div class="igf-typing" id="igf-typing"></div><div id="igf-replybar-wrap"></div>'
      + '<div id="igf-chat-warn" style="font-size:12px;color:#ffd27a;min-height:0"></div>'
      + '<div class="igf-cin"><button class="igf-att" id="igf-photo" title="Send a photo">📷</button><button class="igf-att" id="igf-mic" title="Voice message">🎤</button><input id="igf-cin" maxlength="400" placeholder="Message…" autocomplete="off"><button class="igf-btn igf-p" id="igf-csend">Send</button></div></div>'
      + '<button class="igf-x" id="igf-chat-close">Close</button></div>';
    document.body.appendChild(ov);
    armPause();
    let typingHideT = null;
    const typer = makeTypingChannel("typ-" + pairKey(myKey, key), function (who) {
      const t = ov.querySelector("#igf-typing"); if (!t) return;
      if (who) { t.textContent = who + " is typing…"; if (typingHideT) clearTimeout(typingHideT); typingHideT = setTimeout(function () { t.textContent = ""; }, 3000); } else t.textContent = "";
    });
    function closeChat() { if (ov.__stopRec) ov.__stopRec(); clearOpenChat(); _chatOpenWith = null; _chatOv = null; _chatOpts = null; try { typer.close(); } catch (e) {} ov.remove(); disarmPause(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) closeChat(); });
    ov.querySelector("#igf-chat-close").onclick = closeChat;
    ov.querySelector("#igf-chat-hd").onclick = function () { closeChat(); openProfile(name, key); };
    function setReply(m) { reply = { id: m.id, name: (m.from_key === myKey ? "You" : m.from_name), body: m.body }; showReplyBar(); ov.querySelector("#igf-cin").focus(); }
    function clearReply() { reply = null; showReplyBar(); }
    function showReplyBar() { const w = ov.querySelector("#igf-replybar-wrap"); if (!reply) { w.innerHTML = ""; return; } w.innerHTML = '<div class="igf-replybar"><span class="rb">Replying to <b>' + esc(reply.name) + "</b>: " + esc(reply.body) + '</span><span class="rx" id="igf-rx">✕</span></div>'; w.querySelector("#igf-rx").onclick = clearReply; }
    _chatOpts = { onReply: setReply };
    const box = ov.querySelector("#igf-msgs");
    const thread = await loadThread(key);
    if (!thread.length) box.innerHTML = '<div class="s" style="margin:auto;text-align:center">No messages yet — say hi! 👋</div>';
    else { box.innerHTML = ""; thread.forEach(function (m) { renderBubble(box, m, _chatOpts); }); }
    box.scrollTop = box.scrollHeight;
    setOpenChat({ kind: "direct", key: key, box: box, opts: _chatOpts }, thread);
    markRead(key);
    if (_myProfile && _myProfile.chat_muted) { ov.querySelector("#igf-cin").disabled = true; ov.querySelector("#igf-csend").disabled = true; ov.querySelector("#igf-chat-warn").textContent = "🚫 Your chat is disabled due to repeated bad language."; }
    const inp = ov.querySelector("#igf-cin"), snd = ov.querySelector("#igf-csend");
    async function doSend() {
      const v = inp.value.trim(); if (!v) return; snd.disabled = true;
      const r = await sendChat(key, name, v, reply);
      if (r.ok) { inp.value = ""; clearReply(); renderBubble(box, r.row, _chatOpts); registerShown(r.row); if (r.warn) ov.querySelector("#igf-chat-warn").textContent = r.warn; try { typer.stop(); } catch (e) {} }
      else { ov.querySelector("#igf-chat-warn").textContent = r.msg || ""; if (r.blocked) inp.disabled = true; }
      snd.disabled = false; inp.focus();
    }
    snd.onclick = doSend;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") doSend(); });
    inp.addEventListener("input", function () { try { typer.typing(); } catch (e) {} });
    wireAttachments(ov, async function (body) { const r = await sendChat(key, name, body, null); if (r.ok) { renderBubble(box, r.row, _chatOpts); registerShown(r.row); } else if (r.msg) ov.querySelector("#igf-chat-warn").textContent = r.msg; }, !!(_myProfile && _myProfile.chat_muted));
    inp.focus();
  }

  /* ================= group chat modal ================= */
  async function openGroupChat(groupId) {
    if (_chatBlocked) { toast("Chat is paused during a live match."); return; }
    injectCSS();
    if (!_groups.some(function (x) { return x.id === groupId; })) await loadGroups();
    const grp = _groups.find(function (x) { return x.id === groupId; }) || { id: groupId, name: "Group" };
    let reply = null;
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2 style="cursor:pointer" id="igf-g-hd">' + avatarHTML(grpAvatar(grp), 28) + '<span>' + esc(grp.name) + '</span><small style="font-size:12px;color:#8aa0c6;font-weight:400">ⓘ info</small></h2>'
      + '<div class="igf-chat"><div class="igf-msgs" id="igf-msgs">Loading…</div>'
      + '<div class="igf-typing" id="igf-typing"></div><div id="igf-replybar-wrap"></div>'
      + '<div id="igf-chat-warn" style="font-size:12px;color:#ffd27a;min-height:0"></div>'
      + '<div class="igf-cin"><button class="igf-att" id="igf-photo" title="Send a photo">📷</button><button class="igf-att" id="igf-mic" title="Voice message">🎤</button><input id="igf-cin" maxlength="400" placeholder="Message the group…" autocomplete="off"><button class="igf-btn igf-p" id="igf-csend">Send</button></div></div>'
      + '<button class="igf-x" id="igf-g-close">Close</button></div>';
    document.body.appendChild(ov);
    armPause();
    const opts = { group: true, onReply: setReply };
    const box = ov.querySelector("#igf-msgs");
    let sub = null;
    ensureSb().then(function (s) { if (!s) return; try {
      sub = s.channel("gmsg-" + groupId);
      sub.on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_group_msg", filter: "group_id=eq." + groupId }, function (p) { const m = p && p.new; if (!m || m.from_key === myKey) return; if (showOpenBubble(m)) markGroupRead(groupId); });
      sub.subscribe();
    } catch (e) {} });
    let typingHideT = null;
    const typer = makeTypingChannel("gtyp-" + groupId, function (who) { const t = ov.querySelector("#igf-typing"); if (!t) return; if (who) { t.textContent = who + " is typing…"; if (typingHideT) clearTimeout(typingHideT); typingHideT = setTimeout(function () { t.textContent = ""; }, 3000); } else t.textContent = ""; });
    function close() { if (ov.__stopRec) ov.__stopRec(); clearOpenChat(); try { typer.close(); } catch (e) {} try { if (sub) ensureSb().then(function (s) { try { s.removeChannel(sub); } catch (e) {} }); } catch (e) {} ov.remove(); disarmPause(); }
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector("#igf-g-close").onclick = close;
    ov.querySelector("#igf-g-hd").onclick = function () { close(); openGroupInfo(groupId); };
    function setReply(m) { reply = { id: m.id, name: (m.from_key === myKey ? "You" : m.from_name), body: m.body }; showReplyBar(); ov.querySelector("#igf-cin").focus(); }
    function clearReply() { reply = null; showReplyBar(); }
    function showReplyBar() { const w = ov.querySelector("#igf-replybar-wrap"); if (!reply) { w.innerHTML = ""; return; } w.innerHTML = '<div class="igf-replybar"><span class="rb">Replying to <b>' + esc(reply.name) + "</b>: " + esc(reply.body) + '</span><span class="rx" id="igf-rx">✕</span></div>'; w.querySelector("#igf-rx").onclick = clearReply; }
    const msgs = await loadGroupMsgs(groupId);
    if (!msgs.length) box.innerHTML = '<div class="s" style="margin:auto;text-align:center">No messages yet — start the conversation! 👋</div>';
    else { box.innerHTML = ""; msgs.forEach(function (m) { renderBubble(box, m, opts); }); }
    box.scrollTop = box.scrollHeight;
    setOpenChat({ kind: "group", groupId: groupId, box: box, opts: opts }, msgs);
    markGroupRead(groupId);
    if (_myProfile && _myProfile.chat_muted) { ov.querySelector("#igf-cin").disabled = true; ov.querySelector("#igf-csend").disabled = true; ov.querySelector("#igf-chat-warn").textContent = "🚫 Your chat is disabled due to repeated bad language."; }
    const inp = ov.querySelector("#igf-cin"), snd = ov.querySelector("#igf-csend");
    async function doSend() {
      const v = inp.value.trim(); if (!v) return; snd.disabled = true;
      const r = await sendGroupMsg(groupId, v, reply);
      if (r.ok) { inp.value = ""; clearReply(); renderBubble(box, r.row, opts); registerShown(r.row); if (r.warn) ov.querySelector("#igf-chat-warn").textContent = r.warn; try { typer.stop(); } catch (e) {} }
      else { ov.querySelector("#igf-chat-warn").textContent = r.msg || ""; if (r.blocked) inp.disabled = true; }
      snd.disabled = false; inp.focus();
    }
    snd.onclick = doSend;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") doSend(); });
    inp.addEventListener("input", function () { try { typer.typing(); } catch (e) {} });
    wireAttachments(ov, async function (body) { const r = await sendGroupMsg(groupId, body, null); if (r.ok) { renderBubble(box, r.row, opts); registerShown(r.row); } else if (r.msg) ov.querySelector("#igf-chat-warn").textContent = r.msg; }, !!(_myProfile && _myProfile.chat_muted));
    inp.focus();
  }

  /* ================= group info / admin ================= */
  async function openGroupInfo(groupId) {
    injectCSS();
    const grp = _groups.find(function (x) { return x.id === groupId; }) || { id: groupId, name: "Group" };
    const iAmOwner = grp.owner_key === myKey;
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><div id="igf-gi">Loading…</div><button class="igf-x" id="igf-gi-close">Close</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector("#igf-gi-close").onclick = function () { ov.remove(); };
    async function render() {
      const members = await groupMembers(groupId);
      const memKeys = members.map(function (m) { return m.user_key; });
      if (memKeys.length) await fetchProfiles(memKeys);
      members.sort(function (a, b) { return (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1); });
      let h = '<div style="text-align:center;margin-bottom:10px"><span class="igf-clickav" id="igf-gi-av">' + avatarHTML(grpAvatar(grp), 72) + '</span><div class="nm" style="font-size:20px;font-weight:900;margin-top:6px">' + esc(grp.name) + '</div><div class="s">' + members.length + " member" + (members.length !== 1 ? "s" : "") + "</div></div>";
      if (iAmOwner) h += '<button class="igf-btn igf-g" id="igf-gi-edit" style="width:100%;margin-bottom:6px">✏️ Edit group name & picture</button>';
      h += '<div class="igf-sec">Members</div>';
      members.forEach(function (m) { const p = _profiles[m.user_key] || { user_key: m.user_key, name: m.name };
        const canRemove = iAmOwner && m.user_key !== myKey;
        h += '<div class="igf-row">' + avatarHTML(p, 34) + '<span class="n tapp" data-k="' + esc(m.user_key) + '" data-n="' + esc(m.name) + '" style="cursor:pointer">' + esc(m.name) + (m.role === "owner" ? ' <small>👑 admin</small>' : "") + "</span>" + (canRemove ? '<button class="igf-btn igf-d" data-rm="' + esc(m.user_key) + '">Remove</button>' : "") + "</div>";
      });
      if (iAmOwner) h += '<button class="igf-btn igf-b" id="igf-gi-add" style="width:100%;margin-top:8px">➕ Add friends</button>';
      h += '<button class="igf-btn igf-d" id="igf-gi-leave" style="width:100%;margin-top:10px">🚪 Leave group</button>';
      const b = ov.querySelector("#igf-gi"); b.innerHTML = h;
      b.querySelector("#igf-gi-av").onclick = function () { openAvatarZoom(grpAvatar(grp), grp.name); };
      if (b.querySelector("#igf-gi-edit")) b.querySelector("#igf-gi-edit").onclick = function () { ov.remove(); openEditGroup(groupId); };
      if (b.querySelector("#igf-gi-add")) b.querySelector("#igf-gi-add").onclick = function () { ov.remove(); openAddMembers(groupId, memKeys); };
      b.querySelector("#igf-gi-leave").onclick = function () { if (confirm("Leave " + grp.name + "?")) { leaveGroup(groupId); ov.remove(); } };
      b.querySelectorAll("[data-rm]").forEach(function (btn) { btn.onclick = function () { if (confirm("Remove this member?")) removeGroupMember(groupId, btn.getAttribute("data-rm")).then(render); }; });
      b.querySelectorAll(".tapp").forEach(function (el) { el.onclick = function () { openProfile(el.getAttribute("data-n"), el.getAttribute("data-k")); }; });
    }
    render();
  }
  async function openEditGroup(groupId) {
    injectCSS(); const grp = _groups.find(function (x) { return x.id === groupId; }) || { id: groupId, name: "Group" };
    let pending = { avatar_emoji: grp.avatar_emoji || "", avatar_url: grp.avatar_url || "" };
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2>✏️ Edit group</h2>'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><span id="igf-eg-av">' + avatarHTML(grpAvatar(grp), 60) + '</span><div style="flex:1"><button class="igf-btn igf-b" id="igf-eg-up" style="width:100%">📷 Upload picture</button><input type="file" accept="image/*" id="igf-eg-file" style="display:none"></div></div>'
      + '<div class="s">Or pick an emoji:</div><div class="igf-emopick" id="igf-eg-emo"></div>'
      + '<div class="igf-sec">Group name</div><input id="igf-eg-name" maxlength="40" value="' + esc(grp.name) + '" style="width:100%;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:10px 12px;border-radius:10px;font-size:15px">'
      + '<div id="igf-eg-msg" style="font-size:13px;min-height:16px;margin:6px 0;color:#9fb3d8"></div>'
      + '<button class="igf-btn igf-p" id="igf-eg-save" style="width:100%">Save</button><button class="igf-x" id="igf-eg-cancel">Cancel</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    const emo = ov.querySelector("#igf-eg-emo"); emo.innerHTML = ["👥", "🎮", "🔥", "⭐", "🏆", "🚀", "🐱", "🦊", "🐼", "🦁", "🐉", "🌈", "⚽", "🏏", "🎯", "💎", "👑", "😎"].map(function (e) { return '<button data-e="' + e + '">' + e + "</button>"; }).join("");
    emo.querySelectorAll("button").forEach(function (bt) { bt.onclick = function () { pending.avatar_emoji = bt.getAttribute("data-e"); pending.avatar_url = ""; ov.querySelector("#igf-eg-av").innerHTML = avatarHTML({ user_key: "g" + groupId, name: grp.name, avatar_emoji: pending.avatar_emoji }, 60); }; });
    const msg = function (t, err) { const m = ov.querySelector("#igf-eg-msg"); m.textContent = t; m.style.color = err ? "#ff8088" : "#7CFFB2"; };
    const fileI = ov.querySelector("#igf-eg-file");
    ov.querySelector("#igf-eg-up").onclick = function () { fileI.click(); };
    fileI.onchange = async function () { const f = fileI.files && fileI.files[0]; if (!f) return; msg("Uploading…"); ov.querySelector("#igf-eg-up").disabled = true;
      try { const url = await uploadAvatar(f, "group_" + groupId); pending.avatar_url = url; pending.avatar_emoji = ""; ov.querySelector("#igf-eg-av").innerHTML = avatarHTML({ user_key: "g" + groupId, name: grp.name, avatar_url: url }, 60); msg("Picture ready — tap Save."); }
      catch (e) { msg(e.message || "Upload failed.", true); }
      ov.querySelector("#igf-eg-up").disabled = false; };
    ov.querySelector("#igf-eg-cancel").onclick = function () { ov.remove(); };
    ov.querySelector("#igf-eg-save").onclick = async function () { const name = ov.querySelector("#igf-eg-name").value.trim().slice(0, 40) || grp.name; msg("Saving…"); ov.querySelector("#igf-eg-save").disabled = true;
      const ok = await saveGroupMeta(groupId, { name: name, avatar_emoji: pending.avatar_emoji, avatar_url: pending.avatar_url });
      if (ok) { toast("✅ Group updated!"); ov.remove(); } else { msg("Couldn't save — try again.", true); ov.querySelector("#igf-eg-save").disabled = false; } };
  }
  async function openAddMembers(groupId, existingKeys) {
    injectCSS(); const avail = _friends.filter(function (f) { return existingKeys.indexOf(f.key) < 0; });
    const ov = document.createElement("div"); ov.className = "igf-ov"; let picked = {};
    ov.innerHTML = '<div class="igf-box"><h2>➕ Add friends</h2><div class="s">Tap friends to add them to the group.</div><div id="igf-am-list"></div><div id="igf-am-msg" style="font-size:13px;min-height:16px;color:#9fb3d8"></div><button class="igf-btn igf-p" id="igf-am-add" style="width:100%">Add selected</button><button class="igf-x" id="igf-am-cancel">Cancel</button></div>';
    document.body.appendChild(ov); ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    const list = ov.querySelector("#igf-am-list");
    if (!avail.length) list.innerHTML = '<div class="s">All your friends are already in this group.</div>';
    else { if (avail.length) await fetchProfiles(avail.map(function (f) { return f.key; }));
      list.innerHTML = avail.map(function (f) { const p = _profiles[f.key] || { user_key: f.key, name: f.name }; return '<div class="igf-pick" data-k="' + esc(f.key) + '" data-n="' + esc(f.name) + '"><span class="ck"></span>' + avatarHTML(p, 32) + '<span class="n" style="flex:1;text-align:left">' + esc(f.name) + "</span></div>"; }).join("");
      list.querySelectorAll(".igf-pick").forEach(function (el) { el.onclick = function () { const k = el.getAttribute("data-k"); if (picked[k]) { delete picked[k]; el.classList.remove("on"); el.querySelector(".ck").textContent = ""; } else { picked[k] = el.getAttribute("data-n"); el.classList.add("on"); el.querySelector(".ck").textContent = "✓"; } }; });
    }
    ov.querySelector("#igf-am-cancel").onclick = function () { ov.remove(); };
    ov.querySelector("#igf-am-add").onclick = async function () { const keys = Object.keys(picked); if (!keys.length) { ov.querySelector("#igf-am-msg").textContent = "Pick at least one friend."; return; } ov.querySelector("#igf-am-add").disabled = true;
      for (const k of keys) { await addGroupMember(groupId, k, picked[k]); }
      toast("✅ Added " + keys.length + " to the group."); ov.remove(); await loadGroups(); openGroupInfo(groupId); };
  }
  async function openCreateGroup() {
    injectCSS();
    const ov = document.createElement("div"); ov.className = "igf-ov"; let picked = {}, avatar = { emoji: "👥", url: "" };
    ov.innerHTML = '<div class="igf-box"><h2>👥 New group</h2>'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><span id="igf-cg-av">' + avatarHTML({ user_key: "gnew", name: "g", avatar_emoji: "👥" }, 52) + '</span><input id="igf-cg-name" maxlength="40" placeholder="Group name" style="flex:1;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:11px 12px;border-radius:10px;font-size:15px"></div>'
      + '<div style="display:flex;gap:6px;margin-bottom:6px"><button class="igf-btn igf-b" id="igf-cg-up" style="flex:1">📷 Picture</button><input type="file" accept="image/*" id="igf-cg-file" style="display:none"></div>'
      + '<div class="igf-emopick" id="igf-cg-emo"></div>'
      + '<div class="igf-sec">Add friends</div><div id="igf-cg-list"></div>'
      + '<div id="igf-cg-msg" style="font-size:13px;min-height:16px;color:#9fb3d8"></div>'
      + '<button class="igf-btn igf-p" id="igf-cg-create" style="width:100%">Create group</button><button class="igf-x" id="igf-cg-cancel">Cancel</button></div>';
    document.body.appendChild(ov); ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    const emo = ov.querySelector("#igf-cg-emo"); emo.innerHTML = ["👥", "🎮", "🔥", "⭐", "🏆", "🚀", "🐱", "🦊", "🐼", "🦁", "🐉", "🌈", "⚽", "🏏", "🎯", "💎"].map(function (e) { return '<button data-e="' + e + '">' + e + "</button>"; }).join("");
    emo.querySelectorAll("button").forEach(function (bt) { bt.onclick = function () { avatar = { emoji: bt.getAttribute("data-e"), url: "" }; ov.querySelector("#igf-cg-av").innerHTML = avatarHTML({ user_key: "gnew", name: "g", avatar_emoji: avatar.emoji }, 52); }; });
    const fileI = ov.querySelector("#igf-cg-file"); const msg = function (t, err) { const m = ov.querySelector("#igf-cg-msg"); m.textContent = t; m.style.color = err ? "#ff8088" : "#7CFFB2"; };
    ov.querySelector("#igf-cg-up").onclick = function () { fileI.click(); };
    fileI.onchange = async function () { const f = fileI.files && fileI.files[0]; if (!f) return; msg("Uploading…"); try { const url = await uploadAvatar(f, "group_new"); avatar = { emoji: "", url: url }; ov.querySelector("#igf-cg-av").innerHTML = avatarHTML({ user_key: "gnew", name: "g", avatar_url: url }, 52); msg(""); } catch (e) { msg(e.message || "Upload failed.", true); } };
    const list = ov.querySelector("#igf-cg-list");
    if (!_friends.length) list.innerHTML = '<div class="s">You have no friends yet to add — add some first!</div>';
    else { await fetchProfiles(_friends.map(function (f) { return f.key; }));
      list.innerHTML = _friends.map(function (f) { const p = _profiles[f.key] || { user_key: f.key, name: f.name }; return '<div class="igf-pick" data-k="' + esc(f.key) + '" data-n="' + esc(f.name) + '"><span class="ck"></span>' + avatarHTML(p, 32) + '<span class="n" style="flex:1;text-align:left">' + esc(f.name) + "</span></div>"; }).join("");
      list.querySelectorAll(".igf-pick").forEach(function (el) { el.onclick = function () { const k = el.getAttribute("data-k"); if (picked[k]) { delete picked[k]; el.classList.remove("on"); el.querySelector(".ck").textContent = ""; } else { picked[k] = el.getAttribute("data-n"); el.classList.add("on"); el.querySelector(".ck").textContent = "✓"; } }; });
    }
    ov.querySelector("#igf-cg-cancel").onclick = function () { ov.remove(); };
    ov.querySelector("#igf-cg-create").onclick = async function () { const name = ov.querySelector("#igf-cg-name").value.trim(); if (!name) { msg("Enter a group name.", true); return; } const keys = Object.keys(picked), names = keys.map(function (k) { return picked[k]; });
      ov.querySelector("#igf-cg-create").disabled = true; msg("Creating…");
      const r = await createGroup(name, keys, names, avatar);
      if (r.ok) { toast("✅ Group created!"); ov.remove(); openGroupChat(r.id); } else { msg(r.msg || "Couldn't create.", true); ov.querySelector("#igf-cg-create").disabled = false; } };
  }

  /* ================= friends panel (with search) ================= */
  async function searchPlayers(q) {
    const s = await ensureSb(); if (!s) return [];
    const names = {};
    try { const r = await s.from("ig_profile").select("name").ilike("name", "%" + q + "%").limit(30); if (!r.error && r.data) r.data.forEach(function (x) { names[nameKey(x.name)] = x.name; }); } catch (e) {}
    try { const r = await s.from("leaderboard").select("name").ilike("name", "%" + q + "%").limit(60); if (!r.error && r.data) r.data.forEach(function (x) { names[nameKey(x.name)] = x.name; }); } catch (e) {}
    // also fuzzy over online players (presence) so typos still find them
    for (const k in presState) { const v = presState[k]; if (v && v.length && v[0].name) names[k] = v[0].name; }
    const ranked = igMatchNames(q, Object.values(names)).filter(function (m) { return nameKey(m.name) !== myKey; });
    const keys = ranked.slice(0, 12).map(function (m) { return nameKey(m.name); });
    if (keys.length) await fetchProfiles(keys);
    return ranked.slice(0, 12);
  }
  function openPanel() {
    injectCSS(); dbLoad(); loadUnread(); loadGroups();
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2>👥 Friends</h2><div class="s" id="igf-me"></div>'
      + '<div class="igf-add"><input id="igf-name" maxlength="16" placeholder="Search players by name…" autocomplete="off"><button class="igf-btn igf-p" id="igf-send">Add</button></div>'
      + '<div id="igf-results"></div><div id="igf-body"></div><button class="igf-x" id="igf-close">Close</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector("#igf-close").onclick = function () { ov.remove(); };
    const nameI = ov.querySelector("#igf-name"), sendB = ov.querySelector("#igf-send"), results = ov.querySelector("#igf-results");
    sendB.onclick = function () { const val = nameI.value; sendB.disabled = true; sendB.textContent = "…";
      Promise.resolve(sendRequest(val)).then(function (r) { toast(r.msg); if (r.ok) { nameI.value = ""; results.innerHTML = ""; render(); } sendB.disabled = false; sendB.textContent = "Add"; }); };
    nameI.addEventListener("keydown", function (e) { if (e.key === "Enter") sendB.click(); });
    let searchT = null;
    nameI.addEventListener("input", function () {
      const q = nameI.value.trim(); if (searchT) clearTimeout(searchT);
      if (q.length < 2) { results.innerHTML = ""; return; }
      searchT = setTimeout(function () { searchPlayers(q).then(function (list) {
        if (nameI.value.trim() !== q) return;
        if (!list.length) { results.innerHTML = '<div class="s" style="padding:4px 0">No players found for “' + esc(q) + '”.</div>'; return; }
        results.innerHTML = '<div class="igf-sec">Search results</div>' + list.map(function (m) { const k = nameKey(m.name); const p = _profiles[k] || { user_key: k, name: m.name };
          const rel = isFriend(m.name) ? "Friend" : (_out.some(function (o) { return o.key === k; }) ? "Pending" : "");
          return '<div class="igf-row tap" data-open="' + esc(m.name) + '" data-k="' + esc(k) + '">' + avatarHTML(p, 36) + '<span class="n">' + esc(m.name) + (rel ? '<small>' + rel + "</small>" : "") + '</span><span style="color:#7dc4ff">View ›</span></div>'; }).join("");
        results.querySelectorAll("[data-open]").forEach(function (el) { el.onclick = function () { openProfile(el.getAttribute("data-open"), el.getAttribute("data-k")); }; });
      }); }, 240);
    });
    function render() {
      const me = _myProfile || { user_key: myKey, name: myName };
      ov.querySelector("#igf-me").innerHTML = '<span class="igf-row tap" style="display:inline-flex" data-me="1">' + avatarHTML(me, 30) + '<span class="n" style="margin-left:8px">' + esc(myName || "(no name)") + '<small>Tap to view your profile</small></span></span>';
      const meEl = ov.querySelector('[data-me]'); if (meEl) meEl.onclick = function () { openProfile(myName, myKey); };
      let h = "";
      if (_in.length) { h += '<div class="igf-sec">Requests for you</div>';
        _in.forEach(function (r) { const p = _profiles[r.key] || { user_key: r.key, name: r.name };
          h += '<div class="igf-row">' + avatarHTML(p, 36) + '<span class="n tapn" data-open="' + esc(r.name) + '" data-k="' + esc(r.key) + '" style="cursor:pointer">' + esc(r.name) + '</span><button class="igf-btn igf-p" data-acc="' + esc(r.name) + '" data-k="' + esc(r.key) + '">Accept</button><button class="igf-btn igf-d" data-den="' + esc(r.name) + '" data-k="' + esc(r.key) + '">✕</button></div>'; }); }
      h += '<div class="igf-sec">Your friends (' + _friends.length + ")</div>";
      if (!_friends.length) h += '<div class="s">No friends yet — search above to add someone!</div>';
      _friends.forEach(function (f) { const pr = presenceOfKey(f.key); const p = _profiles[f.key] || { user_key: f.key, name: f.name };
        const sub = pr.online ? (pr.game === "home" ? "Online • in the menu" : "Online • playing " + gname(pr.game)) : "Offline";
        const u = _unread[f.key] ? '<span style="background:#ff3b5c;color:#fff;border-radius:9px;padding:1px 7px;font-size:12px;font-weight:800;margin-right:4px">' + _unread[f.key].count + "</span>" : "";
        h += '<div class="igf-row tap" data-open="' + esc(f.name) + '" data-k="' + esc(f.key) + '"><span class="igf-dot ' + (pr.online ? "on" : "off") + '"></span>' + avatarHTML(p, 36) + '<span class="n">' + esc(f.name) + "<small>" + sub + "</small></span>" + u + '<button class="igf-btn igf-p" data-chat="' + esc(f.name) + '" data-k="' + esc(f.key) + '">💬</button></div>'; });
      h += '<div class="igf-sec" style="display:flex;justify-content:space-between;align-items:center">Your groups <button class="igf-btn igf-b" id="igf-newgroup" style="padding:5px 10px;font-size:12px">➕ New group</button></div>';
      if (!_groups.length) h += '<div class="s">No groups yet — make one to chat with several friends at once.</div>';
      _groups.forEach(function (g) { const c = _groupUnread[g.id]; const u = c ? '<span style="background:#ff3b5c;color:#fff;border-radius:9px;padding:1px 7px;font-size:12px;font-weight:800;margin-right:4px">' + c + "</span>" : "";
        h += '<div class="igf-row tap" data-grp="' + esc(g.id) + '">' + avatarHTML(grpAvatar(g), 36) + '<span class="n">' + esc(g.name) + "<small>" + (g.owner_key === myKey ? "You're the admin 👑" : "Group") + "</small></span>" + u + '<button class="igf-btn igf-p" data-grpc="' + esc(g.id) + '">💬</button></div>'; });
      if (_out.length) { h += '<div class="igf-sec">Sent requests</div>'; _out.forEach(function (r) { h += '<div class="igf-row"><span class="n">' + esc(r.name) + '<small>waiting for them to accept</small></span><span class="igf-btn igf-g" style="opacity:.85;cursor:default">⏳</span></div>'; }); }
      const body = ov.querySelector("#igf-body"); body.innerHTML = h;
      const ng = body.querySelector("#igf-newgroup"); if (ng) ng.onclick = function (e) { e.stopPropagation(); openCreateGroup(); };
      body.querySelectorAll("[data-grp]").forEach(function (b) { b.onclick = function () { openGroupChat(parseInt(b.getAttribute("data-grp"), 10)); }; });
      body.querySelectorAll("[data-grpc]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openGroupChat(parseInt(b.getAttribute("data-grpc"), 10)); }; });
      body.querySelectorAll("[data-acc]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); accept(b.getAttribute("data-acc"), b.getAttribute("data-k")); }; });
      body.querySelectorAll("[data-den]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); deny(b.getAttribute("data-den"), b.getAttribute("data-k")); }; });
      body.querySelectorAll("[data-chat]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openChat(b.getAttribute("data-k"), b.getAttribute("data-chat")); }; });
      body.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { openProfile(b.getAttribute("data-open"), b.getAttribute("data-k")); }; });
      body.querySelectorAll(".tapn[data-open]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openProfile(b.getAttribute("data-open"), b.getAttribute("data-k")); }; });
    }
    render(); onUpdate(function () { if (document.body.contains(ov)) render(); });
  }

  /* ================= "Friends are now working" banner (home only) ================= */
  function maybeBanner() {
    S(function () {
      if (!document.body.hasAttribute("data-arcade-home")) return;
      if (localStorage.getItem("ig_friends_banner_v2") === "1") return;
      const anchor = document.getElementById("uotw") || document.getElementById("feats") || document.body;
      const b = document.createElement("div"); b.className = "igf-banner";
      b.innerHTML = '<span>🎉 <b>Friends & Profiles are now live!</b> Add friends, chat, and set your avatar.</span><span class="x" id="igf-ban-x">✕</span>';
      anchor.parentNode.insertBefore(b, anchor);
      b.querySelector("#igf-ban-x").onclick = function () { b.remove(); S(function () { localStorage.setItem("ig_friends_banner_v2", "1"); }); };
    });
  }

  /* ================= public API ================= */
  window.IGFriends = {
    openPanel: openPanel, openProfile: openProfile, openChat: openChat, openBell: openBell, openInbox: openInbox,
    openGroupChat: openGroupChat, openCreateGroup: openCreateGroup, openAvatarZoom: openAvatarZoom, blockChat: blockChat,
    list: function () { return _friends; }, groups: function () { return _groups; }, isFriend: isFriend, sendRequest: sendRequest,
    accept: accept, deny: deny, unfriend: unfriend, presenceOf: presenceOf,
    onUpdate: onUpdate, reqInCount: function () { return _in.length; }, bellCount: bellCount,
    weeklyInfo: weeklyInfo, isWeekWinner: isWeekWinner, ready: function () { return started; }
  };
  try { if (String(location.search).indexOf("cwtest") >= 0) window.IGFriends._t = { igCountLeading: igCountLeading, leadingHTML: leadingHTML, wireAttachments: wireAttachments, GAME_TITLES: GAME_TITLES, GAME_EMOJI: GAME_EMOJI, HIDDEN_GAMES: HIDDEN_GAMES,
    sendChat: sendChat, sendGroupMsg: sendGroupMsg, loadThread: loadThread, loadGroupMsgs: loadGroupMsgs, openChat: openChat, openGroupChat: openGroupChat,
    myKey: function () { return myKey; }, started: function () { return started; }, openChatInfo: function () { return _openChat ? { kind: _openChat.kind, key: _openChat.key, groupId: _openChat.groupId, shown: _openChat.shownIds.size } : null; } }; } catch (e) {}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
