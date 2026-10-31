import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { RULES } from '../shared/world.js';

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
  const spawns = await fetch(`${base}/shared/spawns.js`); assert.equal(spawns.status, 200); assert.match(spawns.headers.get('content-type'), /javascript/); assert.match(await spawns.text(), /export function addSpawnZones/);
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
  let response = message(a.socket, 'joined'); a.send({ type: 'create', name: 'ALPHA', bots: 0, mapId: 'longrail', weaponId: 'sniper', skinId: 'arctic', fragLimit: 7, roundSeconds: 120 });
  const first = await response; assert.equal(first.room.mapId, 'longrail'); assert.equal(first.players[0].ammo, 5);
  response = message(b.socket, 'joined'); b.send({ type: 'join', code: first.room.code, name: 'BRAVO', weaponId: 'smg', ownedWeapons: ['smg'], skinId: 'circuit', fragLimit: 1, roundSeconds: 60 });
  const joined = await response; assert.equal(joined.room.mapId, 'longrail');
  assert.equal(joined.room.fragLimit, 7); assert.equal(joined.room.roundSeconds, 120);
  assert.equal(joined.players.find((p) => p.id === first.id).skinId, 'arctic'); assert.equal(joined.players.find((p) => p.id === joined.id).weaponId, 'smg');
  a.send({ type: 'input', weaponId: 'shotgun', yaw: 0, pitch: 0 });
  let state;
  for (let i = 0; i < 3; i++) { state = await message(b.socket, 'state'); if (state.players.find((p) => p.id === first.id).weaponId === 'shotgun') break; }
  assert.equal(state.players.find((p) => p.id === first.id).weaponId, 'sniper', 'live input cannot swap the selected weapon');
  assert.equal((await (await fetch(`${base}/api/info`)).json()).rooms[0].mapId, 'longrail');
});

for (const mapId of ['overgrowth', 'nightmarket']) test(`${mapId} is available to real LAN hosts and guests with the same map and natural spawns`, async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }), info = await app.listen(); t.after(() => app.close());
  const base = `http://127.0.0.1:${info.port}`, a = await client(base), b = await client(base);
  t.after(() => { a.socket.terminate(); b.socket.terminate(); });
  let pending = message(a.socket, 'joined'); a.send({ type: 'create', name: 'HOST', mapId, bots: 2 }); const first = await pending;
  pending = message(b.socket, 'joined'); b.send({ type: 'join', code: first.room.code, name: 'GUEST' }); const joined = await pending;
  assert.equal(first.room.mapId, mapId); assert.equal(joined.room.mapId, mapId); assert.equal(joined.players.length, 4);
  const world = app.rooms.get(first.room.code).world;
  for (const player of joined.players) assert.ok(world.spawns.some((spawn) => spawn.spawnId === player.spawnId && spawn.y === player.y));
  assert.equal((await (await fetch(`${base}/api/info`)).json()).rooms[0].mapId, mapId);
});

test('real LAN input can jump from ground onto an elevated firing deck and remain grounded', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1' }); const info = await app.listen(); t.after(() => app.close());
  const a = await client(`http://127.0.0.1:${info.port}`); t.after(() => a.socket.terminate());
  const response = message(a.socket, 'joined'); a.send({ type: 'create', bots: 0, mode: 'lan' }); const joined = await response;
  const room = app.rooms.get(joined.room.code), platform = room.world.platforms[0], player = room.players.get(joined.id);
  Object.assign(player, { x: platform.x, y: 0, z: platform.z + 2.5 + RULES.playerRadius, vy: 0, grounded: true, jumpHeld: false, yaw: 0 });
  a.send({ type: 'input', forward: 0.35, jump: true, yaw: 0 });
  let airborne = false, landed = false, stopped = false;
  for (let i = 0; i < 30; i++) {
    const state = await message(a.socket, 'state'), current = state.players.find((p) => p.id === joined.id);
    airborne ||= current.y > 0.2 && !current.grounded;
    if (!stopped && current.z < platform.z + 1.8) { a.send({ type: 'input', jump: true, yaw: 0 }); stopped = true; }
    if (airborne && current.grounded && current.y === platform.height) { landed = true; break; }
  }
  assert.equal(airborne, true); assert.equal(landed, true);
  a.send({ type: 'input', yaw: 0 });
  const settled = (await message(a.socket, 'state')).players.find((p) => p.id === joined.id);
  assert.equal(settled.y, platform.height); assert.equal(settled.grounded, true);
});

