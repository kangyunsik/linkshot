import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePredictedMovement } from '../public/prediction.js';
import { SnapshotOrder } from '../public/snapshot-order.js';
import { LookInput } from '../public/look-input.js';
import { movePlayer, EMPTY_INPUT, advanceTime } from '../shared/movement.js';
import { Room } from '../shared/simulation.js';

const world = { width: 1000, depth: 1000, obstacles: [] };
const player = () => ({ x: 0, y: 0, z: 0, vy: 0, grounded: true, weaponId: 'rifle' });
test('12–144Hz prediction consumes elapsed movement time instead of losing half the motion at 15 FPS', () => {
  for (const hz of [12,15,20,30,60,144]) {
    const predicted = player(), server = player(), input = { ...EMPTY_INPUT, forward: 1, yaw: .45, sprint: true };
    for (let i = 0; i < hz * 3; i++) advancePredictedMovement(predicted, input, 1 / hz, world, 1000 + i * 1000 / hz);
    for (let i = 0; i < 180; i++) movePlayer(server, input, 1 / 60, world, 1000 + i * 1000 / 60);
    assert.ok(Math.hypot(predicted.x - server.x, predicted.z - server.z) < 1e-7, `${hz} Hz`);
  }
});
test('prediction bounds long stalls and preserves a single jump edge during catch-up', () => {
  const p = player(), input = { ...EMPTY_INPUT, forward: 1, jump: true };
  advancePredictedMovement(p, input, 40, world, 41_000); assert.ok(Math.abs(p.z) < 1.5); assert.ok(p.y > 1); assert.equal(p.jumpHeld, true);
  const before = p.z; advancePredictedMovement(p, input, NaN, world); assert.equal(p.z, before);
});
test('authoritative timer catch-up and client prediction agree when the server also stalls at 15Hz', () => {
  const server = player(), predicted = player(), input = { ...EMPTY_INPUT, forward: 1, yaw: .7 }; let ticks = 0;
  for (let i = 0; i < 45; i++) { advanceTime(1 / 15, (dt) => { ticks++; movePlayer(server,input,dt,world); }); advancePredictedMovement(predicted,input,1 / 15,world); }
  assert.equal(ticks,180); assert.ok(Math.hypot(predicted.x - server.x,predicted.z - server.z) < 1e-8);
  let caught = 0; const duration = advanceTime(60, (dt) => { caught += dt; }); assert.equal(duration,.25); assert.ok(Math.abs(caught - .25) < 1e-9);
});
test('duplicate, out-of-order and cross-room snapshots cannot roll a life or round backward, even if wall time moves backward', () => {
  const order = new SnapshotOrder(), packet = (sequence, time = 1000, code = 'ROOM1') => ({ sequence, serverTime: time, room: { code } });
  assert.equal(order.accept(packet(4)), true); assert.equal(order.accept(packet(4)), false); assert.equal(order.accept(packet(3)), false); assert.equal(order.accept(packet(5, 900)), true); assert.equal(order.accept(packet(6, 1100, 'OTHER')), false); assert.equal(order.accept(packet(6)), true);
  order.reset(); assert.equal(order.accept(packet(1, 1200, 'OTHER')), true); assert.equal(order.accept(packet(Infinity, 1300, 'OTHER')), false);
});
test('room snapshot sequences are strictly increasing across unflushed frames, respawns and restarts', () => {
  const room = new Room('ORDER', { bots: 0 }), p = room.addPlayer('host', 'HOST'), first = room.snapshot(false), second = room.snapshot(false); room.spawn(p); const third = room.snapshot(); room.restart(p.id); const fourth = room.snapshot();
  assert.deepEqual([first.sequence,second.sequence,third.sequence,fourth.sequence], [1,2,3,4]); assert.notEqual(first.room.roundId, fourth.room.roundId);
});
test('pointer-lock/resize cursor warps cannot flip the view, but normal aiming and intentional fast turns remain unmodified', () => {
  const look = new LookInput(); look.transition(1000);
  assert.equal(look.delta({ movementX: 960, movementY: 0 }, 1920,1080,1020), null);
  assert.deepEqual(look.delta({ movementX: 24, movementY: -12 },1920,1080,1025), { x: 24,y: -12 });
  assert.deepEqual(look.delta({ movementX: 1571, movementY: 0 },1920,1080,1200), { x: 1571,y: 0 });
  assert.equal(look.delta({ movementX: NaN, movementY: 0 },1920,1080,1201), null);
});
