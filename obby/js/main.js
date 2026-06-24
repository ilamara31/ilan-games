// main.js — bootstrap + game flow (saves, welcome, shop w/ skins·trails·auras·power, events, themes)
import * as THREE from 'three';
import { World } from './World.js';
import { Particles } from './Particles.js';
import { Controls } from './Controls.js';
import { CameraRig } from './CameraRig.js';
import { Player } from './Player.js';
import { Net } from './Net.js';
import { HUD } from './HUD.js';
import { Music } from './Music.js';
import { Save } from './Save.js';
import { CATS, byId } from './Cosmetics.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

const world = new World(scene);
const particles = new Particles(scene);
const controls = new Controls();
const camRig = new CameraRig(camera, canvas);
const hud = new HUD();
const music = new Music();

let player = null, net = null;
let running = false, paused = false, time = 0, startT = 0, elapsed = 0;
let curThemeIdx = 0, currentTab = 'skins', shopFromRun = false;
let playT = 0, playIdx = 0;        // timed play rewards
const events = { next: 30, active: null, until: 0 };
const presentationFocus = new THREE.Vector3(0, 1.4, 20);

// category -> Save keys
const OWN = { skins: 'ownedSkins', trails: 'ownedTrails', auras: 'ownedAuras', power: 'ownedPowers' };
const EQ = { skins: 'skin', trails: 'trail', auras: 'aura', power: 'power' };

Save.load();
camRig.snap(presentationFocus);
hud.hideLoading();

// ---------- menu ----------
function refreshMenu() {
  const d = Save.data;
  hud.setName(d.name); hud.setBest(d.bestTimeMs);
  hud.setMenuStats(`<span>Best Stage <b>${d.bestStage}</b></span><span>Best Time <b>${hud.fmtTime(d.bestTimeMs)}</b></span><span>🪙 <b>${d.coins}</b></span>`);
  hud.showContinue(d.bestStage > 1);
  hud.showMenuShop(true);
}
if (!Save.data.seenWelcome) { hud.hideOverlay(); hud.showWelcome(); }
else { refreshMenu(); maybeDaily(); }
hud.onWelcomePlay(() => { Save.data.seenWelcome = true; Save.save(); hud.hideWelcome(); hud.showMenu(); refreshMenu(); maybeDaily(); });

// ---------- daily reward ----------
function maybeDaily() {
  const today = Save.todayStr(); if (Save.data.lastDaily === today) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yStr = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
  Save.data.dailyStreak = (Save.data.lastDaily === yStr) ? Save.data.dailyStreak + 1 : 1;
  const reward = 25 + Math.min(Save.data.dailyStreak, 7) * 8;
  Save.data.lastDaily = today; Save.addCoins(reward);
  music.ensure(); music.sfxUnlock();
  hud.popup('🎁 Daily Reward!', `Welcome back! Here are <b>${reward}</b> coins.<br>Daily streak: <b>${Save.data.dailyStreak}</b> 🔥`, 'COLLECT', refreshMenu);
}

// ---------- shop ----------
function swatchOf(cat, it) {
  if (cat === 'skins') return { swatch: it.shirt };
  if (cat === 'trails') return it.color === 'rainbow' ? { rainbow: true } : { swatch: it.color != null ? it.color : 0x556070 };
  if (cat === 'auras') return { swatch: it.color != null ? it.color : 0x556070 };
  return { swatch: it.swatch };
}
function buildShopItems(cat) {
  return CATS[cat].map(it => {
    const owned = Save.data[OWN[cat]].includes(it.id), equipped = Save.data[EQ[cat]] === it.id;
    return Object.assign({ id: it.id, name: it.name, cost: it.cost, owned, equipped, desc: it.desc, afford: Save.data.coins >= it.cost }, swatchOf(cat, it));
  });
}
function refreshShop() { hud.setShopBal(Save.data.coins); hud.setShopTab(currentTab); hud.renderShop(buildShopItems(currentTab)); }
function applyEquip(cat, it) {
  if (!player) return;
  if (cat === 'skins') player.setSkin(it);
  else if (cat === 'trails') player.setTrail(it);
  else if (cat === 'auras') player.setAura(it);
  else player.setPower(it);
}
function openShop(fromRun) { shopFromRun = fromRun; if (fromRun) paused = true; currentTab = 'skins'; refreshShop(); hud.openShop(); }
hud.onShopTab(t => { currentTab = t; refreshShop(); });
hud.onShopClose(() => { hud.closeShop(); if (shopFromRun) { paused = false; shopFromRun = false; } else refreshMenu(); });
hud.onShopBtn(() => openShop(true));
hud.onMenuShop(() => openShop(false));
hud.onShopAction((id, action) => {
  const cat = currentTab, it = byId(cat, id); if (!it) return;
  if (action === 'buy') {
    if (Save.spend(it.cost)) {
      Save.data[OWN[cat]].push(id); Save.data[EQ[cat]] = id; Save.save();
      applyEquip(cat, it); music.sfxUnlock(); hud.toast('Unlocked ' + it.name + '! 🎉', '#9bff8a');
    }
  } else { Save.data[EQ[cat]] = id; Save.save(); applyEquip(cat, it); }
  refreshShop();
});

