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
    backBtn.style.display = showBack ? "flex" : "none";
  }
  function clearScreen() { if (curPlayer) { try { curPlayer.stop(); } catch (e) {} curPlayer = null; } try { MemeEngine.stopAll(); } catch (e) {} screen.innerHTML = ""; }

  var toastT = null;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); if (toastT) clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 2600); }

  function refreshChip() {
    var u = MemeDB.me();
    userChip.textContent = (u.guest ? "👤 " + u.name + " · Log in" : "👤 " + u.name);
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
    toast("🎉 Meme saved!");
    // replace create in the stack, then open the freshly-saved meme
    stack.pop();
    openMeme(id);
  }

  /* ---------------- main menu ---------------- */
  function renderMenu() {
    var u = MemeDB.me();
    screen.innerHTML =
      '<div class="hero"><h1>😂 Meme Studio</h1><p>Create a meme scene, share it inside the arcade, get likes.</p></div>' +
      '<div class="menu">' +
        tile("create", "t-create", "🎬", "Create Meme", "Make a scene in 60s", true) +
        tile("gallery", "t-gallery", "🖼️", "Gallery", "Discover memes") +
        tile("profile", "t-profile", "👤", "My Profile", "Your memes") +
        tile("stats", "t-stats", "📊", "Statistics", "Your numbers") +
        tile("settings", "t-settings", "⚙️", "Settings", "Account") +
      '</div>';
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
        '<button class="btn grad2" id="setAcct">' + (u.guest ? '🔑 Log in / Create account' : '👤 Manage account') + '</button>' +
      '</div>' +
      '<div class="card"><div class="label">About</div>' +
        '<div class="muted">Meme Studio is part of ILAN Games. Everything stays inside the arcade — memes are replayable scenes, not video files. No downloads or outside sharing.</div>' +
      '</div>' +
      '<button class="btn ghost" id="setBack">← Back to menu</button>';
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
          '<button class="btn grad sm" id="replayBtn" style="flex:0 0 auto">▶ Replay</button>' +
          '<button class="btn sm" id="likeBtn" style="flex:0 0 auto;background:var(--panel2)">🤍 <span id="likeN">' + (meme.likes || 0) + '</span></button>' +
          '<div class="muted" style="margin-left:auto">👁 <span id="viewN">' + (meme.views || 0) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div style="font-weight:900;font-size:18px">' + esc(meme.title) + '</div>' +
        '<div class="muted" style="margin-top:4px">by <b id="byLink" style="color:var(--accent);cursor:pointer">' + esc(meme.creator_name) + '</b> · ' + esc(cap(meme.category)) + '</div>' +
      '</div>' +
      '<button class="btn ghost" id="playBack">← Back</button>';
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
    function paintLike() { likeBtn.innerHTML = (liked ? "❤️ " : "🤍 ") + '<span id="likeN">' + (likeN ? likeN.textContent : (meme.likes || 0)) + "</span>"; likeN = $("likeN"); }
    likeBtn.onclick = async function () {
      if (busy) return; busy = true; toggled = true;
      try { var r = await MemeDB.toggleLike(meme.id); liked = r.liked; if (likeN) likeN.textContent = r.likes; paintLike(); }
      catch (e) { toast(e.message || "Couldn't like."); }
      busy = false;
    };
  }

  function errBox(msg, onBack) {
    var d = document.createElement("div"); d.className = "center";
    d.innerHTML = '<div style="font-size:40px">😅</div><div>' + esc(msg) + '</div>';
    var b = document.createElement("button"); b.className = "btn ghost"; b.style.maxWidth = "220px"; b.textContent = "← Back"; b.onclick = onBack; d.appendChild(b);
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
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
