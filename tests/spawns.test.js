import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, hasLineOfSight, RULES } from '../shared/world.js';
import { Room } from '../shared/simulation.js';
import { movePlayer, EMPTY_INPUT, supportHeight } from '../shared/movement.js';

test('all maps offer 24 ground spawns plus second/third-storey and roof spawns without spawn-only walls', () => {
  for (const world of MAPS) {
    assert.equal(world.spawns.filter((s) => s.y === 0).length, 24, world.id);
    assert.ok(world.spawns.some((s) => s.level === 2 && !s.roof)); assert.ok(world.spawns.some((s) => s.level === 3 && !s.roof)); assert.ok(world.spawns.some((s) => s.roof));
    assert.equal(world.obstacles.some((box) => box.spawnCover || box.id.startsWith('spawn-zone-')), false);
    for (const zone of world.spawnZones) assert.ok(zone.coverIds.some((id) => world.obstacles.some((box) => box.id === id)), `${world.id}/${zone.id}: natural cover exists`);
    assert.equal(new Set(world.spawns.map((s) => s.spawnId)).size, world.spawns.length);
  }
});

test('every spawn remains supported and has a physically walkable exit without jumping or collision ejection', () => {
  for (const world of MAPS) for (const spawn of world.spawns) {
    const player = { ...spawn, vy: 0, grounded: true };
    assert.equal(supportHeight(player, world), spawn.y, spawn.spawnId);
    for (let i = 0; i < 12; i++) movePlayer(player, { ...EMPTY_INPUT, yaw: spawn.yaw }, 1 / 60, world);
    assert.equal(player.y, spawn.y); assert.equal(player.x, spawn.x); assert.equal(player.z, spawn.z);
    for (const exit of spawn.exitPath) {
      for (let i = 0; i < 180 && Math.hypot(player.x - exit.x, player.z - exit.z) > 0.12; i++) {
        const yaw = Math.atan2(-(exit.x - player.x), -(exit.z - player.z)); movePlayer(player, { ...EMPTY_INPUT, forward: 0.65, yaw }, 1 / 60, world);
      }
      assert.ok(Math.hypot(player.x - exit.x, player.z - exit.z) <= 0.12, `${spawn.spawnId}: blocked exit`);
      assert.ok(Math.abs(player.y - spawn.y) < 0.01, `${spawn.spawnId}: exit loses its floor`);
    }
  }
});

test('architecture and scenery conceal over 80% of spawn-to-spawn sightlines on each map', () => {
  for (const world of MAPS) {
    let visible = 0, pairs = 0;
    for (const a of world.spawns) for (const b of world.spawns) if (a !== b) {
      pairs++; if (hasLineOfSight({ x: a.x, y: a.y + RULES.eyeHeight, z: a.z }, { x: b.x, y: b.y + RULES.eyeHeight, z: b.z }, world)) visible++;
    }
    assert.ok(visible / pairs < 0.2, `${world.id}: ${visible}/${pairs} exposed pairs`);
  }
});

test('spawn selection distributes all elevations, honours Y and avoids enemies with a clear view', () => {
  for (const world of MAPS) {
    const room = new Room('SAFE2', { mapId: world.id, bots: 0, random: () => 0 }), player = room.addPlayer('a', 'ALPHA'), seen = new Set([player.spawnId]);
    for (let i = 1; i < world.spawns.length; i++) { room.spawn(player); seen.add(player.spawnId); const point = world.spawns.find((p) => p.spawnId === player.spawnId); assert.equal(player.y, point.y); }
    assert.equal(seen.size, world.spawns.length);
    const enemy = room.addPlayer('b', 'BRAVO'); Object.assign(enemy, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 10; i++) {
      room.spawn(player); const from = { x: enemy.x, y: enemy.y + RULES.eyeHeight, z: enemy.z };
      assert.equal(hasLineOfSight(from, { x: player.x, y: player.y + RULES.eyeHeight, z: player.z }, world), false, world.id);
      assert.ok(Math.hypot(player.x - enemy.x, player.y - enemy.y, player.z - enemy.z) >= 8);
    }
  }
});

test('bots follow persistent stair routes both up to third-storey rooftops and back down', () => {
  for (const direction of ['up', 'down']) {
    let now = 1000; const room = new Room('STAIR', { bots: 0, clock: () => now, random: () => 0.5 }), building = room.world.buildings.find((b) => b.storeys === 3);
    const bot = room.addPlayer('bot', 'BOT', true), target = room.addPlayer('human', 'HUMAN');
    Object.assign(bot, { ...(direction === 'up' ? building.entry : building.roof), hp: 1000000, yaw: 0, pitch: 0, vy: 0, grounded: true, protectedUntil: 0, spawnExitPath: [], botPath: [], nextPathAt: 0 });
    Object.assign(target, { ...(direction === 'down' ? building.entry : building.roof), hp: 1000000, protectedUntil: 0 });
    let reached = false;
    for (let i = 0; i < 60 * 60; i++) { now += 1000 / 60; room.tick(1 / 60); if (Math.abs(bot.y - target.y) < 0.15) { reached = true; break; } }
    assert.equal(reached, true, `${direction}: bot stuck at floor height ${bot.y}`);
  }
});
