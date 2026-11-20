import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createOnlineEngine } from '../server/online-engine.js';
import { WEAPONS } from '../shared/catalog.js';

test('the online Docker image copies every local module reachable from its entry point', async () => {
  const root = new URL('../', import.meta.url), dockerfile = await readFile(new URL('server/Dockerfile.online', root), 'utf8');
  const sources = [...dockerfile.matchAll(/^COPY (.+) \S+\s*$/gm)].flatMap((match) => match[1].split(/\s+/)), visited = new Set();
  async function visit(file) {
    if (visited.has(file)) return; visited.add(file);
    assert.ok(sources.some((source) => file === source || file.startsWith(source + '/')), `${file} is missing from the image`);
    const source = await readFile(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) await visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
  }
  await visit('server/online-engine.js');
  assert.ok(visited.has('server/custom-gateway.js')); assert.ok(visited.has('shared/teams.js'));
});

function message(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error(`No ${type} frame`)); }, 3000);
    function receive(raw) { const data = JSON.parse(raw.toString()); if (data.type !== type) return; clearTimeout(timer); socket.off('message', receive); resolve(data); }
    socket.on('message', receive);
  });
}
async function fixture(t, { mode = 'RANKED', bots = 0, humans = 2, rankedAiEnabled = false, botRating = 1000, clock, countdownMs = 0, gameType } = {}) {
  const id = randomUUID(), players = Array.from({ length: humans }, (_, i) => ({ id: randomUUID(), callsign: `HUMAN ${i}`, ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: {}, casualRating: 1000 }));
  const tickets = new Map(), results = [], plan = { id, mode, bots, players, rankedAiEnabled, botRating, mapId: 'foundry', fragLimit: 1, roundSeconds: 60 }, client = {
    pending: async () => [id], claim: async () => plan, heartbeat: async () => {}, cancel: async () => {},
    async consume(matchId, ticket) { const player = tickets.get(ticket); tickets.delete(ticket); if (matchId !== id || !player) throw new Error('Invalid ticket'); return player; },
    async complete(matchId, roster) { results.push({ id: matchId, roster }); return { settled: true }; },
  };
  if (gameType) Object.assign(plan, { gameType, teams: gameType === 'teams' ? Object.fromEntries(players.map((p, i) => [p.id, i % 2 ? 'red' : 'blue'])) : {} });
  const app = createOnlineEngine({ client, port: 0, host: '127.0.0.1', loop: false, countdownMs, ...(clock ? { clock } : {}) }), info = await app.listen(); t.after(() => app.close());
  const join = async (profile, extra = {}, readyNow = true) => {
    const socket = new WebSocket(`ws://127.0.0.1:${info.port}/play`); t.after(() => socket.terminate()); await message(socket, 'hello');
    const ticket = Buffer.from(randomUUID()).toString('base64url').slice(0, 43); tickets.set(ticket, profile); const joined = message(socket, 'joined'); socket.send(JSON.stringify({ type: 'authenticate', matchId: id, ticket, ...extra })); socket.joined = await joined;
    if (readyNow) { const ready = message(socket, 'pong'); socket.send(JSON.stringify({ type: 'ready' })); socket.send(JSON.stringify({ type: 'ping' })); await ready; } return socket;
  };
  return { app, id, players, plan, client, join, results, port: info.port };
}

async function disconnect(socket, match, id) {
  const clientClosed = new Promise((resolve) => socket.once('close', resolve)), serverClosed = new Promise((resolve) => match.sockets.get(id).once('close', resolve)); socket.close(); await Promise.all([clientClosed, serverClosed]);
}

test('a LAN-configured combat server also accepts matching-port loopback origins but still rejects unrelated sites', async (t) => {
  const lanOrigin = `http://${[192, 168, 40, 25].join('.')}:4173`;
  const app = createOnlineEngine({ client: { pending: async () => [] }, host: '127.0.0.1', port: 0, loop: false, origins: [lanOrigin] }), info = await app.listen(); t.after(() => app.close());
  for (const origin of [lanOrigin, 'http://127.0.0.1:4173', 'http://localhost:4173']) {
    const socket = new WebSocket(`ws://127.0.0.1:${info.port}/play`, { origin }); t.after(() => socket.terminate()); assert.equal((await message(socket, 'hello')).type, 'hello'); socket.close();
  }
  for (const origin of ['http://127.0.0.1:9999', 'https://evil.invalid']) {
    const socket = new WebSocket(`ws://127.0.0.1:${info.port}/play`, { origin }); t.after(() => socket.terminate()); const code = await new Promise((resolve, reject) => { socket.once('error', reject); socket.once('close', resolve); }); assert.equal(code, 1008);
  }
});

