import { RULES, WORLD, bounds, playerPose } from '../shared/world.js';
import { supportHeight } from '../shared/movement.js';

export function reconcileMovement(predicted, local, world = WORLD) {
  const error = Math.hypot(local.x - predicted.x, local.z - predicted.z);
  if (error > 3 || Math.abs(local.y - predicted.y) > 2.5) {
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded']) if (key in local) predicted[key] = local[key];
    return;
  }
  if (!predicted.grounded && !local.grounded) {
    for (const key of ['vx', 'vz']) if (Number.isFinite(local[key])) predicted[key] = local[key];
  }
  const next = { ...predicted, x: predicted.x + (local.x - predicted.x) * 0.36, z: predicted.z + (local.z - predicted.z) * 0.36 };
  if (predicted.grounded && local.grounded) {
    const floor = supportHeight({ ...next, y: Math.max(predicted.y, local.y) }, world, RULES.stepHeight + 0.02);
    next.grounded = floor !== null;
    if (next.grounded) { next.y = floor; next.vy = 0; }
  } else if (local.grounded && predicted.vy <= 0 && Math.abs(predicted.y - local.y) < 0.15) {
    const floor = supportHeight({ ...next, y: local.y }, world);
    if (floor !== null) { next.y = floor; next.vy = 0; next.grounded = true; }
  }
  // Never blend a valid position down into a stair/ledge. During flight, keep
  // the predicted jump arc instead of damping it toward delayed ground snapshots.
  const height = playerPose(next).height;
  const blocked = world.obstacles.some((box) => {
    const b = bounds(box, RULES.playerRadius - 0.00001);
    return next.x > b.minX && next.x < b.maxX && next.z > b.minZ && next.z < b.maxZ && next.y < b.maxY - 0.00001 && next.y + height > b.minY + 0.00001;
  });
  if (!blocked) for (const key of ['x', 'y', 'z', 'vy', 'grounded']) predicted[key] = next[key];
}
