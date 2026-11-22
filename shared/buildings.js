import { BUILDING_FACADES, ROOF_BRIDGES, buildingProfile } from './building-profiles.js';

const LEVEL = 3, WALL = .24, SLAB = .22, STAIR_START = 1.28, WALK_INSET = .82;
const windowTypes = {
  slot: [.92, 1.27, 2.2], regular: [1.5, 1.02, 2.3], tall: [1.45, .79, 2.48],
  wide: [2.3, .94, 2.35], panorama: [3.08, .83, 2.46],
};
const rect = (x, z, w, d) => ({ x, z, w, d });
const edges = (r) => [r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2];
const overlaps = (a, b, padding = 0) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + padding - 1e-5 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + padding - 1e-5;
const footprint = source => rect(source.x, source.z, Math.max(6, source.w), Math.max(6.6, source.d));

function faceOf(building, face) {
  const axis = face % 2 === 0 ? 'x' : 'z', side = face === 0 || face === 3 ? 1 : -1;
  const span = axis === 'x' ? building.w : building.d, depth = axis === 'x' ? building.d : building.w;
  const point = (u, v, y) => axis === 'x' ? { x: building.x + side * u, y, z: building.z + side * (depth / 2 - v) }
    : { x: building.x + side * (depth / 2 - v), y, z: building.z - side * u };
  const volume = (u, v, cross, along) => ({ ...point(u, v, 0), w: axis === 'x' ? cross : along, d: axis === 'x' ? along : cross });
  const offset = point => axis === 'x' ? (point.x - building.x) * side : (building.z - point.z) * side;
  return { axis, side, span, depth, point, volume, offset };
}

function cutFloor(plate, hole) {
  if (!overlaps(plate, hole)) return [plate];
  const [x0, x1, z0, z1] = edges(plate), [hx0, hx1, hz0, hz1] = edges(hole);
  const l = Math.max(x0, hx0), r = Math.min(x1, hx1), t = Math.max(z0, hz0), b = Math.min(z1, hz1);
  return [[x0, l, z0, z1], [r, x1, z0, z1], [l, r, z0, t], [l, r, b, z1]]
    .filter(([a, b, c, d]) => b - a > .01 && d - c > .01)
    .map(([a, b, c, d]) => rect((a + b) / 2, (c + d) / 2, b - a, d - c));
}

function stairsFor(building, spec, index) {
  const face = faceOf(building, spec.face), { width, shape } = spec, folded = shape === 'switchback';
  const overall = folded ? width * 2 + .16 : width;
  const u = spec.lane * (face.span / 2 - overall / 2 - .44);
  const run = Math.min(folded ? 3.7 : 6.7, face.depth - (folded ? 3.08 : 2.98));
  const end = STAIR_START + run, a = folded ? u - spec.hand * (width + .16) / 2 : u, b = folded ? 2 * u - a : u;
  const hole = face.volume(u, (STAIR_START + end + (folded ? .9 : 0)) / 2, overall + .06, run + (folded ? .9 : 0));
  const land = end + .44, exit = folded ? WALK_INSET : end + .78, flights = [], solids = [];
  const along = face.axis === 'x' ? 'z' : 'x';
  const add = (name, u, v, y, w, d, kind, direction) => solids.push({
    ...face.volume(u, v, w, d), id: `${building.id}-stairs-${index}-${name}`, buildingId: building.id, kind, y: y - SLAB, h: SLAB,
    ...(direction ? { stairAxis: along, stairDirection: direction, color: 'orange' } : {}),
  });
  for (let level = 0; level < building.storeys; level++) {
    const y = level * LEVEL, count = folded ? 5 : 10, depth = run / count;
    for (let step = 0; step < count; step++) {
      const traveled = (step + .5) * depth, rise = (step + 1) * .3;
      add(`${level}-a-${step}`, a, STAIR_START + traveled, y + rise, width, depth, 'building-step', -face.side);
      if (folded) add(`${level}-b-${step}`, b, end - traveled, y + 1.5 + rise, width, depth, 'building-step', face.side);
    }
    if (folded) add(`${level}-turn`, u, end + .45, y + 1.5, overall, .9, 'building-floor');
    const route = [face.point(a, WALK_INSET, y)];
    if (folded) route.push(face.point(a, land, y + 1.5), face.point(b, land, y + 1.5));
    route.push(face.point(b, exit, y + LEVEL));
    flights.push(route);
  }
  return { id: `${building.id}-stairs-${index}`, shape, width, flights, hole, solids };
}

