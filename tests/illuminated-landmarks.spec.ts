import { test, expect } from '@playwright/test';

test('Schrafft and CITGO retain their skyline details through day, night and travel', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || /GL_INVALID|INVALID_(OPERATION|VALUE|ENUM)/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('backbay-drive-v1', JSON.stringify({ x: 117, z: -3780, yaw: 1.65 })));
  await page.goto('/'); await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 90000 }); await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const snapshot = () => page.evaluate(() => (window as any).__backbay.snapshot());
  await expect.poll(async () => (await snapshot()).bridges.schrafft?.clocks).toBe(4);
  expect((await snapshot()).bridges.citgo.faces).toBe(2);
  await page.keyboard.press('3'); await page.keyboard.press('h');
  const fly = async (x: number, y: number, z: number, tx: number, tz: number) => {
    await page.evaluate(([x, y, z, yaw]) => (window as any).__backbay.flyTo(x, y, z, yaw), [x, y, z, Math.atan2(tx - x, tz - z)]);
    await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 }); await page.waitForTimeout(1300);
  };
  const lighting = async (mode: string) => {
    await page.keyboard.press('Escape'); await page.locator(`[data-light="${mode.toLowerCase()}"]`).click({ timeout: 15000 }); await page.keyboard.press('Escape');
    await expect.poll(async () => (await snapshot()).lighting).toBe(mode.toLowerCase()); await page.waitForTimeout(800);
  };
  await fly(66, 38, -3708, 206, -3796);
  await lighting('Day'); await page.screenshot({ path: testInfo.outputPath('schrafft-day.png') });
  await lighting('Night'); expect((await snapshot()).bridges.schrafft.night).toBe(true); await page.screenshot({ path: testInfo.outputPath('schrafft-night.png') });
  await fly(-1901, 27, 185, -1730, 102);
  expect((await snapshot()).bridges.citgo.night).toBe(true); await page.screenshot({ path: testInfo.outputPath('citgo-night.png') });
  await lighting('Day'); await page.screenshot({ path: testInfo.outputPath('citgo-day.png') });
  await fly(-1580, 43, 40, -1730, 102); await page.screenshot({ path: testInfo.outputPath('citgo-reverse.png') });
  // Reproduce the floating-support report close to the stepped host roof.
  await page.keyboard.press('c'); expect((await snapshot()).camera).toBe('hood');
  await page.evaluate(() => (window as any).__backbay.flyTo(-1750.79, 31.79, 139.23, 2.7966));
  await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 }); await page.waitForTimeout(1300);
  await page.screenshot({ path: testInfo.outputPath('citgo-roof-supports.png') });
  await fly(-1706, 37, 113, -1730, 101); await page.screenshot({ path: testInfo.outputPath('citgo-roof-supports-east.png') });
  await lighting('Night'); await page.screenshot({ path: testInfo.outputPath('citgo-roof-supports-night.png') });
  await page.keyboard.press('c'); await page.keyboard.press('c');
  await fly(-80, 37, -3920, 184, -3812); await lighting('Night'); await page.screenshot({ path: testInfo.outputPath('schrafft-i93-night.png') });
  expect((await snapshot()).bridges.schrafft.night).toBe(true);
  await page.keyboard.press('1');
  await page.evaluate(() => (window as any).__backbay.travelTo(230, -3672, -2.87));
  await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 });
  await page.keyboard.down('w'); await page.waitForTimeout(700); await page.keyboard.up('w');
  await page.screenshot({ path: testInfo.outputPath('schrafft-main-street-drive.png') });
  expect((await snapshot()).travelMode).toBe('drive');
  expect(errors).toEqual([]);
});

test.describe('phone landmark lighting', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  test('CITGO remains luminous without desktop bloom', async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('backbay-drive-v1', JSON.stringify({ x: -1943, z: 187, yaw: 1.94 })));
    await page.goto('/'); await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 90000 }); await page.getByTestId('start-drive').tap();
    await page.keyboard.press('Escape'); await page.locator('[data-light="night"]').tap(); await page.keyboard.press('Escape');
    const state = await page.evaluate(() => (window as any).__backbay.snapshot());
    expect(state.mobile).toBe(true); expect(state.rendering.postprocessing).toBe(false); expect(state.bridges.citgo.night).toBe(true);
    await page.keyboard.press('h'); await expect(page.locator('#interface')).toHaveClass(/hud-off/);
    await expect(page.locator('#toast')).not.toHaveClass(/visible/);
    await page.waitForTimeout(800); await page.screenshot({ path: testInfo.outputPath('citgo-phone-night.png') });
    expect(errors).toEqual([]);
  });
});
