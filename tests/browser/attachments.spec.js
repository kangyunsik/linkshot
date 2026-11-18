import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createProfile, SUPPRESSOR_KILLS } from '../../shared/progression.js';
import { WEAPONS } from '../../shared/catalog.js';

test('local armory unlocks suppressors per weapon at Lv.5, saves the free choice and deploys the suppressed S686', async ({ context, page }) => {
  const profile = createProfile('attachment-browser-0001'); Object.assign(profile, { points: 832, ownedWeapons: [...profile.ownedWeapons, 'an94', 's686', 'vector'], weaponKills: { rifle: 1549, pistol: 1550, an94: 1550, s686: 1550, vector: 1550 } });
  await context.addInitScript((profile) => { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(profile)); localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); }, profile);
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser';" }));
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto('/');
  await page.locator('#armory-button').click(); await expect(page.locator('#weapon-choices button')).toHaveCount(WEAPONS.length);
  await expect(page.getByLabel('기기 소음기 장착')).toBeDisabled(); await expect(page.locator('#armory-suppressor-note')).toContainText('1,549 / 1,550');
  for (const id of ['an94', 'vector', 's686']) { await page.locator(`#weapon-choices [data-weapon=${id}]`).click(); await expect(page.getByLabel('기기 소음기 장착')).toBeEnabled(); }
  await page.getByLabel('기기 소음기 장착').check(); await expect(page.getByLabel('기기 소음기 장착')).toBeEnabled(); await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).suppressedWeapons)).toEqual(['s686']);
  await expect(page.locator('#armory-balance')).toContainText('832 LP'); await expect(page.locator('#armory-level')).toHaveText('Lv.5');
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/s686-suppressor-armory.png' });
  await page.reload(); await page.locator('#armory-button').click(); await expect(page.getByLabel('기기 소음기 장착')).toBeChecked();
  await page.locator('#weapon-choices [data-weapon=pistol]').click(); await expect(page.getByLabel('기기 소음기 장착')).not.toBeChecked(); await page.locator('#weapon-choices [data-weapon=s686]').click(); await expect(page.getByLabel('기기 소음기 장착')).toBeChecked();
  await page.getByRole('button', { name: '장비 저장', exact: true }).click(); await page.locator('#create-button').click(); await expect(page.locator('#pause-overlay')).toBeVisible();
  await expect(page.locator('#hud-weapon-name')).toContainText('S686'); await expect(page.locator('#hud-ammo')).toHaveText('02'); await expect(page.locator('#hud-skin-name')).toContainText('SUPPRESSED');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).points)).toBe(832); expect(errors).toEqual([]);
});

