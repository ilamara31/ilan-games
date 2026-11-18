/* Fun Chess bot — ilan Games.
 * Self-contained chess engine (0x88 board, alpha-beta PVS, quiescence, TT).
 * Use as a Web Worker:
 *   w.postMessage({ id, fen, level: 1..8, maxMs? })  ->  { id, uci, ms }
 * Or in Node: require('./ai.js').bestMove(fen, level, maxMs) -> 'e2e4' | null
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
  var MATE = 30000, MATE_BOUND = 29000, INF = 32000;
  var MAXPLY = 64;
  var N_OFF = [31, 33, 14, 18, -31, -33, -14, -18];
  var K_OFF = [1, -1, 16, -16, 15, 17, -15, -17];
  var B_DIR = [15, 17, -15, -17];
  var R_DIR = [1, -1, 16, -16];
  var Q_DIR = [1, -1, 16, -16, 15, 17, -15, -17];
  var VAL = [0, 100, 320, 330, 500, 900, 20000];
  var PHASE_W = [0, 0, 1, 1, 2, 4, 0];

  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  // ---------------------------------------------------------------- state
  var board = new Int8Array(128);
  var side = 0, castle = 0, ep = -1, halfmove = 0, fullmove = 1;
  var kingSq = [4, 0x74];
  var hashLo = 0, hashHi = 0;

  // zobrist
  var seed = 0x2545F491;
  function rnd32() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; }
  var ZLo = new Int32Array(16 * 128), ZHi = new Int32Array(16 * 128);
  var ZCLo = new Int32Array(16), ZCHi = new Int32Array(16);
  var ZELo = new Int32Array(8), ZEHi = new Int32Array(8);
  var ZSLo, ZSHi;
  (function () {
    var i;
    for (i = 0; i < 16 * 128; i++) { ZLo[i] = rnd32(); ZHi[i] = rnd32(); }
    for (i = 0; i < 16; i++) { ZCLo[i] = rnd32(); ZCHi[i] = rnd32(); }
    for (i = 0; i < 8; i++) { ZELo[i] = rnd32(); ZEHi[i] = rnd32(); }
    ZSLo = rnd32(); ZSHi = rnd32();
  })();

  var castleMask = new Int8Array(128);
  for (var ci = 0; ci < 128; ci++) castleMask[ci] = 15;
  castleMask[4] = 15 & ~3; castleMask[7] = 15 & ~1; castleMask[0] = 15 & ~2;
  castleMask[0x74] = 15 & ~12; castleMask[0x77] = 15 & ~4; castleMask[0x70] = 15 & ~8;

  // undo stack
  var STK = 1024;
  var uMove = new Int32Array(STK), uCap = new Int8Array(STK), uCastle = new Int8Array(STK),
    uEp = new Int16Array(STK), uHalf = new Int16Array(STK), uLo = new Int32Array(STK), uHi = new Int32Array(STK);
  var sp = 0;
  // position history for repetition detection (indexed by sp)
  var hLo = new Int32Array(STK + 1), hHi = new Int32Array(STK + 1);

  // ---------------------------------------------------------------- FEN
  var PIECE_CH = { p: P, n: N, b: B, r: R, q: Q, k: K };
  function computeHash() {
    var lo = 0, hi = 0;
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      if (board[s]) { lo ^= ZLo[board[s] * 128 + s]; hi ^= ZHi[board[s] * 128 + s]; }
    }
    lo ^= ZCLo[castle]; hi ^= ZCHi[castle];
    if (ep >= 0) { lo ^= ZELo[ep & 7]; hi ^= ZEHi[ep & 7]; }
    if (side) { lo ^= ZSLo; hi ^= ZSHi; }
    hashLo = lo; hashHi = hi;
  }

  function setFen(fen) {
    var parts = String(fen).trim().split(/\s+/);
    board.fill(0);
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('bad fen');
    var kings = [-1, -1];
    for (var r = 0; r < 8; r++) {
      var rank = 7 - r, f = 0, row = rows[r];
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch >= '1' && ch <= '8') { f += ch.charCodeAt(0) - 48; continue; }
        var lc = ch.toLowerCase(), t = PIECE_CH[lc];
        if (!t || f > 7) throw new Error('bad fen');
        var c = ch === lc ? 1 : 0;
        var sq = rank * 16 + f;
        board[sq] = t | (c << 3);
        if (t === K) kings[c] = sq;
        f++;
      }
    }
    if (kings[0] < 0 || kings[1] < 0) throw new Error('bad fen: missing king');
    kingSq[0] = kings[0]; kingSq[1] = kings[1];
    side = parts[1] === 'b' ? 1 : 0;
    castle = 0;
    var cs = parts[2] || '-';
    if (cs.indexOf('K') >= 0 && board[4] === K && board[7] === R) castle |= 1;
    if (cs.indexOf('Q') >= 0 && board[4] === K && board[0] === R) castle |= 2;
    if (cs.indexOf('k') >= 0 && board[0x74] === (K | 8) && board[0x77] === (R | 8)) castle |= 4;
    if (cs.indexOf('q') >= 0 && board[0x74] === (K | 8) && board[0x70] === (R | 8)) castle |= 8;
    ep = -1;
    var es = parts[3] || '-';
    if (es.length === 2) {
      var ef = es.charCodeAt(0) - 97, er = es.charCodeAt(1) - 49;
      if (ef >= 0 && ef < 8 && (er === 2 || er === 5)) {
        // only meaningful when the side to move is the capturer
        if ((side === 0 && er === 5) || (side === 1 && er === 2)) ep = er * 16 + ef;
      }
    }
    halfmove = parseInt(parts[4], 10); if (!(halfmove >= 0)) halfmove = 0;
    fullmove = parseInt(parts[5], 10); if (!(fullmove >= 1)) fullmove = 1;
    sp = 0;
    computeHash();
    hLo[0] = hashLo; hHi[0] = hashHi;
  }

  // ---------------------------------------------------------------- attacks
  function isAttacked(sq, by) {
    var s, p, i, d;
    if (by === 0) {
      s = sq - 15; if (!(s & 0x88) && board[s] === P) return true;
      s = sq - 17; if (!(s & 0x88) && board[s] === P) return true;
    } else {
      s = sq + 15; if (!(s & 0x88) && board[s] === (P | 8)) return true;
      s = sq + 17; if (!(s & 0x88) && board[s] === (P | 8)) return true;
    }
    var kn = N | (by << 3), kg = K | (by << 3);
    for (i = 0; i < 8; i++) {
      s = sq + N_OFF[i]; if (!(s & 0x88) && board[s] === kn) return true;
      s = sq + K_OFF[i]; if (!(s & 0x88) && board[s] === kg) return true;
    }
    var bq = B | (by << 3), rq = R | (by << 3), qq = Q | (by << 3);
    for (i = 0; i < 4; i++) {
      d = B_DIR[i]; s = sq + d;
      while (!(s & 0x88)) {
        p = board[s];
        if (p) { if (p === bq || p === qq) return true; break; }
        s += d;
      }
      d = R_DIR[i]; s = sq + d;
      while (!(s & 0x88)) {
        p = board[s];
        if (p) { if (p === rq || p === qq) return true; break; }
        s += d;
      }
    }
    return false;
  }
  function inCheckNow() { return isAttacked(kingSq[side], side ^ 1); }

  // ---------------------------------------------------------------- move gen
  var MOVES = new Int32Array((MAXPLY + 2) * 256);
  var SCORES = new Int32Array((MAXPLY + 2) * 256);
  var gn;
  function add(from, to, promo, flag) { MOVES[gn++] = from | (to << 7) | (promo << 14) | (flag << 18); }

  function genMoves(base, capsOnly) {
    gn = base;
    var us = side, them = us ^ 1, s, p, t, to, q, i, d, offs, dirs, c;
    var pawnDir = us === 0 ? 16 : -16, startRank = us === 0 ? 1 : 6, promoRank = us === 0 ? 7 : 0;
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      p = board[s];
      if (!p || (p >> 3) !== us) continue;
      t = p & 7;
      if (t === P) {
        to = s + pawnDir;
        for (i = 0; i < 2; i++) {
          c = to + (i ? 1 : -1);
          if (c & 0x88) continue;
          q = board[c];
          if (q && (q >> 3) === them) {
            if ((c >> 4) === promoRank) {
              add(s, c, Q, F_CAP);
              add(s, c, N, F_CAP);
              if (!capsOnly) { add(s, c, R, F_CAP); add(s, c, B, F_CAP); }
            } else add(s, c, 0, F_CAP);
          } else if (c === ep && !q && board[c - pawnDir] === (P | (them << 3))) {
            add(s, c, 0, F_CAP | F_EP);
          }
        }
        if (!(to & 0x88) && !board[to]) {
          if ((to >> 4) === promoRank) {
            add(s, to, Q, 0);
            if (!capsOnly) { add(s, to, N, 0); add(s, to, R, 0); add(s, to, B, 0); }
          } else if (!capsOnly) {
            add(s, to, 0, 0);
            if ((s >> 4) === startRank && !board[to + pawnDir]) add(s, to + pawnDir, 0, F_DOUBLE);
          }
        }
      } else if (t === N || t === K) {
        offs = t === N ? N_OFF : K_OFF;
        for (i = 0; i < 8; i++) {
          to = s + offs[i];
          if (to & 0x88) continue;
          q = board[to];
          if (!q) { if (!capsOnly) add(s, to, 0, 0); }
          else if ((q >> 3) === them) add(s, to, 0, F_CAP);
        }
      } else {
        dirs = t === B ? B_DIR : (t === R ? R_DIR : Q_DIR);
        for (i = 0; i < dirs.length; i++) {
          d = dirs[i]; to = s + d;
          while (!(to & 0x88)) {
            q = board[to];
            if (!q) { if (!capsOnly) add(s, to, 0, 0); }
            else { if ((q >> 3) === them) add(s, to, 0, F_CAP); break; }
            to += d;
          }
        }
      }
    }
    if (!capsOnly) {
      if (us === 0) {
        if ((castle & 1) && !board[5] && !board[6] && board[7] === R && board[4] === K &&
          !isAttacked(4, 1) && !isAttacked(5, 1)) add(4, 6, 0, F_CASTLE);
        if ((castle & 2) && !board[3] && !board[2] && !board[1] && board[0] === R && board[4] === K &&
          !isAttacked(4, 1) && !isAttacked(3, 1)) add(4, 2, 0, F_CASTLE);
      } else {
        if ((castle & 4) && !board[0x75] && !board[0x76] && board[0x77] === (R | 8) && board[0x74] === (K | 8) &&
          !isAttacked(0x74, 0) && !isAttacked(0x75, 0)) add(0x74, 0x76, 0, F_CASTLE);
        if ((castle & 8) && !board[0x73] && !board[0x72] && !board[0x71] && board[0x70] === (R | 8) && board[0x74] === (K | 8) &&
          !isAttacked(0x74, 0) && !isAttacked(0x73, 0)) add(0x74, 0x72, 0, F_CASTLE);
      }
    }
    return gn;
  }

  // returns false (and undoes) if the move leaves own king in check
  function makeMove(m) {
    var from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 18;
    var p = board[from], cap = board[to], lo = hashLo, hi = hashHi;
    uMove[sp] = m; uCastle[sp] = castle; uEp[sp] = ep; uHalf[sp] = halfmove; uLo[sp] = lo; uHi[sp] = hi;
    if (ep >= 0) { lo ^= ZELo[ep & 7]; hi ^= ZEHi[ep & 7]; }
    if (flag & F_EP) {
      var cs = to + (side ? 16 : -16);
      cap = board[cs]; board[cs] = 0;
      lo ^= ZLo[cap * 128 + cs]; hi ^= ZHi[cap * 128 + cs];
    } else if (cap) {
      lo ^= ZLo[cap * 128 + to]; hi ^= ZHi[cap * 128 + to];
    }
    uCap[sp] = cap;
    var np = promo ? (promo | (side << 3)) : p;
    board[to] = np; board[from] = 0;
    lo ^= ZLo[p * 128 + from] ^ ZLo[np * 128 + to];
    hi ^= ZHi[p * 128 + from] ^ ZHi[np * 128 + to];
    if (flag & F_CASTLE) {
      var rf, rt;
      if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
      var rp = board[rf]; board[rt] = rp; board[rf] = 0;
      lo ^= ZLo[rp * 128 + rf] ^ ZLo[rp * 128 + rt];
      hi ^= ZHi[rp * 128 + rf] ^ ZHi[rp * 128 + rt];
    }
    if ((p & 7) === K) kingSq[side] = to;
    var nc = castle & castleMask[from] & castleMask[to];
    if (nc !== castle) { lo ^= ZCLo[castle] ^ ZCLo[nc]; hi ^= ZCHi[castle] ^ ZCHi[nc]; castle = nc; }
    ep = -1;
    if (flag & F_DOUBLE) { ep = (from + to) >> 1; lo ^= ZELo[ep & 7]; hi ^= ZEHi[ep & 7]; }
    halfmove = ((p & 7) === P || cap) ? 0 : halfmove + 1;
    side ^= 1; lo ^= ZSLo; hi ^= ZSHi;
    hashLo = lo; hashHi = hi;
    sp++;
    hLo[sp] = lo; hHi[sp] = hi;
    if (isAttacked(kingSq[side ^ 1], side)) { unmakeMove(); return false; }
    return true;
  }

  function unmakeMove() {
    sp--;
    var m = uMove[sp];
    var from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = m >> 18;
    side ^= 1;
    var np = board[to];
    var p = promo ? (P | (side << 3)) : np;
    board[from] = p;
    var cap = uCap[sp];
    if (flag & F_EP) { board[to] = 0; board[to + (side ? 16 : -16)] = cap; }
    else board[to] = cap;
    if (flag & F_CASTLE) {
      var rf, rt;
      if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
      board[rf] = board[rt]; board[rt] = 0;
    }
    if ((p & 7) === K) kingSq[side] = from;
    castle = uCastle[sp]; ep = uEp[sp]; halfmove = uHalf[sp]; hashLo = uLo[sp]; hashHi = uHi[sp];
  }

  var nullEp = new Int16Array(MAXPLY + 2), nullHalf = new Int16Array(MAXPLY + 2);
  function makeNull(ply) {
    nullEp[ply] = ep; nullHalf[ply] = halfmove;
    uLo[sp] = hashLo; uHi[sp] = hashHi;
    if (ep >= 0) { hashLo ^= ZELo[ep & 7]; hashHi ^= ZEHi[ep & 7]; }
    ep = -1; halfmove = 0;
    side ^= 1; hashLo ^= ZSLo; hashHi ^= ZSHi;
    sp++; hLo[sp] = hashLo; hHi[sp] = hashHi;
  }
  function unmakeNull(ply) {
    sp--;
    side ^= 1; ep = nullEp[ply]; halfmove = nullHalf[ply];
    hashLo = uLo[sp]; hashHi = uHi[sp];
  }

  // ---------------------------------------------------------------- utils
  var FILES = 'abcdefgh', PROMO_CH = ['', '', 'n', 'b', 'r', 'q'];
  function sqName(s) { return FILES[s & 7] + ((s >> 4) + 1); }
  function moveToUci(m) {
    var promo = (m >> 14) & 7;
    return sqName(m & 127) + sqName((m >> 7) & 127) + (promo ? PROMO_CH[promo] : '');
  }

  function legalMoves() {
    var base = (MAXPLY + 1) * 256, end = genMoves(base, false), out = [];
    for (var i = base; i < end; i++) {
      var m = MOVES[i];
      if (makeMove(m)) { unmakeMove(); out.push(m); }
    }
    return out;
  }

  function perftRec(depth, ply) {
    var base = ply * 256, end = genMoves(base, false), n = 0;
    for (var i = base; i < end; i++) {
      if (!makeMove(MOVES[i])) continue;
      n += depth <= 1 ? 1 : perftRec(depth - 1, ply + 1);
      unmakeMove();
    }
    return n;
  }
  function perft(fen, depth) { setFen(fen); return depth === 0 ? 1 : perftRec(depth, 0); }

  // ---------------------------------------------------------------- evaluation
  // Tables are written from White's view, row 0 = rank 8.
  var PST_P = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0];
  var PST_PE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    80, 80, 80, 80, 80, 80, 80, 80,
    50, 50, 50, 50, 50, 50, 50, 50,
    30, 30, 30, 30, 30, 30, 30, 30,
    15, 15, 15, 15, 15, 15, 15, 15,
    5, 5, 5, 5, 5, 5, 5, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0];
  var PST_N = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50];
  var PST_B = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20];
  var PST_R = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0];
  var PST_Q = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20];
  var PST_KM = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20];
  var PST_KE = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50];
  var MG = [null, PST_P, PST_N, PST_B, PST_R, PST_Q, PST_KM];
  var EG = [null, PST_PE, PST_N, PST_B, PST_R, PST_Q, PST_KE];
  var PASSED = [0, 5, 10, 20, 35, 60, 100, 0];

  var pawnCnt = new Int8Array(16); // [color*8 + file]
  var wMin = new Int8Array(8), bMax = new Int8Array(8);
  var CENTER_DIST = new Int8Array(128);
  for (var cs = 0; cs < 128; cs++) {
    if (cs & 0x88) continue;
    var cf = cs & 7, cr = cs >> 4;
    CENTER_DIST[cs] = Math.max(3 - cf, cf - 4) + Math.max(3 - cr, cr - 4);
  }

  function evaluate() {
    var s, p, t, c, r, f, idx, i;
    var mg0 = 0, mg1 = 0, eg0 = 0, eg1 = 0, phase = 0;
    var mat = [0, 0], nonPawn = [0, 0], minors = [0, 0], bishops = [0, 0], pawns = [0, 0];
    pawnCnt.fill(0);
    for (i = 0; i < 8; i++) { wMin[i] = 8; bMax[i] = -1; }
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      p = board[s];
      if (p && (p & 7) === P) {
        f = s & 7; r = s >> 4;
        if (p === P) { pawnCnt[f]++; if (r < wMin[f]) wMin[f] = r; }
        else { pawnCnt[8 + f]++; if (r > bMax[f]) bMax[f] = r; }
      }
    }
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      p = board[s];
      if (!p) continue;
      t = p & 7; c = p >> 3; r = s >> 4; f = s & 7;
      idx = c === 0 ? (7 - r) * 8 + f : r * 8 + f;
      var vm = VAL[t] + MG[t][idx], ve = VAL[t] + EG[t][idx];
      if (t === K) { vm = MG[t][idx]; ve = EG[t][idx]; }
      phase += PHASE_W[t];
      if (t === P) {
        pawns[c]++;
        var rel = c === 0 ? r : 7 - r;
        var passed;
        if (c === 0) passed = (f === 0 || bMax[f - 1] <= r) && bMax[f] <= r && (f === 7 || bMax[f + 1] <= r);
        else passed = (f === 0 || wMin[f - 1] >= r) && wMin[f] >= r && (f === 7 || wMin[f + 1] >= r);
        if (passed) { vm += PASSED[rel] >> 1; ve += PASSED[rel]; }
        var own = c * 8;
        if ((f === 0 || !pawnCnt[own + f - 1]) && (f === 7 || !pawnCnt[own + f + 1])) { vm -= 12; ve -= 15; }
        if (pawnCnt[own + f] > 1) { vm -= 8; ve -= 12; }
      } else if (t !== K) {
        mat[c] += VAL[t]; nonPawn[c]++;
        if (t === N || t === B) minors[c]++;
        if (t === B) bishops[c]++;
        if (t === R) {
          var ownP = pawnCnt[c * 8 + f], oppP = pawnCnt[(c ^ 1) * 8 + f];
          if (!ownP) { if (!oppP) { vm += 18; ve += 8; } else { vm += 9; ve += 4; } }
        }
      } else {
        // simple pawn shield for castled king
        if (f <= 2 || f >= 5) {
          var fwd = c === 0 ? 16 : -16, shield = 0;
          for (var df = -1; df <= 1; df++) {
            var ss = s + fwd + df;
            if (!(ss & 0x88) && board[ss] === (P | (c << 3))) shield += 12;
            else if (!((ss + fwd) & 0x88) && board[ss + fwd] === (P | (c << 3))) shield += 6;
          }
          vm += shield;
        }
      }
      if (c === 0) { mg0 += vm; eg0 += ve; } else { mg1 += vm; eg1 += ve; }
    }
    // insufficient material
    if (!pawns[0] && !pawns[1] && nonPawn[0] <= 1 && nonPawn[1] <= 1 && mat[0] <= 330 && mat[1] <= 330) return 0;
    if (bishops[0] >= 2) { mg0 += 30; eg0 += 45; }
    if (bishops[1] >= 2) { mg1 += 30; eg1 += 45; }
    if (phase > 24) phase = 24;
    var score = ((mg0 - mg1) * phase + (eg0 - eg1) * (24 - phase)) / 24 | 0;
    // mop-up: drive lone king to the edge
    var diff = mat[0] + pawns[0] * 100 - mat[1] - pawns[1] * 100;
    if (phase <= 8) {
      var strong = -1;
      if (diff >= 300 && mat[0] >= 500 && (!pawns[1] || mat[0] - mat[1] >= 400)) strong = 0;
      else if (diff <= -300 && mat[1] >= 500 && (!pawns[0] || mat[1] - mat[0] >= 400)) strong = 1;
      if (strong >= 0) {
        var wk = kingSq[strong ^ 1], sk = kingSq[strong];
        var dist = Math.abs((wk & 7) - (sk & 7)) + Math.abs((wk >> 4) - (sk >> 4));
        var bonus = 12 * CENTER_DIST[wk] + 4 * (14 - dist);
        score += strong === 0 ? bonus : -bonus;
      }
    }
    // drawish: no pawns and only a minor piece ahead
    if (!pawns[0] && score > 0 && mat[0] - mat[1] < 400 && mat[0] <= 330 + mat[1]) score >>= 2;
    if (!pawns[1] && score < 0 && mat[1] - mat[0] < 400 && mat[1] <= 330 + mat[0]) score >>= 2;
    score += side === 0 ? 10 : -10; // tempo
    return side === 0 ? score : -score;
  }

  // ---------------------------------------------------------------- TT
  var TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE),
    ttScore = new Int16Array(TT_SIZE), ttDepth = new Int8Array(TT_SIZE), ttFlag = new Uint8Array(TT_SIZE);
  var TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
  function ttClear() { ttKey.fill(0); ttMove.fill(0); ttScore.fill(0); ttDepth.fill(0); ttFlag.fill(0); }
  function ttStore(depth, flag, score, move, ply) {
    var i = hashLo & TT_MASK;
    if (ttFlag[i] && ttKey[i] === hashHi && ttDepth[i] > depth && flag !== TT_EXACT) return;
    if (score > MATE_BOUND) score += ply; else if (score < -MATE_BOUND) score -= ply;
    ttKey[i] = hashHi; ttMove[i] = move; ttScore[i] = score; ttDepth[i] = depth; ttFlag[i] = flag;
  }

  // ---------------------------------------------------------------- search
  var nodes = 0, stopFlag = false, tStart = 0, tHard = 0, useQS = true;
  var killers = new Int32Array((MAXPLY + 2) * 2);
  var history = new Int32Array(16 * 128);

  var canStop = false;
  function checkTime() {
    if (canStop && (nodes & 127) === 0 && now() - tStart >= tHard) stopFlag = true;
  }

  // Positions seen earlier in the game (from previous calls), so the bot does not
  // shuffle into a threefold repetition when it is winning. hi -> [lo, halfmoveClock]
  var gameHist = new Map(), lastFullmove = 0;
  function rememberPos() {
    var e = gameHist.get(hashHi);
    if (!e || e[0] !== hashLo) gameHist.set(hashHi, [hashLo, halfmove]);
  }
  function isRepetition() {
    var lim = sp - halfmove;
    if (lim < 0) lim = 0;
    for (var i = sp - 2; i >= lim; i -= 2) {
      if (hLo[i] === hashLo && hHi[i] === hashHi) return true;
    }
    if (halfmove >= 4 && gameHist.size) {
      var e = gameHist.get(hashHi);
      // same position earlier with a smaller clock -> same reversible stretch of this game
      if (e && e[0] === hashLo && e[1] < halfmove) return true;
    }
    return false;
  }

  function scoreMoves(base, end, ttm, ply) {
    var k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    for (var i = base; i < end; i++) {
      var m = MOVES[i], sc;
      if (m === ttm) sc = 10000000;
      else {
        var flag = m >> 18, promo = (m >> 14) & 7;
        if (flag & F_CAP) {
          var victim = (flag & F_EP) ? P : (board[(m >> 7) & 127] & 7);
          sc = 1000000 + VAL[victim] * 10 - (board[m & 127] & 7) + (promo === Q ? 9000 : 0);
        } else if (promo) sc = promo === Q ? 1009000 : -100000;
        else if (m === k1) sc = 900000;
        else if (m === k2) sc = 800000;
        else sc = history[board[m & 127] * 128 + ((m >> 7) & 127)];
      }
      SCORES[i] = sc;
    }
  }
  function pickNext(i, end) {
    var best = i, bs = SCORES[i];
    for (var j = i + 1; j < end; j++) if (SCORES[j] > bs) { bs = SCORES[j]; best = j; }
    if (best !== i) {
      var tm = MOVES[i]; MOVES[i] = MOVES[best]; MOVES[best] = tm;
      SCORES[best] = SCORES[i]; SCORES[i] = bs;
    }
    return MOVES[i];
  }

  function qsearch(alpha, beta, ply) {
    nodes++; checkTime();
    if (stopFlag) return 0;
    var stand = evaluate();
    if (ply >= MAXPLY) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    var base = ply * 256, end = genMoves(base, true);
    scoreMoves(base, end, 0, ply);
    var best = stand;
    for (var i = base; i < end; i++) {
      var m = pickNext(i, end);
      var flag = m >> 18, promo = (m >> 14) & 7, to = (m >> 7) & 127;
      var victim = (flag & F_EP) ? P : (board[to] & 7);
      if (!promo && stand + VAL[victim] + 200 < alpha) continue;
      var att = board[m & 127] & 7;
      if (!promo && att !== K && VAL[att] > VAL[victim] + 50 && isAttacked(to, side ^ 1)) continue;
      if (!makeMove(m)) continue;
      var sc = -qsearch(-beta, -alpha, ply + 1);
      unmakeMove();
      if (stopFlag) return 0;
      if (sc > best) {
        best = sc;
        if (sc > alpha) { alpha = sc; if (sc >= beta) return sc; }
      }
    }
    return best;
  }

  function hasNonPawn(c) {
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      var p = board[s];
      if (p && (p >> 3) === c) { var t = p & 7; if (t !== P && t !== K) return true; }
    }
    return false;
  }

  function search(depth, alpha, beta, ply, allowNull) {
    if (halfmove >= 100 || isRepetition()) return 0;
    var inCheck = isAttacked(kingSq[side], side ^ 1);
    if (inCheck) depth++;
    if (depth <= 0) {
      if (useQS) return qsearch(alpha, beta, ply);
      nodes++; return evaluate();
    }
    nodes++; checkTime();
    if (stopFlag) return 0;
    if (ply >= MAXPLY) return evaluate();
    // mate distance pruning
    var ma = -MATE + ply, mb = MATE - ply - 1;
    if (ma > alpha) { alpha = ma; if (alpha >= beta) return alpha; }
    if (mb < beta) { beta = mb; if (alpha >= beta) return beta; }

    var pv = beta - alpha > 1;
    var ti = hashLo & TT_MASK, ttm = 0;
    if (ttFlag[ti] && ttKey[ti] === hashHi) {
      ttm = ttMove[ti];
      if (!pv && ttDepth[ti] >= depth) {
        var ts = ttScore[ti];
        if (ts > MATE_BOUND) ts -= ply; else if (ts < -MATE_BOUND) ts += ply;
        var tf = ttFlag[ti];
        if (tf === TT_EXACT || (tf === TT_LOWER && ts >= beta) || (tf === TT_UPPER && ts <= alpha)) return ts;
      }
    }

    if (!pv && !inCheck && beta < MATE_BOUND && beta > -MATE_BOUND) {
      var se = evaluate();
      if (depth <= 3 && se - 120 * depth >= beta) return se;
      if (allowNull && depth >= 3 && se >= beta && hasNonPawn(side)) {
        var Rn = depth >= 7 ? 3 : 2;
        makeNull(ply);
        var ns = -search(depth - 1 - Rn, -beta, -beta + 1, ply + 1, false);
        unmakeNull(ply);
        if (stopFlag) return 0;
        if (ns >= beta) return ns > MATE_BOUND ? beta : ns;
      }
    }

    var base = ply * 256, end = genMoves(base, false);
    scoreMoves(base, end, ttm, ply);
    var legal = 0, best = -INF, bestM = 0, oldAlpha = alpha;
    for (var i = base; i < end; i++) {
      var m = pickNext(i, end);
      var isQuiet = !((m >> 18) & F_CAP) && !((m >> 14) & 7);
      if (!makeMove(m)) continue;
      legal++;
      var sc;
      if (legal === 1) sc = -search(depth - 1, -beta, -alpha, ply + 1, true);
      else {
        var red = 0;
        if (depth >= 3 && legal > 3 && isQuiet && !inCheck && SCORES[i] < 800000 &&
          !isAttacked(kingSq[side], side ^ 1)) {
          red = legal > 10 ? 2 : 1;
          if (pv) red--;
        }
        sc = -search(depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
        if (sc > alpha && red) sc = -search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (sc > alpha && sc < beta) sc = -search(depth - 1, -beta, -alpha, ply + 1, true);
      }
      unmakeMove();
      if (stopFlag) return 0;
      if (sc > best) {
        best = sc; bestM = m;
        if (sc > alpha) {
          alpha = sc;
          if (sc >= beta) {
            if (isQuiet) {
              if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
              var hi = board[m & 127] * 128 + ((m >> 7) & 127);
              history[hi] += depth * depth;
              if (history[hi] > 700000) for (var h = 0; h < history.length; h++) history[h] >>= 1;
            }
            break;
          }
        }
      }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    ttStore(depth, best >= beta ? TT_LOWER : (best > oldAlpha ? TT_EXACT : TT_UPPER), best, bestM, ply);
    return best;
  }


  // ---------------------------------------------------------------- opening book
  // A few mainstream lines so stronger levels open like humans do (and vary).
  var BOOK_LINES = [
    'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7',
    'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4',
    'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6',
    'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 e1g1 d7d6',
    'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6',
    'e2e4 e7e5 b1c3 g8f6 g1f3 b8c6 d2d4 e5d4',
    'e2e4 e7e5 g1f3 d7d6 d2d4 g8f6 b1c3 b8d7',
    'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6',
    'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5',
    'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 a7a6 f1d3 g8f6',
    'e2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6',
    'e2e4 c7c5 c2c3 g8f6 e4e5 f6d5 d2d4 c5d4',
    'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7',
    'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6',
    'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6',
    'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c6c5',
    'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c8f5',
    'e2e4 g7g6 d2d4 f8g7 b1c3 d7d6 g1f3 g8f6',
    'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 g1f3 f8g7',
    'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8',
    'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5',
    'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5',
    'd2d4 g8f6 c2c4 e7e6 g1f3 d7d5 b1c3 f8e7 c1f4 e8g8',
    'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5',
    'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7',
    'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8',
    'd2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7',
    'd2d4 g8f6 g1f3 g7g6 c1f4 f8g7 e2e3 e8g8',
    'd2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 c7c5 c2c3 b8c6',
    'd2d4 d7d5 c1f4 g8f6 e2e3 c7c5 c2c3 b8c6',
    'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5',
    'c2c4 g8f6 b1c3 e7e6 e2e4 d7d5 e4e5 d5d4',
    'c2c4 c7c5 g1f3 g8f6 b1c3 b8c6 g2g3 g7g6',
    'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8',
    'g1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8',
    'g1f3 d7d5 d2d4 g8f6 c2c4 e7e6 b1c3 f8e7'
  ];
  var book = null;
  function bookKey() { return hashLo + ':' + hashHi; }
  function buildBook() {
    book = new Map();
    for (var i = 0; i < BOOK_LINES.length; i++) {
      setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      var ms = BOOK_LINES[i].split(' ');
      for (var j = 0; j < ms.length; j++) {
        var lm = legalMoves(), found = 0;
        for (var k = 0; k < lm.length; k++) if (moveToUci(lm[k]) === ms[j]) { found = lm[k]; break; }
        if (!found) break; // (never happens: lines are verified by tests)
        var key = bookKey(), arr = book.get(key);
        if (!arr) book.set(key, arr = []);
        arr.push(ms[j]);
        makeMove(found);
      }
    }
  }
  // returns a book move (uci) for the current position, or null
  function bookMove() {
    if (fullmove > 8) return null;
    if (!book) {
      var saveFen = currentFen;
      buildBook();
      setFen(saveFen);
    }
    var arr = book.get(bookKey());
    return arr ? arr[(Math.random() * arr.length) | 0] : null;
  }
  var currentFen = '';

  // ---------------------------------------------------------------- levels
  // depth: max nominal depth; qs: quiescence; noise: sigma (cp) added to root moves;
  // rand: chance of a totally random move; ms: think budget.
  var LEVELS = [null,
    { depth: 1, qs: false, noise: 220, rand: 0.30, ms: 300, book: 0 },   // 1 Pawn
    { depth: 1, qs: true, noise: 120, rand: 0.12, ms: 400, book: 0.2 },    // 2 Rookie
    { depth: 2, qs: true, noise: 65, rand: 0.05, ms: 500, book: 0.5 },     // 3 Casual
    { depth: 3, qs: true, noise: 35, rand: 0.015, ms: 700, book: 0.75 },    // 4 Club
    { depth: 5, qs: true, noise: 14, rand: 0, ms: 900, book: 0.9 },        // 5 Strong
    { depth: 6, qs: true, noise: 0, rand: 0, ms: 1000, book: 1 },        // 6 Expert
    { depth: 8, qs: true, noise: 0, rand: 0, ms: 1500, book: 1 },       // 7 Master
    { depth: 64, qs: true, noise: 0, rand: 0, ms: 2400, book: 1 }        // 8 Grandmaster
  ];

  function gauss() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function think(fen, level, maxMs) {
    var t0 = now();
    level = Math.max(1, Math.min(8, Math.round(+level) || 1));
    var cfg = LEVELS[level];
    currentFen = fen;
    setFen(fen);
    if (fullmove < lastFullmove || gameHist.size > 4000) gameHist.clear(); // new game
    lastFullmove = fullmove;
    rememberPos();
    var root = legalMoves();
    var res = { uci: null, ms: 0, depth: 0, score: 0, nodes: 0 };
    if (!root.length) { res.ms = Math.round(now() - t0); return res; }
    if (root.length === 1) { res.uci = moveToUci(root[0]); res.ms = Math.round(now() - t0); return res; }
    if (cfg.book && Math.random() < cfg.book) {
      var bm = bookMove();
      if (bm) {
        for (var bi = 0; bi < root.length; bi++) if (moveToUci(root[bi]) === bm) {
          makeMove(root[bi]); rememberPos(); unmakeMove();
          res.uci = bm; res.ms = Math.round(now() - t0); res.book = true; return res;
        }
      }
    }

    var budget = cfg.ms;
    if (maxMs != null && isFinite(maxMs)) budget = Math.min(budget, Math.max(1, +maxMs));
    tStart = t0; tHard = Math.max(1, budget - 10); stopFlag = false; nodes = 0;

    if (cfg.rand && Math.random() < cfg.rand) {
      res.uci = moveToUci(root[(Math.random() * root.length) | 0]);
      res.ms = Math.round(now() - t0); return res;
    }

    useQS = cfg.qs;
    killers.fill(0);
    for (var h = 0; h < history.length; h++) history[h] >>= 3;

    // root noise: level noise, plus a little variety in the opening at every level
    var sigma = cfg.noise;
    if (fullmove <= 6 && sigma < 8) sigma = 8;
    var n = root.length, noise = new Int32Array(n), rscore = new Int32Array(n);
    for (var i = 0; i < n; i++) {
      var o = Math.round(gauss() * sigma);
      noise[i] = Math.max(-600, Math.min(600, o));
    }
    var order = [];
    for (i = 0; i < n; i++) order.push(i);
    // initial ordering: captures by MVV-LVA first
    var init = new Int32Array(n);
    for (i = 0; i < n; i++) {
      var m0 = root[i];
      if ((m0 >> 18) & F_CAP) init[i] = 1000 + VAL[(m0 >> 18) & F_EP ? P : board[(m0 >> 7) & 127] & 7] - (board[m0 & 127] & 7);
      else if ((m0 >> 14) & 7) init[i] = 900;
    }
    order.sort(function (a, b) { return init[b] - init[a]; });

    var bestIdx = order[0], bestScore = -INF, doneDepth = 0;
    canStop = false;
    for (var depth = 1; depth <= cfg.depth; depth++) {
      if (depth === 2) canStop = true;
      var alpha = -INF, iterBest = -1, iterScore = -INF;
      for (var k = 0; k < n; k++) {
        var idx = order[k], m = root[idx], o2 = noise[idx];
        makeMove(m);
        // the move "beats" alpha if its raw score + its noise > alpha (mate scores get no noise)
        if (alpha > MATE_BOUND || alpha < -MATE_BOUND) o2 = 0;
        var a = k === 0 ? -INF : alpha - o2, sc;
        if (k === 0) sc = -search(depth - 1, -INF, INF, 1, true);
        else {
          sc = -search(depth - 1, -a - 1, -a, 1, true);
          if (!stopFlag && sc > a) sc = -search(depth - 1, -INF, -a, 1, true);
        }
        unmakeMove();
        if (stopFlag) break;
        if (k > 0 && sc <= a) { rscore[idx] = -INF + 1; continue; } // fail-low: not better
        var total = (sc > MATE_BOUND || sc < -MATE_BOUND) ? sc : sc + o2;
        rscore[idx] = total;
        if (k === 0 || total > iterScore) { iterScore = total; iterBest = idx; }
        if (total > alpha) alpha = total;
      }
      if (iterBest >= 0) {
        bestIdx = iterBest; bestScore = iterScore;
      }
      if (stopFlag) break;
      doneDepth = depth;
      // order next iteration: best first, then by score
      order.sort(function (x, y) { return x === iterBest ? -1 : y === iterBest ? 1 : rscore[y] - rscore[x]; });
      if (bestScore > MATE_BOUND && depth >= (MATE - bestScore) + 2) break; // forced mate found
      var el = now() - t0;
      if (el > budget * 0.45) break;
    }
    res.uci = moveToUci(root[bestIdx]);
    makeMove(root[bestIdx]); rememberPos(); unmakeMove();
    res.depth = doneDepth; res.score = bestScore; res.nodes = nodes;
    res.ms = Math.round(now() - t0);
    return res;
  }

  function safeThink(fen, level, maxMs) {
    try { return think(fen, level, maxMs); }
    catch (e) {
      try {
        setFen(fen);
        var lm = legalMoves();
        return { uci: lm.length ? moveToUci(lm[0]) : null, ms: 0, error: String(e) };
      } catch (e2) { return { uci: null, ms: 0, error: String(e2) }; }
    }
  }

  function bestMove(fen, level, maxMs) { return safeThink(fen, level, maxMs).uci; }

  var api = {
    bestMove: bestMove,
    think: safeThink,
    perft: perft,
    legalUci: function (fen) { setFen(fen); return legalMoves().map(moveToUci); },
    evaluate: function (fen) { setFen(fen); return evaluate(); },
    _bookLines: BOOK_LINES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof window !== 'undefined') window.FunChessAI = api; // plain <script> fallback

  var isWorker = typeof importScripts === 'function' && typeof self !== 'undefined' &&
    typeof window === 'undefined' && typeof module === 'undefined';
  if (isWorker) {
    self.onmessage = function (e) {
      var d = e.data || {};
      var r = safeThink(d.fen, d.level, d.maxMs);
      self.postMessage({ id: d.id, uci: r.uci, ms: r.ms });
    };
  }
})();
