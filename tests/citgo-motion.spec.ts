import { test, expect } from '@playwright/test';

test.use({ video: 'on' });

for (const mobile of [false, true]) test.describe(`CITGO vehicle motion (${mobile ? 'phone' : 'desktop'})`, () => {
  test.use({ viewport: mobile ? { width: 844, height: 390 } : { width: 1280, height: 800 }, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 1 });

  test('drive toward Kenmore in daylight and at night', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || /GL_INVALID|INVALID_(OPERATION|VALUE|ENUM)/.test(message.text())) errors.push(message.text()); });
    // Beacon Street's eastbound carriageway, about 500 m from the sign.
    const start = { x: -2205.07, z: 296.089, yaw: 1.937 };
    await page.addInitScript(start => localStorage.setItem('backbay-drive-v1', JSON.stringify(start)), start);
    await page.goto('/'); await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 90000 }); await page.getByTestId('start-drive').click();
    await page.keyboard.press('c'); await page.keyboard.press('h');
    for (const lighting of ['day', 'night']) {
      await page.evaluate(start => (window as any).__backbay.travelTo(start.x, start.z, start.yaw, '15627-0-0'), start);
      await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 });
      await page.keyboard.press('Escape'); await page.locator(`[data-light="${lighting}"]`).click(); await page.keyboard.press('Escape');
      await expect(page.locator('#toast')).not.toHaveClass(/visible/);
      const before = await page.evaluate(() => (window as any).__backbay.snapshot());
      expect(before.travelMode).toBe('drive'); expect(before.camera).toBe('hood'); expect(before.mobile).toBe(mobile);
      await page.keyboard.down('w');
      for (let frame = 0; frame < 4; frame++) {
        await page.waitForTimeout(600);
        await page.screenshot({ path: testInfo.outputPath(`citgo-${lighting}-moving-${frame}.png`) });
      }
      await page.keyboard.up('w');
      const after = await page.evaluate(() => (window as any).__backbay.snapshot());
      expect(Math.hypot(after.state.x - before.state.x, after.state.z - before.state.z)).toBeGreaterThan(8);
      expect(after.bridges.citgo.faces).toBe(2);
      expect(after.bridges.citgo.night).toBe(lighting === 'night');
    }
    // Screenshots and the retained video cover motion; the companion Node
    // regression raycasts every face region to reject overlapping surfaces.
    expect(errors).toEqual([]);
  });
});
