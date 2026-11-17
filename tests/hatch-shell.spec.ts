import { test, expect } from '@playwright/test';
import { hatchShellWorld, HATCH_SHELL_ID } from '../src/render/hatch-shell.ts';

test('Hatch Shell has an open wood-lined stage and persists across tile reloads', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || /GL_INVALID|INVALID_(OPERATION|VALUE|ENUM)/.test(message.text())) errors.push(message.text()); });
  const front = hatchShellWorld(0, 48);
  await page.addInitScript(([x, z]) => localStorage.setItem('backbay-drive-v1', JSON.stringify({ x, z, yaw: 0 })), front);
  await page.goto('/'); await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 90000 });
  await page.getByTestId('start-drive').click();
  await page.keyboard.press('4'); await page.keyboard.press('c'); await page.keyboard.press('h');
  await page.keyboard.press('Escape'); await page.locator('[data-light="day"]').click(); await page.keyboard.press('Escape');
  const view = async (u: number, v: number, targetU = 0, targetV = -6, height?: number) => {
    const [x, z] = hatchShellWorld(u, v), [tx, tz] = hatchShellWorld(targetU, targetV);
    await page.evaluate(([x, z, yaw, height]) => (window as any).__backbay.walkTo(x, z, yaw, height), [x, z, Math.atan2(tx - x, tz - z), height]);
    await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 }); await page.waitForTimeout(600);
  };
  const inspect = () => page.evaluate(id => {
    const scene = (window as any).__backbay.scene, found: any[] = [];
    scene.traverse((o: any) => {
      if (o.isGroup && o.userData.buildingId === id) found.push(o);
    });
    return { count: found.length, uuid: found[0]?.uuid, open: found[0]?.userData.openStage,
      materials: found[0]?.children.map((m: any) => m.material.name), textures: found[0]?.children.filter((m: any) => m.material.map).length };
  }, HATCH_SHELL_ID);
  await view(0, 48);
  const initial = await inspect();
  expect(initial.count).toBe(1); expect(initial.open).toBe(true);
  expect(initial.materials).toContain('Hatch Shell herringbone wood'); expect(initial.textures).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: testInfo.outputPath('hatch-shell-lawn.png') });
  await page.keyboard.press('Escape'); await page.locator('[data-light="golden"]').click(); await page.keyboard.press('Escape');
  await page.waitForTimeout(500); await page.screenshot({ path: testInfo.outputPath('hatch-shell-golden.png') });
  await view(-28, 25); await page.screenshot({ path: testInfo.outputPath('hatch-shell-oblique.png') });
  await view(0, 1.5, 0, -12, 1.03);
  await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w');
  const walker = await page.evaluate(() => (window as any).__backbay.snapshot().walker);
  expect(walker.y).toBeGreaterThan(.9); expect(walker.y).toBeLessThan(1.3);
  expect(Math.hypot(walker.x - hatchShellWorld(0, 1.5)[0], walker.z - hatchShellWorld(0, 1.5)[1])).toBeGreaterThan(1.2);
  await page.screenshot({ path: testInfo.outputPath('hatch-shell-stage.png') });
  await view(0, -40, 0, 0); await page.screenshot({ path: testInfo.outputPath('hatch-shell-rear.png') });
  await page.evaluate(() => (window as any).__backbay.travelTo(-1900, 500, 0));
  await view(0, 48);
  expect((await inspect()).uuid).toBe(initial.uuid);
  await page.keyboard.press('Escape'); await page.locator('[data-quality="balanced"]').click(); await page.keyboard.press('Escape');
  await page.screenshot({ path: testInfo.outputPath('hatch-shell-balanced.png') });
  await page.keyboard.press('Escape'); await page.locator('[data-light="night"]').click(); await page.keyboard.press('Escape');
  await page.waitForTimeout(500); await page.screenshot({ path: testInfo.outputPath('hatch-shell-night.png') });
  expect(errors).toEqual([]);
});

test('Hatch Shell retains the concert opening on a phone', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const [x, z] = hatchShellWorld(0, 48), [tx, tz] = hatchShellWorld(0, 0), yaw = Math.atan2(tx - x, tz - z);
  await page.addInitScript(([x, z, yaw]) => localStorage.setItem('backbay-drive-v1', JSON.stringify({ x, z, yaw })), [x, z, yaw]);
  await page.goto('/'); await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 90000 }); await page.getByTestId('start-drive').tap();
  await page.keyboard.press('4'); await page.keyboard.press('c'); await page.keyboard.press('h');
  await page.evaluate(([x, z, yaw]) => (window as any).__backbay.walkTo(x, z, yaw), [x, z, yaw]);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 }); await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__backbay.snapshot().mobile)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('hatch-shell-phone.png') });
  expect(errors).toEqual([]); await context.close();
});