test('LAN character identity persists through respawn and airborne packets cannot spoof steering or velocity', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }), info = await app.listen(); t.after(() => app.close());
  const c = await client(`http://127.0.0.1:${info.port}`); t.after(() => c.socket.terminate());
  const pending = message(c.socket, 'joined'); c.send({ type: 'create', bots: 0, characterId: 'female', outfitId: 'runner' }); const joined = await pending;
  const room = app.rooms.get(joined.room.code), p = room.players.get(joined.id); room.world = { ...room.world, width: 100, depth: 100, obstacles: [] };
  Object.assign(p, { x: 0, y: 0, z: 0, vy: 0, grounded: true });
  const barrier = async () => { const pending = message(c.socket, 'pong'); c.send({ type: 'ping' }); await pending; };
  c.send({ type: 'input', forward: 1, jump: true, yaw: 0 }); await barrier(); room.tick(1 / 60); const vx = p.vx, vz = p.vz;
  c.send({ type: 'input', forward: -1, strafe: 1, sprint: true, ads: true, yaw: Math.PI / 2, vx: 500, vz: 500, characterId: 'male' }); await barrier();
  for (let i = 0; i < 20; i++) room.tick(1 / 60);
  assert.equal(p.vx, vx); assert.equal(p.vz, vz); assert.equal(p.x, 0); assert.equal(p.yaw, Math.PI / 2); assert.equal(p.characterId, 'female');
  const snapshot = room.snapshot(); assert.equal(snapshot.players[0].vx, vx); assert.equal(snapshot.players[0].vz, vz); assert.equal(snapshot.players[0].characterId, 'female');
  room.spawn(p); assert.equal(p.characterId, 'female'); assert.equal(p.outfitId, 'runner'); assert.equal(p.vx, 0); assert.equal(p.vz, 0);
});

test('eight real LAN connections can join a full bot room; a ninth is rejected', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }); const info = await app.listen(); t.after(() => app.close());
  const base = `http://127.0.0.1:${info.port}`, clients = [];
  t.after(() => clients.forEach((c) => c.socket.terminate()));
  const host = await client(base); clients.push(host);
  let response = message(host.socket, 'joined'); host.send({ type: 'create', bots: 7 }); const joined = await response;
  assert.equal(joined.players.length, 8);
  for (let i = 1; i < 8; i++) { const c = await client(base); clients.push(c); response = message(c.socket, 'joined'); c.send({ type: 'join', code: joined.room.code, name: `HUMAN ${i}` }); await response; }
  const room = app.rooms.get(joined.room.code); assert.equal(room.summary().players, 8); assert.equal(room.summary().bots, 0);
  const ninth = await client(base); clients.push(ninth); response = message(ninth.socket, 'error'); ninth.send({ type: 'join', code: joined.room.code }); assert.match((await response).message, /가득/);
});

test('LAN loadout protocol rejects live changes and applies a dead selection on respawn', async (t) => {
  const app = createGameServer({ port: 0, host: '127.0.0.1', loop: false }); const info = await app.listen(); t.after(() => app.close());
  const c = await client(`http://127.0.0.1:${info.port}`); t.after(() => c.socket.terminate());
  let response = message(c.socket, 'joined'); c.send({ type: 'create', bots: 0 }); const joined = await response, room = app.rooms.get(joined.room.code), p = room.players.get(joined.id);
  const barrier = async () => { const pending = message(c.socket, 'pong'); c.send({ type: 'ping' }); await pending; };
  c.send({ type: 'loadout', weaponId: 'sniper', open: true }); await barrier(); assert.equal(p.weaponId, 'rifle'); assert.equal(p.nextWeaponId, 'rifle');
  Object.assign(p, { hp: 0, diedAt: Date.now(), respawnAt: Date.now() + 3000 });
  c.send({ type: 'loadout', open: true }); await barrier(); assert.equal(p.loadoutSelecting, true);
  c.send({ type: 'loadout', weaponId: 'sniper', open: false }); await barrier(); assert.equal(p.weaponId, 'rifle'); assert.equal(p.nextWeaponId, 'sniper');
  p.respawnAt = Date.now() - 1; app.tick(); assert.equal(p.weaponId, 'sniper'); assert.equal(p.hp, 100); assert.equal(p.ammo, 5);
});
