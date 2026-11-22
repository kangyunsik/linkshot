import { RULES, bounds } from './world.js';
import { topHeight, horizontalOverlap } from './terrain.js';

const cache = new WeakMap(), EMPTY = [];
export const STEERING_PADDING = RULES.playerRadius + .05;

// Shared broad phase for short AI body sweeps and visual weapon-wall probes.
// It never changes authoritative movement contacts or bullet collision bounds.
export function collisionData(world) {
  let data = cache.get(world);
  if (data && data.source === world.obstacles && data.count === world.obstacles.length) return data;
  const boxes = world.obstacles.map((box, index) => ({ ...bounds(box, STEERING_PADDING), walkable: box.walkable === true, physical: bounds(box, RULES.playerRadius - 1e-5), raw: { ...bounds(box), id: box.id || `obstacle-${index}`, kind: box.kind }, kind: box.kind || '' })), buckets = new Map();
  for (const box of boxes) for (let x = Math.floor(box.minX / 4); x <= Math.floor(box.maxX / 4); x++) for (let z = Math.floor(box.minZ / 4); z <= Math.floor(box.maxZ / 4); z++) {
    const key = `${x},${z}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(box);
  }
  data = { source: world.obstacles, count: world.obstacles.length, groundLevel: world.underground?.floor ?? 0, boxes, buckets, queries: new Map() }; cache.set(world, data); return data;
}

export function nearbyColliders(data, a, b = a, radius = 0) {
  const x1 = Math.floor((Math.min(a.x, b.x) - radius) / 4), x2 = Math.floor((Math.max(a.x, b.x) + radius) / 4);
  const z1 = Math.floor((Math.min(a.z, b.z) - radius) / 4), z2 = Math.floor((Math.max(a.z, b.z) + radius) / 4);
  if (x1 === x2 && z1 === z2) return data.buckets.get(`${x1},${z1}`) || EMPTY;
  const key = `${x1},${z1}/${x2},${z2}`; if (data.queries.has(key)) return data.queries.get(key);
  const found = new Set();
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) for (const box of data.buckets.get(`${x},${z}`) || EMPTY) found.add(box);
  const result = [...found]; data.queries.set(key, result); if (data.queries.size > 256) data.queries.delete(data.queries.keys().next().value); return result;
}

export function terrainFloor(point, data, expectedY = point.y || 0, rise = RULES.stepHeight, drop = .55) {
  let floor = expectedY >= -rise && expectedY <= drop ? 0 : null;
  for (const box of nearbyColliders(data, point)) {
    if (!box.walkable || !horizontalOverlap(point, box.physical)) continue;
    const top = topHeight(box.raw, point);
    if (top <= expectedY + rise + 1e-5 && top >= expectedY - drop - 1e-5) floor = Math.max(floor ?? -Infinity, top);
  }
  return floor;
}
export function bodyClear(point, data, height, escapeMargins = null) {
  return !nearbyColliders(data, point).some((box) => horizontalOverlap(point, box.walkable || escapeMargins?.has(box) ? box.physical : box) && (point.y || 0) < topHeight(box, point) - 1e-5 && (point.y || 0) + height > box.minY + 1e-5);
}
