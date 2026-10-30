import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_BEHAVIOR, Room } from '../shared/simulation.js';
import { angleDelta } from '../shared/movement.js';
import { getWeapon } from '../shared/catalog.js';

function seededRandom(seed = 7) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function place(player, x, z, yaw = 0) {
  Object.assign(player, { x, y: 0, z, yaw, pitch: 0, vy: 0, grounded: true, protectedUntil: 0 });
  return player;
}

test('bots select nearby bots and humans with the same free-for-all targeting rules', () => {
  const room = new Room('FFA22', { bots: 0, clock: () => 1000, random: seededRandom() });
  const bot = place(room.addPlayer('bot-a', 'ALPHA', true), 24, 9);
  const other = place(room.addPlayer('bot-b', 'BRAVO', true), 24, 3, Math.PI);
  const human = place(room.addPlayer('human', 'HUMAN'), -23, -18);
  room.botInput(bot, 1000, 1 / 60);
  assert.equal(bot.botBrain.targetId, other.id);
  place(human, 24, 6);
  room.botInput(bot, 1017, 1 / 60);
  assert.equal(bot.botBrain.targetId, human.id);
});

test('bots ignore themselves, dead players and spawn-protected opponents', () => {
  const room = new Room('SAFE2', { bots: 0, clock: () => 1000, random: seededRandom() });
  const bot = place(room.addPlayer('bot-a', 'ALPHA', true), 24, 9);
  const other = place(room.addPlayer('bot-b', 'BRAVO', true), 24, 3);
  other.protectedUntil = 2000;
  assert.equal(room.botInput(bot, 1000, 1 / 60).fire, false);
  assert.equal(bot.botBrain.targetId, null);
  other.protectedUntil = 0; other.hp = 0;
  room.botInput(bot, 1100, 1 / 60); assert.equal(bot.botBrain.targetId, null);
  other.hp = 100;
  room.botInput(bot, 1200, 1 / 60); assert.equal(bot.botBrain.targetId, other.id);
});

test('two bots can damage and eliminate each other without any human target', () => {
  let now = 1000;
  const room = new Room('BOTS2', { bots: 0, clock: () => now, random: seededRandom(42) });
  place(room.addPlayer('bot-a', 'ALPHA', true), 24, 9);
  place(room.addPlayer('bot-b', 'BRAVO', true), 24, 1, Math.PI);
  for (let i = 0; i < 20 * 60; i++) { now += 1000 / 60; room.tick(1 / 60); }
  assert.ok(room.events.some((event) => event.type === 'damage' && event.id !== event.attacker));
  assert.ok(room.events.some((event) => event.type === 'kill' && event.killerId.startsWith('bot-') && event.victimId.startsWith('bot-')));
});

test('bot yaw and pitch are rate-limited instead of snapping toward the target', () => {
  const room = new Room('TURN2', { bots: 0, clock: () => 1000, random: seededRandom() });
  const bot = place(room.addPlayer('bot-a', 'ALPHA', true), 24, 9, Math.PI); bot.pitch = 0.8;
  place(room.addPlayer('human', 'HUMAN'), 24, 1);
  const dt = 1 / 60, input = room.botInput(bot, 1000, dt);
  assert.ok(Math.abs(angleDelta(input.yaw, bot.yaw)) <= BOT_BEHAVIOR.turnRadiansPerSecond * dt + 1e-9);
  assert.ok(Math.abs(input.pitch - bot.pitch) <= BOT_BEHAVIOR.pitchRadiansPerSecond * dt + 1e-9);
  assert.ok(Math.abs(angleDelta(input.yaw, 0)) > 3);
  assert.equal(input.fire, false);
});

test('a newly seen enemy gets a real reaction window before a bot can fire', () => {
  const room = new Room('REACT', { bots: 0, clock: () => 1000, random: seededRandom() });
  const bot = place(room.addPlayer('bot-a', 'ALPHA', true), 24, 9);
  place(room.addPlayer('human', 'HUMAN'), 24, 1);
  assert.equal(room.botInput(bot, 1000, 1 / 60).fire, false);
  const reactAt = bot.botBrain.reactAt;
  assert.ok(reactAt >= 1000 + BOT_BEHAVIOR.reactionMinMs && reactAt <= 1000 + BOT_BEHAVIOR.reactionMaxMs);
  let firstFire = null;
  for (let i = 1; i <= 90; i++) {
    const now = 1000 + i * 1000 / 60, input = room.botInput(bot, now, 1 / 60);
    bot.yaw = input.yaw; bot.pitch = input.pitch;
    if (now < reactAt) assert.equal(input.fire, false);
    if (input.fire && firstFire === null) firstFire = now;
  }
  assert.ok(firstFire !== null && firstFire >= reactAt);
});