// ---------- start / win ----------
function startGame(continueRun) {
  const name = hud.getName(); Save.data.name = name; Save.save();
  let startStage = 1, startPos = null;
  if (continueRun && Save.data.bestStage > 1) {
    const cp = world.checkpoints.find(c => c.stage === Save.data.bestStage);
    if (cp) { startStage = cp.stage; startPos = new THREE.Vector3(cp.cx, cp.top + 0.1, cp.cz); }
  }
  player = new Player(scene, world, particles, hud, name, {
    audio: music, skin: byId('skins', Save.data.skin), trail: byId('trails', Save.data.trail),
    aura: byId('auras', Save.data.aura), power: byId('power', Save.data.power), startStage, startPos,
  });
  player.onCoin = amt => { Save.addCoins(amt); hud.setCoins(Save.data.coins); };
  player.onSecret = amt => { Save.addCoins(amt); hud.setCoins(Save.data.coins); };
  player.onCheckpoint = st => { Save.reachStage(st); };
  player.onWin = onWin;

  net = new Net(scene, world, { localName: name, population: 6 }); net.ensureBots();
  hud.renderLeaderboard(buildLeaderboard());
  hud.setCoins(Save.data.coins); hud.setProgress(player.stage, world.totalStages); hud.setBest(Save.data.bestTimeMs);
  curThemeIdx = world.themeForStage(player.stage); world.setTheme(curThemeIdx); hud.setTheme(world.themes[curThemeIdx].name);

  hud.showGameUI(); hud.hideOverlay(); hud.hideWelcome();
  document.getElementById('musicBtn').classList.remove('hidden');
  hud.revealShopBtn();                            // shop always available while playing
  hud.revealExitBtn();                            // exit-to-menu (progress kept)
  camRig.yaw = 0; camRig.snap(player.pos);
  events.next = 30; events.active = null; playT = 0; playIdx = 0;
  startT = time; running = true; paused = false; music.start();
}

// timed play rewards: every 5 minutes -> 10, 20, 40, 80 … (capped)
function tickPlayReward(dt) {
  playT += dt;
  if (playT >= 300) {
    playT -= 300;
    const amt = Math.min(320, 10 * Math.pow(2, playIdx)); playIdx++;
    Save.addCoins(amt); hud.setCoins(Save.data.coins);
    hud.event('🎁 Play Reward  +' + amt + ' coins!'); music.sfxUnlock();
  }
}
function onWin() {
  const ms = (time - startT) * 1000;
  const prevBest = Save.data.bestTimeMs; Save.recordTime(ms); Save.reachStage(world.totalStages);
  hud.setComplete(world.totalStages);
  const isPB = prevBest === 0 || ms < prevBest;
  hud.showWin(`You finished all <b>${world.totalStages}</b> stages!<br>Time: <b>${hud.fmtTime(ms)}</b>${isPB ? ' 🏆 New Best!' : ''}<br>Best: <b>${hud.fmtTime(Save.data.bestTimeMs)}</b> &nbsp;•&nbsp; 🪙 Bank: <b>${Save.data.coins}</b>`);
}
hud.onAgain(() => location.reload());
hud.onPlay(() => startGame(false));
hud.onContinue(() => startGame(true));
hud.onExit(() => { Save.save(); location.reload(); });   // back to home menu; stage is saved -> Continue resumes it
document.getElementById('musicBtn').addEventListener('click', () => { document.getElementById('musicBtn').textContent = music.toggle() ? '🔊' : '🔇'; });

// ---------- leaderboard ----------
function buildLeaderboard() {
  const list = [{ name: player.name, stage: player.stage, color: player.char.color, you: true }];
  for (const b of net.bots) list.push({ name: b.name, stage: b.stage, color: b.char.color, isBot: true });
  list.sort((a, b) => b.stage - a.stage); return list;
}

// ---------- random events ----------
const EVENTS = [
  { id: 'lowgrav', text: '🌙 Low Gravity!', dur: 14, apply: p => p.fx.grav = 0.55 },
  { id: 'speed', text: '💨 Speed Day!', dur: 14, apply: p => p.fx.speed = 1.35 },
  { id: 'coinrush', text: '💰 Coin Rush x2!', dur: 16, apply: p => p.fx.coinMul = 2 },
];
function tickEvents(dt) {
  if (events.active && time > events.until) { player.fx = { grav: 1, speed: 1, coinMul: 1 }; events.active = null; }
  events.next -= dt;
  if (events.next <= 0 && !events.active) {
    const e = EVENTS[(Math.random() * EVENTS.length) | 0];
    player.fx = { grav: 1, speed: 1, coinMul: 1 }; e.apply(player);
    events.active = e.id; events.until = time + e.dur; events.next = 28 + Math.random() * 16;
    hud.event(e.text); music.sfxEvent();
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
let rosterTick = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  if (running && !paused && player) {
    time += dt;
    world.update(dt, time);
    const input = controls.read();
    player.update(dt, input, camRig);
    net.update(dt);
    world.updateShadow(player.pos);
    camRig.update(dt, player.pos);
    if (!player.won) {
      elapsed = time - startT; hud.setTime(elapsed); hud.setProgress(player.stage, world.totalStages);
      tickEvents(dt); tickPlayReward(dt);
      const ti = world.themeForStage(player.stage);
      if (ti !== curThemeIdx) { curThemeIdx = ti; world.setTheme(ti); hud.setTheme(world.themes[ti].name); hud.toast('🌍 ' + world.themes[ti].name + '!', '#5fe0ff'); }
    }
    if ((rosterTick += dt) > 0.8) { rosterTick = 0; hud.renderLeaderboard(buildLeaderboard()); }
    particles.update(dt);
  } else if (!running) {
    time += dt; camRig.yaw += dt * 0.12; camRig.update(dt, presentationFocus); particles.update(dt);
  }
  renderer.render(scene, camera);
}
loop();
