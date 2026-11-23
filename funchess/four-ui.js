/* =====================================================================
   Fun Chess — 4 Player mode (UI, bots, clocks, online rooms).
   Rules come from four.js (global Four). Shared helpers come from the
   main page (window.FunChess). Loaded by index.html after its main script.
   ===================================================================== */
(function () {
'use strict';
const F = window.FunChess, Four = window.Four;
if (!F || !Four) { console.warn('[funchess] 4 player mode unavailable'); return; }
const $ = id => document.getElementById(id);
const { Board, pieceSVG, esc, clamp, tap, toast, confirmBox, rpc, me, myName, show, fitBoard, fitters, fitAll, Snd, tcOf, tcLabel, tcStr, tcFromStr, TCS, hueOf, initial, seg, copyText, recordUnrated, client } = F;
const S = () => F.store();
const now = () => performance.now();
const N = 14;
const SEATC = ['red', 'blue', 'yellow', 'green'];
const SEATN = Four.NAMES;
const SEATHEX = ['#ff5a4f', '#4f93ff', '#ffd23f', '#4fd27a'];
const LEVELS4 = [{ n: 'Easy', e: '🐣' }, { n: 'Normal', e: '🙂' }, { n: 'Hard', e: '😤' }, { n: 'Expert', e: '👑' }];
const OUTSHORT = { mate: 'Mated', stalemate: 'Stalemate', resign: 'Resigned', timeout: 'Time', disconnect: 'Left' };
const OUTTXT = { mate: 'Checkmated', stalemate: 'Stalemated', resign: 'Resigned', timeout: 'Out of time', disconnect: 'Disconnected' };
const ORD = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th');
const idx = (x, y) => y * N + x;
const F4DEF = { f4mode: 'bot', f4tc: 'blitz', f4level: 2, f4seat: 0 };
const set = () => { const s = S().set; for (const k in F4DEF) if (s[k] == null) s[k] = F4DEF[k]; return s; };

/* ---------------------------------------------------------------- state of the game on screen */
const X = {
  st: null, mode: 'bot', my: 0, view: 0, tc: tcOf('blitz'), clk: [0, 0, 0, 0], run: null, since: 0,
  names: ['', '', '', ''], elos: [null, null, null, null], bots: [false, false, false, false], level: 2,
  over: false, active: false, lastBy: [null, null, null, null], botT: 0, botKey: '', low: {}, standings: null, fast: false, key: '', recorded: false, banner: '',
};
function remaining(s) { return X.clk[s] - (X.run === s ? Math.max(0, now() - X.since) : 0); }

/* ---------------------------------------------------------------- board */
function bgSVG(B) {
  // rich two-tone squares, a tint of each player's colour on their home ranks, glowing cross outline
  let h = '';
  const homeTint = (x, y) => y <= 1 && x >= 3 && x <= 10 ? 0 : x <= 1 && y >= 3 && y <= 10 ? 1 : y >= 12 && x >= 3 && x <= 10 ? 2 : x >= 12 && y >= 3 && y <= 10 ? 3 : -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!Four.isSquare(x, y)) continue;
    const [c, r] = B.toScreen(idx(x, y));
    const light = (x + y) % 2 === 1;
    h += `<rect x="${c}" y="${r}" width="1.003" height="1.003" fill="${light ? '#d8d3e6' : '#6f6a96'}"/>`;
    const t = homeTint(x, y);
    if (t >= 0) h += `<rect x="${c}" y="${r}" width="1.003" height="1.003" fill="${SEATHEX[t]}" opacity="${light ? .26 : .3}"/>`;
  }
  const cross = '3,0 11,0 11,3 14,3 14,11 11,11 11,14 3,14 3,11 0,11 0,3 3,3';
  return `<defs><filter id="glow4" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".18"/></filter>
    <linearGradient id="sheen4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>
    <polygon points="${cross}" fill="#1a1838"/>
    ${h}
    <polygon points="${cross}" fill="url(#sheen4)"/>
    <polygon points="${cross}" fill="none" stroke="#ffd89a" stroke-width=".12" opacity=".75" filter="url(#glow4)"/>
    <polygon points="${cross}" fill="none" stroke="#fff3d6" stroke-width=".035" opacity=".9"/>`;
}
const board4 = new Board($('f4Board'), {
  n: N, valid: (x, y) => Four.isSquare(x, y), customBg: bgSVG,
  canPick: i => canPick(i), destsOf: i => destsOf(i), onMove: (f, t) => userMove(f, t),
});
const cardsEl = document.createElement('div'); cardsEl.className = 'cards4'; board4.el.appendChild(cardsEl);
fitters.push(() => fitBoard(board4, $('f4Wrap'), $('f4Bcol')));
F.extraBoards.push(board4);

function posOf4(st) {
  const pos = {};
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const p = st.board[y][x]; if (p) pos[idx(x, y)] = { t: p.t, c: p.dead ? 'dead' : SEATC[p.c] }; }
  return pos;
}
function myTurn() { return X.active && !X.over && X.st && !X.st.over && X.st.turn === X.my && !X.st.out[X.my] && (X.mode !== 'online' || Online4.canMove()); }
function canPick(i) {
  if (!myTurn()) return false;
  const x = i % N, y = Math.floor(i / N), p = X.st.board[y][x];
  return !!p && !p.dead && p.c === X.my;
}
function destsOf(i) {
  const x = i % N, y = Math.floor(i / N);
  return Four.legalMovesFrom(X.st, x, y).map(m => ({ to: idx(m.to.x, m.to.y), cap: !!X.st.board[m.to.y][m.to.x] }));
}
function userMove(fi, ti) {
  if (!myTurn()) { render(false); return; }
  const fx = fi % N, fy = Math.floor(fi / N), tx = ti % N, ty = Math.floor(ti / N);
  const m = Four.legalMovesFrom(X.st, fx, fy).find(mv => mv.to.x === tx && mv.to.y === ty);
  if (!m) { render(false); return; }
  if (X.mode === 'online') { Online4.sendMove(m); return; }
  applyLocal(m);
}
function trim(st) { if (st.history && st.history.length > 12) st.history = st.history.slice(-12); return st; }

/* ---------------------------------------------------------------- local (vs bots) engine loop */
function applyLocal(m) {
  if (X.over) return false;
  const seat = X.st.turn;
  let r;
  try { r = Four.applyMove(X.st, m); } catch (e) { console.warn('[funchess4] illegal', e && e.message); render(false); return false; }
  X.clk[seat] = Math.max(0, remaining(seat)) + X.tc.i * 1000;
  X.st = trim(r.state); X.lastBy[seat] = m;
  X.run = X.st.over ? null : X.st.turn; X.since = now();
  handleEvents(r.events, seat, m);
  render(true);
  afterChange();
  return true;
}
function afterChange() {
  if (X.st.over || Four.isOver(X.st)) { finish(); return; }
  maybeBot();
}
function maybeBot() {
  if (X.over || !X.active || X.mode !== 'bot') return;
  const s = X.st.turn;
  if (!X.bots[s]) return;
  const key = X.st.moveNo + ':' + s;
  if (X.botKey === key) return;
  X.botKey = key;
  clearTimeout(X.botT);
  X.botT = setTimeout(() => {
    if (X.over || X.mode !== 'bot' || X.st.moveNo + ':' + X.st.turn !== key) return;
    const m = Four.botMove(X.st, X.level);
    if (m) applyLocal(m);
  }, botDelay(s));
}
function botDelay(s) {
  if (X.fast) return 5;
  let d = 400 + Math.random() * 800;
  const rem = remaining(s);
  return Math.max(60, Math.min(d, rem / 15));
}
function eliminateLocal(seat, reason) {
  const r = Four.eliminate(X.st, seat, reason);
  X.st = trim(r.state);
  X.run = X.st.over ? null : X.st.turn; X.since = now();
  handleEvents(r.events, null, null);
  render(false);
  afterChange();
}
setInterval(() => {
  if (!X.st) return;
  paintCards();
  if (X.active && !X.over && X.mode === 'bot' && X.run != null && remaining(X.run) <= 0) { const s = X.run; X.clk[s] = 0; eliminateLocal(s, 'timeout'); }
  if (X.active && !X.over && X.run === X.my && remaining(X.my) < 10000 && remaining(X.my) > 0 && !X.low[X.my]) { X.low[X.my] = 1; Snd.low(); }
  if (X.mode === 'online') Online4.tickUi();
}, 100);

