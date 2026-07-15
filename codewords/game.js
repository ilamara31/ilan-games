/* ============================================================
   CODEWORDS — spy word game (solo / party / online)
   Single authoritative engine. Offline & party = local host.
   ============================================================ */
'use strict';
(function(){
const $=id=>document.getElementById(id);
const $$=s=>Array.prototype.slice.call(document.querySelectorAll(s));
const DATA=(window.CW_DATA)||{words:[],simpleWords:[],categories:{},hardLinks:{}};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=n=>Math.floor(Math.random()*n);

/* ---------- persistent save ---------- */
const SKEY='cw_save_v1';
function defSave(){return{
  coins:60, name:'', theme:'spy', owned:['spy'],
  sound:true, music:true, cbmarks:false, tutorialDone:false,
  daily:{date:'',played:false,won:false},
  stats:{played:0,won:0,lost:0,correct:0,bestClue:0,streak:0,bestStreak:0,doubles:0,traps:0}
};}
function load(){try{const s=JSON.parse(localStorage.getItem(SKEY));if(s&&s.stats){const d=defSave();return Object.assign(d,s,{stats:Object.assign(d.stats,s.stats),daily:Object.assign(d.daily,s.daily||{})});}}catch(e){}return defSave();}
let SV=load();
function save(){try{localStorage.setItem(SKEY,JSON.stringify(SV));}catch(e){}}

/* ---------- sound (procedural WebAudio) ---------- */
const Sound=(function(){
  let ctx=null,musicOn=false,musTimer=null,musGain=null;
  function ac(){if(!ctx){try{ctx=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}return ctx;}
  function unlock(){const c=ac();if(c&&c.state==='suspended')c.resume();}
  function tone(f,d,type,vol,at){const c=ac();if(!c||!SV.sound)return;const t=c.currentTime+(at||0);
    const o=c.createOscillator(),g=c.createGain();o.type=type||'sine';o.frequency.setValueAtTime(f,t);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol||.16,t+.012);g.gain.exponentialRampToValueAtTime(.0008,t+d);
    o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+d+.03);}
  function noise(d,vol,hp){const c=ac();if(!c||!SV.sound)return;const n=c.createBuffer(1,c.sampleRate*d,c.sampleRate);
    const dt=n.getChannelData(0);for(let i=0;i<dt.length;i++)dt[i]=(Math.random()*2-1)*Math.pow(1-i/dt.length,2);
    const s=c.createBufferSource();s.buffer=n;const g=c.createGain();g.gain.value=vol||.15;
    const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=hp||600;s.connect(f);f.connect(g);g.connect(c.destination);s.start();}
  const api={
    unlock,
    click(){tone(320,.06,'triangle',.12);},
    flip(){noise(.08,.12,900);tone(520,.09,'sine',.1);},
    correct(){tone(523,.1,'sine',.16);tone(784,.16,'sine',.15,.09);},
    good(){tone(659,.12,'sine',.16);tone(988,.18,'sine',.14,.1);},
    wrong(){tone(200,.2,'sawtooth',.14);tone(150,.28,'sawtooth',.12,.05);},
    neutral(){tone(300,.18,'triangle',.12);},
    coin(){tone(880,.07,'square',.12);tone(1320,.1,'square',.1,.06);},
    double(){[523,659,784,1046,1319].forEach((f,i)=>tone(f,.22,'triangle',.16,i*.08));},
    token(){tone(700,.1,'sine',.14);tone(1050,.14,'sine',.12,.07);},
    tick(){tone(1200,.03,'square',.06);},
    trap(){const c=ac();if(!c||!SV.sound)return;for(let i=0;i<6;i++){tone(880,.14,'sawtooth',.18,i*.16);tone(660,.14,'sawtooth',.16,i*.16+.08);}noise(.5,.2,300);},
    win(){[523,659,784,1046,784,1046,1319].forEach((f,i)=>tone(f,.28,'triangle',.16,i*.13));},
    lose(){[440,392,349,294].forEach((f,i)=>tone(f,.3,'sine',.15,i*.16));},
    startMusic(){if(!SV.music||musicOn)return;const c=ac();if(!c)return;musicOn=true;
      const seq=[196,0,262,0,247,0,196,0,175,0,233,0,196,0,0,0];let i=0;
      musGain=c.createGain();musGain.gain.value=.05;musGain.connect(c.destination);
      musTimer=setInterval(()=>{if(!SV.music){api.stopMusic();return;}const f=seq[i%seq.length];i++;if(!f)return;
        const o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.value=f;
        g.gain.setValueAtTime(0,c.currentTime);g.gain.linearRampToValueAtTime(1,c.currentTime+.03);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.34);
        o.connect(g);g.connect(musGain);o.start();o.stop(c.currentTime+.36);},300);},
    stopMusic(){musicOn=false;if(musTimer){clearInterval(musTimer);musTimer=null;}if(musGain){try{musGain.disconnect();}catch(e){}musGain=null;}}
  };
  return api;
})();
['pointerdown','keydown','touchstart'].forEach(ev=>window.addEventListener(ev,()=>Sound.unlock(),{passive:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden)Sound.stopMusic();});

/* ---------- themes ---------- */
const THEMES=[
  {id:'spy',name:'Spy',cost:0,bg:'linear-gradient(135deg,#111a30,#070b16)'},
  {id:'gold',name:'Gold',cost:150,bg:'linear-gradient(135deg,#2a1e05,#120d02)'},
  {id:'neon',name:'Neon',cost:200,bg:'linear-gradient(135deg,#160a2e,#05010f)'},
  {id:'retro',name:'Retro',cost:200,bg:'linear-gradient(135deg,#3a2c1c,#211a12)'},
  {id:'space',name:'Space',cost:250,bg:'linear-gradient(135deg,#0e1140,#03030f)'},
  {id:'cyber',name:'Cyber',cost:300,bg:'linear-gradient(135deg,#06302c,#02100f)'}
];
function applyTheme(id){document.body.setAttribute('data-theme',id);}
applyTheme(SV.theme||'spy');

/* ---------- seeded RNG (daily) ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(arr,rng){rng=rng||Math.random;for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}

/* ---------- board words ---------- */
function boardPool(family){
  const src=family?DATA.simpleWords:DATA.words;
  const seen={},out=[];
  for(let i=0;i<src.length;i++){const w=src[i];if(w&&w.length<=9&&!seen[w]){seen[w]=1;out.push(w);}}
  return out;
}
function makeBoard(seed,family){
  const rng=seed!=null?mulberry32(seed):Math.random;
  const pool=boardPool(family).slice();
  shuffle(pool,rng);
  const words=pool.slice(0,36);
  // safety: if pool short, top up from full words
  if(words.length<36){const extra=DATA.words.filter(w=>words.indexOf(w)<0);shuffle(extra,rng);while(words.length<36)words.push(extra.pop());}
  const types=[];
  for(let i=0;i<14;i++)types.push('gold');
  for(let i=0;i<14;i++)types.push('silver');
  for(let i=0;i<6;i++)types.push('civ');
  types.push('double');types.push('trap');
  shuffle(types,rng);
  return words.map((w,i)=>({word:w,type:types[i],revealed:false,revealedAs:null}));
}

/* ============================================================
   AI ENGINE — uses categories + hardLinks for clue & guessing
   ============================================================ */
