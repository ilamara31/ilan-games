// HUD.js — all DOM/UI: HUD, leaderboard, welcome, popups, shop, win, events
export class HUD {
  constructor() {
    this.$ = id => document.getElementById(id);
    this._shopCb = null;
    this.$('shopGrid').addEventListener('click', e => {
      const btn = e.target.closest('button[data-id]'); if (!btn || !this._shopCb) return;
      this._shopCb(btn.dataset.id, btn.dataset.action);
    });
  }

  showGameUI() { for (const id of ['hud', 'roster', 'touchUI']) this.$(id).classList.remove('hidden'); }
  hideOverlay() { this.$('overlay').classList.add('hidden'); }
  hideLoading() { this.$('loading').classList.add('hidden'); }
  getName() { const v = (this.$('nameInput').value || '').trim(); return v || ('Player' + (100 + (Math.random() * 899 | 0))); }
  setName(n) { this.$('nameInput').value = n || ''; }

  fmtTime(ms) { if (!ms) return '--'; const s = ms / 1000; if (s < 60) return s.toFixed(1) + 's'; const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0'); }

  setCoins(n) { this.$('coinCount').textContent = n; }
  setProgress(stage, total) { this.$('stageName').textContent = stage + '/' + total; this.$('cpVal').textContent = Math.round((stage - 1) / total * 100); }
  setComplete(total) { this.$('stageName').textContent = total + '/' + total; this.$('cpVal').textContent = 100; }
  setTime(s) { this.$('timeVal').textContent = s.toFixed(1); }
  setBest(ms) { this.$('bestVal').textContent = this.fmtTime(ms); }
  setTheme(name) { this.$('themeName').textContent = name; }

  flash() { const f = this.$('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
  toast(text, color = '#fff') { const t = this.$('toast'); t.textContent = text; t.style.color = color; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
  event(text) { const b = this.$('eventBanner'); b.textContent = text; b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }

  renderLeaderboard(list) {
    this.$('roster').innerHTML = '<div class="lb-title">🏆 LEADERBOARD</div>' + list.slice(0, 8).map((p, i) =>
      `<div class="rost${p.isBot ? ' bot' : ''}${p.you ? ' you' : ''}"><span class="rk">${i + 1}</span>` +
      `<span class="dot" style="background:#${p.color.toString(16).padStart(6, '0')}"></span>` +
      `<span class="nm">${p.name}${p.you ? ' (you)' : ''}</span><span class="st">S${p.stage}</span></div>`).join('');
  }

  // welcome / menu
  showWelcome() { this.$('welcome').classList.remove('hidden'); }
  hideWelcome() { this.$('welcome').classList.add('hidden'); }
  onWelcomePlay(cb) { this.$('welcomePlay').addEventListener('click', cb); }
  setMenuStats(html) { this.$('menuStats').innerHTML = html; }
  showContinue(on) { this.$('continueBtn').classList.toggle('hidden', !on); }
  showMenuShop(on) { this.$('menuShopBtn').classList.toggle('hidden', !on); }
  onPlay(cb) { this.$('playBtn').addEventListener('click', cb); }
  onContinue(cb) { this.$('continueBtn').addEventListener('click', cb); }
  onMenuShop(cb) { this.$('menuShopBtn').addEventListener('click', cb); }
  showMenu() { this.$('overlay').classList.remove('hidden'); }

  // generic popup
  popup(title, bodyHtml, btnText, cb) {
    this.$('popTitle').innerHTML = title; this.$('popBody').innerHTML = bodyHtml; this.$('popBtn').textContent = btnText || 'OK';
    const p = this.$('popup'); p.classList.remove('hidden');
    const card = p.querySelector('.card'); card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
    const btn = this.$('popBtn'); const handler = () => { p.classList.add('hidden'); btn.removeEventListener('click', handler); if (cb) cb(); };
    btn.addEventListener('click', handler);
  }

  // shop
  revealShopBtn() { this.$('shopBtn').classList.remove('hidden'); }
  openShop() { this.$('shop').classList.remove('hidden'); }
  closeShop() { this.$('shop').classList.add('hidden'); }
  setShopBal(n) { this.$('shopBal').textContent = n; }
  _tabs() { return [['tabSkins', 'skins'], ['tabTrails', 'trails'], ['tabAuras', 'auras'], ['tabPower', 'power']]; }
  setShopTab(tab) { for (const [id, k] of this._tabs()) this.$(id).classList.toggle('active', tab === k); }
  onShopBtn(cb) { this.$('shopBtn').addEventListener('click', cb); }
  onExit(cb) { this.$('exitBtn').addEventListener('click', cb); }
  revealExitBtn() { this.$('exitBtn').classList.remove('hidden'); }
  onShopClose(cb) { this.$('shopClose').addEventListener('click', cb); }
  onShopTab(cb) { for (const [id, k] of this._tabs()) this.$(id).addEventListener('click', () => cb(k)); }
  onShopAction(cb) { this._shopCb = cb; }
  renderShop(items) {
    this.$('shopGrid').innerHTML = items.map(it => {
      const sw = it.rainbow ? 'background:conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)'
        : it.swatch != null ? `background:#${it.swatch.toString(16).padStart(6, '0')}` : 'background:repeating-linear-gradient(45deg,#444,#444 5px,#666 5px,#666 10px)';
      let btn;
      if (it.equipped) btn = `<button class="equip" data-id="${it.id}" data-action="equip" disabled>EQUIPPED</button>`;
      else if (it.owned) btn = `<button class="owned" data-id="${it.id}" data-action="equip">EQUIP</button>`;
      else btn = `<button data-id="${it.id}" data-action="buy" ${it.afford ? '' : 'disabled'}>🪙 ${it.cost}</button>`;
      return `<div class="shop-item${it.equipped ? ' equipped' : ''}"><div class="sw" style="${sw}"></div><div class="nm">${it.name}</div>${it.desc ? `<div class="desc">${it.desc}</div>` : ''}${btn}</div>`;
    }).join('');
  }

  // win
  showWin(html) { this.$('winStats').innerHTML = html; this.$('rebirthBtn').classList.add('hidden'); this.$('winScreen').classList.remove('hidden'); }
  hideWin() { this.$('winScreen').classList.add('hidden'); }
  onAgain(cb) { this.$('againBtn').addEventListener('click', cb); }
  onRebirth(cb) { this.$('rebirthBtn').addEventListener('click', cb); }
}
