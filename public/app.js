import { FPSGame } from './game.js';
import { GameAudio } from './audio.js';
import { drawTacticalMap } from './map.js';
import { MAPS, getMap, RULES, normalizeRoundOptions, NETWORK_PROTOCOL } from '/shared/world.js';
import { WEAPONS, SKINS, getWeapon, getSkin, ownsWeapon } from '/shared/catalog.js';
import { ArmoryPreview } from './weapon-model.js';
import { SoloConnection } from './solo-connection.js';
import * as runtime from './runtime-config.js';
import { OnlineApi } from './online-api.js';
import { OnlineConnection } from './online-connection.js';
import { CustomConnection } from './custom-connection.js';
import { MatchIntro } from './match-intro.js';
import { DialogMotion } from './dialog-motion.js';
import { RoomLobbyView } from './room-lobby.js';
import { SnapshotOrder } from './snapshot-order.js';
import { rankPresentation, renderRankView, PLACEMENT_MATCHES } from './rank-view.js';
import { rankResult } from './rank-result.js';
import { RankedResults } from './ranked-results.js';
import { MatchOfferTimer } from './match-offer-timer.js';
import { ladderKey, ladderProfile, ladderName } from './competitive-stats.js';
import { CompetitiveDashboard } from './competitive-dashboard.js';
import { ProfileStore, PROFILE_KEY } from './profile.js';
import { profileStats, POINT_RULES, weaponMastery, suppressorUnlocked, SUPPRESSOR_LEVEL, SUPPRESSOR_KILLS } from '/shared/progression.js';
import { OUTFITS, getOutfit, CHARACTERS, getCharacter } from '/shared/outfits.js';
import { OperatorPreview } from './operator-model.js';
import { BOT_DIFFICULTIES, getBotDifficulty } from '/shared/simulation.js';
import { PLAY_MODES, getPlayMode, recordsLocalProgress } from './play-modes.js';
import { TRAINING_WORLD } from '/shared/training-world.js';
import { normalizeQuality } from './performance.js';
import { normalizeGameType, isTeamGame, gameTypeName, supportsGameType } from '/shared/game-types.js';
import { objectiveOptions } from '/shared/objectives.js';
import { normalizeWeaponHand } from './viewmodel-renderer.js';

const $ = (id) => document.getElementById(id);
const { APP_MODE, PROFILE_STORAGE, ONLINE_SERVER_URL = '', FRONTEND_URL = '', LAN_PLAY_PATH = '/play' } = runtime;
const defaults = { sensitivity: 1, fov: 82, volume: 65, quality: 'normal', weaponHand: 'right', killfeedOpacity: 100, killAnnouncementOpacity: 100 };
// Retain prototype storage keys so existing names, settings and loadouts survive the LINKSHOT rename.
function stored(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } }
let saved = {};
try { saved = JSON.parse(stored('sector07-settings', '{}')) || {}; } catch { /* Use safe defaults. */ }
const inRange = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const settings = {
  sensitivity: inRange(saved.sensitivity, 0.3, 2.5, defaults.sensitivity),
  fov: inRange(saved.fov, 65, 105, defaults.fov), volume: inRange(saved.volume, 0, 100, defaults.volume),
  quality: normalizeQuality(saved.quality),
  weaponHand: normalizeWeaponHand(saved.weaponHand),
  killfeedOpacity: inRange(saved.killfeedOpacity, 0, 100, defaults.killfeedOpacity),
  killAnnouncementOpacity: inRange(saved.killAnnouncementOpacity, 0, 100, defaults.killAnnouncementOpacity),
};
const SOLO = APP_MODE === 'solo';
let savedLoadout = {}; try { savedLoadout = JSON.parse(stored('sector07-loadout', '{}')) || {}; } catch { /* Use catalog defaults. */ }
const loadout = { mapId: getMap(savedLoadout.mapId).id, weaponId: getWeapon(savedLoadout.weaponId).id, skinId: getSkin(savedLoadout.skinId).id };
let preview = null, lobbyPreview = null, roomSession = null;
const dialogs = new DialogMotion();
const dashboard = new CompetitiveDashboard();
const rankedResults = new RankedResults();
const matchOfferTimer = new MatchOfferTimer();
const roomLobby = new RoomLobbyView((data) => send(data));
let operatorPreview = null, selectedOutfitId = 'field', purchaseRequestId = null, shopBusy = false;
let selfSessionId = null, lastRoundReward = null;
let tutorialCompletedRound = null;
const profileStore = await new ProfileStore({ host: PROFILE_STORAGE === 'host', name: stored('sector07-name', `OP-${Math.floor(100 + Math.random() * 900)}`) }).load();
if (!ownsWeapon(profileStore.profile, loadout.weaponId)) loadout.weaponId = 'rifle';
let selectedWeaponId = loadout.weaponId;
selectedOutfitId = profileStore.profile.equippedOutfitId;
const audio = new GameAudio(settings);
audio.muted = stored('sector07-muted', 'false') === 'true';
let socket, game = null, connected = false, mode = SOLO ? 'practice' : 'lan', transportKind = SOLO ? 'local' : 'lan', botCount = 2, rooms = [], lanUrl = location.origin;
let onlineApi = null, onlineUser = null, onlineAvailable = false, onlineBusy = false, onlineReason = '';
let onlineCapabilities = { matchmaking: false }, onlineQueueState = null, onlineAutoJoin = false, onlinePolling = false, onlineQueueTimer = null, onlineHeartbeatAt = 0, onlineSelectedWeapon = getWeapon(stored('linkshot-online-weapon', 'rifle')).id;
let onlineReceipt = null, onlineResultPending = null, onlineResultNextAt = 0, onlineActiveMatch = null, onlineReconnectUntil = 0;
let onlineServicePolling = false, onlineAuthGeneration = 0;
let lobbyResultMatchId = null;
let dashboardLadder = stored('linkshot-dashboard-ladder', 'teams') === 'ffa' ? 'ffa' : 'teams';
let pendingOnlineSuppressor = null;
let usernameCheckGeneration = 0, usernameChecking = false;
let authView = 'login', equipmentAccount = null;
let pendingJoinCode = null, onlineEntering = false;
let lastOfferedMatch = null;
let onlineQueueRevision = 0;
const matchIntro = new MatchIntro(() => { const previous = socket; socket = null; previous?.close(); onlineReconnectUntil = 0; clearTimeout(reconnectTimeout); leaveGame(false); matchIntro.hide(); });
const onlineResultSummary = document.createElement('p'); onlineResultSummary.id = 'online-rating-summary'; onlineResultSummary.hidden = true; $('round-reward').append(onlineResultSummary);
function suppressorControl(id, labelText, parent, before = null) {
  const root = document.createElement('div'); root.className = 'suppressor-control';
  const label = document.createElement('label'); label.className = 'suppressor-option'; const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.setAttribute('aria-label', labelText);
  const text = document.createElement('span'); text.textContent = '소음기 장착'; label.append(input, text); const note = document.createElement('small'); note.id = `${id}-note`; root.append(label, note); parent.insertBefore(root, before); return { input, note };
}
const localSuppressor = suppressorControl('armory-suppressor', '기기 소음기 장착', $('armory-unlock').parentElement, $('armory-unlock'));
const selectedSuppressor = (profile, weaponId) => suppressorUnlocked(profile?.weaponKills, weaponId) && !!profile?.suppressedWeapons?.includes(weaponId);
if (ONLINE_SERVER_URL) { try { onlineApi = new OnlineApi(ONLINE_SERVER_URL, FRONTEND_URL); } catch (error) { onlineReason = error.message; } }
let botDifficulty = getBotDifficulty(stored('linkshot-bot-difficulty', 'beginner')).id;
let savedRound = {}; try { savedRound = JSON.parse(stored('linkshot-round-options', '{}')) || {}; } catch { /* Defaults. */ }
let roundOptions = normalizeRoundOptions(savedRound);
let savedObjective = {}; try { savedObjective = JSON.parse(stored('linkshot-objective-options', '{}')) || {}; } catch { /* Defaults. */ }
let objectiveConfig = objectiveOptions(savedObjective);
$('room-game-type').value = normalizeGameType(stored('linkshot-game-type', 'ffa'));
function selectedGameType() { return ['practice', 'lan', 'custom'].includes(mode) ? normalizeGameType($('room-game-type').value) : 'ffa'; }
function updateRoundOptions() {
  const type = selectedGameType(), label = type === 'hardpoint' ? '목표 점수' : type === 'defense' ? '방어 공세 수' : type === 'teams' ? '팀 합산 목표 킬' : '목표 킬 수', input = $('frag-limit');
  document.querySelector('label[for="frag-limit"]').firstChild.textContent = label; input.setAttribute('aria-label', ['ffa', 'teams'].includes(type) ? '목표 킬 수' : label);
  input.min = type === 'hardpoint' ? 30 : 1; if (type === 'defense') input.removeAttribute('max'); else input.max = 200;
  input.value = type === 'hardpoint' ? objectiveConfig.scoreLimit : type === 'defense' ? objectiveConfig.waves : roundOptions.fragLimit; $('round-minutes').value = roundOptions.roundSeconds / 60;
}
function saveRoundForm() {
  const type = selectedGameType(), value = Number($('frag-limit').value);
  roundOptions = normalizeRoundOptions({ ...roundOptions, ...(!['hardpoint', 'defense'].includes(type) ? { fragLimit: value } : {}), roundSeconds: Math.max(1, Number($('round-minutes').value) || 5) * 60 });
  objectiveConfig = objectiveOptions({ ...objectiveConfig, ...(type === 'hardpoint' ? { scoreLimit: value } : type === 'defense' ? { waves: value } : {}) });
  store('linkshot-round-options', JSON.stringify(roundOptions)); store('linkshot-objective-options', JSON.stringify(objectiveConfig)); updateRoundOptions();
}
for (const id of ['frag-limit', 'round-minutes']) $(id).addEventListener('change', saveRoundForm);
updateRoundOptions();
for (const level of BOT_DIFFICULTIES) { const option = document.createElement('option'); option.value = level.id; option.textContent = level.label; $('bot-difficulty').append(option); }
$('bot-difficulty').value = botDifficulty;
$('bot-difficulty').addEventListener('change', () => { botDifficulty = getBotDifficulty($('bot-difficulty').value).id; store('linkshot-bot-difficulty', botDifficulty); });
let busy = false, requestTimeout, reconnectTimeout, reconnectDelay = 1000, hasDeployed = false;
let invitedCode = new URL(location.href).searchParams.get('room')?.toUpperCase();
if (!/^[A-Z2-9]{5}$/.test(invitedCode || '')) invitedCode = null;
if (SOLO) invitedCode = null;
let invitedCustomCode = new URL(location.href).searchParams.get('custom')?.toUpperCase();
if (!/^[A-Z2-9]{5}$/.test(invitedCustomCode || '')) invitedCustomCode = null;
if (invitedCustomCode) mode = 'custom';

$('player-name').value = profileStore.profile.callsign;
if (invitedCode) $('room-code').value = invitedCode;

function toast(message, error = false) {
  const element = document.createElement('div'); element.className = `toast${error ? ' error' : ''}`; element.textContent = message;
  $('toast-container').append(element);
  while ($('toast-container').children.length > 3) $('toast-container').firstChild.remove();
  setTimeout(() => element.remove(), error ? 6500 : 3500);
}

function send(data) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(data)); return true;
}

function setBusy(value) {
  busy = value; $('loading-overlay').hidden = !value;
  updateDeployButton();
  $('join-form').querySelector('button').disabled = value || !connected;
  $('room-create-confirm').disabled = value; $('room-password-form').querySelector('button[type="submit"]').disabled = value;
  clearTimeout(requestTimeout);
  if (value) { $('loading-overlay').querySelector('h2').textContent = '전장에 연결하는 중'; $('loading-overlay').querySelector('.eyebrow').textContent = 'ESTABLISHING CONNECTION'; }
  if (value) requestTimeout = setTimeout(() => {
    if (!busy) return;
    send({ type: 'leave' }); setBusy(false); toast('연결 시간이 초과되었습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.', true);
  }, 12_000);
}

function updateConnection(value) {
  connected = value;
  const serviceReady = value || ['online', 'custom'].includes(transportKind) && onlineAvailable;
  $('connection-status').classList.toggle('offline', !serviceReady);
  $('connection-status').lastElementChild.textContent = value ? transportKind === 'local' ? 'SOLO READY · LOCAL SIMULATION' : transportKind === 'custom' ? 'CUSTOM ROOMS CONNECTED' : transportKind === 'online' ? 'ONLINE BATTLE CONNECTED' : 'LAN SERVER ONLINE' : ['online', 'custom'].includes(transportKind) ? onlineAvailable ? 'ONLINE SERVICES READY' : onlineApi ? 'ONLINE SERVER OFFLINE' : 'ONLINE SERVER NOT CONFIGURED' : transportKind === 'local' ? '시뮬레이션 준비 중' : SOLO ? 'LAN 서버 페이지로 접속하세요' : '서버 연결 대기 중';
  document.querySelector('.connection-dot').style.background = serviceReady ? '#a3dbc9' : '#ff6249';
  updateDeployButton();
  $('join-form').querySelector('button').disabled = !value || busy;
  $('room-browser-button').disabled = busy || (mode === 'custom' && !onlineUser ? !onlineAvailable : !value);
  renderModeBrief();
}