test('the online gateway consumes Spring tickets, ignores spoofed identity/ownership and requires every assigned human before starting', async (t) => {
  const f = await fixture(t, { mode: 'CASUAL' }); const a = await f.join(f.players[0], { ownedWeapons: ['m82'], weaponId: 'm82', id: f.players[1].id });
  const match = f.app.matches.get(f.id); assert.equal(match.room.phase, 'countdown'); assert.equal(match.room.players.get(f.players[0].id).weaponId, 'rifle');
  assert.equal(match.room.players.get(f.players[0].id).ownedWeapons.length, 4); assert.equal(f.players[0].ownedWeapons.includes('m82'), false);
  assert.equal([...match.room.players.values()].some((player) => player.isBot), false);
  await f.join(f.players[1]); assert.equal(match.room.phase, 'active'); assert.equal(match.room.hostId, null); assert.equal(match.room.roundId, f.id);
  const error = message(a, 'error'); a.send(JSON.stringify({ type: 'create', mode: 'ranked', bots: 7 })); assert.match((await error).message, /중앙 서버/);
});

test('ranked permits only starters and canonical purchases, ignoring forged ownership at entry and respawn', async (t) => {
  const f = await fixture(t); f.players[1].ownedWeapons.push('m82');
  const a = await f.join(f.players[0], { weaponId: 'm82', ownedWeapons: WEAPONS.map(w => w.id) }); await f.join(f.players[1], { weaponId: 'm82' });
  const room = f.app.matches.get(f.id).room, player = room.players.get(f.players[0].id);
  assert.equal(player.weaponId, 'rifle'); assert.equal(player.ownedWeapons.length, 4); assert.equal(room.players.get(f.players[1].id).weaponId, 'm82');
  player.hp = 0; const done = message(a, 'pong'); a.send(JSON.stringify({ type: 'loadout', weaponId: 'm82', ownedWeapons: ['m82'] })); a.send(JSON.stringify({ type: 'ping' })); await done;
  room.spawn(player); assert.equal(player.weaponId, 'rifle'); assert.equal(f.players[0].ownedWeapons.includes('m82'), false);
});
test('ranked assignments deploy exactly three per side, preserve chosen skins and reward the winning team rather than an individual MVP', async (t) => {
  const f = await fixture(t, { humans: 6, gameType: 'teams' });
  for (const profile of f.players) profile.ownedWeapons.push('awp');
  for (const profile of f.players) await f.join(profile, { weaponId: 'awp', skinId: 'arctic' });
  const match = f.app.matches.get(f.id), room = match.room, players = [...room.players.values()]; room.fragLimit = 20;
  assert.equal(room.gameType, 'teams'); assert.equal(players.filter((p) => p.teamId === 'blue').length, 3); assert.equal(players.filter((p) => p.teamId === 'red').length, 3);
  const [a, b, c] = f.players.map((p) => room.players.get(p.id)); assert.equal(a.weaponSkinId, 'arctic'); assert.equal(a.weaponId, 'awp');
  for (const p of players) p.protectedUntil = 0;
  room.applyDamage(a, c, 10000, false, {}, { id: 'awp' }, room.clock()); assert.equal(c.hp, 100); assert.equal(a.kills, 0);
  b.kills = 9; c.kills = 5; players[4].kills = 5; room.teamScores = { blue: 10, red: 9 }; room.finish(); f.app.tick(1 / 60); await Promise.resolve();
  assert.equal(room.result.winnerTeam, 'blue'); assert.equal(room.result.rewards[a.id].won, true); assert.equal(room.result.rewards[a.id].winBonus, 100); assert.equal(room.result.rewards[b.id].won, false);
  assert.ok(f.results[0].roster.every((p) => ['blue', 'red'].includes(p.teamId)));
});
test('new competitive assignments cannot silently fall back to a four-player team match', async (t) => {
  const f = await fixture(t, { humans: 4, gameType: 'teams' }); await assert.rejects(() => f.app.load(f.id), /roster size/);
});

