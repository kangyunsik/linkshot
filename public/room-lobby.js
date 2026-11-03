import { getMap, RULES } from '/shared/world.js';
import { TEAM_NAMES } from '/shared/teams.js';
import { getWeapon } from '/shared/catalog.js';

const $ = (id) => document.getElementById(id);
const element = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
export class RoomLobbyView {
  constructor(send) {
    this.send = send;
    for (const team of ['blue', 'red']) $(`room-select-${team}`).addEventListener('click', () => send({ type: 'room-team', teamId: team }));
    $('room-lobby-action').addEventListener('click', () => {
      if (!this.state) return; const { room, players } = this.state, self = players.find((p) => p.id === this.id);
      send(room.phase === 'active' ? { type: 'room-enter' } : room.hostId === this.id ? { type: 'room-start' } : { type: 'room-ready', ready: !self?.ready });
    });
  }
  update(state, id) {
    this.state = state; this.id = id;
    const { room, players } = state, self = players.find((p) => p.id === id), host = room.hostId === id, active = room.phase === 'active', teams = room.gameType === 'teams', confirmed = !teams || self?.teamConfirmed === true;
    $('room-lobby-title').textContent = room.name || '출격 대기실'; $('room-lobby-code').textContent = room.code;
    $('room-lobby-meta').textContent = `${getMap(room.mapId).name} · ${room.gameType === 'teams' ? '팀 데스매치' : '개인전'} · ${room.fragLimit}킬 / ${room.roundSeconds / 60}분 · ${players.filter((p) => p.roomStatus === 'playing').length}명 교전 중${room.mode === 'custom' ? ' · 경쟁 점수·전적·LP 미반영' : ''}`;
    $('room-team-choice').hidden = !teams;
    $('room-team-choice-title').textContent = confirmed ? `내 입장 팀: ${TEAM_NAMES[self?.teamId]}` : '1단계 · 입장할 팀을 먼저 선택하세요';
    $('room-team-choice-note').textContent = confirmed ? `${TEAM_NAMES[self.teamId]} 복장을 입고 해당 팀 스폰에서 시작합니다. 아래에서 ${active ? '전장 입장' : host ? '경기 시작' : '준비 완료'}을 눌러 주세요.` : '현재 목록의 팀은 임시 배정입니다. 아래 블루팀 또는 레드팀을 직접 눌러 확정해 주세요.';
    for (const team of ['blue', 'red']) { const selected = confirmed && self?.teamId === team, button = $(`room-select-${team}`); button.setAttribute('aria-pressed', String(selected)); button.disabled = self?.roomStatus !== 'waiting'; button.querySelector('span').textContent = `${selected ? '✓ 선택한 팀' : '이 팀으로 참가'} · ${players.filter((p) => p.teamId === team).length}명 배치`; }
    $('room-lobby-action').textContent = !confirmed ? '입장 팀 선택 필요' : `${teams ? TEAM_NAMES[self.teamId] + ' · ' : ''}${active ? '전장 입장' : host ? '경기 시작' : self?.ready ? '준비 취소' : '준비 완료'}`;
    const unready = players.some((p) => !p.isBot && p.id !== id && !p.ready), emptyTeam = room.gameType === 'teams' && ['blue', 'red'].some((team) => !players.some((p) => p.teamId === team));
    $('room-lobby-action').disabled = !confirmed || !active && host && (unready || emptyTeam);
    $('room-lobby-status').textContent = !confirmed ? '입장 전에 위의 큰 팀 선택 버튼을 눌러 주세요. 방장이 내 팀을 변경한 경우에도 다시 확인해야 합니다.' : active ? '교전은 계속 진행됩니다. 선택한 팀으로 입장하며 기존 참가자의 경기는 초기화하지 않습니다.' : host ? emptyTeam ? '양 팀에 사람 또는 AI를 배치해 주세요.' : unready ? '다른 참가자의 팀 선택·준비 완료를 기다리고 있습니다.' : '준비된 인원으로 경기를 시작할 수 있습니다. 비대칭 AI 팀도 구성할 수 있습니다.' : '팀과 장비를 정한 후 준비 완료를 눌러 주세요. 방장이 경기를 시작합니다.';
    $('lobby-bot-difficulty').parentElement.hidden = !host || active;
    $('room-lobby-result').hidden = !room.result;
    if (room.result) $('room-lobby-result').textContent = `이전 라운드 · ${room.result.winnerName}${room.result.winnerTeam ? ' 승리' : ''}${room.result.rewards?.[id]?.points ? ` · +${room.result.rewards[id].points} LP` : ''}`;
    const signature = JSON.stringify([id, room.hostId, room.phase, room.gameType, players.map((p) => [p.id, p.name, p.teamId, p.teamConfirmed, p.isBot, p.roomStatus, p.ready, p.weaponId, p.botDifficulty])]);
    if (signature === this.signature) return; this.signature = signature;
    const focused = document.activeElement?.dataset.control;
    const root = $('room-lobby-roster'); root.replaceChildren(); root.dataset.teams = String(room.gameType === 'teams');
    const button = (text, control, action) => { const node = element('button', text, 'secondary-button'); node.type = 'button'; node.dataset.control = control; node.addEventListener('click', () => this.send(typeof action === 'function' ? action() : action)); return node; };
    for (const team of room.gameType === 'teams' ? ['blue', 'red'] : [null]) {
      const column = element('section', null, 'roster-team'); if (team) column.dataset.team = team;
      const header = element('header'), roster = players.filter((p) => !team || p.teamId === team);
      header.append(element('strong', team ? `${TEAM_NAMES[team]} / ${roster.length}` : `참가자 / ${roster.length}`));
      column.append(header);
      for (const player of roster) {
        const row = element('div', null, 'roster-slot'); row.dataset.member = player.id; row.dataset.status = player.roomStatus;
        const copy = element('div'), name = element('b', `${player.isBot ? 'AI · ' : ''}${player.name}${player.id === room.hostId ? ' / 방장' : ''}${player.id === id ? ' / 나' : ''}`);
        const status = player.roomStatus === 'playing' ? '교전 중' : teams && !player.teamConfirmed ? '팀 선택 필요 · 임시 배정' : player.ready ? '준비 완료' : '대기 중';
        copy.append(name, element('small', `${status} · ${getWeapon(player.weaponId).name}${player.isBot ? ` · ${player.botDifficulty === 'advanced' ? '고급' : player.botDifficulty === 'intermediate' ? '중급' : '초급'}` : ''}`)); row.append(copy);
        if (host && team && player.roomStatus === 'waiting' && player.id !== id) {
          const select = element('select'); select.setAttribute('aria-label', `${player.name} 팀`); select.dataset.control = `team-${player.id}`;
          for (const value of ['blue', 'red']) { const option = element('option', TEAM_NAMES[value]); option.value = value; select.append(option); } select.value = player.teamId;
          select.addEventListener('change', () => this.send({ type: 'room-team', id: player.id, teamId: select.value })); row.append(select);
        }
        if (host && player.isBot && !active) row.append(button('제거', `remove-${player.id}`, { type: 'room-bot', id: player.id, remove: true }));
        column.append(row);
      }
      for (let i = roster.length; i < Math.max(4, roster.length + 1) && i < RULES.maxPlayers; i++) column.append(element('div', 'EMPTY SLOT / 참가 대기', 'roster-slot empty-slot'));
      if (host && !active) { const add = button('AI 추가', `bot-${team}`, () => ({ type: 'room-bot', teamId: team, difficulty: $('lobby-bot-difficulty').value })); add.setAttribute('aria-label', `${team ? TEAM_NAMES[team] : '개인전'} AI 추가`); add.disabled = players.length >= RULES.maxPlayers; column.append(add); }
      root.append(column);
    }
    if (focused) [...root.querySelectorAll('[data-control]')].find((node) => node.dataset.control === focused)?.focus({ preventScroll: true });
  }
}
