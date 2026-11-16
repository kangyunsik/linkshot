import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../shared/simulation.js';
import { WORLD, RULES, bounds, hasLineOfSight, playerPose } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer } from '../shared/movement.js';
import { canTraverse, findPath, followBotPath, steerBot } from '../shared/bot-navigation.js';

const arena = (obstacles = []) => Object.freeze({ ...WORLD, width: 40, depth: 40, buildings: [], walkways: [], obstacles });
function combat(weaponId) {
  let now = 1000; const room = new Room('TACTIC', { bots: 0, clock: () => now, random: () => .5 }); room.world = arena();
  const bot = room.addPlayer('bot', 'BOT', true, { weaponId }), target = room.addPlayer('target', 'TARGET');
  Object.assign(bot, { x: 0, y: 0, z: weaponId === 'sniper' ? 15 : 8, yaw: 0, pitch: 0, grounded: true, hp: 1000000, protectedUntil: 0, spawnExitPath: [] });
  Object.assign(target, { x: 0, y: 0, z: weaponId === 'sniper' ? -15 : -8, hp: 1000000, protectedUntil: 0 });
  return { room, bot, tick() { now += 1000 / 60; room.tick(1 / 60); return now; } };
}
function drive(world, from, goal, direct = false) {
  const p = { ...from, y: 0, vy: 0, grounded: true, weaponId: 'rifle', yaw: 0, pitch: 0, botBrain: { strafeSide: 1 }, botPath: direct ? [goal] : findPath(from, goal, world) };
  let jumped = false, crouched = false, maxY = 0, reached = false;
  for (let i = 0; i < 1800; i++) {
    if (p.grounded && Math.hypot(p.x - goal.x, p.z - goal.z) < .25) { reached = true; break; }
    const next = followBotPath(p, world), distance = Math.hypot(next.x - p.x, next.z - p.z), yaw = Math.atan2(-(next.x - p.x), -(next.z - p.z));
    const input = steerBot(p, { ...EMPTY_INPUT, yaw, forward: Math.min(.8, distance * 4) }, world, 1000 + i * 1000 / 60);
    movePlayer(p, input, 1 / 60, world); jumped ||= !p.grounded && p.vy > 0; crouched ||= p.crouching; maxY = Math.max(maxY, p.y);
    for (const box of world.obstacles) { const b = bounds(box, RULES.playerRadius - .00001); assert.ok(!(p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.maxY - .00001 && p.y + playerPose(p).height > b.minY + .00001), `body penetrated ${box.id}`); }
  }
  return { p, reached, jumped, crouched, maxY };
}

test('rifle AI actually moves during authoritative shots instead of standing still inside its preferred range', () => {
  const { bot, tick } = combat('rifle'), speeds = [];
  for (let i = 0; i < 60 * 12; i++) { const now = tick(); if (bot.lastShot === now) speeds.push(bot.moveSpeed); }
  assert.ok(speeds.length >= 4); assert.ok(speeds.every((speed) => speed > .2));
});

test('sniper AI braces before each aimed shot, crouches at range and repositions between shots', () => {
  const { room, bot, tick } = combat('sniper'), shots = []; let movedAfterShot = false, crouched = false, aimed = false;
  const shoot = room.shoot.bind(room); room.shoot = (player, now, ads, shot) => { if (player === bot) aimed = ads; return shoot(player, now, ads, shot); };
  for (let i = 0; i < 60 * 16; i++) {
    const now = tick(); crouched ||= bot.crouching;
    if (shots.length && bot.moveSpeed > .2) movedAfterShot = true;
    if (bot.lastShot === now) shots.push({ speed: bot.moveSpeed, ads: aimed, elapsed: now - (bot.botBrain.sniperSettleAt - 220), grounded: bot.grounded });
  }
  assert.ok(shots.length >= 3); assert.ok(shots.every((shot) => shot.speed < .2 && shot.ads && shot.grounded && shot.elapsed >= 219)); assert.ok(movedAfterShot && crouched);
});

