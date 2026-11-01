export const TEAM_IDS = Object.freeze(['blue', 'red']);
export const TEAM_COLORS = Object.freeze({ blue: '#79baff', red: '#ff817a' });
export const TEAM_NAMES = Object.freeze({ blue: '블루팀', red: '레드팀' });
export const sameTeam = (a, b) => TEAM_IDS.includes(a?.teamId) && a.teamId === b?.teamId;
export const normalizeGameType = (value) => value === 'teams' ? 'teams' : 'ffa';

const zones = new WeakMap();
export function teamSpawnZones(world) {
  if (zones.has(world)) return zones.get(world);
  const axis = world.width >= world.depth ? 'x' : 'z', extent = axis === 'x' ? world.width : world.depth;
  const sorted = [...world.spawns].sort((a, b) => a[axis] - b[axis]);
  const blue = sorted.filter((point) => point[axis] <= -extent * .2), red = sorted.filter((point) => point[axis] >= extent * .2);
  const count = Math.max(1, Math.floor(sorted.length / 3));
  const result = { axis, blue: blue.length ? blue : sorted.slice(0, count), red: red.length ? red : sorted.slice(-count) };
  zones.set(world, result); return result;
}

export function balancedTeam(players, human = true) {
  const roster = [...players];
  return [...TEAM_IDS].sort((a, b) => roster.filter((p) => p.teamId === a).length - roster.filter((p) => p.teamId === b).length || (human ? roster.filter((p) => p.teamId === a && !p.isBot).length - roster.filter((p) => p.teamId === b && !p.isBot).length : 0))[0];
}