function renderModeBrief() {
  const selected = getPlayMode(mode);
  $('mode-info-title').textContent = `${selected.name} · 모드 안내`; $('mode-info-description').textContent = selected.description;
  $('mode-service-status').textContent = usesOnlineServices() ? !onlineAvailable ? '온라인 연결 안내' : onlineUser ? '온라인 준비' : '로그인 안내' : mode === 'lan' ? connected ? 'LAN 준비' : 'LAN 연결 안내' : '로컬 실행 · 안내';
}

function isOnlineRoom(room = game?.room) { return ['casual', 'ranked'].includes(room?.mode); }
function usesOnlineServices(value = mode) { return ['online', 'custom'].includes(getPlayMode(value).transport); }
function equipmentProfile() {
  if (!onlineUser) return profileStore.profile;
  return { ...onlineUser, equippedOutfitId: onlineUser.outfitId || 'field', ownedOutfits: onlineUser.ownedOutfits || [...new Set(['field', onlineUser.outfitId || 'field'])] };
}
function rememberAccountWeapon() { if (onlineUser) store(`linkshot-account-weapon-${onlineUser.id}`, onlineSelectedWeapon); }
function updateDeployButton() {
  const online = getPlayMode(mode).transport === 'online', ready = onlineQueueState?.state === 'READY', blocked = ['QUEUED', 'OFFERED', 'ACCEPTED', 'ASSIGNED', 'ABANDONED'].includes(onlineQueueState?.state);
  $('create-button').disabled = busy || (online ? onlineBusy || !onlineApi || !onlineAvailable || !!onlineUser && (blocked || !ready && !onlineCapabilities.matchmaking) : !connected);
  if (mode === 'custom') $('create-button').disabled = busy || onlineBusy || !onlineApi || !onlineAvailable || !!onlineUser && (!onlineCapabilities.customRooms || !connected);
  if (online) $('create-button').querySelector('span').textContent = ready ? '배정된 경기 입장' : blocked ? '매칭 대기 중…' : getPlayMode(mode).action;
}

function updateRooms(list) {
  rooms = list;
  const players = rooms.reduce((sum, room) => sum + room.players, 0);
  $('room-summary').textContent = transportKind === 'local' ? `${MAPS.length}개 전장 · ${WEAPONS.length}종 무기` : transportKind === 'online' ? '개인전 랭크 · 팀전 랭크' : connected ? `${rooms.length}개의 방 · ${players}명` : '연결 대기';
  const container = $('room-list'); container.replaceChildren();
  if (!rooms.length) {
    const empty = document.createElement('div'); empty.className = 'empty-rooms';
    const title = document.createElement('strong'); title.textContent = '아직 열린 방이 없습니다';
    const subtitle = document.createElement('span'); subtitle.textContent = '방을 만들고 친구를 첫 교전에 초대하세요.';
    empty.append(title, subtitle); container.append(empty); return;
  }
  for (const room of rooms) {
    const row = document.createElement('div'); row.className = 'room-row';
    const details = document.createElement('div'); details.className = 'room-details';
    const code = document.createElement('strong'); code.textContent = room.code;
    const name = document.createElement('small'); name.textContent = `${room.passwordProtected ? '🔒 비밀번호 · ' : ''}${getMap(room.mapId).name} · ${room.name} · ${gameTypeName(room.gameType)} · AI ${room.bots}명 · ${room.gameType === 'hardpoint' ? `${room.scoreLimit}점` : room.gameType === 'defense' ? `${room.waves}공세` : `${room.fragLimit || RULES.fragLimit}킬`}/${Math.round((room.roundSeconds || RULES.roundSeconds) / 60)}분 · ${room.phase === 'ended' ? '라운드 종료' : room.phase === 'lobby' ? '대기 중' : `교전 중 ${room.playing ?? room.players}명`}`;
    details.append(code, name);
    const count = document.createElement('span'); count.textContent = `${room.players}/${room.capacity}`;
    const button = document.createElement('button'); button.textContent = '참가'; button.disabled = room.players >= room.capacity;
    button.addEventListener('click', () => { if (room.passwordProtected) askRoomPassword(room.code); else requestJoin(room.code); });
    row.append(details, count, button); container.append(row);
  }
}

