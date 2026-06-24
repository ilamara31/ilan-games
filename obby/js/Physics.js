// Physics.js — shared ground/landing resolution against world platforms
// pos = feet position. Mutates pos.y & vel.y when landing. Returns the platform landed on (or null).
export function resolveGround(world, pos, vel, prevY, r = 0.32) {
  let best = null, bestTop = -Infinity;
  for (const p of world.platforms) {
    if (p.solid === false) continue;                 // disappearing platform currently gone
    if (pos.x < p.minX - r || pos.x > p.maxX + r) continue;
    if (pos.z < p.minZ - r || pos.z > p.maxZ + r) continue;
    if (vel.y > 0.001) continue;                 // moving up -> don't snap
    const top = p.top;
    if (prevY >= top - 0.06 && pos.y <= top + 0.02 && top > bestTop) { bestTop = top; best = p; }
  }
  if (best) { pos.y = best.top; vel.y = 0; }
  return best;
}

// hazard hit test: lasers (kill) + rolling balls (knock).
// includeLasers=false lets bots ignore lasers so they don't get stuck.
export function hazardHit(world, pos, includeLasers = true) {
  if (includeLasers && world.lasers) {
    for (const L of world.lasers) {
      if (!L.active) continue;
      if (pos.x < L.minX || pos.x > L.maxX) continue;
      if (pos.z < L.minZ || pos.z > L.maxZ) continue;
      if (pos.y < L.y + 0.35) return { effect: 'kill' };   // jump above the beam to clear it
    }
  }
  if (world.hazardBalls) {
    for (const b of world.hazardBalls) {
      const dx = pos.x - b.x, dz = pos.z - b.base.z;
      const rr = (b.r + 0.35);
      if (dx * dx + dz * dz < rr * rr && pos.y < b.y + b.r) {
        const len = Math.hypot(dx, dz) || 1;
        return { effect: 'knock', x: dx / len, z: dz / len };
      }
    }
  }
  return null;
}

// rotating-bar hit test: returns an outward unit direction {x,z} if struck, else null
export function rotatorHit(world, pos) {
  for (const r of world.rotators) {
    if (Math.abs(pos.y - r.y) > 0.95) continue;
    const px = pos.x - r.x, pz = pos.z - r.z;
    const dist = Math.hypot(px, pz);
    if (dist < 0.5 || dist > r.reach) continue;
    for (let a = 0; a < r.arms; a++) {
      const th = r.angle + a * Math.PI / r.arms;
      const dx = Math.cos(th), dz = -Math.sin(th);
      const along = px * dx + pz * dz;
      const perp = px * dz - pz * dx;
      if (Math.abs(perp) < 0.5 && Math.abs(along) < r.reach) {
        const len = dist || 1;
        return { x: px / len, z: pz / len };
      }
    }
  }
  return null;
}
