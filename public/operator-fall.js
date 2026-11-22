import { collisionData, nearbyColliders } from '../shared/collision-grid.js';
import { horizontalOverlap, topHeight } from '../shared/terrain.js';
import { wallDistance } from '../shared/world.js';

export const FALL_DURATION_MS = 1120;
const FULL_TILT = Math.PI / 2 + .045;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const ease = (t, from, to) => { const n = clamp((t - from) / (to - from), 0, 1); return n * n * (3 - 2 * n); };

export function fallFloor(data, point, ceiling) {
  let floor = data.groundLevel;
  for (const { raw } of nearbyColliders(data, point)) {
    if (!horizontalOverlap(point, raw)) continue;
    const top = topHeight(raw, point);
    if (top <= ceiling + .055) floor = Math.max(floor, top);
  }
  return floor;
}

function edgeDistance(world, point, back) {
  const x = Math.abs(back.x) < 1e-6 ? Infinity : (Math.sign(back.x) * (world.width / 2 - .10) - point.x) / back.x;
  const z = Math.abs(back.z) < 1e-6 ? Infinity : (Math.sign(back.z) * (world.depth / 2 - .10) - point.z) / back.z;
  return Math.max(0, Math.min(x, z));
}

// Visual only: if there's a wall behind the shoulders, turn and fall along
// the open lane. In a tight corner, slump instead of drawing through cover.
export function planOperatorFall(world, player, attacker) {
  const data = collisionData(world), floor = fallFloor(data, player, player.y);
  const dx = player.x - attacker?.x, dz = player.z - attacker?.z, distance = Math.hypot(dx, dz);
  const impactSide = distance > .05 ? clamp((dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) / distance, -1, 1) : 0;
  const side = impactSide < -.08 ? -1 : 1, bias = clamp(impactSide * .20, -.20, .20);
  let bestTurn = bias, bestClear = 0;
  for (const offset of [bias, side * .57, -side * .57, side * 1.08, -side * 1.08, side * 1.52, -side * 1.52]) {
    const yaw = player.yaw + offset, sin = Math.sin(yaw), cos = Math.cos(yaw), back = { x: sin, y: 0, z: cos };
    let clear = 1.48;
    for (const lane of [-.21, 0, .21]) {
      const origin = { x: player.x + cos * lane, y: floor + .17, z: player.z - sin * lane };
      clear = Math.min(clear, edgeDistance(world, origin, back), wallDistance(origin, back, clear, world));
      origin.y = floor + .47;
      clear = Math.min(clear, wallDistance(origin, back, clear, world));
    }
    if (clear > bestClear) { bestClear = clear; bestTurn = offset; }
    if (clear >= 1.42) break;
  }
  const tilt = bestClear >= 1.08 ? FULL_TILT : Math.asin(clamp((bestClear - .18) / .91, .04, .99));
  const travel = clamp(bestClear - .98, 0, .46);
  const finalYaw = player.yaw + bestTurn;
  const landing = { x: player.x + Math.sin(finalYaw) * travel, z: player.z + Math.cos(finalYaw) * travel };
  return { data, side, turn: bestTurn, tilt, travel, startFloor: floor, floor: fallFloor(data, landing, player.y + .09), ceiling: player.y + .10 };
}

export function operatorFallFrame(age, plan) {
  const t = clamp(age / FALL_DURATION_MS, 0, 1), confined = Math.abs(plan.turn) > .36;
  const flinch = ease(t, 0, .115) * (1 - ease(t, .19, .42));
  const descend = ease(t, .12, .81), settle = ease(t, .57, .98);
  const impact = ease(t, .79, .855) * (1 - ease(t, .855, .98));
  const drop = ease(t, confined ? .24 : .11, .83);
  const initialTilt = Math.min(.10, plan.tilt * .30);
  return {
    done: t >= 1, blend: ease(t, 0, .26),
    twist: plan.turn * ease(t, .02, confined ? .52 : .63),
    pitch: initialTilt * ease(t, 0, .15) + (plan.tilt - initialTilt) * drop - Math.min(.027, plan.tilt * .07) * impact,
    roll: plan.side * (.09 * flinch + .075 * drop),
    motion: plan.travel * ease(t, .13, .93),
    descend, flinch, settle,
    knee: ease(t, .02, .36) * (1 - ease(t, .43, .87)),
    footHold: 1 - ease(t, .34, .69),
    reach: ease(t, .04, .50), loose: ease(t, .01, .17),
    bounce: .021 * impact,
  };
}
