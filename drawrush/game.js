/* ============================================================
   DRAW RUSH — multiplayer & AI drawing game
   Part 1: foundation + drawing engine
   ============================================================ */
'use strict';
(function(){
const $=id=>document.getElementById(id);
const $$=s=>Array.prototype.slice.call(document.querySelectorAll(s));
const DATA=(window.DR_DATA)||{words:['cat','dog','house','tree','sun'],easy:['cat','dog','sun'],categories:{},bluffNouns:['banana','robot'],adjectives:['flying','giant']};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=n=>Math.floor(Math.random()*n);
const pick=a=>a[rnd(a.length)];
const myId='u'+Math.random().toString(36).slice(2,9);

/* ---------- save ---------- */
const SKEY='draw_rush_v1';
function defSave(){return{name:'',sound:true,music:false,
  stats:{played:0,wins:0,correct:0,guessTimeSum:0,guessTimeN:0,drawings:0,modes:{}}};}
function loadSave(){try{const s=JSON.parse(localStorage.getItem(SKEY));if(s&&s.stats){const d=defSave();return Object.assign(d,s,{stats:Object.assign(d.stats,s.stats)});}}catch(e){}return defSave();}
let SV=loadSave();
function save(){try{localStorage.setItem(SKEY,JSON.stringify(SV));}catch(e){}}
function myName(){return (SV.name&&SV.name.trim())?SV.name.trim().slice(0,14):('Player'+myId.slice(-3).toUpperCase());}

/* ---------- sound (WebAudio) ---------- */
const Sound=(function(){
  let ctx=null;
  function ac(){if(!ctx){try{ctx=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}return ctx;}
  function unlock(){const c=ac();if(c&&c.state==='suspended')c.resume();}
  function tone(f,d,type,vol,at){const c=ac();if(!c||!SV.sound)return;const t=c.currentTime+(at||0);
    const o=c.createOscillator(),g=c.createGain();o.type=type||'sine';o.frequency.setValueAtTime(f,t);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||.14,t+.01);g.gain.exponentialRampToValueAtTime(.0008,t+d);
    o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+d+.03);}
  return {
    unlock,
    click(){tone(340,.05,'triangle',.1);},
    tick(){tone(1100,.03,'square',.05);},
    start(){[523,659,784].forEach((f,i)=>tone(f,.14,'triangle',.13,i*.07));},
    correct(){[523,659,784,1046].forEach((f,i)=>tone(f,.16,'sine',.15,i*.08));},
    wrong(){tone(220,.16,'sawtooth',.12);tone(170,.2,'sawtooth',.1,.05);},
    win(){[523,659,784,1046,784,1046,1319].forEach((f,i)=>tone(f,.24,'triangle',.15,i*.12));},
    lose(){[440,392,349,294].forEach((f,i)=>tone(f,.26,'sine',.13,i*.15));},
    pop(){tone(720,.07,'sine',.12);tone(1080,.09,'sine',.1,.05);},
    disaster(){tone(180,.3,'sawtooth',.16);tone(90,.4,'sawtooth',.14,.05);}
  };
})();
['pointerdown','keydown','touchstart'].forEach(ev=>window.addEventListener(ev,()=>Sound.unlock(),{passive:true}));

/* ---------- screen router / ui helpers ---------- */
let curScreen='menu';
function show(id){$$('.screen').forEach(s=>s.classList.remove('on'));const e=$(id);if(e)e.classList.add('on');curScreen=id;window.scrollTo(0,0);}
let toastT=null;
function toast(m,ms){const t=$('toast');t.innerHTML=m;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),ms||1900);}
function openOv(html){$('ovBox').innerHTML=html;$('ov').classList.add('on');}
function closeOv(){$('ov').classList.remove('on');}
function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
function confetti(n){const c=$('confetti');c.innerHTML='';const cols=['#ffd23f','#ec4899','#06b6d4','#22d39a','#7c3aed'];
  for(let i=0;i<(n||80);i++){const s=document.createElement('i');s.style.left=Math.random()*100+'%';s.style.background=pick(cols);
    s.style.animationDuration=(1.5+Math.random()*1.8)+'s';s.style.animationDelay=(Math.random()*.5)+'s';s.style.transform='rotate('+rnd(360)+'deg)';c.appendChild(s);}
  c.classList.add('on');setTimeout(()=>c.classList.remove('on'),3200);}

/* ============================================================
   DRAWING ENGINE — normalized [0..1] coords so a drawing looks
   identical on every device (essential for multiplayer sync).
   ============================================================ */