const AI=(function(){
  const CATS=DATA.categories||{}, HARD=DATA.hardLinks||{};
  // clueKey -> Set(members)
  const CLUE={};
  Object.keys(CATS).forEach(k=>{CLUE[k]=new Set(CATS[k]);});
  Object.keys(HARD).forEach(k=>{if(!CLUE[k])CLUE[k]=new Set();HARD[k].forEach(w=>CLUE[k].add(w));});
  // word -> Set(clueKeys containing it as a member)
  const W2C={};
  Object.keys(CLUE).forEach(k=>{CLUE[k].forEach(w=>{(W2C[w]||(W2C[w]=new Set())).add(k);});});
  const lateralKeys=new Set(Object.keys(HARD)); // keys that are "clever"

  // association strength between a clue word and a board word
  function assoc(clue,word){
    if(clue===word)return 0;
    let s=0;
    if(CLUE[clue]&&CLUE[clue].has(word))s+=6;
    const a=W2C[clue],b=W2C[word];
    if(a&&b){a.forEach(k=>{if(b.has(k))s+=2;});}
    if(s===0){ if(word.indexOf(clue)>=0||clue.indexOf(word)>=0)s+=1; }
    return s;
  }
  // rank unrevealed board indices by association to a clue word (desc)
  function rank(board,clue){
    const arr=[];
    board.forEach((c,i)=>{if(c.revealed)return;arr.push({i,s:assoc(clue,c.word)});});
    shuffle(arr); // random tiebreak
    arr.sort((x,y)=>y.s-x.s);
    return arr;
  }
  // generate a clue for `team`. opts: level(0-3), lateral(bool), clarity(bool safe clue for human helper)
  function clue(board,team,opts){
    opts=opts||{};
    const other=team==='gold'?'silver':'gold';
    const unre=board.filter(c=>!c.revealed);
    const boardWords=new Set(board.map(c=>c.word));
    const own=new Set(), enemy=new Set(), soft=new Set(); let trapW=null;
    unre.forEach(c=>{if(c.type===team)own.add(c.word);else if(c.type===other)enemy.add(c.word);
      else if(c.type==='trap')trapW=c.word;else soft.add(c.word);});
    if(own.size===0)return null;
    const maxNum=[2,3,4,5][opts.level||0];
    const allowLateral=!!opts.lateral;
    let best=null;
    Object.keys(CLUE).forEach(key=>{
      if(boardWords.has(key))return;                 // clue can't be a board word
      if(!allowLateral&&lateralKeys.has(key)&&!CATS[key])return; // skip pure-lateral unless allowed
      const links=[]; CLUE[key].forEach(w=>{if(!board.some(c=>c.word===w&&c.revealed))links.push(w);});
      const ownLinks=links.filter(w=>own.has(w));
      if(ownLinks.length===0)return;
      const hasTrap=links.indexOf(trapW)>=0;
      if(hasTrap)return;                              // never risk the trap
      const enemyLinks=links.filter(w=>enemy.has(w));
      const softLinks=links.filter(w=>soft.has(w));
      // simulate greedy guesser: rank ALL unrevealed by assoc(key); the top ones should be own
      const ranked=rank(board,key);
      let num=Math.min(ownLinks.length,maxNum), safeTop=0;
      for(let i=0;i<ranked.length&&i<num;i++){const w=board[ranked[i].i].word;if(own.has(w))safeTop++;else break;}
      if(opts.clarity){ num=safeTop; if(num<1)return; }   // helper: only as many as are actually safe on top
      else { if(safeTop<num)num=Math.max(1,safeTop); }
      let score=num*4 - enemyLinks.length*3 - softLinks.length - (lateralKeys.has(key)&&!CATS[key]?0.5:0);
      if(opts.lateral&&lateralKeys.has(key))score+=0.6; // expert likes clever clues
      score+=Math.random()*0.4;
      if(!best||score>best.score)best={key,num,score,targets:ownLinks.slice(0,num)};
    });
    if(!best){ // fallback: any category of an own word
      const ow=[...own][0]; const cats=W2C[ow]?[...W2C[ow]].filter(k=>!boardWords.has(k)):[];
      const key=cats[0]||'AGENT'; return {word:key,num:1,targets:[ow]};
    }
    return {word:best.key,num:Math.max(1,best.num),targets:best.targets};
  }
  return {clue,rank,assoc};
})();

/* ============================================================
   PART 2 — state machine, rendering, modes, online
   ============================================================ */
const myId='u'+Math.random().toString(36).slice(2,9);
const SPYAV=['🕵️','🕵️‍♀️','🥷','👮','🦹','🧙','🦸','👤'];
const myAv=SPYAV[rnd(SPYAV.length)];
function pname(){return (SV.name&&SV.name.trim())?SV.name.trim().slice(0,14):('Agent-'+myId.slice(-3).toUpperCase());}
function pav(){return myAv;}

let G=null;                 // authoritative game state (live on host/offline; mirrored on clients)
let R=null;                 // room/lobby state (online)
let curScreen='menu';
let ackedCover=null;        // party pass-device cover acknowledgement
let hbTimer=null,wdTimer=null,pingTimer=null,lobbyTimer=null;
let lastLocalCfg=null;
let toastT=null,selNum=2;

/* ---------- tiny helpers ---------- */
function show(id){$$('.screen').forEach(s=>s.classList.remove('on'));const e=$(id);if(e)e.classList.add('on');curScreen=id;window.scrollTo(0,0);
  if(id==='menu'){Sound.startMusic();refreshMenu();}else Sound.stopMusic();}
function openOv(id){$(id).classList.add('on');}
function closeOv(id){$(id).classList.remove('on');}
function toast(m,ms){const t=$('toast');t.innerHTML=m;t.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('on'),ms||1900);}
function teamName(t){return t==='gold'?'🟡 Gold':'⚪ Silver';}
function typeIcon(t){return {gold:'🟡',silver:'⚪',civ:'🧑',double:'🎭',trap:'💣'}[t]||'';}
function dotColor(t){return {gold:'#f5b301',silver:'#cfd8e3',civ:'#d9c9a3',double:'#c072ff',trap:'#ff4d4d'}[t]||'#fff';}
function logEv(h){if(!G)return;G.log.push(h);if(G.log.length>60)G.log.shift();}
function todayStr(){const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();}
function dailySeed(){const d=new Date();return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();}
function isAuthority(){return !G||!G.online||G.isHost;}
function personalTeam(){if(!G)return null;if(G.party)return null;if(G.online){const a=myAssign();return a?a.team:null;}return G.human?G.human.team:null;}
function isHumanTeam(t){return personalTeam()===t;}
function myAssign(){return (G&&G.assign)?G.assign[myId]:null;}

/* ---------- perspective / interactivity ---------- */
function phaseRole(){return G.phase==='clue'?'cmd':'gss';}
function localActorRole(){
  if(!G||G.phase==='over')return null;
  const need=phaseRole();
  if(G.online){const a=myAssign();if(!a||a.team!==G.turn||a.role!==need)return null;return need;}
  if(G.party)return need;
  if(G.human&&G.human.team===G.turn&&G.human.role===need)return need;
  return null;
}
function coverKey(){return G&&G.party?(G.phase+'|'+G.turn+'|'+(G.step||0)):null;}
function coverAcked(){return ackedCover===coverKey();}
function canClueNow(){return G&&G.phase==='clue'&&localActorRole()==='cmd'&&(!G.party||coverAcked());}
function canGuessNow(){return G&&G.phase==='guess'&&localActorRole()==='gss'&&(!G.party||coverAcked());}
function showKeyNow(){
  if(!G)return false;
  if(G.phase==='over')return true;
  if(G.online){const a=myAssign();return !!(a&&a.role==='cmd');}
  if(G.party)return G.phase==='clue'&&coverAcked();
  return !!(G.human&&G.human.role==='cmd');
}

/* ============================================================
   GAME CONSTRUCTION
   ============================================================ */
function initGame(cfg){
  const gen=((G&&G.gen)||0)+1;
  G={gen,mid:cfg.mid||1,mode:cfg.mode,family:!!cfg.family,difficulty:cfg.difficulty!=null?cfg.difficulty:1,
     online:!!cfg.online,isHost:!!cfg.isHost,party:!!cfg.party,
     board:cfg.board,turn:cfg.starting,phase:'clue',clue:null,step:0,turnCorrect:0,guesses:0,
     remaining:{gold:0,silver:0},tokens:{gold:{hint:1,reveal:1,protect:1},silver:{hint:1,reveal:1,protect:1}},
     shield:{gold:false,silver:false},ctrl:cfg.ctrl,human:cfg.human||null,assign:cfg.assign||null,
     log:[],winner:null,reason:null,seq:0,_fx:null,_lastState:null};
  G.remaining.gold=G.board.filter(c=>c.type==='gold').length;
  G.remaining.silver=G.board.filter(c=>c.type==='silver').length;
  ackedCover=null;
  logEv(teamName(G.turn)+' start the mission.');
  return G;
}
function startFlow(){render();beginClue();}

/* ============================================================
   TURN STATE MACHINE (authoritative)
   ============================================================ */
