/* ============================================================================
   Meme Studio — data layer (window.MemeDB)
   Wraps Supabase. Reuses ILAN's public client + IGAuth accounts + the public
   "avatars" storage bucket (meme/ prefix) for images and voice clips.

   Public API (stable — other modules depend on this):
     MemeDB.ready()                      -> Promise<boolean>   (connected?)
     MemeDB.me()                         -> { key, name, guest }   (current user)
     MemeDB.nameKey(str)                 -> normalized key
     MemeDB.uploadMedia(blob, kind, ext, contentType) -> Promise<publicURL>
                                            kind: 'img' | 'voice'
     MemeDB.saveMeme({title,category,scene}) -> Promise<{ok, id?, msg?}>
     MemeDB.listMemes({sort,category,search,limit}) -> Promise<meme[]>
                                            sort: 'liked' | 'viewed' | 'new'
     MemeDB.getMeme(id)                  -> Promise<meme|null>
     MemeDB.addView(id)                  -> Promise<int>          (new view count)
     MemeDB.hasLiked(id)                 -> Promise<boolean>
     MemeDB.toggleLike(id)               -> Promise<{liked,likes}>
     MemeDB.creatorMemes(key)            -> Promise<meme[]>
     MemeDB.profile(key)                 -> Promise<{key,name,joined_at,totals}>
     MemeDB.myStats()                    -> Promise<stats>
   A "meme" row: { id, creator_key, creator_name, title, category, scene,
                   likes, views, created_at }
   ============================================================================ */
