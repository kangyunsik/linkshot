import { RULES, WORLD } from './world.js';
import { getWeapon } from './catalog.js';
import { collisionData as dataFor, nearbyColliders as nearby, STEERING_PADDING as PADDING, terrainFloor, bodyClear } from './collision-grid.js';
import { horizontalOverlap, topHeight } from './terrain.js';

const grids = new WeakMap(), GRID = .5;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const openShaft = (r) => ({ minX: r.x - r.w / 2 + .12, maxX: r.x + r.w / 2 - .12, minZ: r.z - r.d / 2 + .12, maxZ: r.z + r.d / 2 - .12 });

// AI planning uses the player's full footprint, not a head-height sight ray.
function segmentHit(a, b, box) {
  let near = 0, far = 1;
  for (const [axis, lo, hi] of [['x', 'minX', 'maxX'], ['z', 'minZ', 'maxZ']]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) { if (a[axis] <= box[lo] || a[axis] >= box[hi]) return null; }
    else {
      let first = (box[lo] - a[axis]) / delta, last = (box[hi] - a[axis]) / delta;
      if (first > last) [first, last] = [last, first]; near = Math.max(near, first); far = Math.min(far, last);
      if (near >= far - 1e-8) return null;
    }
  }
  return near < 1 - 1e-6 ? near : null;
}
function supported(point, data, stepHeight = RULES.stepHeight) {
  if ((point.y || 0) <= 2.2) return true; // Ordinary low-cover drops are safe; roofs need a route.
  const drop = stepHeight ? .55 : .05;
  return nearby(data, point).some((box) => point.x > box.minX + .05 && point.x < box.maxX - .05 && point.z > box.minZ + .05 && point.z < box.maxZ - .05 && box.maxY <= point.y + stepHeight + 1e-5 && box.maxY >= point.y - drop);
}
export function canTraverse(from, to, world, height = RULES.playerHeight, checkSupport = true, stepHeight = RULES.stepHeight) {
  const data = dataFor(world), y = from.y || 0;
  if (Math.abs(to.x) > world.width / 2 - PADDING || Math.abs(to.z) > world.depth / 2 - PADDING) return false;
  if (world.terrain) {
    let escapeMargins = null;
    for (const box of nearby(data, from)) if (!box.walkable && horizontalOverlap(from, box) && !horizontalOverlap(from, box.physical)) { escapeMargins ||= new Set(); escapeMargins.add(box); }
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .25));
    for (let i = 0; i <= steps; i++) {
      const point = { x: from.x + (to.x - from.x) * i / steps, z: from.z + (to.z - from.z) * i / steps, y: y + ((to.y ?? y) - y) * i / steps };
      const floor = terrainFloor(point, data);
      if (floor === null && checkSupport && point.y > 2.2) return false;
      if (floor !== null) point.y = floor;
      if (!bodyClear(point, data, height, escapeMargins)) return false;
    }
    return true;
  }
  if (checkSupport && Math.abs(y) < .08 && world.underground?.holes.some(hole => segmentHit(from, to, openShaft(hole)) !== null)) return false;
  for (const box of nearby(data, from, to)) {
    if (box.maxY <= y + stepHeight + 1e-5 || box.minY >= y + height - 1e-5) continue;
    // A valid spawn/slide can begin inside the extra steering margin. Let it
    // leave that margin, without ever allowing a sweep through the real body box.
    if (from.x > box.minX && from.x < box.maxX && from.z > box.minZ && from.z < box.maxZ && segmentHit(from, to, box.physical) === null) continue;
    if (segmentHit(from, to, box) !== null) return false;
  }
  if (checkSupport && y > 2.2) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .45));
    for (let i = 1; i <= steps; i++) if (!supported({ x: from.x + (to.x - from.x) * i / steps, z: from.z + (to.z - from.z) * i / steps, y }, data, stepHeight)) return false;
  }
  return true;
}

