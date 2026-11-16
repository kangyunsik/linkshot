import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MATCHMAKING_MAPS, getMap, RULES, bounds, rayBox, impactSurface, playerPose, hasLineOfSight } from '../shared/world.js';
import { supportsGameType } from '../shared/game-types.js';
import { movePlayer, EMPTY_INPUT, supportHeight, canStand } from '../shared/movement.js';
import { horizontalOverlap, topHeight } from '../shared/terrain.js';
import { findPath, canTraverse, followBotPath, steerBot } from '../shared/bot-navigation.js';
import { Room } from '../shared/simulation.js';

test('twelve maps contain exactly four rule-specific team maps; matchmaking and FFA retain the original eight', () => {
  assert.equal(MAPS.length, 12); assert.equal(MATCHMAKING_MAPS.length, 8);
  for (const id of ['faultline', 'sump', 'relay', 'bastion']) {
    const world = getMap(id); assert.equal(supportsGameType(world, 'ffa'), false); assert.equal(world.buildings.length, 0);
    assert.throws(() => new Room('BAD', { mapId: id, bots: 0 }), /이용할 수 없습니다/);
  }
  assert.deepEqual(getMap('faultline').gameTypes, ['teams']); assert.deepEqual(getMap('sump').gameTypes, ['teams']);
  assert.deepEqual(getMap('relay').gameTypes, ['hardpoint']); assert.deepEqual(getMap('bastion').gameTypes, ['defense']);
});

test('all new spawns are supported, body-clear and explicitly assigned to the correct team', () => {
  for (const world of MAPS.filter((map) => map.terrain)) for (const point of world.spawns) {
    const p = { ...point, grounded: true, vy: 0, weaponId: 'rifle' };
    assert.equal(supportHeight(p, world), point.y, `${world.id}/${point.spawnId}`); assert.equal(canStand(p, world), true, `${world.id}/${point.spawnId}`);
    assert.ok(['blue', 'red'].includes(point.teamId));
  }
});

test('true ramp support and jumps agree at 30–144Hz without hidden steps or floating at maximum AABB height', () => {
  for (const hz of [30, 60, 144]) for (const reversed of [false, true]) {
    const slope = { id: 'ramp', x: 0, y: 0, z: 0, w: 18, d: 6, h: 3, kind: 'ramp', walkable: true, slope: { axis: 'x', low: reversed ? 3 : 0, high: reversed ? 0 : 3 } };
    const world = Object.freeze({ width: 40, depth: 20, terrain: true, navLayers: [0, 3], obstacles: [slope] }), direction = reversed ? -1 : 1;
    const p = { x: direction * -8.5, y: 1 / 12, z: 0, grounded: true, vy: 0, weaponId: 'rifle' };
    for (let i = 0; i < hz * 2; i++) { movePlayer(p, { ...EMPTY_INPUT, forward: 1, yaw: direction * -Math.PI / 2 }, 1 / hz, world); assert.ok(Math.abs(p.y - topHeight(bounds(slope), p)) < 1e-5); assert.equal(p.grounded, true); }
    assert.ok(p.y > 1.8 && p.y < 2.5);
    movePlayer(p, { ...EMPTY_INPUT, jump: true }, 1 / hz, world); assert.equal(p.grounded, false);
  }
});

test('ramp ray intersections and surface normals match the visible inclined plane', () => {
  const ramp = { id: 'r', x: 0, y: 0, z: 0, w: 10, d: 4, h: 2, slope: { axis: 'x', low: 0, high: 2 } }, origin = { x: 0, y: 5, z: 0 }, direction = { x: 0, y: -1, z: 0 };
  const distance = rayBox(origin, direction, ramp, 20); assert.equal(distance, 4);
  const surface = impactSurface(origin, direction, distance, ramp, { width: 20, depth: 20 }); assert.ok(surface.normal.x < 0 && surface.normal.y > .9); assert.equal(surface.point.y, 1);
});

test('round platforms preserve their center hole and ramp slots for movement and bullets', () => {
  const ring = { id: 'ring', x: 0, y: 1.25, z: 0, w: 20, d: 20, h: 1.15, shape: 'ring', innerRadius: 4, cutHalf: 1, walkable: true }, down = { x: 0, y: -1, z: 0 }, b = bounds(ring);
  assert.equal(rayBox({ x: 0, y: 5, z: 0 }, down, ring, 10), null); assert.equal(rayBox({ x: 7, y: 5, z: 0 }, down, ring, 10), null);
  assert.ok(Math.abs(rayBox({ x: 6, y: 5, z: 6 }, down, ring, 10) - 2.6) < 1e-6);
  assert.equal(horizontalOverlap({ x: 0, z: 0 }, b), false); assert.equal(horizontalOverlap({ x: 6, z: 6 }, b), true);
});

