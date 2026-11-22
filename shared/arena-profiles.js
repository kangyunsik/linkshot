// Authored setbacks, not invisible boundaries. A range runs along the named
// side; inset is the depth of the structure extending into the arena.
const profiles = {
  foundry: {
    edges: [
      ['west', -8, -2, 6, 8], ['west', 3, 9, 9, 9], ['west', 9, 15, 5, 8],
      ['east', -18, -13, 4, 8], ['east', -13, -8.75, 7, 9], ['east', 15, 18, 3, 7],
      ['north', -16, -7, 4.5, 8], ['north', 7, 13, 3, 7], ['south', -12, -5, 3, 8],
    ],
  },
  longrail: {
    edges: [
      ['west', -37, -25, 5, 8], ['west', -9, -3, 9, 8], ['west', -3, 4, 15.5, 12], ['west', 4, 9, 8, 8], ['west', 28, 38, 5.5, 8],
      ['east', -40, -32, 4, 8], ['east', -6, -1, 9, 9], ['east', -1, 5, 19, 12], ['east', 5, 12, 8, 8], ['east', 24, 34, 5, 7],
      ['north', 3, 12, 3.5, 7], ['south', -12, -4, 4, 7],
    ],
    crossing: { axis: 'z', at: 1, lanes: [{ name: '정비 골목', center: -1.75, start: -8, end: 10, width: 6.5 }] },
  },
  drydock: {
    edges: [
      ['west', -14, -7, 7, 8], ['west', -7, 2, 11, 10], ['west', 2, 10, 7.5, 8],
      ['east', -23, -13, 5, 8], ['east', 2, 8, 6, 8], ['east', 8, 16, 10, 9], ['east', 16, 22, 6, 8],
      ['north', -19, -10, 6, 9], ['north', -10, -3, 9, 11], ['south', 9, 19, 10, 10], ['south', 19, 29, 6, 8],
    ],
  },
  blocknine: {
    edges: [
      ['west', -7, -2, 19, 9], ['west', -2, 6, 26, 13], ['west', 6, 11, 18, 9],
      ['east', -8, -2, 19, 9], ['east', -2, 6, 23, 13], ['east', 6, 11, 18, 10],
      ['north', -12, -4, 4, 8], ['north', 13, 24, 5, 9], ['south', -25, -14, 5.5, 9], ['south', 4, 12, 4, 8],
    ],
    islands: [[-4, 6, -4.5, 7.5, 12]],
    crossing: { axis: 'z', at: 1, lanes: [
      { name: '서쪽 골목', center: -8, start: -7, end: 9, width: 6.5 },
      { name: '동쪽 골목', center: 10.5, start: -9, end: 8, width: 7.5 },
    ] },
  },
  whiteout: {
    edges: [
      ['west', -17, -10, 4.5, 8], ['west', -8, 0, 8, 9], ['west', 0, 7, 5.5, 8], ['west', 12, 20, 4, 7],
      ['east', -21, -13, 5, 8], ['east', -2, 6, 9, 9], ['east', 6, 13, 6, 8],
      ['north', -19, -8, 7, 8], ['north', 5, 15, 5.5, 7], ['south', -25, -17, 5, 7], ['south', 13, 23, 7.5, 9],
    ],
  },
  redline: {
    edges: [
      ['west', -13, -4, 6, 8], ['west', 5, 13, 9, 9], ['east', -10, 1, 8, 9], ['east', 8, 14, 5, 8],
      ['north', -26, -15, 1.5, 7], ['north', 7, 18, 1.5, 7],
      ['south', -56, -49, 8, 9], ['south', -45, -36, 5, 8], ['south', -27, -17, 9, 10],
      ['south', -10, 9, 8.5, 9], ['south', 18, 27, 9.5, 9], ['south', 35, 45, 5.5, 8], ['south', 50, 57, 8, 8],
    ],
    // The long north rail stays intact; the southern service route winds
    // around terraces instead of giving a second straight edge-to-edge lane.
    reserved: [{ x: 0, z: -19, w: 126, d: 2.2 }],
  },
};

const horizontal = (side) => side === 'north' || side === 'south';
const negative = (side) => side === 'north' || side === 'west';
const sides = ['north', 'south', 'west', 'east'];
const volume = (id, kind, minX, maxX, minZ, maxZ, h, arenaFace) => ({
  id, kind, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, y: 0,
  w: maxX - minX, d: maxZ - minZ, h, ...(arenaFace ? { arenaFace } : {}),
});

function wallSpan(side, from, to, halfX, halfZ, id) {
  const half = horizontal(side) ? halfZ : halfX, offset = negative(side) ? -half - 1 : half;
  return horizontal(side) ? volume(id, 'wall', from, to, offset, offset + 1, 7)
    : volume(id, 'wall', offset, offset + 1, from, to, 7);
}

export function applyArenaProfile(world) {
  if (!Object.hasOwn(profiles, world.id)) return world;
  const profile = profiles[world.id];
  const halfX = world.width / 2, halfZ = world.depth / 2, edges = [], walls = [];
  for (const [i, [side, from, to, inset, h]] of profile.edges.entries()) {
    const half = horizontal(side) ? halfZ : halfX;
    const [low, high] = negative(side) ? [-half, -half + inset] : [half - inset, half];
    const id = `arena-edge-${side}-${i}`;
    edges.push(horizontal(side) ? volume(id, 'arena-setback', from, to, low, high, h, side) : volume(id, 'arena-setback', low, high, from, to, h, side));
  }
  for (const side of sides) {
    const limit = horizontal(side) ? halfX : halfZ;
    const cuts = profile.edges.filter(([edge]) => edge === side).sort((a, b) => a[1] - b[1]);
    let start = -limit - 1, i = 0;
    for (const [, from, to] of cuts) {
      if (from > start) walls.push(wallSpan(side, start, from, halfX, halfZ, `${side}-${i++}`));
      start = Math.max(start, to);
    }
    if (start < limit + 1) walls.push(wallSpan(side, start, limit + 1, halfX, halfZ, `${side}-${i}`));
  }
  const islands = (profile.islands || []).map((extents, i) => volume(`arena-median-${i}`, 'arena-setback', ...extents));
  const corridors = (profile.crossing?.lanes || []).map(({ center, start, end, width }) => profile.crossing.axis === 'z'
    ? { x: center, z: (start + end) / 2, w: width, d: end - start }
    : { x: (start + end) / 2, z: center, w: end - start, d: width });
  return {
    ...world, arenaProfile: true, ...(profile.crossing ? { crossing: profile.crossing } : {}),
    reservedAreas: [...(world.reservedAreas || []), ...(profile.reserved || []), ...corridors],
    obstacles: [...walls, ...edges, ...islands, ...world.obstacles.filter(box => box.kind !== 'wall' || !sides.includes(box.id))],
  };
}
