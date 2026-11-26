import { LobbyRoom, roomLobbyAction } from './room-lobby.js';
import { isGameType, isTeamGame } from './game-types.js';
import { NETWORK_PROTOCOL, RULES } from './world.js';

export const LAN_HOST = 'browser-lan-host';
export const lanCapacity = (gameType) => gameType === 'defense' ? 4 : RULES.maxPlayers;
const roomCode = () => [...crypto.getRandomValues(new Uint8Array(5))].map(n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('');

// One room per host tab. The bridge assigns the sender from the connection,
// never from a player id or role supplied in a guest's payload.
export class PeerLanRoom {
  constructor(send, clock = Date.now) { this.send = send; this.clock = clock; this.room = null; }

  hello() { this.send([LAN_HOST], { type: 'hello', id: LAN_HOST }); }

  enter(id, data) {
    const room = this.room;
    const { weaponId, ownedWeapons, skinId, outfitId, characterId, weaponKills, suppressedWeapons, suppressor } = data;
    room.addPlayer(id, data.name, false, { weaponId, ownedWeapons, skinId, outfitId, characterId, weaponKills, suppressedWeapons, suppressor });
    if (isTeamGame(room.gameType) && room.gameType !== 'defense' && ['blue', 'red'].includes(data.teamId)) room.team(id, id, data.teamId);
    this.send([id], { ...room.snapshot(false), type: 'joined', id, events: [], impacts: room.impactHistory().slice(-128) });
  }

  handle(id, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    try {
      if (data.type === 'ping' && Number.isFinite(data.sent)) { this.send([id], { type: 'pong', sent: data.sent }); return; }
      if (data.type === 'create') {
        if (id !== LAN_HOST || this.room) throw new Error('이 탭의 방장만 방을 만들 수 있습니다.');
        const { bots, mapId, gameType, fragLimit, roundSeconds, scoreLimit, waves, roomName } = data;
        if (!isGameType(gameType)) throw new Error('지원하는 교전 방식을 선택해 주세요.');
        this.room = new LobbyRoom(roomCode(), { mode: 'lan', clock: this.clock, bots, mapId, gameType, fragLimit, roundSeconds, scoreLimit, waves, roomName });
        this.enter(id, data);
        return;
      }
      const room = this.room;
      if (!room) return;
      if (data.type === 'join') {
        if (id === LAN_HOST || data.protocolVersion !== NETWORK_PROTOCOL) throw new Error('플레이 버전이 다릅니다. 두 브라우저를 새로고침해 주세요.');
        this.enter(id, data);
        return;
      }
      if (!room.players.has(id)) return;
      if (data.type === 'leave') {
        if (id === LAN_HOST) { this.send([...room.players.keys()], { type: 'lan-closed' }); this.room = null; }
        else { this.dropGuest(id); this.send([id], { type: 'left' }); }
        return;
      }
      if (roomLobbyAction(room, id, data)) return;
      if (data.type === 'input') room.setInput(id, data);
      else if (data.type === 'equipment') room.interactEquipment(id, data);
      else if (data.type === 'loadout') room.selectLoadout(id, data);
      else if (data.type === 'restart') room.restart(id);
    } catch (error) { this.send([id], { type: 'error', message: error.message }); }
  }

  dropGuest(id) { if (id !== LAN_HOST && this.room?.players.has(id)) this.room.removePlayer(id); }
  tick(dt) { this.room?.tick(dt); }
  broadcast() {
    if (!this.room) return;
    const ids = [...this.room.players.values()].filter(player => !player.isBot).map(player => player.id);
    this.send(ids, this.room.snapshot());
  }
}
