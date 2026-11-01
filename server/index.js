import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomDirectory } from './room-directory.js';
import { RULES, NETWORK_PROTOCOL } from '../shared/world.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.wav': 'audio/wav' };

export function lanUrls(port) {
  const addresses = Object.entries(networkInterfaces()).sort(([a], [b]) => Number(b === 'en0') - Number(a === 'en0'));
  return [...new Set(addresses.flatMap(([, values]) => values.filter((v) => v.family === 'IPv4' && !v.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address)).map((v) => `http://${v.address}:${port}`)))];
}

export function createGameServer({ port = Number(process.env.PORT) || 3000, host = process.env.HOST || '0.0.0.0', loop = true } = {}) {
  const rooms = new Map(), clients = new Map();
  const directory = new RoomDirectory({ rooms });
  let actualPort = port;
  const roomList = () => directory.list();
  const info = () => ({ name: 'LINKSHOT', version: '0.1.0', protocolVersion: NETWORK_PROTOCOL, port: actualPort, urls: lanUrls(actualPort), rooms: roomList(), totalPlayers: [...clients.values()].filter((c) => c.room).length });
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400); response.end('Bad request'); return; }
    if (pathname === '/api/info') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(info())); return;
    }
    const allowedShared = new Set(['/shared/world.js', '/shared/buildings.js', '/shared/spawns.js', '/shared/movement.js', '/shared/catalog.js', '/shared/simulation.js', '/shared/progression.js', '/shared/outfits.js', '/shared/equipment.js', '/shared/tutorial.js', '/shared/training-world.js', '/shared/teams.js']);
    const vendor = { '/vendor/three.module.js': 'three.module.js', '/vendor/three.core.js': 'three.core.js' };
    const addon = { '/vendor/addons/loaders/GLTFLoader.js': 'loaders/GLTFLoader.js', '/vendor/addons/utils/BufferGeometryUtils.js': 'utils/BufferGeometryUtils.js', '/vendor/addons/utils/SkeletonUtils.js': 'utils/SkeletonUtils.js' };
    let file;
    if (vendor[pathname]) file = path.join(root, 'node_modules/three/build', vendor[pathname]);
    else if (addon[pathname]) file = path.join(root, 'node_modules/three/examples/jsm', addon[pathname]);
    else if (allowedShared.has(pathname)) file = path.join(root, pathname);
    else {
      const publicRoot = path.join(root, 'public');
      file = path.resolve(publicRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!file.startsWith(`${publicRoot}${path.sep}`)) { response.writeHead(403); response.end('Forbidden'); return; }
    }
    try {
      const details = await stat(file);
      if (!details.isFile()) throw new Error('Not a file');
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': details.size, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  const wss = new WebSocketServer({ server, path: '/play', maxPayload: 4096, perMessageDeflate: false });
  const send = (socket, data) => { if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512 * 1024) socket.send(JSON.stringify(data)); };
  function leave(client) {
    if (!client.room) return;
    directory.leave(client.id, client.room);
    client.room = null;
  }
  function enter(client, room, name, loadout = {}) {
    room.addPlayer(client.id, name, false, loadout);
    client.room = room.code;
    send(client.socket, { ...room.snapshot(false), type: 'joined', id: client.id, events: [], impacts: room.impactHistory() });
  }
  wss.on('connection', (socket, request) => {
    if (request.headers.origin) {
      let originHost;
      try { originHost = new URL(request.headers.origin).host; } catch { socket.close(1008, 'Invalid origin'); return; }
      if (originHost !== request.headers.host) { socket.close(1008, 'Use the same server origin'); return; }
    }
    const client = { id: randomUUID().slice(0, 12), socket, room: null, alive: true, windowStart: Date.now(), count: 0 };
    clients.set(client.id, client);
    send(socket, { type: 'hello', id: client.id, ...info() });
    socket.on('pong', () => { client.alive = true; });
    socket.on('error', () => {});
    socket.on('message', async (buffer, isBinary) => {
      const now = Date.now();
      if (now - client.windowStart > 1000) { client.windowStart = now; client.count = 0; }
      if (++client.count > 120) { socket.close(1008, 'Too many messages'); return; }
      if (isBinary) return;
      let data;
      try { data = JSON.parse(buffer.toString()); } catch { send(socket, { type: 'error', message: '잘못된 메시지입니다.' }); return; }
      if (!data || typeof data !== 'object') return;
      try {
        if (data.type === 'ping') { send(socket, { type: 'pong', sent: data.sent }); return; }
        if (data.type === 'list') { send(socket, { type: 'rooms', rooms: roomList() }); return; }
        if (data.type === 'leave') { leave(client); send(socket, { type: 'left' }); return; }
        if (data.type === 'input') { rooms.get(client.room)?.setInput(client.id, data); return; }
        if (data.type === 'loadout') { rooms.get(client.room)?.selectLoadout(client.id, data); return; }
        if (data.type === 'equipment') { rooms.get(client.room)?.interactEquipment(client.id, data); return; }
        if (data.type === 'restart') { rooms.get(client.room)?.restart(client.id); return; }
        if (data.type === 'create' || data.type === 'join') {
          if (client.room) throw new Error('먼저 현재 방에서 나가 주세요.');
          if (client.roomAction) throw new Error('이전 방 요청을 처리 중입니다.');
          client.roomAction = true;
          try {
            const room = data.type === 'create' ? await directory.create(data) : await directory.authorize(data.code, data.password, client);
            if (socket.readyState !== WebSocket.OPEN) { directory.discardEmpty(room); return; }
            enter(client, room, data.name, data);
          } finally { client.roomAction = false; }
        }
      } catch (error) { send(socket, { type: 'error', message: error.message, ...(error.code ? { code: error.code } : {}) }); }
    });
    socket.on('close', () => { leave(client); clients.delete(client.id); });
  });
  let previousTick = performance.now();
  const tick = () => {
    const now = performance.now(), dt = Math.min((now - previousTick) / 1000, 1 / 30);
    previousTick = now;
    for (const room of rooms.values()) room.tick(dt);
  };
  const broadcast = () => {
    for (const room of rooms.values()) {
      const snapshot = room.snapshot();
      for (const client of clients.values()) if (client.room === room.code) send(client.socket, snapshot);
    }
  };
  const timers = loop ? [setInterval(tick, 1000 / RULES.tickRate), setInterval(broadcast, 1000 / RULES.snapshotRate)] : [];
  timers.push(setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) { client.socket.terminate(); continue; }
      client.alive = false; client.socket.ping();
      if (!client.room) send(client.socket, { type: 'rooms', rooms: roomList() });
    }
  }, 15_000));
  return {
    server, wss, rooms, clients, directory, tick, broadcast,
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
      actualPort = server.address().port;
      return info();
    },
    async close() {
      timers.forEach(clearInterval);
      for (const client of clients.values()) client.socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createGameServer();
  try {
    const info = await app.listen();
    console.log(`\n  LINKSHOT · LAN COMBAT\n\n  이 컴퓨터  http://localhost:${info.port}\n${info.urls.map((url) => `  LAN 접속   ${url}`).join('\n') || '  LAN 주소   활성화된 사설 IPv4 주소가 없습니다.'}\n\n  같은 Wi-Fi/유선망에서 위 LAN 주소로 접속하세요.\n  Ctrl+C로 서버를 종료합니다.\n`);
  } catch (error) { console.error(`서버를 시작할 수 없습니다: ${error.message}`); process.exit(1); }
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
}
