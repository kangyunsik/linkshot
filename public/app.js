import { FPSGame } from './game.js';
import { GameAudio } from './audio.js';
import { drawTacticalMap } from './map.js';
import { MAPS, getMap } from '/shared/world.js';
import { WEAPONS, SKINS, getWeapon, getSkin } from '/shared/catalog.js';
import { ArmoryPreview } from './weapon-model.js';
import { SoloConnection } from './solo-connection.js';
import { APP_MODE } from './runtime-config.js';

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
const audio = new GameAudio(settings);
audio.muted = stored('sector07-muted', 'false') === 'true';
let socket, game = null, connected = false, mode = 'lan', botCount = 2, rooms = [], lanUrl = location.origin;
let busy = false, requestTimeout, reconnectTimeout, reconnectDelay = 1000, hasDeployed = false;
let invitedCode = new URL(location.href).searchParams.get('room')?.toUpperCase();
if (!/^[A-Z2-9]{5}$/.test(invitedCode || '')) invitedCode = null;
if (SOLO) invitedCode = null;

$('player-name').value = stored('sector07-name', `OP-${Math.floor(100 + Math.random() * 900)}`);
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
    const name = document.createElement('small'); name.textContent = `${getMap(room.mapId).name} · ${room.name} · 봇 ${room.bots}명 · ${room.phase === 'ended' ? '종료' : '교전 중'}`;
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
    if (data.type === 'joined') enterGame(data);
    if (data.type === 'state') game?.applySnapshot(data);
    if (data.type === 'left' && game) leaveGame(false);
    if (data.type === 'error') { setBusy(false); toast(data.message, true); }
  });
  socket.addEventListener('close', () => {
    const wasPlaying = !!game;
    updateConnection(false); setBusy(false); updateRooms([]);
    if (wasPlaying) { leaveGame(false); toast(SOLO ? '브라우저 시뮬레이션이 중단되었습니다. 다시 시작해 주세요.' : '서버 연결이 끊겼습니다. 로컬 서버가 실행 중인지 확인해 주세요.', true); }
    reconnectTimeout = setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 1.5, 8000);
  });
  socket.addEventListener('error', () => { /* close handles recovery. */ });
}

function callsign() {
  const name = $('player-name').value.trim() || 'OPERATOR';
  store('sector07-name', name); return name;
}

