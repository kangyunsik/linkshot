export const GAME_TYPES = Object.freeze([
  Object.freeze({ id: 'ffa', name: '개인전', teams: false, objective: false }),
  Object.freeze({ id: 'teams', name: '팀 데스매치', teams: true, objective: false }),
  Object.freeze({ id: 'hardpoint', name: '이동 거점전', teams: true, objective: true }),
  Object.freeze({ id: 'defense', name: '협동 방어전', teams: true, objective: true }),
]);
export const isGameType = (id) => GAME_TYPES.some((type) => type.id === id);
export const normalizeGameType = (id) => isGameType(id) ? id : 'ffa';
export const isTeamGame = (id) => id === 'teams' || id === 'hardpoint' || id === 'defense';
export const isObjectiveGame = (id) => id === 'hardpoint' || id === 'defense';
export const gameTypeName = (id) => GAME_TYPES.find((type) => type.id === id)?.name || '개인전';
export const supportsGameType = (world, type) => (world.gameTypes || ['ffa', 'teams']).includes(type);
export function assertMapGameType(world, type) {
  if (!supportsGameType(world, type)) throw new Error(`${world.name}에서는 ${gameTypeName(type)}을 이용할 수 없습니다. 호환되는 전장을 선택해 주세요.`);
}
