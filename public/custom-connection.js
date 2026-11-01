import { NETWORK_PROTOCOL } from '/shared/world.js';

// Account authentication is a one-use Spring ticket in the first WS frame.
// Room passwords travel only in create/join messages, never in links/storage.
export class CustomConnection extends EventTarget {
  constructor(api) {
    super(); this.readyState = 0; this.closed = false; this.closeSent = false;
    this.open(api).catch((error) => { if (this.closed) return; this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'error', message: error.message }) })); this.finish(1008, 'Custom gateway authentication failed'); });
  }
  async open(api) {
    const ticket = await api.customTicket(); if (this.closed) return; const url = new URL(ticket.engineUrl);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || location.protocol === 'https:' && url.protocol !== 'wss:' || !/^[A-Za-z0-9_-]{43}$/.test(ticket.ticket)) throw new Error('사용자 대전 서버 주소를 확인하세요.');
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => { if (this.closed) this.socket.close(); });
    this.socket.addEventListener('message', (event) => {
      if (this.closed) return; let data; try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === 'hello') { if (data.protocolVersion !== NETWORK_PROTOCOL) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'error', message: '사용자 대전 서버를 재시작하고 새로고침해 주세요.' }) })); this.socket.close(4001, 'Protocol mismatch'); } else if (!this.authSent) { this.authSent = true; this.socket.send(JSON.stringify({ type: 'authenticate-custom', ticket: ticket.ticket })); } return; }
      if (data.type === 'custom-ready') {
        if (data.protocolVersion !== NETWORK_PROTOCOL) { this.socket.close(4001, 'Update the combat server'); return; }
        this.readyState = 1; data.type = 'hello';
      }
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
    });
    this.socket.addEventListener('error', () => this.dispatchEvent(new Event('error')));
    this.socket.addEventListener('close', (event) => this.finish(this.closed ? 1000 : event.code, event.reason));
  }
  finish(code, reason) { if (this.closeSent) return; this.closeSent = true; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code, reason })); }
  send(raw) { if (!this.closed && this.readyState === 1) this.socket.send(raw); }
  close() { if (this.closed) return; this.closed = true; if (this.socket) this.socket.close(1000, 'Client closed'); else this.finish(1000, 'Client closed'); }
}
