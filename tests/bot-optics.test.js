import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, BOT_DIFFICULTIES } from '../shared/simulation.js';
import { WORLD } from '../shared/world.js';
import { WEAPONS, getWeapon } from '../shared/catalog.js';
import { BOT_OPTICS, botSightRange, botLongRange, botSniperAimWindow, botSniperAimMs } from '../shared/bot-awareness.js';

const seeded = (seed = 17) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function arena(difficulty, weaponId = 'rifle', obstacles = []) {
  const room = new Room('OPTICS', { bots: 0, botDifficulty: difficulty, clock: () => 1000, random: seeded() });
  room.world = Object.freeze({ ...WORLD, width: 100, depth: 400, buildings: [], walkways: [], obstacles });
  const bot = room.addPlayer('bot', 'BOT', true, { weaponId }), target = room.addPlayer('target', 'TARGET');
  for (const p of [bot, target]) Object.assign(p, { x: 0, y: 0, z: p === bot ? 0 : -20, yaw: 0, pitch: 0, moveSpeed: 0, hp: 1_000_000, grounded: true, protectedUntil: 0, spawnExitPath: [] });
  const input = (now) => { const input = room.botInput(bot, now, 1 / 60); bot.yaw = input.yaw; bot.pitch = input.pitch; return input; };
  return { room, bot, target, input };
}

test('each difficulty enforces its own sight radius and field of view, including the scope bonus', () => {
  for (const { id, behavior } of BOT_DIFFICULTIES) for (const weaponId of ['rifle', 'sniper']) {
    const { room, bot, target } = arena(id, weaponId), range = botSightRange(getWeapon(weaponId), behavior);
    assert.equal(range, behavior.sightRange + (weaponId === 'sniper' ? BOT_OPTICS.sniperSightBonus : 0));
    target.z = -range + .5; room.botInput(bot, 1000, 1 / 60); assert.ok(bot.botBrain.aimPoint, `${id}/${weaponId}: inside`);
    target.z = -range - .5; room.botInput(bot, 1017, 1 / 60); assert.equal(bot.botBrain.aimPoint, null, `${id}/${weaponId}: outside`);
    for (const inside of [true, false]) {
      const angle = behavior.viewHalfAngle + (inside ? -.01 : .01);
      target.x = -Math.sin(angle) * 20; target.z = -Math.cos(angle) * 20;
      room.botInput(bot, 1050, 1 / 60);
      assert.equal(!!bot.botBrain.aimPoint, inside, `${id}/${weaponId}: view angle`);
    }
  }
});

test('sniper optics really detect an opponent beyond the same difficulty rifle sight limit', () => {
  for (const { id, behavior } of BOT_DIFFICULTIES) for (const weaponId of ['rifle', 'sniper']) {
    const { room, bot, target } = arena(id, weaponId);
    target.z = -(behavior.sightRange + 20); room.botInput(bot, 1000, 1 / 60);
    assert.equal(!!bot.botBrain.aimPoint, weaponId === 'sniper', `${id}/${weaponId}`);
  }
});

test('seeing outside effective firearm range neither fires out of range nor makes a rifle bot stop approaching', () => {
  for (const { behavior } of BOT_DIFFICULTIES) for (const weapon of WEAPONS) {
    assert.ok(botLongRange(weapon, behavior) <= weapon.range);
    assert.ok(botLongRange(weapon, behavior) <= botSightRange(weapon, behavior));
  }
  const { bot, target, input } = arena('extreme'); target.z = -120;
  const fire = [];
  for (let i = 0; i < 100; i++) {
    const next = input(1000 + i * 1000 / 60);
    assert.equal(next.fire, false); fire.push(next);
  }
  assert.ok(bot.botBrain.aimPoint); assert.ok(fire.at(-1).forward > .2);
});

test('sniper aim windows grow with distance, shrink with skill and sample a bounded nonfixed delay', () => {
  const hundredMeterWindows = [[1160, 1960], [960, 1650], [780, 1360], [600, 1090], [500, 890]];
  for (const [i, { behavior }] of BOT_DIFFICULTIES.entries()) {
    const near = botSniperAimWindow(30, behavior), far = botSniperAimWindow(100, behavior);
    assert.deepEqual(near, { minMs: behavior.sniperAimMinMs, maxMs: behavior.sniperAimMaxMs });
    assert.deepEqual([far.minMs, far.maxMs], hundredMeterWindows[i]);
    assert.ok(far.minMs > near.minMs && far.maxMs > near.maxMs && far.maxMs > far.minMs);
    assert.equal(botSniperAimMs(100, behavior, 0), far.minMs); assert.equal(botSniperAimMs(100, behavior, 1), far.maxMs);
    assert.ok(botSniperAimMs(100, behavior, .25) < botSniperAimMs(100, behavior, .75));
    assert.deepEqual(botSniperAimWindow(1000, behavior), { minMs: BOT_OPTICS.sniperAimCapMs, maxMs: BOT_OPTICS.sniperAimCapMs });
    for (const invalid of [NaN, Infinity, undefined, -1]) assert.deepEqual(botSniperAimWindow(invalid, behavior), near);
  }
});