/* ---------------------------------------------------------------- events → sounds, popups, toasts */
const nameOf = s => X.names[s] || SEATN[s];
function handleEvents(evs, mover, m) {
  let snd = 'move', msgs = [];
  for (const e of evs || []) {
    if (e.type === 'capture') { if (snd === 'move') snd = 'capture'; if (e.points > 0 && e.at) popup(e.at, '+' + e.points, e.seat); }
    else if (e.type === 'castle') { if (snd === 'move') snd = 'castle'; }
    else if (e.type === 'check') snd = 'check';
    else if (e.type === 'bonus') { msgs.push(`${e.kings === 3 ? 'Triple' : 'Double'} check by ${nameOf(e.seat)}! +${e.points}`); const k = kingPos(e.seat); }
    else if (e.type === 'mate') { msgs.push(`${nameOf(e.seat)} checkmated by ${nameOf(e.by)} +20`); snd = 'mate'; const k = kingPos(e.seat); if (k) popup(k, '+20', e.by); }
    else if (e.type === 'stalemate') { msgs.push(`${nameOf(e.seat)} is stalemated +20`); snd = 'mate'; }
    else if (e.type === 'eliminate') { msgs.push(`${nameOf(e.seat)} ${e.reason === 'resign' ? 'resigned' : e.reason === 'timeout' ? 'ran out of time' : e.reason === 'disconnect' ? 'disconnected' : 'is out'}`); if (snd !== 'mate') snd = 'out'; }
  }
  if (snd === 'check') Snd.check(); else if (snd === 'mate' || snd === 'out') Snd.end(null); else if (snd === 'capture') Snd.capture(); else if (snd === 'castle') Snd.castle(); else if (mover != null) Snd.move();
  if (msgs.length) toast(msgs.join(' · '), 3200);
}
function kingPos(seat) {
  if (!X.st) return null;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const p = X.st.board[y][x]; if (p && p.t === 'k' && p.c === seat) return { x, y }; }
  return null;
}
function popup(at, text, seat) {
  const [c, r] = board4.toScreen(idx(at.x, at.y));
  const d = document.createElement('div'); d.className = 'pop4'; d.textContent = text;
  d.style.left = (c * 100 / N) + '%'; d.style.top = (r * 100 / N) + '%'; d.style.setProperty('--pcol', SEATHEX[seat == null ? 0 : seat]);
  board4.el.appendChild(d); setTimeout(() => d.remove(), 1400);
}

/* ---------------------------------------------------------------- rendering */
function render(anim) {
  if (!X.st) return;
  board4.setOrient(X.view);
  board4.setPieces(posOf4(X.st), anim);
  const extra = [];
  for (let s = 0; s < 4; s++) { const m = X.lastBy[s]; if (m) { extra.push([idx(m.from.x, m.from.y), 'lm' + s], [idx(m.to.x, m.to.y), 'lm' + s]); } }
  const checks = [];
  for (let s = 0; s < 4; s++) if (!X.st.out[s] && X.st.active[s] !== false) { try { if (Four.inCheck(X.st, s)) { const k = kingPos(s); if (k) checks.push(idx(k.x, k.y)); } } catch (e) {} }
  board4.sel = -1; board4.dests = [];
  board4.setHl({ extra, checks });
  paintCards(true); renderStatus();
  $('f4Resign').disabled = !X.active || X.over || !!X.st.out[X.my] || (X.mode === 'online' && !Online4.playing());
}
let cardsSig = '';
function paintCards(force) {
  if (!X.st) return;
  const pos = ['bl', 'tl', 'tr', 'br'];
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const s = (X.view + k) % 4, out = X.st.out[s];
    const on = !X.over && !X.st.over && X.st.turn === s && !out;
    const ms = remaining(s), low = on && ms < 10000;
    const sub = X.bots[s] ? `${LEVELS4[X.level - 1].e} Bot` : X.elos[s] != null ? `★ ${X.elos[s]}` : '';
    const away = X.mode === 'online' ? Online4.awayLeft(s) : null;
    parts.push(`<div class="pc4 ${pos[k]}${on ? ' on' : ''}${low ? ' low' : ''}${out ? ' out' : ''}${s === X.my && !X.spectator ? ' me' : ''}" style="--pcol:${SEATHEX[s]}">
      <div class="nm"><i></i><span>${esc(nameOf(s))}</span></div>
      ${out ? `<div class="tagout">Out · ${OUTSHORT[out] || out}</div>` : away != null ? `<div class="tagout">📡 ${away}s</div>` : `<div class="sub">${esc(sub)}</div>`}
      <div class="pts">${X.st.points[s]}<small>pts</small></div>
      <div class="clk">${F.fmtClock(out ? Math.max(0, X.clk[s]) : ms)}</div></div>`);
  }
  const html = parts.join('');
  if (html !== cardsSig) { cardsSig = html; cardsEl.innerHTML = html; }
}
function renderStatus() {
  const el = $('f4Status');
  if (X.banner) { el.innerHTML = X.banner; return; }
  if (!X.st) { el.innerHTML = ''; return; }
  if (X.over) { el.innerHTML = $('standSheet').hidden ? '<button class="btn ghost sm" data-a="result">Show result</button>' : ''; return; }
  const t = X.st.turn;
  if (X.st.out[X.my] && !X.spectator) {
    el.innerHTML = `<div class="banner">You're out (${OUTTXT[X.st.out[X.my]] || ''}). Keep watching or leave.${X.mode === 'bot' ? ' <button class="btn ghost" data-a="fast">Fast-forward</button>' : ''}</div>`;
    return;
  }
  el.innerHTML = t === X.my ? `<span style="color:${SEATHEX[t]}">● Your turn</span>` : `<span style="color:${SEATHEX[t]}">● ${esc(nameOf(t))}${X.bots[t] ? ' is thinking…' : '’s turn'}</span>`;
}
$('f4Status').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return; tap();
  if (b.dataset.a === 'result') { showStandings(); renderStatus(); return; }
  if (b.dataset.a === 'fast') { X.fast = true; X.botKey = ''; maybeBot(); b.disabled = true; }
  else Online4.bannerAction(b.dataset.a);
});

