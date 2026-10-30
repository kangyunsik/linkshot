import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, WORLD, getMap, bounds, aimDirection, RULES } from '../shared/world.js';
import { WEAPONS, SKINS, getWeapon, getSkin, freshMagazines, shotAngles, damageAtDistance } from '../shared/catalog.js';
import { Room, traceShot, findPath } from '../shared/simulation.js';
import { movePlayer, EMPTY_INPUT, sanitizeInput } from '../shared/movement.js';

test('six genuinely distinct arenas have clear, connected, inward-facing spawn points', () => {
  assert.equal(MAPS.length, 6);
  assert.equal(new Set(MAPS.map((map) => JSON.stringify(map.obstacles))).size, 6);
  assert.ok(MAPS.some((map) => map.depth >= 110)); assert.ok(MAPS.some((map) => map.width >= 120));
  for (const map of MAPS) {
    assert.equal(map.spawns.length, 8);
    for (const spawn of map.spawns) {
      const direction = aimDirection(spawn.yaw, 0);
      assert.ok((direction.x * -spawn.x + direction.z * -spawn.z) / Math.hypot(spawn.x, spawn.z) > 0.99, map.id);
      for (const box of map.obstacles) {
        const b = bounds(box, RULES.playerRadius + 0.1);
        assert.ok(!(spawn.x > b.minX && spawn.x < b.maxX && spawn.z > b.minZ && spawn.z < b.maxZ), `${map.id}: blocked spawn`);
      }
      const path = findPath(spawn, map.spawns[(map.spawns.indexOf(spawn) + 1) % 8], map);
      assert.ok(path.length, `${map.id}: no navigation path`);
      const target = map.spawns[(map.spawns.indexOf(spawn) + 1) % 8];
      assert.ok(Math.hypot(path.at(-1).x - target.x, path.at(-1).z - target.z) < 3.1, `${map.id}: disconnected spawn`);
    }
  }
});

test('movement and long-range shots use the selected arena, not old foundry bounds', () => {
  const world = getMap('redline');
  const p = { x: 50, y: 0, z: -19, yaw: -Math.PI / 2, pitch: 0, vy: 0, grounded: true };
  for (let i = 0; i < 240; i++) movePlayer(p, { ...EMPTY_INPUT, forward: 1, yaw: -Math.PI / 2 }, 1 / 60, world);
  assert.ok(p.x > 63 && p.x <= world.width / 2 - RULES.playerRadius);
  const shooter = { id: 'a', weaponId: 'sniper', x: -55, y: 0, z: -19, yaw: -Math.PI / 2, pitch: 0 };
  const target = { id: 'b', x: 55, y: 0, z: -19, hp: 100, protectedUntil: 0 };
  const hit = traceShot(shooter, [shooter, target], 1000, world);
  assert.equal(hit.victim, target); assert.ok(hit.distance > 100);
});

test('catalog rejects unknown/prototype IDs and skins have no combat modifiers', () => {
  assert.equal(WEAPONS.length, 19); assert.equal(SKINS.length, 6);
  assert.equal(getMap('__proto__'), WORLD); assert.equal(getWeapon('toString').id, 'rifle'); assert.equal(getSkin({}).id, 'standard');
  assert.equal(sanitizeInput({ weaponId: 'invalid' }, { ...EMPTY_INPUT, weaponId: 'sniper' }).weaponId, 'sniper');
  for (const skin of SKINS) for (const key of ['damage', 'speed', 'hp', 'spread']) assert.equal(skin[key], undefined);
});

test('sniper deals 100 base body damage and retains 150 headshot damage', () => {
  const sniper = getWeapon('sniper');
  assert.equal(sniper.damage, 100);
  assert.equal(damageAtDistance(sniper, 100), 100);
  assert.equal(sniper.headDamage, 150);
  assert.equal(damageAtDistance(sniper, 100, true), 150);
});

