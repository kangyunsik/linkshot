import { test, expect } from '@playwright/test';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { createProfile } from '../../shared/progression.js';

test('portable host keeps identity and purchases after browser storage is cleared', async ({ browser }) => {
  test.setTimeout(90_000);
  const root = process.cwd(), go = process.env.GO_BINARY || path.join(root, '.toolchain/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
  try { await access(go); } catch { test.skip(true, 'Optional local packaging compiler is not installed.'); }
  const base = path.join(root, 'artifacts/native-profile-e2e'); await mkdir(base, { recursive: true });
  const stage = await mkdtemp(path.join(base, 'run-'));
  await cp(path.join(root, 'dist'), path.join(stage, 'web'), { recursive: true });
  await cp(path.join(root, 'scripts/windows-launcher.go'), path.join(stage, 'main.go'));
  const dataDir = path.join(stage, 'user-data'); await mkdir(dataDir);
  const initial = createProfile('host-demo-profile-0001', Date.now(), 'HOST TESTER'); Object.assign(initial, { points: 600, totalEarned: 600 });
  await writeFile(path.join(dataDir, 'profile.json'), JSON.stringify(initial));
  const binary = path.join(stage, process.platform === 'win32' ? 'native-test.exe' : 'native-test');
  execFileSync(go, ['build', '-trimpath', '-o', binary, 'main.go'], { cwd: stage, env: { ...process.env, CGO_ENABLED: '0' }, timeout: 60_000 });
  expect((await readFile(binary)).includes(Buffer.from(initial.id))).toBe(false);
  const child = spawn(binary, ['--no-browser'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LINKSHOT_DATA_DIR: dataDir } });
  let context;
  try {
    const url = await new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('Native launcher did not start')), 10_000);
      child.once('error', reject); child.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
    context = await browser.newContext();
    await context.addInitScript(() => { try { localStorage.setItem('sector07-settings', JSON.stringify({ sensitivity: 1, fov: 82, volume: 0, quality: 'low' })); } catch { /* about:blank */ } });
    const page = await context.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible(); await expect(page.locator('#profile-storage')).toHaveText('이 PC에 자동 저장');
    await expect(page.locator('#profile-points')).toHaveText('600');
    await page.getByRole('button', { name: '캐릭터 외형 상점', exact: true }).click(); await page.getByRole('button', { name: '보이드 러너 외형 미리보기', exact: true }).click();
    await page.getByRole('button', { name: '250 LP로 구매', exact: true }).click(); await page.getByRole('button', { name: '구매 후 장착', exact: true }).click(); await expect(page.locator('#purchase-dialog')).toBeHidden(); await expect(page.locator('#shop-points')).toHaveText('350');
    await page.getByRole('button', { name: '여성 오퍼레이터 선택', exact: true }).click(); await expect(page.locator('#character-status')).toContainText('다음 출격부터 적용');
    await page.getByRole('button', { name: '외형 상점 닫기', exact: true }).click();
    await page.evaluate(() => localStorage.clear()); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
    await expect(page.locator('#profile-points')).toHaveText('350');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).id)).toBe(initial.id);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).equippedOutfitId)).toBe('runner');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1')).characterId)).toBe('female');
    const saved = JSON.parse(await readFile(path.join(dataDir, 'profile.json'), 'utf8')); expect(saved.points).toBe(350); expect(saved.equippedOutfitId).toBe('runner');
    await page.evaluate(async () => {
      const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'round', roundId: 'native-browser-round-0001', kills: 30, weaponKills: { rifle: 30 }, completed: true }) });
      if (!response.ok) throw new Error('Native mastery write failed');
    });
    await page.reload(); await expect(page.locator('#profile-points')).toHaveText('1,000'); await page.getByRole('button', { name: '무기 및 스킨 선택', exact: true }).click();
    await expect(page.locator('#armory-mastery-count')).toHaveText('30 / 50 KILLS → Lv.1'); await page.locator('#weapon-choices [data-weapon=glock18c]').click(); await page.locator('#armory-unlock').click(); await page.getByRole('button', { name: '영구 해금', exact: true }).click();
    await expect(page.locator('#purchase-dialog')).toBeHidden(); await expect(page.locator('#profile-points')).toHaveText('200');
    await page.evaluate(() => localStorage.clear()); await page.reload(); await expect(page.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('linkshot-profile-v1'))); expect(restored.points).toBe(200); expect(restored.ownedWeapons).toContain('glock18c'); expect(restored.weaponKills.rifle).toBe(30); expect(restored.equippedOutfitId).toBe('runner');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill('SIGINT'); await stopped; }
  }
});
