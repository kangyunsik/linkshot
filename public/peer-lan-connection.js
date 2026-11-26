import { LAN_HOST, lanCapacity } from '/shared/peer-lan-room.js';
import { encodeLanSignal, decodeLanSignal } from '/shared/peer-lan-signal.js';
import { NETWORK_PROTOCOL } from '/shared/world.js';

const LABEL = 'linkshot-lan';
const INVITE_TIME = 5 * 60_000, CONNECT_TIME = 25_000, SILENCE = 20_000;
const FRAME_BYTES = 16_384, MAX_STATE = 1024 * 1024, MAX_INPUT = 4096;
const CLOSED = '방장이 나가 LAN 방이 종료되었습니다. 다시 참가하려면 새 초대를 받으세요.';
const UNREACHABLE = '직접 연결하지 못했습니다. 같은 LAN에 연결하고 로컬 네트워크 접근을 허용한 뒤 새 초대를 사용하세요.';
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const emit = (connection, raw) => connection.dispatchEvent(new MessageEvent('message', { data: raw }));
const closed = (connection, code, reason) => connection.dispatchEvent(new CloseEvent('close', { code, reason }));

function waitFor(target, event, ready, signal, timeout, message) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer); target.removeEventListener(event, check); signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve();
    };
    const check = () => { if (ready()) finish(); };
    const cancel = () => finish(new Error(message));
    const timer = setTimeout(cancel, timeout);
    target.addEventListener(event, check); signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel(); else check();
  });
}

class PeerLink extends EventTarget {
  constructor(maxIncoming) {
    super();
    this.abort = new AbortController();
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.maxIncoming = maxIncoming; this.parts = []; this.bytes = 0;
    this.pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(this.pc.connectionState)) this.close();
    }, { signal: this.abort.signal });
  }

  attach(channel) {
    if (this.channel || channel.label !== LABEL || !channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) {
      channel.close(); this.close(); return;
    }
    this.channel = channel; channel.binaryType = 'arraybuffer';
    const options = { signal: this.abort.signal };
    channel.addEventListener('close', () => this.close(), options);
    channel.addEventListener('error', () => this.close(), options);
    channel.addEventListener('message', event => this.receive(event.data), options);
    const open = () => this.dispatchEvent(new Event('open'));
    if (channel.readyState === 'open') open(); else channel.addEventListener('open', open, options);
  }

  async gather(type) {
    await this.pc.setLocalDescription(type === 'offer' ? await this.pc.createOffer() : await this.pc.createAnswer());
    await waitFor(this.pc, 'icegatheringstatechange', () => this.pc.iceGatheringState === 'complete',
      this.abort.signal, 15_000, 'LAN 주소 준비 시간이 초과되었습니다. 로컬 네트워크 접근 권한을 확인해 주세요.');
    return this.pc.localDescription.sdp;
  }

  waitOpen() {
    return waitFor(this, 'open', () => this.channel?.readyState === 'open', this.abort.signal, CONNECT_TIME, UNREACHABLE);
  }

  // Reliable, ordered frames keep lobby actions and combat events together.
  // Split large snapshots to fit DataChannel implementations with small SCTP limits.
  send(raw) {
    if (this.channel?.readyState !== 'open') return false;
    const bytes = encoder.encode(raw);
    if (!bytes.length || bytes.length > MAX_STATE || this.channel.bufferedAmount + bytes.length > MAX_STATE * 2) { this.close(); return false; }
    const partSize = Math.min(FRAME_BYTES, this.pc.sctp?.maxMessageSize || FRAME_BYTES) - 1;
    if (partSize < 1) { this.close(); return false; }
    try {
      for (let at = 0; at < bytes.length; at += partSize) {
        const part = bytes.subarray(at, at + partSize), frame = new Uint8Array(part.length + 1);
        frame[0] = Number(at + part.length === bytes.length); frame.set(part, 1); this.channel.send(frame);
      }
      return true;
    } catch { this.close(); return false; }
  }

  receive(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 2 || buffer.byteLength > FRAME_BYTES) { this.close(); return; }
    const [last] = new Uint8Array(buffer, 0, 1), part = new Uint8Array(buffer, 1);
    this.bytes += part.length;
    if (last > 1 || this.bytes > this.maxIncoming || this.parts.length >= 256 || (!last && this.maxIncoming === MAX_INPUT)) { this.close(); return; }
    this.parts.push(part);
    if (!last) return;
    const bytes = new Uint8Array(this.bytes); let at = 0;
    for (const chunk of this.parts) { bytes.set(chunk, at); at += chunk.length; }
    this.parts = []; this.bytes = 0;
    let raw; try { raw = decoder.decode(bytes); } catch { this.close(); return; }
    emit(this, raw);
  }

  close() {
    if (this.abort.signal.aborted) return;
    this.abort.abort(); this.parts = []; this.channel?.close(); this.pc.close();
    this.dispatchEvent(new Event('close'));
  }
}

