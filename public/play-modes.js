export const PLAY_MODES = Object.freeze([
  { id: 'tutorial', name: '튜토리얼', transport: 'local', action: '튜토리얼 시작', description: '전용 훈련장에서 직접 배우는 기본 조작 · 서버 불필요 · 전적/LP/실력 점수 미반영' },
  { id: 'practice', name: '혼자 연습', transport: 'local', action: '연습전 시작', description: '맵·봇 수·난이도를 직접 고르는 브라우저 내부 연습전 · 경쟁 점수 미반영' },
  { id: 'lan', name: 'LAN 대전', transport: 'lan', action: '방 만들고 출격', description: '같은 네트워크의 로컬 서버에서 친구와 교전 · 온라인 경쟁 점수와 분리' },
  { id: 'casual', name: '일반', transport: 'online', action: '일반 매칭', description: '비슷한 일반 레이팅의 사람 우선 · 대기 후 AI 보충 · 랜덤 맵' },
  { id: 'ranked', name: '랭크', transport: 'online', action: '랭크 매칭', description: '실력 기반 4인 개인전 · 랜덤 맵 · 브론즈 → 챌린저' },
  { id: 'custom', name: '사용자 대전', transport: 'custom', action: '사용자 방 만들기', description: 'WAN 온라인 방 만들기·목록·비밀번호 입장 · 개인전/팀전 · 경쟁 점수·LP 미반영' },
]);
export const getPlayMode = (id) => PLAY_MODES.find((mode) => mode.id === id) || PLAY_MODES[2];
export const recordsLocalProgress = (room) => ['lan', 'practice'].includes(room?.mode);
