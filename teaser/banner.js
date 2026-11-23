/* ilan games V2 teaser banner — shows on the home page until 26 Nov 2026 12:00 AM (viewer's local time), then removes itself.
   Self-contained: delete this folder + the one <script> line in index.html to remove it for good. */
(function () {
  var RELEASE = new Date(2026, 10, 25, 0, 0, 0);   // 25 Nov 2026, 00:00 local
  var EXPIRE  = new Date(2026, 10, 26, 0, 0, 0);   // 26 Nov 2026, 00:00 local -> banner gone
  if (Date.now() >= EXPIRE) return;

  var css = `
  .v2t{--f:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter',system-ui,sans-serif;position:relative;width:100%;max-width:560px;margin:4px auto 24px;border-radius:30px;padding:2px;font-family:var(--f);text-align:left;cursor:pointer;
    background:conic-gradient(from var(--v2a,0deg),#5e5ce6,#bf5af2,#ff375f,#ff9f0a,#ffd60a,#5e5ce6);animation:v2spin 6s linear infinite;
    box-shadow:0 24px 60px -18px rgba(191,90,242,.55),0 10px 30px -10px rgba(255,55,95,.4);transition:transform .35s cubic-bezier(.2,.8,.2,1)}
  @property --v2a{syntax:'<angle>';inherits:false;initial-value:0deg}
  @keyframes v2spin{to{--v2a:360deg}}
  .v2t:hover{transform:translateY(-3px) scale(1.01)} .v2t:active{transform:scale(.98)}
  .v2t-in{border-radius:28px;overflow:hidden;background:#0b0b12;color:#fff}
  .v2t-pic{position:relative;aspect-ratio:16/9;background:#fff url(teaser/poster.jpg) center/cover}
  .v2t-pic:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(11,11,18,.9))}
  .v2t-play{position:absolute;right:16px;top:14px;width:58px;height:58px;border-radius:50%;z-index:2;display:grid;place-items:center;
    background:rgba(20,20,30,.55);-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);border:1px solid rgba(255,255,255,.35);box-shadow:0 10px 30px rgba(0,0,0,.35)}
  .v2t-play:before{content:'';position:absolute;inset:-8px;border-radius:50%;border:2px solid rgba(255,255,255,.7);animation:v2pulse 1.8s ease-out infinite}
  @keyframes v2pulse{from{transform:scale(.85);opacity:1}to{transform:scale(1.45);opacity:0}}
  .v2t-tag{position:absolute;left:16px;top:16px;z-index:2;font:700 11px/1 var(--f);letter-spacing:.12em;padding:7px 11px;border-radius:999px;color:#fff;background:linear-gradient(90deg,#ff375f,#ff9f0a);box-shadow:0 6px 16px rgba(255,55,95,.45)}
  .v2t-body{padding:4px 22px 20px;margin-top:-34px;position:relative;z-index:2}
  .v2t-h{font:800 30px/1.05 var(--f);letter-spacing:-.04em}
  .v2t-h span{background:linear-gradient(90deg,#a5a4ff,#e08cff 40%,#ff6b8a 75%,#ffbe4d);-webkit-background-clip:text;background-clip:text;color:transparent}
  .v2t-s{font:500 15px/1.4 var(--f);color:rgba(255,255,255,.66);margin-top:8px;letter-spacing:-.01em}
  .v2t-s b{color:#fff;font-weight:700}
  .v2t-row{display:flex;align-items:center;gap:12px;margin-top:16px;flex-wrap:wrap}
  .v2t-cd{display:flex;gap:6px}
  .v2t-cd div{min-width:50px;padding:7px 6px 6px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);text-align:center;font:700 20px/1 var(--f);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
  .v2t-cd small{display:block;font:600 9px/1 var(--f);letter-spacing:.1em;color:rgba(255,255,255,.45);margin-top:4px}
  .v2t-btn{margin-left:auto;height:44px;padding:0 20px;border-radius:999px;border:0;background:#fff;color:#0b0b12;font:700 15px/1 var(--f);letter-spacing:-.01em;display:inline-flex;align-items:center;gap:8px;cursor:pointer}
  .v2t-now{font:700 18px/1 var(--f);letter-spacing:-.02em}
  @media (max-width:420px){.v2t-h{font-size:25px}.v2t-cd div{min-width:44px;font-size:18px}.v2t-btn{margin-left:0;width:100%;justify-content:center}}
  .v2m{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .35s}
  .v2m.on{opacity:1}
  .v2m video{width:100%;max-width:1200px;max-height:100%;border-radius:18px;background:#000;box-shadow:0 30px 90px rgba(0,0,0,.6);transform:scale(.94);transition:transform .45s cubic-bezier(.2,.8,.2,1)}
  .v2m.on video{transform:none}
  .v2m-x{position:absolute;top:max(16px,env(safe-area-inset-top));right:16px;width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.12);color:#fff;font:400 26px/1 sans-serif;cursor:pointer;display:grid;place-items:center}
  @media (prefers-reduced-motion:reduce){.v2t,.v2t-play:before{animation:none}}`;

  function mount() {
    if (Date.now() >= EXPIRE || document.querySelector('.v2t')) return;
    var st = document.createElement('style'); st.id = 'v2t-style'; st.textContent = css; document.head.appendChild(st);
    var card = document.createElement('div');
    card.className = 'v2t'; card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0'); card.setAttribute('aria-label', 'Watch the ilan games Version 2 teaser');
    card.innerHTML =
      '<div class="v2t-in"><div class="v2t-pic"><span class="v2t-tag">NEW · TEASER</span>' +
      '<span class="v2t-play"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#fff"/></svg></span></div>' +
      '<div class="v2t-body"><div class="v2t-h">Version 2 is <span>coming.</span></div>' +
      '<div class="v2t-s">A brand-new design for every game. Modern, royal, simple.<br><b>Releasing November 25, without fail.</b></div>' +
      '<div class="v2t-row"><div class="v2t-cd" id="v2tcd"></div>' +
      '<button class="v2t-btn" type="button"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>Watch teaser</button></div></div></div>';
    var h1 = document.querySelector('body > h1'), sub = document.querySelector('body > .sub');
    var anchor = sub || h1;
    if (anchor) anchor.insertAdjacentElement('afterend', card); else document.body.prepend(card);
    card.addEventListener('click', openVideo);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVideo(); } });
    tick(); var iv = setInterval(function () { if (Date.now() >= EXPIRE) { clearInterval(iv); unmount(); } else tick(); }, 1000);
  }
  function unmount() { var c = document.querySelector('.v2t'); c && c.remove(); var s = document.getElementById('v2t-style'); s && s.remove(); var m = document.querySelector('.v2m'); m && m.remove(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tick() {
    var el = document.getElementById('v2tcd'); if (!el) return;
    var ms = RELEASE - Date.now();
    if (ms <= 0) { el.innerHTML = '<span class="v2t-now">Out today. Enjoy!</span>'; return; }
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    el.innerHTML = [[d, 'DAYS'], [pad(h), 'HRS'], [pad(m), 'MIN'], [pad(x), 'SEC']].map(function (p) { return '<div>' + p[0] + '<small>' + p[1] + '</small></div>'; }).join('');
  }
  function openVideo() {
    var m = document.createElement('div'); m.className = 'v2m';
    m.innerHTML = '<video src="teaser/v2-teaser.mp4" poster="teaser/poster.jpg" playsinline controls autoplay preload="auto"></video><button class="v2m-x" aria-label="Close">×</button>';
    document.body.appendChild(m); requestAnimationFrame(function () { m.classList.add('on'); });
    var v = m.querySelector('video'); var p = v.play(); if (p && p.catch) p.catch(function () {});
    function close() { v.pause(); m.classList.remove('on'); setTimeout(function () { m.remove(); }, 350); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    m.querySelector('.v2m-x').onclick = close;
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    v.addEventListener('ended', function () { setTimeout(close, 600); });
    document.addEventListener('keydown', esc);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
