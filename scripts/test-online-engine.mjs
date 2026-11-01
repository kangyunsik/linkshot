// Maven's real PostgreSQL/Spring integration test launches this isolated engine.
// All secrets/tickets arrive through environment/stdin and are never printed.
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { createOnlineEngine, SpringEngineClient } from '../server/online-engine.js';

const client = new SpringEngineClient(), app = createOnlineEngine({ client, port: 0, loop: false }); const sockets = [];
function frame(socket, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error('Engine handshake timeout')); }, 5000);
    function receive(raw) { const data = JSON.parse(raw); if (data.type !== type) return; clearTimeout(timer); socket.off('message', receive); resolve(data); } socket.on('message', receive);
  });
}
try {
  const { port } = await app.listen(); const match = await app.load(process.env.SMOKE_MATCH_ID);
  const input = createInterface({ input: process.stdin }); const payload = new Promise((resolve) => input.once('line', (line) => resolve(JSON.parse(line))));
  console.log(JSON.stringify({ ready: true })); const tickets = await payload; input.close();
  for (const entry of tickets) { const socket = new WebSocket(`ws://127.0.0.1:${port}/play`); sockets.push(socket); await frame(socket, 'hello'); const joined = frame(socket, 'joined'); socket.send(JSON.stringify({ type: 'authenticate', matchId: match.id, ticket: entry.ticket })); await joined; }
  const players = [...match.room.players.values()].filter((player) => !player.isBot), [a, b] = players;
  match.room.world = { ...match.room.world, width: 100, depth: 100, obstacles: [] };
  Object.assign(a, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, protectedUntil: 0 }); Object.assign(b, { x: 0, y: 0, z: -1, hp: 1, protectedUntil: 0 });
  match.room.setInput(a.id, { fire: true, yaw: 0, pitch: 0, spawnCount: a.spawnCount, equipmentSeq: a.equipmentSeq }); app.tick(1 / 60);
  for (let attempt = 0; attempt < 100 && match.settlement !== 'saved'; attempt++) { await new Promise((resolve) => setTimeout(resolve, 20)); app.tick(1 / 60); }
  if (match.settlement !== 'saved' || match.room.phase !== 'ended') throw new Error('Authoritative settlement did not complete');
  console.log(JSON.stringify({ complete: true, winner: a.id }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { sockets.forEach((socket) => socket.terminate()); await app.close(); }
