import { performance } from 'node:perf_hooks';
import { Room, BOT_DIFFICULTIES } from '../shared/simulation.js';
import { MAPS, RULES } from '../shared/world.js';

// Seeded authoritative simulation + 20Hz snapshots/JSON, not network capacity.
const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const list = (key, fallback) => (args.get(key) || fallback).split(',');
const roomCounts = list('rooms', '4,12,24').map(Number), maps = list('maps', 'foundry');
const difficulties = list('difficulties', 'advanced,expert,extreme');
const ticks = Number(args.get('ticks') || 600), warmup = Number(args.get('warmup') || 180);
if (roomCounts.some((n) => !Number.isInteger(n) || n < 1 || n > 100) || maps.some((id) => !MAPS.some((map) => map.id === id)) || difficulties.some((id) => !BOT_DIFFICULTIES.some((level) => level.id === id)) || !Number.isInteger(ticks) || ticks < 60 || !Number.isInteger(warmup) || warmup < 0) throw new Error('Invalid AI benchmark options.');
const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const rounded = (value) => +value.toFixed(3);
const results = [];
for (const mapId of maps) for (const difficulty of difficulties) for (const count of roomCounts) {
  let now = 1000, bytes = 0;
  const rooms = Array.from({ length: count }, (_, i) => {
    const room = new Room(`CPU${i}`, { bots: 0, botDifficulty: difficulty, gameType: 'teams', mapId, fragLimit: 200, roundSeconds: 3600, clock: () => now, random: seeded(17 + i) });
    room.addPlayer(`human-${i}`, 'HUMAN');
    for (let j = 0; j < 5; j++) room.addPlayer(`bot-${i}-${j}`, `BOT ${j}`, true);
    return room;
  });
  const samples = [];
  for (let i = -warmup; i < ticks; i++) {
    now += 1000 / RULES.tickRate;
    const start = performance.now();
    for (const room of rooms) {
      room.tick(1 / RULES.tickRate);
      if (i % (RULES.tickRate / RULES.snapshotRate) === 0) {
        const serialized = JSON.stringify(room.snapshot());
        if (i >= 0) bytes += Buffer.byteLength(serialized);
      }
    }
    if (i >= 0) samples.push(performance.now() - start);
  }
  const mean = samples.reduce((sum, time) => sum + time, 0) / ticks;
  samples.sort((a, b) => a - b);
  results.push({ mapId, difficulty, rooms: count, humans: count, bots: count * 5, ticks, warmupTicks: warmup, meanMs: rounded(mean), p50Ms: rounded(samples[Math.floor(ticks * .5)]), p95Ms: rounded(samples[Math.floor(ticks * .95)]), p99Ms: rounded(samples[Math.floor(ticks * .99)]), maxMs: rounded(samples.at(-1)), overBudgetPercent: rounded(samples.filter((ms) => ms > 1000 / RULES.tickRate).length / ticks * 100), snapshotBytes: bytes });
}
console.log(JSON.stringify({ node: process.version, tickBudgetMs: rounded(1000 / RULES.tickRate), includes: 'One idle human + five fighting bots per room, movement/collision/combat, 20Hz snapshots + one JSON serialization per room.', excludes: 'TCP/TLS/tunnels, incoming packets, per-recipient sending, Spring/DB, rendering, cold map/grid construction and initial wave/spawn spikes. Warm maps/grids are shared between scenarios. Not a concurrent-player guarantee.', results }, null, 2));
