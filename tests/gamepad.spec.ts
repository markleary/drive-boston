import { test, expect, type Page } from '@playwright/test';

type Snapshot = { paused: boolean; camera: string; travelMode: string; state: { x: number; z: number; yaw: number; speed: number; steering: number }; flight: { y: number } };
type FakePad = { connected: boolean; pad: { axes: number[]; buttons: { pressed: boolean; value: number }[] } };
const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9, LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15 } as const;
type Button = keyof typeof BUTTON;
const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { __backbay: { snapshot(): Snapshot } }).__backbay.snapshot());
const setButton = (page: Page, name: Button, value: number) => page.evaluate(([index, v]) => { const button = (window as unknown as { __pad: FakePad }).__pad.pad.buttons[index]; button.pressed = v > .1; button.value = v; }, [BUTTON[name], value] as const);
const setAxes = (page: Page, axes: number[]) => page.evaluate(a => { (window as unknown as { __pad: FakePad }).__pad.pad.axes = a; }, axes);
const plug = (page: Page, connected: boolean) => page.evaluate(c => { (window as unknown as { __pad: FakePad }).__pad.connected = c; }, connected);
/** Hold long enough for several render-loop polls, then release. */
async function press(page: Page, name: Button) { await setButton(page, name, 1); await page.waitForTimeout(120); await setButton(page, name, 0); await page.waitForTimeout(120); }

// A standard-mapping Xbox controller read through navigator.getGamepads(), as Chrome reports one.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { index: 0, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons };
    const state = { connected: false, pad };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [state.connected ? pad : null, null, null, null] });
    Object.assign(window, { __pad: state });
  });
});

test('gamepad: start, drive, menus, vehicles and controller tips', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 60000 });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __backbay?: { ready: boolean } }).__backbay?.ready))).toBe(true);
  const polling = { timeout: 20000, intervals: [100, 200, 300] };
  const ui = page.locator('#interface'), hint = page.locator('#drive-hint');

  // The title screen notices the controller and starts from A alone.
  await expect(ui).not.toHaveClass(/\bgamepad\b/);
  await plug(page, true);
  await expect(ui).toHaveClass(/\bgamepad\b/);
  await expect(page.locator('#welcome-foot')).toHaveText('Single player / Controller connected');
  await expect(page.getByTestId('start-drive').locator('.pad-glyph')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('gamepad-welcome.png') });
  await press(page, 'A');
  await expect(page.locator('#welcome')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(false);

  // Controller tips replace the keyboard ones in the HUD and the map caption.
  await expect(hint).toContainText('Accelerate');
  await expect(hint).toContainText('Handbrake');
  await expect(hint.locator('kbd')).toHaveCount(0);
  await expect(hint.locator('.pad-glyph')).toHaveCount(5);
  await expect(page.locator('.map-caption kbd')).toBeHidden();
  await expect(page.locator('.map-caption .pad-glyph')).toBeVisible();

  // D-pad down resets to the start; RT accelerates and the left stick steers left (positive steer).
  await press(page, 'Down');
  await expect.poll(async () => Math.abs((await snapshot(page)).state.speed), polling).toBeLessThan(.25);
  await setButton(page, 'RT', 1);
  try {
    await expect.poll(async () => (await snapshot(page)).state.speed, polling).toBeGreaterThan(3);
    await setAxes(page, [-1, 0, 0, 0]);
    await expect.poll(async () => (await snapshot(page)).state.steering, polling).toBeGreaterThan(.05);
    await page.screenshot({ path: testInfo.outputPath('gamepad-driving.png') });
  } finally { await setAxes(page, [0, 0, 0, 0]); await setButton(page, 'RT', 0); }
  await expect.poll(async () => Math.abs((await snapshot(page)).state.steering), polling).toBeLessThan(.05);
  // LT brakes to a stop, then reverses.
  await setButton(page, 'LT', 1);
  try { await expect.poll(async () => (await snapshot(page)).state.speed, polling).toBeLessThan(-1); }
  finally { await setButton(page, 'LT', 0); }

  // Y cycles the camera.
  await press(page, 'Y');
  await expect.poll(async () => (await snapshot(page)).camera).toBe('hood');
  await press(page, 'Y');
  await press(page, 'Y');
  await expect.poll(async () => (await snapshot(page)).camera).toBe('chase');

  // Menu pauses with the controller reference; the D-pad moves focus and B resumes.
  await press(page, 'Menu');
  await expect(page.getByRole('dialog', { name: 'Your afternoon.' })).toBeVisible();
  expect((await snapshot(page)).paused).toBe(true);
  const help = page.locator('#controls-help');
  await expect(help).toContainText('Handbrake');
  await expect(help).toContainText('Change camera');
  await expect(help.locator('kbd')).toHaveCount(0);
  await expect(page.locator('#resume-drive')).toBeFocused();
  await press(page, 'Up');
  await expect(page.locator('#resume-drive')).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.closest('#settings-modal') !== null)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('gamepad-settings.png') });
  await press(page, 'B');
  await expect(page.locator('#settings-modal')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(false);

  // View opens the map; A on a focused place travels there and closes it.
  await press(page, 'View');
  await expect(page.getByRole('dialog', { name: 'Find your next turn.' })).toBeVisible();
  await expect(page.locator('#close-map .pad-glyph')).toBeVisible();
  await expect(page.locator('.map-note')).toHaveText(/Left stick to pan/);
  await page.locator('[data-destination]').first().focus();
  await press(page, 'Down');
  const destination = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.destination);
  expect(destination).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('gamepad-map.png') });
  await press(page, 'A');
  await expect(page.locator('#map-modal')).toBeHidden();
  await press(page, 'View');
  await expect(page.locator('#map-modal')).toBeVisible();
  await press(page, 'B');
  await expect(page.locator('#map-modal')).toBeHidden();

  // D-pad right steps through the bike to the helicopter, each with its own tips.
  await press(page, 'Right');
  await expect(page.getByTestId('mode-bike')).toHaveAttribute('aria-pressed', 'true');
  await expect(hint).toContainText('Wheelie');
  await press(page, 'Right');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed', 'true');
  await expect(hint).toContainText('Move');
  await expect(hint).toContainText('Turn');
  const ground = (await snapshot(page)).flight.y;
  await setButton(page, 'RT', 1);
  try { await expect.poll(async () => (await snapshot(page)).flight.y, polling).toBeGreaterThan(ground + 3); }
  finally { await setButton(page, 'RT', 0); }
  await page.screenshot({ path: testInfo.outputPath('gamepad-flight.png') });

  // A key press brings the keyboard tips back; touching the controller swaps them again.
  await page.keyboard.press('q');
  await expect(ui).not.toHaveClass(/\bgamepad\b/);
  await expect(hint).toContainText('Forward / back');
  await press(page, 'LB');
  await expect(ui).toHaveClass(/\bgamepad\b/);
  await expect(hint).not.toContainText('Forward / back');

  // Unplugging mid-flight pauses and restores the keyboard tips.
  await plug(page, false);
  await expect(ui).not.toHaveClass(/\bgamepad\b/);
  await expect(page.getByRole('dialog', { name: 'Your afternoon.' })).toBeVisible();
  await expect(page.locator('#toast')).toHaveText('Controller disconnected');
  expect(errors).toEqual([]);
});
