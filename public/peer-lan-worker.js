import { PeerLanRoom } from '/shared/peer-lan-room.js';
import { advanceTime } from '/shared/movement.js';
import { RULES } from '/shared/world.js';

const session = new PeerLanRoom((ids, data) => self.postMessage({ ids, data }));
let previousTick = performance.now();
setInterval(() => {
  const now = performance.now(); advanceTime((now - previousTick) / 1000, dt => session.tick(dt)); previousTick = now;
}, 1000 / RULES.tickRate);
setInterval(() => session.broadcast(), 1000 / RULES.snapshotRate);
self.addEventListener('message', ({ data }) => {
  if (data.type === 'drop') session.dropGuest(data.id);
  else session.handle(data.id, data.message);
});
session.hello();
