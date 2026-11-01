import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from '../shared/simulation.js';
import { NETWORK_PROTOCOL, RULES, MAPS } from '../shared/world.js';
import { isWeaponId, ownsWeapon } from '../shared/catalog.js';
import { EMPTY_INPUT } from '../shared/movement.js';
import { roundReward } from '../shared/progression.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const validId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const neutral = (player) => ({ ...EMPTY_INPUT, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId });
const send = (socket, data) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512 * 1024) socket.send(JSON.stringify(data)); };

export class SpringEngineClient {
  constructor({ apiUrl = process.env.ONLINE_API_URL || 'http://127.0.0.1:8080', secret = process.env.ENGINE_SECRET, engineId = `engine-${randomUUID()}` } = {}) {
    const url = new URL(apiUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !secret || secret.length < 32) throw new Error('Configure ONLINE_API_URL and a private ENGINE_SECRET of at least 32 characters.');
    this.base = url.href.replace(/\/$/, ''); this.secret = secret; this.engineId = engineId;
  }
  async request(route, body) {
    const response = await fetch(this.base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${this.secret}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) { const error = new Error(`Online service rejected an engine request (${response.status}).`); error.status = response.status; throw error; }
    return response.json();
  }
  pending() { return this.request('/internal/matches/pending'); }
  claim(id) { return this.request(`/internal/matches/${id}/claim`, { engineId: this.engineId }); }
  consume(id, ticket) { return this.request(`/internal/matches/${id}/consume-ticket`, { engineId: this.engineId, ticket }); }
  heartbeat(id) { return this.request(`/internal/matches/${id}/heartbeat`, { engineId: this.engineId }); }
  complete(id, players) { return this.request(`/internal/matches/${id}/results`, { engineId: this.engineId, roundId: id, players }); }
  cancel(id) { return this.request(`/internal/matches/${id}/cancel`, { engineId: this.engineId }); }
}

class OnlineRoom extends Room {
  finish() {
    if (this.phase === 'ended') return;
    super.finish();
    // Deterministic ties match Spring settlement, independent of reconnect or
    // JSON roster order. Solo/LAN winner rules remain completely untouched.
    const winner = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id.localeCompare(b.id, 'en'))[0];
    this.result = { ...this.result, winnerId: winner?.id || null, winnerName: winner?.name || 'OPERATOR', winnerKills: winner?.kills || 0, rewards: Object.fromEntries([...this.players.values()].filter((player) => !player.isBot).map((player) => [player.id, { kills: player.kills, deaths: player.deaths, weaponKills: { ...player.weaponKills }, ...roundReward(player.kills, player.id === winner?.id) }])) };
    const event = this.events.findLast((event) => event.type === 'ended'); if (event) Object.assign(event, { winner: winner?.name || 'OPERATOR', winnerId: winner?.id || null });
  }
}

