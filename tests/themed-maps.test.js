import test from 'node:test';
import assert from 'node:assert/strict';
import { getMap, hasLineOfSight, wallDistance, RULES } from '../shared/world.js';
import { movePlayer, EMPTY_INPUT, supportHeight } from '../shared/movement.js';
import { Room, findPath } from '../shared/simulation.js';

const walkTo = (player, target, world, frames = 1200) => {
  for (let i = 0; i < frames; i++) {
    const dx = target.x - player.x, dz = target.z - player.z, distance = Math.hypot(dx, dz);
    if (distance < .1 && Math.abs(player.y - target.y) < .07) return true;
    movePlayer(player, { ...EMPTY_INPUT, forward: Math.min(1, distance * 4), yaw: Math.atan2(-dx, -dz) }, 1 / 60, world);
  }
  return false;
};

test('the conservatory and Korean market have distinct playable landmarks, natural spawns and no gameplay modifiers', () => {
  const garden = getMap('overgrowth'), market = getMap('nightmarket');
  assert.equal(garden.theme, 'greenhouse'); assert.equal(market.theme, 'market');
  assert.equal(garden.obstacles.filter((b) => b.kind === 'tree').length, 1);
  assert.ok(garden.obstacles.some((b) => b.kind === 'root')); assert.ok(garden.obstacles.filter((b) => b.kind === 'planter').length >= 6);
  assert.equal(market.obstacles.filter((b) => b.kind === 'market-stall').length, 10);
  assert.equal(market.buildings.filter((b) => b.id.startsWith('restaurant-') && b.storeys === 2).length, 4);
  for (const world of [garden, market]) {
    assert.ok(world.spawns.length >= 40); assert.equal(world.spawns.filter((s) => s.y === 0).length, 24);
    assert.equal(world.obstacles.some((b) => b.kind === 'container'), false);
    assert.equal(world.footprint.length, 3); assert.ok(world.obstacles.some((b) => b.kind === 'closed-annex'));
    assert.ok(world.obstacles.filter((b) => b.kind === 'closed-annex').reduce((sum, b) => sum + b.w * b.d, 0) > world.width * world.depth * .15, 'the playable shape is genuinely non-rectangular');
    for (const spawn of world.spawns) assert.ok(world.footprint.some((r) => Math.abs(spawn.x - r.x) < r.w / 2 && Math.abs(spawn.z - r.z) < r.d / 2), `${world.id}: spawn stays inside the irregular footprint`);
    for (const key of ['damage', 'speed', 'gravity', 'hp']) assert.equal(world[key], undefined);
  }
});

test('every ground spawn in both irregular arenas has a bot path into the connected central play space', () => {
  for (const id of ['overgrowth', 'nightmarket']) {
    const world = getMap(id), hub = { x: id === 'overgrowth' ? 0 : -8, z: 0 };
    for (const spawn of world.spawns.filter((spawn) => spawn.y === 0)) {
      const path = findPath(spawn, hub, world), end = path.at(-1) || spawn;
      assert.ok(Math.hypot(end.x - hub.x, end.z - hub.z) < 1, `${spawn.spawnId}: isolated spawn pocket`);
    }
  }
});

test('the conservatory management bridge can be crossed both ways without jumping and has a real open underpass', () => {
  const world = getMap('overgrowth');
  for (const side of [-1, 1]) {
    const p = { x: side * 20, y: 0, z: 0, vy: 0, grounded: true, weaponId: 'rifle' };
    assert.ok(walkTo(p, { x: side * 10, y: 3, z: 0 }, world)); assert.equal(supportHeight(p, world), 3);
    assert.ok(walkTo(p, { x: -side * 10, y: 3, z: 0 }, world));
    assert.ok(walkTo(p, { x: -side * 20, y: 0, z: 0 }, world));
  }
  const under = { x: 0, y: 0, z: -3, vy: 0, grounded: true, weaponId: 'rifle' };
  assert.ok(walkTo(under, { x: 0, y: 0, z: 3 }, world));
  assert.equal(hasLineOfSight({ x: 0, y: RULES.eyeHeight, z: -3 }, { x: 0, y: RULES.eyeHeight, z: 3 }, world), true);
  assert.ok(wallDistance({ x: 0, y: 4.62, z: 0 }, { x: 0, y: -1, z: 0 }, 10, world) < 1.63, 'the bridge deck really stops bullets');
});

test('bots climb onto and descend from the conservatory bridge using its persistent traversal route', () => {
  for (const direction of ['up', 'down']) {
    let now = 1000; const room = new Room('LEAF2', { mapId: 'overgrowth', bots: 0, clock: () => now, random: () => .5 });
    const bridge = room.world.walkways[0], bot = room.addPlayer('bot', 'BOT', true), target = room.addPlayer('human', 'HUMAN');
    Object.assign(bot, { ...(direction === 'up' ? bridge.entry : bridge.roof), hp: 1000000, yaw: 0, pitch: 0, vy: 0, grounded: true, protectedUntil: 0, spawnExitPath: [], botPath: [], nextPathAt: 0 });
    Object.assign(target, { ...(direction === 'down' ? bridge.entry : { ...bridge.roof, x: 10 }), hp: 1000000, protectedUntil: 0 });
    let reached = false;
    for (let i = 0; i < 60 * 60; i++) { now += 1000 / 60; room.tick(1 / 60); if (direction === 'up' ? bot.y === 3 && bot.x > -11.5 : bot.y === 0 && bot.x < -19) { reached = true; break; } }
    assert.equal(reached, true, `${direction}: ${JSON.stringify({ x: bot.x, y: bot.y, z: bot.z })}`);
  }
});

test('the market dogleg street, back alley and courtyard connect while stall counters, backs and awnings remain solid', () => {
  const world = getMap('nightmarket');
  for (const [from, to] of [[{ x: -8, z: -22 }, { x: -8, z: 8 }], [{ x: -8, z: 8 }, { x: 3, z: 12 }], [{ x: 3, z: 12 }, { x: 29, z: 14 }], [{ x: -33, z: -10 }, { x: -22, z: -2 }]]) {
    const path = findPath(from, to, world);
    assert.ok(path.length > 0, `market lane ${JSON.stringify(from)}`); assert.ok(Math.hypot(path.at(-1).x - to.x, path.at(-1).z - to.z) < .1);
    const p = { ...from, y: 0, vy: 0, grounded: true, weaponId: 'rifle' };
    for (const point of path) assert.ok(walkTo(p, { ...point, y: 0 }, world, 120), `blocked path at ${JSON.stringify(point)}`);
  }
  assert.equal(hasLineOfSight({ x: -8, y: RULES.eyeHeight, z: -22 }, { x: -8, y: RULES.eyeHeight, z: 8 }, world), true);
  const stall = world.obstacles.find((b) => b.kind === 'market-stall'), from = { x: stall.x + 3, y: .6, z: stall.z };
  assert.equal(hasLineOfSight(from, { ...from, x: stall.x }, world), false);
  assert.ok(wallDistance({ x: stall.x, y: 1.7, z: stall.z }, { x: 0, y: 1, z: 0 }, 10, world) < 1, 'awnings have the same overhead collision as their render');
});
