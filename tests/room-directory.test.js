import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RoomDirectory } from '../server/room-directory.js';

test('LAN and WAN room lists expose only password protection, never the password/hash, and retain host migration', async () => {
  for (const mode of ['lan', 'custom']) {
    const directory = new RoomDirectory({ mode }), password = randomUUID(), room = await directory.create({ bots: 0, gameType: 'teams', roomName: '<FRIENDS>', password }); room.addPlayer('host', 'HOST');
    const listing = directory.list()[0]; assert.equal(listing.name, 'FRIENDS'); assert.equal(listing.passwordProtected, true); assert.equal(listing.gameType, 'teams'); assert.equal(JSON.stringify(listing).includes(password), false); assert.equal(JSON.stringify(room.snapshot()).includes(password), false);
    const guest = {}; await assert.rejects(() => directory.authorize(room.code, '', guest), (error) => error.code === 'ROOM_PASSWORD'); await assert.rejects(() => directory.authorize(room.code, 'wrong', guest), /비밀번호/); assert.equal(await directory.authorize(room.code.toLowerCase(), password, guest), room);
    room.addPlayer('guest', 'GUEST'); directory.leave('host', room.code); assert.equal(room.hostId, 'guest'); assert.equal(directory.list()[0].passwordProtected, true); directory.leave('guest', room.code); assert.equal(directory.list().length, 0); assert.equal(directory.rooms.size, 0);
  }
});

test('password guessing is bounded, invalid options fail safely, and rooms retain their configured combat rules', async () => {
  let now = 1000; const directory = new RoomDirectory({ mode: 'custom', clock: () => now, capacity: () => 1 }), password = randomUUID(), room = await directory.create({ bots: 0, password, mapId: 'longrail', fragLimit: 30, roundSeconds: 600, gameType: 'teams' }); room.addPlayer('host', 'HOST');
  const identity = {}; for (let i = 0; i < 8; i++) await assert.rejects(() => directory.authorize(room.code, 'bad', identity), /비밀번호/); await assert.rejects(() => directory.authorize(room.code, password, identity), /30초/); now += 30_001; assert.equal(await directory.authorize(room.code, password, identity), room);
  assert.equal(room.world.id, 'longrail'); assert.equal(room.fragLimit, 30); assert.equal(room.roundSeconds, 600); await assert.rejects(() => directory.create({ password: '' }), /모두 사용/); await assert.rejects(() => directory.create({ gameType: 'forged' }), /교전|개인전/); await assert.rejects(() => directory.create({ password: 'x'.repeat(65) }), /64자/);
  for (let i = 0; i < 8; i++) await assert.rejects(() => directory.authorize(room.code, 'bad', 'same-account'), /비밀번호/); await assert.rejects(() => directory.authorize(room.code, password, 'same-account'), /30초/);
});

test('WAN room creation limits follow the account across reconnections rather than trusting a new client object', async () => {
  const directory = new RoomDirectory({ mode: 'custom' });
  for (let i = 0; i < 8; i++) { const room = await directory.create({ bots: 0 }, 'same-account'); directory.discardEmpty(room); }
  await assert.rejects(() => directory.create({ bots: 0 }, 'same-account'), /30초/);
});

test('joining an open room cannot reset the account password-guessing budget', async () => {
  const directory = new RoomDirectory({ mode: 'custom' }), password = randomUUID();
  const locked = await directory.create({ bots: 0, password }), open = await directory.create({ bots: 0 });
  for (let i = 0; i < 7; i++) {
    await assert.rejects(() => directory.authorize(locked.code, 'bad', 'same-account'), /비밀번호/);
    assert.equal(await directory.authorize(open.code, '', 'same-account'), open);
  }
  await assert.rejects(() => directory.authorize(locked.code, 'bad', 'same-account'), /비밀번호/);
  await assert.rejects(() => directory.authorize(locked.code, password, 'same-account'), /30초/);
});
