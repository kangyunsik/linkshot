import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createProfile } from '../../shared/progression.js';
import { createGameServer } from '../../server/index.js';

test.use({ baseURL: `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}` });
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
});

test('the single top wallet and cosmetic purchases stay synchronized after refresh', async ({ context, page }) => {
  const profile = createProfile('demo-device-0001', Date.now(), 'TESTER');
  Object.assign(profile, { kills: 12, deaths: 4, points: 20_350, totalEarned: 20_350 });
  await context.addInitScript((initial) => { try { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(initial)); } catch { /* about:blank */ } }, profile);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page.locator('.profile-strip, #rank-card')).toHaveCount(0); await expect(page.locator('#top-points')).toHaveText('20,350');
  await page.locator('#wallet-button').click(); await expect(page.locator('#outfit-choices button')).toHaveCount(5);
  await expect(page.locator('#shop-price')).toHaveText('기본 지급 · 무료');
  await page.getByRole('button', { name: '나이트 러너 외형 미리보기', exact: true }).click();
  await page.getByRole('button', { name: '20,000 LP로 구매', exact: true }).click(); await expect(page.locator('#purchase-dialog')).toBeVisible(); await expect(page.locator('#purchase-description')).toContainText('20,000 기기 LP');
  await page.getByRole('button', { name: '구매 후 장착', exact: true }).click(); await expect(page.locator('#purchase-dialog')).toBeHidden();
  await expect(page.locator('#shop-points')).toHaveText('350'); await expect(page.locator('#shop-owned-state')).toHaveText('현재 장착 중');
  await expect(page.locator('#shop-action')).toBeDisabled();
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/operator-shop.png' });
  await page.getByRole('button', { name: '외형 상점 닫기', exact: true }).click(); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page.locator('#top-points')).toHaveText('350');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')));
  expect(saved.equippedOutfitId).toBe('runner'); expect(saved.kills).toBe(12); expect(saved.deaths).toBe(4);
  await page.getByRole('button', { name: '캐릭터 외형 상점', exact: true }).click(); await page.getByRole('button', { name: '시티라인 외형 미리보기', exact: true }).click();
  await expect(page.locator('#shop-action')).toBeDisabled(); await expect(page.locator('#shop-point-note')).toContainText('19,650 LP');
  await page.getByRole('button', { name: '필드 이슈 외형 미리보기', exact: true }).click(); await page.getByRole('button', { name: '이 외형 장착', exact: true }).click();
  await expect(page.locator('#shop-points')).toHaveText('350'); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).equippedOutfitId)).toBe('field');
  await page.getByRole('button', { name: '외형 상점 닫기', exact: true }).click(); expect(errors).toEqual([]);
});

test('completion reward is paid once, persists after refresh, and a new round can earn separately', async ({ context, page }) => {
  await context.route('**/shared/simulation.js', async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replaceAll('this.startedAt + this.roundSeconds * 1000', 'this.startedAt + 2000') }); });
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible(); const identity = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).id);
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#round-overlay')).toBeVisible();
  await expect(page.locator('#round-reward')).toBeVisible(); await expect(page.locator('#round-points')).toHaveText('50'); await expect(page.locator('#top-points')).toHaveText('50');
  await page.getByRole('button', { name: '로비로 돌아가기', exact: true }).click(); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await expect(page.locator('#top-points')).toHaveText('50'); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).id)).toBe(identity);
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#round-overlay')).toBeVisible(); await expect(page.locator('#top-points')).toHaveText('100');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).roundsPlayed)).toBe(2);
});

test('leaving before round completion does not grant participation points', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#pause-overlay')).toBeVisible();
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click(); await expect(page.locator('#top-points')).toHaveText('0');
  await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).roundsPlayed)).toBe(0);
});

test('paid weapons preview without equipping, permanently unlock once, and retain personal mastery after refresh', async ({ context, page }) => {
  const profile = createProfile('unlock-demo-0001', Date.now(), 'UNLOCK TEST'); Object.assign(profile, { points: 2000, kills: 51, weaponKills: { rifle: 50, pistol: 1 }, ownedOutfits: ['field', 'runner'], equippedOutfitId: 'runner' });
  await context.addInitScript((profile) => { if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(profile)); }, profile);
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.getByRole('button', { name: '무기 및 스킨 선택', exact: true }).click();
  await expect(page.locator('#armory-level')).toHaveText('Lv.1'); await expect(page.locator('#armory-mastery-count')).toHaveText('0 / 100 KILLS → Lv.2');
  await page.locator('#weapon-choices [data-weapon=smg]').click(); await expect(page.locator('#armory-owned-state')).toContainText('미해금');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sector07-loadout')).weaponId)).toBe('rifle');
  await page.locator('#armory-unlock').click(); await expect(page.locator('#purchase-description')).toContainText('600 LP'); await page.getByRole('button', { name: '영구 해금', exact: true }).click();
  await expect(page.locator('#purchase-dialog')).toBeHidden(); await expect(page.locator('#armory-owned-state')).toContainText('영구 해금됨'); await expect(page.locator('#top-points')).toHaveText('1,400');
  await page.getByRole('button', { name: '장비 저장', exact: true }).click(); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); expect(saved.points).toBe(1400); expect(saved.ownedWeapons.filter((id) => id === 'smg')).toHaveLength(1); expect(saved.weaponKills.rifle).toBe(50); expect(saved.equippedOutfitId).toBe('runner');
  await page.getByRole('button', { name: '무기 및 스킨 선택', exact: true }).click(); await expect(page.locator('#armory-unlock')).toBeDisabled();
  await page.locator('#weapon-choices [data-weapon=m82]').click(); await expect(page.locator('#armory-unlock')).toBeDisabled(); await expect(page.locator('#armory-balance')).toContainText('600 LP 더 필요');
  await page.getByRole('button', { name: '장비 저장', exact: true }).click();
});

