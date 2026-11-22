import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../shared/simulation.js';
import { RULES, getMap, hasLineOfSight, playerPose } from '../shared/world.js';
import { botFirePoint } from '../shared/bot-vantage.js';
import { botSniperAimMs } from '../shared/bot-awareness.js';

function upperRoom(from, destination, weaponId = 'rifle', difficulty = 'advanced') {
  let now = 1000;
  const room = new Room('LOOKOUT', { mapId: 'foundry', bots: 0, botDifficulty: difficulty, clock: () => now, random: () => .5 });
  const bot = room.addPlayer('watch-bot', 'WATCH', true, { weaponId });
  const enemy = room.addPlayer('enemy', 'ENEMY');
  Object.assign(bot, { ...from, yaw: 0, pitch: 0, hp: 1e6, protectedUntil: 0, grounded: true, spawnExitPath: [] });
  Object.assign(enemy, { ...destination, hp: 1e6, protectedUntil: 0 });
  return {
    room, bot, enemy,
    tick() {
      now += 1000 / 60;
      room.tick(1 / 60);
      return { now, events: room.events.splice(0) };
    },
  };
}

test('a bot finds a real second-storey window and hits a lower enemy without leaving the floor', () => {
  const building = getMap('foundry').buildings.find(item => item.id === 'operations-tower-0');
  const entry = building.stairs[0].flights[0].at(-1);
  const enemy = { x: 10, y: 0, z: -34 / 3 };
  const { room, bot, tick } = upperRoom(entry, enemy);
  const standingEye = { ...bot, y: bot.y + RULES.eyeHeight };
  assert.equal(botFirePoint(standingEye, enemy, room.world), null, 'the fixture initially has no shot');
  let hits = 0, firstShot = null;
  for (let i = 0; i < 8 * 60; i++) {
    const { now, events } = tick();
    assert.equal(bot.y, 3); assert.equal(bot.stairRouteKey, null);
    for (const shot of events.filter(event => event.type === 'shot' && event.id === bot.id)) {
      firstShot ??= now; hits += Number(shot.hit === 'enemy');
      assert.equal(shot.origin.y, 3 + RULES.eyeHeight);
    }
  }
  assert.ok(bot.z < entry.z - 2 && firstShot > 1500 && hits >= 3, `${hits} hits after moving to the window`);
});

test('a sniper finds a roof edge and keeps the existing stationary aim delay for each shot', () => {
  const building = getMap('foundry').buildings.find(item => item.id === 'operations-tower-0');
  const { room, bot, enemy, tick } = upperRoom(building.roof, { x: -6.5, y: 0, z: -21.5 }, 'sniper');
  assert.equal(botFirePoint({ ...bot, y: bot.y + RULES.eyeHeight }, enemy, room.world), null);
  let hits = 0;
  for (let i = 0; i < 10 * 60; i++) {
    const { now, events } = tick();
    assert.equal(bot.y, building.height);
    for (const e of events.filter(event => event.type === 'shot' && event.id === bot.id)) {
      hits += Number(e.hit === enemy.id);
      assert.ok(bot.moveSpeed < .2 && bot.grounded);
      const { sniperAimStartedAt, sniperAimDistance, sniperAimRoll } = bot.botBrain;
      assert.ok(now - sniperAimStartedAt >= botSniperAimMs(sniperAimDistance, room.botBehavior, sniperAimRoll) - .001);
      assert.ok(botFirePoint(e.origin, enemy, room.world), 'the roof rail must leave the chosen target exposed');
    }
  }
  assert.ok(bot.z < building.roof.z - 2 && hits > 1, `roof hits: ${hits}`);
});

test('a blocked roof has a finite wait and then walks downstairs without restarting the hold on landings', () => {
  const { roof, entry } = getMap('foundry').buildings.find(item => item.storeys === 3);
  const { bot, tick } = upperRoom(roof, entry);
  let firstStair = null, reachedGround = false;
  for (let i = 0; i < 24 * 60; i++) {
    const { now, events } = tick();
    if (now < 4000) {
      assert.equal(bot.y, roof.y); assert.equal(bot.stairRouteKey, null);
      assert.ok(!events.some(event => event.type === 'shot' && event.id === bot.id));
    }
    if (bot.stairRouteKey) firstStair ??= now;
    if (bot.y === 0) { reachedGround = true; break; }
  }
  assert.ok(firstStair >= 4400 && firstStair <= 6200, String(firstStair));
  assert.ok(reachedGround);
});

test('a partially open shot aims at the exposed head rather than a torso behind solid geometry', () => {
  const world = { ...getMap('foundry'), obstacles: [{ id: 'cover', x: 0, y: 0, z: -4, w: 3, d: .8, h: 1.48 }] };
  const shooter = { x: 0, y: 1.62, z: 0 }, target = { x: 0, y: 0, z: -8 };
  assert.equal(hasLineOfSight(shooter, { ...target, y: playerPose(target).aimHeight }, world), false);
  assert.equal(botFirePoint(shooter, target, world).y, playerPose(target).headHeight);
  world.obstacles[0] = { ...world.obstacles[0], h: 2 };
  assert.equal(botFirePoint(shooter, target, world), null);
});