function placeBridges(world, buildings, blockers) {
  const bridges = [];
  for (const design of ROOF_BRIDGES[world.id] || []) {
    const from = buildings.find(b => b.id === design.from), to = buildings.find(b => b.id === design.to);
    if (!from || !to || from.height !== to.height) continue;
    const { axis, at, width } = design, across = axis === 'x' ? 'z' : 'x', depth = axis === 'x' ? 'w' : 'd', span = axis === 'x' ? 'd' : 'w';
    const start = from[axis] + from[depth] / 2, end = to[axis] - to[depth] / 2, height = from.height;
    if (end - start < 1.3 || [from, to].some(b => Math.abs(at - b[across]) + width / 2 > b[span] / 2 - .38)) continue;
    const point = (p) => ({ [axis]: p, [across]: at, y: height });
    const route = [point(start - WALK_INSET), point(end + WALK_INSET)];
    if ([from, to].some((b, i) => b.stairs.some(stair => overlaps(stair.hole, rect(route[i].x, route[i].z, .88, .88))))) continue;
    const deck = { ...point((start + end) / 2), [depth]: end - start + .56, [span]: width };
    const clearance = { ...deck, [depth]: end - start };
    if (blockers.some(box => overlaps(clearance, box, .02) && (box.y || 0) + box.h > height - SLAB && (box.y || 0) < height + 2.6) ||
        buildings.some(b => b !== from && b !== to && b.height + .9 > height - SLAB && overlaps(clearance, b))) continue;
    const add = (name, box, y, h, kind) => blockers.push({ id: `${design.id}-${name}`, buildingId: design.id, ...box, y, h, kind, bridgeStyle: design.style });
    add('deck', deck, height - SLAB, SLAB, 'building-bridge');
    for (const side of [-1, 1]) {
      const cross = at + side * (width / 2 - .08);
      add(`rail-${side}`, { ...clearance, [across]: cross, [span]: .16 }, height, .93, 'building-rail');
      if (design.style === 'steel') add(`girder-${side}`, { ...clearance, [across]: cross, [span]: .24 }, height - SLAB - .34, .34, 'building-bridge');
      if (design.style === 'covered') for (const t of [.11, .5, .89]) {
        add(`post-${side}-${t}`, { ...point(start + t * (end - start)), [depth]: .14, [span]: .13, [across]: cross }, height + .93, 1.54, 'building-rail');
      }
    }
    if (design.style === 'covered') add('canopy', { ...clearance, [span]: width + .44 }, height + 2.47, .16, 'building-bridge');
    from.roofCuts.push({ face: axis === 'x' ? 3 : 0, at: point(start), width });
    to.roofCuts.push({ face: axis === 'x' ? 1 : 2, at: point(end), width });
    bridges.push({ ...design, ...clearance, height, route });
  }
  return bridges;
}

