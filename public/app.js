import { FPSGame } from './game.js';
import { GameAudio } from './audio.js';
import { drawTacticalMap } from './map.js';
import { MAPS, getMap, RULES, normalizeRoundOptions, NETWORK_PROTOCOL } from '/shared/world.js';
import { WEAPONS, SKINS, getWeapon, getSkin, ownsWeapon } from '/shared/catalog.js';
import { ArmoryPreview } from './weapon-model.js';
import { SoloConnection } from './solo-connection.js';
import { APP_MODE, PROFILE_STORAGE } from './runtime-config.js';
import { ProfileStore, PROFILE_KEY } from './profile.js';
import { profileStats, POINT_RULES, weaponMastery } from '/shared/progression.js';
import { OUTFITS, getOutfit } from '/shared/outfits.js';
import { OperatorPreview } from './operator-model.js';
import { BOT_DIFFICULTIES, getBotDifficulty } from '/shared/simulation.js';

const $ = (id) => document.getElementById(id);
const defaults = { sensitivity: 1, fov: 82, volume: 65, quality: 'normal' };
// Retain prototype storage keys so existing names, settings and loadouts survive the LINKSHOT rename.
function stored(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } }
let saved = {};
try { saved = JSON.parse(stored('sector07-settings', '{}')) || {}; } catch { /* Use safe defaults. */ }
const inRange = (value, min, max, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const settings = {
  sensitivity: inRange(saved.sensitivity, 0.3, 2.5, defaults.sensitivity),
  fov: inRange(saved.fov, 65, 105, defaults.fov), volume: inRange(saved.volume, 0, 100, defaults.volume),
  quality: saved.quality === 'low' ? 'low' : 'normal',
};
const SOLO = APP_MODE === 'solo';
let savedLoadout = {}; try { savedLoadout = JSON.parse(stored('sector07-loadout', '{}')) || {}; } catch { /* Use catalog defaults. */ }
const loadout = { mapId: getMap(savedLoadout.mapId).id, weaponId: getWeapon(savedLoadout.weaponId).id, skinId: getSkin(savedLoadout.skinId).id };
let preview = null;
let operatorPreview = null, selectedOutfitId = 'field', purchaseRequestId = null, shopBusy = false;
let selfSessionId = null, lastRoundReward = null;
const profileStore = await new ProfileStore({ host: PROFILE_STORAGE === 'host', name: stored('sector07-name', `OP-${Math.floor(100 + Math.random() * 900)}`) }).load();
if (!ownsWeapon(profileStore.profile, loadout.weaponId)) loadout.weaponId = 'rifle';
let selectedWeaponId = loadout.weaponId;
selectedOutfitId = profileStore.profile.equippedOutfitId;
const audio = new GameAudio(settings);
audio.muted = stored('sector07-muted', 'false') === 'true';
let socket, game = null, connected = false, mode = 'lan', botCount = 2, rooms = [], lanUrl = location.origin;
let botDifficulty = getBotDifficulty(stored('linkshot-bot-difficulty', 'beginner')).id;
let savedRound = {}; try { savedRound = JSON.parse(stored('linkshot-round-options', '{}')) || {}; } catch { /* Defaults. */ }
let roundOptions = normalizeRoundOptions(savedRound);
function updateRoundOptions() { $('frag-limit').value = roundOptions.fragLimit; $('round-minutes').value = roundOptions.roundSeconds / 60; }
for (const id of ['frag-limit', 'round-minutes']) $(id).addEventListener('change', () => {
  roundOptions = normalizeRoundOptions({ fragLimit: Number($('frag-limit').value), roundSeconds: Math.max(1, Number($('round-minutes').value) || 5) * 60 });
  store('linkshot-round-options', JSON.stringify(roundOptions)); updateRoundOptions();
});
updateRoundOptions();
for (const level of BOT_DIFFICULTIES) { const option = document.createElement('option'); option.value = level.id; option.textContent = level.label; $('bot-difficulty').append(option); }
$('bot-difficulty').value = botDifficulty;
$('bot-difficulty').addEventListener('change', () => { botDifficulty = getBotDifficulty($('bot-difficulty').value).id; store('linkshot-bot-difficulty', botDifficulty); });
let busy = false, requestTimeout, reconnectTimeout, reconnectDelay = 1000, hasDeployed = false;
let invitedCode = new URL(location.href).searchParams.get('room')?.toUpperCase();
if (!/^[A-Z2-9]{5}$/.test(invitedCode || '')) invitedCode = null;
if (SOLO) invitedCode = null;

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
  $('create-button').disabled = value || !connected;
  $('join-form').querySelector('button').disabled = value || !connected;
  clearTimeout(requestTimeout);
  if (value) requestTimeout = setTimeout(() => {
    if (!busy) return;
    send({ type: 'leave' }); setBusy(false); toast('연결 시간이 초과되었습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.', true);
  }, 12_000);
}

