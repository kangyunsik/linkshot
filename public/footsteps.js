const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class FootstepTracker {
  constructor() { this.reset(); }
  reset() { this.position = null; this.spawnCount = null; this.updatedAt = null; this.distance = 0; this.travel = null; this.travelAt = null; this.lastMovedAt = -Infinity; this.moving = false; this.lastStepAt = -Infinity; this.foot = 0; }

  update(player, now, { active = true, teleport = false } = {}) {
    if (!player || ![player.x, player.y, player.z, now].every(Number.isFinite)) { this.reset(); return null; }
    const previous = this.position, elapsed = now - this.updatedAt, lifeChanged = player.spawnCount !== this.spawnCount, travel = this.travel;
    this.position = { x: player.x, y: player.y, z: player.z }; this.updatedAt = now; this.spawnCount = player.spawnCount;
    this.travel = Number.isFinite(player.stepDistance) ? player.stepDistance : null;
    const travelElapsed = now - (this.travelAt ?? now);
    if (this.travel !== travel || !previous) this.travelAt = now;
    const authoritative = this.travel !== null && travel !== null;
    const moving = active && player.hp > 0 && player.grounded === true && (authoritative || player.moveSpeed > 0.1);
    if (!previous || lifeChanged || teleport || elapsed <= 0 || elapsed > 250) { this.distance = 0; this.moving = moving; return null; }
    this.moving = moving;
    if (!moving) { this.distance = 0; return null; }
    const moved = authoritative ? this.travel - travel : Math.hypot(player.x - previous.x, player.z - previous.z), expected = authoritative ? 12 * travelElapsed / 1000 : player.moveSpeed * elapsed / 1000;
    // Ignore respawn/reconciliation jumps and vertical motion. Never queue air
    // travel and then dump several phantom steps on landing.
    if (Math.abs(player.y - previous.y) > 0.6 || moved < 0 || moved > expected * 2 + 0.15) { this.distance = 0; return null; }
    if (moved < .0001) { if (now - this.lastMovedAt > 350) this.distance = 0; return null; }
    this.lastMovedAt = now;
    this.distance += Math.min(moved, expected * 1.1 + 0.02);
    const crouched = player.crouching === true, sprint = player.sprinting === true && !crouched;
    const stride = crouched ? 1.2 : sprint ? 1.9 : 1.65;
    if (this.distance < stride || now - this.lastStepAt < (sprint ? 125 : 160)) return null;
    this.distance %= stride; this.lastStepAt = now; const foot = this.foot; this.foot = 1 - foot;
    return { sprint, crouched, foot };
  }
}

export function footstepMix(listener, source, yaw = 0, occluded = false) {
  if (![listener?.x, listener?.y, listener?.z, source?.x, source?.y, source?.z, yaw].every(Number.isFinite)) return { volume: 0, pan: 0, distance: Infinity, occluded };
  const dx = source.x - listener.x, dz = source.z - listener.z, horizontal = Math.hypot(dx, dz), distance = Math.hypot(dx, source.y - listener.y, dz);
  const range = source.crouching ? 14 : source.sprinting ? 34 : 26;
  const volume = distance >= range ? 0 : (1 - distance / range) ** 1.35 / (1 + distance / 16) * (occluded ? 0.6 : 1);
  return { volume, pan: clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(0.1, horizontal), -1, 1), distance, occluded };
}