const PALETTE=['#111827','#ef4444','#f97316','#facc15','#22c55e','#06b6d4','#3b82f6','#7c3aed','#ec4899','#a16207','#ffffff','#9ca3af'];
const Draw=(function(){
  let canvas,ctx,W=1,H=1,dpr=1;
  let strokes=[],redo=[],cur=null,seq=0;
  let color='#111827',sizePx=8,tool='brush';
  let enabled=false, drawing=false;
  let onStroke=null,onOp=null;            // multiplayer hooks
  let sendBuf=null,sendTimer=null;

  function init(cv){ canvas=cv; ctx=canvas.getContext('2d'); resize(); }
  function frac(){ return clamp(sizePx/620,.003,.09); }   // slider px -> fraction of width (device independent)
  function px(x){return x*W;} function py(y){return y*H;}

  function resize(){
    const wrap=canvas.parentElement, r=wrap.getBoundingClientRect();
    dpr=Math.min(window.devicePixelRatio||1,2.5);
    W=Math.max(2,Math.round(r.width*dpr)); H=Math.max(2,Math.round(r.height*dpr));
    canvas.width=W; canvas.height=H;
    renderAll();
  }
  function setupCtx(s){
    ctx.lineWidth=Math.max(1,s.w*W); ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.strokeStyle=s.c; ctx.fillStyle=s.c;
    ctx.globalCompositeOperation = s.t==='eraser'?'destination-out':'source-over';
  }
  function dot(s,p){ setupCtx(s); ctx.beginPath(); ctx.arc(px(p.x),py(p.y),Math.max(.6,s.w*W/2),0,7); ctx.fill(); }
  function drawFull(s){
    const p=s.pts; if(!p.length)return; setupCtx(s);
    if(p.length===1){ dot(s,p[0]); return; }
    if(p.length===2){ ctx.beginPath();ctx.moveTo(px(p[0].x),py(p[0].y));ctx.lineTo(px(p[1].x),py(p[1].y));ctx.stroke();return; }
    ctx.beginPath(); ctx.moveTo(px(p[0].x),py(p[0].y));
    for(let i=1;i<p.length-1;i++){ const m={x:(p[i].x+p[i+1].x)/2,y:(p[i].y+p[i+1].y)/2}; ctx.quadraticCurveTo(px(p[i].x),py(p[i].y),px(m.x),py(m.y)); }
    ctx.lineTo(px(p[p.length-1].x),py(p[p.length-1].y)); ctx.stroke();
  }
  // incremental: draw only the newest smoothed segment (live feel, cheap)
  function drawStep(s){
    const p=s.pts,n=p.length; setupCtx(s);
    if(n===1){ dot(s,p[0]); return; }
    if(n===2){ ctx.beginPath();ctx.moveTo(px(p[0].x),py(p[0].y));ctx.lineTo(px(p[1].x),py(p[1].y));ctx.stroke();return; }
    const a=p[n-3],b=p[n-2],c=p[n-1];
    const m1={x:(a.x+b.x)/2,y:(a.y+b.y)/2}, m2={x:(b.x+c.x)/2,y:(b.y+c.y)/2};
    ctx.beginPath(); ctx.moveTo(px(m1.x),py(m1.y)); ctx.quadraticCurveTo(px(b.x),py(b.y),px(m2.x),py(m2.y)); ctx.stroke();
  }
  function renderAll(){ if(!ctx)return; ctx.globalCompositeOperation='source-over'; ctx.clearRect(0,0,W,H); strokes.forEach(drawFull); }

  /* ---- local input ---- */
  function begin(x,y){
    if(!enabled)return; drawing=true; redo=[];
    cur={t:tool,c:color,w:frac(),pts:[{x:clamp(x,0,1),y:clamp(y,0,1)}],id:myId+'-'+(++seq)};
    strokes.push(cur); drawStep(cur); queueSend(cur,true);
  }
  function move(x,y){
    if(!enabled||!drawing||!cur)return;
    const p={x:clamp(x,0,1),y:clamp(y,0,1)}, last=cur.pts[cur.pts.length-1];
    if(last && Math.abs(last.x-p.x)<.0008 && Math.abs(last.y-p.y)<.0008) return;   // skip micro-jitter
    cur.pts.push(p); drawStep(cur); queueSend(cur);
  }
  function end(){
    if(!drawing)return; drawing=false;
    if(cur){ flushSend(cur,true); if(cur.pts.length===1) drawFull(cur); }
    cur=null;
    if(onOp) onOp({op:'snap',strokes:snapshot()});   // authoritative correction after each stroke
  }
  /* throttled multiplayer stroke delta */
  function queueSend(s,forceStart){
    if(!onStroke)return;
    if(!sendBuf||sendBuf.id!==s.id){ sendBuf={id:s.id,t:s.t,c:s.c,w:s.w,from:s.pts.length-1}; }
    if(sendTimer&&!forceStart)return;
    const doSend=()=>{ sendTimer=null; if(!sendBuf)return; const s2=cur&&cur.id===sendBuf.id?cur:strokes.find(x=>x.id===sendBuf.id);
      if(!s2){sendBuf=null;return;} const pts=s2.pts.slice(sendBuf.from); if(!pts.length){return;}
      onStroke({id:s2.id,t:s2.t,c:s2.c,w:s2.w,pts,done:false}); sendBuf.from=s2.pts.length; };
    sendTimer=setTimeout(doSend,55);
  }
  function flushSend(s,done){
    if(!onStroke)return; if(sendTimer){clearTimeout(sendTimer);sendTimer=null;}
    const from=(sendBuf&&sendBuf.id===s.id)?sendBuf.from:0; const pts=s.pts.slice(from);
    onStroke({id:s.id,t:s.t,c:s.c,w:s.w,pts,done:!!done}); sendBuf=null;
  }

  /* ---- remote apply ---- */
  function applyStroke(msg){
    if(!msg||!msg.id)return;
    let s=strokes.find(x=>x.id===msg.id);
    if(!s){ s={t:msg.t,c:msg.c,w:msg.w,pts:[],id:msg.id}; strokes.push(s); }
    (msg.pts||[]).forEach(p=>{ s.pts.push(p); drawStep(s); });
  }
  function applySnapshot(list){ strokes=(list||[]).map(s=>({t:s.t,c:s.c,w:s.w,id:s.id,pts:s.pts.map(p=>({x:p.x,y:p.y}))})); redo=[]; renderAll(); }
  function snapshot(){ return strokes.map(s=>({t:s.t,c:s.c,w:s.w,id:s.id,pts:s.pts})); }

  /* ---- ops ---- */
  function undo(){ if(!strokes.length)return; redo.push(strokes.pop()); renderAll(); if(onOp)onOp({op:'snap',strokes:snapshot()}); }
  function redoOp(){ if(!redo.length)return; strokes.push(redo.pop()); renderAll(); if(onOp)onOp({op:'snap',strokes:snapshot()}); }
  function clear(broadcast){ strokes=[]; redo=[]; renderAll(); if(broadcast!==false&&onOp)onOp({op:'snap',strokes:[]}); }

  return {
    init,resize,renderAll,begin,move,end,applyStroke,applySnapshot,snapshot,undo,redo:redoOp,clear,
    setColor(c){color=c;tool='brush';}, setSize(px){sizePx=px;}, setTool(t){tool=t;},
    getTool(){return tool;}, getColor(){return color;}, getSize(){return sizePx;},
    setEnabled(b){enabled=b;}, isEnabled(){return enabled;},
    setHooks(hStroke,hOp){onStroke=hStroke;onOp=hOp;},
    isEmpty(){return strokes.length===0;}, strokeCount(){return strokes.length;},
    // simple analysis for AI Judge
    analyze(){ let n=0,minx=1,miny=1,maxx=0,maxy=0; const cols={};
      strokes.forEach(s=>{ if(s.t==='eraser')return; cols[s.c]=1; s.pts.forEach(p=>{n++;minx=Math.min(minx,p.x);miny=Math.min(miny,p.y);maxx=Math.max(maxx,p.x);maxy=Math.max(maxy,p.y);}); });
      const bw=Math.max(0,maxx-minx), bh=Math.max(0,maxy-miny);
      return {points:n,strokes:strokes.length,colors:Object.keys(cols).length,coverage:clamp(bw*bh,0,1),bw,bh}; }
  };
})();

/* pointer wiring for the canvas */
function wireCanvas(){
  const cv=$('canvas'), wrap=$('canvasWrap');
  Draw.init(cv);
  function norm(e){ const r=cv.getBoundingClientRect(); return {x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height}; }
  let active=false;
  cv.addEventListener('pointerdown',e=>{ if(!Draw.isEnabled())return; active=true; try{cv.setPointerCapture(e.pointerId);}catch(_){}
    const p=norm(e); Draw.begin(p.x,p.y); e.preventDefault(); },{passive:false});
  cv.addEventListener('pointermove',e=>{ if(!active)return;
    const evs=(e.getCoalescedEvents?e.getCoalescedEvents():null)||[e];
    for(const ev of evs){ const p=norm(ev); Draw.move(p.x,p.y); } e.preventDefault(); },{passive:false});
  function up(e){ if(!active)return; active=false; Draw.end(); }
  cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up); cv.addEventListener('pointerleave',up);
  let rt=null; window.addEventListener('resize',()=>{ clearTimeout(rt); rt=setTimeout(()=>{ if(curScreen==='game')Draw.resize(); },160); });
}

/* ---------- toolbar wiring ---------- */
function buildSwatches(){
  const box=$('swatches'); box.innerHTML='';
  PALETTE.forEach((c,i)=>{ const s=document.createElement('div'); s.className='swatch'+(i===0?' on':''); s.style.background=c;
    if(c==='#ffffff')s.style.border='3px solid #ccc';
    s.onclick=()=>{ Sound.click(); Draw.setColor(c); Draw.setTool('brush'); $$('#swatches .swatch').forEach(x=>x.classList.remove('on')); s.classList.add('on');
      $('tBrush').classList.add('on'); $('tEraser').classList.remove('on'); updateSizeDot(); };
    box.appendChild(s); });
}
function updateSizeDot(){ const d=$('sizeDot'), sz=clamp(Draw.getSize(),6,26); d.style.width=sz+'px'; d.style.height=sz+'px';
  d.style.background=Draw.getTool()==='eraser'?'#fff':Draw.getColor(); d.style.border=Draw.getTool()==='eraser'?'2px solid #999':'none'; }
function wireTools(){
  buildSwatches();
  $('tBrush').onclick=()=>{ Sound.click(); Draw.setTool('brush'); $('tBrush').classList.add('on'); $('tEraser').classList.remove('on'); updateSizeDot(); };
  $('tEraser').onclick=()=>{ Sound.click(); Draw.setTool('eraser'); $('tEraser').classList.add('on'); $('tBrush').classList.remove('on'); updateSizeDot(); };
  $('sizeSlider').addEventListener('input',e=>{ Draw.setSize(+e.target.value); updateSizeDot(); });
  $('tUndo').onclick=()=>{ Sound.click(); Draw.undo(); };
  $('tRedo').onclick=()=>{ Sound.click(); Draw.redo(); };
  $('tClear').onclick=()=>{ Sound.click(); Draw.clear(); };
  $('tBrush').classList.add('on'); updateSizeDot();
}

/* ============================================================
   Part 2: shared game state, HUD render, ONLINE multiplayer
   ============================================================ */
const MODE_TIME={secret:60,bluff:60,rush:20};
const MODE_NAME={secret:'🕵️ Secret Theme',bluff:'🎭 Draw & Bluff',rush:'⚡ Draw Rush'};
const REVEAL_MS=4200, CHOOSE_TIME=25;

let G=null;                 // active game (online or AI)
let R=null;                 // room (online)
let curCode=null;
let hbTimer=null,tickTimer=null,wdTimer=null,pingTimer=null,lobbyTimer=null;

function scoreFor(timerMax,timeLeft){ const el=timerMax-timeLeft, q=Math.max(1,timerMax/4); return [100,80,60,40][clamp(Math.floor(el/q),0,3)]; }
function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,''); }
function guessMatches(guess,word){ const a=norm(guess),b=norm(word); if(!a||!b)return false; if(a===b)return true;
  if(b.length>=4 && (a===b+'s'||a+'s'===b||a===b+'es'||a+'es'===b)) return true; return false; }

