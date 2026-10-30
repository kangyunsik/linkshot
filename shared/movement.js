import { RULES, WORLD, bounds, playerPose } from './world.js';
import { DEFAULT_WEAPON, isWeaponId, getWeapon } from './catalog.js';

export const EMPTY_INPUT = Object.freeze({ forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: false, sprint: false, crouch: false, fire: false, reload: false, ads: false, weaponId: DEFAULT_WEAPON });
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const CONTACT_EPSILON = 0.00001;
const overlaps = (player, b) => player.x > b.minX + CONTACT_EPSILON && player.x < b.maxX - CONTACT_EPSILON && player.z > b.minZ + CONTACT_EPSILON && player.z < b.maxZ - CONTACT_EPSILON;
const colliderCache = new WeakMap();
function collidersFor(world) {
  if (!Object.isFrozen(world)) return world.obstacles.map((box) => bounds(box, RULES.playerRadius));
  if (!colliderCache.has(world)) colliderCache.set(world, world.obstacles.map((box) => bounds(box, RULES.playerRadius)));
  return colliderCache.get(world);
}

// All contacts share the full horizontal footprint; a smaller landing radius lets
// feet sink into ledges that the side solver then treats as an overlapping wall.
export function supportHeight(player, world = WORLD, maxDrop = 0.02) {
  let floor = player.y >= -CONTACT_EPSILON && player.y <= maxDrop + CONTACT_EPSILON ? 0 : null;
  for (const b of collidersFor(world)) {
    if (overlaps(player, b) && b.maxY <= player.y + CONTACT_EPSILON && player.y - b.maxY <= maxDrop + CONTACT_EPSILON) floor = Math.max(floor ?? 0, b.maxY);
  }
  return floor;
}

export function sanitizeInput(data, previous = EMPTY_INPUT) {
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    forward: clamp(finite(data.forward), -1, 1), strafe: clamp(finite(data.strafe), -1, 1),
    yaw: finite(data.yaw, previous.yaw) % (Math.PI * 2), pitch: clamp(finite(data.pitch, previous.pitch), -1.48, 1.48),
    jump: data.jump === true, sprint: data.sprint === true, fire: data.fire === true, reload: data.reload === true,
    crouch: data.crouch === true,
    ads: data.ads === true, weaponId: isWeaponId(data.weaponId) ? data.weaponId : previous.weaponId || DEFAULT_WEAPON,
  };
}

export function canStand(player, world = WORLD) {
  return !collidersFor(world).some((b) => {
    return overlaps(player, b) && player.y < b.maxY - CONTACT_EPSILON && player.y + RULES.playerHeight > b.minY + CONTACT_EPSILON;
  });
}

export function movementSpeed(player, input) {
  const weapon = getWeapon(player.weaponId || input.weaponId);
  const sprinting = input.sprint && input.forward > 0 && !input.ads && !player.crouching;
  const base = player.crouching ? RULES.crouchSpeed : sprinting ? RULES.sprintSpeed : RULES.walkSpeed;
  return base * (sprinting ? weapon.sprintMultiplier : weapon.walkMultiplier) * (input.ads ? weapon.adsMoveMultiplier : 1);
}

export function movePlayer(player, input, dt, world = WORLD) {
  dt = clamp(dt, 0, 1 / 30);
  player.yaw = input.yaw;
  player.pitch = input.pitch;
  const startX = player.x, startZ = player.z;
  const forcedCrouch = player.crouching === true && !canStand(player, world);
  const sprintRequested = input.sprint && input.forward > 0 && !input.ads;
  const jumpRequested = input.jump && !player.jumpHeld && player.grounded && !forcedCrouch;
  player.crouching = forcedCrouch || (player.grounded && !sprintRequested && !jumpRequested && input.crouch === true);
  player.sprinting = sprintRequested && !player.crouching;
  const height = playerPose(player).height;
  let forward = input.forward, strafe = input.strafe;
  const length = Math.hypot(forward, strafe);
  if (length > 1) { forward /= length; strafe /= length; }
  const speed = movementSpeed(player, input);
  const vx = (Math.cos(input.yaw) * strafe - Math.sin(input.yaw) * forward) * speed;
  const vz = (-Math.sin(input.yaw) * strafe - Math.cos(input.yaw) * forward) * speed;
  const radius = RULES.playerRadius;
  const colliders = collidersFor(world);
  const intersectsHeight = (b) => player.y < b.maxY - CONTACT_EPSILON && player.y + height > b.minY + CONTACT_EPSILON;
  const tryStep = (b) => {
    const rise = b.maxY - player.y;
    if (!player.grounded || rise <= CONTACT_EPSILON || rise > RULES.stepHeight + CONTACT_EPSILON) return false;
    const blocked = colliders.some((other) => overlaps(player, other) && b.maxY < other.maxY - CONTACT_EPSILON && b.maxY + height > other.minY + CONTACT_EPSILON);
    if (blocked) return false;
    player.y = b.maxY; player.vy = 0; return true;
  };
  // Consume the jump edge before auto-step so jumping at a riser cannot also
  // gain a free stair's height during the same frame.
  if (jumpRequested) {
    player.vy = RULES.jumpSpeed;
    player.grounded = false;
  }
  player.jumpHeld = input.jump;
  // Small collision steps and analytic gravity give 30–144Hz clients the same
  // jump arc as the authoritative 60Hz server/solo worker.
  const steps = Math.max(1, Math.ceil(dt / (1 / 120))), step = dt / steps;
  for (let i = 0; i < steps; i++) {
    for (const [axis, delta, lo, hi] of [['x', vx * step, 'minX', 'maxX'], ['z', vz * step, 'minZ', 'maxZ']]) {
      player[axis] += delta;
      for (const b of colliders) {
        if (!delta || !intersectsHeight(b) || !overlaps(player, b)) continue;
        if (tryStep(b)) continue;
        player[axis] = delta > 0 ? b[lo] : b[hi];
      }
    }
    player.x = clamp(player.x, -world.width / 2 + radius, world.width / 2 - radius);
    player.z = clamp(player.z, -world.depth / 2 + radius, world.depth / 2 - radius);
    if (player.grounded) {
      const floor = supportHeight(player, world, RULES.stepHeight);
      if (floor !== null) { player.y = floor; player.vy = 0; continue; }
      player.grounded = false;
    }
    const previousY = player.y, velocity = player.vy || 0;
    player.y += velocity * step - RULES.gravity * step * step / 2;
    player.vy = velocity - RULES.gravity * step;
    if (player.y > previousY) {
      let ceiling = Infinity;
      for (const b of colliders) {
        if (overlaps(player, b) && previousY + height <= b.minY + CONTACT_EPSILON && player.y + height >= b.minY) ceiling = Math.min(ceiling, b.minY);
      }
      if (ceiling !== Infinity) { player.y = ceiling - height; player.vy = 0; }
    } else {
      let floor = 0;
      for (const b of colliders) {
        if (overlaps(player, b) && previousY >= b.maxY - CONTACT_EPSILON && player.y <= b.maxY) floor = Math.max(floor, b.maxY);
      }
      if (player.y <= floor) { player.y = floor; player.vy = 0; player.grounded = true; }
    }
  }
  player.moveSpeed = dt > 0 ? Math.hypot(player.x - startX, player.z - startZ) / dt : 0;
  return player;
}
