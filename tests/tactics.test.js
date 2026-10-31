import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, WORLD, RULES, playerPose, damageBearing } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer, sanitizeInput, movementSpeed, canStand } from '../shared/movement.js';
import { Room, traceShot } from '../shared/simulation.js';
import { WEAPONS } from '../shared/catalog.js';

const player = (extra = {}) => ({ id: 'p', x: 24, y: 0, z: 18, yaw: 0, pitch: 0, vy: 0, grounded: true, hp: 100, protectedUntil: 0, weaponId: 'rifle', ...extra });
const input = (extra = {}) => ({ ...EMPTY_INPUT, ...extra });

test('crouch lowers the eye/hitbox, slows movement, blocks sprint and releases normally', () => {
  const p = player();
  for (let i = 0; i < 60; i++) movePlayer(p, input({ forward: 1, crouch: true }), 1 / 60);
  assert.equal(p.crouching, true); assert.ok(18 - p.z >= RULES.crouchSpeed && 18 - p.z < RULES.crouchSpeed + (RULES.walkSpeed - RULES.crouchSpeed) * RULES.crouchSeconds);
  assert.equal(playerPose(p).height, RULES.crouchHeight); assert.equal(playerPose(p).eyeHeight, RULES.crouchEyeHeight);
  for (let i = 0; i < 6; i++) movePlayer(p, input(), 1 / 60); assert.equal(p.crouching, false); assert.equal(playerPose(p).eyeHeight, RULES.eyeHeight);
  const sanitized = sanitizeInput({ crouch: 'true', crouching: true, height: 0.01 });
  assert.equal(sanitized.crouch, false); assert.equal(sanitized.crouching, undefined); assert.equal(sanitized.height, undefined);
});

test('crouched players can pass under a low ceiling but cannot stand or jump through it', () => {
  const world = { width: 20, depth: 20, obstacles: [{ x: 0, y: 1.25, z: 0, w: 4, d: 4, h: 0.3 }] };
  const p = player({ x: 0, z: 0, crouching: true });
  assert.equal(canStand(p, world), false); movePlayer(p, input(), 1 / 60, world); assert.equal(p.crouching, true);
  let highest = 0;
  for (let i = 0; i < 60; i++) { movePlayer(p, input({ crouch: true, jump: true }), 1 / 60, world); highest = Math.max(highest, p.y + playerPose(p).height); }
  assert.ok(highest <= 1.251);
  for (let i = 0; i < 80; i++) movePlayer(p, input({ forward: 1 }), 1 / 60, world);
  assert.ok(p.z < -2.34); assert.equal(p.crouching, false);
});

test('crouch never permits walking through a solid low barrier', () => {
  const world = { width: 20, depth: 20, obstacles: [{ x: 0, y: 0, z: 0, w: 2, d: 2, h: 1.15 }] };
  const p = player({ x: 0, z: 3 });
  for (let i = 0; i < 180; i++) movePlayer(p, input({ forward: 1, crouch: true }), 1 / 60, world);
  assert.ok(p.z >= 1 + RULES.playerRadius - 0.001);
});

test('crouched heads and bodies move down, and bullets start from the correct eye height', () => {
  const shooter = player({ id: 'a', z: 10 }), target = player({ id: 'b', z: 3, crouching: true });
  assert.equal(traceShot(shooter, [shooter, target], 1000).victim, null);
  shooter.pitch = Math.atan2(playerPose(target).headHeight - RULES.eyeHeight, 7);
  const head = traceShot(shooter, [shooter, target], 1000); assert.equal(head.victim, target); assert.equal(head.headshot, true);
  shooter.crouching = true; shooter.pitch = 0; target.crouching = false;
  const body = traceShot(shooter, [shooter, target], 1000); assert.equal(body.origin.y, RULES.crouchEyeHeight); assert.equal(body.victim, target); assert.equal(body.headshot, false);
});

