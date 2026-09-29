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
    return get("game_plays?select=game,plays&order=plays.desc&limit=200")
      .then(function (rows) {
        var map = {}, pooled = 0;
        rows.forEach(function (r) {
          if (r.game === "3d.html" || r.game === "2d.html") { pooled += r.plays; return; }
          map[r.game] = (map[r.game] || 0) + r.plays;
        });
        if (pooled) {
          var a = map.f1 || 0, b = map.football || 0, t = a + b;
          if (t) {
            map.f1 = a + Math.round(pooled * (a / t));
            map.football = b + Math.round(pooled * (b / t));
          }
        }
        // a couple of older keys that belong to games we still list
        if (map["cricket2-bat"] || map["cricket2-bowl"]) {
          map.cricket = (map.cricket || 0) +
            (map["cricket2-bat"] || 0) + (map["cricket2-bowl"] || 0);
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
                 "&order=plays.desc&limit=12")
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
    friendsOf: friendsOf, allFriendPairs: allFriendPairs,
    groups: groups, groupMembers: groupMembers, messages: messages
  };
})();
