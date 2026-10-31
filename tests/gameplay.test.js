import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, MAPS, hasLineOfSight } from '../shared/world.js';
import { EMPTY_INPUT, movePlayer } from '../shared/movement.js';
import { WEAPONS, getWeapon, shotSpread } from '../shared/catalog.js';
import { Room, BOT_DIFFICULTIES, BOT_BEHAVIOR, getBotDifficulty } from '../shared/simulation.js';

const input = (extra = {}) => ({ ...EMPTY_INPUT, ...extra });
const player = (extra = {}) => ({ x: 0, y: 0, z: 0, grounded: true, vy: 0, yaw: 0, pitch: 0, weaponId: 'rifle', ...extra });
const empty = { width: 50, depth: 50, obstacles: [] };

test('sprint and jump cannot enter crouch, including simultaneous or spoofed inputs', () => {
  const running = player();
  movePlayer(running, input({ forward: 1, sprint: true, crouch: true, fire: true }), 1 / 60, empty);
  assert.equal(running.crouching, false); assert.equal(running.sprinting, true); assert.ok(running.moveSpeed > RULES.walkSpeed);
  const jumping = player({ crouching: true });
  movePlayer(jumping, input({ jump: true, crouch: true }), 1 / 60, empty);
  assert.equal(jumping.grounded, false); assert.equal(jumping.crouching, false);
  for (let i = 0; i < 12; i++) { movePlayer(jumping, input({ crouch: true }), 1 / 60, empty); assert.equal(jumping.crouching, false); }
  const low = { ...empty, obstacles: [{ x: 0, z: 0, y: 1.25, w: 3, d: 3, h: 0.3 }] }, forced = player({ crouching: true });
  movePlayer(forced, input({ jump: true, sprint: true, forward: 1 }), 1 / 60, low);
  assert.equal(forced.crouching, true); assert.equal(forced.grounded, true, 'headroom safety never enables airborne crouch');
});

test('ADS does not erase running or airborne shot spread; rifle spray blooms and recovers', () => {
  const rifle = getWeapon('rifle'), steady = shotSpread(rifle, true, { grounded: true });
  const walking = shotSpread(rifle, true, { grounded: true, moveSpeed: 5 });
  const running = shotSpread(rifle, true, { grounded: true, sprinting: true });
  const airborne = shotSpread(rifle, true, { grounded: false });
  assert.ok(steady < walking && walking < running && running < airborne);
  assert.ok(running > steady * 30 && airborne > 0.1); assert.ok(rifle.recoil >= 1.6);
  let now = 1000; const room = new Room('SPRAY', { bots: 0, clock: () => now }), p = room.addPlayer('a', 'ALPHA');
  for (let i = 0; i < 8; i++) room.shoot(p, now + i * 110);
  assert.ok(shotSpread(rifle, true, p) > steady * 10);
  for (let i = 0; i < 90; i++) { now += 1000 / 60; room.setInput('a', input()); room.tick(1 / 60); }
  assert.equal(p.shotHeat, 0);
});

test('snipers have wide hip fire and stronger movement penalties while stationary scope precision is unchanged', () => {
  for (const [id, precision] of [['sniper', .0004], ['awp', .00025], ['m82', .001]]) {
    const weapon = getWeapon(id), steady = shotSpread(weapon, true, { grounded: true, moveSpeed: 0 });
    const hip = shotSpread(weapon, false, { grounded: true }), walking = shotSpread(weapon, true, { grounded: true, moveSpeed: 2 });
    const running = shotSpread(weapon, true, { grounded: true, sprinting: true }), air = shotSpread(weapon, true, { grounded: false });
    assert.equal(steady, precision, id); assert.ok(hip >= .08 && hip > steady * 70, id);
    assert.ok(walking >= .045 && walking > steady * 40 && running > walking && air > running, id);
    assert.ok(shotSpread(weapon, false, { grounded: true, moveSpeed: 2 }) > hip + .06, id);
  }
  for (const weapon of WEAPONS.filter((weapon) => weapon.type !== 'SNIPER')) for (const ads of [false, true]) {
    const base = ads ? weapon.adsSpread : weapon.spread;
    assert.equal(shotSpread(weapon, ads, { grounded: true, moveSpeed: 2 }), base + (ads ? .014 : .024), weapon.id);
    assert.equal(shotSpread(weapon, ads, { grounded: false }), base + .105, weapon.id);
  }
});

