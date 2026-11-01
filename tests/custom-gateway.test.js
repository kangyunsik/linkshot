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
