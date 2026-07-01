/* Ilan's Arcade — Friends (persistent, offline-capable) over Supabase.
   - Friend requests + friendships are stored in the DB, so a request reaches the
     other player WHENEVER they next come online (no need to be online together).
   - Online status + "what they're playing" come from Supabase Realtime presence.
   Requires two tables (ig_friend_req, ig_friend) — see the SQL Ilan was given.
   Fully guarded: if the DB/Realtime is unavailable it just does nothing. */
(function () {
  "use strict";
  function S(fn, d) { try { return fn(); } catch (e) { return d; } }

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
    try: "One More Try", "anime-tycoon": "Anime Tycoon", tennis: "Tennis Tour", pptour: "Ping Pong Tour", karate: "Karate", "fruit-arena": "Fruit Arena", rescue: "Rescue Bounce" };
  function gameSlug() {
    if (S(function () { return document.body && document.body.hasAttribute("data-arcade-home"); })) return "home";
    const segs = location.pathname.split("/").filter(Boolean);
    let g = segs.pop() || ""; if (/\.html$/.test(g) || g === "index") g = segs.pop() || "";
    return g || "home";
  }
  function gname(slug) { return GN[slug] || slug; }
  function rd(k, d) { return S(function () { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }, d); }
  function wr(k, v) { S(function () { localStorage.setItem(k, JSON.stringify(v)); }); }

  let myName = null, myKey = "", sb = null, presCh = null, presState = {}, started = false;
  let _friends = rd("ig_friends_cache", []) || [], _in = [], _out = [];
  const listeners = []; function onUpdate(cb) { listeners.push(cb); } function fire() { listeners.forEach(function (cb) { S(function () { cb(); }); }); }

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

  /* ---------- DB ops ---------- */
  async function dbLoad() {
    const s = await ensureSb(); if (!s || !myKey) return;
    try {
      const fr = await s.from("ig_friend").select("bname,bkey").eq("akey", myKey);
      if (!fr.error && fr.data) { _friends = fr.data.map(function (r) { return { name: r.bname, key: r.bkey }; }); wr("ig_friends_cache", _friends); wr("ig_friend_keys", _friends.map(function (f) { return f.key; })); }
      const ins = await s.from("ig_friend_req").select("from_name,from_key").eq("to_key", myKey);
      if (!ins.error && ins.data) _in = ins.data.map(function (r) { return { name: r.from_name, key: r.from_key }; });
      const outs = await s.from("ig_friend_req").select("to_name,to_key").eq("from_key", myKey);
      if (!outs.error && outs.data) _out = outs.data.map(function (r) { return { name: r.to_name, key: r.to_key }; });
      // auto-accept any pair where both have requested each other
      for (const r of _in.slice()) { if (_out.some(function (o) { return o.key === r.key; })) { await doAccept(r.name, r.key, true); } }
      fire();
    } catch (e) {}
  }
  async function dbRequest(name) {
    const s = await ensureSb(); if (!s) return false; const k = nameKey(name);
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

  /* ---------- User of the Week: count game-opens per player per week ---------- */
  /* The week runs Friday→Thursday and the winner is announced every Friday.
     weekId = the local day-index of the Friday that opened the current week
     (unique + increasing each week); daysLeft = days until the next Friday. */
  function weekMeta() {
    const d = new Date();
    const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayNum = Math.round(localMidnight / 86400000);   // local day index
    const sinceFri = (d.getDay() - 5 + 7) % 7;             // Fri=0, Sat=1, … Thu=6
    return { week: dayNum - sinceFri, daysLeft: 7 - sinceFri };  // Fri→7 (fresh), Thu→1 (tomorrow)
  }
  async function bumpPlay() {
    try {
      if (gameSlug() === "home") return;                 // only count actually opening a game
      const now = Date.now(); if (now - (+rd("ig_lastbump", 0)) < 60000) return; wr("ig_lastbump", now);  // throttle refresh-spam
      const s = await ensureSb(); if (!s || !myKey) return;
      await s.rpc("ig_play_bump", { p_name: myName, p_key: myKey, p_week: weekMeta().week });
    } catch (e) {}
  }
  async function weeklyInfo() {
    const s = await ensureSb(); if (!s) return null;
    const wm = weekMeta(), wk = wm.week, daysLeft = wm.daysLeft;
    const info = { daysLeft: daysLeft, leader: null, leaderPlays: 0, prev: null };
    try { const r = await s.from("ig_weekly").select("user_name,plays").eq("week", wk).neq("user_key", "ilan").order("plays", { ascending: false }).limit(1); if (!r.error && r.data && r.data.length) { info.leader = r.data[0].user_name; info.leaderPlays = r.data[0].plays; } } catch (e) {}
    try { const p = await s.from("ig_weekly").select("user_name,plays").eq("week", wk - 7).neq("user_key", "ilan").order("plays", { ascending: false }).limit(1); if (!p.error && p.data && p.data.length) info.prev = p.data[0].user_name; } catch (e) {}
    return info;
  }

  /* ---------- init: presence + load + live request feed ---------- */
  async function init() {
    if (started) return; myName = myDisplayName();
    if (!myName) { setTimeout(init, 1500); return; }
    started = true; myKey = nameKey(myName);
    const s = await ensureSb(); if (!s) return;
    try {
      presCh = s.channel("ig-presence", { config: { presence: { key: myKey } } });
      presCh.on("presence", { event: "sync" }, function () { presState = S(function () { return presCh.presenceState(); }, {}) || {}; fire(); });
      presCh.subscribe(function (st) { if (st === "SUBSCRIBED") S(function () { presCh.track({ name: myName, game: gameSlug(), ts: Date.now() }); }); });
    } catch (e) {}
    // instant request delivery while online (if the table is in the realtime publication)
    try {
      const fc = s.channel("igfr-" + myKey);
      fc.on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_friend_req", filter: "to_key=eq." + myKey }, function () { dbLoad().then(function () { toast("👋 New friend request!"); }); });
      fc.on("postgres_changes", { event: "INSERT", schema: "public", table: "ig_friend", filter: "akey=eq." + myKey }, function () { dbLoad(); });
      fc.subscribe();
    } catch (e) {}
    dbLoad();
    setInterval(dbLoad, 15000);   // catch anything missed / requests that arrived while offline
    bumpPlay();                   // count this game-open toward User of the Week
  }

  /* ---------- public API ---------- */
  function presenceOf(name) { const v = presState && presState[nameKey(name)]; if (v && v.length) return { online: true, game: v[0].game }; return { online: false }; }
  function isFriend(name) { const k = nameKey(name); const keys = rd("ig_friend_keys", []); return (keys || []).indexOf(k) >= 0; }
  // resolve a typed username to the REAL player (case-insensitive), or null if no such player exists
  async function lookupUser(name) {
    const s = await ensureSb(); if (!s) return null; const key = nameKey(name);
    try { const v = presState && presState[key]; if (v && v.length) return v[0].name || name; } catch (e) {}            // online right now
    try { const r = await s.from("leaderboard").select("name").ilike("name", name).limit(8); if (!r.error && r.data) { for (const row of r.data) if (nameKey(row.name) === key) return row.name; } } catch (e) {}  // has played
    try { const r2 = await s.from("ig_friend").select("aname").ilike("aname", name).limit(8); if (!r2.error && r2.data) { for (const row of r2.data) if (nameKey(row.aname) === key) return row.aname; } } catch (e) {} // known player
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
    const ok = await dbRequest(canon); if (!ok) return { ok: false, msg: "Couldn't reach the server — try again." };
    _out.push({ name: canon, key: nameKey(canon) }); fire();
    return { ok: true, msg: "✅ Request sent to " + canon + " — pending until they accept." };
  }
  function accept(name, key) { doAccept(name, key || nameKey(name)); }
  function deny(name, key) { doDeny(name, key || nameKey(name)); }
  function unfriend(name, key) { doUnfriend(name, key || nameKey(name)); }

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
    c.textContent = ".igf-ov{position:fixed;inset:0;background:rgba(6,10,22,.72);backdrop-filter:blur(4px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:18px;font-family:-apple-system,'Segoe UI',system-ui,sans-serif}"
      + ".igf-box{background:#0f1d36;border:1px solid #2a3c63;border-radius:18px;padding:20px;max-width:400px;width:100%;color:#fff;max-height:88vh;overflow:auto}"
      + ".igf-box h2{font-size:21px;margin:0 0 4px}.igf-box .s{font-size:12px;color:#9fb3d8;margin:0 0 12px}"
      + ".igf-add{display:flex;gap:6px;margin-bottom:12px}.igf-add input{flex:1;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:11px 12px;border-radius:10px;font-size:15px}"
      + ".igf-btn{border:none;border-radius:10px;padding:11px 14px;font-weight:800;cursor:pointer;font-size:14px}.igf-p{background:linear-gradient(135deg,#39ff88,#1ea85a);color:#04220f}.igf-g{background:#26344f;color:#cfe0ff}.igf-d{background:#5a2330;color:#ffb4b4}"
      + ".igf-sec{font-size:12px;color:#7e90b5;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px}"
      + ".igf-row{display:flex;align-items:center;gap:8px;background:#16243f;border-radius:10px;padding:9px 11px;margin:5px 0}"
      + ".igf-row .n{flex:1;text-align:left;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.igf-row .n small{display:block;color:#8aa0c6;font-size:11px}"
      + ".igf-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}.on{background:#39ff88;box-shadow:0 0 8px #39ff88}.off{background:#566}"
      + ".igf-x{background:transparent;color:#7e90b5;border:none;font-weight:700;cursor:pointer;width:100%;padding:12px;font-size:15px}";
    document.head.appendChild(c);
  }
  function esc(s) { return String(s).replace(/[<>&]/g, ""); }
  function openPanel() {
    injectCSS(); dbLoad();
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2>👥 Friends</h2><div class="s" id="igf-me"></div>'
      + '<div class="igf-add"><input id="igf-name" maxlength="16" placeholder="username to add" autocomplete="off"><button class="igf-btn igf-p" id="igf-send">Add</button></div>'
      + '<div id="igf-body"></div><button class="igf-x" id="igf-close">Close</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector("#igf-close").onclick = function () { ov.remove(); };
    const nameI = ov.querySelector("#igf-name");
    const sendB = ov.querySelector("#igf-send");
    sendB.onclick = function () { const val = nameI.value; sendB.disabled = true; sendB.textContent = "…";
      Promise.resolve(sendRequest(val)).then(function (r) { toast(r.msg); if (r.ok) { nameI.value = ""; render(); } sendB.disabled = false; sendB.textContent = "Add"; }); };
    nameI.addEventListener("keydown", function (e) { if (e.key === "Enter") sendB.click(); });
    function render() {
      ov.querySelector("#igf-me").textContent = "You're " + (myName || "(no name yet)") + ". Add players by their exact username — the request waits for them to come online.";
      let h = "";
      if (_in.length) { h += '<div class="igf-sec">Requests for you</div>';
        _in.forEach(function (r) { h += '<div class="igf-row"><span class="n">' + esc(r.name) + '</span><button class="igf-btn igf-p" data-acc="' + esc(r.name) + '" data-k="' + esc(r.key) + '">Accept</button><button class="igf-btn igf-d" data-den="' + esc(r.name) + '" data-k="' + esc(r.key) + '">Deny</button></div>'; }); }
      h += '<div class="igf-sec">Your friends (' + _friends.length + ')</div>';
      if (!_friends.length) h += '<div class="s">No friends yet — add someone above!</div>';
      _friends.forEach(function (f) { const p = presenceOf(f.name); const sub = p.online ? (p.game === "home" ? "Online • in the menu" : "Online • playing " + gname(p.game)) : "Offline";
        h += '<div class="igf-row"><span class="igf-dot ' + (p.online ? "on" : "off") + '"></span><span class="n">' + esc(f.name) + '<small>' + sub + '</small></span><button class="igf-btn igf-g" data-unf="' + esc(f.name) + '" data-k="' + esc(f.key) + '">✕</button></div>'; });
      if (_out.length) { h += '<div class="igf-sec">Sent requests</div>'; _out.forEach(function (r) { h += '<div class="igf-row"><span class="n">' + esc(r.name) + '<small>waiting for them to accept</small></span><span class="igf-btn igf-g" style="opacity:.85;cursor:default">⏳ Request pending</span></div>'; }); }
      const body = ov.querySelector("#igf-body"); body.innerHTML = h;
      body.querySelectorAll("[data-acc]").forEach(function (b) { b.onclick = function () { accept(b.getAttribute("data-acc"), b.getAttribute("data-k")); }; });
      body.querySelectorAll("[data-den]").forEach(function (b) { b.onclick = function () { deny(b.getAttribute("data-den"), b.getAttribute("data-k")); }; });
      body.querySelectorAll("[data-unf]").forEach(function (b) { b.onclick = function () { if (confirm("Remove this friend?")) unfriend(b.getAttribute("data-unf"), b.getAttribute("data-k")); }; });
    }
    render(); onUpdate(function () { if (document.body.contains(ov)) render(); });
  }

  window.IGFriends = { openPanel: openPanel, list: function () { return _friends; }, isFriend: isFriend, sendRequest: sendRequest, accept: accept, deny: deny, presenceOf: presenceOf, onUpdate: onUpdate, reqInCount: function () { return _in.length; }, weeklyInfo: weeklyInfo, ready: function () { return started; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
