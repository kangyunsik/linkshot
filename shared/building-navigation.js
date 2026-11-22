import { RULES } from './world.js';
import { canStand, supportHeight } from './movement.js';
import { canTraverse, findPath } from './bot-navigation.js';

const cache = new WeakMap();
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const inside = (p, b) => Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.z - b.z) < b.d / 2;
const walk = (a, b, world) => canTraverse(a, b, world, RULES.playerHeight);
const walkDeck = (a, b, world) => canTraverse({ x: a.x, y: b.y, z: a.z }, b, world, RULES.playerHeight, true, 0);
const costOf = (start, route) => route.reduce((cost, p, i) => cost + distance(i ? route[i - 1] : start, p), 0);

function groundPath(from, to, world, variant) {
  if (walk(from, to, world)) return [to];
  const path = findPath(from, to, world, variant).map(point => ({ ...point, y: 0 }));
  const end = path.at(-1) || from;
  return horizontal(end, to) < 1 && walk(end, to, world) ? [...path, to] : null;
}

function floorGraph(building, y, world) {
  if (!cache.has(world)) cache.set(world, new WeakMap());
  const byBuilding = cache.get(world);
  if (!byBuilding.has(building)) byBuilding.set(building, new Map());
  const floors = byBuilding.get(building);
  if (!floors.has(y)) {
    const points = building.floorGuides.map(point => ({ ...point, y })).filter(point => supportHeight(point, world) === y && canStand(point, world));
    floors.set(y, { points, links: points.map(() => new Map()) });
  }
  return floors.get(y);
}

// Only search nearby points on the current deck. A straight line that crosses
// a stairwell, rooftop equipment or a solid parapet isn't a floor connection.
export function buildingFloorPath(from, to, building, world) {
  if (walkDeck(from, to, world)) return [to];
  const { points: guides, links } = floorGraph(building, to.y, world);
  const start = guides.length, end = start + 1, points = [...guides, from, to];
  const estimates = points.map(() => Infinity), costs = [...estimates], parents = points.map(() => -1), visited = new Set();
  costs[start] = 0; estimates[start] = distance(from, to);
  for (;;) {
    let current = -1, best = Infinity;
    for (const [i, estimate] of estimates.entries()) if (estimate < best && !visited.has(i)) { current = i; best = estimate; }
    if (current < 0) return null;
    if (current === end) {
      const route = [];
      for (let i = end; i !== start; i = parents[i]) route.push(points[i]);
      return route.reverse();
    }
    visited.add(current);
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      const cost = costs[current] + distance(points[current], points[i]);
      if (cost >= costs[i]) continue;
      const known = links[current];
      if (known && i < start && !known.has(i)) known.set(i, walkDeck(points[current], points[i], world));
      if (!(known && i < start ? known.get(i) : walkDeck(points[current], points[i], world))) continue;
      costs[i] = cost; estimates[i] = cost + distance(points[i], to); parents[i] = current;
    }
  }
}

function continueFlight(point, route) {
  let closest = Infinity, after = 1;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / (dx * dx + dy * dy + dz * dz)));
    const deviation = Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t, point.z - a.z - dz * t);
    if (deviation < closest) { closest = deviation; after = i; }
  }
  return route.slice(after);
}

function climb(from, to, building, world) {
  const height = building.height / building.storeys;
  const first = Math.round(from.y / height), last = Math.min(building.storeys, Math.round(to.y / height));
  const goal = { ...to, y: last * height }, between = Math.abs(from.y - first * height) > .10;
  if (!between && first === last) return buildingFloorPath(from, goal, building, world);
  let best = null, bestCost = Infinity;
  for (const stair of building.stairs) {
    let at = from, level = first, route = [], failed = false;
    if (between) {
      const step = Math.floor(from.y / height), flight = stair.flights[step];
      if (!flight || !inside(from, stair.hole)) continue;
      const up = last > step;
      route = continueFlight(from, up ? flight : flight.slice().reverse());
      at = route.at(-1); level = up ? step + 1 : step;
    }
    while (level !== last) {
      const up = level < last, flight = up ? stair.flights[level] : stair.flights[level - 1]?.slice().reverse();
      if (!flight) { failed = true; break; }
      const approach = buildingFloorPath(at, flight[0], building, world);
      if (!approach) { failed = true; break; }
      route.push(...approach, ...flight.slice(1)); at = flight.at(-1); level += up ? 1 : -1;
    }
    if (failed) continue;
    const arrival = buildingFloorPath(at, goal, building, world);
    if (!arrival) continue;
    route.push(...arrival);
    const cost = costOf(from, route);
    if (cost < bestCost) { bestCost = cost; best = route; }
  }
  return best;
}