/* ---------------------------------------------------------------- start / finish */
function startLocal(o) {
  clearTimeout(X.botT);
  Object.assign(X, {
    st: Four.newGame(), mode: o.mode, my: o.my, view: o.my, tc: o.tc, clk: [0, 1, 2, 3].map(() => o.tc.m * 60000), run: 0, since: now() + 800,
    names: o.names, elos: o.elos || [null, null, null, null], bots: o.bots, level: o.level || 2, over: false, active: true,
    lastBy: [null, null, null, null], botKey: '', low: {}, standings: null, fast: false, key: o.key || '', recorded: false, banner: '', spectator: !!o.spectator,
  });
  $('standSheet').hidden = true;
  $('f4Title').textContent = o.mode === 'bot' ? `vs 3 Bots · ${LEVELS4[X.level - 1].n}` : '4 Player online';
  $('f4Sub').textContent = tcLabel(o.tc) + (o.mode === 'online' ? (o.rated ? ' · Rated' : F.ratingsOff() ? ' · Ratings not set up yet' : ' · Unrated') : '');
  show('four');
  board4.setPieces({}, false);
  render(false);
  if (o.mode === 'bot') { persistLocal(); maybeBot(); }
}
function finish() {
  if (X.over) return;
  X.over = true; clearTimeout(X.botT);
  for (let s = 0; s < 4; s++) X.clk[s] = Math.max(0, remaining(s));
  X.run = null;
  X.standings = Four.standings(X.st);
  render(false);
  const mine = X.standings.find(r => r.seat === X.my);
  Snd.end(mine && mine.place === 1 ? true : false);
  if (X.mode === 'bot' && !X.recorded) {
    X.recorded = true;
    recordUnrated('bot4', mine && mine.place === 1 ? 'win' : 'loss', null, `lvl${X.level} ${tcStr(X.tc)} place${mine ? mine.place : 4}`);
    clearLocal();
  }
  setTimeout(() => { if (X.over && F.store && document.getElementById('four').hidden === false) showStandings(); }, 900);
}
function showStandings() {
  $('stBtns').hidden = false;
  const st = X.standings || Four.standings(X.st);
  const mine = st.find(r => r.seat === X.my);
  const place = mine ? mine.place : 0;
  $('stTitle').textContent = X.spectator ? 'Game over' : place === 1 ? 'You won!' : `You finished ${ORD(place)}`;
  $('stTitle').className = 'resTitle ' + (place === 1 ? 'win' : place === 2 ? 'draw' : 'loss');
  $('stReason').textContent = { last: 'Only one player left', kings: 'Only kings left', quiet: 'No captures for a long time' }[X.st.overReason] || 'Game over';
  $('stList').innerHTML = st.map(r => `<div class="stand${r.seat === X.my ? ' me' : ''}"><div class="pl">${r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : r.place}</div>
    <div class="pc">${pieceSVG('k', SEATC[r.seat])}</div><div class="nm">${esc(nameOf(r.seat))}<small>${r.out ? OUTTXT[r.out] || r.out : 'Still in'}</small></div><div class="sc">${r.points}</div></div>`).join('');
  $('stElo').hidden = X.mode !== 'online';
  if (X.mode === 'online') Online4.paintElo();
  $('stAgain').textContent = X.mode === 'online' ? (Online4.isHost() ? 'Play again' : 'Host decides') : 'Play again';
  $('stAgain').disabled = X.mode === 'online' && !Online4.isHost();
  $('stBtns').hidden = false;
  $('standSheet').hidden = false;
  if (place === 1 && !X.spectator && X.over) confetti();
}
function confetti() {
  const box = document.createElement('div'); box.className = 'confetti';
  for (let i = 0; i < 70; i++) { const p = document.createElement('i'); p.style.left = Math.random() * 100 + '%'; p.style.background = SEATHEX[i % 4];
    p.style.animationDuration = (1.6 + Math.random() * 1.6) + 's'; p.style.animationDelay = (Math.random() * .5) + 's'; box.appendChild(p); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 3800);
}
$('stView').onclick = () => { tap(); $('standSheet').hidden = true; renderStatus(); };
$('stHome').onclick = () => { tap(); leaveGame(); show('home'); };
$('stNew').onclick = () => { tap(); leaveGame(); openSetup(); };
$('stAgain').onclick = () => {
  tap();
  if (X.mode === 'online') { Online4.again(); $('standSheet').hidden = true; return; }
  startBots();
};
function leaveGame() {
  clearTimeout(X.botT); X.active = false; $('standSheet').hidden = true;
  if (X.mode === 'online') Online4.leave(true);
  if (X.mode === 'bot' && !X.over) clearLocal();
}
$('f4Rotate').onclick = () => { tap(); X.view = (X.view + 1) % 4; render(false); };
$('f4Table').onclick = () => { tap(); if (!X.st) return; X.standings = Four.standings(X.st); showStandings(); if (!X.over) { $('stTitle').textContent = 'Scores so far'; $('stTitle').className = 'resTitle draw'; $('stReason').textContent = 'The game is still going'; $('stBtns').hidden = true; } else $('stBtns').hidden = false; };
$('standSheet').addEventListener('click', e => { if (e.target.id === 'standSheet') $('standSheet').hidden = true; });
const _show = showStandings;
$('f4Resign').onclick = () => {
  tap(); if (!X.active || X.over || X.st.out[X.my]) return;
  confirmBox('Resign?', 'You will be out of this game. You can keep watching.', 'Resign', () => {
    if (X.over || X.st.out[X.my]) return;
    if (X.mode === 'online') { Online4.act('resign'); return; }
    eliminateLocal(X.my, 'resign');
  });
};
$('f4Back').onclick = () => {
  tap();
  // vs bots: leaving before my first move is free; after that it counts as a loss
  const movedYet = X.st && X.st.moveNo > X.my;
  if (X.active && !X.over && !X.st.out[X.my] && !X.spectator && (X.mode === 'online' || movedYet)) {
    confirmBox('Leave the game?', X.mode === 'online' ? 'Leaving counts as resigning.' : 'Leaving now counts as a loss.', 'Leave', () => {
      if (X.mode === 'online') { Online4.act('resign'); setTimeout(() => { leaveGame(); show('home'); }, 500); return; }
      eliminateLocal(X.my, 'resign');
      if (!X.recorded) { X.recorded = true; recordUnrated('bot4', 'loss', null, 'left'); }
      leaveGame(); show('home');
    });
    return;
  }
  if (X.mode === 'bot' && !X.over) {
    clearLocal();
    // resigned / flagged earlier and now leaving before the bots finish: still a lost game
    if (X.active && X.st && X.st.out[X.my] && !X.recorded) { X.recorded = true; recordUnrated('bot4', 'loss', null, 'left'); }
  }
  leaveGame(); show('home');
};
$('f4Mute').onclick = () => { S().set.snd = !S().set.snd; F.save(); F.paintMute(); paintMute4(); if (S().set.snd) { Snd.unlock(); Snd.tap(); } };
const SND_ON4 = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/></svg>', SND_OFF4 = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>';
function paintMute4() { $('f4Mute').innerHTML = S().set.snd ? SND_ON4 : SND_OFF4; }

/* ---------------------------------------------------------------- local save (vs bots game survives a reload) */
const LKEY = 'funChess_game4';
function persistLocal() {
  if (X.mode !== 'bot' || X.over || !X.active) return;
  try { localStorage.setItem(LKEY, JSON.stringify({ v: 1, st: X.st, my: X.my, tc: X.tc, clk: [0, 1, 2, 3].map(remaining), names: X.names, bots: X.bots, level: X.level, lastBy: X.lastBy, at: Date.now(), who: myName() || '' })); } catch (e) {}
}
function clearLocal() { try { localStorage.removeItem(LKEY); } catch (e) {} }
setInterval(persistLocal, 2000);
window.addEventListener('pagehide', persistLocal);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistLocal(); });
function resumeLocal() {
  let g = null; try { g = JSON.parse(localStorage.getItem(LKEY)); } catch (e) {}
  if (!g || g.v !== 1 || !g.st || Date.now() - g.at > 24 * 3600 * 1000 || (g.who || '') !== (myName() || '')) { clearLocal(); return false; }
  startLocal({ mode: 'bot', my: g.my, tc: g.tc, names: g.names, bots: g.bots, level: g.level });
  X.st = g.st; X.clk = g.clk; X.lastBy = g.lastBy || [null, null, null, null]; X.run = X.st.over ? null : X.st.turn; X.since = now() + 1500;
  render(false); toast('Welcome back! Your game continues.');
  afterChange();
  return true;
}