test('authoritative sniper bullets miss far more often from the hip and while moving than from a stationary scope', () => {
  for (const id of ['sniper', 'awp', 'm82']) {
    const hitRate = (ads, state) => {
      let seed = 71; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const room = new Room('SCOPE', { bots: 0, clock: () => 1000, random }), shooter = room.addPlayer('shooter', 'SHOOTER', false, { weaponId: id, ownedWeapons: [id] }), target = room.addPlayer('target', 'TARGET');
      room.world = { ...room.world, width: 250, depth: 250, obstacles: [] };
      Object.assign(shooter, { x: 0, y: 0, z: 40, yaw: 0, pitch: Math.atan2(1.05 - 1.62, 40), ...state }); Object.assign(target, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 1000000, protectedUntil: 0 });
      let hits = 0;
      for (let shot = 0; shot < 400; shot++) { shooter.ammo = getWeapon(id).magazine; shooter.shotHeat = 0; room.events.length = 0; room.shoot(shooter, 1000 + shot * 2000, ads); hits += Number(room.events.find((event) => event.type === 'shot').hit === target.id); }
      return hits / 400;
    };
    const stationary = hitRate(true, { grounded: true, moveSpeed: 0, sprinting: false }), hip = hitRate(false, { grounded: true, moveSpeed: 0, sprinting: false });
    const walking = hitRate(true, { grounded: true, moveSpeed: 2, sprinting: false }), running = hitRate(true, { grounded: true, moveSpeed: 6, sprinting: true });
    assert.equal(stationary, 1, id); assert.ok(hip < .2 && walking < .4 && running < walking, `${id}: ${JSON.stringify({ stationary, hip, walking, running })}`);
  }
});

test('actual authoritative bullets miss more often while running or airborne', () => {
  const rate = (state) => {
    let seed = 19; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const room = new Room('SHOTS', { bots: 0, random }), shooter = room.addPlayer('a', 'ALPHA'), target = room.addPlayer('b', 'BRAVO');
    room.world = empty; Object.assign(shooter, player({ id: 'a', z: 12, protectedUntil: 0, ...state }));
    Object.assign(target, player({ id: 'b', z: -8, protectedUntil: 0, hp: 1_000_000 }));
    let hits = 0;
    for (let i = 0; i < 400; i++) { shooter.ammo = 30; shooter.shotHeat = 0; room.shoot(shooter, Date.now(), true); hits += Number(room.events.at(-1)?.type === 'damage' || room.events.findLast((event) => event.type === 'shot').hit === 'b'); }
    return hits / 400;
  };
  const steady = rate({ grounded: true }), running = rate({ grounded: true, sprinting: true, moveSpeed: 8 }), air = rate({ grounded: false });
  assert.ok(steady > 0.95); assert.ok(running < 0.2 && air < running);
});

test('living players cannot change weapons via input, compatibility calls or loadout packets', () => {
  let now = 1000; const room = new Room('LOCKD', { bots: 0, clock: () => now }), p = room.addPlayer('a', 'ALPHA');
  p.ammo = 7; room.setInput('a', input({ reload: true })); room.tick(1 / 60); const reload = p.reloadUntil;
  for (const id of ['sniper', 'smg', 'shotgun']) {
    room.setInput('a', input({ weaponId: id })); room.tick(1 / 60); assert.equal(room.switchWeapon(p, id), false); assert.equal(room.selectLoadout('a', { weaponId: id, open: true }), false);
    assert.equal(p.weaponId, 'rifle'); assert.equal(p.ammo, 7); assert.equal(p.reloadUntil, reload);
  }
});

