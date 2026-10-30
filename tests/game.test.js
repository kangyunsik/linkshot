import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, traceShot, findPath, cleanName } from '../server/game.js';
import { WORLD, RULES, rayBox, aimDirection, hasLineOfSight, bounds } from '../shared/world.js';
import { movePlayer, sanitizeInput, EMPTY_INPUT } from '../shared/movement.js';

const player = (overrides = {}) => ({ id: 'p', x: 24, y: 0, z: 18, yaw: 0, pitch: 0, vy: 0, hp: 100, grounded: true, protectedUntil: 0, ...overrides });
const input = (overrides = {}) => ({ ...EMPTY_INPUT, ...overrides });

test('movement is normalized, frame-rate independent, and cannot cross cover', () => {
  const p = player();
  for (let i = 0; i < 60; i++) movePlayer(p, input({ forward: 1 }), 1 / 60);
  assert.ok(Math.abs(p.z - (18 - RULES.walkSpeed)) < 0.001);
  const diagonal = player({ x: 21, z: 19 });
  movePlayer(diagonal, input({ forward: 1, strafe: 1 }), 1 / 60);
  assert.ok(Math.abs(Math.hypot(diagonal.x - 21, diagonal.z - 19) - RULES.walkSpeed / 60) < 0.001);
  const cover = player({ x: 0, z: -12 });
  const coverWorld = { ...WORLD, obstacles: [WORLD.obstacles.find((box) => box.id === 'low-n')] };
  for (let i = 0; i < 120; i++) movePlayer(cover, input({ forward: 1 }), 1 / 60, coverWorld);
  assert.ok(cover.z >= -14.66 - 0.001);
  assert.ok(cover.z <= -14.65);
});

test('jump returns to the ground, holding jump cannot auto-bounce, and release re-arms it', () => {
  const p = player(); let highest = 0;
  for (let i = 0; i < 100; i++) { movePlayer(p, input({ jump: true }), 1 / 60); highest = Math.max(highest, p.y); }
  assert.ok(highest > 2 && highest < 2.15);
  assert.equal(p.y, 0); assert.equal(p.grounded, true);
  movePlayer(p, input(), 1 / 60); movePlayer(p, input({ jump: true }), 1 / 60);
  assert.ok(p.y > 0);
});

test('input rejects non-finite values, position spoofing, and truthy strings', () => {
  const result = sanitizeInput({ forward: 500, strafe: -500, yaw: NaN, pitch: Infinity, fire: 'true', jump: 1, x: 999999 });
  assert.deepEqual(result, input({ forward: 1, strafe: -1 }));
  assert.equal(cleanName('<hello>\u0000'), 'hello');
  assert.equal(cleanName(null), 'OPERATOR');
});

test('ray-box handles parallel rays and line of sight respects the reactor', () => {
  assert.equal(rayBox({ x: 0, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }, WORLD.obstacles.find((b) => b.id === 'reactor')), 7.5);
  assert.equal(rayBox({ x: 10, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }, WORLD.obstacles.find((b) => b.id === 'reactor')), null);
  assert.equal(hasLineOfSight({ x: 0, y: 1.6, z: 8 }, { x: 0, y: 1.6, z: -8 }), false);
  assert.equal(hasLineOfSight({ x: 24, y: 1.6, z: 8 }, { x: 24, y: 1.6, z: -8 }), true);
  assert.deepEqual(aimDirection(0, 0), { x: -0, y: 0, z: -1 });
});

test('hitscan distinguishes heads and bodies, cover blocks shots, and spawn protection works', () => {
  const shooter = player({ id: 'shooter', z: 10 });
  const victim = player({ id: 'victim', z: 0 });
  let hit = traceShot(shooter, [shooter, victim], 1000);
  assert.equal(hit.victim, victim); assert.equal(hit.headshot, true);
  shooter.pitch = Math.atan2(-0.55, 10);
  hit = traceShot(shooter, [shooter, victim], 1000);
  assert.equal(hit.victim, victim); assert.equal(hit.headshot, false);
  victim.protectedUntil = 2000;
  assert.equal(traceShot(shooter, [shooter, victim], 1000).victim, null);
  Object.assign(shooter, { x: 0, z: 8, pitch: 0 }); Object.assign(victim, { x: 0, z: -8, protectedUntil: 0 });
  assert.equal(traceShot(shooter, [shooter, victim], 1000).victim, null);
});

