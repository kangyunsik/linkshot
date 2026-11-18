import { WebSocket, WebSocketServer } from 'ws';

export function installLanProxy(server, address) {
  const target = new URL(address);
  if (!['ws:', 'wss:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== '/lan/play') throw new Error('LAN_ENGINE_URL must be a ws(s) URL ending in /lan/play.');
  const info = new URL(target); info.protocol = target.protocol === 'wss:' ? 'https:' : 'http:'; info.pathname = '/lan/info';
  const sockets = new Set(), wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    let sameOrigin = false;
    try { sameOrigin = !!request.headers.origin && new URL(request.headers.origin).host === request.headers.host; } catch {}
    if (request.url !== '/lan/play' || !sameOrigin) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (front) => {
      const back = new WebSocket(target, { origin: request.headers.origin, handshakeTimeout: 3000, maxPayload: 16 * 1024 * 1024 });
      sockets.add(front); sockets.add(back); const queued = [];
      const stop = () => { for (const peer of [front, back]) { sockets.delete(peer); if (peer.readyState === WebSocket.OPEN) peer.close(1011, 'LAN connection closed'); else if (peer.readyState === WebSocket.CONNECTING) peer.terminate(); } };
      front.on('message', (data, binary) => {
        if (binary || data.length > 4096) { stop(); return; }
        if (back.readyState === WebSocket.OPEN && back.bufferedAmount < 512 * 1024) back.send(data, { binary: false });
        else if (back.readyState === WebSocket.CONNECTING && queued.length < 16) queued.push(data);
        else stop();
      });
      back.on('open', () => { for (const data of queued.splice(0)) back.send(data, { binary: false }); });
      back.on('message', (data, binary) => { if (front.readyState === WebSocket.OPEN && front.bufferedAmount < 512 * 1024) front.send(data, { binary }); });
      front.on('error', stop); back.on('error', stop); front.on('close', stop); back.on('close', stop);
    });
  });
  return {
    async info(request, response) {
      if (request.url !== '/api/info') return false;
      try {
        const upstream = await fetch(info, { signal: AbortSignal.timeout(1500), redirect: 'error' });
        if (!upstream.ok) throw new Error('LAN unavailable');
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(await upstream.json()));
      } catch { response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ message: 'LAN 전투 서버를 실행해 주세요.' })); }
      return true;
    },
    close() { for (const socket of sockets) socket.terminate(); wss.close(); },
  };
}