test('death-only selection queues the next spawn, has a bounded timer and keeps cosmetics', () => {
  let now = 1000; const room = new Room('PICKW', { bots: 0, clock: () => now }), p = room.addPlayer('a', 'ALPHA', false, { skinId: 'arctic', outfitId: 'runner' });
  Object.assign(p, { hp: 0, diedAt: now, respawnAt: now + 3000 });
  assert.equal(room.selectLoadout('a', { open: true }), true); assert.equal(p.respawnAt, 16000);
  now = 8000; room.selectLoadout('a', { open: true }); assert.equal(p.respawnAt, 16000);
  assert.equal(room.selectLoadout('a', { weaponId: '__proto__' }), false);
  room.selectLoadout('a', { weaponId: 'sniper', open: false }); assert.equal(p.weaponId, 'rifle'); assert.equal(p.nextWeaponId, 'sniper');
  now += 400; room.tick(1 / 60);
  assert.equal(p.hp, 100); assert.equal(p.weaponId, 'sniper'); assert.equal(p.ammo, 5); assert.equal(p.loadoutSelecting, false);
  assert.equal(p.outfitId, 'runner'); assert.equal(p.skinId, 'arctic');
});

test('the sniper last shot starts exactly one immediate reload without another trigger press', () => {
  let now = 1000; const room = new Room('BOLT4', { bots: 0, clock: () => now }), p = room.addPlayer('a', 'ALPHA', false, { weaponId: 'sniper' });
  p.ammo = 1; room.setInput('a', input({ weaponId: 'sniper', fire: true })); room.tick(1 / 60);
  assert.equal(p.ammo, 0); assert.equal(p.reloadUntil, now + getWeapon('sniper').reloadSeconds * 1000);
  const until = p.reloadUntil; now += 100; room.setInput('a', input({ weaponId: 'sniper' })); room.tick(1 / 60); assert.equal(p.reloadUntil, until);
  assert.equal(room.events.filter((event) => event.type === 'reload').length, 1);
});

test('every empty weapon automatically reloads after its final shot even after releasing the trigger', () => {
  for (const weapon of WEAPONS) {
    let now = 1000; const room = new Room('AUTOR', { bots: 0, clock: () => now }), p = room.addPlayer('a', 'ALPHA', false, { weaponId: weapon.id, ownedWeapons: [weapon.id] });
    p.ammo = 1; room.setInput(p.id, input({ weaponId: weapon.id, fire: true })); room.tick(1 / 60);
    assert.equal(p.ammo, 0, weapon.id); assert.equal(p.reloadUntil, now + weapon.reloadSeconds * 1000, `${weapon.id}: same-tick auto reload`);
    room.setInput(p.id, input({ weaponId: weapon.id }));
    const started = p.reloadUntil; now = p.nextFireAt - 1; room.tick(1 / 60); assert.equal(p.reloadUntil, started, `${weapon.id}: no delayed or duplicate reload`);
    const until = p.reloadUntil; now = until - 1; room.tick(1 / 60); assert.equal(p.ammo, 0); assert.equal(p.reloadUntil, until);
    now = until; room.tick(1 / 60); assert.equal(p.ammo, weapon.magazine); assert.equal(p.reloadUntil, 0);
    assert.equal(room.events.filter((event) => event.type === 'reload').length, 1, `${weapon.id}: no duplicate reload event`);
    assert.equal(room.events.filter((event) => event.type === 'shot').length, 1, `${weapon.id}: do not fire again after release`);
  }
});