test('WAN ranked suppressors use canonical per-weapon mastery, ignore forged unlocks and retain temporary ownership boundaries', async (t) => {
  const f = await fixture(t); for (const profile of f.players) profile.ownedWeapons.push('vector'); Object.assign(f.players[0], { weaponKills: { vector: 1549 }, suppressedWeapons: ['vector'] }); Object.assign(f.players[1], { weaponKills: { vector: 1550 }, suppressedWeapons: ['vector'] });
  const a = await f.join(f.players[0], { weaponId: 'vector', suppressor: true, weaponKills: { vector: 999999 }, suppressedWeapons: ['vector'] });
  await f.join(f.players[1], { weaponId: 'vector', suppressor: true });
  const room = f.app.matches.get(f.id).room, locked = room.players.get(f.players[0].id), earned = room.players.get(f.players[1].id);
  assert.equal(locked.suppressor, false); assert.deepEqual(locked.suppressedWeapons, []); assert.equal(earned.suppressor, true);
  assert.equal(earned.ownedWeapons.length, 5); assert.equal(f.players[1].ownedWeapons.includes('vector'), true); assert.equal(f.players[1].weaponKills.vector, 1550);
  const barrier = async (data) => { const done = message(a, 'pong'); a.send(JSON.stringify(data)); a.send(JSON.stringify({ type: 'ping' })); await done; };
  await barrier({ type: 'input', suppressor: true, weaponKills: { vector: 1550 } }); assert.equal(locked.suppressor, false);
  await barrier({ type: 'loadout', weaponId: 'vector', suppressor: true }); assert.equal(locked.suppressor, false);
  locked.hp = 0; locked.diedAt = Date.now(); await barrier({ type: 'loadout', weaponId: 'vector', suppressor: true, weaponKills: { vector: 1550 } }); assert.deepEqual(locked.suppressedWeapons, []);
  room.spawn(locked); room.shoot(earned, Date.now(), false); assert.equal(room.events.findLast((event) => event.type === 'shot').suppressor, true);
  assert.equal(room.dropWeapon(earned).suppressor, true); assert.equal(room.snapshot().players.find((player) => player.id === earned.id).suppressor, true);
});

test('ready players are frozen for the complete five-second countdown and the match timer starts only afterward', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now, countdownMs: 5000 }); const socket = await f.join(f.players[0]); await f.join(f.players[1]); const match = f.app.matches.get(f.id), p = match.room.players.get(f.players[0].id), initial = { x: p.x, z: p.z, ammo: p.ammo };
  assert.equal(match.room.phase, 'countdown'); assert.equal(match.countdownEndsAt, 6000); match.room.setInput(p.id, { forward: 1, fire: true, spawnCount: p.spawnCount }); now = 5999; f.app.tick(1 / 60); assert.equal(match.room.phase, 'countdown'); assert.deepEqual({ x: p.x, z: p.z, ammo: p.ammo }, initial);
  now = 6000; f.app.tick(1 / 60); assert.equal(match.room.phase, 'active'); assert.equal(match.room.startedAt, 6000); assert.equal(match.room.endsAt, 66_000); assert.equal(p.hp, 100); assert.equal(p.ammo, initial.ammo); assert.equal(p.protectedUntil, 7500);
});

test('late loaders and reconnects share the first ready deadline without a restarted countdown', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now, countdownMs: 5000 }), a = await f.join(f.players[0]); const match = f.app.matches.get(f.id);
  assert.equal(match.countdownEndsAt, 6000);
  now = 3000; const late = await f.join(f.players[1]); assert.equal(late.joined.online.countdownEndsAt - late.joined.serverTime, 3000);
  await disconnect(a, match, f.players[0].id); assert.equal(match.room.phase, 'countdown'); assert.equal(match.countdownEndsAt, 6000);
  now = 6500; f.app.tick(1 / 60); assert.equal(match.room.phase, 'countdown'); // Fairness: never fight an unready human.
  await f.join(f.players[0]); assert.equal(match.room.phase, 'active'); assert.equal(match.room.startedAt, 6500);
});