function assembleBuilding(building, obstacles, neighbors, world) {
  const { id, profile } = building, style = BUILDING_FACADES[profile.style];
  const add = (name, box, y, h, kind) => { if (box.w > .01 && box.d > .01 && h > .01) obstacles.push({ id: `${id}-${name}`, buildingId: id, ...box, y, h, kind }); };
  const nearby = obstacles.filter(box => overlaps(building, box, 2.4));
  const faceOpenings = (floor, side) => {
    const face = faceOf(building, side), base = floor * LEVEL, openings = [];
    const reserve = (fraction, width, sill, top, accept) => {
      for (const shift of sill === 0 ? [0, -.16, .16, -.34, .34, -.58, .58] : [0, -.16, .16]) {
        const offset = Math.max(-face.span / 2 + width / 2 + .35, Math.min(face.span / 2 - width / 2 - .35, (fraction + shift) * face.span / 2));
        if (openings.some(o => Math.abs(o.offset - offset) < (o.width + width) / 2 + .32) || !accept(offset)) continue;
        const opening = { ...face.point(offset, 0, base + (sill + top) / 2), axis: face.axis, side: face.side, floor, offset, width, height: top - sill, sill, top };
        openings.push(opening); return opening;
      }
    };
    const candidateDoor = (offset) => {
      const throat = face.volume(offset, -.15, 1.16, 2.46);
      const inner = face.point(offset, WALK_INSET, 0);
      return Math.abs(throat.x) + throat.w / 2 <= world.width / 2 && Math.abs(throat.z) + throat.d / 2 <= world.depth / 2 &&
        !(world.groundHoles || []).some(hole => overlaps(throat, hole, .18)) &&
        !nearby.some(b => (b.y || 0) < 1.8 && (b.y || 0) + b.h > .42 && overlaps(throat, b)) &&
        !building.stairs.some(stair => overlaps(stair.hole, rect(inner.x, inner.z, .72, .72))) &&
        !neighbors.some(b => b !== building && overlaps(throat, b));
    };
    const door = (offset, width) => {
      const opening = reserve(offset, width, 0, width >= 2.5 ? 2.65 : 2.43, candidateDoor);
      if (!opening) return;
      building.doors.push({ ...opening, outside: face.point(opening.offset, -1.03, 0), inside: face.point(opening.offset, WALK_INSET, 0) });
    };
    if (floor === 0) {
      for (const [orientation, offset, width] of style.doors) if ((orientation + profile.turn) % 4 === side) door(offset, width);
    }
    const candidateWindow = (offset, sill, top) => {
      const inside = face.point(offset, .69, 0), opening = face.volume(offset, 0, .24, 1.12);
      if (building.stairs.some(stair => overlaps(stair.hole, rect(inside.x, inside.z, .48, .48)))) return false;
      return !nearby.some(b => (b.y || 0) < base + top - .2 && (b.y || 0) + b.h > base + sill + .2 && overlaps(opening, b)) &&
        !neighbors.some(b => b !== building && b.height > base + top && overlaps(opening, b));
    };
    const window = (offset, type) => {
      const [width, sill, top] = windowTypes[type];
      const opening = reserve(offset, width, sill, top, p => candidateWindow(p, sill, top));
      if (opening) building.windows.push(opening);
    };
    for (const [orientation, offset, type] of style.windows[floor % style.windows.length]) if ((orientation + profile.turn) % 4 === side) window(offset, type);
    return { face, openings, door, window };
  };

  const wall = (floor, side, face, list) => {
    let cursor = -face.span / 2, i = 0;
    const panel = (tag, a, b, y, h) => add(`${floor}-${side}-${i++}-${tag}`, face.volume((a + b) / 2, WALL / 2, b - a, WALL), floor * LEVEL + y, h, 'building-wall');
    for (const { offset, width, sill, top } of list.sort((a, b) => a.offset - b.offset)) {
      const a = offset - width / 2, b = offset + width / 2;
      panel('pier', cursor, a, 0, LEVEL); building.solidPanels++;
      panel('sill', a, b, 0, sill); panel('lintel', a, b, top, LEVEL - top); cursor = b;
    }
    panel('pier', cursor, face.span / 2, 0, LEVEL); building.solidPanels++;
  };
  for (let level = 0; level < building.storeys; level++) {
    const faces = Array.from({ length: 4 }, (_, side) => faceOpenings(level, side));
    if (level === 0 && !building.doors.length) {
      for (const face of faces) {
        for (const offset of [0, -.52, .52]) { face.door(offset, 1.65); if (building.doors.length) break; }
        if (building.doors.length) break;
      }
    }
    if (!building.windows.some(win => win.floor === level)) for (const face of faces) {
      face.window(0, 'regular'); if (building.windows.some(win => win.floor === level)) break;
    }
    faces.forEach(({ face, openings }, side) => wall(level, side, face, openings));
    for (const [i, [x, z, w, d]] of (style.partitions || []).entries()) {
      add(`partition-${level}-${i}`, rect(building.x + x, building.z + z, w, d), level * LEVEL, LEVEL, 'building-wall');
    }
    building.plates.forEach((plate, i) => add(`plate-${level}-${i}`, plate, (level + 1) * LEVEL - SLAB, SLAB, 'building-floor'));
  }
  for (let side = 0; side < 4; side++) {
    const face = faceOf(building, side); let left = -face.span / 2, index = 0;
    const rail = (a, b) => add(`parapet-${side}-${index++}`, face.volume((a + b) / 2, WALL / 2, b - a, WALL), building.height, style.rail, 'building-rail');
    const cuts = building.roofCuts.filter(c => c.face === side).map(c => ({ ...c, center: face.offset(c.at) })).sort((a, b) => a.center - b.center);
    for (const cut of cuts) { rail(left, cut.center - cut.width / 2); left = cut.center + cut.width / 2; }
    rail(left, face.span / 2);
  }
  for (const stair of building.stairs) { obstacles.push(...stair.solids); delete stair.solids; }
  // "Entry" and "roof" remain stable landmarks for bots, tests and previews.
  building.entry = building.doors[0]?.outside;
  building.roof = building.stairs[0].flights.at(-1).at(-1);
  delete building.profile;
}

