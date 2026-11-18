import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, shotSpread, shotAngles } from '../shared/catalog.js';
import { Room } from '../shared/simulation.js';

test('crouch blends every firearm spread down by 30%, for hipfire, ADS, moving and sustained fire', () => {
  for (const weapon of WEAPONS) for (const ads of [false, true]) for (const moveSpeed of [0, 2.5]) for (const shotHeat of [0, 1]) {
    const state = { grounded: true, moveSpeed, shotHeat, crouchAmount: 0 }, standing = shotSpread(weapon, ads, state);
    const half = shotSpread(weapon, ads, { ...state, crouchAmount: 0.5 }), crouched = shotSpread(weapon, ads, { ...state, crouchAmount: 1 });
    assert.ok(Math.abs(half - standing * 0.85) < 1e-9); assert.ok(Math.abs(crouched - standing * 0.7) < 1e-9);
    const baseRays = shotAngles(weapon, ads, () => 0.5, state), rays = shotAngles(weapon, ads, () => 0.5, { ...state, crouchAmount: 1 });
    rays.forEach((ray, i) => { assert.ok(Math.abs(ray.yaw - baseRays[i].yaw * 0.7) < 1e-9); assert.ok(Math.abs(ray.pitch - baseRays[i].pitch * 0.7) < 1e-9); });
  }
});
test('airborne crouch flags cannot reduce spread, and clients cannot forge authoritative crouchAmount', () => {
  const weapon = WEAPONS[0], state = { grounded: false, moveSpeed: 7, shotHeat: 1 };
  assert.equal(shotSpread(weapon, false, { ...state, crouching: true, crouchAmount: 1 }), shotSpread(weapon, false, state));
  const room = new Room('AIM', { bots: 0 }), player = room.addPlayer('self', 'SELF');
  room.setInput(player.id, { crouchAmount: 1, crouching: true, spawnCount: player.spawnCount, equipmentSeq: player.equipmentSeq });
  room.tick(1 / 60); assert.equal(player.crouchAmount, 0);
});