/* ---------- HUD / game render (shared) ---------- */
function pname(id){ if(!G)return 'Player'; if(id==='ai')return '🤖 AI'; if(id===myId)return myName(); const p=G.players&&G.players[id]; return p?p.name:'Player'; }
function amDrawer(){ return G && G.drawerId===myId; }
function renderGame(){
  if(!G)return;
  $('timer').textContent = G.phase==='over'?'🏁':(G.timeLeft!=null?G.timeLeft:'–');
  $('timer').classList.toggle('warn', G.phase==='draw' && G.timeLeft<=10 && G.timeLeft>0);
  $('roundTag').textContent = G.phase==='over'?'Final Score':('Round '+G.round+' / '+G.totalRounds+' · '+(MODE_NAME[G.mode]||''));
  // scoreboard
  const ids=G.order||Object.keys(G.scores||{});
  $('scoreboard').innerHTML=ids.map(id=>'<div class="sc'+(id===myId?' me':'')+'"><div class="n">'+esc(pname(id))+(G.drawerId===id&&G.phase!=='over'?' ✏️':'')+'</div><div class="v">'+(G.scores[id]|0)+'</div></div>').join('');
  // wordbar
  const wb=$('wordbar'); wb.classList.toggle('draw', amDrawer()&&G.phase==='draw');
  if(G.phase==='draw'){
    if(amDrawer()) wb.innerHTML = G.mode==='bluff' ? '🎭 Draw anything, then name it below!' : ('✏️ Draw: <span class="w">'+esc((G.word||'').toUpperCase())+'</span>');
    else wb.innerHTML = G.mode==='bluff' ? '🎨 Watch the artist…' : '🤔 Guess what it is!';
  } else if(G.phase==='choose'){ wb.innerHTML = amDrawer()?'🕵️ Did your bluff work?':'❓ Which is the REAL title?'; }
  else if(G.phase==='reveal'){ wb.innerHTML = '👀 It was <span class="w">'+esc(((G.mode==='bluff'?G.title:G.word)||'').toUpperCase())+'</span>'; }
  else wb.innerHTML='…';
  // canvas / tools / inputs
  const canDraw = amDrawer() && G.phase==='draw';
  Draw.setEnabled(canDraw);
  $('viewOnly').style.display = canDraw?'none':'block';
  $('tools').classList.toggle('on', canDraw);
  $('guessbar').classList.toggle('on', !amDrawer() && G.phase==='draw' && G.mode!=='bluff');
  $('titleInputWrap').style.display = (amDrawer() && G.phase==='draw' && G.mode==='bluff')?'block':'none';
  const bluffOn = !amDrawer() && G.phase==='choose' && G.mode==='bluff';
  $('bluffOpts').classList.toggle('on', bluffOn);
  if(bluffOn) renderBluffOptions();
  // universal "Done" button — whoever is drawing can finish early (bluff uses its own Submit Title)
  $('doneBtn').style.display = (amDrawer() && G.phase==='draw' && G.mode!=='bluff') ? 'block' : 'none';
}
function renderBluffOptions(){
  const box=$('bluffOpts'); if(box.getAttribute('data-r')===String(G.round)+G.phase && box.children.length){return;}
  box.setAttribute('data-r',String(G.round)+G.phase);
  box.innerHTML=(G.options||[]).map((o,i)=>'<button class="opt" data-i="'+i+'">'+esc(o)+'</button>').join('');
  box.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{ Sound.click(); submitChoose(+b.getAttribute('data-i')); });
}
function pushFeed(html,cls){ const f=$('feed'); const d=document.createElement('div'); d.className='g '+(cls||''); d.innerHTML=html; f.appendChild(d); f.scrollTop=f.scrollHeight; while(f.children.length>40)f.removeChild(f.firstChild); }
function clearFeed(){ $('feed').innerHTML=''; }

/* ============================================================
   ONLINE MULTIPLAYER (Supabase realtime, host-authoritative)
   ============================================================ */
function pav(){ return '🎨'; }
const MP={
  sb:null,ch:null,code:null,isHost:false,reopening:false,
  async ensure(){
    if(!(window.supabase&&window.supabase.createClient)){
      await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=res;s.onerror=()=>rej(new Error('cdn'));document.head.appendChild(s);});
    }
    if(!this.sb)this.sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_KEY,{auth:{persistSession:false},realtime:{params:{eventsPerSecond:30}}});
    return this.sb;
  },
  async open(code,host){this.code=code;this.isHost=host;await this.ensure();await this._sub();},
  _sub(){return new Promise((res,rej)=>{
    if(this.ch){try{this.sb.removeChannel(this.ch);}catch(e){}}
    const ch=this.sb.channel('dr-room-'+this.code,{config:{broadcast:{self:false},presence:{key:myId}}});
    ['hello','lobby','start','state','stroke','snap','guess','guessfeed','title','choose','drawerdone','ping','bye'].forEach(ev=>ch.on('broadcast',{event:ev},({payload})=>onNet(ev,payload)));
    ch.on('presence',{event:'sync'},()=>onNet('presence'));
    ch.on('presence',{event:'join'},()=>onNet('presence'));
    ch.on('presence',{event:'leave'},()=>onNet('presence'));
    let done=false;
    ch.subscribe(st=>{ if(st==='SUBSCRIBED'){done=true;this.reopening=false;try{ch.track({id:myId,name:myName(),av:pav(),t:Date.now()});}catch(e){}if(res){const r=res;res=null;r();}}
      else if((st==='CHANNEL_ERROR'||st==='TIMED_OUT'||st==='CLOSED')&&!done&&rej){done=true;rej(new Error(st));} });
    this.ch=ch;
  });},
  send(ev,payload){if(this.ch){try{this.ch.send({type:'broadcast',event:ev,payload:payload||{}});}catch(e){}}},
  roster(){try{const st=this.ch.presenceState(),a=[];for(const k in st){const p=st[k]&&st[k][0];if(p&&p.id)a.push({id:p.id,name:(p.name||'Player').slice(0,14),t:p.t||0});}a.sort((x,y)=>(x.id===myId?-1:y.id===myId?1:x.t-y.t));return a;}catch(e){return[];}},
  state(){return (this.ch&&this.ch.state)||'closed';},
  reopen(){if(this.reopening||!this.sb||!this.code)return;const s=this.state();if(s==='joined'||s==='joining')return;this.reopening=true;try{this._sub();}catch(e){this.reopening=false;}setTimeout(()=>this.reopening=false,6000);},
  leave(){if(this.ch){try{this.sb.removeChannel(this.ch);}catch(e){}}this.ch=null;this.code=null;this.isHost=false;}
};
function genCode(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<4;i++)s+=A[rnd(A.length)];return s;}
function shareLink(){return location.origin+location.pathname+'?room='+(R?R.code:'');}

/* ---- net router ---- */
function onNet(ev,payload){
  if(!R)return;
  if(ev==='presence'){ if(R.isHost){ hostPresence(); } if(curScreen==='lobby')renderLobby(); return; }
  if(ev==='hello'){ if(R.isHost){ hostPresence(); if(R.phase==='lobby')hostBroadcastLobby(); else if(G){ broadcastState(); if(amDrawer())MP.send('snap',{mid:G.mid,round:G.round,strokes:Draw.snapshot()}); } } return; }
  if(ev==='ping'){ if(R){R.seen=R.seen||{};if(payload&&payload.from)R.seen[payload.from]=Date.now();} return; }
  if(ev==='lobby'){ if(!R.isHost){ R.hostId=payload.hostId; R.mode=payload.mode; R.totalRounds=payload.totalRounds; R.players=payload.players||[]; renderLobby(); } return; }
  if(ev==='start'){ if(!R.isHost) startFromNet(payload); return; }
  if(ev==='state'){ if(!R.isHost) applyState(payload); return; }
  if(ev==='stroke'){ if(G&&payload&&payload.mid===G.mid && (payload.round==null||payload.round===G.round) && G.drawerId!==myId) Draw.applyStroke(payload); return; }
  if(ev==='snap'){ if(G&&payload&&payload.mid===G.mid && (payload.round==null||payload.round===G.round) && G.drawerId!==myId) Draw.applySnapshot(payload.strokes); return; }
  if(ev==='guess'){ if(R.isHost&&G) hostOnGuess(payload); return; }
  if(ev==='guessfeed'){ if(!R.isHost&&G&&payload&&payload.mid===G.mid) showGuess(payload.from,payload.txt,payload.correct); return; }
  if(ev==='title'){ if(R.isHost&&G) hostOnTitle(payload); return; }
  if(ev==='choose'){ if(R.isHost&&G) hostOnChoose(payload); return; }
  if(ev==='drawerdone'){ if(R.isHost&&G&&payload&&payload.mid===G.mid&&G.phase==='draw'&&payload.from===G.drawerId){ if(G.mode==='bluff')hostBeginChoose(); else hostReveal(false); } return; }
  if(ev==='bye'){ if(R&&R.isHost&&G&&G.phase!=='over'){ hostPresence(); } return; }
}

