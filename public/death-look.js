import { angleDelta, clamp } from '../shared/movement.js';
import { playerPose } from '../shared/world.js';

export function deathLookSource(victim, events = [], players = []) {
  const attackerId = victim.lastDeath?.attackerId;
  if (!attackerId || attackerId === victim.id) return null;
  const impact = events.findLast(event => event.type === 'damage' && event.id === victim.id && event.attacker === attackerId && event.damage > 0);
  if (impact?.origin) return impact.origin;
  const attacker = players.find(player => player.id === attackerId);
  return attacker ? { x: attacker.x, y: attacker.y + playerPose(attacker).eyeHeight, z: attacker.z } : null;
}

// Freeze the direction at death. This is only a camera turn, not a spectator
// view or an update to the aim sent to the server.
export function planDeathLook(position, yaw, pitch, source, startedAt) {
  if (![position?.x, position?.y, position?.z, source?.x, source?.y, source?.z, yaw, pitch].every(Number.isFinite)) return null;
  const dx = source.x - position.x, dz = source.z - position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < .05) return null;
  const turn = angleDelta(Math.atan2(-dx, -dz), yaw);
  return { yaw, pitch, turn, targetPitch: clamp(Math.atan2(source.y - position.y - .45, distance), -.62, .62),
    startedAt, duration: 900 + Math.abs(turn) / Math.PI * 450 };
}

export function sampleDeathLook(plan, now) {
  const t = clamp((now - plan.startedAt) / plan.duration, 0, 1), mix = t * t * (3 - 2 * t);
  return { yaw: plan.yaw + plan.turn * mix, pitch: plan.pitch + (plan.targetPitch - plan.pitch) * mix };
}