/* ---------------------------------------------------------------- setup screen */
function openSetup() { show('setup4'); renderSetup(); }
function renderSetup() {
  const s = set();
  seg('f4Mode', s.f4mode, v => { s.f4mode = v; F.save(); renderSetup(); });
  $('f4Tc').innerHTML = TCS.map(t => `<button class="chip${s.f4tc === t.id ? ' on' : ''}" data-tc="${t.id}"><b>${t.id === 'custom' ? 'Custom' : t.i ? `${t.m} | ${t.i}` : `${t.m} min`}</b><small>${t.id === 'custom' ? `${clamp(s.cm, 1, 90)} | ${clamp(s.ci, 0, 60)}` : t.name}</small></button>`).join('');
  $('f4Custom').hidden = s.f4tc !== 'custom';
  $('f4cMin').textContent = clamp(s.cm, 1, 90); $('f4cInc').textContent = clamp(s.ci, 0, 60);
  const online = s.f4mode === 'online';
  $('f4BotBox').hidden = online;                 // online bots are a fixed medium level
  $('f4TcTitle').textContent = online ? 'Time for a new room' : 'Time';
  $('f4Levels').innerHTML = LEVELS4.map((l, i) => `<button class="lvl${s.f4level === i + 1 ? ' on' : ''}" data-l="${i + 1}"><span class="em">${l.e}</span><b>${l.n}</b><small>Level ${i + 1}</small></button>`).join('');
  $('f4OnlineBox').hidden = !online; $('f4StartBox').hidden = online; $('f4Net').hidden = !online;
  $('f4Login').hidden = !online || !!me();
  if (online) {
    $('f4OlNote').textContent = (F.ratingsOff() ? 'Ratings are not set up yet · ' : '') + '2 to 4 players · empty seats are played by bots';
    Online4.openLobby();
  }
}
function tc4() { const s = set(); return tcOf(s.f4tc); }
$('f4Tc').onclick = e => { const b = e.target.closest('[data-tc]'); if (!b) return; tap(); set().f4tc = b.dataset.tc; F.save(); renderSetup(); };
$('f4Custom').onclick = e => {
  const b = e.target.closest('[data-st]'); if (!b) return; tap();
  const s = set(), d = +b.dataset.d;
  if (b.dataset.st === 'm') { const v = s.cm; s.cm = clamp(v + d * (v >= 30 ? 5 : v >= 10 ? 2 : 1), 1, 90); } else s.ci = clamp(s.ci + d, 0, 60);
  F.save(); renderSetup();
};
$('f4Levels').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; tap(); set().f4level = +b.dataset.l; F.save(); renderSetup(); };
$('f4Start').onclick = () => { tap(); startBots(); };
$('f4LoginBtn').onclick = () => { try { window.IGAuth && IGAuth.openAuth(); } catch (e) {} };
function startBots() {
  const s = set(), my = 0, lvl = clamp(s.f4level | 0, 1, 4);     // you are Red, at the bottom
  const names = SEATN.map((n, i) => i === my ? (myName() || 'You') : n);
  startLocal({ mode: 'bot', my, tc: tc4(), names, bots: [0, 1, 2, 3].map(i => i !== my), level: lvl });
}

/* =====================================================================
   Online 4-player rooms. Same idea as 2-player: the host is the referee
   (validates moves with four.js, runs clocks and the bots for empty seats)
   and broadcasts the whole room state. If the host disappears, the next
   human in seat order takes over, so nobody is ever stuck.
   ===================================================================== */