function beginClue(){
  if(!G||G.winner)return;
  G.phase='clue';G.clue=null;G.step=(G.step||0)+1;ackedCover=null;commit();
  if(isAuthority()&&G.ctrl[G.turn].cmd==='ai')scheduleAI(()=>aiDoClue(G.turn));
}
function beginGuess(){
  if(!G||G.winner)return;
  G.phase='guess';G.step=(G.step||0)+1;ackedCover=null;commit();
  if(isAuthority()&&G.ctrl[G.turn].gss==='ai')scheduleAI(()=>aiDoGuess(G.turn));
}
function endTurnAfter(team){const g=G.gen;setTimeout(()=>{if(!G||G.gen!==g||G.winner)return;endTurn();},950);}
function endTurn(){if(!G||G.winner)return;G.turn=G.turn==='gold'?'silver':'gold';G.clue=null;logEv('▸ '+teamName(G.turn)+'\'s turn.');beginClue();}

function commit(){if(!G)return;render();if(G.online&&G.isHost)broadcastState();}

/* ---- actions (routing) ---- */
function requestAction(a){if(!G)return;a.from=myId;a.mid=G.mid;
  if(!G.online){applyAction(a);return;}
  if(G.isHost){hostOnAct(a);return;}
  MP.send('act',a);
}
function applyAction(a){if(!G||G.winner)return;
  switch(a.t){
    case 'clue':doClue(a.team,a.word,a.num);break;
    case 'guess':doGuess(a.team,a.idx);break;
    case 'token':doToken(a.team,a.tok);break;
    case 'end':doEnd(a.team);break;
  }
}

/* ---- clue ---- */
function doClue(team,word,num){
  if(!G||G.phase!=='clue'||G.turn!==team||G.winner)return;
  word=String(word||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,16);
  if(!word)return;
  num=clamp(parseInt(num,10)||1,1,9);
  G.clue={word,num,left:num+1};G.turnCorrect=0;G.guesses=0;
  logEv('<b>'+teamName(team)+' Commander:</b> <span class="'+(team==='gold'?'cg':'cs')+'">'+word+' '+num+'</span>');
  Sound.token();
  beginGuess();
}
/* ---- guess ---- */
function doGuess(team,idx){
  if(!G||G.phase!=='guess'||G.turn!==team||G.winner)return;
  const card=G.board[idx];if(!card||card.revealed)return;
  const other=team==='gold'?'silver':'gold';
  card.revealed=true;card.revealedAs=card.type;G.guesses++;
  if(card.type==='trap'){
    if(G.shield[team]){G.shield[team]=false;logEv('🛡️ <b>DEFUSED!</b> Protection stopped the Trap — turn ends.');Sound.token();G._fx={idx,kind:'defuse'};commit();endTurnAfter(team);return;}
    logEv('🚨 <b>'+card.word+'</b> was the <b>TRAP</b>! '+teamName(team)+' are caught.');
    if(isHumanTeam(team)){SV.stats.traps++;save();}
    Sound.trap();G._fx={idx,kind:'trap'};commit();gameOver(other,'trap');return;
  }
  if(card.type==='double'){
    G.clue.left+=1;
    logEv('🎭 '+teamName(team)+' unmasked the <b>Double Agent</b> — bonus guess!');
    if(isHumanTeam(team)){SV.coins+=15;SV.stats.doubles++;save();}
    Sound.double();G._fx={idx,kind:'double'};commit();
    if(!G.online||G.isHost)maybeShowDouble(team);
    return;
  }
  if(card.type===team){
    G.remaining[team]--;G.clue.left--;G.turnCorrect++;
    if(isHumanTeam(team))SV.stats.correct++;
    logEv('✅ '+teamName(team)+' agent <b>'+card.word+'</b> recruited!');
    Sound.correct();G._fx={idx,kind:'correct',team};
    if(G.remaining[team]<=0){noteBestClue(team);commit();gameOver(team,'cleared');return;}
    if(G.clue.left<=0){noteBestClue(team);commit();endTurnAfter(team);return;}
    commit();return;
  }
  // wrong: enemy agent or civilian
  if(card.type===other){
    G.remaining[other]--;
    logEv('❌ '+teamName(team)+' exposed an <b>enemy agent</b> ('+card.word+')!');
    if(G.remaining[other]<=0){Sound.wrong();G._fx={idx,kind:'enemy'};noteBestClue(team);commit();gameOver(other,'cleared');return;}
  }else{
    logEv('⬜ '+teamName(team)+' met a Civilian ('+card.word+').');
  }
  if(G.shield[team]){G.shield[team]=false;G.clue.left--;logEv('🛡️ Protection absorbed the miss — keep going!');Sound.token();G._fx={idx,kind:card.type};
    if(G.clue.left<=0){noteBestClue(team);commit();endTurnAfter(team);return;}
    commit();return;}
  Sound.wrong();G._fx={idx,kind:card.type};noteBestClue(team);commit();endTurnAfter(team);
}
/* ---- tokens ---- */
function doToken(team,tok){
  if(!G||G.winner||G.turn!==team||G.phase!=='guess')return;
  const tk=G.tokens[team];if(!tk||!tk[tok])return;
  if(tok==='hint'){if(!G.clue)return;tk.hint=0;G.clue.left++;logEv('🎁 '+teamName(team)+' used a Hint — one extra guess!');Sound.token();commit();return;}
  if(tok==='reveal'){const own=[];G.board.forEach((c,i)=>{if(!c.revealed&&c.type===team)own.push(i);});if(!own.length){toast('No agents left to reveal');return;}
    tk.reveal=0;const idx=own[rnd(own.length)];G.board[idx].revealed=true;G.board[idx].revealedAs=team;G.remaining[team]--;if(isHumanTeam(team))SV.stats.correct++;
    logEv('🔍 '+teamName(team)+' used Reveal — <b>'+G.board[idx].word+'</b> found for free!');Sound.good();G._fx={idx,kind:'correct',team};
    if(G.remaining[team]<=0){commit();gameOver(team,'cleared');return;}commit();return;}
  if(tok==='protect'){tk.protect=0;G.shield[team]=true;logEv('🛡️ '+teamName(team)+' armed Protection — next miss is blocked.');Sound.token();commit();return;}
}
/* ---- end turn ---- */
function doEnd(team){if(!G||G.phase!=='guess'||G.turn!==team||G.winner)return;noteBestClue(team);logEv(teamName(team)+' stop guessing.');commit();endTurnAfter(team);}

function noteBestClue(team){if(isHumanTeam(team)&&G.turnCorrect>SV.stats.bestClue){SV.stats.bestClue=G.turnCorrect;save();}}

/* ---- game over ---- */
function gameOver(winner,reason){
  if(!G||G.winner)return;
  G.winner=winner;G.phase='over';G.reason=reason;
  G.board.forEach(c=>{c.revealed=true;if(!c.revealedAs)c.revealedAs=c.type;});
  finalizeForHuman(winner,reason);
  commit();
  const g=G.gen;
  if(reason==='trap'){showTrap(winner);}
  else{setTimeout(()=>{if(G&&G.gen===g)showResult(winner,reason);},1150);}
}
function finalizeForHuman(winner,reason){
  SV.stats.played++;
  const pt=personalTeam();
  if(pt){
    if(winner===pt){SV.stats.won++;SV.stats.streak++;if(SV.stats.streak>SV.stats.bestStreak)SV.stats.bestStreak=SV.stats.streak;SV.coins+=(reason==='trap'?20:45);}
    else{SV.stats.lost++;SV.stats.streak=0;SV.coins+=8;}
  }else{SV.coins+=20;}
  if(G.mode==='daily'){SV.daily={date:todayStr(),played:true,won:pt?winner===pt:true};if(pt&&winner===pt)SV.coins+=20;}
  save();
}