test('low cover hides a crouching player while elevated sightlines can see over it', () => {
  const shooter = player({ id: 'a', x: 0, z: -20, yaw: Math.PI }), target = player({ id: 'b', x: 0, z: -14.4 });
  shooter.pitch = Math.atan2(playerPose(target).headHeight - RULES.eyeHeight, 5.6);
  assert.equal(traceShot(shooter, [shooter, target], 1000).victim, target);
  target.crouching = true; shooter.pitch = Math.atan2(playerPose(target).headHeight - RULES.eyeHeight, 5.6);
  assert.equal(traceShot(shooter, [shooter, target], 1000).victim, null);
  shooter.y = 1.8; shooter.pitch = Math.atan2(playerPose(target).headHeight - shooter.y - RULES.eyeHeight, 5.6);
  assert.equal(traceShot(shooter, [shooter, target], 1000).victim, target);
});

test('seven weapons have distinct weight, sprint and ADS movement penalties', () => {
  const walk = Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, movementSpeed(player({ weaponId: weapon.id }), input({ forward: 1 }))]));
  assert.ok(walk.pistol > walk.smg && walk.smg > walk.rifle && walk.rifle > walk.dmr && walk.dmr > walk.sniper && walk.sniper > walk.lmg);
  for (const weapon of WEAPONS) {
    const p = player({ weaponId: weapon.id });
    assert.ok(movementSpeed(p, input({ forward: 1, sprint: true })) > walk[weapon.id]);
    assert.ok(movementSpeed(p, input({ forward: 1, ads: true, sprint: true })) < walk[weapon.id]);
    p.crouching = true;
    assert.equal(movementSpeed(p, input({ forward: 1, sprint: true })), RULES.crouchSpeed * weapon.walkMultiplier);
  }
  assert.equal(movementSpeed(player({ weaponId: 'lmg' }), input({ weaponId: 'pistol', forward: 1 })), walk.lmg);
});

test('each arena has its own walkable firing platforms and twelve extra solid cover objects', () => {
  for (const world of MAPS) {
    assert.equal(world.platforms.length, world.id === 'nightmarket' ? 3 : 4, world.id); assert.equal(world.extraCover.length, 12, world.id);
    for (const platform of world.platforms) {
      const p = player({ x: platform.approach.x, z: platform.approach.z, yaw: Math.PI }); let top = 0;
      for (let i = 0; i < 90; i++) { movePlayer(p, input({ forward: 1, yaw: Math.PI }), 1 / 60, world); top = Math.max(top, p.y); }
      assert.ok(Math.abs(top - platform.height) < 0.001, `${world.id}/${platform.id}`);
      Object.assign(p, { x: platform.x, z: platform.z + 1.5, y: platform.height, vy: 0, grounded: true });
      for (let i = 0; i < 60; i++) movePlayer(p, input({ strafe: 1 }), 1 / 60, world);
      assert.ok(p.y < platform.height, `${world.id}: platform has no invisible floor beyond its edge`);
    }
  }
});

test('incoming shot bearings follow camera rotation and reject unknown/coincident origins', () => {
  const viewer = { x: 0, z: 0, yaw: 0 };
  assert.equal(damageBearing(viewer, { x: 0, z: -10 }), 0);
  assert.ok(Math.abs(damageBearing(viewer, { x: 10, z: 0 }) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(Math.abs(damageBearing(viewer, { x: 0, z: 10 })) - Math.PI) < 1e-9);
  assert.ok(Math.abs(damageBearing(viewer, { x: -10, z: 0 }) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(damageBearing(viewer, { x: 10, z: 0 }, -Math.PI / 2)) < 1e-9);
  assert.equal(damageBearing(viewer, { x: 0, z: 0 }), null); assert.equal(damageBearing(viewer, {}), null);
});

test('damage events retain the shot origin rather than tracking the attacker afterward', () => {
  const room = new Room('HIT22', { bots: 0, clock: () => 1000 });
  const shooter = room.addPlayer('a', 'ALPHA'), target = room.addPlayer('b', 'BRAVO');
  Object.assign(shooter, player({ id: 'a', x: 24, z: 8, crouching: true, crouchAmount: 1 }));
  Object.assign(target, player({ id: 'b', x: 24, z: 4 }));
  room.shoot(shooter, 1000, true);
  const hit = room.events.find((event) => event.type === 'damage'); assert.ok(hit);
  assert.deepEqual(hit.origin, { x: 24, y: RULES.crouchEyeHeight, z: 8 });
  shooter.x = 12; assert.equal(hit.origin.x, 24);
  assert.equal(room.snapshot().players.find((p) => p.id === 'a').crouching, true);
});
