/* Time Duel — screens, flow and the round itself. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var el = function (sel, root) { return (root || document).querySelector(sel); };
  var els = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* The price list is duplicated from timeduel-setup.sql for DISPLAY only.
   * The database charges from its own copy, so if these ever drift the
   * player is charged the real price and never the one a hacked page claims. */
  var ARENAS = [
    { id: "bronze",  name: "Bronze",  icon: "🥉", entry: 10 },
    { id: "silver",  name: "Silver",  icon: "🥈", entry: 50 },
    { id: "gold",    name: "Gold",    icon: "🥇", entry: 200 },
    { id: "diamond", name: "Diamond", icon: "💎", entry: 1000 },
    { id: "master",  name: "Master",  icon: "👑", entry: 5000 }
  ];

  var S = {
    screen: "menu",
    mode: "classic",
    tournament: false,
    capacity: 2,
    arena: "bronze",
    code: null,
    room: null,
    coins: null,
    armedKey: null,       // "CODE#round" of the round we've already armed
    round: null,          // TDClock.Round
    myStop: null,
    sentStop: false,
    practice: { targetMs: 2000, blind: false, round: null, active: false },
    inPractice: false,
    resultKey: null,      // "CODE#round" of the result already on screen
    onStopCb: null,       // what to do with this round's measured time
    hintTimer: null,
    busy: false
  };

  /* ================================================================ chrome */

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, ms || 2300);
  }

  function banner(msg) {
    var b = $("banner");
    if (!msg) { b.classList.remove("on"); return; }
    b.textContent = msg;
    b.classList.add("on");
  }

  var BACKABLE = { multi: "menu", join: "multi", mode: "multi", size: "mode",
                   arena: null, practice: "menu", profile: "menu" };

  function show(name) {
    S.screen = name;
    els(".screen").forEach(function (s) { s.classList.remove("on"); });
    var sc = $("sc-" + name);
    if (sc) sc.classList.add("on");
    // The back button never appears mid-round: there is no backing out of a
    // round you have already paid the entry fee for.
    var showBack = (name in BACKABLE) || name === "lobby";
    $("backBtn").classList.toggle("on", showBack);
    $("homeBtn").style.display = (name === "round") ? "none" : "grid";
    // The round screen is one big tap target. The coin pill and the gear are
    // painted above it, so leaving them up meant the top of the screen did
    // not stop the timer — and a mis-tap on the gear opened a full-screen
    // modal with the clock still running behind it, losing the round and the
    // entry fee. Nothing but the tap zone exists during a round.
    var tb = document.querySelector(".topbar");
    if (tb) tb.style.display = (name === "round") ? "none" : "flex";
    if (name === "menu") banner("");
    // Re-read the balance whenever the player lands somewhere it is shown or
    // spent. It used to refresh at only a few moments, so it could sit stale
    // for a whole session and make the coin rules look broken when they were
    // not. Throttled, so flicking between screens does not spam the API.
    if (name === "menu" || name === "multi" || name === "arena" ||
        name === "join" || name === "lobby") coinsSoon();
    TDSound.duck(name === "round");
  }

  function back() {
    if (S.screen === "lobby") { leaveRoom(); return; }
    if (S.screen === "arena") { show(S.tournament ? "size" : "mode"); return; }
    show(BACKABLE[S.screen] || "menu");
  }

  /* ============================================================ the wallet */

  function setCoins(n) {
    if (n == null) return;
    S.coins = n;
    $("coinVal").textContent = n;
  }

  var coinsAt = 0;
  function coinsSoon() {
    if (Date.now() - coinsAt < 2500) return;
    coinsAt = Date.now();
    refreshCoins().then(function () {
      if (S.screen === "arena") renderArenas();
    });
  }

  async function refreshCoins() {
    var r = await TDDB.profile();
    if (r && r.ok) { setCoins(r.coins); return r; }
    if (r && r.error === "no_db") showNoDb();
    else if (r && r.error === "offline") banner("You're offline — Time Duel needs a connection.");
    return null;
  }

  function showNoDb() {
    banner("Time Duel's database isn't set up yet — run timeduel-setup.sql in Supabase → SQL Editor.");
  }

  /* ============================================================== identity */

  function player() { return (window.IGAuth && IGAuth.getUser) ? IGAuth.getUser() : null; }

  var authReady = false;

  function needAccount() {
    if (player()) return false;
    if (!authReady) { toast("Still signing you in — one moment…"); return true; }
    if (!window.IGAuth) { toast("Can't reach the accounts server."); return true; }
    toast("Log in to play Time Duel");
    try { IGAuth.openAuth(); } catch (e) {}
    return true;
  }

  /* ================================================================= menus */

  els("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () {
      TDSound.click();
      var to = b.getAttribute("data-go");
      if (to === "multi" && needAccount()) return;
      if (to === "profile") { openProfile(); return; }
      if (to === "practice") { openPractice(); return; }
      show(to);
    });
  });

  $("goCreate").addEventListener("click", function () {
    TDSound.click(); show("mode");
  });
  $("goJoin").addEventListener("click", function () {
    TDSound.click(); $("joinCode").value = ""; show("join");
    setTimeout(function () { try { $("joinCode").focus(); } catch (e) {} }, 120);
  });

  els("[data-mode]").forEach(function (c) {
    c.addEventListener("click", function () {
      TDSound.click();
      var m = c.getAttribute("data-mode");
      if (m === "tournament") {
        S.tournament = true; S.capacity = 4; S.mode = "classic";
        renderSizes(); show("size");
      } else {
        S.tournament = false; S.capacity = 2; S.mode = m;
        renderArenas(); show("arena");
      }
    });
  });

  function renderSizes() {
    var g = $("sizeGrid");
    g.innerHTML = "";
    for (var n = 2; n <= 8; n++) {
      (function (n) {
        var b = document.createElement("button");
        b.textContent = n;
        b.className = (n === S.capacity ? "sel" : "");
        b.addEventListener("click", function () {
          TDSound.click(); S.capacity = n; renderSizes();
        });
        g.appendChild(b);
      })(n);
    }
    els("[data-tmode]").forEach(function (c) {
      c.classList.toggle("sel", c.getAttribute("data-tmode") === S.mode);
    });
  }

  els("[data-tmode]").forEach(function (c) {
    c.addEventListener("click", function () {
      TDSound.click(); S.mode = c.getAttribute("data-tmode"); renderSizes();
    });
  });

  $("sizeNext").addEventListener("click", function () {
    TDSound.click(); renderArenas(); show("arena");
  });

  function renderArenas() {
    var list = $("arenaList");
    list.innerHTML = "";
    $("arenaSub").textContent =
      (S.tournament
        ? S.capacity + " players · " + (S.mode === "blind" ? "Blind" : "Classic")
        : (S.mode === "blind" ? "Blind duel" : "Classic duel") + " · 2 players") +
      "  ·  you have " + (S.coins == null ? "…" : S.coins) + " 🪙";

    ARENAS.forEach(function (a) {
      var pot = a.entry * S.capacity;
      var poor = (S.coins != null && S.coins < a.entry);
      var d = document.createElement("div");
      d.className = "card" + (poor ? " locked" : "");
      d.innerHTML =
        '<div class="ct">' + a.icon + " " + a.name +
        '<span class="badge">' + (poor ? "need " + a.entry : "win " + pot) + "</span></div>" +
        '<div class="cd">Entry <b>' + a.entry + " 🪙</b> · pot <b>" +
        (S.capacity > 2 ? "up to " + pot : pot) + " 🪙</b>" +
        (S.capacity > 2 ? " — the entry fees of whoever actually plays" : "") + "</div>";
      d.addEventListener("click", function () {
        if (poor) {
          TDSound.error();
          toast("You have " + (S.coins == null ? "too few" : S.coins) +
                " coins — " + a.name + " costs " + a.entry + " to enter.");
          return;
        }
        TDSound.click();
        S.arena = a.id;
        createRoom();
      });
      makeFocusable(d);
      list.appendChild(d);
    });
  }

  function arenaById(id) {
    for (var i = 0; i < ARENAS.length; i++) if (ARENAS[i].id === id) return ARENAS[i];
    return ARENAS[0];
  }

  /* ============================================================ room flows */

  function rpcError(r) {
    var e = r && r.error;
    if (e === "no_db")    { showNoDb(); return "Database not set up yet."; }
    if (e === "auth")     return "Log in again to play.";
    if (e === "broke")    return "Not enough coins — you need " + (r.need || "more") + ".";
    if (e === "full")     return "That room is full.";
    if (e === "started")  return "That round has already started.";
    if (e === "no_room")  return "No room with that code.";
    if (e === "not_host") return "Only the host can do that.";
    if (e === "need_two") return "You need at least 2 players.";
    if (e === "offline")  return "You're offline — check your connection.";
    if (e === "busy")     return "Hang on, the round is still going.";
    return "Something went wrong. Try again.";
  }

  async function createRoom() {
    if (needAccount() || S.busy) return;
    S.busy = true;
    var r = await TDDB.createRoom(S.mode, S.arena, S.capacity);
    S.busy = false;
    if (!r.ok) { TDSound.error(); toast(rpcError(r)); refreshCoins(); return; }
    enterRoom(r);
  }

  $("joinBtn").addEventListener("click", async function () {
    if (needAccount() || S.busy) return;
    var code = ($("joinCode").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (code.length !== 4) { TDSound.error(); toast("Enter the 4-letter room code"); return; }
    S.busy = true; TDSound.click();
    $("joinBtn").setAttribute("disabled", "");
    var r = await TDDB.joinRoom(code);
    $("joinBtn").removeAttribute("disabled");
    S.busy = false;
    if (!r.ok) { TDSound.error(); toast(rpcError(r)); return; }
    enterRoom(r);
  });

  $("joinCode").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $("joinBtn").click(); }
  });

  $("joinCode").addEventListener("input", function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });

  var ROOM_KEY = "timeDuel_room_v1";

  function rememberRoom(code) {
    try {
      if (code) sessionStorage.setItem(ROOM_KEY, code);
      else sessionStorage.removeItem(ROOM_KEY);
    } catch (e) {}
  }

  function rememberedRoom() {
    try { return sessionStorage.getItem(ROOM_KEY); } catch (e) { return null; }
  }

  /* Reconnect to whatever room this tab was in before it reloaded. Without
   * this, refreshing during a round left the player outside a room they had
   * already paid for, with no way back and no explanation — the stake just
   * sat escrowed until the 30-minute sweep. */
  async function resumeRoom() {
    var code = rememberedRoom();
    if (!code || S.code || S.inPractice) return;
    var r = await TDDB.state(code);
    // Re-check AFTER the await: this lookup takes seconds on a bad link, and
    // the player may have created or joined a room in the meantime. Stealing
    // the UI back would leave their fresh stake in a room they cannot reach.
    if (S.code) return;
    if (!r || !r.ok || !r.seated ||
        r.status === "aborted" || r.status === "done") { rememberRoom(null); return; }
    S.code = code;
    rememberRoom(code);
    S.room = r;
    S.armedKey = null;
    TDNet.open(code, onRoom);
    onRoom(r, true);
    toast("Back in room " + code);
  }

  function enterRoom(r) {
    rememberRoom(r.code);
    S.code = r.code;
    S.armedKey = null;
    S.room = r;
    refreshCoins();
    TDNet.open(r.code, onRoom);
    onRoom(r, true);
  }

  async function leaveRoom() {
    var code = S.code;
    TDSound.click();
    TDNet.close();
    rememberRoom(null);
    S.code = null; S.room = null; S.armedKey = null;
    if (S.round) { S.round.cancel(); S.round = null; }
    show("menu");
    if (code) { await TDDB.leaveRoom(code); TDNet.shout(); }
    refreshCoins();
  }

  $("leaveBtn").addEventListener("click", leaveRoom);

  $("rejoinBtn").addEventListener("click", async function () {
    if (S.busy || !S.code) return;
    S.busy = true; TDSound.click();
    $("rejoinBtn").setAttribute("disabled", "");
    var r = await TDDB.joinRoom(S.code);
    S.busy = false;
    $("rejoinBtn").removeAttribute("disabled");
    if (!r.ok) {
      TDSound.error();
      if (r.error === "broke") {
        var need = r.need != null ? r.need : (S.room ? S.room.entry : 0);
        $("lobbyHint").textContent = "You don't have enough coins for this round — " +
          "it costs " + need + " 🪙 and you have " + (r.coins == null ? "fewer" : r.coins) + ".";
      }
      toast(rpcError(r));
      refreshCoins();
      return;
    }
    S.resultKey = null;
    TDNet.shout();
    onRoom(r, true);
    refreshCoins();
  });

  /* ------------------------------------------------- the room state pump */

  function onRoom(r, changed) {
    if (!r) return;

    if (!r.ok) {
      if (r.error === "no_room") {
        toast("That room has closed.");
        TDNet.close(); rememberRoom(null); S.code = null; show("menu"); refreshCoins();
      } else if (r.error === "no_db") {
        showNoDb();
      } else if (r.failures && r.failures >= 3) {
        banner("Reconnecting…");
      }
      return;
    }
    banner("");
    S.room = r;

    if (r.status === "lobby") {
      // Still looking at the result of the last round? Leave it up and just
      // re-label the buttons. Yanking people to a lobby the instant the host
      // hits rematch is how the winner vanished before anyone could read it.
      if (S.screen === "result") { resultActions(r); return; }
      var first = (S.screen !== "lobby");
      if (changed || first) renderLobby(r);
      if (first) show("lobby");
    }
    else if (r.status === "playing") {
      if (S.screen === "result" && !mySeat(r)) { resultActions(r); return; }
      if (r.seated === false) {
        // Not in this round — the host restarted without us. Never arm a
        // round we cannot see the target for.
        S.armedKey = null;
        if (S.round) { S.round.cancel(); S.round = null; }
        renderLobby(r);
        if (S.screen !== "lobby") show("lobby");
        $("lobbyHint").textContent = "A round is in progress without you — wait for it to finish.";
      } else {
        enterRound(r);
        if (S.screen === "round" && S.myStop != null) updateWaiting(r);
      }
    }
    else if (r.status === "done")    { enterResult(r); }
    else if (r.status === "aborted") {
      if (S.screen === "result") { resultActions(r); refreshCoins(); return; }
      toast("The host closed the room — your entry was refunded.");
      TDNet.close(); rememberRoom(null); S.code = null; show("menu"); refreshCoins();
    }
  }

  function myName() { var p = player(); return p ? p.name : null; }

  function mySeat(r) {
    var me = myName();
    return (r.seats || []).filter(function (s) { return s.name === me; })[0] || null;
  }

  function renderLobby(r) {
    var a = arenaById(r.arena);
    $("lobbyCode").textContent = r.code;
    $("lobbyMeta").textContent = a.icon + " " + a.name + " · " +
      (r.mode === "blind" ? "🙈 Blind" : "🎯 Classic") + " · entry " + r.entry +
      " 🪙 · pot " + r.pot + " 🪙";

    var seats = r.seats || [];
    var box = $("lobbySeats");
    box.innerHTML = "";
    for (var i = 0; i < r.capacity; i++) {
      var s = seats[i];
      var d = document.createElement("div");
      d.className = "row" + (s && s.name === myName() ? " me" : "");
      d.innerHTML = s
        ? '<span>' + (s.name === r.host ? "👑" : "🎮") + '</span><span class="nm"></span>' +
          '<span class="rt">' + (s.name === myName() ? "you" : "ready") + "</span>"
        : '<span>➕</span><span class="nm" style="color:var(--dim)">waiting…</span>';
      if (s) el(".nm", d).textContent = s.name;
      box.appendChild(d);
    }

    var isHost = (r.host === myName());
    var enough = seats.length >= 2;
    var seatedMe = !!mySeat(r);
    var room = r.capacity - seats.length;

    // Not seated: the host has re-opened the room for another round and we
    // have to buy back in. Nobody is ever re-staked without tapping.
    $("rejoinBtn").style.display = seatedMe ? "none" : "block";
    $("rejoinBtn").textContent = room > 0
      ? "🎟 Take your seat (" + r.entry + " 🪙)"
      : "Room is full";
    if (room > 0) $("rejoinBtn").removeAttribute("disabled");
    else $("rejoinBtn").setAttribute("disabled", "");

    $("startBtn").style.display = (isHost && seatedMe) ? "block" : "none";
    if (isHost && seatedMe) {
      if (enough) $("startBtn").removeAttribute("disabled");
      else $("startBtn").setAttribute("disabled", "");
    }
    $("lobbyHint").textContent = !seatedMe
      ? (room > 0 ? "A new round is open — take your seat to play."
                  : "This round filled up without you.")
      : isHost
        ? (enough ? "Start when everyone's in — " + seats.length + " of " + r.capacity + " seated."
                  : "Share the code " + r.code + " — you need at least 2 players.")
        : "Waiting for " + r.host + " to start… (" + seats.length + "/" + r.capacity + ")";
  }

  $("startBtn").addEventListener("click", async function () {
    if (S.busy) return;
    S.busy = true; TDSound.click();
    $("startBtn").setAttribute("disabled", "");
    var r = await TDDB.startRound(S.code);
    S.busy = false;
    if (!r.ok) { TDSound.error(); toast(rpcError(r)); $("startBtn").removeAttribute("disabled"); return; }
    TDNet.shout();
    onRoom(r, true);
  });

  /* ================================================================ round */

  function enterRound(r) {
    var key = r.code + "#" + r.round;
    if (S.armedKey === key) {
      // Already running this round — just refresh who has answered.
      if (S.screen === "round") updateWaiting(r);
      return;
    }
    S.armedKey = key;
    S.myStop = null;
    S.sentStop = false;
    S.inPractice = false;
    // Whatever was running belongs to a round that is over. Leaving it armed
    // kept its rAF loop alive, let its onExpire clobber this screen, and left
    // #tapzone measuring taps against the old round's start.
    if (S.round) { S.round.cancel(); S.round = null; }
    S.onStopCb = null;

    var target = r.target_ms;
    var blind = (r.mode === "blind");
    var startMs = Date.parse(r.started_at);
    var until = startMs - TDDB.serverNow();

    // Belt and braces: never hand NaN to the clock. Every comparison against
    // NaN is false, which turns the round screen into a dead end.
    if (target == null || !isFinite(until)) {
      S.armedKey = null;
      renderLobby(r);
      if (S.screen !== "lobby") show("lobby");
      return;
    }

    // Arrived so late the round is effectively over: don't pretend to play it.
    if (until < -(target + 3000)) {
      $("roundTarget").textContent = TDClock.secs(target, 3);
      $("countnum").textContent = "";
      $("bigtime").style.display = "none";
      show("round");
      bail("You missed the start of this round.");
      return;
    }

    beginRound({
      targetMs: target, blind: blind, msUntilStart: until,
      onStop: function (ms) { sendStop(ms); }
    });
  }

  function beginRound(opts) {
    $("roundTarget").textContent = TDClock.secs(opts.targetMs, 3);
    $("countnum").textContent = "";
    $("countnum").style.display = "block";
    $("bigtime").style.display = "none";
    $("blindclock").style.display = "none";
    $("bigtime").className = "mono " + (opts.blind ? "blind" : "live");
    $("roundHint").textContent = "Get ready…";
    $("roundBail").style.display = "none";
    show("round");                       // content first, THEN the fade-in

    if (S.round) { S.round.cancel(); S.round = null; }
    var round = new TDClock.Round({
      targetMs: opts.targetMs,
      blind: opts.blind,
      onCount: function (n) {
        var c = $("countnum");
        if (n === "GO") {
          c.style.display = "none";
          if (opts.blind) {
            // The clock is running; you just can't read it.
            $("bigtime").style.display = "none";
            $("blindclock").style.display = "grid";
          } else {
            $("blindclock").style.display = "none";
            $("bigtime").style.display = "block";
            $("bigtime").textContent = "0.00";
          }
          $("roundHint").textContent = opts.blind
            ? "Count it yourself — tap at " + TDClock.secs(opts.targetMs, 3) + "s"
            : "Tap anywhere to stop";
          TDSound.go();
        } else if (typeof n === "number" && n > 0 && n <= 3) {
          c.textContent = n;
          // Re-trigger the pop animation on each number.
          c.style.animation = "none"; void c.offsetWidth; c.style.animation = "";
          TDSound.tickDown(n);
        }
      },
      onFrame: function (ms) { $("bigtime").textContent = TDClock.live(ms); },
      onExpire: function () {
        TDSound.lose();
        bail("Too slow! The round timed out.");
      }
    });

    S.round = round;
    S.onStopCb = opts.onStop;
    round.arm(opts.msUntilStart);
  }

  // Shown only when a round has ended in a way that produces no result
  // screen — a practice round that timed out, or an answer we could never
  // deliver. Without this the player had no back button, no home button and
  // no working tap: the only way out was reloading the page.
  function bail(msg) {
    $("roundHint").textContent = msg;
    var b = $("roundBail");
    b.style.display = "block";
    b.textContent = S.inPractice ? "← Back to practice" : "← Back to the room";
  }

  $("roundBail").addEventListener("click", function () {
    TDSound.click();
    $("roundBail").style.display = "none";
    if (S.round) { S.round.cancel(); S.round = null; }
    if (S.inPractice) { show("practice"); return; }
    if (!S.code || !S.room) { show("menu"); return; }
    if (S.room.status === "done") { enterResult(S.room); return; }
    // The round is still running. Show the room as it actually is — and NOT a
    // stale lobby offering "Leave room", which would walk out on a round that
    // can still be won (and whose stake td_leave will not refund).
    renderLobby(S.room);
    show("lobby");
    $("lobbyHint").textContent = "Your round is still being settled — hold on.";
    TDNet.refreshNow();
  });

  function handleTap(e) {
    if (S.screen !== "round" || !S.round) return;
    // Only a primary press counts: a right-click or a second finger must not
    // spend the one answer this player gets.
    if (e && e.type === "pointerdown" && (e.button > 0 || e.isPrimary === false)) return;
    if (S.round.counting()) {
      $("roundHint").textContent = "Not yet — wait for START";
      // ...and put the normal prompt back, or the scolding outlives the
      // countdown and is still on screen during the round itself.
      clearTimeout(S.hintTimer);
      S.hintTimer = setTimeout(function () {
        if (S.round && S.round.counting()) $("roundHint").textContent = "Get ready…";
      }, 700);
      return;
    }
    var ms = S.round.stop(e);
    if (ms == null) return;
    S.myStop = ms;
    TDSound.stop();
    // Whatever the mode, your own time is revealed the instant you stop.
    $("blindclock").style.display = "none";
    $("bigtime").className = "mono";
    $("bigtime").textContent = TDClock.secs(ms, 3);
    $("bigtime").style.display = "block";
    $("countnum").style.display = "none";
    if (S.onStopCb) S.onStopCb(ms);
  }

  $("tapzone").addEventListener("pointerdown", handleTap);
  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space" && e.code !== "Enter") return;
    if (e.repeat) return;                       // a held key must not auto-fire
    if (S.screen !== "round") return;
    // Let a focused control have the key. Swallowing it here made the escape
    // button reachable by Tab but impossible to press.
    var t = e.target;
    if (t && (t.tagName === "BUTTON" || t.tagName === "INPUT" ||
              t.getAttribute && t.getAttribute("role") === "button")) return;
    e.preventDefault();
    handleTap(e);
  });

  async function sendStop(ms) {
    if (S.sentStop) return;
    S.sentStop = true;
    $("roundHint").textContent = "Sending your time…";
    var r = await TDDB.stopRound(S.code, ms, S.room ? S.room.round : null);
    if (!r.ok) {
      TDSound.error();
      // Let them out. S.sentStop stays true because the tap itself is spent
      // (the clock is stopped and cannot be restarted), but the player must
      // not be trapped on a dead screen waiting for a result that is never
      // coming.
      if (r.error === "impossible") bail("That time was rejected by the server.");
      else if (r.error === "stale_round") bail("That round had already moved on.");
      else bail("Couldn't send your time — " + rpcError(r));
      return;
    }
    TDNet.shout();
    onRoom(r, true);
  }

  function updateWaiting(r) {
    if (S.myStop == null) return;
    var seats = r.seats || [];
    var done = seats.filter(function (s) { return s.done; }).length;
    var msg = "Waiting for the others… " + done + "/" + seats.length + " in";

    // A player who never answers forfeits 15s after the target elapses. That
    // silence read as a freeze, so count it down out loud instead.
    if (r.started_at && r.target_ms != null) {
      var left = (Date.parse(r.started_at) + r.target_ms + 15000) - TDDB.serverNow();
      if (left > 0 && left < 15000) {
        msg = "Still waiting on " + (seats.length - done) + " player" +
              (seats.length - done === 1 ? "" : "s") + " — " +
              Math.ceil(left / 1000) + "s until they forfeit";
      }
    }
    $("roundHint").textContent = msg;
  }

  /* =============================================================== result */

  /* The result is the payoff of the whole round, so it STAYS on screen.
   * Nothing drags the player off it automatically any more: if the host opens
   * another round the winner is still shown and the button simply becomes
   * "Take your seat"; if the host closes the room the winner is still shown
   * and the button becomes "Back to menu". */
  function enterResult(r) {
    var key = r.code + "#" + r.round;
    if (S.screen === "result" && S.resultKey === key) { resultActions(r); return; }
    S.resultKey = key;
    if (S.round) { S.round.cancel(); S.round = null; }

    var seats = (r.seats || []).slice().sort(function (a, b) {
      if (a.diff_ms == null) return 1;
      if (b.diff_ms == null) return -1;
      return a.diff_ms - b.diff_ms;
    });
    var me = mySeat(r);
    var best = (seats.length && seats[0].diff_ms != null) ? seats[0].diff_ms : null;
    var winners = seats.filter(function (x) { return x.diff_ms != null && x.diff_ms === best; });
    var iWon = !!(me && best != null && me.diff_ms === best);
    var voided = !r.winner;

    // Mirror td_settle exactly, odd coins and all.
    var share = winners.length ? Math.floor(r.pot / winners.length) : 0;
    var extra = r.pot - (share * (winners.length || 1));
    var payout = iWon ? share + (r.winner === myName() ? extra : 0) : 0;
    var delta = voided ? 0 : payout - r.entry;

    var crown = $("resultCrown"), nameEl = $("winnerName"), subEl = $("winnerSub");

    if (voided) {
      crown.textContent = "⏳";
      nameEl.className = "winner void";
      nameEl.textContent = "Nobody stopped the clock";
      subEl.className = "winner-sub";
      subEl.textContent = "Every entry fee was returned.";
    } else {
      var dot = winners.some(function (x) { return x.diff_ms === 0; });
      crown.textContent = dot ? "🎯" : "🏆";
      nameEl.className = "winner" + (dot ? " dot" : "");
      nameEl.textContent = winners.length > 1
        ? winners.map(function (x) { return x.name; }).join("  &  ")
        : (r.winner || "—");
      subEl.className = "winner-sub" + (delta < 0 ? " neg" : "");
      subEl.textContent = (winners.length > 1 ? "split " : "wins ") + r.pot + " 🪙" +
        (me ? "   ·   you " + (delta >= 0 ? "+" : "") + delta + " 🪙" : "");
      if (me && me.diff_ms === 0) TDSound.dot();
      else if (iWon) TDSound.win();
      else TDSound.lose();
    }

    // The target, then every player's time. Large, and nothing else.
    var board = $("timesBoard");
    board.innerHTML = "";
    var t = document.createElement("div");
    t.className = "trow";
    t.innerHTML = '<span class="tn" style="color:var(--dim);font-size:15px;letter-spacing:.14em">TARGET</span>' +
                  '<span class="tt" style="color:var(--gold)"></span>';
    el(".tt", t).textContent = TDClock.secs(r.target_ms, 3) + "s";
    board.appendChild(t);

    seats.forEach(function (x) {
      var isWin = !voided && x.diff_ms != null && x.diff_ms === best;
      var row = document.createElement("div");
      row.className = "trow" + (isWin ? " win" : "") + (x.name === myName() ? " me" : "");
      row.innerHTML = '<span class="tn"></span><span class="td"></span><span class="tt"></span>';
      el(".tn", row).textContent = (isWin ? "🏆 " : "") + x.name;
      el(".tt", row).textContent = x.stop_ms == null ? "—" : TDClock.secs(x.stop_ms, 3) + "s";
      el(".td", row).textContent = x.diff_ms == null ? "no time" : TDClock.diffLabel(x.diff_ms);
      board.appendChild(row);
    });

    resultActions(r);
    show("result");
    refreshCoins();
  }

  /* What the two buttons mean depends on what the room has done since. */
  function resultActions(r) {
    var isHost = (r.host === myName());
    var seated = !!mySeat(r);
    var again = $("againBtn"), note = $("resultNote");

    if (r.status === "aborted") {
      again.style.display = "none";
      $("resultMenuBtn").textContent = "Back to menu";
      note.textContent = "The host closed the room. Your entry fee was refunded.";
      return;
    }

    if (r.status === "lobby") {
      // A new round is open. Don't move the player — offer them the seat.
      note.textContent = seated
        ? "You're in the next round. Waiting for " + r.host + " to start…"
        : r.host + " opened another round.";
      again.style.display = seated ? "none" : "block";
      again.textContent = "🎟 Take your seat (" + r.entry + " 🪙)";
      again.setAttribute("data-act", "join");
      $("resultMenuBtn").textContent = "Leave room";
      return;
    }

    again.style.display = isHost ? "block" : "none";
    again.textContent = "↻ Rematch (" + r.entry + " 🪙 each)";
    again.setAttribute("data-act", "rematch");
    note.textContent = isHost
      ? "A rematch costs every player another " + r.entry + " 🪙."
      : "Waiting to see if " + r.host + " starts another round…";
    $("resultMenuBtn").textContent = "Leave room";
  }

  $("againBtn").addEventListener("click", async function () {
    if (S.busy) return;
    if (S.inPractice) { openPractice(); return; }
    var act = $("againBtn").getAttribute("data-act");
    S.busy = true; TDSound.click();
    $("againBtn").setAttribute("disabled", "");
    var r = (act === "join") ? await TDDB.joinRoom(S.code) : await TDDB.rematch(S.code);
    S.busy = false;
    $("againBtn").removeAttribute("disabled");

    if (!r.ok) {
      TDSound.error();
      if (r.error === "broke") {
        // Name the shortfall plainly instead of a generic failure.
        var need = r.need != null ? r.need : (S.room ? S.room.entry : 0);
        var have = r.coins != null ? r.coins : S.coins;
        $("resultNote").textContent =
          "You don't have enough coins to play again — this round costs " +
          need + " \ud83e\ude99 and you have " + (have == null ? "fewer" : have) + ".";
        toast("Not enough coins for another round");
      } else {
        $("resultNote").textContent = rpcError(r);
      }
      refreshCoins();
      return;
    }
    S.resultKey = null;
    S.armedKey = null;
    TDNet.shout();
    onRoom(r, true);
    refreshCoins();
  });

  $("resultMenuBtn").addEventListener("click", function () {
    if (S.inPractice) { TDSound.click(); show("menu"); refreshCoins(); return; }
    leaveRoom();                      // plays its own click
  });

  /* ============================================================= practice */

  var PRESETS = [500, 1000, 2500, 4200, 6800, 8000];

  function openPractice() {
    if (needAccount()) return;
    S.inPractice = true;
    renderPractice();
    show("practice");
  }

  function renderPractice() {
    $("pracVal").textContent = TDClock.secs(S.practice.targetMs, 2);
    $("pracSlider").value = S.practice.targetMs;
    var box = $("pracPresets");
    box.innerHTML = "";
    PRESETS.forEach(function (ms) {
      var b = document.createElement("button");
      b.textContent = TDClock.secs(ms, 1) + "s";
      b.className = (ms === S.practice.targetMs ? "sel" : "");
      b.addEventListener("click", function () {
        TDSound.click(); S.practice.targetMs = ms; renderPractice();
      });
      box.appendChild(b);
    });
    $("pracBlindBadge").textContent = S.practice.blind ? "on" : "off";
    $("pracBlindCard").classList.toggle("sel", S.practice.blind);
  }

  $("pracSlider").addEventListener("input", function () {
    S.practice.targetMs = Math.round(+this.value / 10) * 10;
    $("pracVal").textContent = TDClock.secs(S.practice.targetMs, 2);
    els("#pracPresets button").forEach(function (b) { b.classList.remove("sel"); });
  });

  $("pracBlindCard").addEventListener("click", function () {
    TDSound.click();
    S.practice.blind = !S.practice.blind;
    renderPractice();
  });

  $("pracStart").addEventListener("click", async function () {
    if (needAccount() || S.busy) return;
    S.busy = true; TDSound.click();
    $("pracStart").setAttribute("disabled", "");
    var armed = await TDDB.practiceArm(S.practice.targetMs);
    S.busy = false;
    $("pracStart").removeAttribute("disabled");
    if (!armed.ok) { TDSound.error(); toast(rpcError(armed)); return; }

    S.inPractice = true;
    S.myStop = null;
    // Count down to the instant the SERVER armed, so the elapsed time it
    // checks the answer against is the same clock the player played on.
    var until = Date.parse(armed.starts_at) - TDDB.serverNow();
    if (!isFinite(until) || until < 500 || until > 6000) until = 3000;

    beginRound({
      targetMs: S.practice.targetMs,
      blind: S.practice.blind,
      msUntilStart: until,
      onStop: practiceResult
    });
  });

  async function practiceResult(ms) {
    var target = S.practice.targetMs;
    var d = Math.abs(Math.round(ms) - target);
    $("roundHint").textContent = "Scoring\u2026";

    var r = await TDDB.practice(ms);
    S.resultKey = "practice#" + Date.now();

    var crown = $("resultCrown"), nameEl = $("winnerName"), subEl = $("winnerSub");
    if (d === 0)        { crown.textContent = "\ud83c\udfaf"; nameEl.className = "winner dot"; nameEl.textContent = "DOT! PERFECT"; TDSound.dot(); }
    else if (d <= 50)   { crown.textContent = "\ud83d\udd25"; nameEl.className = "winner";     nameEl.textContent = "So close!";     TDSound.win(); }
    else if (d <= 200)  { crown.textContent = "\ud83d\udc4d"; nameEl.className = "winner";     nameEl.textContent = "Nice one";      TDSound.stop(); }
    else                { crown.textContent = "\u23f1\ufe0f"; nameEl.className = "winner void"; nameEl.textContent = "Keep practising"; TDSound.stop(); }

    if (r && r.ok) {
      subEl.className = "winner-sub" + (r.reward > 0 ? "" : " neg");
      subEl.textContent = r.reward > 0
        ? "+" + r.reward + " \ud83e\ude99" + (r.capped ? "  (daily practice cap reached)" : "")
        : "No reward this time";
      setCoins(r.coins);
    } else {
      subEl.className = "winner-sub neg";
      subEl.textContent = (r && r.error === "no_db") ? "Not scored \u2014 database not set up."
        : (r && (r.error === "not_armed" || r.error === "impossible"))
          ? "Not scored \u2014 that round wasn't timed by the server."
          : "Not scored \u2014 you're offline.";
      if (r && r.error === "no_db") showNoDb();
    }

    var board = $("timesBoard");
    board.innerHTML = "";
    [["TARGET", TDClock.secs(target, 3) + "s", "var(--gold)"],
     ["YOUR TIME", TDClock.secs(ms, 3) + "s", "var(--cyan)"],
     ["DIFFERENCE", TDClock.diffLabel(d), d === 0 ? "var(--green)" : "var(--ink)"]
    ].forEach(function (row) {
      var el2 = document.createElement("div");
      el2.className = "trow";
      el2.innerHTML = '<span class="tn" style="color:var(--dim);font-size:15px;letter-spacing:.14em"></span>' +
                      '<span class="tt"></span>';
      el(".tn", el2).textContent = row[0];
      var tt = el(".tt", el2);
      tt.textContent = row[1];
      tt.style.color = row[2];
      board.appendChild(el2);
    });

    $("resultNote").textContent = "";
    $("againBtn").style.display = "block";
    $("againBtn").textContent = "\u21bb Practise again";
    $("againBtn").setAttribute("data-act", "practice");
    $("resultMenuBtn").textContent = "Back to menu";
    show("result");
  }

  /* ============================================================== profile */

  async function openProfile() {
    if (needAccount()) return;
    show("profile");
    $("profName").textContent = myName() || "—";
    $("profJoined").textContent = "loading…";
    ["pCoins", "pPlayed", "pWon", "pDots", "pBest"].forEach(function (id) {
      $(id).textContent = "—";
    });
    $("profHistory").innerHTML = '<div class="spin"></div>';

    var r = await TDDB.profile();
    if (!r || !r.ok) {
      $("profJoined").textContent = "";
      $("profHistory").innerHTML = '<div class="sub">' + rpcError(r || {}) + "</div>";
      return;
    }
    setCoins(r.coins);
    $("profName").textContent = r.name;          // the real account name, never a placeholder
    $("profJoined").textContent = r.joined
      ? "Joined " + new Date(r.joined).toLocaleDateString(undefined,
          { year: "numeric", month: "short", day: "numeric" })
      : "";
    $("pCoins").textContent  = r.coins;
    $("pPlayed").textContent = r.played;
    $("pWon").textContent    = r.won;
    $("pDots").textContent   = r.dots;
    $("pBest").textContent   = (r.best_diff_ms == null) ? "—"
      : (r.best_diff_ms === 0 ? "DOT" : "±" + TDClock.secs(r.best_diff_ms, 3));

    var h = await TDDB.history(15);
    var box = $("profHistory");
    box.innerHTML = "";
    if (!h || !h.ok || !h.rows || !h.rows.length) {
      box.innerHTML = '<div class="sub">No rounds yet — go and win one.</div>';
      return;
    }
    h.rows.forEach(function (row) {
      var d = document.createElement("div");
      d.className = "row" + (row.won ? " win" : "");
      var label = row.mode === "practice" ? "🎯 Practice"
        : (row.mode === "blind" ? "🙈 Blind" : "🎯 Classic") +
          (row.players > 2 ? " ×" + row.players : "");
      d.innerHTML = '<span class="nm">' + label + "</span>" +
        (row.diff_ms === 0 ? '<span class="dotpill">DOT</span>' : "") +
        '<span class="rt">' + (row.diff_ms == null ? "—" : "±" + TDClock.secs(row.diff_ms, 3)) +
        "  " + (row.delta >= 0 ? "+" : "") + row.delta + " 🪙</span>";
      box.appendChild(d);
    });
  }

  /* ============================================================= settings */

  $("settingsBtn").addEventListener("click", function () {
    TDSound.click();
    els("[data-set]").forEach(function (sw) {
      sw.classList.toggle("on", !!TDSound.get(sw.getAttribute("data-set")));
    });
    $("settingsOv").classList.add("on");
  });
  $("closeSettings").addEventListener("click", function () {
    TDSound.click(); $("settingsOv").classList.remove("on");
  });
  $("settingsOv").addEventListener("click", function (e) {
    if (e.target === $("settingsOv")) $("settingsOv").classList.remove("on");
  });
  els("[data-set]").forEach(function (sw) {
    sw.addEventListener("click", function () {
      var k = sw.getAttribute("data-set");
      var next = !TDSound.get(k);
      TDSound.set(k, next);
      sw.classList.toggle("on", next);
      sw.setAttribute("aria-checked", next ? "true" : "false");
      TDSound.click();
    });
  });

  /* ------------------------------------------------------------ keyboard
   * The mode cards, the arena list, the practice Blind toggle and all three
   * settings switches are <div>s with click handlers. That made the entire
   * chooser, the whole arena list and every setting unreachable without a
   * mouse or a finger. Promote them to real controls and let Enter/Space
   * activate them, the way a <button> does. */
  function makeFocusable(node, roleName) {
    if (!node || node.dataset.kb) return;
    node.dataset.kb = "1";
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", roleName || "button");
    node.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.code !== "Space") return;
      e.preventDefault();
      node.click();
    });
  }

  function wireKeyboard() {
    els(".card").forEach(function (c) { makeFocusable(c); });
    els("[data-set]").forEach(function (sw) {
      makeFocusable(sw, "switch");
      sw.setAttribute("aria-checked", TDSound.get(sw.getAttribute("data-set")) ? "true" : "false");
      sw.setAttribute("aria-label", (sw.parentNode.textContent || "").trim());
    });
  }

  /* ========================================================= home & exit */

  // Home returns to the arcade. It does NOT log the player out and it does
  // NOT close the app — it is a link, and the account survives it.
  $("homeBtn").addEventListener("click", async function () {
    TDSound.click();
    var code = S.code;
    var inLobby = S.room && S.room.status === "lobby";
    TDNet.close();
    if (code && inLobby) {
      // Give the seat back so the entry fee isn't parked for 30 minutes.
      try { await Promise.race([TDDB.leaveRoom(code), new Promise(function (r) { setTimeout(r, 900); })]); } catch (e) {}
    }
    location.href = "../";
  });

  $("backBtn").addEventListener("click", function () { TDSound.click(); back(); });

  /* The arcade's shared announcement bar (announce.js) is bottom-fixed at
   * z-index 99999. Every other game puts its home button top-left, so nothing
   * collided before; this game was asked for bottom corners, and the bar sat
   * squarely on top of BOTH Home and Back, making them untappable until it was
   * dismissed. The bar carries no id or class, so it is found by its role and
   * its fixed positioning, and the buttons step up out of its way. */
  function dodgeAnnouncement() {
    var lift = 0;
    els('div[role="status"]').forEach(function (n) {
      try {
        if (getComputedStyle(n).position !== "fixed") return;
        var h = n.getBoundingClientRect().height;
        if (h > 0) lift = Math.max(lift, h + 16);
      } catch (e) {}
    });
    document.documentElement.style.setProperty("--lift", lift + "px");
  }

  try {
    new MutationObserver(dodgeAnnouncement).observe(document.body, { childList: true });
    window.addEventListener("resize", dodgeAnnouncement);
    setTimeout(dodgeAnnouncement, 1500);   // announce.js renders after we boot
  } catch (e) {}

  /* A closed tab must not strand an entry fee in a lobby. fetch(keepalive)
   * survives the page going away, and td_leave only ever refunds a seat that
   * is still in the lobby — it can never abandon a round in progress. */
  function leaveBeacon() {
    if (!S.code || !S.room || S.room.status !== "lobby") return;
    var p = player(); if (!p) return;
    try {
      fetch(window.SUPABASE_URL + "/rest/v1/rpc/td_leave", {
        method: "POST", keepalive: true,
        headers: { "apikey": window.SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_name: p.name, p_password: p.pw, p_code: S.code })
      });
    } catch (e) {}
  }
  window.addEventListener("pagehide", leaveBeacon);
  window.addEventListener("beforeunload", leaveBeacon);

  /* A phone that sleeps mid-round comes back with a stale screen; catch up
   * the instant it wakes rather than waiting for the next poll. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && S.code) TDNet.refreshNow();
  });

  /* ================================================================= boot */

  function boot() {
    renderSizes();
    renderPractice();
    wireKeyboard();
    TDSound.startMusic();
    $("coinVal").textContent = "—";

    // Wait for auth.js to finish. It assigns the player only after fetching
    // the Supabase SDK from a CDN, so asking at DOMContentLoaded reports NO
    // ONE even for a player who is signed in — and the first thing they tap
    // gets them a "Log in to play" prompt they don't need.
    if (window.IGAuth && IGAuth.onReady) {
      IGAuth.onReady(function () {
        authReady = true;
        if (player()) {
          refreshCoins().then(function () { renderArenas(); });
          TDDB.sweep();
          resumeRoom();
        }
        else banner("Sign in with the 👤 button to play Time Duel.");
      });
    } else {
      // auth.js never loaded at all (blocked CDN, offline). Say so, rather
      // than pretending this is a login problem.
      setTimeout(function () {
        if (!window.IGAuth) {
          authReady = true;
          banner("Can't reach the accounts server — check your connection and reload.");
        }
      }, 6000);
    }

    if (window.IGAuth && IGAuth.onChange) {
      IGAuth.onChange(function (p) {
        if (p) { banner(""); refreshCoins().then(function () { renderArenas(); }); }
        else { $("coinVal").textContent = "—"; S.coins = null; }
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