export class PeerLanHostConnection extends EventTarget {
  constructor(options) {
    super();
    this.role = 'host'; this.readyState = 0; this.peers = new Map();
    this.maxGuests = lanCapacity(options.gameType) - 1;
    this.worker = new Worker(new URL('./peer-lan-worker.js', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', ({ data: { ids, data } }) => {
      if (data.type === 'hello') this.readyState = 1;
      if (data.type === 'lan-closed') { this.close(); return; }
      const raw = JSON.stringify(data);
      for (const id of ids) {
        if (id === LAN_HOST) { emit(this, raw); continue; }
        const link = this.peers.get(id)?.link;
        // Drop only superseded motion updates when an individual link backs up.
        if (data.type === 'state' && !data.events.length && link?.channel?.bufferedAmount > 256 * 1024) continue;
        link?.send(raw);
      }
    });
    this.worker.addEventListener('error', () => this.close(1011, '방장 브라우저에서 LAN 시뮬레이션을 시작하지 못했습니다.'));
    this.worker.postMessage({ id: LAN_HOST, message: options });
    this.heartbeat = setInterval(() => {
      for (const { link, seen } of this.peers.values()) if (seen && performance.now() - seen > SILENCE) link.close();
    }, 4000);
  }

  send(raw) {
    if (this.readyState === 1) this.worker.postMessage({ id: LAN_HOST, message: JSON.parse(raw) });
  }

  makeInvite() {
    if (this.readyState !== 1) throw new Error('방이 열려 있을 때만 초대할 수 있습니다.');
    if (this.pending) return this.pending.offer;
    if (this.peers.size >= this.maxGuests) throw new Error('방이 가득 찼습니다.');
    const id = crypto.randomUUID().replaceAll('-', ''), link = new PeerLink(MAX_INPUT);
    const peer = { id, link, seen: 0, count: 0, windowAt: 0, expiresAt: Date.now() + INVITE_TIME };
    this.peers.set(id, peer); this.pending = peer;
    peer.expiry = setTimeout(() => link.close(), INVITE_TIME);
    link.addEventListener('open', () => { peer.seen = performance.now(); });
    link.addEventListener('close', () => {
      this.peers.delete(id); clearTimeout(peer.expiry);
      if (this.pending === peer) this.pending = null;
      if (this.readyState === 1) this.worker.postMessage({ type: 'drop', id });
    });
    link.addEventListener('message', ({ data }) => {
      peer.seen = performance.now();
      if (peer.seen - peer.windowAt >= 1000) { peer.windowAt = peer.seen; peer.count = 0; }
      if (++peer.count > 120) { link.close(); return; }
      let message; try { message = JSON.parse(data); } catch { link.close(); return; }
      this.worker.postMessage({ id, message });
    });
    link.attach(link.pc.createDataChannel(LABEL));
    peer.offer = link.gather('offer').then(sdp => encodeLanSignal('offer', id, sdp))
      .catch(error => { link.close(); throw error; });
    return peer.offer;
  }

