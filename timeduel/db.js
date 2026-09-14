/* Time Duel — everything that talks to Supabase.
 *
 * Only two things in this file matter for fairness:
 *   1. no coin amount is ever sent from here. The client says "I stopped at
 *      6.428"; the database decides what that is worth.
 *   2. every call that moves a coin carries the account password, because
 *      that is the only identity this arcade has (there is no Supabase Auth
 *      session — see accounts-setup.sql).
 */
window.TDDB = (function () {
  "use strict";

  var sb = null;
  var sdkTried = false;
  var installed = null;          // null = unknown, false = SQL not run yet, true = ready
  var clockOffset = 0;           // serverNow - clientNow, in ms
  var clockSeen = false;
  var bestRtt = Infinity;       // half of this bounds our clock error
  var bestAt = 0;               // when that best sample was taken

  /* ---------------------------------------------------------------- setup */

  function loadSDK() {
    return new Promise(function (res) {
      if (window.supabase && window.supabase.createClient) return res(true);
      // auth.js pulls the same script; if it is already in flight, wait it out
      // rather than racing a second copy of the SDK into the page.
      var have = document.querySelector('script[src*="supabase-js"]');
      if (have) {
        have.addEventListener("load", function () { res(true); });
        have.addEventListener("error", function () { res(false); });
        return;
      }
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = function () { res(true); };
      s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
  }

  async function client() {
    if (sb) return sb;
    if (!window.SUPABASE_URL || !window.SUPABASE_KEY) return null;
    if (!sdkTried) { sdkTried = true; await loadSDK(); }
    if (!(window.supabase && window.supabase.createClient)) return null;
    sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
      auth: { persistSession: false },
      // The round is short and chatty; the default 10/s throttles a full
      // 8-player table's "I stopped" messages into a visible lag.
      realtime: { params: { eventsPerSecond: 30 } }
    });
    return sb;
  }

  /* ------------------------------------------------------------ identity */

  function me() {
    var p = window.IGAuth && IGAuth.getUser ? IGAuth.getUser() : null;
    return (p && p.name && p.pw) ? p : null;
  }

  /* ------------------------------------------------------------ rpc core */

  // A missing function means timeduel-setup.sql has not been run. That is a
  // setup problem, not a network problem, and the player deserves to be told
  // the difference instead of watching a spinner.
  function isMissingFn(err) {
    var m = ((err && (err.message || err.hint || err.code)) || "") + "";
    return /PGRST202|PGRST205|Could not find the function|schema cache/i.test(m);
  }

  function isNetwork(err) {
    var m = ((err && err.message) || "") + "";
    return /load failed|failed to fetch|networkerror|aborted|timeout/i.test(m);
  }

  /* Call an RPC with retries. Retries are for the network only — a call that
   * came back with a real answer (even "you're broke") is never repeated,
   * because repeating td_join would buy a second seat. */
  async function rpc(fn, args, opts) {
    opts = opts || {};
    var tries = opts.tries || 3;
    var c = await client();
    if (!c) return { ok: false, error: "offline" };

    var lastErr = null;
    for (var i = 0; i < tries; i++) {
      var t0 = Date.now();
      var ctl = null, killer = 0;
      try {
        // supabase-js has no default timeout, so a captive portal or a
        // half-open socket leaves the promise unsettled forever — which left
        // Create/Join/Start disabled and S.busy stuck with no message.
        ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
        killer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} },
                                  opts.timeout || 12000) : 0;
        var q = c.rpc(fn, args || {});
        if (ctl && q.abortSignal) q = q.abortSignal(ctl.signal);
        var res = await q;
        clearTimeout(killer);
        if (res.error) {
          if (isMissingFn(res.error)) { installed = false; return { ok: false, error: "no_db" }; }
          lastErr = res.error;
          if (!isNetwork(res.error)) break;      // a real error: don't hammer it
        } else {
          installed = true;
          noteClock(res.data, t0, Date.now());
          return normalise(res.data);
        }
      } catch (e) {
        clearTimeout(killer);      // a throw skipped this, leaking a 12s timer
        lastErr = e;
        if (isMissingFn(e)) { installed = false; return { ok: false, error: "no_db" }; }
      }
      if (i < tries - 1) await sleep(280 * (i + 1));
    }
    return { ok: false, error: isNetwork(lastErr) ? "offline" : "failed",
             detail: (lastErr && lastErr.message) || "" };
  }

  function normalise(data) {
    if (data && typeof data === "object") return data;
    return { ok: true, value: data };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ------------------------------------------------------------ the clock
   * Rooms are scheduled against the SERVER's clock ("the timer starts at
   * 12:00:03.000"), because phone clocks are routinely seconds out. Every
   * reply carries the server's now(); we pin our own clock to it using the
   * midpoint of the request, which is the same trick NTP uses.
   * This only drives the 3-2-1 countdown — the score itself is measured
   * locally, so being a little off cannot cost anybody the round. */
  function noteClock(data, t0, t1) {
    if (!data || !data.now) return;
    var server = Date.parse(data.now);
    if (!server) return;
    var rtt = t1 - t0;
    var offset = server - (t0 + rtt / 2);

    // Keep the sample with the TIGHTEST round-trip, because the error in an
    // NTP-style offset is bounded by half the round-trip and nothing else.
    //
    // The old rule ("first sample, or any under 900ms") was backwards twice
    // over: the first RPC of the page is a cold TLS handshake against a cold
    // PostgREST worker, so it is systematically the SLOWEST sample of the
    // session — and once it was pinned, a phone whose round-trips sit above
    // 900ms could never replace it. A 2.5s cold start left the countdown up
    // to 1.25s out, which at the extreme starts the round with no visible
    // 3-2-1 at all, and can get an honest answer refused as impossible.
    if (!clockSeen || rtt <= bestRtt || (Date.now() - bestAt) > 60000) {
      clockOffset = offset; clockSeen = true; bestRtt = rtt; bestAt = Date.now();
    }
  }

  function serverNow() { return Date.now() + clockOffset; }

  /* ------------------------------------------------------------- the API */

  async function profile() {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_me", { p_name: p.name, p_password: p.pw });
  }

  async function history(limit) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_history_for", { p_name: p.name, p_password: p.pw, p_limit: limit || 20 });
  }

  async function createRoom(mode, arena, capacity) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_create", {
      p_name: p.name, p_password: p.pw,
      p_mode: mode, p_arena: arena, p_capacity: capacity
    }, { tries: 1 });                         // buying a seat is never retried
  }

  async function joinRoom(code) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_join", { p_name: p.name, p_password: p.pw, p_code: code }, { tries: 1 });
  }

  async function leaveRoom(code) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_leave", { p_name: p.name, p_password: p.pw, p_code: code }, { tries: 2 });
  }

  async function startRound(code) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_start", { p_name: p.name, p_password: p.pw, p_code: code }, { tries: 2 });
  }

  /* The one call that must not be lost. If the answer never lands the player
   * forfeits a round they may well have won, so this one keeps trying for as
   * long as the round could still be open. td_stop ignores a second answer,
   * so retrying is safe. */
  async function stopRound(code, stopMs, roundNo) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    var deadline = Date.now() + 14000;
    var wait = 200, out = null;
    while (Date.now() < deadline) {
      out = await rpc("td_stop", {
        p_name: p.name, p_password: p.pw, p_code: code,
        p_stop_ms: Math.round(stopMs),
        // Pin the answer to its own round, so a retry that finally lands
        // after a rematch cannot be scored against the NEW round.
        p_round: (roundNo == null ? null : roundNo)
      }, { tries: 1 });
      // Terminal answers. not_playing/no_room matter as much as the rest:
      // the round is over, so retrying for another 14 seconds just spams the
      // database and leaves "Sending your time..." on screen underneath a
      // result the poll loop has already drawn.
      if (out.ok || out.error === "no_db" || out.error === "auth" ||
          out.error === "bad_time" || out.error === "impossible" ||
          out.error === "not_seated" || out.error === "not_playing" ||
          out.error === "no_room" || out.error === "stale_round") return out;
      await sleep(wait);
      wait = Math.min(wait * 1.6, 1800);
    }
    return out || { ok: false, error: "offline" };
  }

  // td_tick and td_state now need an account: the room's target and every
  // rival's time used to be readable by anyone who guessed a 4-letter code.
  // Hand back the entry fees of rooms nobody came back to. Fired once at
  // boot; cheap, and it is the only thing that unsticks a stake left behind
  // by a browser that was closed mid-lobby.
  function sweep() {
    var p = me(); if (!p) return;
    rpc("td_sweep", { p_name: p.name, p_password: p.pw }, { tries: 1 })
      .catch(function () {});
  }

  async function tick(code) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_tick", { p_name: p.name, p_password: p.pw, p_code: code }, { tries: 2 });
  }
  async function state(code) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_state", { p_name: p.name, p_password: p.pw, p_code: code }, { tries: 2 });
  }
  async function rematch(code) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_rematch", { p_name: p.name, p_password: p.pw, p_code: code }, { tries: 1 });
  }

  // The server records the target and the start instant up front, so the
  // reward is scored against something IT remembers. Previously the client
  // sent both numbers, and td_practice(300, 300) on a loop printed coins.
  async function practiceArm(targetMs) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    return rpc("td_practice_arm", {
      p_name: p.name, p_password: p.pw, p_target_ms: Math.round(targetMs)
    }, { tries: 2 });
  }

  async function practice(stopMs) {
    var p = me(); if (!p) return { ok: false, error: "auth" };
    // tries:1 — td_practice is not idempotent, and a retry of a request that
    // actually committed would pay the reward twice.
    return rpc("td_practice", {
      p_name: p.name, p_password: p.pw, p_stop_ms: Math.round(stopMs)
    }, { tries: 1 });
  }

  return {
    client: client, me: me, rpc: rpc,
    profile: profile, history: history,
    createRoom: createRoom, joinRoom: joinRoom, leaveRoom: leaveRoom,
    startRound: startRound, stopRound: stopRound, rematch: rematch,
    tick: tick, state: state, practice: practice, practiceArm: practiceArm, sweep: sweep,
    serverNow: serverNow,
    isInstalled: function () { return installed; }
  };
})();
