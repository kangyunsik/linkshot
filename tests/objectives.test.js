import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../shared/simulation.js';
import { LobbyRoom, roomLobbyAction } from '../server/room-lobby.js';
import { OBJECTIVE_RULES } from '../shared/objectives.js';

function fixture(gameType, options = {}) {
  let now = 1000; const room = new Room('OBJECT', { gameType, mapId: gameType === 'hardpoint' ? 'relay' : 'bastion', bots: 0, clock: () => now, random: () => .5, ...options });
  return { room, now: () => now, advance(ms) { for (let i = 0; i < ms / 50; i++) { now += 50; room.tick(.05); } } };
}
test('hardpoint scores occupation, pauses for contests, ignores kills for victory and rotates at 45 seconds', () => {
  const f = fixture('hardpoint'), { room } = f, a = room.addPlayer('a', 'A'), b = room.addPlayer('b', 'B');
  const point = room.world.hardpoints[0]; Object.assign(a, { x: point.x, y: point.y, z: point.z, hp: 10000, protectedUntil: 0 }); Object.assign(b, { x: 25, y: 0, z: 10, protectedUntil: 0 });
  f.advance(2000); assert.equal(room.teamScores.blue, 2); assert.equal(room.teamScores.red, 0);
  Object.assign(b, { x: point.x, y: point.y, z: point.z }); f.advance(1000); assert.equal(room.teamScores.blue, 2); assert.equal(room.snapshot().room.objective.contested, true);
  Object.assign(b, { x: 25, y: 0, z: 10, hp: 100 }); room.fragLimit = 1; room.applyDamage(a, b, 100, false, {}, { id: 'rifle' }, f.now()); assert.equal(room.phase, 'active'); assert.equal(room.teamScores.blue, 2);
  f.advance(OBJECTIVE_RULES.rotationMs); assert.equal(room.snapshot().room.objective.point.id, 'B');
});
test('hardpoint victory follows the score target and restart clears scores/objective clocks without paying LP', () => {
  const f = fixture('hardpoint', { scoreLimit: 30 }), { room } = f, a = room.addPlayer('a', 'A'), point = room.world.hardpoints[0]; Object.assign(a, { x: point.x, y: point.y, z: point.z, protectedUntil: 0 });
  f.advance(31_000); assert.equal(room.phase, 'ended'); assert.equal(room.result.winnerTeam, 'blue'); assert.equal(room.result.rewards.a.points, 0);
  const old = room.roundId; room.restart(a.id); assert.notEqual(room.roundId, old); assert.equal(room.teamScores.blue, 0); assert.equal(room.snapshot().room.objective.point.id, 'A');
});

test('hardpoint gauge progress is authoritative, freezes on contests and does not change instant occupation scoring', () => {
  const f = fixture('hardpoint'), { room } = f, blue = room.addPlayer('blue', 'BLUE'), red = room.addPlayer('red', 'RED'), point = room.world.hardpoints[0];
  Object.assign(blue, { x: point.x, y: point.y, z: point.z, protectedUntil: 0 }); Object.assign(red, { x: 30, y: 0, z: 10, protectedUntil: 0 });
  f.advance(500); let objective = room.snapshot().room.objective;
  assert.equal(objective.owner, 'blue'); assert.ok(Math.abs(objective.scoreProgress - .5) < 1e-8); assert.equal(objective.rotationSeconds, 45); assert.equal(room.teamScores.blue, 0);
  Object.assign(red, { x: point.x, y: point.y, z: point.z }); f.advance(1000); objective = room.snapshot().room.objective;
  assert.equal(objective.contested, true); assert.equal(objective.scoreProgress, 0); assert.equal(room.teamScores.blue, 0); assert.ok(Math.abs(room.objectives.remainder.blue - .5) < 1e-8);
  Object.assign(red, { x: 30, y: 0, z: 10 }); f.advance(500); assert.equal(room.teamScores.blue, 1);
  room.restart(blue.id); assert.equal(room.snapshot().room.objective.scoreProgress, 0);
});

