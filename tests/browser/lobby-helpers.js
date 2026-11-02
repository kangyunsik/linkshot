import { expect } from '@playwright/test';

export async function setCallsign(page, name) {
  await page.locator('#profile-button').click(); await page.locator('.local-profile-details summary').click(); await page.getByLabel('플레이어 콜사인').fill(name); await page.getByLabel('플레이어 콜사인').blur(); await page.getByLabel('프로필 닫기').click(); await expect(page.locator('#profile-dialog')).toBeHidden();
}
export async function startCreatedRoom(page) {
  await page.locator('#room-create-confirm').click(); await expect(page.locator('#room-lobby-dialog')).toBeVisible(); await page.locator('#room-lobby-action').click(); await expect(page.locator('#pause-overlay')).toBeVisible();
}
export async function joinRunningRoom(page, code) {
  await page.locator('#room-browser-button').click(); await page.getByLabel('참가할 방 코드').fill(code); await page.getByRole('button', { name: '코드로 방 참가' }).click(); await expect(page.locator('#room-lobby-dialog')).toBeVisible(); await page.locator('#room-lobby-action').click(); await expect(page.locator('#pause-overlay')).toBeVisible();
}
