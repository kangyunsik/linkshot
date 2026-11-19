import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, RULES } from '../shared/world.js';
import { findPath, canTraverse } from '../shared/bot-navigation.js';
import { Room } from '../shared/simulation.js';

const worldFor = (obstacles) => Object.freeze({ ...WORLD, width: 20, depth: 20, buildings: [], walkways: [], obstacles });
function breadthFirstLength(from, to, world) {
  const key = (p) => `${p.x},${p.z}`, visited = new Set([key(from)]), queue = [{ ...from, cost: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (p.x === to.x && p.z === to.z) return p.cost;
    for (const [dx, dz] of [[.5, 0], [-.5, 0], [0, .5], [0, -.5]]) {
      const next = { x: p.x + dx, y: 0, z: p.z + dz, cost: p.cost + 1 }, id = key(next);
      if (Math.abs(next.x) > 9 || Math.abs(next.z) > 9 || visited.has(id) || !canTraverse(p, next, world, RULES.crouchHeight, false)) continue;
      visited.add(id); queue.push(next);
    }
  }
  return Infinity;
}

test('A* preserves shortest legal grid routes and reusable-heap state across different goals and variants', () => {
  const world = worldFor([{ id: 'a', x: -2, y: 0, z: 0, w: 1, d: 9, h: 3 }, { id: 'b', x: 2, y: 0, z: 2, w: 1, d: 10, h: 3 }]);
  for (const [from, to] of [[{ x: -7, y: 0, z: -6 }, { x: 7, y: 0, z: 6 }], [{ x: -7, y: 0, z: 0 }, { x: 7, y: 0, z: 0 }], [{ x: 7, y: 0, z: 0 }, { x: -7, y: 0, z: 0 }]]) {
    const expected = breadthFirstLength(from, to, world);
    for (const variant of [0, 1, 17, 65537, 0xffffffff]) {
      const path = findPath(from, to, world, variant);
      assert.equal(path.length, expected); assert.deepEqual(path.at(-1), { x: to.x, z: to.z });
      let previous = from;
      for (const point of path) { assert.ok(canTraverse(previous, point, world, RULES.crouchHeight)); previous = { ...point, y: 0 }; }
    }
  }
});

test('an unreachable goal returns a legal closest approach, and empty arenas take a direct path', () => {
  const from = { x: -7, y: 0, z: 0 }, to = { x: 7, y: 0, z: 0 };
  const direct = findPath(from, to, worldFor([]));
  assert.equal(direct.length, 28); assert.deepEqual(direct.at(-1), { x: 7, z: 0 });
  assert.ok(direct.every((point, i) => Math.hypot(point.x - (direct[i - 1] || from).x, point.z - (direct[i - 1] || from).z) <= .5));
  const world = worldFor([{ id: 'barrier', x: 0, y: 0, z: 0, w: 2, d: 24, h: 5 }]);
  for (const variant of [0, 11, 0xffffffff]) {
    const path = findPath(from, to, world, variant); assert.ok(path.length > 0);
    assert.ok(path.at(-1).x < -1 && path.at(-1).x >= -1.5);
    let previous = from;
    for (const point of path) { assert.ok(canTraverse(previous, point, world, RULES.crouchHeight)); previous = { ...point, y: 0 }; }
  }
});

test('open combat does not repeatedly plan or smooth an unused navigation path', () => {
  const room = new Room('DIRECT', { bots: 0, clock: () => 1000, random: () => .5 }); room.world = worldFor([]);
  const bot = room.addPlayer('bot', 'BOT', true), target = room.addPlayer('target', 'TARGET');
  Object.assign(bot, { x: 0, y: 0, z: 6, yaw: 0, protectedUntil: 0, spawnExitPath: [] });
  Object.assign(target, { x: 0, y: 0, z: -6, protectedUntil: 0 });
  for (let i = 0; i < 60; i++) room.botInput(bot, 1000 + i * 17, 1 / 60);
  assert.deepEqual(bot.botPath, []); assert.equal(bot.botBrain.routeGoal, undefined);
});
