import test from 'node:test';
import assert from 'node:assert/strict';
import { LAN_HOST, PeerLanRoom } from '../shared/peer-lan-room.js';
import { encodeLanSignal, decodeLanSignal, LAN_SIGNAL_LENGTH } from '../shared/peer-lan-signal.js';
import { NETWORK_PROTOCOL } from '../shared/world.js';

const privateAddress = [192, 168, 10, 7].join('.');
const id = '0123456789abcdef'.repeat(2);
const sdp = (...candidates) => ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0', 'a=sctp-port:5000', ...candidates.map(([address, kind], i) => `a=candidate:${i + 1} 1 udp 200 ${address} 5000 typ ${kind}`), ''].join('\r\n');
const token = value => 'LSLAN1.' + Buffer.from(JSON.stringify(value)).toString('base64url');

test('manual signaling uses local data-channel ICE only and binds the response to its invite version and id', () => {
  const original = sdp([privateAddress, 'host'], ['f003-13.local', 'host'], ['fe80::7', 'host'], ['203.0.113.5', 'host'], [privateAddress, 'relay'], [privateAddress, 'srflx']);
  const offer = encodeLanSignal('offer', id, original);
  const fromLink = decodeLanSignal(`https://example.test/linkshot/#lan=${offer}`, 'offer');
  assert.deepEqual(fromLink, decodeLanSignal(offer, 'offer'));
  assert.equal(fromLink.id, id); assert.equal(fromLink.version, NETWORK_PROTOCOL);
  assert.equal(fromLink.sdp.match(/a=candidate:/g).length, 3);
  assert.doesNotMatch(fromLink.sdp, /203\.0\.113\.5|typ (relay|srflx)/);
  assert.equal(decodeLanSignal(encodeLanSignal('answer', id, original), 'answer').id, id);
  assert.throws(() => decodeLanSignal(offer, 'answer'), /유효한/);
  assert.throws(() => decodeLanSignal(token({ ...fromLink, version: NETWORK_PROTOCOL - 1 }), 'offer'), /버전/);
  assert.throws(() => decodeLanSignal('X'.repeat(LAN_SIGNAL_LENGTH + 1), 'offer'), /유효한/);
  assert.throws(() => encodeLanSignal('offer', id, sdp(['203.0.113.5', 'host'])), /LAN 연결 주소/);
  assert.throws(() => encodeLanSignal('offer', id, `${original}m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n`), /유효한/);
});

test('peer LAN uses the shared lobby and authoritative combat, never grants host permissions to a guest', () => {
  let now = 1000;
  const output = [], lan = new PeerLanRoom((ids, data) => output.push({ ids, data }), () => now);
  const create = { type: 'create', gameType: 'ffa', bots: 0, roomName: 'LOCAL TEST' };
  lan.hello(); assert.equal(output.at(-1).data.id, LAN_HOST);
  lan.handle('guest-1', { ...create, id: LAN_HOST }); assert.equal(lan.room, null);
  lan.handle(LAN_HOST, { ...create, name: 'HOST' });
  const room = lan.room;
  assert.equal(room.hostId, LAN_HOST); assert.equal(room.phase, 'lobby');
  lan.handle('guest-1', { type: 'join', protocolVersion: NETWORK_PROTOCOL - 1 });
  assert.equal(room.players.size, 1);
  lan.handle('guest-1', { type: 'join', protocolVersion: NETWORK_PROTOCOL, id: LAN_HOST, name: 'GUEST', weaponId: 'sniper', rankBadge: 'GOLD' });
  assert.equal(output.at(-1).data.id, 'guest-1'); assert.equal(room.players.get('guest-1').rankBadge, null);
  lan.handle('guest-1', { type: 'room-start', id: LAN_HOST });
  assert.match(output.at(-1).data.message, /방장만/); assert.equal(room.phase, 'lobby');
  lan.handle(LAN_HOST, { type: 'room-start' }); assert.equal(room.phase, 'lobby');
  lan.handle('guest-1', { type: 'room-ready', ready: true }); lan.handle(LAN_HOST, { type: 'room-start' });
  assert.equal(room.phase, 'active');
  const guest = room.players.get('guest-1'), ammo = guest.ammo;
  now += 16; lan.handle('guest-1', { type: 'input', fire: true, yaw: guest.yaw, pitch: 0 }); lan.tick(1 / 60); lan.broadcast();
  assert.equal(guest.ammo, ammo - 1);
  assert.deepEqual(output.at(-1).ids, [LAN_HOST, 'guest-1']);
  assert.equal(output.at(-1).data.events.find(event => event.type === 'shot')?.id, 'guest-1');
  lan.dropGuest(LAN_HOST); assert.equal(room.hostId, LAN_HOST);
  lan.dropGuest('guest-1'); assert.equal(room.players.size, 1);
  lan.handle('guest-2', { type: 'join', protocolVersion: NETWORK_PROTOCOL });
  lan.handle(LAN_HOST, { type: 'leave' });
  assert.equal(lan.room, null); assert.deepEqual(output.at(-1), { ids: [LAN_HOST, 'guest-2'], data: { type: 'lan-closed' } });
});
