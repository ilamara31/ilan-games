/* Time Duel — room sync.
 *
 * The design rule here, learned from the other online games in this arcade:
 * a realtime message is an ACCELERATOR, never a source of truth. Every
 * client polls td_tick on a timer, and td_tick is also what settles a
 * finished round. So if the websocket dies, or a broadcast is dropped, or a
 * phone sleeps through the whole round, the game still converges to the same
 * state within a second or two instead of soft-locking on "waiting…".
 *
 * The second rule, learned the same way: every async result must prove which
 * SESSION it belongs to before it is allowed to touch the UI. A boolean is
 * not enough — close() then open() flips it back to true and a reply from the
 * old room sails straight through. Hence `gen`.
 */
window.TDNet = (function () {
  "use strict";

  var ch = null;          // the supabase channel
  var code = null;
  var onState = null;
  var pollTimer = null;
  var pokeTimer = null;
  var watchTimer = null;
  var busy = false;
  var pendingPoke = false;
  var last = null;        // last room snapshot we handed out
  var subscribed = false;
  var failures = 0;
  var gen = 0;            // bumped by every open()/close(); stale work is dropped
  var lastReopen = 0;
  var attachAt = 0;       // when the current channel started joining

  var MIN_GAP = 700;      // never read faster than this, poke or no poke
  var lastRead = 0;

  async function open(roomCode, cb) {
    close();
    var myGen = ++gen;
    code = roomCode; onState = cb; failures = 0; pendingPoke = false;
    lastReopen = 0; attachAt = Date.now();

    var sb = await TDDB.client();
    // We may have been closed (player hit Leave) while the SDK was loading.
    // Without this check we would subscribe a channel nobody will ever close
    // and announce the player as present in a room they already left.
    if (myGen !== gen) return false;

    if (sb) attach(sb, myGen);
    schedule(0);
    return true;
  }

  function attach(sb, myGen) {
    try {
      ch = sb.channel("td-" + code, {
        config: { broadcast: { self: false }, presence: { key: (TDDB.me() || {}).name || "?" } }
      });
      // One event type, one meaning: "something changed, go look". Carrying
      // game state in the message itself is how these go out of sync.
      ch.on("broadcast", { event: "poke" }, function () { poke(myGen); });
      ch.on("presence", { event: "sync" }, function () { poke(myGen); });
      ch.on("presence", { event: "join" }, function () { poke(myGen); });
      ch.on("presence", { event: "leave" }, function () { poke(myGen); });
      ch.subscribe(function (status) {
        if (myGen !== gen) return;
        subscribed = (status === "SUBSCRIBED");
        if (subscribed) {
          var p = TDDB.me();
          try { ch.track({ name: p ? p.name : "?", at: Date.now() }); } catch (e) {}
        }
      });
    } catch (e) { ch = null; }

    // Supabase channels drop under load and do NOT reliably rejoin themselves.
    // Polling means the game still works, but this client would silently stop
    // accelerating everyone else for the rest of the session. Watch the socket
    // and rebuild it rather than letting it rot.
    attachAt = Date.now();
    clearInterval(watchTimer);
    watchTimer = setInterval(function () {
      if (myGen !== gen || !ch) return;
      var st = "";
      try { st = ch.state; } catch (e) {}

      // A channel that is still joining is not a broken channel. The earlier
      // version treated "not yet subscribed" exactly like "errored", so on a
      // cold mobile websocket — where the phoenix join routinely takes more
      // than 3s — it killed the join in flight, restarted it, and killed that
      // one too, forever. Those clients never got realtime at all, silently,
      // because polling covered for it.
      var dead = (st === "closed" || st === "errored");
      var stuck = !subscribed && (Date.now() - attachAt > 10000);
      if ((dead || stuck) && Date.now() - lastReopen > 8000) {
        lastReopen = Date.now();
        reopen(myGen);
      }
    }, 3000);
  }

  async function reopen(myGen) {
    var sb = await TDDB.client();
    if (myGen !== gen || !sb) return;
    dropChannel(sb);
    subscribed = false;
    attach(sb, myGen);
  }

  // Take a LOCAL reference before nulling the module variable. The old code
  // nulled `ch` on the next line, so the async callback always ran
  // removeChannel(null) — an unhandled rejection, and the channel was never
  // actually removed from the client's registry.
  function dropChannel(sb) {
    var old = ch;
    ch = null;
    if (!old) return;
    try { old.unsubscribe(); } catch (e) {}
    try { sb.removeChannel(old); } catch (e) {}
  }

  // Tell the others to re-read. Cheap, carries nothing, safe to drop.
  function shout() {
    if (!ch || !subscribed) return;
    try { ch.send({ type: "broadcast", event: "poke", payload: {} }); } catch (e) {}
  }

  // A poke can arrive 8 times at once on a full table; collapse the burst.
  function poke(myGen) {
    if (myGen != null && myGen !== gen) return;
    if (pokeTimer) return;
    pokeTimer = setTimeout(function () {
      pokeTimer = null;
      // A poke that lands mid-read used to be thrown away, and the next read
      // pushed out by a full interval. Remember it and read straight after.
      if (busy) { pendingPoke = true; return; }
      schedule(0);
    }, 120);
  }

  function pollDelay() {
    // Back off hard while the network is failing: a disconnected client used
    // to sit on its last known status ("playing") and hammer every second.
    if (failures > 0) return Math.min(1200 * Math.pow(1.8, failures - 1), 15000);
    if (!last) return 1200;
    if (last.status === "playing") return 1000;   // settle needs to be found fast
    if (last.status === "lobby") return 2000;
    return 3000;                                  // done / aborted: nearly idle
  }

  function schedule(ms) {
    clearTimeout(pollTimer);
    if (!code) return;
    var want = (ms == null) ? pollDelay() : ms;
    // Floor every read, however many pokes arrive, so a flapping peer cannot
    // turn 8 clients into 60+ row-lock acquisitions a second on one room.
    var since = Date.now() - lastRead;
    if (since < MIN_GAP) want = Math.max(want, MIN_GAP - since);
    pollTimer = setTimeout(refresh, want);
  }

  async function refresh() {
    var myGen = gen;
    if (!code || busy) { schedule(); return; }
    busy = true; lastRead = Date.now();
    try {
      // td_tick both reads AND closes a finished round, so a round still ends
      // when the only player left is the one who lost their connection.
      var r = await TDDB.tick(code);
      if (myGen !== gen) return;               // this answer belongs to a room we left
      if (r && r.ok) {
        failures = 0;
        var changed = !last || sig(r) !== sig(last);
        last = r;
        if (onState) { try { onState(r, changed); } catch (e) {} }
      } else if (r && r.error === "no_room") {
        if (onState) { try { onState(r, true); } catch (e) {} }
      } else {
        failures++;
        if (onState) { try { onState({ ok: false, error: r ? r.error : "failed", failures: failures }, false); } catch (e) {} }
      }
    } catch (e) {
      if (myGen !== gen) return;
      failures++;
      // A thrown error used to skip onState entirely, so the "Reconnecting…"
      // banner never appeared for the most total kind of failure.
      if (onState) { try { onState({ ok: false, error: "failed", failures: failures }, false); } catch (e2) {} }
    } finally {
      if (myGen === gen) {
        busy = false;
        if (pendingPoke) { pendingPoke = false; schedule(0); }
        else schedule();
      }
    }
  }

  // What counts as "a change worth redrawing": everything a player can see.
  function sig(r) {
    return [r.status, r.round, r.pot, r.winner, r.target_ms, r.started_at,
            (r.seats || []).map(function (s) {
              return s.name + ":" + (s.stop_ms == null ? "-" : s.stop_ms);
            }).join(",")].join("|");
  }

  function presentNames() {
    if (!ch || !subscribed) return null;       // null = "we don't know", not "nobody"
    try {
      var st = ch.presenceState(), out = [];
      for (var k in st) (st[k] || []).forEach(function (m) { if (m && m.name) out.push(m.name); });
      return out;
    } catch (e) { return null; }
  }

  function close() {
    gen++;                                   // everything in flight is now stale
    subscribed = false;
    clearTimeout(pollTimer); pollTimer = null;
    clearTimeout(pokeTimer); pokeTimer = null;
    clearInterval(watchTimer); watchTimer = null;
    if (ch) {
      var old = ch; ch = null;
      try { old.unsubscribe(); } catch (e) {}
      TDDB.client().then(function (sb) {
        try { sb && sb.removeChannel(old); } catch (e) {}
      }).catch(function () {});
    }
    last = null; onState = null; code = null; busy = false; pendingPoke = false;
  }

  return {
    open: open, close: close, shout: shout,
    poke: function () { poke(null); },
    refreshNow: function () { schedule(0); },
    presentNames: presentNames,
    isLive: function () { return subscribed; },
    room: function () { return last; }
  };
})();
