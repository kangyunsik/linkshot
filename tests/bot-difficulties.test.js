import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, BOT_DIFFICULTIES, getBotDifficulty, botDifficultyForRating } from '../shared/simulation.js';
import { WORLD, RULES } from '../shared/world.js';
import { getWeapon } from '../shared/catalog.js';
import { angleDelta } from '../shared/movement.js';

const seeded = (seed = 17) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function arena(difficulty, obstacles = []) {
  const room = new Room('LEVELS', { bots: 0, botDifficulty: difficulty, clock: () => 1000, random: seeded() });
  room.world = Object.freeze({ ...WORLD, width: 100, depth: 100, buildings: [], walkways: [], obstacles });
  const bot = room.addPlayer('bot', 'BOT', true, { weaponId: 'rifle' }), target = room.addPlayer('target', 'TARGET');
  for (const p of [bot, target]) Object.assign(p, { x: 0, y: 0, z: p === bot ? 10 : -10, yaw: 0, pitch: 0, grounded: true, protectedUntil: 0, spawnExitPath: [] });
  return { room, bot, target };
}

test('five selectable difficulty levels share one rating policy with exact safe boundaries', () => {
  assert.deepEqual(BOT_DIFFICULTIES.map((level) => [level.id, level.label]), [['beginner', '초급'], ['intermediate', '중급'], ['advanced', '고급'], ['expert', '최고급'], ['extreme', '극한']]);
  for (let i = 0; i < BOT_DIFFICULTIES.length; i++) {
    const level = BOT_DIFFICULTIES[i];
    assert.equal(botDifficultyForRating(level.minRating), level.id);
    if (i) {
      const previous = BOT_DIFFICULTIES[i - 1];
      assert.equal(botDifficultyForRating(level.minRating - 1), previous.id);
      for (const key of ['sightRange', 'viewHalfAngle']) assert.ok(level.behavior[key] > previous.behavior[key], key);
      for (const key of ['aimYawError', 'aimPitchError', 'shotSpread', 'aimSampleMs']) assert.ok(level.behavior[key] < previous.behavior[key], key);
    }
    assert.ok(Object.isFrozen(level.behavior));
  }
  assert.equal(botDifficultyForRating(10_000), 'extreme');
  for (const invalid of [null, undefined, NaN, Infinity, -Infinity, -1, '2300']) assert.equal(botDifficultyForRating(invalid), 'beginner');
  assert.equal(getBotDifficulty('__proto__').id, 'beginner');
});

for (const difficulty of ['expert', 'extreme']) {
  test(`${difficulty} has a real reaction window, bounded turns, sampled aim and weapon-limited shots`, () => {
    const { room, bot, target } = arena(difficulty), behavior = getBotDifficulty(difficulty).behavior;
    assert.equal(bot.hp, 100); assert.equal(target.hp, 100); target.hp = 1_000_000;
    const first = room.botInput(bot, 1000, 1 / 60), reactAt = bot.botBrain.reactAt;
    assert.equal(first.fire, false); assert.ok(reactAt >= 1000 + behavior.reactionMinMs && reactAt <= 1000 + behavior.reactionMaxMs);
    const sample = { ...bot.botBrain.aimPoint }; target.x += .1;
    room.botInput(bot, 1010, 1 / 60); assert.deepEqual(bot.botBrain.aimPoint, sample);
    const times = [];
    for (let i = 1; i <= 180; i++) {
      const now = 1000 + i * 1000 / RULES.tickRate, input = room.botInput(bot, now, 1 / RULES.tickRate);
      assert.ok(Math.abs(angleDelta(input.yaw, bot.yaw)) <= behavior.turnRadiansPerSecond / RULES.tickRate + 1e-9);
      assert.ok(Math.abs(input.pitch - bot.pitch) <= behavior.pitchRadiansPerSecond / RULES.tickRate + 1e-9);
      bot.yaw = input.yaw; bot.pitch = input.pitch;
      if (now < reactAt) assert.equal(input.fire, false);
      if (input.fire && bot.ammo > 0) { room.shoot(bot, now, input.ads); times.push(now); }
    }
    assert.ok(times.length >= 8); assert.ok(times[0] >= reactAt && times[0] < reactAt + 150);
    const interval = Math.max(behavior.shotIntervalMs, getWeapon('rifle').fireSeconds * 1000);
    assert.ok(times.slice(1).every((time, i) => time - times[i] >= interval - .001));
    assert.equal(getWeapon('rifle').damage, 28);
  });

  test(`${difficulty} cannot see or pre-fire through solid cover`, () => {
    const { room, bot } = arena(difficulty, [{ id: 'wall', x: 0, y: 0, z: 0, w: 30, h: 5, d: 2 }]);
    for (let i = 0; i < 180; i++) {
      const input = room.botInput(bot, 1000 + i * 1000 / 60, 1 / 60);
      bot.yaw = input.yaw; bot.pitch = input.pitch;
      assert.equal(input.fire, false); assert.equal(bot.botBrain.aimPoint, null);
    }
  });
}

test('higher difficulties improve actual body-hit accuracy without raising firearm damage', () => {
  const rates = [];
  for (const { id: difficulty } of BOT_DIFFICULTIES) {
    const { room, bot, target } = arena(difficulty); target.hp = 1_000_000;
    target.z = -30; bot.pitch = Math.atan2(1.05 - RULES.eyeHeight, 40);
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      bot.ammo = 30; bot.shotHeat = 0; room.shoot(bot, 1000 + i * 1000);
      const shot = room.events.findLast((event) => event.type === 'shot');
      if (shot.hit === target.id) hits++;
      room.events.length = 0;
    }
    rates.push(hits / 600);
  }
  assert.ok(rates.slice(1).every((rate, i) => rate > rates[i]), rates.join(', '));
  assert.equal(getWeapon('rifle').damage, 28);
});
