/* ============================================================================
   Meme Studio — gallery, profile & stats (window.MemeGallery / MemeProfile / MemeStats)
   Read-only browsing screens. Each fully owns its container. Everything stays
   in-app: no sharing, downloads, or exports.

   Contract (see app.js):
     MemeGallery.open(container, { onOpenMeme(id), onOpenProfile(key), onExit() })
     MemeProfile.open(container, key, { onOpenMeme(id), onExit() })
     MemeStats.open(container, { onOpenMeme(id), onExit() })
   ============================================================================ */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function num(n) { n = +n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n); }

  function joinedLabel(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
    return "Joined " + mon + " " + d.getFullYear();
  }

  function el(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  }

  function spinner(text) {
    var d = document.createElement("div");
    d.className = "center";
    d.innerHTML = '<div class="spin"></div><div>' + esc(text || "Loading…") + "</div>";
    return d;
  }

  function emptyBox(msg) {
    var d = document.createElement("div");
    d.className = "center";
    d.innerHTML = '<div style="font-size:40px">🎬</div><div>' + esc(msg) + "</div>";
    return d;
  }

  function errorBox(msg, onRetry) {
    var d = document.createElement("div");
    d.className = "center";
    d.innerHTML = '<div style="font-size:40px">📡</div><div>' + esc(msg) + "</div>";
    if (onRetry) {
      var b = document.createElement("button");
      b.className = "btn ghost";
      b.style.maxWidth = "220px";
      b.textContent = "↻ Retry";
      b.onclick = onRetry;
      d.appendChild(b);
    }
    return d;
  }

  /* ---------------- shared meme-card renderer ---------------- */
  // Builds a .memecard for `meme`. Card click -> onOpenMeme(id).
  // Creator name (in .ms) -> onOpenProfile(creator_key) when provided (stopPropagation).
  function memeCard(meme, onOpenMeme, onOpenProfile) {
    var card = document.createElement("div");
    card.className = "memecard";

    var thumb = document.createElement("div");
    thumb.className = "thumb";
    try { MemeEngine.thumb(meme.scene || {}, thumb); } catch (e) {}

    var meta = document.createElement("div");
    meta.className = "meta";

    var mt = document.createElement("div");
    mt.className = "mt";
    mt.textContent = meme.title || "Untitled";

    var ms = document.createElement("div");
    ms.className = "ms";
    ms.innerHTML =
      "<span>❤️ " + num(meme.likes) + "</span>" +
      "<span>👁 " + num(meme.views) + "</span>";

    if (meme.creator_name) {
      var by = document.createElement("span");
      by.textContent = "· " + meme.creator_name;
      if (onOpenProfile && meme.creator_key) {
        by.style.cursor = "pointer";
        by.style.color = "var(--accent)";
        by.onclick = function (ev) {
          ev.stopPropagation();
          onOpenProfile(meme.creator_key);
        };
      }
      ms.appendChild(by);
    }

    meta.appendChild(mt);
    meta.appendChild(ms);
    card.appendChild(thumb);
    card.appendChild(meta);

    if (onOpenMeme) card.onclick = function () { onOpenMeme(meme.id); };
    return card;
  }

  function grid(memes, onOpenMeme, onOpenProfile) {
    var g = document.createElement("div");
    g.className = "mgrid";
    memes.forEach(function (m) { g.appendChild(memeCard(m, onOpenMeme, onOpenProfile)); });
    return g;
  }

  function statTile(n, label) {
    var d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = '<div class="n">' + esc(num(n)) + '</div><div class="l">' + esc(label) + "</div>";
    return d;
  }

  function backButton(onExit) {
    var b = document.createElement("button");
    b.className = "btn ghost";
    b.textContent = "← Back";
    b.onclick = onExit;
    return b;
  }

  /* ============================================================
     GALLERY
     ============================================================ */
  var SORTS = [
    { id: "liked", label: "❤️ Most Liked" },
    { id: "viewed", label: "👁 Most Viewed" },
    { id: "new", label: "🆕 Newest" }
  ];
  var CATS = [
    { id: "all", label: "All" },
    { id: "funny", label: "Funny" },
    { id: "animals", label: "Animals" },
    { id: "sports", label: "Sports" },
    { id: "school", label: "School" },
    { id: "gaming", label: "Gaming" },
    { id: "random", label: "Random" }
  ];

  function openGallery(container, cbs) {
    cbs = cbs || {};
    var onOpenMeme = cbs.onOpenMeme, onOpenProfile = cbs.onOpenProfile, onExit = cbs.onExit;

    var state = { sort: "liked", category: "all", search: "" };
    var reqSeq = 0;          // increments each query; stale responses are ignored
    var debounceT = null;

    container.innerHTML = "";

    // sort tabs
    var tabs = document.createElement("div");
    tabs.className = "tabs";
    SORTS.forEach(function (s) {
      var t = document.createElement("button");
      t.className = "tab" + (s.id === state.sort ? " on" : "");
      t.textContent = s.label;
      t.onclick = function () {
        if (state.sort === s.id) return;
        state.sort = s.id;
        Array.prototype.forEach.call(tabs.children, function (c) { c.classList.remove("on"); });
        t.classList.add("on");
        load();
      };
      tabs.appendChild(t);
    });

    // search
    var search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search title, creator, category…";
    search.autocomplete = "off";
    search.oninput = function () {
      if (debounceT) clearTimeout(debounceT);
      debounceT = setTimeout(function () {
        state.search = search.value.trim();
        load();
      }, 300);
    };

    // category chips
    var chips = document.createElement("div");
    chips.className = "row";
    chips.style.marginTop = "0";
    CATS.forEach(function (c) {
      var chip = document.createElement("button");
      chip.className = "chip" + (c.id === state.category ? " on" : "");
      chip.style.flex = "0 0 auto";
      chip.style.padding = "9px 14px";
      chip.textContent = c.label;
      chip.onclick = function () {
        if (state.category === c.id) return;
        state.category = c.id;
        Array.prototype.forEach.call(chips.children, function (x) { x.classList.remove("on"); });
        chip.classList.add("on");
        load();
      };
      chips.appendChild(chip);
    });

    var results = document.createElement("div");

    container.appendChild(tabs);
    container.appendChild(search);
    container.appendChild(chips);
    container.appendChild(results);
    container.appendChild(backButton(onExit));

    async function load() {
      var seq = ++reqSeq;
      results.innerHTML = "";
      results.appendChild(spinner("Loading memes…"));
      var memes = null, failed = false;
      try {
        memes = await MemeDB.listMemes({
          sort: state.sort,
          category: state.category,
          search: state.search,
          limit: 60
        });
      } catch (e) {
        failed = true;
      }
      if (seq !== reqSeq) return; // a newer query superseded this one

      results.innerHTML = "";
      if (failed || !Array.isArray(memes)) {
        results.appendChild(errorBox("Couldn't load the gallery. Check your connection.", load));
        return;
      }
      if (memes.length === 0) {
        // Empty list can mean "no results" or "not connected" (listMemes swallows
        // connection errors and returns []). Disambiguate via ready().
        var connected = true;
        try { connected = await MemeDB.ready(); } catch (e) { connected = false; }
        if (seq !== reqSeq) return;
        results.innerHTML = "";
        if (!connected) {
          results.appendChild(errorBox("Can't reach the server. Check your connection.", load));
        } else if (state.search || state.category !== "all") {
          results.appendChild(emptyBox("No memes match that. Try another search or category."));
        } else {
          results.appendChild(emptyBox("No memes yet — be the first! 🎬"));
        }
        return;
      }
      results.appendChild(grid(memes, onOpenMeme, onOpenProfile));
    }

    load();
  }

  /* ============================================================
     PROFILE
     ============================================================ */
  function openProfileScreen(container, key, cbs) {
    cbs = cbs || {};
    var onOpenMeme = cbs.onOpenMeme, onExit = cbs.onExit;

    container.innerHTML = "";
    container.appendChild(spinner("Loading profile…"));

    async function load() {
      container.innerHTML = "";
      container.appendChild(spinner("Loading profile…"));
      var p = null, failed = false;
      try { p = await MemeDB.profile(key); } catch (e) { failed = true; }

      container.innerHTML = "";
      if (failed || !p) {
        container.appendChild(errorBox("Couldn't load this profile. Check your connection.", load));
        container.appendChild(backButton(onExit));
        return;
      }

      var t = p.totals || { memes: 0, likes: 0, views: 0 };

      // header card
      var header = document.createElement("div");
      header.className = "card";
      header.innerHTML =
        '<div style="font-weight:900;font-size:20px">👤 ' + esc(p.name || key) + "</div>" +
        (joinedLabel(p.joined_at)
          ? '<div class="muted" style="margin-top:4px">' + esc(joinedLabel(p.joined_at)) + "</div>"
          : "");
      var tiles = document.createElement("div");
      tiles.className = "grid3";
      tiles.style.marginTop = "14px";
      tiles.appendChild(statTile(t.memes, "Total Memes"));
      tiles.appendChild(statTile(t.likes, "Total Likes"));
      tiles.appendChild(statTile(t.views, "Total Views"));
      header.appendChild(tiles);
      container.appendChild(header);

      // memes section
      var lbl = document.createElement("div");
      lbl.className = "label";
      lbl.textContent = "Memes by " + (p.name || key);
      container.appendChild(lbl);

      var memes = p.memes || [];
      if (memes.length === 0) {
        container.appendChild(emptyBox("No memes yet."));
      } else {
        // no onOpenProfile here — already on this creator's profile
        container.appendChild(grid(memes, onOpenMeme, null));
      }

      container.appendChild(backButton(onExit));
    }

    load();
  }

  /* ============================================================
     STATS (current user)
     ============================================================ */
  function openStats(container, cbs) {
    cbs = cbs || {};
    var onOpenMeme = cbs.onOpenMeme, onExit = cbs.onExit;

    container.innerHTML = "";
    container.appendChild(spinner("Loading your stats…"));

    async function load() {
      container.innerHTML = "";
      container.appendChild(spinner("Loading your stats…"));
      var s = null, failed = false;
      try { s = await MemeDB.myStats(); } catch (e) { failed = true; }

      container.innerHTML = "";
      if (failed || !s) {
        container.appendChild(errorBox("Couldn't load your stats. Check your connection.", load));
        container.appendChild(backButton(onExit));
        return;
      }

      // stat tiles
      var tiles = document.createElement("div");
      tiles.className = "grid3";
      tiles.appendChild(statTile(s.memes, "Memes Created"));
      tiles.appendChild(statTile(s.likes, "Total Likes"));
      tiles.appendChild(statTile(s.views, "Total Views"));
      container.appendChild(tiles);

      // most popular meme
      var popLbl = document.createElement("div");
      popLbl.className = "label";
      popLbl.textContent = "Most Popular Meme";
      container.appendChild(popLbl);

      if (s.top) {
        var card = document.createElement("div");
        card.className = "memecard";
        card.style.maxWidth = "220px";

        var thumb = document.createElement("div");
        thumb.className = "thumb";
        try { MemeEngine.thumb(s.top.scene || {}, thumb); } catch (e) {}

        var meta = document.createElement("div");
        meta.className = "meta";
        var mt = document.createElement("div");
        mt.className = "mt";
        mt.textContent = s.top.title || "Untitled";
        var ms = document.createElement("div");
        ms.className = "ms";
        ms.innerHTML = "<span>❤️ " + num(s.top.likes) + "</span>";
        meta.appendChild(mt);
        meta.appendChild(ms);
        card.appendChild(thumb);
        card.appendChild(meta);
        card.onclick = function () { if (onOpenMeme) onOpenMeme(s.top.id); };
        container.appendChild(card);
      } else {
        var none = document.createElement("div");
        none.className = "muted";
        none.textContent = "No memes yet.";
        container.appendChild(none);
      }

      // favourite category
      var favLbl = document.createElement("div");
      favLbl.className = "label";
      favLbl.textContent = "Favourite Category";
      container.appendChild(favLbl);

      var fav = document.createElement("div");
      fav.className = "card";
      fav.style.fontWeight = "900";
      fav.style.fontSize = "18px";
      fav.textContent = s.favCategory ? cap(s.favCategory) : "—";
      container.appendChild(fav);

      container.appendChild(backButton(onExit));
    }

    load();
  }

  /* ---------------- exports ---------------- */
  window.MemeGallery = { open: openGallery };
  window.MemeProfile = { open: openProfileScreen };
  window.MemeStats = { open: openStats };
})();
