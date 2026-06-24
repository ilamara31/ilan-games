// Save.js — persistent meta-progress in localStorage (coins, unlocks, cosmetics, best time…)
const KEY = 'ilanObbySave_v1';

function defaults() {
  return {
    v: 1,
    seenWelcome: false,
    bestStage: 1,
    bestTimeMs: 0,
    coins: 0,                 // banked currency
    ownedSkins: ['rookie'],
    ownedTrails: ['none'],
    ownedAuras: ['none'],
    ownedPowers: ['none'],
    skin: 'rookie',
    trail: 'none',
    aura: 'none',
    power: 'none',
    lastDaily: '',            // YYYY-MM-DD
    dailyStreak: 0,
  };
}

export const Save = {
  data: defaults(),

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        this.data = Object.assign(defaults(), s);
        for (const k of ['ownedSkins', 'ownedTrails', 'ownedAuras', 'ownedPowers'])
          if (!Array.isArray(this.data[k])) this.data[k] = defaults()[k];
      }
    } catch (e) { this.data = defaults(); }
    return this.data;
  },

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {} },

  // helpers
  addCoins(n) { this.data.coins = Math.max(0, this.data.coins + n); this.save(); },
  spend(n) { if (this.data.coins >= n) { this.data.coins -= n; this.save(); return true; } return false; },
  reachStage(stage) { if (stage > this.data.bestStage) { this.data.bestStage = stage; this.save(); } },
  recordTime(ms) { if (ms > 0 && (this.data.bestTimeMs === 0 || ms < this.data.bestTimeMs)) { this.data.bestTimeMs = ms; this.save(); } },
  todayStr() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },
};