test('defense randomly selects safe entries across the whole perimeter instead of cycling fixed lanes', () => {
  const sequence = (value) => {
    const room = new Room('RANDOM', { gameType: 'defense', mapId: 'bastion', bots: 0, random: () => value }), ids = [];
    for (let i = 0; i < 12; i++) {
      const enemy = room.addPlayer(`enemy-${i}`, 'ENEMY', true, { defenseEnemy: true }); ids.push(enemy.spawnId); room.players.delete(enemy.id);
    }
    assert.equal(new Set(ids).size, 12); return ids;
  };
  const first = sequence(.01), second = sequence(.99); assert.notDeepEqual(first, second); assert.notEqual(first[0], second[0]);
  const room = new Room('SAFE', { gameType: 'defense', mapId: 'bastion', bots: 0, random: () => 0 }), defender = room.addPlayer('defender', 'DEFENDER'), entry = room.world.spawns.find((p) => p.teamId === 'red');
  Object.assign(defender, { x: entry.x, y: entry.y, z: entry.z, protectedUntil: 0 });
  const enemy = room.addPlayer('enemy', 'ENEMY', true, { defenseEnemy: true }); assert.notEqual(enemy.spawnId, entry.spawnId); assert.ok(Math.hypot(enemy.x - defender.x, enemy.z - defender.z) >= 8);
});
test('defense keeps people/allied bots on blue, reserves enemy slots and automatically queues bounded waves', () => {
  const f = fixture('defense'), { room } = f; for (let i = 0; i < 4; i++) assert.equal(room.addPlayer(`h${i}`, `H${i}`).teamId, 'blue');
  assert.throws(() => room.addPlayer('fifth', 'FIFTH'), /최대 4명/); f.advance(12_000);
  assert.equal([...room.players.values()].filter((p) => p.isWaveEnemy).length, 4); assert.equal(room.players.size, 8);
  assert.ok([...room.players.values()].filter((p) => p.isWaveEnemy).every((p) => p.teamId === 'red' && p.hp === 100));
});
test('defense clears waves, fails on core loss/time expiry and cannot be won from kill counts', () => {
  const f = fixture('defense', { waves: 1 }), { room } = f, host = room.addPlayer('host', 'HOST'); f.advance(12_000);
  host.kills = 999; assert.equal(room.phase, 'active');
  for (const enemy of [...room.players.values()].filter((p) => p.isWaveEnemy)) room.applyDamage(host, enemy, 10000, false, {}, { id: 'rifle' }, f.now());
  f.advance(1000); assert.equal(room.phase, 'ended'); assert.equal(room.result.winnerTeam, 'blue'); assert.equal(room.result.cleared, 1); assert.equal(room.result.rewards.host.points, 0);
  const loss = fixture('defense'); loss.room.addPlayer('host', 'HOST'); loss.advance(11_000); const enemy = [...loss.room.players.values()].find((p) => p.isWaveEnemy);
  loss.room.objectives.damageCore({ isWaveEnemy: false }, 99999); assert.equal(loss.room.objectives.state.coreHealth, 1000);
  loss.room.objectives.damageCore({ ...enemy }, 99999); assert.equal(loss.room.objectives.state.coreHealth, 1000);
  loss.room.objectives.damageCore(enemy, 99999); assert.equal(loss.room.result.winnerTeam, 'red'); assert.equal(loss.room.result.reason, 'core-destroyed');
});
test('staged cooperative rooms start without an opposing human and reject team/enemy-AI spoofing', () => {
  const room = new LobbyRoom('COOP', { mapId: 'bastion', gameType: 'defense', bots: 1 }), host = room.addPlayer('host', 'HOST');
  assert.equal(host.teamConfirmed, true); assert.throws(() => room.team(host.id, host.id, 'red'), /같은 수비팀/); assert.throws(() => room.bot(host.id, { teamId: 'red' }), /공세 AI/);
  room.start(host.id); assert.equal(room.phase, 'active');
});

test('objective AI occupies and follows the elevated moving point instead of only chasing players', () => {
  let now = 1000; const room = new Room('CAPAI', { gameType: 'hardpoint', mapId: 'relay', bots: 0, scoreLimit: 200, clock: () => now, random: () => .5 });
  const bot = room.addPlayer('capturer', 'CAPTURE AI', true), human = room.addPlayer('host', 'HOST'); human.hp = 0; human.respawnAt = Infinity;
  Object.assign(bot, { x: -31, y: 0, z: 6, yaw: 0, pitch: 0, spawnExitPath: [], protectedUntil: 0 });
  for (let i = 0; i < 80 * 60; i++) { now += 1000 / 60; room.tick(1 / 60); }
  assert.equal(room.snapshot().room.objective.point.id, 'B'); assert.ok(Math.abs(bot.y - 2.4) < .02, JSON.stringify({ x: bot.x, y: bot.y, z: bot.z }));
  assert.ok(Math.hypot(bot.x, bot.z + 20) < 4.8); assert.ok(room.teamScores.blue > 10);
});

test('real wave AI uses ordinary obstructed hitscan to attack the core, not a proximity-only damage timer', () => {
  let now = 1000; const room = new Room('CORE', { gameType: 'defense', mapId: 'bastion', bots: 0, clock: () => now, random: () => .5 });
  const host = room.addPlayer('host', 'HOST'); Object.assign(host, { x: 30, y: 0, z: 28, hp: 1000000 });
  let hits = 0; const damage = room.objectives.damageCore.bind(room.objectives); room.objectives.damageCore = (attacker, amount) => { if (amount > 0) hits++; return damage(attacker, amount); };
  for (let i = 0; i < 80 * 60 && room.phase === 'active'; i++) { now += 1000 / 60; room.tick(1 / 60); }
  assert.ok(hits > 0); assert.ok(room.objectives.state.coreHealth < 1000); assert.equal(room.result?.reason, 'core-destroyed');
});

test('wave AI from every randomized BASTION entry must navigate around the vault before a real core hit', () => {
  const sample = fixture('defense').room.world;
  for (const entry of sample.spawns.filter((p) => p.teamId === 'red')) {
    let now = 1000, hitAt = null; const room = new Room('BREACH', { gameType: 'defense', mapId: 'bastion', bots: 0, clock: () => now, random: () => .5 });
    const host = room.addPlayer('host', 'HOST'); host.hp = 0; host.respawnAt = Infinity;
    const enemy = room.addPlayer('enemy', 'ENEMY', true, { defenseEnemy: true, weaponId: 'rifle' });
    Object.assign(enemy, { x: entry.x, y: entry.y, z: entry.z, yaw: entry.yaw, protectedUntil: 0, spawnExitPath: entry.exitPath.map((p) => ({ ...p })) });
    room.objectives.state.phase = 'wave'; room.objectives.state.pending = 0;
    const damage = room.objectives.damageCore.bind(room.objectives); room.objectives.damageCore = (attacker, amount) => { hitAt ??= now; return damage(attacker, amount); };
    for (let i = 0; i < 60 * 45 && hitAt === null; i++) { now += 1000 / 60; room.tick(1 / 60); }
    assert.ok(hitAt !== null, `${entry.spawnId}: ${JSON.stringify({ x: enemy.x, y: enemy.y, z: enemy.z, next: enemy.botPath[0] })}`);
    assert.ok(hitAt - 1000 >= 8000, `${entry.spawnId} could shoot the core without a meaningful approach`); assert.ok(enemy.z > 31);
  }
});
