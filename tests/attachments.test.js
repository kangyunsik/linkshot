import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfile, normalizeProfile, applyProfileOperation, suppressorUnlocked, SUPPRESSOR_KILLS, SUPPRESSOR_LEVEL, weaponMastery } from '../shared/progression.js';
import { Room } from '../shared/simulation.js';
import { WEAPONS, shotInterval } from '../shared/catalog.js';

function fixture(options = {}) {
  let now = 1000; const room = new Room('ATTACH', { bots: 0, random: () => .5, clock: () => now, ...options });
  return { room, now: () => now, advance(ms) { for (let i = 0; i < ms; i += 5) { now += 5; room.tick(.005); } } };
}

test('suppressors unlock at exactly weapon Lv.5, are per firearm and preserve legacy profiles and LP', () => {
  assert.equal(SUPPRESSOR_LEVEL, 5); assert.equal(SUPPRESSOR_KILLS, 1550); assert.equal(weaponMastery(1549).level, 4); assert.equal(weaponMastery(1550).level, 5);
  const profile = createProfile('attachment-profile-0001'); profile.points = 321; profile.weaponKills = { rifle: 1549, pistol: 1550, knife: 1000000 };
  assert.equal(suppressorUnlocked(profile.weaponKills, 'rifle'), false); assert.equal(suppressorUnlocked(profile.weaponKills, 'pistol'), true); assert.equal(suppressorUnlocked(profile.weaponKills, 'knife'), false);
  assert.throws(() => applyProfileOperation(profile, { type: 'suppressor', weaponId: 'rifle', equipped: true }), /Lv.5/);
  const attached = applyProfileOperation(profile, { type: 'suppressor', weaponId: 'pistol', equipped: true }).profile;
  assert.deepEqual(attached.suppressedWeapons, ['pistol']); assert.equal(attached.points, 321); assert.deepEqual(profile.suppressedWeapons, []);
  assert.equal(applyProfileOperation(attached, { type: 'suppressor', weaponId: 'pistol', equipped: true }).changed, false);
  assert.deepEqual(applyProfileOperation(attached, { type: 'suppressor', weaponId: 'pistol', equipped: false }).profile.suppressedWeapons, []);
  const old = normalizeProfile({ ...profile, suppressedWeapons: ['rifle', 'pistol', 'knife', '__proto__', 'missing'] }, profile.id); assert.deepEqual(old.suppressedWeapons, ['pistol']);
  assert.deepEqual(normalizeProfile({ ...profile, suppressedWeapons: undefined }, profile.id).suppressedWeapons, []);
});

test('authoritative equipment rejects forged unlocks and living loadout changes; every firearm can carry an earned suppressor', () => {
  for (const weapon of WEAPONS) {
    const f = fixture(), p = f.room.addPlayer('p', 'P', false, { ownedWeapons: [weapon.id], weaponId: weapon.id, weaponKills: { [weapon.id]: 1549 }, suppressedWeapons: [weapon.id], suppressor: true });
    assert.equal(p.suppressor, false, weapon.id); assert.equal(f.room.selectLoadout(p.id, { suppressor: true }), false);
    f.room.setInput(p.id, { suppressor: true, suppressedWeapons: [weapon.id] }); assert.equal(p.suppressor, false);
    p.masteryKills[weapon.id] = 1550; assert.equal(f.room.selectLoadout(p.id, { suppressor: true }), false);
    p.hp = 0; p.diedAt = f.now(); assert.equal(f.room.selectLoadout(p.id, { weaponId: weapon.id, suppressor: true }), true); f.room.spawn(p);
    assert.equal(p.suppressor, true); assert.equal(f.room.snapshot().players[0].suppressor, true);
    f.room.shoot(p, f.now(), true); assert.equal(f.room.events.findLast((event) => event.type === 'shot').suppressor, true);
    assert.equal(f.room.setSuppressor(p, 'knife', true), false);
  }
});

