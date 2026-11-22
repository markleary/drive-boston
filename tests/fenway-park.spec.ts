import { test, expect } from '@playwright/test';
import type { Scene } from 'three';

test('Fenway mounts its scoreboard and street signs with the stadium tile', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|Shader Error/.test(message.text())) errors.push(message.text());
  });
  await page.goto('/');
  await page.getByTestId('start-drive').click({ timeout: 90000 });
  await page.keyboard.press('3');
  await page.keyboard.press('c');
  await page.keyboard.press('h');
  const flyTo = (x: number, y: number, z: number, yaw: number) => page.evaluate(
    ([x, y, z, yaw]) => (window as any).__backbay.flyTo(x, y, z, yaw), [x, y, z, yaw]);
  const reportedView = () => flyTo(-1792.62, 38.33, 384.45, 2.557);
  const details = () => page.evaluate(() => {
    const scene: Scene = (window as any).__backbay.scene;
    const tile = scene.getObjectByName('Tile -2_0');
    const park = tile?.getObjectByName('Fenway Park field and grandstands');
    const board = park?.getObjectByName('Fenway center-field scoreboard face');
    if (!park || !board) return null;
    return {
      uuid: park.uuid, gateBays: park.userData.gateBays,
      streetSigns: park.children.filter(child => child.name.startsWith('Fenway street plaque')).map(child => child.name).sort()
    };
  });
  const capture = async (name: string) => {
    await expect(page.locator('#toast')).toHaveCSS('opacity', '0');
    await page.screenshot({ path: testInfo.outputPath(name) });
  };

  await reportedView();
  const park = await details();
  expect(park?.gateBays).toBeGreaterThan(0);
  expect(park?.streetSigns).toEqual([
    'Fenway street plaque: FENWAY PARK (Jersey Street)',
    'Fenway street plaque: FENWAY PARK (Van Ness Street)',
    'Fenway street plaque: GATE A   •   JERSEY STREET (Jersey Street)'
  ]);
  await capture('fenway-lansdowne.jpg');
  await flyTo(-1946, 92, 514, 2.45);
  await page.mouse.move(600, 300); await page.mouse.down(); await page.mouse.move(600, 415, { steps: 8 }); await page.mouse.up();
  await capture('fenway-bowl.jpg');

  await page.keyboard.press('4');
  await page.keyboard.press('c');
  await page.evaluate(() => (window as any).__backbay.walkTo(-1850, 390, 2.0));
  await capture('fenway-on-field.jpg');
  const feet = await page.evaluate(() => (window as any).__backbay.snapshot().walker.y);
  expect(feet).toBeCloseTo(3.16, 1);

  // From the street, both the gate plaque and the park name should sit on the brick above the same entrance.
  await page.evaluate(() => (window as any).__backbay.walkTo(-1968, 433, 1.75));
  await page.mouse.move(500, 380); await page.mouse.down(); await page.mouse.move(500, 325, { steps: 8 }); await page.mouse.up();
  if (!(await page.locator('#interface').getAttribute('class'))?.includes('hud-off')) await page.keyboard.press('h');
  await capture('fenway-jersey-street.jpg');

  await page.keyboard.press('3');
  await flyTo(1550, 120, -350, 0);
  await expect.poll(details).toBeNull();
  await reportedView();
  const rebuilt = await details();
  expect(rebuilt).toMatchObject({ gateBays: park!.gateBays, streetSigns: park!.streetSigns });
  expect(rebuilt!.uuid).not.toBe(park!.uuid);
  expect(errors).toEqual([]);
});
