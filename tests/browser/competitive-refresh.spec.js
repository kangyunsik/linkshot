import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createOnlineEngine } from '../../server/online-engine.js';
import { WEAPONS } from '../../shared/catalog.js';

const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`;
const api = 'http://127.0.0.1:18089';
function profile() { return { id: randomUUID(), callsign: 'RANK TESTER', points: 0, kills: 0, deaths: 0, casualRating: 1234, rankTier: 'BRONZE', rankDivision: 1, rankPoints: 90, placementsPlayed: 5, placementWins: 3, competitive: { ffa: { rankTier: 'SILVER', rankDivision: 4, rankPoints: 17, placementsPlayed: 5 } }, ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: {} }; }
async function mockApi(context, user, handler = () => null) {
  await context.addInitScript(() => { if (!localStorage.getItem('sector07-settings')) localStorage.setItem('sector07-settings', JSON.stringify({ quality: 'low', volume: 0, fov: 82, sensitivity: 1 })); });
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE='solo'; export const PROFILE_STORAGE='browser'; export const ONLINE_SERVER_URL=${JSON.stringify(api)};` }));
  await context.route(api + '/api/**', async (route) => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-TOKEN' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = await handler(pathname, request) ?? (pathname === '/api/health' ? { service: 'linkshot-online', matchmaking: true } : pathname === '/api/account' ? user : pathname === '/api/auth/csrf' ? { token: 'test-csrf', headerName: 'X-CSRF-TOKEN' } : { state: 'IDLE' });
    await route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('ranked loadout cards, actual weapon thumbnails and skins update immediately and survive refresh independently of local equipment', async ({ context, page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); const user = profile(); user.ownedWeapons.push('awp'); await mockApi(context, user);
  await page.goto(origin); await expect(page.locator('#hero-rank-tier')).toHaveText('브론즈 I'); await expect(page.locator('#profile-casual-rating')).toHaveText('실버 IV');
  await page.getByRole('tab', { name: '랭크: 팀전 랭크', exact: true }).click(); await page.locator('#armory-button').click();
  await expect(page.locator('#weapon-choices button')).toHaveCount(WEAPONS.length); await expect(page.locator('#skin-choices button')).toHaveCount(6);
  await page.locator('#weapon-choices [data-weapon=awp]').click(); await page.locator('#skin-choices [data-skin=arctic]').click();
  await expect(page.locator('#weapon-choices [data-weapon=awp]')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#armory-skin-name')).toHaveText('ARCTIC GHOST');
  await expect.poll(() => page.locator('#weapon-choices [data-weapon=awp] canvas').evaluate((canvas) => { const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return new Set(pixels).size; })).toBeGreaterThan(40);
  await page.getByRole('button', { name: '장비 저장', exact: true }).click();
  await expect(page.locator('#loadout-weapon')).toContainText('AWP'); await expect(page.locator('#loadout-skin')).toHaveText('ARCTIC GHOST'); await expect(page.locator('#armory-button')).toHaveAttribute('data-weapon', 'awp');
  await expect(page.locator('#loadout-description')).not.toContainText(/사망|E로/); await expect(page.locator('#loadout-preview')).toBeVisible();
  await page.reload(); await expect(page.locator('#profile-rank-tier')).toHaveText('브론즈 I'); await page.locator('#mode-ranked').click(); await expect(page.locator('#loadout-weapon')).toContainText('AWP'); await expect(page.locator('#loadout-skin')).toHaveText('ARCTIC GHOST');
  await page.locator('#mode-practice').click(); await expect(page.locator('#loadout-weapon')).toContainText('AWP'); await page.locator('#mode-ranked').click(); await expect(page.locator('#loadout-weapon')).toContainText('AWP');
  for (const [width, height] of [[1440, 1000], [1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height }); await expect(page.locator('#hero-rank-tier')).toBeVisible(); await expect(page.locator('#armory-button')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/competitive-home.png' }); expect(errors).toEqual([]);
});

test('ranked countdown renders over the real arena, then victory lasts five seconds and the home screen shows earned RP and promotion', async ({ context, page }) => {
  test.setTimeout(60_000);
  const user = profile(), id = randomUUID(), token = randomBytes(32).toString('base64url'); let now = Date.now(), queued = false, accepted = false;
  user.ownedWeapons.push('awp', 'm82');
  const receipt = { matchId: id, mode: 'RANKED', points: 170, completion: 50, killBonus: 20, winBonus: 100, won: true, outcome: 'WIN', abandoned: false, rankTierBefore: 'BRONZE', rankDivisionBefore: 1, rankPointsBefore: 90, rankPointsDelta: 26, rankTier: 'SILVER', rankDivision: 5, rankPointsAfter: 16, placementsPlayed: 5 };
  const engine = createOnlineEngine({ host: '127.0.0.1', port: 0, origins: [origin], clock: () => now, loop: false, client: {
    claim: async () => ({ id, mode: 'RANKED', gameType: 'teams', teams: { [user.id]: 'blue' }, bots: 5, rankedAiEnabled: true, botRating: 1000, players: [user], mapId: 'foundry', fragLimit: 20, roundSeconds: 60 }),
    consume: async (_, value) => { if (value !== token) throw new Error('Invalid ticket'); return user; },
    complete: async () => { Object.assign(user, { rankTier: 'SILVER', rankDivision: 5, rankPoints: 16, points: 170 }); },
  } });
  const { port } = await engine.listen(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  try {
    await mockApi(context, user, (pathname, request) => {
      if (pathname === '/api/queue') { if (request.method() === 'POST') queued = true; return queued ? { state: accepted ? 'READY' : 'OFFERED', mode: 'RANKED', matchId: id, playersFound: 1, requiredPlayers: 6, acceptanceDeadline: new Date(now + 15000).toISOString(), serverTime: new Date(now).toISOString() } : { state: 'IDLE' }; }
      if (pathname === '/api/queue/respond') { expect(request.postDataJSON()).toEqual({ matchId: id, accept: true }); accepted = true; return { state: 'READY', mode: 'RANKED', matchId: id }; }
      if (pathname === '/api/match/ticket') return { matchId: id, ticket: token, engineUrl: `ws://127.0.0.1:${port}/play` };
      if (pathname === `/api/results/${id}`) return receipt;
    });
    await page.goto(origin); await page.locator('#mode-ranked').click(); await page.locator('#armory-button').click(); await page.locator('#weapon-choices [data-weapon=awp]').click(); await page.locator('#skin-choices [data-skin=arctic]').click(); await page.getByRole('button', { name: '장비 저장', exact: true }).click();
    await page.locator('#create-button').click(); await expect(page.locator('#online-accept-match')).toBeVisible(); expect(engine.matches.size).toBe(0); await page.locator('#online-accept-match').click();
    await expect.poll(() => engine.matches.get(id)?.room.phase).toBe('countdown'); engine.broadcast();
    await expect(page.locator('#game-shell')).toBeVisible(); await expect(page.locator('#lobby')).toBeHidden(); await expect(page.locator('#game-shell > #match-intro')).toBeVisible(); await expect(page.locator('#match-countdown-value')).toHaveText('5'); await expect(page.locator('#hud-map-name')).toHaveText('FOUNDRY 07');
    const match = engine.matches.get(id), player = match.room.players.get(user.id);
    expect(player.weaponId).toBe('awp'); expect(player.skinId).toBe('arctic'); expect([...match.room.players.values()].filter((p) => p.teamId === 'blue')).toHaveLength(3); expect([...match.room.players.values()].filter((p) => p.teamId === 'red')).toHaveLength(3);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/in-game-ranked-countdown.png' });
    await page.keyboard.press('f'); await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('game-shell'); await page.keyboard.press('f');
    await page.keyboard.press('e'); await expect(page.locator('#armory-dialog')).toBeVisible(); await expect(page.locator('#armory-dialog')).toHaveAttribute('data-scope', 'online'); await page.locator('#weapon-choices [data-weapon=m82]').click(); await expect.poll(() => player.weaponId).toBe('m82'); engine.broadcast();
    await page.getByRole('button', { name: '장비 저장', exact: true }).click();
    await page.keyboard.press('w'); await page.keyboard.press('Escape'); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#pause-overlay')).toBeHidden();
    now += 5000; engine.tick(1 / 60); engine.broadcast(); await expect(page.locator('#pause-overlay')).toBeHidden(); await expect(page.locator('#combat-focus-hint')).toBeVisible(); await expect(page.locator('#match-intro')).toBeHidden();
    match.room.teamScores.blue = 1; player.kills = 1; player.weaponKills.awp = 1; const started = Date.now(); match.room.finish(); engine.tick(1 / 60); await expect.poll(() => match.settlement).toBe('saved'); engine.broadcast();
    await expect(page.locator('#round-effect')).toHaveAttribute('data-kind', 'victory'); await expect(page.locator('#round-effect h2')).toHaveText('VICTORY'); await expect(page.locator('#round-overlay')).toBeHidden();
    engine.broadcast(); await expect(page.locator('#round-overlay')).toBeVisible({ timeout: 9000 }); expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    await expect(page.locator('#online-rating-summary')).toContainText('승급'); await expect(page.locator('#ranked-results-transition')).toHaveText('승급'); await expect(page.locator('#profile-points')).toHaveText('170');
    await expect(page.locator('#ranked-results')).toHaveAttribute('data-phase', 'complete'); await expect(page.locator('#ranked-results-delta')).toHaveText('+26 RP'); await expect(page.locator('#ranked-results-progress')).toContainText('16 RP'); await expect(page.locator('#ranked-results-tiers')).toHaveText('브론즈 I → 실버 V');
    await page.screenshot({ path: 'artifacts/animated-ranked-results.png' });
    await page.locator('#round-leave').click(); await expect(page.locator('#lobby-match-result')).toBeVisible(); await expect(page.locator('#lobby-result-delta')).toHaveText('+26 RP'); await expect(page.locator('#lobby-result-detail')).toContainText('승급'); await expect(page.locator('#hero-rank-tier')).toHaveText('실버 V'); expect(errors).toEqual([]);
  } finally { await engine.close(); }
});

test('thumbnail map selection accepts high wave counts and kill HUD opacity persists and applies to animated multikills', async ({ context, page }) => {
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const APP_MODE='solo'; export const PROFILE_STORAGE='browser';" }));
  await page.goto(origin); await page.locator('#deployment-settings-button').click(); await expect(page.locator('#room-map-cards img').first()).toBeVisible();
  await page.locator('#room-game-type').selectOption('defense'); await expect(page.locator('.room-map-card:visible')).toHaveCount(1); await expect(page.locator('.room-map-card:visible img')).toBeVisible(); await page.locator('#frag-limit').fill('50'); await page.locator('#room-create-confirm').click();
  await page.locator('[data-open=settings-dialog]').first().click();
  for (const [id, value] of [['killfeed-opacity', 35], ['kill-announcement-opacity', 20]]) await page.locator(`#${id}`).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await page.getByRole('button', { name: '완료', exact: true }).click(); await page.reload();
  await page.locator('[data-open=settings-dialog]').first().click(); await expect(page.locator('#killfeed-opacity')).toHaveValue('35'); await expect(page.locator('#kill-announcement-opacity')).toHaveValue('20'); await page.getByRole('button', { name: '완료', exact: true }).click();
  await page.locator('#create-button').click(); await expect(page.locator('#pause-overlay')).toBeVisible();
  const styles = await page.evaluate(() => ({ feed: getComputedStyle(document.getElementById('killfeed')).opacity, awards: getComputedStyle(document.querySelector('.combat-awards')).opacity, count: getComputedStyle(document.getElementById('hud-kd')).opacity }));
  expect(styles).toEqual({ feed: '0.35', awards: '0.2', count: '0.2' }); await page.locator('#leave-button').click();
});

test('collapsed matchmaking stays in the reserved main action slot, can be cancelled there, and offers never auto-accept', async ({ context, page }) => {
  let state = { state: 'IDLE' }, next = 'QUEUED', cancellations = 0, ticketRequests = 0;
  const id = randomUUID();
  await mockApi(context, profile(), (pathname, request) => {
    if (pathname === '/api/queue') {
      if (request.method() === 'DELETE') { cancellations++; state = { state: 'IDLE' }; }
      if (request.method() === 'POST') state = { state: next, mode: 'RANKED', elapsedSeconds: 7, playersFound: 2, requiredPlayers: 6, matchId: id, serverTime: new Date().toISOString(), acceptanceDeadline: new Date(Date.now() + 15000).toISOString(), acceptedPlayers: 0 };
      return state;
    }
    if (pathname === '/api/match/ticket') ticketRequests++;
  });
  await page.goto(origin); await page.locator('#mode-ranked').click();
  for (const [width, height] of [[1440,900], [1024,600], [360,600], [740,480]]) {
    await page.setViewportSize({ width, height }); const before = await page.locator('.selected-map').boundingBox(), action = await page.locator('#create-button').boundingBox();
    await page.locator('#create-button').click(); await page.getByLabel('매칭 창 접기').click();
    await expect(page.locator('#matchmaking-status')).toContainText('상대를 찾는 중'); await expect(page.locator('#matchmaking-cancel')).toBeInViewport();
    const current = await page.locator('#matchmaking-widget').boundingBox();
    expect(current.width).toBe(action.width); expect(current.height).toBe(action.height); expect(current.y).toBe(action.y);
    expect(await page.locator('.selected-map').boundingBox()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#matchmaking-cancel').click(); await expect(page.locator('#matchmaking-widget')).toBeHidden(); await expect(page.locator('#create-button')).toBeVisible();
  }
  expect(cancellations).toBe(4); next = 'OFFERED'; await page.locator('#create-button').click(); await expect(page.locator('#online-accept-match')).toBeVisible();
  await page.getByLabel('매칭 창 접기').click(); await expect(page.locator('#matchmaking-accept')).toBeInViewport(); expect(ticketRequests).toBe(0);
  await page.locator('#matchmaking-cancel').click(); await expect(page.locator('#matchmaking-widget')).toBeHidden(); expect(ticketRequests).toBe(0);
});

test('all deployment modes share the same account armory and LP, while device records remain untouched', async ({ context, page }) => {
  const user = profile(); user.points = 108690;
  await mockApi(context, user); await page.goto(origin);
  await expect(page.locator('#profile-rank-tier')).toHaveText('브론즈 I');
  await expect(page.locator('#profile-points')).toHaveText('108,690');
  for (const mode of ['ranked', 'practice', 'lan', 'custom', 'casual']) {
    await page.locator(`#mode-${mode}`).click(); await page.locator('#armory-button').click();
    await expect(page.locator('#armory-dialog')).toBeVisible();
    await expect(page.locator('#armory-dialog')).toHaveAttribute('data-scope', 'online');
    await expect(page.locator('#weapon-choices button')).toHaveCount(WEAPONS.length); await expect(page.locator('#weapon-stats')).toContainText('기본 피해');
    if (mode === 'ranked') { await page.locator('#weapon-choices [data-weapon=awp]').click(); await expect(page.locator('#weapon-choices [data-weapon=awp]')).toHaveClass(/locked/); await expect(page.locator('#armory-owned-state')).toContainText('계정 LP로 영구 해금'); }
    if (mode === 'practice') await expect(page.locator('#weapon-choices [data-weapon=awp]')).toHaveClass(/locked/);
    await page.getByRole('button', { name: '장비 저장', exact: true }).click();
    await expect(page.locator('#profile-points')).toHaveText('108,690');
  }
  await page.locator('.profile-points').click(); await expect(page.locator('#shop-dialog')).toBeVisible(); await expect(page.locator('#shop-points')).toHaveText('108,690'); await expect(page.locator('#local-profile-points')).toHaveText('0 LP');
});

test('account LP unlocks a firearm for practice, LAN and custom without changing the offline wallet', async ({ context, page }) => {
  const user = profile(); Object.assign(user, { points: 100000, characterId: 'male', outfitId: 'field', ownedOutfits: ['field'] });
  let purchases = 0;
  await mockApi(context, user, pathname => {
    if (pathname === '/api/account/weapons/m82/purchase') { if (!user.ownedWeapons.includes('m82')) { user.points -= 2000; user.ownedWeapons.push('m82'); } purchases++; return user; }
  });
  await page.goto(origin); await expect(page.locator('#profile-rank-tier')).toHaveText('브론즈 I'); await page.locator('#mode-practice').click(); await page.locator('#armory-button').click();
  await page.locator('#weapon-choices [data-weapon=m82]').click(); await expect(page.locator('#armory-unlock')).toHaveText('2,000 LP로 영구 해금'); await expect(page.locator('#armory-unlock')).toBeEnabled(); await page.locator('#armory-unlock').click(); await page.locator('#confirm-purchase').click();
  await expect(page.locator('#purchase-dialog')).toBeHidden(); await expect(page.locator('#profile-points')).toHaveText('98,000'); await expect(page.locator('#armory-owned-state')).toContainText('영구 해금됨');
  await page.getByRole('button', { name: '장비 저장', exact: true }).click();
  for (const mode of ['practice','lan','custom']) { await page.locator(`#mode-${mode}`).click(); await expect(page.locator('#profile-points')).toHaveText('98,000'); await expect(page.locator('#loadout-weapon')).toContainText('Barrett M82'); }
  await page.locator('#mode-practice').click(); await page.locator('#create-button').click(); await expect(page.locator('#pause-overlay')).toBeVisible(); await expect(page.locator('#hud-weapon-name')).toHaveText('Barrett M82'); await page.locator('#leave-button').click();
  expect(purchases).toBe(1); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).points)).toBe(0);
  await page.reload(); await expect(page.locator('#profile-points')).toHaveText('98,000'); await expect(page.locator('#loadout-weapon')).toContainText('Barrett M82');
});

test('reduced-motion rank results show exact signed losses, demotion, draws and placements without replaying or leaking animations', async ({ page }) => {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(origin);
  await page.evaluate(async () => {
    const { RankedResults } = await import('/ranked-results.js');
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false; document.getElementById('round-overlay').hidden = false;
    const panel = new RankedResults(); window.__results = panel; panel.pending('loss');
  });
  await expect(page.locator('#ranked-results-delta')).toHaveText('…');
  const loss = { matchId: 'loss', mode: 'CASUAL', outcome: 'LOSS', won: false, rankTierBefore: 'SILVER', rankDivisionBefore: 5, rankPointsBefore: 0, rankPointsDelta: -25, rankTier: 'BRONZE', rankDivision: 1, rankPointsAfter: 75, placementsPlayed: 5, kills: 3, deaths: 8, assists: 1 };
  await page.evaluate(receipt => { window.__results.setReceipt(receipt); window.__results.reveal(); window.__results.setReceipt(receipt); }, loss);
  await expect(page.locator('#ranked-results-delta')).toHaveText('-25 RP'); await expect(page.locator('#ranked-results-transition')).toHaveText('강등'); await expect(page.locator('#ranked-results-emblem')).toHaveAttribute('src', /ffa\/bronze/); await expect(page.locator('#ranked-results-progress')).toContainText('75 RP');
  await page.evaluate(receipt => { window.__results.pending('draw'); window.__results.setReceipt({ ...receipt, matchId: 'draw', outcome: 'DRAW', rankTierBefore: 'UNRANKED', rankTier: 'UNRANKED', rankPointsDelta: 0, rankPointsAfter: 0, placementsPlayed: 3 }); window.__results.reveal(); }, loss);
  await expect(page.locator('#ranked-results-delta')).toHaveText('+0 RP'); await expect(page.locator('#ranked-results-transition')).toHaveText('무승부'); await expect(page.locator('#ranked-results-progress')).toHaveText('배치 3 / 5'); await expect(page.locator('#ranked-results-track')).toHaveAttribute('aria-valuenow', '60');
  await page.evaluate(() => window.__results.reset()); await expect(page.locator('#ranked-results')).toBeHidden();
});

test('acceptance gauges count down from the server deadline without replaying on polling or folding the dialog', async ({ page }) => {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { MatchOfferTimer } = await import('/match-offer-timer.js'), timer = new MatchOfferTimer();
    document.getElementById('online-queue-panel').hidden = false; document.getElementById('queue-dialog').showModal();
    const now = Date.now(), state = { state: 'OFFERED', matchId: 'offer-a', serverTime: new Date(now).toISOString(), acceptanceDeadline: new Date(now + 15000).toISOString() };
    timer.update(state);
    const root = document.getElementById('dialog-acceptance-track'), animation = root.firstElementChild.getAnimations()[0]; animation.pause(); animation.currentTime = 5000;
    timer.update({ ...state, serverTime: new Date(now + 5000).toISOString() });
    const sameAnimation = root.firstElementChild.getAnimations()[0] === animation, remaining = root.getAttribute('aria-valuenow'), time = animation.currentTime;
    animation.finish(); const finalScale = getComputedStyle(root.firstElementChild).transform;
    timer.update({ state: 'IDLE' });
    return { sameAnimation, remaining, time, finalScale, hidden: root.hidden, retired: root.firstElementChild.getAnimations().length };
  });
  expect(result.sameAnimation).toBe(true); expect(result.remaining).toBe('10'); expect(result.time).toBe(5000); expect(result.finalScale).toBe('matrix(0, 0, 0, 1, 0, 0)'); expect(result.hidden).toBe(true); expect(result.retired).toBe(0);
});

test('defeat and draw effects last five seconds, wave transitions do not replay on snapshots, and disposal cancels pending result actions', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.clock.install({ time: new Date('2026-11-17T00:00:00Z') }); await page.goto(origin); await page.clock.pauseAt(new Date('2026-11-17T00:01:00Z'));
  await page.evaluate(async () => {
    const { RoundEffects } = await import('/round-effects.js'); document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const effects = new RoundEffects(), players = [{ id: 'self', teamId: 'blue' }], room = { roundId: 'round-a', phase: 'ended', gameType: 'teams', result: { winnerTeam: 'red' } };
    window.__roundEffectFixture = { effects, room, players, done: 0 };
    effects.update(room, players, 'self', () => window.__roundEffectFixture.done++);
  });
  await expect(page.locator('#round-effect')).toHaveAttribute('data-kind', 'defeat'); await expect(page.locator('#round-effect h2')).toHaveText('DEFEAT');
  await page.clock.fastForward(4999); await expect(page.locator('#round-effect')).toBeVisible(); await page.clock.fastForward(1); await expect(page.locator('#round-effect')).toBeHidden();
  expect(await page.evaluate(() => window.__roundEffectFixture.done)).toBe(1);
  await page.evaluate(() => { const f = window.__roundEffectFixture; f.effects.update(f.room, f.players, 'self', () => f.done++); }); await expect(page.locator('#round-effect')).toBeHidden();
  await page.evaluate(() => { const f = window.__roundEffectFixture; f.room = { roundId: 'round-b', phase: 'active', gameType: 'defense', objective: { kind: 'defense', phase: 'wave', wave: 1, cleared: 0, aliveEnemies: 4, pending: 0 } }; f.effects.update(f.room, f.players, 'self'); });
  await expect(page.locator('#round-effect h2')).toHaveText('WAVE 1'); await page.clock.fastForward(2600); await expect(page.locator('#round-effect')).toBeHidden();
  await page.evaluate(() => { const f = window.__roundEffectFixture; f.effects.update(f.room, f.players, 'self'); }); await expect(page.locator('#round-effect')).toBeHidden();
  await page.evaluate(() => { const f = window.__roundEffectFixture; Object.assign(f.room.objective, { phase: 'prepare', wave: 2, cleared: 1 }); f.effects.update(f.room, f.players, 'self'); });
  await expect(page.locator('#round-effect h2')).toHaveText('WAVE 1 CLEAR');
  await page.evaluate(() => { const f = window.__roundEffectFixture; Object.assign(f.room.objective, { phase: 'wave', aliveEnemies: 8 }); f.effects.update(f.room, f.players, 'self'); }); await expect(page.locator('#round-effect h2')).toHaveText('WAVE 2');
  await page.evaluate(() => { const f = window.__roundEffectFixture; f.room = { roundId: 'round-c', phase: 'ended', gameType: 'teams', result: { winnerTeam: null } }; f.effects.update(f.room, f.players, 'self', () => f.done++); }); await expect(page.locator('#round-effect h2')).toHaveText('DRAW');
  await page.evaluate(() => window.__roundEffectFixture.effects.dispose()); await page.clock.fastForward(5000); expect(await page.evaluate(() => window.__roundEffectFixture.done)).toBe(1); await expect(page.locator('#round-effect')).toHaveCount(0);
});
