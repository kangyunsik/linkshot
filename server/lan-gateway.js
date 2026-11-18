import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { RoomDirectory } from './room-directory.js';
import { roomLobbyAction } from './room-lobby.js';
import { isTeamGame } from '../shared/game-types.js';
import { NETWORK_PROTOCOL } from '../shared/world.js';
import { isPrivateOnlineHost } from '../shared/online-network.js';
import { highestRank } from '../shared/ranks.js';

// Guest gameplay never requires Spring. Optional, single-use account proofs
// only add a cosmetic badge and never authenticate the LAN player's identity.
export class LanGateway {
  constructor({ send, clock, origins, capacity, engineId, verifyBadge }) {
    this.send = send; this.clock = clock; this.origins = origins; this.engineId = engineId; this.verifyBadge = verifyBadge; this.clients = new Map(); this.directory = new RoomDirectory({ clock, capacity });
  }
  info() {
    return { name: 'LINKSHOT LAN', protocolVersion: NETWORK_PROTOCOL, urls: this.origins.filter((origin) => isPrivateOnlineHost(new URL(origin).hostname)), rooms: this.directory.list(), totalPlayers: [...this.clients.values()].filter((c) => c.room).length };
  }
  attach(socket, request) {
    const address = request.socket.remoteAddress?.replace(/^::ffff:/, ''), local = address === '::1' || isPrivateOnlineHost(address || '');
    const origin = request.headers.origin;
    try {
      const page = origin ? new URL(origin) : null;
      // The FE proxy is same-origin. A guest using the FE's private IP must also
      // work when the saved account-server configuration still uses loopback.
      // Authenticated /play keeps its separate, exact origin allowlist.
      const approvedPort = page && this.origins.some(value => { const allowed = new URL(value); return allowed.protocol === 'http:' && isPrivateOnlineHost(allowed.hostname) && allowed.port === page.port; });
      if (!local || page && (page.origin !== origin || page.protocol !== 'http:' || !isPrivateOnlineHost(page.hostname) || !approvedPort)) throw new Error();
    }
    catch { socket.close(1008, 'Use an approved local network frontend'); return; }
    const client = { id: randomUUID(), socket, room: null, alive: true, at: this.clock(), messages: 0 };
    this.clients.set(client.id, client); this.send(socket, { type: 'hello', id: client.id, rankBadgeEngineId: this.engineId || null, ...this.info() });
    socket.on('pong', () => { client.alive = true; }); socket.on('error', () => {});
    socket.on('message', async (raw, binary) => {
      if (this.clock() - client.at >= 1000) { client.at = this.clock(); client.messages = 0; }
      if (++client.messages > 120 || binary) { socket.close(1008, 'Invalid LAN message rate'); return; }
      let data; try { data = JSON.parse(raw.toString()); } catch { return; }
      if (!data || typeof data !== 'object') return;
      try { await this.handle(client, data); }
      catch (error) { this.send(socket, { type: 'error', message: error.message, ...(error.code ? { code: error.code } : {}) }); }
    });
    socket.on('close', () => { this.directory.leave(client.id, client.room); this.clients.delete(client.id); this.publishList(); });
  }
  async handle(client, data) {
    const room = this.directory.rooms.get(client.room);
    if (data.type === 'rank-profile') {
      if (data.clear === true) { client.badgeGeneration = (client.badgeGeneration || 0) + 1; client.rankBadge = null; if (room?.players.has(client.id)) room.players.get(client.id).rankBadge = null; return; }
      if (!this.verifyBadge || typeof data.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.ticket) || client.verifyingBadge || this.clock() < (client.nextBadgeAt || 0)) return;
      client.verifyingBadge = true; client.nextBadgeAt = this.clock() + 5000;
      const generation = client.badgeGeneration = (client.badgeGeneration || 0) + 1;
      try {
        const profile = await this.verifyBadge(data.ticket);
        if (this.clients.get(client.id) !== client || generation !== client.badgeGeneration || client.socket.readyState !== WebSocket.OPEN) return;
        client.rankBadge = highestRank(profile);
        const member = this.directory.rooms.get(client.room)?.players.get(client.id);
        if (member) member.rankBadge = client.rankBadge;
        this.send(client.socket, { type: 'rank-profile', verified: true });
      } catch { this.send(client.socket, { type: 'rank-profile', verified: false }); }
      finally { client.verifyingBadge = false; }
      return;
    }
    if (data.type === 'ping') { this.send(client.socket, { type: 'pong', sent: data.sent }); return; }
    if (data.type === 'list') { this.send(client.socket, { type: 'rooms', rooms: this.directory.list() }); return; }
    if (data.type === 'leave') { this.directory.leave(client.id, client.room); client.room = null; this.send(client.socket, { type: 'left' }); this.publishList(); return; }
    if (roomLobbyAction(room, client.id, data)) { this.publishList(); return; }
    if (data.type === 'input') { room?.setInput(client.id, data); return; }
    if (data.type === 'equipment') { room?.interactEquipment(client.id, data); return; }
    if (data.type === 'loadout') { room?.selectLoadout(client.id, data); return; }
    if (data.type === 'restart') { room?.restart(client.id); return; }
    if (!['create', 'join'].includes(data.type)) throw new Error('지원하지 않는 LAN 요청입니다.');
    if (client.room || client.pending) throw new Error('현재 방 요청을 먼저 마쳐 주세요.');
    client.pending = true;
    try {
      const next = data.type === 'create' ? await this.directory.create({ ...data, mode: 'lan' }, client.id) : await this.directory.authorize(data.code, data.password, client.id);
      if (client.socket.readyState !== WebSocket.OPEN) { this.directory.discardEmpty(next); return; }
      next.addPlayer(client.id, data.name, false, data);
      next.players.get(client.id).rankBadge = client.rankBadge || null;
      if (next.staging && ['blue', 'red'].includes(data.teamId) && isTeamGame(next.gameType) && next.gameType !== 'defense') next.team(client.id, client.id, data.teamId);
      client.room = next.code;
      this.send(client.socket, { ...next.snapshot(false), type: 'joined', id: client.id, events: [], impacts: next.impactHistory() }); this.publishList();
    } finally { client.pending = false; }
  }
  publishList() { const state = { type: 'rooms', rooms: this.directory.list() }; for (const client of this.clients.values()) if (!client.room) this.send(client.socket, state); }
  tick(dt) { for (const room of this.directory.rooms.values()) room.tick(dt); }
  broadcast() { for (const room of this.directory.rooms.values()) { const state = room.snapshot(); for (const client of this.clients.values()) if (client.room === room.code) this.send(client.socket, state); } }
  heartbeat() { for (const client of this.clients.values()) { if (!client.alive) client.socket.terminate(); else { client.alive = false; client.socket.ping(); } } this.publishList(); }
  close() { for (const client of this.clients.values()) client.socket.terminate(); }
}
