const EPS = 0.00001;
const boxBounds = (b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, minY: b.y || 0, maxY: (b.y || 0) + b.h });
const intersects = (a, b) => a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS && a.minY < b.maxY - EPS && a.maxY > b.minY + EPS;

// Spawns borrow the arena's architecture and scenery. Never build a personal
// U-shaped enclosure, roof or spawn-only wall around a player.
export function addSpawnZones(world, rules) {
  const obstacles = [...world.obstacles], colliders = obstacles.map(boxBounds), spawns = [], spawnZones = [];
  const radius = rules.playerRadius, height = rules.playerHeight;
  const bodyBox = (p) => ({ minX: p.x - radius, maxX: p.x + radius, minZ: p.z - radius, maxZ: p.z + radius, minY: p.y || 0, maxY: (p.y || 0) + height });
  const inside = (p) => Math.abs(p.x) < world.width / 2 - radius - 0.15 && Math.abs(p.z) < world.depth / 2 - radius - 0.15;
  const free = (p) => inside(p) && !colliders.some((b) => intersects(bodyBox(p), b));
  const supported = (p) => p.y === 0 || colliders.some((b) => Math.abs(b.maxY - p.y) < EPS && p.x - radius < b.maxX && p.x + radius > b.minX && p.z - radius < b.maxZ && p.z + radius > b.minZ);
  const samples = (a, b) => Array.from({ length: 17 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / 16, y: a.y + (b.y - a.y) * i / 16, z: a.z + (b.z - a.z) * i / 16 }));
  const pathClear = (a, b) => samples(a, b).every((p) => free(p) && supported(p));
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  const exitFor = (point) => {
    const choices = directions.map(([dx, dz]) => ({ x: point.x + dx * 2.4, y: point.y, z: point.z + dz * 2.4 }));
    choices.sort((a, b) => a.x * a.x + a.z * a.z - b.x * b.x - b.z * b.z);
    const exit = choices.find((p) => pathClear(point, p));
    return exit ? [exit] : null;
  };
  const scenery = (box) => { obstacles.push(box); colliders.push(boxBounds(box)); };
  const reserved = world.buildings.flatMap((building) => building.route.flatMap((point, i, route) => i ? samples(route[i - 1], point) : [point]));

  // A few full-size freight stacks/utility installations break exposed outer
  // lanes as part of the map, not as structures centred on a spawn point.
  for (const [i, anchor] of world.spawns.filter((_, i) => i < 6).entries()) {
    const cargo = ['harbor', 'rail', 'desert'].includes(world.theme) || i % 2 === 0;
    const w = cargo ? 5.6 : 3.0, d = cargo ? 2.8 : 2.2, h = cargo ? 2.7 : 2.15;
    const target = { x: anchor.x * 0.82, z: anchor.z * 0.8 }, choices = [];
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) choices.push({ x: target.x + dx, z: target.z + dz });
    choices.sort((a, b) => (a.x - target.x) ** 2 + (a.z - target.z) ** 2 - (b.x - target.x) ** 2 - (b.z - target.z) ** 2);
    const point = choices.find((p) => {
      if (Math.abs(p.x) + w / 2 > world.width / 2 - 2 || Math.abs(p.z) + d / 2 > world.depth / 2 - 3.5) return false;
      if (world.buildings.some((b) => Math.abs(p.x - b.x) < (w + b.w) / 2 + 1.1 && Math.abs(p.z - b.z) < (d + b.d) / 2 + 1.1)) return false;
      const b = boxBounds({ ...p, y: 0, w: w + 1.4, d: d + 1.4, h });
      return !colliders.some((other) => intersects(b, other)) && !reserved.some((p) => intersects(b, bodyBox(p)));
    });
    if (point) scenery({ id: `yard-${cargo ? 'freight' : 'utilities'}-${i}`, ...point, y: 0, w, d, h, kind: cargo ? 'container' : 'equipment', color: i % 3 ? 'slate' : 'orange', scenery: true });
  }

  const groundSight = colliders.filter((box) => box.minY <= rules.eyeHeight && box.maxY >= rules.eyeHeight);
  const visible = (from, to) => {
    return !groundSight.some((box) => {
      let near = 0, far = 1;
      for (const [axis, lo, hi] of [['x', 'minX', 'maxX'], ['z', 'minZ', 'maxZ']]) {
        const delta = to[axis] - from[axis];
        if (Math.abs(delta) < EPS) { if (from[axis] < box[lo] || from[axis] > box[hi]) return false; }
        else { const t1 = (box[lo] - from[axis]) / delta, t2 = (box[hi] - from[axis]) / delta; near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2)); if (near > far) return false; }
      }
      return far > EPS && near < 1 - EPS;
    });
  };
  const add = (point, exitPath, coverIds, level = 1, roof = false) => {
    if (!exitPath || !free(point) || !supported(point)) return false;
    let previous = point;
    for (const exit of exitPath) { if (!pathClear(previous, exit)) return false; previous = exit; }
    const id = `spawn-zone-${spawns.length}`, yaw = Math.atan2(-(exitPath[0].x - point.x), -(exitPath[0].z - point.z));
    spawns.push({ ...point, yaw, spawnId: `${world.id}-${id}`, areaId: id, level, roof, exitPath });
    spawnZones.push({ id, ...point, level, roof, coverIds }); return true;
  };

  const candidates = [], seen = new Set();
  for (const box of obstacles) {
    if (box.kind === 'wall' || (box.y || 0) > EPS || box.h < 1.9) continue;
    for (const axis of ['x', 'z']) for (const side of [-1, 1]) for (const fraction of [-0.3, 0, 0.3]) {
      const point = axis === 'x' ? { x: box.x + side * (box.w / 2 + radius + 0.5), y: 0, z: box.z + box.d * fraction } : { x: box.x + box.w * fraction, y: 0, z: box.z + side * (box.d / 2 + radius + 0.5) };
      const key = `${point.x.toFixed(2)},${point.z.toFixed(2)}`;
      if (seen.has(key) || !free(point)) continue;
      seen.add(key); const exitPath = exitFor(point);
      if (exitPath) candidates.push({ point, exitPath, coverIds: [box.id], distance: Infinity, exposed: 0 });
    }
  }
  for (let i = 0; i < 24; i++) {
    const available = candidates.filter((candidate) => candidate.distance >= 16);
    available.sort((a, b) => (Math.min(b.distance, 2500) / (1 + b.exposed * 0.8)) - (Math.min(a.distance, 2500) / (1 + a.exposed * 0.8)));
    const choice = available[0]; if (!choice) break;
    add(choice.point, choice.exitPath, choice.coverIds);
    for (const candidate of candidates) {
      candidate.distance = Math.min(candidate.distance, (candidate.point.x - choice.point.x) ** 2 + (candidate.point.z - choice.point.z) ** 2);
      if (candidate.distance >= 16 && visible(candidate.point, choice.point)) candidate.exposed++;
    }
  }

  for (const building of world.buildings) {
    const y = building.height, equipment = { id: `${building.id}-roof-hvac`, x: building.x + building.w / 2 - 1.2, y, z: building.z - 0.4, w: 1.3, d: 2.2, h: 2.05, kind: 'equipment', scenery: true };
    if (!colliders.some((b) => intersects(boxBounds(equipment), b)) && !reserved.some((p) => intersects(boxBounds(equipment), bodyBox(p)))) scenery(equipment);
    for (let floor = 1; floor <= building.storeys; floor++) for (const side of [-1, 1]) {
      const roof = floor === building.storeys, point = { x: building.x + building.w / 2 - (roof ? 1.2 : 0.85), y: floor * 3, z: building.z + side * (building.d / 2 - 0.85) };
      const inside = { x: building.x + building.w / 2 - 2.4, y: point.y, z: point.z };
      const exitPath = [inside, { x: inside.x, y: point.y, z: building.z + building.d / 2 - 0.8 }];
      add(point, exitPath, roof ? [equipment.id] : world.obstacles.filter((b) => b.buildingId === building.id && b.kind === 'building-wall').map((b) => b.id), floor + 1, roof);
    }
  }
  return Object.freeze({ ...world, obstacles, spawns, spawnZones });
}
