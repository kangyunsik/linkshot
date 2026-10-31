import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, traceShot, playerBodyVolumes, limbDamageMultiplier } from '../shared/simulation.js';
import { RULES, playerPose, aimDirection, rayCapsule } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer, movementSpeed } from '../shared/movement.js';
import { getWeapon, damageAtDistance } from '../shared/catalog.js';
import { reconcileMovement } from '../public/prediction.js';

const empty = { width: 250, depth: 250, obstacles: [] };
const target = (extra = {}) => ({ id: 'target', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouchAmount: 0, hp: 1000, protectedUntil: 0, weaponId: 'rifle', ...extra });
function worldPoint(player, p) { const c = Math.cos(player.yaw), s = Math.sin(player.yaw); return { x: player.x + p.x * c + p.z * s, y: player.y + p.y, z: player.z - p.x * s + p.z * c }; }
function aimAt(player, point, front = true, distance = 5) {
  const from = worldPoint(player, { x: point.x, y: 0, z: front ? -distance : distance }), to = worldPoint(player, point);
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z)), pitch = Math.atan2(to.y - from.y - RULES.eyeHeight, Math.hypot(to.x - from.x, to.z - from.z));
  return { id: 'shooter', weaponId: 'rifle', ...from, yaw, pitch };
}

test('finite limb capsules handle parallel, tangent, inside and distance-limited rays', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 1, z: 0 };
  assert.ok(Math.abs(rayCapsule({ x: 0, y: .5, z: 5 }, { x: 0, y: 0, z: -1 }, a, b, .1) - 4.9) < 1e-9);
  assert.ok(Math.abs(rayCapsule({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, a, b, .1) - .9) < 1e-9);
  assert.equal(rayCapsule({ x: 0, y: .5, z: 0 }, { x: 0, y: 1, z: 0 }, a, b, .1), 0);
  assert.equal(rayCapsule({ x: 1, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, a, b, .1), null);
  assert.equal(rayCapsule({ x: 0, y: .5, z: 5 }, { x: 0, y: 0, z: -1 }, a, b, .1, 4), null);
});

test('arm damage changes continuously from 1.2x at the shoulder to 0.5x at the fingertips', () => {
  let previous = Infinity;
  for (let i = 0; i <= 100; i++) { const value = limbDamageMultiplier(i / 100); assert.ok(value <= previous && value >= .5 && value <= 1.2); previous = value; }
  assert.equal(limbDamageMultiplier(0), 1.2); assert.equal(limbDamageMultiplier(1), .5); assert.equal(limbDamageMultiplier(-1), 1.2); assert.equal(limbDamageMultiplier(2), .5);
  const p = target(), forearm = playerBodyVolumes(p).filter((part) => part.part === 'leftArm').at(-1), values = [];
  for (const t of [0, .25, .5, .75, 1]) {
    const point = { x: forearm.a.x + (forearm.b.x - forearm.a.x) * t, y: forearm.a.y + (forearm.b.y - forearm.a.y) * t, z: forearm.a.z + (forearm.b.z - forearm.a.z) * t };
    const hit = traceShot(aimAt(p, point), [p], 1000, empty); assert.equal(hit.victim, p); values.push(hit.damageMultiplier);
  }
  assert.ok(values.every((value, i) => !i || value <= values[i - 1])); assert.equal(values.at(-1), .5);
});