/* ---- AI turns ---- */
function scheduleAI(fn,delay){if(!isAuthority())return;const g=G.gen;setTimeout(()=>{if(!G||G.gen!==g||G.winner||G.phase==='over')return;fn();},delay||(750+rnd(500)));}
function aiDoClue(team){
  if(!G||G.turn!==team||G.phase!=='clue')return;
  const forHuman=(!G.online&&!G.party&&G.human&&G.human.role==='gss'&&G.human.team===team);
  const level=forHuman?2:G.difficulty;
  const c=AI.clue(G.board,team,{level,lateral:(!forHuman&&G.difficulty>=2),clarity:forHuman});
  if(!c){doEnd(team);return;}
  doClue(team,c.word,c.num);
}
function aiDoGuess(team){
  const skill=[0.55,0.72,0.87,0.96][G.difficulty]||0.8;
  (function step(){
    if(!G||G.phase!=='guess'||G.turn!==team||G.winner)return;
    if(!G.clue||G.clue.left<=0){doEnd(team);return;}
    const ranked=AI.rank(G.board,G.clue.word).filter(r=>!G.board[r.i].revealed);
    if(!ranked.length){doEnd(team);return;}
    const guessesDone=G.guesses;
    if(guessesDone>=G.clue.num){ if(ranked[0].s<4||Math.random()>skill*0.5){doEnd(team);return;} }
    let pick=ranked[0];
    if(ranked[0].s<=0){ if(Math.random()>0.35){doEnd(team);return;} pick=ranked[rnd(Math.min(4,ranked.length))]; }
    else if(Math.random()>skill){ pick=ranked[Math.min(ranked.length-1,1+rnd(3))]||ranked[0]; }
    doGuess(team,pick.i);
    if(G&&G.phase==='guess'&&G.turn===team&&!G.winner)scheduleAI(step,650+rnd(500));
  })();
}

/* ============================================================
   RENDER
   ============================================================ */
function render(){
  if(!G)return;
  $('goldNum').textContent=G.remaining.gold;
  $('silverNum').textContent=G.remaining.silver;
  $('sbGold').classList.toggle('turn',G.turn==='gold'&&G.phase!=='over');
  $('sbSilver').classList.toggle('turn',G.turn==='silver'&&G.phase!=='over');
  handleCover();
  renderBoard(showKeyNow());
  renderStatus();
  renderCluebox();
  renderControls();
  renderTokens();
  renderLog();
}
function handleCover(){
  const key=coverKey();
  if(!key||G.phase==='over'||!localActorRole()||ackedCover===key){closeOv('cover');return;}
  const need=phaseRole();const tname=teamName(G.turn);
  $('coverEmoji').textContent=need==='cmd'?'🎖️':'🔍';
  $('coverTitle').textContent='Pass to '+tname+(need==='cmd'?' Commander':' Guessers');
  $('coverText').textContent=need==='cmd'
    ? 'Commander only! Everyone else look away. You will see the secret key and give one clue.'
    : 'Guessers ready! The key is hidden. Find your agents. Clue: '+(G.clue?('“'+G.clue.word+' '+G.clue.num+'”'):'');
  openOv('cover');
}
function renderStatus(){
  const tb=$('turnbar');tb.className='turnbar '+G.turn;
  const cl=$('clueline');
  let txt='',clue='';
  if(G.phase==='clue'){
    if(canClueNow())txt='🎖️ <b>You are the Commander</b> — give a clue below';
    else if(G.ctrl[G.turn].cmd==='ai')txt=teamName(G.turn)+' Commander is thinking… 🤔';
    else txt='Waiting for '+teamName(G.turn)+' Commander…';
  }else if(G.phase==='guess'){
    if(canGuessNow())txt='🔍 <b>Tap your agents!</b>';
    else if(G.ctrl[G.turn].gss==='ai')txt=teamName(G.turn)+' agents are guessing…';
    else txt='Waiting for '+teamName(G.turn)+' Guessers…';
    if(G.clue)clue='<span class="cluepill">'+G.clue.word+'</span><span class="cluenum">'+G.clue.num+'</span><span class="guessleft">'+Math.max(0,G.clue.left)+' guess'+(G.clue.left===1?'':'es')+' left</span>';
  }
  tb.innerHTML=txt;
  cl.innerHTML=clue;
}
function renderCluebox(){
  const box=$('cluebox');
  if(canClueNow()){
    box.style.display='block';
    const own=G.remaining[G.turn];
    const ns=$('numsel');
    if(ns.getAttribute('data-max')!=String(own)){
      ns.setAttribute('data-max',own);ns.innerHTML='';
      const max=Math.min(9,Math.max(1,own));
      for(let i=1;i<=max;i++){const b=document.createElement('button');b.textContent=i;b.onclick=()=>{selNum=i;renderNumSel();};ns.appendChild(b);}
      if(selNum>max)selNum=Math.min(2,max);
      renderNumSel();
    }
  }else box.style.display='none';
}
function renderNumSel(){const ns=$('numsel');Array.prototype.forEach.call(ns.children,(b,i)=>b.classList.toggle('on',(i+1)===selNum));}
function renderControls(){
  const eg=$('endGuessBtn');
  if(canGuessNow()&&G.guesses>=1){eg.style.display='block';}else eg.style.display='none';
}
function renderTokens(){
  const t=$('tokens');
  if(!canGuessNow()){t.style.display='none';return;}
  t.style.display='flex';
  const tk=G.tokens[G.turn];
  const defs=[['hint','🎁','Hint','+1 guess'],['reveal','🔍','Reveal','free agent'],['protect','🛡️','Protect','block a miss']];
  t.innerHTML='';
  defs.forEach(d=>{
    const [key,emoji,label,desc]=d;
    const b=document.createElement('button');b.className='tok'+(tk[key]?'':' used');
    b.innerHTML='<span class="te">'+emoji+'</span>'+label+'<small>'+(tk[key]?desc:'used')+'</small>';
    if(tk[key])b.onclick=()=>{Sound.click();requestAction({t:'token',team:G.turn,tok:key});};
    t.appendChild(b);
  });
}
function renderBoard(showKey){
  const b=$('board');const frag=document.createDocumentFragment();const canG=canGuessNow();
  G.board.forEach((c,i)=>{
    const d=document.createElement('div');d.className='card';
    if(c.revealed){d.classList.add('rev','r-'+c.revealedAs);d.innerHTML='<span class="icon">'+typeIcon(c.revealedAs)+'</span><span class="w">'+c.word+'</span>';}
    else{
      d.innerHTML='<span class="kd"></span><span class="w">'+c.word+'</span>';
      if(showKey){d.classList.add('key-'+c.type);if(SV.cbmarks){d.classList.add('showdot');d.querySelector('.kd').style.background=dotColor(c.type);}}
      if(canG)d.onclick=()=>onCardTap(i);else d.classList.add('disabled');
    }
    if(G._fx&&G._fx.idx===i){d.classList.add('flip');
      if(G._fx.kind==='correct'||G._fx.kind==='double'){d.classList.add('glow');d.style.setProperty('--gl',G._fx.kind==='double'?'#c072ff':'#f5b301');}
      if(['enemy','civ','trap','defuse'].indexOf(G._fx.kind)>=0)d.classList.add('shake');}
    frag.appendChild(d);
  });
  b.innerHTML='';b.appendChild(frag);G._fx=null;
}
function onCardTap(i){if(!canGuessNow())return;const c=G.board[i];if(!c||c.revealed)return;Sound.flip();requestAction({t:'guess',team:G.turn,idx:i});}
function renderLog(){
  const l=$('log');l.innerHTML='';
  const items=G.log.slice(-8);
  items.forEach(h=>{const d=document.createElement('div');d.className='ev';d.innerHTML=h;l.appendChild(d);});
  l.scrollTop=l.scrollHeight;
}

