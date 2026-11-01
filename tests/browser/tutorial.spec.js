import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('the final lesson waits for an explicit start, shows the respawn alive, and requires a later Enter confirmation', async ({ page }) => {
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: '' })); await page.goto('/');
  await page.evaluate(async () => {
    const [{ TutorialSession }, { TRAINING_WORLD }, { FPSGame }] = await Promise.all([import('/shared/tutorial.js'), import('/shared/training-world.js'), import('/game.js')]);
    const tutorial = new TutorialSession('viewer', 'VIEWER'); tutorial.setStage(5);
    document.getElementById('lobby').hidden = true; document.getElementById('game-shell').hidden = false;
    const game = new FPSGame({ canvas: document.getElementById('game-canvas'), minimap: document.getElementById('minimap'), world: TRAINING_WORLD, settings: { sensitivity: 1, fov: 82, volume: 0, quality: 'low' }, audio: { unlock: async () => {}, step() {}, shot() {}, reload() {}, hit() {}, hurt() {}, kill() {} },
      send(data) { if (data.type === 'input') tutorial.setInput(data); if (data.type === 'tutorial-action') tutorial.command(data); }, onMenu(show) { document.getElementById('pause-overlay').hidden = !show; }, onFatal(message) { throw new Error(message); } });
    game.applySnapshot(tutorial.snapshot(), tutorial.player.id); await game.prepareGraphics();
    let ticks = 0; const timer = setInterval(() => { tutorial.tick(1 / 60); if (++ticks % 3 === 0) game.applySnapshot(tutorial.snapshot()); }, 1000 / 60);
    const start = () => game.lock(); document.getElementById('resume-button').addEventListener('click', start); document.getElementById('pause-overlay').hidden = false;
    window.__respawnTutorial = { tutorial, game, timer, start };
  });
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
    await page.keyboard.press('Enter'); await expect(page.locator('#tutorial-title')).toHaveText('기초 훈련 완료');
  } finally {
    await page.evaluate(async () => { const f = window.__respawnTutorial; clearInterval(f.timer); document.getElementById('resume-button').removeEventListener('click', f.start); await f.game.dispose(); delete window.__respawnTutorial; });
  }
});
