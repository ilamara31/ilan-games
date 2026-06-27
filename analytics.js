/* Ilan's Arcade — analytics + identity layer (Phase 1)
   Loads Microsoft Clarity (session recordings + heatmaps) and exposes a tiny
   vendor-agnostic event helper: window.track(eventName, props).

   SETUP: create a free project at https://clarity.microsoft.com → Settings →
   "Project ID" (a short code like "abcd1234ef") and paste it below.
   Until you do, the site works fine — analytics just stays off.            */
(function () {
  'use strict';

  var CLARITY_PROJECT_ID = 'xde3a1kje3'; // Microsoft Clarity project id

  // Known game folders. Used to detect which game a page belongs to and to
  // target announcements at players of specific games.
  var GAMES = ['cricket', 'catch', 'f1', 'football', 'try', 'obby',
               'puzzles', 'anime-tycoon', 'cricket-test', 'catch-test'];

  // ---- which game is this page? -------------------------------------------
  function detectGame() {
    var segs = location.pathname.replace(/\/index\.html$/i, '').split('/').filter(Boolean);
    var last = segs[segs.length - 1] || '';
    return GAMES.indexOf(last) !== -1 ? last : 'home';
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
    games: GAMES,
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
  }
})();