test('full-body paths round thin L-shaped corners without cutting through walls or getting stuck', () => {
  const world = arena([{ id: 'corner-a', x: 0, y: 0, z: 0, w: .24, h: 3, d: 9 }, { id: 'corner-b', x: 2, y: 0, z: 4.5, w: 4.24, h: 3, d: .24 }]);
  const result = drive(world, { x: -3, z: 3 }, { x: 3, z: -3 }); assert.ok(result.reached, JSON.stringify(result.p)); assert.equal(result.jumped, false);
});

test('a clear head sightline does not let AI walk its feet into low cover', () => {
  const world = arena([{ id: 'crate', x: 0, y: 0, z: 0, w: 2, h: .9, d: 2 }]), a = { x: 0, y: 0, z: 3 }, b = { x: 0, y: 0, z: -3 };
  assert.equal(hasLineOfSight({ ...a, y: RULES.eyeHeight }, { ...b, y: RULES.eyeHeight }, world), true); assert.equal(canTraverse(a, b, world), false);
});

test('AI crouches through a low passage using ordinary collision/stance rules, then stands outside', () => {
  const world = arena([{ id: 'low-roof', x: 0, y: 1.25, z: 0, w: 6, h: .3, d: 6 }]);
  const result = drive(world, { x: 0, z: 5 }, { x: 0, z: -5 }); assert.ok(result.reached && result.crouched); assert.equal(result.p.crouching, false); assert.equal(result.maxY, 0);
});

test('an AI already beneath a low ceiling can crouch around a blocked forward probe instead of freezing', () => {
  const world = Object.freeze({ ...arena([
    { id: 'low-roof', x: 0, y: 1.25, z: 0, w: 12, h: .35, d: 12 },
    { id: 'blocked-forward', x: 0, y: 0, z: -.9, w: 3, h: 1.25, d: .4 },
  ]), terrain: true, navLayers: [0] });
  const bot = { x: 0, y: 0, z: 0, yaw: 0, grounded: true, weaponId: 'rifle', crouching: true, crouchAmount: 1, botBrain: { strafeSide: 1 }, botPath: [] };
  const input = steerBot(bot, { ...EMPTY_INPUT, forward: .8 }, world, 1000);
  assert.equal(input.crouch, true); assert.ok(Math.hypot(input.forward, input.strafe) > .5);
  movePlayer(bot, input, 1 / 60, world); assert.ok(Math.hypot(bot.x, bot.z) > .02); assert.equal(bot.y, 0);
});

test('terrain navigation can leave an extra steering margin without ever sweeping through the physical box or cylinder', () => {
  for (const shape of [undefined, 'cylinder']) {
    const world = Object.freeze({ ...arena([{ id: 'cover', x: 0, y: 0, z: 0, w: 4, h: 3, d: 4, shape }]), terrain: true, navLayers: [0] }), from = { x: -2.36, y: 0, z: 0 };
    assert.equal(canTraverse(from, { x: -5, y: 0, z: 0 }, world), true);
    assert.equal(canTraverse(from, { x: 5, y: 0, z: 0 }, world), false);
    assert.ok(findPath(from, { x: -5, y: 0, z: 0 }, world).length > 0);
  }
});

test('AI hops a short low obstacle with the normal jump arc, but never jumps at a high wall or low ceiling', () => {
  const crate = { id: 'short-crate', kind: 'crate', x: 0, y: 0, z: 0, w: 3, h: .9, d: .6 };
  const result = drive(arena([crate]), { x: 0, z: 1.2 }, { x: 0, z: -3 }, true);
  assert.ok(result.reached && result.jumped); assert.ok(result.maxY > .9 && result.maxY < 2.2); assert.equal(result.p.grounded, true);
  for (const obstacles of [[{ ...crate, h: 3 }], [crate, { id: 'ceiling', x: 0, y: 2, z: 0, w: 4, h: .3, d: 4 }]]) {
    const p = { x: 0, y: 0, z: 1.2, yaw: 0, grounded: true, weaponId: 'rifle', botBrain: { strafeSide: 1 }, botPath: [] };
    assert.equal(steerBot(p, { ...EMPTY_INPUT, forward: .8 }, arena(obstacles), 1000).jump, false);
  }
});
