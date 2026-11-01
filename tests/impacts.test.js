import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, aimDirection, wallDistance, impactSurface, BULLET_MARK_RULES } from '../shared/world.js';
import { Room, traceShot } from '../shared/simulation.js';

const world = (obstacles = []) => ({ ...WORLD, width: 100, depth: 100, obstacles });
test('world impacts identify outward normals on all six box faces without changing wall distance', () => {
  const arena = world([{ id: 'box', x: 0, y: 1, z: 0, w: 2, d: 2, h: 2 }]);
  for (const [origin, direction, normal] of [
    [[4, 2, 0], [-1, 0, 0], [1, 0, 0]], [[-4, 2, 0], [1, 0, 0], [-1, 0, 0]],
    [[0, 6, 0], [0, -1, 0], [0, 1, 0]], [[0, -2, 0], [0, 1, 0], [0, -1, 0]],
    [[0, 2, 4], [0, 0, -1], [0, 0, 1]], [[0, 2, -4], [0, 0, 1], [0, 0, -1]],
  ]) {
    const point = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, origin[i]])), ray = Object.fromEntries(['x', 'y', 'z'].map((axis, i) => [axis, direction[i]])), details = {};
    const distance = wallDistance(point, ray, 20, arena, details); assert.equal(distance, 3); assert.equal(wallDistance(point, ray, 20, arena), distance);
    assert.deepEqual(Object.values(impactSurface(point, ray, distance, details.box, arena).normal), normal);
  }
});

test('sky misses do not make scars; floor VFX stop on the ground without changing combat range', () => {
  const shooter = { id: 'self', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, weaponId: 'rifle' };
  assert.equal(traceShot(shooter, [shooter], 1000, world(), aimDirection(0, .5), 110).surface, null);
  const floor = traceShot(shooter, [shooter], 1000, world(), aimDirection(0, -.5), 110); assert.equal(floor.surface.id, 'ground'); assert.equal(floor.end.y, 0); assert.equal(floor.distance, 110);
});

test('body hits and spawn-protected contacts cannot stamp bullet holes onto characters or walls behind them', () => {
  const shooter = { id: 'self', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, weaponId: 'rifle' }, target = { id: 'target', x: 0, y: 0, z: -2, hp: 100, protectedUntil: 0 };
  const arena = world([{ id: 'wall', x: 0, y: 0, z: -5, w: 10, d: .4, h: 4 }]);
  const hit = traceShot(shooter, [target], 1000, arena); assert.equal(hit.victim, target); assert.equal(hit.surface, null);
  target.protectedUntil = 2000; const protectedHit = traceShot(shooter, [target], 1000, arena); assert.equal(protectedHit.protectedTarget, target.id); assert.equal(protectedHit.surface, null);
});

test('authoritative shot events carry surface metadata and bounded late-join history expires after one minute', () => {
  let now = 10_000; const room = new Room('SCARS', { bots: 0, clock: () => now, random: () => .5 }); room.world = world([{ id: 'wall', x: 0, y: 0, z: -5, w: 10, d: .4, h: 4 }]);
  const player = room.addPlayer('viewer', 'VIEWER'); Object.assign(player, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectedUntil: 0 }); room.shoot(player, now, true);
  const ray = room.snapshot().events.find((event) => event.type === 'shot').rays[0]; assert.ok(ray.surface.id); assert.equal(ray.surface.surfaceId, 'wall'); assert.equal(ray.surface.at, now); assert.deepEqual(ray.surface.normal, { x: 0, y: 0, z: 1 });
  assert.equal(room.impactHistory().length, 1); assert.equal('impacts' in room.snapshot(), false, 'full history must not be broadcast at 20Hz');
  now += 200; player.shotHeat = 0; room.shoot(player, now, true); assert.equal(room.impacts.size, 1, 'same-cell impacts coalesce and refresh instead of creating unbounded black layers');
  now += 59_000; room.tick(1 / 60); assert.equal(room.impactHistory().length, 1); now += 1100; room.tick(1 / 60); assert.equal(room.impactHistory().length, 0);
  now += 100; player.shotHeat = 0; Object.assign(player, { yaw: 0, pitch: 0 }); room.shoot(player, now, true); room.restart(player.id); assert.equal(room.impactHistory().length, 0);
  assert.equal(BULLET_MARK_RULES.lifetimeMs, 60_000);
});
