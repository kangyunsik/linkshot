import { RULES, WORLD, getMap, aimDirection, rayBox, raySphere, wallDistance, hasLineOfSight, bounds } from './world.js';
import { EMPTY_INPUT, sanitizeInput, movePlayer, clamp, angleDelta } from './movement.js';
import { SKINS, getWeapon, getSkin, freshMagazines, damageAtDistance, shotAngles, isWeaponId } from './catalog.js';

const BOT_NAMES = ['GHOST', 'RIVET', 'ECHO', 'CINDER', 'STATIC', 'ONYX', 'NOVA'];
const botId = () => globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
const nowMs = () => Date.now();
export const cleanName = (name) => typeof name === 'string' ? name.replace(/[\p{C}<>]/gu, '').trim().slice(0, 16) || 'OPERATOR' : 'OPERATOR';

export function traceShot(shooter, players, now = nowMs(), world = WORLD, direction = aimDirection(shooter.yaw, shooter.pitch), range = getWeapon(shooter.weaponId).range) {
  const origin = { x: shooter.x, y: shooter.y + RULES.eyeHeight, z: shooter.z };
  let distance = wallDistance(origin, direction, range, world);
  let victim = null, headshot = false;
  for (const target of players) {
    if (target.id === shooter.id || target.hp <= 0 || target.protectedUntil > now) continue;
    const body = rayBox(origin, direction, {
      minX: target.x - 0.34, maxX: target.x + 0.34, minZ: target.z - 0.34, maxZ: target.z + 0.34,
      minY: target.y + 0.2, maxY: target.y + 1.4,
    }, distance);
    const head = raySphere(origin, direction, { x: target.x, y: target.y + 1.58, z: target.z }, 0.25);
    const hitHead = head !== null && head < distance && (body === null || head <= body);
    const hit = hitHead ? head : body;
    if (hit !== null && hit < distance) { distance = hit; victim = target; headshot = hitHead; }
  }
  return { victim, headshot, origin, distance, end: { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance } };
}

function freeCell(x, z, world) {
  return !world.obstacles.some((box) => {
    const b = bounds(box, 0.65);
    return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
  });
}
const navigation = new Map();
function getNavigation(world) {
  if (navigation.has(world.id)) return navigation.get(world.id);
  const width = Math.floor((world.width - 4) / 2) + 1, height = Math.floor((world.depth - 4) / 2) + 1;
  const minX = -world.width / 2 + 2, minZ = -world.depth / 2 + 2;
  const cells = Array.from({ length: width * height }, (_, i) => freeCell(minX + (i % width) * 2, minZ + Math.floor(i / width) * 2, world));
  const nav = { width, height, minX, minZ, cells }; navigation.set(world.id, nav); return nav;
}
export function findPath(from, to, world = WORLD) {
  const { width, height, minX, minZ, cells } = getNavigation(world);
  const gridCell = (point) => ({ x: clamp(Math.round((point.x - minX) / 2), 0, width - 1), z: clamp(Math.round((point.z - minZ) / 2), 0, height - 1) });
  const a = gridCell(from), b = gridCell(to);
  const start = a.z * width + a.x, end = b.z * width + b.x;
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
  for (let p = closest; p !== start && p !== -1; p = visited.get(p) ?? -1) path.push({ x: minX + (p % width) * 2, z: minZ + Math.floor(p / width) * 2 });
  return path.reverse();
}

export class Room {
  constructor(code, { mode = 'lan', bots = 2, mapId = WORLD.id, clock = nowMs } = {}) {
    this.code = code; this.mode = mode; this.clock = clock;
    this.world = getMap(mapId);
    this.players = new Map(); this.hostId = null; this.events = []; this.phase = 'active';
    this.startedAt = clock(); this.endsAt = this.startedAt + RULES.roundSeconds * 1000;
    this.lastActivity = this.startedAt;
    for (let i = 0; i < clamp(Math.floor(Number(bots) || 0), 0, 4); i++) this.addPlayer(`bot-${botId()}`, BOT_NAMES[i], true);
  }

