import { hasLineOfSight, playerPose } from './world.js';
import { sameTeam } from './teams.js';

export function botRouteSeed(id, life = 0) {
  let seed = (life * 2654435761) >>> 0;
  for (const letter of id) seed = (Math.imul(seed, 31) + letter.charCodeAt(0)) >>> 0;
  return seed || 1;
}

export function segmentDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z, length = dx * dx + dy * dy + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / length)) : 0;
  return Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t, point.z - start.z - dz * t);
}

// Only real server traces produce cues. Store the sound's historical origin,
// never a live target position; walls still block vision and actual bullets.
export function alertBotsToShot(players, shooter, origin, rays, world, now, random = Math.random) {
  for (const bot of players.values()) {
    if (!bot.isBot || bot.id === shooter.id || bot.hp <= 0 || bot.roomStatus === 'waiting' || sameTeam(bot, shooter)) continue;
    const ear = { x: bot.x, y: bot.y + playerPose(bot).eyeHeight, z: bot.z }, distance = Math.hypot(ear.x - origin.x, ear.y - origin.y, ear.z - origin.z);
    const nearMiss = rays.some(ray => segmentDistance(ear, origin, ray.end) < 2.4);
    const range = shooter.suppressor ? 20 : 70;
    if (!nearMiss && (distance > range || distance > range * .5 && !hasLineOfSight(origin, ear, world))) continue;
    const brain = bot.botBrain;
    if (!brain || brain.alert?.at === now && brain.alert.nearMiss && !nearMiss) continue;
    const bearing = Math.atan2(origin.z - ear.z, origin.x - ear.x) + (random() * 2 - 1) * (nearMiss ? .045 : .16);
    const old = brain.alert, reactionAt = now + (nearMiss ? 140 : 240) + random() * 180;
    brain.alert = { sourceId: shooter.id, x: ear.x + Math.cos(bearing) * distance, y: origin.y, z: ear.z + Math.sin(bearing) * distance, at: now, reactAt: old?.sourceId === shooter.id && old.until > now ? Math.min(old.reactAt, reactionAt) : reactionAt, until: now + 3000, nearMiss };
  }
}

export function botLongRange(weapon, behavior) {
  const extra = weapon.type === 'SNIPER' ? 45 : weapon.type === 'DMR' ? 30 : ['ASSAULT','LMG'].includes(weapon.type) ? 22 : 0;
  return Math.min(weapon.range, behavior.firingRange + extra);
}
