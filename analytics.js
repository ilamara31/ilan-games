/* Ilan's Arcade — analytics + identity layer (Phase 1)
   Loads Microsoft Clarity (session recordings + heatmaps) and exposes a tiny
   vendor-agnostic event helper: window.track(eventName, props).

   SETUP: create a free project at https://clarity.microsoft.com → Settings →
   "Project ID" (a short code like "abcd1234ef") and paste it below.
   Until you do, the site works fine — analytics just stays off.            */
(function () {
  'use strict';

  var CLARITY_PROJECT_ID = 'xde3a1kje3'; // Microsoft Clarity project id
  var MIXPANEL_TOKEN = '2495c27a558d30fdf6a138078c25414d'; // Mixpanel project token

  // ---- home vs game detection (no allow-list, so new games just work) ------
  // The arcade home page carries <body data-arcade-home> and renders the game
  // cards (a.card). Anything else is treated as a game, identified by its
  // folder name — so a brand-new game folder is picked up automatically.
  function isHome() {
    if (document.body && document.body.hasAttribute('data-arcade-home')) return true;
    if (document.querySelector('a.card')) return true;
    return false;
  }
  function detectGame() {
    if (isHome()) return 'home';
    var segs = location.pathname.replace(/\/index\.html$/i, '').split('/').filter(Boolean);
    return segs.length ? segs[segs.length - 1] : 'home';
  }
  var GAME_ID = detectGame();

  // ---- soft identity (reuses the home-page player system) ------------------
  function activePlayer() {
    try {
      var store = JSON.parse(localStorage.getItem('soc_store_v1') || 'null');
      if (store && store.accounts) {
        var a = store.accounts.find(function (x) { return x.id === store.activeId; });
        return a ? a.name : null;
      }
    } catch (e) {}
    return null;
  }

  // ---- remember which games this device has played (for targeting) ---------
  function recordPlayed(slug) {
    if (slug === 'home') return;
    try {
      var played = JSON.parse(localStorage.getItem('ig_played') || '[]');
      if (played.indexOf(slug) === -1) { played.push(slug); localStorage.setItem('ig_played', JSON.stringify(played)); }
    } catch (e) {}
  }
  recordPlayed(GAME_ID);

  // ---- expose shared state for announce.js & game code ---------------------
  window.IG = {
    gameId: GAME_ID,
    player: activePlayer(),
    played: (function () { try { return JSON.parse(localStorage.getItem('ig_played') || '[]'); } catch (e) { return []; } })()
  };

  // ---- vendor-agnostic event helper ---------------------------------------
  // Call window.track('game_over', { score: 42 }) anywhere in a game.
  window.track = function (event, props) {
    try {
      if (window.clarity) {
        clarity('event', event);
        if (props) Object.keys(props).forEach(function (k) { clarity('set', k, String(props[k])); });
      }
      if (window.mixpanel && mixpanel.track) {
        mixpanel.track(event, props || {});
      }
      // Future: if you add PostHog/GA4, forward here too.
      // if (window.posthog) posthog.capture(event, props);
    } catch (e) {}
  };

  // ---- load Microsoft Clarity ---------------------------------------------
  if (CLARITY_PROJECT_ID) {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_PROJECT_ID);

    // tag every session so you can filter recordings by game / player
    clarity('set', 'game', GAME_ID);
    var nm = window.IG.player;
    if (nm) clarity('set', 'player', nm);
  } else if (location.hostname && location.hostname !== 'localhost') {
    console.info('[analytics] Add your Microsoft Clarity project id in analytics.js to enable analytics.');
  }

  // ---- load Mixpanel -------------------------------------------------------
  if (MIXPANEL_TOKEN) {
    // Official Mixpanel loader snippet (creates a stub queue until the CDN loads).
    (function (f, b) { if (!b.__SV) { var e, g, i, h; window.mixpanel = b; b._i = []; b.init = function (e, f, c) { function g(a, d) { var b = d.split('.'); 2 == b.length && (a = a[b[0]], d = b[1]); a[d] = function () { a.push([d].concat(Array.prototype.slice.call(arguments, 0))); }; } var a = b; 'undefined' !== typeof c ? a = b[c] = [] : c = 'mixpanel'; a.people = a.people || []; a.toString = function (a) { var d = 'mixpanel'; 'mixpanel' !== c && (d += '.' + c); a || (d += ' (stub)'); return d; }; a.people.toString = function () { return a.toString(1) + '.people (stub)'; }; i = 'disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove'.split(' '); for (h = 0; h < i.length; h++) g(a, i[h]); var j = 'set set_once union unset remove delete'.split(' '); a.get_group = function () { function b(c) { d[c] = function () { call2_args = arguments; call2 = [c].concat(Array.prototype.slice.call(call2_args, 0)); a.push([e, call2]); }; } for (var d = {}, e = ['get_group'].concat(Array.prototype.slice.call(arguments, 0)), c = 0; c < j.length; c++) b(j[c]); return d; }; b._i.push([e, f, c]); }; b.__SV = 1.2; e = f.createElement('script'); e.type = 'text/javascript'; e.async = !0; e.src = 'undefined' !== typeof MIXPANEL_CUSTOM_LIB_URL ? MIXPANEL_CUSTOM_LIB_URL : 'file:' === f.location.protocol && '//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js'.match(/^\/\//) ? 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js' : '//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js'; g = f.getElementsByTagName('script')[0]; g.parentNode.insertBefore(e, g); } })(document, window.mixpanel || []);

    mixpanel.init(MIXPANEL_TOKEN, { track_pageview: true, persistence: 'localStorage' });

    // tag every event with the game slug so you can break down by game
    mixpanel.register({ game: GAME_ID });
    var mpName = window.IG.player;
    if (mpName) { mixpanel.identify(mpName); mixpanel.people.set({ $name: mpName }); }
  }

  // ---- automatic events ----------------------------------------------------
  if (GAME_ID === 'home') {
    // funnel start: which game card did they click?
    document.addEventListener('click', function (e) {
      var card = e.target.closest && e.target.closest('a.card');
      if (!card) return;
      var slug = (card.getAttribute('href') || '').replace(/\/+$/, '').split('/').pop();
      window.track('game_card_click', { game: slug });
    }, true);
  } else {
    // funnel: a game page actually opened
    window.track('game_open', { game: GAME_ID });

    // ---- global play counter (powers the home page 🔥 trending + play counts) ----
    // Counted once per game per browser session so a refresh doesn't inflate it.
    // Uses the browser-safe publishable Supabase key (falls back if config isn't loaded).
    // Anti-spam: only count the play after the player has actually stayed on the
    // game for DWELL_MS. Opening then quickly closing a game no longer counts.
    // Time with the tab hidden/backgrounded is not counted.
    (function () {
      try {
        var pk = 'igplay_' + GAME_ID;
        if (sessionStorage.getItem(pk)) return;   // already counted this session
        var DWELL_MS = 25000;
        var acc = 0, last = Date.now(), done = false;
        var iv = setInterval(function () {
          if (done) return;
          var t = Date.now();
          if (!document.hidden) acc += t - last;
          last = t;
          if (acc < DWELL_MS) return;
          done = true; clearInterval(iv);
          try {
            if (sessionStorage.getItem(pk)) return;
            sessionStorage.setItem(pk, '1');
            var url = window.SUPABASE_URL || 'https://xanrofecdpoljnerpsow.supabase.co';
            var key = window.SUPABASE_KEY || 'sb_publishable_jff4Q2OLVzIf0Cr1FILZyQ_vgy8xRrT';
            fetch(url + '/rest/v1/rpc/bump_play', {
              method: 'POST',
              headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
              body: JSON.stringify({ p_game: GAME_ID })
            }).catch(function () {});
          } catch (e) {}
        }, 1000);
        document.addEventListener('visibilitychange', function () { last = Date.now(); });
      } catch (e) {}
    })();
  }

  // ---- safety net: guarantee a way back to the arcade ----------------------
  // Every game page should let players return home. If a game already has its
  // own home/exit (an #homeBtn, a link to "../", or an onclick that navigates
  // to "../"), we leave it alone. Otherwise we inject a floating 🏠 button.
  // This means any NEW game gets a Home button automatically — no extra work.
  function hasArcadeExit() {
    if (document.getElementById('homeBtn')) return true;
    var roots = ['../', '../index.html', '../#', '..'];
    var as = document.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) { if (roots.indexOf(as[i].getAttribute('href')) !== -1) return true; }
    var cl = document.querySelectorAll('[onclick]');
    for (var j = 0; j < cl.length; j++) { if (/location[\s\S]*=\s*['"]\.\.\//.test(cl[j].getAttribute('onclick') || '')) return true; }
    return false;
  }
  function ensureArcadeExit() {
    if (GAME_ID === 'home' || hasArcadeExit()) return;
    var a = document.createElement('a');
    a.id = 'homeBtn'; a.href = '../'; a.title = 'All games'; a.textContent = '🏠';
    a.style.cssText = 'position:fixed;top:12px;left:12px;z-index:100000;width:44px;height:44px;border-radius:12px;'
      + 'display:flex;align-items:center;justify-content:center;background:rgba(8,16,30,.72);'
      + 'border:2px solid rgba(255,255,255,.2);font-size:22px;line-height:1;text-decoration:none;color:#fff;'
      + '-webkit-tap-highlight-color:transparent;';
    document.body.appendChild(a);
  }
  // run after the page's own UI has had a chance to render its own exit button
  if (document.readyState === 'complete') ensureArcadeExit();
  else addEventListener('load', ensureArcadeExit);
})();