function updateConnection(value) {
  connected = value;
  $('connection-status').classList.toggle('offline', !value);
  $('connection-status').lastElementChild.textContent = value ? SOLO ? 'SOLO READY · LOCAL SIMULATION' : 'LAN SERVER ONLINE' : SOLO ? '시뮬레이션 준비 중' : '서버 연결 대기 중';
  document.querySelector('.connection-dot').style.background = value ? '#a3dbc9' : '#ff6249';
  $('create-button').disabled = !value || busy;
  $('join-form').querySelector('button').disabled = !value || busy;
}

function updateRooms(list) {
  rooms = list;
  const players = rooms.reduce((sum, room) => sum + room.players, 0);
  $('room-summary').textContent = SOLO ? `${MAPS.length}개 전장 · ${WEAPONS.length}종 무기 · ${SKINS.length}종 스킨 · 별도 서버 없이 플레이` : !connected ? '로컬 서버에 다시 연결하고 있습니다' : rooms.length ? `${rooms.length}개의 열린 방 · ${players}명 교전 중` : '네트워크 준비 완료 · 첫 번째 방을 만들어 보세요';
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
    const name = document.createElement('small'); name.textContent = `${getMap(room.mapId).name} · ${room.name} · 봇 ${room.bots}명 · ${room.fragLimit || RULES.fragLimit}킬/${Math.round((room.roundSeconds || RULES.roundSeconds) / 60)}분 · ${room.phase === 'ended' ? '종료' : '교전 중'}`;
    details.append(code, name);
    const count = document.createElement('span'); count.textContent = `${room.players}/${room.capacity}`;
    const button = document.createElement('button'); button.textContent = '참가'; button.disabled = room.players >= room.capacity;
    button.addEventListener('click', () => { $('rooms-dialog').close(); requestJoin(room.code); });
    row.append(details, count, button); container.append(row);
  }
}

function updateServerInfo(data) {
  if (SOLO) { updateRooms([]); return; }
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  lanUrl = isLocalhost ? data.urls?.[0] || location.origin : location.origin;
  $('lan-address').textContent = lanUrl.replace(/^https?:\/\//, '');
  $('copy-lan').title = `${lanUrl} 복사`;
  updateRooms(data.rooms || rooms);
}

function connect() {
  clearTimeout(reconnectTimeout);
  const url = new URL('/play', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = SOLO ? new SoloConnection() : new WebSocket(url);
  socket.addEventListener('message', (event) => {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'hello') {
      reconnectDelay = 1000; updateConnection(true); updateServerInfo(data); send({ type: 'ping', sent: Date.now() });
      if (invitedCode) { const code = invitedCode; invitedCode = null; requestJoin(code); }
    }
    if (data.type === 'rooms') updateRooms(data.rooms);
    if (data.type === 'pong') {
      const latency = Math.max(1, Date.now() - data.sent);
      $('hud-ping').textContent = `${latency} MS`;
      $('connection-status').title = SOLO ? `브라우저 시뮬레이션 응답: ${latency}ms` : `서버 왕복 지연: ${latency}ms`;
    }
    if (data.type === 'joined') { selfSessionId = data.id; syncProgress(data); enterGame(data); }
    if (data.type === 'state') { syncProgress(data); game?.applySnapshot(data); }
    if (data.type === 'left') { selfSessionId = null; if (game) leaveGame(false); }
    if (data.type === 'error') { setBusy(false); toast(data.message, true); }
  });
  socket.addEventListener('close', () => {
    const wasPlaying = !!game;
    updateConnection(false); setBusy(false); updateRooms([]);
    if (wasPlaying) { leaveGame(false); toast(SOLO ? '브라우저 시뮬레이션이 중단되었습니다. 다시 시작해 주세요.' : '서버 연결이 끊겼습니다. 로컬 서버가 실행 중인지 확인해 주세요.', true); }
    selfSessionId = null;
    reconnectTimeout = setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 1.5, 8000);
  });
  socket.addEventListener('error', () => { /* close handles recovery. */ });
}

function callsign() {
  const name = $('player-name').value.trim() || 'OPERATOR';
  store('sector07-name', name); profileStore.setName(name).catch((error) => toast(error.message, true)); return name;
}