test('bots use delayed position samples and cannot pre-fire through solid cover', () => {
  const room = new Room('TRACK', { bots: 0, clock: () => 1000, random: seededRandom() });
  const bot = place(room.addPlayer('bot-a', 'ALPHA', true), 0, 12);
  const human = place(room.addPlayer('human', 'HUMAN'), 0, -12);
  for (const now of [1000, 2000, 5000]) {
    assert.equal(room.botInput(bot, now, 1 / 60).fire, false);
    assert.equal(bot.botBrain.visibleSince, null);
  }
  place(bot, 24, 9); place(human, 24, 1);
  assert.equal(room.botInput(bot, 6000, 1 / 60).fire, false);
  assert.ok(bot.botBrain.reactAt >= 6000 + BOT_BEHAVIOR.reactionMinMs);
  const observedX = bot.botBrain.aimPoint.x;
  human.x += 2;
  room.botInput(bot, 6080, 1 / 60); assert.equal(bot.botBrain.aimPoint.x, observedX);
  room.botInput(bot, 6000 + BOT_BEHAVIOR.aimSampleMs + 1, 1 / 60); assert.equal(bot.botBrain.aimPoint.x, human.x);
});

test('bots fire short bursts with longer bullet intervals and recovery pauses', () => {
  const room = new Room('BURST', { bots: 0, clock: () => 1000, random: seededRandom(33) });
  const bot = place(room.addPlayer('bot-a', 'ALPHA', true), 24, 9);
  const human = place(room.addPlayer('human', 'HUMAN'), 24, 1); human.hp = 1_000_000;
  const shotTimes = [];
  for (let i = 0; i < 8 * 60; i++) {
    const now = 1000 + i * 1000 / 60, input = room.botInput(bot, now, 1 / 60);
    bot.yaw = input.yaw; bot.pitch = input.pitch;
    if (input.fire) { room.shoot(bot, now); shotTimes.push(now); }
  }
  assert.ok(shotTimes.length >= 4 && shotTimes.length <= 14);
  const gaps = shotTimes.slice(1).map((time, index) => time - shotTimes[index]);
  assert.ok(gaps.every((gap) => gap >= BOT_BEHAVIOR.shotIntervalMs - 0.001));
  assert.ok(gaps.some((gap) => gap >= BOT_BEHAVIOR.burstPauseMinMs));
});

test('extra bot spread lowers mid-range accuracy without nerfing player weapons', () => {
  function hitRate(isBot, distance) {
    const room = new Room('ACCRY', { bots: 0, clock: () => 1000, random: seededRandom(123) });
    const shooter = place(room.addPlayer('shooter', 'SHOOTER', isBot), 24, 10);
    const target = place(room.addPlayer('target', 'TARGET'), 24, 10 - distance); target.hp = 1_000_000;
    shooter.pitch = Math.atan2(1.05 - 1.62, distance);
    let hits = 0;
    for (let i = 0; i < 500; i++) {
      shooter.ammo = 30; room.shoot(shooter, 1000 + i * 1000);
      if (room.events.findLast((event) => event.type === 'shot').hit === target.id) hits++;
    }
    return hits / 500;
  }
  const playerAccuracy = hitRate(false, 20), botAccuracy = hitRate(true, 20), closeAccuracy = hitRate(true, 2);
  assert.equal(playerAccuracy, 1);
  assert.ok(botAccuracy > 0.1 && botAccuracy < 0.6);
  assert.ok(botAccuracy < playerAccuracy * 0.65);
  assert.ok(closeAccuracy > 0.8 && closeAccuracy > botAccuracy);
  assert.equal(getWeapon('rifle').spread, 0.004);
});

test('respawn resets bot reaction/burst state and snapshots do not expose AI internals', () => {
  const room = new Room('RESET', { bots: 0, random: seededRandom() });
  const bot = room.addPlayer('bot-a', 'ALPHA', true);
  Object.assign(bot.botBrain, { targetId: 'old-target', reactAt: 99999, burstLeft: 3, aimPoint: { x: 1, y: 1, z: 1 } });
  room.spawn(bot);
  assert.equal(bot.botBrain.targetId, null); assert.equal(bot.botBrain.visibleSince, null);
  assert.equal(bot.botBrain.reactAt, 0); assert.equal(bot.botBrain.burstLeft, 0); assert.equal(bot.botBrain.aimPoint, null);
  assert.equal(room.snapshot().players[0].botBrain, undefined);
});
