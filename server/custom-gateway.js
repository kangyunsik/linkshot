import { WebSocket } from 'ws';
import { RoomDirectory } from './room-directory.js';
import { isWeaponId } from '../shared/catalog.js';
import { NETWORK_PROTOCOL } from '../shared/world.js';

export class CustomGateway {
  constructor({ send, clock, capacity }) {
    this.send = send; this.directory = new RoomDirectory({ mode: 'custom', clock, capacity }); this.accounts = new Map();
  }
  attach(connection, profile) {
    if (this.accounts.has(profile.id)) throw new Error('이 계정은 이미 사용자 대전에 연결되어 있습니다.');
    connection.profile = profile; connection.account = profile.id; connection.kind = 'custom'; connection.roomCode = null; this.accounts.set(profile.id, connection);
    this.send(connection.socket, { type: 'custom-ready', protocolVersion: NETWORK_PROTOCOL, id: profile.id, rooms: this.directory.list() });
  }
  detach(connection) {
    if (this.accounts.get(connection.account) !== connection) return;
    this.directory.leave(connection.account, connection.roomCode); this.accounts.delete(connection.account); this.publishList();
  }
  publishList() { const state = { type: 'rooms', rooms: this.directory.list() }; for (const connection of this.accounts.values()) if (!connection.roomCode) this.send(connection.socket, state); }
  async handle(connection, data) {
    const room = this.directory.rooms.get(connection.roomCode);
    if (data.type === 'list') { this.send(connection.socket, { type: 'rooms', rooms: this.directory.list() }); return; }
    if (data.type === 'leave') { this.directory.leave(connection.account, connection.roomCode); connection.roomCode = null; this.send(connection.socket, { type: 'left' }); this.publishList(); return; }
    if (data.type === 'input') { room?.setInput(connection.account, data); return; }
    if (data.type === 'equipment') { room?.interactEquipment(connection.account, data); return; }
    if (data.type === 'loadout') { room?.selectLoadout(connection.account, data); return; }
    if (data.type === 'restart') { room?.restart(connection.account); this.publishList(); return; }
    if (!['create', 'join'].includes(data.type)) throw new Error('지원하지 않는 사용자 대전 요청입니다.');
    if (connection.roomCode) throw new Error('먼저 현재 방에서 나가 주세요.');
    if (connection.roomAction) throw new Error('이전 방 요청을 처리 중입니다.');
    connection.roomAction = true;
    try {
      const next = data.type === 'create' ? await this.directory.create(data, connection.account) : await this.directory.authorize(data.code, data.password, connection.account);
      if (connection.socket.readyState !== WebSocket.OPEN) { this.directory.discardEmpty(next); return; }
      const profile = connection.profile;
      next.addPlayer(profile.id, profile.callsign, false, { ownedWeapons: profile.ownedWeapons, weaponKills: profile.weaponKills, outfitId: profile.outfitId, characterId: profile.characterId, weaponId: isWeaponId(data.weaponId) ? data.weaponId : 'rifle', skinId: data.skinId });
      connection.roomCode = next.code;
      this.send(connection.socket, { ...next.snapshot(false), type: 'joined', id: profile.id, events: [], impacts: next.impactHistory() }); this.publishList();
    } finally { connection.roomAction = false; }
  }
  tick(dt) { for (const room of this.directory.rooms.values()) room.tick(dt); }
  broadcast() {
    for (const room of this.directory.rooms.values()) {
      const snapshot = room.snapshot(); for (const connection of this.accounts.values()) if (connection.roomCode === room.code) this.send(connection.socket, snapshot);
    }
  }
}