// Hollow, traversable buildings: collision is made from the same wall, stair and
// floor pieces as rendering. Windows and doors are actual openings, not decals.
export function expandBuildings(world) {
  const obstacles = world.obstacles.filter((box) => box.kind !== 'building'), buildings = [];
  const sources = world.obstacles.filter((box) => box.kind === 'building');
  for (let addition = 0; addition < 2; addition++) {
    if (sources.some(source => source.id === `operations-tower-${addition}`)) continue;
    const choices = [];
    for (let z = -world.depth / 2 + 5; z <= world.depth / 2 - 5; z++) for (let x = -world.width / 2 + 5; x <= world.width / 2 - 5; x++) {
      if (world.reservedAreas?.some((r) => Math.abs(r.x - x) < (r.w + 6) / 2 + .5 && Math.abs(r.z - z) < (r.d + 7) / 2 + .5)) continue;
      if (world.spawns.some((p) => Math.abs(p.x - x) < 4.6 && Math.abs(p.z - z) < 5.1)) continue;
      if (sources.some((box) => Math.abs(box.x - x) < (Math.max(6, box.w) + 6) / 2 + 1.5 && Math.abs(box.z - z) < (Math.max(6.6, box.d) + 7) / 2 + 1.5)) continue;
      if (obstacles.some((box) => Math.abs(box.x - x) < (box.w + 6) / 2 + 1.25 && Math.abs(box.z - z) < (box.d + 7) / 2 + 1.25)) continue;
      choices.push({ x, z });
    }
    const anchor = world.id === 'foundry' ? { x: addition ? -1 : 1, z: addition ? 9 : -9 } : { x: world.width * (addition ? 0.22 : -0.22), z: world.depth * (addition ? 0.25 : -0.25) };
    choices.sort((a, b) => (a.x - anchor.x) ** 2 + (a.z - anchor.z) ** 2 - ((b.x - anchor.x) ** 2 + (b.z - anchor.z) ** 2));
    if (choices[0]) sources.push({ id: `operations-tower-${addition}`, ...choices[0], w: 6, d: 7, h: 6 });
  }
  for (const source of sources) {
    const profile = buildingProfile(world.id, source.id);
    const building = { id: source.id, ...footprint(source), profile, style: profile.style, windows: [], doors: [], solidPanels: 0, roofCuts: [] };
    building.storeys = source.storeys || (source.id === 'operations-tower-0' || source.h >= 6 && source.w >= 9 && source.d >= 9 || source.id === 'warehouse' ? 3 : 2);
    building.height = building.storeys * LEVEL;
    building.stairs = profile.stairs.map((stair, i) => stairsFor(building, stair, i));
    building.plates = building.stairs.reduce((plates, stair) => plates.flatMap(plate => cutFloor(plate, stair.hole)), [rect(building.x, building.z, building.w - WALL, building.d - WALL)]);
    building.floorGuides = building.plates.flatMap(plate => {
      const offsets = (span) => span >= 1.8 ? [-span / 2 + .66, 0, span / 2 - .66] : [0];
      return offsets(plate.w).flatMap(dx => offsets(plate.d).map(dz => ({ x: plate.x + dx, z: plate.z + dz })));
    });
    for (const hole of world.groundHoles || []) if (overlaps(building, hole)) {
      const [l, r, n, s] = edges(hole);
      for (const x of [l - .62, hole.x, r + .62]) for (const z of [n - .62, hole.z, s + .62]) {
        if (Math.abs(x - building.x) < building.w / 2 - .58 && Math.abs(z - building.z) < building.d / 2 - .58) building.floorGuides.push({ x, z });
      }
    }
    buildings.push(building);
  }
  const roofBridges = placeBridges(world, buildings, obstacles);
  for (const building of buildings) assembleBuilding(building, obstacles, buildings, world);
  const coverWalls = [];
  for (let i = 0; i < 8; i++) {
    const width = i % 2 ? 0.38 : 4.2, depth = i % 2 ? 4.2 : 0.38, choices = [];
    for (let z = -world.depth / 2 + 4; z < world.depth / 2 - 3; z += 1) for (let x = -world.width / 2 + 4; x < world.width / 2 - 3; x += 1) {
      if (world.reservedAreas?.some((r) => Math.abs(r.x - x) < (r.w + width) / 2 + .5 && Math.abs(r.z - z) < (r.d + depth) / 2 + .5)) continue;
      if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;
      if (world.spawns.some((p) => Math.abs(p.x - x) < width / 2 + 2.5 && Math.abs(p.z - z) < depth / 2 + 2.5)) continue;
      if (sources.some((box) => Math.abs(box.x - x) < (Math.max(6, box.w) + width) / 2 + 1.7 && Math.abs(box.z - z) < (Math.max(6.6, box.d) + depth) / 2 + 1.7)) continue;
      if (obstacles.some((box) => Math.abs(box.x - x) < (box.w + width) / 2 + 1 && Math.abs(box.z - z) < (box.d + depth) / 2 + 1)) continue;
      choices.push({ x, z });
    }
    const anchor = { x: (i % 4 < 2 ? -1 : 1) * world.width * 0.32, z: (i % 2 ? -1 : 1) * world.depth * 0.24 };
    choices.sort((a, b) => (a.x - anchor.x) ** 2 + (a.z - anchor.z) ** 2 - ((b.x - anchor.x) ** 2 + (b.z - anchor.z) ** 2));
    if (!choices[0]) continue;
    const id = `solid-cover-wall-${i}`; obstacles.push({ id, buildingId: id, ...choices[0], y: 0, w: width, d: depth, h: i % 3 ? 2.5 : 3.2, kind: 'building-wall' }); coverWalls.push(id);
  }
  return Object.freeze({ ...world, obstacles, buildings, roofBridges, coverWalls });
}
