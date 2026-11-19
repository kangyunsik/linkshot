// Static-map broad phase only. Leaves still use the exact box/ramp/ring/cylinder
// intersection supplied by world.js, so windows and thin cover stay physical.
export function createRayIndex(boxes) {
  function build(entries) {
    if (!entries.length) return null;
    const node = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const { box } of entries) {
      node.minX = Math.min(node.minX, box.minX); node.maxX = Math.max(node.maxX, box.maxX);
      node.minY = Math.min(node.minY, box.minY); node.maxY = Math.max(node.maxY, box.maxY);
      node.minZ = Math.min(node.minZ, box.minZ); node.maxZ = Math.max(node.maxZ, box.maxZ);
    }
    if (entries.length <= 6) { node.entries = entries; return node; }
    const x = node.maxX - node.minX >= node.maxZ - node.minZ;
    entries.sort((a, b) => x ? a.box.minX + a.box.maxX - b.box.minX - b.box.maxX : a.box.minZ + a.box.maxZ - b.box.minZ - b.box.maxZ);
    const middle = entries.length >>> 1;
    node.left = build(entries.slice(0, middle)); node.right = build(entries.slice(middle));
    return node;
  }
  return { root: build(boxes.map((box, order) => ({ box, order }))), stack: [] };
}

export function indexedRayDistance(index, origin, direction, maxDistance, intersect, details = null, anyHit = false) {
  let nearest = maxDistance, nearestOrder = -1, size = 0;
  const stack = index.stack;
  if (index.root) stack[size++] = index.root;
  while (size) {
    const node = stack[--size];
    if (intersect(origin, direction, node, nearest) === null) continue;
    if (!node.entries) { stack[size++] = node.left; stack[size++] = node.right; continue; }
    for (const { box, order } of node.entries) {
      const hit = intersect(origin, direction, box, nearest);
      if (hit === null) continue;
      if (anyHit && hit < maxDistance - .01) return hit;
      // The old linear scan chooses the last obstacle on exact ties.
      if (hit < nearest || hit === nearest && order > nearestOrder) {
        nearest = hit; nearestOrder = order;
        if (details) details.box = box;
      }
    }
  }
  return nearest;
}
