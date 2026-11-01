// Spring owns identity/assignment. Only a short-lived single-use ticket crosses
// into the WebSocket gateway; it never appears in the URL or localStorage.
export class OnlineConnection extends EventTarget {
  constructor(api, weaponId = 'rifle') {
    super(); this.readyState = 0; this.closed = false; this.closeSent = false;
    this.open(api, weaponId).catch((error) => { if (this.closed) return; this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'error', message: error.message }) })); this.finish(1008, 'Online authentication failed'); });
  }
  async open(api, weaponId) {
    const ticket = await api.ticket(); if (this.closed) return;
    const url = new URL(ticket.engineUrl);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || location.protocol === 'https:' && url.protocol !== 'wss:' || !/^[A-Za-z0-9_-]{43}$/.test(ticket.ticket)) throw new Error('온라인 전투 서버 접속 정보를 확인하세요.');
    this.matchId = ticket.matchId; this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => { if (this.closed) { this.socket.close(); return; } this.readyState = 1; this.socket.send(JSON.stringify({ type: 'authenticate', matchId: ticket.matchId, ticket: ticket.ticket, weaponId })); });
    this.socket.addEventListener('message', (event) => { if (!this.closed) this.dispatchEvent(new MessageEvent('message', { data: event.data })); });
    this.socket.addEventListener('error', () => this.dispatchEvent(new Event('error')));
    this.socket.addEventListener('close', (event) => this.finish(this.closed ? 1000 : event.code, event.reason));
  }
  finish(code, reason) { if (this.closeSent) return; this.closeSent = true; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code, reason })); }
  send(raw) { if (this.readyState === 1 && !this.closed) this.socket.send(raw); }
  close() { if (this.closed) return; this.closed = true; if (this.socket) this.socket.close(1000, 'Client closed'); else this.finish(1000, 'Client closed'); }
}
