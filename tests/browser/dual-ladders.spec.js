import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const origin = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}`, api = 'http://127.0.0.1:18092';
const ladder = (kind, overrides = {}) => ({
  rankTier: kind === 'ffa' ? 'SILVER' : 'GOLD', rankDivision: kind === 'ffa' ? 4 : 2, rankPoints: kind === 'ffa' ? 17 : 42,
  placementsPlayed: 5, placementWins: 3, rankedGames: 20, roundsPlayed: 20, wins: kind === 'ffa' ? 5 : 14, draws: 2, kills: 80, deaths: 40, assists: 20,
  recentMatches: Array.from({ length: 10 }, (_, i) => ({ matchId: `${kind}-match-${i}`, mapId: i % 2 ? 'foundry' : 'nightmarket', outcome: i % 3 ? 'WIN' : i % 2 ? 'DRAW' : 'LOSS', kills: 10 + i, deaths: 5, assists: 3, rankPointsDelta: i % 3 ? 25 : i % 2 ? 0 : -25, completedAt: '2026-11-17T12:00:00Z' })),
  ...overrides,
});
test('each mode shows its own tier, win rate, K/DA and ten games without page or panel scrolling, even with long records and result notices', async ({ page, context }) => {
  test.setTimeout(90_000);
  const user = { id: 'dual-ladder-account', callsign: 'DUAL RANK', points: 105500, kills: 99999, deaths: 99999, casualRating: 1432, rankTier: 'GOLD', rankDivision: 2, rankPoints: 42, placementsPlayed: 5, ownedWeapons: ['rifle', 'pistol', 'shotgun', 'sniper'], weaponKills: {}, competitive: { ffa: ladder('ffa'), teams: ladder('teams') } };
  await context.route('**/runtime-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const APP_MODE='solo'; export const PROFILE_STORAGE='browser'; export const ONLINE_SERVER_URL=${JSON.stringify(api)};` }));
  let healthChecks = 0;
  await context.route(api + '/api/**', (route) => { const path = new URL(route.request().url()).pathname; if (path === '/api/health') healthChecks++; return route.fulfill({ headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }, contentType: 'application/json', body: JSON.stringify(path === '/api/health' ? { service: 'linkshot-online', matchmaking: true } : path === '/api/account' ? user : { state: 'IDLE' }) }); });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto(origin);
  await expect(page.locator('#profile-casual-rating')).toHaveText('실버 IV'); await expect(page.locator('#profile-rank-tier')).toHaveText('골드 II');
  await page.locator('#dashboard-ffa').click(); await expect(page.locator('#hero-rank-tier')).toHaveText('실버 IV'); await expect(page.locator('#hero-winrate')).toHaveText('25.0%'); await expect(page.locator('#hero-kda')).toHaveText('2.50'); await expect(page.locator('#hero-record')).toHaveText('5/2/13'); await expect(page.locator('#hero-combat-counts')).toHaveText('80/40/20');
  await expect(page.locator('#recent-match-list > li')).toHaveCount(10); await expect(page.locator('#recent-match-list > li').first()).toHaveAttribute('data-match', 'ffa-match-0');
  await page.locator('#dashboard-teams').click(); await expect(page.locator('#hero-rank-tier')).toHaveText('골드 II'); await expect(page.locator('#hero-winrate')).toHaveText('70.0%'); await expect(page.locator('#recent-match-list > li').first()).toHaveAttribute('data-match', 'teams-match-0');
  for (const [width, height] of [[1920,1080],[1440,900],[1366,768],[1280,720],[1024,600],[820,768],[740,667],[390,844],[375,667],[360,640],[360,600],[1280,540],[740,540],[390,560],[360,480]]) {
    await page.setViewportSize({ width, height });
    for (const key of ['ffa', 'teams']) {
      await page.locator(`#dashboard-${key}`).click();
      for (const notice of [false, true]) {
      const result = await page.evaluate((notice) => {
        const banner = document.getElementById('lobby-match-result'); banner.hidden = !notice; document.getElementById('lobby-result-mode').textContent = '개인전 랭크'; document.getElementById('lobby-result-delta').textContent = '+25 RP'; document.getElementById('lobby-result-detail').textContent = '승급 · 승리 · 플래티넘 III · 17 RP';
        const root = document.getElementById('competitive-hero').getBoundingClientRect(), list = document.getElementById('recent-match-list');
        const ids = ['hero-rank-tier', 'hero-record', 'hero-winrate', 'hero-kda', 'hero-combat-counts', 'dashboard-ffa', 'dashboard-teams', 'create-button', 'armory-button'];
        const outside = ids.filter(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width <= 0 || r.height <= 0 || r.top < 0 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1; });
        const clippedMatches = [...list.children].filter(item => { const r = item.getBoundingClientRect(); return r.top < root.top || r.bottom > root.bottom + 1 || item.scrollHeight > item.clientHeight + 1; }).length;
        return { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, outside, clippedMatches, listScroll: list.scrollHeight > list.clientHeight + 1 };
      }, notice);
      expect(result, `${width}x${height}/${key}/notice=${notice}`).toEqual({ width, height, outside: [], clippedMatches: 0, listScroll: false });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/dual-ladder-stats-desktop.png' });
  await page.setViewportSize({ width: 360, height: 640 }); await page.screenshot({ path: 'artifacts/dual-ladder-stats-mobile.png' });
  for (const [width, height] of [[1440,900], [1024,600], [390,844]]) {
    await page.setViewportSize({ width, height }); const frames = [];
    for (const mode of ['casual', 'ranked', 'custom', 'lan', 'practice', 'tutorial']) {
      await page.locator(`#mode-${mode}`).click();
      frames.push(await page.locator('.selected-map').evaluate(node => { const r = node.getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), bottom: Math.round(r.bottom) }; }));
    }
    expect(new Set(frames.map(frame => JSON.stringify(frame))).size, `fixed map allocation ${width}x${height}`).toBe(1);
  }
  await page.locator('#mode-practice').click(); await page.locator('#dashboard-ffa').click(); await page.locator('#rank-card').click(); await expect(page.locator('#rank-detail-emblem')).toHaveAttribute('src', /ranks\/ffa\/silver\.svg/); await page.keyboard.press('Escape');
  await page.locator('#mode-casual').click(); await expect(page.locator('#hero-rank-tier')).toHaveText('실버 IV'); await page.locator('#dashboard-teams').click();
  const checks = healthChecks; await expect.poll(() => healthChecks).toBeGreaterThan(checks); await expect(page.locator('#hero-rank-tier')).toHaveText('골드 II');
  await page.reload(); await expect(page.locator('#dashboard-teams')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#hero-rank-tier')).toHaveText('골드 II'); expect(errors).toEqual([]);
});
