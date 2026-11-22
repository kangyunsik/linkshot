import test from 'node:test';
import assert from 'node:assert/strict';
import { getMap, RULES, hasLineOfSight, wallDistance } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer, supportHeight } from '../shared/movement.js';
import { routeThroughBasements } from '../shared/basement-navigation.js';
import { findPath } from '../shared/bot-navigation.js';
import { settleDroppedWeapon } from '../shared/equipment.js';
import { Room, traceShot } from '../shared/simulation.js';

const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const close = (a, b) => gap(a, b) < .11 && Math.abs(a.y - b.y) < .07;

function walkRoute(world, route) {
  const p = { ...route[0], vy: 0, grounded: true, weaponId: 'rifle' };
  for (const goal of route.slice(1)) {
    for (let i = 0; i < 600 && !close(p, goal); i++) {
      const distance = gap(p, goal), yaw = Math.atan2(p.x - goal.x, p.z - goal.z);
      movePlayer(p, { ...EMPTY_INPUT, forward: Math.min(1, distance * 4), yaw }, 1 / 60, world);
      assert.ok(p.y >= world.underground.floor - .001, `${world.id}: fell through the basement`);
    }
    assert.ok(close(p, goal) && p.grounded, `${world.id}: failed to walk to ${JSON.stringify(goal)}`);
  }
}

test('both building basements have real openings and can be crossed both ways without jumping', () => {
  for (const id of ['drydock', 'whiteout']) {
    const world = getMap(id), u = world.underground, entries = u.entrances;
    for (const entry of entries) {
      const building = world.buildings.find(b => b.id === entry.buildingId);
      assert.ok(Math.abs(entry.top.x - building.x) < building.w / 2 && Math.abs(entry.top.z - building.z) < building.d / 2);
      assert.equal(supportHeight(entry.top, world), 0);
      assert.ok(Math.abs(supportHeight(entry.bottom, world) - u.floor) < 1e-8);
    }
    const path = [entries[0].top, ...u.path, entries[1].top];
    walkRoute(world, path);
    walkRoute(world, [...path].reverse());
  }
});

test('the opened stairs do not stop shots at y=0, but ordinary ground blocks them; dropped gear lands below grade', () => {
  for (const id of ['drydock', 'whiteout']) {
    const world = getMap(id), u = world.underground, down = { x: 0, y: -1, z: 0 };
    const shaft = u.entrances[0].hole, hall = u.path[2];
    const shooter = (p) => ({ x: p.x, y: 0, z: p.z, weaponId: 'rifle', yaw: 0, pitch: 0 });
    const stair = traceShot(shooter(shaft), [], 1000, world, down, 12), capped = traceShot(shooter(hall), [], 1000, world, down, 12);
    assert.ok(stair.end.y < -1 && stair.surface.kind === 'basement-step');
    assert.equal(capped.end.y, 0); assert.equal(capped.surface.kind, 'ground-slab');
    assert.equal(hasLineOfSight({ ...hall, y: .8 }, { ...hall, y: -1.2 }, world), false);
    const jumper = { ...hall, grounded: true, vy: 0 };
    for (let i = 0; i < 90; i++) {
      movePlayer(jumper, { ...EMPTY_INPUT, jump: i === 0 }, 1 / 60, world);
      assert.ok(jumper.y + RULES.playerHeight < -.239, 'the actual ceiling blocks jumps');
    }
    assert.ok(jumper.grounded && Math.abs(jumper.y - u.floor) < 1e-8);
    const drop = { ...hall, y: u.floor + .75, vy: 0, grounded: false };
    for (let i = 0; i < 60; i++) settleDroppedWeapon(drop, 1 / 60, world);
    assert.ok(drop.grounded && Math.abs(drop.y - u.floor) < 1e-8);
  }
});

test('Whiteout actually separates the surface, while Drydock retains a street alternate', () => {
  for (const id of ['drydock', 'whiteout']) {
    const w = getMap(id), [a, b] = w.underground.entrances, raw = findPath(a.top, b.top, w);
    const surfaceReached = gap(raw.at(-1) || a.top, b.top) < .8;
    assert.equal(surfaceReached, id === 'drydock');
    if (id === 'whiteout') {
      const divider = w.obstacles.find(box => box.id === 'glacier-divider');
      assert.ok(divider.d > w.depth && divider.h >= 16);
      for (const z of [-31.1, -20, 0, 20, 31.1]) {
        assert.ok(wallDistance({ x: -2.4, y: 13.3, z }, { x: 1, y: 0, z: 0 }, 5, w) < .5);
      }
      const path = routeThroughBasements(a.top, b.top, w).points;
      assert.ok(path.some(p => p.y === w.underground.floor) && close(path.at(-1), b.top));
    }
  }
});

