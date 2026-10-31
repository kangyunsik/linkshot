import { bounds, hasLineOfSight } from './world.js';

export const EQUIPMENT_RULES = Object.freeze({ pickupRange: 1.8, pickupHeight: 1.25, equipMs: 350, actionMs: 350, lifetimeMs: 60_000, maxDrops: 32 });

// The HUD and both authoritative transports use the same contextual G priority.
export function nearestDroppedWeapon(player, drops, world, now) {
  if (!player || player.hp <= 0) return null;
  const origin = { x: player.x, y: player.y + .55, z: player.z };
  let nearest = null, distance = Infinity;
  for (const drop of drops) {
    if (now < drop.pickupAt || now >= drop.expiresAt || Math.abs(drop.y - player.y) > EQUIPMENT_RULES.pickupHeight) continue;
    const horizontal = Math.hypot(drop.x - player.x, drop.z - player.z), range = Math.hypot(horizontal, drop.y - player.y);
    if (horizontal > EQUIPMENT_RULES.pickupRange || range >= distance) continue;
    if (!hasLineOfSight(origin, { x: drop.x, y: drop.y + .12, z: drop.z }, world)) continue;
    nearest = drop; distance = range;
  }
  return nearest;
}

export function settleDroppedWeapon(drop, dt, world) {
  if (drop.grounded) return;
  const previous = drop.y; drop.y += drop.vy * dt - 9.8 * dt * dt / 2; drop.vy -= 9.8 * dt;
  let floor = 0;
  for (const obstacle of world.obstacles) {
    const b = bounds(obstacle);
    if (drop.x > b.minX && drop.x < b.maxX && drop.z > b.minZ && drop.z < b.maxZ && b.maxY <= previous + .00001 && b.maxY >= drop.y) floor = Math.max(floor, b.maxY);
  }
  if (drop.y <= floor) { drop.y = floor; drop.vy = 0; drop.grounded = true; }
}
