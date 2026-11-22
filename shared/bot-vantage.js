import { RULES, hasLineOfSight, playerPose } from './world.js';
import { canStand, supportHeight } from './movement.js';
import { buildingFloorPath } from './building-navigation.js';

const vantageCache = new WeakMap();
const inset = .79;
const inside = (point, building) => Math.abs(point.x - building.x) < building.w / 2 && Math.abs(point.z - building.z) < building.d / 2;
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function botFirePoint(origin, target, world) {
  const pose = playerPose(target);
  const body = { x: target.x, y: target.y + pose.aimHeight, z: target.z };
  if (hasLineOfSight(origin, body, world)) return body;
  const head = { ...body, y: target.y + pose.headHeight };
  return hasLineOfSight(origin, head, world) ? head : null;
}

export function occupiedBuilding(bot, world) {
  return bot.y >= -.08 && world.buildings?.find(building => building.storeys > 0 && bot.y <= building.height + .14 && inside(bot, building));
}

function floorSites(world, building, floor) {
  if (!vantageCache.has(world)) vantageCache.set(world, new WeakMap());
  const byBuilding = vantageCache.get(world);
  if (!byBuilding.has(building)) byBuilding.set(building, []);
  const floors = byBuilding.get(building);
  if (floors[floor]) return floors[floor];
  const y = floor * building.height / building.storeys, points = [];
  const supported = (point) => supportHeight(point, world, .11) === y && canStand(point, world);
  const add = (x, z, nx, nz) => {
    const point = { x: x - nx * inset, y, z: z - nz * inset };
    if (supported(point)) points.push({ ...point, nx, nz, lookout: { x: point.x + nx * 8, y: y * .68, z: point.z + nz * 8 } });
  };
  if (floor === building.storeys) {
    for (const side of [-1, 1]) for (const offset of [-.27, 0, .27]) {
      add(building.x + side * building.w / 2, building.z + offset * building.d, side, 0);
      add(building.x + offset * building.w, building.z + side * building.d / 2, 0, side);
    }
  } else for (const win of building.windows || []) {
    if (win.floor === floor) add(win.x, win.z, win.axis === 'z' ? win.side : 0, win.axis === 'x' ? win.side : 0);
  }
  return floors[floor] = points;
}

export function watchFromBuilding(bot, building, target, world, now, range, sightPoint) {
  const brain = bot.botBrain;
  if (!building) { brain.vantage = null; return null; }
  if (bot.stairRouteKey && bot.botPath.length || !bot.grounded || target.y >= bot.y - .25 && inside(target, building)) return null;
  const height = building.height / building.storeys, floor = Math.round(bot.y / height), y = floor * height;
  if (Math.abs(y - bot.y) > .14 || floor < 0 || floor > building.storeys) return null;
  const patience = 3400 + (brain.routeSeed || 0) % 1700;
  let state = brain.vantage;
  if (state?.building === building && state.released) return null;
  if (state?.building !== building || state.floor !== floor) {
    state = brain.vantage = { building, floor, until: now + patience, nextProbe: now, site: null, route: [] };
    bot.botPath = []; bot.nextPathAt = 0;
  }
  while (state.route.length && gap(bot, state.route[0]) < .25) state.route.shift();
  const inSight = sightPoint && Math.hypot(sightPoint.x - bot.x, sightPoint.y - bot.y - playerPose(bot).eyeHeight, sightPoint.z - bot.z) < range;
  if (inSight) {
    state.until = now + patience;
    // Walk the last little bit to the selected opening instead of stopping
    // at the first grazing ray past a frame/parapet.
    if (!state.siteClear || !state.route.length || now - state.siteAt > 2500) {
      state.route = [];
      return { look: target, move: null };
    }
  }
  if (now >= state.until) { state.released = true; bot.botPath = []; bot.nextPathAt = 0; return null; }
  if (now >= state.nextProbe) {
    // Stable stagger keeps several top-floor bots from trying a new perch on
    // the same tick. Only the closest useful openings get exact view rays.
    state.nextProbe = now + 560 + (brain.routeSeed || 0) % 145;
    const points = floorSites(world, building, floor);
    const ranked = points.map(site => {
      const dx = target.x - site.x, dz = target.z - site.z, distance = Math.hypot(dx, dz);
      const outward = distance ? (dx * site.nx + dz * site.nz) / distance : 0;
      return { site, distance, weight: gap(bot, site) + 7 * (1 - outward) - (site === state.site ? 2.5 : 0) };
    }).sort((a, b) => a.weight - b.weight).slice(0, 5);
    let fallback = null;
    for (const { site, distance } of ranked) {
      const position = { ...site, y: y + RULES.eyeHeight };
      const clear = distance < range && !!botFirePoint(position, target, world);
      if (fallback && !clear) continue;
      const route = buildingFloorPath(bot, site, building, world); if (!route) continue;
      if (clear) { fallback = { site, route, clear }; break; }
      fallback ??= { site, route };
    }
    if (fallback) {
      if (state.site !== fallback.site) state.siteAt = now;
      state.site = fallback.site; state.route = fallback.route; state.siteClear = !!fallback.clear;
    }
  }
  while (state.route.length && gap(bot, state.route[0]) < .25) state.route.shift();
  return { look: state.site?.lookout || target, move: state.route[0] || null };
}