for (const weapon of WEAPONS) {
  test(`${weapon.name}: distinct server damage, one cartridge per shot, correct magazine and reload time`, () => {
    let now = 1000; const room = new Room('WEAPN', { bots: 0, clock: () => now });
    const shooter = room.addPlayer('a', 'ALPHA', false, { weaponId: weapon.id, skinId: 'arctic' }), target = room.addPlayer('b', 'BRAVO');
    Object.assign(shooter, { x: 24, y: 0, z: 8, yaw: 0, pitch: Math.atan2(-0.5, 4), protectedUntil: 0 });
    Object.assign(target, { x: 24, y: 0, z: 4, protectedUntil: 0 });
    assert.equal(shooter.ammo, weapon.magazine); assert.equal(shooter.skinId, 'arctic');
    room.shoot(shooter, now, true);
    assert.equal(shooter.ammo, weapon.magazine - 1);
    assert.equal(target.hp, Math.max(0, 100 - weapon.damage * weapon.pellets));
    assert.equal(room.events.filter((event) => event.type === 'shot').at(-1).rays.length, weapon.pellets);
    assert.equal(room.events.filter((event) => event.type === 'damage').length, 1);
    if (weapon.id === 'shotgun') { assert.equal(shooter.kills, 1); assert.equal(target.deaths, 1); }
    room.setInput('a', { ...EMPTY_INPUT, weaponId: weapon.id, reload: true }); room.tick(1 / 60);
    assert.equal(shooter.reloadUntil, now + weapon.reloadSeconds * 1000);
    now += weapon.reloadSeconds * 1000 - 1; room.setInput('a', { ...EMPTY_INPUT, weaponId: weapon.id }); room.tick(1 / 60);
    assert.equal(shooter.ammo, weapon.magazine - 1);
    now += 2; room.tick(1 / 60); assert.equal(shooter.ammo, weapon.magazine);
  });
}

test('live switching is rejected and cannot cancel reload or bypass a firing cooldown', () => {
  let now = 1000; const room = new Room('SWICH', { bots: 0, clock: () => now }); const p = room.addPlayer('a', 'ALPHA');
  p.ammo = 12; room.setInput('a', { ...EMPTY_INPUT, reload: true }); room.tick(1 / 60); assert.ok(p.reloadUntil);
  room.setInput('a', { ...EMPTY_INPUT, weaponId: 'smg' }); room.tick(1 / 60);
  assert.equal(p.ammo, 12); assert.equal(p.weaponId, 'rifle'); assert.ok(p.reloadUntil);
  const reloadingUntil = p.reloadUntil; room.switchWeapon(p, 'sniper', now); assert.equal(p.reloadUntil, reloadingUntil);
  now = reloadingUntil + 1; room.tick(1 / 60); room.shoot(p, now); const cooldown = p.nextFireAt;
  room.switchWeapon(p, 'smg', now); assert.equal(p.nextFireAt, cooldown); assert.equal(p.weaponId, 'rifle');
});

test('pump and bolt weapons require a new trigger press; automatics keep firing', () => {
  for (const weapon of WEAPONS) {
    let now = 1000; const room = new Room('TRIGR', { bots: 0, clock: () => now }); const p = room.addPlayer('a', 'ALPHA', false, { weaponId: weapon.id });
    for (let i = 0; i < 120; i++) { now += 1000 / 60; room.setInput('a', { ...EMPTY_INPUT, weaponId: weapon.id, fire: true }); room.tick(1 / 60); }
    const shots = room.events.filter((event) => event.type === 'shot').length;
    assert.ok(weapon.automatic ? shots > 5 : shots === (weapon.burstCount || 1), weapon.id);
    if (!weapon.automatic) {
      room.setInput('a', { ...EMPTY_INPUT, weaponId: weapon.id }); room.tick(1 / 60);
      room.setInput('a', { ...EMPTY_INPUT, weaponId: weapon.id, fire: true }); room.tick(1 / 60);
      assert.equal(room.events.filter((event) => event.type === 'shot').length, (weapon.burstCount || 1) + 1);
    }
  }
});

test('shotgun spread is multi-pellet, ADS tighter, and damage falls off with distance', () => {
  const shotgun = getWeapon('shotgun');
  assert.equal(shotAngles(shotgun, false, () => 0.5).length, 8);
  const widest = (angles) => Math.max(...angles.map((angle) => Math.hypot(angle.yaw, angle.pitch)));
  assert.ok(widest(shotAngles(shotgun, true)) < widest(shotAngles(shotgun, false)));
  assert.ok(damageAtDistance(shotgun, 35) < damageAtDistance(shotgun, 5));
});

test('respawn replenishes all magazines while retaining selected weapon and skin', () => {
  const room = new Room('SPAWN', { bots: 0 }); const p = room.addPlayer('a', 'ALPHA', false, { weaponId: 'sniper', skinId: 'phantom' });
  p.ammo = 0; p.magazines.shotgun = 0; room.spawn(p);
  assert.equal(p.weaponId, 'sniper'); assert.equal(p.skinId, 'phantom'); assert.equal(p.ammo, 5); assert.deepEqual(p.magazines, freshMagazines());
  assert.equal(room.snapshot().players[0].skinId, 'phantom');
});
