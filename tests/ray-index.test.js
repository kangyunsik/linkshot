import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, bounds, rayBox, wallDistance, hasLineOfSight, impactSurface } from '../shared/world.js';
import { surfaceRay } from '../shared/terrain.js';
import { createRayIndex, indexedRayDistance } from '../shared/ray-index.js';

// Independent copy of the pre-optimization slab algorithm.
function referenceBox(origin, direction, box, maxDistance) {
  const b = 'minX' in box ? box : bounds(box);
  let near = 0, far = maxDistance;
  for (const [axis, lo, hi] of [['x', 'minX', 'maxX'], ['y', 'minY', 'maxY'], ['z', 'minZ', 'maxZ']]) {
    if (Math.abs(direction[axis]) < 1e-9) { if (origin[axis] < b[lo] || origin[axis] > b[hi]) return null; }
    else {
      let a = (b[lo] - origin[axis]) / direction[axis], c = (b[hi] - origin[axis]) / direction[axis];
      if (a > c) [a, c] = [c, a];
      near = Math.max(near, a); far = Math.min(far, c);
      if (near > far) return null;
    }
  }
  return near <= maxDistance ? surfaceRay(origin, direction, b, near, far) : null;
}
const seeded = (seed = 29) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

test('indexed rays and early-out sight agree with the original exhaustive geometry on every map', () => {
  const random = seeded();
  for (const world of MAPS) {
    const boxes = world.obstacles.map((box) => ({ ...bounds(box), id: box.id, kind: box.kind }));
    for (let i = 0; i < 400; i++) {
      const origin = { x: (random() - .5) * world.width, y: random() * 10, z: (random() - .5) * world.depth };
      const end = { x: (random() - .5) * world.width, y: random() * 10, z: (random() - .5) * world.depth };
      if (i % 5 === 0) end.x = origin.x;
      if (i % 7 === 0) end.y = origin.y;
      if (i % 11 === 0) end.z = origin.z;
      const length = Math.hypot(end.x - origin.x, end.y - origin.y, end.z - origin.z);
      if (!length) continue;
      const direction = { x: (end.x - origin.x) / length, y: (end.y - origin.y) / length, z: (end.z - origin.z) / length };
      let nearest = length, expectedBox = null;
      for (const box of boxes) {
        const hit = referenceBox(origin, direction, box, nearest);
        assert.equal(rayBox(origin, direction, box, nearest), hit);
        if (hit !== null) { nearest = hit; expectedBox = box; }
      }
      const details = {}, actual = wallDistance(origin, direction, length, world, details), context = `${world.id}/${i}`;
      assert.equal(actual, nearest, context); assert.equal(details.box?.id, expectedBox?.id, context);
      assert.equal(hasLineOfSight(origin, end, world), nearest >= length - .01, context);
      assert.deepEqual(impactSurface(origin, direction, actual, details.box, world), impactSurface(origin, direction, nearest, expectedBox, world), context);
    }
  }
});

test('spatial ray queries prune unrelated obstacles without changing exact-hit tie order', () => {
  const boxes = [];
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) boxes.push({ ...bounds({ x: x * 4, y: 0, z: z * 4, w: 1, d: 1, h: 3 }), id: `${x}/${z}` });
  const index = createRayIndex(boxes); let checks = 0;
  const origin = { x: 0, y: 1, z: 2 }, direction = { x: 0, y: 0, z: -1 };
  const intersect = (...args) => { checks++; return rayBox(...args); };
  const details = {};
  assert.equal(indexedRayDistance(index, origin, direction, 10, intersect, details), 1.5);
  assert.equal(details.box.id, '0/0'); assert.ok(checks < boxes.length / 8, `${checks} checks for ${boxes.length} boxes`);
  const duplicate = Object.freeze({ width: 100, depth: 100, obstacles: [...boxes.map((box) => ({ id: box.id, x: (box.minX + box.maxX) / 2, y: 0, z: (box.minZ + box.maxZ) / 2, w: 1, d: 1, h: 3 })), { id: 'last', x: 0, y: 0, z: 0, w: 1, d: 1, h: 3 }] });
  assert.equal(wallDistance(origin, direction, 10, duplicate, details), 1.5); assert.equal(details.box.id, 'last');
});

test('parallel/grazing/inside rays and editable worlds retain their collision behavior', () => {
  const box = { id: 'wall', x: 0, y: 0, z: 0, w: 2, d: 2, h: 3 }, world = { width: 20, depth: 20, obstacles: [box] };
  for (const origin of [{ x: 0, y: 1, z: 0 }, { x: 1, y: 3, z: 4 }, { x: 1.01, y: 1, z: 4 }]) for (const direction of [{ x: 0, y: 0, z: -1 }, { x: -1, y: 0, z: 0 }, { x: 1e-10, y: -1, z: 0 }]) {
    assert.equal(rayBox(origin, direction, box, 10), referenceBox(origin, direction, box, 10));
  }
  const origin = { x: 0, y: 1, z: 4 }, end = { x: 0, y: 1, z: -4 };
  assert.equal(hasLineOfSight(origin, end, world), false);
  box.x = 5; assert.equal(hasLineOfSight(origin, end, world), true);
  world.obstacles.push({ ...box, id: 'new', x: 0 }); assert.equal(hasLineOfSight(origin, end, world), false);
  const empty = Object.freeze({ ...world, obstacles: [] }), details = { box };
  assert.equal(wallDistance(origin, { x: 0, y: 0, z: -1 }, 10, empty, details), 10); assert.equal(details.box, null);
  assert.equal(hasLineOfSight(origin, origin, empty), true);
});
