/* Ilan's Arcade — Friends (presence + friend requests over Supabase Realtime).
   Backend-free: requests are delivered live to ONLINE users; the friend list is
   stored per-device in localStorage. Everything is wrapped so it can never break a page. */
(function () {
  "use strict";
  function S(fn, d) { try { return fn(); } catch (e) { return d; } }

  /* ---------- identity (same name the leaderboard uses) ---------- */
  function myDisplayName() {
    let n = S(function () { return window.IGAuth && IGAuth.displayName && IGAuth.displayName(); });
    if (n) return n;
    n = S(function () { const s = JSON.parse(localStorage.getItem("soc_store_v1")); const a = s && s.accounts && (s.accounts.find(x => x.id === s.activeId) || s.accounts[0]); return a && a.name; });
    if (n) return n;
    n = S(function () { return localStorage.getItem("iglb_guestname"); });
    return n || null;
  }
  function nameKey(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40); }

  /* ---------- current game (for "what is my friend playing") ---------- */
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

  /* ---------- localStorage ---------- */
  function rd(k, d) { return S(function () { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }, d); }
  function wr(k, v) { S(function () { localStorage.setItem(k, JSON.stringify(v)); }); }
  function friends() { const a = rd("ig_friends", []); return Array.isArray(a) ? a : []; }
  function reqIn() { const a = rd("ig_freq_in", []); return Array.isArray(a) ? a : []; }
  function reqOut() { const a = rd("ig_freq_out", []); return Array.isArray(a) ? a : []; }
  function hasName(arr, name) { const k = nameKey(name); return arr.some(function (x) { return nameKey(x) === k; }); }
  function addUniq(k, name) { const a = rd(k, []); if (!hasName(a, name)) { a.push(name); wr(k, a); } }
  function rmName(k, name) { const a = rd(k, []).filter(function (x) { return nameKey(x) !== nameKey(name); }); wr(k, a); }

  let myName = null, sb = null, presCh = null, inboxCh = null, presState = {}, sendChans = {};
  const listeners = [];
  function onUpdate(cb) { listeners.push(cb); }
  function fireUpdate() { listeners.forEach(function (cb) { S(function () { cb(); }); }); }

  /* ---------- supabase ---------- */
  function loadSDK() { return new Promise(function (res) {
    if (window.supabase && window.supabase.createClient) return res(true);
    const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = function () { res(true); }; s.onerror = function () { res(false); }; document.head.appendChild(s);
  }); }
  async function ensureSb() {
    if (sb) return sb;
    if (!window.SUPABASE_URL || !window.SUPABASE_KEY) return null;
    const ok = await loadSDK(); if (!ok) return null;
    try { sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 10 } } }); } catch (e) { sb = null; }
    return sb;
  }
  async function sendTo(name, payload) {
    const s = await ensureSb(); if (!s) return false;
    const key = nameKey(name);
    let ch = sendChans[key];
    if (!ch) {
      ch = s.channel("ig-dm-" + key, { config: { broadcast: { self: false } } });
      sendChans[key] = ch;
      await new Promise(function (res) { let done = false; ch.subscribe(function (st) { if (!done && st === "SUBSCRIBED") { done = true; res(); } }); setTimeout(res, 2500); });
    }
    return S(function () { ch.send({ type: "broadcast", event: "msg", payload: payload }); return true; }, false);
  }

  /* ---------- inbox handling ---------- */
  function handleInbox(p) {
    if (!p || !p.from) return; const from = p.from;
    if (p.type === "freq") {
      if (hasName(friends(), from)) { sendTo(from, { type: "facc", from: myName }); return; } // already friends -> auto-accept
      addUniq("ig_freq_in", from); toast("👋 " + from + " sent you a friend request!"); fireUpdate();
    } else if (p.type === "facc") {
      addUniq("ig_friends", from); rmName("ig_freq_out", from); rmName("ig_freq_in", from); toast("✅ " + from + " accepted your friend request!"); fireUpdate();
    } else if (p.type === "fden") {
      rmName("ig_freq_out", from); toast("🙁 " + from + " declined your request."); fireUpdate();
    } else if (p.type === "funf") {
      rmName("ig_friends", from); fireUpdate();
    }
  }

  /* ---------- init: presence + inbox ---------- */
  let started = false;
  async function init() {
    if (started) return; myName = myDisplayName();
    if (!myName) { setTimeout(init, 1500); return; }            // wait until the player has a name
    started = true;
    const s = await ensureSb(); if (!s) return;
    const key = nameKey(myName), game = gameSlug();
    try {
      presCh = s.channel("ig-presence", { config: { presence: { key: key } } });
      presCh.on("presence", { event: "sync" }, function () { presState = S(function () { return presCh.presenceState(); }, {}) || {}; fireUpdate(); });
      presCh.subscribe(function (st) { if (st === "SUBSCRIBED") S(function () { presCh.track({ name: myName, game: game, ts: Date.now() }); }); });
    } catch (e) {}
    try {
      inboxCh = s.channel("ig-dm-" + key, { config: { broadcast: { self: false } } });
      inboxCh.on("broadcast", { event: "msg" }, function (m) { handleInbox(m && m.payload); });
      inboxCh.subscribe();
    } catch (e) {}
  }

  /* ---------- public API ---------- */
  function presenceOf(name) { const v = presState && presState[nameKey(name)]; if (v && v.length) return { online: true, game: v[0].game }; return { online: false }; }
  function isFriend(name) { return hasName(friends(), name); }
  function sendRequest(name) {
    name = (name || "").trim(); if (!name) return { ok: false, msg: "Enter a username." };
    if (!myName) return { ok: false, msg: "Set your player name first (top of the home page)." };
    if (nameKey(name) === nameKey(myName)) return { ok: false, msg: "That's you! 😄" };
    if (isFriend(name)) return { ok: false, msg: "You're already friends with " + name + "." };
    const online = presenceOf(name).online;
    sendTo(name, { type: "freq", from: myName }); addUniq("ig_freq_out", name); fireUpdate();
    return online ? { ok: true, msg: "Request sent to " + name + "! ✉️" }
                  : { ok: true, offline: true, msg: name + " looks offline — ask them to open the arcade (online in ~10s), then it'll reach them. Request queued." };
  }
  function accept(name) { addUniq("ig_friends", name); rmName("ig_freq_in", name); sendTo(name, { type: "facc", from: myName }); toast("🤝 You and " + name + " are now friends!"); fireUpdate(); }
  function deny(name) { rmName("ig_freq_in", name); sendTo(name, { type: "fden", from: myName }); fireUpdate(); }
  function unfriend(name) { rmName("ig_friends", name); sendTo(name, { type: "funf", from: myName }); fireUpdate(); }

  /* ---------- toast ---------- */
  function toast(msg) {
    S(function () {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9600;background:#0f1d36;border:1px solid #2a3c63;color:#fff;padding:12px 16px;border-radius:14px;font:14px -apple-system,system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:92vw;text-align:center";
      t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 5000);
    });
  }

  /* ---------- UI panel (used by the home page) ---------- */
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
  function openPanel() {
    injectCSS();
    const ov = document.createElement("div"); ov.className = "igf-ov";
    ov.innerHTML = '<div class="igf-box"><h2>👥 Friends</h2><div class="s" id="igf-me"></div>'
      + '<div class="igf-add"><input id="igf-name" maxlength="16" placeholder="username to add" autocomplete="off"><button class="igf-btn igf-p" id="igf-send">Add</button></div>'
      + '<div id="igf-body"></div><button class="igf-x" id="igf-close">Close</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector("#igf-close").onclick = function () { ov.remove(); };
    const nameI = ov.querySelector("#igf-name");
    ov.querySelector("#igf-send").onclick = function () { const r = sendRequest(nameI.value); toast(r.msg); if (r.ok) nameI.value = ""; render(); };
    nameI.addEventListener("keydown", function (e) { if (e.key === "Enter") ov.querySelector("#igf-send").click(); });
    function render() {
      const me = myName || "(no name yet)";
      ov.querySelector("#igf-me").textContent = "You're " + me + ". Add players by their exact username — they must be online to receive it.";
      let h = "";
      const ins = reqIn();
      if (ins.length) { h += '<div class="igf-sec">Requests for you</div>';
        ins.forEach(function (n) { h += '<div class="igf-row"><span class="n">' + esc(n) + '</span><button class="igf-btn igf-p" data-acc="' + esc(n) + '">Accept</button><button class="igf-btn igf-d" data-den="' + esc(n) + '">Deny</button></div>'; }); }
      const fr = friends();
      h += '<div class="igf-sec">Your friends (' + fr.length + ')</div>';
      if (!fr.length) h += '<div class="s">No friends yet — add someone above!</div>';
      fr.forEach(function (n) { const p = presenceOf(n); const sub = p.online ? ("Online" + (p.game && p.game !== "home" ? " • playing " + gname(p.game) : (p.game === "home" ? " • in the menu" : ""))) : "Offline";
        h += '<div class="igf-row"><span class="igf-dot ' + (p.online ? "on" : "off") + '"></span><span class="n">' + esc(n) + '<small>' + sub + '</small></span><button class="igf-btn igf-g" data-unf="' + esc(n) + '">✕</button></div>'; });
      const outs = reqOut();
      if (outs.length) { h += '<div class="igf-sec">Sent (waiting)</div>'; outs.forEach(function (n) { h += '<div class="igf-row"><span class="n">' + esc(n) + '<small>pending…</small></span></div>'; }); }
      const body = ov.querySelector("#igf-body"); body.innerHTML = h;
      body.querySelectorAll("[data-acc]").forEach(function (b) { b.onclick = function () { accept(b.getAttribute("data-acc")); render(); }; });
      body.querySelectorAll("[data-den]").forEach(function (b) { b.onclick = function () { deny(b.getAttribute("data-den")); render(); }; });
      body.querySelectorAll("[data-unf]").forEach(function (b) { b.onclick = function () { if (confirm("Remove this friend?")) { unfriend(b.getAttribute("data-unf")); render(); } }; });
    }
    function esc(s) { return String(s).replace(/[<>&]/g, ""); }
    render(); onUpdate(function () { if (document.body.contains(ov)) render(); });
  }

  window.IGFriends = { openPanel: openPanel, list: friends, isFriend: isFriend, sendRequest: sendRequest, accept: accept, deny: deny, presenceOf: presenceOf, onUpdate: onUpdate, reqInCount: function () { return reqIn().length; }, ready: function () { return started; } };
  // boot
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