function updateServerInfo(data) {
  if (transportKind !== 'lan') { updateRooms([]); return; }
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  lanUrl = isLocalhost ? data.urls?.[0] || location.origin : location.origin;
  $('lan-address').textContent = lanUrl.replace(/^https?:\/\//, '');
  $('copy-lan').title = `${lanUrl} 복사`;
  updateRooms(data.rooms || rooms);
}

function connect(kind = getPlayMode(mode).transport) {
  clearTimeout(reconnectTimeout);
  const previous = socket; socket = null; previous?.close(); selfSessionId = null; transportKind = kind;
  updateConnection(false); updateRooms([]);
  if (kind === 'online' || kind === 'custom' && (!onlineUser || !onlineApi || !onlineCapabilities.customRooms) || kind === 'lan' && SOLO) return;
  const url = new URL(kind === 'lan' && LAN_PLAY_PATH === '/lan/play' ? '/lan/play' : '/play', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const connection = kind === 'custom' ? new CustomConnection(onlineApi) : kind === 'local' ? new SoloConnection() : new WebSocket(url); socket = connection;
  bindConnection(connection, kind);
}
function bindConnection(connection, kind) {
  const snapshots = new SnapshotOrder();
  const expectedOnlineAccount = ['online', 'custom'].includes(kind) ? onlineUser?.id : null;
  connection.addEventListener('message', (event) => {
    if (socket !== connection) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (!data || typeof data !== 'object') return;
    if (['joined', 'state'].includes(data.type) && data.room?.protocolVersion !== NETWORK_PROTOCOL) { send({ type: 'leave' }); setBusy(false); toast('서버를 재시작하고 페이지를 새로고침해 주세요. 전투 버전이 일치하지 않습니다.', true); connection.close(4001, 'Protocol mismatch'); return; }
    if (data.type === 'joined' && (!selfSessionId || snapshots.code !== data.room?.code)) snapshots.reset();
    if (['joined', 'state'].includes(data.type) && !snapshots.accept(data)) return;
    if (kind === 'online' && ['joined', 'state'].includes(data.type) && (!isOnlineRoom(data.room) || data.online?.matchId !== connection.matchId || !Array.isArray(data.players) || !data.players.some((player) => player?.id === expectedOnlineAccount) || data.type === 'joined' && data.id !== expectedOnlineAccount)) { connection.close(); setBusy(false); toast('온라인 경기 배정 정보가 일치하지 않습니다.', true); return; }
    if (kind === 'custom' && ['joined', 'state'].includes(data.type) && (data.room?.mode !== 'custom' || !data.players?.some((player) => player.id === expectedOnlineAccount) || data.type === 'joined' && data.id !== expectedOnlineAccount)) { connection.close(); setBusy(false); toast('사용자 대전 계정 정보를 확인하세요.', true); return; }
    if (data.type === 'hello') {
      reconnectDelay = 1000; updateConnection(true); if (kind === 'custom') updateRooms(data.rooms || []); else updateServerInfo(data); send({ type: 'ping', sent: Date.now() });
      if (kind === 'lan') { connection.rankBadgeEngineId = data.rankBadgeEngineId; void authenticateLanRank(); }
      if (kind === 'lan' && invitedCode) { const code = invitedCode; invitedCode = null; requestJoin(code); }
      if (kind === 'custom' && invitedCustomCode) { const code = invitedCustomCode; invitedCustomCode = null; const room = data.rooms?.find((item) => item.code === code); if (room?.passwordProtected) askRoomPassword(code); else requestJoin(code); }
    }
    if (data.type === 'rooms') updateRooms(data.rooms);
    if (data.type === 'rank-profile' && data.verified === false) connection.rankBadgeKey = null;
    if (data.type === 'pong') {
      const latency = Math.max(1, Date.now() - data.sent);
      $('hud-ping').textContent = `${latency} MS`;
      $('connection-status').title = kind === 'local' ? `브라우저 시뮬레이션 응답: ${latency}ms` : `서버 왕복 지연: ${latency}ms`;
    }
    if (data.type === 'joined') { clearTimeout(requestTimeout); pendingJoinCode = null; $('room-join-password').value = ''; dialogs.closeAll(); selfSessionId = data.id; if (kind === 'online') { onlineActiveMatch = data.online?.matchId; onlineReconnectUntil = 0; } syncProgress(data); if (data.room.staging) handleRoomSession(data); else enterGame(data); }
    if (data.type === 'state') { syncProgress(data); if (data.room?.staging) handleRoomSession(data); else { game?.applySnapshot(data); handleTutorialState(data); handleOnlineState(data); } }
    if (data.type === 'left') { if (game || roomSession) leaveGame(false); selfSessionId = null; }
    if (data.type === 'error') { setBusy(false); if (data.code === 'ROOM_PASSWORD' && pendingJoinCode) { askRoomPassword(pendingJoinCode); $('room-password-error').textContent = data.message; } else { if (roomSession) $('room-lobby-status').textContent = data.message; toast(data.message, true); } }
  });
  connection.addEventListener('close', (event) => {
    if (socket !== connection) return;
    const wasPlaying = !!game || !!roomSession, phase = game?.room?.phase, ended = phase === 'ended';
    updateConnection(false); setBusy(false); updateRooms([]);
    if (kind === 'online') {
      matchIntro.hide(); onlineEntering = false;
      if (wasPlaying && !ended) { leaveGame(false); toast(phase === 'active' ? '온라인 전투 연결이 끊겼습니다. 30초 안에는 같은 생명·탄약으로 재접속할 수 있습니다.' : '경기 준비 연결이 끊겼습니다. 복구 후에는 공통 시작 시각의 남은 준비 시간을 표시합니다.', true); }
      selfSessionId = null; void refreshOnlineQueue();
      if (!ended && ![1000, 1008].includes(event.code) && (wasPlaying || onlineReconnectUntil > Date.now())) { onlineReconnectUntil ||= Date.now() + 30_000; reconnectTimeout = setTimeout(tryOnlineReconnect, 1000); }
      return;
    }
    if (kind === 'custom') {
      if (wasPlaying) { leaveGame(false); toast('사용자 대전 연결이 끊겼습니다. 방 목록에서 다시 참가해 주세요.', true); }
      socket = null;
      if (![1000, 1008, 4001].includes(event.code) && mode === 'custom' && onlineUser) reconnectTimeout = setTimeout(() => connect('custom'), reconnectDelay);
      return;
    }
    if (wasPlaying) { leaveGame(false); toast(kind === 'local' ? '브라우저 시뮬레이션이 중단되었습니다. 다시 시작해 주세요.' : '서버 연결이 끊겼습니다. 튜토리얼/혼자 연습은 서버 없이 이용할 수 있습니다.', true); }
    selfSessionId = null;
    if (event.code !== 4001) { reconnectTimeout = setTimeout(() => connect(kind), reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 1.5, 8000); }
  });
  connection.addEventListener('error', () => { /* close handles recovery. */ });
}

function callsign() {
  if (onlineUser) return onlineUser.callsign;
  const name = $('player-name').value.trim() || 'OPERATOR';
  store('sector07-name', name); profileStore.setName(name).catch((error) => toast(error.message, true)); return name;
}

function profileLoadout() {
  const profile = equipmentProfile(), requested = onlineUser ? onlineSelectedWeapon : loadout.weaponId;
  const weaponId = ownsWeapon(profile, requested) ? requested : 'rifle';
  return { ...loadout, weaponId, outfitId: profile.equippedOutfitId, characterId: profile.characterId, ownedWeapons: profile.ownedWeapons, weaponKills: profile.weaponKills, suppressedWeapons: profile.suppressedWeapons, suppressor: selectedSuppressor(profile, weaponId) };
}

function askRoomPassword(code) {
  pendingJoinCode = code; $('room-password-code').textContent = `방 코드 ${code}`; $('room-password-error').textContent = ''; $('room-join-password').value = ''; openDialog('room-password-dialog'); $('room-join-password').focus();
}
function requestJoin(code, password = '') {
  if (busy || game || roomSession) return;
  if (!connected) { toast('먼저 로컬 서버에 연결되어야 합니다.', true); return; }
  if (!/^[A-Z2-9]{5}$/.test(code)) { toast('5자리 방 코드를 입력해 주세요.', true); return; }
  pendingJoinCode = code; dialogs.closeAll(); setBusy(true);
  send(transportKind === 'custom' ? { type: 'join', code, password, weaponId: onlineSelectedWeapon, skinId: loadout.skinId, suppressor: selectedSuppressor(onlineUser, onlineSelectedWeapon) } : { type: 'join', code, password, name: callsign(), ...profileLoadout() });
}

function showMenu(visible) {
  if (!game || ['waiting', 'countdown', 'ended'].includes(game.room?.phase)) return;
  $('pause-overlay').hidden = !visible;
  if (!visible) hasDeployed = true;
  $('pause-title').textContent = hasDeployed ? 'STAY IN THE FIGHT.' : 'READY TO BREACH';
  $('pause-description').textContent = hasDeployed ? '호흡을 가다듬고, 다시 교전으로.' : '마우스를 클릭해 조준과 이동을 시작하세요.';
  $('resume-button').querySelector('span').textContent = hasDeployed ? '교전 계속하기' : '교전 시작';
  const training = game.room?.mode === 'tutorial'; $('tutorial-actions').hidden = !training;
  if (training && game.room.phase === 'training-complete') { $('pause-title').textContent = 'TRAINING COMPLETE'; $('pause-description').textContent = '기초 훈련을 마쳤습니다. 다시 도전하거나 혼자 연습으로 이어가세요.'; $('resume-button').hidden = true; }
  else $('resume-button').hidden = false;
  $('return-room-button').hidden = !game.room.staging;
  $('return-room-button').textContent = isTeamGame(game.room.gameType) && game.room.gameType !== 'defense' ? '팀 변경 / 대기실' : '방 대기실로';
}

function handleRoomSession(data, resultPresented = false) {
  roomSession = data; const self = data.players.find((p) => p.id === selfSessionId);
  if (!self) return;
  if (game?.roundReturnTimer && data.room.phase !== 'ended') { clearTimeout(game.roundReturnTimer); game.roundReturnTimer = null; }
  if (self.roomStatus === 'waiting') {
    if (game && data.room.phase === 'ended' && !resultPresented) {
      game.applySnapshot(data);
      if (!game.roundReturnTimer) { const current = game; current.roundReturnTimer = setTimeout(() => { if (game === current && roomSession?.room.phase === 'ended') handleRoomSession(roomSession, true); }, 5000); }
      return;
    }
    if (game) { game.dispose(); game = null; for (const id of ['pause-overlay', 'round-overlay', 'respawn-overlay', 'scoreboard-overlay']) $(id).hidden = true; }
    $('lobby').hidden = false; $('game-shell').hidden = true; setBusy(false);
    roomLobby.update(data, selfSessionId); dialogs.show($('room-lobby-dialog'));
  } else if (!game) { dialogs.closeAll(); setBusy(true); void enterGame({ ...data, id: selfSessionId }); }
  else game.applySnapshot(data);
}

async function enterGame(data) {
  if (data.room?.protocolVersion !== NETWORK_PROTOCOL) { send({ type: 'leave' }); matchIntro.hide(); onlineEntering = false; setBusy(false); toast('게임 서버가 이전 버전입니다. 진행 중인 방을 종료한 뒤 서버를 재시작하고 브라우저를 새로고침해 주세요.', true); return; }
  if (game) game.dispose();
  onlineEntering = isOnlineRoom(data.room) && ['waiting', 'countdown'].includes(data.room.phase);
  $('lobby').hidden = true; $('game-shell').hidden = false; hasDeployed = false;
  $('pause-overlay').hidden = true; $('combat-focus-hint').hidden = true; $('combat-focus-menu').hidden = true;
  rankedResults.reset();
  if (onlineEntering) matchIntro.update(data); else matchIntro.hide();
  try {
    game = new FPSGame({
      canvas: $('game-canvas'), minimap: $('minimap'), settings, audio, send,
      mapId: data.room.mapId, weaponId: data.players.find((player) => player.id === data.id)?.weaponId, skinId: data.players.find((player) => player.id === data.id)?.skinId,
      world: data.room.mode === 'tutorial' ? TRAINING_WORLD : undefined,
      outfitId: data.players.find((player) => player.id === data.id)?.outfitId,
      characterId: data.players.find((player) => player.id === data.id)?.characterId,
      onMenu: showMenu,
      onResults: () => rankedResults.reveal(),
      onPrepareLoadout: chooseDeploymentWeapon,
      onFatal: (message, fatal = true) => { toast(message, true); if (fatal) leaveGame(); },
    });
    game.applySnapshot(data, data.id);
    $('loading-overlay').querySelector('h2').textContent = '그래픽을 준비하는 중'; $('loading-overlay').querySelector('.eyebrow').textContent = 'PREPARING GRAPHICS';
    const created = game; await created.prepareGraphics(); if (game !== created || created.disposed) return;
    $('pause-room-code').textContent = data.room.code;
    $('copy-invite').hidden = !['lan', 'custom'].includes(data.room.mode); $('hud-connection-kind').textContent = transportKind === 'local' ? 'LOCAL' : transportKind === 'custom' ? 'CUSTOM' : transportKind === 'online' ? 'ONLINE' : 'ROOM';
    if (onlineEntering) { send({ type: 'ready' }); handleOnlineState({ room: created.room, online: created.online, serverTime: created.serverNow }); }
    else if (isOnlineRoom(data.room) && data.room.phase === 'active') showCombatFocus();
    else if (data.room.phase !== 'ended') showMenu(true);
    const address = new URL(location.href); address.searchParams.delete('room'); address.searchParams.delete('custom'); history.replaceState(null, '', address);
  } catch (error) {
    console.error('Failed to create the 3D arena:', error);
    leaveGame(); toast('3D 그래픽을 시작할 수 없습니다. WebGL을 지원하는 데스크톱 브라우저와 하드웨어 가속을 확인해 주세요.', true);
  } finally { setBusy(false); }
}

function leaveGame(notify = true) {
  matchIntro.hide(); onlineEntering = false;
  const online = isOnlineRoom(); if (online && game.room.phase === 'ended') { lobbyResultMatchId = onlineActiveMatch; renderLobbyResult(); void fetchOnlineReceipt(onlineActiveMatch); }
  if (notify && online) { onlineReconnectUntil = 0; clearTimeout(reconnectTimeout); }
  if (notify) send({ type: 'leave' });
  game?.dispose(); game = null; roomSession = null; dialogs.closeAll();
  rankedResults.reset();
  if (online) { onlineQueueState = null; renderOnlineQueue(); }
  selfSessionId = null; $('tutorial-actions').hidden = true; $('resume-button').hidden = false;
  $('lobby').hidden = false; $('game-shell').hidden = true;
  if (document.fullscreenElement === $('game-shell')) document.exitFullscreen?.().catch(() => {});
  for (const id of ['pause-overlay', 'round-overlay', 'scoreboard-overlay', 'respawn-overlay']) $(id).hidden = true;
  setBusy(false); if (online) { void connectOnlineServices(); void refreshOnlineQueue(); } else send({ type: 'list' });
}

function setMode(value) {
  if (game || roomSession || busy || onlineBusy) return;
  if (['QUEUED', 'OFFERED'].includes(onlineQueueState?.state) && getPlayMode(value).id !== onlineQueueState.mode.toLowerCase()) { void cancelOnlineQueue().then((cancelled) => { if (cancelled) setMode(value); }); return; }
  if (['ACCEPTED', 'ASSIGNED', 'READY'].includes(onlineQueueState?.state) && getPlayMode(value).id !== onlineQueueState.mode.toLowerCase()) { toast('수락한 경기를 먼저 입장해 주세요.'); return; }
  const selected = getPlayMode(value), changedMode = mode !== selected.id;
  if (selected.transport === 'online' && !['casual', 'ranked'].includes(mode)) onlineSelectedWeapon = getWeapon(stored('linkshot-online-weapon', onlineSelectedWeapon)).id;
  if (selected.id === 'custom' && mode !== 'custom') onlineSelectedWeapon = getWeapon(stored('linkshot-custom-weapon', 'rifle')).id;
  mode = selected.id;
  if (onlineUser) {
    onlineSelectedWeapon = getWeapon(stored(`linkshot-account-weapon-${onlineUser.id}`, onlineSelectedWeapon)).id;
    if (!ownsWeapon(onlineUser, onlineSelectedWeapon)) onlineSelectedWeapon = 'rifle';
  }
  if (changedMode && ['casual', 'ranked'].includes(mode)) { dashboardLadder = ladderKey(mode); store('linkshot-dashboard-ladder', dashboardLadder); }
  const roomBrowserLabel = mode === 'custom' ? '사용자 대전 방 목록' : 'LAN 방 목록'; $('nav-rooms').title = roomBrowserLabel; $('nav-rooms').setAttribute('aria-label', roomBrowserLabel); $('nav-rooms').querySelector('span').textContent = mode === 'custom' ? '사용자 방' : 'LAN 방';
  if (mode === 'custom' && !onlineUser && transportKind === 'custom' && socket) connect('custom');
  for (const item of PLAY_MODES) { $(`mode-${item.id}`).classList.toggle('selected', mode === item.id); $(`mode-${item.id}`).setAttribute('aria-selected', String(mode === item.id)); $(`mode-${item.id}`).tabIndex = mode === item.id ? 0 : -1; }
  $('create-button').querySelector('span').textContent = selected.action; $('mode-description').textContent = selected.description;
  const unavailable = usesOnlineServices() && (!onlineAvailable || !(mode === 'custom' ? onlineCapabilities.customRooms : onlineCapabilities.matchmaking)) || SOLO && mode === 'lan';
  $('mode-unavailable').hidden = !unavailable;
  $('mode-unavailable').textContent = usesOnlineServices() ? onlineAvailable ? 'Java/Spring Boot 연결됨 · 전투 노드 준비 중' : 'Java/Spring Boot 서버 미연결 · 프로필에서 상태를 확인하세요.' : 'LAN 서버 페이지에서 이용할 수 있습니다.';
  renderOnlineAccount(); renderOnlineQueue();
  renderCompetitiveHero();
  $('lan-connect-guide').hidden = !SOLO; $('lan-share-panel').hidden = SOLO;
  $('deploy-note').lastChild.textContent = mode === 'lan' ? ' 방 코드로 친구를 초대할 수 있어요' : mode === 'tutorial' ? ' 약 3–5분 · 언제든 건너뛰기 / 다시 시작' : ' 튜토리얼·혼자 연습은 서버 없이 이용할 수 있어요';
  $('bot-description').textContent = mode === 'lan' ? '친구를 기다리는 동안 가볍게' : '함께 실력을 쌓아갈 연습 상대';
  const roomMode = mode === 'custom' || mode === 'lan' && !SOLO;
  $('join-section').hidden = !roomMode; $('room-settings').hidden = !roomMode; $('room-browser-button').hidden = !roomMode; $('practice-note').hidden = mode !== 'practice';
  $('deployment-settings-button').hidden = mode !== 'practice'; $('online-loadout-button').hidden = !usesOnlineServices();
  $('tutorial-recommendation').hidden = !['tutorial', 'practice'].includes(mode) || !!stored('linkshot-tutorial-v1', '');
  const settingsVisible = mode === 'practice' || roomMode;
  for (const selector of ['.bot-row', '.match-options']) document.querySelector(selector).hidden = !settingsVisible;
  document.querySelector('.bot-level-row').hidden = mode !== 'practice';
  $('choose-map').disabled = mode === 'tutorial' || selected.transport === 'online';
  updateRuleChoices();
  if (mode === 'practice' && selectedGameType() !== 'defense' && botCount === 0) botCount = 1;
  if (socket && transportKind !== selected.transport || !socket && (selected.transport === 'local' || selected.transport === 'custom' && onlineUser && onlineCapabilities.customRooms || selected.transport === 'lan' && !SOLO)) connect(selected.transport);
  else if (unavailable && transportKind !== selected.transport) connect(selected.transport);
  updateConnection(connected && !unavailable);
  updateBots();
}

function handleTutorialState(data) {
  if (data.room?.mode !== 'tutorial' || !game) return;
  const action = data.tutorial?.action; $('tutorial-advance').hidden = !action; $('tutorial-advance').disabled = !action?.enabled; $('tutorial-advance').textContent = action?.label || '';
  if (!data.tutorial?.completed) { tutorialCompletedRound = null; return; }
  if (tutorialCompletedRound === data.room.roundId) return;
  tutorialCompletedRound = data.room.roundId; store('linkshot-tutorial-v1', 'completed'); $('tutorial-recommendation').hidden = true;
  game.clearInput(); if (game.locked) document.exitPointerLock(); showMenu(true);
}

function renderOnlineAccount() {
  if ((onlineUser?.id || null) !== equipmentAccount) {
    equipmentAccount = onlineUser?.id || null;
    onlineSelectedWeapon = onlineUser ? getWeapon(stored(`linkshot-account-weapon-${onlineUser.id}`, 'rifle')).id : onlineSelectedWeapon;
    selectedOutfitId = equipmentProfile().equippedOutfitId;
  }
  renderPointBalance();
  renderOnlineProfileStats();
  renderModeBrief();
  $('online-server-state').textContent = onlineAvailable ? 'SPRING ONLINE SERVICES · 연결됨' : '온라인 서버에 연결되어 있지 않습니다';
  $('account-badge-state').textContent = onlineUser ? 'ONLINE · 로그인됨' : '로그인 / 회원가입'; $('operator-callsign').textContent = onlineUser?.callsign || profileStore.profile.callsign;
  $('mode-account-note').hidden = !usesOnlineServices(); $('mode-account-note').textContent = onlineUser ? `${onlineUser.callsign} · 온라인 계정으로 출격` : '온라인 로그인은 우측 상단 프로필에서 진행하세요.';
  $('online-auth-form').hidden = !!onlineUser || authView !== 'login'; $('online-registration-form').hidden = !!onlineUser || authView !== 'register';
  $('online-auth-tabs').hidden = !!onlineUser;
  $('auth-login-tab').setAttribute('aria-selected', String(authView === 'login')); $('online-register').setAttribute('aria-selected', String(authView === 'register'));
  $('auth-login-tab').tabIndex = authView === 'login' ? 0 : -1; $('online-register').tabIndex = authView === 'register' ? 0 : -1;
  $('online-profile-summary').hidden = !onlineUser; $('online-logout').hidden = !onlineUser;
  $('online-callsign-form').hidden = !onlineUser;
  const nameInput = $('online-profile-callsign'), accountId = onlineUser?.id || '';
  if (nameInput.dataset.accountId !== accountId) { nameInput.dataset.accountId = accountId; nameInput.dataset.dirty = 'false'; nameInput.value = onlineUser?.callsign || onlineUser?.username || ''; nameInput.setCustomValidity(''); }
  else if (nameInput.dataset.dirty !== 'true' && document.activeElement !== nameInput) nameInput.value = onlineUser?.callsign || onlineUser?.username || '';
  nameInput.disabled = onlineBusy || !onlineAvailable;
  if (onlineUser) $('online-profile-summary').textContent = `${onlineUser.callsign} · 온라인 ${onlineUser.points} LP · ${onlineUser.kills} K / ${onlineUser.deaths} D · 개인전 ${rankPresentation(ladderProfile(onlineUser, 'ffa')).label} · 팀전 ${rankPresentation(ladderProfile(onlineUser, 'teams')).label}`;
  if (onlineUser && !ownsWeapon(onlineUser, onlineSelectedWeapon)) onlineSelectedWeapon = 'rifle';
  if ($('armory-dialog').open) renderWeaponOwnership();
  renderLoadoutCard();
  void authenticateLanRank();
  for (const id of ['online-login', 'online-submit-registration', 'online-register', 'auth-login-tab', 'online-logout', 'online-save-callsign']) $(id).disabled = onlineBusy || shopBusy || !onlineAvailable;
  $('online-check-username').disabled = onlineBusy || !onlineAvailable || usernameChecking;
  updateDeployButton();
}
async function authenticateLanRank() {
  const connection = socket;
  if (transportKind !== 'lan' || connection?.readyState !== WebSocket.OPEN || !connection.rankBadgeEngineId) return;
  if (!onlineUser) { if (connection.rankBadgeKey) { send({ type: 'rank-profile', clear: true }); connection.rankBadgeKey = null; } return; }
  if (!onlineApi || !onlineAvailable || connection.rankBadgePending || Date.now() < (connection.rankBadgeNextAt || 0)) return;
  const key = JSON.stringify([onlineUser.id, onlineUser.competitive, onlineUser.rankTier, onlineUser.rankDivision, onlineUser.rankPoints]);
  if (connection.rankBadgeKey === key) return;
  connection.rankBadgePending = true; connection.rankBadgeNextAt = Date.now() + 10000;
  const generation = onlineAuthGeneration, account = onlineUser.id;
  try {
    const proof = await onlineApi.rankBadgeTicket(connection.rankBadgeEngineId);
    if (socket !== connection || generation !== onlineAuthGeneration || account !== onlineUser?.id) return;
    connection.send(JSON.stringify({ type: 'rank-profile', ticket: proof.ticket })); connection.rankBadgeKey = key;
  } catch { /* Cosmetic verification must never stop guest LAN gameplay. */ }
  finally { connection.rankBadgePending = false; }
}
function rankText(tier, division = 5, points = 0, placements = 0) { return tier === 'UNRANKED' ? `배치 ${Math.min(PLACEMENT_MATCHES, placements || 0)}/${PLACEMENT_MATCHES}` : tier === 'CHALLENGER' ? 'CHALLENGER' : `${tier} ${['', 'I', 'II', 'III', 'IV', 'V'][division]} · ${points} 승급점수`; }
function renderOnlineProfileStats() {
  const user = onlineUser, rank = rankPresentation(ladderProfile(user, 'teams')), ffa = rankPresentation(ladderProfile(user, 'ffa'));
  $('profile-casual-rating').textContent = user ? ffa.label : '—';
  $('profile-casual-status').textContent = user ? ffa.detail : '로그인';
  $('profile-rank-tier').textContent = user ? rank.label : '—';
  $('profile-rank-progress').textContent = user ? rank.detail : '로그인';
  $('profile-rank-tier').title = user ? rankText(user.rankTier, user.rankDivision, user.rankPoints, user.placementsPlayed) : '온라인 계정의 랭크 티어';
  renderRankView(ladderProfile(user, dashboardLadder), ladderName(dashboardLadder), dashboardLadder);
  renderCompetitiveHero();
}
function renderCompetitiveHero() {
  dashboard.render({ profile: onlineUser, key: dashboardLadder, mode, mapId: loadout.mapId });
}
function renderPointBalance() {
  const online = !!onlineUser || usesOnlineServices(), points = online ? onlineUser?.points ?? 0 : profileStore.profile.points;
  $('profile-points').textContent = points.toLocaleString('ko-KR'); $('top-points').textContent = points.toLocaleString('ko-KR');
  const button = document.querySelector('.profile-points');
  button.dataset.open = online && !onlineUser ? 'profile-dialog' : 'shop-dialog';
  button.querySelector('span').textContent = online ? 'ACCOUNT LINK POINTS' : 'DEVICE LINK POINTS';
  button.querySelector('small').textContent = online ? '계정 LP · 전 모드 공통 상점 ↗' : '기기 LP · 외형 상점 ↗';
  button.title = online ? '로그인 계정의 공통 LP · 구매 장비는 LAN·연습·사용자 대전에서 공통 사용' : '비로그인 기기 LP · 계정 데이터와 별도로 보존';
  $('local-profile-points').textContent = `${profileStore.profile.points.toLocaleString('ko-KR')} LP`;
}
function renderLoadoutCard() {
  const online = !!onlineUser || usesOnlineServices(), weapon = getWeapon(online ? onlineSelectedWeapon : loadout.weaponId), skin = getSkin(loadout.skinId);
  $('loadout-weapon').replaceChildren(document.createTextNode(`${weapon.name} `));
  const type = document.createElement('span'); type.textContent = weapon.type; $('loadout-weapon').append(type);
  $('loadout-description').textContent = `${weapon.label} · ${weapon.magazine}발`;
  $('loadout-heading').textContent = online ? 'ONLINE LOADOUT' : 'YOUR LOADOUT';
  const suppressor = selectedSuppressor(online ? onlineUser : profileStore.profile, weapon.id);
  $('loadout-skin').textContent = `${skin.name}${suppressor ? ' · SUPPRESSED' : ''}`;
  $('armory-button').dataset.weapon = weapon.id; $('armory-button').dataset.skin = skin.id;
  try { lobbyPreview ||= new ArmoryPreview($('loadout-preview')); lobbyPreview.set(weapon.id, skin.id, suppressor); } catch { /* Equipment names remain available without WebGL. */ }
}
function renderLobbyResult() {
  const root = $('lobby-match-result'); root.hidden = !lobbyResultMatchId;
  if (root.hidden) return;
  const receipt = onlineReceipt?.matchId === lobbyResultMatchId ? onlineReceipt : null;
  if (!receipt) { $('lobby-result-mode').textContent = 'RANKED RESULT'; $('lobby-result-delta').textContent = '정산 중'; $('lobby-result-detail').textContent = ''; return; }
  const result = rankResult(receipt); root.dataset.positive = String(result.positive);
  $('lobby-result-mode').textContent = result.mode; $('lobby-result-delta').textContent = result.delta; $('lobby-result-detail').textContent = result.detail;
}
async function connectOnlineServices() {
  if (!onlineApi || onlineServicePolling) return;
  onlineServicePolling = true; const generation = onlineAuthGeneration;
  try { const health = await onlineApi.health(); if (health.service !== 'linkshot-online') throw new Error('온라인 서버 종류를 확인하세요.'); onlineAvailable = true; onlineCapabilities = health; onlineReason = ''; try { const user = await onlineApi.profile(); if (generation === onlineAuthGeneration) onlineUser = user; } catch (error) { if (error.status !== 401) throw error; if (generation === onlineAuthGeneration) onlineUser = null; } }
  catch { onlineAvailable = false; onlineReason = '온라인 서버에 연결할 수 없습니다. Java/Spring Boot 서버 주소를 확인하세요. 튜토리얼과 혼자 연습은 계속 이용할 수 있습니다.'; }
  finally { onlineServicePolling = false; }
  renderOnlineAccount(); if (usesOnlineServices()) { setMode(mode); if (mode !== 'custom') void refreshOnlineQueue(); }
}
async function onlineAuthenticate(register = false) {
  const form = $(register ? 'online-registration-form' : 'online-auth-form');
  if (!onlineApi || onlineBusy || !onlineAvailable || !form.reportValidity()) return;
  if (register && $('register-password').value !== $('register-password-confirm').value) { $('online-auth-status').textContent = '비밀번호 확인이 일치하지 않습니다.'; return; }
  onlineBusy = true; onlineAuthGeneration++; usernameCheckGeneration++; usernameChecking = false; renderOnlineAccount(); $('online-auth-status').textContent = '온라인 계정 확인 중…';
  const username = $(register ? 'register-username' : 'online-username').value, password = $(register ? 'register-password' : 'online-password').value;
  try { if (register) await onlineApi.register(username, password); onlineUser = await onlineApi.login(username, password); $('online-auth-status').textContent = '온라인 로그인 완료 · 기기 기록은 변경하지 않았습니다.'; }
  catch (error) { $('online-auth-status').textContent = error.message; }
  finally { for (const id of ['online-password', 'register-password', 'register-password-confirm']) $(id).value = ''; onlineBusy = false; renderOnlineAccount(); renderShop(); if (mode === 'custom') setMode(mode); else void refreshOnlineQueue(); }
}
function setAuthView(view) {
  if (onlineBusy) return;
  authView = view; usernameCheckGeneration++; usernameChecking = false;
  for (const id of ['online-password', 'register-password', 'register-password-confirm']) $(id).value = '';
  $('online-auth-status').textContent = ''; $('online-username-status').textContent = '';
  renderOnlineAccount();
}

function renderOnlineQueue() {
  matchOfferTimer.update(onlineUser ? onlineQueueState : null);
  const state = onlineQueueState, visible = getPlayMode(mode).transport === 'online' && !!onlineUser && state && state.state !== 'IDLE';
  $('online-queue-panel').hidden = !visible; $('queue-status-button').hidden = true; $('matchmaking-widget').hidden = !visible;
  if (!visible) { updateDeployButton(); return; }
  const queued = state.state === 'QUEUED', ready = state.state === 'READY', offered = state.state === 'OFFERED', accepted = state.state === 'ACCEPTED';
  const seconds = Math.max(0, Math.ceil((Date.parse(state.acceptanceDeadline) - Date.parse(state.serverTime)) / 1000)) || 0;
  const title = queued ? `상대를 찾는 중 · ${state.elapsedSeconds}초` : offered ? `매칭 발견 · 수락 ${seconds}초` : accepted ? `수락 완료 · ${seconds}초` : ready ? '경기 입장 / 재접속' : state.state === 'ABANDONED' ? '탈주 처리 · 정산 대기' : '전투 서버 준비 중';
  const detail = queued ? `매칭 인원 ${state.playersFound}/${state.requiredPlayers}` : offered || accepted ? `수락 ${state.acceptedPlayers || 0}/${state.playersFound} · 미수락 자리 AI 대체` : state.matchId ? `경기 ${state.matchId.slice(0, 8)} · 입장 준비` : '';
  $('matchmaking-widget').dataset.state = state.state;
  $('matchmaking-status').textContent = title; $('matchmaking-detail-text').textContent = detail;
  $('queue-dialog-title').textContent = offered ? '매칭을 수락해 주세요' : accepted ? '다른 플레이어 응답 대기' : queued ? '상대를 찾는 중' : '온라인 경기';
  $('online-queue-title').textContent = title; $('online-queue-detail').textContent = detail;
  $('online-queue-reason').textContent = state.reason || (queued ? '창을 접어도 매칭은 계속됩니다. 메인 화면에서 취소할 수 있습니다.' : '연결 종료 후 30초 안에는 같은 생명·탄약으로 재접속할 수 있습니다.');
  for (const id of ['matchmaking-accept', 'online-accept-match']) { $(id).hidden = !offered; $(id).disabled = onlineBusy; }
  for (const id of ['matchmaking-cancel', 'online-cancel-queue']) { $(id).hidden = !queued && !offered; $(id).disabled = onlineBusy; $(id).textContent = offered ? '거절' : '취소'; }
  $('online-reconnect').hidden = !ready; $('online-reconnect').disabled = busy || onlineBusy;
  if (offered && lastOfferedMatch !== state.matchId) { lastOfferedMatch = state.matchId; openDialog('queue-dialog'); }
  updateDeployButton();
}
function stopQueuePolling() { clearInterval(onlineQueueTimer); onlineQueueTimer = null; }
function startQueuePolling() { if (!onlineQueueTimer) onlineQueueTimer = setInterval(() => { void refreshOnlineQueue(); }, 1000); void refreshOnlineQueue(); }
async function refreshOnlineQueue() {
  if (!onlineApi || !onlineUser || onlinePolling || onlineBusy || game) return;
  onlinePolling = true;
  const generation = onlineAuthGeneration, account = onlineUser.id, revision = onlineQueueRevision;
  try {
    const state = await onlineApi.queueStatus();
    if (generation !== onlineAuthGeneration || onlineUser?.id !== account || revision !== onlineQueueRevision) return;
    onlineQueueState = state;
    if (onlineQueueState.state === 'QUEUED' && Date.now() - onlineHeartbeatAt > 5000) { await onlineApi.queueHeartbeat(); onlineHeartbeatAt = Date.now(); }
    renderOnlineQueue();
    if (onlineQueueState.state === 'READY' && onlineAutoJoin && getPlayMode(mode).transport === 'online') startOnlineMatch();
    if (onlineQueueState.state === 'IDLE') { onlineAutoJoin = false; lastOfferedMatch = null; stopQueuePolling(); void dialogs.close($('queue-dialog')); }
  } catch (error) { if (error.status === 401) { onlineUser = null; onlineQueueState = null; stopQueuePolling(); renderOnlineAccount(); } $('online-queue-reason').textContent = '매칭 상태를 확인할 수 없습니다. 연결을 확인해 주세요.'; }
  finally { onlinePolling = false; }
}
async function joinOnlineQueue() {
  if (!onlineApi || !onlineUser || onlineBusy || busy || game) return;
  if (onlineQueueState?.state === 'READY') { startOnlineMatch(); return; }
  onlineBusy = true; onlineQueueRevision++; onlineAutoJoin = true; renderOnlineAccount();
  try { onlineQueueState = await onlineApi.queue(mode === 'ranked' ? 'RANKED' : 'CASUAL'); renderOnlineQueue(); openDialog('queue-dialog'); startQueuePolling(); }
  catch (error) { onlineAutoJoin = false; toast(error.message, true); }
  finally { onlineBusy = false; renderOnlineAccount(); renderOnlineQueue(); }
}
async function cancelOnlineQueue() {
  if (!onlineApi || onlineBusy) return false;
  onlineBusy = true; onlineQueueRevision++; onlineAutoJoin = false; renderOnlineAccount();
  try { onlineQueueState = await onlineApi.cancelQueue(); stopQueuePolling(); void dialogs.close($('queue-dialog')); return true; }
  catch (error) { toast(error.message, true); await refreshOnlineQueue(); return false; }
  finally { onlineBusy = false; renderOnlineAccount(); renderOnlineQueue(); }
}
async function acceptOnlineMatch() {
  if (!onlineApi || onlineBusy || onlineQueueState?.state !== 'OFFERED') return;
  onlineBusy = true; onlineQueueRevision++; onlineAutoJoin = true; renderOnlineQueue();
  try { onlineQueueState = await onlineApi.respondToMatch(onlineQueueState.matchId, true); renderOnlineQueue(); startQueuePolling(); }
  catch (error) { toast(error.message, true); await refreshOnlineQueue(); }
  finally { onlineBusy = false; renderOnlineAccount(); renderOnlineQueue(); }
}
function startOnlineMatch() {
  if (!onlineApi || !onlineUser || onlineQueueState?.state !== 'READY' || game || busy) return false;
  stopQueuePolling(); onlineQueueRevision++; dialogs.closeAll(); onlineAutoJoin = false; onlineReceipt = null; onlineResultPending = null; onlineResultNextAt = 0; rankedResults.reset(); matchIntro.show(); setBusy(true);
  const previous = socket; socket = null; previous?.close(); transportKind = 'online'; selfSessionId = null;
  const connection = new OnlineConnection(onlineApi, onlineSelectedWeapon, selectedSuppressor(onlineUser, onlineSelectedWeapon), loadout.skinId); socket = connection; bindConnection(connection, 'online'); return true;
}
async function tryOnlineReconnect() {
  if (game || busy || !onlineApi || !onlineUser || Date.now() >= onlineReconnectUntil) return;
  await refreshOnlineQueue();
  if (onlineQueueState?.state === 'READY') startOnlineMatch();
  else if (['IDLE', 'ABANDONED'].includes(onlineQueueState?.state)) onlineReconnectUntil = 0;
  else reconnectTimeout = setTimeout(tryOnlineReconnect, 1000);
}
function handleOnlineState(data) {
  if (!isOnlineRoom(data.room)) return;
  if (onlineEntering) {
    matchIntro.update(data);
    if (['active', 'ended'].includes(data.room.phase) && game?.graphicsReady) { onlineEntering = false; if ($('armory-dialog').open) void dialogs.close($('armory-dialog')); if (data.room.phase === 'active') { game.closeLoadout(false); matchIntro.finish(); showCombatFocus(); } else matchIntro.hide(); }
  }
  if (data.room.phase === 'ended') {
    rankedResults.pending(data.online.matchId);
    if (data.online?.settlement === 'saved') void fetchOnlineReceipt(data.online.matchId);
  }
}
function showCombatFocus() {
  $('pause-overlay').hidden = true;
  $('combat-focus-hint').hidden = !!game?.locked; $('combat-focus-menu').hidden = !!game?.locked;
}
async function fetchOnlineReceipt(id) {
  if (!onlineApi || onlineReceipt?.matchId === id || onlineResultPending || Date.now() < onlineResultNextAt) return;
  if (!id || !onlineUser) return;
  onlineResultPending = id; const generation = onlineAuthGeneration, accountId = onlineUser.id;
  try { const [receipt, user] = await Promise.all([onlineApi.receipt(id), onlineApi.profile()]); if (generation !== onlineAuthGeneration || accountId !== onlineUser?.id || id !== onlineActiveMatch) return; onlineReceipt = receipt; onlineUser = user; if (game?.room.phase === 'ended') { rankedResults.setReceipt(receipt); if (!$('round-overlay').hidden) rankedResults.reveal(); } renderOnlineAccount(); renderRoundReward(); renderLobbyResult(); }
  catch { onlineResultNextAt = Date.now() + 2000; $('round-reward-status').textContent = '온라인 정산을 확인하는 중입니다.'; }
  finally { onlineResultPending = null; }
}

function updateBots() {
  const minimum = mode === 'practice' && selectedGameType() !== 'defense' ? 1 : 0, maximum = selectedGameType() === 'defense' ? 3 : RULES.maxPlayers - 1;
  botCount = Math.max(minimum, Math.min(maximum, botCount));
  $('bot-count').textContent = botCount;
  $('bots-minus').disabled = botCount <= minimum; $('bots-plus').disabled = botCount >= maximum;
}
function updateRuleChoices() {
  const type = selectedGameType(), selected = getMap(loadout.mapId);
  if (!supportsGameType(selected, type)) loadout.mapId = MAPS.find((world) => supportsGameType(world, type)).id;
  for (const option of $('room-map-choice').options) option.disabled = option.hidden = !supportsGameType(getMap(option.value), type);
  $('room-map-choice').value = loadout.mapId;
  for (const button of $('room-map-cards').children) button.hidden = !supportsGameType(getMap(button.dataset.map), type);
  for (const button of $('map-choices').children) { const world = getMap(button.dataset.map); button.disabled = !supportsGameType(world, type); button.title = button.disabled ? `${world.name} · ${(world.gameTypes || ['ffa', 'teams']).map(gameTypeName).join(' / ')} 전용` : world.description; }
  $('room-initial-team').disabled = !isTeamGame(type) || type === 'defense' || mode === 'practice';
  $('rule-description').textContent = type === 'hardpoint' ? '45초 이동 · 초당 1점' : type === 'defense' ? '수비팀 1–4명 · 공세당 적 4명씩 증가' : '';
  const difficultyLabel = document.querySelector('.bot-level-row > span'); difficultyLabel.firstChild.textContent = type === 'defense' ? '지원 AI 난이도' : '연습 AI 난이도';
  difficultyLabel.querySelector('small').textContent = type === 'defense' ? '수비를 돕는 AI에 적용 · 적 공세 난이도는 회차별 자동 진행' : '혼자 연습에만 적용 · 방에서는 AI별로 설정';
  updateRoundOptions(); updateBots(); updateSelections();
}

function openDialog(id) {
  if (id === 'online-loadout-dialog') id = 'armory-dialog';
  if (id === 'armory-dialog') {
    if (usesOnlineServices() && !onlineUser) { openDialog('profile-dialog'); return; }
    selectedWeaponId = onlineUser ? onlineSelectedWeapon : loadout.weaponId;
    updateSelections();
  }
  if (game?.locked) document.exitPointerLock();
  const dialog = $(id);
  if (dialog.open && dialog.dataset.motion !== 'closing') return;
  if (id === 'briefing-dialog') {
    const world = getMap(loadout.mapId);
    drawTacticalMap($('briefing-map'), { world, spawns: true, detailed: true, gameType: ['lan', 'custom'].includes(mode) ? $('room-game-type').value : 'ffa' });
    $('briefing-map-title').textContent = world.name; $('briefing-map-size').textContent = `${world.width} × ${world.depth} M`;
    $('briefing-map-description').textContent = `${world.description} 건물 ${world.buildings.length}개·추가 엄폐벽 ${world.coverWalls.length}개와 계단식 발판을 활용하세요. 지상·2/3층·옥상 ${world.spawns.length}개 스폰은 건물·화물·설비의 자연 엄폐를 사용합니다. ${roundOptions.roundSeconds / 60}분 또는 먼저 ${roundOptions.fragLimit}킬을 달성하면 라운드가 끝납니다.`;
  }
  if (id === 'profile-dialog') renderOnlineAccount();
  if (id === 'room-create-dialog') { $('room-create-title').textContent = mode === 'practice' ? '연습 교전 설정' : mode === 'custom' ? '사용자 방 만들기' : 'LAN 방 만들기'; $('room-create-confirm').textContent = mode === 'practice' ? '설정 저장' : '대기실 만들기'; updateRuleChoices(); }
  dialogs.show(dialog);
  if (id === 'armory-dialog') {
    try { preview ||= new ArmoryPreview($('weapon-preview')); preview.set(selectedWeaponId, loadout.skinId, selectedSuppressor(equipmentProfile(), selectedWeaponId)); preview.drawThumbnails($('weapon-choices').children, loadout.skinId); $('preview-fallback').hidden = true; }
    catch { $('preview-fallback').hidden = false; }
  }
  if (id === 'shop-dialog') {
    renderShop();
    try { const profile = equipmentProfile(); operatorPreview ||= new OperatorPreview($('operator-preview')); operatorPreview.set(selectedOutfitId, loadout.skinId, onlineUser ? onlineSelectedWeapon : loadout.weaponId, profile.characterId, selectedSuppressor(profile, onlineUser ? onlineSelectedWeapon : loadout.weaponId)); $('operator-preview-fallback').hidden = true; }
    catch { $('operator-preview-fallback').hidden = false; }
  }
}

function renderProfile() {
  const profile = profileStore.profile, stats = profileStats(profile), character = getCharacter(profile.characterId);
  const format = (number) => number.toLocaleString('ko-KR');
  $('profile-callsign').textContent = profile.callsign; $('operator-callsign').textContent = onlineUser?.callsign || profile.callsign;
  $('profile-device').textContent = `기기 #${profile.id.slice(0, 8).toUpperCase()}`;
  $('profile-portrait').src = `/assets/${character.image}?v=${NETWORK_PROTOCOL}`; $('profile-portrait').alt = character.label;
  $('profile-kills').textContent = format(stats.kills); $('profile-deaths').textContent = format(stats.deaths);
  $('profile-ratio').textContent = stats.ratio.toFixed(2); $('profile-killrate').textContent = `킬 비율 ${stats.killRate.toFixed(0)}%`;
  $('shop-points').textContent = format(profile.points); renderPointBalance();
  $('profile-storage').textContent = profileStore.warning ? '저장 상태 확인 필요' : profileStore.saving ? 'PC 파일에 저장 중...' : profileStore.scope === 'host' ? '이 PC에 자동 저장' : '이 브라우저에 자동 저장';
  $('profile-storage').title = profileStore.warning || ''; $('profile-storage').classList.toggle('save-warning', !!profileStore.warning);
  $('profile-full-id').textContent = profile.id;
  $('profile-storage-detail').textContent = profileStore.scope === 'host' ? '운영체제 사용자 설정 폴더의 LINKSHOT/profile.json' : '현재 사이트 주소의 이 브라우저 로컬 저장소';
  $('profile-rounds').textContent = `${profile.roundsPlayed} / ${profile.wins}`; $('profile-earned').textContent = `${format(profile.totalEarned)} LP`;
  renderRoundReward(); renderShop(); renderWeaponOwnership(); renderOnlineProfileStats();
}

function syncProgress(data) {
  if (transportKind === 'online' || !recordsLocalProgress(data.room)) { lastRoundReward = null; renderRoundReward(); return; }
  if (!selfSessionId || !data.room?.roundId) return;
  const player = data.players.find((entry) => entry.id === selfSessionId); if (!player) return;
  if (data.room.staging && player.roomStatus === 'waiting' && !data.room.result?.rewards?.[selfSessionId]) return;
  const result = data.room.result?.roundId === data.room.roundId ? data.room.result.rewards?.[selfSessionId] : null;
  lastRoundReward = data.room.phase === 'ended' && result ? result : null;
  profileStore.syncRound({ roundId: data.room.roundId, kills: result?.kills ?? player.kills, deaths: result?.deaths ?? player.deaths, weaponKills: result?.weaponKills ?? player.weaponKills, completed: !!lastRoundReward, won: lastRoundReward?.won === true }).catch((error) => toast(error.message, true));
  renderRoundReward();
}

function renderRoundReward() {
  if (isOnlineRoom()) {
    $('round-reward').hidden = !onlineReceipt;
    if (!onlineReceipt) return;
    const receipt = onlineReceipt; $('round-points').textContent = receipt.points; $('reward-completion').textContent = receipt.completion; $('reward-kills').textContent = receipt.killBonus; $('reward-win').textContent = receipt.winBonus;
    $('round-reward-status').textContent = receipt.abandoned ? '온라인 서버 저장 · 탈주 보상 없음' : '온라인 서버에 저장됨 · 기기 LP와 별도'; onlineResultSummary.hidden = false;
    const result = rankResult(receipt); onlineResultSummary.textContent = `${result.mode} ${result.delta} · ${result.detail}`;
    return;
  }
  onlineResultSummary.hidden = true;
  $('round-reward').hidden = !lastRoundReward;
  if (!lastRoundReward) return;
  $('round-points').textContent = lastRoundReward.points; $('reward-completion').textContent = lastRoundReward.completion;
  $('reward-kills').textContent = lastRoundReward.killBonus; $('reward-win').textContent = lastRoundReward.winBonus;
  $('round-reward-status').textContent = profileStore.warning ? '기기 저장 상태를 확인하세요' : profileStore.saving ? 'PC 파일에 저장 중...' : '이 기기 프로필에 저장됨';
}

function renderShop() {
  const outfit = getOutfit(selectedOutfitId), profile = equipmentProfile();
  $('shop-points').textContent = profile.points.toLocaleString('ko-KR');
  for (const button of $('character-choices').children) {
    const selected = button.dataset.character === profile.characterId; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); button.disabled = shopBusy;
  }
  $('character-status').textContent = `${getCharacter(profile.characterId).name} · ${getCharacter(profile.characterId).label} · ${shopBusy ? '저장 중...' : '다음 출격부터 적용 · 기존 외형 모두 사용 가능'}`;
  operatorPreview?.set(selectedOutfitId, loadout.skinId, loadout.weaponId, profile.characterId, selectedSuppressor(profile, loadout.weaponId));
  document.querySelector('.shop-balance small').textContent = `${onlineUser ? '계정 공통 LP' : '기기 LP'} · 완주 ${POINT_RULES.completion} · 킬당 ${POINT_RULES.perKill} · 승리 ${POINT_RULES.victory}`;
  const owned = profile.ownedOutfits.includes(outfit.id), equipped = profile.equippedOutfitId === outfit.id;
  $('shop-concept').textContent = outfit.concept; $('shop-outfit-name').textContent = outfit.name; $('shop-description').textContent = outfit.description;
  $('shop-price').textContent = outfit.price ? `${outfit.price.toLocaleString('ko-KR')} LP` : '기본 지급';
  $('shop-owned-state').textContent = equipped ? '현재 장착 중' : owned ? '보유 중' : '미보유 외형';
  $('shop-action').textContent = shopBusy ? '저장 중...' : equipped ? '장착 중' : owned ? '이 외형 장착' : `${outfit.price} LP로 구매`;
  $('shop-action').disabled = shopBusy || equipped || (!owned && profile.points < outfit.price);
  $('shop-point-note').textContent = !owned && profile.points < outfit.price ? `${outfit.price - profile.points} LP가 더 필요합니다. 라운드를 완료해 포인트를 모으세요.` : '구매한 외형은 다음 교전부터 적용됩니다.';
  for (const card of $('outfit-choices').children) {
    const id = card.dataset.outfit, item = getOutfit(id); card.classList.toggle('selected', id === outfit.id); card.setAttribute('aria-pressed', String(id === outfit.id));
    card.querySelector('small').textContent = profile.equippedOutfitId === id ? '장착 중' : profile.ownedOutfits.includes(id) ? '보유 중' : `${item.price} LP`;
    card.classList.toggle('owned', profile.ownedOutfits.includes(id));
  }
}

function updateSelections() {
  const world = getMap(loadout.mapId), weapon = getWeapon(selectedWeaponId), skin = getSkin(loadout.skinId);
  const index = MAPS.indexOf(world) + 1;
  $('choose-map').querySelector('span').textContent = `${MAPS.length} MAPS ↗`;
  document.querySelector('.hero-index i').textContent = `/ ${String(MAPS.length).padStart(2, '0')}`;
  $('hero-map-name').textContent = world.name; $('hero-map-index').textContent = String(index).padStart(2, '0');
  $('hero-map-thumbnail').src = `/assets/${world.previewImage || world.image}`; $('hero-map-thumbnail').alt = world.name;
  $('room-map-choice').value = world.id;
  document.querySelector('#armory-dialog .dialog-heading .eyebrow').textContent = 'ARMORY / WEAPON FINISH';
  document.querySelector('#armory-dialog .dialog-footer > span').textContent = '';
  $('armory-button').style.setProperty('--finish', skin.color); $('armory-button').style.setProperty('--finish-accent', skin.accent);
  $('armory-button').style.setProperty('--finish-map', skin.pattern ? `url('/assets/${skin.pattern}')` : 'none');
  for (const button of $('map-choices').children) { const selected = button.dataset.map === world.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  for (const button of $('room-map-cards').children) { const selected = button.dataset.map === world.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  for (const button of $('weapon-choices').children) { const selected = button.dataset.weapon === weapon.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  for (const button of $('skin-choices').children) { const selected = button.dataset.skin === skin.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  $('armory-weapon-type').textContent = `${weapon.type} / ${weapon.label}`; $('armory-weapon-name').textContent = weapon.name;
  $('armory-weapon-description').textContent = weapon.description; $('armory-skin-name').textContent = skin.name;
  $('weapon-stats').replaceChildren();
  for (const [label, value] of [['기본 피해', weapon.pellets > 1 ? `${weapon.damage} × ${weapon.pellets} PELLETS` : `${weapon.damage} / HEAD ${weapon.headDamage}`], ['부위 배율', '몸통 ×1.2 · 손끝 ×0.5 · 머리 별도'], ['탄창 / 연사', `${weapon.magazine} / ${Math.round(60 / weapon.fireSeconds)} RPM`], ['재장전', `${weapon.reloadSeconds.toFixed(2)} SEC`], ['달리기 / 무음 걷기', `${(RULES.runSpeed * weapon.walkMultiplier).toFixed(1)} / ${(RULES.walkSpeed * weapon.walkMultiplier).toFixed(1)} M/S`], ['최대 사거리', `${weapon.range} M`]]) {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt, dd); $('weapon-stats').append(row);
  }
  preview?.set(weapon.id, skin.id, selectedSuppressor(equipmentProfile(), weapon.id));
  preview?.drawThumbnails($('weapon-choices').children, skin.id); store('sector07-loadout', JSON.stringify(loadout));
  if (roomSession) { const id = onlineUser ? onlineSelectedWeapon : loadout.weaponId; send({ type: 'room-loadout', weaponId: id, skinId: loadout.skinId, suppressor: selectedSuppressor(equipmentProfile(), id) }); }
  else if (game?.preparing) send({ type: 'prepare-loadout', roundId: game.room.roundId, weaponId: onlineSelectedWeapon, skinId: loadout.skinId, suppressor: selectedSuppressor(onlineUser, onlineSelectedWeapon) });
  renderWeaponOwnership();
  renderOnlineAccount();
}

function renderWeaponOwnership() {
  const online = !!onlineUser, profile = equipmentProfile();
  const weapon = getWeapon(selectedWeaponId), owned = ownsWeapon(profile, weapon.id), mastery = weaponMastery(profile?.weaponKills?.[weapon.id]);
  const equipped = online ? onlineSelectedWeapon : loadout.weaponId, saving = onlineBusy || shopBusy;
  $('armory-dialog').dataset.scope = online ? 'online' : 'device';
  document.querySelector('#armory-dialog .dialog-heading .eyebrow').textContent = online ? 'ACCOUNT ARMORY / SHARED EQUIPMENT' : 'ARMORY / DEVICE EQUIPMENT';
  for (const button of $('weapon-choices').children) {
    const item = getWeapon(button.dataset.weapon), available = ownsWeapon(profile, item.id);
    button.classList.toggle('locked', !available);
    button.querySelector('small').textContent = available ? `${item.label} · Lv.${weaponMastery(profile?.weaponKills?.[item.id]).level}` : `${item.price.toLocaleString('ko-KR')} ${online ? '계정 ' : ''}LP로 해금`;
  }
  $('armory-level').textContent = `Lv.${mastery.level}`;
  $('armory-mastery-count').textContent = `${mastery.inLevel} / ${mastery.required} KILLS → Lv.${mastery.level + 1}`;
  $('armory-mastery-fill').style.width = `${mastery.progress * 100}%`;
  $('armory-owned-state').textContent = !weapon.price ? '기본 지급 · 무제한 이용' : owned ? '영구 해금됨 · 모든 모드에서 사용 가능' : online ? '계정 LP로 영구 해금 · 랭크·LAN·연습·사용자 대전 공통' : '미해금 · 구매하면 이 기기에서 영구 이용';
  $('armory-unlock').textContent = saving ? '저장 중...' : owned ? equipped === weapon.id ? '출격 장비로 선택됨' : '출격 장비로 선택' : `${weapon.price.toLocaleString('ko-KR')} LP로 영구 해금`;
  $('armory-unlock').disabled = saving || owned && equipped === weapon.id || !owned && profile.points < weapon.price || online && !onlineAvailable;
  $('armory-balance').textContent = `${online ? '계정 공통' : '기기'} 보유 ${(profile?.points ?? 0).toLocaleString('ko-KR')} LP${!owned && profile.points < weapon.price ? ` · ${weapon.price - profile.points} LP 더 필요` : ''}`;
  const attachmentUnlocked = suppressorUnlocked(profile?.weaponKills, weapon.id);
  localSuppressor.input.setAttribute('aria-label', online ? '온라인 소음기 장착' : '기기 소음기 장착');
  localSuppressor.input.checked = pendingOnlineSuppressor?.weaponId === weapon.id && online ? pendingOnlineSuppressor.equipped : selectedSuppressor(profile, weapon.id);
  localSuppressor.input.disabled = saving || !attachmentUnlocked;
  localSuppressor.note.textContent = attachmentUnlocked ? `Lv.${mastery.level} · 무료 장착 · 피해량 동일` : `해당 총기 Lv.${SUPPRESSOR_LEVEL} 해금 · ${mastery.kills.toLocaleString('ko-KR')} / ${SUPPRESSOR_KILLS.toLocaleString('ko-KR')} KILLS · ${online ? '온라인' : '기기'} 숙련도 기준`;
}

function makeCollections() {
  for (const character of CHARACTERS) {
    const button = document.createElement('button'); button.className = 'character-choice'; button.dataset.character = character.id; button.setAttribute('aria-label', `${character.label} 선택`);
    const image = document.createElement('img'); image.src = `/assets/${character.image}?v=${NETWORK_PROTOCOL}`; image.alt = '';
    const copy = document.createElement('span'), name = document.createElement('b'), label = document.createElement('small'); name.textContent = character.name; label.textContent = `${character.label} · 무료`; copy.append(name, label); button.append(image, copy); $('character-choices').append(button);
    button.addEventListener('click', async () => {
      if (shopBusy || equipmentProfile().characterId === character.id) return;
      shopBusy = true; if (onlineUser) onlineAuthGeneration++; renderShop();
      try { if (onlineUser) onlineUser = await onlineApi.selectCharacter(character.id); else await profileStore.setCharacter(character.id); }
      catch (error) { toast(error.message, true); }
      finally { shopBusy = false; renderShop(); renderOnlineAccount(); }
    });
  }
  for (const world of MAPS) {
    const option = document.createElement('option'); option.value = world.id; option.textContent = world.name; $('room-map-choice').append(option);
    const button = document.createElement('button'); button.className = 'map-choice'; button.dataset.map = world.id; button.setAttribute('aria-label', `${world.label} 전장 선택`);
    const art = document.createElement('div'); art.className = 'map-choice-art'; art.style.backgroundImage = `url('/assets/${world.previewImage || world.image}')`;
    const tag = document.createElement('span'); tag.className = 'map-choice-tag'; tag.textContent = world.tag;
    const map = document.createElement('canvas'); map.width = 240; map.height = 170; map.setAttribute('aria-label', `${world.name} 지도`); drawTacticalMap(map, { world }); art.append(tag, map);
    const copy = document.createElement('div'); copy.className = 'map-choice-copy';
    const title = document.createElement('strong'); title.textContent = world.name;
    const arrow = document.createElement('span'); arrow.textContent = '↗'; title.append(arrow);
    copy.append(title); button.append(art, copy); $('map-choices').append(button);
    button.addEventListener('click', () => { if (!supportsGameType(world, selectedGameType())) return; loadout.mapId = world.id; updateSelections(); void dialogs.close($('maps-dialog')); });
    const card = document.createElement('button'); card.type = 'button'; card.className = 'room-map-card'; card.dataset.map = world.id; card.setAttribute('aria-label', `${world.label} 전장 선택`);
    const image = document.createElement('img'); image.src = `/assets/${world.previewImage || world.image}`; image.alt = ''; image.loading = 'lazy';
    const name = document.createElement('strong'); name.textContent = world.name; card.append(image, name); $('room-map-cards').append(card);
    card.addEventListener('click', () => { loadout.mapId = world.id; updateSelections(); });
  }
  for (const weapon of WEAPONS) {
    const button = document.createElement('button'); button.dataset.weapon = weapon.id; button.setAttribute('aria-label', `${weapon.label} ${weapon.name} 선택`);
    const key = document.createElement('kbd'); key.textContent = weapon.slot;
    const copy = document.createElement('span'), name = document.createElement('b'), label = document.createElement('small'); name.textContent = weapon.name; label.textContent = weapon.label; copy.append(name, label); button.append(key, copy); $('weapon-choices').append(button);
    const thumbnail = document.createElement('canvas'); thumbnail.width = 200; thumbnail.height = 90; thumbnail.setAttribute('aria-hidden', 'true');
    button.append(thumbnail);
    button.addEventListener('click', () => {
      selectedWeaponId = weapon.id;
      if (onlineUser) {
        if (ownsWeapon(onlineUser, weapon.id)) { onlineSelectedWeapon = weapon.id; rememberAccountWeapon(); }
      } else if (ownsWeapon(profileStore.profile, weapon.id)) loadout.weaponId = weapon.id;
      updateSelections();
    });
  }
  for (const skin of SKINS) {
    const button = document.createElement('button'); button.className = 'skin-choice'; button.dataset.skin = skin.id; button.setAttribute('aria-label', `${skin.label} 스킨`);
    button.style.setProperty('--skin-color', skin.color); button.style.setProperty('--skin-accent', skin.accent); button.style.setProperty('--skin-pattern', skin.pattern ? `url('/assets/${skin.pattern}')` : 'none');
    const swatch = document.createElement('span'); swatch.className = 'skin-swatch'; const label = document.createElement('small'); label.textContent = skin.label; button.append(swatch, label); $('skin-choices').append(button);
    button.addEventListener('click', () => { loadout.skinId = skin.id; updateSelections(); });
  }
  for (const outfit of OUTFITS) {
    const card = document.createElement('button'); card.className = 'outfit-choice'; card.dataset.outfit = outfit.id; card.setAttribute('aria-label', `${outfit.label} 외형 미리보기`);
    const image = document.createElement('img'); image.src = `/assets/${outfit.image}`; image.alt = outfit.concept; image.loading = 'lazy';
    const name = document.createElement('b'); name.textContent = outfit.label; const price = document.createElement('small'); price.textContent = `${outfit.price} LP`;
    card.append(image, name, price); $('outfit-choices').append(card);
    card.addEventListener('click', () => { selectedOutfitId = outfit.id; renderShop(); });
  }
}

async function copyText(text, message) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      // Clipboard API is unavailable on plain-HTTP LAN origins.
      const field = document.createElement('textarea'); field.value = text; field.setAttribute('readonly', ''); field.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(field); field.select(); field.setSelectionRange(0, text.length);
      const copied = document.execCommand('copy'); field.remove(); if (!copied) throw new Error('Copy denied');
    }
    toast(message);
  } catch { toast(`주소를 복사할 수 없습니다. 직접 공유해 주세요: ${text}`, true); }
}

function updateSoundButton() {
  const muted = audio.muted || settings.volume === 0;
  $('sound-button').setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  $('sound-button').querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-sound');
}

function updateSettings() {
  for (const key of ['sensitivity', 'fov', 'volume', 'quality']) $(key).value = settings[key];
  $('weapon-hand').value = settings.weaponHand;
  $('sensitivity-value').textContent = settings.sensitivity.toFixed(1);
  $('fov-value').textContent = `${settings.fov}°`; $('volume-value').textContent = `${settings.volume}%`;
  for (const [id, key] of [['killfeed-opacity', 'killfeedOpacity'], ['kill-announcement-opacity', 'killAnnouncementOpacity']]) { $(id).value = settings[key]; $(`${id}-value`).textContent = `${settings[key]}%`; }
  document.documentElement.style.setProperty('--killfeed-opacity', settings.killfeedOpacity / 100);
  document.documentElement.style.setProperty('--kill-announcement-opacity', settings.killAnnouncementOpacity / 100);
  audio.updateVolume(); updateSoundButton(); game?.applySettings();
  store('sector07-settings', JSON.stringify(settings));
}

$('create-button').addEventListener('click', () => {
  if (busy) return;
  if (usesOnlineServices() && !onlineUser) { openDialog('profile-dialog'); return; }
  if (getPlayMode(mode).transport === 'online') { void joinOnlineQueue(); return; }
  if (!connected) return;
  if (['lan', 'custom'].includes(mode)) { openDialog('room-create-dialog'); return; }
  setBusy(true); send({ type: 'create', mode, gameType: selectedGameType(), ...objectiveConfig, bots: botCount, botDifficulty, ...roundOptions, name: callsign(), ...profileLoadout() });
});
$('deployment-settings-button').addEventListener('click', () => openDialog('room-create-dialog'));
$('room-create-form').addEventListener('submit', (event) => {
  event.preventDefault(); if (busy || game || roomSession || !$('room-create-form').reportValidity()) return;
  loadout.mapId = getMap($('room-map-choice').value).id; updateSelections();
  saveRoundForm();
  if (mode === 'practice') { void dialogs.close($('room-create-dialog')); return; }
  if (!connected) { toast('서버에 연결한 뒤 다시 시도해 주세요.', true); return; }
  const options = { staging: true, roomName: $('room-title').value, password: $('room-password').value, gameType: selectedGameType(), teamId: $('room-initial-team').value, bots: botCount, ...roundOptions, ...objectiveConfig, mapId: loadout.mapId };
  dialogs.closeAll(); setBusy(true); send(transportKind === 'custom' ? { type: 'create', ...options, weaponId: onlineSelectedWeapon, skinId: loadout.skinId, suppressor: selectedSuppressor(onlineUser, onlineSelectedWeapon) } : { type: 'create', mode, ...profileLoadout(), ...options, name: callsign() }); $('room-password').value = '';
});
$('join-form').addEventListener('submit', (event) => { event.preventDefault(); requestJoin($('room-code').value.trim().toUpperCase()); });
$('room-password-form').addEventListener('submit', (event) => { event.preventDefault(); if (!$('room-password-form').reportValidity() || !pendingJoinCode) return; const password = $('room-join-password').value; $('room-join-password').value = ''; requestJoin(pendingJoinCode, password); });
$('room-game-type').addEventListener('change', () => { store('linkshot-game-type', selectedGameType()); updateRuleChoices(); });
$('profile-dialog').addEventListener('close', () => { for (const id of ['online-password', 'register-password', 'register-password-confirm']) $(id).value = ''; });
$('room-create-dialog').addEventListener('close', () => { $('room-password').value = ''; });
$('room-password-dialog').addEventListener('close', () => { $('room-join-password').value = ''; });
$('room-code').addEventListener('input', () => { $('room-code').value = $('room-code').value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });
$('player-name').addEventListener('change', () => callsign());
for (const item of PLAY_MODES) $(`mode-${item.id}`).addEventListener('click', () => setMode(item.id));
document.querySelector('.mode-switch').addEventListener('keydown', (event) => {
  const index = PLAY_MODES.findIndex((item) => `mode-${item.id}` === event.target.id);
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? PLAY_MODES.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + PLAY_MODES.length) % PLAY_MODES.length;
  setMode(PLAY_MODES[next].id); $(`mode-${PLAY_MODES[next].id}`).focus();
});
$('recommend-tutorial').addEventListener('click', () => { dialogs.closeAll(); setMode('tutorial'); });
$('online-auth-form').addEventListener('submit', (event) => { event.preventDefault(); void onlineAuthenticate(); });
$('online-registration-form').addEventListener('submit', event => { event.preventDefault(); void onlineAuthenticate(true); });
$('register-username').addEventListener('input', () => { usernameCheckGeneration++; usernameChecking = false; $('online-username-status').textContent = ''; delete $('online-username-status').dataset.available; renderOnlineAccount(); });
$('online-check-username').addEventListener('click', async () => {
  if (!onlineApi || !onlineAvailable || onlineBusy || usernameChecking || !$('register-username').reportValidity()) return;
  const generation = ++usernameCheckGeneration; usernameChecking = true; renderOnlineAccount(); $('online-username-status').textContent = '아이디 확인 중…';
  try {
    const result = await onlineApi.usernameAvailability($('register-username').value);
    if (generation !== usernameCheckGeneration) return;
    $('online-username-status').textContent = result.available ? '사용 가능한 아이디입니다.' : '이미 존재하는 아이디입니다.'; $('online-username-status').dataset.available = String(result.available);
  } catch (error) { if (generation === usernameCheckGeneration) { $('online-username-status').textContent = error.message; $('online-username-status').dataset.available = 'false'; } }
  finally { if (generation === usernameCheckGeneration) { usernameChecking = false; renderOnlineAccount(); } }
});
$('online-register').addEventListener('click', () => setAuthView('register'));
$('auth-login-tab').addEventListener('click', () => setAuthView('login'));
$('online-auth-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault(); setAuthView(event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : authView === 'login' ? 'register' : 'login'); $(authView === 'login' ? 'auth-login-tab' : 'online-register').focus();
});
$('online-profile-callsign').addEventListener('input', () => { const input = $('online-profile-callsign'); input.dataset.dirty = 'true'; input.setCustomValidity([...input.value.trim()].length > 24 ? '콜사인은 1–24자여야 합니다.' : ''); });
$('online-callsign-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!onlineApi || !onlineUser || onlineBusy || !onlineAvailable || !$('online-callsign-form').reportValidity()) return;
  const name = $('online-profile-callsign').value; onlineBusy = true; onlineAuthGeneration++; renderOnlineAccount(); $('online-auth-status').textContent = '콜사인 저장 중…';
  try {
    onlineUser = await onlineApi.updateCallsign(name); $('online-profile-callsign').dataset.dirty = 'false'; $('online-profile-callsign').value = onlineUser.callsign; $('online-profile-callsign').setCustomValidity(''); $('online-auth-status').textContent = '콜사인을 저장했습니다.';
    if (transportKind === 'custom' && !roomSession && !game) connect('custom');
  } catch (error) { $('online-auth-status').textContent = error.message; }
  finally { onlineBusy = false; renderOnlineAccount(); }
});
localSuppressor.input.addEventListener('change', async () => {
  if (onlineUser) {
    if (!onlineApi || !onlineUser || onlineBusy) return;
    const id = selectedWeaponId, equipped = localSuppressor.input.checked;
    pendingOnlineSuppressor = { accountId: onlineUser.id, weaponId: id, equipped }; onlineBusy = true; onlineAuthGeneration++; renderWeaponOwnership();
    try { onlineUser = await onlineApi.setSuppressor(id, equipped); }
    catch (error) { toast(error.message, true); }
    finally { pendingOnlineSuppressor = null; onlineBusy = false; updateSelections(); }
    return;
  }
  const id = selectedWeaponId, equipped = localSuppressor.input.checked; shopBusy = true; renderWeaponOwnership();
  try { await profileStore.setSuppressor(id, equipped); }
  catch (error) { toast(error.message, true); }
  finally { shopBusy = false; updateSelections(); }
});
function chooseDeploymentWeapon() { openDialog('armory-dialog'); }
$('online-loadout-button').addEventListener('click', chooseDeploymentWeapon);
$('room-lobby-weapon').addEventListener('click', chooseDeploymentWeapon);
$('room-lobby-leave').addEventListener('click', () => leaveGame());
$('queue-status-button').addEventListener('click', () => openDialog('queue-dialog'));
$('online-cancel-queue').addEventListener('click', () => { void cancelOnlineQueue(); });
$('matchmaking-cancel').addEventListener('click', () => { void cancelOnlineQueue(); });
$('matchmaking-detail').addEventListener('click', () => onlineQueueState?.state === 'READY' ? startOnlineMatch() : openDialog('queue-dialog'));
for (const id of ['online-accept-match', 'matchmaking-accept']) $(id).addEventListener('click', () => { void acceptOnlineMatch(); });
$('online-reconnect').addEventListener('click', () => startOnlineMatch());
$('online-logout').addEventListener('click', async () => {
  if (!onlineApi || onlineBusy) return; onlineBusy = true; onlineAuthGeneration++; onlineAutoJoin = false; stopQueuePolling(); renderOnlineAccount();
   try { if (['QUEUED','OFFERED'].includes(onlineQueueState?.state)) await onlineApi.cancelQueue().catch(() => {}); await onlineApi.logout(); onlineUser = null; authView = 'login'; onlineQueueState = null; onlineReceipt = null; lobbyResultMatchId = null; renderLobbyResult(); $('online-auth-status').textContent = '온라인 로그아웃 완료'; } catch (error) { $('online-auth-status').textContent = error.message; }
  finally { onlineBusy = false; if (transportKind === 'custom') connect('custom'); renderOnlineAccount(); renderOnlineQueue(); }
});
$('dismiss-tutorial').addEventListener('click', () => { store('linkshot-tutorial-v1', 'dismissed'); $('tutorial-recommendation').hidden = true; });
$('lan-connect-guide').addEventListener('submit', (event) => {
  event.preventDefault();
  try { const address = new URL($('lan-server-address').value.trim()); if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw new Error(); location.assign(address.href); }
  catch { toast('http:// 또는 https://로 시작하는 LAN 서버 주소를 입력하세요.', true); }
});
$('bots-minus').addEventListener('click', () => { botCount--; updateBots(); });
$('bots-plus').addEventListener('click', () => { botCount++; updateBots(); });
$('resume-button').addEventListener('click', () => game?.lock());
$('leave-button').addEventListener('click', () => { if (!isOnlineRoom() || game.room.phase !== 'active' || confirm('온라인 경기에서 나가면 30초 후 탈주 처리되어 보상을 받지 못하고 랭크는 최하위로 정산됩니다. 나갈까요?')) leaveGame(); });
$('round-leave').addEventListener('click', () => leaveGame());
$('restart-button').addEventListener('click', () => send({ type: 'restart' }));
$('copy-lan').addEventListener('click', () => copyText(lanUrl, 'LAN 주소를 복사했습니다. 같은 네트워크의 친구에게 공유하세요.'));
$('copy-invite').addEventListener('click', () => {
  if (!game) return;
  const url = new URL(game.room.mode === 'custom' ? location.origin : lanUrl); url.searchParams.set(game.room.mode === 'custom' ? 'custom' : 'room', game.room.code);
  copyText(url.toString(), `초대 링크를 복사했습니다. 방 코드: ${game.room.code}`);
});
$('room-lobby-invite').addEventListener('click', () => { if (!roomSession) return; const url = new URL(roomSession.room.mode === 'custom' ? location.origin : lanUrl); url.searchParams.set(roomSession.room.mode === 'custom' ? 'custom' : 'room', roomSession.room.code); void copyText(url.toString(), `초대 링크를 복사했습니다. 방 코드: ${roomSession.room.code}`); });
$('sound-button').addEventListener('click', async () => {
  audio.muted = !audio.muted;
  if (!audio.muted && settings.volume === 0) { settings.volume = 65; updateSettings(); }
  store('sector07-muted', String(audio.muted)); await audio.unlock(); audio.updateVolume(); updateSoundButton();
});
$('briefing-button').addEventListener('click', () => openDialog('briefing-dialog'));
$('choose-map').addEventListener('click', () => openDialog('maps-dialog'));
$('armory-button').addEventListener('click', chooseDeploymentWeapon);
$('nav-armory').addEventListener('click', chooseDeploymentWeapon);
$('armory-dialog').addEventListener('close', () => { if (!$('armory-dialog').open) { preview?.dispose(); preview = null; } });
$('armory-dialog').addEventListener('keydown', event => { if (event.code === 'KeyE' && !event.repeat && game?.preparing && !event.target.matches('input, select, textarea')) { event.preventDefault(); void dialogs.close($('armory-dialog')); } });
$('shop-dialog').addEventListener('close', () => { if (!$('shop-dialog').open) { operatorPreview?.dispose(); operatorPreview = null; } });
$('shop-action').addEventListener('click', async () => {
  const outfit = getOutfit(selectedOutfitId);
  if (!equipmentProfile().ownedOutfits.includes(outfit.id)) {
    purchaseRequestId = { type: 'outfit', id: outfit.id, accountId: onlineUser?.id || null }; $('purchase-title').textContent = '이 외형을 구매할까요?'; $('purchase-description').textContent = `${outfit.label} 외형을 ${outfit.price} LP에 구매하고 장착합니다.`;
    $('purchase-note').textContent = '포인트를 차감하고 외형을 장착합니다. 외형은 게임 플레이 능력치에 영향을 주지 않습니다.'; $('confirm-purchase').textContent = '구매 후 장착'; openDialog('purchase-dialog'); return;
  }
  shopBusy = true; if (onlineUser) onlineAuthGeneration++; renderShop();
  try { if (onlineUser) onlineUser = await onlineApi.selectOutfit(outfit.id); else await profileStore.equip(outfit.id); toast(`${outfit.label} 외형을 장착했습니다.`); }
  catch (error) { toast(error.message, true); } finally { shopBusy = false; renderShop(); renderOnlineAccount(); }
});
$('armory-unlock').addEventListener('click', () => {
  const weapon = getWeapon(selectedWeaponId);
  if (ownsWeapon(equipmentProfile(), weapon.id)) { if (onlineUser) { onlineSelectedWeapon = weapon.id; rememberAccountWeapon(); } else loadout.weaponId = weapon.id; updateSelections(); return; }
  purchaseRequestId = { type: 'weapon', id: weapon.id, accountId: onlineUser?.id || null }; $('purchase-title').textContent = '이 무기를 영구 해금할까요?';
  $('purchase-description').textContent = `${weapon.name}을 ${weapon.price.toLocaleString('ko-KR')} LP로 영구 해금하고 출격 장비로 선택합니다.`;
  $('purchase-note').textContent = onlineUser ? '계정 LP로 구매하며 LAN·연습·사용자 대전에서 공통 사용합니다. 추가 사용료는 없습니다.' : '해금은 이 기기 프로필에 저장됩니다. 추가 사용료는 없으며 무기 숙련도는 피해량이나 체력을 높이지 않습니다.';
  $('confirm-purchase').textContent = '영구 해금'; openDialog('purchase-dialog');
});
$('confirm-purchase').addEventListener('click', async () => {
  if (!purchaseRequestId || shopBusy) return;
  if (purchaseRequestId.accountId !== (onlineUser?.id || null)) { purchaseRequestId = null; toast('계정이 변경되었습니다. 다시 구매를 확인해 주세요.', true); return; }
  const request = purchaseRequestId; shopBusy = true; if (onlineUser) onlineAuthGeneration++; $('confirm-purchase').disabled = true; renderShop(); renderWeaponOwnership();
  try {
    if (request.type === 'weapon') {
      if (onlineUser) { onlineUser = await onlineApi.purchaseWeapon(request.id); onlineSelectedWeapon = request.id; rememberAccountWeapon(); }
      else { await profileStore.purchaseWeapon(request.id); loadout.weaponId = request.id; }
      selectedWeaponId = request.id; updateSelections(); toast(`${getWeapon(request.id).name} 영구 해금 완료`);
    } else { if (onlineUser) onlineUser = await onlineApi.selectOutfit(request.id, true); else await profileStore.purchase(request.id); toast(`${getOutfit(request.id).label} 외형을 구매하고 장착했습니다.`); }
    void dialogs.close($('purchase-dialog'));
  } catch (error) { toast(error.message, true); } finally { shopBusy = false; purchaseRequestId = null; $('confirm-purchase').disabled = false; renderShop(); renderWeaponOwnership(); renderOnlineAccount(); }
});
$('nav-play').addEventListener('click', () => {
  setMode(SOLO ? 'practice' : 'lan'); $('create-button').focus({ preventScroll: true });
});
function browseRooms() { if (!['lan', 'custom'].includes(mode)) setMode('lan'); if (SOLO && mode === 'lan') { openDialog('network-dialog'); $('lan-server-address').focus(); return; } if (mode === 'custom' && !onlineUser) { openDialog('profile-dialog'); return; } if (mode === 'custom' && !connected) { toast('사용자 대전 서버 연결을 기다려 주세요.', true); return; } $('room-browser-title').textContent = mode === 'custom' ? '열려 있는 사용자 대전 방' : '열려 있는 LAN 방'; $('room-browser-note').textContent = mode === 'custom' ? '연결된 온라인 서버의 사용자 방입니다. 점수·LP에는 반영하지 않습니다.' : '현재 LAN 서버에서 생성된 방입니다.'; send({ type: 'list' }); openDialog('rooms-dialog'); updateRooms(rooms); }
$('nav-rooms').addEventListener('click', browseRooms); $('browse-rooms').addEventListener('click', browseRooms);
$('room-browser-button').addEventListener('click', browseRooms);
$('refresh-rooms').addEventListener('click', () => { if (send({ type: 'list' })) toast('방 목록을 새로고침했습니다.'); else toast('로컬 서버에 연결되어 있지 않습니다.', true); });
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openDialog(button.dataset.open)));
for (const key of ['sensitivity', 'fov', 'volume']) $(key).addEventListener('input', () => { settings[key] = Number($(key).value); updateSettings(); });
$('quality').addEventListener('change', () => { settings.quality = $('quality').value; updateSettings(); });
$('weapon-hand').addEventListener('change', () => { settings.weaponHand = normalizeWeaponHand($('weapon-hand').value); updateSettings(); });
for (const [id, key] of [['killfeed-opacity', 'killfeedOpacity'], ['kill-announcement-opacity', 'killAnnouncementOpacity']]) $(id).addEventListener('input', () => { settings[key] = Number($(id).value); updateSettings(); });
$('room-map-choice').addEventListener('change', () => { loadout.mapId = getMap($('room-map-choice').value).id; updateSelections(); });
$('dismiss-match-result').addEventListener('click', () => { lobbyResultMatchId = null; renderLobbyResult(); });
for (const key of ['ffa', 'teams']) $(`dashboard-${key}`).addEventListener('click', () => { dashboardLadder = key; store('linkshot-dashboard-ladder', key); renderOnlineProfileStats(); });

