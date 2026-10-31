import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../shared/simulation.js';
import { WEAPONS, EQUIPMENT, getWeapon, isWeaponId, ownsWeapon } from '../shared/catalog.js';
import { EQUIPMENT_RULES, nearestDroppedWeapon } from '../shared/equipment.js';
import { createProfile, normalizeProfile, recordRound, purchaseWeapon } from '../shared/progression.js';

function fixture() {
  let now = 10_000;
  const room = new Room('DROPS', { bots: 0, clock: () => now });
  room.world = { ...room.world, width: 100, depth: 100, obstacles: [] };
  const player = room.addPlayer('a', 'A'), other = room.addPlayer('b', 'B', false, { weaponId: 'mp5', ownedWeapons: ['mp5'], skinId: 'circuit' });
  Object.assign(player, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectedUntil: 0 });
  Object.assign(other, { x: 0, y: 0, z: -1.2, yaw: Math.PI, pitch: 0, protectedUntil: 0 });
  let actionSeq = 0;
  const request = (p = player) => ({ roundId: room.roundId, spawnCount: p.spawnCount, equipmentSeq: p.equipmentSeq, actionSeq: ++actionSeq });
  const advance = (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 1000 / 60); room.tick(1 / 60); } };
  return { room, player, other, request, advance, now: () => now };
}

test('G drops exactly one gun with its ammunition, cancels reload/bursts and equips an unlimited fallback knife', () => {
  const f = fixture(), { room, player } = f; player.ammo = 7; player.reloadUntil = f.now() + 1000; player.burstLeft = 2;
  const request = f.request(); assert.equal(room.interactEquipment(player.id, request), true);
  assert.equal(player.weaponId, 'knife'); assert.equal(player.ammo, 0); assert.equal(player.reloadUntil, 0); assert.equal(player.burstLeft, 0);
  assert.equal(room.startReload(player), false); assert.equal(room.droppedWeapons.size, 1);
  const drop = [...room.droppedWeapons.values()][0]; assert.equal(drop.weaponId, 'rifle'); assert.equal(drop.ammo, 7);
  assert.equal(room.interactEquipment(player.id, request), false); assert.equal(room.droppedWeapons.size, 1);
  f.advance(400); assert.equal(drop.y, 0); assert.equal(drop.grounded, true);
  assert.equal(room.interactEquipment(player.id, f.request()), true); assert.equal(player.weaponId, 'rifle'); assert.equal(player.ammo, 7); assert.equal(room.droppedWeapons.size, 0);
});

test('nearby pickups atomically swap guns without granting permanent ownership or changing next-spawn equipment/cosmetics', () => {
  const f = fixture(), { room, player, other } = f; other.ammo = 12; room.dropWeapon(other); f.advance(400);
  assert.equal(room.interactEquipment(player.id, f.request()), true); assert.equal(player.weaponId, 'mp5'); assert.equal(player.ammo, 12);
  assert.equal(player.weaponSkinId, 'circuit'); assert.equal(player.skinId, 'standard'); assert.equal(player.nextWeaponId, 'rifle'); assert.equal(ownsWeapon(player, 'mp5'), false);
  assert.equal(room.droppedWeapons.size, 1); assert.equal([...room.droppedWeapons.values()][0].weaponId, 'rifle');
  player.hp = 0; assert.equal(room.selectLoadout(player.id, { weaponId: 'mp5' }), false); room.spawn(player);
  assert.equal(player.weaponId, 'rifle'); assert.equal(player.weaponSkinId, 'standard'); assert.equal(player.ammo, 30);
});

test('only the server selects a reachable nearby pickup; walls, floors, height and range block remote item spoofing', () => {
  const f = fixture(), { room, player, other } = f; const drop = room.dropWeapon(other); f.advance(400);
  assert.equal(nearestDroppedWeapon(player, room.droppedWeapons.values(), room.world, f.now()), drop);
  room.world.obstacles = [{ x: 0, y: 0, z: -.6, w: 3, h: 3, d: .2 }];
  assert.equal(nearestDroppedWeapon(player, room.droppedWeapons.values(), room.world, f.now()), null);
  room.world.obstacles = []; drop.y = 3; assert.equal(nearestDroppedWeapon(player, [drop], room.world, f.now()), null);
  drop.y = 0; drop.z = -20; assert.equal(nearestDroppedWeapon(player, [drop], room.world, f.now()), null);
  room.interactEquipment(player.id, { ...f.request(), itemId: drop.id, weaponId: 'm82' }); assert.equal(player.weaponId, 'knife');
});