const Online4 = (() => {
  const BOT_LEVEL = 2;   // empty online seats: a fixed medium bot
  const RKEY = 'funChess_room4', ABANDON = 60000, HOST_GONE = 12000, GRACE = 700, AUTO_START = 25000;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const randCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const tabId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const quiet = p => { try { Promise.resolve(p).catch(() => {}); } catch (e) {} };
  let code = null, isHost = false, rs = null, ch = null, chOk = false, gen = 0, tickT = 0, beatT = 0;
  let members = new Map(), quick = false, gotRs = false, joinAt = 0, lastSeq = -1, lastRsAt = 0, pending = null;
  let hostGoneAt = 0, resumeHostAt = 0, botKey = '', botT = 0, evSeen = 0, humansSince = 0;
  const joined = {}, reported = {}, eloInfo = {};
  let lobbyHooked = false;
  const myElo4 = () => { const p = F.prof(); return p && typeof p.elo4 === 'number' ? p.elo4 : S().elo4 || 500; };

  /* ---------- lobby list (shared lobby channel of the main page) ---------- */
  function openLobby() {
    if (!lobbyHooked) { lobbyHooked = true; F.Online.onLobby(() => renderRooms()); }
    F.Online.openLobby(); renderRooms();
  }
  function advertise() {
    const ad = isHost && rs ? { code, host: rs.host, kind: '4p', tc: rs.tc, n: humanCount(), playing: rs.status !== 'lobby', elo: (rs.elo || {})[rs.host] || 500, q: quick ? 1 : 0 } : null;
    F.Online.setAd(ad);
  }
  function renderRooms() {
    const ok = F.Online.lobbyReady();
    const pill = $('f4Net'); pill.textContent = ok ? 'Live' : 'Connecting…'; pill.classList.toggle('ok', ok);
    const box = $('f4Rooms'); if (!box || $('setup4').hidden) return;
    const rooms = F.Online.listRooms('4p').filter(r => r.code !== code);
    if (!rooms.length) { box.innerHTML = `<div class="empty">${ok ? 'No open rooms right now. Create one and it shows up here for everyone!' : 'Looking for rooms…'}</div>`; return; }
    box.innerHTML = '';
    for (const r of rooms) {
      const t = tcFromStr(r.tc), mine = r.host === myName(), full = (r.n | 0) >= 4;
      const row = document.createElement('div'); row.className = 'roomrow';
      row.innerHTML = `<div class="avatar" style="--h:${hueOf(r.host)}">${esc(initial(r.host))}</div><div class="grow"><div class="nm">${esc(r.host)}'s room</div><div class="sub">${t ? esc(tcLabel(t)) : '?'} · ${r.code} · ${r.n | 0}/4${r.playing ? ' · playing' : ''}</div></div>`;
      const b = document.createElement('button'); b.className = 'btn sm ' + (r.playing || mine || full ? 'ghost' : 'primary');
      b.textContent = r.playing ? 'Playing' : mine ? 'Yours' : full ? 'Full' : 'Join'; b.disabled = !!r.playing || mine || full;
      b.onclick = e => { e.stopPropagation(); tap(); join(r.code); };
      if (!r.playing && !mine && !full) { row.classList.add('tap'); row.dataset.code = r.code; row.onclick = () => { tap(); join(r.code); }; }
      row.appendChild(b); box.appendChild(row);
    }
  }
  function needLogin() { if (me()) return false; toast('Log in to play online'); try { window.IGAuth && IGAuth.openAuth(); } catch (e) {} return true; }

  /* ---------- create / join / quick / leave ---------- */
  function create(opt) {
    if (needLogin()) return;
    leave(true); if (F.Online.inRoom()) F.Online.leave(true);
    const used = new Set(F.Online.listRooms('4p').map(r => r.code)); let c = randCode(); while (used.has(c)) c = randCode();
    code = c; isHost = true; quick = !!(opt && opt.quick);
    rs = { v: 1, kind: '4p', code, host: myName(), seq: 1, status: 'lobby', tc: tcStr(tc4()), gameNo: 0, level: BOT_LEVEL,
      humans: [{ name: myName(), elo: myElo4() }], seats: [null, null, null, null], elo: { [myName()]: myElo4() }, st: null, clock: null, lastBy: [null, null, null, null],
      evlog: [], evk: 0, away: {}, result: null, gameId: null, rated: false, ratedOff: F.ratingsOff(), gid: null };
    enterRoom(); persist(); openLobby(); advertise(); renderRoom();
  }
  function join(c, opt) {
    if (needLogin()) return;
    c = String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (c.length !== 4) { toast('Room codes are 4 letters'); return; }
    leave(true); if (F.Online.inRoom()) F.Online.leave(true);
    code = c; isHost = false; quick = !!(opt && opt.quick); rs = null;
    enterRoom(); persist(); renderRoom();
  }
  function enterRoom() {
    members = new Map(); gotRs = false; joinAt = now(); lastSeq = -1; lastRsAt = now(); pending = null; hostGoneAt = 0; resumeHostAt = 0; botKey = ''; evSeen = rs ? rs.evk || 0 : 0; humansSince = 0;
    show('room4'); openRoom();
    clearInterval(tickT); tickT = setInterval(tick, 250);
    clearInterval(beatT); beatT = setInterval(() => { if (isHost && rs) send('rs4', snapshot()); }, 2000);
  }
  async function openRoom() {
    const my = ++gen; chOk = false;
    let s;
    try { s = await client(); } catch (e) { if (my === gen) { toast('Could not connect. Check your internet.'); setTimeout(() => { if (my === gen && code) openRoom(); }, 3000); } return; }
    if (my !== gen) return;
    const c = s.channel('funchess-room4-' + code, { config: { broadcast: { self: false }, presence: { key: tabId } } });
    ch = c;
    c.on('broadcast', { event: 'rs4' }, ({ payload }) => { if (my === gen) onRS(payload); });
    c.on('broadcast', { event: 'mv4' }, ({ payload }) => { if (my === gen && isHost) onMoveReq(payload); });
    c.on('broadcast', { event: 'act4' }, ({ payload }) => { if (my === gen && isHost) onAct(payload); });
    c.on('broadcast', { event: 'bye4' }, ({ payload }) => { if (my === gen) onBye(payload); });
    c.on('presence', { event: 'sync' }, () => { if (my === gen) onPresence(); });
    c.subscribe(st => {
      if (my !== gen) return;
      chOk = st === 'SUBSCRIBED';
      if (chOk) { try { quiet(c.track({ id: tabId, name: myName(), elo: myElo4() })); } catch (e) {} if (isHost && rs) send('rs4', snapshot()); }
      if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { chOk = false; try { s.removeChannel(c); } catch (e) {} setTimeout(() => { if (my === gen && code) openRoom(); }, 2000); }
      const p = $('r4Pill'); p.textContent = chOk ? 'Live' : 'Connecting…'; p.classList.toggle('ok', chOk);
    });
  }
  function send(event, payload) { if (ch && chOk) { try { quiet(ch.send({ type: 'broadcast', event, payload })); } catch (e) {} } }
  function leave(quietly) {
    if (!code) return;
    send('bye4', { code, name: myName(), host: isHost });
    const c = ch, s = F.client ? null : null;
    ch = null; chOk = false; gen++;
    clearInterval(tickT); clearInterval(beatT); clearTimeout(botT);
    if (c) setTimeout(() => { try { quiet(c.untrack()); } catch (e) {} client().then(sb => { try { quiet(sb.removeChannel(c)); } catch (e) {} }).catch(() => {}); }, 400);
    if (pending) clearInterval(pending.sendT);
    code = null; isHost = false; rs = null; pending = null; members = new Map(); quick = false;
    try { localStorage.removeItem(RKEY); } catch (e) {}
    advertise();
    if (X.mode === 'online') { X.active = false; X.banner = ''; }
    if (!quietly && !$('room4').hidden) openSetup();
  }
  function persist() {
    if (!code) return;
    try { localStorage.setItem(RKEY, JSON.stringify({ code, host: isHost, name: myName(), quick, rs: isHost ? rs : null, at: Date.now() })); } catch (e) {}
  }
  function resume() {
    let s = null; try { s = JSON.parse(localStorage.getItem(RKEY)); } catch (e) {}
    if (!s || !s.code || !me() || s.name !== myName() || Date.now() - (s.at || 0) > 3 * 3600 * 1000) { try { localStorage.removeItem(RKEY); } catch (e) {} return false; }
    if (s.host && s.rs) {
      if (s.rs.status === 'over' && Date.now() - s.at > 10 * 60000) { localStorage.removeItem(RKEY); return false; }
      // come back as a listener first: if someone else took over as host, follow them
      code = s.code; isHost = false; quick = !!s.quick; rs = s.rs;
      enterRoom(); resumeHostAt = now() + 4000; openLobby();
      applyRS(snapshotOf(rs), true);
      return true;
    }
    join(s.code, { quick: s.quick }); return true;
  }

  /* ---------- presence ---------- */
  function onPresence() {
    let st = {}; try { st = ch ? ch.presenceState() || {} : {}; } catch (e) {}
    const m = new Map();
    for (const k in st) for (const x of st[k] || []) if (x && typeof x.name === 'string' && x.name.length < 40) m.set(x.name, { name: x.name, elo: +x.elo || 500 });
    members = m;
    if (isHost && rs) {
      let changed = false;
      if (rs.status === 'lobby') {
        const keep = rs.humans.filter(h => h.name === rs.host || m.has(h.name));
        for (const [n, x] of m) if (!keep.some(h => h.name === n) && keep.length < 4) keep.push({ name: n, elo: x.elo });
        if (JSON.stringify(keep) !== JSON.stringify(rs.humans)) { rs.humans = keep; changed = true; }
      }
      for (const [n, x] of m) if (rs.elo[n] !== x.elo) { rs.elo[n] = x.elo; changed = true; }
      if (changed) publish();
    }
    renderRoom();
  }
  function onBye(p) {
    if (!p || p.code !== code) return;
    members.delete(p.name);
    if (rs && p.name === rs.host && !isHost) hostGoneAt = now() - HOST_GONE;   // take over right away
    if (isHost && rs && rs.status === 'lobby') { rs.humans = rs.humans.filter(h => h.name !== p.name || h.name === rs.host); publish(); }
    renderRoom();
  }
  const humanCount = () => rs ? (rs.status === 'lobby' ? rs.humans.length : rs.seats.filter(Boolean).length) : 0;
  const mySeat = () => rs && rs.seats ? rs.seats.indexOf(myName()) : -1;

  /* ---------- host: referee ---------- */
  function snapshotOf(r) {
    const o = JSON.parse(JSON.stringify(r));
    if (r.clock) {
      const t = Date.now(), c = r.clock, el = Math.max(0, t - c.at);
      o.clock = { t: c.t.map((v, i) => i === c.run ? v - el : v), run: c.run, startIn: Math.max(0, c.at - t) };
    }
    o.sentAt = Date.now();
    return o;
  }
  const snapshot = () => snapshotOf(rs);
  function publish() {
    if (!rs) return;
    rs.seq++; persist(); advertise();
    const snap = snapshot(); send('rs4', snap); applyRS(snap, true);
  }
  function pushEvents(evs, mover, move) {
    rs.evk++; rs.evlog.push({ k: rs.evk, evs, mover, move: move || null });
    if (rs.evlog.length > 8) rs.evlog = rs.evlog.slice(-8);
  }
  function hostStart() {
    if (!isHost || !rs) return;
    const humans = rs.humans.filter(h => h.name === rs.host || members.has(h.name)).slice(0, 4);
    if (humans.length < 2) { toast('You need at least 2 players'); return; }
    const seats = [null, null, null, null], order = [0, 1, 2, 3].sort(() => Math.random() - .5);
    humans.forEach((h, i) => { seats[order[i]] = h.name; });
    const t = tcFromStr(rs.tc);
    Object.assign(rs, { status: 'playing', gameNo: rs.gameNo + 1, seats, st: trim(Four.newGame()), clock: { t: [0, 1, 2, 3].map(() => t.m * 60000), run: 0, at: Date.now() + 3000 },
      lastBy: [null, null, null, null], evlog: [], away: {}, result: null, gameId: null, rated: !F.ratingsOff(), ratedOff: F.ratingsOff(), gid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), level: BOT_LEVEL });
    botKey = '';
    publish();
    if (rs.rated) openRated(rs.gameNo, 0);
  }
  async function openRated(gameNo, tries) {
    if (!rs || rs.gameNo !== gameNo) return;
    const r = await rpc('chess_game_open', { p_code: code, p_kind: '4p', p_tc: rs.tc, p_seats: rs.seats.slice() });
    if (!rs || rs.gameNo !== gameNo) return;
    if (r.data) { rs.gameId = String(r.data); joined[rs.gameId] = 1; publish(); return; }
    if (r.error && /too fast/i.test(r.error.message || '') && tries < 3) { setTimeout(() => openRated(gameNo, tries + 1), 10500); return; }
    rs.rated = false; rs.ratedOff = !!r.missing; publish();
  }
  function clockLeft(seat) { const c = rs.clock; return c.t[seat] - (c.run === seat ? Math.max(0, Date.now() - c.at) : 0); }
  function hostMove(seat, mv, moveNo) {
    if (!rs || rs.status !== 'playing' || !rs.st || rs.st.over) return false;
    if (rs.st.turn !== seat || (moveNo != null && moveNo !== rs.st.moveNo)) return false;
    const legal = Four.legalMoves(rs.st).find(m => m.from.x === mv.from.x && m.from.y === mv.from.y && m.to.x === mv.to.x && m.to.y === mv.to.y);
    if (!legal) return false;
    let left = clockLeft(seat);
    if (left < -GRACE) return false;
    let r; try { r = Four.applyMove(rs.st, legal); } catch (e) { return false; }
    const t = Date.now(), c = rs.clock;
    c.t[seat] = Math.max(0, left) + tcFromStr(rs.tc).i * 1000;
    rs.st = trim(r.state); rs.lastBy[seat] = legal;
    c.run = rs.st.over ? null : rs.st.turn; c.at = Math.max(t, c.at);
    pushEvents(r.events, seat, legal);
    if (rs.st.over || Four.isOver(rs.st)) hostOver(); else publish();
    return true;
  }
  function hostEliminate(seat, reason) {
    if (!rs || rs.status !== 'playing' || rs.st.out[seat]) return;
    const r = Four.eliminate(rs.st, seat, reason);
    const t = Date.now(), c = rs.clock;
    if (c.run === seat) c.t[seat] = Math.max(0, clockLeft(seat));
    else if (c.run != null) c.t[c.run] = clockLeft(c.run);
    rs.st = trim(r.state); c.run = rs.st.over ? null : rs.st.turn; c.at = Math.max(t, c.at);
    pushEvents(r.events, null, null);
    if (rs.st.over || Four.isOver(rs.st)) hostOver(); else publish();
  }
  function hostOver() {
    const c = rs.clock; if (c.run != null) { c.t[c.run] = Math.max(0, clockLeft(c.run)); c.run = null; }
    rs.status = 'over'; rs.result = { standings: Four.standings(rs.st), reason: rs.st.overReason };
    publish();
  }
  function onMoveReq(p) {
    if (!p || p.code !== code || typeof p.by !== 'string' || !rs || !rs.seats) return;
    const seat = rs.seats.indexOf(p.by);
    if (seat < 0 || !p.from || !p.to || !hostMove(seat, { from: p.from, to: p.to }, p.moveNo | 0)) send('rs4', snapshot());
  }
  function onAct(p) { if (!p || p.code !== code || typeof p.by !== 'string') return; hostAct(p.by, String(p.type)); }
  function hostAct(by, type) {
    if (!rs) return;
    const seat = rs.seats ? rs.seats.indexOf(by) : -1;
    if (type === 'resign' && rs.status === 'playing' && seat >= 0) hostEliminate(seat, 'resign');
  }
  function hostTick() {
    if (!rs) return;
    if (rs.status === 'lobby') {
      const n = rs.humans.length;
      return;
    }
    if (rs.status !== 'playing') return;
    const c = rs.clock;
    if (c.run != null) {
      const s = c.run, human = rs.seats[s], grace = human && human !== rs.host ? GRACE : 0;
      if (clockLeft(s) <= -grace) { hostEliminate(s, 'timeout'); return; }
    }
    // every human is out: no point letting the bots play on, end it now (places by points)
    if (rs.seats.every((n, s) => !n || rs.st.out[s])) {
      for (let s = 0; s < 4 && rs && rs.status === 'playing'; s++) if (!rs.seats[s] && !rs.st.out[s]) hostEliminate(s, 'resign');
      return;
    }
    // disconnected humans: 60 s, then out
    let ch2 = false;
    for (let s = 0; s < 4; s++) {
      const n = rs.seats[s];
      if (!n || n === myName() || rs.st.out[s]) { if (rs.away[s]) { delete rs.away[s]; ch2 = true; } continue; }
      if (!members.has(n)) {
        if (!rs.away[s]) { rs.away[s] = Date.now(); ch2 = true; }
        else if (Date.now() - rs.away[s] >= ABANDON) { delete rs.away[s]; hostEliminate(s, 'disconnect'); return; }
      } else if (rs.away[s]) { delete rs.away[s]; ch2 = true; }
    }
    if (ch2) publish();
    // bots for empty seats
    const s = rs.st.turn;
    if (!rs.seats[s] && !rs.st.over) {
      const key = rs.gameNo + ':' + rs.st.moveNo + ':' + s;
      if (botKey !== key) {
        botKey = key; clearTimeout(botT);
        const startWait = Math.max(0, c.at - Date.now());
        let d = X.fast ? 5 : 400 + Math.random() * 800; d = Math.max(60, Math.min(d, clockLeft(s) / 15));
        botT = setTimeout(() => {
          if (!isHost || !rs || rs.status !== 'playing' || rs.gameNo + ':' + rs.st.moveNo + ':' + rs.st.turn !== key) { botKey = ''; return; }
          const m = Four.botMove(rs.st, rs.level || 2);
          if (m) hostMove(s, m, rs.st.moveNo);
        }, d + startWait);
      }
    }
  }
  function tick() {
    if (!code) return;
    if (isHost) hostTick();
    else {
      if (resumeHostAt && now() > resumeHostAt) {
        // nobody else is running the room: we are still the host
        resumeHostAt = 0;
        if (rs && rs.host === myName()) { isHost = true; publish(); toast('Room restored'); }
      }
      if (!resumeHostAt && rs && rs.host !== myName()) {
        if (!members.has(rs.host) && members.size) { if (!hostGoneAt) hostGoneAt = now(); } else hostGoneAt = 0;
        if (hostGoneAt && now() - hostGoneAt >= HOST_GONE && successor() === myName()) takeOver();
      }
      if (!gotRs && !resumeHostAt && now() - joinAt > 9000) { toast(`Room ${code} not found`); leave(); return; }
      if (pending && now() - pending.at > 9000) { clearInterval(pending.sendT); pending = null; toast('Move not received, check your connection'); if (rs) applyRS(snapshot(), true); }
    }
  }
  function successor() {
    if (!rs) return null;
    const list = rs.status === 'lobby' ? rs.humans.map(h => h.name) : rs.seats.filter((n, s) => n && !(rs.st && rs.st.out[s]));
    const all = rs.status === 'lobby' ? list : list.concat(rs.seats.filter(Boolean));
    return all.find(n => n && n !== rs.host && (members.has(n) || n === myName())) || null;
  }
  function takeOver() {
    hostGoneAt = 0; isHost = true;
    const old = rs.host;
    rs.host = myName(); rs.seq += 100;
    if (rs.status === 'lobby') rs.humans = rs.humans.filter(h => h.name !== old);
    toast('The host left. You are now running the room.', 3500);
    botKey = '';
    publish();
  }

  /* ---------- everyone: follow the room ---------- */
  function onRS(p) {
    if (!p || p.v !== 1 || p.kind !== '4p' || p.code !== code) return;
    if (isHost) {
      // another host with newer state (we came back after someone took over): follow them
      if (p.host !== myName() && p.seq > rs.seq) { isHost = false; clearTimeout(botT); toast(`${p.host} is running the room now`); }
      else return;
    }
    if (p.host === myName() && !gotRs && !resumeHostAt) { toast('That is your own room. Send the code to your friends!'); leave(); return; }
    if (resumeHostAt && p.host !== myName()) resumeHostAt = 0;
    if (rs && p.gameNo === rs.gameNo && p.seq < lastSeq && p.host === rs.host) return;
    lastSeq = p.seq; lastRsAt = now(); gotRs = true; rs = p; hostGoneAt = members.has(p.host) ? 0 : hostGoneAt; persist();
    applyRS(p, false);
  }
  function applyRS(p, own) {
    if (!p) return;
    renderRoom();
    if (p.status === 'lobby') { if (!$('four').hidden && X.mode === 'online' && X.over) { /* stay on results */ } else if ($('room4').hidden && code) show('room4'); return; }
    const seat = p.seats.indexOf(myName());
    if (seat < 0 && p.status === 'playing' && !X.key) { toast('That game has already started'); leave(); return; }
    const key = code + ':' + p.gameNo;
    if (X.mode !== 'online' || X.key !== key) {
      eloInfo[key] = eloInfo[key] || { before: (p.elo || {})[myName()] || myElo4(), state: p.rated ? 'pending' : (p.ratedOff || F.ratingsOff() ? 'off' : 'unrated') };
      startLocal({ mode: 'online', my: Math.max(0, seat), spectator: seat < 0, tc: tcFromStr(p.tc), names: p.seats.map((n, i) => n || SEATN[i]), elos: p.seats.map(n => n ? (p.elo || {})[n] || null : null),
        bots: p.seats.map(n => !n), level: p.level || 2, key, rated: p.rated });
      X.key = key; evSeen = p.evk || 0;
    }
    X.names = p.seats.map((n, i) => n || SEATN[i]); X.elos = p.seats.map(n => n ? (p.elo || {})[n] || null : null); X.bots = p.seats.map(n => !n); X.level = p.level || 2;
    $('f4Sub').textContent = tcLabel(X.tc) + (p.rated ? ' · Rated' : (p.ratedOff || F.ratingsOff()) ? ' · Ratings not set up yet' : ' · Unrated');
    if (pending && (p.st.moveNo > pending.moveNo || p.gameNo !== pending.gameNo)) { clearInterval(pending.sendT); pending = null; }
    const waiting = pending && p.st.moveNo === pending.moveNo;
    // events since last time (toasts, popups, sounds)
    const fresh = (p.evlog || []).filter(e => e.k > evSeen);
    if (!waiting) {
      const anim = fresh.length === 1 && fresh[0].move && X.st && p.st.moveNo === X.st.moveNo + 1;
      X.st = p.st; X.lastBy = p.lastBy || X.lastBy;
      if (p.clock) { X.clk = p.clock.t.slice(); X.run = p.clock.run; X.since = now() + (p.clock.startIn || 0); }
      for (const e of fresh) { if (!(pendingEchoed(e))) handleEvents(e.evs, e.mover, e.move); }
      if (fresh.length) evSeen = fresh[fresh.length - 1].k;
      render(anim || fresh.length > 0);
    }
    // ratings
    if (p.gameId && !joined[p.gameId] && seat >= 0 && !isHost) joined[p.gameId] = rpc('chess_game_join', { p_game: p.gameId });
    if (p.rated && eloInfo[key] && eloInfo[key].state !== 'applied') eloInfo[key].state = eloInfo[key].state === 'waiting' ? 'waiting' : 'pending';
    if (p.status === 'over' && p.result) {
      if (!X.over) finish();
      recordOnce(p, seat);
      report(p, key);
    }
    paintBanner();
    if (!$('room4').hidden) show('four');
  }
  let echo = null;
  function pendingEchoed(e) { if (echo && e.move && e.mover === echo.seat && e.move.to.x === echo.m.to.x && e.move.to.y === echo.m.to.y && e.move.from.x === echo.m.from.x && e.move.from.y === echo.m.from.y && !echo.used) { echo.used = true; return true; } return false; }
  function recordOnce(p, seat) {
    if (seat < 0) return;
    const S_ = S(); if (!Array.isArray(S_.onlineRec4)) S_.onlineRec4 = [];
    const rk = code + ':' + (p.gid || p.gameNo);
    if (S_.onlineRec4.indexOf(rk) >= 0) return;
    S_.onlineRec4 = S_.onlineRec4.concat(rk).slice(-30);
    const mine = p.result.standings.find(r => r.seat === seat);
    S_.stats.games4++; if (mine && mine.place === 1) S_.stats.wins4++;
    F.save();
  }
  async function report(p, key) {
    if (!p.gameId || reported[p.gameId] || p.seats.indexOf(myName()) < 0) return;
    reported[p.gameId] = 1;
    const info = eloInfo[key] || (eloInfo[key] = { before: myElo4() });
    try { await joined[p.gameId]; } catch (e) {}
    const places = p.result.standings.map(r => p.seats[r.seat]).filter(Boolean);
    const r = await rpc('chess_game_report', { p_game: p.gameId, p_places: places, p_reason: p.result.reason || 'over' });
    if (r.data) {
      const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      if (d.applied) { info.state = 'applied'; info.delta = (d.deltas || {})[myName()] || 0; if (typeof d.elo === 'number') info.after = d.elo; F.fetchProfile(); }
      else { info.state = 'waiting'; [6000, 30000, 95000].forEach(ms => setTimeout(() => recheck(key), ms)); }
    } else info.state = r.missing ? 'off' : 'error';
    paintElo();
  }
  async function recheck(key) {
    const info = eloInfo[key]; if (!info || info.state === 'applied') return;
    const pr = await F.fetchProfile();
    if (pr && typeof pr.elo4 === 'number' && pr.elo4 !== info.before) { info.state = 'applied'; info.after = pr.elo4; info.delta = pr.elo4 - info.before; paintElo(); }
  }
  function paintElo() {
    const box = $('stElo'); if (!box || X.mode !== 'online') return;
    const info = eloInfo[X.key] || {};
    box.hidden = false;
    if (X.spectator) box.innerHTML = '<span class="muted">You were watching</span>';
    else if (info.state === 'applied') { const d = info.delta | 0, after = info.after != null ? info.after : (info.before || 500) + d; box.innerHTML = `<span class="muted">4P rating</span><b>${after}</b><span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${d}</span>`; }
    else if (info.state === 'off') box.innerHTML = '<span class="muted">Ratings not set up yet</span>';
    else if (info.state === 'unrated') box.innerHTML = '<span class="muted">Unrated game</span>';
    else if (info.state === 'error') box.innerHTML = '<span class="muted">Could not update the rating</span>';
    else box.innerHTML = `<span class="muted">4P rating ${info.before || myElo4()} · updates shortly…</span>`;
  }
  function paintBanner() {
    let h = '';
    if (rs && rs.status === 'playing') {
      const aways = Object.keys(rs.away || {}).map(Number).filter(s => rs.seats[s] && !rs.st.out[s]);
      if (aways.length) h = `<div class="banner red">📡 ${aways.map(s => esc(rs.seats[s])).join(', ')} disconnected · out in ${Math.max(0, Math.ceil((ABANDON - (Date.now() - rs.away[aways[0]])) / 1000))}s</div>`;
      else if (!isHost && hostGoneAt) h = `<div class="banner">📡 Waiting for ${esc(rs.host)}…</div>`;
      else if (X.spectator) h = '<div class="banner">You are watching this game</div>';
    }
    if (h !== X.banner) { X.banner = h; renderStatus(); }
  }
  function awayLeft(s) { if (!rs || !rs.away || !rs.away[s] || rs.status !== 'playing') return null; return Math.max(0, Math.ceil((ABANDON - (Date.now() - rs.away[s])) / 1000)); }
  function tickUi() {
    if (!code || $('four').hidden) return;
    paintBanner();
    // the host can change while the results are up (takeover): keep "Play again" in step
    if (X.over && !X.spectator && !$('standSheet').hidden && !$('stBtns').hidden) {
      const b = $('stAgain'), t = isHost ? 'Play again' : 'Host decides';
      if (b.textContent !== t) { b.textContent = t; b.disabled = !isHost; }
    }
  }

  /* ---------- my actions ---------- */
  function sendMove(m) {
    if (!rs || rs.status !== 'playing' || pending) { render(false); return; }
    const seat = mySeat(); if (seat < 0 || X.st.turn !== seat) return;
    const moveNo = X.st.moveNo;
    if (isHost) { if (!hostMove(seat, m, moveNo)) { applyRS(snapshot(), true); } return; }
    // show it right away
    let r; try { r = Four.applyMove(X.st, m); } catch (e) { render(false); return; }
    X.clk[seat] = Math.max(0, remaining(seat)) + X.tc.i * 1000;
    X.st = trim(r.state); X.lastBy[seat] = m; X.run = X.st.over ? null : X.st.turn; X.since = now();
    echo = { seat, m, used: false };
    handleEvents(r.events, seat, m); render(true);
    const msg = { code, by: myName(), moveNo, from: m.from, to: m.to };
    pending = { moveNo, gameNo: rs.gameNo, at: now(), sendT: setInterval(() => send('mv4', msg), 1000) };
    send('mv4', msg);
  }
  function act(type) {
    if (!rs) return;
    if (isHost) { hostAct(myName(), type); return; }
    const msg = { code, by: myName(), type };
    send('act4', msg); setTimeout(() => send('act4', msg), 700); setTimeout(() => send('act4', msg), 2000);
  }
  function again() {
    if (!isHost || !rs || rs.status !== 'over') return;
    rs.status = 'lobby'; rs.humans = rs.seats.filter(n => n && (n === myName() || members.has(n))).map(n => ({ name: n, elo: rs.elo[n] || 500 }));
    if (!rs.humans.some(h => h.name === myName())) rs.humans.unshift({ name: myName(), elo: myElo4() });
    if (rs.humans.length >= 2) { hostStart(); return; }
    // everyone else left: reopen the room and wait for new players instead of sitting on the old board
    publish(); show('room4'); renderRoom();
    toast('The others left. Waiting for new players…');
  }
  function bannerAction(a) {}

  /* ---------- room screen ---------- */
  function renderRoom() {
    if (!code) return;
    $('r4Code').textContent = code;
    const t = rs ? tcFromStr(rs.tc) : null;
    $('r4Tc').textContent = t ? tcLabel(t) + ' · empty seats are bots' : 'Joining…';
    const list = rs ? (rs.status === 'lobby' ? rs.humans : rs.seats.filter(Boolean).map(n => ({ name: n, elo: rs.elo[n] }))) : [];
    let html = '';
    for (let i = 0; i < 4; i++) {
      const h = list[i];
      html += h ? `<div class="glass seat4"><div class="avatar" style="--h:${hueOf(h.name)};width:34px;height:34px;font-size:14px">${esc(initial(h.name))}</div><div class="nm">${esc(h.name)}${h.name === myName() ? ' (you)' : ''}<small>${rs && h.name === rs.host ? 'Host' : members.has(h.name) ? 'Ready' : 'Connecting…'}</small></div><div class="el">${h.elo || 500}</div></div>`
        : `<div class="glass seat4" style="opacity:.6"><div class="dot">${pieceSVG('k', 'dead')}</div><div class="nm">Open seat<small>A bot plays here if nobody joins</small></div></div>`;
    }
    if (rs && rs.status === 'lobby') html += '<div class="note">Colours are picked at random when the game starts.</div>';
    $('r4Seats').innerHTML = html;
    const n = rs ? rs.humans.length : 0;
    $('r4Msg').innerHTML = !rs ? '<span class="waitdots">Joining</span>' : rs.status !== 'lobby' ? 'Game on!' : isHost
      ? (n < 2 ? '<span class="waitdots">Waiting for at least one more player</span>' : `${n} players here. Start when you're ready!`)
      : `<span class="waitdots">Waiting for ${esc(rs.host)} to start</span>`;
    const b = $('r4Start'); b.hidden = !isHost || !rs || rs.status !== 'lobby'; b.disabled = n < 2;
    b.textContent = n < 2 ? 'Start game (need 2 players)' : `Start game: ${n} players + ${4 - n} bot${4 - n === 1 ? '' : 's'}`;
  }
  $('r4Start').onclick = () => { tap(); hostStart(); };
  $('r4Leave').onclick = () => { tap(); confirmBox('Leave the room?', '', 'Leave', () => leave()); };
  const inviteLink = () => { const u = new URL(location.href); u.search = '?room4=' + code; u.hash = ''; return u.toString(); };
  const inviteText = () => `Play 4 player chess with me on Fun Chess! Room code ${code}\n${inviteLink()}`;
  $('r4Copy').onclick = async () => { tap(); toast(await copyText(inviteText()) ? 'Invite copied. Send it to your friends!' : 'Room code: ' + code); };
  $('r4Share').onclick = async () => { tap(); if (navigator.share) { try { await navigator.share({ title: 'Fun Chess', text: inviteText() }); return; } catch (e) { if (e && e.name === 'AbortError') return; } } toast(await copyText(inviteText()) ? 'Invite copied!' : 'Room code: ' + code); };
  $('f4Create').onclick = () => { tap(); create(); };
  $('f4Join').onclick = () => { tap(); join($('f4CodeIn').value); };
  $('f4CodeIn').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  $('f4CodeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('f4Join').click(); });

  return {
    openLobby, create, join, leave, resume, sendMove, act, again, paintElo, awayLeft, tickUi, bannerAction,
    inRoom: () => !!code, isHost: () => isHost,
    canMove: () => !!(rs && rs.status === 'playing' && !pending),
    playing: () => !!(rs && rs.status === 'playing'),
    _state: () => ({ code, isHost, rs, pending, members: [...members.keys()], chOk, hostGoneAt }),
  };
})();

/* ---------------------------------------------------------------- public */
window.FourUI = {
  open: openSetup,
  onShow: id => { if (id === 'setup4') renderSetup(); if (id === 'four') { paintMute4(); requestAnimationFrame(fitAll); } },
  resume: () => { if (Online4.resume()) return true; return resumeLocal(); },
  joinLink: c => { const go = () => { if (me()) Online4.join(c); else { set().f4mode = 'online'; openSetup(); $('f4CodeIn').value = String(c).toUpperCase().slice(0, 4); toast('Log in, then tap Join'); } }; go(); },
  leaveRoom: () => Online4.leave(true),
  _X: X, _O: Online4, _fast: v => { X.fast = !!v; }, _board: board4,
};
})();