/* ---- splashes ---- */
function maybeShowDouble(team){if(!isHumanTeam(team)&&!(G.party))return;$('doubleText').textContent=(isHumanTeam(team)?'You':teamName(team))+' uncovered the Double Agent — a bonus guess and +15 🪙!';openOv('double');}
function showTrap(winner){$('trapText').innerHTML='The Trap Card was triggered — instant defeat.<br><b>'+teamName(winner)+' win the mission.</b>';openOv('trap');}
function showResult(winner,reason){
  const pt=personalTeam();const youWon=pt?winner===pt:null;
  let emoji=reason==='trap'?'🚨':'🏆';let head=teamName(winner)+' win!';
  let sub=reason==='trap'?'The other team triggered the Trap Card.':'All of '+teamName(winner)+'\'s agents were found.';
  if(youWon===true){Sound.win();confetti();head='🎉 Victory!';}
  else if(youWon===false){Sound.lose();head='Mission Failed';}
  else Sound.win();
  const s=SV.stats;
  const line='<div class="statgrid" style="margin:10px 0"><div class="stat"><div class="sv">🪙 '+SV.coins+'</div><div class="sl">Coins</div></div><div class="stat"><div class="sv">'+s.streak+'</div><div class="sl">Win streak</div></div></div>';
  $('result').innerHTML='<div class="sheet" style="margin:12vh auto 0"><div style="font-size:64px">'+emoji+'</div><div class="winbanner">'+head+'</div><p>'+sub+'</p>'+line+'<div class="btns"><button class="btn" id="againBtn">🔁 Play again</button><button class="btn ghost" id="menuBtn2">🏠 Menu</button></div></div>';
  show('result');
  $('againBtn').onclick=()=>{Sound.click();confettiOff();playAgain();};
  $('menuBtn2').onclick=()=>{Sound.click();confettiOff();quitToMenu();};
}
function confetti(){const c=$('confetti');c.innerHTML='';const cols=['#f5b301','#cfd8e3','#c072ff','#2ec16b','#ff9b3d'];
  for(let i=0;i<70;i++){const s=document.createElement('i');s.style.left=Math.random()*100+'%';s.style.background=cols[rnd(cols.length)];
    s.style.animationDuration=(1.6+Math.random()*1.8)+'s';s.style.animationDelay=(Math.random()*0.6)+'s';s.style.transform='rotate('+rnd(360)+'deg)';c.appendChild(s);}
  c.classList.add('on');}
function confettiOff(){$('confetti').classList.remove('on');}

/* ============================================================
   MODES — setup & launch (local)
   ============================================================ */
function selectMode(mode){
  Sound.click();
  if(mode==='tutorial'){startTutorial();return;}
  if(mode==='online'){show('online');return;}
  if(mode==='quick'){startLocal({mode:'quick',difficulty:1,family:false,role:'gss',team:'gold'});return;}
  if(mode==='daily'){startLocal({mode:'daily',difficulty:1,family:false,role:'gss',team:'gold',seed:dailySeed()});return;}
  buildSetup(mode);show('setup');
}
let setupCfg={};
function buildSetup(mode){
  setupCfg={mode,difficulty:1,family:mode==='family',role:'gss',team:'gold',startTeam:null};
  const titles={practice:'🎯 Practice',party:'🎉 Party Mode',family:'👶 Family Mode'};
  $('setupTitle').textContent=titles[mode]||'Setup';
  const body=$('setupBody');let h='';
  if(mode==='party'){
    h+='<p class="sub">One device, two teams. Each turn the Commander looks at the secret key, gives a clue, then passes to the Guessers. A cover screen keeps the key secret. Great for a room full of people!</p>';
    h+='<label class="fld">Who starts?</label><div class="seg" id="segStart"><button data-v="gold">🟡 Gold</button><button data-v="silver">⚪ Silver</button><button data-v="random" class="on">🎲 Random</button></div>';
    h+='<label class="fld">Word difficulty</label><div class="seg" id="segFam"><button data-v="0">🧩 Normal</button><button data-v="1" class="on">👶 Easy words</button></div>';
    setupCfg.family=true;
  }else{
    if(mode==='family'){h+='<p class="sub">Simple, kid-friendly words and gentle clues. The computer helps you find your agents. Perfect for children and grandparents.</p>';}
    else{h+='<p class="sub">Play against the computer. Pick how tough it is and whether you want to be the Guesser or the Commander.</p>';}
    if(mode==='practice'){
      h+='<label class="fld">Opponent difficulty</label><div class="seg" id="segDiff"><button data-v="0">😊 Easy</button><button data-v="1" class="on">🙂 Medium</button><button data-v="2">😎 Hard</button><button data-v="3">🧠 Expert</button></div>';
    }
    h+='<label class="fld">Your role</label><div class="seg" id="segRole"><button data-v="gss" class="on">🔍 Guesser<br><small style="font-weight:600;opacity:.8">computer gives you clues</small></button><button data-v="cmd">🎖️ Commander<br><small style="font-weight:600;opacity:.8">you give the clues</small></button></div>';
    h+='<label class="fld">Your team</label><div class="seg" id="segTeam"><button data-v="gold" class="on">🟡 Gold</button><button data-v="silver">⚪ Silver</button></div>';
    if(mode==='family'){setupCfg.difficulty=0;setupCfg.family=true;}
  }
  body.innerHTML=h;
  wireSeg('segStart',v=>setupCfg.startTeam=(v==='random'?null:v));
  wireSeg('segFam',v=>setupCfg.family=v==='1');
  wireSeg('segDiff',v=>setupCfg.difficulty=+v);
  wireSeg('segRole',v=>setupCfg.role=v);
  wireSeg('segTeam',v=>setupCfg.team=v);
}
function wireSeg(id,cb){const s=$(id);if(!s)return;s.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;Sound.click();Array.prototype.forEach.call(s.children,x=>x.classList.toggle('on',x===b));cb(b.getAttribute('data-v'));});}
function startLocalFromSetup(){startLocal(Object.assign({},setupCfg));}
function startLocal(cfg){
  lastLocalCfg=Object.assign({},cfg);
  const seed=cfg.seed!=null?cfg.seed:null;
  const starting=cfg.startTeam||(Math.random()<.5?'gold':'silver');
  const board=makeBoard(seed,cfg.family);
  let ctrl;
  if(cfg.mode==='party')ctrl={gold:{cmd:'human',gss:'human'},silver:{cmd:'human',gss:'human'}};
  else{ctrl={gold:{cmd:'ai',gss:'ai'},silver:{cmd:'ai',gss:'ai'}};ctrl[cfg.team][cfg.role]='human';}
  initGame({mode:cfg.mode,family:!!cfg.family,difficulty:cfg.difficulty,online:false,isHost:false,party:cfg.mode==='party',
    board,starting,ctrl,human:cfg.mode==='party'?null:{team:cfg.team,role:cfg.role}});
  show('game');startFlow();
}
function playAgain(){
  if(G&&G.online){show('lobby');return;}
  if(lastLocalCfg){const c=Object.assign({},lastLocalCfg);if(c.mode==='daily')c.seed=dailySeed();else delete c.seed;startLocal(c);}
  else quitToMenu();
}
function quitToMenu(){const g=G;G=null;if(g&&g.online)leaveRoom();closeOv('cover');show('menu');}

/* ============================================================
   ONLINE MULTIPLAYER (Supabase realtime — host authoritative)
   ============================================================ */
const MP={
  sb:null,ch:null,code:null,isHost:false,reopening:false,
  async ensure(){
    if(!(window.supabase&&window.supabase.createClient)){
      await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';s.onload=res;s.onerror=()=>rej(new Error('cdn'));document.head.appendChild(s);});
    }
    if(!this.sb)this.sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_KEY,{auth:{persistSession:false}});
    return this.sb;
  },
  async open(code,host){this.code=code;this.isHost=host;await this.ensure();await this._sub();},
  _sub(){return new Promise((res,rej)=>{
    if(this.ch){try{this.sb.removeChannel(this.ch);}catch(e){}}
    const ch=this.sb.channel('cw-room-'+this.code,{config:{broadcast:{self:false},presence:{key:myId}}});
    ['lobby','start','state','act','pick','hello','ping'].forEach(ev=>ch.on('broadcast',{event:ev},({payload})=>onNet(ev,payload)));
    ch.on('presence',{event:'sync'},()=>onNet('presence'));
    ch.on('presence',{event:'join'},()=>onNet('presence'));
    ch.on('presence',{event:'leave'},()=>onNet('presence'));
    let done=false;
    ch.subscribe(st=>{
      if(st==='SUBSCRIBED'){done=true;this.reopening=false;try{ch.track({id:myId,name:pname(),av:pav(),t:Date.now()});}catch(e){}if(res){const r=res;res=null;r();}}
      else if((st==='CHANNEL_ERROR'||st==='TIMED_OUT'||st==='CLOSED')&&!done&&rej){done=true;rej(new Error(st));}
    });
    this.ch=ch;
  });},
  send(ev,payload){if(this.ch){try{this.ch.send({type:'broadcast',event:ev,payload:payload||{}});}catch(e){}}},
  roster(){try{const st=this.ch.presenceState(),a=[];for(const k in st){const p=st[k]&&st[k][0];if(p&&p.id)a.push({id:p.id,name:(p.name||'Agent').slice(0,14),av:p.av||'🕵️',t:p.t||0});}a.sort((x,y)=>(x.id===myId?-1:y.id===myId?1:x.t-y.t));return a;}catch(e){return[];}},
  state(){return (this.ch&&this.ch.state)||'closed';},
  reopen(){if(this.reopening||!this.sb||!this.code)return;const s=this.state();if(s==='joined'||s==='joining')return;this.reopening=true;try{this._sub();}catch(e){this.reopening=false;}setTimeout(()=>this.reopening=false,6000);},
  leave(){if(this.ch){try{this.sb.removeChannel(this.ch);}catch(e){}}this.ch=null;this.code=null;this.isHost=false;}
};
function genCode(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<4;i++)s+=A[rnd(A.length)];return s;}