test('actual sniper triggers wait through the complete distance-based stationary, scoped aim before every shot', () => {
  for (const distance of [20, 100, 160]) {
    const { room, bot, target, input } = arena('extreme', 'sniper'); target.z = -distance;
    const shots = [], rolls = [];
    for (let i = 0; i < 20 * 60 && shots.length < 3; i++) {
      const now = 1000 + i * 1000 / 60, next = input(now);
      if (!next.fire) continue;
      assert.equal(next.ads, true); assert.ok(bot.botBrain.sniperAimStartedAt !== null);
      assert.ok(now - bot.botBrain.sniperAimStartedAt >= botSniperAimMs(distance, room.botBehavior, bot.botBrain.sniperAimRoll) - .001);
      assert.ok(now >= bot.botBrain.reactAt); assert.ok(now >= bot.nextFireAt);
      assert.ok(room.shoot(bot, now, next.ads)); shots.push(now); rolls.push(bot.botBrain.sniperAimRoll);
    }
    assert.ok(shots.length >= 2, `${distance}m: ${shots.length} shots`);
    assert.ok(new Set(rolls).size > 1, 'successive shots must not all reuse the same random aim');
    assert.ok(shots.slice(1).every((time, i) => time - shots[i] >= getWeapon('sniper').fireSeconds * 1000 - .001));
  }
});

test('authoritative moving sniper combat also stops and re-aims for the full distant delay on successive shots', () => {
  let now = 1000;
  const { room, bot, target } = arena('extreme', 'sniper'); target.z = -100; room.clock = () => now;
  const shoot = room.shoot.bind(room); let shots = 0;
  room.shoot = (player, time, ads, shot) => {
    if (player === bot) {
      assert.ok(bot.botBrain.sniperAimStartedAt !== null);
      const distance = Math.hypot(bot.x - target.x, bot.z - target.z);
      const required = botSniperAimMs(bot.botBrain.sniperAimDistance, room.botBehavior, bot.botBrain.sniperAimRoll);
      assert.ok(time - bot.botBrain.sniperAimStartedAt >= required - .001);
      assert.ok(bot.botBrain.sniperAimDistance >= distance - .001);
      assert.ok(bot.moveSpeed < .2 && bot.grounded && ads); shots++;
    }
    return shoot(player, time, ads, shot);
  };
  for (let i = 0; i < 20 * 60; i++) { now += 1000 / 60; room.tick(1 / 60); }
  assert.ok(shots >= 2, `${shots} distant shots`);
});

test('losing sight or moving resets pending sniper aim and a retreating target extends, never shortens, its deadline', () => {
  const { room, bot, target, input } = arena('extreme', 'sniper', [{ id: 'wall', x: 0, y: 0, z: 0, w: 30, h: 5, d: 2 }]);
  bot.x = target.x = 24; bot.z = 50; target.z = -30;
  for (let i = 0; i < 30; i++) input(1000 + i * 1000 / 60);
  const since = bot.botBrain.sniperAimStartedAt, before = bot.botBrain.sniperSettleAt;
  assert.ok(since !== null && before > since);
  target.z = -70; assert.equal(input(1500).fire, false);
  const extended = bot.botBrain.sniperSettleAt;
  assert.ok(extended > before); assert.equal(extended, since + botSniperAimMs(120, room.botBehavior, bot.botBrain.sniperAimRoll));
  target.z = -30; input(1517); assert.equal(bot.botBrain.sniperSettleAt, extended);
  bot.moveSpeed = .5; assert.equal(input(1534).fire, false);
  assert.equal(bot.botBrain.sniperAimStartedAt, null); assert.equal(bot.botBrain.sniperSettleAt, 0);
  bot.moveSpeed = 0; input(1551); assert.ok(bot.botBrain.sniperAimStartedAt >= 1551);
  target.x = -24; target.z = -50; assert.equal(input(1568).fire, false);
  assert.equal(bot.botBrain.aimPoint, null); assert.equal(bot.botBrain.sniperAimStartedAt, null); assert.equal(bot.botBrain.sniperSettleAt, 0);
});

test('an active aim rolls once, remains stable between ticks and rerolls only after that aim is interrupted', () => {
  const { room, bot, target, input } = arena('extreme', 'sniper'); target.z = -100;
  room.random = () => .25;
  let now = 1000;
  while (bot.botBrain.sniperAimStartedAt === null && now < 1500) { input(now); now += 1000 / 60; }
  const deadline = bot.botBrain.sniperSettleAt;
  assert.equal(bot.botBrain.sniperAimRoll, .25);
  room.random = () => .9;
  for (let i = 0; i < 6; i++) {
    assert.equal(input(now).fire, false); now += 1000 / 60;
    assert.equal(bot.botBrain.sniperAimRoll, .25); assert.equal(bot.botBrain.sniperSettleAt, deadline);
  }
  bot.moveSpeed = .5; input(now); now += 1000 / 60;
  assert.equal(bot.botBrain.sniperAimRoll, null);
  bot.moveSpeed = 0; input(now);
  assert.equal(bot.botBrain.sniperAimRoll, .9);
  assert.equal(bot.botBrain.sniperSettleAt - bot.botBrain.sniperAimStartedAt, botSniperAimMs(100, room.botBehavior, .9));
});

test('scope range never bypasses solid cover, dead targets, teammates or spawn protection', () => {
  for (const invalid of ['wall', 'dead', 'friendly', 'protected']) {
    const { bot, target, input } = arena('extreme', 'sniper', invalid === 'wall' ? [{ id: 'wall', x: 0, y: 0, z: -60, w: 40, d: 2, h: 5 }] : []);
    target.z = -120;
    if (invalid === 'dead') target.hp = 0;
    if (invalid === 'friendly') bot.teamId = target.teamId = 'blue';
    if (invalid === 'protected') target.protectedUntil = 10_000;
    for (let i = 0; i < 150; i++) { assert.equal(input(1000 + i * 17).fire, false); assert.equal(bot.botBrain.aimPoint, null); }
  }
});
