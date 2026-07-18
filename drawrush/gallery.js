/* ============================================================
   DRAW RUSH — Community Gallery (fully isolated from gameplay)
   Uses window.DrawRushAPI for UI helpers + the shared Supabase client.
   Never throws into the game: all backend calls degrade gracefully.
   ============================================================ */
'use strict';
(function(){
const API=window.DrawRushAPI; if(!API){ return; }
const $=id=>document.getElementById(id);
const esc=API.esc||(s=>String(s==null?'':s));
const CATS=['animals','food','sports','funny','nature','fantasy','vehicles','random'];
const CATNAME={animals:'🐾 Animals',food:'🍕 Food',sports:'⚽ Sports',funny:'😂 Funny',nature:'🌳 Nature',fantasy:'🐉 Fantasy',vehicles:'🚗 Vehicles',random:'🎲 Random'};
const PAGE=12;

/* ---- identity (persistent per device, no auth) ---- */
function userKey(){ let k; try{k=localStorage.getItem('dr_gallery_key');}catch(e){} if(!k){ k='dg'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); try{localStorage.setItem('dr_gallery_key',k);}catch(e){} } return k; }
function userName(){ return (API.userName&&API.userName())||'Artist'; }

let sb=null, sbFail=false;
async function client(){ if(sb)return sb; if(sbFail)return null; try{ sb=await API.getClient(); }catch(e){ sbFail=true; } return sb; }
function fmtDate(t){ try{ return new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }catch(e){ return ''; } }
function safeSearch(s){ return String(s||'').replace(/[%,()"\\*]/g,' ').trim().slice(0,40); }   // strip chars that could break the PostgREST or() filter
function loading(el){ el.innerHTML='<div class="spin"></div>'; }

/* ---- nav (gallery -> detail -> profile with Back) ---- */
let galCur='gallery'; const navBack=[];
function goScreen(id){ galCur=id; API.show(id); }
function pushGo(id){ navBack.push(galCur); goScreen(id); }
function goBack(){ const p=navBack.pop(); if(p){ goScreen(p); } else { API.show('menu'); } }

/* ============================================================
   BROWSE
   ============================================================ */
const gs={ sort:'likes', category:'all', search:'', offset:0, busy:false, done:false };
function renderChips(){
  const box=$('gChips'); if(box.getAttribute('data-built'))return; box.setAttribute('data-built','1');
  box.innerHTML=['all'].concat(CATS).map(c=>'<button class="gchip'+(c==='all'?' on':'')+'" data-c="'+c+'">'+(c==='all'?'✨ All':CATNAME[c])+'</button>').join('');
  box.querySelectorAll('.gchip').forEach(b=>b.onclick=()=>{ gs.category=b.getAttribute('data-c'); box.querySelectorAll('.gchip').forEach(x=>x.classList.toggle('on',x===b)); loadGallery(true); });
}
function cardHTML(d){
  const img=d.image_url?('<img class="thumb" loading="lazy" src="'+esc(d.image_url)+'" alt="">'):'<div class="thumb"></div>';
  return '<div class="gcard" data-id="'+d.id+'">'+img+'<div class="gc-b"><div class="gc-t">'+esc(d.title||'Untitled')+'</div>'
    +'<div class="gc-c">by '+esc(d.creator_name||'Artist')+'</div>'
    +'<div class="gc-m"><span>❤️ '+(d.likes|0)+'</span><span>👁 '+(d.views|0)+'</span></div>'
    +'<span class="gcat">'+(CATNAME[d.category]||'🎲')+'</span></div></div>';
}
function wireCards(grid){ grid.querySelectorAll('.gcard').forEach(c=>{ if(c.getAttribute('data-w'))return; c.setAttribute('data-w','1'); c.onclick=()=>{ API.sound&&API.sound.click(); openDetail(c.getAttribute('data-id')); }; }); }
async function loadGallery(reset){
  if(gs.busy)return; gs.busy=true;
  const grid=$('gGrid'), more=$('gMore');
  if(reset){ gs.offset=0; gs.done=false; grid.innerHTML=''; loading(grid); }
  const s=await client();
  if(!s){ grid.innerHTML='<div class="gempty">Gallery is offline — check your internet.</div>'; more.style.display='none'; gs.busy=false; return; }
  try{
    let q=s.from('dr_drawings').select('id,user_key,creator_name,title,category,image_url,likes,views,created_at').eq('hidden',false);
    if(gs.category&&gs.category!=='all') q=q.eq('category',gs.category);
    const term=safeSearch(gs.search);
    if(term) q=q.or('title.ilike.%'+term+'%,creator_name.ilike.%'+term+'%,category.ilike.%'+term+'%');
    const col=gs.sort==='likes'?'likes':gs.sort==='views'?'views':'created_at';
    q=q.order(col,{ascending:false}).order('id',{ascending:false}).range(gs.offset,gs.offset+PAGE-1);
    const r=await q;
    if(r.error){ if(reset)grid.innerHTML='<div class="gempty">🖼️ The gallery isn\'t set up yet.<br><span class="small">Run the gallery SQL in Supabase, then reload.</span></div>'; more.style.display='none'; gs.done=true; gs.busy=false; return; }
    const rows=r.data||[];
    if(reset && !rows.length){ grid.innerHTML='<div class="gempty">No drawings yet.<br><span class="small">Be the first — draw one in an AI mode and tap “Save to Gallery”!</span></div>'; more.style.display='none'; gs.done=true; gs.busy=false; return; }
    if(reset) grid.innerHTML='';
    grid.insertAdjacentHTML('beforeend', rows.map(cardHTML).join(''));
    wireCards(grid);
    gs.offset+=rows.length;
    if(rows.length<PAGE){ gs.done=true; more.style.display='none'; }
    else { more.style.display='block'; more.innerHTML='<button class="btn ghost sm" id="gMoreBtn">Load more ↓</button>'; $('gMoreBtn').onclick=()=>loadGallery(false); }
  }catch(e){ if(reset)grid.innerHTML='<div class="gempty">Couldn\'t load the gallery.</div>'; more.style.display='none'; }
  gs.busy=false;
}
function openGallery(){ renderChips(); goScreen('gallery'); navBack.length=0; gs.search=''; $('gSearch').value=''; loadGallery(true); }

/* ============================================================
   DETAIL (view + like + creator)
   ============================================================ */
let detailId=null;
async function openDetail(id){
  detailId=id; pushGo('detail'); loading($('detailBody'));
  const s=await client(); if(!s){ $('detailBody').innerHTML='<div class="gempty">Offline.</div>'; return; }
  try{
    const r=await s.from('dr_drawings').select('*').eq('id',id).maybeSingle();
    if(r.error||!r.data){ $('detailBody').innerHTML='<div class="gempty">This drawing is unavailable.</div>'; return; }
    const d=r.data;
    let liked=false; try{ const lr=await s.from('dr_likes').select('drawing_id').eq('drawing_id',id).eq('user_key',userKey()).maybeSingle(); liked=!!(lr&&lr.data); }catch(e){}
    // count a view (deduped server-side)
    let views=d.views|0; try{ const vr=await s.rpc('dr_add_view',{p_drawing:Number(id),p_user:userKey()}); if(vr&&!vr.error&&typeof vr.data==='number')views=vr.data; }catch(e){}
    $('detailBody').innerHTML=(d.image_url?'<img class="dimg" src="'+esc(d.image_url)+'" alt="">':'<div class="dimg"></div>')
      +'<h2 style="margin:12px 0 4px">'+esc(d.title||'Untitled')+'</h2>'
      +'<span class="gcat">'+(CATNAME[d.category]||'🎲 Random')+'</span>'
      +'<div class="dmeta"><span class="dstat">❤️ <span id="dLikes">'+(d.likes|0)+'</span></span><span class="dstat">👁 <span id="dViews">'+views+'</span></span><span class="dstat">📅 '+fmtDate(d.created_at)+'</span></div>'
      +'<button class="btn likebtn'+(liked?' liked':'')+' block" id="dLike">'+(liked?'❤️ Liked':'🤍 Like')+'</button>'
      +'<div class="dcreator" id="dCreator"><span class="av">🎨</span><div style="flex:1"><b>'+esc(d.creator_name||'Artist')+'</b><div class="small">👤 View creator profile ›</div></div></div>';
    $('dLike').onclick=async()=>{ API.sound&&API.sound.click(); $('dLike').disabled=true;
      try{ const lr=await s.rpc('dr_like_toggle',{p_drawing:Number(id),p_user:userKey()});
        if(lr&&!lr.error&&lr.data){ const liked2=!!lr.data.liked; $('dLikes').textContent=lr.data.likes|0; $('dLike').classList.toggle('liked',liked2); $('dLike').innerHTML=liked2?'❤️ Liked':'🤍 Like'; if(liked2)API.sound&&API.sound.pop&&API.sound.pop(); } }catch(e){ API.toast('Couldn\'t like — try again'); }
      $('dLike').disabled=false; };
    $('dCreator').onclick=()=>{ API.sound&&API.sound.click(); openProfile(d.user_key); };
  }catch(e){ $('detailBody').innerHTML='<div class="gempty">Couldn\'t open this drawing.</div>'; }
}

/* ============================================================
   PROFILE (creator + my)
   ============================================================ */
const ps={ key:null, isMe:false, sort:'new', category:'all', offset:0, busy:false, done:false };
async function openProfile(key){
  ps.key=key; ps.isMe=(key===userKey()); ps.sort='new'; ps.category='all'; ps.offset=0; ps.done=false;
  pushGo('profile'); loading($('profileBody'));
  const s=await client(); if(!s){ $('profileBody').innerHTML='<div class="gempty">Offline.</div>'; return; }
  let name=ps.isMe?userName():'Artist', joined='';
  try{ const pr=await s.from('dr_profiles').select('name,created_at').eq('user_key',key).maybeSingle(); if(pr&&pr.data){ name=pr.data.name||name; joined=fmtDate(pr.data.created_at); } }catch(e){}
  let st={drawings:0,likes:0,views:0,followers:0,following:0};
  try{ const sr=await s.rpc('dr_profile_stats',{p_user:key}); if(sr&&!sr.error&&sr.data)st=sr.data; }catch(e){}
  let following=false; if(!ps.isMe){ try{ const fr=await s.from('dr_followers').select('creator_key').eq('follower_key',userKey()).eq('creator_key',key).maybeSingle(); following=!!(fr&&fr.data); }catch(e){} }
  $('profileBody').innerHTML='<div class="phead"><div class="pav">🎨</div><div style="flex:1"><div style="font-size:22px;font-weight:900">'+esc(name)+(ps.isMe?' <span class="small">(you)</span>':'')+'</div><div class="small">Joined '+(joined||'recently')+'</div></div></div>'
    +'<div class="pstats"><div class="pstat"><div class="v">'+(st.drawings|0)+'</div><div class="l">Drawings</div></div><div class="pstat"><div class="v">'+(st.likes|0)+'</div><div class="l">❤️ Likes</div></div><div class="pstat"><div class="v">'+(st.views|0)+'</div><div class="l">👁 Views</div></div></div>'
    +'<div class="pstats"><div class="pstat"><div class="v">'+(st.followers|0)+'</div><div class="l">Followers</div></div><div class="pstat"><div class="v">'+(st.following|0)+'</div><div class="l">Following</div></div></div>'
    +(ps.isMe?'':'<button class="btn'+(following?' ghost':'')+' block" id="pFollow" style="margin:4px 0 10px">'+(following?'✓ Following':'➕ Follow')+'</button>')
    +'<div class="gtabs" id="pTabs"><button data-s="new" class="on">🆕 Newest</button><button data-s="likes">🔥 Most Liked</button></div>'
    +'<div class="ggrid" id="pGrid"></div><div class="gmore" id="pMore" style="display:none"></div>';
  if(!ps.isMe){ $('pFollow').onclick=async()=>{ API.sound&&API.sound.click(); const btn=$('pFollow'); btn.disabled=true;
    try{ if(following){ await s.from('dr_followers').delete().eq('follower_key',userKey()).eq('creator_key',key); following=false; }
      else { await s.from('dr_followers').upsert({follower_key:userKey(),creator_key:key},{onConflict:'follower_key,creator_key'}); following=true; }
      btn.classList.toggle('ghost',following); btn.innerHTML=following?'✓ Following':'➕ Follow';
    }catch(e){ API.toast('Couldn\'t update follow'); } btn.disabled=false; }; }
  $('pTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{ ps.sort=b.getAttribute('data-s'); $('pTabs').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); loadProfileDrawings(true); });
  loadProfileDrawings(true);
}
async function loadProfileDrawings(reset){
  if(ps.busy)return; ps.busy=true;
  const grid=$('pGrid'), more=$('pMore'); if(!grid){ps.busy=false;return;}
  if(reset){ ps.offset=0; ps.done=false; loading(grid); }
  const s=await client(); if(!s){ grid.innerHTML='<div class="gempty">Offline.</div>'; ps.busy=false; return; }
  try{
    let q=s.from('dr_drawings').select('id,user_key,creator_name,title,category,image_url,likes,views,created_at').eq('user_key',ps.key).eq('hidden',false);
    const col=ps.sort==='likes'?'likes':'created_at'; q=q.order(col,{ascending:false}).order('id',{ascending:false}).range(ps.offset,ps.offset+PAGE-1);
    const r=await q;
    if(r.error){ grid.innerHTML='<div class="gempty">Couldn\'t load drawings.</div>'; more.style.display='none'; ps.busy=false; return; }
    const rows=r.data||[];
    if(reset&&!rows.length){ grid.innerHTML='<div class="gempty">No drawings yet.</div>'; more.style.display='none'; ps.done=true; ps.busy=false; return; }
    if(reset)grid.innerHTML='';
    grid.insertAdjacentHTML('beforeend', rows.map(cardHTML).join('')); wireCards(grid);
    ps.offset+=rows.length;
    if(rows.length<PAGE){ ps.done=true; more.style.display='none'; }
    else { more.style.display='block'; more.innerHTML='<button class="btn ghost sm" id="pMoreBtn">Load more ↓</button>'; $('pMoreBtn').onclick=()=>loadProfileDrawings(false); }
  }catch(e){ grid.innerHTML='<div class="gempty">Couldn\'t load drawings.</div>'; }
  ps.busy=false;
}

/* ============================================================
   SAVE
   ============================================================ */
function dataURLtoBlob(d){ const p=d.split(','); const mime=(p[0].match(/:(.*?);/)||[])[1]||'image/png'; const bin=atob(p[1]); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i); return new Blob([a],{type:mime}); }
function openSave(dataURL, defTitle){
  if(!dataURL){ API.toast('Nothing to save yet'); return; }
  let cat=CATS[0];
  API.openOv('<div class="big-emoji">🖼️</div><h2>Save to Gallery</h2>'
    +'<img src="'+dataURL+'" style="width:62%;border-radius:12px;background:#fff;margin:4px auto 8px;display:block;box-shadow:0 6px 18px rgba(0,0,0,.4)">'
    +'<input id="gvTitle" class="field" placeholder="Give it a title…" maxlength="40" value="'+esc((defTitle||'').replace(/^\w/,c=>c.toUpperCase()))+'" style="text-align:center">'
    +'<div style="text-align:left;font-weight:800;font-size:13px;margin:12px 2px 6px">Category</div>'
    +'<div id="gvCats" style="display:flex;flex-wrap:wrap;gap:6px">'+CATS.map((c,i)=>'<button class="gchip'+(i===0?' on':'')+'" data-c="'+c+'">'+CATNAME[c]+'</button>').join('')+'</div>'
    +'<div class="btns"><button class="btn ghost" id="gvCancel">Cancel</button><button class="btn" id="gvSave">Save ▶</button></div>');
  $('gvCats').querySelectorAll('.gchip').forEach(b=>b.onclick=()=>{ cat=b.getAttribute('data-c'); $('gvCats').querySelectorAll('.gchip').forEach(x=>x.classList.toggle('on',x===b)); });
  $('gvCancel').onclick=()=>API.closeOv();
  $('gvSave').onclick=async()=>{ const t=($('gvTitle').value.trim()||defTitle||'Untitled').slice(0,40); const btn=$('gvSave'); btn.disabled=true; btn.textContent='Saving…';
    const ok=await saveDrawing(t,cat,dataURL);
    if(ok){ API.closeOv(); API.sound&&API.sound.win&&API.sound.win(); API.toast('🎉 Saved to Gallery!'); }
    else { btn.disabled=false; btn.textContent='Save ▶'; API.toast('Save failed — is the gallery set up in Supabase?'); } };
}
async function saveDrawing(title, category, dataURL){
  const s=await client(); if(!s)return false;
  try{
    // upload the PNG to the shared public "avatars" bucket
    const blob=dataURLtoBlob(dataURL);
    const path='dr/'+userKey()+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,6)+'.png';
    const up=await s.storage.from('avatars').upload(path,blob,{contentType:'image/png',upsert:true,cacheControl:'3600'});
    if(up.error)return false;
    const pub=s.storage.from('avatars').getPublicUrl(path); const url=pub&&pub.data&&pub.data.publicUrl; if(!url)return false;
    // ensure a profile row exists / name up to date
    try{ await s.from('dr_profiles').upsert({user_key:userKey(),name:userName()},{onConflict:'user_key'}); }catch(e){}
    let strokes=null; try{ strokes=API.strokes&&API.strokes(); }catch(e){}
    const ins=await s.from('dr_drawings').insert({user_key:userKey(),creator_name:userName(),title,category,image_url:url,strokes}).select('id').maybeSingle();
    if(ins.error){ // maybe the strokes column / table differs — retry minimal
      const ins2=await s.from('dr_drawings').insert({user_key:userKey(),creator_name:userName(),title,category,image_url:url}).select('id').maybeSingle();
      if(ins2.error)return false;
    }
    return true;
  }catch(e){ return false; }
}

/* ============================================================
   WIRING
   ============================================================ */
function boot(){
  const gb=$('galleryOpenBtn'); if(gb) gb.onclick=()=>{ API.sound&&API.sound.click(); openGallery(); };
  $('gTabs')&&$('gTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{ gs.sort=b.getAttribute('data-sort'); $('gTabs').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); loadGallery(true); });
  const doSearch=()=>{ gs.search=$('gSearch').value; loadGallery(true); };
  $('gSearchBtn')&&($('gSearchBtn').onclick=()=>{ API.sound&&API.sound.click(); doSearch(); });
  $('gSearch')&&$('gSearch').addEventListener('keydown',e=>{ if(e.key==='Enter')doSearch(); });
  let st=null; $('gSearch')&&$('gSearch').addEventListener('input',()=>{ clearTimeout(st); st=setTimeout(doSearch,450); });   // live search (debounced)
  $('detailBack')&&($('detailBack').onclick=()=>{ API.sound&&API.sound.click(); goBack(); });
  $('profileBack')&&($('profileBack').onclick=()=>{ API.sound&&API.sound.click(); goBack(); });
  $('myProfileBtn')&&($('myProfileBtn').onclick=()=>{ API.sound&&API.sound.click(); openProfile(userKey()); });
  // infinite scroll: load more when near the bottom of an active gallery/profile list
  window.addEventListener('scroll',()=>{
    if(window.innerHeight+window.scrollY < document.body.offsetHeight-260) return;
    if(galCur==='gallery' && !gs.busy && !gs.done && gs.offset>0) loadGallery(false);
    else if(galCur==='profile' && !ps.busy && !ps.done && ps.offset>0) loadProfileDrawings(false);
  },{passive:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();

/* public API (used by game.js result overlays + tests) */
window.Gallery={ openSave, openGallery, openDetail, openProfile,
  _t: (String(location.search).indexOf('cwtest')>=0) ? { saveDrawing, loadGallery, userKey, gs, ps, client } : undefined };
})();
