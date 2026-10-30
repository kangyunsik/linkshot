import { randomInt } from 'node:crypto';

export { Room, traceShot, findPath, cleanName } from '../shared/simulation.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function createRoomCode(existing) {
  let code;
  do { code = Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); } while (existing.has(code));
  return code;
}
