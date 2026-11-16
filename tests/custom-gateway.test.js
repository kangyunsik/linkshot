import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createOnlineEngine } from '../server/online-engine.js';
import { getWeapon } from '../shared/catalog.js';

function frame(socket, type) {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.off('message', receive); reject(new Error(`No ${type} frame`)); }, 4000); function receive(raw) { const data = JSON.parse(raw); if (data.type !== type) return; clearTimeout(timer); socket.off('message', receive); resolve(data); } socket.on('message', receive); });
}
async function fixture(t) {
  const tickets = new Map(), settlements = [], profiles = [0, 1].map((n) => ({ id: randomUUID(), callsign: `CUSTOM ${n}`, ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: {}, characterId: 'male', outfitId: 'field' }));
  const client = { pending: async () => [], async consumeCustom(token) { const profile = tickets.get(token); tickets.delete(token); if (!profile) throw new Error('Invalid custom ticket'); return profile; }, async complete(...args) { settlements.push(args); } };
  const app = createOnlineEngine({ client, port: 0, loop: false }), info = await app.listen(); t.after(() => app.close());
  const connect = async (profile) => { const socket = new WebSocket(`ws://127.0.0.1:${info.port}/play`); t.after(() => socket.terminate()); await frame(socket, 'hello'); const token = Buffer.from(randomUUID()).toString('base64url').slice(0, 43); tickets.set(token, profile); const ready = frame(socket, 'custom-ready'); socket.send(JSON.stringify({ type: 'authenticate-custom', ticket: token, id: 'forged', ownedWeapons: ['m82'] })); await ready; return socket; };
  return { app, profiles, connect, settlements };
}

test('authenticated WAN users list password-protected team rooms, join with canonical identities and never settle custom results as competitive progress', async (t) => {
  const f = await fixture(t), a = await f.connect(f.profiles[0]), b = await f.connect(f.profiles[1]), password = randomUUID();
  let waiting = frame(a, 'joined'); a.send(JSON.stringify({ type: 'create', roomName: 'WAN FRIENDS', gameType: 'teams', password, bots: 0, fragLimit: 1, weaponId: 'm82', ownedWeapons: ['m82'] })); const first = await waiting, room = f.app.custom.directory.rooms.get(first.room.code);
  assert.equal(first.id, f.profiles[0].id); assert.equal(first.players[0].name, 'CUSTOM 0'); assert.equal(first.players[0].weaponId, 'rifle'); assert.equal(first.room.mode, 'custom');
  waiting = frame(b, 'rooms'); b.send(JSON.stringify({ type: 'list' })); const listing = await waiting; assert.equal(listing.rooms[0].passwordProtected, true); assert.equal(JSON.stringify(listing).includes(password), false);
  waiting = frame(b, 'error'); b.send(JSON.stringify({ type: 'join', code: room.code, password: 'bad' })); assert.equal((await waiting).code, 'ROOM_PASSWORD'); assert.equal(room.players.size, 1);
  waiting = frame(b, 'joined'); b.send(JSON.stringify({ type: 'join', code: room.code, password })); const joined = await waiting; assert.deepEqual(new Set(joined.players.map((p) => p.teamId)), new Set(['blue', 'red']));
  waiting = frame(b, 'error'); b.send(JSON.stringify({ type: 'restart' })); assert.match((await waiting).message, /방장/);
  room.applyDamage(room.players.get(f.profiles[0].id), room.players.get(f.profiles[1].id), 100, false, {}, getWeapon('rifle'), Date.now()); const state = frame(a, 'state'); f.app.broadcast(); const result = await state; assert.equal(result.room.result.winnerTeam, 'blue'); assert.ok(Object.values(result.room.result.rewards).every((reward) => reward.points === 0)); assert.equal(f.settlements.length, 0);
  a.send(JSON.stringify({ type: 'restart' })); const barrier = frame(a, 'pong'); a.send(JSON.stringify({ type: 'ping' })); await barrier; assert.equal(room.phase, 'active'); assert.deepEqual(room.teamScores, { blue: 0, red: 0 });
  waiting = frame(a, 'left'); a.send(JSON.stringify({ type: 'leave' })); await waiting; assert.equal(room.hostId, f.profiles[1].id);
});

test('canonical online IDs and profile callsigns retain all 24 characters in real room snapshots', async (t) => {
  const f = await fixture(t); f.profiles[0].callsign = 'account_' + 'a'.repeat(16); f.profiles[1].callsign = '가'.repeat(24);
  const a = await f.connect(f.profiles[0]), b = await f.connect(f.profiles[1]);
  let pending = frame(a, 'joined'); a.send(JSON.stringify({ type: 'create', gameType: 'ffa', bots: 0 })); const created = await pending;
  pending = frame(b, 'joined'); b.send(JSON.stringify({ type: 'join', code: created.room.code })); const joined = await pending;
  for (const profile of f.profiles) assert.equal(joined.players.find((p) => p.id === profile.id).name, profile.callsign);
});

