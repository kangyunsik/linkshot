const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class FootstepTracker {
  constructor() { this.reset(); }
  reset() { this.position = null; this.spawnCount = null; this.updatedAt = null; this.distance = 0; this.moving = false; this.lastStepAt = -Infinity; this.foot = 0; }

  update(player, now, { active = true, teleport = false } = {}) {
    if (!player || ![player.x, player.y, player.z, now].every(Number.isFinite)) { this.reset(); return null; }
    const previous = this.position, elapsed = now - this.updatedAt, lifeChanged = player.spawnCount !== this.spawnCount;
    this.position = { x: player.x, y: player.y, z: player.z }; this.updatedAt = now; this.spawnCount = player.spawnCount;
    const moving = active && player.hp > 0 && player.grounded === true && player.moveSpeed > 0.1;
    if (!previous || lifeChanged || teleport || elapsed <= 0 || elapsed > 250) { this.distance = 0; this.moving = moving; return null; }
    const wasMoving = this.moving; this.moving = moving;
    if (!moving || !wasMoving) { this.distance = 0; return null; }
    const moved = Math.hypot(player.x - previous.x, player.z - previous.z), expected = player.moveSpeed * elapsed / 1000;
    // Ignore respawn/reconciliation jumps and vertical motion. Never queue air
    // travel and then dump several phantom steps on landing.
    if (Math.abs(player.y - previous.y) > 0.6 || moved > expected * 2 + 0.15) { this.distance = 0; return null; }
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
  const volume = distance >= range ? 0 : (1 - distance / range) ** 2 / (1 + (distance / 9) ** 1.5) * (occluded ? 0.38 : 1);
  return { volume, pan: clamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(0.1, horizontal), -1, 1), distance, occluded };
}