test('online attachment choices use account mastery and CSRF without granting unpurchased ranked equipment or changing device records', async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin, api = 'http://127.0.0.1:18080', local = createProfile('separate-attachment-0001'); Object.assign(local, { points: 511, weaponKills: { rifle: SUPPRESSOR_KILLS }, suppressedWeapons: ['rifle'] });
  const account = { id: 'online-attachment', username: 'attachment', callsign: 'ONLINE', points: 0, kills: 0, deaths: 0, casualRating: 1000, rankTier: 'UNRANKED', placementsPlayed: 0, ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: { rifle: 1549, vector: 1550 }, suppressedWeapons: [] }, writes = [];
  account.competitive = { ffa: { rankTier: 'UNRANKED', placementsPlayed: 0 }, teams: { rankTier: 'UNRANKED', placementsPlayed: 0 } };
  await context.addInitScript((profile) => { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(profile)); }, local);
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser'; export const ONLINE_SERVER_URL = ${JSON.stringify(api)};` }));
  await context.route(api + '/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname, headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-TOKEN' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let body = {}, status = 200;
    if (path === '/api/health') body = { service: 'linkshot-online', matchmaking: true };
    else if (path === '/api/account') body = account;
    else if (path === '/api/auth/csrf') body = { token: 'attachment-csrf', headerName: 'X-CSRF-TOKEN' };
    else if (path === '/api/queue') body = { state: 'IDLE' };
    else if (path === '/api/account/weapons/vector/suppressor') {
      writes.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] }); account.suppressedWeapons = request.postDataJSON().equipped ? ['vector'] : []; body = account;
    } else status = 404;
    return route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto('/'); await expect(page.locator('#profile-casual-rating')).toHaveText('배치 중');
  await page.getByRole('tab', { name: '랭크: 팀전 랭크', exact: true }).click(); await page.locator('#online-loadout-button').click();
  await expect(page.locator('#weapon-choices button')).toHaveCount(WEAPONS.length); await expect(page.getByLabel('온라인 소음기 장착')).toBeDisabled(); await expect(page.getByLabel('온라인 소음기 장착')).not.toBeChecked();
  await page.locator('#weapon-choices [data-weapon=vector]').click(); await expect(page.getByLabel('온라인 소음기 장착')).toBeEnabled(); await page.getByLabel('온라인 소음기 장착').check(); await expect(page.getByLabel('온라인 소음기 장착')).toBeEnabled();
  expect(writes).toEqual([{ body: { equipped: true }, csrf: 'attachment-csrf' }]); expect(account.ownedWeapons).not.toContain('vector');
  await page.reload(); await page.getByRole('tab', { name: '랭크: 팀전 랭크', exact: true }).click(); await page.locator('#online-loadout-button').click(); await page.locator('#weapon-choices [data-weapon=vector]').click(); await expect(page.getByLabel('온라인 소음기 장착')).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); expect(saved.points).toBe(511); expect(saved.suppressedWeapons).toEqual(['rifle']); expect(saved.ownedWeapons).not.toContain('vector');
  await page.getByLabel('온라인 소음기 장착').uncheck(); await expect(page.getByLabel('온라인 소음기 장착')).toBeEnabled(); expect(writes.at(-1)).toEqual({ body: { equipped: false }, csrf: 'attachment-csrf' }); expect(errors).toEqual([]);
});

test('all suppressors have hollow bores, preserve the aim axis and share owner-managed buffers; S686 hands and twin tubes follow the action', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [THREE, { WeaponModels, disposeModel, setModelSuppressor }, { WEAPONS }] = await Promise.all([import('/vendor/three.module.js'), import('/weapon-model.js'), import('/shared/catalog.js')]);
    const models = new WeaponModels(), checks = [];
    for (const weapon of WEAPONS) {
      const model = models.create(weapon.id, 'standard', true, 'field', 'male', 'standard', true), data = model.userData, attachment = data.suppressorMesh; model.updateMatrixWorld(true); attachment.material.side = THREE.DoubleSide;
      const centers = weapon.id === 's686' ? [.02, -.033] : [.02], clearBores = centers.every((y) => new THREE.Raycaster(new THREE.Vector3(0, y, data.suppressorTip - .03), new THREE.Vector3(0, 0, 1), 0, data.baseMuzzleZ - data.suppressorTip + .04).intersectObject(attachment, false).length === 0);
      const tip = data.muzzle.position.z, height = data.aimHeight; setModelSuppressor(model, false); const restored = data.muzzle.position.z === data.baseMuzzleZ && !attachment.visible && data.flash.scale.x === 1;
      setModelSuppressor(model, true); checks.push({ id: weapon.id, clearBores, restored, extension: data.baseMuzzleZ - tip, aimUnchanged: data.aimHeight === height, flash: data.flash.scale.x, visible: attachment.visible, finite: [...attachment.geometry.getAttribute('position').array].every(Number.isFinite) });
      if (weapon.id === 's686') {
        const action = data.breakAction, left = model.getObjectByName('left-hand'), socket = model.getObjectByName('grip-l'), relative = action.worldToLocal(left.getWorldPosition(new THREE.Vector3()));
        const attachmentBefore = action.worldToLocal(attachment.getWorldPosition(new THREE.Vector3())); action.rotation.x = -.5; model.updateMatrixWorld(true);
        checks.push({ id: 's686-action', error: action.worldToLocal(left.getWorldPosition(new THREE.Vector3())).distanceTo(relative), socketError: socket.getWorldPosition(new THREE.Vector3()).distanceTo(left.getWorldPosition(new THREE.Vector3())), tubeError: action.worldToLocal(attachment.getWorldPosition(new THREE.Vector3())).distanceTo(attachmentBefore), parented: attachment.parent === action && data.supportArm.parent === action, pump: !!data.pump });
      }
      disposeModel(model);
    }
    const a = models.create('vector', 'standard'), b = models.create('vector', 'circuit'), geometry = a.userData.suppressorMesh.geometry; let disposals = 0; geometry.addEventListener('dispose', () => disposals++);
    const shared = geometry === b.userData.suppressorMesh.geometry; disposeModel(a); disposeModel(b); const beforeOwner = disposals; models.dispose(); return { checks, shared, beforeOwner, afterOwner: disposals };
  });
  for (const check of result.checks) {
    if (check.id === 's686-action') { expect(check.parented).toBe(true); expect(check.pump).toBe(false); expect(check.error).toBeLessThan(1e-8); expect(check.socketError).toBeLessThan(1e-8); expect(check.tubeError).toBeLessThan(1e-8); }
    else { expect(check.clearBores && check.restored && check.aimUnchanged && check.visible && check.finite, check.id).toBe(true); expect(check.extension).toBeGreaterThan(.15); expect(check.flash).toBe(.32); }
  }
  expect(result.shared).toBe(true); expect(result.beforeOwner).toBe(0); expect(result.afterOwner).toBe(1);
});

