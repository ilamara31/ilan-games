// Cosmetics.js — skins (distinct looks), trails, auras, power coils + economy
export const SKINS = [
  { id: 'rookie',   name: 'Rookie',          cost: 0,    shirt: 0x5fe0ff, pants: 0x2e3b66, accessory: null },
  { id: 'ninja',    name: 'Ninja Warrior',   cost: 250,  shirt: 0x1a1a2e, pants: 0x0d0d1a, accessory: 'ninja' },
  { id: 'robot',    name: 'Cyber Robot',     cost: 450,  shirt: 0x9aa6b5, pants: 0x6a7585, accessory: 'robot',   metal: 0.85, emissive: 0x1199ff, emissiveInt: 0.25 },
  { id: 'fire',     name: 'Fire Knight',     cost: 750,  shirt: 0xc0392b, pants: 0x5a1a10, accessory: 'knight',  emissive: 0xff4400, emissiveInt: 0.45 },
  { id: 'ice',      name: 'Ice Mage',        cost: 1000, shirt: 0x5fa8ff, pants: 0x244a8a, accessory: 'mage',    emissive: 0x66ccff, emissiveInt: 0.4 },
  { id: 'shadow',   name: 'Shadow Assassin', cost: 1500, shirt: 0x241733, pants: 0x120a1e, accessory: 'assassin', emissive: 0x8a2be2, emissiveInt: 0.3 },
  { id: 'galaxy',   name: 'Galaxy Hero',     cost: 2400, shirt: 0x4b2a8a, pants: 0x1a0d3a, accessory: 'galaxy',  emissive: 0x9b5cff, emissiveInt: 0.55 },
  { id: 'gold',     name: 'Golden Champion', cost: 4000, shirt: 0xffd54a, pants: 0x8a6a00, accessory: 'gold',    metal: 0.9, emissive: 0xffaa00, emissiveInt: 0.3 },
];

export const TRAILS = [
  { id: 'none',      name: 'None',           cost: 0,    color: null },
  { id: 'rainbow',   name: 'Rainbow Trail',  cost: 400,  color: 'rainbow' },
  { id: 'fire',      name: 'Fire Trail',     cost: 650,  color: 0xff5a1e, effect: 'fire' },
  { id: 'lightning', name: 'Lightning Trail',cost: 900,  color: 0xeaff5a, effect: 'lightning' },
  { id: 'galaxy',    name: 'Galaxy Trail',   cost: 1300, color: 0x9b5cff },
  { id: 'crystal',   name: 'Crystal Trail',  cost: 1800, color: 0x6fe9ff },
  { id: 'lava',      name: 'Lava Trail',     cost: 2400, color: 0xff2a00, effect: 'fire' },
  { id: 'neon',      name: 'Neon Trail',     cost: 3200, color: 0x39ff88 },
];

export const AURAS = [
  { id: 'none',      name: 'None',            cost: 0,    color: null },
  { id: 'blue',      name: 'Blue Energy Aura',cost: 500,  color: 0x33aaff },
  { id: 'fire',      name: 'Fire Aura',       cost: 950,  color: 0xff5a1e },
  { id: 'lightning', name: 'Lightning Aura',  cost: 1500, color: 0xeaff5a },
  { id: 'galaxy',    name: 'Galaxy Aura',     cost: 2400, color: 0x9b5cff },
  { id: 'gold',      name: 'Golden Aura',     cost: 3800, color: 0xffd54a },
  { id: 'shadow',    name: 'Shadow Aura',     cost: 5500, color: 0x8a2be2 },
];

export const POWERS = [
  { id: 'none',    name: 'None',         cost: 0,    swatch: 0x666666, desc: 'No boost',          speed: 1,    grav: 1,    jump: 1 },
  { id: 'speed',   name: 'Speed Coil',   cost: 1600, swatch: 0x39ff88, desc: '+25% run speed',    speed: 1.25, grav: 1,    jump: 1 },
  { id: 'gravity', name: 'Gravity Coil', cost: 2200, swatch: 0x9b5cff, desc: 'Floaty low gravity', speed: 1,   grav: 0.78, jump: 1.05 },
  { id: 'jump',    name: 'Jump Coil',    cost: 2800, swatch: 0xffd54a, desc: '+22% jump height',   speed: 1,    grav: 1,    jump: 1.22 },
];

export const CATS = { skins: SKINS, trails: TRAILS, auras: AURAS, power: POWERS };
export const byId = (cat, id) => CATS[cat].find(x => x.id === id) || CATS[cat][0];
