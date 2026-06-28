/* =====================================================================
   IGAuth — simple name + password accounts + guests + per-game leaderboard.
   No email, no verification. Backed by Supabase RPCs (passwords hashed
   server-side so a guest can't overwrite a registered name's score).
   Loaded like analytics.js:  <script src="../supabase-config.js"></script>
                              <script src="../auth.js" defer></script>
   ===================================================================== */
(function () {
  "use strict";
  const SUPA_URL = window.SUPABASE_URL, SUPA_KEY = window.SUPABASE_KEY;
  const STORE_KEY = "soc_store_v1", PKEY = "ig_player";

  // map each game's "best" number out of a stored account, for migration seeding
  const GAME_BEST = {
    catch:    a => (a.basket && a.basket.best) || 0,
    cricket:  a => ((a.ipl && a.ipl.runs) || 0) + ((a.odi && a.odi.runs) || 0),
    f1:       a => (a.f1 && a.f1.points) || 0,
    football: a => (a.pk && a.pk.won) || 0,
  };
  const NS = ["ipl", "odi", "basket", "f1", "pk", "puz"];
  const GAME_TITLES = {
    catch: "Basket Catch", cricket: "Super Over Cricket", f1: "Grand Prix", football: "Penalty Kings",
    try: "One More Try", puzzles: "Puzzle Pad", obby: "Rainbow Obby", "anime-tycoon": "Anime Tycoon",
    tennis: "Tennis", karate: "Karate", rescue: "Rescue", "fruit-arena": "Fruit Arena", pptour: "Ping Pong Tour"
  };
  const GAME_METRIC = {
    catch: "Best score", cricket: "Career runs", f1: "Championship points", football: "Matches won",
    try: "Best level", puzzles: "Puzzles solved", obby: "Best stage", "anime-tycoon": "Net worth",
    tennis: "Trophies", karate: "Wins", rescue: "Best rescues", "fruit-arena": "Best score", pptour: "Matches won"
  };

  let sb = null, ready = false, player = null;   // player = {name, pw?, guest}
  const cbs = [];
  function fire() { cbs.forEach(cb => { try { cb(player); } catch (e) {} }); refreshButtons(); }
  // Centrally update the standard account button in every game (auth.js loads
  // deferred, so per-page onChange wiring may register too late — this is robust).
  function refreshButtons() {
    try {
      const label = player ? ("👤 " + player.name) : "👤 Log in";
      document.querySelectorAll("#IGA_login, #acctBtn").forEach(b => { b.textContent = label; });
    } catch (e) {}
  }

  /* ---------- player persistence ---------- */
  function loadPlayer() { try { const p = JSON.parse(localStorage.getItem(PKEY)); if (p && p.name) return p; } catch (e) {} return null; }
  function savePlayer(p) { player = p; try { p ? localStorage.setItem(PKEY, JSON.stringify(p)) : localStorage.removeItem(PKEY); } catch (e) {} fire(); }

  /* ---------- soc_store_v1 bridge (so every game shows this player) ---------- */
  function storeLoad() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && Array.isArray(s.accounts)) return s; } catch (e) {} return { activeId: null, accounts: [] }; }
  function storeSave(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  function mergeGameData(dest, src) {
    NS.forEach(k => {
      if (!src[k]) return;
      if (!dest[k]) { dest[k] = JSON.parse(JSON.stringify(src[k])); return; }
      for (const f in src[k]) { const v = src[k][f]; if (typeof v === "number") dest[k][f] = Math.max(dest[k][f] || 0, v); else if (dest[k][f] == null) dest[k][f] = v; }
      if (Array.isArray(src[k].owned)) dest[k].owned = Array.from(new Set([...(dest[k].owned || []), ...src[k].owned]));
    });
  }
  // make `name` the active account, carrying over whatever the player had on this device
  function setActiveByName(name) {
    const s = storeLoad();
    let acct = s.accounts.find(a => a.name === name);
    if (!acct) { acct = { id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name }; s.accounts.push(acct); }
    // pull in scores from EVERY other on-device account (highest per field) so nothing is lost
    for (const a of s.accounts) { if (a.id !== acct.id) mergeGameData(acct, a); }
    // fold Basket Catch guest + legacy saves
    try {
      const g = JSON.parse(localStorage.getItem("basketCatchV2_guest"));
      if (g) { acct.basket = acct.basket || {}; acct.basket.best = Math.max(acct.basket.best || 0, g.best || 0); acct.basket.coins = Math.max(acct.basket.coins || 0, g.coins || 0); acct.basket.owned = Array.from(new Set([...(acct.basket.owned || ["starter"]), ...(g.owned || [])])); acct.basket.sel = acct.basket.sel || g.sel || "starter"; }
    } catch (e) {}
    try { const lh = +(localStorage.getItem("basketCatchHigh") || 0); if (lh > 0) { acct.basket = acct.basket || {}; acct.basket.best = Math.max(acct.basket.best || 0, lh); } } catch (e) {}
    s.activeId = acct.id; storeSave(s);
    return acct;
  }
  function migrateAndSeed(name) {
    const acct = setActiveByName(name);
    for (const g in GAME_BEST) { const v = GAME_BEST[g](acct); if (v > 0) submitScore(g, v); }   // seed leaderboard with existing bests
    // One More Try keeps its best in its own save key (not in the account object)
    try { const o = JSON.parse(localStorage.getItem("omt_save_v1")); if (o && (o.best || 0) > 0) submitScore("try", o.best); } catch (e) {}
  }

  /* ---------- Supabase client (anon — only for RPC + leaderboard reads) ---------- */
  function loadSDK() {
    return new Promise(res => {
      if (window.supabase && window.supabase.createClient) return res(true);
      const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s);
    });
  }
  async function init() {
    if (!SUPA_URL || !SUPA_KEY) { console.warn("[IGAuth] missing Supabase config"); ready = true; return; }
    const ok = await loadSDK();
    if (ok) sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
    player = loadPlayer();
    if (player) migrateAndSeed(player.name);    // re-merge device scores + (re)seed leaderboard each load
    else autoGuestSeed();                       // not signed in? post device scores as a guest + nudge to log in
    ready = true; fire();
  }

  // RPC with retry — "Load failed" / fetch errors are often transient (flaky
  // network, Private Relay). Retry a couple times before giving up.
  async function callRpc(name, args) {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try { return await sb.rpc(name, args); }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 350 * (i + 1))); }
    }
    throw lastErr;
  }
  function netMsg(e) {
    const m = (e && e.message) || "";
    if (/load failed|failed to fetch|networkerror/i.test(m))
      return "Couldn't reach the server. Turn off any ad-blocker / Private Relay for this site, or try another network or browser.";
    return m || "Could not connect.";
  }

  /* ---------- leaderboard ---------- */
  async function submitScore(game, score) {
    if (!sb || !player) return;
    score = Math.round(score || 0); if (!score) return;
    try { await callRpc("post_score", { p_name: player.name, p_password: player.pw || "", p_game: game, p_score: score, p_guest: !!player.guest }); }
    catch (e) {}
  }
  async function topScores(game, n) {
    if (!sb) return [];
    try { const { data } = await sb.from("leaderboard").select("name,score,is_guest").eq("game", game).order("score", { ascending: false }).limit(n || 50); return data || []; }
    catch (e) { return []; }
  }

  /* ---------- account actions ---------- */
  async function login(name, pw, recovery) {
    if (!sb) return { error: "Connecting… try again in a moment." };
    name = (name || "").trim().slice(0, 16);
    if (!name) return { error: "Enter a name." };
    if (!pw) return { error: "Enter a password." };
    try {
      const { data, error } = await callRpc("account_auth", { p_name: name, p_password: pw, p_recovery: recovery || null });
      if (error) return { error: error.message };
      if (data === "wrong") return { error: "That name is taken — wrong password." };
      if (data === "invalid") return { error: "Enter a name and password." };
      savePlayer({ name, pw, guest: false });   // 'ok' or 'created'
      migrateAndSeed(name);
      return { ok: true };
    } catch (e) { return { error: netMsg(e) }; }
  }
  async function resetPassword(name, recovery, newPw) {
    if (!sb) return { error: "Connecting… try again in a moment." };
    name = (name || "").trim().slice(0, 16);
    if (!name || !newPw) return { error: "Enter your name and a new password." };
    try {
      const { data, error } = await callRpc("reset_password", { p_name: name, p_recovery: recovery || "", p_new_password: newPw });
      if (error) return { error: error.message };
      if (data === "ok") return { ok: true };
      if (data === "norecovery") return { error: "No recovery word was set for that name — ask the game owner to reset it." };
      if (data === "wrong") return { error: "Recovery word doesn't match." };
      return { error: "Could not reset." };
    } catch (e) { return { error: netMsg(e) }; }
  }
  function guest(name) {
    name = (name || "").trim().slice(0, 16) || "Guest";
    savePlayer({ name, guest: true });
    migrateAndSeed(name);
    return { ok: true };
  }
  function signOut() { savePlayer(null); location.reload(); }

  /* ================= UI ================= */
  function injectStyles() {
    if (document.getElementById("igauth-css")) return;
    const css = document.createElement("style"); css.id = "igauth-css";
    css.textContent = `
    .iga-ov{position:fixed;inset:0;background:rgba(6,10,22,.72);backdrop-filter:blur(4px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:18px;font-family:-apple-system,'Segoe UI',system-ui,sans-serif}
    .iga-box{background:#0f1d36;border:1px solid #2a3c63;border-radius:18px;padding:22px;max-width:380px;width:100%;color:#fff;text-align:center;max-height:90vh;overflow:auto}
    .iga-box h2{font-size:22px;margin:0 0 6px}
    .iga-box p{font-size:13px;color:#9fb3d8;margin:0 0 12px;line-height:1.45}
    .iga-box input{width:100%;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:12px 14px;border-radius:10px;font-size:16px;margin:6px 0}
    .iga-btn{border:none;border-radius:24px;padding:13px 18px;font-size:16px;font-weight:800;cursor:pointer;margin:5px 0;width:100%}
    .iga-p{background:linear-gradient(135deg,#39ff88,#1ea85a);color:#04220f}
    .iga-g{background:#26344f;color:#cfe0ff}
    .iga-x{background:transparent;color:#7e90b5;font-weight:700}
    .iga-msg{font-size:13px;margin:8px 0;min-height:16px}
    .iga-err{color:#ff8088}.iga-ok{color:#7CFFB2}
    .iga-link{color:#7cc0ff;cursor:pointer;font-size:13px;text-decoration:underline}
    .iga-row{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:10px;margin:4px 0;background:#16243f;font-size:15px}
    .iga-row.me{background:rgba(255,211,77,.18)}
    .iga-row .r{width:34px;color:#ffd54a;font-weight:800;text-align:left}
    .iga-row .n{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .iga-row .n small{color:#8aa0c6}
    .iga-row .sc{font-weight:800;color:#ffd54a}
    .iga-tabs{display:flex;gap:6px;overflow-x:auto;padding:4px 0 10px;-webkit-overflow-scrolling:touch}
    .iga-tab{flex:0 0 auto;background:#16243f;color:#cfe0ff;border:1px solid #2a3c63;border-radius:20px;padding:7px 13px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
    .iga-tab.on{background:linear-gradient(135deg,#ffd54a,#ff8c3d);color:#241600;border-color:transparent}
    .iga-metric{font-size:12px;color:#8aa0c6;margin:-2px 0 8px}`;
    document.head.appendChild(css);
  }
  function modal(html) {
    injectStyles();
    const ov = document.createElement("div"); ov.className = "iga-ov";
    ov.innerHTML = `<div class="iga-box">${html}</div>`;
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov); return ov;
  }

  function openAuth() {
    if (player) return openAccount();
    const ov = modal(`
      <h2>Save your scores</h2>
      <p>Pick a name &amp; password to claim your spot on the leaderboard — no email needed. Or just play as a guest.</p>
      <input id="iga-name" type="text" placeholder="Name" maxlength="16" autocomplete="nickname">
      <input id="iga-pwd" type="password" placeholder="Password" autocomplete="current-password">
      <input id="iga-rec" type="text" placeholder="Recovery word (optional, to reset password)" maxlength="24">
      <div class="iga-msg" id="iga-m"></div>
      <button class="iga-btn iga-p" id="iga-go">Save my name &amp; play</button>
      <button class="iga-btn iga-g" id="iga-guest">Play as Guest</button>
      <div style="margin-top:8px"><span class="iga-link" id="iga-forgot">Forgot password?</span></div>`);
    const $ = id => ov.querySelector(id);
    const msg = (t, ok) => { const m = $("#iga-m"); m.textContent = t; m.className = "iga-msg " + (ok ? "iga-ok" : "iga-err"); };
    $("#iga-go").onclick = async () => {
      msg("Saving…", true);
      const r = await login($("#iga-name").value, $("#iga-pwd").value, $("#iga-rec").value);
      if (r.error) msg(r.error); else location.reload();
    };
    $("#iga-guest").onclick = () => { guest($("#iga-name").value); location.reload(); };
    $("#iga-forgot").onclick = () => { ov.remove(); openReset(); };
  }

  function openReset() {
    const ov = modal(`
      <h2>Reset password</h2>
      <p>Enter your name, your recovery word, and a new password.</p>
      <input id="iga-rname" type="text" placeholder="Name" maxlength="16">
      <input id="iga-rrec" type="text" placeholder="Recovery word" maxlength="24">
      <input id="iga-rnew" type="password" placeholder="New password">
      <div class="iga-msg" id="iga-rm"></div>
      <button class="iga-btn iga-p" id="iga-rdo">Set new password</button>
      <button class="iga-btn iga-x" id="iga-rback">Back</button>`);
    const $ = id => ov.querySelector(id);
    const msg = (t, ok) => { const m = $("#iga-rm"); m.textContent = t; m.className = "iga-msg " + (ok ? "iga-ok" : "iga-err"); };
    $("#iga-rdo").onclick = async () => {
      msg("Resetting…", true);
      const r = await resetPassword($("#iga-rname").value, $("#iga-rrec").value, $("#iga-rnew").value);
      if (r.error) msg(r.error); else { msg("Done! Now log in with your new password.", true); setTimeout(() => { ov.remove(); openAuth(); }, 1400); }
    };
    $("#iga-rback").onclick = () => { ov.remove(); openAuth(); };
  }

  function openAccount() {
    const tag = player.guest ? " <small style='color:#8aa0c6'>(guest)</small>" : "";
    const ov = modal(`
      <h2>👤 ${(player.name || "").replace(/[<>]/g, "")}${tag}</h2>
      <p>${player.guest ? "You're playing as a guest. Save a name + password to keep your scores." : "Your scores are saved to this name."}</p>
      ${player.guest ? `<button class="iga-btn iga-p" id="iga-upgrade">Save a name &amp; password</button>` : ``}
      <button class="iga-btn iga-g" id="iga-out">Log out / switch</button>
      <button class="iga-btn iga-x" id="iga-close">Close</button>`);
    if (ov.querySelector("#iga-upgrade")) ov.querySelector("#iga-upgrade").onclick = () => { ov.remove(); savePlayer(null); openAuth(); };
    ov.querySelector("#iga-out").onclick = () => signOut();
    ov.querySelector("#iga-close").onclick = () => ov.remove();
  }

  async function showLeaderboard(game, title) {
    const ov = modal(`<h2>🏆 ${title || "Leaderboard"}</h2><p>All-time best scores</p><div id="iga-lb">Loading…</div>
      <button class="iga-btn iga-x" id="iga-close" style="margin-top:10px">Close</button>`);
    ov.querySelector("#iga-close").onclick = () => ov.remove();
    const rows = await topScores(game, 50);
    const box = ov.querySelector("#iga-lb");
    // collapse same-name entries: if a registered name exists, drop the guest
    // duplicate and keep the highest score under the registered name.
    const byName = {};
    for (const r of rows) {
      const k = (r.name || "Player");
      if (!byName[k]) byName[k] = { name: r.name, score: r.score, is_guest: !!r.is_guest };
      else { byName[k].score = Math.max(byName[k].score, r.score); if (!r.is_guest) byName[k].is_guest = false; }
    }
    const list = Object.values(byName).sort((a, b) => b.score - a.score);
    if (!list.length) { box.innerHTML = `<p>No scores yet — be the first!</p>`; return; }
    box.innerHTML = list.map((r, i) => {
      const me = player && r.name === player.name;
      const nm = (r.name || "Player").replace(/[<>]/g, "") + (r.is_guest ? ` <small>(guest)</small>` : "");
      return `<div class="iga-row ${me ? "me" : ""}"><span class="r">${i + 1}</span><span class="n">${nm}</span><span class="sc">${r.score}</span></div>`;
    }).join("");
  }

  // Overall leaderboard — one tab per game; tap a game to see its top players.
  async function showOverall() {
    const ov = modal(`<h2>🏆 Ilan Games Leaderboard</h2><p>Top players in each game</p>
      <div class="iga-tabs" id="iga-tabs"></div>
      <div class="iga-metric" id="iga-metric"></div>
      <div id="iga-lb">Loading…</div>
      <button class="iga-btn iga-x" id="iga-close" style="margin-top:10px">Close</button>`);
    ov.querySelector("#iga-close").onclick = () => ov.remove();
    const tabs = ov.querySelector("#iga-tabs"), box = ov.querySelector("#iga-lb"), metric = ov.querySelector("#iga-metric");
    let rows = [];
    if (sb) { try { const { data } = await sb.from("leaderboard").select("name,game,score,is_guest").order("score", { ascending: false }).limit(1000); rows = data || []; } catch (e) {} }
    // one row per (name, game): registered beats guest, keep highest score
    const map = {};
    for (const r of rows) {
      const k = r.name + "|" + r.game;
      if (!map[k]) map[k] = { name: r.name, game: r.game, score: r.score, is_guest: !!r.is_guest };
      else { map[k].score = Math.max(map[k].score, r.score); if (!r.is_guest) map[k].is_guest = false; }
    }
    // group by game
    const byGame = {};
    for (const v of Object.values(map)) { (byGame[v.game] = byGame[v.game] || []).push(v); }
    for (const g in byGame) byGame[g].sort((a, b) => b.score - a.score);
    // tab order: known games first (in GAME_TITLES order), then any others
    const order = Object.keys(GAME_TITLES).filter(g => byGame[g] && byGame[g].length);
    for (const g in byGame) if (!order.includes(g)) order.push(g);
    if (!order.length) { metric.textContent = ""; box.innerHTML = `<p>No scores yet — be the first!</p>`; return; }
    function render(g) {
      tabs.querySelectorAll(".iga-tab").forEach(t => t.classList.toggle("on", t.dataset.g === g));
      metric.textContent = GAME_METRIC[g] ? (GAME_METRIC[g] + " — higher is better") : "";
      box.innerHTML = byGame[g].slice(0, 20).map((r, i) => {
        const me = player && r.name === player.name;
        const nm = (r.name || "Player").replace(/[<>]/g, "") + (r.is_guest ? ` <small>(guest)</small>` : "");
        return `<div class="iga-row ${me ? "me" : ""}"><span class="r">${i + 1}</span><span class="n">${nm}</span><span class="sc">${r.score}</span></div>`;
      }).join("");
    }
    tabs.innerHTML = order.map(g => `<button class="iga-tab" data-g="${g}">${GAME_TITLES[g] || g}</button>`).join("");
    tabs.querySelectorAll(".iga-tab").forEach(t => t.onclick = () => render(t.dataset.g));
    render(order[0]);
  }

  // If a visitor isn't signed in but has on-device scores, auto-post them as a
  // guest so they show on the leaderboard, then nudge them to log in to claim it.
  function autoGuestSeed() {
    try {
      const s = storeLoad();
      const act = s.accounts.find(a => a.id === s.activeId) || s.accounts[0];
      const nm = act && act.name;
      if (!nm) return;
      let has = false;
      for (const g in GAME_BEST) { if (GAME_BEST[g](act) > 0) { has = true; break; } }
      try { const gk = JSON.parse(localStorage.getItem("basketCatchV2_guest")); if (gk && (gk.best || 0) > 0) has = true; } catch (e) {}
      try { const o = JSON.parse(localStorage.getItem("omt_save_v1")); if (o && (o.best || 0) > 0) has = true; } catch (e) {}
      if (!has) return;
      savePlayer({ name: nm, guest: true });
      migrateAndSeed(nm);
      setTimeout(nudgeLogin, 1600);
    } catch (e) {}
  }
  function nudgeLogin() {
    if (sessionStorage.getItem("iga_nudged")) return;
    try { sessionStorage.setItem("iga_nudged", "1"); } catch (e) {}
    injectStyles();
    const t = document.createElement("div");
    t.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9500;background:#0f1d36;border:1px solid #2a3c63;color:#fff;padding:12px 16px;border-radius:14px;font:14px -apple-system,system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:92vw;text-align:center";
    t.innerHTML = `🏆 Your scores are on the leaderboard as a <b>guest</b>. <b class="iga-link" id="iga-nudge-go">Log in to claim them</b> <span id="iga-nudge-x" style="color:#7e90b5;cursor:pointer;margin-left:8px">✕</span>`;
    document.body.appendChild(t);
    const go = t.querySelector("#iga-nudge-go"); if (go) go.onclick = () => { t.remove(); savePlayer(null); openAuth(); };
    const x = t.querySelector("#iga-nudge-x"); if (x) x.onclick = () => t.remove();
    setTimeout(() => t.remove(), 13000);
  }

  /* ---------- public API ---------- */
  window.IGAuth = {
    onReady: cb => { if (ready) cb(); else cbs.push(() => cb()); },
    onChange: cb => { cbs.push(cb); if (ready) cb(player); },
    getUser: () => player,
    isGuest: () => !!(player && player.guest),
    isReady: () => ready,
    openAuth, openAccount, signOut, submitScore, topScores, showLeaderboard, showOverall,
    displayName: () => player ? player.name : null,
  };
  init();
})();