test('torso, hand and head regions follow yaw and crouch without gender/cosmetic damage bonuses', () => {
  for (const crouchAmount of [0, .5, 1]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const p = target({ crouchAmount, yaw, y: 3 });
    const core = traceShot(aimAt(p, { x: 0, y: playerPose(p).aimHeight, z: 0 }, false), [p], 1000, empty);
    assert.equal(core.bodyPart, 'torso'); assert.equal(core.damageMultiplier, 1.2);
    const hand = playerBodyVolumes(p).find((volume) => volume.part === 'leftHand');
    const edge = traceShot(aimAt(p, hand.b), [p], 1000, empty); assert.equal(edge.bodyPart, 'leftHand'); assert.ok(Math.abs(edge.damageMultiplier - .5) < 1e-9);
    const head = traceShot(aimAt(p, { x: 0, y: playerPose(p).headHeight, z: 0 }), [p], 1000, empty); assert.equal(head.headshot, true); assert.equal(head.damageMultiplier, 1);
    const female = { ...p, characterId: 'female', outfitId: 'orbital' }; assert.deepEqual(playerBodyVolumes(female), playerBodyVolumes(p));
  }
});

test('server combines location multipliers with distance falloff for each shotgun pellet', () => {
  const room = new Room('REGION', { bots: 0, clock: () => 1000, random: () => 0 }); room.world = { ...room.world, ...empty };
  const shooter = room.addPlayer('shooter', 'SHOOTER'), victim = room.addPlayer('target', 'TARGET'); Object.assign(victim, target({ id: 'target', hp: 10000 }));
  for (const [point, front, expected] of [[{ x: 0, y: 1, z: 0 }, false, 1.2], [playerBodyVolumes(victim).find((v) => v.part === 'leftHand').b, true, .5], [{ x: 0, y: 1.58, z: 0 }, true, 1]]) {
    Object.assign(shooter, aimAt(victim, point, front), { weaponId: 'rifle', ammo: 30, shotHeat: 0 }); room.events.length = 0; room.shoot(shooter, 1000, true);
    const ray = room.events.find((event) => event.type === 'shot').rays[0]; assert.ok(Math.abs(ray.damageMultiplier - expected) < 1e-9);
    assert.equal(room.events.find((event) => event.type === 'damage').damage, Math.round((ray.headshot ? 48 : 28) * expected));
  }
  Object.assign(shooter, aimAt(victim, { x: 0, y: 1, z: 0 }, false, 70), { weaponId: 'rifle', ammo: 30, shotHeat: 0 }); room.events.length = 0; room.shoot(shooter, 1000, true);
  let shot = room.events.find((event) => event.type === 'shot'); const distance = Math.hypot(shot.rays[0].end.x - shot.origin.x, shot.rays[0].end.y - shot.origin.y, shot.rays[0].end.z - shot.origin.z);
  assert.equal(room.events.find((event) => event.type === 'damage').damage, Math.round(damageAtDistance(getWeapon('rifle'), distance) * 1.2));
  Object.assign(shooter, aimAt(victim, playerBodyVolumes(victim).find((v) => v.part === 'leftHand').b, true, 4), { weaponId: 'shotgun', ammo: 8, shotHeat: 0 }); room.events.length = 0; room.shoot(shooter, 1000, true);
  shot = room.events.find((event) => event.type === 'shot'); const total = shot.rays.reduce((sum, ray) => sum + (ray.hit ? damageAtDistance(getWeapon('shotgun'), Math.hypot(ray.end.x - shot.origin.x, ray.end.y - shot.origin.y, ray.end.z - shot.origin.z), ray.headshot) * ray.damageMultiplier : 0), 0);
  assert.equal(room.events.find((event) => event.type === 'damage').damage, Math.round(total)); assert.ok(shot.rays.some((ray) => ray.damageMultiplier === .5) && shot.rays.some((ray) => ray.damageMultiplier === 1.2));
});

test('arm hits stay behind solid cover and cannot bypass current spawn protection', () => {
  const p = target(), hand = playerBodyVolumes(p).find((part) => part.part === 'leftHand'), shooter = aimAt(p, hand.b);
  const covered = { ...empty, obstacles: [{ x: 0, y: 0, z: -1, w: 2, d: .2, h: 3 }] };
  assert.equal(traceShot(shooter, [p], 1000, covered).victim, null);
  p.protectedUntil = 2000; const protectedHit = traceShot(shooter, [p], 1000, empty); assert.equal(protectedHit.victim, null); assert.equal(protectedHit.protectedTarget, p.id); assert.equal(protectedHit.damageMultiplier, 0);
});