/* ---- create / join ---- */
async function createRoom(mode,rounds){
  const code=genCode(); R={code,isHost:true,hostId:myId,mode,totalRounds:rounds,phase:'lobby',players:[],seen:{},_mid:0};
  showLobby(code,true);
  try{ await MP.open(code,true); hostPresence(); hostBroadcastLobby(); startLobbyHost(); }
  catch(e){ toast('Connection failed — check internet'); leaveRoom(); show('online'); }
}
async function joinRoom(code){
  code=(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
  if(code.length<4){ toast('Enter the 4-letter code'); return; }
  R={code,isHost:false,hostId:null,phase:'lobby',players:[],seen:{}};
  showLobby(code,false); $('lobbyConn').textContent='connecting…';
  try{
    await MP.open(code,false);
    MP.send('hello',{id:myId,name:myName()});
    // validate: a host must be present within a few seconds
    let ok=false; for(let i=0;i<40;i++){ if(MP.roster().length>=2){ok=true;break;} await new Promise(r=>setTimeout(r,100)); }
    if(!ok){ toast('Room not found — check the code'); leaveRoom(); show('online'); return; }
    toast('✅ Connected!'); startGuestNet();
  }catch(e){ toast('Connection failed — check internet'); leaveRoom(); show('online'); }
}
function leaveRoom(){ stopAllTimers(); if(MP.ch){try{MP.send('bye',{from:myId});}catch(e){} MP.leave();} R=null; }

function showLobby(code,host){
  $('lobbyCode').textContent=code; $('hostStartWrap').style.display=host?'block':'none'; $('waitHostMsg').style.display=host?'none':'block';
  show('lobby'); renderLobby();
}
function renderLobby(){
  const roster=MP.roster(); const box=$('lobbyPlayers');
  const slots=[]; for(let i=0;i<2;i++){ const p=roster[i]; slots.push('<div class="pcard'+(p?' ready':'')+'"><div class="av">'+(p?'🎨':'⏳')+'</div><div class="nm">'+(p?esc(p.name)+(p.id===myId?' (you)':''):'Waiting…')+'</div><div class="st">'+(p?'Ready':'empty')+'</div></div>'); }
  box.innerHTML=slots.join('');
  $('lobbyMode').textContent=(MODE_NAME[R&&R.mode]||'')+' · '+((R&&R.totalRounds)||6)+' rounds';
  $('lobbyConn').style.color=MP.state()==='joined'?'#22d39a':'#ffd23f';
  if(R&&R.isHost){ const two=roster.length>=2; $('startGameBtn').disabled=!two; $('startHint').textContent=two?'Both players ready! 🎉':'Waiting for a second player…'; }
}
function hostPresence(){ if(R&&R.isHost&&R.phase==='lobby') renderLobby(); }
function hostBroadcastLobby(){ if(!R||!R.isHost)return; R.players=MP.roster(); MP.send('lobby',{hostId:myId,mode:R.mode,totalRounds:R.totalRounds,players:R.players}); }
function startLobbyHost(){ stopAllTimers(); lobbyTimer=setInterval(()=>{ if(!R||!R.isHost||R.phase!=='lobby'){clearInterval(lobbyTimer);lobbyTimer=null;return;} hostBroadcastLobby(); if(MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen(); },2500); }
function startGuestNet(){ stopAllTimers(); pingTimer=setInterval(()=>{ if(!R){clearInterval(pingTimer);return;} MP.send('ping',{from:myId}); if(MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen(); },3500); }
function stopAllTimers(){ [hbTimer,tickTimer,wdTimer,pingTimer,lobbyTimer].forEach(t=>t&&clearInterval(t)); hbTimer=tickTimer=wdTimer=pingTimer=lobbyTimer=null; }

/* ---- host: game control ---- */
function hostStartGame(){
  const roster=MP.roster(); if(roster.length<2){ toast('Need a second player'); return; }
  const ids=roster.slice(0,2).map(p=>p.id);
  R.phase='playing'; const mid=(R._mid=(R._mid||0)+1);
  G={ gen:(G&&G.gen||0)+1, mid, mode:R.mode, online:true, isHost:true, vsAI:false,
      totalRounds:R.totalRounds, round:0, phase:'reveal', order:ids, players:{}, scores:{},
      drawerId:null, firstDrawer:ids[rnd(2)], timerMax:MODE_TIME[R.mode], timeLeft:0, word:'', title:'', options:[], solved:false, seq:0 };
  roster.forEach(p=>{ G.players[p.id]={name:p.name}; G.scores[p.id]=0; });
  MP.send('start',serializeStart());
  stopAllTimers(); startHostNet();
  enterGame(); hostNextRound();
}
function serializeStart(){ return {mid:G.mid,mode:G.mode,totalRounds:G.totalRounds,order:G.order,players:G.players,scores:G.scores,firstDrawer:G.firstDrawer,timerMax:G.timerMax}; }
function startFromNet(s){
  R.phase='playing';
  G={ gen:(G&&G.gen||0)+1, mid:s.mid, mode:s.mode, online:true, isHost:false, vsAI:false,
      totalRounds:s.totalRounds, round:0, phase:'reveal', order:s.order, players:s.players, scores:s.scores,
      drawerId:null, timerMax:s.timerMax, timeLeft:0, word:'', title:'', options:[], solved:false, _rseq:-1 };
  stopAllTimers(); startGuestNet();
  enterGame(); renderGame();
}
function onlineStrokeHook(msg){ if(G&&G.online) MP.send('stroke',Object.assign({mid:G.mid,round:G.round},msg)); }
function onlineOpHook(msg){ if(G&&G.online&&msg&&msg.op==='snap') MP.send('snap',{mid:G.mid,round:G.round,strokes:msg.strokes}); }
function enterGame(){ clearFeed(); closeOv(); $('canvasWrap').style.transform=''; Draw.setHooks(G&&G.online?onlineStrokeHook:null, G&&G.online?onlineOpHook:null); show('game'); requestAnimationFrame(()=>{ Draw.applySnapshot([]); Draw.resize(); }); }

function startHostNet(){
  const g=G.gen;
  hbTimer=setInterval(()=>{ if(!G||G.gen!==g){clearInterval(hbTimer);return;} broadcastState(); if(amDrawer()&&G.phase==='draw')MP.send('snap',{mid:G.mid,round:G.round,strokes:Draw.snapshot()}); if(R&&MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen(); },3000);
}
function broadcastState(){ if(!G||!G.isHost)return; G.seq++; G._lastState=serialize(); MP.send('state',G._lastState); }
function serialize(){ return {mid:G.mid,seq:G.seq,round:G.round,totalRounds:G.totalRounds,phase:G.phase,drawerId:G.drawerId,
  word:G.word,title:G.title,options:G.options,timeLeft:G.timeLeft,timerMax:G.timerMax,scores:G.scores,order:G.order,players:G.players,result:G.result||null}; }
function applyState(s){
  if(!G||G.isHost||!s)return; if(s.mid!==G.mid)return;
  if(s.seq!=null){ if(G._rseq!=null&&s.seq<=G._rseq)return; G._rseq=s.seq; }
  const prevPhase=G.phase, prevRound=G.round;
  G.round=s.round;G.totalRounds=s.totalRounds;G.phase=s.phase;G.drawerId=s.drawerId;G.word=s.word;G.title=s.title;G.options=s.options;
  G.timeLeft=s.timeLeft;G.timerMax=s.timerMax;G.scores=s.scores;G.order=s.order;G.players=s.players;G.result=s.result;
  if(s.round!==prevRound || (s.phase==='draw'&&prevPhase!=='draw')){ clearFeed(); if(G.drawerId!==myId) Draw.applySnapshot([]); else Draw.applySnapshot([]); }
  renderGame();
  if(G.phase==='reveal' && prevPhase!=='reveal') onReveal();
  if(G.phase==='over' && prevPhase!=='over') onGameOver();
}

function hostNextRound(){
  if(!G||!G.isHost)return;
  if(G.round>=G.totalRounds){ hostGameOver(); return; }
  G.round++; G.solved=false; G.result=null;
  // swap drawer each round
  G.drawerId = G.round===1 ? G.firstDrawer : (G.order[0]===G.drawerId?G.order[1]:G.order[0]);
  G.word = G.mode==='bluff' ? '' : pick(G.mode==='rush'?DATA.easy:DATA.words);
  G.title=''; G.options=[]; G.timerMax=MODE_TIME[G.mode]; G.timeLeft=G.timerMax; G.phase='draw';
  clearFeed(); Draw.clear(false); Draw.applySnapshot([]);
  broadcastState();
  renderGame();
  if(amDrawer()) SV.stats.drawings++, save();
  startTick();
}
function startTick(){
  if(tickTimer)clearInterval(tickTimer); const g=G.gen;
  tickTimer=setInterval(()=>{
    if(!G||G.gen!==g||!G.isHost){clearInterval(tickTimer);return;}
    if(G._paused){ return; }                              // frozen during a disconnect
    if(G.phase!=='draw'&&G.phase!=='choose'){ return; }
    G.timeLeft--; if(G.timeLeft<=5&&G.timeLeft>0)Sound.tick();
    if(G.timeLeft<=0){ clearInterval(tickTimer); tickTimer=null;
      if(G.phase==='draw'){ if(G.mode==='bluff')hostBeginChoose(); else hostReveal(false); }
      else if(G.phase==='choose'){ hostChooseTimeout(); }   // chooser never picked → don't hang
      return; }
    broadcastState(); renderGame();
  },1000);
}
function hostChooseTimeout(){ if(!G||!G.isHost||G.phase!=='choose')return; G.result={type:'bluff',right:false,by:null,chosen:null}; G.scores[G.drawerId]=(G.scores[G.drawerId]|0)+50; hostReveal(false,G.drawerId); }
function hostOnGuess(p){
  if(!G||!G.isHost||G.phase!=='draw'||G.mode==='bluff')return;
  if(!p||!G.order||G.order.indexOf(p.from)<0||p.from===G.drawerId)return;   // only the guesser in this game
  const txt=String(p.text||'').slice(0,40);
  const correct=guessMatches(txt,G.word);
  netFeed(p.from,txt,correct);
  if(correct) hostReveal(true,p.from);
}
function netFeed(from,txt,correct){ MP.send('guessfeed',{mid:G.mid,from,txt,correct}); showGuess(from,txt,correct); }
function hostBeginChoose(){
  if(!G||!G.isHost)return;
  if(!G.title){ // drawer never submitted a title → auto title
    G.title=(pick(DATA.adjectives)+' '+pick(DATA.bluffNouns)); }
  G.options=makeBluffOptions(G.title); G.phase='choose'; G.timerMax=CHOOSE_TIME; G.timeLeft=CHOOSE_TIME;
  broadcastState(); renderGame(); startTick();     // give the chooser a real countdown (and a hard timeout)
}
function hostOnTitle(p){ if(!G||!G.isHost||G.mode!=='bluff'||G.phase!=='draw')return; if(p.from!==G.drawerId)return;
  G.title=String(p.title||'').slice(0,40)||('My '+pick(DATA.bluffNouns)); if(tickTimer){clearInterval(tickTimer);tickTimer=null;} hostBeginChoose(); }
function hostOnChoose(p){ if(!G||!G.isHost||G.mode!=='bluff'||G.phase!=='choose')return; if(!p||!G.order||G.order.indexOf(p.from)<0||p.from===G.drawerId)return;
  const chosen=G.options[p.idx]; const right=chosen===G.title;
  G.result={type:'bluff',right,by:p.from,chosen};
  if(right){ G.scores[p.from]=(G.scores[p.from]|0)+100; } else { G.scores[G.drawerId]=(G.scores[G.drawerId]|0)+100; }
  hostReveal(right,right?p.from:G.drawerId);
}
function hostReveal(solved,by){
  if(!G||!G.isHost)return; if(tickTimer){clearInterval(tickTimer);tickTimer=null;}
  G.solved=!!solved; G.phase='reveal';
  if(solved && G.mode!=='bluff'){ const pts=scoreFor(G.timerMax,G.timeLeft); const gid=by, did=G.drawerId;
    G.scores[gid]=(G.scores[gid]|0)+pts; G.scores[did]=(G.scores[did]|0)+pts; G.result={type:'guess',by:gid,pts}; }
  broadcastState(); renderGame(); onReveal();
  scheduleReveal();
}
function scheduleReveal(){ if(!G)return; const g=G.gen; if(G._revealT)clearTimeout(G._revealT);
  G._revealT=setTimeout(()=>{ G&&(G._revealT=null); if(G&&G.gen===g&&G.isHost&&!G._paused) hostNextRound(); }, REVEAL_MS); }
function hostGameOver(){ if(!G||!G.isHost)return; G.phase='over'; broadcastState(); renderGame(); onGameOver(); }

/* ---- client actions ---- */
function sendGuess(){
  const inp=$('guessInput'); const t=inp.value.trim(); if(!t)return; inp.value='';
  if(!G)return;
  if(G.isHost){ hostOnGuess({from:myId,text:t}); }
  else { MP.send('guess',{mid:G.mid,from:myId,text:t}); }
}
function submitTitle(){ const t=$('titleInput').value.trim(); if(!t){toast('Give it a title!');return;} $('titleInput').value='';
  if(G.isHost)hostOnTitle({from:myId,title:t}); else MP.send('title',{mid:G.mid,from:myId,title:t}); toast('Title submitted!'); }
function submitChoose(idx){ if(G.isHost)hostOnChoose({from:myId,idx}); else MP.send('choose',{mid:G.mid,from:myId,idx}); }
function showGuess(from,txt,correct){
  if(correct===true) pushFeed('🎉 <b>'+esc(pname(from))+'</b> guessed it!','correct');
  else pushFeed('<b>'+esc(pname(from))+':</b> '+esc(txt), from===myId?'me':'');
}
function makeBluffOptions(title){
  const opts=new Set([title]); let tries=0;
  while(opts.size<4 && tries<40){ tries++; opts.add(bluffVariant(title)); }
  while(opts.size<4){ opts.add(pick(DATA.adjectives)+' '+pick(DATA.bluffNouns)); }
  const arr=[...opts]; for(let i=arr.length-1;i>0;i--){const j=rnd(i+1);[arr[i],arr[j]]=[arr[j],arr[i]];} return arr;
}
function bluffVariant(title){
  const words=title.split(/\s+/); if(words.length>=2){ const i=rnd(words.length); const w=words.slice(); w[i]= (i===0?pick(DATA.adjectives):pick(DATA.bluffNouns)); const v=w.join(' '); if(v!==title)return v; }
  return pick(DATA.adjectives)+' '+title;
}

function onReveal(){
  const solved=G.solved, mine=(G.result&&(G.result.by===myId));
  if(G.mode==='bluff'){
    if(G.result&&G.result.type==='bluff'){ if(G.result.right){ if(mine){Sound.correct();confetti(50);} else Sound.wrong(); } else { if(G.drawerId===myId){Sound.correct();confetti(50);} else Sound.wrong(); } }
    // highlight options
    const box=$('bluffOpts'); if(box.classList.contains('on')){ box.querySelectorAll('.opt').forEach(b=>{ const t=b.textContent; if(t===G.title)b.classList.add('right'); else if(G.result&&t===G.result.chosen)b.classList.add('wrong'); }); }
  } else {
    if(solved){ if(mine||G.drawerId===myId){Sound.correct(); if(mine)confetti(50);} pushFeed('✅ The word was <b>'+esc((G.word||'').toUpperCase())+'</b>','sys'); }
    else { Sound.wrong(); pushFeed('⏰ Time! The word was <b>'+esc((G.word||'').toUpperCase())+'</b>','sys'); }
  }
  if(!amDrawer() && solved && G.mode!=='bluff' && mine){ SV.stats.correct++; if(G.result&&G.result.pts){ /* time tracked below */ } save(); }
  renderGame();
}
function onGameOver(){
  stopAllTimers();
  const ids=G.order; const my=G.scores[myId]|0, opId=ids.find(i=>i!==myId), op=G.scores[opId]|0;
  const win=my>op, tie=my===op;
  SV.stats.played++; if(win)SV.stats.wins++; SV.stats.modes[G.mode]=(SV.stats.modes[G.mode]||0)+1; save();
  if(win){Sound.win();confetti(140);} else if(!tie)Sound.lose();
  openOv('<div class="big-emoji">'+(win?'🏆':tie?'🤝':'🎨')+'</div><h2>'+(win?'You Win!':tie?"It's a Tie!":'Good Game!')+'</h2>'
    +'<p>'+esc(myName())+' <b>'+my+'</b> &nbsp;—&nbsp; '+esc(pname(opId))+' <b>'+op+'</b></p>'
    +'<div class="btns"><button class="btn" id="ovAgain">🔁 Play again</button><button class="btn ghost" id="ovMenu">🏠 Menu</button></div>');
  $('ovAgain').onclick=()=>{ Sound.click(); closeOv(); if(G.isHost){ hostStartGame(); } else { toast('Waiting for host…'); show('lobby'); } };
  $('ovMenu').onclick=()=>{ Sound.click(); closeOv(); quitGame(); };
}
function quitGame(){ const wasOnline=G&&G.online; if(G&&G._revealT)clearTimeout(G._revealT); G=null; stopAllTimers(); stopAI(); Draw.setEnabled(false); $('canvasWrap').style.transform=''; if(wasOnline)leaveRoom(); closeOv(); show('menu'); }

/* ---------- disconnect / reconnect overlay ---------- */
function showDisc(on){ if(on){ if($('ov').classList.contains('on')&&$('ovBox').getAttribute('data-disc'))return;
    openOv('<div class="big-emoji">🔌</div><h2>Player Disconnected</h2><p>Waiting to reconnect… hang tight, the game will resume automatically.</p>');
    $('ovBox').setAttribute('data-disc','1'); }
  else { if($('ovBox').getAttribute('data-disc')){ $('ovBox').removeAttribute('data-disc'); closeOv(); } } }

/* ============================================================
   Part 3: AI modes, boot & wiring
   ============================================================ */
let aiTimer=null;
function stopAI(){ if(aiTimer){clearInterval(aiTimer);aiTimer=null;} }
function startAI(aimode){
  Sound.click(); stopAllTimers(); stopAI();
  const time = aimode==='disaster'?45 : aimode==='judge'?50 : 60;
  const uiMode = aimode==='bluff'?'bluff':(aimode==='secret'?'secret':aimode);
  const word = aimode==='judge'?pick(DATA.easy):(aimode==='bluff'?'':pick(aimode==='disaster'?DATA.easy:DATA.words));
  G={ gen:(G&&G.gen||0)+1, mode:uiMode, aimode, vsAI:true, online:false, isHost:true,
      totalRounds:1, round:1, phase:'draw', drawerId:myId, order:[myId,'ai'], players:{[myId]:{name:myName()},ai:{name:'AI'}},
      scores:{[myId]:0,ai:0}, word, title:'', options:[], timerMax:time, timeLeft:time, solved:false, result:null,
      _aiNextGuess:9, _aiGuessed:false, _events:0 };
  Draw.setHooks(null,null);
  clearFeed(); show('game'); Draw.setEnabled(true);
  requestAnimationFrame(()=>{ Draw.applySnapshot([]); $('canvasWrap').style.transform=''; Draw.resize(); renderAIWordbar(); });
  renderGame();
  if(aimode==='judge') $('wordbar').innerHTML='✏️ Draw a <span class="w">'+esc(word.toUpperCase())+'</span> — the AI will rate it!';
  if(aimode==='secret') pushFeed('🤖 AI: I\'m watching… show me what you\'ve got!','sys');
  if(aimode==='disaster') pushFeed('🌪️ Survive the chaos! Draw a '+esc(word.toUpperCase())+'.','sys');
  aiTimer=setInterval(aiTick,1000);
  Sound.start();
}
function renderAIWordbar(){ if(!G)return; if(G.aimode==='bluff'){ $('wordbar').innerHTML='🎭 Draw anything, then name it below!'; $('titleInputWrap').style.display='block'; } }
function aiTick(){
  if(!G||!G.vsAI){ stopAI(); return; }
  if(G.phase!=='draw'){ return; }
  G.timeLeft--; if(G.timeLeft<=5&&G.timeLeft>0)Sound.tick(); renderGame();
  // per-mode behaviour
  if(G.aimode==='secret'){
    if(!G._aiGuessed && G.timeLeft<=G._aiNextGuess){ aiSecretGuess(); G._aiNextGuess=G.timeLeft-(6+rnd(4)); }
  } else if(G.aimode==='disaster'){
    if(G.timeLeft%6===0 && G.timeLeft>2) fireDisaster();
  }
  if(G.timeLeft<=0){ stopAI(); aiFinish(); }
}
function aiSecretGuess(){
  if(!G||G._aiGuessed)return;
  const drawn=Draw.analyze(); const progress=clamp(drawn.strokes/8 + drawn.coverage,0,1);
  const chance=clamp(progress*0.5 + (1-G.timeLeft/G.timerMax)*0.25, .05, .7);
  if(Math.random()<chance){ G._aiGuessed=true; pushFeed('🤖 AI: Is it a <b>'+esc(G.word.toUpperCase())+'</b>? 🎯','correct'); Sound.correct(); confetti(50);
    const pts=scoreFor(G.timerMax,G.timeLeft); G.scores[myId]+=pts; G.scores.ai+=0; SV.stats.correct=SV.stats.correct; renderGame();
    G._won=true; setTimeout(()=>{ if(G&&G.vsAI){ stopAI(); aiFinish(); } },1400); return; }
  // funny wrong guess
  const cat=Object.keys(DATA.categories).find(k=>DATA.categories[k].indexOf(G.word)>=0);
  const pool=(cat&&Math.random()<.5)?DATA.categories[cat]:DATA.words;
  let g=pick(pool); if(g===G.word)g=pick(DATA.words);
  const pre=pick(['Is it a','Hmm… a','Maybe a','Ooh! A','Looks like a','Definitely a']);
  pushFeed('🤖 AI: '+pre+' <b>'+esc(g)+'</b>? '+pick(['🤔','😅','👀','🧐']),'');
}
function aiFinish(){
  if(!G)return;
  if(G.aimode==='secret'){ const won=!!G._won; endAIResult(won?'🎯':'⏰', won?'AI guessed it!':"AI couldn't guess it!",
      won?('You drew a great <b>'+esc(G.word.toUpperCase())+'</b>! +'+ (G.scores[myId]) +' pts'):('The word was <b>'+esc(G.word.toUpperCase())+'</b>. Try clearer drawings!'), won); return; }
  if(G.aimode==='disaster'){ $('canvasWrap').style.transform=''; aiJudge(true); return; }
  if(G.aimode==='judge'){ aiJudge(false); return; }
  if(G.aimode==='bluff'){ aiBluffFinish(); return; }
}
/* --- AI Bluff --- */
function submitTitleAI(){ const t=$('titleInput').value.trim(); if(!t){toast('Give it a title!');return;}
  G.title=t.slice(0,40); $('titleInputWrap').style.display='none'; stopAI(); aiBluffFinish(); }
function aiBluffFinish(){
  if(!G.title)G.title=(pick(DATA.adjectives)+' '+pick(DATA.bluffNouns));
  G.options=makeBluffOptions(G.title); Draw.setEnabled(false);
  // AI picks: real title with ~45% chance, else a fake (you fooled it)
  const realIdx=G.options.indexOf(G.title); const aiRight=Math.random()<.45; let aiPick;
  if(aiRight)aiPick=realIdx; else { const fakes=G.options.map((o,i)=>i).filter(i=>i!==realIdx); aiPick=pick(fakes); }
  const fooled=!aiRight;
  if(fooled)G.scores[myId]+=100; else G.scores.ai+=100;
  const reason=pick(['The linework screams it.','Trust me, I have great taste.','That one just feels right.','Elementary, really.','My circuits are rarely wrong…']);
  openOv('<div class="big-emoji">🤖</div><h2>AI picks…</h2><p>“'+esc(G.options[aiPick])+'” — '+esc(reason)+'</p>'
    +'<p style="margin-top:10px">'+(fooled?'🎉 <b>You fooled the AI!</b> The real title was “'+esc(G.title)+'”. +100':'🧠 <b>The AI guessed right!</b> Real title: “'+esc(G.title)+'”.')+'</p>'
    +'<div class="btns"><button class="btn" id="ovAgain">🔁 Again</button><button class="btn ghost" id="ovMenu">🏠 Menu</button></div>');
  finishAIButtons(fooled);
}
/* --- AI Judge (heuristic rating) --- */
function aiJudge(disaster){
  Draw.setEnabled(false); const a=Draw.analyze();
  const detail=clamp(Math.round(2 + a.strokes*0.9 + a.points/60),1,10);
  const creativity=clamp(Math.round(3 + a.colors*1.3 + a.strokes*0.4 + rnd(2)),1,10);
  const accuracy=clamp(Math.round(3 + a.coverage*7 + (a.bw>.2&&a.bh>.2?1:0)),1,10);
  const overall=clamp(Math.round((detail+creativity+accuracy)/3 + (disaster?1:0)),1,10);
  const fb=[]; if(detail>=7)fb.push('Lovely detail!'); else fb.push('Try adding a few more details.');
  if(a.colors>=3)fb.push('Great use of colour.'); else fb.push('More colours could pop.');
  if(a.coverage<.15)fb.push('Fill more of the canvas next time.'); else fb.push('Nice use of the space.');
  if(disaster)fb.push('…and you survived the CHAOS! 🌪️');
  const bar=(l,v)=>'<div class="judge-row"><span style="min-width:78px;text-align:left">'+l+'</span><div class="judge-bar"><span style="width:'+(v*10)+'%"></span></div><span class="judge-score">'+v+'/10</span></div>';
  openOv('<div class="big-emoji">⭐</div><h2>AI Judge</h2>'
    +'<p>Subject: <b>'+esc((G.word||'').toUpperCase())+'</b></p>'
    +bar('Creativity',creativity)+bar('Detail',detail)+bar('Accuracy',accuracy)+bar('Overall',overall)
    +'<p style="margin-top:10px">💬 '+esc(fb.join(' '))+'</p>'
    +'<div class="btns"><button class="btn" id="ovAgain">🔁 Again</button><button class="btn ghost" id="ovMenu">🏠 Menu</button></div>');
  if(overall>=8){Sound.win();confetti(120);}else Sound.pop();
  finishAIButtons(overall>=6);
}
function endAIResult(emoji,title,body,good){
  Draw.setEnabled(false);
  SV.stats.played++; if(good)SV.stats.wins++; save();
  openOv('<div class="big-emoji">'+emoji+'</div><h2>'+title+'</h2><p>'+body+'</p>'
    +'<div class="btns"><button class="btn" id="ovAgain">🔁 Again</button><button class="btn ghost" id="ovMenu">🏠 Menu</button></div>');
  if(good){Sound.win();confetti(100);}else Sound.lose();
  finishAIButtons(good);
}
function finishAIButtons(){ SV.stats.played=SV.stats.played; SV.stats.modes[G.aimode]=(SV.stats.modes[G.aimode]||0)+1; if(G.aimode==='bluff'||G.aimode==='judge'||G.aimode==='disaster'){ SV.stats.played++; } save();
  const am=G.aimode;
  galleryBtn(G.word||'');
  $('ovAgain').onclick=()=>{ Sound.click(); closeOv(); startAI(am); };
  $('ovMenu').onclick=()=>{ Sound.click(); closeOv(); quitGame(); };
}
// add a "Save to Gallery" button to a result overlay (only if the gallery module is loaded).
function galleryBtn(defTitle){ if(!window.Gallery||!window.Gallery.openSave)return; const box=$('ovBox'); const btns=box.querySelector('.btns'); if(!btns||box.querySelector('#ovSaveGal'))return;
  if(Draw.isEmpty())return;   // nothing drawn -> nothing to save
  const b=document.createElement('button'); b.id='ovSaveGal'; b.className='btn cyan block'; b.style.marginBottom='8px';
  b.innerHTML='🖼️ Save to Gallery'; b.onclick=()=>{ Sound.click(); const img=window.DrawRushAPI.imageDataURL(); window.Gallery.openSave(img,defTitle||''); };
  btns.parentNode.insertBefore(b,btns);
}
/* disaster events */
function fireDisaster(){
  const wrap=$('canvasWrap'), tag=$('disasterTag');
  const events=[
    ()=>{ Draw.setColor(pick(PALETTE.filter(c=>c!=='#ffffff'))); return '🎨 Colour swap!'; },
    ()=>{ const s=6+rnd(34); Draw.setSize(s); $('sizeSlider').value=s; updateSizeDot(); return '🖌️ Brush went wild!'; },
    ()=>{ wrap.style.transition='transform .4s'; wrap.style.transform='rotate('+(rnd(2)?12:-12)+'deg)'; setTimeout(()=>{wrap.style.transform='';},3800); return '🌀 Canvas tilt!'; },
    ()=>{ wrap.style.transition='transform .4s'; wrap.style.transform='scaleX(-1)'; setTimeout(()=>{wrap.style.transform='';},3200); return '🔁 Mirror mode!'; },
    ()=>{ wrap.style.transition='transform .5s'; wrap.style.transform='rotate(180deg)'; setTimeout(()=>{wrap.style.transform='';},3000); return '🙃 Upside down!'; },
    ()=>{ Draw.setTool(Draw.getTool()==='eraser'?'brush':'eraser'); return '😈 Tool flipped!'; }
  ];
  const msg=pick(events)(); Sound.disaster(); tag.textContent=msg; tag.classList.remove('show'); void tag.offsetWidth; tag.classList.add('show');
  setTimeout(()=>tag.classList.remove('show'),1800); G._events++;
}

/* ---------- stats / settings render ---------- */
function renderStats(){
  const s=SV.stats; const avg=s.guessTimeN?Math.round(s.guessTimeSum/s.guessTimeN):0;
  const items=[['🎮',s.played,'Played'],['🏆',s.wins,'Wins'],['🎯',s.correct,'Correct'],['🖼️',s.drawings,'Drawings'],['⚡',s.played?Math.round(s.wins/s.played*100)+'%':'0%','Win rate'],['✏️',(s.modes&&Object.keys(s.modes).length)||0,'Modes tried']];
  $('statGrid').innerHTML=items.map(i=>'<div class="stat"><div class="v">'+i[0]+' '+i[1]+'</div><div class="l">'+i[2]+'</div></div>').join('');
  let fav='—',mx=0; for(const k in (s.modes||{})){ if(s.modes[k]>mx){mx=s.modes[k];fav=k;} }
  const FN={secret:'🕵️ Secret Theme',bluff:'🎭 Draw & Bluff',rush:'⚡ Draw Rush',disaster:'🌪️ Disaster',judge:'⭐ AI Judge'};
  $('favMode').textContent=FN[fav]||fav;
}
function renderSettings(){ $('tSound').textContent=SV.sound?'On':'Off'; $('tMusic').textContent=SV.music?'On':'Off'; $('setName').value=SV.name||''; }

/* ============================================================
   BOOT
   ============================================================ */
let createMode='secret', createRounds=6;
function boot(){
  wireCanvas(); wireTools();
  // nav
  $$('[data-go]').forEach(b=>b.onclick=()=>{ Sound.click(); const g=b.getAttribute('data-go'); if(g==='stats')renderStats(); if(g==='settings')renderSettings(); show(g); });
  $$('[data-back]').forEach(b=>b.onclick=()=>{ Sound.click(); show(b.getAttribute('data-back')); });
  // online
  $('createRoomBtn').onclick=()=>{ Sound.click(); show('createSetup'); };
  $('modeGrid').addEventListener('click',e=>{ const c=e.target.closest('.modecard'); if(!c)return; Sound.click(); createMode=c.getAttribute('data-mode'); $$('#modeGrid .modecard').forEach(x=>x.classList.toggle('on',x===c)); });
  $('roundsSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return; Sound.click(); createRounds=+b.getAttribute('data-r'); $$('#roundsSeg button').forEach(x=>x.classList.toggle('on',x===b)); });
  $('doCreateBtn').onclick=()=>{ Sound.click(); createRoom(createMode,createRounds); };
  $('joinRoomBtn').onclick=()=>{ Sound.click(); joinRoom($('joinCode').value); };
  $('joinCode').addEventListener('keydown',e=>{ if(e.key==='Enter')joinRoom($('joinCode').value); });
  $('leaveLobbyBtn').onclick=()=>{ Sound.click(); leaveRoom(); show('online'); };
  $('startGameBtn').onclick=()=>{ Sound.click(); hostStartGame(); };
  $('shareBtn').onclick=async()=>{ Sound.click(); try{ if(navigator.share){await navigator.share({title:'Draw Rush',text:'Join my Draw Rush room — code '+(R?R.code:''),url:shareLink()});return;} }catch(e){} try{await navigator.clipboard.writeText(shareLink());toast('Link copied!');}catch(e){toast(shareLink());} };
  $('copyBtn').onclick=async()=>{ Sound.click(); try{await navigator.clipboard.writeText(R?R.code:'');toast('Code copied!');}catch(e){toast('Code: '+(R?R.code:''));} };
  // AI menu
  $('ai').addEventListener('click',e=>{ const c=e.target.closest('[data-ai]'); if(!c)return; startAI(c.getAttribute('data-ai')); });
  // game controls
  $('quitGameBtn').onclick=()=>{ Sound.click(); openOv('<h2>Quit game?</h2><p>Your current game will end.</p><div class="btns"><button class="btn ghost" id="ovNo">Stay</button><button class="btn" id="ovYes">Quit</button></div>'); $('ovNo').onclick=closeOv; $('ovYes').onclick=()=>{closeOv();stopAI();quitGame();}; };
  $('guessSend').onclick=()=>{ Sound.click(); sendGuess(); };
  $('guessInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ sendGuess(); } });
  $('doneBtn').onclick=()=>{ Sound.click(); if(!G)return; if(G.vsAI){ stopAI(); aiFinish(); } else if(G.online){ if(G.isHost)hostReveal(false); else MP.send('drawerdone',{mid:G.mid,from:myId}); } };
  $('titleSubmit').onclick=()=>{ Sound.click(); if(G&&G.vsAI)submitTitleAI(); else submitTitle(); };
  $('titleInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ if(G&&G.vsAI)submitTitleAI(); else submitTitle(); } });
  // settings
  $('tSound').onclick=()=>{ SV.sound=!SV.sound; save(); renderSettings(); if(SV.sound)Sound.click(); };
  $('tMusic').onclick=()=>{ SV.music=!SV.music; save(); renderSettings(); };
  $('setName').addEventListener('input',e=>{ SV.name=e.target.value.slice(0,14); save(); });
  $('resetStats').onclick=()=>{ openOv('<h2>Reset stats?</h2><p>This clears your record.</p><div class="btns"><button class="btn ghost" id="ovNo">Cancel</button><button class="btn" id="ovYes">Reset</button></div>'); $('ovNo').onclick=closeOv; $('ovYes').onclick=()=>{ SV.stats=defSave().stats; save(); renderStats(); closeOv(); toast('Stats reset'); }; };
  // auto-join from ?room=
  try{ const rc=new URLSearchParams(location.search).get('room'); if(rc){ const code=rc.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4); if(code.length===4){ show('online'); setTimeout(()=>joinRoom(code),500); } } }catch(e){}
}
// online host disconnect watchdog folds into the heartbeat (added here so G is in scope)
const _origStartHostNet=startHostNet;
startHostNet=function(){ const g=G.gen;
  if(hbTimer)clearInterval(hbTimer);
  hbTimer=setInterval(()=>{
    if(!G||G.gen!==g){clearInterval(hbTimer);return;}
    broadcastState(); if(amDrawer()&&G.phase==='draw')MP.send('snap',{mid:G.mid,round:G.round,strokes:Draw.snapshot()});
    if(R&&MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen();
    if(G.phase!=='over'){ const two=MP.roster().length>=2;
      if(!two&&!G._paused){ G._paused=true; if(tickTimer){clearInterval(tickTimer);tickTimer=null;} if(G._revealT){clearTimeout(G._revealT);G._revealT=null;G._revealPending=true;} showDisc(true); }
      else if(two&&G._paused){ G._paused=false; showDisc(false); broadcastState(); if(amDrawer())MP.send('snap',{mid:G.mid,round:G.round,strokes:Draw.snapshot()});
        if(G._revealPending){ G._revealPending=false; scheduleReveal(); } else if(G.phase==='draw'||G.phase==='choose') startTick(); }
    }
  },3000);
};
// guest reconnect watchdog: applyState refreshes _lastStateAt; ping loop checks staleness
const _origApplyState=applyState;
applyState=function(s){ _origApplyState(s); if(G&&!G.isHost){ G._lastStateAt=Date.now(); showDisc(false); } };
const _origStartGuestNet=startGuestNet;
startGuestNet=function(){ stopAllTimers(); pingTimer=setInterval(()=>{ if(!R){clearInterval(pingTimer);return;} MP.send('ping',{from:myId});
  if(MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen();
  if(G&&!G.isHost&&G.phase!=='over'&&G._lastStateAt&&Date.now()-G._lastStateAt>12000){ showDisc(true); MP.reopen(); }
},3500); };

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();

/* ---- public API for the (isolated) Community Gallery module. Read-only helpers;
   does NOT expose or alter any gameplay/multiplayer state. ---- */
window.DrawRushAPI={
  show:show, openOv:openOv, closeOv:closeOv, toast:toast, esc:esc, sound:Sound,
  userName:()=>myName(),
  getClient:()=>MP.ensure(),                      // shared Supabase client (lazy)
  strokes:()=>Draw.snapshot(),
  imageDataURL:()=>{ try{ const c=$('canvas'); const t=document.createElement('canvas'); t.width=c.width||600; t.height=c.height||450; const x=t.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,t.width,t.height); x.drawImage(c,0,0); return t.toDataURL('image/png'); }catch(e){ return null; } },
  // render a strokes-array into an arbitrary <canvas> (used for gallery previews if needed)
  renderStrokesTo:(canvas,list)=>{ try{ const ctx=canvas.getContext('2d'); const W=canvas.width,H=canvas.height; ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
      (list||[]).forEach(s=>{ ctx.lineWidth=Math.max(1,s.w*W); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=s.c; ctx.fillStyle=s.c; ctx.globalCompositeOperation=s.t==='eraser'?'destination-out':'source-over';
        const p=s.pts; if(!p||!p.length)return; if(p.length===1){ctx.beginPath();ctx.arc(p[0].x*W,p[0].y*H,Math.max(.6,s.w*W/2),0,7);ctx.fill();return;}
        ctx.beginPath();ctx.moveTo(p[0].x*W,p[0].y*H); for(let i=1;i<p.length-1;i++){const m={x:(p[i].x+p[i+1].x)/2,y:(p[i].y+p[i+1].y)/2};ctx.quadraticCurveTo(p[i].x*W,p[i].y*H,m.x*W,m.y*H);} ctx.lineTo(p[p.length-1].x*W,p[p.length-1].y*H); ctx.stroke(); }); }catch(e){} }
};

/* test hook (inert unless ?cwtest) */
try{ if(String(location.search).indexOf('cwtest')>=0){ window.DR_T={ myId, getG:()=>G, getR:()=>R, MP, Draw, createRoom, joinRoom, hostStartGame, sendGuess, startAI, submitTitle, submitChoose, roster:()=>MP.roster(),
  titleFor:(t)=>{ if(G){ if(G.isHost)hostOnTitle({from:myId,title:t}); else MP.send('title',{mid:G.mid,from:myId,title:t}); } },
  chooseCorrect:()=>{ if(G&&G.options){ const i=G.options.indexOf(G.title); if(i>=0)submitChoose(i); } },
  fakeDraw:(pts)=>{ if(pts&&pts.length){ Draw.begin(pts[0].x,pts[0].y); for(let i=1;i<pts.length;i++)Draw.move(pts[i].x,pts[i].y); Draw.end(); } } }; } }catch(e){}
})();
