const EPS = 1e-7;
export function surfaceBounds(box, padding = 0) {
  if (box.slope) return { type: 'ramp', axis: box.slope.axis, low: box.slope.low, high: box.slope.high, min: (box.slope.axis === 'x' ? box.x - box.w / 2 : box.z - box.d / 2), span: box.slope.axis === 'x' ? box.w : box.d };
  if (box.shape === 'cylinder' || box.shape === 'ring') return { type: box.shape, x: box.x, z: box.z, radius: box.w / 2 + padding, inner: box.shape === 'ring' ? Math.max(0, box.innerRadius - padding) : 0, cut: box.shape === 'ring' ? Math.max(0, (box.cutHalf || 0) - padding) : 0 };
  return null;
}
export function topHeight(box, point) {
  const surface = box.surface;
  return surface?.type === 'ramp' ? surface.low + (surface.high - surface.low) * Math.max(0, Math.min(1, (point[surface.axis] - surface.min) / surface.span)) : box.maxY;
}
export function horizontalOverlap(point, box, epsilon = 0) {
  if (point.x <= box.minX + epsilon || point.x >= box.maxX - epsilon || point.z <= box.minZ + epsilon || point.z >= box.maxZ - epsilon) return false;
  const s = box.surface;
  if (!s || s.type === 'ramp') return true;
  const radius = Math.hypot(point.x - s.x, point.z - s.z);
  if (s.cut && (Math.abs(point.x - s.x) < s.cut - epsilon || Math.abs(point.z - s.z) < s.cut - epsilon)) return false;
  return radius < s.radius - epsilon && (!s.inner || radius > s.inner + epsilon);
}
export function horizontalContact(point, box, axis, delta) {
  const s = box.surface;
  if (!s || s.type === 'ramp') return delta > 0 ? box[axis === 'x' ? 'minX' : 'minZ'] : box[axis === 'x' ? 'maxX' : 'maxZ'];
  const other = axis === 'x' ? 'z' : 'x', offset = point[other] - s[other], previous = point[axis] - delta - s[axis];
  if (s.cut && Math.abs(previous) < s.cut + EPS && Math.abs(offset) >= s.cut) return s[axis] + (delta > 0 ? s.cut : -s.cut);
  const insideHole = s.inner && previous * previous + offset * offset < s.inner * s.inner;
  const radius = insideHole ? s.inner : s.radius, span = Math.sqrt(Math.max(0, radius * radius - offset * offset));
  return s[axis] + (insideHole ? delta > 0 ? span : -span : delta > 0 ? -span : span);
}
function circleInterval(origin, direction, s, radius) {
  const x = origin.x - s.x, z = origin.z - s.z, a = direction.x ** 2 + direction.z ** 2, c = x * x + z * z - radius * radius;
  if (a < EPS) return c <= 0 ? [-Infinity, Infinity] : null;
  const b = x * direction.x + z * direction.z, discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant); return [(-b - root) / a, (-b + root) / a];
}
// Called after the enclosing AABB slab interval has been computed.
export function surfaceRay(origin, direction, box, near, far) {
  const s = box.surface; if (!s) return near;
  if (s.type === 'ramp') {
    const gradient = (s.high - s.low) / s.span, height = s.low + gradient * (origin[s.axis] - s.min);
    const outside = origin.y - height, denominator = direction.y - gradient * direction[s.axis];
    if (Math.abs(denominator) < EPS) return outside <= EPS ? near : null;
    const crossing = -outside / denominator;
    if (denominator < 0) near = Math.max(near, crossing); else far = Math.min(far, crossing);
    return near <= far + EPS ? Math.max(0, near) : null;
  }
  const outer = circleInterval(origin, direction, s, s.radius); if (!outer) return null;
  near = Math.max(near, outer[0]); far = Math.min(far, outer[1]); if (near > far + EPS) return null;
  const holes = s.inner ? [circleInterval(origin, direction, s, s.inner)] : [];
  if (s.cut) for (const axis of ['x', 'z']) {
    const start = origin[axis] - s[axis], speed = direction[axis];
    if (Math.abs(speed) < EPS) { if (Math.abs(start) < s.cut) holes.push([-Infinity, Infinity]); }
    else { const a = (-s.cut - start) / speed, b = (s.cut - start) / speed; holes.push([Math.min(a, b), Math.max(a, b)]); }
  }
  for (let i = 0; i < 4; i++) { const before = near; for (const hole of holes) if (hole && near > hole[0] + EPS && near < hole[1] - EPS) near = hole[1]; if (before === near) break; }
  if (!Number.isFinite(near) || near > far + EPS) return null;
  return Math.max(0, near);
}
export function surfaceNormal(box, point) {
  const s = box?.surface; if (!s) return null;
  if (s.type === 'ramp') {
    if (Math.abs(point.y - topHeight(box, point)) > .003) return null;
    const gradient = (s.high - s.low) / s.span, length = Math.hypot(gradient, 1);
    return { x: s.axis === 'x' ? -gradient / length : 0, y: 1 / length, z: s.axis === 'z' ? -gradient / length : 0 };
  }
  if (Math.abs(point.y - box.maxY) < .003) return { x: 0, y: 1, z: 0 };
  if (Math.abs(point.y - box.minY) < .003) return { x: 0, y: -1, z: 0 };
  if (s.cut) for (const axis of ['x', 'z']) if (Math.abs(Math.abs(point[axis] - s[axis]) - s.cut) < .003) return { x: axis === 'x' ? -Math.sign(point.x - s.x) : 0, y: 0, z: axis === 'z' ? -Math.sign(point.z - s.z) : 0 };
  const x = point.x - s.x, z = point.z - s.z, radius = Math.hypot(x, z);
  if (!radius) return null;
  const inner = s.inner && Math.abs(radius - s.inner) < Math.abs(radius - s.radius), sign = inner ? -1 : 1;
  return { x: sign * x / radius, y: 0, z: sign * z / radius };
}
