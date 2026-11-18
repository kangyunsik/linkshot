import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, getWeapon, shotSpread, damageAtDistance } from '../shared/catalog.js';
import { Room } from '../shared/simulation.js';
import { RULES } from '../shared/world.js';
import { idealTimeToKill, shotgunDistribution } from '../scripts/benchmark-weapons.mjs';

test('precision hits matter for the starter rifle while the original bolt-action sniper damage is preserved', () => {
  const rifle = getWeapon('rifle'), sniper = getWeapon('sniper');
  assert.equal(idealTimeToKill(rifle).shots, 3); assert.equal(idealTimeToKill(rifle, 5, true).shots, 2);
  assert.equal(sniper.damage, 100); assert.equal(sniper.headDamage, 150); assert.equal(idealTimeToKill(sniper).shots, 1);
  assert.equal(getWeapon('awp').damage, 100);
});

test('semi-auto M82 needs two actual torso hits instead of outperforming bolt actions on every body shot', () => {
  const room = new Room('M82', { bots: 0, clock: () => 1000, random: () => 0 });
  room.world = { ...room.world, obstacles: [], buildings: [], walkways: [] };
  const shooter = room.addPlayer('a', 'A', false, { weaponId: 'm82', ownedWeapons: ['m82'] }), target = room.addPlayer('b', 'B');
  Object.assign(shooter, { x: 24, y: 0, z: 8, yaw: 0, pitch: Math.atan2(1.05 - RULES.eyeHeight, 4), protectedUntil: 0 });
  Object.assign(target, { x: 24, y: 0, z: 4, yaw: 0, pitch: 0, protectedUntil: 0 });
  assert.equal(room.shoot(shooter, 1000, true), true); assert.ok(target.hp > 0 && target.hp <= 10);
  assert.equal(shooter.nextFireAt, 1600);
  assert.equal(room.shoot(shooter, 1600, true), true); assert.equal(target.hp, 0);
  assert.equal(idealTimeToKill(getWeapon('m82'), 5, true).shots, 1);
});

test('FAMAS rewards landing one complete chest burst and retains the penalty for missing a burst', () => {
  const weapon = getWeapon('famas');
  assert.equal(idealTimeToKill(weapon).shots, 3); assert.equal(idealTimeToKill(weapon).milliseconds, 150);
  assert.ok(weapon.burstPause >= .24); assert.ok(weapon.reloadSeconds > getWeapon('rifle').reloadSeconds);
});

test('SMGs have a genuine moving-accuracy role but cannot replace rifles at long range', () => {
  const rifle = getWeapon('rifle');
  const penalty = weapon => shotSpread(weapon, true, { grounded: true, moveSpeed: 5 }) - shotSpread(weapon, true, { grounded: true, moveSpeed: 0 });
  for (const weapon of WEAPONS.filter(weapon => weapon.type === 'SMG')) {
    assert.ok(penalty(weapon) < penalty(rifle), weapon.id);
    assert.ok(weapon.range < rifle.range, weapon.id);
    assert.ok(damageAtDistance(weapon, Math.min(weapon.range,50)) < damageAtDistance(rifle,50), weapon.id);
  }
  assert.ok(idealTimeToKill(getWeapon('vector'), 5).milliseconds < idealTimeToKill(rifle, 5).milliseconds);
  assert.ok(getWeapon('vector').magazine < getWeapon('smg').magazine);
});

test('shotguns preserve close-range lethality but even all chest pellets cannot kill in one shot at twenty metres', () => {
  for (const weapon of WEAPONS.filter(weapon => weapon.type === 'SHOTGUN')) {
    const close = shotgunDistribution(weapon, 3), far = shotgunDistribution(weapon, 20);
    assert.ok(close.oneShotPercent > 50, weapon.id);
    assert.ok(far.oneShotPercent < 5, weapon.id);
    assert.ok(close.meanDamage > far.meanDamage * 2, weapon.id);
    assert.ok(damageAtDistance(weapon,20) * weapon.pellets * RULES.torsoDamageMultiplier < 100, weapon.id);
  }
  assert.equal(getWeapon('spas12').magazine, 6);
  assert.ok(getWeapon('spas12').reloadSeconds > getWeapon('shotgun').reloadSeconds);
  assert.equal(getWeapon('s686').magazine, 2);
});

test('DMRs and LMGs retain distinct precision, cadence, mobility and capacity tradeoffs', () => {
  const precision = getWeapon('dmr'), battle = getWeapon('m14'), light = getWeapon('lmg'), heavy = getWeapon('m249');
  assert.equal(idealTimeToKill(precision, 5, true).shots, 1); assert.equal(idealTimeToKill(battle,5,true).shots, 2);
  assert.ok(precision.magazine < battle.magazine); assert.ok(precision.adsSpread < battle.adsSpread);
  assert.ok(light.adsSpread < heavy.adsSpread); assert.ok(light.walkMultiplier > heavy.walkMultiplier);
  assert.ok(light.magazine < heavy.magazine); assert.ok(light.reloadSeconds < heavy.reloadSeconds);
});
