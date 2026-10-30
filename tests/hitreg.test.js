import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, traceShot } from '../shared/simulation.js';
import { EMPTY_INPUT } from '../shared/movement.js';
import { WEAPONS, getWeapon } from '../shared/catalog.js';
import { normalizeRoundOptions, aimDirection } from '../shared/world.js';

function setup(weaponId = 'sniper', isBot = false) {
  let now = 1000; const room = new Room('HITRG', { bots: 0, clock: () => now, random: () => 0 });
  const shooter = room.addPlayer('a', 'ALPHA', isBot, { weaponId, ownedWeapons: [weaponId] }), target = room.addPlayer('b', 'BRAVO');
  room.world = { ...room.world, width: 240, depth: 240, obstacles: [] };
  Object.assign(shooter, { x: 0, y: 0, z: 10, yaw: 0, pitch: 0, protectedUntil: 0 });
  Object.assign(target, { x: 0, y: 0, z: -40, protectedUntil: 0 });
  for (const p of [shooter, target]) { p.history = []; room.recordPlayerHistory(p, 800); room.recordPlayerHistory(p, 1000); }
  room.events.length = 0;
  return { room, shooter, target, now: (value) => { now = value; } };
}

test('a same-tick recoil/look update cannot overwrite a precisely aimed sniper trigger', () => {
  const { room, shooter, target } = setup(); room.random = () => 0.5; const pitch = Math.atan2(1.58 - 1.62, 50);
  room.setInput('a', { ...EMPTY_INPUT, fire: true, ads: true, pitch });
  room.setInput('a', { ...EMPTY_INPUT, fire: true, ads: false, sprint: true, forward: 1, pitch: pitch + 0.01035 });
  assert.equal(shooter.pendingShot.ads, true);
  room.tick(1 / 60);
  assert.equal(target.hp, 0); assert.equal(room.events.find((event) => event.type === 'damage').damage, 150);
  assert.equal(shooter.pendingShot, null); assert.equal(shooter.ammo, 4);
});

test('a sniper tap released between ticks fires exactly once instead of disappearing', () => {
  const { room, shooter, target, now } = setup();
  room.setInput('a', { ...EMPTY_INPUT, fire: true, ads: true }); room.setInput('a', { ...EMPTY_INPUT, fire: false, ads: true }); room.tick(1 / 60);
  assert.equal(target.hp, 0); assert.equal(shooter.ammo, 4);
  now(2400); room.tick(1 / 60); assert.equal(shooter.ammo, 4);
  assert.equal(room.snapshot().players[0].history, undefined); assert.equal(room.snapshot().players[0].pendingShot, undefined);
});

test('bounded target history registers the rendered position without moving the live target', () => {
  const { room, target } = setup();
  target.history = []; room.recordPlayerHistory(target, 900); target.x = 1.2; room.recordPlayerHistory(target, 1000);
  room.setInput('a', { ...EMPTY_INPUT, fire: true, ads: true, viewTime: 900 }); room.tick(1 / 60);
  assert.equal(target.hp, 0); assert.equal(target.x, 1.2);
});

test('shot rewind timestamps are clamped and cannot bypass current spawn protection', () => {
  const { room, shooter, target } = setup(); target.protectedUntil = 3000;
  room.setInput('a', { ...EMPTY_INPUT, fire: true, ads: true, viewTime: -1e12 }); assert.equal(shooter.pendingShot.viewTime, 800);
  room.tick(1 / 60); assert.equal(target.hp, 100);
  assert.equal(room.events.find((event) => event.type === 'shot').rays[0].protectedTarget, 'b');
});

test('standing/crouched shoulders and boots have no visible hitbox gaps', () => {
  const target = { id: 'b', x: 0, y: 0, z: 0, hp: 100, protectedUntil: 0 };
  for (const [crouching, x, y] of [[false, 0.27, 1.50], [true, 0.27, 0.86], [false, 0.12, 0.01]]) {
    target.crouching = crouching;
    const shooter = { id: 'a', x, y: 0, z: 5, yaw: 0, pitch: Math.atan2(y - 1.62, 5) };
    const hit = traceShot(shooter, [shooter, target], 1000, { obstacles: [] }, aimDirection(0, shooter.pitch));
    assert.equal(hit.victim, target, `crouch=${crouching}, height=${y}`);
  }
});

test('seven bots receive seven distinct guns and use the same body damage as players', () => {
  const roster = new Room('GUNS7', { bots: 7 }); assert.equal(new Set([...roster.players.values()].map((p) => p.weaponId)).size, 7);
  const observed = new Set([...roster.players.values()].map((p) => p.weaponId));
  for (let life = 0; life < 3; life++) for (const bot of roster.players.values()) { roster.spawn(bot); observed.add(bot.weaponId); }
  assert.equal(observed.size, 20, 'respawning bots also rotate through the new real-world gun profiles');
  for (const weapon of WEAPONS) {
    const damages = [];
    for (const isBot of [false, true]) {
      const { room, shooter, target } = setup(weapon.id, isBot);
      Object.assign(target, { z: 9, hp: 10000 }); shooter.pitch = Math.atan2(1.0 - 1.62, 1);
      room.shoot(shooter, 1000, true); damages.push(room.events.find((event) => event.type === 'damage')?.damage || 0);
    }
    assert.equal(damages[0], weapon.damage * weapon.pellets, weapon.id); assert.equal(damages[1], damages[0], weapon.id);
  }
  assert.equal(getWeapon('sniper').damage, 100);
});

test('per-room kill/time limits are enforced, bounded and retained on restart', () => {
  assert.deepEqual(normalizeRoundOptions({ fragLimit: 99999, roundSeconds: -4 }), { fragLimit: 200, roundSeconds: 60 });
  let now = 1000; const room = new Room('LIMIT', { bots: 0, fragLimit: 1, roundSeconds: 120, clock: () => now, random: () => 0 });
  const shooter = room.addPlayer('a', 'ALPHA', false, { weaponId: 'sniper' }), target = room.addPlayer('b', 'BRAVO');
  room.world = { ...room.world, obstacles: [] };
  Object.assign(shooter, { x: 0, y: 0, z: 5, yaw: 0, pitch: 0, protectedUntil: 0 }); Object.assign(target, { x: 0, y: 0, z: 0, protectedUntil: 0 });
  room.shoot(shooter, now, true); assert.equal(room.phase, 'ended');
  room.restart('a'); assert.equal(room.phase, 'active'); assert.equal(room.snapshot().room.fragLimit, 1); assert.equal(room.endsAt, now + 120000);
  now += 120001; room.tick(1 / 60); assert.equal(room.phase, 'ended');
});