test('a looted suppressor remains with its physical gun but never grants a permanent unlock or changes the respawn preference', () => {
  const f = fixture(), p = f.room.addPlayer('p', 'P'); Object.assign(p, { x: 20, y: 0, z: 0, protectedUntil: 0 });
  f.room.droppedWeapons.set('loot', { id: 'loot', weaponId: 'pistol', skinId: 'standard', suppressor: true, ammo: 7, x: 20.5, y: 0, z: 0, grounded: true, pickupAt: 0, expiresAt: f.now() + 5000 });
  const data = { roundId: f.room.roundId, spawnCount: p.spawnCount, equipmentSeq: p.equipmentSeq, actionSeq: 1 }; assert.equal(f.room.interactEquipment(p.id, data), true);
  assert.equal(p.suppressor, true); assert.equal(p.ammo, 7); assert.equal(suppressorUnlocked(p.masteryKills, 'pistol'), false); assert.deepEqual(p.suppressedWeapons, []);
  const dropped = f.room.dropWeapon(p); assert.equal(dropped.suppressor, true); f.room.spawn(p); assert.equal(p.weaponId, 'rifle'); assert.equal(p.suppressor, false);
});

test('nonprogression rounds cannot farm mastery to obtain suppressor permission', () => {
  for (const options of [{ mode: 'custom' }, { mode: 'practice', gameType: 'hardpoint', mapId: 'relay' }, { mode: 'practice', gameType: 'defense', mapId: 'bastion' }]) {
    const f = fixture(options), a = f.room.addPlayer('a', 'A', false, { weaponKills: { rifle: 1549 } }), b = f.room.addPlayer('b', 'B');
    if (a.teamId === b.teamId) b.teamId = 'red'; b.protectedUntil = 0; f.room.applyDamage(a, b, 10000, false, {}, WEAPONS[0], f.now());
    assert.equal(a.masteryKills.rifle, 1549); assert.equal(f.room.setSuppressor(a, 'rifle', true), false);
  }
});

test('attaching a suppressor never changes damage, spread, range, ammunition or movement rules for any firearm', () => {
  for (const weapon of WEAPONS) {
    const shots = [];
    for (const suppressor of [false, true]) {
      const f = fixture(), p = f.room.addPlayer('p', 'P', false, { weaponId: weapon.id, ownedWeapons: [weapon.id], weaponKills: { [weapon.id]: 1550 }, suppressor }), target = f.room.addPlayer('target', 'TARGET');
      f.room.world = { ...f.room.world, width: 200, depth: 200, obstacles: [] }; Object.assign(p, { x: 0, y: 0, z: 0, yaw: 0, pitch: -.1 }); Object.assign(target, { x: 0, y: 0, z: -1, hp: 10000, protectedUntil: 0 });
      f.room.shoot(p, f.now(), true); const shot = f.room.events.findLast((event) => event.type === 'shot'); shots.push({ rays: shot.rays, ammo: p.ammo, delay: p.nextFireAt, damage: 10000 - target.hp });
    }
    assert.deepEqual(shots[0], shots[1], weapon.id);
  }
});

test('AN-94 holds a fast first pair then ordinary automatic cadence, while rapid tapping cannot repeat first-shot intervals', () => {
  const f = fixture(), p = f.room.addPlayer('p', 'P', false, { weaponId: 'an94', ownedWeapons: ['an94'] });
  f.room.setInput(p.id, { fire: true, fireSeq: 1 }); const times = [], shoot = f.room.shoot.bind(f.room); f.room.shoot = (...args) => { const ok = shoot(...args); if (ok) times.push(f.now()); return ok; };
  f.advance(400); assert.ok(times.length >= 4); assert.deepEqual(times.slice(1, 4).map((time, i) => time - times[i]), [40, 120, 120]);
  const tapped = fixture(), tapper = tapped.room.addPlayer('p', 'P', false, { weaponId: 'an94', ownedWeapons: ['an94'] }), tapTimes = [], fire = tapped.room.shoot.bind(tapped.room);
  tapped.room.shoot = (...args) => { const ok = fire(...args); if (ok) tapTimes.push(tapped.now()); return ok; };
  for (let i = 0; i < 20; i++) { tapped.room.setInput(tapper.id, { fire: true, fireSeq: i }); tapped.advance(5); tapped.room.setInput(tapper.id, { fire: false }); tapped.advance(15); }
  assert.ok(tapTimes.length >= 2); assert.ok(tapTimes.slice(1).every((time, i) => time - tapTimes[i] >= 120));
  assert.equal(shotInterval(WEAPONS.find((w) => w.id === 'an94'), 1, false), .12);
});