setInterval(() => {
  if (!connected) return;
  send({ type: 'ping', sent: Date.now() });
  if (!game && !busy && transportKind !== 'online') send({ type: 'list' });
}, 4000);
setInterval(() => { if (!onlineApi) return; if (!game && !roomSession) { void connectOnlineServices(); if (lobbyResultMatchId) void fetchOnlineReceipt(lobbyResultMatchId); } else if (isOnlineRoom() && game.room.phase === 'ended' && onlineActiveMatch) void fetchOnlineReceipt(onlineActiveMatch); }, 5000);
makeCollections(); updateSelections(); renderProfile();
profileStore.addEventListener('change', renderProfile);
profileStore.addEventListener('award', (event) => toast(`라운드 정산 완료 · +${event.award.points} LP`));
window.addEventListener('storage', (event) => { if (event.key === PROFILE_KEY && !game) { profileStore.refreshLocal(); renderProfile(); } });
if (profileStore.warning) toast(profileStore.warning, true);
const tutorialActions = document.createElement('div'); tutorialActions.id = 'tutorial-actions'; tutorialActions.className = 'tutorial-actions'; tutorialActions.hidden = true;
const returnRoom = document.createElement('button'); returnRoom.id = 'return-room-button'; returnRoom.textContent = '방 대기실로'; returnRoom.hidden = true; returnRoom.addEventListener('click', () => send({ type: 'room-return' })); $('leave-button').before(returnRoom);
for (const [id, text] of [['tutorial-advance', '리스폰 시범 시작'], ['tutorial-retry', '튜토리얼 다시 시작'], ['tutorial-skip', '건너뛰기 · 혼자 연습으로']]) { const button = document.createElement('button'); button.id = id; button.className = 'secondary-button'; button.textContent = text; button.hidden = id === 'tutorial-advance'; tutorialActions.append(button); }
document.querySelector('.pause-bottom').before(tutorialActions);
$('tutorial-advance').addEventListener('click', () => { if (game?.requestTutorialAction()) game.lock(); });
$('tutorial-retry').addEventListener('click', () => { send({ type: 'restart' }); game?.lock(); });
$('tutorial-skip').addEventListener('click', () => { store('linkshot-tutorial-v1', stored('linkshot-tutorial-v1', 'dismissed')); leaveGame(); setMode('practice'); $('tutorial-recommendation').hidden = true; });
$('tutorial-recommendation').hidden = !!stored('linkshot-tutorial-v1', '');
if (SOLO) {
  document.body.classList.add('solo-edition'); document.title = 'LINKSHOT · 링크샷 — Solo combat';
  for (const id of ['join-section', 'copy-lan']) $(id).hidden = true;
  $('hud-connection-kind').textContent = 'LOCAL';
  document.querySelector('.build-tag').childNodes[1].textContent = ' SOLO EDITION ';
  const steps = $('help-dialog').querySelectorAll('.help-steps p span');
  for (const [i, text] of [`전장과 장비를 고르세요. ${MAPS.length}개 전장 · ${WEAPONS.length}종 중 1–4번은 무료, 나머지는 LP로 영구 해금합니다.`, '연습전 시작을 누르세요. 전적·무기 숙련도는 자동 저장되며 포인트는 라운드 완료 후 지급됩니다.', `목표 킬·시간을 설정하세요. 외형과 무기 숙련도는 능력치를 높이지 않습니다.`].entries()) steps[i].textContent = text;
  $('help-dialog').querySelector('.rooms-footnote').textContent = '튜토리얼과 혼자 연습은 서버 없이 실행됩니다. LAN대전은 로컬 서버 페이지로 접속하며, 일반·랭크는 별도의 중앙 온라인 서버가 필요합니다.';
}
updateSettings(); updateBots(); setMode(mode); updateRooms([]);
void connectOnlineServices();
