import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCHMAKING_MAPS, getMap, RULES, bounds, hasLineOfSight } from '../shared/world.js';
import { canTraverse, findPath } from '../shared/bot-navigation.js';
import { routeThroughBasements } from '../shared/basement-navigation.js';
import { horizontalOverlap } from '../shared/terrain.js';
import { EMPTY_INPUT, movePlayer } from '../shared/movement.js';

const at = (crossing, across, along) => crossing.axis === 'z' ? { x: across, z: along, y: 0 } : { x: along, z: across, y: 0 };
const reaches = (path, destination, start) => {
  const last = path.at(-1) || start;
  return Math.hypot(last.x - destination.x, last.z - destination.z) < .76;
};
const overlap = (a, b) => Math.abs(a.x - b.x) + 1e-5 < (a.w + b.w) / 2 && Math.abs(a.z - b.z) + 1e-5 < (a.d + b.d) / 2;

test('six arena footprints step inward on multiple edges without burying playable structures', () => {
  const revised = MATCHMAKING_MAPS.filter(world => world.arenaProfile);
  assert.deepEqual(revised.map(world => world.id), ['foundry', 'longrail', 'drydock', 'blocknine', 'whiteout', 'redline']);
  for (const world of revised) {
    const outer = world.obstacles.filter(box => box.arenaFace);
    assert.ok(outer.length >= 8 && new Set(outer.map(box => box.arenaFace)).size >= 3, world.id);
    assert.ok(outer.reduce((sum, box) => sum + box.w * box.d, 0) > world.width * world.depth * .09, world.id);
    const inside = world.obstacles.filter(box => !['arena-setback', 'wall'].includes(box.kind) && (box.y || 0) + box.h > 1e-5);
    for (const setback of world.obstacles.filter(box => box.kind === 'arena-setback')) {
      assert.ok(!inside.some(box => overlap(setback, box)), `${world.id}: something buried in ${setback.id}`);
    }
  }
});

test('every ground spawn on the revised arenas can reach the other zones via the real AI graph', () => {
  for (const world of MATCHMAKING_MAPS.filter(world => world.arenaProfile)) {
    const spawns = world.spawns.filter(spawn => spawn.y === 0), crossing = world.crossing;
    const hub = crossing ? at(crossing, crossing.lanes[0].center, crossing.at) : spawns[0];
    assert.equal(spawns.length, 24, world.id);
    for (const spawn of spawns) {
      const path = routeThroughBasements(spawn, hub, world)?.points ?? findPath(spawn, hub, world);
      assert.ok(reaches(path, hub, spawn), `${world.id}/${spawn.spawnId}: disconnected from main play area`);
    }
  }
});

test('Longrail has exactly one usable crossing and Block Nine has exactly two at ground level', () => {
  for (const [id, expected] of [['longrail', 1], ['blocknine', 2]]) {
    const world = getMap(id), { crossing } = world, half = (crossing.axis === 'z' ? world.width : world.depth) / 2;
    const colliders = world.obstacles.map(box => bounds(box, RULES.playerRadius)).filter(box => box.maxY > RULES.stepHeight && box.minY < RULES.playerHeight);
    let openings = 0, wasOpen = false;
    for (let across = -half + RULES.playerRadius; across <= half - RULES.playerRadius; across += .125) {
      const open = !colliders.some(box => horizontalOverlap(at(crossing, across, crossing.at), box));
      if (open && !wasOpen) openings++;
      wasOpen = open;
    }
    assert.equal(openings, expected, id);
    for (const lane of crossing.lanes) {
      const start = at(crossing, lane.center, lane.start), goal = at(crossing, lane.center, lane.end);
      assert.ok(canTraverse(start, goal, world), lane.name);
      assert.ok(reaches(findPath(start, goal, world), goal, start), lane.name);
      const player = { ...start, grounded: true, vy: 0, weaponId: 'rifle' };
      const yaw = Math.atan2(start.x - goal.x, start.z - goal.z);
      for (let i = 0; i < 420 && Math.hypot(player.x - goal.x, player.z - goal.z) > .16; i++) movePlayer(player, { ...EMPTY_INPUT, yaw, forward: .75 }, 1 / 60, world);
      assert.ok(Math.hypot(player.x - goal.x, player.z - goal.z) <= .16 && player.y === 0, `${id}/${lane.name}: requires a jump or a collision workaround`);
      const width = lane.width + 2, point = at(crossing, lane.center, crossing.at);
      const sealed = { ...world, obstacles: [...world.obstacles, { ...point, h: 13, w: crossing.axis === 'z' ? width : 1, d: crossing.axis === 'z' ? 1 : width }] };
      assert.equal(reaches(findPath(start, goal, sealed), goal, start), expected === 2, `${id}/${lane.name}: a bypass is missing or unintended`);
    }
  }
});

test('Redline retains the north sightline while the south edge is not a straight perimeter shortcut', () => {
  const world = getMap('redline'), eye = (x, z) => ({ x, z, y: RULES.eyeHeight });
  assert.ok(hasLineOfSight(eye(-55, -19), eye(55, -19), world));
  assert.equal(hasLineOfSight(eye(-57, 18), eye(58, 18), world), false);
});