test('server-authoritative fire consumes ammo, scores kills and respawns the victim', () => {
  let now = 1000; const room = new Room('TEST2', { bots: 0, clock: () => now });
  const shooter = room.addPlayer('a', 'ALPHA'), victim = room.addPlayer('b', 'BRAVO');
  Object.assign(shooter, { x: 24, z: 10, y: 0, yaw: 0, pitch: 0, protectedUntil: 0 });
  Object.assign(victim, { x: 24, z: 0, y: 0, protectedUntil: 0 });
  room.setInput('a', input({ fire: true }));
  for (let i = 0; i < 20; i++) { now += 17; room.tick(1 / 60); }
  assert.equal(victim.hp, 0); assert.equal(shooter.kills, 1); assert.equal(victim.deaths, 1);
  assert.ok(shooter.ammo < RULES.magazine);
  assert.ok(room.events.some((e) => e.type === 'kill' && e.headshot));
  now = victim.respawnAt + 1; room.setInput('a', input()); room.tick(1 / 60);
  assert.equal(victim.hp, 100); assert.equal(victim.ammo, RULES.magazine); assert.ok(victim.protectedUntil > now);
});

test('reload has a real server-side delay and stale input stops firing', () => {
  let now = 1000; const room = new Room('TEST3', { bots: 0, clock: () => now });
  const p = room.addPlayer('a', 'ALPHA'); p.ammo = 7;
  room.setInput('a', input({ reload: true })); room.tick(1 / 60);
  assert.equal(p.ammo, 7); assert.equal(p.reloadUntil, now + 1750);
  now += 1000; room.tick(1 / 60); assert.equal(p.ammo, 7);
  now += 800; room.tick(1 / 60); assert.equal(p.ammo, 30); assert.equal(p.reloadUntil, 0);
  room.setInput('a', input({ fire: true, forward: 1 })); now += 600;
  const z = p.z; room.tick(1 / 60); assert.equal(p.ammo, 30); assert.equal(p.z, z);
});

test('match clock, host-only restart, host migration and bot replacement work', () => {
  let now = 1000; const room = new Room('TEST4', { bots: 4, clock: () => now });
  room.addPlayer('a', 'ALPHA'); room.addPlayer('b', 'BRAVO');
  assert.equal(room.hostId, 'a'); assert.throws(() => room.restart('b'), /방장/);
  now += 300001; room.tick(1 / 60); assert.equal(room.phase, 'ended');
  room.players.get('a').kills = 15; room.restart('a'); assert.equal(room.phase, 'active'); assert.equal(room.players.get('a').kills, 0);
  room.removePlayer('a'); assert.equal(room.hostId, 'b');
  for (let i = 0; i < 5; i++) room.addPlayer(`human${i}`, `H${i}`);
  assert.equal(room.players.size, 8); assert.equal([...room.players.values()].filter((p) => p.isBot).length, 2);
});

test('navigation produces a path around solid cover rather than through it', () => {
  const world = { ...WORLD, id: 'navigation-regression', obstacles: [WORLD.obstacles.find((box) => box.id === 'reactor')] };
  const path = findPath({ x: 0, z: 8 }, { x: 0, z: -8 }, world);
  assert.ok(path.length > 4);
  for (const point of path) for (const box of world.obstacles) {
    const b = bounds(box, 0.5);
    assert.ok(!(point.x > b.minX && point.x < b.maxX && point.z > b.minZ && point.z < b.maxZ));
  }
});

test('bots navigate, fire and score in a free-for-all match with humans and other bots', () => {
  let now = 1000, seed = 7;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const room = new Room('BOT22', { bots: 3, clock: () => now, random });
  room.addPlayer('human', 'OPERATOR');
  const origins = new Map([...room.players.values()].map((p) => [p.id, { x: p.x, z: p.z }]));
  for (let i = 0; i < 45 * 60; i++) { now += 1000 / 60; room.tick(1 / 60); }
  assert.ok(room.events.filter((e) => e.type === 'shot').length > 10);
  assert.ok([...room.players.values()].some((p) => p.isBot && p.kills > 0));
  assert.ok([...room.players.values()].some((p) => p.isBot && Math.hypot(p.x - origins.get(p.id).x, p.z - origins.get(p.id).z) > 8));
});

test('every spawn faces into the arena rather than the outer wall', () => {
  for (const spawn of WORLD.spawns) {
    const direction = aimDirection(spawn.yaw, 0), distance = Math.hypot(spawn.x, spawn.z);
    const dot = (direction.x * -spawn.x + direction.z * -spawn.z) / distance;
    assert.ok(dot > 0.99, `spawn ${spawn.x}, ${spawn.z} faces outwards`);
  }
});

test('snapshots serialize only public state and flush events exactly once', () => {
  const room = new Room('TEST5', { bots: 1 }); room.addPlayer('a', 'ALPHA');
  const first = room.snapshot(); assert.ok(first.events.length > 0);
  assert.equal(first.players[0].input, undefined); assert.equal(first.players[0].botPath, undefined);
  assert.equal(room.snapshot().events.length, 0);
  assert.doesNotThrow(() => JSON.stringify(first));
});
