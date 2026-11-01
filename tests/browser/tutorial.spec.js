import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function fixture(page, stage) {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  await page.evaluate(async (stage) => {
    const [{ TutorialSession }, { TRAINING_WORLD }, { FPSGame }] = await Promise.all([import('/shared/tutorial.js'), import('/shared/training-world.js'), import('/game.js')]);
    const tutorial = new TutorialSession('viewer', 'VIEWER'); tutorial.setStage(stage);
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), world: TRAINING_WORLD, settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio: { unlock: async () => {}, step() {}, shot() {}, reload() {}, hit() {}, hurt() {}, kill() {} },
      send(data) { if (data.type === 'input') tutorial.setInput(data); if (data.type === 'tutorial-action') tutorial.command(data); }, onMenu(show) { document.getElementById('pause-overlay').hidden = !show; }, onFatal(message) { throw new Error(message); } });
    game.applySnapshot(tutorial.snapshot(), tutorial.player.id); await game.prepareGraphics();
    let ticks = 0; const timer = setInterval(() => { tutorial.tick(1 / 60); if (++ticks % 3 === 0) game.applySnapshot(tutorial.snapshot()); }, 1000 / 60);
    const start = () => game.lock(); document.getElementById('resume-button').addEventListener('click', start); document.getElementById('pause-overlay').hidden = false;
    window.__respawnTutorial = { tutorial, game, timer, start };
  }, stage);
}

async function dispose(page) { await page.evaluate(async () => { const f = window.__respawnTutorial; if (!f) return; clearInterval(f.timer); document.getElementById('resume-button').removeEventListener('click', f.start); await f.game.dispose(); delete window.__respawnTutorial; }); }

test('the respawn lesson still waits for an explicit start and visible recovery before proceeding to final target practice', async ({ page }) => {
  await fixture(page, 5);
  try {
    await page.getByRole('button', { name: '교전 시작', exact: true }).click(); await expect(page.locator('#tutorial-action-hint')).toContainText('시범 시작');
    const before = Date.now(); await expect.poll(async () => { expect(await page.evaluate(() => window.__respawnTutorial.tutorial.player.hp)).toBe(100); return Date.now() - before; }).toBeGreaterThan(500);
    await page.keyboard.press('Enter'); await expect(page.locator('#respawn-overlay')).toBeVisible(); await expect(page.locator('#respawn-overlay')).toBeHidden();
    expect(await page.evaluate(() => ({ hp: window.__respawnTutorial.tutorial.player.hp, complete: window.__respawnTutorial.tutorial.completed, phase: window.__respawnTutorial.game.room.phase }))).toEqual({ hp: 100, complete: false, phase: 'active' });
    await expect.poll(() => page.evaluate(() => window.__respawnTutorial.game.weapon.visible)).toBe(true);
    await page.keyboard.press('Enter'); expect(await page.evaluate(() => window.__respawnTutorial.tutorial.completed)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__respawnTutorial.tutorial.snapshot(false).tutorial.action?.enabled)).toBe(true);
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/tutorial-respawn-visible.png' });
    expect(await page.evaluate(() => window.__respawnTutorial.tutorial.completed)).toBe(false);
    await page.keyboard.press('Enter'); await expect(page.locator('#tutorial-title')).toHaveText('마무리 표적 연습'); expect(await page.evaluate(() => window.__respawnTutorial.tutorial.completed)).toBe(false);
  } finally { await dispose(page); }
});

test('final target practice keeps a harmless stationary AI respawning in place until the player explicitly finishes', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await fixture(page, 6);
  try {
    const initial = await page.evaluate(() => { const f = window.__respawnTutorial, bot = f.tutorial.opponent; return { x: bot.x, y: bot.y, z: bot.z, yaw: bot.yaw, pitch: bot.pitch }; });
    await page.getByRole('button', { name: '교전 시작', exact: true }).click(); await expect(page.locator('#tutorial-title')).toHaveText('마무리 표적 연습'); await page.keyboard.press('Enter'); expect(await page.evaluate(() => window.__respawnTutorial.tutorial.completed)).toBe(false);
    for (let i = 0; i < 2; i++) {
      const spawn = await page.evaluate(() => window.__respawnTutorial.tutorial.opponent.spawnCount);
      await page.mouse.down({ button: 'right' });
      // Re-aim between real trigger taps instead of expecting an uncompensated
      // automatic spray to remain on a small head at the far end of the range.
      for (let shot = 0; shot < 10 && await page.evaluate(() => window.__respawnTutorial.tutorial.opponent.hp > 0); shot++) {
        await expect.poll(() => page.evaluate(() => { const f = window.__respawnTutorial; return f.tutorial.player.nextFireAt <= f.tutorial.room.clock(); })).toBe(true);
        const serial = await page.evaluate(async () => { const f = window.__respawnTutorial, p = f.tutorial.player, bot = f.tutorial.opponent, { playerPose } = await import('/shared/world.js'); f.game.yaw = Math.atan2(-(bot.x - p.x), -(bot.z - p.z)); f.game.pitch = Math.atan2(bot.y + playerPose(bot).headHeight - p.y - playerPose(p).eyeHeight, Math.hypot(bot.x - p.x, bot.z - p.z)); return p.shotSerial; });
        await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' }); await expect.poll(() => page.evaluate(() => window.__respawnTutorial.tutorial.player.shotSerial)).toBeGreaterThan(serial);
      }
      expect(await page.evaluate(() => window.__respawnTutorial.tutorial.opponent.hp)).toBe(0); await page.mouse.up({ button: 'right' });
      await expect.poll(() => page.evaluate(() => window.__respawnTutorial.tutorial.opponent.spawnCount)).toBe(spawn + 1);
      const current = await page.evaluate(() => { const f = window.__respawnTutorial, bot = f.tutorial.opponent; return { position: { x: bot.x, y: bot.y, z: bot.z, yaw: bot.yaw, pitch: bot.pitch }, hp: bot.hp, shots: bot.shotSerial, playerHp: f.tutorial.player.hp, complete: f.tutorial.completed }; }); expect(current).toEqual({ position: initial, hp: 100, shots: 0, playerHp: 100, complete: false });
    }
    await expect(page.locator('#round-overlay')).toBeHidden(); await expect(page.locator('#tutorial-action-hint')).toContainText('연습 마치고');
    await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/tutorial-final-stationary-target.png' });
    await page.keyboard.press('Enter'); await expect(page.locator('#tutorial-title')).toHaveText('기초 훈련 완료'); expect(errors).toEqual([]);
  } finally { await dispose(page); }
});
