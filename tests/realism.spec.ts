import { test, expect, type Page } from '@playwright/test';

interface Snapshot {
  paused: boolean;
  quality: 'high' | 'balanced';
  state: { speed: number };
  audio: {
    context: string; enabled: boolean; paused: boolean;
    loadedCount: number; expectedCount: number; loading: boolean;
    failed: string[]; fallback: boolean; activeOneShots: number;
    masterGain: number; rpm: number;
  };
}
const snapshot = (page: Page) => page.evaluate(() =>
  (window as unknown as { __backbay: { snapshot(): Snapshot } }).__backbay.snapshot());

test('desktop: recorded driving sound, pause/mute/horn and both graphics modes', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|WebGL.*(?:error|invalid)/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 60000 });
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).audio.loadedCount, { timeout: 20000 }).toBe(16);
  const initial = await snapshot(page);
  expect(initial.audio.expectedCount).toBe(16);
  expect(initial.audio.loading).toBe(false);
  expect(initial.audio.failed).toEqual([]);
  expect(initial.audio.fallback).toBe(false);
  expect(initial.audio.context).toBe('running');
  expect(initial.quality).toBe('high');
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeGreaterThan(.1);

  // Exercise keyboard input and observe the actual game; no test hook changes
  // the vehicle or audio state. Acceleration should audibly lift engine RPM.
  const idleRpm = initial.audio.rpm;
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => (await snapshot(page)).state.speed).toBeGreaterThan(1);
    await expect.poll(async () => (await snapshot(page)).audio.rpm).toBeGreaterThan(idleRpm + 400);
  } finally { await page.keyboard.up('w'); }
  await page.keyboard.press('r');
  await page.keyboard.press('f');
  await expect.poll(async () => (await snapshot(page)).audio.activeOneShots, { intervals: [50, 100] }).toBe(1);
  await page.keyboard.press('m');
  await expect(page.locator('#map-modal')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).audio.paused).toBe(true);
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeLessThan(.001);
  expect((await snapshot(page)).audio.activeOneShots).toBe(0);
  await page.keyboard.press('m');
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeGreaterThan(.1);

  await page.keyboard.press('n');
  expect((await snapshot(page)).audio.enabled).toBe(false);
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeLessThan(.001);
  expect((await snapshot(page)).paused).toBe(false);
  await page.keyboard.press('n');
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeGreaterThan(.1);

  for (const [button, quality] of [['Balanced', 'balanced'], ['Detailed', 'high']] as const) {
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.getByRole('button', { name: button, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await snapshot(page)).quality).toBe(quality);
    await page.getByRole('button', { name: 'Keep driving', exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).paused).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`graphics-${quality}-desktop.png`) });
  }
  expect(errors).toEqual([]);
});
