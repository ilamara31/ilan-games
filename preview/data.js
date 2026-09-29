/* Real numbers, straight from the arcade's own database.
 *
 * Nothing here is invented: play counts, the weekly leader, scores, friends
 * and groups are all read live from Supabase with the same public key the
 * site already ships. Everything degrades to an empty list rather than a
 * fake one, so a page never shows numbers that aren't real.
 */
window.IGData = (function () {
  "use strict";

  var URL = "https://xanrofecdpoljnerpsow.supabase.co/rest/v1";
  var KEY = "sb_publishable_jff4Q2OLVzIf0Cr1FILZyQ_vgy8xRrT";

  function get(path) {
    return fetch(URL + "/" + path, { headers: { apikey: KEY } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  }

  function rpc(fn, body) {
    return fetch(URL + "/rpc/" + fn, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ---------------------------------------------------------------- plays
   * analytics.js keys a play on the LAST path segment, so /f1/3d.html and
   * /football/3d.html both land on "3d.html" — two games sharing one
   * counter. Those pooled plays are split between them in proportion to the
   * plays each one recorded under its own folder, which is an estimate and
   * the only part of this file that is.
   */
  function plays() {
    // The pooled keys have to be split by something that still moves. The
    // games' own folder counters do not: /f1/ has auto-redirected to 3d.html
    // since July 2026, so f1's own counter has been frozen while the pooled
    // one kept climbing. Distinct players on each game's leaderboard is the
    // nearest live signal, so the pool is divided by that instead.
    return Promise.all([
      get("game_plays?select=game,plays&order=plays.desc&limit=200"),
      get("leaderboard?select=game,name&limit=900")
    ]).then(function (res) {
      var rows = res[0] || [], lb = res[1] || [];

      var map = {}, pooled = 0;
      rows.forEach(function (r) {
        if (r.game === "3d.html" || r.game === "2d.html") { pooled += r.plays; return; }
        // Super Over Cricket 2 was dropped; auth.js and friends.js both hide
        // its leftovers, so its counters are not folded into anything.
        if (r.game === "cricket2-bat" || r.game === "cricket2-bowl") return;
        map[r.game] = (map[r.game] || 0) + r.plays;
      });

      if (pooled) {
        var who = { f1: {}, football: {} };
        lb.forEach(function (r) { if (who[r.game]) who[r.game][r.name] = 1; });
        var a2 = Object.keys(who.f1).length, b2 = Object.keys(who.football).length;
        if (!(a2 + b2)) { a2 = map.f1 || 1; b2 = map.football || 1; }
        var share = Math.round(pooled * (a2 / (a2 + b2)));
        map.f1 = (map.f1 || 0) + share;
        map.football = (map.football || 0) + (pooled - share);   // nothing lost
      }
      return map;
    });
  }

  /* ------------------------------------------------------- user of the week
   * The week rolls over on Friday night, decided server-side so players in
   * different timezones sit in the same bucket.
   */
  function weekly() {
    return rpc("ig_week_now").then(function (w) {
      if (w == null) return { week: null, rows: [] };
      return get("ig_weekly?select=user_name,plays,week&week=eq." + w +
                 "&order=plays.desc,updated.asc&limit=12")
        .then(function (rows) { return { week: w, rows: rows || [] }; });
    });
  }

  function board(limit) {
    return get("leaderboard?select=game,name,score&order=score.desc&limit=" + (limit || 900));
  }

  function profiles() {
    return get("ig_profile?select=user_key,name,avatar_emoji,avatar_url&limit=200");
  }

  function friendsOf(key) {
    if (!key) return Promise.resolve([]);
    return get("ig_friend?select=bkey,bname&akey=eq." + encodeURIComponent(key));
  }

  function allFriendPairs() {
    return get("ig_friend?select=akey,aname,bkey,bname&limit=400");
  }

  // Requests waiting on this player, and the ones they have sent out.
  function requestsFor(key) {
    if (!key) return Promise.resolve({ inbox: [], sent: [] });
    return Promise.all([
      get("ig_friend_req?select=from_key,from_name&to_key=eq." + encodeURIComponent(key)),
      get("ig_friend_req?select=to_key,to_name&from_key=eq." + encodeURIComponent(key))
    ]).then(function (r) { return { inbox: r[0] || [], sent: r[1] || [] }; });
  }

  function groups() {
    return get("ig_group?select=id,name,avatar_emoji,avatar_url,owner_name&limit=60");
  }

  function groupMembers() {
    return get("ig_group_member?select=group_id,user_key,name&limit=400");
  }

  function messages(limit) {
    return get("ig_group_msg?select=group_id,name,text,created_at&order=created_at.desc&limit=" +
               (limit || 60));
  }

  return {
    plays: plays, weekly: weekly, board: board, profiles: profiles,
    friendsOf: friendsOf, allFriendPairs: allFriendPairs, requestsFor: requestsFor,
    groups: groups, groupMembers: groupMembers, messages: messages
  };
})();
