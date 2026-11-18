export const PLAY_MODES = Object.freeze([
  { id: 'casual', name: '일반: 개인전 랭크', transport: 'online', action: '개인전 랭크 매칭', description: '4인 개인전 · 랜덤 전장 · 개인전 랭크 점수' },
  { id: 'ranked', name: '랭크: 팀전 랭크', transport: 'online', action: '팀전 랭크 매칭', description: '3:3 팀전 · 팀 합산 40킬 선승 · 랜덤 전장' },
  { id: 'custom', name: '사용자 대전', transport: 'custom', action: '사용자 방 만들기', description: '개인전 · 팀전 · 이동 거점전 · 협동 방어전' },
  { id: 'lan', name: 'LAN 대전', transport: 'lan', action: 'LAN 방 만들기', description: '로컬 네트워크 · 사용자 방' },
  { id: 'practice', name: '혼자 연습', transport: 'local', action: '연습전 시작', description: '전장 · AI · 교전 규칙 선택' },
  { id: 'tutorial', name: '튜토리얼', transport: 'local', action: '튜토리얼 시작', description: '전용 훈련장에서 직접 배우는 기본 조작 · 서버 불필요 · 전적/LP/실력 점수 미반영' },
]);
export const getPlayMode = (id) => PLAY_MODES.find((mode) => mode.id === id) || PLAY_MODES.find((mode) => mode.id === 'lan');
export const recordsLocalProgress = (room) => ['lan', 'practice'].includes(room?.mode) && !['hardpoint', 'defense'].includes(room?.gameType);
