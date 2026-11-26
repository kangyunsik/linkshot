import { test, expect } from '@playwright/test';

const testUrl = process.env.BROWSER_LAN_TEST_URL || `http://127.0.0.1:${Number(process.env.PREVIEW_PORT) || 4173}/`;

test('static browser LAN joins with a link or pasted code, plays on the host worker, and ends when the host tab closes', async ({ browser }) => {
  test.setTimeout(100_000);
  const contexts = [], faults = [];
  async function participant(name) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    contexts.push(context);
    if (!process.env.BROWSER_LAN_TEST_URL) await context.route('**/runtime-config.js', route => route.fulfill({
      contentType: 'text/javascript', body: "export const APP_MODE = 'solo'; export const PROFILE_STORAGE = 'browser'; export const BROWSER_LAN_ENABLED = true;",
    }));
    await context.addInitScript(name => {
      if (!['http:', 'https:'].includes(location.protocol)) return;
      localStorage.setItem('sector07-name', name);
      localStorage.setItem('sector07-settings', JSON.stringify({ volume: 0, quality: 'low' }));
      const RTC = window.RTCPeerConnection;
      window.__lanPeers = [];
      window.RTCPeerConnection = class extends RTC {
        constructor(options) { super(options); window.__lanPeers.push(this); }
      };
    }, name);
    const page = await context.newPage();
    page.on('pageerror', error => faults.push(error.message));
    page.on('websocket', socket => faults.push(socket.url()));
    page.on('request', request => {
      if (request.url().startsWith('http') && (!request.url().startsWith(testUrl) || new URL(request.url()).pathname.includes('/api/'))) faults.push(request.url());
    });
    page.on('response', response => { if (response.status() >= 400) faults.push(`${response.status()} ${response.url()}`); });
    return page;
  }
  try {
    const host = await participant('LAN HOST'), guest = await participant('LAN GUEST');
    await host.goto(testUrl);
    await host.getByRole('tab', { name: 'LAN 대전', exact: true }).click();
    await expect(host.locator('#join-section')).toBeHidden();
    await host.locator('#create-button').click();
    await expect(host.locator('#room-password')).toBeHidden();
    await host.locator('#room-title').fill('BROWSER LAN TEST');
    await host.locator('#bots-minus').click(); await host.locator('#bots-minus').click();
    await host.locator('#room-create-confirm').click();
    await expect(host.locator('#room-lobby-roster')).toContainText('LAN HOST / 방장 / 나');
    await host.locator('#room-lobby-invite').click();
    await expect(host.locator('#peer-lan-link')).toHaveValue(/#lan=LSLAN1\./);
    const link = await host.locator('#peer-lan-link').inputValue();
    expect(link.startsWith(`${testUrl}#lan=`)).toBe(true);
    await guest.goto(link);
    await expect(guest.locator('#peer-lan-dialog')).toBeVisible();
    expect(new URL(guest.url()).hash).toBe('');
    await guest.locator('#peer-lan-make-answer').click();
    await expect(guest.locator('#peer-lan-response')).toHaveValue(/^LSLAN1\./);
    expect(await host.locator('[data-member]').count()).toBe(1);
    const answer = await guest.locator('#peer-lan-response').inputValue();
    const truncated = answer.slice(0, -20);
    await host.locator('#peer-lan-answer').fill(truncated);
    await host.locator('#peer-lan-connect').click();
    await expect(host.locator('#peer-lan-status')).toContainText('유효한');
    await host.locator('#peer-lan-answer').fill(answer);
    await host.locator('#peer-lan-connect').click();
    await expect(guest.locator('#room-lobby-title')).toHaveText('BROWSER LAN TEST', { timeout: 27_000 });
    await expect(guest.locator('#room-lobby-invite')).toBeHidden();
    await host.getByLabel('LAN 초대 닫기').click();
    await expect(host.locator('#room-lobby-roster')).toContainText('LAN GUEST');

    const second = await participant('LAN SECOND');
    await host.locator('#room-lobby-invite').click();
    await expect(host.locator('#peer-lan-link')).toHaveValue(/#lan=LSLAN1\./);
    const secondLink = new URL(await host.locator('#peer-lan-link').inputValue());
    expect(secondLink.href).not.toBe(link);
    await second.goto(testUrl);
    await second.getByRole('tab', { name: 'LAN 대전', exact: true }).click();
    await second.locator('#room-browser-button').click();
    await second.locator('#peer-lan-offer').fill(new URLSearchParams(secondLink.hash.slice(1)).get('lan'));
    await second.locator('#peer-lan-make-answer').click();
    await expect(second.locator('#peer-lan-response')).toHaveValue(/^LSLAN1\./);
    await host.locator('#peer-lan-answer').fill(await second.locator('#peer-lan-response').inputValue());
    await host.locator('#peer-lan-connect').click();
    await expect(second.locator('#room-lobby-roster')).toContainText('LAN SECOND / 나', { timeout: 27_000 });
    await host.getByLabel('LAN 초대 닫기').click();
    await expect(host.locator('#room-lobby-roster')).toContainText('LAN SECOND');
    await second.locator('#room-lobby-leave').click();
    await expect(host.locator('#room-lobby-roster')).not.toContainText('LAN SECOND');
    await expect(host.locator('#room-lobby-roster')).toContainText('LAN HOST / 방장 / 나');

    await expect(host.locator('#room-lobby-action')).toBeDisabled();
    await guest.locator('#room-lobby-action').click();
    await expect(host.locator('#room-lobby-action')).toBeEnabled();
    for (const page of [host, guest]) {
      expect(await page.evaluate(() => window.__lanPeers.filter(pc => pc.connectionState !== 'closed').map(pc => ({ state: pc.connectionState, servers: pc.getConfiguration().iceServers })))).toEqual([{ state: 'connected', servers: [] }]);
    }
    await host.locator('#room-lobby-action').click();
    for (const page of [host, guest]) {
      await expect(page.locator('#pause-overlay')).toBeVisible({ timeout: 25_000 });
      await expect(page.locator('#hud-connection-kind')).toHaveText('LAN · P2P');
    }
    await guest.locator('#resume-button').click();
    await expect.poll(() => guest.evaluate(() => document.pointerLockElement?.id)).toBe('game-canvas');
    await guest.mouse.down(); await expect(guest.locator('#hud-ammo')).not.toHaveText('30'); await guest.mouse.up();
    await host.close();
    await expect(guest.locator('#lobby')).toBeVisible({ timeout: 25_000 });
    await expect(guest.getByText(/방장이 나가 LAN 방이 종료/)).toBeVisible();
    await guest.getByRole('tab', { name: '혼자 연습', exact: true }).click();
    await expect(guest.getByText('SOLO READY · LOCAL SIMULATION')).toBeVisible();
    expect(faults).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});
