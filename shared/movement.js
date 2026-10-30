import { RULES, WORLD, bounds } from './world.js';
import { DEFAULT_WEAPON, isWeaponId } from './catalog.js';

export const EMPTY_INPUT = Object.freeze({ forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false, fire: false, reload: false, ads: false, weaponId: DEFAULT_WEAPON });
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function sanitizeInput(data, previous = EMPTY_INPUT) {
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    forward: clamp(finite(data.forward), -1, 1), strafe: clamp(finite(data.strafe), -1, 1),
    yaw: finite(data.yaw, previous.yaw) % (Math.PI * 2), pitch: clamp(finite(data.pitch, previous.pitch), -1.48, 1.48),
    jump: data.jump === true, sprint: data.sprint === true, fire: data.fire === true, reload: data.reload === true,
    ads: data.ads === true, weaponId: isWeaponId(data.weaponId) ? data.weaponId : previous.weaponId || DEFAULT_WEAPON,
  };
}

export function movePlayer(player, input, dt, world = WORLD) {
  dt = clamp(dt, 0, 1 / 30);
  player.yaw = input.yaw;
  player.pitch = input.pitch;
  let forward = input.forward, strafe = input.strafe;
  const length = Math.hypot(forward, strafe);
  if (length > 1) { forward /= length; strafe /= length; }
  const speed = input.sprint && forward > 0 && !input.fire ? 9 : 6;
  const dx = (Math.cos(input.yaw) * strafe - Math.sin(input.yaw) * forward) * speed * dt;
  const dz = (-Math.sin(input.yaw) * strafe - Math.cos(input.yaw) * forward) * speed * dt;
  const radius = RULES.playerRadius;
  const intersectsHeight = (b) => player.y + 0.02 < b.maxY && player.y + RULES.playerHeight > b.minY;

  player.x += dx;
  for (const box of world.obstacles) {
    const b = bounds(box, radius);
    if (intersectsHeight(b) && player.x > b.minX && player.x < b.maxX && player.z > b.minZ && player.z < b.maxZ) {
      if (dx > 0) player.x = b.minX;
      else if (dx < 0) player.x = b.maxX;
    }
  }
  player.z += dz;
  for (const box of world.obstacles) {
    const b = bounds(box, radius);
    if (intersectsHeight(b) && player.x > b.minX && player.x < b.maxX && player.z > b.minZ && player.z < b.maxZ) {
      if (dz > 0) player.z = b.minZ;
      else if (dz < 0) player.z = b.maxZ;
    }
  }

  if (input.jump && !player.jumpHeld && player.grounded) {
    player.vy = 6.8;
    player.grounded = false;
  }
  player.jumpHeld = input.jump;
  const previousY = player.y;
  player.vy = (player.vy || 0) - 20 * dt;
  player.y += player.vy * dt;
  player.grounded = false;
  if (player.vy <= 0) {
    let floor = 0;
    for (const box of world.obstacles) {
      const b = bounds(box, radius * 0.7);
      if (player.x > b.minX && player.x < b.maxX && player.z > b.minZ && player.z < b.maxZ && previousY >= b.maxY - 0.02 && player.y <= b.maxY) floor = Math.max(floor, b.maxY);
    }
    if (player.y <= floor) { player.y = floor; player.vy = 0; player.grounded = true; }
  }
  player.x = clamp(player.x, -world.width / 2 + radius, world.width / 2 - radius);
  player.z = clamp(player.z, -world.depth / 2 + radius, world.depth / 2 - radius);
  if (player.y < 0) { player.y = 0; player.vy = 0; player.grounded = true; }
  return player;
}
