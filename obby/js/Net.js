// Net.js — multiplayer scaffolding. Today it only runs bots locally, but the shape
// (player registry + snapshot send/receive hooks) is ready to drop a real server into.
import { Bot } from './Bot.js';

const BOT_NAMES = ['Zoomer', 'PixelPablo', 'JumpKing', 'NoobMaster', 'SkyWalker', 'TacoCat',
  'GlitchGuy', 'BananaBoi', 'SpeedyG', 'MoonHopper', 'LavaLad', 'CookieQ'];

export class Net {
  constructor(scene, world, { localName, population = 5 } = {}) {
    this.scene = scene; this.world = world;
    this.localName = localName;
    this.population = population;        // desired total players in the room
    this.bots = [];
    this.remotes = new Map();           // <id, RemoteAvatar>  (reserved for real multiplayer)
    this.connected = false;             // becomes true once a server is wired in
  }

  // fill the room with bots whenever there aren't enough real players online
  ensureBots() {
    const humans = 1 + this.remotes.size;
    const used = new Set();
    while (humans + this.bots.length < this.population) {
      let n; do { n = BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0]; } while (used.has(n) && used.size < BOT_NAMES.length);
      used.add(n);
      this.bots.push(new Bot(this.scene, this.world, n + (Math.random() < 0.4 ? (10 + (Math.random() * 89 | 0)) : '')));
    }
  }

  update(dt) {
    for (const b of this.bots) b.update(dt);
    // when networked: interpolate this.remotes here from received snapshots
  }

  // roster for the HUD (humans + bots)
  roster(local) {
    const list = [{ name: local.name, color: local.char.color, isBot: false, you: true }];
    for (const b of this.bots) list.push({ name: b.name, color: b.char.color, isBot: true });
    return list;
  }

  // ---- networking hooks (no-ops until a server is connected) ----
  connect(/* url */) { /* TODO: open WebSocket, set this.connected = true */ }
  sendState(/* snapshot */) { if (!this.connected) return; /* TODO: ws.send(JSON.stringify(snapshot)) */ }
  onSnapshot(/* msg */) { /* TODO: update this.remotes avatars from server */ }
}
