/* ============================================================================
   Meme Studio — shell: router, main menu, settings, and the core playback
   screen (the meme scene player with view + like). Ties the modules together.

   Modules this loads (built to a fixed contract):
     MemeCreate.open(container, { onSaved(id), onExit() })
     MemeGallery.open(container, { onOpenMeme(id), onOpenProfile(key), onExit() })
     MemeProfile.open(container, key, { onOpenMeme(id), onExit() })
     MemeStats.open(container, { onOpenMeme(id), onExit() })
   Shell API used by those modules:
     MemeApp.toast(msg), MemeApp.openMeme(idOrMeme), MemeApp.openProfile(key), MemeApp.go(name)
   ============================================================================ */
(function () {
  "use strict";
  var screen, backBtn, topTitle, userChip, toastEl;
  var stack = [];                 // navigation stack of {name, arg}
  var curPlayer = null;           // active MemeEngine controller (to stop on nav)

  function $(id) { return document.getElementById(id); }
  function setHeader(title, showBack) {
    topTitle.textContent = title || "Meme Studio";
    var ap = document.getElementById("app"); if (ap) ap.classList.toggle("sub", !!showBack);
    backBtn.style.display = showBack ? "flex" : "none";
  }
  function clearScreen() { if (curPlayer) { try { curPlayer.stop(); } catch (e) {} curPlayer = null; } try { MemeEngine.stopAll(); } catch (e) {} screen.innerHTML = ""; }

  var toastT = null;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); if (toastT) clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 2600); }

  function refreshChip() {
    var u = MemeDB.me();
    userChip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8"/></svg>' + "<span></span>"; userChip.lastChild.textContent = (u.guest ? "Log in" : u.name);
  }

  /* ---------------- navigation ---------------- */
  function render(name, arg, push) {
    if (push !== false) stack.push({ name: name, arg: arg });
    clearScreen();
    var showBack = stack.length > 1;
    if (name === "menu") { setHeader("Meme Studio", false); renderMenu(); }
    else if (name === "create") { setHeader("Create Meme", true); MemeCreate.open(screen, { onSaved: onSaved, onExit: back }); }
    else if (name === "gallery") { setHeader("Gallery", true); MemeGallery.open(screen, { onOpenMeme: openMeme, onOpenProfile: openProfile, onExit: back }); }
    else if (name === "profile") { setHeader("Profile", true); MemeProfile.open(screen, arg || MemeDB.me().key, { onOpenMeme: openMeme, onExit: back }); }
    else if (name === "stats") { setHeader("Statistics", true); MemeStats.open(screen, { onOpenMeme: openMeme, onExit: back }); }
    else if (name === "settings") { setHeader("Settings", true); renderSettings(); }
    else if (name === "play") { setHeader("", true); renderPlay(arg); }
    window.scrollTo(0, 0);
  }
  function back() {
    if (stack.length <= 1) { render("menu", null, false); stack = [{ name: "menu" }]; return; }
    stack.pop();
    var top = stack[stack.length - 1];
    render(top.name, top.arg, false);
  }
  function go(name, arg) { render(name, arg, true); }
  function openMeme(idOrMeme) { render("play", idOrMeme, true); }
  function openProfile(key) { render("profile", key, true); }
  function onSaved(id) {
    toast("Meme saved!");
    submitMemeScore();          // update the arcade leaderboard (ranked by memes published)
    // replace create in the stack, then open the freshly-saved meme
    stack.pop();
    openMeme(id);
  }

  // ---- Arcade leaderboard: a creator's score = how many memes they've published ----
  async function submitMemeScore() {
    try {
      if (!(window.IGAuth && IGAuth.submitScore)) return;
      var st = await MemeDB.myStats();
      var n = (st && st.memes) || 0;
      if (n > 0) IGAuth.submitScore("meme", n);
    } catch (e) {}
  }

  /* ---------------- main menu ---------------- */
  function renderMenu() {
    var u = MemeDB.me();
    screen.innerHTML =
      '<div class="ig-hero"><div class="ig-appicon"><svg viewBox="0 0 100 100" aria-hidden="true"><rect class="o" x="10" y="10" width="80" height="80" rx="6" fill="#fff" transform="rotate(-4 50 50)"/><g transform="rotate(-4 50 50)"><rect class="o" x="17" y="24" width="66" height="50" rx="3" fill="#7dd3fc"/><path d="M17 62 Q40 54 83 64 L83 74 L17 74Z" fill="#169b62"/><path class="o" d="M34 40 L36 28 L44 36Z" fill="#ff9f43"/><path class="o" d="M66 40 L64 28 L56 36Z" fill="#ff9f43"/><ellipse class="o" cx="50" cy="50" rx="19" ry="16" fill="#ff9f43"/><ellipse cx="42" cy="47" rx="4.5" ry="6" fill="#fff" stroke="#22120a" stroke-width="2"/><ellipse cx="58" cy="47" rx="4.5" ry="6" fill="#fff" stroke="#22120a" stroke-width="2"/><circle cx="43" cy="49" r="2.5" fill="#22120a"/><circle cx="57" cy="45" r="2.5" fill="#22120a"/><path d="M44 58 Q50 62 57 56" fill="none" stroke="#22120a" stroke-width="2.5" stroke-linecap="round"/><path d="M30 52 L22 50 M30 56 L22 58 M70 52 L78 50 M70 56 L78 58" stroke="#22120a" stroke-width="1.8" stroke-linecap="round"/><rect x="24" y="15" width="52" height="6" rx="2" fill="#22120a"/><rect x="30" y="78" width="40" height="6" rx="2" fill="#22120a"/></g></svg></div><div class="ig-title">Meme Studio</div><div class="ig-tagline">Make a meme scene. Share it. Get likes.</div></div>' +
      '<div class="ig-playrow"><button class="ig-cta" data-go="create"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span><b>Create Meme</b><small>Make a scene in 60 seconds</small></span></button></div>' +
      '<div class="ig-modes">' +
        '<button class="ig-mode" data-go="gallery"><span class="ig-tile" style="--tile:linear-gradient(160deg,#5ac8fa,#0a60ff)"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-9 8"/></svg></span><b>Gallery</b><small>Top memes</small></button>' +
        '<button class="ig-mode" data-go="profile"><span class="ig-tile" style="--tile:linear-gradient(160deg,#5ee28a,#11998e)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8"/></svg></span><b>Profile</b><small>Your memes</small></button>' +
        '<button class="ig-mode" data-go="stats"><span class="ig-tile" style="--tile:linear-gradient(160deg,#ff8ac8,#d9467f)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg></span><b>Stats</b><small>Your numbers</small></button>' +
      '</div>' +
      '<div class="ig-list"><button class="ig-row" data-go="settings"><span class="ig-tile" style="--tile:linear-gradient(160deg,#9aa6b8,#5b6678)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg></span><span class="ig-grow">Settings<small>Account &amp; about</small></span></button></div>';
    Array.prototype.forEach.call(screen.querySelectorAll("[data-go]"), function (b) {
      b.onclick = function () { go(b.getAttribute("data-go")); };
    });
  }
  function tile(go, cls, icon, name, desc, big) {
    return '<button class="mtile ' + cls + (big ? ' big' : '') + '" data-go="' + go + '">' +
      '<div class="mi">' + icon + '</div><div><div class="mn">' + name + '</div><div class="md">' + desc + '</div></div></button>';
  }

  /* ---------------- settings ---------------- */
  function renderSettings() {
    var u = MemeDB.me();
    screen.innerHTML =
      '<div class="card"><div class="label">Account</div>' +
        '<div class="muted" style="margin-bottom:12px">You\'re signed in as <b style="color:var(--ink)">' + esc(u.name) + '</b>' + (u.guest ? ' (guest)' : '') + '. Your memes and likes are saved to this name.</div>' +
        '<button class="btn grad2" id="setAcct">' + (u.guest ? 'Log in / Create account' : 'Manage account') + '</button>' +
      '</div>' +
      '<div class="card"><div class="label">About</div>' +
        '<div class="muted">Meme Studio is part of ILAN Games. Everything stays inside the arcade — memes are replayable scenes, not video files. No downloads or outside sharing.</div>' +
      '</div>' +
      '<button class="btn ghost" id="setBack">Back to menu</button>';
    $("setAcct").onclick = function () { try { (u.guest ? IGAuth.openAuth : (IGAuth.openAccount || IGAuth.openAuth))(); } catch (e) { toast("Account unavailable."); } };
    $("setBack").onclick = back;
  }

  /* ---------------- core playback screen ---------------- */
  var viewed = {};   // count a view once per session per meme
  async function renderPlay(idOrMeme) {
    screen.innerHTML = '<div class="center"><div class="spin"></div><div>Loading meme…</div></div>';
    var meme = (idOrMeme && typeof idOrMeme === "object") ? idOrMeme : await MemeDB.getMeme(idOrMeme);
    if (!meme) { screen.innerHTML = ''; screen.appendChild(errBox("Couldn't load this meme.", back)); return; }
    setHeader(meme.title || "Meme", true);

    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="card" style="padding:12px">' +
        '<div id="stage"></div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-top:12px">' +
          '<button class="btn grad sm" id="replayBtn" style="flex:0 0 auto">Replay</button>' +
          '<button class="btn sm" id="likeBtn" style="flex:0 0 auto"><svg class="ic" viewBox="0 0 24 24"><path d="M12 20s-7-4.3-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.7 12 20 12 20z"/></svg> <span id="likeN">' + (meme.likes || 0) + '</span></button>' +
          '<div class="muted" style="margin-left:auto">Views <span id="viewN">' + (meme.views || 0) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div style="font-weight:900;font-size:18px">' + esc(meme.title) + '</div>' +
        '<div class="muted" style="margin-top:4px">by <b id="byLink" style="color:var(--accent);cursor:pointer">' + esc(meme.creator_name) + '</b> · ' + esc(cap(meme.category)) + '</div>' +
      '</div>' +
      '<button class="btn ghost" id="playBack">Back</button>';
    screen.innerHTML = ""; screen.appendChild(wrap);

    var stage = $("stage");
    curPlayer = MemeEngine.play(meme.scene, stage, {});
    $("replayBtn").onclick = function () { if (curPlayer) curPlayer.replay(); };
    $("playBack").onclick = back;
    $("byLink").onclick = function () { openProfile(meme.creator_key); };

    // view count — once per session per meme
    if (!viewed[meme.id]) { viewed[meme.id] = true; MemeDB.addView(meme.id).then(function (n) { if (n) $("viewN").textContent = n; }); }

    // like button
    var likeBtn = $("likeBtn"), likeN = $("likeN"), liked = false, busy = false, toggled = false;
    MemeDB.hasLiked(meme.id).then(function (v) { if (!toggled) { liked = v; paintLike(); } });   // ignore if user already tapped
    function paintLike() { likeBtn.style.color = liked ? "#e0364f" : ""; likeBtn.innerHTML = (liked ? "<svg class=\"ic\" viewBox=\"0 0 24 24\" style=\"fill:currentColor\"><path d=\"M12 20s-7-4.3-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.7 12 20 12 20z\"/></svg> " : "<svg class=\"ic\" viewBox=\"0 0 24 24\"><path d=\"M12 20s-7-4.3-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.7 12 20 12 20z\"/></svg> ") + '<span id="likeN">' + (likeN ? likeN.textContent : (meme.likes || 0)) + "</span>"; likeN = $("likeN"); }
    likeBtn.onclick = async function () {
      if (busy) return; busy = true; toggled = true;
      try { var r = await MemeDB.toggleLike(meme.id); liked = r.liked; if (likeN) likeN.textContent = r.likes; paintLike(); }
      catch (e) { toast(e.message || "Couldn't like."); }
      busy = false;
    };
  }

  function errBox(msg, onBack) {
    var d = document.createElement("div"); d.className = "center";
    d.innerHTML = '<div class="bigic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v5M12 16h.01"/></svg></div><div>' + esc(msg) + '</div>';
    var b = document.createElement("button"); b.className = "btn ghost"; b.style.maxWidth = "220px"; b.textContent = "Back"; b.onclick = onBack; d.appendChild(b);
    return d;
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  /* ---------------- boot ---------------- */
  function boot() {
    screen = $("screen"); backBtn = $("backBtn"); topTitle = $("topTitle"); userChip = $("userChip"); toastEl = $("toast");
    backBtn.onclick = back;
    userChip.onclick = function () { try { (MemeDB.me().guest ? IGAuth.openAuth : (IGAuth.openAccount || IGAuth.openAuth))(); } catch (e) {} };
    refreshChip();
    try { if (window.IGAuth && IGAuth.onChange) IGAuth.onChange(function () { refreshChip(); }); } catch (e) {}
    window.MemeApp = { toast: toast, openMeme: openMeme, openProfile: openProfile, go: go, back: back, setHeader: setHeader };
    render("menu", null, true);
    setTimeout(submitMemeScore, 2500);   // post this creator's published-meme count to the arcade leaderboard once connected
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