test('preparation loadouts are authenticated, preserve position and life, freeze combat and close on activation', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now, countdownMs: 5000 }), a = await f.join(f.players[0]);
  const match = f.app.matches.get(f.id), player = match.room.players.get(f.players[0].id), before = [player.x, player.y, player.z, player.spawnCount];
  const barrier = async data => { const done = message(a, 'pong'); a.send(JSON.stringify(data)); a.send(JSON.stringify({ type: 'ping' })); await done; };
  await barrier({ type: 'prepare-loadout', roundId: f.id, weaponId: 'awp', id: f.players[1].id, suppressor: true, weaponKills: { awp: 999999 }, x: 9999 });
  assert.equal(player.weaponId, 'rifle');
  f.players[0].ownedWeapons.push('awp'); f.client.accountEquipment = async () => ({ ...f.players[0], suppressedWeapons: [] });
  await barrier({ type: 'prepare-loadout', roundId: f.id, weaponId: 'awp', suppressor: true });
  assert.equal(player.weaponId, 'awp'); assert.equal(player.ammo, 10); assert.equal(player.suppressor, false);
  assert.deepEqual([player.x, player.y, player.z, player.spawnCount], before);
  await barrier({ type: 'input', forward: 1, fire: true, spawnCount: player.spawnCount, equipmentSeq: player.equipmentSeq });
  f.app.tick(1 / 60); assert.deepEqual([player.x, player.y, player.z, player.spawnCount], before); assert.equal(player.ammo, 10);
  now = 3500; const b = await f.join(f.players[1], { weaponId: 'sniper' }, false);
  assert.equal(match.room.players.get(f.players[1].id).weaponId, 'sniper'); now = 6000; f.app.tick(1 / 60); assert.equal(match.room.phase, 'countdown');
  const done = message(b, 'pong'); b.send(JSON.stringify({ type: 'ready' })); b.send(JSON.stringify({ type: 'ping' })); await done;
  assert.equal(match.room.phase, 'active');
  const error = message(a, 'error'); a.send(JSON.stringify({ type: 'prepare-loadout', roundId: f.id, weaponId: 'rifle' })); assert.match((await error).message, /준비 중/); assert.equal(player.weaponId, 'awp');
});

test('ranked AI assignments still require explicit permission from the authoritative plan', async (t) => {
  const f = await fixture(t, { bots: 1 }); await assert.rejects(() => f.app.load(f.id), /Invalid authoritative/); assert.equal(f.app.matches.size, 0);
});

test('rated AI uses the frozen mode rating for all five levels and ignores browser difficulty claims', async (t) => {
  for (const [botRating, difficulty] of [[899, 'beginner'], [900, 'intermediate'], [1300, 'advanced'], [1699, 'advanced'], [1700, 'expert'], [2099, 'expert'], [2100, 'extreme']]) {
    const f = await fixture(t, { gameType: 'ffa', mode: 'CASUAL', humans: 1, bots: 3, botRating });
    const socket = await f.join(f.players[0], { botDifficulty: 'beginner' }), match = f.app.matches.get(f.id);
    assert.equal(match.room.botDifficulty, difficulty);
    assert.equal(socket.joined.room.botDifficulty, difficulty);
    assert.equal(match.plan.botRating, botRating);
    const levels = ['beginner', 'intermediate', 'advanced', 'expert', 'extreme'];
    for (const bot of socket.joined.players.filter((p) => p.isBot)) {
      assert.ok(levels.includes(bot.botDifficulty));
      assert.ok(Math.abs(levels.indexOf(bot.botDifficulty) - levels.indexOf(difficulty)) <= 1);
    }
    f.players[0].casualRating = 100; assert.equal(match.room.botDifficulty, difficulty);
  }
});

test('the final unequal team roster receives two harder AI on its smaller human side and keeps the assignment across lives and reconnect', async (t) => {
  const f = await fixture(t, { gameType: 'teams', humans: 3, bots: 3, rankedAiEnabled: true, botRating: 1300 });
  const a = await f.join(f.players[0]); await f.join(f.players[1]); await f.join(f.players[2]);
  const match = f.app.matches.get(f.id), bots = [...match.room.players.values()].filter(p => p.isBot);
  assert.equal(match.room.botDifficulty, 'intermediate');
  assert.equal(bots.filter(p => p.teamId === 'blue').length, 1);
  assert.deepEqual(bots.filter(p => p.teamId === 'red').map(p => p.botDifficulty), ['advanced', 'advanced']);
  const assigned = new Map(bots.map(bot => [bot.id, bot.botDifficulty]));
  for (const bot of bots) match.room.spawn(bot);
  await disconnect(a, match, f.players[0].id);
  const restored = await f.join(f.players[0]);
  assert.deepEqual(new Map(restored.joined.players.filter(p => p.isBot).map(bot => [bot.id, bot.botDifficulty])), assigned);
});

