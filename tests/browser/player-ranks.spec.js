import { test, expect } from '@playwright/test';

test('official highest-tier marks appear on rosters, scoreboard, kill feedback, self counter and attacker death details', async ({ page }) => {
  await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluate(async () => {
      const [{ FPSGame, renderScoreboard }, { Room }, { getWeapon }, { RoomLobbyView }] = await Promise.all([import('/game.js'), import('/shared/simulation.js'), import('/shared/catalog.js'), import('/room-lobby.js')]);
      const room = new Room('RANKS', { bots: 0, fragLimit: 100 }), a = room.addPlayer('a', 'GOLD HUNTER'), b = room.addPlayer('b', 'DIAMOND GUARD');
      a.rankBadge = { tier: 'GOLD', division: 2, ladder: 'ffa' }; b.rankBadge = { tier: 'DIAMOND', division: 4, ladder: 'teams' };
      const lobby = new RoomLobbyView(() => {}), roster = room.snapshot(false); roster.room.phase = 'lobby'; roster.players.forEach(p => Object.assign(p, { roomStatus: 'waiting', teamConfirmed: true })); lobby.update(roster, a.id);
      renderScoreboard(document.getElementById('scoreboard-table'), roster.players, a.id);
      document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
      const audio = { step() {}, stopReload() {}, kill() {}, hurt() {}, shot() {}, hit() {} };
      const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), mapId: 'foundry', settings: { fov: 82, sensitivity: 1, quality: 'low', volume: 0 }, audio, send() {}, onMenu() {}, onFatal(message) { throw new Error(message); } });
      game.applySnapshot(room.snapshot(), a.id); await game.prepareGraphics(); window.__rankFixture = { room, a, b, game, getWeapon };
      room.applyDamage(a, b, 100, false, {}, getWeapon('rifle'), room.clock()); game.applySnapshot(room.snapshot());
    });
    await expect(page.locator('#room-lobby-roster [data-member=a] .player-rank-mark')).toHaveAttribute('data-ladder', 'ffa');
    await expect(page.locator('#scoreboard-table .player-rank-mark')).toHaveCount(2);
    await expect(page.locator('#hud-self-rank img')).toHaveAttribute('src', /ranks\/ffa\/gold\.svg/);
    await expect(page.locator('#kill-rank-badge')).toBeVisible(); await expect(page.locator('#kill-rank-badge img')).toHaveAttribute('src', /ranks\/diamond\.svg/); await expect(page.locator('#kill-rank-badge')).toContainText('팀전 · 다이아 IV');
    await expect(page.locator('#killfeed .player-rank-mark')).toHaveCount(2);
    await page.evaluate(() => { const { room, a, b, game, getWeapon } = window.__rankFixture; room.spawn(b); room.applyDamage(b, a, 100, false, {}, getWeapon('rifle'), room.clock()); game.applySnapshot(room.snapshot()); });
    await expect(page.locator('#death-rank-badge')).toBeVisible(); await expect(page.locator('#death-rank-badge img')).toHaveAttribute('src', /ranks\/diamond\.svg/); await expect(page.locator('#death-rank-badge')).toContainText('팀전 · 다이아 IV');
    expect(errors).toEqual([]);
  } finally { await page.evaluate(() => window.__rankFixture?.game.dispose()); }
});

test('account password minimum is eight characters in the profile form', async ({ page, context }) => {
  await context.route('**/runtime-config.js', route => route.fulfill({ contentType: 'text/javascript', body: "export const APP_MODE='solo'; export const PROFILE_STORAGE='browser';" }));
  await page.goto('/'); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible(); await page.locator('#profile-button').click();
  const password = page.getByLabel('비밀번호 (8자 이상)', { exact: true }); await expect(password).toHaveAttribute('minlength', '8');
  await password.fill('seven77'); expect(await password.evaluate(input => input.checkValidity())).toBe(false);
  await password.fill('eight888'); expect(await password.evaluate(input => input.checkValidity())).toBe(true);
});
