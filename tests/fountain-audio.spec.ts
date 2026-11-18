import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`Fellsmere fountain volume follows the walker and rider (${mobile ? 'phone' : 'desktop'})`, async ({ browser }) => {
    test.setTimeout(150000);
    const page = await browser.newPage({
      isMobile: mobile, hasTouch: mobile,
      viewport: mobile ? { width: 844, height: 390 } : { width: 1280, height: 800 },
    });
    try {
      // Start on Fellsway East, with the parked car well away from either shoreline listening point.
      await page.addInitScript(() => localStorage.setItem('backbay-drive-v1', JSON.stringify({ x: -848.35, z: -8626.19, yaw: 2.48 })));
      let downloads = 0;
      page.on('response', response => { if (response.url().endsWith('/audio/pond-fountain.mp3') && response.ok()) downloads++; });
      await page.goto('/');
      await page.getByTestId('start-drive').click({ timeout: 90000 });
      const gain = () => page.evaluate(() => (window as any).__backbay.snapshot().audio.fountainGain);
      const master = () => page.evaluate(() => (window as any).__backbay.snapshot().audio.masterGain);
      const move = (mode: 'walk' | 'bike', x: number, z: number) => page.evaluate(([mode, x, z]) => {
        const game = (window as any).__backbay;
        return mode === 'walk' ? game.walkTo(x,z) : game.travelTo(x,z);
      }, [mode,x,z] as const);

      expect(downloads).toBe(0);
      for (const mode of ['walk', 'bike'] as const) {
        await page.keyboard.press(mode === 'walk' ? '4' : '2');
        await move(mode, -923, -8655); // West promontory, between the two jets.
        await expect.poll(gain).toBeGreaterThan(.005);
        await expect.poll(gain).toBeLessThan(.12);
        await move(mode, -857, -8758); // North terrace.
        await expect.poll(gain).toBeGreaterThan(.4);
        await move(mode, -993, -8491); // South bank.
        await expect.poll(gain).toBeLessThan(.39);
        await expect.poll(gain).toBeGreaterThan(.25);
      }
      expect(downloads).toBe(1);
      await page.keyboard.press('n');
      await expect.poll(master).toBeLessThan(.001);
      await page.keyboard.press('n');
      await expect.poll(master).toBeGreaterThan(.5);
      await page.keyboard.press('1');
      await expect.poll(gain).toBe(0);
    } finally {
      await page.close();
    }
  });
}
