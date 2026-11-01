import test from 'node:test';
import assert from 'node:assert/strict';
import { TutorialSession, TUTORIAL_STEPS } from '../shared/tutorial.js';
import { MAPS, RULES, playerPose } from '../shared/world.js';

function fixture() {
  let now = 10_000;
  const tutorial = new TutorialSession('student', 'STUDENT', { characterId: 'female', skinId: 'arctic' }, { clock: () => now, random: () => .5 });
  const advance = (ms, input = {}, untilStage = tutorial.stage) => {
    const end = now + ms;
    while (now < end && tutorial.stage === untilStage && !tutorial.completed) {
      now += 1000 / 60; tutorial.setInput({ yaw: tutorial.player.yaw, pitch: tutorial.player.pitch, ...input, spawnCount: tutorial.player.spawnCount, equipmentSeq: tutorial.player.equipmentSeq }); tutorial.tick(1 / 60);
    }
  };
  return { tutorial, advance, now: () => now };
}

test('the dedicated tutorial is local-only, excluded from multiplayer maps and uses ordinary combat/equipment rules', () => {
  const { tutorial } = fixture(), data = tutorial.snapshot();
  assert.equal(data.room.mode, 'tutorial'); assert.equal(data.room.mapId, 'training'); assert.equal(MAPS.some((map) => map.id === 'training'), false);
  assert.equal(data.tutorial.total, TUTORIAL_STEPS.length); assert.equal(data.players.length, 1); assert.equal(data.players[0].characterId, 'female'); assert.equal(data.players[0].ammo, 30);
  assert.equal(data.room.result, null); assert.equal(data.tutorial.completed, false); assert.equal(data.tutorial.goals.every((goal) => !goal.done), true);
});

test('real movement, shots, ground-gun swaps and an explicitly confirmed respawn complete training', () => {
  const f = fixture(), { tutorial: t, advance } = f, p = t.player;
  advance(1500, { forward: 1, sprint: true, yaw: .5 }); assert.equal(t.stage, 1);
  advance(100, { jump: true }); advance(1200); advance(200, { crouch: true });
  Object.assign(p, { x: 6, y: 0, z: 7.2, vy: 0, grounded: true, yaw: 0 }); advance(2000, { forward: .65, yaw: 0 });
  assert.equal(t.stage, 2); assert.equal(p.y, 1.2);
  const aim = () => { const target = t.opponent, horizontal = Math.hypot(target.x - p.x, target.z - p.z); return { yaw: Math.atan2(-(target.x - p.x), -(target.z - p.z)), pitch: Math.atan2(target.y + playerPose(target).headHeight - p.y - playerPose(p).eyeHeight, horizontal) }; };
  advance(1500, { ...aim(), fire: true, ads: true }); advance(2000, { reload: true }); assert.equal(t.stage, 3);
  let action = 0;
  const interact = () => t.interactEquipment({ roundId: t.room.roundId, spawnCount: p.spawnCount, equipmentSeq: p.equipmentSeq, actionSeq: ++action });
  advance(500); assert.equal(interact(), true); assert.equal(p.weaponId, 'mp5'); advance(500); assert.equal(interact(), true); advance(50); assert.equal(t.stage, 4);
  advance(1500, { ...aim(), fire: true, ads: true }); assert.equal(t.stage, 5); assert.ok(p.hp > 0);
  const command = (action) => t.command({ action, roundId: t.room.roundId, spawnCount: p.spawnCount });
  advance(500); assert.ok(p.hp > 0); assert.equal(command('confirm-respawn'), false); assert.equal(command('start-respawn'), true); advance(1700); assert.equal(p.hp, 0);
  const life = p.spawnCount; assert.equal(p.respawnAt - p.diedAt, RULES.respawnSeconds * 1000); advance(3200);
  assert.equal(p.spawnCount, life + 1); assert.equal(p.hp, 100); assert.equal(t.completed, false); assert.equal(t.room.phase, 'active'); assert.equal(command('confirm-respawn'), false);
  advance(2100); assert.equal(t.completed, false); assert.equal(command('confirm-respawn'), true); advance(50);
  assert.equal(t.completed, true); assert.equal(t.room.phase, 'training-complete'); assert.equal(t.snapshot().room.result, null);
});

test('dying keeps the lesson checkpoint; restarting clears objectives, enemies, drops and the previous round', () => {
  const { tutorial: t, advance } = fixture(); advance(1500, { forward: 1, sprint: true, yaw: .5 }); assert.equal(t.stage, 1);
  t.player.hp = 0; t.player.respawnAt = t.room.clock() + 100; advance(200); assert.equal(t.stage, 1); assert.equal(t.player.hp, 100);
  t.room.dropWeapon(t.player); const round = t.room.roundId; t.restart();
  assert.notEqual(t.room.roundId, round); assert.equal(t.stage, 0); assert.equal(t.player.kills, 0); assert.equal(t.room.players.size, 1); assert.equal(t.room.droppedWeapons.size, 0); assert.equal(t.goals().some((goal) => goal.done), false);
});
