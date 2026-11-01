import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, traceShot } from '../shared/simulation.js';
import { MAPS, RULES } from '../shared/world.js';
import { getWeapon } from '../shared/catalog.js';
import { teamSpawnZones } from '../shared/teams.js';

function fixture(options = {}) {
  let now = 1000; const room = new Room('TEAMS', { bots: 0, gameType: 'teams', fragLimit: 3, random: () => .5, clock: () => now, ...options });
  const players = ['a', 'b', 'c', 'd'].map((id) => room.addPlayer(id, id.toUpperCase()));
  return { room, players, advance: (ms) => { now += ms; room.tick(1 / 60); } };
}

test('both teams have disjoint opposite-side spawn zones on all eight maps and retain their side on every respawn', () => {
  for (const world of MAPS) {
    const { room, players } = fixture({ mapId: world.id }); const zones = teamSpawnZones(world);
    assert.ok(zones.blue.length >= 2, world.id); assert.ok(zones.red.length >= 2, world.id);
    assert.ok(Math.max(...zones.blue.map((p) => p[zones.axis])) < Math.min(...zones.red.map((p) => p[zones.axis])), world.id);
    for (let life = 0; life < 4; life++) for (const player of players) {
      room.spawn(player); assert.ok(zones[player.teamId].some((point) => point.spawnId === player.spawnId && (point.y || 0) === player.y), `${world.id}/${player.teamId}`);
      assert.equal(player.hp, 100); assert.equal(player.protectedUntil, room.clock() + RULES.protectionSeconds * 1000);
    }
  }
});

test('team assignment and replacing a full bot roster keep both human and total teams balanced', () => {
  const room = new Room('TEAMS', { bots: 7, gameType: 'teams' });
  for (let i = 0; i < 8; i++) {
    room.addPlayer(`human-${i}`, 'HUMAN'); const all = [...room.players.values()], humans = all.filter((p) => !p.isBot);
    const difference = (roster) => Math.abs(roster.filter((p) => p.teamId === 'blue').length - roster.filter((p) => p.teamId === 'red').length);
    assert.ok(difference(all) <= 1); assert.ok(difference(humans) <= 1);
  }
  assert.equal(room.players.size, 8); assert.equal(room.summary().bots, 0);
});

test('allies stop bullets and knives without damage, blood, hit markers, scars or kills, including lag-rewound bodies', () => {
  const { room, players: [a, b, c] } = fixture(); room.world = { ...room.world, width: 100, depth: 100, obstacles: [] };
  Object.assign(a, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectedUntil: 0 }); Object.assign(b, { x: 0, y: 0, z: -5, protectedUntil: 0 }); Object.assign(c, { x: 0, y: 0, z: -2, protectedUntil: 0 });
  room.players.delete('d'); for (const p of room.players.values()) { p.history = []; room.recordPlayerHistory(p, 800); room.recordPlayerHistory(p, 1000); }
  const trace = traceShot(a, room.playersAt(900), 1000, room.world); assert.equal(trace.friendlyTarget, c.id); assert.equal(trace.victim, null); assert.equal(trace.surface, null);
  room.events.length = 0; room.shoot(a, 1000, true, { viewTime: 900 }); const ray = room.snapshot().events.find((event) => event.type === 'shot').rays[0]; assert.equal(ray.friendlyTarget, c.id); assert.equal(ray.hit, null); assert.equal(c.hp, 100); assert.equal(b.hp, 100); assert.equal(room.impacts.size, 0);
  room.applyDamage(a, c, 999, false, { x: 0, y: 1, z: 0 }, getWeapon('rifle'), 1100); assert.equal(c.hp, 100); assert.deepEqual(room.teamScores, { blue: 0, red: 0 });
  Object.assign(c, { z: -1 }); Object.assign(a, { weaponId: 'knife', nextFireAt: 0 }); room.melee(a, 1200); assert.equal(c.hp, 100); assert.equal(a.kills, 0);
});

test('bots only target enemies rather than a closer teammate', () => {
  const room = new Room('TEAMS', { bots: 1, gameType: 'teams' }), bot = [...room.players.values()][0], enemy = room.addPlayer('enemy', 'ENEMY'), ally = room.addPlayer('ally', 'ALLY');
  room.world = { ...room.world, width: 100, depth: 100, obstacles: [] }; Object.assign(bot, { x: 0, y: 0, z: 0, yaw: 0, spawnExitPath: [], protectedUntil: 0 }); Object.assign(enemy, { x: 0, y: 0, z: -8, protectedUntil: 0 }); Object.assign(ally, { x: 0, y: 0, z: -1, protectedUntil: 0 }); room.botInput(bot, 2000, 1 / 60); assert.equal(bot.botBrain.targetId, enemy.id);
});

test('combined team kills win the round and award victory to every winning teammate rather than only the top scorer', () => {
  const { room, players: [a, b, c, d] } = fixture(); const kill = (killer, victim) => { victim.hp = 100; room.applyDamage(killer, victim, 100, false, { x: 0, y: 1, z: 0 }, getWeapon('rifle'), room.clock()); };
  kill(a, b); kill(c, d); assert.equal(room.phase, 'active'); kill(c, b);
  assert.equal(a.kills, 1); assert.equal(c.kills, 2); assert.equal(room.phase, 'ended'); assert.equal(room.result.winnerTeam, 'blue'); assert.deepEqual(room.result.teamScores, { blue: 3, red: 0 }); assert.equal(room.result.rewards[a.id].won, true); assert.equal(room.result.rewards[c.id].won, true); assert.equal(room.result.rewards[b.id].won, false);
  d.hp = 100; room.applyDamage(a, d, 100, false, {}, getWeapon('rifle'), room.clock()); assert.equal(d.hp, 100); assert.deepEqual(room.teamScores, { blue: 3, red: 0 });
  room.restart(a.id); assert.deepEqual(room.teamScores, { blue: 0, red: 0 }); assert.equal(room.phase, 'active'); assert.equal(room.result, null); assert.throws(() => room.restart(b.id), /방장/);
});

test('team totals survive departures, ties draw at the time limit, and WAN custom games never grant progression rewards', () => {
  const f = fixture(), [a, b, c] = f.players; f.room.applyDamage(c, b, 100, false, {}, getWeapon('rifle'), 1000); f.room.removePlayer(c.id); assert.equal(f.room.teamScores.blue, 1);
  const tie = fixture(); tie.advance(300_001); assert.equal(tie.room.result.winnerTeam, null); assert.ok(Object.values(tie.room.result.rewards).every((reward) => !reward.won));
  const custom = fixture({ mode: 'custom', fragLimit: 1 }); custom.room.applyDamage(custom.players[0], custom.players[1], 100, false, {}, getWeapon('rifle'), 1000); assert.ok(Object.values(custom.room.result.rewards).every((reward) => reward.points === 0));
});