test('Whiteout research and service lanes are independent below the divider and both work in either direction', () => {
  const world = getMap('whiteout'), u = world.underground, [west, east] = u.entrances, [service] = u.branches;
  assert.ok(service.width < world.underground.passages[0].d);
  const seal = (id, z, d) => ({ id, x: 0, y: u.floor, z, w: .4, d, h: 3.6 });
  const mainBlock = seal('test-research-closed', -7.2, 5.7), serviceBlock = seal('test-service-closed', service.path.at(-1).z, service.width + .2);
  for (const [block, lane] of [[mainBlock, serviceBlock], [serviceBlock, mainBlock]]) {
    const sealed = Object.freeze({ ...world, obstacles: [...world.obstacles, block] });
    for (const [from, to] of [[west.top, east.top], [east.top, west.top]]) {
      const path = [from, ...routeThroughBasements(from, to, sealed).points];
      assert.ok(close(path.at(-1), to));
      const index = path.findIndex((p, i) => i > 0 && p.y < 0 && path[i - 1].y < 0 && p.x * path[i - 1].x <= 0);
      assert.ok(index > 0, 'must go under the divider');
      const a = path[index - 1], b = path[index], crossing = a.z + (b.z - a.z) * (-a.x / (b.x - a.x));
      assert.ok(Math.abs(crossing - lane.z) < lane.d / 2, 'must use the other lane');
      walkRoute(sealed, path);
    }
  }
  const sealed = { ...world, obstacles: [...world.obstacles, mainBlock, serviceBlock] };
  assert.deepEqual(routeThroughBasements(west.top, east.top, sealed).points, []);
});

test('Whiteout skywalk buildings have fewer windows, separated flights and real covered interior walls', () => {
  const w = getMap('whiteout'), [link] = w.roofBridges;
  const [lab, service] = [link.from, link.to].map(id => w.buildings.find(b => b.id === id));
  assert.ok(lab.w >= 16 && lab.d >= 12 && service.w >= 8.8 && service.d >= 9);
  assert.equal(lab.windows.length, 2); assert.equal(service.windows.length, 2);
  assert.ok(gap(lab.stairs[0].flights[0][0], lab.stairs[1].flights[0][0]) > 9);
  const pieces = w.obstacles.filter(b => b.buildingId === lab.id && b.id.includes('-partition-'));
  assert.ok(pieces.some(b => b.y === 0 && b.h > RULES.eyeHeight) && pieces.some(b => b.y === 3));
  assert.equal(hasLineOfSight({ x: 15.7, y: RULES.eyeHeight, z: 12 }, { x: 17.4, y: RULES.eyeHeight, z: 12 }, w), false);
});

test('a Whiteout bot finds the interior stairs from a spawn, uses the tunnel, and exits uphill into the other sector', () => {
  let now = 1000;
  const room = new Room('B1', { mapId: 'whiteout', bots: 0, clock: () => now, botDifficulty: 'advanced', random: () => .5 });
  const ground = room.world.spawns.filter(s => s.y === 0), from = ground.find(s => s.x < -33), to = ground.find(s => s.x > 16);
  const bot = room.addPlayer('a', 'BOT', true), target = room.addPlayer('b', 'TARGET');
  Object.assign(bot, { ...from, weaponId: 'knife', hp: 1e6, grounded: true, protectedUntil: 0, spawnExitPath: [] });
  Object.assign(target, { ...to, hp: 1e6, grounded: true, protectedUntil: 0 });
  let wentBelow = false, reached = false;
  for (let i = 0; i < 60 * 55; i++) {
    now += 1000 / 60; room.tick(1 / 60); room.events.length = 0;
    if (bot.y < -3.5 && Math.abs(bot.x) < 1) wentBelow = true;
    if (gap(bot, to) < .85 && bot.y === 0) { reached = true; break; }
  }
  assert.ok(wentBelow && reached, `last position ${bot.x}, ${bot.y}, ${bot.z}`);
});