(function () {
  "use strict";
  var sb = null, sbTried = false;

  function loadSdk() {
    return new Promise(function (res) {
      if (window.supabase && window.supabase.createClient) return res(true);
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = function () { res(true); };
      s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
  }
  async function client() {
    if (sb) return sb;
    if (sbTried && !sb) { /* retry allowed */ }
    if (!window.SUPABASE_URL || !window.SUPABASE_KEY) return null;
    var ok = await loadSdk(); sbTried = true;
    if (!ok) return null;
    try { sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, { auth: { persistSession: false } }); }
    catch (e) { sb = null; }
    return sb;
  }
  async function ready() { return !!(await client()); }

  function nameKey(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40); }

  function me() {
    var u = null;
    try { u = window.IGAuth && IGAuth.getUser && IGAuth.getUser(); } catch (e) {}
    var name = (u && u.name) ? u.name : "Guest";
    var guest = !u || !!u.guest || !u.name;
    return { key: guest ? ("guest_" + nameKey(name)) : nameKey(name), name: name, guest: guest };
  }

  // Upload an image/voice blob to the public avatars bucket under meme/<kind>/<key>/<ts>.<ext>
  async function uploadMedia(blob, kind, ext, contentType) {
    var s = await client(); if (!s) throw new Error("Not connected — check your internet and try again.");
    if (!blob || !blob.size) throw new Error("Nothing to upload.");
    var u = me();
    var path = "meme/" + (kind || "img") + "/" + u.key + "/" + Date.now() + "." + (ext || "bin");
    var up = await s.storage.from("avatars").upload(path, blob, { upsert: true, contentType: contentType, cacheControl: "3600" });
    if (up.error) throw new Error("Upload failed: " + (up.error.message || "storage error"));
    var pub = s.storage.from("avatars").getPublicUrl(path);
    var url = pub && pub.data && pub.data.publicUrl;
    if (!url) throw new Error("Couldn't get the file URL.");
    return url;
  }

  async function saveMeme(m) {
    var s = await client(); if (!s) return { ok: false, msg: "Not connected — try again." };
    var u = me();
    var title = String(m.title || "").trim().slice(0, 80);
    if (!title) return { ok: false, msg: "Give your meme a title." };
    var cat = String(m.category || "random").toLowerCase();
    try {
      // remember the creator's join date (first save)
      await s.from("ms_profile").upsert({ user_key: u.key, name: u.name }, { onConflict: "user_key", ignoreDuplicates: true });
      var r = await s.from("ms_meme").insert({
        creator_key: u.key, creator_name: u.name, title: title, category: cat, scene: m.scene
      }).select("id").single();
      if (r.error) return { ok: false, msg: "Save failed: " + (r.error.message || "") };
      return { ok: true, id: r.data.id };
    } catch (e) { return { ok: false, msg: (e && e.message) || "Save failed." }; }
  }

  var COLS = "id,creator_key,creator_name,title,category,scene,likes,views,created_at";

  async function listMemes(opt) {
    opt = opt || {};
    var s = await client(); if (!s) return [];
    try {
      var q = s.from("ms_meme").select(COLS);
      if (opt.category && opt.category !== "all") q = q.eq("category", String(opt.category).toLowerCase());
      if (opt.search) {
        var t = String(opt.search).replace(/[,%()]/g, " ").trim();
        if (t) q = q.or("title.ilike.%" + t + "%,creator_name.ilike.%" + t + "%,category.ilike.%" + t + "%");
      }
      var sort = opt.sort || "new";
      if (sort === "liked") q = q.order("likes", { ascending: false }).order("created_at", { ascending: false });
      else if (sort === "viewed") q = q.order("views", { ascending: false }).order("created_at", { ascending: false });
      else q = q.order("created_at", { ascending: false });
      q = q.limit(opt.limit || 60);
      var r = await q;
      if (r.error) return [];
      return r.data || [];
    } catch (e) { return []; }
  }

  async function getMeme(id) {
    var s = await client(); if (!s) return null;
    try { var r = await s.from("ms_meme").select(COLS).eq("id", id).maybeSingle(); return r.error ? null : r.data; }
    catch (e) { return null; }
  }

  async function addView(id) {
    var s = await client(); if (!s) return 0;
    try { var r = await s.rpc("ms_view", { p_meme: id }); return r.error ? 0 : (r.data || 0); }
    catch (e) { return 0; }
  }

  async function hasLiked(id) {
    var s = await client(); if (!s) return false;
    var u = me();
    try {
      var r = await s.from("ms_like").select("meme_id").eq("meme_id", id).eq("user_key", u.key).maybeSingle();
      return !r.error && !!r.data;
    } catch (e) { return false; }
  }

  async function toggleLike(id) {
    var s = await client(); if (!s) throw new Error("Not connected.");
    var u = me();
    var r = await s.rpc("ms_like_toggle", { p_meme: id, p_user: u.key });
    if (r.error) throw new Error(r.error.message || "Couldn't like.");
    return r.data || { liked: false, likes: 0 };
  }

  async function creatorMemes(key) {
    var s = await client(); if (!s) return [];
    try {
      var r = await s.from("ms_meme").select(COLS).eq("creator_key", key).order("created_at", { ascending: false }).limit(120);
      return r.error ? [] : (r.data || []);
    } catch (e) { return []; }
  }

  function totalsOf(rows) {
    var likes = 0, views = 0, top = null;
    (rows || []).forEach(function (m) { likes += m.likes || 0; views += m.views || 0; if (!top || (m.likes || 0) > (top.likes || 0)) top = m; });
    return { memes: (rows || []).length, likes: likes, views: views, top: top };
  }

  async function profile(key) {
    var s = await client();
    var rows = await creatorMemes(key);
    var t = totalsOf(rows);
    var name = rows.length ? rows[0].creator_name : key;
    var joined = null;
    if (s) { try { var p = await s.from("ms_profile").select("name,joined_at").eq("user_key", key).maybeSingle(); if (!p.error && p.data) { name = p.data.name || name; joined = p.data.joined_at; } } catch (e) {} }
    if (!joined && rows.length) joined = rows[rows.length - 1].created_at;
    return { key: key, name: name, joined_at: joined, totals: t, memes: rows };
  }

  async function myStats() {
    var u = me();
    var rows = await creatorMemes(u.key);
    var t = totalsOf(rows);
    // favourite category = the one they've made most memes in
    var byCat = {}; rows.forEach(function (m) { byCat[m.category] = (byCat[m.category] || 0) + 1; });
    var favCat = null, favN = 0; Object.keys(byCat).forEach(function (c) { if (byCat[c] > favN) { favN = byCat[c]; favCat = c; } });
    return { memes: t.memes, likes: t.likes, views: t.views, top: t.top, favCategory: favCat, rows: rows };
  }

  window.MemeDB = {
    ready: ready, me: me, nameKey: nameKey, uploadMedia: uploadMedia,
    saveMeme: saveMeme, listMemes: listMemes, getMeme: getMeme, addView: addView,
    hasLiked: hasLiked, toggleLike: toggleLike, creatorMemes: creatorMemes,
    profile: profile, myStats: myStats
  };
})();