function gridFor(world) {
  const data = dataFor(world); if (grids.has(data)) return grids.get(data);
  const width = Math.floor((world.width - 2) / GRID) + 1, height = Math.floor((world.depth - 2) / GRID) + 1, minX = -world.width / 2 + 1, minZ = -world.depth / 2 + 1, cellCount = width * height, layers = world.navLayers || [0], size = cellCount * layers.length;
  const cells = new Uint8Array(size), floors = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const cell = i % cellCount, level = layers[Math.floor(i / cellCount)], point = { x: minX + cell % width * GRID, z: minZ + Math.floor(cell / width) * GRID, y: 0 };
    if (world.terrain) {
      let floor = level === 0 ? 0 : null;
      if (level !== 0) for (const box of nearby(data, point)) {
        if (!box.walkable || Math.abs(box.maxY - level) > .01 || !horizontalOverlap(point, box.physical)) continue;
        floor = Math.max(floor ?? -Infinity, topHeight(box.raw, point));
      }
      if (floor === null) continue;
      point.y = floor; floors[i] = floor; cells[i] = bodyClear(point, data, RULES.crouchHeight) ? 1 : 0; continue;
    }
    const blocked = world.underground?.holes.some(hole => horizontalOverlap(point, openShaft(hole))) ||
      nearby(data, point).some((box) => box.maxY > RULES.stepHeight && box.minY < RULES.crouchHeight && point.x > box.minX && point.x < box.maxX && point.z > box.minZ && point.z < box.maxZ);
    cells[i] = blocked ? 0 : 1;
  }
  const grid = { width, height, minX, minZ, cells, floors, layers, cellCount, checked: new Uint32Array(size), links: new Uint32Array(size), visited: new Uint32Array(size), parents: new Int32Array(size), queue: new Int32Array(size), costs: new Uint32Array(size), estimates: new Uint32Array(size), heapPositions: new Int32Array(size), serial: 0 };
  grids.set(data, grid); return grid;
}

export function findPath(from, to, world = WORLD, variant = 0) {
  // No grid/search is needed for a legal straight route on the same floor.
  // Layered terrain still goes through the navigation graph and ramp links.
  if (!world.terrain && Math.abs((from.y || 0) - (to.y || 0)) < .2 && canTraverse(from, to, world, RULES.crouchHeight)) {
    // Preserve bounded waypoint spacing for callers that consume one point at
    // a time, without constructing/searching the grid for a clear segment.
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / GRID));
    return Array.from({ length: steps }, (_, i) => ({ x: from.x + (to.x - from.x) * (i + 1) / steps, z: from.z + (to.z - from.z) * (i + 1) / steps }));
  }
  const grid = gridFor(world), { width, height, minX, minZ, cells, floors, layers, cellCount, checked, links, visited, parents, queue, costs, estimates, heapPositions } = grid;
  const point = (index, overrideY) => { const cell = index % cellCount; return { x: minX + cell % width * GRID, z: minZ + Math.floor(cell / width) * GRID, y: overrideY ?? floors[index] }; };
  const cell = (p) => ({ x: clamp(Math.round((p.x - minX) / GRID), 0, width - 1), z: clamp(Math.round((p.z - minZ) / GRID), 0, height - 1) });
  const nodeAt = (x, z, y) => { let best = -1, error = Infinity; for (let layer = 0; layer < layers.length; layer++) { const index = layer * cellCount + z * width + x; if (cells[index] && Math.abs(floors[index] - y) < error) { best = index; error = Math.abs(floors[index] - y); } } return best; };
  const a = cell(from), b = cell(to), end = nodeAt(b.x, b.z, to.y || 0); let start = nodeAt(a.x, a.z, from.y || 0);
  if (start < 0 || !canTraverse(from, point(start, world.terrain ? undefined : from.y || 0), world, RULES.crouchHeight, false)) {
    const choices = [];
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
      const x = a.x + dx, z = a.z + dz;
      if (x >= 0 && x < width && z >= 0 && z < height) { const index = nodeAt(x, z, from.y || 0); if (index >= 0) choices.push(index); }
    }
    choices.sort((a, b) => (point(a).x - from.x) ** 2 + (point(a).z - from.z) ** 2 - (point(b).x - from.x) ** 2 - (point(b).z - from.z) ** 2);
    const reachable = choices.find((index) => canTraverse(from, point(index, world.terrain ? undefined : from.y || 0), world, RULES.crouchHeight, false));
    if (reachable === undefined) return []; start = reachable;
  }
  if (++grid.serial === 0xffffffff) { visited.fill(0); grid.serial = 1; }
  const serial = grid.serial;
  const heuristic = (index) => { const flat = index % cellCount; return Math.abs(b.x - flat % width) + Math.abs(b.z - Math.floor(flat / width)); };
  // A* with a reusable indexed heap. The Manhattan lower bound is admissible
  // across layers too: every graph edge moves exactly one horizontal cell.
  // Prefer progress on equal costs, varying only ties for each bot/route.
  const tie = (index) => {
    if (!variant) return index;
    let value = Math.imul(index ^ variant, 0x7feb352d);
    value = Math.imul(value ^ value >>> 15, 0x846ca68b);
    return (value ^ value >>> 16) >>> 0;
  };
  const compare = (a, b) => estimates[a] - estimates[b] || costs[b] - costs[a] || tie(a) - tie(b);
  queue[0] = start; visited[start] = serial; parents[start] = -1; costs[start] = 0; estimates[start] = heuristic(start); heapPositions[start] = 0;
  let count = 1, closest = start, best = Infinity;
  while (count) {
    const current = queue[0], last = queue[--count];
    if (count) {
      let position = 0; queue[0] = last; heapPositions[last] = 0;
      while (position * 2 + 1 < count) {
        let child = position * 2 + 1;
        if (child + 1 < count && compare(queue[child + 1], queue[child]) < 0) child++;
        if (compare(queue[position], queue[child]) <= 0) break;
        const swap = queue[position]; queue[position] = queue[child]; queue[child] = swap;
        heapPositions[queue[position]] = position; heapPositions[swap] = child; position = child;
      }
    }
    heapPositions[current] = -1;
    const flat = current % cellCount, x = flat % width, z = Math.floor(flat / width), distance = Math.abs(b.x - x) + Math.abs(b.z - z) + Math.abs(floors[current] - (to.y || 0)) * 6;
    if (distance < best) { best = distance; closest = current; } if (current === end) break;
    // Equal-length routes need not use the same side of every obstacle. Keep
    // variant=0 stable for tools/tests, and vary only tie order, not walkability.
    const rotation = variant ? ((Math.imul(current + 1, variant | 1) >>> 16) ^ variant) & 3 : 0;
    for (let order = 0; order < 4; order++) {
      const side = (rotation + order * (variant & 4 ? 3 : 1)) & 3;
      const [dx, dz] = DIRECTIONS[side], nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      for (let layer = 0; layer < layers.length; layer++) {
        const next = layer * cellCount + nz * width + nx, bit = 1 << (side * layers.length + layer);
        const seen = visited[next] === serial, cost = costs[current] + 1;
        if (!cells[next] || seen && (heapPositions[next] < 0 || cost >= costs[next]) || Math.abs(floors[current] - floors[next]) > RULES.stepHeight + .001) continue;
        if (!(checked[current] & bit)) { checked[current] |= bit; if (canTraverse(point(current), point(next), world, RULES.crouchHeight, false)) links[current] |= bit; }
        if (!(links[current] & bit)) continue;
        costs[next] = cost; estimates[next] = cost + heuristic(next); parents[next] = current;
        let position = seen ? heapPositions[next] : count++;
        visited[next] = serial; queue[position] = next; heapPositions[next] = position;
        while (position > 0) {
          const parent = (position - 1) >>> 1;
          if (compare(queue[parent], next) <= 0) break;
          queue[position] = queue[parent]; heapPositions[queue[position]] = position; position = parent;
        }
        queue[position] = next; heapPositions[next] = position;
      }
    }
  }
  const path = [];
  for (let index = closest; index !== start && index !== -1; index = parents[index]) { const p = point(index); path.push(world.terrain ? p : { x: p.x, z: p.z }); }
  const first = point(start); if (Math.hypot(first.x - from.x, first.z - from.z) > .15) path.push(world.terrain ? first : { x: first.x, z: first.z });
  return path.reverse();
}

