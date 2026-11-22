import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCHMAKING_MAPS, getMap, hasLineOfSight, wallDistance } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer, supportHeight } from '../shared/movement.js';
import { routeThroughBuildings } from '../shared/building-navigation.js';
import { Room } from '../shared/simulation.js';

function walkRoute(world, route, label) {
  assert.ok(route.length > 1, `${label}: missing route`);
  const player = { ...route[0], vy: 0, grounded: true, weaponId: 'rifle' };
  for (const to of route.slice(1)) {
    let reached = false;
    for (let frame = 0; frame < 420; frame++) {
      const dx = to.x - player.x, dz = to.z - player.z, distance = Math.hypot(dx, dz);
      if (distance < .10 && Math.abs(player.y - to.y) < .07 && player.grounded) { reached = true; break; }
      movePlayer(player, { ...EMPTY_INPUT, forward: Math.min(1, distance * 4), yaw: Math.atan2(-dx, -dz) }, 1 / 60, world);
    }
    assert.ok(reached, `${label}: could not walk to ${JSON.stringify(to)}`);
  }
}

test('the eight arenas have authored facades, distinct entrance faces and genuinely different stair routes', () => {
  const warehouse = getMap('drydock').buildings.find(b => b.id === 'warehouse');
  assert.ok(warehouse.w >= 17 && warehouse.d >= 14);
  assert.equal(new Set(warehouse.doors.map(door => `${door.axis}/${door.side}`)).size, 3);
  assert.deepEqual(warehouse.stairs.map(stair => stair.shape), ['straight', 'switchback']);
  assert.ok(warehouse.stairs[0].width >= 3);
  const routes = warehouse.doors.map(door => routeThroughBuildings(door.outside, warehouse.roof, getMap('drydock')).points);
  for (const stair of warehouse.stairs) assert.ok(routes.some(path => path.includes(stair.flights[0][1])), `${stair.shape} is chosen from at least one entrance`);
  const buildings = MATCHMAKING_MAPS.flatMap(world => world.buildings);
  assert.equal(buildings.length, 34);
  assert.ok(new Set(buildings.map(b => b.style)).size >= 6);
  assert.ok(buildings.filter(b => b.stairs.length > 1).length >= 5);
  for (const world of MATCHMAKING_MAPS) {
    assert.equal(world.coverWalls.length, 8);
    for (const building of world.buildings) {
      assert.ok(building.entry && building.solidPanels > building.windows.length, building.id);
      assert.equal(new Set(building.windows.map(win => win.floor)).size, building.storeys);
      for (const win of building.windows) {
        const axis = win.axis === 'x' ? 'z' : 'x';
        const inner = { ...win, [axis]: win[axis] - win.side * .6 }, outer = { ...win, [axis]: win[axis] + win.side * .6 };
        assert.ok(hasLineOfSight(inner, outer, world), `${world.id}/${building.id}: blocked opening`);
        inner.y = outer.y = win.floor * 3 + .5;
        assert.equal(hasLineOfSight(inner, outer, world), false, `${world.id}/${building.id}: missing sill`);
      }
    }
  }
});

test('all entrances connect to a roof, and every primary and secondary flight is walkable in both directions', () => {
  for (const world of MATCHMAKING_MAPS) for (const building of world.buildings) {
    const label = `${world.id}/${building.id}`;
    for (const stair of building.stairs) for (const flight of stair.flights) {
      walkRoute(world, flight, stair.id);
      walkRoute(world, [...flight].reverse(), stair.id);
    }
    for (const door of building.doors) for (const [from, to] of [[door.outside, building.roof], [building.roof, door.outside]]) {
      walkRoute(world, [from, ...routeThroughBuildings(from, to, world).points], label);
    }
  }
});

test('three roof crossings have open portals, different profiles, and solid floors at the actual walking height', () => {
  const bridged = MATCHMAKING_MAPS.filter(world => world.roofBridges.length);
  assert.deepEqual(bridged.map(w => w.id), ['blocknine', 'whiteout', 'nightmarket']);
  for (const world of bridged) for (const link of world.roofBridges) {
    const [a, b] = [link.from, link.to].map(id => world.buildings.find(building => building.id === id).roof);
    for (const [from, to] of [[a, b], [b, a]]) {
      const route = routeThroughBuildings(from, to, world).points;
      assert.ok(route.length > 1 && route.every(point => point.y === link.height), `${link.id}: detours via the ground`);
      walkRoute(world, [from, ...route], link.id);
    }
    const middle = { x: link.x, y: link.height, z: link.z };
    assert.equal(supportHeight(middle, world), link.height);
    assert.ok(wallDistance({ ...middle, y: middle.y + .45 }, { x: 0, y: -1, z: 0 }, 4, world) < .451);
    assert.equal(world.obstacles.some(box => box.id === `${link.id}-canopy`), link.style === 'covered');
  }
});

test('a bot navigates around stairwells and crosses from roof to roof rather than descending to street level', () => {
  for (const mapId of ['blocknine', 'whiteout', 'nightmarket']) {
    let now = 1000;
    const room = new Room('SKY', { bots: 0, mapId, clock: () => now, random: () => .5, botDifficulty: 'advanced' });
    const [link] = room.world.roofBridges, [from, to] = [link.from, link.to].map(id => room.world.buildings.find(b => b.id === id).roof);
    const bot = room.addPlayer('walker', 'BOT', true), goal = room.addPlayer('goal', 'GOAL');
    // Disable rooftop firing holds for this movement-only fixture.
    Object.assign(bot, { ...from, weaponId: 'knife', grounded: true, hp: 1e6, protectedUntil: 0, spawnExitPath: [] });
    Object.assign(goal, { ...to, grounded: true, hp: 1e6, protectedUntil: 0 });
    let crossed = false, entered = false;
    for (let i = 0; i < 60 * 12; i++) {
      now += 1000 / 60; room.tick(1 / 60); room.events.length = 0;
      assert.ok(bot.y > link.height - .45, `${link.id}: fell or took the ground route`);
      if (Math.abs(bot[link.axis] - link[link.axis]) < .3 && Math.hypot(bot.x - link.x, bot.z - link.z) < 1.2 && bot.y === link.height) crossed = true;
      if (Math.hypot(bot.x - to.x, bot.z - to.z) < .65 && bot.y === to.y) { entered = true; break; }
    }
    assert.ok(crossed && entered, link.id);
  }
});