function profileLoadout() {
  const profile = profileStore.profile;
  if (!ownsWeapon(profile, loadout.weaponId)) loadout.weaponId = 'rifle';
  return { ...loadout, outfitId: profile.equippedOutfitId, ownedWeapons: profile.ownedWeapons, weaponKills: profile.weaponKills };
}

function requestJoin(code) {
  if (busy || game) return;
  if (!connected) { toast('먼저 로컬 서버에 연결되어야 합니다.', true); return; }
  if (!/^[A-Z2-9]{5}$/.test(code)) { toast('5자리 방 코드를 입력해 주세요.', true); return; }
  setBusy(true); send({ type: 'join', code, name: callsign(), ...profileLoadout() });
}

function showMenu(visible) {
  if (!game || game.room?.phase === 'ended') return;
  $('pause-overlay').hidden = !visible;
  if (!visible) hasDeployed = true;
  $('pause-title').textContent = hasDeployed ? 'STAY IN THE FIGHT.' : 'READY TO BREACH';
  $('pause-description').textContent = hasDeployed ? '호흡을 가다듬고, 다시 교전으로.' : '마우스를 클릭해 조준과 이동을 시작하세요.';
  $('resume-button').querySelector('span').textContent = hasDeployed ? '교전 계속하기' : '교전 시작';
}

function enterGame(data) {
  if (data.room?.protocolVersion !== NETWORK_PROTOCOL) { send({ type: 'leave' }); setBusy(false); toast('게임 서버가 이전 버전입니다. 진행 중인 방을 종료한 뒤 서버를 재시작하고 브라우저를 새로고침해 주세요.', true); return; }
  if (game) game.dispose();
  $('lobby').hidden = true; $('game-shell').hidden = false; hasDeployed = false;
  try {
    game = new FPSGame({
      canvas: $('game-canvas'), minimap: $('minimap'), settings, audio, send,
      mapId: data.room.mapId, weaponId: data.players.find((player) => player.id === data.id)?.weaponId, skinId: data.players.find((player) => player.id === data.id)?.skinId,
      outfitId: data.players.find((player) => player.id === data.id)?.outfitId,
      onMenu: showMenu,
      onFatal: (message, fatal = true) => { toast(message, true); if (fatal) leaveGame(); },
    });
    game.applySnapshot(data, data.id);
    $('pause-room-code').textContent = data.room.code;
    $('copy-invite').hidden = data.room.mode === 'practice';
    if (data.room.phase !== 'ended') showMenu(true);
    const address = new URL(location.href); address.searchParams.delete('room'); history.replaceState(null, '', address);
  } catch (error) {
    console.error('Failed to create the 3D arena:', error);
    leaveGame(); toast('3D 그래픽을 시작할 수 없습니다. WebGL을 지원하는 데스크톱 브라우저와 하드웨어 가속을 확인해 주세요.', true);
  } finally { setBusy(false); }
}

function leaveGame(notify = true) {
  if (notify) send({ type: 'leave' });
  game?.dispose(); game = null;
  $('lobby').hidden = false; $('game-shell').hidden = true;
  if (document.fullscreenElement === $('game-shell')) document.exitFullscreen?.().catch(() => {});
  for (const id of ['pause-overlay', 'round-overlay', 'scoreboard-overlay', 'respawn-overlay']) $(id).hidden = true;
  setBusy(false); send({ type: 'list' });
}

function setMode(value) {
  mode = SOLO ? 'practice' : value;
  $('mode-lan').classList.toggle('selected', mode === 'lan'); $('mode-lan').setAttribute('aria-selected', String(mode === 'lan'));
  $('mode-practice').classList.toggle('selected', mode === 'practice'); $('mode-practice').setAttribute('aria-selected', String(mode === 'practice'));
  $('create-button').querySelector('span').textContent = mode === 'lan' ? '방 만들고 출격' : '연습전 시작';
  $('deploy-note').lastChild.textContent = mode === 'lan' ? ' 방 코드로 친구를 초대할 수 있어요' : ' 나만의 전장에서 감각을 익혀보세요';
  $('bot-description').textContent = mode === 'lan' ? '친구를 기다리는 동안 가볍게' : '함께 실력을 쌓아갈 연습 상대';
  $('join-section').hidden = mode !== 'lan'; $('practice-note').hidden = mode !== 'practice';
  if (mode === 'practice' && botCount === 0) botCount = 1;
  updateBots();
}

