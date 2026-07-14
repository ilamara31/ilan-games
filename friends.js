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
    "fruit-arena": "Fruit Arena", rescue: "Rescue Bounce", airhockey: "Air Hockey Arena", codebreaker: "Codebreaker", thisorthat: "This or That" };
  // maps used to show a player's scores on their profile (mirrors auth.js)
  const GAME_TITLES = { catch: "Basket Catch", cricket: "Super Over Cricket", f1: "Grand Prix", football: "Penalty Kings",
    try: "One More Try", puzzles: "Puzzle Pad", obby: "Rainbow Obby", "anime-tycoon": "Anime Tycoon",
    tennis: "Tennis Tour", karate: "Karate", rescue: "Rescue Bounce", "fruit-arena": "Fruit Arena", pptour: "Ping Pong Tour",
    paper: "Paper Territory", stack: "Stack Tower", archer: "Archer Duel", airhockey: "Air Hockey Arena" };
  const GAME_METRIC = { catch: "Best score", cricket: "Career runs", f1: "Points", football: "Matches won",
    try: "Best level", puzzles: "Puzzles solved", obby: "Best stage", "anime-tycoon": "Net worth",
    tennis: "Trophies", karate: "Wins", rescue: "Best rescues", "fruit-arena": "Best score", pptour: "Matches won",
    paper: "Territory %", stack: "Tallest stack", archer: "Best level", airhockey: "Matches won" };
  const GAME_EMOJI = { catch: "🧺", cricket: "🏏", f1: "🏎️", football: "⚽", try: "🎯", puzzles: "🧩", obby: "🌈",
    "anime-tycoon": "💴", tennis: "🎾", karate: "🥋", rescue: "🚑", "fruit-arena": "🍉", pptour: "🏓", paper: "🟦",
    stack: "🧱", archer: "🏹", airhockey: "🏒" };
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
  async function uploadAvatar(file) {
    const s = await ensureSb(); if (!s) throw new Error("Not connected — try again.");
    if (!file) throw new Error("No file chosen.");
    if (!/^image\//.test(file.type)) throw new Error("Please choose an image file (JPG, PNG…).");
    if (file.size > 12 * 1024 * 1024) throw new Error("That image is too big (max 12 MB).");
    const blob = await downscale(file, 256);
    const path = myKey + "/" + Date.now() + ".jpg";
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

  /* ================= CHAT ================= */
  function pairKey(a, b) { return [a, b].sort().join("__"); }
  async function loadThread(otherKey) {
    const s = await ensureSb(); if (!s) return [];
    try {
      const r = await s.from("ig_chat").select("id,from_key,from_name,body,created_at,read_at").eq("pair_key", pairKey(myKey, otherKey)).order("created_at", { ascending: true }).limit(200);
      if (!r.error && r.data) return r.data;
    } catch (e) {}
    return [];
  }
  async function markRead(otherKey) {
    const s = await ensureSb(); if (!s) return;
    try { await s.from("ig_chat").update({ read_at: new Date().toISOString() }).eq("to_key", myKey).eq("from_key", otherKey).is("read_at", null); } catch (e) {}
    delete _unread[otherKey]; fire();
  }
  // returns { ok, blocked, warn } ; applies moderation, strikes, mute
  async function sendChat(otherKey, otherName, text) {
    const s = await ensureSb(); if (!s) return { ok: false, msg: "Not connected." };
    text = String(text || "").trim().slice(0, 400); if (!text) return { ok: false };
    if (_myProfile && _myProfile.chat_muted) return { ok: false, blocked: true, msg: "Your chat is disabled for repeated bad language." };
    const mod = igModerate(text);
    let warn = null;
    if (mod.badCount > 0) {
      try {
        const r = await s.rpc("ig_chat_strike", { p_key: myKey, p_name: myName, p_add: mod.badCount, p_limit: CHAT_MUTE_LIMIT });
        const st = r && r.data; if (st) { if (_myProfile) { _myProfile.chat_strikes = st.strikes; _myProfile.chat_muted = st.muted; wr("ig_my_profile", _myProfile); }
          if (st.muted) { fire(); return { ok: false, blocked: true, msg: "🚫 Your chat has been disabled for repeated inappropriate language." }; }
          const left = CHAT_MUTE_LIMIT - st.strikes;
          warn = "⚠️ Please keep it friendly — bad words are hidden. " + (left <= 2 ? "Your chat will be disabled after " + left + " more." : "");
        }
      } catch (e) {}
    }
    try {
      const r = await s.from("ig_chat").insert({ pair_key: pairKey(myKey, otherKey), from_key: myKey, from_name: myName, to_key: otherKey, body: mod.masked });
      if (r.error) return { ok: false, msg: "Message didn't send — try again." };
    } catch (e) { return { ok: false, msg: "Message didn't send — try again." }; }
    return { ok: true, warn: warn, body: mod.masked };
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
  function bellCount() { return _in.length + unreadTotal(); }

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
      fc.subscribe();
    } catch (e) {}
    ensureMyProfile();
    dbLoad(); loadUnread();
    setInterval(function () { dbLoad(); loadUnread(); }, 15000);
    bumpPlay(); weeklyInfo();
  }
  function onIncomingChat(msg) {
    if (!msg) { loadUnread(); return; }
    if (_chatOpenWith && msg.from_key === _chatOpenWith) { appendChatBubble(msg); markRead(_chatOpenWith); return; }
    const e = _unread[msg.from_key] || { count: 0, name: msg.from_name }; e.count++; e.name = msg.from_name; _unread[msg.from_key] = e;
    toast("💬 " + msg.from_name + ": " + (msg.body || "").slice(0, 40)); fire();
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
      + ".igf-banner b{color:#fff}.igf-banner .x{cursor:pointer;opacity:.8;font-weight:800}";
    document.head.appendChild(c);
  }

  /* ================= bell + notifications ================= */
  function injectBell() {
    if (document.getElementById("igf-bell")) return;
    const b = document.createElement("button"); b.id = "igf-bell"; b.className = "igf-bell";
    b.innerHTML = '🔔<span class="cnt" id="igf-bell-cnt">0</span>';
    b.onclick = openBell;
    S(function () { document.body.appendChild(b); });
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
  function openBell() {
    dbLoad(); loadUnread();
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2>🔔 Notifications</h2><div class="s">Tap a message to open the chat, or a request to view their profile. You can’t reply from here.</div><div id="igf-bell-body"></div><button class="igf-x" id="igf-bell-close">Close</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector("#igf-bell-close").onclick = function () { ov.remove(); };
    function render() {
      let h = "";
      if (_in.length) {
        h += '<div class="igf-sec">Friend requests</div>';
        _in.forEach(function (r) { const p = _profiles[r.key] || { user_key: r.key, name: r.name };
          h += '<div class="igf-row tap" data-req="' + esc(r.name) + '" data-k="' + esc(r.key) + '">' + avatarHTML(p, 38) + '<span class="n">' + esc(r.name) + '<small>sent you a friend request — tap to view</small></span><span style="color:#ff9">›</span></div>'; });
      }
      const uk = Object.keys(_unread);
      if (uk.length) {
        h += '<div class="igf-sec">New messages</div>';
        uk.forEach(function (k) { const u = _unread[k]; const p = _profiles[k] || { user_key: k, name: u.name };
          h += '<div class="igf-row tap" data-msg="' + esc(u.name) + '" data-k="' + esc(k) + '">' + avatarHTML(p, 38) + '<span class="n">' + esc(u.name) + '<small>' + u.count + ' new message' + (u.count > 1 ? "s" : "") + " — tap to open chat</small></span><span style=\"background:#ff3b5c;color:#fff;border-radius:9px;padding:1px 7px;font-size:12px;font-weight:800\">" + u.count + "</span></div>"; });
      }
      if (!_in.length && !uk.length) h += '<div class="s" style="text-align:center;padding:22px 0">🎉 You’re all caught up — no new notifications.</div>';
      const body = ov.querySelector("#igf-bell-body"); body.innerHTML = h;
      body.querySelectorAll("[data-req]").forEach(function (el) { el.onclick = function () { ov.remove(); openProfile(el.getAttribute("data-req"), el.getAttribute("data-k")); }; });
      body.querySelectorAll("[data-msg]").forEach(function (el) { el.onclick = function () { ov.remove(); openChat(el.getAttribute("data-k"), el.getAttribute("data-msg")); }; });
    }
    render(); onUpdate(function () { if (document.body.contains(ov)) render(); });
  }

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
    ov.querySelector("#igf-prof").innerHTML =
      '<div class="igf-prof-top">' + avatarHTML(Object.assign({ user_key: key, name: realName }, p || {}), 66) +
      '<div><div class="nm">' + esc(realName) + wk + '</div><div class="st">' + st + "</div></div></div>" +
      bioH + '<div style="margin:12px 0">' + actions + "</div>" + scoreH;
    const q = function (id) { return ov.querySelector(id); };
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

  /* ================= chat modal ================= */
  function fmtTime(iso) { try { const d = new Date(iso); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } }
  let _chatOv = null;
  function appendChatBubble(m) {
    if (!_chatOv || !document.body.contains(_chatOv)) return;
    const box = _chatOv.querySelector("#igf-msgs"); if (!box) return;
    const me = m.from_key === myKey;
    const div = document.createElement("div"); div.className = "igf-bub " + (me ? "me" : "them");
    div.innerHTML = esc(m.body) + '<small>' + fmtTime(m.created_at || new Date().toISOString()) + "</small>";
    box.appendChild(div); box.scrollTop = box.scrollHeight;
  }
  async function openChat(key, name) {
    injectCSS(); if (!isFriend(name) && key !== myKey) { /* only chat friends */ }
    _chatOpenWith = key;
    const ov = document.createElement("div"); ov.className = "igf-ov"; _chatOv = ov;
    ov.innerHTML = '<div class="igf-box"><h2 style="cursor:pointer" id="igf-chat-hd">💬 ' + esc(name) + '</h2><div class="igf-chat"><div class="igf-msgs" id="igf-msgs">Loading…</div>'
      + '<div id="igf-chat-warn" style="font-size:12px;color:#ffd27a;min-height:0;margin-top:4px"></div>'
      + '<div class="igf-cin"><input id="igf-cin" maxlength="400" placeholder="Message…" autocomplete="off"><button class="igf-btn igf-p" id="igf-csend">Send</button></div></div>'
      + '<button class="igf-x" id="igf-chat-close">Close</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) closeChat(); });
    ov.querySelector("#igf-chat-close").onclick = closeChat;
    ov.querySelector("#igf-chat-hd").onclick = function () { closeChat(); openProfile(name, key); };
    function closeChat() { _chatOpenWith = null; _chatOv = null; ov.remove(); }
    const box = ov.querySelector("#igf-msgs");
    const thread = await loadThread(key);
    if (!thread.length) box.innerHTML = '<div class="s" style="margin:auto;text-align:center">No messages yet — say hi! 👋</div>';
    else { box.innerHTML = ""; thread.forEach(appendChatBubble); }
    box.scrollTop = box.scrollHeight;
    markRead(key);
    // muted?
    if (_myProfile && _myProfile.chat_muted) { ov.querySelector("#igf-cin").disabled = true; ov.querySelector("#igf-csend").disabled = true; ov.querySelector("#igf-chat-warn").textContent = "🚫 Your chat is disabled due to repeated bad language."; }
    const inp = ov.querySelector("#igf-cin"), snd = ov.querySelector("#igf-csend");
    async function doSend() {
      const v = inp.value.trim(); if (!v) return; snd.disabled = true;
      const r = await sendChat(key, name, v);
      if (r.ok) { inp.value = ""; appendChatBubble({ from_key: myKey, body: r.body, created_at: new Date().toISOString() }); if (r.warn) ov.querySelector("#igf-chat-warn").textContent = r.warn; }
      else { ov.querySelector("#igf-chat-warn").textContent = r.msg || ""; if (r.blocked) { inp.disabled = true; } }
      snd.disabled = false; inp.focus();
    }
    snd.onclick = doSend;
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") doSend(); });
    inp.focus();
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
    injectCSS(); dbLoad(); loadUnread();
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
      if (_out.length) { h += '<div class="igf-sec">Sent requests</div>'; _out.forEach(function (r) { h += '<div class="igf-row"><span class="n">' + esc(r.name) + '<small>waiting for them to accept</small></span><span class="igf-btn igf-g" style="opacity:.85;cursor:default">⏳</span></div>'; }); }
      const body = ov.querySelector("#igf-body"); body.innerHTML = h;
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
    openPanel: openPanel, openProfile: openProfile, openChat: openChat, openBell: openBell,
    list: function () { return _friends; }, isFriend: isFriend, sendRequest: sendRequest,
    accept: accept, deny: deny, unfriend: unfriend, presenceOf: presenceOf,
    onUpdate: onUpdate, reqInCount: function () { return _in.length; }, bellCount: bellCount,
    weeklyInfo: weeklyInfo, isWeekWinner: isWeekWinner, ready: function () { return started; }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