function onNet(ev,payload){
  if(ev==='presence'){if(R&&R.isHost&&curScreen==='lobby'){hostReconcile();hostBroadcastLobby();}if(curScreen==='lobby')renderLobby();return;}
  if(ev==='hello'){if(R&&R.isHost){hostReconcile();hostBroadcastLobby();}return;}
  if(ev==='pick'){if(R&&R.isHost)hostApplyPick(payload);return;}
  if(ev==='lobby'){if(!R||R.isHost)return;if(payload.seq!=null){if(R.lseq!=null&&payload.seq<R.lseq)return;R.lseq=payload.seq;}R.hostId=payload.hostId;R.assign=payload.assign||{};if(curScreen==='lobby')renderLobby();return;}
  if(ev==='start'){if(R&&R.isHost)return;startFromNet(payload);return;}
  if(ev==='state'){if(R&&R.isHost)return;applyState(payload);return;}
  if(ev==='act'){if(R&&R.isHost)hostOnAct(payload);return;}
  if(ev==='ping'){if(R){R.seen=R.seen||{};if(payload&&payload.from)R.seen[payload.from]=Date.now();}return;}
}

/* ---- lobby (host authoritative roster) ---- */
function teamCount(t){return Object.keys(R.assign).filter(id=>R.assign[id].team===t).length;}
function hasCmd(t){return Object.keys(R.assign).some(id=>R.assign[id].team===t&&R.assign[id].role==='cmd');}
function teamRoleCount(t,role){return Object.keys(R.assign).filter(id=>R.assign[id].team===t&&R.assign[id].role===role).length;}
function hostReconcile(){
  if(!R||!R.isHost)return;const present=MP.roster();const ids={};present.forEach(p=>ids[p.id]=p);
  R.assign=R.assign||{};
  Object.keys(R.assign).forEach(id=>{if(!ids[id])delete R.assign[id];});
  present.forEach(p=>{
    if(!R.assign[p.id]){const team=teamCount('gold')<=teamCount('silver')?'gold':'silver';R.assign[p.id]={team,role:'gss',name:p.name,av:p.av};}
    else{R.assign[p.id].name=p.name;R.assign[p.id].av=p.av;}
  });
}
function hostApplyPick(p){
  if(!R||!R.isHost||!p||!R.assign[p.id])return;const a=R.assign[p.id];
  if(p.team==='gold'||p.team==='silver')a.team=p.team;
  if(p.role==='cmd'){Object.keys(R.assign).forEach(id=>{if(id!==p.id&&R.assign[id].team===a.team&&R.assign[id].role==='cmd')R.assign[id].role='gss';});a.role='cmd';}
  else if(p.role==='gss')a.role='gss';
  hostBroadcastLobby();renderLobby();
}
function hostBroadcastLobby(){if(!R||!R.isHost)return;R.lseq=(R.lseq||0)+1;MP.send('lobby',{hostId:myId,assign:R.assign,seq:R.lseq});}
function myPick(team,role){
  Sound.click();
  if(!R)return;
  if(R.isHost){hostApplyPick({id:myId,team:team,role:role});}
  else{if(!R.assign[myId])R.assign[myId]={team:team||'gold',role:role||'gss',name:pname(),av:pav()};else{if(team)R.assign[myId].team=team;if(role)R.assign[myId].role=role;}renderLobby();MP.send('pick',{id:myId,team,role});}
}