function updateBots() {
  $('bot-count').textContent = botCount;
  $('bots-minus').disabled = botCount <= (mode === 'practice' ? 1 : 0); $('bots-plus').disabled = botCount >= RULES.maxPlayers - 1;
}

function openDialog(id) {
  if (game?.locked) document.exitPointerLock();
  const dialog = $(id);
  if (dialog.open) return;
  if (id === 'briefing-dialog') {
    const world = getMap(loadout.mapId);
    drawTacticalMap($('briefing-map'), { world, spawns: true, detailed: true });
    $('briefing-map-title').textContent = world.name; $('briefing-map-size').textContent = `${world.width} × ${world.depth} M`;
    $('briefing-map-description').textContent = `${world.description} 건물 ${world.buildings.length}개·추가 엄폐벽 ${world.coverWalls.length}개와 계단식 발판을 활용하세요. 지상·2/3층·옥상 ${world.spawns.length}개 스폰은 건물·화물·설비의 자연 엄폐를 사용합니다. ${roundOptions.roundSeconds / 60}분 또는 먼저 ${roundOptions.fragLimit}킬을 달성하면 라운드가 끝납니다.`;
  }
  dialog.showModal();
  if (id === 'armory-dialog') {
    try { preview = new ArmoryPreview($('weapon-preview')); preview.set(selectedWeaponId, loadout.skinId); $('preview-fallback').hidden = true; }
    catch { $('preview-fallback').hidden = false; }
  }
  if (id === 'shop-dialog') {
    renderShop();
    try { operatorPreview = new OperatorPreview($('operator-preview')); operatorPreview.set(selectedOutfitId, loadout.skinId, loadout.weaponId); $('operator-preview-fallback').hidden = true; }
    catch { $('operator-preview-fallback').hidden = false; }
  }
}

function renderProfile() {
  const profile = profileStore.profile, stats = profileStats(profile), outfit = getOutfit(profile.equippedOutfitId);
  const format = (number) => number.toLocaleString('ko-KR');
  $('profile-callsign').textContent = profile.callsign; $('operator-callsign').textContent = profile.callsign;
  $('profile-device').textContent = `기기 #${profile.id.slice(0, 8).toUpperCase()}`;
  $('profile-portrait').src = `/assets/${outfit.image}`; $('profile-portrait').alt = outfit.label;
  $('profile-kills').textContent = format(stats.kills); $('profile-deaths').textContent = format(stats.deaths);
  $('profile-ratio').textContent = stats.ratio.toFixed(2); $('profile-killrate').textContent = `킬 비율 ${stats.killRate.toFixed(0)}%`;
  $('profile-points').textContent = format(profile.points); $('top-points').textContent = format(profile.points); $('shop-points').textContent = format(profile.points);
  $('profile-storage').textContent = profileStore.warning ? '저장 상태 확인 필요' : profileStore.saving ? 'PC 파일에 저장 중...' : profileStore.scope === 'host' ? '이 PC에 자동 저장' : '이 브라우저에 자동 저장';
  $('profile-storage').title = profileStore.warning || ''; $('profile-storage').classList.toggle('save-warning', !!profileStore.warning);
  $('profile-full-id').textContent = profile.id;
  $('profile-storage-detail').textContent = profileStore.scope === 'host' ? '운영체제 사용자 설정 폴더의 LINKSHOT/profile.json' : '현재 사이트 주소의 이 브라우저 로컬 저장소';
  $('profile-rounds').textContent = `${profile.roundsPlayed} / ${profile.wins}`; $('profile-earned').textContent = `${format(profile.totalEarned)} LP`;
  renderRoundReward(); renderShop(); renderWeaponOwnership();
}

function syncProgress(data) {
  if (!selfSessionId || !data.room?.roundId) return;
  const player = data.players.find((entry) => entry.id === selfSessionId); if (!player) return;
  const result = data.room.result?.roundId === data.room.roundId ? data.room.result.rewards?.[selfSessionId] : null;
  lastRoundReward = data.room.phase === 'ended' && result ? result : null;
  profileStore.syncRound({ roundId: data.room.roundId, kills: result?.kills ?? player.kills, deaths: result?.deaths ?? player.deaths, weaponKills: result?.weaponKills ?? player.weaponKills, completed: !!lastRoundReward, won: lastRoundReward?.won === true }).catch((error) => toast(error.message, true));
  renderRoundReward();
}

