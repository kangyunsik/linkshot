import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';

function message(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', handle); reject(new Error(`Timed out waiting for ${type}`)); }, 4000);
    function handle(raw) { const data = JSON.parse(raw.toString()); if (data.type !== type) return; clearTimeout(timer); socket.off('message', handle); resolve(data); }
    socket.on('message', handle);
  });
}
async function client(base, options) {
  const socket = new WebSocket(base.replace('http', 'ws') + '/play', options);
  const hello = await message(socket, 'hello');
  return { socket, hello, send: (data) => socket.send(JSON.stringify(data)) };
}
const close = (socket) => new Promise((resolve) => { if (socket.readyState === WebSocket.CLOSED) resolve(); else { socket.once('close', resolve); socket.close(); } });

test('HTTP serves the client and whitelisted modules without exposing project files', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }); const info = await app.listen(); t.after(() => app.close());
  const base = `http://127.0.0.1:${info.port}`;
  assert.match(await (await fetch(base)).text(), /LINKSHOT/);
  const shared = await fetch(`${base}/shared/world.js`); assert.equal(shared.status, 200); assert.match(shared.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/vendor/three.core.js`)).status, 200);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/server/index.js`)).status, 404);
  assert.notEqual((await fetch(`${base}/..%2fpackage.json`)).status, 200);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  const status = await (await fetch(`${base}/api/info`)).json(); assert.equal(status.port, info.port); assert.deepEqual(status.rooms, []);
});

test('two real WebSocket clients create, join, move, list, and clean up a LAN room', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }); const info = await app.listen(); t.after(() => app.close());
  const base = `http://127.0.0.1:${info.port}`;
  const a = await client(base), b = await client(base);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  let response = message(a.socket, 'joined'); a.send({ type: 'create', name: 'ALPHA', bots: 0, mode: 'lan' });
  const joined = await response; const code = joined.room.code;
  assert.match(code, /^[A-Z2-9]{5}$/); assert.equal(joined.players.length, 1);
  response = message(b.socket, 'joined'); b.send({ type: 'join', name: 'BRAVO', code: code.toLowerCase() });
  const second = await response; assert.equal(second.players.length, 2);
  const origin = second.players.find((p) => p.id === second.id);
  b.send({ type: 'input', forward: 1, yaw: 0, pitch: 0, x: 999999, z: 999999 });
  let moved;
  for (let i = 0; i < 5; i++) { const state = await message(b.socket, 'state'); moved = state.players.find((p) => p.id === second.id); if (moved.z < origin.z - 0.4) break; }
  assert.ok(moved.z < origin.z); assert.ok(Math.abs(moved.x) < 29);
  const list = await (await fetch(`${base}/api/info`)).json(); assert.equal(list.rooms[0].players, 2);
  response = message(b.socket, 'error'); b.socket.send('not json'); assert.match((await response).message, /메시지/);
  response = message(b.socket, 'pong'); b.send({ type: 'ping', sent: 123 }); assert.equal((await response).sent, 123);
  await close(a.socket);
  const migrated = await message(b.socket, 'state'); assert.equal(migrated.room.hostId, second.id);
  const lastClosed = new Promise((resolve) => app.clients.get(second.id).socket.once('close', resolve));
  await close(b.socket); await lastClosed; assert.equal(app.rooms.size, 0);
});

test('practice rooms cannot be joined, nonexistent room errors are actionable', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }); const info = await app.listen(); t.after(() => app.close());
  const base = `http://127.0.0.1:${info.port}`;
  const a = await client(base), b = await client(base); t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  let response = message(a.socket, 'joined'); a.send({ type: 'create', mode: 'practice', bots: 1 }); const room = await response;
  response = message(b.socket, 'error'); b.send({ type: 'join', code: room.room.code }); assert.match((await response).message, /같은 서버/);
  assert.deepEqual((await (await fetch(`${base}/api/info`)).json()).rooms, []);
});

test('cross-origin WebSocket connections are rejected', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }); const info = await app.listen(); t.after(() => app.close());
  const socket = new WebSocket(`ws://127.0.0.1:${info.port}/play`, { origin: 'http://unrelated.invalid' });
  const code = await new Promise((resolve, reject) => { socket.once('close', resolve); socket.once('error', reject); });
  assert.equal(code, 1008);
});

test('selected map, skin and starting weapon are shared with other LAN clients', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }); const info = await app.listen(); t.after(() => app.close());
  const base = `http://127.0.0.1:${info.port}`, a = await client(base), b = await client(base);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  let response = message(a.socket, 'joined'); a.send({ type: 'create', name: 'ALPHA', bots: 0, mapId: 'longrail', weaponId: 'sniper', skinId: 'arctic' });
  const first = await response; assert.equal(first.room.mapId, 'longrail'); assert.equal(first.players[0].ammo, 5);
  response = message(b.socket, 'joined'); b.send({ type: 'join', code: first.room.code, name: 'BRAVO', weaponId: 'smg', skinId: 'circuit' });
  const joined = await response; assert.equal(joined.room.mapId, 'longrail');
  assert.equal(joined.players.find((p) => p.id === first.id).skinId, 'arctic'); assert.equal(joined.players.find((p) => p.id === joined.id).weaponId, 'smg');
  a.send({ type: 'input', weaponId: 'shotgun', yaw: 0, pitch: 0 });
  let state;
  for (let i = 0; i < 3; i++) { state = await message(b.socket, 'state'); if (state.players.find((p) => p.id === first.id).weaponId === 'shotgun') break; }
  assert.equal(state.players.find((p) => p.id === first.id).weaponId, 'shotgun');
  assert.equal((await (await fetch(`${base}/api/info`)).json()).rooms[0].mapId, 'longrail');
});