async function createRoom(){
  const code=genCode();R={code,isHost:true,assign:{},lseq:0,hostId:myId,seen:{}};
  showLobbyScreen(code,true);
  try{await MP.open(code,true);hostReconcile();hostBroadcastLobby();startLobbyHost();}
  catch(e){toast('Connection failed — check your internet');leaveRoom();show('online');}
}
async function joinRoom(code){
  code=(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
  if(code.length<4){toast('Enter the 4-letter code');return;}
  R={code,isHost:false,assign:{},hostId:null,seen:{}};
  showLobbyScreen(code,false);
  try{await MP.open(code,false);MP.send('hello',{id:myId,name:pname(),av:pav()});startGuestLobby();}
  catch(e){toast('Connection failed — check your internet');leaveRoom();show('online');}
}
function leaveRoom(){stopTimers();if(lobbyTimer){clearInterval(lobbyTimer);lobbyTimer=null;}if(MP.ch)MP.leave();R=null;}
function startLobbyHost(){wdWatch();lobbyTimer=setInterval(()=>{if(!R||!R.isHost){clearInterval(lobbyTimer);return;}hostReconcile();hostBroadcastLobby();if(MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen();},3000);}
function startGuestLobby(){wdWatch();lobbyTimer=setInterval(()=>{if(!R||R.isHost){clearInterval(lobbyTimer);return;}if(!R.assign||!R.assign[myId])MP.send('hello',{id:myId,name:pname(),av:pav()});if(MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen();},3000);}
function wdWatch(){}

function showLobbyScreen(code,host){
  $('lobbyCode').textContent=code;
  $('hostControls').style.display=host?'block':'none';
  $('waitHost').style.display=host?'none':'block';
  show('lobby');renderLobby();
}
function renderLobby(){
  const root=$('lobbyRoster');const assign=(R&&R.assign)||{};
  function col(team){
    const ids=Object.keys(assign).filter(id=>assign[id].team===team);
    let h='<div class="teamcol '+team+'"><h4>'+(team==='gold'?'🟡 Team Gold':'⚪ Team Silver')+'</h4>';
    if(!ids.length)h+='<div class="pslot" style="opacity:.6"><span class="nm">No players yet</span></div>';
    ids.sort((a,b)=>(assign[a].role==='cmd'?-1:1)-(assign[b].role==='cmd'?-1:1));
    ids.forEach(id=>{const a=assign[id];h+='<div class="pslot"><span class="av">'+(a.av||'🕵️')+'</span><span class="nm">'+esc(a.name||'Agent')+(id===myId?' <small style="color:var(--accent)">(you)</small>':'')+'</span><span class="rl '+(a.role==='cmd'?'cmd':'')+'">'+(a.role==='cmd'?'🎖️ Commander':'🔍 Guesser')+'</span></div>';});
    if(!hasCmdIn(assign,team))h+='<div class="pslot" style="opacity:.75"><span class="av">🤖</span><span class="nm">AI Commander</span><span class="rl cmd">auto</span></div>';
    if(teamRoleCountIn(assign,team,'gss')===0)h+='<div class="pslot" style="opacity:.75"><span class="av">🤖</span><span class="nm">AI Guesser</span><span class="rl">auto</span></div>';
    h+='</div>';return h;
  }
  const mine=assign[myId];
  let controls='<div class="panel" style="margin-top:10px"><div class="row" style="gap:8px">'
    +'<button class="btn sm gold" data-pk="team:gold" style="flex:1">Join Gold</button>'
    +'<button class="btn sm silver" data-pk="team:silver" style="flex:1">Join Silver</button></div>'
    +'<div class="row mt8" style="gap:8px">'
    +'<button class="btn sm ghost" data-pk="role:cmd" style="flex:1">🎖️ Be Commander</button>'
    +'<button class="btn sm ghost" data-pk="role:gss" style="flex:1">🔍 Be Guesser</button></div>'
    +(mine?'<p class="small center mt8">You: '+(mine.team==='gold'?'🟡 Gold':'⚪ Silver')+' · '+(mine.role==='cmd'?'🎖️ Commander':'🔍 Guesser')+'</p>':'<p class="small center mt8">Connecting…</p>')
    +'</div>';
  root.innerHTML=col('gold')+col('silver')+controls;
  root.querySelectorAll('[data-pk]').forEach(b=>b.onclick=()=>{const [k,v]=b.getAttribute('data-pk').split(':');myPick(k==='team'?v:null,k==='role'?v:null);});
  // host start hint
  if(R&&R.isHost){
    const gG=Object.keys(assign).filter(id=>assign[id].team==='gold').length;
    const sS=Object.keys(assign).filter(id=>assign[id].team==='silver').length;
    let hint='Empty roles are filled by 🤖 AI. You can start any time.';
    $('startHint').textContent=hint;
  }
  $('lobbyConn').style.color=(MP.state()==='joined')?'#2ec16b':'#ffb454';
}
function hasCmdIn(assign,t){return Object.keys(assign).some(id=>assign[id].team===t&&assign[id].role==='cmd');}
function teamRoleCountIn(assign,t,r){return Object.keys(assign).filter(id=>assign[id].team===t&&assign[id].role===r).length;}
function esc(s){return String(s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));}

/* ---- host starts the match ---- */
function hostStart(){
  if(!R||!R.isHost)return;
  const assign=R.assign;
  const ctrl={
    gold:{cmd:hasCmdIn(assign,'gold')?'human':'ai',gss:teamRoleCountIn(assign,'gold','gss')>0?'human':'ai'},
    silver:{cmd:hasCmdIn(assign,'silver')?'human':'ai',gss:teamRoleCountIn(assign,'silver','gss')>0?'human':'ai'}
  };
  const starting=Math.random()<.5?'gold':'silver';
  const board=makeBoard(null,false);
  const mid=(R._mid=(R._mid||0)+1);
  initGame({mode:'online',family:false,difficulty:2,online:true,isHost:true,board,starting,ctrl,assign,mid});
  MP.send('start',serializeStart());
  stopLobbyTimer();startHeartbeat();
  show('game');startFlow();
}
function rebuildFromState(s){
  const board=s.board.map(c=>({word:c.w,type:c.t,revealed:!!c.r,revealedAs:c.ra||null}));
  initGame({mode:'online',family:false,difficulty:2,online:true,isHost:false,board,starting:s.turn,ctrl:s.ctrl,assign:s.assign,mid:s.mid});
  G.phase=s.phase||'clue';G.clue=s.clue||null;if(s.remaining)G.remaining=s.remaining;if(s.tokens)G.tokens=s.tokens;if(s.shield)G.shield=s.shield;G.step=s.step||0;G._rseq=s.seq!=null?s.seq:null;G.winner=s.winner||null;G.reason=s.reason||null;if(s.log)G.log=s.log;
  if(curScreen!=='game')show('game');render();
}
function startFromNet(s){
  rebuildFromState(s);
  stopLobbyTimer();startGuestNet();
}
function serializeStart(){return {mid:G.mid,board:G.board.map(c=>({w:c.word,t:c.type,r:0,ra:null})),ctrl:G.ctrl,assign:G.assign,turn:G.turn,phase:G.phase,clue:G.clue,remaining:G.remaining,tokens:G.tokens,shield:G.shield,seq:G.seq,step:G.step};}
function serialize(){return {mid:G.mid,seq:G.seq,board:G.board.map(c=>({w:c.word,t:c.type,r:c.revealed?1:0,ra:c.revealedAs})),turn:G.turn,phase:G.phase,clue:G.clue,remaining:G.remaining,tokens:G.tokens,shield:G.shield,winner:G.winner,reason:G.reason,log:G.log.slice(-14),step:G.step,ctrl:G.ctrl,assign:G.assign};}
function broadcastState(){G.seq++;G._lastState=serialize();MP.send('state',G._lastState);}
function hostOnAct(a){
  if(!G||!G.isHost||G.winner||!a)return;
  if(a.mid!=null&&a.mid!==G.mid)return;   // ignore actions from a previous match
  if(a.team!==G.turn)return;
  const need=a.t==='clue'?'cmd':'gss';
  if(a.from&&G.assign&&G.assign[a.from]){const as=G.assign[a.from];if(as.team!==a.team||as.role!==need)return;}
  applyAction(a);
}
function applyState(s){
  if(!G||G.isHost||!s)return;
  if(s.mid!=null&&G.mid!==s.mid){rebuildFromState(s);return;}   // a new match started — rebuild, ignore stale
  if(s.seq!=null){if(G._rseq!=null&&s.seq<=G._rseq)return;G._rseq=s.seq;}
  const wasOver=G.winner;
  if(s.board)s.board.forEach((c,i)=>{if(G.board[i]){G.board[i].word=c.w;G.board[i].type=c.t;G.board[i].revealed=!!c.r;G.board[i].revealedAs=c.ra;}});
  G.turn=s.turn;G.phase=s.phase;G.clue=s.clue;if(s.remaining)G.remaining=s.remaining;if(s.tokens)G.tokens=s.tokens;if(s.shield)G.shield=s.shield;
  G.winner=s.winner;G.reason=s.reason;if(s.log)G.log=s.log;G.step=s.step;if(s.ctrl)G.ctrl=s.ctrl;if(s.assign)G.assign=s.assign;
  render();
  if(!wasOver&&G.winner){if(G.reason==='trap'){showTrap(G.winner);}else{const g=G.gen;setTimeout(()=>{if(G&&G.gen===g)showResult(G.winner,G.reason);},700);}}
}

/* ---- online timers ---- */
function startHeartbeat(){stopTimers();const g=G.gen;
  hbTimer=setInterval(()=>{if(!G||G.gen!==g){clearInterval(hbTimer);hbTimer=null;return;}if(G.isHost&&G._lastState)MP.send('state',G._lastState);if(R&&MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen();},3500);}
function startGuestNet(){stopTimers();
  pingTimer=setInterval(()=>{if(!R){clearInterval(pingTimer);pingTimer=null;return;}MP.send('ping',{from:myId});if(MP.state()!=='joined'&&MP.state()!=='joining')MP.reopen();},4000);}
function stopTimers(){[hbTimer,wdTimer,pingTimer].forEach(t=>t&&clearInterval(t));hbTimer=wdTimer=pingTimer=null;}
function stopLobbyTimer(){if(lobbyTimer){clearInterval(lobbyTimer);lobbyTimer=null;}}

/* ---- share links ---- */
function shareLink(){return location.origin+location.pathname+'?room='+(R?R.code:'');}

/* ============================================================
   TUTORIAL
   ============================================================ */
const TUT=[
  {e:'🕵️',t:'Welcome, Agent!',x:'Two spy teams — 🟡 Gold and ⚪ Silver — race to find their 14 secret agents hidden on a grid of 36 words.'},
  {e:'🎖️',t:'The Commander',x:'One player is the Commander. Only they see which cards are their agents. They give ONE word and a NUMBER, like “ANIMAL 3”.'},
  {e:'🔍',t:'The Guessers',x:'Guessers hear the clue and tap the cards they think are theirs. “ANIMAL 3” might mean TIGER, LION and MONKEY!'},
  {e:'⬜',t:'Be careful!',x:'Tap a Civilian or an enemy agent and your turn ends. 🎭 Find the Double Agent for a bonus guess & coins. 🚨 The Trap Card means instant defeat!'},
  {e:'🏆',t:'Win the mission',x:'First team to find all 14 of their agents wins. Use your Hint, Reveal and Protection tokens wisely. Good luck!'}
];
let tutI=0;
function startTutorial(){tutI=0;renderTut();openOv('tut');}
function renderTut(){const s=TUT[tutI];$('tutEmoji').textContent=s.e;$('tutTitle').textContent=s.t;$('tutText').textContent=s.x;
  const d=$('tutDots');d.innerHTML='';TUT.forEach((_,i)=>{const b=document.createElement('i');if(i===tutI)b.className='on';d.appendChild(b);});
  $('tutNext').textContent=tutI===TUT.length-1?'Start playing ▶':'Next ▶';}
function tutNext(){Sound.click();if(tutI<TUT.length-1){tutI++;renderTut();}else{closeOv('tut');SV.tutorialDone=true;save();}}
function tutSkip(){closeOv('tut');SV.tutorialDone=true;save();}

/* ============================================================
   SHOP / STATS / SETTINGS / MENU
   ============================================================ */
function refreshMenu(){$('coinsM').textContent=SV.coins;$$('.coinsX').forEach(e=>e.textContent=SV.coins);}
function renderShop(){
  $$('.coinsX').forEach(e=>e.textContent=SV.coins);
  const g=$('shopGrid');g.innerHTML='';
  THEMES.forEach(th=>{
    const owned=SV.owned.indexOf(th.id)>=0;const active=SV.theme===th.id;
    const d=document.createElement('div');d.className='theme-card'+(owned?' owned':'')+(active?' active':'');
    d.style.background=th.bg;
    d.innerHTML='<div class="tn">'+th.name+'</div><div class="tp '+(th.cost===0?'free':(owned?'have':'cost'))+'">'+(active?'✓ Active':owned?(th.cost===0?'Free':'Owned — tap to use'):'🪙 '+th.cost)+'</div>';
    d.onclick=()=>{
      Sound.click();
      if(owned){SV.theme=th.id;applyTheme(th.id);save();renderShop();toast(th.name+' theme on!');}
      else if(SV.coins>=th.cost){SV.coins-=th.cost;SV.owned.push(th.id);SV.theme=th.id;applyTheme(th.id);save();Sound.coin();renderShop();refreshMenu();toast('Unlocked '+th.name+'!');}
      else toast('Need '+(th.cost-SV.coins)+' more 🪙');
    };
    g.appendChild(d);
  });
}
function renderStats(){
  const s=SV.stats;const wr=s.played?Math.round(s.won/s.played*100):0;
  const items=[['🎮',s.played,'Played'],['🏆',s.won,'Won'],['📈',wr+'%','Win rate'],['🎯',s.correct,'Agents found'],['🔥',s.bestStreak,'Best streak'],['🎭',s.doubles,'Doubles found']];
  const g=$('statGrid');g.innerHTML='';
  items.forEach(it=>{const d=document.createElement('div');d.className='stat';d.innerHTML='<div class="sv">'+it[0]+' '+it[1]+'</div><div class="sl">'+it[2]+'</div>';g.appendChild(d);});
  $('bestClue').textContent=s.bestClue?(s.bestClue+' in one clue'):'—';
}
function renderSettings(){
  $('tSound').textContent=SV.sound?'On':'Off';$('tSound').classList.toggle('gold',SV.sound);
  $('tMusic').textContent=SV.music?'On':'Off';$('tMusic').classList.toggle('gold',SV.music);
  $('tCB').textContent=SV.cbmarks?'On':'Off';$('tCB').classList.toggle('gold',SV.cbmarks);
  $('setName').value=SV.name||'';
}

/* ============================================================
   BOOT / WIRING
   ============================================================ */
function boot(){
  refreshMenu();
  // menu mode buttons
  $$('.mode').forEach(b=>b.addEventListener('click',()=>selectMode(b.getAttribute('data-mode'))));
  // back buttons
  $$('[data-back]').forEach(b=>b.addEventListener('click',()=>{Sound.click();show(b.getAttribute('data-back'));}));
  $('shopBtn').onclick=()=>{Sound.click();renderShop();show('shop');};
  $('statsBtn').onclick=()=>{Sound.click();renderStats();show('stats');};
  $('setBtn').onclick=()=>{Sound.click();renderSettings();show('settings');};
  $('startLocalBtn').onclick=()=>{Sound.click();startLocalFromSetup();};
  // online
  $('createRoomBtn').onclick=()=>{Sound.click();createRoom();};
  $('joinRoomBtn').onclick=()=>{Sound.click();joinRoom($('joinCode').value);};
  $('joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')joinRoom($('joinCode').value);});
  $('leaveLobbyBtn').onclick=()=>{Sound.click();leaveRoom();show('online');};
  $('startOnlineBtn').onclick=()=>{Sound.click();hostStart();};
  $('shareBtn').onclick=async()=>{Sound.click();try{if(navigator.share){await navigator.share({title:'Codewords',text:'Join my Codewords room — code '+(R?R.code:''),url:shareLink()});return;}}catch(e){}try{await navigator.clipboard.writeText(shareLink());toast('Invite link copied!');}catch(e){toast(shareLink());}};
  $('copyBtn').onclick=async()=>{Sound.click();try{await navigator.clipboard.writeText(R?R.code:'');toast('Code copied!');}catch(e){toast('Code: '+(R?R.code:''));}};
  // game controls
  $('quitBtn').onclick=()=>{Sound.click();openConfirm('Quit the mission?','Your progress in this match will be lost.',()=>{quitToMenu();});};
  $('helpBtn').onclick=()=>{Sound.click();openOv('help');};
  $('helpClose').onclick=()=>{Sound.click();closeOv('help');};
  $('endGuessBtn').onclick=()=>{Sound.click();requestAction({t:'end',team:G.turn});};
  $('clueGo').onclick=submitClue;
  $('clueWord').addEventListener('keydown',e=>{if(e.key==='Enter')submitClue();});
  $('peekBtn').style.display='none';
  // overlays
  $('coverBtn').onclick=()=>{Sound.click();ackedCover=coverKey();closeOv('cover');render();};
  $('doubleBtn').onclick=()=>{Sound.click();closeOv('double');};
  $('trapBtn').onclick=()=>{Sound.click();closeOv('trap');if(G&&G.winner)showResult(G.winner,G.reason);};
  $('tutNext').onclick=tutNext;$('tutSkip').onclick=tutSkip;
  // settings toggles
  $('tSound').onclick=()=>{SV.sound=!SV.sound;save();renderSettings();if(SV.sound)Sound.click();};
  $('tMusic').onclick=()=>{SV.music=!SV.music;save();renderSettings();if(SV.music)Sound.startMusic();else Sound.stopMusic();};
  $('tCB').onclick=()=>{SV.cbmarks=!SV.cbmarks;save();renderSettings();if(G)render();};
  $('setName').addEventListener('input',e=>{SV.name=e.target.value.slice(0,14);save();});
  $('tutorialAgain').onclick=()=>{Sound.click();startTutorial();};
  $('resetStats').onclick=()=>{openConfirm('Reset all stats?','This clears your record (coins & themes stay).',()=>{SV.stats=defSave().stats;save();renderStats();toast('Stats reset');});};
  // auto-join from ?room=
  try{const rc=new URLSearchParams(location.search).get('room');if(rc){const code=rc.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);if(code.length===4){setTimeout(()=>joinRoom(code),400);}}}catch(e){}
  // first-time tutorial
  if(!SV.tutorialDone)setTimeout(()=>{if(curScreen==='menu')startTutorial();},600);
}
function submitClue(){
  if(!canClueNow())return;
  const w=$('clueWord').value;
  if(!w.trim().replace(/[^A-Za-z]/g,'')){toast('Type a one-word clue');$('clueWord').focus();return;}
  Sound.click();
  requestAction({t:'clue',team:G.turn,word:w,num:selNum});
  $('clueWord').value='';
}
let confirmCb=null;
function openConfirm(title,text,cb){$('cfTitle').textContent=title;$('cfText').textContent=text;confirmCb=cb;openOv('confirm');}
$('cfYes').onclick=()=>{closeOv('confirm');if(confirmCb)confirmCb();confirmCb=null;};
$('cfNo').onclick=()=>{closeOv('confirm');confirmCb=null;};

// quit/leave safety on unload
window.addEventListener('beforeunload',()=>{try{if(R)MP.leave();}catch(e){}});

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();

/* test-only hook (inert unless ?cwtest is in the URL) */
try{if(String(location.search).indexOf('cwtest')>=0){window.CW_T={myId,getG:()=>G,getR:()=>R,AI,makeBoard,startLocal,requestAction,createRoom,joinRoom,hostStart,myPick,selectMode,submitClueVal:(w,n)=>{$('clueWord').value=w;selNum=n;submitClue();}};}}catch(e){}
})();
