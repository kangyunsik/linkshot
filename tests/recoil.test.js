import test from 'node:test';
import assert from 'node:assert/strict';
import { AimRecoil } from '../public/aim-recoil.js';
import { WEAPONS } from '../shared/catalog.js';

test('every weapon kicks upward then returns exactly to its original aim', () => {
  for (const weapon of WEAPONS) {
    const aim = new AimRecoil(); aim.reset(0.3);
    aim.kick(weapon.recoil * (weapon.type === 'ASSAULT' ? 0.008 : 0.0045), 1000);
    assert.ok(aim.pitch > 0.3, weapon.id);
    aim.update(1120); assert.ok(aim.pitch > 0.3, 'kick remains visible before recovery');
    aim.update(3000); assert.equal(aim.pitch, 0.3, weapon.id); assert.equal(aim.offset, 0);
  }
});

test('manual aiming during recoil becomes the return target, not the old shot direction', () => {
  const aim = new AimRecoil(); aim.reset(0.2); aim.kick(0.05, 0);
  aim.move(-0.07); assert.ok(aim.pitch > 0.13);
  aim.update(2000); assert.ok(Math.abs(aim.pitch - 0.13) < 1e-12);
  aim.move(0.11); aim.kick(0.03, 2200); aim.update(4200);
  assert.ok(Math.abs(aim.pitch - 0.24) < 1e-12);
});

test('sustained fire accumulates bounded recoil and release recovers without overshoot', () => {
  const aim = new AimRecoil(); aim.reset(-0.1);
  for (let shot = 0; shot < 200; shot++) aim.kick(0.0136, shot * 100);
  assert.equal(aim.offset, 1.48); assert.ok(aim.pitch > -0.1);
  let previous = aim.pitch;
  for (let now = 20000; now <= 22000; now += 10) { aim.update(now); assert.ok(aim.pitch <= previous && aim.pitch >= -0.1); previous = aim.pitch; }
  assert.equal(aim.pitch, -0.1);
});

test('recovery uses elapsed time consistently at 30–144Hz and after a stalled frame', () => {
  const values = [];
  for (const hz of [30, 60, 120, 144]) {
    const aim = new AimRecoil(); aim.kick(0.045, 0);
    for (let frame = 1; frame * 1000 / hz < 720; frame++) aim.update(frame * 1000 / hz);
    aim.update(720); values.push(aim.pitch);
  }
  const stalled = new AimRecoil(); stalled.kick(0.045, 0); stalled.update(720); values.push(stalled.pitch);
  assert.ok(Math.max(...values) - Math.min(...values) < 1e-12);
  assert.ok(Math.abs(values[0] - 0.045 * Math.exp(-5.7)) < 1e-12);
});

test('view limits and life/weapon resets cannot leave a hidden residual kick', () => {
  const aim = new AimRecoil(); aim.reset(1.47); aim.kick(0.1, 0); assert.equal(aim.pitch, 1.48);
  aim.move(0.1); aim.update(2000); assert.equal(aim.pitch, 1.48); assert.equal(aim.offset, 0);
  aim.reset(-1.45); aim.kick(0.4, 2100); aim.update(5000); assert.equal(aim.pitch, -1.45);
  aim.kick(0.05, 5100); aim.reset(0); aim.update(9000); assert.equal(aim.pitch, 0);
});
