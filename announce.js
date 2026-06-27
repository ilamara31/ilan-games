/* Ilan's Arcade — in-app announcements (Phase 1)
   Shows a dismissible banner driven by messages.json. No backend needed:
   edit messages.json, commit, and every player sees it on next load.

   messages.json shape:
   {
     "messages": [
       {
         "id": "unique-id",              // required, unique. change it to re-show.
         "title": "🎉 New game!",        // required
         "body": "Try Anime Tycoon.",    // required
         "target": "all",               // "all" | "obby" | ["obby","cricket"]
         "cta":   { "label": "Play", "href": "anime-tycoon/" },  // optional, href is root-relative
         "start": "2026-06-01",          // optional ISO date (inclusive)
         "end":   "2026-12-31",          // optional ISO date (inclusive)
         "level": "info"                // optional: info | success | warning
       }
     ]
   }

   Targeting: "all" shows to everyone. A game slug (or array of slugs) shows to
   players currently on that game OR who have played it before on this device. */
(function () {
  'use strict';

  var IG = window.IG || { gameId: 'home', played: [] };
  var onGame = IG.gameId !== 'home';
  var BASE = onGame ? '../' : './';

  function dismissed() { try { return JSON.parse(localStorage.getItem('ig_dismissed') || '[]'); } catch (e) { return []; } }
  function dismiss(id) {
    var d = dismissed(); if (d.indexOf(id) === -1) { d.push(id); }
    try { localStorage.setItem('ig_dismissed', JSON.stringify(d)); } catch (e) {}
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  function targeted(msg) {
    var t = msg.target;
    if (!t || t === 'all') return true;
    var list = Array.isArray(t) ? t : [t];
    if (list.indexOf(IG.gameId) !== -1) return true;            // on that game now
    return list.some(function (g) { return (IG.played || []).indexOf(g) !== -1; }); // played before
  }

  function eligible(msg) {
    if (!msg || !msg.id || !msg.title) return false;
    if (dismissed().indexOf(msg.id) !== -1) return false;
    var d = today();
    if (msg.start && d < msg.start) return false;
    if (msg.end && d > msg.end) return false;
    return targeted(msg);
  }

  function colors(level) {
    if (level === 'success') return { bar: '#1f7a4d', accent: '#7be2a8' };
    if (level === 'warning') return { bar: '#7a5a1f', accent: '#ffd54a' };
    return { bar: '#13315c', accent: '#ffd54a' };
  }

  function render(msg) {
    var c = colors(msg.level);
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'status');
    wrap.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:99999',
      'max-width:560px', 'margin:0 auto', 'background:' + c.bar,
      'color:#fff', 'border:2px solid ' + c.accent, 'border-radius:16px',
      'box-shadow:0 12px 32px rgba(0,0,0,.45)', 'padding:14px 16px',
      "font-family:'Trebuchet MS','Segoe UI',sans-serif",
      'display:flex', 'gap:12px', 'align-items:flex-start',
      'animation:igSlideUp .25s ease-out'
    ].join(';');

    var text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0';
    var h = document.createElement('div');
    h.style.cssText = 'font-weight:bold;font-size:16px;margin-bottom:2px';
    h.textContent = msg.title;
    var p = document.createElement('div');
    p.style.cssText = 'font-size:13px;line-height:1.4;color:#dbe6fb';
    p.textContent = msg.body || '';
    text.appendChild(h); text.appendChild(p);

    if (msg.cta && msg.cta.href && msg.cta.label) {
      var a = document.createElement('a');
      a.href = /^https?:\/\//.test(msg.cta.href) ? msg.cta.href : BASE + msg.cta.href;
      a.textContent = msg.cta.label;
      a.style.cssText = 'display:inline-block;margin-top:8px;padding:7px 14px;border-radius:10px;'
        + 'background:' + c.accent + ';color:#0a0e1a;font-weight:bold;font-size:13px;text-decoration:none';
      a.addEventListener('click', function () {
        if (window.track) window.track('announcement_cta', { id: msg.id });
        dismiss(msg.id);
      });
      text.appendChild(a);
    }

    var x = document.createElement('button');
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '✕';
    x.style.cssText = 'background:transparent;border:0;color:#9fb3d8;font-size:18px;cursor:pointer;padding:2px 4px;line-height:1';
    x.addEventListener('click', function () {
      dismiss(msg.id);
      if (window.track) window.track('announcement_dismiss', { id: msg.id });
      wrap.remove();
    });

    wrap.appendChild(text);
    wrap.appendChild(x);

    var style = document.createElement('style');
    style.textContent = '@keyframes igSlideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(style);
    document.body.appendChild(wrap);
    if (window.track) window.track('announcement_shown', { id: msg.id });
  }

  // network-first fetch so new messages appear immediately (sw.js also bypasses cache for messages.json)
  fetch(BASE + 'messages.json?ts=' + today(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !Array.isArray(data.messages)) return;
      var next = data.messages.filter(eligible)[0]; // show one at a time (most recent eligible)
      if (next) render(next);
    })
    .catch(function () {});
})();
