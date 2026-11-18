/* four.js — 4-player Free-For-All chess (chess.com style) rules engine + bot.
 * Pure logic, no DOM. Browser / Web Worker: global `Four`. Node: module.exports.
 *
 * BOARD: 14x14, the four 3x3 corners are not squares. Coordinates {x:0..13, y:0..13}, y=0 is the bottom.
 * state.board[y][x] = null | {t:'p'|'n'|'b'|'r'|'q'|'k', c:0..3, dead?:true, promoted?:true}
 * Corner (non-)squares are always null; use Four.isSquare(x,y).
 *
 * SEATS / START LAYOUT (chess.com layout; every king stands on its owner's RIGHT of the queen,
 * so the setup is exactly symmetric under 90-degree rotation):
 *   0 Red    bottom: back rank y=0,  x=3..10 = R N B Q K B N R  -> Q(6,0)  K(7,0);  pawns y=1,  move +y
 *   1 Blue   left:   back rank x=0,  y=10..3 = R N B Q K B N R  -> Q(0,7)  K(0,6);  pawns x=1,  move +x
 *   2 Yellow top:    back rank y=13, x=10..3 = R N B Q K B N R  -> Q(7,13) K(6,13); pawns y=12, move -y
 *   3 Green  right:  back rank x=13, y=3..10 = R N B Q K B N R  -> Q(13,6) K(13,7); pawns x=12, move -x
 * Internally each seat has "local" coordinates (f = file 0..7 from the player's left, r = rank from own back rank):
 *   Red (3+f, r)   Blue (r, 10-f)   Yellow (10-f, 13-r)   Green (13-r, 3+f)
 * Turn order: Red -> Blue -> Yellow -> Green (clockwise), skipping eliminated players.
 *
 * RULES: pawns double-step from their start rank, no en passant, promote to a queen (only) on local rank 7
 * (Red y=7, Blue x=7, Yellow y=6, Green x=6); promoted queens are worth 1 point when captured.
 * Castling both sides: king moves 2 squares toward the rook (kingside K f4->f6, R f7->f5; queenside K f4->f2, R f0->f3),
 * king & rook unmoved, squares between empty, king not in / through / into check from any active opponent.
 * Kings can never be captured (alive or dead). Check = attacked by any ACTIVE opponent's piece (dead pieces never attack).
 * A player with no legal moves when their turn comes is eliminated: checkmate (+20 to the checking player — the most
 * recent mover among the attackers) or stalemate (+20 to the stalemated player). Eliminated players' pieces turn grey
 * ("dead": never move, worth 0, block squares; a dead king can't be captured).
 * Points: P1 N3 B5 R5 Q9, promoted Q1, mate +20, one move checking 2 kings +5, 3 kings +20.
 * Game over when <=1 active player, or every active player has only a king, or 200 full rounds
 * (200 * active players plies) without a capture or pawn move. Places are by points; ties: still active > eliminated later > earlier.
 */
