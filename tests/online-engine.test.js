import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createOnlineEngine } from '../server/online-engine.js';

function message(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error(`No ${type} frame`)); }, 3000);
    function receive(raw) { const data = JSON.parse(raw.toString()); if (data.type !== type) return; clearTimeout(timer); socket.off('message', receive); resolve(data); }
    socket.on('message', receive);
  });
}
async function fixture(t, { mode = 'RANKED', bots = 0, clock } = {}) {
  const id = randomUUID(), players = [0, 1].map((i) => ({ id: randomUUID(), callsign: `HUMAN ${i}`, ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: {}, casualRating: 1000 }));
  const tickets = new Map(), results = [], plan = { id, mode, bots, players, mapId: 'foundry', fragLimit: 1, roundSeconds: 60 }, client = {
    pending: async () => [id], claim: async () => plan, heartbeat: async () => {}, cancel: async () => {},
    async consume(matchId, ticket) { const player = tickets.get(ticket); tickets.delete(ticket); if (matchId !== id || !player) throw new Error('Invalid ticket'); return player; },
    async complete(matchId, roster) { results.push({ id: matchId, roster }); return { settled: true }; },
  };
  const app = createOnlineEngine({ client, port: 0, host: '127.0.0.1', loop: false, ...(clock ? { clock } : {}) }), info = await app.listen(); t.after(() => app.close());
  const join = async (profile, extra = {}) => {
    const socket = new WebSocket(`ws://127.0.0.1:${info.port}/play`); t.after(() => socket.terminate()); await message(socket, 'hello');
    const ticket = Buffer.from(randomUUID()).toString('base64url').slice(0, 43); tickets.set(ticket, profile); const joined = message(socket, 'joined'); socket.send(JSON.stringify({ type: 'authenticate', matchId: id, ticket, ...extra })); socket.joined = await joined; return socket;
  };
  return { app, id, players, plan, client, join, results, port: info.port };
}

test('the online gateway consumes Spring tickets, ignores spoofed identity/ownership and requires every assigned human before starting', async (t) => {
  const f = await fixture(t, { mode: 'CASUAL' }); const a = await f.join(f.players[0], { ownedWeapons: ['m82'], weaponId: 'm82', id: f.players[1].id });
  const match = f.app.matches.get(f.id); assert.equal(match.room.phase, 'waiting'); assert.equal(match.room.players.get(f.players[0].id).weaponId, 'rifle');
  assert.equal([...match.room.players.values()].some((player) => player.isBot), false);
  await f.join(f.players[1]); assert.equal(match.room.phase, 'active'); assert.equal(match.room.hostId, null); assert.equal(match.room.roundId, f.id);
  const error = message(a, 'error'); a.send(JSON.stringify({ type: 'create', mode: 'ranked', bots: 7 })); assert.match((await error).message, /중앙 서버/);
});

test('ranked weapon access is temporary and does not mutate the canonical online ownership profile', async (t) => {
  const f = await fixture(t); await f.join(f.players[0], { weaponId: 'm82' }); await f.join(f.players[1]);
  const player = f.app.matches.get(f.id).room.players.get(f.players[0].id); assert.equal(player.weaponId, 'm82'); assert.equal(player.ownedWeapons.length, 20); assert.equal(f.players[0].ownedWeapons.includes('m82'), false);
});

test('ranked AI assignments are rejected even if a compromised planner sends one', async (t) => {
  const f = await fixture(t, { bots: 1 }); await assert.rejects(() => f.app.load(f.id), /Invalid authoritative/); assert.equal(f.app.matches.size, 0);
});

