import { damageBearing, hasLineOfSight, playerPose } from '../shared/world.js';

export const BULLET_PASS_RADIUS = 1.85;
const maxDistanceSquared = BULLET_PASS_RADIUS ** 2;
const panLimit = n => Math.max(-.96, Math.min(.96, n));
const position = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

export function incomingBulletPass(event, listener, yaw, selfId, world) {
  if (!position(listener) || !position(event.origin) || event.id === selfId || event.melee || event.hit === selfId) return null;
  const rays = event.rays?.length ? event.rays : [{ end: event.end }];
  if (rays.some(ray => ray.hit === selfId || ray.protectedTarget === selfId || ray.friendlyTarget === selfId)) return null;

  const ear = { x: listener.x, y: listener.y + playerPose(listener).eyeHeight, z: listener.z };
  // A round grazing the upper body is audible as well as one beside the ear.
  const height = ear.y - .17, from = event.origin;
  const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
  let closestSquared = maxDistanceSquared, best = null;
  for (const { end } of rays) {
    if (!position(end)) continue;
    const dx = end.x - from.x, dy = end.y - from.y, dz = end.z - from.z;
    const length2 = dx * dx + dy * dy + dz * dz;
    if (length2 < .25) continue;
    const t = ((ear.x - from.x) * dx + (height - from.y) * dy + (ear.z - from.z) * dz) / length2;
    // Never extend the trace past its first impact, or treat an endpoint
    // (a muzzle/nearby wall impact) as a bullet that actually passed by.
    if (t <= 0 || t >= 1 || t * t * length2 < .16 || (1 - t) ** 2 * length2 < .01) continue;
    const x = from.x + t * dx, y = from.y + t * dy, z = from.z + t * dz;
    const xOffset = x - ear.x, zOffset = z - ear.z;
    const distance2 = xOffset * xOffset + (y - height) ** 2 + zOffset * zOffset;
    if (distance2 >= closestSquared || world && !hasLineOfSight(ear, { x, y, z }, world)) continue;
    const distance = Math.sqrt(distance2);
    const pan = (xOffset * rightX + zOffset * rightZ) * .86 / Math.max(.65, Math.hypot(xOffset, zOffset));
    const sweep = ((dx * rightX + dz * rightZ) / Math.sqrt(length2)) * (.20 + .19 * (1 - distance / BULLET_PASS_RADIUS));
    closestSquared = distance2;
    best = { distance, pan: panLimit(pan - sweep), endPan: panLimit(pan + sweep) };
  }
  return best;
}

export function incomingImpactPan(listener, source, yaw) {
  const angle = damageBearing(listener, source, yaw);
  return angle === null ? 0 : Math.sin(angle) * .25;
}