(function (root) {
  'use strict';
  var N = 14;
  var PTS = { p: 1, n: 3, b: 5, r: 5, q: 9, k: 0 };
  var MAT = { p: 1, n: 3, b: 4, r: 5, q: 9, k: 0 };       // bot material values
  var FWD = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  var BACK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  var KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ALL8 = ORTH.concat(DIAG);
  var NAMES = ['Red', 'Blue', 'Yellow', 'Green'];

  function isSq(x, y) {
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    return !((x < 3 || x > 10) && (y < 3 || y > 10));
  }
  function toBoard(s, f, r) {
    switch (s) {
      case 0: return [3 + f, r];
      case 1: return [r, 10 - f];
      case 2: return [10 - f, 13 - r];
      default: return [13 - r, 3 + f];
    }
  }
  function localRank(s, x, y) { return s === 0 ? y : s === 1 ? x : s === 2 ? 13 - y : 13 - x; }

  // Castle geometry per seat, precomputed.
  var CASTLE = [];
  for (var s0 = 0; s0 < 4; s0++) {
    var k = toBoard(s0, 4, 0);
    CASTLE.push({
      king: k,
      k: { rook: toBoard(s0, 7, 0), kTo: toBoard(s0, 6, 0), rTo: toBoard(s0, 5, 0),
        empty: [toBoard(s0, 5, 0), toBoard(s0, 6, 0)], safe: [toBoard(s0, 5, 0), toBoard(s0, 6, 0)] },
      q: { rook: toBoard(s0, 0, 0), kTo: toBoard(s0, 2, 0), rTo: toBoard(s0, 3, 0),
        empty: [toBoard(s0, 1, 0), toBoard(s0, 2, 0), toBoard(s0, 3, 0)], safe: [toBoard(s0, 3, 0), toBoard(s0, 2, 0)] }
    });
  }

  function newGame() {
    var board = [];
    for (var y = 0; y < N; y++) { var row = []; for (var x = 0; x < N; x++) row.push(null); board.push(row); }
    for (var s = 0; s < 4; s++) {
      for (var f = 0; f < 8; f++) {
        var b = toBoard(s, f, 0); board[b[1]][b[0]] = { t: BACK[f], c: s };
        var p = toBoard(s, f, 1); board[p[1]][p[0]] = { t: 'p', c: s };
      }
    }
    return {
      v: 1, board: board, turn: 0,
      active: [true, true, true, true], points: [0, 0, 0, 0],
      out: [null, null, null, null], outSeq: [null, null, null, null], elimCount: 0,
      castle: [{ k: true, q: true }, { k: true, q: true }, { k: true, q: true }, { k: true, q: true }],
      moveNo: 0, quiet: 0, history: [], lastMove: null, over: false, overReason: null
    };
  }

  function cloneState(st) {
    return {
      v: 1, board: st.board.map(function (r) { return r.slice(); }), turn: st.turn,
      active: st.active.slice(), points: st.points.slice(), out: st.out.slice(),
      outSeq: (st.outSeq || [null, null, null, null]).slice(), elimCount: st.elimCount || 0,
      castle: st.castle.map(function (c) { return { k: !!c.k, q: !!c.q }; }),
      moveNo: st.moveNo || 0, quiet: st.quiet || 0, history: (st.history || []).slice(),
      lastMove: st.lastMove || null, over: !!st.over, overReason: st.overReason || null
    };
  }

  // ---------- attacks ----------
  // Is (x,y) attacked by any live (non-dead) piece whose colour != def?  If `only` >= 0, only colour `only` counts.
  function attacked(B, x, y, def, only) {
    var i, d, p, nx, ny;
    for (i = 0; i < 8; i++) {
      nx = x + KN[i][0]; ny = y + KN[i][1];
      if (isSq(nx, ny)) { p = B[ny][nx]; if (p && p.t === 'n' && !p.dead && p.c !== def && (only < 0 || p.c === only)) return true; }
    }
    for (i = 0; i < 8; i++) {
      d = ALL8[i]; var diag = i >= 4;
      nx = x + d[0]; ny = y + d[1]; var dist = 1;
      while (isSq(nx, ny)) {
        p = B[ny][nx];
        if (p) {
          if (!p.dead && p.c !== def && (only < 0 || p.c === only)) {
            var t = p.t;
            if (t === 'q' || (diag ? t === 'b' : t === 'r')) return true;
            if (dist === 1) {
              if (t === 'k') return true;
              if (t === 'p' && diag) { var fw = FWD[p.c]; if (-d[0] * fw[0] - d[1] * fw[1] === 1) return true; }
            }
          }
          break;
        }
        nx += d[0]; ny += d[1]; dist++;
      }
    }
    return false;
  }
  // Colours (bitmask) of live pieces != def attacking (x,y).
  function attackerMask(B, x, y, def) {
    var m = 0;
    for (var c = 0; c < 4; c++) if (c !== def && attacked(B, x, y, def, c)) m |= 1 << c;
    return m;
  }
  // Cheapest MAT value among live attackers satisfying pred(colour); Infinity if none. King counts as 100.
  function minAttacker(B, x, y, pred) {
    var best = Infinity, i, d, p, nx, ny;
    for (i = 0; i < 8; i++) {
      nx = x + KN[i][0]; ny = y + KN[i][1];
      if (isSq(nx, ny)) { p = B[ny][nx]; if (p && p.t === 'n' && !p.dead && pred(p.c)) { best = 3; break; } }
    }
    for (i = 0; i < 8; i++) {
      d = ALL8[i]; var diag = i >= 4;
      nx = x + d[0]; ny = y + d[1]; var dist = 1;
      while (isSq(nx, ny)) {
        p = B[ny][nx];
        if (p) {
          if (!p.dead && pred(p.c)) {
            var t = p.t, v = -1;
            if (t === 'q') v = 9; else if (diag && t === 'b') v = 4; else if (!diag && t === 'r') v = 5;
            else if (dist === 1 && t === 'k') v = 100;
            else if (dist === 1 && t === 'p' && diag) { var fw = FWD[p.c]; if (-d[0] * fw[0] - d[1] * fw[1] === 1) v = 1; }
            if (v >= 0 && v < best) best = v;
          }
          break;
        }
        nx += d[0]; ny += d[1]; dist++;
      }
    }
    return best;
  }

  function findKing(B, s) {
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var p = B[y][x]; if (p && p.t === 'k' && p.c === s) return [x, y];
    }
    return null;
  }

  // ---------- move generation ----------
  // Internal move: [fx, fy, tx, ty, flag] flag: 0 normal, 1 promo, 2 castle k, 3 castle q
  function pseudo(B, s, castle, out) {
    var fw = FWD[s];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var p = B[y][x];
      if (!p || p.c !== s || p.dead) continue;
      var t = p.t, i, nx, ny, q;
      if (t === 'p') {
        nx = x + fw[0]; ny = y + fw[1];
        if (isSq(nx, ny) && !B[ny][nx]) {
          out.push([x, y, nx, ny, localRank(s, nx, ny) === 7 ? 1 : 0]);
          if (localRank(s, x, y) === 1) {
            var nx2 = nx + fw[0], ny2 = ny + fw[1];
            if (isSq(nx2, ny2) && !B[ny2][nx2]) out.push([x, y, nx2, ny2, 0]);
          }
        }
        for (i = -1; i <= 1; i += 2) {
          nx = x + fw[0] + (fw[0] === 0 ? i : 0); ny = y + fw[1] + (fw[1] === 0 ? i : 0);
          if (!isSq(nx, ny)) continue;
          q = B[ny][nx];
          if (q && q.c !== s && q.t !== 'k') out.push([x, y, nx, ny, localRank(s, nx, ny) === 7 ? 1 : 0]);
        }
      } else if (t === 'n' || t === 'k') {
        var offs = t === 'n' ? KN : ALL8;
        for (i = 0; i < 8; i++) {
          nx = x + offs[i][0]; ny = y + offs[i][1];
          if (!isSq(nx, ny)) continue;
          q = B[ny][nx];
          if (!q || (q.c !== s && q.t !== 'k')) out.push([x, y, nx, ny, 0]);
        }
      } else {
        var dirs = t === 'r' ? ORTH : t === 'b' ? DIAG : ALL8;
        for (i = 0; i < dirs.length; i++) {
          nx = x + dirs[i][0]; ny = y + dirs[i][1];
          while (isSq(nx, ny)) {
            q = B[ny][nx];
            if (!q) out.push([x, y, nx, ny, 0]);
            else { if (q.c !== s && q.t !== 'k') out.push([x, y, nx, ny, 0]); break; }
            nx += dirs[i][0]; ny += dirs[i][1];
          }
        }
      }
    }
    // castling
    var cg = CASTLE[s], kp = B[cg.king[1]][cg.king[0]];
    if (castle && kp && kp.t === 'k' && kp.c === s && !kp.dead && (castle.k || castle.q) &&
        !attacked(B, cg.king[0], cg.king[1], s, -1)) {
      for (var side = 0; side < 2; side++) {
        var key = side ? 'q' : 'k';
        if (!castle[key]) continue;
        var g = cg[key], rp = B[g.rook[1]][g.rook[0]];
        if (!rp || rp.t !== 'r' || rp.c !== s || rp.dead) continue;
        var ok = true, j;
        for (j = 0; j < g.empty.length && ok; j++) if (B[g.empty[j][1]][g.empty[j][0]]) ok = false;
        for (j = 0; j < g.safe.length && ok; j++) if (attacked(B, g.safe[j][0], g.safe[j][1], s, -1)) ok = false;
        if (ok) out.push([cg.king[0], cg.king[1], g.kTo[0], g.kTo[1], side ? 3 : 2]);
      }
    }
    return out;
  }

  // make/unmake on board B (mutating). Returns undo record.
  function make(B, m) {
    var p = B[m[1]][m[0]], cap = B[m[3]][m[2]];
    var u = { p: p, cap: cap, rook: null };
    B[m[1]][m[0]] = null;
    B[m[3]][m[2]] = m[4] === 1 ? { t: 'q', c: p.c, promoted: true } : p;
    if (m[4] >= 2) {
      var g = CASTLE[p.c][m[4] === 2 ? 'k' : 'q'];
      u.rook = B[g.rook[1]][g.rook[0]];
      B[g.rook[1]][g.rook[0]] = null;
      B[g.rTo[1]][g.rTo[0]] = u.rook;
    }
    return u;
  }
  function unmake(B, m, u) {
    B[m[1]][m[0]] = u.p;
    B[m[3]][m[2]] = u.cap;
    if (m[4] >= 2) {
      var g = CASTLE[u.p.c][m[4] === 2 ? 'k' : 'q'];
      B[g.rTo[1]][g.rTo[0]] = null;
      B[g.rook[1]][g.rook[0]] = u.rook;
    }
  }

  function legalInternal(B, s, castle) {
    var ps = pseudo(B, s, castle, []), res = [];
    var kp = findKing(B, s);
    for (var i = 0; i < ps.length; i++) {
      var m = ps[i], u = make(B, m);
      var kx = kp ? kp[0] : -1, ky = kp ? kp[1] : -1;
      if (u.p.t === 'k') { kx = m[2]; ky = m[3]; }
      if (kx < 0 || !attacked(B, kx, ky, s, -1)) res.push(m);
      unmake(B, m, u);
    }
    return res;
  }
  function hasLegal(B, s, castle) {
    var ps = pseudo(B, s, castle, []), kp = findKing(B, s);
    for (var i = 0; i < ps.length; i++) {
      var m = ps[i], u = make(B, m);
      var kx = kp ? kp[0] : -1, ky = kp ? kp[1] : -1;
      if (u.p.t === 'k') { kx = m[2]; ky = m[3]; }
      var ok = kx < 0 || !attacked(B, kx, ky, s, -1);
      unmake(B, m, u);
      if (ok) return true;
    }
    return false;
  }
  function toApi(m) {
    var o = { from: { x: m[0], y: m[1] }, to: { x: m[2], y: m[3] } };
    if (m[4] === 1) o.promo = 'q';
    if (m[4] === 2) o.castle = 'k';
    if (m[4] === 3) o.castle = 'q';
    return o;
  }

  function legalMoves(st) {
    if (!st || st.over || !st.active[st.turn]) return [];
    var B = st.board.map(function (r) { return r.slice(); });
    return legalInternal(B, st.turn, st.castle[st.turn]).map(toApi);
  }
  function legalMovesFrom(st, x, y) {
    return legalMoves(st).filter(function (m) { return m.from.x === x && m.from.y === y; });
  }
  function inCheck(st, s) {
    var kp = findKing(st.board, s);
    return !!(kp && st.active[s] && attacked(st.board, kp[0], kp[1], s, -1));
  }

  // ---------- turn flow ----------
  function nextActive(st, s) {
    for (var i = 1; i <= 4; i++) { var c = (s + i) % 4; if (st.active[c]) return c; }
    return s;
  }
  function countActive(st) { var n = 0; for (var i = 0; i < 4; i++) if (st.active[i]) n++; return n; }

  function markOut(st, s, reason) {
    st.active[s] = false; st.out[s] = reason;
    st.elimCount = (st.elimCount || 0) + 1; st.outSeq[s] = st.elimCount;
    st.castle[s] = { k: false, q: false };
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var p = st.board[y][x];
      if (p && p.c === s && !p.dead) {
        var d = { t: p.t, c: p.c, dead: true }; if (p.promoted) d.promoted = true;
        st.board[y][x] = d;
      }
    }
  }

  function onlyKings(st) {
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var p = st.board[y][x]; if (p && !p.dead && p.t !== 'k' && st.active[p.c]) return false;
    }
    return true;
  }

  function checkOver(st, events) {
    if (st.over) return true;
    var n = countActive(st), reason = null;
    if (n <= 1) reason = 'last';
    else if (onlyKings(st)) reason = 'kings';
    else if (st.quiet >= 200 * n) reason = 'quiet';
    if (reason) {
      st.over = true; st.overReason = reason;
      events.push({ type: 'gameover', reason: reason, standings: standings(st) });
      return true;
    }
    return false;
  }

  // Called with st.turn = the player about to move. Eliminates players without legal moves until someone can move or game ends.
  function resolveTurn(st, events) {
    for (var guard = 0; guard < 8; guard++) {
      if (checkOver(st, events)) return;
      var s = st.turn;
      if (!st.active[s]) { st.turn = nextActive(st, s); continue; }
      var B = st.board;
      if (hasLegal(B, s, st.castle[s])) return;
      var kp = findKing(B, s);
      var mask = kp ? attackerMask(B, kp[0], kp[1], s) : 0;
      if (mask) {
        var by = -1;
        for (var i = 1; i <= 3; i++) { var c = (s + 4 - i) % 4; if (mask & (1 << c)) { by = c; break; } }
        st.points[by] += 20;
        events.push({ type: 'mate', seat: s, by: by, points: 20 });
        markOut(st, s, 'mate');
      } else {
        st.points[s] += 20;
        events.push({ type: 'stalemate', seat: s, points: 20 });
        markOut(st, s, 'stalemate');
      }
      st.turn = nextActive(st, s);
    }
    checkOver(st, events);
  }

  function sameSq(a, x, y) { return a && a.x === x && a.y === y; }

  function applyMove(state, move) {
    if (state.over) throw new Error('game over');
    var st = cloneState(state), s = st.turn, B = st.board;
    var legal = legalInternal(B, s, st.castle[s]), m = null;
    for (var i = 0; i < legal.length; i++) {
      var l = legal[i];
      if (sameSq(move.from, l[0], l[1]) && sameSq(move.to, l[2], l[3])) { m = l; break; }
    }
    if (!m && move.castle) {   // tolerate king->rook style castle requests
      for (i = 0; i < legal.length; i++) {
        if ((legal[i][4] === 2 && move.castle === 'k') || (legal[i][4] === 3 && move.castle === 'q')) { m = legal[i]; break; }
      }
    }
    if (!m) throw new Error('illegal move');
    var events = [];
    var p = B[m[1]][m[0]], cap = B[m[3]][m[2]];
    make(B, m);
    if (cap) {
      var pts = cap.dead ? 0 : (cap.promoted ? 1 : PTS[cap.t]);
      st.points[s] += pts;
      events.push({ type: 'capture', seat: s, victim: cap, at: { x: m[2], y: m[3] }, points: pts });
    }
    if (m[4] === 1) events.push({ type: 'promote', seat: s, at: { x: m[2], y: m[3] } });
    if (m[4] >= 2) events.push({ type: 'castle', seat: s, side: m[4] === 2 ? 'k' : 'q' });
    // castling rights
    if (p.t === 'k') st.castle[s] = { k: false, q: false };
    for (var c = 0; c < 4; c++) {
      var g = CASTLE[c];
      if ((m[0] === g.k.rook[0] && m[1] === g.k.rook[1]) || (m[2] === g.k.rook[0] && m[3] === g.k.rook[1])) st.castle[c] = { k: false, q: st.castle[c].q };
      if ((m[0] === g.q.rook[0] && m[1] === g.q.rook[1]) || (m[2] === g.q.rook[0] && m[3] === g.q.rook[1])) st.castle[c] = { k: st.castle[c].k, q: false };
    }
    st.quiet = (cap || p.t === 'p') ? 0 : st.quiet + 1;
    st.moveNo++;
    var rec = toApi(m); rec.seat = s; rec.piece = p.t; if (cap) rec.cap = cap.t;
    st.history.push(rec); st.lastMove = rec;
    // checks
    var mine = 0;
    for (c = 0; c < 4; c++) {
      if (c === s || !st.active[c]) continue;
      var kp = findKing(B, c); if (!kp) continue;
      var mask = attackerMask(B, kp[0], kp[1], c);
      if (mask) {
        var by = []; for (var j = 0; j < 4; j++) if (mask & (1 << j)) by.push(j);
        events.push({ type: 'check', seat: c, by: by });
        if (mask & (1 << s)) mine++;
      }
    }
    if (mine >= 2) {
      var bonus = mine >= 3 ? 20 : 5;
      st.points[s] += bonus;
      events.push({ type: 'bonus', seat: s, kings: mine, points: bonus });
    }
    st.turn = nextActive(st, s);
    resolveTurn(st, events);
    return { state: st, events: events };
  }

  function eliminate(state, seat, reason) {
    var st = cloneState(state), events = [];
    if (st.over || !st.active[seat]) return { state: st, events: events };
    markOut(st, seat, reason || 'resign');
    events.push({ type: 'eliminate', seat: seat, reason: reason || 'resign' });
    if (st.turn === seat) st.turn = nextActive(st, seat);
    resolveTurn(st, events);
    return { state: st, events: events };
  }

  function isOver(st) { return !!st.over; }

  function standings(st) {
    var seats = [0, 1, 2, 3];
    var seq = st.outSeq || [null, null, null, null];
    seats.sort(function (a, b) {
      if (st.points[b] !== st.points[a]) return st.points[b] - st.points[a];
      var ea = st.active[a] ? 1e9 : (seq[a] || 0), eb = st.active[b] ? 1e9 : (seq[b] || 0);
      if (eb !== ea) return eb - ea;
      return a - b;
    });
    return seats.map(function (s, i) { return { seat: s, points: st.points[s], place: i + 1, out: st.out[s] || null }; });
  }

  // ---------- bot ----------
  function rnd(n) { return Math.floor(Math.random() * n); }

  // Expected material loss for seat s on board B: for each of s's pieces attacked by an active opponent.
  // Considers opponents in turn order after s, weighted 1, .5, .3 (each takes at most one piece).
  function threatLoss(B, s, active, onlySq) {
    var w = [1, 0.5, 0.3], total = 0, oi = 0;
    for (var i = 1; i <= 3; i++) {
      var o = (s + i) % 4; if (!active[o]) continue;
      var best = 0;
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var p = B[y][x];
        if (!p || p.c !== s || p.dead || p.t === 'k') continue;
        if (onlySq && (onlySq[0] !== x || onlySq[1] !== y)) continue;
        var a = minAttacker(B, x, y, function (c) { return c === o; });
        if (a === Infinity) continue;
        var v = p.promoted ? 9 : MAT[p.t];
        var def = minAttacker(B, x, y, function (c) { return c === s; }) !== Infinity;
        var loss = def ? Math.max(0, v - a) : v;   // a king attacker (100) can't take a defended piece
        if (loss > best) best = loss;
      }
      total += best * w[oi]; oi++;
    }
    return total;
  }

  function positional(s, m, p) {
    var sc = 0, r0 = localRank(s, m[0], m[1]), r1 = localRank(s, m[2], m[3]);
    if (p.t === 'p') sc += 0.08 * (r1 - r0) + (r1 >= 5 ? 0.15 : 0);
    else if ((p.t === 'n' || p.t === 'b') && r0 === 0) sc += 0.35;
    else if (p.t === 'k' && m[4] < 2) sc -= 0.4;
    else if (p.t === 'q' && r0 === 0) sc -= 0.1;
    if (m[4] >= 2) sc += 0.6;
    var cx = Math.abs(m[2] - 6.5) + Math.abs(m[3] - 6.5), fx = Math.abs(m[0] - 6.5) + Math.abs(m[1] - 6.5);
    sc += 0.03 * (fx - cx);
    return sc;
  }

  function scoreMove(st, B, s, m, level) {
    var p = B[m[1]][m[0]], cap = B[m[3]][m[2]];
    var sc = 0;
    if (cap) sc += cap.dead ? 0.05 : (cap.promoted ? 1 : PTS[cap.t]) + 0.1;
    if (m[4] === 1) sc += 8;
    var u = make(B, m);
    // checks / mates on opponents
    var mine = 0;
    for (var c = 0; c < 4; c++) {
      if (c === s || !st.active[c]) continue;
      var kp = findKing(B, c); if (!kp) continue;
      if (attacked(B, kp[0], kp[1], c, s)) {
        mine++;
        if (level >= 3) {
          if (!hasLegal(B, c, st.castle[c])) sc += 22; else sc += 0.3;
        }
      }
    }
    if (mine >= 3) sc += 20; else if (mine === 2) sc += 5;
    if (level === 2) sc -= threatLoss(B, s, st.active, [m[2], m[3]]) * 0.9;
    else if (level >= 3) sc -= threatLoss(B, s, st.active, null);
    if (level >= 3) {
      var me = findKing(B, s);
      if (me) {   // king exposure: count enemy-attacked squares around my king
        var bad = 0;
        for (var i = 0; i < 8; i++) {
          var nx = me[0] + ALL8[i][0], ny = me[1] + ALL8[i][1];
          if (isSq(nx, ny) && attacked(B, nx, ny, s, -1)) bad++;
        }
        sc -= bad * 0.12;
      }
    }
    unmake(B, m, u);
    sc += positional(s, m, p);
    return sc;
  }

  // Simulate the rest of the round after my move m: each active opponent plays its greedy best (level-2 style) move.
  // Returns my net gain estimate (points gained by me minus material lost).
  function roundSim(st, B, s, m) {
    var undo = [], cap0 = B[m[3]][m[2]];
    var gain = cap0 ? (cap0.dead ? 0 : (cap0.promoted ? 1 : PTS[cap0.t])) : 0;
    if (m[4] === 1) gain += 8;
    undo.push([m, make(B, m)]);
    var lost = 0;
    for (var i = 1; i <= 3; i++) {
      var o = (s + i) % 4; if (!st.active[o]) continue;
      var ms = legalInternal(B, o, st.castle[o]);
      if (!ms.length) continue;
      var best = null, bs = -Infinity;
      for (var j = 0; j < ms.length; j++) {
        var q = B[ms[j][3]][ms[j][2]], v = 0;
        if (q && !q.dead) v = (q.promoted ? 1 : PTS[q.t]) + (q.c === s ? 0.2 : 0);
        if (ms[j][4] === 1) v += 8;
        if (v > 0) {   // only consider captures/promos; subtract simple recapture risk
          var u2 = make(B, ms[j]);
          var piece = B[ms[j][3]][ms[j][2]];
          if (minAttacker(B, ms[j][2], ms[j][3], function (c) { return c !== o && st.active[c]; }) !== Infinity) v -= (piece.promoted ? 9 : MAT[piece.t]) * 0.8;
          unmake(B, ms[j], u2);
        }
        if (v > bs) { bs = v; best = ms[j]; }
      }
      if (bs <= 0.5) continue;   // no worthwhile capture: assume a quiet move (ignored)
      var victim = B[best[3]][best[2]];
      if (victim && victim.c === s) lost += victim.promoted ? 9 : MAT[victim.t];
      undo.push([best, make(B, best)]);
    }
    var res = gain - lost - 0.5 * threatLoss(B, s, st.active, null);
    for (var k = undo.length - 1; k >= 0; k--) unmake(B, undo[k][0], undo[k][1]);
    return res;
  }

  function botMove(state, level) {
    level = Math.max(1, Math.min(4, level | 0 || 2));
    if (state.over) return null;
    var s = state.turn;
    var B = state.board.map(function (r) { return r.slice(); });
    var ms = legalInternal(B, s, state.castle[s]);
    if (!ms.length) return null;
    if (ms.length === 1) return toApi(ms[0]);
    if (level === 1) {
      var caps = ms.filter(function (m) { var q = B[m[3]][m[2]]; return q && !q.dead; });
      if (caps.length && Math.random() < 0.6) {
        caps.sort(function (a, b) { return PTS[B[b[3]][b[2]].t] - PTS[B[a[3]][a[2]].t]; });
        return toApi(caps[Math.random() < 0.5 ? 0 : rnd(caps.length)]);
      }
      return toApi(ms[rnd(ms.length)]);
    }
    var noise = level === 2 ? 1.2 : level === 3 ? 0.35 : 0.1;
    var scored = ms.map(function (m) { return { m: m, s: scoreMove(state, B, s, m, level) + Math.random() * noise }; });
    scored.sort(function (a, b) { return b.s - a.s; });
    if (level === 2 && Math.random() < 0.12) return toApi(scored[rnd(Math.min(6, scored.length))].m);
    if (level === 4) {
      var top = scored.slice(0, Math.min(12, scored.length));
      for (var i = 0; i < top.length; i++) top[i].s = top[i].s * 0.5 + roundSim(state, B, s, top[i].m) + Math.random() * 0.05;
      top.sort(function (a, b) { return b.s - a.s; });
      return toApi(top[0].m);
    }
    return toApi(scored[0].m);
  }

  var Four = {
    N: N, NAMES: NAMES, POINTS: PTS,
    isSquare: isSq,
    newGame: newGame,
    legalMoves: legalMoves,
    legalMovesFrom: legalMovesFrom,
    applyMove: applyMove,
    eliminate: eliminate,
    isOver: isOver,
    standings: standings,
    inCheck: inCheck,
    botMove: botMove,
    clone: cloneState,
    _attacked: function (st, x, y, def) { return attacked(st.board, x, y, def, -1); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Four;
  else root.Four = Four;
})(typeof self !== 'undefined' ? self : this);
