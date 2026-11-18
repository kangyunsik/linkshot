import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createOnlineEngine } from '../server/online-engine.js';
import { installLanProxy } from '../scripts/lan-proxy.mjs';

const frame = (socket, type) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error(`No ${type} frame`)); }, 4000);
  function receive(raw) { const data = JSON.parse(raw); if (data.type === type) { clearTimeout(timeout); socket.off('message', receive); resolve(data); } }
  socket.on('message', receive);
});
test('the FE LAN proxy creates, joins and plays real guest rooms with Spring unavailable and never touches ranked accounts', async () => {
  let proxy; const server = http.createServer(async (request, response) => { if (proxy && await proxy.info(request, response)) return; response.writeHead(404); response.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, calls = [];
  const client = new Proxy({}, { get: (_, method) => async () => { calls.push(method); throw new Error('Spring is offline'); } });
  const engine = createOnlineEngine({ client, host: '127.0.0.1', port: 0, loop: false, origins: [origin] }), peers = [];
  try {
    const { port } = await engine.listen(); proxy = installLanProxy(server, `ws://127.0.0.1:${port}/lan/play`);
    const connect = async () => { const socket = new WebSocket(origin.replace('http:', 'ws:') + '/lan/play', { origin }); peers.push(socket); await frame(socket, 'hello'); return socket; };
    const a = await connect(), b = await connect();
    let waiting = frame(a, 'joined'); a.send(JSON.stringify({ type: 'create', mode: 'lan', bots: 0, name: 'HOST', mapId: 'foundry', weaponId: 'rifle' })); const first = await waiting;
    waiting = frame(b, 'joined'); b.send(JSON.stringify({ type: 'join', code: first.room.code, name: 'GUEST' })); const second = await waiting;
    assert.equal(second.room.mode, 'lan'); assert.equal(second.players.length, 2); assert.equal(engine.matches.size, 0); assert.equal(engine.custom.directory.rooms.size, 0);
    const info = await (await fetch(origin + '/api/info')).json(); assert.equal(info.rooms[0].code, first.room.code); assert.equal(info.totalPlayers, 2);
    const room = engine.lan.directory.rooms.get(first.room.code), player = room.players.get(first.id), initial = { x: player.x, z: player.z };
    waiting = frame(a, 'pong'); a.send(JSON.stringify({ type: 'input', forward: 1, yaw: player.yaw, spawnCount: player.spawnCount, equipmentSeq: player.equipmentSeq })); a.send(JSON.stringify({ type: 'ping', sent: Date.now() })); await waiting;
    engine.tick(1 / 60); waiting = frame(a, 'state'); engine.broadcast(); const state = await waiting;
    const moved = state.players.find((p) => p.id === first.id); assert.ok(Math.hypot(moved.x - initial.x, moved.z - initial.z) > 0);
    assert.deepEqual(calls, []); assert.equal((await fetch(origin + '/api/account')).status, 404);
    const privateHost = [192, 168, 40, 25].join('.'), lanOrigin = origin.replace('127.0.0.1', privateHost);
    const privatePeer = new WebSocket(`ws://127.0.0.1:${port}/lan/play`, { origin: lanOrigin }); peers.push(privatePeer); assert.equal((await frame(privatePeer, 'hello')).type, 'hello');
    const rejected = new WebSocket(`ws://127.0.0.1:${port}/lan/play`, { origin: `http://${privateHost}:65530` }); peers.push(rejected); rejected.on('error', () => {}); assert.equal(await new Promise(resolve => rejected.once('close', resolve)), 1008);
    const outsider = new WebSocket(origin.replace('http:', 'ws:') + '/lan/play', { origin: 'https://unrelated.invalid' }); peers.push(outsider);
    outsider.on('error', () => {}); const close = await new Promise((resolve) => outsider.once('close', resolve)); assert.notEqual(close, 1000);
  } finally {
    peers.forEach((socket) => socket.terminate()); proxy?.close(); await engine.close(); await new Promise((resolve) => server.close(resolve));
  }
});
test('a LAN proxy cannot be configured to forward arbitrary API paths or credentials', () => {
  const server = http.createServer();
  for (const value of ['http://127.0.0.1:8090/lan/play', 'ws://127.0.0.1:8090/play', 'ws://user:pass@127.0.0.1:8090/lan/play', 'ws://127.0.0.1:8090/lan/play?ticket=secret']) assert.throws(() => installLanProxy(server, value), /LAN_ENGINE_URL/);
});
test('LAN accepts an optional official badge proof without changing guest identity or trusting a client tier', async () => {
  let now = 10000; const origin = 'http://127.0.0.1:4173', tickets = new Map();
  const account = { id: 'canonical-account', competitive: { ffa: { rankTier: 'DIAMOND', rankDivision: 4, rankPoints: 17 }, teams: { rankTier: 'GOLD', rankDivision: 1, rankPoints: 90 } } };
  const engine = createOnlineEngine({ client: { engineId: 'rank-proof-engine', async consumeRankBadge(ticket) { const profile = tickets.get(ticket); tickets.delete(ticket); if (!profile) throw new Error('Invalid proof'); return profile; } }, host: '127.0.0.1', port: 0, loop: false, clock: () => now, origins: [origin] });
  const { port } = await engine.listen(), socket = new WebSocket(`ws://127.0.0.1:${port}/lan/play`, { origin });
  try {
    assert.equal((await frame(socket, 'hello')).rankBadgeEngineId, 'rank-proof-engine');
    let waiting = frame(socket, 'joined'); socket.send(JSON.stringify({ type: 'create', bots: 0, rankBadge: { tier: 'CHALLENGER', ladder: 'teams', division: 1 } })); const joined = await waiting;
    const player = engine.lan.directory.rooms.get(joined.room.code).players.get(joined.id); assert.equal(player.rankBadge, null); assert.notEqual(player.id, account.id);
    const token = 'a'.repeat(43); tickets.set(token, account); waiting = frame(socket, 'rank-profile'); socket.send(JSON.stringify({ type: 'rank-profile', ticket: token })); assert.equal((await waiting).verified, true);
    assert.deepEqual(player.rankBadge, { tier: 'DIAMOND', division: 4, ladder: 'ffa' }); assert.notEqual(player.id, account.id); assert.equal(engine.matches.size, 0);
    now += 5001; waiting = frame(socket, 'rank-profile'); socket.send(JSON.stringify({ type: 'rank-profile', ticket: token, rankBadge: { tier: 'CHALLENGER', ladder: 'teams' } })); assert.equal((await waiting).verified, false); assert.equal(player.rankBadge.tier, 'DIAMOND');
    waiting = frame(socket, 'pong'); socket.send(JSON.stringify({ type: 'rank-profile', clear: true })); socket.send(JSON.stringify({ type: 'ping' })); await waiting; assert.equal(player.rankBadge, null);
  } finally { socket.terminate(); await engine.close(); }
});
