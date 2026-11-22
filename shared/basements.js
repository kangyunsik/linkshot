const DEPTH = -3.6, RUN = 6.6, APPROACH = .78, CAP = .24, STEPS = 12;
const rect = (x, z, w, d) => ({ x, z, w, d });
const limits = r => [r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2];
const inside = (x, z, r) => Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2;
const box = (id, footprint, y, h, kind) => ({ id, ...footprint, y, h, kind });

const PLANS = {
  drydock: {
    label: '화물 지하 통로', width: 2.85,
    stairs: [
      { id: 'warehouse-cellar', buildingId: 'warehouse', x: 5.5, z: -3.1, axis: 'x', dir: -1, width: 2.4 },
      { id: 'freight-cellar', buildingId: 'operations-tower-0', x: -15.8, z: -7.6, axis: 'z', dir: -1, width: 2.35 },
    ],
    bends: [[-7.2, -3.1], [-7.2, -14.98]],
    rooms: [rect(-4.8, -3.1, 6.3, 5.1), rect(-14.7, -14.98, 5.65, 4.7)],
    cover: [rect(-4.55, -1.54, 2.2, .75), rect(-14.75, -16.55, 1.9, .72)],
  },
  whiteout: {
    label: '연구 구역 연결 통로', width: 3.35,
    divider: { axis: 'x', at: 0, thickness: 3.9, height: 16 },
    stairs: [
      { id: 'west-lab-cellar', buildingId: 'lab-west', x: -19.65, z: -13.75, axis: 'x', dir: 1, width: 2.3 },
      { id: 'east-lab-cellar', buildingId: 'lab-east', x: 14.4, z: 16.6, axis: 'z', dir: -1, width: 2.55 },
    ],
    bends: [[-7.1, -13.75], [-7.1, -7.2], [4.4, -7.2], [4.4, 5.8], [14.4, 5.8]],
    branches: [{
      label: '정비 우회로', width: 2.35,
      bends: [[-7.1, -10.4], [-10.45, -10.4], [-10.45, 1.05], [-3.8, 1.05], [-3.8, 3.1], [4.4, 3.1]],
    }],
    rooms: [rect(-9.75, -13.75, 7.2, 4.65), rect(0, -7.2, 8, 5.6), rect(12.4, 7.1, 6.5, 5.6), rect(-6.9, 1.05, 3.95, 4.4)],
    cover: [rect(-9.5, -12.05, 1.6, .65), rect(0, -5.37, 2.6, .85), rect(11.3, 8.54, 1.45, .75), rect(-7.1, -.48, 1.65, .64)],
  },
};

function entryFor(spec) {
  const { x, z, axis, dir, width } = spec, alongX = axis === 'x';
  const point = (distance, y) => ({ x: x + (alongX ? dir * distance : 0), y, z: z + (alongX ? 0 : dir * distance) });
  const volume = (distance, length, span) => {
    const center = point(distance, 0);
    return rect(center.x, center.z, alongX ? length : span, alongX ? span : length);
  };
  const top = point(-APPROACH, 0), bottom = point(RUN + APPROACH, DEPTH);
  return { ...spec, top, bottom, hole: volume(RUN / 2, RUN, width), pocket: volume((RUN + 1) / 2, RUN + 2.5, width), point, volume };
}

function grid(rectangles) {
  const extents = rectangles.map(limits);
  const axis = (a, b) => [...new Set(extents.flatMap(edge => [edge[a], edge[b]]).map(n => +n.toFixed(5)))].sort((a, b) => a - b);
  return { xs: axis(0, 1), zs: axis(2, 3) };
}

// Merge adjacent cells into coplanar plates rather than overlapping slabs.
function plates({ xs, zs }, matches) {
  const result = [];
  let previous = new Map();
  for (let j = 0; j < zs.length - 1; j++) {
    const z0 = zs[j], z1 = zs[j + 1], row = new Map();
    for (let i = 0; i < xs.length - 1;) {
      const open = index => matches((xs[index] + xs[index + 1]) / 2, (z0 + z1) / 2);
      if (!open(i)) { i++; continue; }
      const lo = i++;
      while (i < xs.length - 1 && open(i)) i++;
      const key = `${lo}:${i}`;
      const old = previous.get(key);
      if (old) { old.d += z1 - z0; old.z += (z1 - z0) / 2; row.set(key, old); }
      else {
        const r = rect((xs[lo] + xs[i]) / 2, (z0 + z1) / 2, xs[i] - xs[lo], z1 - z0);
        result.push(r); row.set(key, r);
      }
    }
    previous = row;
  }
  return result;
}

