import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer, sanitizeInput } from '../shared/movement.js';
import { Room } from '../shared/simulation.js';
import { FootstepTracker, footstepMix } from '../public/footsteps.js';

test('normal running retains the former default speed; Shift is half-speed in every ground direction with no legacy boost', () => {
  for (const hz of [30, 60, 144]) for (const input of [{ forward: 1 }, { forward: -1 }, { strafe: 1 }, { forward: 1, strafe: 1 }]) for (const walk of [false, true]) {
    const p = { x: 0, y: 0, z: 0, vy: 0, grounded: true, weaponId: 'rifle' }, world = { width: 100, depth: 100, obstacles: [] };
    for (let i = 0; i < hz; i++) movePlayer(p, { ...EMPTY_INPUT, ...input, walk, sprint: true }, 1 / hz, world);
    assert.ok(Math.abs(Math.hypot(p.x, p.z) - (walk ? RULES.walkSpeed : RULES.runSpeed)) < 1e-8); assert.equal(p.walking, walk); assert.equal(p.sprinting, false);
  }
  assert.equal(RULES.runSpeed, 5.7); assert.equal(RULES.walkSpeed, 2.85);
  assert.equal(sanitizeInput({ walk: 'true', sprint: true }).walk, false); assert.equal(sanitizeInput({ walk: true, sprint: true }).sprint, false);
});

test('20Hz canonical snapshots keep silent walking inaudible and cannot replay quiet travel as footsteps on release', () => {
  let now = 1000; const room = new Room('QUIET', { bots: 0, clock: () => now }); room.world = { ...room.world, width: 100, depth: 100, obstacles: [] };
  const p = room.addPlayer('walker', 'WALKER'); Object.assign(p, { x: 0, y: 0, z: 20 }); const tracker = new FootstepTracker(); tracker.update(room.snapshot().players[0], now);
  let steps = 0;
  for (let i = 0; i < 180; i++) { now += 1000 / 60; room.setInput(p.id, { forward: 1, walk: true, yaw: 0 }); room.tick(1 / 60); if (i % 3 === 2) { const state = room.snapshot().players[0]; assert.equal(state.walking, true); assert.equal(state.stepDistance, 0); assert.equal(tracker.update(state, now), null); assert.equal(footstepMix({ x: 0, y: 0, z: 0 }, state).volume, 0); } }
  assert.ok(Math.abs(20 - p.z - RULES.walkSpeed * 3) < 1e-8);
  for (let i = 0; i < 30; i++) { now += 1000 / 60; room.setInput(p.id, { forward: 1 }); room.tick(1 / 60); if (i % 3 === 2 && tracker.update(room.snapshot().players[0], now)) steps++; if (i < 12) assert.equal(steps, 0); }
  assert.equal(steps, 1); room.spawn(p); assert.equal(p.walking, false);
});