export function routeThroughBuildings(from, to, world, variant) {
  const structures = (world.buildings || []).filter(b => b.stairs?.length);
  const own = structures.find(b => from.y <= b.height + .14 && inside(from, b));
  const destination = structures.find(b => to.y <= b.height + .14 && inside(to, b));
  const deckAt = point => world.roofBridges?.find(bridge => Math.abs(bridge.height - point.y) < .14 && inside(point, bridge));
  const wrap = points => ({ points: points || [] });
  const onBridge = !own && deckAt(from);
  if (onBridge) {
    if (deckAt(to) === onBridge && walkDeck(from, to, world)) return wrap([to]);
    const ends = [...onBridge.route].sort((a, b) => horizontal(a, to) - horizontal(b, to));
    for (const end of ends) if (walkDeck(from, end, world)) {
      const rest = routeThroughBuildings(end, to, world, variant);
      if (rest?.points.length) return wrap([end, ...rest.points]);
    }
    return wrap(null);
  }
  const targetBridge = !destination && deckAt(to);
  if (targetBridge) {
    const ends = [...targetBridge.route].sort((a, b) => horizontal(a, from) - horizontal(b, from));
    for (const end of ends) if (walkDeck(end, to, world)) {
      const approach = routeThroughBuildings(from, end, world, variant);
      if (approach?.points.length) return wrap([...approach.points, to]);
    }
    return wrap(null);
  }
  const leaving = own && from.y > .20, entering = destination && to.y > .20;
  if (!leaving && !entering) return null;
  if (!leaving && from.y > .20) return null; // A legacy elevated route must return to the ground first.
  if (own === destination) return wrap(climb(from, to, own, world));

  // Don't force a trip down to street level between directly linked rooftops.
  if (leaving && entering) for (const bridge of world.roofBridges || []) {
    const reverse = bridge.to === own.id && bridge.from === destination.id;
    if (!reverse && (bridge.from !== own.id || bridge.to !== destination.id)) continue;
    const [a, b] = reverse ? bridge.route.slice().reverse() : bridge.route;
    const ascent = climb(from, a, own, world), arrival = climb(b, to, destination, world);
    if (ascent && arrival && walkDeck(a, b, world)) return wrap([...ascent, b, ...arrival]);
  }

  const exits = leaving ? own.doors.map(door => ({ ground: door.outside, inside: door.inside })) : [{ ground: from }];
  const legacy = to.y > .2 && world.walkways?.find(link => inside(to, link));
  const doors = entering ? destination.doors.map(door => ({ ground: door.outside, inside: door.inside })) : [{ ground: legacy?.entry || { ...to, y: 0 } }];
  const options = exits.flatMap(exit => doors.map(door => ({ exit, door,
    cost: horizontal(from, exit.ground) + horizontal(exit.ground, door.ground) + horizontal(door.ground, to),
  }))).sort((a, b) => a.cost - b.cost);
  const descents = new Map(), ascents = new Map();
  for (const { exit, door } of options) {
    if (!descents.has(exit)) descents.set(exit, leaving ? climb(from, exit.inside, own, world) : []);
    if (!ascents.has(door)) ascents.set(door, entering ? climb(door.inside, to, destination, world) : []);
    const descent = descents.get(exit), ascent = ascents.get(door);
    if (!descent || !ascent) continue;
    const street = groundPath(exit.ground, door.ground, world, variant);
    if (street) return wrap([...descent, ...(leaving ? [exit.ground] : []), ...street, ...(entering ? [door.inside] : []), ...ascent]);
  }
  return wrap(null);
}
