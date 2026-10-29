import { test, expect, type Page } from '@playwright/test';

type Snapshot = { paused: boolean; camera: string; lighting: string; state: { x: number; z: number; yaw: number; speed: number } };
const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { __backbay: { snapshot(): Snapshot } }).__backbay.snapshot());
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 60000 });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __backbay?: { ready: boolean } }).__backbay?.ready))).toBe(true);
}

test('desktop: start, map, destination, camera, lighting, pause and reset', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  expect((await snapshot(page)).paused).toBe(true);
  await expect(page.locator('.hud.brand')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('welcome-desktop.png') });
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('.hud.brand')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(false);
  await page.keyboard.press('c');
  await expect.poll(async () => (await snapshot(page)).camera).toBe('hood');
  await page.keyboard.press('m');
  await expect(page.getByRole('dialog', { name: 'Find your next turn.' })).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
  const before = (await snapshot(page)).state;
  await page.keyboard.down('w');
  await page.waitForTimeout(400);
  await page.keyboard.up('w');
  const after = (await snapshot(page)).state;
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(.01);
  await page.getByRole('button', { name: 'Zoom map in', exact: true }).click();
  await page.getByRole('button', { name: 'Center map on car' }).click();
  await page.screenshot({ path: testInfo.outputPath('map-desktop.png') });
  await page.locator('[data-destination]').first().click();
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Your afternoon.' })).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).lighting).toBe('night');
  await page.getByRole('button', { name: 'Muted', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Muted', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'About this city' }).click();
  await expect(page.getByRole('dialog', { name: 'A real place.' })).toBeVisible();
  await expect(page.locator('#source-list a').first()).toHaveAttribute('href', /^https:\/\//);
  await page.getByRole('button', { name: 'Back to settings' }).click();
  await page.getByRole('button', { name: 'Reset car', exact: true }).click();
  await expect(page.locator('#settings-modal')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(false);
  const reset = await snapshot(page);
  expect(Number.isFinite(reset.state.x)).toBe(true);
  expect(Math.abs(reset.state.speed)).toBeLessThan(.5);
  await page.screenshot({ path: testInfo.outputPath('night-drive-desktop.png') });
  expect(errors).toEqual([]);
});

test('desktop: keyboard accelerates, brakes, reverses, steers both ways and resets', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const spawn = await page.evaluate(() => (window as unknown as { __backbay: { city: { spawn: { x: number; z: number; yaw: number } } } }).__backbay.city.spawn);
  const angleDelta = (yaw: number) => Math.atan2(Math.sin(yaw - spawn.yaw), Math.cos(yaw - spawn.yaw));
  const polling = { timeout: 20000, intervals: [100, 200, 300] };
  async function resetToSpawn() {
    await page.keyboard.press('r');
    await expect.poll(async () => {
      const state = (await snapshot(page)).state;
      return Math.hypot(state.x - spawn.x, state.z - spawn.z);
    }, polling).toBeLessThan(.25);
    await expect.poll(async () => Math.abs((await snapshot(page)).state.speed), polling).toBeLessThan(.25);
    expect(Math.abs(angleDelta((await snapshot(page)).state.yaw))).toBeLessThan(.02);
  }

  // These are real browser key events. Diagnostics only read the resulting
  // Rapier motion; no test hook teleports, forces, or advances the simulation.
  await resetToSpawn();
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => (await snapshot(page)).state.speed, polling).toBeGreaterThan(3);
    await expect.poll(async () => {
      const state = (await snapshot(page)).state;
      return (state.x - spawn.x) * Math.sin(spawn.yaw) + (state.z - spawn.z) * Math.cos(spawn.yaw);
    }, polling).toBeGreaterThan(2);
  } finally { await page.keyboard.up('w'); }
  await page.screenshot({ path: testInfo.outputPath('keyboard-drive-desktop.png') });
  const forward = (await snapshot(page)).state;
  await page.keyboard.down('s');
  try {
    await expect.poll(async () => (await snapshot(page)).state.speed, polling).toBeLessThan(.5);
    await expect.poll(async () => (await snapshot(page)).state.speed, polling).toBeLessThan(-1);
    await expect.poll(async () => {
      const state = (await snapshot(page)).state;
      return (state.x - forward.x) * Math.sin(spawn.yaw) + (state.z - forward.z) * Math.cos(spawn.yaw);
    }, polling).toBeLessThan(-.5);
  } finally { await page.keyboard.up('s'); }

  const turns: number[] = [];
  for (const key of ['a', 'd']) {
    await resetToSpawn();
    await page.keyboard.down('w');
    try {
      await expect.poll(async () => (await snapshot(page)).state.speed, polling).toBeGreaterThan(2);
      await page.keyboard.down(key);
      await expect.poll(async () => Math.abs(angleDelta((await snapshot(page)).state.yaw)), polling).toBeGreaterThan(.06);
      turns.push(angleDelta((await snapshot(page)).state.yaw));
    } finally {
      await page.keyboard.up(key);
      await page.keyboard.up('w');
    }
  }
  expect(turns[0] * turns[1]).toBeLessThan(0);
  await resetToSpawn();
  expect(errors).toEqual([]);
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  test('touch controls and map fit a 375px viewport', async ({ page }, testInfo) => {
    await ready(page);
    const title = await page.locator('.welcome h1').boundingBox();
    expect(title).not.toBeNull();
    expect(title!.x).toBeGreaterThanOrEqual(0);
    expect(title!.x + title!.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath('welcome-mobile.png') });
    await page.getByTestId('start-drive').click();
    await expect(page.locator('#welcome')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Accelerate', exact: true })).toBeVisible();
    const accelerator = await page.getByRole('button', { name: 'Accelerate', exact: true }).boundingBox();
    expect(accelerator!.width).toBeGreaterThanOrEqual(44);
    expect(accelerator!.x + accelerator!.width).toBeLessThanOrEqual(375);
    await expect(page.locator('#minimap-button')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('drive-mobile.png') });
    await page.getByRole('button', { name: 'Open map', exact: true }).click();
    await expect(page.locator('#map-modal')).toBeVisible();
    const close = await page.locator('#close-map').boundingBox();
    expect(close!.x).toBeGreaterThan(0);
    expect(close!.x + close!.width).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(overflow.width).toBeLessThanOrEqual(overflow.viewport);
    await page.screenshot({ path: testInfo.outputPath('map-mobile.png') });
    await page.getByRole('button', { name: 'Back to driving' }).click();
    await expect(page.locator('#map-modal')).toBeHidden();
    await page.getByRole('button', { name: 'Pause and open settings' }).click();
    await page.getByRole('button', { name: 'Daylight', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).lighting).toBe('day');
    await page.getByRole('button', { name: 'Keep driving' }).click();
    expect((await snapshot(page)).paused).toBe(false);
    await page.setViewportSize({width:812,height:375});
    await expect(page.locator('#minimap-button')).toBeVisible();
    const mini=(await page.locator('#minimap-button').boundingBox())!;
    expect(mini.width).toBeGreaterThanOrEqual(96);
    expect(mini.x).toBeLessThan(100);
    expect(mini.y).toBeLessThan(100);
    await expect(page.locator('#minimap')).toHaveAttribute('aria-label',/Your position in Boston/);
    await page.screenshot({path:testInfo.outputPath('drive-mobile-landscape.png')});
  });
});
