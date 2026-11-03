import { randomUUID } from 'node:crypto';
import { Room, getBotDifficulty } from '../shared/simulation.js';
import { RULES } from '../shared/world.js';
import { isWeaponId, ownsWeapon, getSkin } from '../shared/catalog.js';

// Waiting members share the roster, but never have a combat body or respawn.
export class LobbyRoom extends Room {
  constructor(code, options = {}) {
    super(code, { ...options, bots: 0 }); this.phase = 'lobby'; this.staging = true;
    const count = Number.isInteger(options.bots) ? Math.max(0, Math.min(7, options.bots)) : 2;
    this.botSerial = count;
    for (let i = 0; i < count; i++) this.addPlayer(`bot-${randomUUID()}`, `AI ${i + 1}`, true);
  }
  park(player) {
    player.roomStatus = 'waiting'; player.ready = false; player.hp = 0; player.respawnAt = Infinity;
    player.input = { forward: 0, strafe: 0, yaw: player.yaw, pitch: player.pitch }; player.pendingShot = null; player.burstLeft = 0; player.history = [];
  }
  addPlayer(...args) { const owner = !this.hostId, player = super.addPlayer(...args); this.park(player); player.teamConfirmed = this.gameType !== 'teams' || player.isBot || owner; return player; }
  host(id) { if (id !== this.hostId) throw new Error('방장만 방 구성을 변경할 수 있습니다.'); }
  member(id) { const player = this.players.get(id); if (!player || player.isBot) throw new Error('방 참가자를 확인해 주세요.'); return player; }
  team(id, targetId, teamId) {
    const actor = this.member(id), player = this.players.get(targetId || id);
    if (!player || actor.id !== player.id && id !== this.hostId) throw new Error('자신 또는 방장이 대기 중인 참가자의 팀을 변경할 수 있습니다.');
    if (player.roomStatus !== 'waiting') throw new Error('교전 중에는 팀을 변경할 수 없습니다. 대기실로 돌아와 주세요.');
    if (this.gameType !== 'teams' || !['blue', 'red'].includes(teamId)) throw new Error('블루팀 또는 레드팀을 선택해 주세요.');
    player.teamId = teamId; player.teamConfirmed = player.isBot || actor.id === player.id; player.ready = false;
  }
  bot(id, data) {
    this.host(id); if (this.phase === 'active') throw new Error('AI 구성은 경기 시작 전에 변경해 주세요.');
    if (data.remove === true) { const player = this.players.get(data.id); if (!player?.isBot) throw new Error('제거할 AI를 확인해 주세요.'); this.removePlayer(player.id); return; }
    if (this.players.size >= RULES.maxPlayers) throw new Error('방이 가득 찼습니다.');
    if (this.gameType === 'teams' && !['blue', 'red'].includes(data.teamId)) throw new Error('AI의 팀을 선택해 주세요.');
    const player = this.addPlayer(`bot-${randomUUID()}`, `AI ${++this.botSerial}`, true);
    if (this.gameType === 'teams') player.teamId = data.teamId;
    const difficulty = getBotDifficulty(data.difficulty); player.botDifficulty = difficulty.id;
  }
  start(id) {
    this.host(id); if (!['lobby', 'ended'].includes(this.phase)) throw new Error('이미 교전 중입니다.');
    if ([...this.players.values()].some((p) => !p.isBot && !p.teamConfirmed)) throw new Error('입장할 팀을 먼저 선택·확정해 주세요.');
    if ([...this.players.values()].some((p) => !p.isBot && p.id !== id && !p.ready)) throw new Error('참가자들이 준비를 마칠 때까지 기다려 주세요.');
    if (this.gameType === 'teams' && ['blue', 'red'].some((team) => ![...this.players.values()].some((p) => p.teamId === team))) throw new Error('양 팀에 플레이어나 AI를 배치해 주세요.');
    for (const player of this.players.values()) { player.roomStatus = 'playing'; player.ready = false; }
    super.restart(id);
  }
  restart(id) { this.start(id); }
  enter(id) { const player = this.member(id); if (this.phase !== 'active' || player.roomStatus !== 'waiting') throw new Error('입장할 수 있는 교전을 확인해 주세요.'); if (!player.teamConfirmed) throw new Error('입장할 팀을 먼저 선택·확정해 주세요.'); player.roomStatus = 'playing'; player.ready = false; this.spawn(player); }
  returnToLobby(id) { const player = this.member(id); if (player.roomStatus === 'playing' && this.phase === 'active' && player.hp > 0) { this.dropWeapon(player); player.deaths++; } this.park(player); }
  loadout(id, data) {
    const player = this.member(id); if (player.roomStatus !== 'waiting') throw new Error('대기실에서만 출격 장비를 변경할 수 있습니다.');
    if (!isWeaponId(data.weaponId) || !ownsWeapon(player, data.weaponId)) throw new Error('보유한 무기를 선택해 주세요.');
    player.nextWeaponId = player.weaponId = data.weaponId; if (data.skinId) player.skinId = getSkin(data.skinId).id;
  }
  finish() { if (this.phase === 'ended') return; super.finish(); for (const player of this.players.values()) this.park(player); }
  summary() { return { ...super.summary(), staging: true, playing: [...this.players.values()].filter((p) => !p.isBot && p.roomStatus === 'playing').length }; }
  snapshot(...args) {
    const state = super.snapshot(...args); state.room.staging = true;
    for (const player of state.players) { const member = this.players.get(player.id); Object.assign(player, { roomStatus: member.roomStatus, ready: member.ready, teamConfirmed: member.teamConfirmed, botDifficulty: member.botDifficulty || this.botDifficulty }); }
    return state;
  }
}

export function roomLobbyAction(room, id, data) {
  if (typeof data.type !== 'string' || !data.type.startsWith('room-')) return false;
  if (!(room instanceof LobbyRoom)) throw new Error('대기실을 지원하는 방을 선택해 주세요.');
  if (data.type === 'room-team') room.team(id, data.id, data.teamId);
  else if (data.type === 'room-bot') room.bot(id, data);
  else if (data.type === 'room-start') room.start(id);
  else if (data.type === 'room-enter') room.enter(id);
  else if (data.type === 'room-return') room.returnToLobby(id);
  else if (data.type === 'room-ready') { const player = room.member(id); if (player.roomStatus !== 'waiting' || room.phase === 'active') throw new Error('대기 중인 경기에서 준비해 주세요.'); if (!player.teamConfirmed) throw new Error('입장할 팀을 먼저 선택·확정해 주세요.'); player.ready = data.ready === true; }
  else if (data.type === 'room-loadout') room.loadout(id, data);
  else throw new Error('지원하지 않는 대기실 요청입니다.');
  return true;
}
