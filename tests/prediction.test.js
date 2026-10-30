import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMovement } from '../public/prediction.js';
import { movePlayer, EMPTY_INPUT } from '../shared/movement.js';

const deck = { x: 0, z: 0, w: 4, d: 4, h: 1.8 };
const world = { width: 20, depth: 20, obstacles: [deck] };
const player = (extra = {}) => ({ x: 0, y: 1.8, z: 0, vy: 0, grounded: true, ...extra });

test('an elevated authoritative landing restores grounded state without sinking into the deck', () => {
  const predicted = player({ y: 1.86, vy: -1, grounded: false });
  reconcileMovement(predicted, player(), world);
  assert.equal(predicted.y, 1.8); assert.equal(predicted.vy, 0); assert.equal(predicted.grounded, true);
});

test('delayed ground snapshots cannot shorten or cancel a locally predicted jump', () => {
  const predicted = player({ y: 2.35, vy: 7, grounded: false });
  reconcileMovement(predicted, player(), world);
  assert.equal(predicted.y, 2.35); assert.equal(predicted.vy, 7); assert.equal(predicted.grounded, false);
});

test('stale lower-stair snapshots do not interpolate the player into a higher stair', () => {
  const stairs = { ...world, obstacles: [{ x: 0, z: -0.5, w: 3, d: 1, h: 0.45 }, { x: 0, z: 0.5, w: 3, d: 1, h: 0.9 }] };
  const predicted = player({ y: 0.9, z: 0.12 });
  reconcileMovement(predicted, player({ y: 0.45, z: -0.45 }), stairs);
  assert.equal(predicted.y, 0.9); assert.equal(predicted.grounded, true);
  movePlayer(predicted, { ...EMPTY_INPUT, forward: 1, yaw: Math.PI }, 1 / 60, stairs);
  assert.ok(predicted.z > -0.09, 'movement keeps making progress after reconciliation');
});

test('horizontal snapshot corrections cannot insert an airborne player into a solid side', () => {
  const predicted = player({ x: 2.4, y: 1, grounded: false, vy: 4 });
  reconcileMovement(predicted, player({ x: 2.1 }), world);
  assert.equal(predicted.x, 2.4); assert.equal(predicted.y, 1);
});

test('major authoritative corrections restore all movement state, including airborne state', () => {
  const predicted = player(), local = player({ x: 8, y: 0.8, vx: 2, vz: -4, vy: -2, grounded: false });
  reconcileMovement(predicted, local, world);
  assert.deepEqual(predicted, local);
});

test('flight reconciliation restores authoritative momentum but stale ground snapshots cannot steer a jump', () => {
  const predicted = player({ y: 2.5, grounded: false, vy: 4, vx: 0, vz: -5 });
  reconcileMovement(predicted, player({ vx: 3, vz: 0 }), world); assert.equal(predicted.vx, 0); assert.equal(predicted.vz, -5);
  reconcileMovement(predicted, player({ y: 2.5, grounded: false, vy: 3, vx: 1, vz: -4 }), world); assert.equal(predicted.vx, 1); assert.equal(predicted.vz, -4);
});