test('online authoritative kills settle the original round ID and complete canonical weapon ledgers once', async (t) => {
  const f = await fixture(t); await f.join(f.players[0]); await f.join(f.players[1]);
  const match = f.app.matches.get(f.id), room = match.room, a = room.players.get(f.players[0].id), b = room.players.get(f.players[1].id);
  room.world = { ...room.world, width: 100, depth: 100, obstacles: [] };
  Object.assign(a, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectedUntil: 0 }); Object.assign(b, { x: 0, y: 0, z: -1, hp: 1, protectedUntil: 0 });
  room.setInput(a.id, { fire: true, yaw: 0, spawnCount: a.spawnCount, equipmentSeq: a.equipmentSeq }); f.app.tick(1 / 60);
  await Promise.resolve(); f.app.tick(1 / 60); assert.equal(match.settlement, 'saved'); assert.equal(f.results.length, 1); assert.equal(f.results[0].id, f.id);
  assert.equal(f.results[0].roster.find((player) => player.id === a.id).weaponKills.rifle, 1); assert.equal(b.hp, 0); assert.equal(room.droppedWeapons.size, 1);
});

test('reconnecting within the grace window retains the same player/life and never fills a disconnected ranked slot with AI', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now }); const a = await f.join(f.players[0]); await f.join(f.players[1]);
  const match = f.app.matches.get(f.id), player = match.room.players.get(f.players[0].id), life = player.spawnCount; player.hp = 75; player.ammo = 9;
  const closed = new Promise((resolve) => a.once('close', resolve)); a.close(); await closed;
  for (let i = 0; i < 20; i++) { if (!match.sockets.has(player.id)) break; await new Promise((resolve) => setImmediate(resolve)); }
  match.room.impacts.set('wall', { id: 'persistent-shot', at: now, point: { x: 0, y: 1, z: 0 } });
  now += 5000; const restored = await f.join(f.players[0]); assert.equal(player.hp, 75); assert.equal(player.ammo, 9); assert.equal(player.spawnCount, life); assert.equal(restored.joined.impacts[0].id, 'persistent-shot');
  assert.equal([...match.room.players.values()].some((player) => player.isBot), false);
});

test('the thirty-second grace expiry marks a leaver last, submits abandonment and never spawns a replacement AI', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now }); const a = await f.join(f.players[0]); await f.join(f.players[1]); const notices = []; f.client.abandon = async (match, account) => notices.push({ match, account });
  const match = f.app.matches.get(f.id), player = match.room.players.get(f.players[0].id); player.kills = 9;
  const closed = new Promise((resolve) => a.once('close', resolve)); a.close(); await closed; await new Promise((resolve) => setImmediate(resolve));
  now += 29_999; f.app.tick(1 / 60); assert.equal(player.abandoned, undefined); assert.equal(match.room.phase, 'active');
  now++; f.app.tick(1 / 60); await Promise.resolve(); assert.equal(player.abandoned, true); assert.equal(player.hp, 0); assert.equal(player.respawnAt, Infinity); assert.equal(match.room.phase, 'ended'); assert.equal(match.room.result.winnerId, f.players[1].id); assert.equal(match.room.result.rewards[player.id].points, 0);
  assert.deepEqual(notices, [{ match: f.id, account: player.id }]); assert.equal(f.results.length, 1); assert.equal(f.results[0].roster.find((entry) => entry.id === player.id).abandoned, true); assert.equal([...match.room.players.values()].some((entry) => entry.isBot), false);
});

test('a disconnect during the grace window cannot retroactively rewrite an already completed result as abandonment', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now }); const a = await f.join(f.players[0]); await f.join(f.players[1]); const match = f.app.matches.get(f.id), player = match.room.players.get(f.players[0].id);
  const closed = new Promise((resolve) => a.once('close', resolve)); a.close(); await closed; await new Promise((resolve) => setImmediate(resolve)); match.room.finish(); f.app.tick(1 / 60); await Promise.resolve();
  now += 30_001; f.app.tick(1 / 60); assert.equal(player.abandoned, undefined); assert.equal(f.results.length, 1); assert.equal(f.results[0].roster.find((entry) => entry.id === player.id).abandoned, false);
});
