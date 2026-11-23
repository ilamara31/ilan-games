/* ilan Games shared theme: one clean light (Apple-style) look for the home page and every game.
   Include in <head>:  <script src="../theme.js"></script>  — it loads theme.css and the soft background lights. */
(function () {
  var d = document.documentElement;
  d.setAttribute('data-theme', 'light');
  var base = (document.currentScript && document.currentScript.src || '').replace(/theme\.js.*$/, '');
  if (!document.querySelector('link[data-ig-theme]')) {
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + 'theme.css'; l.setAttribute('data-ig-theme', '');
    document.head.appendChild(l);
  }
  function aurora() { if (!document.querySelector('.ig-aurora')) { var a = document.createElement('div'); a.className = 'ig-aurora'; a.setAttribute('aria-hidden', 'true'); document.body.insertBefore(a, document.body.firstChild); } }
  if (document.body) aurora(); else document.addEventListener('DOMContentLoaded', aurora);

  // The shared scripts (auth.js, friends.js, announce.js, rec.js) write labels like "👤 Log in",
  // "🎮 Ilan Games account" or "👥 Friends". The new design uses no emoji icons, so strip a LEADING
  // emoji from their titles / buttons / labels. Chat messages and user names are never touched.
  var LEAD = /^(?:\s*(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}])+)+\s*/u;
  var ROOTS = '#IGA_login, #acctBtn, .iga-ov, .igf-ov, .igf-banner, #ig-uotw-pop, #igRecChip, body > [role=status]';
  var SKIP = '.igf-bub, .igf-msg, input, textarea, [contenteditable]';
  var LABELS = { H1:1, H2:1, H3:1, H4:1, BUTTON:1, A:1, LABEL:1, B:1, STRONG:1, SPAN:1, DIV:1 };
  function clean(root) {
    if (!root || !root.querySelectorAll) return;
    var list = [];
    if (root.matches && root.matches(ROOTS)) list.push(root);
    Array.prototype.push.apply(list, root.querySelectorAll(ROOTS));
    list.forEach(function (r) {
      var w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) {
        var el = n.parentElement;
        if (!el || !LABELS[el.tagName] || el.closest(SKIP)) continue;
        if (n !== el.firstChild) continue;                 // only the start of a label
        var t = n.nodeValue, u = t.replace(LEAD, '');
        if (u !== t && u.trim()) n.nodeValue = u;
      }
    });
  }
  var pending = false;
  function sweep() {
    pending = false; clean(document.body);
    // device-tip pill from rec.js: keep it at the bottom centre (its own inline style puts it at the top)
    var chip = document.getElementById('igRecChip');
    if (chip && !chip.__ig) { chip.__ig = 1; chip.style.top = 'auto'; chip.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 16px)'; }
  }
  function watch() {
    sweep();
    new MutationObserver(function () { if (!pending) { pending = true; requestAnimationFrame(sweep); } })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  try { if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch); } catch (e) {}
})();
