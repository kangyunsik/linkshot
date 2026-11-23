import assert from 'node:assert/strict';
import test from 'node:test';
import { deathLookSource, planDeathLook, sampleDeathLook } from '../public/death-look.js';

test('death look favors the confirmed killer attack origin over later snapshot positions', () => {
  const victim = { id: 'viewer', lastDeath: { attackerId: 'killer' } }, origin = { x: -7, y: 2, z: 9 };
  const players = [{ id: 'killer', x: 5, y: 1, z: 6 }];
  assert.deepEqual(deathLookSource(victim, [
    { type: 'damage', id: 'viewer', attacker: 'killer', damage: 60, origin },
    { type: 'damage', id: 'viewer', attacker: 'other', damage: 1, origin: { x: 10, y: 2, z: -7 } },
  ], players), origin);
  assert.deepEqual(deathLookSource(victim, [], players), { x: 5, y: 2.62, z: 6 });
  assert.equal(deathLookSource({ id: 'viewer' }, [], players), null);
});

test('death look eases through the shortest angle and does not track after its initial turn', () => {
  const yaw = Math.PI - .1, targetYaw = -Math.PI + .1, start = 500;
  const plan = planDeathLook({ x: 0, y: 0, z: 0 }, yaw, 0, { x: -Math.sin(targetYaw) * 8, y: 2, z: -Math.cos(targetYaw) * 8 }, start);
  assert.ok(Math.abs(plan.turn - .2) < 1e-8);
  assert.deepEqual(sampleDeathLook(plan, start), { yaw, pitch: 0 });
  assert.ok(Math.abs(sampleDeathLook(plan, start + plan.duration / 2).yaw - Math.PI) < 1e-8);
  assert.deepEqual(sampleDeathLook(plan, start + plan.duration), sampleDeathLook(plan, start + 3000));
  assert.equal(planDeathLook({ x: 1, y: 0, z: 1 }, 0, 0, { x: 1, y: 0, z: 1 }, start), null);
});
