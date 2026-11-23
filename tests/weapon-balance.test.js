import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, getWeapon, shotAngles, shotSpread, damageAtDistance } from '../shared/catalog.js';
import { Room } from '../shared/simulation.js';
import { RULES } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer } from '../shared/movement.js';
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
  const power = getWeapon('dmr'), battle = getWeapon('m14'), light = getWeapon('lmg'), heavy = getWeapon('m249');
  assert.equal(idealTimeToKill(power, 5, true).shots, 1); assert.equal(idealTimeToKill(battle,5,true).shots, 2);
  assert.ok(power.magazine < battle.magazine); assert.ok(power.adsSpread > battle.adsSpread);
  assert.ok(light.adsSpread < heavy.adsSpread); assert.ok(light.walkMultiplier > heavy.walkMultiplier);
  assert.ok(light.magazine < heavy.magazine); assert.ok(light.reloadSeconds < heavy.reloadSeconds);
});

test('rifles have distinct rested and sustained spread, with a small but nonzero scoped cone', () => {
  const sorted = (ids, ads, shotHeat = 0) => [...ids].sort((a, b) => shotSpread(getWeapon(a), ads, { shotHeat }) - shotSpread(getWeapon(b), ads, { shotHeat }));
  for (const [ids, ads, heat] of [
    [['m4a1', 'an94', 'rifle', 'famas', 'ak47'], false, 0],
    [['an94', 'm4a1', 'rifle', 'famas', 'ak47'], true, 0],
    [['m4a1', 'an94', 'rifle', 'famas', 'ak47'], true, 1],
    [['m14', 'dmr'], true, 0], [['sniper', 'awp', 'm82'], true, 0],
  ]) assert.deepEqual(sorted(ids, ads, heat), ids);
  for (const weapon of WEAPONS.filter(w => w.spreadBloom !== undefined)) {
    const [angle] = shotAngles(weapon, true, () => .5), radius = Math.hypot(angle.pitch, angle.yaw);
    assert.ok(radius > 0 && radius < weapon.adsSpread && weapon.adsSpread < weapon.spread, weapon.id);
  }
});

test('Shift and ADS match weapon-weighted pace and upright walking spread without making ADS silent', () => {
  const world = { width: 100, depth: 100, obstacles: [] };
  for (const weapon of WEAPONS) for (const [moveSpeed, shotHeat] of [[0, 0], [2, .5]]) {
    const state = { grounded: true, moveSpeed, shotHeat };
    const walkSpread = shotSpread(weapon, false, { ...state, walking: true });
    const hip = shotSpread(weapon, false, state), adsSpread = shotSpread(weapon, true, state);
    if (moveSpeed > 0) { assert.equal(walkSpread, adsSpread, weapon.id); assert.ok(walkSpread < hip, weapon.id); }
    else assert.equal(walkSpread, hip, weapon.id);
    assert.ok(adsSpread > 0 && adsSpread < hip, weapon.id);
    for (const [walk, ads] of [[true, false], [false, true], [true, true]]) {
      const player = { x: 0, y: 0, z: 0, grounded: true, weaponId: weapon.id };
      movePlayer(player, { ...EMPTY_INPUT, forward: 1, walk, ads }, 1 / 60, world);
      assert.ok(Math.abs(player.moveSpeed - RULES.walkSpeed * weapon.walkMultiplier) < 1e-9, weapon.id);
      assert.equal(player.walking, walk, 'only holding Shift is silent');
    }
  }
});

test('Shift cannot stack with crouching or narrow a stopped or airborne shot', () => {
  for (const weapon of WEAPONS) for (const state of [
    { grounded: true, moveSpeed: 0 }, { grounded: true, moveSpeed: .1 },
    { grounded: true, moveSpeed: 0, crouching: true, crouchAmount: 1 },
    { grounded: true, moveSpeed: 2, crouching: true, crouchAmount: 1 },
    { grounded: true, moveSpeed: 2, crouching: true, crouchAmount: 0 },
    { grounded: true, moveSpeed: 2, crouching: false, crouchAmount: .3 },
    { grounded: false, moveSpeed: 2 },
  ]) {
    assert.equal(shotSpread(weapon, false, { ...state, walking: true }), shotSpread(weapon, false, state), weapon.id);
  }
});

test('authoritative Shift shots require actual upright walking, and precise rifles hit smaller targets more often', () => {
  const trials = (id, { ads = false, walk = false, forward = 0, crouch = false, blocked = false } = {}) => {
    let seed = 340151, now = 1000;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const room = new Room('FOCUS', { bots: 0, clock: () => now, random });
    const wall = { id: 'stop', x: 0, y: 0, z: -RULES.playerRadius - .25, w: 5, h: 3, d: .5 };
    room.world = { ...room.world, width: 200, depth: 200, obstacles: blocked ? [wall] : [] };
    const shooter = room.addPlayer('a', 'A', false, { weaponId: id, ownedWeapons: [id] }), target = room.addPlayer('b', 'B');
    const pitch = Math.atan2(1.58 - RULES.eyeHeight, 65);
    Object.assign(target, { x: 0, y: 0, z: -65, hp: 1e7, protectedUntil: 0, yaw: 0 });
    const stance = { ...EMPTY_INPUT, yaw: 0, pitch, forward, ads, walk, crouch };
    let heads = 0; const endpoints = [];
    for (let i = 0; i < 240; i++) {
      Object.assign(shooter, { x: 0, y: 0, z: 0, grounded: true, walking: false, moveSpeed: 0, shotHeat: 0, ammo: 24, crouching: crouch, crouchAmount: Number(crouch) });
      now += 1000; room.events.length = 0;
      if (forward) movePlayer(shooter, stance, 1 / 60, room.world, now);
      room.setInput(shooter.id, { ...stance, fire: true });
      // A tap released before the tick still uses the stance captured at the trigger.
      room.setInput(shooter.id, { ...EMPTY_INPUT, crouch });
      room.tick(1 / 60);
      const event = room.events.find(event => event.type === 'shot');
      heads += Number(event.headshot); endpoints.push(event.end);
    }
    return { heads, endpoints };
  };
  assert.deepEqual(trials('rifle', { walk: true, forward: 1 }), trials('rifle', { ads: true, forward: 1 }));
  for (const state of [{}, { crouch: true, forward: 1 }, { blocked: true, forward: 1 }]) {
    assert.deepEqual(trials('rifle', { ...state, walk: true }), trials('rifle', state));
  }
  const m4 = trials('m4a1', { ads: true }), ak = trials('ak47', { ads: true });
  assert.ok(m4.heads > 225 && ak.heads < m4.heads * .72 && ak.heads > 25, `${m4.heads}/${ak.heads}`);
  assert.ok(new Set(m4.endpoints.map(e => e.x)).size > 200);
});