test('live snapshots update local, remote and dropped suppressors without rebuilding guns and prewarm attachment geometry', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const result = await page.evaluate(async () => {
    const [{ FPSGame }, { Room }] = await Promise.all([import('/game.js'), import('/shared/simulation.js')]);
    const room = new Room('QUIET', { bots: 0 }), p = room.addPlayer('viewer', 'VIEWER', false, { weaponId: 's686', ownedWeapons: ['s686'], weaponKills: { s686: 1550 }, suppressedWeapons: ['s686'] }), peer = room.addPlayer('peer', 'PEER', false, { weaponKills: { rifle: 1550 }, suppressedWeapons: ['rifle'] });
    Object.assign(p, { x: 24, y: 0, z: 10, yaw: 0 }); Object.assign(peer, { x: 22, y: 0, z: 8 }); room.dropWeapon(peer); room.events.length = 0;
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const sounds = [], game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: 'foundry', settings: { sensitivity: 1, fov: 82, quality: 'low', weaponHand: 'left' }, audio: { shot(...args) { sounds.push(args); }, step() {}, stopReload() {} }, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
    try {
      game.applySnapshot(room.snapshot(), p.id); const local = game.activeModel, remote = game.remote.get(peer.id).weapon, attachment = local.userData.suppressorMesh;
      let warmed = false; const compile = game.renderer.compileAsync.bind(game.renderer); game.renderer.compileAsync = async (...args) => { warmed ||= [...game.weaponModels.values()].every((model) => !model.userData.suppressorMesh || model.userData.suppressorMesh.visible); return compile(...args); };
      await game.prepareGraphics(); cancelAnimationFrame(game.frameId); game.playLocalShot({ ...(await import('/shared/catalog.js')).getWeapon('s686') }, performance.now());
      const initial = attachment.visible && remote.userData.suppressorMesh.visible && [...game.groundItems.values()].every((item) => item.group.children[0].userData.suppressorMesh.visible);
      p.suppressor = false; peer.suppressor = false; game.applySnapshot(room.snapshot());
      return { initial, warmed, sameLocal: local === game.activeModel, sameRemote: remote === game.remote.get(peer.id).weapon, off: !attachment.visible && !remote.userData.suppressorMesh.visible, localSound: sounds.at(-1)?.[5], left: game.weaponHand.scale.x, count: game.weaponModels.size };
    } finally { await game.dispose(); }
  });
  expect(result.initial && result.warmed && result.sameLocal && result.sameRemote && result.off).toBe(true); expect(result.localSound).toBe(true); expect(result.left).toBe(-1); expect(result.count).toBe(WEAPONS.length + 1);
});
