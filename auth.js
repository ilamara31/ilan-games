/* =====================================================================
   IGAuth — shared accounts + cross-player leaderboard (Supabase).
   - Email + password sign-up (with verification email), and Play as Guest
   - Auto-migrates existing on-device accounts/scores into the online account
   - submitScore(game, score) + showLeaderboard(game) helpers + a login/account modal
   Loaded like analytics.js:  <script src="../supabase-config.js"></script>
                              <script src="../auth.js" defer></script>
   ===================================================================== */
(function () {
  "use strict";
  const SUPA_URL = window.SUPABASE_URL, SUPA_KEY = window.SUPABASE_KEY;
  const STORE_KEY = "soc_store_v1";

  // How to read each game's "best" number from a stored account, for leaderboard
  // seeding/migration. (Used by submitScore + auto-migration.)
  const GAME_BEST = {
    catch:    a => (a.basket && a.basket.best) || 0,
    cricket:  a => ((a.ipl && a.ipl.runs) || 0) + ((a.odi && a.odi.runs) || 0),
    f1:       a => (a.f1 && a.f1.points) || 0,
    football: a => (a.pk && a.pk.won) || 0,
  };
  const NS = ["ipl", "odi", "basket", "f1", "pk", "puz"];   // per-game data namespaces

  let sb = null, user = null, ready = false;
  const changeCbs = [];

  /* ---------- soc_store_v1 helpers (same shape the games use) ---------- */
  function storeLoad() { try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && Array.isArray(s.accounts)) return s; } catch (e) {} return { activeId: null, accounts: [] }; }
  function storeSave(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  function displayName(u) { return (u.user_metadata && u.user_metadata.name) || (u.email ? u.email.split("@")[0] : "Player"); }

  /* ---------- merge on-device data into the online account ---------- */
  function mergeGameData(dest, src) {
    NS.forEach(k => {
      if (!src[k]) return;
      if (!dest[k]) { dest[k] = JSON.parse(JSON.stringify(src[k])); return; }
      for (const f in src[k]) {
        const v = src[k][f];
        if (typeof v === "number") dest[k][f] = Math.max(dest[k][f] || 0, v);   // keep the better number
        else if (dest[k][f] == null) dest[k][f] = v;
      }
      if (Array.isArray(src[k].owned)) dest[k].owned = Array.from(new Set([...(dest[k].owned || []), ...src[k].owned]));
    });
  }

  // Bring the player's existing device data into their uid account, then seed
  // the leaderboard. Runs once at sign-in. Safe to run again (idempotent merges).
  async function migrateLocalInto(u) {
    const s = storeLoad();
    let acct = s.accounts.find(a => a.id === u.id);
    // source = the local account they were using (active, non-online), else any local one
    const src = s.accounts.find(a => a.id === s.activeId && !a.supabase && a.id !== u.id)
             || s.accounts.find(a => !a.supabase);
    if (!acct) { acct = { id: u.id }; s.accounts.push(acct); }
    acct.name = displayName(u); acct.supabase = true; acct.email = u.email;
    if (src) mergeGameData(acct, src);
    // also fold the Basket Catch guest save, if any
    try {
      const g = JSON.parse(localStorage.getItem("basketCatchV2_guest"));
      if (g) {
        acct.basket = acct.basket || {};
        acct.basket.best  = Math.max(acct.basket.best  || 0, g.best  || 0);
        acct.basket.coins = Math.max(acct.basket.coins || 0, g.coins || 0);
        acct.basket.owned = Array.from(new Set([...(acct.basket.owned || ["starter"]), ...(g.owned || [])]));
        acct.basket.sel   = acct.basket.sel || g.sel || "starter";
      }
    } catch (e) {}
    s.activeId = u.id; storeSave(s);
    // push every known best up to the cloud leaderboard
    for (const game in GAME_BEST) { const v = GAME_BEST[game](acct); if (v > 0) await submitScore(game, v, true); }
  }

  // run migration once per device per user (covers password login AND email-link verify)
  async function ensureMigrated(u) {
    const flag = "igmig_" + u.id;
    if (localStorage.getItem(flag)) { const s = storeLoad(); if (s.activeId !== u.id) { s.activeId = u.id; storeSave(s); } return; }
    await migrateLocalInto(u);
    try { localStorage.setItem(flag, "1"); } catch (e) {}
  }

  function setActiveToLocal() {   // on sign-out: fall back to a local account (or none)
    const s = storeLoad();
    const local = s.accounts.find(a => !a.supabase);
    s.activeId = local ? local.id : null; storeSave(s);
  }

  /* ---------- Supabase SDK load + init ---------- */
  function loadSDK() {
    return new Promise(res => {
      if (window.supabase && window.supabase.createClient) return res(true);
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      sc.onload = () => res(true); sc.onerror = () => res(false);
      document.head.appendChild(sc);
    });
  }
  async function init() {
    if (!SUPA_URL || !SUPA_KEY) { console.warn("[IGAuth] missing Supabase config"); ready = true; return; }
    const ok = await loadSDK();
    if (!ok) { console.warn("[IGAuth] Supabase SDK failed to load"); ready = true; fire(); return; }
    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await sb.auth.getSession();
    user = data.session ? data.session.user : null;
    if (user) await ensureMigrated(user);
    ready = true; fire();
    sb.auth.onAuthStateChange((ev, session) => {
      user = session ? session.user : null;
      if (ev === "SIGNED_IN" && user) ensureMigrated(user);
      fire();
    });
  }
  function fire() { changeCbs.forEach(cb => { try { cb(user); } catch (e) {} }); }

  /* ---------- leaderboard ---------- */
  async function submitScore(game, score, quiet) {
    if (!sb || !user) return;
    score = Math.round(score || 0); if (!score) return;
    try {
      const { data } = await sb.from("leaderboard").select("score").eq("user_id", user.id).eq("game", game).maybeSingle();
      if (!data || score > data.score) {
        await sb.from("leaderboard").upsert(
          { user_id: user.id, game, name: displayName(user), score, updated_at: new Date().toISOString() },
          { onConflict: "user_id,game" });
      }
    } catch (e) { if (!quiet) console.warn("[IGAuth] submitScore failed", e); }
  }
  async function topScores(game, n) {
    if (!sb) return [];
    try {
      const { data } = await sb.from("leaderboard").select("name,score,user_id").eq("game", game).order("score", { ascending: false }).limit(n || 20);
      return data || [];
    } catch (e) { return []; }
  }

  /* ---------- auth actions ---------- */
  async function signUp(email, password, name) {
    if (!sb) return { error: "Not ready" };
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
    if (error) return { error: error.message };
    // with email confirmations on, no session is returned until they verify
    return { needsVerify: !data.session, user: data.user };
  }
  async function signIn(email, password) {
    if (!sb) return { error: "Not ready" };
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    await ensureMigrated(data.user);
    return { ok: true };
  }
  async function resend(email) { if (sb) await sb.auth.resend({ type: "signup", email }); }
  async function signOut() { if (sb) await sb.auth.signOut(); setActiveToLocal(); location.reload(); }

  /* ================= UI (self-contained modal) ================= */
  function injectStyles() {
    if (document.getElementById("igauth-css")) return;
    const css = document.createElement("style"); css.id = "igauth-css";
    css.textContent = `
    .iga-ov{position:fixed;inset:0;background:rgba(6,10,22,.72);backdrop-filter:blur(4px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:18px;font-family:-apple-system,'Segoe UI',system-ui,sans-serif}
    .iga-box{background:#0f1d36;border:1px solid #2a3c63;border-radius:18px;padding:22px;max-width:380px;width:100%;color:#fff;text-align:center;max-height:90vh;overflow:auto}
    .iga-box h2{font-size:22px;margin:0 0 6px}
    .iga-box p{font-size:13px;color:#9fb3d8;margin:0 0 12px;line-height:1.45}
    .iga-box input{width:100%;background:#0c1426;border:1px solid #2a3c63;color:#fff;padding:12px 14px;border-radius:10px;font-size:16px;margin:6px 0}
    .iga-btn{border:none;border-radius:24px;padding:12px 18px;font-size:15px;font-weight:800;cursor:pointer;margin:5px 4px;width:100%}
    .iga-p{background:linear-gradient(135deg,#39ff88,#1ea85a);color:#04220f}
    .iga-s{background:linear-gradient(135deg,#3a5fcd,#28408f);color:#fff}
    .iga-g{background:#26344f;color:#cfe0ff}
    .iga-x{background:transparent;color:#7e90b5;font-weight:700}
    .iga-link{color:#7cc0ff;cursor:pointer;font-size:13px;text-decoration:underline}
    .iga-msg{font-size:13px;margin:8px 0;min-height:16px}
    .iga-err{color:#ff8088}.iga-ok{color:#7CFFB2}
    .iga-row{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:10px;margin:4px 0;background:#16243f;font-size:15px}
    .iga-row.me{background:rgba(255,211,77,.18)}
    .iga-row .r{width:34px;color:#ffd54a;font-weight:800;text-align:left}
    .iga-row .n{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .iga-row .sc{font-weight:800;color:#ffd54a}`;
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
    if (user) return openAccount();
    const ov = modal(`
      <h2>Sign in / Sign up</h2>
      <p>Save your scores online and join the leaderboard. Or just play as a guest.</p>
      <input id="iga-email" type="email" placeholder="Email" autocomplete="email">
      <input id="iga-pwd" type="password" placeholder="Password" autocomplete="current-password">
      <input id="iga-name" type="text" placeholder="Display name (for a new account)" maxlength="16" autocomplete="nickname">
      <div class="iga-msg" id="iga-m"></div>
      <button class="iga-btn iga-p" id="iga-login">Log in</button>
      <button class="iga-btn iga-s" id="iga-signup">Create account</button>
      <button class="iga-btn iga-g" id="iga-guest">Play as Guest</button>
      <div style="margin-top:8px"><span class="iga-link" id="iga-resend">Resend verification email</span></div>`);
    const $ = id => ov.querySelector(id);
    const msg = (t, ok) => { const m = $("#iga-m"); m.textContent = t; m.className = "iga-msg " + (ok ? "iga-ok" : "iga-err"); };
    const email = () => $("#iga-email").value.trim(), pwd = () => $("#iga-pwd").value;
    const nameVal = () => ($("#iga-name").value.trim() || email().split("@")[0] || "Player").slice(0, 16);
    $("#iga-login").onclick = async () => {
      if (!email() || !pwd()) return msg("Enter your email and password.");
      msg("Logging in…", true);
      const r = await signIn(email(), pwd());
      if (r.error) msg(/confirm/i.test(r.error) ? "Please verify your email first (check your inbox)." : r.error);
      else { msg("Welcome back!", true); location.reload(); }
    };
    $("#iga-signup").onclick = async () => {
      if (!email() || pwd().length < 6) return msg("Use a valid email and a password of 6+ characters.");
      msg("Creating account…", true);
      const r = await signUp(email(), pwd(), nameVal());
      if (r.error) msg(r.error);
      else if (r.needsVerify) msg("Account made! Check your email to verify, then Log in.", true);
      else { await ensureMigrated(r.user); location.reload(); }
    };
    $("#iga-guest").onclick = () => ov.remove();
    $("#iga-resend").onclick = async () => { if (!email()) return msg("Enter your email above first."); await resend(email()); msg("Verification email sent.", true); };
  }

  function openAccount() {
    const ov = modal(`
      <h2>👤 ${displayName(user)}</h2>
      <p>${user.email || ""}</p>
      <button class="iga-btn iga-s" id="iga-switch">Log out / switch account</button>
      <button class="iga-btn iga-x" id="iga-close">Close</button>`);
    ov.querySelector("#iga-switch").onclick = () => signOut();
    ov.querySelector("#iga-close").onclick = () => ov.remove();
  }

  async function showLeaderboard(game, title) {
    const ov = modal(`<h2>🏆 ${title || "Leaderboard"}</h2><p>All-time best scores</p><div id="iga-lb">Loading…</div>
      <button class="iga-btn iga-x" id="iga-close" style="margin-top:10px">Close</button>`);
    ov.querySelector("#iga-close").onclick = () => ov.remove();
    const rows = await topScores(game, 20);
    const box = ov.querySelector("#iga-lb");
    if (!rows.length) { box.innerHTML = `<p>No scores yet — be the first! ${user ? "" : "(log in to post yours)"}</p>`; return; }
    box.innerHTML = rows.map((r, i) =>
      `<div class="iga-row ${user && r.user_id === user.id ? "me" : ""}"><span class="r">${i + 1}</span><span class="n">${(r.name || "Player").replace(/[<>]/g, "")}</span><span class="sc">${r.score}</span></div>`
    ).join("");
  }

  /* ---------- public API ---------- */
  window.IGAuth = {
    onReady: cb => { if (ready) cb(); else changeCbs.push(() => cb()); },
    onChange: cb => { changeCbs.push(cb); if (ready) cb(user); },
    getUser: () => user,
    isReady: () => ready,
    openAuth, openAccount, signOut, submitScore, topScores, showLeaderboard,
    displayName: () => user ? displayName(user) : null,
  };
  init();
})();
