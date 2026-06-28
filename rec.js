/* Ilan's Arcade — per-game "Best on…" device label.
   Loaded by every game. Detects the game from the URL and shows a small chip
   on the game's screen for a few seconds (so players see the recommendation),
   then it fades out so it never blocks gameplay. */
(function () {
  'use strict';
  var REC = {
    cricket: 'both', 'catch': 'mobile', f1: 'pc', football: 'both', pptour: 'both',
    'fruit-arena': 'both', paper: 'pc', rescue: 'both', obby: 'both', puzzles: 'both',
    'try': 'pc', 'anime-tycoon': 'both', tennis: 'both', karate: 'both', stack: 'both', archer: 'both'
  };
  var LABEL = { both: '👍 Best on any device', mobile: '📱 Best on phone', pc: '💻 Best on PC / laptop' };

  // find the game folder in the path (works on /ilan-games/<game>/ and /<game>/)
  var parts = location.pathname.split('/').filter(Boolean);
  var key = null;
  for (var i = parts.length - 1; i >= 0; i--) { if (Object.prototype.hasOwnProperty.call(REC, parts[i])) { key = parts[i]; break; } }
  if (!key) return;
  var cat = REC[key], text = LABEL[cat];
  if (!text) return;

  function show() {
    if (!document.body) { setTimeout(show, 60); return; }
    if (document.getElementById('igRecChip')) return;
    var el = document.createElement('div');
    el.id = 'igRecChip';
    el.textContent = text;
    el.setAttribute('style',
      'position:fixed;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);' +
      'z-index:2147483600;background:rgba(8,10,20,.85);color:#eaf2ff;' +
      'font-family:system-ui,"Segoe UI",Roboto,sans-serif;font-weight:700;font-size:12px;line-height:1;' +
      'padding:7px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.22);' +
      'box-shadow:0 3px 10px rgba(0,0,0,.45);pointer-events:none;white-space:nowrap;' +
      'transition:opacity 1s ease;opacity:1');
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1100); }, 7000);
  }
  show();
})();