test('a single human can play a temporary ranked AI match without it ending immediately or trusting browser AI flags', async (t) => {
  const f = await fixture(t, { humans: 1, bots: 3, rankedAiEnabled: true, botRating: 1600 }); const socket = await f.join(f.players[0], { weaponId: 'm82', bots: 7 }); const match = f.app.matches.get(f.id);
  f.app.tick(1 / 60); assert.equal(match.room.phase, 'active'); assert.equal(match.room.botDifficulty, 'advanced'); assert.equal(socket.joined.players.filter((player) => player.isBot).length, 3);
  const player = match.room.players.get(f.players[0].id), bots = [...match.room.players.values()].filter((entry) => entry.isBot); match.room.world = { ...match.room.world, width: 100, depth: 100, obstacles: [] };
  Object.assign(player, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectedUntil: 0 }); bots.forEach((bot, index) => Object.assign(bot, { x: index ? 40 : 0, y: 0, z: index ? -40 : -1, hp: 1, protectedUntil: 0 }));
  match.room.setInput(player.id, { fire: true, yaw: 0, spawnCount: player.spawnCount, equipmentSeq: player.equipmentSeq }); f.app.tick(1 / 60); await Promise.resolve();
  assert.equal(match.room.phase, 'ended'); assert.equal(f.results.length, 1); assert.equal(f.results[0].roster.length, 4); assert.equal(f.results[0].roster.find((entry) => entry.id === player.id).humanKills, 0); assert.equal(player.kills, 1);
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
  await disconnect(a, match, player.id);
  match.room.impacts.set('wall', { id: 'persistent-shot', at: now, point: { x: 0, y: 1, z: 0 } });
  now += 5000; const restored = await f.join(f.players[0]); assert.equal(player.hp, 75); assert.equal(player.ammo, 9); assert.equal(player.spawnCount, life); assert.equal(restored.joined.impacts[0].id, 'persistent-shot');
  assert.equal([...match.room.players.values()].some((player) => player.isBot), false);
});

test('the thirty-second grace expiry marks a leaver last, submits abandonment and never spawns a replacement AI', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now }); const a = await f.join(f.players[0]); await f.join(f.players[1]); const notices = []; f.client.abandon = async (match, account) => notices.push({ match, account });
  const match = f.app.matches.get(f.id), player = match.room.players.get(f.players[0].id); player.kills = 9;
  await disconnect(a, match, player.id);
  now += 29_999; f.app.tick(1 / 60); assert.equal(player.abandoned, undefined); assert.equal(match.room.phase, 'active');
  now++; f.app.tick(1 / 60); await Promise.resolve(); assert.equal(player.abandoned, true); assert.equal(player.hp, 0); assert.equal(player.respawnAt, Infinity); assert.equal(match.room.phase, 'ended'); assert.equal(match.room.result.winnerId, f.players[1].id); assert.equal(match.room.result.rewards[player.id].points, 0);
  assert.deepEqual(notices, [{ match: f.id, account: player.id }]); assert.equal(f.results.length, 1); assert.equal(f.results[0].roster.find((entry) => entry.id === player.id).abandoned, true); assert.equal([...match.room.players.values()].some((entry) => entry.isBot), false);
});

test('a disconnect during the grace window cannot retroactively rewrite an already completed result as abandonment', async (t) => {
  let now = 1000; const f = await fixture(t, { clock: () => now }); const a = await f.join(f.players[0]); await f.join(f.players[1]); const match = f.app.matches.get(f.id), player = match.room.players.get(f.players[0].id);
  await disconnect(a, match, player.id); match.room.finish(); f.app.tick(1 / 60); await Promise.resolve();
  now += 30_001; f.app.tick(1 / 60); assert.equal(player.abandoned, undefined); assert.equal(f.results.length, 1); assert.equal(f.results[0].roster.find((entry) => entry.id === player.id).abandoned, false);
});