test('WAN staging keeps canonical accounts in a server-owned team lobby until readiness/start or explicit late entry', async (t) => {
  const f = await fixture(t), a = await f.connect(f.profiles[0]), b = await f.connect(f.profiles[1]);
  let waiting = frame(a, 'joined'); a.send(JSON.stringify({ type: 'create', staging: true, gameType: 'teams', bots: 0, fragLimit: 1 })); const first = await waiting, room = f.app.custom.directory.rooms.get(first.room.code);
  assert.equal(first.room.phase, 'lobby'); assert.equal(first.players[0].roomStatus, 'waiting'); assert.equal(first.players[0].hp, 0);
  waiting = frame(b, 'joined'); b.send(JSON.stringify({ type: 'join', code: room.code })); await waiting;
  waiting = frame(b, 'error'); b.send(JSON.stringify({ type: 'room-start' })); assert.match((await waiting).message, /방장/);
  waiting = frame(b, 'error'); b.send(JSON.stringify({ type: 'room-loadout', weaponId: 'm82' })); assert.match((await waiting).message, /보유/);
  const barrier = (socket, data) => { const done = frame(socket, 'pong'); socket.send(JSON.stringify(data)); socket.send(JSON.stringify({ type: 'ping' })); return done; };
  await barrier(b, { type: 'room-team', teamId: 'red' }); await barrier(b, { type: 'room-ready', ready: true }); await barrier(a, { type: 'room-start' }); assert.equal(room.phase, 'active');
  const lateProfile = { ...f.profiles[0], id: randomUUID(), callsign: 'LATE' }, c = await f.connect(lateProfile);
  waiting = frame(c, 'joined'); c.send(JSON.stringify({ type: 'join', code: room.code })); const late = await waiting; assert.equal(late.players.find((p) => p.id === lateProfile.id).roomStatus, 'waiting');
  room.applyDamage(room.players.get(f.profiles[0].id), room.players.get(f.profiles[1].id), 100, false, {}, getWeapon('rifle'), Date.now()); assert.equal(room.phase, 'ended'); assert.equal(room.result.rewards[lateProfile.id], undefined); assert.ok(Object.values(room.result.rewards).every((reward) => reward.points === 0)); assert.equal(f.settlements.length, 0);
});

for (const [gameType, mapId] of [['hardpoint', 'relay'], ['defense', 'bastion']]) test(`authenticated WAN ${gameType} enforces map compatibility, canonical teams and noncompetitive settlement`, async (t) => {
  const f = await fixture(t), a = await f.connect(f.profiles[0]), b = await f.connect(f.profiles[1]);
  let waiting = frame(a, 'error'); a.send(JSON.stringify({ type: 'create', gameType: 'ffa', mapId, bots: 0 })); assert.match((await waiting).message, /이용할 수 없습니다/); assert.equal(f.app.custom.directory.rooms.size, 0);
  waiting = frame(a, 'joined'); a.send(JSON.stringify({ type: 'create', staging: true, gameType, mapId, bots: 0, waves: 1, scoreLimit: 30, id: 'forged', ownedWeapons: ['m82'], weaponId: 'm82' }));
  const joined = await waiting, room = f.app.custom.directory.rooms.get(joined.room.code); assert.equal(joined.id, f.profiles[0].id); assert.equal(joined.players[0].weaponId, 'rifle');
  waiting = frame(b, 'joined'); b.send(JSON.stringify({ type: 'join', code: room.code })); const guest = await waiting; assert.equal(guest.id, f.profiles[1].id);
  const barrier = async (socket, data) => { const done = frame(socket, 'pong'); socket.send(JSON.stringify(data)); socket.send(JSON.stringify({ type: 'ping' })); await done; };
  if (gameType === 'hardpoint') await barrier(b, { type: 'room-team', teamId: 'red' });
  else { assert.ok(guest.players.every((p) => p.teamId === 'blue')); waiting = frame(b, 'error'); b.send(JSON.stringify({ type: 'room-team', teamId: 'red' })); assert.match((await waiting).message, /같은 수비팀/); }
  await barrier(b, { type: 'room-ready', ready: true }); await barrier(a, { type: 'room-start' }); assert.equal(room.phase, 'active');
  waiting = frame(a, 'error'); a.send(JSON.stringify({ type: 'room-objective-score', score: 99999, coreHealth: 0 })); assert.match((await waiting).message, /지원하지 않는/); assert.equal(room.teamScores.blue, 0);
  if (gameType === 'hardpoint') {
    const host = room.players.get(f.profiles[0].id), point = room.world.hardpoints[0]; Object.assign(host, { x: point.x, y: point.y, z: point.z, protectedUntil: 0 });
    for (let i = 0; i < 120; i++) room.objectives.tick(.25, Date.now());
  } else {
    room.objectives.state.startsAt = Date.now() - 1; room.tick(.05); const enemy = [...room.players.values()].find((p) => p.isWaveEnemy); room.objectives.damageCore(enemy, 99999);
  }
  waiting = frame(a, 'state'); f.app.broadcast(); const state = await waiting; assert.equal(state.room.phase, 'ended'); assert.ok(Object.values(state.room.result.rewards).every((reward) => reward.points === 0)); assert.equal(f.settlements.length, 0);
});
