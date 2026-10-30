// Hollow, traversable buildings: collision is made from the same wall, stair and
// floor pieces as rendering. Windows and doors are actual openings, not decals.
export function expandBuildings(world) {
  const obstacles = world.obstacles.filter((box) => box.kind !== 'building'), buildings = [];
  const sources = world.obstacles.filter((box) => box.kind === 'building');
  for (let addition = 0; addition < 2; addition++) {
    const choices = [];
    for (let z = -world.depth / 2 + 5; z <= world.depth / 2 - 5; z++) for (let x = -world.width / 2 + 5; x <= world.width / 2 - 5; x++) {
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
    const building = { id: source.id, x: source.x, z: source.z, w: Math.max(6, source.w), d: Math.max(6.6, source.d), storeys: source.w >= 10 && source.d >= 9 ? 3 : 2, windows: [], solidPanels: 0, route: [] };
    const { w, d } = building, levelHeight = 3, thickness = 0.24;
    building.height = building.storeys * levelHeight;
    const left = -w / 2 + 0.95, right = left + 1.45, startZ = d / 2 - 1.25, run = 3.7, landingZ = startZ - run - 0.45;
    const holeEdge = -w / 2 + 3.2, mainX = w / 2 - w / Math.max(2, Math.round(w / 2.7)) / 2;
    const add = (id, x, y, z, width, height, depth, kind = 'wall') => {
      if (height <= 0 || width <= 0 || depth <= 0) return;
      obstacles.push({ id: `${source.id}-${id}`, buildingId: source.id, x: source.x + x, y, z: source.z + z, w: width, h: height, d: depth, kind: `building-${kind}`, color: kind === 'step' ? 'orange' : 'slate' });
    };
    const point = (x, y, z) => ({ x: source.x + x, y, z: source.z + z });
    building.entry = point(mainX, 0, d / 2 + 0.85); building.roof = point(mainX, building.height, startZ + 0.3);
    building.route.push(building.entry, point(mainX, 0, startZ + 0.3));
    for (let floor = 0; floor < building.storeys; floor++) {
      const base = floor * levelHeight;
      for (const side of [-1, 1]) for (const axis of ['x', 'z']) {
        const span = axis === 'x' ? w : d, count = Math.max(2, Math.round(span / 2.7)), cell = span / count;
        for (let i = 0; i < count; i++) {
          const center = -span / 2 + cell * (i + 0.5), door = floor === 0 && axis === 'x' && side === 1 && i === count - 1;
          const opening = Math.min(door ? 1.8 : 1.5, cell - 0.45), sill = door ? 0 : 1.0, lintel = door ? 2.4 : 2.3;
          const wall = (tag, offset, y, length, height) => axis === 'x'
            ? add(`${floor}-${axis}-${side}-${i}-${tag}`, offset, base + y, side * (d / 2 - thickness / 2), length, height, thickness)
            : add(`${floor}-${axis}-${side}-${i}-${tag}`, side * (w / 2 - thickness / 2), base + y, offset, thickness, height, length);
          const hasWindow = !(axis === 'z' && side === -1) && (floor + i + (axis === 'x' ? 0 : 1) + (side > 0 ? 1 : 0)) % 3 === 0;
          if (!door && !hasWindow) { wall('solid', center, 0, cell, levelHeight); building.solidPanels++; continue; }
          const pillar = (cell - opening) / 2;
          wall('left', center - opening / 2 - pillar / 2, 0, pillar, levelHeight);
          wall('right', center + opening / 2 + pillar / 2, 0, pillar, levelHeight);
          wall('sill', center, 0, opening, sill); wall('lintel', center, lintel, opening, levelHeight - lintel);
          if (!door) building.windows.push({ ...point(axis === 'x' ? center : side * w / 2, base + (sill + lintel) / 2, axis === 'x' ? side * d / 2 : center), width: opening, height: lintel - sill, axis, side, floor });
        }
      }
      // Two stair flights per floor. Each tread is a thin slab, preserving
      // headroom underneath the matching flight on the next storey.
      for (let step = 0; step < 5; step++) {
        const rise = (step + 1) * 0.3;
        add(`${floor}-flight-a-${step}`, left, base + rise - 0.22, startZ - (step + 0.5) * run / 5, 1.3, 0.22, run / 5, 'step');
        add(`${floor}-flight-b-${step}`, right, base + 1.5 + rise - 0.22, startZ - run + (step + 0.5) * run / 5, 1.3, 0.22, run / 5, 'step');
      }
      add(`${floor}-landing`, (left + right) / 2, base + 1.5 - 0.22, landingZ, 2.75, 0.22, 0.9, 'floor');
      const top = base + levelHeight;
      add(`${floor}-main-floor`, (holeEdge + w / 2) / 2, top - 0.22, 0, w / 2 - holeEdge, 0.22, d - 0.48, 'floor');
      add(`${floor}-front-floor`, -w / 2 + 1.6, top - 0.22, (startZ + d / 2 - 0.24) / 2, 3.2, 0.22, d / 2 - 0.24 - startZ, 'floor');
      building.route.push(point(left, base, startZ + 0.45), point(left, base + 1.5, landingZ), point(right, base + 1.5, landingZ), point(right, top, startZ + 0.3), point(mainX, top, startZ + 0.3));
    }
    for (const side of [-1, 1]) {
      add(`parapet-x-${side}`, 0, building.height, side * (d / 2 - 0.12), w, 0.65, 0.24, 'rail');
      add(`parapet-z-${side}`, side * (w / 2 - 0.12), building.height, 0, 0.24, 0.65, d, 'rail');
    }
    buildings.push(building);
  }
  const coverWalls = [];
  for (let i = 0; i < 8; i++) {
    const width = i % 2 ? 0.38 : 4.2, depth = i % 2 ? 4.2 : 0.38, choices = [];
    for (let z = -world.depth / 2 + 4; z < world.depth / 2 - 3; z += 1) for (let x = -world.width / 2 + 4; x < world.width / 2 - 3; x += 1) {
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
  return Object.freeze({ ...world, obstacles, buildings, coverWalls });
}
