import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom, roomLobbyAction } from '../server/room-lobby.js';
import { RoomDirectory } from '../server/room-directory.js';
import { getWeapon } from '../shared/catalog.js';

function fixture(options = {}) {
  let now = 1000; const room = new LobbyRoom('LOBBY', { bots: 0, gameType: 'teams', clock: () => now, ...options });
  const host = room.addPlayer('host', 'HOST'), guest = room.addPlayer('guest', 'GUEST');
  return { room, host, guest, advance(ms) { now += ms; room.tick(1 / 60); } };
}
test('staged rooms wait without combat, let users compose asymmetric teams and start only after human readiness', () => {
  const { room, host, guest, advance } = fixture(); const start = room.startedAt;
  assert.equal(room.phase, 'lobby'); advance(600_000); assert.equal(room.phase, 'lobby'); assert.equal(host.hp, 0); assert.equal(host.respawnAt, Infinity); assert.equal(room.startedAt, start);
  room.team(guest.id, null, 'blue'); assert.equal(guest.teamId, 'blue'); assert.throws(() => room.start(host.id), /준비/);
  roomLobbyAction(room, guest.id, { type: 'room-ready', ready: true }); assert.throws(() => room.start(host.id), /양 팀/);
  room.bot(host.id, { teamId: 'red', difficulty: 'advanced' }); const bot = [...room.players.values()].find((p) => p.isBot); assert.equal(bot.botDifficulty, 'advanced'); assert.equal(bot.teamId, 'red');
  room.start(host.id); assert.equal(room.phase, 'active'); assert.ok([...room.players.values()].every((p) => p.roomStatus === 'playing' && p.hp === 100)); assert.ok(host.x < bot.x);
  assert.throws(() => room.team(host.id, null, 'red'), /교전 중/); assert.throws(() => room.bot(host.id, { teamId: 'red' }), /경기 시작 전/);
});
test('late members cannot move, shoot, respawn or claim completion before explicitly entering; existing players are not reset', () => {
  const { room, host, guest, advance } = fixture({ fragLimit: 1 }); guest.ready = true; room.start(host.id); const deadline = room.endsAt, life = host.spawnCount; host.ammo = 7; host.hp = 63;
  const late = room.addPlayer('late', 'LATE'); const waitingLife = late.spawnCount; room.setInput(late.id, { fire: true, forward: 1 }); advance(5000);
  assert.equal(late.hp, 0); assert.equal(late.spawnCount, waitingLife); assert.equal(host.spawnCount, life); assert.equal(host.ammo, 7); assert.equal(host.hp, 63); assert.equal(room.endsAt, deadline);
  room.applyDamage(host, guest, 100, false, {}, getWeapon('rifle'), 6000); assert.equal(room.phase, 'ended'); assert.equal(room.result.rewards.late, undefined); assert.ok([...room.players.values()].every((p) => p.roomStatus === 'waiting')); assert.equal(room.result.rewards.host.points, 170);
});
test('lobby actions enforce ownership, loadout entitlement, capacity and wait-only team changes and preserve host migration', () => {
  const { room, host, guest } = fixture(); assert.throws(() => room.bot(guest.id, { teamId: 'red' }), /방장/); assert.throws(() => room.team(guest.id, host.id, 'red'), /자신|방장/);
  assert.throws(() => room.loadout(guest.id, { weaponId: 'm82' }), /보유/); room.loadout(guest.id, { weaponId: 'sniper' }); assert.equal(guest.nextWeaponId, 'sniper');
  for (let i = 0; i < 6; i++) room.bot(host.id, { teamId: 'red' }); assert.throws(() => room.bot(host.id, { teamId: 'blue' }), /가득/);
  room.removePlayer(host.id); assert.equal(room.hostId, guest.id); room.bot(guest.id, { id: [...room.players.values()].find((p) => p.isBot).id, remove: true }); assert.equal(room.players.size, 6);
});
test('returning to a live room removes the combat body without resetting the round or giving waiting users death-only respawns', () => {
  const { room, host, guest, advance } = fixture(); guest.ready = true; room.start(host.id); const round = room.roundId, deadline = room.endsAt;
  room.returnToLobby(guest.id); const life = guest.spawnCount; assert.equal(guest.deaths, 1); room.selectLoadout(guest.id, { weaponId: 'sniper' }); advance(10_000); assert.equal(guest.hp, 0); assert.equal(guest.spawnCount, life);
  room.team(guest.id, null, 'blue'); room.enter(guest.id); assert.equal(guest.hp, 100); assert.equal(guest.spawnCount, life + 1); assert.equal(room.roundId, round); assert.equal(room.endsAt, deadline); assert.equal(host.roomStatus, 'playing');
});
test('staging is opt-in for LAN/custom rooms and never changes legacy solo/LAN/rated simulation contracts', async () => {
  const directory = new RoomDirectory({ mode: 'custom' }), staged = await directory.create({ bots: 0, staging: true }); staged.addPlayer('host', 'HOST');
  assert.equal(staged.phase, 'lobby'); assert.equal(directory.list()[0].staging, true); assert.equal(staged.snapshot().room.staging, true);
  const legacy = await directory.create({ bots: 0 }); assert.equal(legacy.phase, 'active'); assert.equal(roomLobbyAction(legacy, 'host', { type: 'input' }), false); assert.throws(() => roomLobbyAction(legacy, 'host', { type: 'room-start' }), /대기실/);
});