test('layered navigation reaches actual elevated relay goals and traverses the reservoir ring', () => {
  for (const [id, goal] of [['relay', { x: 0, y: 2.4, z: -20 }], ['faultline', { x: 0, y: 3, z: -23 }], ['sump', { x: 17, y: 2.4, z: -14 }]]) {
    const world = getMap(id), start = world.spawns.find((point) => point.teamId === 'blue'), path = findPath(start, goal, world), last = path.at(-1);
    assert.ok(last && Math.hypot(last.x - goal.x, last.z - goal.z) < 1 && Math.abs(last.y - goal.y) < .2, `${id}: ${JSON.stringify(last)}`);
  }
});

test('reservoir AI physically climbs onto the round walkway without penetrating its floor or ramp slots', () => {
  let now = 1000; const room = new Room('RINGAI', { mapId: 'sump', gameType: 'teams', bots: 0, clock: () => now, random: () => .5 }), bot = room.addPlayer('bot', 'BOT', true), target = room.addPlayer('human', 'HUMAN');
  Object.assign(bot, { x: -31, y: 0, z: -4, yaw: 0, pitch: 0, grounded: true, vy: 0, hp: 1000000, protectedUntil: 0, spawnExitPath: [] });
  Object.assign(target, { x: 17, y: 2.4, z: -14, hp: 1000000, protectedUntil: 0 }); let climbed = false;
  for (let i = 0; i < 60 * 60; i++) {
    now += 1000 / 60; room.tick(1 / 60); climbed ||= bot.grounded && Math.abs(bot.y - 2.4) < .01;
    for (const box of room.world.obstacles) { const b = bounds(box, RULES.playerRadius - .00001); assert.ok(!(horizontalOverlap(bot, b) && bot.y < topHeight(b, bot) - .00002 && bot.y + playerPose(bot).height > b.minY + .00002), box.id); }
  }
  assert.ok(climbed, JSON.stringify({ x: bot.x, y: bot.y, z: bot.z }));
});

function driveTerrainBot(world, from, goal, hz = 60) {
  const bot = { ...from, vy: 0, grounded: true, weaponId: 'rifle', yaw: 0, pitch: 0, botBrain: { strafeSide: 1 }, botPath: findPath(from, goal, world) };
  let crouched = false, reached = false;
  for (let i = 0; i < hz * 40; i++) {
    if (bot.grounded && Math.hypot(bot.x - goal.x, bot.z - goal.z) < .3 && Math.abs(bot.y - goal.y) < .1) { reached = true; break; }
    if (!bot.botPath.length && bot.grounded) bot.botPath = findPath(bot, goal, world);
    const next = followBotPath(bot, world), distance = Math.hypot(next.x - bot.x, next.z - bot.z), yaw = Math.atan2(-(next.x - bot.x), -(next.z - bot.z));
    const input = steerBot(bot, { ...EMPTY_INPUT, yaw, forward: Math.min(.8, distance * 4) }, world, 1000 + i * 1000 / hz);
    const previous = { x: bot.x, z: bot.z };
    movePlayer(bot, input, 1 / hz, world); crouched ||= bot.crouching;
    assert.ok(Math.hypot(bot.x - previous.x, bot.z - previous.z) <= RULES.runSpeed / hz + .0001, 'ramp contacts must not teleport the body');
    assert.equal(input.jump, false, 'ordinary upper/lower routes must not require jumping');
    for (const box of world.obstacles) {
      const b = bounds(box, RULES.playerRadius - .00001);
      assert.ok(!(horizontalOverlap(bot, b) && bot.y < topHeight(b, bot) - .00002 && bot.y + playerPose(bot).height > b.minY + .00002), `${box.id}: ${JSON.stringify({ x: bot.x, y: bot.y, z: bot.z })}`);
    }
  }
  assert.ok(reached, JSON.stringify({ from, goal, last: { x: bot.x, y: bot.y, z: bot.z }, next: bot.botPath[0] }));
  return { bot, crouched };
}

test('SUMP AI descends all four inner ramps and returns from the basin at 30–144Hz', () => {
  const world = getMap('sump');
  for (const hz of [30, 60, 144]) for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const upper = { x: x * 22.5, y: 2.4, z: z * 24.5 }, lower = { x: x * 6, y: 0, z: z * 6 };
    driveTerrainBot(world, upper, lower, hz); driveTerrainBot(world, lower, upper, hz);
  }
});

test('live SUMP combat AI follows a lower-floor opponent down and returns to the ring when the opponent changes floors', () => {
  let now = 1000; const room = new Room('DOWNUP', { gameType: 'teams', mapId: 'sump', bots: 0, clock: () => now, random: () => .5 }), bot = room.addPlayer('bot', 'BOT', true), target = room.addPlayer('human', 'HUMAN');
  Object.assign(bot, { x: 17, y: 2.4, z: -14, grounded: true, vy: 0, hp: 1000000, protectedUntil: 0, spawnExitPath: [], yaw: 0, pitch: 0 });
  Object.assign(target, { x: 7, y: 0, z: 10, hp: 1000000, protectedUntil: 0 });
  const reaches = (condition) => { for (let i = 0; i < 60 * 40; i++) { now += 1000 / 60; room.tick(1 / 60); if (condition()) return true; } return false; };
  assert.ok(reaches(() => bot.grounded && Math.abs(bot.y) < .00001 && Math.hypot(bot.x, bot.z) < 22));
  Object.assign(target, { x: -17, y: 2.4, z: 14 }); assert.ok(reaches(() => bot.grounded && Math.abs(bot.y - 2.4) < .00001));
});