export function followBotPath(bot, world) {
  while (bot.botPath.length && (bot.grounded !== false || bot.botPath.length > 1) && Math.hypot(bot.botPath[0].x - bot.x, bot.botPath[0].z - bot.z) < .2 && (Math.abs((bot.botPath[0].y ?? bot.y) - bot.y) - 1e-6 < .18 || bot.stairRouteKey && bot.y >= bot.botPath[0].y && bot.y - bot.botPath[0].y <= RULES.stepHeight)) bot.botPath.shift();
  if (!bot.stairRouteKey) {
    // Cut across open grid cells, never across a wall corner or a stair flight.
    let furthest = 0;
    for (let i = 1; i < Math.min(9, bot.botPath.length); i++) {
      const p = bot.botPath[i]; if (p.y !== undefined && Math.abs(p.y - bot.y) > .2 || Math.hypot(p.x - bot.x, p.z - bot.z) > 3.5) break;
      if (canTraverse(bot, p, world, RULES.crouchHeight)) furthest = i;
    }
    if (furthest) bot.botPath.splice(0, furthest);
  }
  return bot.botPath[0] || bot;
}

export function nearBotCover(bot, world) {
  return nearby(dataFor(world), bot, bot, 1.5).some((box) => box.maxY > bot.y + .5 && box.maxY < bot.y + 1.4 && bot.x > box.minX - 1.2 && bot.x < box.maxX + 1.2 && bot.z > box.minZ - 1.2 && bot.z < box.maxZ + 1.2);
}