test('new operators are free, keep existing purchases and enter the solo worker with the chosen identity', async ({ context, page }) => {
  const profile = createProfile('character-demo-0001', Date.now(), 'LYRA TEST'); Object.assign(profile, { points: 600, kills: 7, ownedOutfits: ['field', 'runner'], equippedOutfitId: 'runner' });
  await context.addInitScript((profile) => {
    if (!localStorage.getItem('linkshot-profile-v1')) localStorage.setItem('linkshot-profile-v1', JSON.stringify(profile));
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => { if (data.type === 'joined') window.__characterJoined = data; }); } };
  }, profile);
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  await page.locator('#appearance-card').click(); await expect(page.locator('#character-choices button')).toHaveCount(5);
  for (const id of ['female', 'jin', 'rhea', 'nari']) {
    const button = page.locator(`[data-character=${id}]`); await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.locator('#operator-preview-name')).toHaveText('NARI'); await expect(page.locator('#shop-points')).toHaveText('600');
  await page.getByRole('button', { name: '외형 상점 닫기', exact: true }).click(); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); expect(saved.characterId).toBe('nari'); expect(saved.points).toBe(600); expect(saved.kills).toBe(7); expect(saved.equippedOutfitId).toBe('runner');
  await expect(page.locator('#appearance-portrait')).toHaveAttribute('src', /operator-nari\.png/);
  await page.getByRole('button', { name: '연습전 시작', exact: true }).click(); await expect(page.locator('#game-shell')).toBeVisible();
  expect(await page.evaluate(() => window.__characterJoined.players.find((p) => p.id === 'local-operator').characterId)).toBe('nari');
  await page.getByRole('button', { name: '로비로 나가기', exact: true }).click();
});

test('an actual LAN kill persists mastery once and shows the killer gun level on the victim death card', async ({ browser }) => {
  const server = createGameServer({ port: 0, host: '127.0.0.1', loop: false }), info = await server.listen(), url = `http://127.0.0.1:${info.port}`;
  const attackerContext = await browser.newContext(), victimContext = await browser.newContext();
  try {
    const profile = createProfile('lan-mastery-demo-0001', Date.now(), 'MASTER'); profile.kills = 49; profile.weaponKills = { rifle: 49 };
    await attackerContext.addInitScript((profile) => { localStorage.setItem('linkshot-profile-v1', JSON.stringify(profile)); }, profile);
    const attacker = await attackerContext.newPage(), victim = await victimContext.newPage();
    await attacker.goto(url); await expect(attacker.getByText('LAN SERVER ONLINE')).toBeVisible();
    await attacker.locator('#create-button').click(); await attacker.getByRole('button', { name: '봇 한 명 줄이기' }).click(); await attacker.getByRole('button', { name: '봇 한 명 줄이기' }).click();
    await attacker.locator('#room-create-confirm').click(); await expect(attacker.locator('#room-lobby-dialog')).toBeVisible(); await attacker.locator('#room-lobby-action').click(); await expect.poll(() => [...server.rooms.values()][0]?.phase).toBe('active'); server.broadcast(); await expect(attacker.locator('#pause-overlay')).toBeVisible();
    const room = [...server.rooms.values()][0], killer = [...room.players.values()][0];
    await victim.goto(url); await expect(victim.getByText('LAN SERVER ONLINE')).toBeVisible(); await victim.locator('#room-browser-button').click(); await victim.getByLabel('참가할 방 코드').fill(room.code); await victim.getByRole('button', { name: '코드로 방 참가', exact: true }).click(); await expect(victim.locator('#room-lobby-dialog')).toBeVisible(); await victim.locator('#room-lobby-action').click(); await expect.poll(() => [...room.players.values()].filter((p) => p.roomStatus === 'playing').length).toBe(2); server.broadcast(); await expect(victim.locator('#pause-overlay')).toBeVisible();
    const target = [...room.players.values()].find((p) => p.id !== killer.id);
    Object.assign(killer, { x: 24, y: 0, z: 10, yaw: 0, pitch: 0, ammo: 30 }); Object.assign(target, { x: 24, y: 0, z: 0, hp: 1, protectedUntil: 0 });
    room.shoot(killer, Date.now(), true); server.broadcast();
    await expect(attacker.locator('#mastery-level')).toHaveText('Lv.1 · LEVEL UP!'); await expect(attacker.locator('#mastery-count')).toHaveText('0 / 100 KILLS → Lv.2');
    await expect(victim.locator('#death-attacker')).toHaveText('MASTER'); await expect(victim.locator('#death-weapon')).toHaveText('VX–7'); await expect(victim.locator('#death-weapon-level')).toHaveText('Lv.1');
    room.finish(); server.broadcast(); await expect(attacker.locator('#top-points')).toHaveText('170'); server.broadcast();
    const saved = await attacker.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); expect(saved.kills).toBe(50); expect(saved.weaponKills.rifle).toBe(50); expect(saved.points).toBe(170);
    await attacker.locator('#room-lobby-leave').click(); await expect(attacker.locator('#room-lobby-dialog')).toBeHidden(); await attacker.getByRole('button', { name: '무기 및 스킨 선택', exact: true }).click(); await expect(attacker.locator('#armory-level')).toHaveText('Lv.1');
  } finally { await attackerContext.close(); await victimContext.close(); await server.close(); }
});