test('FAMAS delivers exactly three rounds per press, finishes a released burst and cancels for reload', () => {
  let now = 1000; const room = new Room('BURST3', { bots: 0, clock: () => now }), p = room.addPlayer('a', 'ALPHA', false, { weaponId: 'famas', ownedWeapons: ['famas'] });
  room.setInput('a', input({ fire: true, ads: true })); room.tick(1 / 60);
  room.setInput('a', input({ ads: true }));
  for (let i = 0; i < 60; i++) { now += 1000 / 60; room.tick(1 / 60); }
  assert.equal(p.ammo, 22); assert.equal(p.burstLeft, 0); assert.equal(room.events.filter((event) => event.type === 'shot').length, 3);
  room.setInput('a', input({ fire: true })); room.tick(1 / 60);
  room.setInput('a', input({ reload: true })); room.tick(1 / 60); assert.equal(p.burstLeft, 0); assert.ok(p.reloadUntil > now);
});

test('eight humans replace training bots, and a ninth cannot enter', () => {
  const room = new Room('EIGHT', { bots: 7 }); assert.equal(room.players.size, 7);
  for (let i = 0; i < 8; i++) room.addPlayer(`p-${i}`, `PLAYER ${i}`);
  assert.equal(room.players.size, 8); assert.equal(room.summary().players, 8); assert.equal(room.summary().bots, 0); assert.equal(room.summary().capacity, 8);
  assert.throws(() => room.addPlayer('ninth', 'NINTH'), /가득/);
});

test('all thirty-four hollow buildings have walkable stairs, floors and roofs without jumping', () => {
  let count = 0;
  for (const world of MAPS) for (const building of world.buildings) {
    count++; assert.ok(building.height >= 6); const p = player(building.entry);
    for (const target of building.route.slice(1)) {
      let reached = false;
      for (let frame = 0; frame < 350; frame++) {
        const dx = target.x - p.x, dz = target.z - p.z, distance = Math.hypot(dx, dz);
        if (distance < 0.1 && Math.abs(p.y - target.y) < 0.07) { reached = true; break; }
        movePlayer(p, input({ forward: Math.min(1, distance * 4), yaw: Math.atan2(-dx, -dz) }), 1 / 60, world);
      }
      assert.ok(reached, `${world.id}/${building.id}/${JSON.stringify(target)}`);
    }
    assert.equal(p.y, building.height);
  }
  assert.equal(count, 34);
  for (const world of MAPS) { assert.equal(world.coverWalls.length, 8); assert.ok(world.buildings.every((building) => building.solidPanels > building.windows.length)); }
});

test('beginner preserves the current AI; medium and advanced improve reaction, aim and bursts without extra HP', () => {
  assert.equal(BOT_DIFFICULTIES[0].behavior, BOT_BEHAVIOR); assert.equal(getBotDifficulty('__proto__').id, 'beginner');
  for (let i = 1; i < BOT_DIFFICULTIES.length; i++) {
    const before = BOT_DIFFICULTIES[i - 1].behavior, after = BOT_DIFFICULTIES[i].behavior;
    assert.ok(after.reactionMaxMs < before.reactionMinMs); assert.ok(after.shotSpread < before.shotSpread); assert.ok(after.shotIntervalMs < before.shotIntervalMs); assert.ok(after.turnRadiansPerSecond > before.turnRadiansPerSecond);
    const room = new Room('LEVEL', { bots: 1, botDifficulty: BOT_DIFFICULTIES[i].id }), bot = [...room.players.values()][0];
    assert.equal(bot.hp, 100); assert.equal(room.snapshot().room.botDifficulty, BOT_DIFFICULTIES[i].id);
  }
});

test('building windows are real bullet/sight openings while the sill blocks lower shots', () => {
  for (const world of MAPS) for (const building of world.buildings) {
    const window = building.windows.find((item) => item.axis === 'z' && item.side === 1);
    const inside = { x: window.x - 0.7, y: window.y, z: window.z }, outside = { ...inside, x: window.x + 0.7 };
    assert.equal(hasLineOfSight(inside, outside, world), true, `${world.id}/${building.id} window`);
    inside.y = outside.y = window.floor * 3 + 0.5;
    assert.equal(hasLineOfSight(inside, outside, world), false, 'window sill must remain solid');
  }
});