function requestJoin(code) {
  if (busy || game) return;
  if (!connected) { toast('먼저 로컬 서버에 연결되어야 합니다.', true); return; }
  if (!/^[A-Z2-9]{5}$/.test(code)) { toast('5자리 방 코드를 입력해 주세요.', true); return; }
  setBusy(true); send({ type: 'join', code, name: callsign(), ...loadout });
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
  if (game) game.dispose();
  $('lobby').hidden = true; $('game-shell').hidden = false; hasDeployed = false;
  try {
    game = new FPSGame({
      canvas: $('game-canvas'), minimap: $('minimap'), settings, audio, send,
      mapId: data.room.mapId, weaponId: data.players.find((player) => player.id === data.id)?.weaponId, skinId: data.players.find((player) => player.id === data.id)?.skinId,
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
  $('bots-minus').disabled = botCount <= (mode === 'practice' ? 1 : 0); $('bots-plus').disabled = botCount >= 4;
}

function openDialog(id) {
  if (game?.locked) document.exitPointerLock();
  const dialog = $(id);
  if (dialog.open) return;
  if (id === 'briefing-dialog') {
    const world = getMap(loadout.mapId);
    drawTacticalMap($('briefing-map'), { world, spawns: true, detailed: true });
    $('briefing-map-title').textContent = world.name; $('briefing-map-size').textContent = `${world.width} × ${world.depth} M`;
    $('briefing-map-description').textContent = `${world.description} 5분 또는 먼저 20킬을 달성하면 라운드가 끝납니다.`;
  }
  dialog.showModal();
  if (id === 'armory-dialog') {
    try { preview = new ArmoryPreview($('weapon-preview')); preview.set(loadout.weaponId, loadout.skinId); $('preview-fallback').hidden = true; }
    catch { $('preview-fallback').hidden = false; }
  }
}

function updateSelections() {
  const world = getMap(loadout.mapId), weapon = getWeapon(loadout.weaponId), skin = getSkin(loadout.skinId);
  const index = MAPS.indexOf(world) + 1;
  $('hero-map-title').textContent = `${world.title}.`; $('hero-map-title').style.fontSize = world.title.length > 8 ? '.78em' : '';
  $('hero-map-name').textContent = world.name; $('hero-map-index').textContent = String(index).padStart(2, '0');
  $('hero-operation').textContent = `OPERATION ${String(index).padStart(3, '0')}`; $('hero-description').textContent = world.description;
  document.querySelector('.hero-art').style.backgroundImage = `linear-gradient(90deg,#0e151bdf 0%,#0e151b68 45%,#0d161b00 100%),linear-gradient(0deg,#0e141aef,#10202a00 45%,#17212e33),url('/assets/${world.image}')`;
  $('map-card-name').textContent = world.name; $('map-card-description').textContent = `${world.width} × ${world.depth} M · ${world.tag}`;
  $('loadout-weapon').replaceChildren(document.createTextNode(`${weapon.name} `));
  const type = document.createElement('span'); type.textContent = weapon.type; $('loadout-weapon').append(type);
  $('loadout-description').textContent = `${weapon.label} · ${weapon.magazine}발 · 1–4 / 휠 교체`;
  $('loadout-skin').textContent = `${skin.name} · 장비 변경 ↗`;
  $('armory-button').style.setProperty('--finish', skin.color); $('armory-button').style.setProperty('--finish-accent', skin.accent);
  $('armory-button').style.setProperty('--finish-map', skin.pattern ? `url('/assets/${skin.pattern}')` : 'none');
  for (const button of $('map-choices').children) { const selected = button.dataset.map === world.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  for (const button of $('weapon-choices').children) { const selected = button.dataset.weapon === weapon.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  for (const button of $('skin-choices').children) { const selected = button.dataset.skin === skin.id; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  $('armory-weapon-type').textContent = `${weapon.type} / ${weapon.label}`; $('armory-weapon-name').textContent = weapon.name;
  $('armory-weapon-description').textContent = weapon.description; $('armory-skin-name').textContent = skin.name;
  $('weapon-stats').replaceChildren();
  for (const [label, value] of [['피해량', weapon.pellets > 1 ? `${weapon.damage} × ${weapon.pellets} PELLETS` : `${weapon.damage} / HEAD ${weapon.headDamage}`], ['탄창 / 연사', `${weapon.magazine} / ${Math.round(60 / weapon.fireSeconds)} RPM`], ['재장전', `${weapon.reloadSeconds.toFixed(2)} SEC`], ['최대 사거리', `${weapon.range} M`]]) {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt, dd); $('weapon-stats').append(row);
  }
  preview?.set(weapon.id, skin.id); store('sector07-loadout', JSON.stringify(loadout));
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
    const size = document.createElement('small'); size.textContent = `${world.width} × ${world.depth} M  /  DEATHMATCH`;
    copy.append(title, description, size); button.append(art, copy); $('map-choices').append(button);
    button.addEventListener('click', () => { loadout.mapId = world.id; updateSelections(); $('maps-dialog').close(); });
  }
  for (const weapon of WEAPONS) {
    const button = document.createElement('button'); button.dataset.weapon = weapon.id; button.setAttribute('aria-label', `${weapon.label} ${weapon.name} 선택`);
    const key = document.createElement('kbd'); key.textContent = weapon.slot;
    const copy = document.createElement('span'), name = document.createElement('b'), label = document.createElement('small'); name.textContent = weapon.name; label.textContent = weapon.label; copy.append(name, label); button.append(key, copy); $('weapon-choices').append(button);
    button.addEventListener('click', () => { loadout.weaponId = weapon.id; updateSelections(); });
  }
  for (const skin of SKINS) {
    const button = document.createElement('button'); button.className = 'skin-choice'; button.dataset.skin = skin.id; button.setAttribute('aria-label', `${skin.label} 스킨`);
    button.style.setProperty('--skin-color', skin.color); button.style.setProperty('--skin-accent', skin.accent); button.style.setProperty('--skin-pattern', skin.pattern ? `url('/assets/${skin.pattern}')` : 'none');
    const swatch = document.createElement('span'); swatch.className = 'skin-swatch'; const label = document.createElement('small'); label.textContent = skin.label; button.append(swatch, label); $('skin-choices').append(button);
    button.addEventListener('click', () => { loadout.skinId = skin.id; updateSelections(); });
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
  setBusy(true); send({ type: 'create', mode, bots: botCount, name: callsign(), ...loadout });
});
$('join-form').addEventListener('submit', (event) => { event.preventDefault(); requestJoin($('room-code').value.trim().toUpperCase()); });
$('room-code').addEventListener('input', () => { $('room-code').value = $('room-code').value.toUpperCase().replace(/[^A-Z2-9]/g, ''); });
$('player-name').addEventListener('change', () => callsign());
$('mode-lan').addEventListener('click', () => setMode('lan'));
$('mode-practice').addEventListener('click', () => setMode('practice'));
$('bots-minus').addEventListener('click', () => { botCount = Math.max(mode === 'practice' ? 1 : 0, botCount - 1); updateBots(); });
$('bots-plus').addEventListener('click', () => { botCount = Math.min(4, botCount + 1); updateBots(); });
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
makeCollections(); updateSelections();
const extraControls = document.createElement('p'); extraControls.className = 'controls-addition'; extraControls.textContent = '1 / 2 / 3 / 4 또는 마우스 휠: 무기 교체 · 산탄총과 저격총은 클릭할 때마다 한 발씩 발사합니다.'; $('help-dialog').append(extraControls);
if (SOLO) {
  document.body.classList.add('solo-edition'); document.title = 'LINKSHOT · 링크샷 — Solo combat';
  document.querySelector('.page-heading h1').textContent = '여섯 개의 전장, 나만의 교전.';
  document.querySelector('.page-heading p').textContent = '설치 없이 브라우저에서. 모든 장비를 열고 연습 봇과 실력을 겨뤄보세요.';
  for (const id of ['mode-lan', 'join-section', 'nav-rooms', 'browse-rooms', 'copy-lan']) $(id).hidden = true;
  setMode('practice'); $('hero-player-note').textContent = 'SOLO / BOT COMBAT'; $('hud-connection-kind').textContent = 'LOCAL';
  document.querySelector('.build-tag').childNodes[1].textContent = ' SOLO EDITION ';
  const card = document.querySelector('.network-info'); card.querySelector('.card-eyebrow').textContent = 'NO GAME SERVER REQUIRED';
  card.querySelector('h3').textContent = '혼자서도, 어디서나.'; card.querySelector('p').textContent = '게임과 봇은 이 브라우저 안에서 실행됩니다.';
  const badge = document.createElement('span'); badge.className = 'solo-network-badge'; badge.textContent = 'LOCAL SIMULATION · WEB WORKER'; card.querySelector('.info-copy').append(badge);
  const steps = $('help-dialog').querySelectorAll('.help-steps p span');
  for (const [i, text] of ['전장과 장비를 고르세요. 6개 전장, 4종 무기와 6가지 스킨이 모두 열려 있습니다.', '연습전 시작을 누르세요. 봇과 전투 판정은 브라우저의 별도 워커에서 실행됩니다.', '20킬 또는 5분. 모든 무기를 1–4 또는 휠로 교체하며 플레이하세요.'].entries()) steps[i].textContent = text;
  $('help-dialog').querySelector('.rooms-footnote').textContent = '이 배포는 1인 플레이 전용입니다. LAN 멀티플레이는 프로젝트를 로컬에서 npm start로 실행하면 사용할 수 있습니다.';
}
updateSettings(); updateBots(); updateConnection(false); updateRooms([]); connect();
