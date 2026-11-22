import { RULES } from './world.js';
import { canStand, supportHeight } from './movement.js';
import { canTraverse, findPath } from './bot-navigation.js';
import { routeThroughBuildings } from './building-navigation.js';

const between = (p, r, margin = 0) => Math.abs(p.x - r.x) < r.w / 2 + margin && Math.abs(p.z - r.z) < r.d / 2 + margin;
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const walk = (a, b, world) => canTraverse(a, b, world, RULES.playerHeight);
const flat = (p, y = 0) => ({ x: p.x, y, z: p.z });

function streetPath(from, to, world, variant) {
  if (from.y > .2) {
    const route = routeThroughBuildings(from, to, world, variant);
    if (route?.points.length) return route.points;
  }
  if (walk(from, to, world)) return [to];
  const route = findPath(from, to, world, variant).map(point => flat(point));
  const last = route.at(-1) || from;
  return gap(last, to) < 1.1 && walk(last, to, world) ? [...route, to] : null;
}

const cachedGuides = new WeakMap();
function lowerPath(from, to, world) {
  if (walk(from, to, world)) return [to];
  if (!cachedGuides.has(world)) {
    const { floor, path, rooms, branches } = world.underground;
    const guides = [...path, ...branches.flatMap(branch => branch.path),
      ...rooms.flatMap(r => [-.33, 0, .33].flatMap(x => [-.33, 0, .33].map(z => ({ x: r.x + x * r.w, y: floor, z: r.z + z * r.d }))))];
    cachedGuides.set(world, guides.filter(p => supportHeight(p, world) !== null && canStand(p, world)));
  }
  const points = [...cachedGuides.get(world), to, from], end = points.length - 2, begin = points.length - 1;
  const costs = points.map(() => Infinity), prev = points.map(() => -1), visited = new Set();
  costs[begin] = 0;
  for (;;) {
    let at = -1, best = Infinity;
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && costs[i] < best) { at = i; best = costs[i]; }
    if (at < 0) return null;
    if (at === end) {
      const route = []; for (let i = end; i !== begin; i = prev[i]) route.push(points[i]); return route.reverse();
    }
    visited.add(at);
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      const next = costs[at] + gap(points[at], points[i]);
      if (next < costs[i] && walk(points[at], points[i], world)) { costs[i] = next; prev[i] = at; }
    }
  }
}

export function routeThroughBasements(from, to, world, variant) {
  const u = world.underground; if (!u) return null;
  const below = p => p.y < -.12;
  const side = p => Math.sign(p[u.divider.axis] - u.divider.at);
  const crossing = u.divider && side(from) !== side(to);
  if (!below(from) && !below(to) && !crossing) return null; // Dock surface routes are still valid.
  const options = (p) => {
    if (below(p)) {
      const staircase = p.y > u.floor + .19 && u.entrances.find(entry => between(p, entry.hole, .36));
      return [{ inner: staircase ? staircase.bottom : flat(p, u.floor), staircase }];
    }
    return u.entrances.filter(entry => !u.divider || side(entry.top) === side(p))
      .sort((a, b) => gap(p, a.top) - gap(p, b.top)).map(entry => ({ inner: entry.bottom, entry }));
  };
  for (const a of options(from)) {
    const approach = a.entry ? streetPath(from, a.entry.top, world, variant) : a.staircase ? [a.inner] : [];
    if (!approach) continue;
    for (const b of options(to)) {
      const lower = lowerPath(a.inner, b.inner, world);
      if (!lower) continue;
      const exit = b.entry ? (to.y > .2 ? [] : streetPath(b.entry.top, flat(to), world, variant)) : b.staircase ? [to] : [];
      if (exit) return { points: [...approach, ...(a.entry ? [a.inner] : []), ...lower, ...(b.entry ? [b.entry.top] : []), ...exit] };
    }
  }
  return { points: [] };
}