function renderRoundReward() {
  $('round-reward').hidden = !lastRoundReward;
  if (!lastRoundReward) return;
  $('round-points').textContent = lastRoundReward.points; $('reward-completion').textContent = lastRoundReward.completion;
  $('reward-kills').textContent = lastRoundReward.killBonus; $('reward-win').textContent = lastRoundReward.winBonus;
  $('round-reward-status').textContent = profileStore.warning ? '기기 저장 상태를 확인하세요' : profileStore.saving ? 'PC 파일에 저장 중...' : '이 기기 프로필에 저장됨';
}

function renderShop() {
  const outfit = getOutfit(selectedOutfitId), profile = profileStore.profile;
  document.querySelector('.shop-balance small').textContent = `완주 ${POINT_RULES.completion} · 킬당 ${POINT_RULES.perKill} · 승리 ${POINT_RULES.victory}`;
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
  const world = getMap(loadout.mapId), weapon = getWeapon(selectedWeaponId), equipped = getWeapon(loadout.weaponId), skin = getSkin(loadout.skinId);
  const index = MAPS.indexOf(world) + 1;
  $('hero-map-title').textContent = `${world.title}.`; $('hero-map-title').style.fontSize = world.title.length > 8 ? '.78em' : '';
  $('hero-map-name').textContent = world.name; $('hero-map-index').textContent = String(index).padStart(2, '0');
  $('hero-operation').textContent = `OPERATION ${String(index).padStart(3, '0')}`; $('hero-description').textContent = world.description;
  document.querySelector('.hero-art').style.backgroundImage = `linear-gradient(90deg,#0e151bdf 0%,#0e151b68 45%,#0d161b00 100%),linear-gradient(0deg,#0e141aef,#10202a00 45%,#17212e33),url('/assets/${world.image}')`;
  $('map-card-name').textContent = world.name; $('map-card-description').textContent = `${world.width} × ${world.depth} M · ${world.tag}`;
  $('loadout-weapon').replaceChildren(document.createTextNode(`${equipped.name} `));
  const type = document.createElement('span'); type.textContent = equipped.type; $('loadout-weapon').append(type);
  $('loadout-description').textContent = `${equipped.label} · ${equipped.magazine}발 · 사망 후 E로 변경`;
  $('loadout-heading').textContent = `YOUR LOADOUT / ${String(WEAPONS.length).padStart(2, '0')} WEAPONS`;
  $('loadout-skin').textContent = `${skin.name} · 장비 변경 ↗`;
  $('armory-button').style.setProperty('--finish', skin.color); $('armory-button').style.setProperty('--finish-accent', skin.accent);
  $('armory-button').style.setProperty('--finish-map', skin.pattern ? `url('/assets/${skin.pattern}')` : 'none');
  for (const button of $('map-choices').children) { const selected = button.dataset.map === world.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  for (const button of $('weapon-choices').children) { const selected = button.dataset.weapon === weapon.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  for (const button of $('skin-choices').children) { const selected = button.dataset.skin === skin.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  $('armory-weapon-type').textContent = `${weapon.type} / ${weapon.label}`; $('armory-weapon-name').textContent = weapon.name;
  $('armory-weapon-description').textContent = weapon.description; $('armory-skin-name').textContent = skin.name;
  $('weapon-stats').replaceChildren();
  for (const [label, value] of [['피해량', weapon.pellets > 1 ? `${weapon.damage} × ${weapon.pellets} PELLETS` : `${weapon.damage} / HEAD ${weapon.headDamage}`], ['탄창 / 연사', `${weapon.magazine} / ${Math.round(60 / weapon.fireSeconds)} RPM`], ['재장전', `${weapon.reloadSeconds.toFixed(2)} SEC`], ['이동 / 달리기', `${(RULES.walkSpeed * weapon.walkMultiplier).toFixed(1)} / ${(RULES.sprintSpeed * weapon.sprintMultiplier).toFixed(1)} M/S`], ['최대 사거리', `${weapon.range} M`]]) {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt, dd); $('weapon-stats').append(row);
  }
  preview?.set(weapon.id, skin.id); store('sector07-loadout', JSON.stringify(loadout));
  renderWeaponOwnership();
}

function renderWeaponOwnership() {
  const profile = profileStore.profile, weapon = getWeapon(selectedWeaponId), owned = ownsWeapon(profile, weapon.id), mastery = weaponMastery(profile.weaponKills[weapon.id]);
  for (const button of $('weapon-choices').children) {
    const item = getWeapon(button.dataset.weapon), available = ownsWeapon(profile, item.id);
    button.classList.toggle('locked', !available);
    button.querySelector('small').textContent = available ? `${item.label} · Lv.${weaponMastery(profile.weaponKills[item.id]).level}` : `잠김 · ${item.price.toLocaleString('ko-KR')} LP`;
  }
  $('armory-level').textContent = `Lv.${mastery.level}`;
  $('armory-mastery-count').textContent = `${mastery.inLevel} / ${mastery.required} KILLS → Lv.${mastery.level + 1}`;
  $('armory-mastery-fill').style.width = `${mastery.progress * 100}%`;
  $('armory-owned-state').textContent = !weapon.price ? '기본 지급 · 무제한 이용' : owned ? '영구 해금됨 · 무제한 이용' : '미해금 · 구매하면 이 기기에서 영구 이용';
  $('armory-unlock').textContent = shopBusy ? '저장 중...' : owned ? loadout.weaponId === weapon.id ? '출격 장비로 선택됨' : '출격 장비로 선택' : `${weapon.price.toLocaleString('ko-KR')} LP로 영구 해금`;
  $('armory-unlock').disabled = shopBusy || owned && loadout.weaponId === weapon.id || !owned && profile.points < weapon.price;
  $('armory-balance').textContent = `보유 ${profile.points.toLocaleString('ko-KR')} LP${!owned && profile.points < weapon.price ? ` · ${weapon.price - profile.points} LP 더 필요` : ''}`;
}

function makeCollections() {
  for (const world of MAPS) {
    const button = document.createElement('button'); button.className = 'map-choice'; button.dataset.map = world.id; button.setAttribute('aria-label', `${world.label} 전장 선택`);
    const art = document.createElement('div'); art.className = 'map-choice-art'; art.style.backgroundImage = `url('/assets/${world.image}')`;
    const tag = document.createElement('span'); tag.className = 'map-choice-tag'; tag.textContent = world.tag;
    const map = document.createElement('canvas'); map.width = 240; map.height = 170; map.setAttribute('aria-label', `${world.name} 지도`); drawTacticalMap(map, { world }); art.append(tag, map);
    const copy = document.createElement('div'); copy.className = 'map-choice-copy';
    const title = document.createElement('strong'); title.textContent = world.name;
    const arrow = document.createElement('span'); arrow.textContent = '↗'; title.append(arrow);
    const description = document.createElement('p'); description.textContent = world.description;
    const size = document.createElement('small'); size.textContent = `${world.width} × ${world.depth} M  /  ${world.platforms.length} DECKS + ${world.extraCover.length} COVER`;
    copy.append(title, description, size); button.append(art, copy); $('map-choices').append(button);
    button.addEventListener('click', () => { loadout.mapId = world.id; updateSelections(); $('maps-dialog').close(); });
  }
  for (const weapon of WEAPONS) {
    const button = document.createElement('button'); button.dataset.weapon = weapon.id; button.setAttribute('aria-label', `${weapon.label} ${weapon.name} 선택`);
    const key = document.createElement('kbd'); key.textContent = weapon.slot;
    const copy = document.createElement('span'), name = document.createElement('b'), label = document.createElement('small'); name.textContent = weapon.name; label.textContent = weapon.label; copy.append(name, label); button.append(key, copy); $('weapon-choices').append(button);
    button.addEventListener('click', () => { selectedWeaponId = weapon.id; if (ownsWeapon(profileStore.profile, weapon.id)) loadout.weaponId = weapon.id; updateSelections(); });
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
    card.addEventListener('click', () => { selectedOutfitId = outfit.id; renderShop(); operatorPreview?.set(outfit.id, loadout.skinId, loadout.weaponId); });
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
  $('sensitivity-value').textContent = settings.sensitivity.toFixed(1);
  $('fov-value').textContent = `${settings.fov}°`; $('volume-value').textContent = `${settings.volume}%`;
  audio.updateVolume(); updateSoundButton(); game?.applySettings();
  store('sector07-settings', JSON.stringify(settings));
}

$('create-button').addEventListener('click', () => {
  if (busy || !connected) return;
  setBusy(true); send({ type: 'create', mode, bots: botCount, botDifficulty, ...roundOptions, name: callsign(), ...profileLoadout() });
});
$('join-form').addEventListener('submit', (event) => { event.preventDefault(); requestJoin($('room-code').value.trim().toUpperCase()); });
$('room-code').addEventListener('input', () => { $('room-code').value = $('room-code').value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });
$('player-name').addEventListener('change', () => callsign());
$('mode-lan').addEventListener('click', () => setMode('lan'));
$('mode-practice').addEventListener('click', () => setMode('practice'));
$('bots-minus').addEventListener('click', () => { botCount = Math.max(mode === 'practice' ? 1 : 0, botCount - 1); updateBots(); });
$('bots-plus').addEventListener('click', () => { botCount = Math.min(RULES.maxPlayers - 1, botCount + 1); updateBots(); });
$('resume-button').addEventListener('click', () => game?.lock());
$('leave-button').addEventListener('click', () => leaveGame());
$('round-leave').addEventListener('click', () => leaveGame());
$('restart-button').addEventListener('click', () => send({ type: 'restart' }));
$('copy-lan').addEventListener('click', () => copyText(lanUrl, 'LAN 주소를 복사했습니다. 같은 네트워크의 친구에게 공유하세요.'));
$('copy-invite').addEventListener('click', () => {
  if (!game) return;
  const url = new URL(lanUrl); url.searchParams.set('room', game.room.code);
  copyText(url.toString(), `초대 링크를 복사했습니다. 방 코드: ${game.room.code}`);
});
$('sound-button').addEventListener('click', async () => {
  audio.muted = !audio.muted;
  if (!audio.muted && settings.volume === 0) { settings.volume = 65; updateSettings(); }
  store('sector07-muted', String(audio.muted)); await audio.unlock(); audio.updateVolume(); updateSoundButton();
});
$('briefing-button').addEventListener('click', () => openDialog('briefing-dialog'));
$('map-card').addEventListener('click', () => openDialog('maps-dialog'));
$('choose-map').addEventListener('click', () => openDialog('maps-dialog'));
$('armory-button').addEventListener('click', () => openDialog('armory-dialog'));
$('nav-armory').addEventListener('click', () => openDialog('armory-dialog'));
$('armory-dialog').addEventListener('close', () => { preview?.dispose(); preview = null; });
$('shop-dialog').addEventListener('close', () => { operatorPreview?.dispose(); operatorPreview = null; });
$('shop-action').addEventListener('click', async () => {
  const outfit = getOutfit(selectedOutfitId);
  if (!profileStore.profile.ownedOutfits.includes(outfit.id)) {
    purchaseRequestId = { type: 'outfit', id: outfit.id }; $('purchase-title').textContent = '이 외형을 구매할까요?'; $('purchase-description').textContent = `${outfit.label} 외형을 ${outfit.price} LP에 구매하고 장착합니다.`;
    $('purchase-note').textContent = '포인트를 차감하고 외형을 장착합니다. 외형은 게임 플레이 능력치에 영향을 주지 않습니다.'; $('confirm-purchase').textContent = '구매 후 장착'; openDialog('purchase-dialog'); return;
  }
  shopBusy = true; renderShop();
  try { await profileStore.equip(outfit.id); toast(`${outfit.label} 외형을 장착했습니다.`); }
  catch (error) { toast(error.message, true); } finally { shopBusy = false; renderShop(); }
});
$('armory-unlock').addEventListener('click', () => {
  const weapon = getWeapon(selectedWeaponId);
  if (ownsWeapon(profileStore.profile, weapon.id)) { loadout.weaponId = weapon.id; updateSelections(); return; }
  purchaseRequestId = { type: 'weapon', id: weapon.id }; $('purchase-title').textContent = '이 무기를 영구 해금할까요?';
  $('purchase-description').textContent = `${weapon.name}을 ${weapon.price.toLocaleString('ko-KR')} LP로 영구 해금하고 출격 장비로 선택합니다.`;
  $('purchase-note').textContent = '해금은 이 기기 프로필에 저장됩니다. 추가 사용료는 없으며 무기 숙련도는 피해량이나 체력을 높이지 않습니다.';
  $('confirm-purchase').textContent = '영구 해금'; openDialog('purchase-dialog');
});
$('confirm-purchase').addEventListener('click', async () => {
  if (!purchaseRequestId || shopBusy) return;
  const request = purchaseRequestId; shopBusy = true; $('confirm-purchase').disabled = true; renderShop(); renderWeaponOwnership();
  try {
    if (request.type === 'weapon') {
      await profileStore.purchaseWeapon(request.id); loadout.weaponId = request.id; selectedWeaponId = request.id; updateSelections(); toast(`${getWeapon(request.id).name} 영구 해금 완료`);
    } else { await profileStore.purchase(request.id); toast(`${getOutfit(request.id).label} 외형을 구매하고 장착했습니다.`); }
    $('purchase-dialog').close();
  } catch (error) { toast(error.message, true); } finally { shopBusy = false; purchaseRequestId = null; $('confirm-purchase').disabled = false; renderShop(); renderWeaponOwnership(); }
});
$('nav-play').addEventListener('click', () => {
  setMode('lan'); $('create-button').focus({ preventScroll: true });
  document.querySelector('.operation-grid').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
});
function browseRooms() { send({ type: 'list' }); openDialog('rooms-dialog'); updateRooms(rooms); }
$('nav-rooms').addEventListener('click', browseRooms); $('browse-rooms').addEventListener('click', browseRooms);
$('refresh-rooms').addEventListener('click', () => { if (send({ type: 'list' })) toast('방 목록을 새로고침했습니다.'); else toast('로컬 서버에 연결되어 있지 않습니다.', true); });
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openDialog(button.dataset.open)));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
for (const key of ['sensitivity', 'fov', 'volume']) $(key).addEventListener('input', () => { settings[key] = Number($(key).value); updateSettings(); });
$('quality').addEventListener('change', () => { settings.quality = $('quality').value; updateSettings(); });

setInterval(() => {
  if (!connected) return;
  send({ type: 'ping', sent: Date.now() });
  if (!game && !busy) send({ type: 'list' });
}, 4000);
makeCollections(); updateSelections(); renderProfile();
profileStore.addEventListener('change', renderProfile);
profileStore.addEventListener('award', (event) => toast(`라운드 정산 완료 · +${event.award.points} LP`));
window.addEventListener('storage', (event) => { if (event.key === PROFILE_KEY && !game) { profileStore.refreshLocal(); renderProfile(); } });
if (profileStore.warning) toast(profileStore.warning, true);
const extraControls = document.createElement('p'); extraControls.className = 'controls-addition'; extraControls.textContent = `생존 중 무기 교체 불가 · 사망 후 E: ${WEAPONS.length}종 목록에서 클릭해 다음 부활 무기 선택 (처음 10종은 숫자 1–9, 0) · C / Ctrl: 앉기 (달리기·공중에서는 불가) · 계단으로 건물·옥상까지 이동할 수 있습니다. 달리거나 공중에서 쏘면 탄이 크게 퍼집니다. 피격 방향은 붉은 표시만으로 알립니다.`; $('help-dialog').append(extraControls);
if (SOLO) {
  document.body.classList.add('solo-edition'); document.title = 'LINKSHOT · 링크샷 — Solo combat';
  document.querySelector('.page-heading h1').textContent = '여섯 개의 전장, 나만의 교전.';
  document.querySelector('.page-heading p').textContent = '설치 없이 브라우저에서. 연습 봇과 실력을 겨루고 포인트로 나만의 외형을 모으세요.';
  for (const id of ['mode-lan', 'join-section', 'nav-rooms', 'browse-rooms', 'copy-lan']) $(id).hidden = true;
  setMode('practice'); $('hero-player-note').textContent = 'SOLO / BOT COMBAT'; $('hud-connection-kind').textContent = 'LOCAL';
  document.querySelector('.build-tag').childNodes[1].textContent = ' SOLO EDITION ';
  const card = document.querySelector('.network-info'); card.querySelector('.card-eyebrow').textContent = 'NO GAME SERVER REQUIRED';
  card.querySelector('h3').textContent = '혼자서도, 어디서나.'; card.querySelector('p').textContent = '게임과 봇은 이 브라우저 안에서 실행됩니다.';
  const badge = document.createElement('span'); badge.className = 'solo-network-badge'; badge.textContent = 'LOCAL SIMULATION · WEB WORKER'; card.querySelector('.info-copy').append(badge);
  const steps = $('help-dialog').querySelectorAll('.help-steps p span');
  for (const [i, text] of [`전장과 장비를 고르세요. ${MAPS.length}개 전장 · ${WEAPONS.length}종 중 1–4번은 무료, 나머지는 LP로 영구 해금합니다.`, '연습전 시작을 누르세요. 전적·무기 숙련도는 자동 저장되며 포인트는 라운드 완료 후 지급됩니다.', `목표 킬·시간을 설정하세요. 외형과 무기 숙련도는 능력치를 높이지 않습니다.`].entries()) steps[i].textContent = text;
  $('help-dialog').querySelector('.rooms-footnote').textContent = '이 배포는 1인 플레이 전용입니다. LAN 멀티플레이는 프로젝트를 로컬에서 npm start로 실행하면 사용할 수 있습니다.';
}
updateSettings(); updateBots(); updateConnection(false); updateRooms([]); connect();
