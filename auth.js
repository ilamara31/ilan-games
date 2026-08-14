/* =====================================================================
   IGAuth — username + password accounts + per-game leaderboard.
   No email, no verification, NO guests: you need an account to play and to
   appear on any leaderboard. Backed by Supabase RPCs (passwords hashed
   server-side, so a wrong password can never get into someone's account).
   There is no password recovery — the password is shown back to you in
   👤 My Profile on the device you're signed in on, so you can't forget it.
   Loaded like analytics.js:  <script src="../supabase-config.js"></script>
                              <script src="../auth.js" defer></script>
   ===================================================================== */
(function () {
  "use strict";
  const SUPA_URL = window.SUPABASE_URL, SUPA_KEY = window.SUPABASE_KEY;
  const STORE_KEY = "soc_store_v1", PKEY = "ig_player";

  const NS = ["ipl", "odi", "basket", "f1", "pk", "puz"];
  const GAME_TITLES = {
    catch: "Basket Catch", cricket: "Super Over Cricket", f1: "Grand Prix", football: "Penalty Kings",
    try: "One More Try", puzzles: "Puzzle Pad", obby: "Rainbow Obby", "anime-tycoon": "Anime Tycoon",
    tennis: "Tennis", karate: "Karate", "fruit-arena": "Fruit Arena", pptour: "Ping Pong Tour",
    paper: "Paper Territory", stack: "Stack Tower", archer: "Archer Duel", airhockey: "Air Hockey Arena",
    scoop: "Basket Scoop", meme: "Meme Studio", drawrush: "Draw Rush", stars: "⭐ Stars"
  };
  // Dropped/retired games — their leftover scores must never show as a leaderboard tab.
  const HIDDEN_GAMES = new Set(["cricket2bowl", "cricket2bat", "rescue"]);  // Super Over Cricket 2 (dropped); rescue (removed) — hides any leftover scores
  // Auto-generated "Guest-1234" identities (test runs / one-off visits) are noise,
  // not players — never show them on any leaderboard.
  function isAutoGuest(n) { return /^guest[-_ ]?\d{3,}$/i.test(String(n || "").trim()); }
  const GAME_METRIC = {
    catch: "Best score", cricket: "Career runs", f1: "Money earned", football: "Matches won",
    try: "Best level", puzzles: "Puzzles solved", obby: "Best stage", "anime-tycoon": "Net worth",
    tennis: "Trophies", karate: "Wins", "fruit-arena": "Best score", pptour: "Matches won",
    paper: "Territory %", stack: "Tallest stack", archer: "Best level", airhockey: "Matches won",
    scoop: "Best in 60s", meme: "Memes published", drawrush: "Drawings published",
    stars: "Stars earned (Game of the Day & Week goals)"
  };
  // player = {name, pw, guest:false, loginAt, since}
  let sb = null, ready = false, player = null;
  // True between swapping the device's saves and the reload that follows: the
  // page still holds the OTHER account's data in memory, so nothing may be
  // posted until it has reloaded.
  let swapping = false;
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
  function loadPlayer() { try { const p = JSON.parse(localStorage.getItem(PKEY)); if (p && p.name && !p.guest) return p; } catch (e) {} return null; }
  function savePlayer(p) { player = p; try { if (p) { localStorage.setItem(PKEY, JSON.stringify(p)); } else localStorage.removeItem(PKEY); } catch (e) {} fire(); }

  /* ---------- per-account save vault ----------------------------------
     Every game on this origin writes to the SAME localStorage, so a second
     account made on one device used to open up already holding the first
     account's progress — and the moment it played one round it posted that
     progress to the leaderboard under the new name.
     Fix: exactly one account "owns" the live game saves at a time. On every
     account change we stash the owner's keys into their own vault, wipe the
     live keys, then restore the incoming account's vault (nothing to restore
     for a brand-new account → it starts genuinely from zero). Nothing is ever
     deleted: log back in as the old account and its progress comes straight
     back. Keys listed here are PROGRESS; device settings (tutorial-seen flags,
     multiplayer nicknames, caches) are deliberately left shared.            */
  const VKEY = "ig_vault_", VOWNER = "ig_vault_owner", VDECLINED = "ig_vault_declined";
  const OWNED_KEYS = [
    // per-game saves
    "airHockeyArena_v1", "animeTycoon_v1", "archerDuel_v1", "basketCatchV2_guest",
    "basketCatch2_guest", "basketCatchHigh", "basketScoop_v1", "cb_secret_agent_v1",
    "cricTourLive_v1", "cw_save_v1", "draw_rush_v1", "dr_gallery_key", "fruitArena_v1",
    "hcl_save_v1", "ilanObbySave_v1", "karateChamp_v1", "ms_pub_count_v1", "omt_save_v1",
    "paperTerritory_v1", "penaltyKings_v1", "ppTour_v2", "soc_profile_v2",
    "stackTower_v1", "tennisTour_v1", "thisOrThat_v2",
    // hub: stars, passport, Game of the Day/Week goal tracking
    "iglb_local",                       // this account's offline copy of the board
    "ig_stars", "ig_played", "ig_lastplay", "ig_champion",
    "ig_day_base", "ig_week_base", "ig_claim_day", "ig_claim_week"
  ];
  const OWNED_PREFIXES = ["igsent_", "pcreator_", "stackTower_v1__", "tennisTour_v1__", "archerDuel_v1__"];
  const NOT_OWNED = ["pcreator_searchState", "pcreator_seeded"];   // UI state, not progress
  // Bookkeeping the hub rewrites on every visit — real progress must exist
  // alongside these before we call a device "has unclaimed progress".
  const TRIVIAL_KEYS = ["ig_day_base", "ig_week_base"];
  // Caches of the signed-in player's own social data — wiped on a switch and
  // refetched from the server for the new account (never carried over).
  const WIPE_ON_SWITCH = ["ig_my_profile", "ig_friends_cache", "ig_friend_keys", "ig_uotw_shown"];

  // The vault id of an account. The server treats usernames case-insensitively
  // and nothing else, so we do exactly the same — NOT a slug: squashing spaces,
  // "-" and "_" together would give "Ilan 1" and "Ilan-1" (two real, separate
  // accounts) one shared vault, and each would open holding the other's saves.
  // "u:" keeps every real name clear of the ORPHAN bucket below.
  function acctVault(n) { return "u:" + String(n || "").trim().toLowerCase().slice(0, 64); }
  // Progress on a device that no account has claimed (played before signing up,
  // or after a log out). Real accounts are all "u:…", so this can never clash.
  const ORPHAN = "device:unclaimed";
  function ownedKeys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || NOT_OWNED.indexOf(k) >= 0 || k.indexOf(VKEY) === 0) continue;
        if (OWNED_KEYS.indexOf(k) >= 0 || OWNED_PREFIXES.some(p => k.indexOf(p) === 0)) out.push(k);
      }
    } catch (e) {}
    return out;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function vaultOwner() { return lsGet(VOWNER) || ""; }
  // Write the live keys into `owner`'s vault. Returns false if the write did not
  // land (storage full, private mode) — the caller must then NOT wipe anything,
  // or the player's progress would be erased with no copy of it anywhere.
  function vaultStash(owner) {
    if (!owner) return false;
    const blob = {}; ownedKeys().forEach(k => { blob[k] = lsGet(k); });
    // The unclaimed bucket can be filled more than once (several signed-out
    // sessions between logins), so merge into it — never flatten what's there.
    if (owner === ORPHAN) {
      const had = vaultBlob(owner);
      for (const k in had) { if (blob[k] == null) blob[k] = had[k]; }
    }
    const s = JSON.stringify(blob);
    if (!lsSet(VKEY + owner, s)) return false;
    return lsGet(VKEY + owner) === s;                     // read it back — trust nothing
  }
  function vaultWipe() { ownedKeys().concat(WIPE_ON_SWITCH).forEach(lsDel); }
  function vaultBlob(owner) {
    let blob = null; try { blob = JSON.parse(lsGet(VKEY + owner)); } catch (e) {}
    return (blob && typeof blob === "object") ? blob : {};
  }
  function vaultRestore(owner) {
    const blob = vaultBlob(owner);
    for (const k in blob) { if (blob[k] != null) lsSet(k, blob[k]); }
  }
  // Hand the device's game saves to `name`.
  //   "same"   already this account's device — nothing to do
  //   "moved"  saves swapped; the caller reloads (games read storage at load)
  //   "full"   storage wouldn't take the stash — NOTHING was touched, abort
  function useProfile(name) {
    const next = acctVault(name); if (next === "u:") return "same";
    const cur = vaultOwner();
    if (cur === next) return "same";                      // already this account's device

    // Whatever is live belongs to the current owner — or to nobody, in which
    // case it goes to the unclaimed bucket. Either way it is parked before a
    // single key is removed, and a park that doesn't land aborts the whole
    // switch: erasing someone's progress is never an acceptable failure.
    if (!cur && !lsGet(VKEY + next)) {
      // Nobody has claimed this device yet — the first run of this build with a
      // player already signed in. With no vault of their own, the saves sitting
      // here are theirs: adopt them as-is rather than wiping their history.
      lsSet(VOWNER, next); return "same";
    }
    if (ownedKeys().length && !vaultStash(cur || ORPHAN)) return "full";
    vaultWipe(); vaultRestore(next);
    lsSet(VOWNER, next);
    return "moved";
  }
  // Log out: park this account's saves and clear the device, so the next person
  // to sign in here never sees the previous player's data. Anything played
  // while signed out afterwards belongs to nobody → the ORPHAN bucket.
  // If the park can't be written we leave the saves alone rather than destroy
  // them; the device still stops belonging to the account that just left.
  function vaultRelease() {
    const parked = !ownedKeys().length || vaultStash(vaultOwner() || ORPHAN);
    if (parked) vaultWipe();
    lsSet(VOWNER, ORPHAN);
    return parked;
  }
  // Nobody has claimed this device (first run of this build with no one signed
  // in, an old guest session, or play after a log out). Park it under ORPHAN so
  // the next account can't inherit it by accident. Nothing is deleted — the
  // first NEW account made here is offered it, once.
  function claimOrphanSaves() { if (!vaultOwner()) lsSet(VOWNER, ORPHAN); }
  function hasOrphanSaves() {
    if (lsGet(VDECLINED) === "1") return false;                 // already asked, they said no
    if (lsGet(VKEY + ORPHAN)) return true;                      // parked by an earlier log out
    return vaultOwner() === ORPHAN && ownedKeys().some(k => TRIVIAL_KEYS.indexOf(k) < 0);
  }
  // Asked once, when someone makes their FIRST account on a device that was
  // played without one. Their choice, never automatic — and never offered when
  // signing in to an account that already has its own history.
  // Returns an undo(), because the sign-in after it can still fail.
  function offerOrphanSaves(name) {
    const owner0 = lsGet(VOWNER), declined0 = lsGet(VDECLINED);
    const wroteLive = [];             // live keys this call created
    let wroteVault = "";              // vault this call created
    const undo = () => {
      if (owner0 == null) lsDel(VOWNER); else lsSet(VOWNER, owner0);
      if (declined0 == null) lsDel(VDECLINED); else lsSet(VDECLINED, declined0);
      wroteLive.forEach(lsDel);       // …and everything it handed over, or the
      if (wroteVault) lsDel(wroteVault);   // retry would inherit what it refused
    };
    if (!hasOrphanSaves()) return undo;
    let keep = false;
    try {
      keep = window.confirm("This device has game progress saved from before you had an account.\n\n"
        + "OK  —  keep it in your new account “" + name + "”\n"
        + "Cancel  —  start “" + name + "” from zero (the old progress stays saved on this device)");
    } catch (e) {}
    if (!keep) { lsSet(VDECLINED, "1"); return undo; }          // keep the data, just stop asking
    const mine = acctVault(name);
    if (vaultOwner() === ORPHAN) {
      // It's live on the device. Bring back anything parked by an earlier
      // signed-out session too, then hand the lot over — nothing is dropped.
      const parked = vaultBlob(ORPHAN);
      for (const k in parked) {
        if (parked[k] != null && lsGet(k) == null && lsSet(k, parked[k])) wroteLive.push(k);
      }
      lsSet(VOWNER, mine);
    } else {
      // Someone else's saves are live; the unclaimed ones are parked. Make the
      // parked bucket this account's vault — useProfile restores it in a moment.
      const parked = lsGet(VKEY + ORPHAN);
      if (parked && !lsGet(VKEY + mine) && lsSet(VKEY + mine, parked)) wroteVault = VKEY + mine;
    }
    lsSet(VDECLINED, "1");                                      // asked, and answered
    return undo;
  }

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
    // case-insensitive, like the server — otherwise signing in as "ilan" after
    // "Ilan" would make a second, empty soc_store account and every cricket /
    // F1 / Penalty Kings / Puzzle Pad stat would read as zero.
    let acct = s.accounts.find(a => String(a.name).trim().toLowerCase() === String(name).trim().toLowerCase());
    if (!acct) { acct = { id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name }; s.accounts.push(acct); }
    // NOTE: we deliberately do NOT merge scores from other on-device accounts.
    // Each account keeps its own progress + leaderboard — switching must never copy scores.
    // fold Basket Catch guest + legacy saves
    try {
      const g = JSON.parse(localStorage.getItem("basketCatchV2_guest"));
      if (g) { acct.basket = acct.basket || {}; acct.basket.best = Math.max(acct.basket.best || 0, g.best || 0); acct.basket.coins = Math.max(acct.basket.coins || 0, g.coins || 0); acct.basket.owned = Array.from(new Set([...(acct.basket.owned || ["starter"]), ...(g.owned || [])])); acct.basket.sel = acct.basket.sel || g.sel || "starter"; }
    } catch (e) {}
    try { const lh = +(localStorage.getItem("basketCatchHigh") || 0); if (lh > 0) { acct.basket = acct.basket || {}; acct.basket.best = Math.max(acct.basket.best || 0, lh); } } catch (e) {}
    s.activeId = acct.id; storeSave(s);
    return acct;
  }
  // Make `name` the active soc_store account. Scores are NEVER bulk-seeded from
  // device saves — they only reach the board when this account plays a round.
  function migrateAndSeed(name) { setActiveByName(name); }

  /* ---------- Supabase client (anon — only for RPC + leaderboard reads) ---------- */
  function loadSDK() {
    return new Promise(res => {
      if (window.supabase && window.supabase.createClient) return res(true);
      const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s);
    });
  }
  async function init() {
    // one-time cleanup: earlier builds bulk-seeded on-device scores under the active
    // account, so a shared device could show one player's scores under another. Wipe
    // the local board + cache once; it repopulates cleanly from the server + real plays.
    try {
      if (localStorage.getItem("iglb_reset_v2") !== "1") {
        localStorage.removeItem("iglb_local");
        localStorage.removeItem("iglb_cache");
        localStorage.setItem("iglb_reset_v2", "1");
      }
    } catch (e) {}
    if (!SUPA_URL || !SUPA_KEY) { console.warn("[IGAuth] missing Supabase config"); ready = true; return; }
    const ok = await loadSDK();
    if (ok) sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
    player = loadPlayer();
    if (player) {
      // Point the device's game saves at this account. Normally a no-op (the
      // account change already did it, then reloaded) — but if another tab
      // switched account under us, reload so games re-read the right saves.
      if (useProfile(player.name) === "moved") { swapping = true; location.reload(); return; }
      migrateAndSeed(player.name);
    } else {
      claimOrphanSaves();                       // don't let the next sign-up inherit them
      setTimeout(promptLogin, 500);             // accounts only — no guest play
    }
    // ⭐ upload this device's stars from ANY page (home or game) so everyone with
    // stars lands on the Star Leaderboard on their first visit after the update
    try { const n = Math.round(+JSON.parse(localStorage.getItem("ig_stars") || "0") || 0); if (n > 0) submitScore("stars", n); } catch (e) {}
    ready = true;
    // Games that post a saved best as soon as the page loads can beat us to it
    // (we have to fetch the Supabase SDK first). Those calls were parked — send
    // them now that we know who the player is.
    const q = pendingScores.splice(0); q.forEach(s => submitScore(s[0], s[1]));
    fire();
    setTimeout(fetchBoard, 800);                // warm the leaderboard cache so it opens instantly
    watchOtherTabs();
  }
  // Another tab signed in, switched account or logged out: this tab's games are
  // still holding the previous account's saves in memory, so reload rather than
  // let them write one player's progress into another player's storage.
  function watchOtherTabs() {
    try {
      window.addEventListener("storage", e => {
        if (!e || (e.key !== VOWNER && e.key !== PKEY)) return;
        const now = loadPlayer(), nowName = now && now.name, curName = player && player.name;
        if (nowName !== curName) location.reload();
        else if (curName && vaultOwner() !== acctVault(curName)) location.reload();
      });
    } catch (e) {}
  }
  // Not signed in → ask for an account. Closable, so a server hiccup can never
  // lock anyone out of the page; scores simply don't count until you sign in.
  function promptLogin() {
    if (player) return;
    if (document.querySelector(".iga-ov")) return;          // something else is already open
    openAuth();
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

  /* ---------- local leaderboard fallback (always works, even offline / not logged in) ---------- */
  function localRows() { try { const a = JSON.parse(localStorage.getItem("iglb_local")); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  // Only ever records under the signed-in account — there is no guest identity.
  function recordLocal(game, score) {
    score = Math.round(score || 0); if (!score || !player) return;
    const name = player.name, a = localRows(), row = a.find(r => r.name === name && r.game === game);
    if (row) { if (score > row.score) row.score = score; row.is_guest = false; }
    else a.push({ name, game, score, is_guest: false });
    try { localStorage.setItem("iglb_local", JSON.stringify(a)); } catch (e) {}
  }
  function mergeLocal(rows) { return (rows || []).concat(localRows()); }

  /* ---------- leaderboard ---------- */
  // No account = no score. Nothing reaches any leaderboard unless a signed-in
  // account actually played, so a new account on a shared device starts at zero.
  const pendingScores = [];
  async function submitScore(game, score) {
    score = Math.round(score || 0); if (!score || swapping) return;
    if (!player) {
      // Still working out who's signed in (the Supabase SDK loads over the
      // network). Park it rather than drop it — but only until we know.
      if (!ready && pendingScores.length < 40) pendingScores.push([game, score]);
      return;
    }
    recordLocal(game, score);                 // local fallback board (works offline)
    if (!sb) return;
    // skip the network call if we've already posted this score (or higher) for this player
    const ck = "igsent_" + game + "_" + player.name;
    try { if (+(localStorage.getItem(ck) || 0) >= score) return; } catch (e) {}
    try {
      await callRpc("post_score", { p_name: player.name, p_password: player.pw || "", p_game: game, p_score: score, p_guest: false });
      try { localStorage.setItem(ck, score); } catch (e) {}   // remember success so we don't re-post; if it threw, we'll retry next load
    } catch (e) {}
  }
  // ---- leaderboard cache: load is instant from cache, then refreshed in the background ----
  let boardRows = null;
  function cachedBoard() {
    if (boardRows) return boardRows;
    try { const c = JSON.parse(localStorage.getItem("iglb_cache")); if (c && Array.isArray(c.rows)) { boardRows = c.rows; return boardRows; } } catch (e) {}
    return null;
  }
  async function fetchBoard() {
    if (!sb) return boardRows || [];
    try {
      const { data } = await sb.from("leaderboard").select("name,game,score,is_guest").order("score", { ascending: false }).limit(1000);
      boardRows = data || [];
      try { localStorage.setItem("iglb_cache", JSON.stringify({ t: Date.now(), rows: boardRows })); } catch (e) {}
      return boardRows;
    } catch (e) { return boardRows || []; }
  }
  async function topScores(game, n) {
    await fetchBoard();
    return mergeLocal(boardRows || []).filter(r => r.game === game && !isAutoGuest(r.name)).sort((a, b) => b.score - a.score).slice(0, n || 20);
  }

  /* ---------- account rules ---------- */
  const PW_MIN = 4;
  function checkName(n) {
    n = (n || "").trim();
    if (!n) return "Enter a username.";
    if (n.length < 3) return "Username must be at least 3 characters.";
    if (n.length > 16) return "Username must be 16 characters or less.";
    if (!/^[A-Za-z0-9 _-]+$/.test(n)) return "Username can only use letters, numbers, spaces, - and _.";
    if (!/[A-Za-z0-9]/.test(n)) return "Username needs at least one letter or number.";
    if (isAutoGuest(n)) return "Pick a different username.";
    return "";
  }
  function checkPw(p) {
    p = p || "";
    if (!p) return "Enter a password.";
    if (p.length < PW_MIN) return "Password must be at least " + PW_MIN + " characters.";
    if (p.length > 64) return "Password must be 64 characters or less.";
    return "";
  }
  // The strict RPCs (account_signup / account_login) live in accounts-setup.sql.
  // Until that file has been run in Supabase we fall back to the old
  // account_auth RPC so the site keeps working — see README of that file.
  function fnMissing(error) {
    const m = ((error && (error.message || error.details || error.code)) || "") + "";
    return /PGRST202|could not find the function|function .* does not exist|schema cache/i.test(m);
  }

  /* ---------- account actions ---------- */
  // Everything that changes who is signed in goes through here, so the save
  // vault and the soc_store active account can never drift apart.
  // Order matters. savePlayer() fires onChange synchronously, and several games
  // re-submit their score from that callback — so the device's saves AND the
  // active soc_store account must already be the new player's, or the outgoing
  // player's progress gets posted to the leaderboard under the incoming name.
  function enterAccount(name, pw, isNew) {
    const prev = loadPlayer();
    const since = (!isNew && prev && prev.name === name && prev.since) ? prev.since : Date.now();
    const undoOffer = isNew ? offerOrphanSaves(name) : null;   // pre-account progress here? their call
    if (useProfile(name) === "full") {          // 1. saves
      if (undoOffer) undoOffer();               // the sign-in failed — don't burn the one-time offer
      return "This browser's storage is full, so your accounts can't be kept apart. Free up space and try again.";
    }
    migrateAndSeed(name);                       // 2. active account
    savePlayer({ name, pw, guest: false, loginAt: Date.now(), since });   // 3. only now, tell everyone
    loadAccountInfo();                          // fill in the real "member since" from the server
    return "";
  }

  async function signUp(name, pw) {
    name = (name || "").trim();
    const nErr = checkName(name); if (nErr) return { error: nErr };
    const pErr = checkPw(pw); if (pErr) return { error: pErr };
    if (!sb) return { error: "Connecting… try again in a moment." };
    try {
      let { data, error } = await callRpc("account_signup", { p_name: name, p_password: pw });
      if (error && fnMissing(error)) {   // legacy server: account_auth creates on first use
        const r = await callRpc("account_auth", { p_name: name, p_password: pw, p_recovery: null });
        error = r.error; data = r.data === "created" ? "ok" : (r.data === "ok" || r.data === "wrong") ? "taken" : r.data;
      }
      if (error) return { error: error.message };
      if (data === "taken") {
        // The account may be one WE just made, whose sign-in then failed (e.g.
        // storage was full). Finishing it needs the right password, so this is
        // simply a log in — someone else's name with a wrong password still
        // gets the "taken" message below.
        const retry = await logIn(name, pw, true);
        return retry.ok ? retry : { error: "“" + name + "” is already taken — pick another username." };
      }
      if (data === "invalid") return { error: "That username or password isn't allowed." };
      if (data !== "ok") return { error: "Could not create the account. Try again." };
      const problem = enterAccount(name, pw, true);
      return problem ? { error: problem } : { ok: true };
    } catch (e) { return { error: netMsg(e) }; }
  }

  // asNew: this is the first time this account has been used on this device, so
  // it is still offered any pre-account progress sitting here.
  async function logIn(name, pw, asNew) {
    name = (name || "").trim();
    if (!name) return { error: "Enter your username." };
    if (!pw) return { error: "Enter your password." };
    if (!sb) return { error: "Connecting… try again in a moment." };
    try {
      let { data, error } = await callRpc("account_login", { p_name: name, p_password: pw });
      if (error && fnMissing(error)) {   // legacy server
        const r = await callRpc("account_auth", { p_name: name, p_password: pw, p_recovery: null });
        error = r.error; data = r.data === "created" ? "nouser" : r.data;
      }
      if (error) return { error: error.message };
      if (data === "nouser") return { error: "No account called “" + name + "”. Check the spelling, or create a new account." };
      if (data === "wrong") return { error: "Wrong password for “" + name + "”. Passwords can't be recovered — try again." };
      if (data === "invalid") return { error: "Enter your username and password." };
      // account_login answers "ok:<the name as stored>" so we always use the
      // server's own spelling. Two legacy accounts can differ only by case
      // ("Bob"/"bob"); keying anything off what was typed would give them one
      // shared vault and one shared soc_store row.
      if (String(data).slice(0, 2) !== "ok") return { error: "Could not sign in. Try again." };
      const canon = String(data).slice(3).trim();
      if (canon) name = canon;
      const problem = enterAccount(name, pw, !!asNew);
      return problem ? { error: problem } : { ok: true };
    } catch (e) { return { error: netMsg(e) }; }
  }

  function signOut() {
    try { const s = storeLoad(); s.activeId = null; storeSave(s); } catch (e) {}   // no active soc_store account either
    vaultRelease();                                                               // park this account's saves; clear the device
    savePlayer(null); location.reload();
  }

  // Switch to a DIFFERENT existing account (username + password of THAT account).
  // Loads that account's own saves + leaderboard — never copies the current one's.
  async function switchAccount(name, pw) {
    name = (name || "").trim();
    if (player && player.name && name.toLowerCase() === player.name.toLowerCase())
      return { error: "You're already signed in as " + name + "." };
    return await logIn(name, pw);
  }

  /* ---------- account info (member since / last login, from the server) ---------- */
  function loadAccountInfo() {
    if (!sb || !player) return Promise.resolve(null);
    const who = player.name;
    return callRpc("account_info", { p_name: who, p_password: player.pw || "" }).then(r => {
      if (r.error || !r.data) return null;
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      const p = loadPlayer();
      if (p && p.name === who && d && d.created_at) {
        const t = Date.parse(d.created_at);
        if (t && (!p.since || t < p.since)) { p.since = t; savePlayer(p); }
      }
      return d;
    }).catch(() => null);
  }

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
    .iga-metric{font-size:12px;color:#8aa0c6;margin:-2px 0 8px}
    .iga-seg{display:flex;gap:6px;background:#0c1426;border:1px solid #2a3c63;border-radius:24px;padding:4px;margin:2px 0 12px}
    .iga-seg button{flex:1;background:transparent;border:none;color:#9fb3d8;font:800 14px -apple-system,system-ui,sans-serif;padding:9px 6px;border-radius:20px;cursor:pointer}
    .iga-seg button.on{background:linear-gradient(135deg,#39ff88,#1ea85a);color:#04220f}
    .iga-fld{display:flex;align-items:center;gap:10px;background:#16243f;border-radius:12px;padding:11px 13px;margin:6px 0;text-align:left}
    .iga-fld .k{font-size:12px;color:#8aa0c6;font-weight:700;flex:0 0 96px}
    .iga-fld .v{flex:1;font-size:15px;font-weight:700;color:#fff;word-break:break-word}
    .iga-fld .v small{font-weight:600;color:#8aa0c6}
    .iga-eye{background:#26344f;border:none;color:#cfe0ff;font:700 12px -apple-system,system-ui,sans-serif;padding:6px 11px;border-radius:14px;cursor:pointer}
    .iga-warn{background:rgba(255,180,60,.12);border:1px solid rgba(255,180,60,.35);color:#ffcf80;font-size:12.5px;line-height:1.45;border-radius:12px;padding:10px 12px;margin:10px 0;text-align:left}`;
    document.head.appendChild(css);
  }
  function modal(html) {
    injectStyles();
    const ov = document.createElement("div"); ov.className = "iga-ov";
    ov.innerHTML = `<div class="iga-box">${html}</div>`;
    ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov); return ov;
  }

  // Log in / Create account. One screen, two tabs. No guest play, no recovery
  // word: the password is the only key to the account, and 👤 My Profile keeps
  // showing it to you on this device so you can't lose it.
  function openAuth(startTab) {
    if (player) return openAccount();
    let tab = startTab === "new" ? "new" : "in";
    const ov = modal(`
      <h2>🎮 Ilan Games account</h2>
      <p>You need an account to play and to appear on the leaderboards — no email needed.</p>
      <div class="iga-seg"><button id="iga-t-in">Log in</button><button id="iga-t-new">Create account</button></div>
      <input id="iga-name" type="text" placeholder="Username" maxlength="16" autocomplete="username" autocapitalize="off" spellcheck="false">
      <input id="iga-pwd" type="password" placeholder="Password" autocomplete="current-password">
      <input id="iga-pwd2" type="password" placeholder="Type the password again" autocomplete="new-password" style="display:none">
      <div class="iga-warn" id="iga-note" style="display:none">⚠️ <b>Remember this password.</b> There is no recovery word and no reset — if you forget it you cannot get back into this account. You can always see it again in 👤 My Profile while you're signed in on this device.</div>
      <div class="iga-msg" id="iga-m"></div>
      <button class="iga-btn iga-p" id="iga-go">Log in</button>
      <button class="iga-btn iga-x" id="iga-close">Close</button>`);
    const $ = id => ov.querySelector(id);
    const msg = (t, ok) => { const m = $("#iga-m"); m.textContent = t; m.className = "iga-msg " + (ok ? "iga-ok" : "iga-err"); };
    function paint() {
      const isNew = tab === "new";
      $("#iga-t-in").className = isNew ? "" : "on";
      $("#iga-t-new").className = isNew ? "on" : "";
      $("#iga-pwd2").style.display = isNew ? "" : "none";
      $("#iga-note").style.display = isNew ? "" : "none";
      $("#iga-pwd").setAttribute("autocomplete", isNew ? "new-password" : "current-password");
      $("#iga-go").textContent = isNew ? "Create my account" : "Log in";
      msg("");
    }
    $("#iga-t-in").onclick = () => { tab = "in"; paint(); };
    $("#iga-t-new").onclick = () => { tab = "new"; paint(); };
    $("#iga-go").onclick = async () => {
      const nm = $("#iga-name").value, pw = $("#iga-pwd").value;
      if (tab === "new") {
        if ($("#iga-pwd2").value !== pw) return msg("The two passwords don't match.");
        msg("Creating your account…", true);
        const r = await signUp(nm, pw);
        if (r.error) msg(r.error); else location.reload();
      } else {
        msg("Checking…", true);
        const r = await logIn(nm, pw);
        if (r.error) msg(r.error); else location.reload();
      }
    };
    $("#iga-name").addEventListener("keydown", e => { if (e.key === "Enter") $("#iga-pwd").focus(); });
    $("#iga-pwd").addEventListener("keydown", e => { if (e.key === "Enter") { if (tab === "new") $("#iga-pwd2").focus(); else $("#iga-go").click(); } });
    $("#iga-pwd2").addEventListener("keydown", e => { if (e.key === "Enter") $("#iga-go").click(); });
    $("#iga-close").onclick = () => ov.remove();
    paint();
  }

  function fmtDate(t) {
    if (!t) return "—";
    try { return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); }
    catch (e) { return new Date(t).toString(); }
  }
  function fmtDay(t) {
    if (!t) return "—";
    try { return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return new Date(t).toString(); }
  }
  const esc = s => String(s == null ? "" : s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  // 👤 My Profile — username, password (hidden until you tap Show), when you
  // signed in, and when the account was made. Opened from the account button
  // on the home page and inside every game.
  function openAccount() {
    if (!player) return openAuth();
    const pw = player.pw || "";
    const ov = modal(`
      <h2>👤 My Profile</h2>
      <p>Your account details on this device.</p>
      <div class="iga-fld"><span class="k">Username</span><span class="v">${esc(player.name)}</span></div>
      <div class="iga-fld"><span class="k">Password</span><span class="v" id="iga-pw">${pw ? "•".repeat(Math.min(pw.length, 16)) : "—"}</span>${pw ? `<button class="iga-eye" id="iga-pweye">Show</button>` : ``}</div>
      <div class="iga-fld"><span class="k">Signed in</span><span class="v">${esc(fmtDate(player.loginAt))}</span></div>
      <div class="iga-fld"><span class="k">Member since</span><span class="v" id="iga-since">${esc(fmtDay(player.since))}</span></div>
      <div class="iga-warn">🔑 Keep this password safe. There is no reset — if you forget it, the account can't be opened again.</div>
      <button class="iga-btn iga-g" id="iga-switch">🔄 Switch account</button>
      <button class="iga-btn iga-g" id="iga-logout">🚪 Log out</button>
      <button class="iga-btn iga-x" id="iga-close">Close</button>`);
    const eye = ov.querySelector("#iga-pweye");
    if (eye) eye.onclick = () => {
      const el = ov.querySelector("#iga-pw"), shown = eye.textContent === "Hide";
      el.textContent = shown ? "•".repeat(Math.min(pw.length, 16)) : pw;
      eye.textContent = shown ? "Show" : "Hide";
    };
    ov.querySelector("#iga-switch").onclick = () => { ov.remove(); openSwitch(); };
    ov.querySelector("#iga-logout").onclick = () => signOut();
    ov.querySelector("#iga-close").onclick = () => ov.remove();
    // refresh "member since" from the server if we've never had it
    loadAccountInfo().then(d => {
      const el = ov.querySelector("#iga-since");
      if (el && d && d.created_at) el.textContent = fmtDay(Date.parse(d.created_at));
    });
  }

  // Switch to another existing account (asks username + password of THAT account).
  function openSwitch() {
    const ov = modal(`
      <h2>🔄 Switch account</h2>
      <p>Enter the username &amp; password of the account you want to switch to. You'll get that account's own progress, scores &amp; leaderboard spot — nothing is copied between accounts.</p>
      <input id="iga-sname" type="text" placeholder="Username" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false">
      <input id="iga-spwd" type="password" placeholder="Password" autocomplete="off">
      <div class="iga-msg" id="iga-sm"></div>
      <button class="iga-btn iga-p" id="iga-sgo">Switch</button>
      <button class="iga-btn iga-g" id="iga-snew">➕ Create a new account instead</button>
      <button class="iga-btn iga-x" id="iga-sback">Back</button>`);
    const $ = id => ov.querySelector(id);
    const msg = (t, ok) => { const m = $("#iga-sm"); m.textContent = t; m.className = "iga-msg " + (ok ? "iga-ok" : "iga-err"); };
    $("#iga-sgo").onclick = async () => {
      msg("Checking…", true);
      const r = await switchAccount($("#iga-sname").value, $("#iga-spwd").value);
      if (r.error) msg(r.error); else location.reload();
    };
    // Making a new account means leaving this one — log out first so the new
    // account opens on a clean device (this account's progress stays vaulted).
    $("#iga-snew").onclick = () => {
      if (!confirm("Log out of " + (player ? player.name : "this account") + " and create a new account?\n\nYour progress is kept — log back in any time with your username and password.")) return;
      signOut();
    };
    $("#iga-sname").addEventListener("keydown", e => { if (e.key === "Enter") $("#iga-spwd").focus(); });
    $("#iga-spwd").addEventListener("keydown", e => { if (e.key === "Enter") $("#iga-sgo").click(); });
    $("#iga-sback").onclick = () => { ov.remove(); openAccount(); };
  }

  async function showLeaderboard(game, title) {
    const sub = game === "stars" ? "Most ⭐ earned — play the Game of the Day &amp; Game of the Week to climb!" : "All-time best scores";
    const ov = modal(`<h2>${game === "stars" ? "⭐" : "🏆"} ${title || "Leaderboard"}</h2><p>${sub}</p><div id="iga-lb">Loading…</div>
      <button class="iga-btn iga-x" id="iga-close" style="margin-top:10px">Close</button>`);
    ov.querySelector("#iga-close").onclick = () => ov.remove();
    const box = ov.querySelector("#iga-lb");
    const render = (all) => {
      // collapse same-name entries: registered beats guest, keep highest score
      const byName = {};
      for (const r of all.filter(r => r.game === game && !isAutoGuest(r.name))) {
        const k = (r.name || "Player");
        if (!byName[k]) byName[k] = { name: r.name, score: r.score, is_guest: !!r.is_guest };
        else { byName[k].score = Math.max(byName[k].score, r.score); if (!r.is_guest) byName[k].is_guest = false; }
      }
      const list = Object.values(byName).sort((a, b) => b.score - a.score).slice(0, 20);
      if (!list.length) { box.innerHTML = `<p>No scores yet — be the first!</p>`; return; }
      box.innerHTML = list.map((r, i) => {
        const me = player && r.name === player.name;
        const fr = (window.IGFriends && IGFriends.isFriend && IGFriends.isFriend(r.name)) ? "👥 " : "";
        const wk = (window.IGFriends && IGFriends.isWeekWinner && IGFriends.isWeekWinner(r.name)) ? `<span title="User of the Week">🏅</span> ` : "";
        const nm = wk + fr + (r.name || "Player").replace(/[<>]/g, "") + (r.is_guest ? ` <small>(guest)</small>` : "");
        return `<div class="iga-row ${me ? "me" : ""}"><span class="r">${i + 1}</span><span class="n">${nm}</span><span class="sc">${r.score}</span></div>`;
      }).join("");
    };
    render(mergeLocal(cachedBoard() || []));              // instant (cache + local fallback)
    const fresh = await fetchBoard(); render(mergeLocal(fresh));   // then refresh
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
    let activeG = null;
    function build(rows) {
      rows = rows.filter(r => !HIDDEN_GAMES.has(r.game) && r.game !== "stars" && !isAutoGuest(r.name));   // drop retired games, auto-guest test rows + stars (it has its own board)
      // one row per (name, game): registered beats guest, keep highest score
      const map = {};
      for (const r of rows) {
        const k = r.name + "|" + r.game;
        if (!map[k]) map[k] = { name: r.name, game: r.game, score: r.score, is_guest: !!r.is_guest };
        else { map[k].score = Math.max(map[k].score, r.score); if (!r.is_guest) map[k].is_guest = false; }
      }
      const byGame = {};
      for (const v of Object.values(map)) { (byGame[v.game] = byGame[v.game] || []).push(v); }
      for (const g in byGame) byGame[g].sort((a, b) => b.score - a.score);
      const order = Object.keys(GAME_TITLES).filter(g => byGame[g] && byGame[g].length);
      for (const g in byGame) if (!order.includes(g)) order.push(g);
      if (!order.length) { metric.textContent = ""; tabs.innerHTML = ""; box.innerHTML = `<p>No scores yet — be the first!</p>`; return; }
      function render(g) {
        activeG = g;
        tabs.querySelectorAll(".iga-tab").forEach(t => t.classList.toggle("on", t.dataset.g === g));
        metric.textContent = GAME_METRIC[g] ? (GAME_METRIC[g] + " — higher is better") : "";
        box.innerHTML = byGame[g].slice(0, 20).map((r, i) => {
          const me = player && r.name === player.name;
          const fr = (window.IGFriends && IGFriends.isFriend && IGFriends.isFriend(r.name)) ? "👥 " : "";
          const wk = (window.IGFriends && IGFriends.isWeekWinner && IGFriends.isWeekWinner(r.name)) ? `<span title="User of the Week">🏅</span> ` : "";
        const nm = wk + fr + (r.name || "Player").replace(/[<>]/g, "") + (r.is_guest ? ` <small>(guest)</small>` : "");
          return `<div class="iga-row ${me ? "me" : ""}"><span class="r">${i + 1}</span><span class="n">${nm}</span><span class="sc">${r.score}</span></div>`;
        }).join("");
      }
      tabs.innerHTML = order.map(g => `<button class="iga-tab" data-g="${g}">${GAME_TITLES[g] || g}</button>`).join("");
      tabs.querySelectorAll(".iga-tab").forEach(t => t.onclick = () => render(t.dataset.g));
      render(order.includes(activeG) ? activeG : order[0]);   // keep the tab the user was on across refresh
    }
    build(mergeLocal(cachedBoard() || []));               // instant (cache + local fallback)
    const fresh = await fetchBoard(); build(mergeLocal(fresh));    // then refresh
  }

  /* ---------- public API ---------- */
  window.IGAuth = {
    onReady: cb => { if (ready) cb(); else cbs.push(() => cb()); },
    onChange: cb => { cbs.push(cb); if (ready) cb(player); },
    getUser: () => player,
    isGuest: () => false,                      // guest play was removed — accounts only
    isReady: () => ready,
    openAuth, openAccount, openProfile: openAccount, openSwitch, switchAccount, signUp, logIn, signOut,
    submitScore, topScores, showLeaderboard, showOverall,
    displayName: () => player ? player.name : null,
  };
  init();
})();