test('lag compensation rewinds arm orientation and weapon pose as well as position', () => {
  const room = new Room('ARMHIS', { bots: 0, clock: () => 1000, random: () => 0 }); room.world = { ...room.world, ...empty };
  const shooter = room.addPlayer('shooter', 'SHOOTER'), p = room.addPlayer('target', 'TARGET'); Object.assign(p, target({ hp: 10000 }));
  const aim = aimAt(p, playerBodyVolumes(p).find((part) => part.part === 'leftHand').b); Object.assign(shooter, aim);
  p.history = []; room.recordPlayerHistory(p, 900); p.yaw = Math.PI; p.pitch = .4; room.recordPlayerHistory(p, 1000);
  room.events.length = 0; room.shoot(shooter, 1000, true, { viewTime: 900 }); assert.equal(room.events.find((e) => e.type === 'shot').rays[0].bodyPart, 'leftHand');
  assert.equal(p.yaw, Math.PI); assert.equal(p.pitch, .4);
});

test('a damaging hit slows movement for one second, refreshes rather than stacks, and resets on respawn', () => {
  let now = 1000; const room = new Room('SLOW1', { bots: 0, clock: () => now, random: () => 0 }); room.world = { ...room.world, ...empty };
  const shooter = room.addPlayer('shooter', 'SHOOTER'), p = room.addPlayer('target', 'TARGET'); Object.assign(p, target({ hp: 10000 })); Object.assign(shooter, aimAt(p, { x: 0, y: 1, z: 0 }, false));
  room.shoot(shooter, now, true); assert.equal(p.hitSlowUntil, 2000); assert.equal(movementSpeed(p, { ...EMPTY_INPUT, forward: 1 }, 1000), RULES.walkSpeed * .7);
  now = 1500; shooter.ammo = 30; room.shoot(shooter, now, true); assert.equal(p.hitSlowUntil, 2500);
  room.setInput(p.id, { ...EMPTY_INPUT, forward: 1, hitSlowUntil: 0 }); assert.equal(p.hitSlowUntil, 2500);
  const before = p.z; room.tick(1 / 60); assert.ok(Math.abs(before - p.z - RULES.walkSpeed * .7 / 60) < 1e-9);
  assert.equal(movementSpeed(p, EMPTY_INPUT, 2499), RULES.walkSpeed * .7); assert.equal(movementSpeed(p, EMPTY_INPUT, 2500), RULES.walkSpeed);
  assert.equal(room.snapshot().players.find((entry) => entry.id === p.id).hitSlowUntil, 2500); room.spawn(p); assert.equal(p.hitSlowUntil, 0);
});

test('airborne hit slow preserves takeoff direction/base velocity and does not slow gravity or aiming', () => {
  const p = { ...target(), grounded: true, vy: 0 }; movePlayer(p, { ...EMPTY_INPUT, forward: 1, jump: true }, 1 / 60, empty, 1000);
  const normal = { ...p }; p.hitSlowUntil = 2000;
  const before = { x: p.x, z: p.z }, input = { ...EMPTY_INPUT, yaw: 1.1, pitch: .5, strafe: 1, sprint: true };
  movePlayer(p, input, 1 / 60, empty, 1100); movePlayer(normal, input, 1 / 60, empty, 1100);
  assert.equal(p.vx, normal.vx); assert.equal(p.vz, normal.vz); assert.equal(p.y, normal.y); assert.equal(p.vy, normal.vy); assert.equal(p.yaw, 1.1); assert.equal(p.pitch, .5);
  assert.ok(Math.abs(p.z - before.z - (normal.z - before.z) * .7) < 1e-9);
  const predicted = { ...p, hitSlowUntil: 0 }; reconcileMovement(predicted, p, empty); assert.equal(predicted.hitSlowUntil, 2000);
});