test('SUMP connects upper/lower floors, standing undercroft, two-ended crouch shelters and every spawn exit', () => {
  const world = getMap('sump'), upper = { x: 17, y: 2.4, z: -14 }, lower = { x: 17, y: 0, z: -14 };
  assert.equal(canStand(lower, world), true); driveTerrainBot(world, upper, lower); driveTerrainBot(world, lower, upper);
  for (const side of [-1, 1]) {
    const entry = { x: side * 8, y: 0, z: -side * 17 }, exit = { x: side * 8, y: 0, z: -side * 27 };
    assert.equal(canStand({ x: side * 8, y: 0, z: -side * 22 }, world), false);
    assert.equal(driveTerrainBot(world, entry, exit).crouched, true); assert.equal(driveTerrainBot(world, exit, entry).crouched, true);
  }
  driveTerrainBot(world, { x: -13, y: 0, z: -30.5 }, { x: -8, y: 0, z: -17 });
  for (const spawn of world.spawns) assert.equal(canTraverse(spawn, spawn.exitPath[0], world), true, spawn.spawnId);
});

test('SUMP offers real standing and crouching cover in the basin, undercroft and upper ring', () => {
  const world = getMap('sump'), eye = (point, crouching = false) => ({ ...point, y: point.y + (crouching ? RULES.crouchEyeHeight : RULES.eyeHeight) });
  for (const [viewer, hidden] of [
    [{ x: 7, y: 0, z: 3 }, { x: 7, y: 0, z: 10 }],
    [{ x: 17, y: 0, z: 11 }, { x: 22, y: 0, z: 11 }],
    [{ x: 16, y: 2.4, z: -16 }, { x: 16, y: 2.4, z: -22 }],
  ]) {
    assert.equal(canStand(viewer, world), true); assert.equal(canStand(hidden, world), true);
    assert.equal(hasLineOfSight(eye(viewer), eye(hidden), world), false);
  }
  const viewer = { x: 16, y: 2.4, z: 18.5 }, hidden = { x: 20.3, y: 2.4, z: 18.5 };
  assert.equal(hasLineOfSight(eye(viewer), eye(hidden), world), true); assert.equal(hasLineOfSight(eye(viewer), eye(hidden, true), world), false);
});

test('RELAY keeps both ramp approaches and all objective AI slots reachable behind new cover', () => {
  const world = getMap('relay');
  for (const point of world.hardpoints) for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) {
    const goal = { x: point.x + x, y: point.y, z: point.z + z }; assert.equal(canStand(goal, world), true);
    for (const start of [world.spawns[0], world.spawns[4]]) {
      const last = findPath(start, goal, world).at(-1); assert.ok(last && Math.hypot(last.x - goal.x, last.z - goal.z) < .4 && Math.abs(last.y - goal.y) < .01);
    }
  }
  for (const [viewer, hidden] of [
    [{ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: -4 }],
    [{ x: -9, y: 2.4, z: -18.5 }, { x: -4, y: 2.4, z: -18.5 }],
    [{ x: 9, y: 1.2, z: 18.5 }, { x: 4, y: 1.2, z: 18.5 }],
  ]) assert.equal(hasLineOfSight({ ...viewer, y: viewer.y + RULES.eyeHeight }, { ...hidden, y: hidden.y + RULES.eyeHeight }, world), false);
});

test('BASTION is a larger layered arena with a physically shielded core and reachable rear breaches', () => {
  const room = new Room('VAULT', { gameType: 'defense', mapId: 'bastion', bots: 0 }), world = room.world, core = world.defenseCore;
  assert.equal(world.width, 96); assert.equal(world.depth, 88); assert.ok(world.width * world.depth > 68 * 64 * 1.9);
  const entries = world.spawns.filter((p) => p.teamId === 'red'); assert.equal(entries.length, 12);
  for (const spawn of world.spawns) assert.equal(canTraverse(spawn, spawn.exitPath[0], world), true, spawn.spawnId);
  for (const from of [...entries, { x: 0, y: 1.2, z: -4 }, { x: -31, y: 1.8, z: 4 }, { x: 31, y: 1.8, z: 4 }]) {
    assert.equal(room.objectives.coreVisible({ ...from, y: from.y + RULES.eyeHeight }, core), false, `direct core sightline from ${JSON.stringify(from)}`);
  }
  for (const point of world.defenseApproaches) {
    assert.equal(canStand(point, world), true); assert.equal(room.objectives.coreVisible({ ...point, y: point.y + RULES.eyeHeight }, core), true);
  }
  for (const from of entries) {
    const goal = world.defenseApproaches[from.x < 0 ? 0 : 1]; driveTerrainBot(world, from, goal);
  }
  for (const post of world.defensePosts) assert.equal(canStand(post, world), true);
});
