import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Room, createRoomCode } from './game.js';

const derive = promisify(scrypt);
let pendingHashes = 0;
async function passwordKey(password, salt) {
  if (pendingHashes >= 8) throw new Error('방 인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  pendingHashes++;
  try { return await derive(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }); }
  finally { pendingHashes--; }
}
function checkedPassword(value = '') {
  if (typeof value !== 'string' || [...value].length > 64 || Buffer.byteLength(value) > 256) throw new Error('방 비밀번호는 64자 이하여야 합니다.');
  return value;
}
export class RoomAccessError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Secrets stay outside Room/snapshots and are never listed or put in invites.
export class RoomDirectory {
  constructor({ rooms = new Map(), mode = 'lan', capacity = () => 24, clock = () => Date.now() } = {}) {
    this.rooms = rooms; this.mode = mode; this.capacity = capacity; this.clock = clock; this.passwords = new WeakMap(); this.attempts = new WeakMap(); this.accountAttempts = new Map(); this.creations = new Map();
  }
  async create(options = {}, account = null) {
    const password = checkedPassword(options.password);
    if (options.gameType != null && !['ffa', 'teams'].includes(options.gameType)) throw new Error('개인전 또는 팀전을 선택해 주세요.');
    if (this.rooms.size >= this.capacity()) throw new Error('서버의 방이 모두 사용 중입니다.');
    if (typeof account === 'string') {
      const now = this.clock(); for (const [key, entry] of this.creations) if (now - entry.at >= 30_000) this.creations.delete(key);
      let entry = this.creations.get(account); if (!entry) { if (this.creations.size >= 4096) throw new Error('방 생성 요청이 많습니다. 잠시 후 다시 시도해 주세요.'); entry = { at: now, count: 0 }; this.creations.set(account, entry); }
      if (++entry.count > 8) throw new Error('방 생성이 너무 잦습니다. 30초 후 다시 시도해 주세요.');
    }
    const salt = password ? randomBytes(16) : null, key = password ? await passwordKey(password, salt) : null;
    if (this.rooms.size >= this.capacity()) throw new Error('서버의 방이 모두 사용 중입니다.');
    const room = new Room(createRoomCode(this.rooms), { ...options, clock: this.clock, mode: this.mode === 'lan' && options.mode === 'practice' ? 'practice' : this.mode });
    if (key) this.passwords.set(room, { salt, key });
    this.rooms.set(room.code, room); return room;
  }
  summary(room) { return { ...room.summary(), passwordProtected: this.passwords.has(room) }; }
  list() { return [...this.rooms.values()].filter((room) => room.mode === this.mode && room.hostId).map((room) => this.summary(room)); }
  async authorize(code, supplied, identity) {
    const now = this.clock(), store = typeof identity === 'string' ? this.accountAttempts : this.attempts;
    if (store === this.accountAttempts) { for (const [key, value] of store) if (now - value.at >= 30_000) store.delete(key); if (store.size >= 4096 && !store.has(identity)) throw new Error('방 인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.'); }
    let attempts = store.get(identity);
    if (!attempts || now - attempts.at >= 30_000) { attempts = { at: now, failures: 0 }; store.set(identity, attempts); }
    if (attempts.failures >= 8) throw new Error('입장 시도가 너무 많습니다. 30초 후 다시 시도해 주세요.');
    const room = this.rooms.get(typeof code === 'string' ? code.trim().toUpperCase() : '');
    if (!room || room.mode !== this.mode) { attempts.failures++; throw new Error('방을 찾을 수 없습니다. 같은 서버 주소와 방 코드를 확인하세요.'); }
    const password = checkedPassword(supplied), secret = this.passwords.get(room);
    if (secret && (!password || !timingSafeEqual(await passwordKey(password, secret.salt), secret.key))) { attempts.failures++; throw new RoomAccessError('ROOM_PASSWORD', '방 비밀번호를 확인해 주세요.'); }
    if (this.rooms.get(room.code) !== room) throw new Error('방이 종료되었습니다. 목록을 새로고침해 주세요.');
    return room;
  }
  leave(id, code) {
    const room = this.rooms.get(code); room?.removePlayer(id);
    if (room && !room.hostId) this.rooms.delete(room.code);
  }
  discardEmpty(room) { if (!room.hostId) this.rooms.delete(room.code); }
}