function canHop(bot, to, world) {
  const data = dataFor(world), y = bot.y || 0;
  if (!bot.grounded || bot.jumpHeld || bot.stairRouteKey) return false;
  const blockers = nearby(data, bot, to).filter((box) => box.maxY > y + RULES.stepHeight && box.minY < y + RULES.playerHeight && segmentHit(bot, to, box) !== null);
  if (!blockers.length || blockers.some((box) => box.minY > y + .05 || box.maxY > y + 1.25 || box.kind.includes('step'))) return false;
  if (nearby(data, bot).some((box) => bot.x > box.minX && bot.x < box.maxX && bot.z > box.minZ && bot.z < box.maxZ && box.minY > y + .1 && box.minY < y + RULES.playerHeight + 2.2)) return false;
  const dx = to.x - bot.x, dz = to.z - bot.z, length = Math.hypot(dx, dz), landing = { x: bot.x + dx / length * 2.6, z: bot.z + dz / length * 2.6, y };
  return canTraverse({ ...bot, y: y + 1.3 }, { ...landing, y: y + 1.3 }, world, RULES.playerHeight, false) && canTraverse(landing, landing, world, RULES.playerHeight) && supported(landing, data);
}

export function steerBot(bot, input, world, now) {
  const brain = bot.botBrain, amount = Math.hypot(input.forward, input.strafe); if (!brain || amount < .05) return input;
  const sine = Math.sin(input.yaw), cosine = Math.cos(input.yaw), dx = (cosine * input.strafe - sine * input.forward) / amount, dz = (-sine * input.strafe - cosine * input.forward) / amount;
  let reach = Math.max(.45, Math.min(.9, RULES.runSpeed * getWeapon(bot.weaponId).walkMultiplier * amount * .18));
  if (bot.stairRouteKey && bot.botPath[0]) reach = Math.min(reach, .25, Math.max(.08, Math.hypot(bot.botPath[0].x - bot.x, bot.botPath[0].z - bot.z)));
  const ahead = { x: bot.x + dx * reach, z: bot.z + dz * reach, y: bot.y };
  brain.progress ||= { x: bot.x, z: bot.z, at: now, stuck: 0 };
  if (now - brain.progress.at >= 400 && bot.grounded) {
    const moved = Math.hypot(bot.x - brain.progress.x, bot.z - brain.progress.z); brain.progress.stuck = moved < .08 ? brain.progress.stuck + 1 : 0;
    Object.assign(brain.progress, { x: bot.x, z: bot.z, at: now });
    if (brain.progress.stuck >= 2) { brain.recoverUntil = now + 600; brain.progress.stuck = 0; if (!bot.stairRouteKey) { bot.nextPathAt = 0; bot.botPath = []; } }
  }
  const checkSupport = bot.stairRouteKey !== 'basement-route';
  if (canTraverse(bot, ahead, world, input.crouch ? RULES.crouchHeight : RULES.playerHeight, checkSupport) && !(brain.recoverUntil > now)) return input;
  if (canTraverse(bot, ahead, world, RULES.crouchHeight, checkSupport)) { input.crouch = true; return input; }
  if (now >= (brain.nextJumpAt || 0) && canHop(bot, ahead, world)) { input.jump = true; input.crouch = false; brain.nextJumpAt = now + 1800; return input; }
  const side = brain.strafeSide || 1, angles = brain.recoverUntil > now ? [side * Math.PI / 2, -side * Math.PI / 2, Math.PI] : [side * .5, -side * .5, side, -side, side * Math.PI / 2, -side * Math.PI / 2, Math.PI];
  for (const angle of angles) {
    const x = dx * Math.cos(angle) - dz * Math.sin(angle), z = dx * Math.sin(angle) + dz * Math.cos(angle), next = { x: bot.x + x * reach, z: bot.z + z * reach, y: bot.y };
    if (!canTraverse(bot, next, world, input.crouch ? RULES.crouchHeight : RULES.playerHeight, checkSupport)) {
      // Recovery and side steps need the same low-ceiling stance as forward
      // movement, including when the body is already forced to stay crouched.
      if (!canTraverse(bot, next, world, RULES.crouchHeight, checkSupport)) continue;
      input.crouch = true;
    }
    input.forward = (-x * sine - z * cosine) * amount; input.strafe = (x * cosine - z * sine) * amount; return input;
  }
  input.forward = input.strafe = 0; bot.nextPathAt = 0; return input;
}