export function createOnlineEngine({ client = new SpringEngineClient(), host = process.env.ENGINE_BIND || '127.0.0.1', port = Number(process.env.ENGINE_PORT) || 8090, origins = (process.env.FRONTEND_ORIGINS || 'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:3000,http://localhost:3000').split(','), loop = true, clock = () => Date.now() } = {}) {
  const matches = new Map(), loading = new Map(), connections = new Set(), timers = []; let closed = false, syncing = false;
  for (const origin of origins) if (new URL(origin).origin !== origin || origin.includes('*')) throw new Error('FRONTEND_ORIGINS must list explicit origins.');
  const server = http.createServer((request, response) => { response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.writeHead(request.method === 'GET' && request.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(request.url === '/health' ? { status: 'UP', protocolVersion: NETWORK_PROTOCOL } : { message: 'Not found' })); });
  const wss = new WebSocketServer({ server, path: '/play', maxPayload: 4096, perMessageDeflate: false });

  async function load(id) {
    if (!validId(id)) throw new Error('Invalid match assignment.');
    if (matches.has(id)) return matches.get(id);
    if (loading.has(id)) return loading.get(id);
    if (matches.size + loading.size >= 24) throw new Error('Engine capacity reached.');
    const pending = (async () => {
      const plan = await client.claim(id);
      if (closed) throw new Error('Engine stopped.');
      if (plan.id !== id || !['CASUAL', 'RANKED'].includes(plan.mode) || !Array.isArray(plan.players) || !plan.players.length || plan.players.length + plan.bots > RULES.maxPlayers || !Number.isInteger(plan.bots) || plan.bots < 0 || plan.mode === 'RANKED' && (plan.bots !== 0 || plan.players.length < 2) || !MAPS.some((map) => map.id === plan.mapId) || plan.players.some((player) => !validId(player.id)) || new Set(plan.players.map((player) => player.id)).size !== plan.players.length) throw new Error('Invalid authoritative match assignment.');
      const average = plan.players.reduce((sum, player) => sum + player.casualRating, 0) / plan.players.length;
      const room = new OnlineRoom(id.slice(0, 5).toUpperCase(), { mode: plan.mode.toLowerCase(), mapId: plan.mapId, bots: plan.bots, fragLimit: plan.fragLimit, roundSeconds: plan.roundSeconds, botDifficulty: average >= 1500 ? 'advanced' : average >= 1100 ? 'intermediate' : 'beginner', clock });
      for (const profile of plan.players) room.addPlayer(profile.id, profile.callsign, false, { ownedWeapons: profile.ownedWeapons, weaponKills: profile.weaponKills, outfitId: profile.outfitId, characterId: profile.characterId });
      room.phase = 'waiting'; room.roundId = id; room.hostId = null;
      const match = { id, plan, room, sockets: new Map(), disconnected: new Map(), abandoned: new Set(), deadline: clock() + 30_000, settlement: 'pending', lastHeartbeat: clock(), nextSettle: 0, settling: false, lastHealthy: clock() };
      matches.set(id, match); return match;
    })();
    loading.set(id, pending); try { return await pending; } finally { loading.delete(id); }
  }
  function snapshot(match, flush = true) {
    const state = match.room.snapshot(flush);
    return { ...state, online: { matchId: match.id, settlement: match.settlement, connected: match.sockets.size, expected: match.plan.players.length }, players: state.players.map((player) => ({ ...player, connected: player.isBot || match.sockets.has(player.id) })) };
  }
  function start(match) {
    if (match.room.phase !== 'waiting' || match.sockets.size !== match.plan.players.length) return;
    const room = match.room; room.phase = 'active'; room.startedAt = clock(); room.endsAt = room.startedAt + room.roundSeconds * 1000;
    for (const player of room.players.values()) player.hp = 0;
    for (const player of room.players.values()) room.spawn(player);
    room.events.push({ type: 'online-start' });
  }
  async function cancel(match) {
    if (match.cancelling) return; match.cancelling = true;
    try { await client.cancel(match.id); } catch { /* Lease expiry also cancels safely in Spring. */ }
    for (const socket of match.sockets.values()) socket.close(1013, 'Match cancelled'); matches.delete(match.id);
  }
  async function settle(match) {
    if (match.settling || match.settlement === 'saved' || clock() < match.nextSettle) return;
    match.settling = true;
    try {
      await client.complete(match.id, [...match.room.players.values()].map((player) => ({ id: player.id, bot: player.isBot, kills: player.kills, deaths: player.deaths, weaponKills: { ...player.weaponKills } })));
      match.settlement = 'saved'; match.retireAt = clock() + 30_000;
    } catch { match.nextSettle = clock() + 2000; }
    finally { match.settling = false; }
  }
  function tick(dt) {
    for (const match of matches.values()) {
      const now = clock();
      if (match.room.phase === 'waiting' && now > match.deadline || now - match.lastHealthy > 60_000) { void cancel(match); continue; }
      for (const [id, until] of match.disconnected) if (now >= until) { const player = match.room.players.get(id); player.hp = 0; player.respawnAt = Infinity; match.disconnected.delete(id); match.abandoned.add(id); }
      if (match.room.phase === 'active' && !match.sockets.size && !match.disconnected.size) { void cancel(match); continue; }
      match.room.tick(dt);
      if (match.room.phase === 'ended') void settle(match);
      if (match.retireAt && now >= match.retireAt) { for (const socket of match.sockets.values()) socket.close(1000, 'Round complete'); matches.delete(match.id); }
    }
  }
  function broadcast() { for (const match of matches.values()) { const state = snapshot(match); for (const socket of match.sockets.values()) send(socket, state); } }
  async function sync() {
    if (syncing || closed) return; syncing = true;
    try {
      for (const match of matches.values()) if (match.room.phase !== 'ended' && clock() - match.lastHeartbeat >= 10_000) {
        try { await client.heartbeat(match.id); match.lastHealthy = clock(); } catch (error) { if (error.status === 400 || error.status === 401) void cancel(match); } match.lastHeartbeat = clock();
      }
      for (const id of await client.pending()) { if (matches.size + loading.size >= 24) break; if (!matches.has(id)) { try { await load(id); } catch { /* Another engine may have claimed it. */ } } }
    } catch { /* No secret, token, URL query or response body is logged. */ }
    finally { syncing = false; }
  }

  wss.on('connection', (socket, request) => {
    if (request.headers.origin && !origins.includes(request.headers.origin)) { socket.close(1008, 'Origin not allowed'); return; }
    const connection = { socket, match: null, account: null, pending: false, windowAt: clock(), messages: 0, alive: true }; connections.add(connection);
    const timeout = setTimeout(() => { if (!connection.account) socket.close(1008, 'Authenticate with a match ticket'); }, 5000);
    send(socket, { type: 'hello', protocolVersion: NETWORK_PROTOCOL, name: 'LINKSHOT ONLINE ENGINE' });
    socket.on('pong', () => { connection.alive = true; }); socket.on('error', () => {});
    socket.on('message', async (raw, binary) => {
      if (clock() - connection.windowAt > 1000) { connection.windowAt = clock(); connection.messages = 0; }
      if (++connection.messages > 120 || binary) { socket.close(1008, 'Invalid message rate'); return; }
      let data; try { data = JSON.parse(raw.toString()); } catch { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ping') { send(socket, { type: 'pong', sent: data.sent }); return; }
      if (!connection.account) {
        if (data.type !== 'authenticate' || connection.pending || typeof data.ticket !== 'string' || data.ticket.length !== 43) return;
        connection.pending = true;
        try {
          const match = await load(data.matchId), profile = await client.consume(match.id, data.ticket);
          if (socket.readyState !== WebSocket.OPEN || match.sockets.has(profile.id) || match.abandoned.has(profile.id) || !match.room.players.has(profile.id) || match.room.phase === 'ended') throw new Error('Match access denied.');
          connection.account = profile.id; connection.match = match; match.sockets.set(profile.id, socket); match.disconnected.delete(profile.id); clearTimeout(timeout);
          const player = match.room.players.get(profile.id);
          if (match.room.phase === 'waiting' && isWeaponId(data.weaponId) && ownsWeapon(profile, data.weaponId)) { player.nextWeaponId = data.weaponId; match.room.spawn(player); }
          start(match); send(socket, { ...snapshot(match, false), type: 'joined', id: profile.id, events: [] });
        } catch { socket.close(1008, 'Invalid or expired match ticket'); }
        finally { connection.pending = false; }
        return;
      }
      const { room } = connection.match;
      if (data.type === 'input') room.setInput(connection.account, data);
      else if (data.type === 'equipment') room.interactEquipment(connection.account, data);
      else if (data.type === 'loadout') room.selectLoadout(connection.account, data);
      else if (data.type === 'leave') socket.close(1000, 'Left match');
      else send(socket, { type: 'error', message: '온라인 경기는 중앙 서버가 배정합니다.' });
    });
    socket.on('close', () => {
      clearTimeout(timeout); connections.delete(connection);
      const match = connection.match; if (!match || match.sockets.get(connection.account) !== socket) return;
      match.sockets.delete(connection.account);
      const player = match.room.players.get(connection.account); player.input = neutral(player); player.pendingShot = null; player.burstLeft = 0;
      if (match.room.phase === 'active') match.disconnected.set(connection.account, clock() + 30_000);
    });
  });
  let previous = performance.now();
  if (loop) {
    timers.push(setInterval(() => { const now = performance.now(); tick(Math.min((now - previous) / 1000, 1 / 30)); previous = now; }, 1000 / RULES.tickRate), setInterval(broadcast, 1000 / RULES.snapshotRate), setInterval(() => { void sync(); }, 1000));
    timers.push(setInterval(() => { for (const connection of connections) { if (!connection.alive) connection.socket.terminate(); else { connection.alive = false; connection.socket.ping(); } } }, 15_000));
  }
  return {
    server, matches, load, tick, broadcast, sync,
    async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); return { port: server.address().port }; },
    async close() { closed = true; timers.forEach(clearInterval); for (const connection of connections) connection.socket.terminate(); await Promise.allSettled([...loading.values()]); await new Promise((resolve) => wss.close(resolve)); await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createOnlineEngine(); const info = await app.listen(); console.log(`LINKSHOT shared combat engine listening on port ${info.port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