  cancelInvite() { this.pending?.link.close(); }

  async acceptAnswer(text) {
    const answer = decodeLanSignal(text, 'answer'), peer = this.pending;
    if (peer && Date.now() >= peer.expiresAt) peer.link.close();
    if (!peer || this.pending !== peer || peer.id !== answer.id) throw new Error('이 초대의 응답 코드가 아니거나 초대가 만료되었습니다. 현재 링크로 다시 시도해 주세요.');
    if (peer.accepting) throw new Error('이 응답을 이미 확인 중입니다.');
    peer.accepting = true;
    try {
      await peer.link.pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
      await peer.link.waitOpen(); clearTimeout(peer.expiry); if (this.pending === peer) this.pending = null;
    } catch { peer.link.close(); throw new Error(UNREACHABLE); }
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3; clearInterval(this.heartbeat); this.worker.terminate();
    for (const { link } of this.peers.values()) { link.send('{"type":"lan-closed"}'); link.close(); }
    closed(this, code, reason);
  }
}

export class PeerLanGuestConnection extends EventTarget {
  constructor(loadout) { super(); this.role = 'guest'; this.readyState = 0; this.joined = false; this.loadout = loadout; }

  async answerInvite(text) {
    const invite = decodeLanSignal(text, 'offer');
    this.id = invite.id;
    const link = this.link = new PeerLink(MAX_STATE);
    this.expiry = setTimeout(() => this.close(1008, UNREACHABLE), INVITE_TIME);
    link.addEventListener('close', () => this.close(1006, this.joined ? CLOSED : UNREACHABLE));
    link.addEventListener('message', ({ data: raw }) => {
      let data; try { data = JSON.parse(raw); } catch { this.close(1008, 'LAN 응답을 확인할 수 없습니다.'); return; }
      this.seen = performance.now();
      if (data?.type === 'lan-closed') { this.close(1000, CLOSED); return; }
      if (data?.type === 'error' && !this.joined) { this.close(1008, typeof data.message === 'string' ? data.message.slice(0, 160) : UNREACHABLE); return; }
      if (data?.type === 'joined' && !this.joined && data.id === this.id && data.room?.mode === 'lan' && data.room.hostId === LAN_HOST && Array.isArray(data.players)) {
        this.joined = true; this.roomCode = data.room.code; emit(this, raw);
      } else if (this.joined && (data?.type === 'state' && data.room?.code === this.roomCode && data.room?.mode === 'lan' && data.room.hostId === LAN_HOST && Array.isArray(data.players) || ['error', 'pong'].includes(data?.type))) emit(this, raw);
    });
    link.addEventListener('open', () => {
      this.readyState = 1; this.seen = performance.now(); clearTimeout(this.expiry);
      emit(this, JSON.stringify({ type: 'hello', id: this.id }));
      this.send(JSON.stringify({ ...this.loadout, type: 'join', protocolVersion: NETWORK_PROTOCOL }));
      const openedAt = this.seen;
      this.heartbeat = setInterval(() => {
        if (!this.joined && performance.now() - openedAt > CONNECT_TIME || performance.now() - this.seen > SILENCE) this.close(1006, this.joined ? CLOSED : UNREACHABLE);
      }, 4000);
    }, { once: true });
    link.pc.addEventListener('datachannel', event => link.attach(event.channel), { signal: link.abort.signal });
    await link.pc.setRemoteDescription({ type: invite.type, sdp: invite.sdp });
    return encodeLanSignal('answer', invite.id, await link.gather('answer'));
  }

  send(raw) { if (this.readyState === 1) this.link.send(raw); }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3; clearTimeout(this.expiry); clearInterval(this.heartbeat); this.link?.close();
    closed(this, code, reason);
  }
}
