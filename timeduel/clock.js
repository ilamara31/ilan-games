/* Time Duel — the round clock.
 *
 * Three decisions live in here, and they are the whole game:
 *
 * 1. EVERY PLAYER TIMES THEMSELVES. The score is measured from the frame in
 *    which START appears on YOUR screen to the moment YOUR finger lands —
 *    entirely on your device, never across the network. A player on hotel
 *    wifi and a player on fibre are therefore scored identically. Latency
 *    decides when you see the countdown; it cannot decide who wins.
 *
 * 2. THE START IS THE PAINTED FRAME, not the scheduled instant. We line the
 *    countdown up against the server's clock, but the stopwatch starts on
 *    the requestAnimationFrame timestamp of the frame that actually shows
 *    START, because that is the thing a human reacts to. A phone that paints
 *    30ms late simply has its whole window shifted 30ms; it is not penalised.
 *
 * 3. THE TAP TIME COMES FROM THE EVENT, not from when JavaScript got round
 *    to running. event.timeStamp is recorded by the browser at the hardware
 *    event, so it survives a busy main thread — which is worth 10-40ms of
 *    accuracy on a mid-range phone, and this game is scored in milliseconds.
 */
window.TDClock = (function () {
  "use strict";

  var MAX_MS = 20000;

  function now() { return performance.now(); }

  /* The truest timestamp we can get for an input. Browsers give trusted
   * events a timeStamp on performance.now()'s timeline; a few old ones still
   * hand back epoch milliseconds, which is a ~1.7e12 mismatch and trivial to
   * spot. Anything odd falls back to "right now", which is merely less
   * accurate, never wrong. */
  function eventTime(e) {
    var ts = (e && typeof e.timeStamp === "number") ? e.timeStamp : NaN;
    var p = now();
    if (isFinite(ts) && ts > 0 && Math.abs(ts - p) < 2000) return ts;
    return p;
  }

  function Round(opts) {
    this.targetMs = opts.targetMs;
    this.blind = !!opts.blind;
    this.onCount = opts.onCount || function () {};   // 3, 2, 1, "GO"
    this.onFrame = opts.onFrame || function () {};   // live elapsed, classic only
    this.onStart = opts.onStart || function () {};
    this.onExpire = opts.onExpire || function () {}; // took far too long
    this.t0 = null;          // performance.now() of the painted START frame
    this.stopped = false;
    this.armed = false;
    this.raf = 0;
    this.lastCount = null;
    this.expireAt = null;
  }

  /* msUntilStart: how long from right now until the timer should start.
   * The caller works this out from the server clock, so every device counts
   * down to the same real-world instant. */
  Round.prototype.arm = function (msUntilStart) {
    var self = this;
    this.armed = true;
    this.stopped = false;
    this.t0 = null;
    // msUntilStart may be NEGATIVE: this device joined, woke or loaded after
    // the round already began. We keep the real (past) instant rather than
    // clamping to zero — see the anchor choice below.
    var startAt = now() + msUntilStart;
    this.lateBy = Math.max(0, -msUntilStart);

    function frame(ts) {
      if (!self.armed) return;
      self._frame = frame;

      if (self.t0 === null) {
        if (ts >= startAt) {
          // Normally the stopwatch starts on the frame the player SEES, which
          // is the fairest reference for a human reaction.
          //
          // Only a genuine LATE JOIN anchors to the scheduled instant instead.
          // The test is lateBy — how late this device was handed the round —
          // NOT how late this frame landed. Those are different things, and
          // using frame lateness meant an ordinary 130ms main-thread stall on
          // a mid-range phone was misread as a late join and silently started
          // that player 130ms into the round. Connection and CPU quality must
          // not touch the score; that is the whole promise of this file.
          self.t0 = (self.lateBy > 250) ? startAt : ts;
          // Measured from t0, not from this frame: a late-anchored round
          // must not also get a longer deadline than everybody else.
          self.expireAt = self.t0 + Math.min(MAX_MS, self.targetMs + 12000);
          self.onCount("GO");
          self.onStart();
        } else {
          var left = startAt - ts;
          var n = Math.ceil(left / 1000);
          if (n !== self.lastCount) { self.lastCount = n; self.onCount(n); }
        }
      } else if (!self.stopped) {
        var elapsed = ts - self.t0;
        if (!self.blind) self.onFrame(elapsed);
        if (ts >= self.expireAt) { self.armed = false; self.onExpire(); return; }
      }
      self.raf = requestAnimationFrame(frame);
    }
    this._frame = frame;
    this.raf = requestAnimationFrame(frame);
  };

  /* Returns the elapsed milliseconds, or null if the round wasn't running.
   * Taps during the 3-2-1 return null: they are ignored, not scored, so a
   * player mashing through the countdown gains nothing. */
  Round.prototype.stop = function (e) {
    if (!this.armed || this.t0 === null || this.stopped) return null;
    this.stopped = true;
    this.armed = false;
    cancelAnimationFrame(this.raf);
    var ms = eventTime(e) - this.t0;
    // A NEGATIVE measurement means the tap physically happened before START —
    // the handler just ran late enough (busy main thread) that counting() had
    // already flipped. Clamping it to 0 would score a mashed countdown tap as
    // a real 0.000s answer and lock the player out of the round with the worst
    // possible time. An impossible measurement is refused, not rounded.
    if (!(ms >= 0)) {
      this.stopped = false; this.armed = true;
      this.raf = requestAnimationFrame(this._frame);
      return null;
    }
    return Math.min(ms, MAX_MS);
  };

  Round.prototype.running = function () { return this.armed && this.t0 !== null && !this.stopped; };
  Round.prototype.counting = function () { return this.armed && this.t0 === null; };

  Round.prototype.cancel = function () {
    this.armed = false; this.stopped = true;
    cancelAnimationFrame(this.raf);
  };

  /* ---- formatting, shared by every screen so they never disagree ---- */

  function secs(ms, dp) {
    if (ms == null || !isFinite(ms)) return "—";
    return (ms / 1000).toFixed(dp == null ? 3 : dp);
  }

  // A live classic timer shows hundredths: three decimals at 60fps is an
  // unreadable blur, and the round is still scored to the millisecond.
  function live(ms) { return (Math.max(0, ms) / 1000).toFixed(2); }

  function diffLabel(ms) {
    if (ms == null) return "—";
    if (ms === 0) return "DOT!";
    return (ms / 1000).toFixed(3);
  }

  return { Round: Round, eventTime: eventTime, secs: secs, live: live,
           diffLabel: diffLabel, MAX_MS: MAX_MS };
})();
