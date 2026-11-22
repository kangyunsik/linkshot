import test from 'node:test';
import assert from 'node:assert/strict';
import { FALL_DURATION_MS, operatorFallFrame, planOperatorFall } from '../public/operator-fall.js';

const player = { x: 0, y: 0, z: 0, yaw: 0 };
const world = (obstacles = []) => ({ width: 20, depth: 20, obstacles });

test('operator fall always tips backward in open space and releases the hands before landing', () => {
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const plan = planOperatorFall(world(), { ...player, yaw }, { x: 1, z: -2 });
    const begin = operatorFallFrame(0, plan), reaction = operatorFallFrame(195, plan), middle = operatorFallFrame(450, plan);
    const end = operatorFallFrame(FALL_DURATION_MS, plan);
    assert.equal(begin.pitch, 0); assert.equal(begin.motion, 0); assert.equal(begin.blend, 0);
    assert.ok(reaction.loose > .95 && reaction.pitch < .25);
    assert.ok(middle.knee > .80 && middle.pitch > reaction.pitch && middle.footHold > .8);
    assert.ok(Math.abs(plan.turn) <= .20 && end.pitch > 1.5 && end.motion > 0);
    assert.equal(end.knee, 0); assert.equal(end.footHold, 0); assert.equal(end.settle, 1); assert.equal(end.done, true);
    assert.deepEqual(end, operatorFallFrame(FALL_DURATION_MS * 2, plan));
  }
});

test('a rear wall uses a side lane, an enclosed corner slumps, and a rooftop stays at its own elevation', () => {
  const slab = { x: 0, y: 0, z: 0, w: 4, h: 3, d: 4 };
  // A tall wall behind the player has no room for a full rear fall.
  const wall = { x: 0, z: .50, w: 6, d: .20, h: 3 };
  const open = planOperatorFall(world([wall]), player);
  assert.ok(Math.abs(open.turn) >= 1.08);
  const corner = [wall, { ...wall, x: .48, z: 0, w: .20, d: 4 }, { ...wall, x: -.48, z: 0, w: .20, d: 4 }];
  const shut = planOperatorFall(world(corner), player);
  assert.ok(shut.tilt < .75); assert.equal(shut.travel, 0);
  const roof = planOperatorFall(world([slab]), { ...player, y: 3 });
  assert.equal(roof.floor, 3); assert.ok(roof.tilt > 1.5);
});
