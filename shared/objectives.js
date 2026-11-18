import { wallDistance } from './world.js';

export const OBJECTIVE_RULES = Object.freeze({ rotationMs: 45_000, scoreLimit: 150, waves: 5, coreHealth: 1000, prepareMs: 10_000, intermissionMs: 7000, defenders: 4 });
const bounded = (n, min, max, fallback) => Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
export const objectiveOptions = (options = {}) => ({ scoreLimit: bounded(options.scoreLimit, 30, 200, 150), waves: Number.isSafeInteger(options.waves) && options.waves > 0 ? options.waves : OBJECTIVE_RULES.waves });
export const waveEnemyCount = (wave) => 4 * wave;

export class ObjectiveRound {
  constructor(room) { this.room = room; this.reset(room.clock()); }
  reset(now) {
    const room = this.room; this.serial = 0; this.remainder = { blue: 0, red: 0 };
    for (const [id, player] of room.players) if (player.isWaveEnemy) room.players.delete(id);
    this.state = room.gameType === 'hardpoint' ? { kind: 'hardpoint', active: 0, nextAt: now + OBJECTIVE_RULES.rotationMs, owner: null, contested: false } : { kind: 'defense', phase: 'prepare', wave: 1, cleared: 0, startsAt: now + OBJECTIVE_RULES.prepareMs, pending: 0, coreHealth: OBJECTIVE_RULES.coreHealth, reason: null };
  }
  enemies() { return [...this.room.players.values()].filter((player) => player.isWaveEnemy); }
  tick(dt, now) {
    const room = this.room, state = this.state; if (room.phase !== 'active') return;
    if (state.kind === 'hardpoint') {
      while (now >= state.nextAt) { state.active = (state.active + 1) % room.world.hardpoints.length; state.nextAt += OBJECTIVE_RULES.rotationMs; room.events.push({ type: 'objective-moved', id: room.world.hardpoints[state.active].id }); }
      const point = room.world.hardpoints[state.active], occupants = new Set([...room.players.values()].filter((p) => p.hp > 0 && p.roomStatus !== 'waiting' && p.protectedUntil <= now && Math.abs(p.y - point.y) < 1.1 && Math.hypot(p.x - point.x, p.z - point.z) <= point.radius).map((p) => p.teamId));
      state.contested = occupants.has('blue') && occupants.has('red'); state.owner = occupants.size === 1 ? [...occupants][0] : null;
      if (state.owner) {
        this.remainder[state.owner] += Math.max(0, Math.min(.25, dt)); const points = Math.floor(this.remainder[state.owner] + 1e-8);
        this.remainder[state.owner] -= points; room.teamScores[state.owner] += points;
        if (room.teamScores[state.owner] >= room.scoreLimit) room.finish();
      }
      return;
    }
    for (const enemy of this.enemies()) if (enemy.hp <= 0 && now - enemy.diedAt >= 600) room.players.delete(enemy.id);
    if (state.coreHealth <= 0) { state.reason = 'core-destroyed'; room.finish(); return; }
    if (state.phase === 'prepare' && now >= state.startsAt) { state.phase = 'wave'; state.pending = waveEnemyCount(state.wave); room.events.push({ type: 'wave-start', wave: state.wave, enemies: state.pending }); }
    if (state.phase !== 'wave') return;
    // All entries deploy together. Defender capacity is independent of enemy
    // population; neither the total wave nor living attackers has a fixed cap.
    while (state.pending > 0) {
      const weaponIds = ['rifle', 'smg', 'shotgun', 'dmr', 'lmg', 'sniper'];
      const enemy = room.addPlayer(`wave-${room.roundId}-${++this.serial}`, `공세 ${state.wave}-${this.serial}`, true, { defenseEnemy: true, weaponId: weaponIds[(this.serial - 1) % weaponIds.length], skinId: 'standard', characterId: this.serial % 2 ? 'male' : 'female' });
      enemy.botDifficulty = state.wave >= 5 ? 'advanced' : state.wave >= 3 ? 'intermediate' : 'beginner';
      state.pending--;
    }
    if (!state.pending && !this.enemies().length) {
      state.cleared++; room.teamScores.blue = state.cleared;
      room.events.push({ type: 'wave-cleared', wave: state.cleared });
      if (state.cleared >= room.waves) { state.phase = 'complete'; state.reason = 'waves-cleared'; room.finish(); }
      else { state.wave++; state.phase = 'prepare'; state.startsAt = now + OBJECTIVE_RULES.intermissionMs; }
    }
  }
  damageCore(attacker, amount) {
    const state = this.state;
    if (state.kind !== 'defense' || state.phase !== 'wave' || this.room.phase !== 'active' || !attacker.isWaveEnemy || attacker.teamId !== 'red' || attacker.hp <= 0 || this.room.players.get(attacker.id) !== attacker) return;
    state.coreHealth = Math.max(0, state.coreHealth - Math.max(0, Math.round(amount)));
    if (!state.coreHealth) { state.reason = 'core-destroyed'; this.room.finish(); }
  }
  goal(bot) {
    const state = this.state;
    if (state.kind === 'hardpoint') {
      const point = this.room.world.hardpoints[state.active], slot = [...bot.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
      return { ...point, x: point.x + (slot % 2 ? 1.6 : -1.6), z: point.z + (slot < 2 ? 1.6 : -1.6) };
    }
    const core = this.room.world.defenseCore;
    const slot = [...bot.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
    if (bot.isWaveEnemy) {
      const approach = this.room.world.defenseApproaches?.reduce((best, point) => !best || Math.hypot(point.x - bot.x, point.z - bot.z) < Math.hypot(best.x - bot.x, best.z - bot.z) ? point : best, null);
      return { ...core, id: 'defense-core', hp: state.coreHealth, teamId: 'blue', protectedUntil: 0, yaw: 0, pitch: 0, isObjective: true, ...(approach ? { approach } : {}) };
    }
    return this.room.world.defensePosts?.[slot] || { x: core.x + (slot % 2 ? 8 : -8), y: core.y, z: core.z - (slot < 2 ? 4 : 2) };
  }
  coreVisible(origin, target) {
    const dx = target.x - origin.x, dy = target.y + 1.5 - origin.y, dz = target.z - origin.z, distance = Math.hypot(dx, dy, dz), details = {};
    wallDistance(origin, { x: dx / distance, y: dy / distance, z: dz / distance }, distance, this.room.world, details);
    return !details.box || details.box.id === this.room.world.defenseCore.id;
  }
  snapshot(now) {
    const state = this.state;
    if (state.kind === 'hardpoint') return { kind: state.kind, point: { ...this.room.world.hardpoints[state.active] }, nextPoint: this.room.world.hardpoints[(state.active + 1) % this.room.world.hardpoints.length].id, changesIn: Math.max(0, Math.ceil((state.nextAt - now) / 1000)), rotationSeconds: OBJECTIVE_RULES.rotationMs / 1000, owner: state.owner, contested: state.contested, scoreProgress: state.owner ? Math.max(0, Math.min(1, this.remainder[state.owner])) : 0, scoreLimit: this.room.scoreLimit };
    return { kind: state.kind, phase: state.phase, wave: state.wave, totalWaves: this.room.waves, cleared: state.cleared, startsIn: Math.max(0, Math.ceil((state.startsAt - now) / 1000)), pending: state.pending, aliveEnemies: this.enemies().filter((p) => p.hp > 0).length, core: { ...this.room.world.defenseCore, hp: state.coreHealth, maxHp: OBJECTIVE_RULES.coreHealth }, reason: state.reason };
  }
}
