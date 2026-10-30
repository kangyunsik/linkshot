import { Room } from '/shared/simulation.js';
import { RULES } from '/shared/world.js';

const playerId = 'local-operator';
let room = null, tickTimer, snapshotTimer, previousTick;
const send = (data) => self.postMessage(data);
function stop() { clearInterval(tickTimer); clearInterval(snapshotTimer); room = null; }
function start(data) {
  stop();
  room = new Room('SOLO7', { mode: 'practice', mapId: data.mapId, bots: Math.max(1, Number(data.bots) || 2) });
  room.addPlayer(playerId, data.name, false, data);
  send({ ...room.snapshot(), type: 'joined', id: playerId, events: [] });
  previousTick = performance.now();
  tickTimer = setInterval(() => { const now = performance.now(); room?.tick(Math.min((now - previousTick) / 1000, 1 / 30)); previousTick = now; }, 1000 / RULES.tickRate);
  snapshotTimer = setInterval(() => { if (room) send(room.snapshot()); }, 1000 / RULES.snapshotRate);
}
self.addEventListener('message', ({ data }) => {
  try {
    if (data.type === 'create') start(data);
    if (data.type === 'input') room?.setInput(playerId, data);
    if (data.type === 'restart') room?.restart(playerId);
    if (data.type === 'leave') { stop(); send({ type: 'left' }); }
    if (data.type === 'ping') send({ type: 'pong', sent: data.sent });
    if (data.type === 'list') send({ type: 'rooms', rooms: [] });
    if (data.type === 'join') send({ type: 'error', message: '이 배포는 1인 플레이 전용입니다. LAN 대전은 로컬에서 npm start로 실행하세요.' });
  } catch (error) { send({ type: 'error', message: error.message }); }
});
send({ type: 'hello', id: playerId, name: 'LINKSHOT SOLO', urls: [], rooms: [], totalPlayers: 0 });