test('duplicate, rapid, old-life, old-round and old-equipment actions or shots cannot duplicate items or fire a replacement gun', () => {
  const f = fixture(), { room, player } = f; const old = f.request(); room.interactEquipment(player.id, old);
  room.setInput(player.id, { ...old, fire: true, yaw: 1 }); assert.equal(player.input.fire, false);
  assert.equal(room.interactEquipment(player.id, f.request()), false);
  f.advance(400); const prior = f.request(); room.spawn(player); assert.equal(room.interactEquipment(player.id, prior), false);
  const previousRound = f.request(); room.restart(player.id); assert.equal(room.interactEquipment(player.id, previousRound), false);
  player.hp = 0; assert.equal(room.interactEquipment(player.id, f.request()), false); player.hp = 100; room.finish(); assert.equal(room.interactEquipment(player.id, f.request()), false);
});

test('death drops the actual carried gun once (not the saved loadout); knife deaths do not manufacture firearms', () => {
  const f = fixture(), { room, player, other } = f;
  other.weaponId = 'm82'; other.ammo = 3; other.hp = 1;
  room.shoot(player, f.now(), true); assert.equal(other.hp, 0); assert.equal(room.droppedWeapons.size, 1);
  const drop = [...room.droppedWeapons.values()][0]; assert.equal(drop.weaponId, 'm82'); assert.equal(drop.ammo, 3);
  room.shoot(player, f.now() + 200, true); assert.equal(room.droppedWeapons.size, 1);
  room.spawn(other); Object.assign(other, { x: 0, y: 0, z: -1.2, protectedUntil: 0, weaponId: 'knife', hp: 1 });
  room.shoot(player, f.now() + 400, true); assert.equal(other.hp, 0); assert.equal(room.droppedWeapons.size, 1);
});

test('dropped weapons fall onto elevated floors, expire and remain bounded; restart clears the world inventory', () => {
  const f = fixture(), { room, player } = f;
  room.world.obstacles = [{ x: 0, y: 0, z: 0, w: 10, d: 10, h: 3 }]; player.y = 3; const drop = room.dropWeapon(player);
  f.advance(500); assert.equal(drop.y, 3); assert.equal(drop.grounded, true);
  for (let i = 0; i < 40; i++) room.dropWeapon(player); assert.equal(room.droppedWeapons.size, EQUIPMENT_RULES.maxDrops);
  f.advance(EQUIPMENT_RULES.lifetimeMs + 1); assert.equal(room.droppedWeapons.size, 0);
  room.dropWeapon(player); room.restart(player.id); assert.equal(room.droppedWeapons.size, 0);
});

test('knife attacks damage only in melee range, respect cover/protection/cooldown and award kills without ammunition or headshot bonuses', () => {
  const f = fixture(), { room, player, other } = f; room.interactEquipment(player.id, f.request()); f.advance(400);
  assert.equal(room.shoot(player, f.now()), true); assert.equal(other.hp, 55); assert.equal(player.ammo, 0);
  assert.equal(room.shoot(player, f.now()), false); assert.equal(other.hp, 55);
  f.advance(600); other.protectedUntil = f.now() + 500; room.shoot(player, f.now()); assert.equal(other.hp, 55);
  f.advance(600); room.world.obstacles = [{ x: 0, y: 0, z: -.6, w: 3, h: 3, d: .2 }]; room.shoot(player, f.now()); assert.equal(other.hp, 55);
  f.advance(600); room.world.obstacles = []; other.z = -4; room.shoot(player, f.now()); assert.equal(other.hp, 55);
  f.advance(600); other.z = -1.2; other.hp = 45; room.shoot(player, f.now()); assert.equal(other.hp, 0); assert.equal(player.weaponKills.knife, 1);
  assert.equal(other.lastDeath.weaponId, 'knife'); assert.equal(other.lastDeath.headshot, false); assert.ok(room.events.some((event) => event.melee));
});

test('knife kill ledgers persist idempotently without adding a shop weapon or allowing a purchased/selected knife loadout', () => {
  assert.equal(WEAPONS.length, 20); assert.equal(EQUIPMENT.length, 21); assert.equal(isWeaponId('knife'), false); assert.equal(getWeapon('knife').melee, true);
  const p = createProfile('equipment-test-01'); assert.throws(() => purchaseWeapon(p, 'knife'));
  const report = { roundId: 'equipment-round-01', kills: 2, deaths: 1, weaponKills: { knife: 1, rifle: 1 }, completed: true };
  const next = recordRound(p, report).profile; assert.equal(next.kills, 2); assert.deepEqual(next.weaponKills, { knife: 1, rifle: 1 });
  assert.equal(recordRound(next, report).changed, false); assert.equal(normalizeProfile(next, next.id).weaponKills.knife, 1);
  const f = fixture(); const player = f.room.addPlayer('invalid', 'INVALID', false, { weaponId: 'knife', ownedWeapons: ['knife'] }); assert.equal(player.weaponId, 'rifle');
});

test('round completion freezes combat but the final dropped gun still falls to the floor', () => {
  const f = fixture(), { room, player } = f, drop = room.dropWeapon(player); room.finish(); const ammo = player.ammo;
  f.advance(500); assert.equal(drop.grounded, true); assert.equal(drop.y, 0); assert.equal(player.ammo, ammo); assert.equal(room.phase, 'ended');
});
