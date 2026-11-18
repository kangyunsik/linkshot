import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, BOT_BEHAVIOR } from '../shared/simulation.js';
import { WORLD, RULES } from '../shared/world.js';
import { findPath, canTraverse } from '../shared/bot-navigation.js';
import { botRouteSeed, botLongRange } from '../shared/bot-awareness.js';
import { getWeapon } from '../shared/catalog.js';
import { angleDelta } from '../shared/movement.js';

function random(seed = 17) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function place(p, x, z, yaw = 0) { return Object.assign(p, { x, y: 0, z, yaw, pitch: 0, hp: 1000000, grounded: true, moveSpeed: 0, protectedUntil: 0, spawnExitPath: [] }); }
function arena(obstacles = []) { const room = new Room('AWARE', { bots: 0, clock: () => 1000, random: random() }); room.world = { ...WORLD, width: 160, depth: 160, obstacles, buildings: [], walkways: [] }; return room; }

test('bot-specific path variants take different legal sides of cover and retain deterministic routes', () => {
  const world = { ...WORLD, width: 40, depth: 40, buildings: [], walkways: [], obstacles: [{ id: 'cover', x: 0, y: 0, z: 0, w: 6, h: 3, d: 10 }] };
  const from = { x: 0, y: 0, z: 12 }, to = { x: 0, y: 0, z: -12 }, signatures = new Set(), sides = new Set();
  for (let i = 0; i < 12; i++) {
    const variant = botRouteSeed(`bot-${i}`, 1), path = findPath(from, to, world, variant);
    signatures.add(JSON.stringify(path)); sides.add(Math.sign(path.find(p => Math.abs(p.x) > 3.2)?.x || 0));
    assert.deepEqual(path, findPath(from, to, world, variant));
    let previous = from;
    for (const point of path) { assert.ok(canTraverse(previous, point, world, RULES.crouchHeight)); previous = { ...point, y: 0 }; }
    assert.ok(Math.hypot(previous.x - to.x, previous.z - to.z) < 1);
  }
  assert.ok(signatures.size > 1); assert.ok(sides.has(-1) && sides.has(1));
});

test('real incoming fire from humans or bots creates delayed bounded turns toward a historical sound bearing', () => {
  for (const isBot of [false, true]) {
    const room = arena(), bot = place(room.addPlayer('observer', 'OBSERVER', true, { weaponId: 'rifle' }), 0, 0);
    place(room.addPlayer('front', 'FRONT'), 0, -6);
    const source = place(room.addPlayer('source', 'SOURCE', isBot, { weaponId: 'rifle' }), 0, 10);
    room.botInput(bot, 1000, 1 / 60); assert.equal(bot.botBrain.targetId, 'front');
    room.shoot(source, 1100); const alert = bot.botBrain.alert;
    assert.ok(alert.nearMiss); assert.ok(alert.reactAt >= 1240); assert.ok(alert.reactAt < 1700);
    const input = room.botInput(bot, alert.reactAt + 1, 1 / 60);
    assert.equal(bot.botBrain.targetId, source.id); assert.equal(input.fire, false);
    assert.ok(Math.abs(angleDelta(input.yaw, bot.yaw)) <= BOT_BEHAVIOR.turnRadiansPerSecond * 1.8 / 60 + 1e-9);
    const historical = [alert.x, alert.z]; source.x += 30; room.botInput(bot, alert.reactAt + 20, 1 / 60);
    assert.deepEqual([bot.botBrain.alert.x, bot.botBrain.alert.z], historical);
  }
});

test('suppressed distant reports and friendly shots cannot reveal an enemy, and sound never enables shooting through cover', () => {
  const room = arena(), bot = place(room.addPlayer('observer', 'OBSERVER', true), 0, 0), source = place(room.addPlayer('source', 'SOURCE'), 0, 55, Math.PI);
  source.suppressor = true; room.shoot(source, 1000); assert.equal(bot.botBrain.alert, undefined);
  source.suppressor = false; source.ammo = 30; source.nextFireAt = 0; room.shoot(source, 2000); assert.equal(bot.botBrain.alert.sourceId, source.id);
  bot.botBrain.alert = null; bot.teamId = source.teamId = 'blue'; source.ammo = 30; source.nextFireAt = 0; room.shoot(source, 3000); assert.equal(bot.botBrain.alert, null);
  const covered = arena([{ id: 'wall', x: 0, y: 0, z: 0, w: 20, h: 5, d: 2 }]);
  const guard = place(covered.addPlayer('guard', 'GUARD', true), 0, 8), shooter = place(covered.addPlayer('shooter', 'SHOOTER'), 0, -8, Math.PI);
  covered.shoot(shooter, 1000); assert.ok(guard.botBrain.alert);
  for (let i = 0; i < 150; i++) { const input = covered.botInput(guard, 1100 + i * 17, 1 / 60); guard.yaw = input.yaw; guard.pitch = input.pitch; assert.equal(input.fire, false); }
});

test('long-range observations are intermittent and weapon bounded, with ordinary reaction delays and real burst cooldowns', () => {
  const room = arena(), bot = place(room.addPlayer('observer', 'OBSERVER', true, { weaponId: 'rifle' }), 0, 30), target = place(room.addPlayer('target', 'TARGET'), 0, -30);
  const shots = []; let scanned = false, resting = false;
  for (let i = 0; i < 12 * 60; i++) {
    const now = 1000 + i * 1000 / 60, input = room.botInput(bot, now, 1 / 60);
    bot.yaw = input.yaw; bot.pitch = input.pitch; scanned ||= !!bot.botBrain.aimPoint; resting ||= now > 4000 && !bot.botBrain.aimPoint;
    if (input.fire) { assert.ok(now >= bot.botBrain.reactAt); room.shoot(bot, now, input.ads); shots.push(now); }
  }
  assert.ok(scanned && resting); assert.ok(shots.length > 0);
  assert.ok(shots.slice(1).every((time, i) => time - shots[i] >= BOT_BEHAVIOR.shotIntervalMs - .1));
  assert.ok(botLongRange(getWeapon('sniper'), BOT_BEHAVIOR) > botLongRange(getWeapon('rifle'), BOT_BEHAVIOR));
  assert.ok(botLongRange(getWeapon('pistol'), BOT_BEHAVIOR) <= BOT_BEHAVIOR.firingRange);
  assert.equal(target.hp > 0, true);
});