export function reserveBasements(world) {
  const plan = PLANS[world.id]; if (!plan) return world;
  const entries = plan.stairs.map(entryFor);
  const reservedAreas = [...(world.reservedAreas || []), ...entries.map(e => ({ ...e.pocket, w: e.pocket.w + .8, d: e.pocket.d + .8 }))];
  const groundHoles = entries.map(e => e.hole);
  if (!plan.divider) return { ...world, reservedAreas, groundHoles };
  const { thickness, height } = plan.divider;
  const divider = rect(0, 0, thickness, world.depth + 2);
  return { ...world, groundHoles, reservedAreas: [...reservedAreas, divider], obstacles: [...world.obstacles, box('glacier-divider', divider, 0, height, 'wall')] };
}

export function addBasements(world) {
  const plan = PLANS[world.id]; if (!plan) return world;
  const entries = plan.stairs.map(entryFor), holes = entries.map(e => e.hole);
  const floorLimits = rect(0, 0, world.width, world.depth);
  const ground = plates(grid([floorLimits, ...holes]), (x, z) => !holes.some(hole => inside(x, z, hole)));
  const atDepth = ([x, z]) => ({ x, y: DEPTH, z });
  const path = [entries[0].bottom, ...plan.bends.map(atDepth), entries[1].bottom];
  const branches = (plan.branches || []).map(({ label, width, bends }) => ({ label, width, path: bends.map(atDepth) }));
  const corridors = (points, width) => points.slice(1).map((b, i) => {
    const a = points[i];
    return rect((a.x + b.x) / 2, (a.z + b.z) / 2, Math.abs(a.x - b.x) + width, Math.abs(a.z - b.z) + width);
  });
  const passages = [...corridors(path, plan.width), ...branches.flatMap(branch => corridors(branch.path, branch.width))];
  const spaces = [...entries.map(e => e.pocket), ...plan.rooms, ...passages];
  const lattice = grid(spaces), { xs, zs } = lattice;
  const open = (x, z) => spaces.some(s => inside(x, z, s));
  const floor = plates(lattice, open);
  const obstacles = [...world.obstacles];
  const add = (name, r, y, h, kind) => obstacles.push(box(`basement-${name}`, r, y, h, kind));
  ground.forEach((r, i) => add(`surface-${i}`, r, -CAP, CAP, 'ground-slab'));
  const slabBottom = +(DEPTH - .28).toFixed(2);
  floor.forEach((r, i) => add(`floor-${i}`, r, slabBottom, DEPTH - slabBottom, 'basement-floor'));
  const wall = .26, edges = new Map();
  const boundary = (axis, side, fixed, low, high) => {
    const key = `${axis}/${side}/${fixed}`;
    if (!edges.has(key)) edges.set(key, { axis, side, fixed, spans: [] });
    edges.get(key).spans.push([low, high]);
  };
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const [l, r, n, s] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
    const x = (l + r) / 2, z = (n + s) / 2;
    if (!open(x, z)) continue;
    if (!open(l - .0001, z)) boundary('x', -1, l, n, s);
    if (!open(r + .0001, z)) boundary('x', 1, r, n, s);
    if (!open(x, n - .0001)) boundary('z', -1, n, l, r);
    if (!open(x, s + .0001)) boundary('z', 1, s, l, r);
  }
  let index = 0;
  for (const { axis, side, fixed, spans } of edges.values()) {
    const merged = [];
    for (const [lo, hi] of spans.sort((a, b) => a[0] - b[0])) {
      if (merged.length && lo <= merged.at(-1)[1] + .0001) merged.at(-1)[1] = hi;
      else merged.push([lo, hi]);
    }
    for (const [lo, hi] of merged) {
      // The thin ends meet at corners without narrowing the navigable space.
      const cross = fixed + side * wall / 2, center = (lo + hi) / 2, length = hi - lo + .04;
      const r = axis === 'x' ? rect(cross, center, wall, length) : rect(center, cross, length, wall);
      add(`wall-${index++}`, r, DEPTH - .12, -DEPTH + .12, 'basement-wall');
    }
  }
  plan.cover.forEach((r, i) => add(`cover-${i}`, r, DEPTH, 1.17, 'basement-cover'));
  for (const { id, width, axis, volume } of entries) {
    const alongX = axis === 'x', across = alongX ? 'z' : 'x';
    for (let i = 0; i < STEPS; i++) {
      const segment = RUN / STEPS;
      const y = DEPTH * (i + 1) / STEPS, r = volume((i + .5) * segment, segment, width);
      add(`${id}-step-${i}`, r, DEPTH - .12, y - DEPTH + .12, 'basement-step');
    }
    for (const side of [-1, 1]) {
      const r = volume(RUN / 2, RUN, .16);
      r[across] += side * (width / 2 + .08);
      add(`${id}-rail-${side}`, r, 0, .83, 'basement-rail');
    }
    add(`${id}-rail-end`, volume(RUN + .09, .18, width + .32), 0, .83, 'basement-rail');
  }
  return Object.freeze({
    ...world, obstacles,
    underground: { label: plan.label, floor: DEPTH, holes, rooms: plan.rooms, passages, path, branches, divider: plan.divider,
      entrances: entries.map(({ point, volume, pocket, ...entry }) => entry) },
  });
}
