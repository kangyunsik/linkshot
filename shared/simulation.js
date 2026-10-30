import { RULES, WORLD, getMap, aimDirection, rayBox, raySphere, wallDistance, hasLineOfSight, bounds, playerPose, normalizeRoundOptions, NETWORK_PROTOCOL } from './world.js';
import { EMPTY_INPUT, sanitizeInput, movePlayer, clamp, angleDelta } from './movement.js';
import { WEAPONS, SKINS, getWeapon, getSkin, freshMagazines, damageAtDistance, shotAngles, isWeaponId, normalizeOwnedWeapons, ownsWeapon } from './catalog.js';
import { getOutfit, getCharacter, CHARACTERS } from './outfits.js';
import { roundReward, normalizeWeaponKills, weaponMastery } from './progression.js';

const BOT_NAMES = ['GHOST', 'RIVET', 'ECHO', 'CINDER', 'STATIC', 'ONYX', 'NOVA'];
const botId = () => globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
const nowMs = () => Date.now();
const newRoundId = () => globalThis.crypto?.randomUUID?.() || `round-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
export const cleanName = (name) => typeof name === 'string' ? name.replace(/[\p{C}<>]/gu, '').trim().slice(0, 16) || 'OPERATOR' : 'OPERATOR';

export const BOT_BEHAVIOR = Object.freeze({
  turnRadiansPerSecond: 1.1, pitchRadiansPerSecond: 0.85,
  reactionMinMs: 600, reactionMaxMs: 1000, aimSampleMs: 180,
  aimYawError: 0.035, aimPitchError: 0.025, aimErrorMinMs: 450, aimErrorMaxMs: 750,
  shotSpread: 0.055, shotIntervalMs: 450,
  burstMinShots: 2, burstMaxShots: 3, burstPauseMinMs: 650, burstPauseMaxMs: 1000,
  viewHalfAngle: 1.1, firingAngle: 0.08, firingRange: 42,
});
export const BOT_DIFFICULTIES = Object.freeze([
  Object.freeze({ id: 'beginner', label: '초급', behavior: BOT_BEHAVIOR }),
  Object.freeze({ id: 'intermediate', label: '중급', behavior: Object.freeze({ ...BOT_BEHAVIOR, turnRadiansPerSecond: 2, pitchRadiansPerSecond: 1.5, reactionMinMs: 350, reactionMaxMs: 550, aimSampleMs: 120, aimYawError: 0.022, aimPitchError: 0.016, shotSpread: 0.032, shotIntervalMs: 300, burstMinShots: 3, burstMaxShots: 4, burstPauseMinMs: 450, burstPauseMaxMs: 650, viewHalfAngle: 1.4, firingRange: 55 }) }),
  Object.freeze({ id: 'advanced', label: '고급', behavior: Object.freeze({ ...BOT_BEHAVIOR, turnRadiansPerSecond: 3.6, pitchRadiansPerSecond: 2.8, reactionMinMs: 180, reactionMaxMs: 300, aimSampleMs: 70, aimYawError: 0.012, aimPitchError: 0.008, shotSpread: 0.016, shotIntervalMs: 180, burstMinShots: 4, burstMaxShots: 6, burstPauseMinMs: 260, burstPauseMaxMs: 450, viewHalfAngle: 1.7, firingRange: 65 }) }),
]);
export const getBotDifficulty = (id) => BOT_DIFFICULTIES.find((level) => level.id === id) || BOT_DIFFICULTIES[0];

function freshBotBrain() {
  return { targetId: null, visibleSince: null, reactAt: 0, aimPoint: null, nextAimSampleAt: 0, yawError: 0, pitchError: 0, nextAimErrorAt: 0, burstLeft: 0, nextBurstAt: 0 };
}

export function traceShot(shooter, players, now = nowMs(), world = WORLD, direction = aimDirection(shooter.yaw, shooter.pitch), range = getWeapon(shooter.weaponId).range) {
  const origin = { x: shooter.x, y: shooter.y + playerPose(shooter).eyeHeight, z: shooter.z };
  let distance = wallDistance(origin, direction, range, world);
  let victim = null, headshot = false, protectedTarget = null;
  for (const target of players) {
    if (target.id === shooter.id || target.hp <= 0) continue;
    const pose = playerPose(target);
    const body = rayBox(origin, direction, {
      minX: target.x - RULES.playerRadius, maxX: target.x + RULES.playerRadius, minZ: target.z - RULES.playerRadius, maxZ: target.z + RULES.playerRadius,
      minY: target.y, maxY: target.y + pose.bodyTop,
    }, distance);
    const head = raySphere(origin, direction, { x: target.x, y: target.y + pose.headHeight, z: target.z }, pose.headRadius);
    const hitHead = head !== null && head < distance && (body === null || head <= body);
    const hit = hitHead ? head : body;
    if (hit !== null && hit < distance) { distance = hit; protectedTarget = target.protectedUntil > now ? target.id : null; victim = protectedTarget ? null : target; headshot = !protectedTarget && hitHead; }
  }
  return { victim, headshot, protectedTarget, origin, distance, end: { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance } };
}

const navigation = new WeakMap();
function getNavigation(world) {
  if (navigation.has(world)) return navigation.get(world);
  const width = Math.floor(world.width - 4) + 1, height = Math.floor(world.depth - 4) + 1;
  const minX = -world.width / 2 + 2, minZ = -world.depth / 2 + 2;
  const blockers = world.obstacles.map((box) => bounds(box, RULES.playerRadius + 0.06)).filter((b) => b.minY < RULES.playerHeight && b.maxY > RULES.stepHeight);
  const cells = Array.from({ length: width * height }, (_, i) => { const x = minX + i % width, z = minZ + Math.floor(i / width); return !blockers.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ); });
  const edges = world.obstacles.map((box) => bounds(box, RULES.playerRadius - 0.00001)).filter((b) => b.minY < RULES.playerHeight && b.maxY > RULES.stepHeight);
  const nav = { width, height, minX, minZ, cells, edges }; navigation.set(world, nav); return nav;
}
export function findPath(from, to, world = WORLD) {
  const { width, height, minX, minZ, cells, edges } = getNavigation(world);
  const clearSegment = (a, b) => {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < 0.0001) return true;
    const origin = { x: a.x, y: 0, z: a.z }, direction = { x: (b.x - a.x) / distance, y: 0, z: (b.z - a.z) / distance };
    return !edges.some((box) => rayBox(origin, direction, { ...box, minY: -1, maxY: 1 }, distance) !== null);
  };
  const gridCell = (point) => ({ x: clamp(Math.round(point.x - minX), 0, width - 1), z: clamp(Math.round(point.z - minZ), 0, height - 1) });
  const a = gridCell(from), b = gridCell(to);
  let start = a.z * width + a.x; const end = b.z * width + b.x;
  const startPoint = { x: minX + a.x, z: minZ + a.z };
  if (!cells[start] || !clearSegment(from, startPoint)) {
    const choices = [];
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const x = a.x + dx, z = a.z + dz, index = z * width + x;
      if (x >= 0 && z >= 0 && x < width && z < height && cells[index]) choices.push({ index, x: minX + x, z: minZ + z });
    }
    choices.sort((a, b) => (a.x - from.x) ** 2 + (a.z - from.z) ** 2 - (b.x - from.x) ** 2 - (b.z - from.z) ** 2);
    const reachable = choices.find((point) => clearSegment(from, point)); if (!reachable) return [];
    start = reachable.index;
  }
  const queue = [start], visited = new Map([[start, -1]]);
  let closest = start, best = Infinity;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i], x = current % width, z = Math.floor(current / width);
    const distance = Math.abs(b.x - x) + Math.abs(b.z - z);
    if (distance < best) { best = distance; closest = current; }
    if (current === end) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, next = nz * width + nx;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height || !cells[next] || visited.has(next)) continue;
      visited.set(next, current); queue.push(next);
    }
  }
  const path = [];
  for (let p = closest; p !== start && p !== -1; p = visited.get(p) ?? -1) path.push({ x: minX + p % width, z: minZ + Math.floor(p / width) });
  if (Math.hypot(minX + start % width - from.x, minZ + Math.floor(start / width) - from.z) > 0.2) path.push({ x: minX + start % width, z: minZ + Math.floor(start / width) });
  return path.reverse();
}

export class Room {
  constructor(code, { mode = 'lan', bots = 2, mapId = WORLD.id, botDifficulty = 'beginner', fragLimit, roundSeconds, clock = nowMs, random = Math.random } = {}) {
    this.code = code; this.mode = mode; this.clock = clock; this.random = random;
    this.world = getMap(mapId);
    const difficulty = getBotDifficulty(botDifficulty); this.botDifficulty = difficulty.id; this.botBehavior = difficulty.behavior;
    Object.assign(this, normalizeRoundOptions({ fragLimit, roundSeconds }));
    this.players = new Map(); this.hostId = null; this.events = []; this.phase = 'active';
    this.startedAt = clock(); this.endsAt = this.startedAt + this.roundSeconds * 1000;
    this.roundId = newRoundId(); this.result = null;
    this.lastActivity = this.startedAt;
    this.spawnUses = new Map();
    for (let i = 0; i < clamp(Math.floor(Number(bots) || 0), 0, RULES.maxPlayers - 1); i++) this.addPlayer(`bot-${botId()}`, BOT_NAMES[i], true);
  }

  addPlayer(id, name, isBot = false, loadout = {}) {
    if (this.players.has(id)) throw new Error('이미 이 방에 접속해 있습니다.');
    if (this.players.size >= RULES.maxPlayers) {
      const bot = [...this.players.values()].find((p) => p.isBot);
      if (bot && !isBot) this.players.delete(bot.id);
      else throw new Error('방이 가득 찼습니다.');
    }
    const ownedWeapons = isBot ? WEAPONS.map(({ id }) => id) : normalizeOwnedWeapons(loadout.ownedWeapons);
    const requested = getWeapon(isBot && !isWeaponId(loadout.weaponId) ? WEAPONS[[...this.players.values()].filter((p) => p.isBot).length % WEAPONS.length].id : loadout.weaponId).id;
    const chosenWeapon = ownsWeapon({ ownedWeapons }, requested) ? requested : 'rifle';
    const player = {
      id, name: cleanName(name), isBot, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vy: 0,
      hp: 100, ammo: RULES.magazine, kills: 0, deaths: 0, grounded: true, jumpHeld: false,
      reloadUntil: 0, respawnAt: 0, protectedUntil: 0, lastShot: 0, lastInput: this.clock(),
      input: { ...EMPTY_INPUT }, botPath: [], nextPathAt: 0,
      weaponId: chosenWeapon,
      ownedWeapons, weaponKills: {}, masteryKills: isBot ? {} : normalizeWeaponKills(loadout.weaponKills), killChain: 0, lastKillAt: null,
      nextWeaponId: chosenWeapon, loadoutSelecting: false, diedAt: 0, pendingShot: null, history: [], shotSerial: 0,
      skinId: getSkin(isBot ? SKINS[(this.players.size + 1) % SKINS.length].id : loadout.skinId).id,
      outfitId: getOutfit(loadout.outfitId).id,
      characterId: getCharacter(isBot ? CHARACTERS[this.players.size % CHARACTERS.length].id : loadout.characterId).id,
      magazines: freshMagazines(), switchUntil: 0, nextFireAt: 0, fireLatched: false,
    };
    this.players.set(id, player);
    if (!isBot && !this.hostId) this.hostId = id;
    this.spawn(player);
    this.events.push({ type: 'joined', name: player.name, id, isBot });
    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    this.players.delete(id);
    if (player) this.events.push({ type: 'left', name: player.name, id });
    if (this.hostId === id) this.hostId = [...this.players.values()].find((p) => !p.isBot)?.id || null;
  }

  spawn(player) {
    if (player.isBot && player.spawnCount > 0) player.nextWeaponId = WEAPONS[(WEAPONS.findIndex((weapon) => weapon.id === player.weaponId) + 7) % WEAPONS.length].id;
    player.spawnCount = (player.spawnCount || 0) + 1;
    const requested = getWeapon(player.nextWeaponId || player.weaponId).id;
    player.weaponId = ownsWeapon(player, requested) ? requested : 'rifle'; player.nextWeaponId = player.weaponId;
    const others = [...this.players.values()].filter((p) => p.id !== player.id && p.hp > 0);
    const choices = this.world.spawns.map((point) => {
      const y = point.y || 0, eye = { x: point.x, y: y + RULES.eyeHeight, z: point.z }, chest = { ...eye, y: y + 0.9 };
      const visible = others.filter((p) => { const from = { x: p.x, y: p.y + playerPose(p).eyeHeight, z: p.z }; return hasLineOfSight(from, eye, this.world) || hasLineOfSight(from, chest, this.world); }).length;
      const distance = Math.min(...others.map((p) => Math.hypot(point.x - p.x, point.z - p.z, y - p.y)), Infinity);
      const key = point.spawnId || `${point.x},${y},${point.z}`;
      return { point, key, visible, distance, uses: this.spawnUses.get(key) || 0 };
    });
    let pool = choices.filter((s) => !s.visible && s.distance >= 8);
    if (!pool.length) pool = choices.filter((s) => !s.visible && s.distance >= 3);
    if (!pool.length) { const visible = Math.min(...choices.map((s) => s.visible)); pool = choices.filter((s) => s.visible === visible); }
    if (others.length) { const distance = Math.min(12, Math.max(...pool.map((s) => s.distance)) - 2); pool = pool.filter((s) => s.distance >= distance); }
    const uses = Math.min(...pool.map((s) => s.uses)); pool = pool.filter((s) => s.uses === uses);
    const choice = pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))], spawn = choice.point;
    this.spawnUses.set(choice.key, choice.uses + 1);
    Object.assign(player, { x: spawn.x, y: spawn.y || 0, z: spawn.z, yaw: spawn.yaw, spawnId: spawn.spawnId || null, spawnLevel: spawn.roof ? 'ROOF' : `${spawn.level || 1}F`, pitch: 0, vx: 0, vy: 0, vz: 0, hp: 100, ammo: getWeapon(player.weaponId).magazine, magazines: freshMagazines(), reloadUntil: 0, switchUntil: 0, nextFireAt: 0, fireLatched: false, respawnAt: 0, protectedUntil: this.clock() + RULES.protectionSeconds * 1000, grounded: true, jumpHeld: false, crouching: false, crouchAmount: 0, sprinting: false, moveSpeed: 0, shotHeat: 0, loadoutSelecting: false, diedAt: 0, lastDeath: null, botPath: [], nextPathAt: 0, stairRouteKey: null });
    player.botBrain = player.isBot ? freshBotBrain() : null;
    player.input = { ...EMPTY_INPUT, yaw: player.yaw, weaponId: player.weaponId };
    player.pendingShot = null; player.viewTime = null; player.burstLeft = 0; player.triggerSeq = null; player.triggerShotIndex = 0;
    player.killChain = 0; player.lastKillAt = null;
    player.spawnExitPath = player.isBot ? (spawn.exitPath || []).map((p) => ({ ...p })) : [];
    player.history = []; this.recordPlayerHistory(player, this.clock());
  }

  recordPlayerHistory(player, time) {
    player.history.push({ time, x: player.x, y: player.y, z: player.z, crouching: player.crouching, crouchAmount: player.crouchAmount });
    while (player.history.length > 1 && (player.history[0].time < time - 250 || player.history.length > 32)) player.history.shift();
  }

  playersAt(time) {
    return [...this.players.values()].map((player) => {
      const history = player.history;
      if (!history?.length || time >= history.at(-1).time) return player;
      let before = history[0], after = before;
      for (const sample of history) { if (sample.time <= time) before = sample; else { after = sample; break; } }
      const mix = after.time > before.time ? clamp((time - before.time) / (after.time - before.time), 0, 1) : 0;
      return { id: player.id, hp: player.hp, protectedUntil: player.protectedUntil, x: before.x + (after.x - before.x) * mix, y: before.y + (after.y - before.y) * mix, z: before.z + (after.z - before.z) * mix, crouching: mix < 0.5 ? before.crouching : after.crouching, crouchAmount: (before.crouchAmount ?? (before.crouching ? 1 : 0)) + ((after.crouchAmount ?? (after.crouching ? 1 : 0)) - (before.crouchAmount ?? (before.crouching ? 1 : 0))) * mix };
    });
  }

  setInput(id, input) {
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    // Dead clients keep sending neutral look packets until they see the
    // respawn. Those packets must not overwrite the new spawn's exit-facing
    // yaw (or re-arm an old trigger) during the snapshot delivery window.
    if (input.spawnCount !== undefined && input.spawnCount !== player.spawnCount) return;
    if (player.hp <= 0 || this.phase !== 'active') { player.input = { ...EMPTY_INPUT, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId }; player.pendingShot = null; player.burstLeft = 0; player.fireLatched = false; return; }
    const next = sanitizeInput(input, player.input), now = this.clock();
    player.viewTime = typeof input.viewTime === 'number' && Number.isFinite(input.viewTime) ? clamp(input.viewTime, now - 200, now) : null;
    if (next.fire && !player.input.fire && !player.pendingShot) player.pendingShot = { newTrigger: true, fireSeq: Number.isSafeInteger(input.fireSeq) && input.fireSeq >= 0 ? input.fireSeq : null, yaw: next.yaw, pitch: next.pitch, ads: next.ads, at: now, movement: { grounded: player.grounded, sprinting: player.sprinting || next.sprint && next.forward > 0 && !next.ads && !player.crouching, moveSpeed: Math.max(player.moveSpeed || 0, Math.hypot(next.forward, next.strafe)) }, viewTime: typeof input.viewTime === 'number' && Number.isFinite(input.viewTime) ? clamp(input.viewTime, now - 200, now) : null };
    player.input = next;
    player.lastInput = now;
  }

  switchWeapon(player, weaponId, now = this.clock()) {
    // Kept as a narrow compatibility entry point; never changes a living loadout.
    if (player.hp > 0 || !isWeaponId(weaponId)) return false;
    return this.selectLoadout(player.id, { weaponId, open: false }, now);
  }

  selectLoadout(id, data, now = this.clock()) {
    const player = this.players.get(id);
    if (!player || player.isBot || player.hp > 0 || this.phase !== 'active') return false;
    if (data.weaponId !== undefined && (!isWeaponId(data.weaponId) || !ownsWeapon(player, data.weaponId))) return false;
    if (data.weaponId) player.nextWeaponId = data.weaponId;
    player.loadoutSelecting = data.open === true;
    const death = player.diedAt || Math.max(0, player.respawnAt - RULES.respawnSeconds * 1000);
    player.respawnAt = player.loadoutSelecting ? death + RULES.loadoutSelectSeconds * 1000 : Math.max(death + RULES.respawnSeconds * 1000, now + 350);
    return true;
  }

  restart(id) {
    if (id !== this.hostId) throw new Error('방장만 새 라운드를 시작할 수 있습니다.');
    this.phase = 'active'; this.startedAt = this.clock(); this.endsAt = this.startedAt + this.roundSeconds * 1000;
    this.roundId = newRoundId(); this.result = null;
    this.events = [{ type: 'restart' }];
    this.spawnUses.clear(); for (const player of this.players.values()) player.hp = 0;
    for (const player of this.players.values()) { player.kills = 0; player.deaths = 0; player.weaponKills = {}; this.spawn(player); }
  }

  botInput(bot, now, dt) {
    const behavior = this.botBehavior;
    while (bot.spawnExitPath?.length && Math.hypot(bot.spawnExitPath[0].x - bot.x, bot.spawnExitPath[0].z - bot.z) < 0.25) bot.spawnExitPath.shift();
    if (bot.spawnExitPath?.length) {
      const point = bot.spawnExitPath[0], targetYaw = Math.atan2(-(point.x - bot.x), -(point.z - bot.z));
      const yaw = bot.yaw + clamp(angleDelta(targetYaw, bot.yaw), -dt * behavior.turnRadiansPerSecond, dt * behavior.turnRadiansPerSecond);
      const bearing = angleDelta(targetYaw, yaw);
      return { ...EMPTY_INPUT, weaponId: bot.weaponId, yaw, pitch: bot.pitch + clamp(-bot.pitch, -dt * behavior.pitchRadiansPerSecond, dt * behavior.pitchRadiansPerSecond), forward: Math.cos(bearing) * 0.65, strafe: -Math.sin(bearing) * 0.65 };
    }
    const brain = bot.botBrain ||= freshBotBrain();
    const origin = { x: bot.x, y: bot.y + playerPose(bot).eyeHeight, z: bot.z };
    // Free-for-all: humans and other bots use exactly the same target score.
    const candidates = [...this.players.values()].filter((p) => p.id !== bot.id && p.hp > 0 && p.protectedUntil <= now).map((target) => {
      const distance = Math.hypot(target.x - bot.x, target.z - bot.z);
      const pose = playerPose(target);
      const visible = hasLineOfSight(origin, { x: target.x, y: target.y + pose.aimHeight, z: target.z }, this.world) || hasLineOfSight(origin, { x: target.x, y: target.y + pose.eyeHeight, z: target.z }, this.world);
      return { target, distance, visible, score: distance * (visible ? 0.65 : 1) };
    }).sort((a, b) => a.score - b.score);
    if (!candidates.length) {
      Object.assign(brain, freshBotBrain());
      return { ...EMPTY_INPUT, yaw: bot.yaw, pitch: bot.pitch, weaponId: bot.weaponId };
    }
    const current = candidates.find((candidate) => candidate.target.id === brain.targetId);
    // Keep a reasonable current target instead of flicking between nearby enemies.
    const selected = current && current.score <= candidates[0].score * 1.3 ? current : candidates[0];
    const { target, distance, visible } = selected;
    if (brain.targetId !== target.id) {
      Object.assign(brain, freshBotBrain(), { targetId: target.id });
      bot.botPath = []; bot.nextPathAt = 0; bot.stairRouteKey = null;
    }
    if (now > bot.nextPathAt) {
      const buildings = this.world.buildings || [];
      const own = buildings.find((b) => Math.abs(bot.x - b.x) < b.w / 2 && Math.abs(bot.z - b.z) < b.d / 2);
      const leaving = own && bot.y > 0.2 && (Math.abs(target.x - own.x) >= own.w / 2 || Math.abs(target.z - own.z) >= own.d / 2);
      const up = !leaving && buildings.find((b) => Math.abs(target.x - b.x) < b.w / 2 && Math.abs(target.z - b.z) < b.d / 2 && target.y > bot.y + 0.2);
      const down = leaving ? own : !up && own && bot.y > target.y + 0.2 ? own : null;
      const building = up || down;
      if (building) {
        const destinationY = leaving ? 0 : target.y;
        const key = `${building.id}-${up ? 'up' : 'down'}-${Math.floor((destinationY + 0.15) / 3)}`;
        if (key !== bot.stairRouteKey || !bot.botPath.length) {
          const inside = Math.abs(bot.x - building.x) < building.w / 2 && Math.abs(bot.z - building.z) < building.d / 2;
          const destination = { x: target.x, y: target.y, z: target.z };
          bot.botPath = up ? [...(inside ? [] : findPath(bot, building.entry, this.world)), ...building.route.filter((point) => point.y >= bot.y - 0.15 && point.y <= target.y + 0.15), destination] : [...building.route.slice().reverse().filter((point) => point.y <= bot.y + 0.15 && point.y >= destinationY - 0.15), ...findPath(building.entry, target, this.world), destination];
          bot.stairRouteKey = key;
        }
      } else { bot.stairRouteKey = null; bot.botPath = findPath(bot, target, this.world); }
      bot.nextPathAt = now + 850;
    }
    while (bot.botPath.length && Math.hypot(bot.botPath[0].x - bot.x, bot.botPath[0].z - bot.z) < 0.18 && Math.abs((bot.botPath[0].y ?? bot.y) - bot.y) < 0.16) bot.botPath.shift();
    const waypoint = visible && Math.abs(target.y - bot.y) < 0.2 ? target : bot.botPath[0] || bot;
    const navigationYaw = Math.atan2(-(waypoint.x - bot.x), -(waypoint.z - bot.z));
    const targetYaw = Math.atan2(-(target.x - bot.x), -(target.z - bot.z));
    const perceived = visible && Math.abs(angleDelta(targetYaw, bot.yaw)) <= behavior.viewHalfAngle;
    if (!perceived) {
      brain.visibleSince = null; brain.reactAt = 0; brain.aimPoint = null;
      brain.nextAimSampleAt = 0; brain.burstLeft = 0;
    } else {
      if (brain.visibleSince === null) {
        brain.visibleSince = now;
        brain.reactAt = now + behavior.reactionMinMs + this.random() * (behavior.reactionMaxMs - behavior.reactionMinMs);
      }
      // Delayed observations and body aim make moving/flanking players harder to hit.
      if (now >= brain.nextAimSampleAt) {
        brain.aimPoint = { x: target.x, y: target.y + playerPose(target).aimHeight, z: target.z };
        brain.nextAimSampleAt = now + behavior.aimSampleMs;
      }
      if (now >= brain.nextAimErrorAt) {
        brain.yawError = (this.random() * 2 - 1) * behavior.aimYawError;
        brain.pitchError = (this.random() * 2 - 1) * behavior.aimPitchError;
        brain.nextAimErrorAt = now + behavior.aimErrorMinMs + this.random() * (behavior.aimErrorMaxMs - behavior.aimErrorMinMs);
      }
    }
    const aim = brain.aimPoint;
    const desiredYaw = aim ? Math.atan2(-(aim.x - bot.x), -(aim.z - bot.z)) + brain.yawError : navigationYaw;
    const desiredPitch = aim ? Math.atan2(aim.y - origin.y, Math.max(Math.hypot(aim.x - bot.x, aim.z - bot.z), 0.01)) + brain.pitchError : 0;
    const yaw = bot.yaw + clamp(angleDelta(desiredYaw, bot.yaw), -dt * behavior.turnRadiansPerSecond, dt * behavior.turnRadiansPerSecond);
    const pitch = bot.pitch + clamp(desiredPitch - bot.pitch, -dt * behavior.pitchRadiansPerSecond, dt * behavior.pitchRadiansPerSecond);
    const facing = aim && Math.abs(angleDelta(desiredYaw, yaw)) < behavior.firingAngle && Math.abs(desiredPitch - pitch) < behavior.firingAngle;
    const ready = perceived && facing && now >= brain.reactAt && distance < behavior.firingRange;
    if (ready && brain.burstLeft === 0 && now >= brain.nextBurstAt) {
      brain.burstLeft = behavior.burstMinShots + Math.floor(this.random() * (behavior.burstMaxShots - behavior.burstMinShots + 1));
    }
    const alignedToMove = Math.abs(angleDelta(navigationYaw, yaw)) < behavior.viewHalfAngle;
    const navigating = !visible || Math.abs(target.y - bot.y) >= 0.2, bearing = angleDelta(navigationYaw, yaw);
    const botWeapon = getWeapon(bot.weaponId), preferred = botWeapon.type === 'SNIPER' ? 30 : botWeapon.type === 'SHOTGUN' ? 7 : botWeapon.type === 'SMG' || botWeapon.type === 'SIDEARM' ? 10 : 16;
    return {
      ...EMPTY_INPUT, weaponId: bot.weaponId, yaw, pitch,
      forward: navigating ? Math.cos(bearing) * 0.8 : alignedToMove ? ready && botWeapon.type === 'SNIPER' ? 0 : (distance > preferred + 3 ? 0.65 : distance < preferred - 4 ? -0.4 : 0) : 0,
      strafe: navigating ? -Math.sin(bearing) * 0.8 : perceived && distance < 20 && botWeapon.type !== 'SNIPER' ? Math.sin(now / 1100 + bot.z) * 0.3 : 0,
      ads: ready && distance > 12 && ['ASSAULT', 'SNIPER', 'DMR', 'LMG'].includes(botWeapon.type),
      fire: !!(ready && brain.burstLeft > 0 && now >= brain.nextBurstAt && now >= bot.nextFireAt),
      reload: bot.ammo < 1, sprint: !visible && alignedToMove && distance > 20,
    };
  }

  tick(dt) {
    const now = this.clock();
    if (this.phase !== 'active') return;
    if (now >= this.endsAt) { this.finish(); return; }
    for (const player of this.players.values()) {
      if (player.hp <= 0) { if (now >= player.respawnAt) this.spawn(player); else continue; }
      const input = player.isBot ? this.botInput(player, now, dt) : now - player.lastInput > 500 ? { ...EMPTY_INPUT, yaw: player.yaw, pitch: player.pitch, weaponId: player.weaponId } : player.input;
      movePlayer(player, input, dt, this.world);
      player.shotHeat = Math.max(0, (player.shotHeat || 0) - dt * 1.35);
      const weapon = getWeapon(player.weaponId);
      if (player.reloadUntil && now >= player.reloadUntil) { player.ammo = weapon.magazine; player.reloadUntil = 0; }
      if ((input.reload || (player.ammo === 0 && now >= player.nextFireAt)) && player.ammo < weapon.magazine && !player.reloadUntil && now >= player.switchUntil) {
        player.burstLeft = 0; player.pendingShot = null;
        player.reloadUntil = now + weapon.reloadSeconds * 1000;
        this.events.push({ type: 'reload', id: player.id, weaponId: player.weaponId });
      }
      if (player.pendingShot && now - player.pendingShot.at > 150) player.pendingShot = null;
      const shot = player.pendingShot;
      const triggerReady = (input.fire || shot) && (weapon.automatic || !player.fireLatched || shot);
      if (weapon.burstCount && !player.burstLeft && triggerReady && !player.reloadUntil && player.ammo > 0 && now >= player.nextFireAt) player.burstLeft = weapon.burstCount;
      const ready = weapon.burstCount ? player.burstLeft > 0 : triggerReady;
      if (ready && !player.reloadUntil && player.ammo > 0 && now >= player.nextFireAt) { this.shoot(player, now, shot?.ads ?? input.ads, shot || (!player.isBot && player.viewTime != null ? { viewTime: player.viewTime } : null)); player.pendingShot = null; }
      player.fireLatched = input.fire;
      player.magazines[player.weaponId] = player.ammo;
      if (this.phase !== 'active') break;
    }
    for (const player of this.players.values()) this.recordPlayerHistory(player, now);
  }

  shoot(player, now, ads = false, shot = null) {
    if (!player || player.hp <= 0 || player.ammo <= 0 || this.phase !== 'active' || this.players.get(player.id) !== player) return false;
    const weapon = getWeapon(player.weaponId);
    if (shot?.newTrigger) { player.triggerSeq = shot.fireSeq; player.triggerShotIndex = 0; }
    player.triggerShotIndex++; player.shotSerial++;
    player.ammo--; player.lastShot = now; player.protectedUntil = 0;
    player.magazines[player.weaponId] = player.ammo;
    const withinBurst = weapon.burstCount && player.burstLeft > 1;
    player.nextFireAt = now + Math.max(weapon.fireSeconds * 1000, player.isBot && !withinBurst ? this.botBehavior.shotIntervalMs : 0);
    if (weapon.burstCount) { player.burstLeft = Math.max(0, (player.burstLeft || 0) - 1); if (player.ammo === 0) player.burstLeft = 0; if (!player.burstLeft) player.nextFireAt = Math.max(player.nextFireAt, now + weapon.burstPause * 1000); }
    if (player.isBot && player.botBrain?.burstLeft > 0) {
      player.botBrain.burstLeft--;
      if (player.botBrain.burstLeft === 0) player.botBrain.nextBurstAt = now + this.botBehavior.burstPauseMinMs + this.random() * (this.botBehavior.burstPauseMaxMs - this.botBehavior.burstPauseMinMs);
    }
    const hits = new Map(), rays = [];
    const origin = { x: player.x, y: player.y + playerPose(player).eyeHeight, z: player.z };
    const firingWeapon = player.isBot ? { ...weapon, spread: weapon.spread + this.botBehavior.shotSpread, adsSpread: weapon.adsSpread + this.botBehavior.shotSpread } : weapon;
    const targets = shot?.viewTime != null && !player.isBot ? this.playersAt(clamp(shot.viewTime, now - 200, now)) : [...this.players.values()];
    const firingState = shot?.movement ? { ...player, ...shot.movement, grounded: player.grounded && shot.movement.grounded } : player;
    for (const angle of shotAngles(firingWeapon, ads, this.random, firingState)) {
      const direction = aimDirection((shot?.yaw ?? player.yaw) + angle.yaw, (shot?.pitch ?? player.pitch) + angle.pitch);
      const trace = traceShot(player, targets, now, this.world, direction, weapon.range);
      const { headshot, end, distance, protectedTarget } = trace, victim = trace.victim ? this.players.get(trace.victim.id) : null;
      rays.push({ end, hit: victim?.id || null, headshot, protectedTarget });
      if (!victim || victim.hp <= 0) continue;
      const hit = hits.get(victim.id) || { victim, damage: 0, headshot: false };
      hit.damage += damageAtDistance(weapon, distance, headshot);
      hit.headshot ||= headshot; hits.set(victim.id, hit);
    }
    player.shotHeat = Math.min(1, (player.shotHeat || 0) + (weapon.type === 'ASSAULT' ? 0.25 : 0.17));
    this.events.push({ type: 'shot', shotId: `${this.roundId}-${player.id}-${player.shotSerial}`, spawnCount: player.spawnCount, fireSeq: player.triggerSeq, shotIndex: player.triggerShotIndex, id: player.id, weaponId: weapon.id, origin, rays, end: rays[0].end, hit: rays.find((r) => r.hit)?.hit || null, headshot: rays.some((r) => r.hit && r.headshot) });
    for (const { victim, damage: rawDamage, headshot } of hits.values()) {
      const damage = Math.round(rawDamage);
      victim.hp = Math.max(0, victim.hp - damage);
      this.events.push({ type: 'damage', id: victim.id, attacker: player.id, damage, headshot, origin });
      if (victim.hp <= 0) {
        victim.deaths++; victim.diedAt = now; victim.loadoutSelecting = false; victim.pendingShot = null; victim.burstLeft = 0; victim.respawnAt = now + RULES.respawnSeconds * 1000;
        victim.killChain = 0; victim.lastKillAt = null;
        player.weaponKills[weapon.id] = (player.weaponKills[weapon.id] || 0) + 1;
        player.masteryKills[weapon.id] = Math.min(1_000_000_000, (player.masteryKills[weapon.id] || 0) + 1);
        const mastery = weaponMastery(player.masteryKills[weapon.id]);
        player.killChain = player.lastKillAt !== null && now - player.lastKillAt <= 5000 ? player.killChain + 1 : 1; player.lastKillAt = now;
        victim.lastDeath = { attackerId: player.id, attackerName: player.name, weaponId: weapon.id, weaponLevel: mastery.level, headshot, damage, at: now };
        victim.input = { ...EMPTY_INPUT, yaw: victim.yaw, pitch: victim.pitch, weaponId: victim.weaponId }; player.kills++;
        this.events.push({ type: 'kill', killId: `${this.roundId}-${player.id}-kill-${player.kills}`, at: now, killer: player.name, victim: victim.name, killerId: player.id, victimId: victim.id, weaponId: weapon.id, weaponLevel: mastery.level, weaponKills: mastery.kills, killChain: player.killChain, headshot });
        if (player.kills >= this.fragLimit) this.finish();
      }
    }
    return true;
  }

  finish() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    const winner = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
    const rewards = Object.fromEntries([...this.players.values()].filter((player) => !player.isBot).map((player) => [player.id, { kills: player.kills, deaths: player.deaths, weaponKills: { ...player.weaponKills }, ...roundReward(player.kills, player.id === winner?.id) }]));
    this.result = { roundId: this.roundId, winnerId: winner?.id || null, winnerName: winner?.name || 'OPERATOR', winnerKills: winner?.kills || 0, rewards };
    this.events.push({ type: 'ended', winner: winner?.name || 'OPERATOR', winnerId: winner?.id || null });
  }

  summary() {
    const humans = [...this.players.values()].filter((p) => !p.isBot);
    return { code: this.code, mapId: this.world.id, botDifficulty: this.botDifficulty, fragLimit: this.fragLimit, roundSeconds: this.roundSeconds, name: humans.find((p) => p.id === this.hostId)?.name || 'OPERATOR', players: humans.length, bots: this.players.size - humans.length, capacity: RULES.maxPlayers, phase: this.phase };
  }

  snapshot(flushEvents = true) {
    const now = this.clock();
    const result = {
      type: 'state', serverTime: now,
      room: { protocolVersion: NETWORK_PROTOCOL, code: this.code, roundId: this.roundId, result: this.result, mapId: this.world.id, botDifficulty: this.botDifficulty, mode: this.mode, hostId: this.hostId, phase: this.phase, timeLeft: Math.max(0, Math.ceil((this.endsAt - now) / 1000)), fragLimit: this.fragLimit, roundSeconds: this.roundSeconds },
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: p.yaw, pitch: p.pitch,
        vx: p.vx, vy: p.vy, vz: p.vz, grounded: p.grounded, crouching: p.crouching, crouchAmount: p.crouchAmount, sprinting: p.sprinting, moveSpeed: p.moveSpeed, shotHeat: p.shotHeat, hp: p.hp, ammo: p.ammo, kills: p.kills, deaths: p.deaths, spawnId: p.spawnId, spawnLevel: p.spawnLevel, lastDeath: p.lastDeath,
        reloadUntil: p.reloadUntil, respawnAt: p.respawnAt, protectedUntil: p.protectedUntil,
        weaponId: p.weaponId, nextWeaponId: p.nextWeaponId, loadoutSelecting: p.loadoutSelecting, skinId: p.skinId, outfitId: p.outfitId, characterId: p.characterId, magazines: { ...p.magazines }, switchUntil: p.switchUntil, nextFireAt: p.nextFireAt,
        spawnCount: p.spawnCount, ownedWeapons: [...p.ownedWeapons], weaponKills: { ...p.weaponKills }, masteryKills: { ...p.masteryKills }, weaponLevel: weaponMastery(p.masteryKills[p.weaponId]).level,
      })),
      events: [...this.events],
    };
    if (flushEvents) this.events.length = 0;
    return result;
  }
}