  addPlayer(id, name, isBot = false, loadout = {}) {
    if (this.players.has(id)) throw new Error('이미 이 방에 접속해 있습니다.');
    if (this.players.size >= RULES.maxPlayers) {
      const bot = [...this.players.values()].find((p) => p.isBot);
      if (bot && !isBot) this.players.delete(bot.id);
      else throw new Error('방이 가득 찼습니다.');
    }
    const player = {
      id, name: cleanName(name), isBot, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vy: 0,
      hp: 100, ammo: RULES.magazine, kills: 0, deaths: 0, grounded: true, jumpHeld: false,
      reloadUntil: 0, respawnAt: 0, protectedUntil: 0, lastShot: 0, lastInput: this.clock(),
      input: { ...EMPTY_INPUT }, botPath: [], nextPathAt: 0,
      weaponId: getWeapon(loadout.weaponId).id,
      skinId: getSkin(isBot ? SKINS[(this.players.size + 1) % SKINS.length].id : loadout.skinId).id,
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
    const others = [...this.players.values()].filter((p) => p.id !== player.id && p.hp > 0);
    const spawns = [...this.world.spawns].sort((a, b) => {
      const score = (s) => Math.min(...others.map((p) => Math.hypot(s.x - p.x, s.z - p.z)), 100);
      return score(b) - score(a);
    });
    const spawn = spawns[0];
    Object.assign(player, spawn, { y: 0, pitch: 0, vy: 0, hp: 100, ammo: getWeapon(player.weaponId).magazine, magazines: freshMagazines(), reloadUntil: 0, switchUntil: 0, nextFireAt: 0, fireLatched: false, respawnAt: 0, protectedUntil: this.clock() + RULES.protectionSeconds * 1000, grounded: true, jumpHeld: false, botPath: [], nextPathAt: 0 });
    player.input = { ...EMPTY_INPUT, yaw: player.yaw, weaponId: player.weaponId };
  }

  setInput(id, input) {
    const player = this.players.get(id);
    if (!player || player.isBot) return;
    player.input = sanitizeInput(input, player.input);
    player.lastInput = this.clock();
  }

  switchWeapon(player, weaponId, now = this.clock()) {
    if (!isWeaponId(weaponId) || weaponId === player.weaponId || player.hp <= 0) return;
    player.magazines[player.weaponId] = player.ammo;
    player.weaponId = weaponId; player.ammo = player.magazines[weaponId];
    player.reloadUntil = 0; player.switchUntil = now + RULES.switchSeconds * 1000;
    // A weapon switch never bypasses the previous weapon's firing cooldown.
    player.nextFireAt = Math.max(player.nextFireAt, player.switchUntil);
    this.events.push({ type: 'switch', id: player.id, weaponId });
  }

  restart(id) {
    if (id !== this.hostId) throw new Error('방장만 새 라운드를 시작할 수 있습니다.');
    this.phase = 'active'; this.startedAt = this.clock(); this.endsAt = this.startedAt + RULES.roundSeconds * 1000;
    this.events = [{ type: 'restart' }];
    for (const player of this.players.values()) { player.kills = 0; player.deaths = 0; this.spawn(player); }
  }

  botInput(bot, now, dt) {
    const humans = [...this.players.values()].filter((p) => !p.isBot && p.hp > 0);
    const target = humans.sort((a, b) => Math.hypot(a.x - bot.x, a.z - bot.z) - Math.hypot(b.x - bot.x, b.z - bot.z))[0];
    if (!target) return { ...EMPTY_INPUT, yaw: bot.yaw };
    const origin = { x: bot.x, y: bot.y + RULES.eyeHeight, z: bot.z };
    const aim = { x: target.x, y: target.y + 1.3, z: target.z };
    const distance = Math.hypot(target.x - bot.x, target.z - bot.z);
    const visible = hasLineOfSight(origin, aim, this.world);
    if (now > bot.nextPathAt) { bot.botPath = findPath(bot, target, this.world); bot.nextPathAt = now + 850; }
    while (bot.botPath.length && Math.hypot(bot.botPath[0].x - bot.x, bot.botPath[0].z - bot.z) < 0.7) bot.botPath.shift();
    const waypoint = visible ? target : bot.botPath[0] || bot;
    const desiredYaw = Math.atan2(-(waypoint.x - bot.x), -(waypoint.z - bot.z));
    const yaw = bot.yaw + clamp(angleDelta(desiredYaw, bot.yaw), -dt * 3, dt * 3);
    const pitch = visible ? Math.atan2(aim.y - origin.y, Math.max(distance, 0.01)) + Math.sin(now / 220 + bot.x) * 0.035 : 0;
    const facing = Math.abs(angleDelta(desiredYaw, yaw)) < 0.15;
    return {
      ...EMPTY_INPUT, yaw, pitch, forward: visible ? (distance > 13 ? 0.65 : distance < 6 ? -0.4 : 0) : 0.8,
      strafe: visible && distance < 20 ? Math.sin(now / 1100 + bot.z) * 0.45 : 0,
      fire: visible && facing && distance < 42 && target.protectedUntil < now,
      reload: bot.ammo < 1, sprint: !visible && distance > 20,
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
      this.switchWeapon(player, input.weaponId, now);
      const weapon = getWeapon(player.weaponId);
      if (player.reloadUntil && now >= player.reloadUntil) { player.ammo = weapon.magazine; player.reloadUntil = 0; }
      if ((input.reload || (input.fire && player.ammo === 0)) && player.ammo < weapon.magazine && !player.reloadUntil && now >= player.switchUntil) {
        player.reloadUntil = now + weapon.reloadSeconds * 1000;
        this.events.push({ type: 'reload', id: player.id, weaponId: player.weaponId });
      }
      if (input.fire && (weapon.automatic || !player.fireLatched) && !player.reloadUntil && player.ammo > 0 && now >= player.nextFireAt) this.shoot(player, now, input.ads);
      player.fireLatched = input.fire;
      player.magazines[player.weaponId] = player.ammo;
      if (this.phase !== 'active') break;
    }
  }

  shoot(player, now, ads = false) {
    const weapon = getWeapon(player.weaponId);
    player.ammo--; player.lastShot = now; player.protectedUntil = 0;
    player.magazines[player.weaponId] = player.ammo;
    player.nextFireAt = now + Math.max(weapon.fireSeconds * 1000, player.isBot ? 340 : 0);
    const hits = new Map(), rays = [];
    const origin = { x: player.x, y: player.y + RULES.eyeHeight, z: player.z };
    for (const angle of shotAngles(weapon, ads)) {
      const direction = aimDirection(player.yaw + angle.yaw, player.pitch + angle.pitch);
      const { victim, headshot, end, distance } = traceShot(player, this.players.values(), now, this.world, direction, weapon.range);
      rays.push({ end, hit: victim?.id || null, headshot });
      if (!victim) continue;
      const hit = hits.get(victim.id) || { victim, damage: 0, headshot: false };
      hit.damage += player.isBot ? 15 : damageAtDistance(weapon, distance, headshot);
      hit.headshot ||= headshot; hits.set(victim.id, hit);
    }
    this.events.push({ type: 'shot', id: player.id, weaponId: weapon.id, origin, rays, end: rays[0].end, hit: rays.find((r) => r.hit)?.hit || null, headshot: rays.some((r) => r.hit && r.headshot) });
    for (const { victim, damage: rawDamage, headshot } of hits.values()) {
      const damage = Math.round(rawDamage);
      victim.hp = Math.max(0, victim.hp - damage);
      this.events.push({ type: 'damage', id: victim.id, attacker: player.id, damage, headshot });
      if (victim.hp <= 0) {
        victim.deaths++; victim.respawnAt = now + RULES.respawnSeconds * 1000;
        victim.input = { ...EMPTY_INPUT, yaw: victim.yaw, pitch: victim.pitch, weaponId: victim.weaponId }; player.kills++;
        this.events.push({ type: 'kill', killer: player.name, victim: victim.name, killerId: player.id, victimId: victim.id, weaponId: weapon.id, headshot });
        if (player.kills >= RULES.fragLimit) this.finish();
      }
    }
  }

  finish() {
    this.phase = 'ended';
    const winner = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
    this.events.push({ type: 'ended', winner: winner?.name || 'OPERATOR' });
  }

  summary() {
    const humans = [...this.players.values()].filter((p) => !p.isBot);
    return { code: this.code, mapId: this.world.id, name: humans.find((p) => p.id === this.hostId)?.name || 'OPERATOR', players: humans.length, bots: this.players.size - humans.length, capacity: RULES.maxPlayers, phase: this.phase };
  }

  snapshot(flushEvents = true) {
    const now = this.clock();
    const result = {
      type: 'state', serverTime: now,
      room: { code: this.code, mapId: this.world.id, mode: this.mode, hostId: this.hostId, phase: this.phase, timeLeft: Math.max(0, Math.ceil((this.endsAt - now) / 1000)), fragLimit: RULES.fragLimit },
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: p.yaw, pitch: p.pitch,
        vy: p.vy, grounded: p.grounded, hp: p.hp, ammo: p.ammo, kills: p.kills, deaths: p.deaths,
        reloadUntil: p.reloadUntil, respawnAt: p.respawnAt, protectedUntil: p.protectedUntil,
        weaponId: p.weaponId, skinId: p.skinId, magazines: { ...p.magazines }, switchUntil: p.switchUntil, nextFireAt: p.nextFireAt,
      })),
      events: [...this.events],
    };
    if (flushEvents) this.events.length = 0;
    return result;
  }
}
