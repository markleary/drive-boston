import { test, expect, type Page } from '@playwright/test';

interface Position { x: number; y: number; z: number; yaw: number; speed: number; }
interface FlightSnapshot {
  travelMode: 'drive' | 'helicopter'; paused: boolean; camera: string;
  state: Position; flight: Position & { verticalSpeed: number };
  audio: { mode: string; loadedCount: number; failed: string[]; fallback: boolean; enabled: boolean; rotorGain: number; engineGain: number; masterGain: number };
}
const snapshot = (page: Page) => page.evaluate(() =>
  (window as unknown as { __backbay: { snapshot(): FlightSnapshot } }).__backbay.snapshot());
const moved = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('helicopter: lift, fly, turn, descend, inspect, pause and return to the car', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|WebGL.*(?:error|invalid)/i.test(message.text())) errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 60000 });
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const hint=page.locator('#drive-hint');
  await expect(hint).toContainText('Handbrake');
  // Exercise the former 18-second fade deadline with real browser timers.
  await page.waitForTimeout(19000);
  await expect(hint).toBeVisible();
  await expect(hint).toHaveCSS('opacity','1');
  await page.screenshot({path:testInfo.outputPath('persistent-car-hints.png')});
  const parkedCar = (await snapshot(page)).state;
  await page.getByRole('button', { name: 'Helicopter mode', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).travelMode).toBe('helicopter');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#altitude-readout')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).audio.loadedCount, { timeout: 20000 }).toBe(7);
  await expect.poll(async () => (await snapshot(page)).audio.engineGain).toBeLessThan(.001);
  await expect.poll(async () => (await snapshot(page)).audio.rotorGain).toBeGreaterThan(.1);
  expect((await snapshot(page)).audio.failed).toEqual([]);
  expect((await snapshot(page)).audio.fallback).toBe(false);
  const launch = (await snapshot(page)).flight;

  // All movement comes from player input. Diagnostics only observe the flight.
  await page.keyboard.down('Space');
  try {
    await expect.poll(async () => (await snapshot(page)).flight.y).toBeGreaterThan(launch.y + 8);
  } finally { await page.keyboard.up('Space'); }
  const raised = (await snapshot(page)).flight;
  expect(Number(await page.locator('#altitude-value').textContent())).toBeGreaterThan(Math.round(launch.y * 3.28084));
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => {
      const state = (await snapshot(page)).flight;
      return Math.hypot(state.x - raised.x, state.z - raised.z);
    }).toBeGreaterThan(5);
  } finally { await page.keyboard.up('w'); }
  const forward = (await snapshot(page)).flight;
  await page.keyboard.down('d');
  try {
    await expect.poll(async () => {
      const state = (await snapshot(page)).flight;
      return Math.abs((state.x - forward.x) * Math.cos(forward.yaw) - (state.z - forward.z) * Math.sin(forward.yaw));
    }).toBeGreaterThan(2);
  } finally { await page.keyboard.up('d'); }
  const beforeTurn = (await snapshot(page)).flight;
  await page.keyboard.down('e');
  try {
    await expect.poll(async () => {
      const yaw = (await snapshot(page)).flight.yaw - beforeTurn.yaw;
      return Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw)));
    }).toBeGreaterThan(.12);
  } finally { await page.keyboard.up('e'); }
  const beforeDescent = (await snapshot(page)).flight;
  await page.keyboard.down('Shift');
  try {
    await expect.poll(async () => (await snapshot(page)).flight.y).toBeLessThan(beforeDescent.y - 2);
  } finally { await page.keyboard.up('Shift'); }
  await page.waitForTimeout(19000);
  await expect(hint).toContainText('Forward / back');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveCSS('opacity','1');
  await page.screenshot({ path: testInfo.outputPath('helicopter-chase.png') });
  await page.setViewportSize({width:900,height:700});
  await expect(hint).toBeVisible();
  const hintBox=await hint.boundingBox(),modeBox=await page.locator('.travel-switch').boundingBox();
  expect(hintBox!.y).toBeGreaterThan(modeBox!.y+modeBox!.height);
  expect(hintBox!.x).toBeGreaterThanOrEqual(0);
  expect(hintBox!.x+hintBox!.width).toBeLessThanOrEqual(900);
  await page.screenshot({path:testInfo.outputPath('persistent-flight-hints-narrow.png')});
  await page.setViewportSize({width:1280,height:800});
  await page.keyboard.press('c');
  await expect.poll(async () => (await snapshot(page)).camera).toBe('hood');
  await expect(page.locator('#camera-label')).toHaveText('Cockpit camera');
  await page.screenshot({ path: testInfo.outputPath('helicopter-cockpit.png') });

  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Back to flying' })).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeLessThan(.001);
  const paused = (await snapshot(page)).flight;
  await page.keyboard.down('Space'); await page.keyboard.down('w');
  await page.waitForTimeout(250);
  await page.keyboard.up('Space'); await page.keyboard.up('w');
  expect(moved((await snapshot(page)).flight, paused)).toBeLessThan(.01);
  await page.locator('[data-destination]').first().click();
  await expect(page.locator('#map-modal')).toBeHidden();
  expect((await snapshot(page)).travelMode).toBe('helicopter');
  expect((await snapshot(page)).flight.y).toBeGreaterThanOrEqual(44);

  await page.keyboard.press('n');
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeLessThan(.001);
  expect((await snapshot(page)).audio.enabled).toBe(false);
  expect((await snapshot(page)).paused).toBe(false);
  await page.keyboard.press('n');
  await expect.poll(async () => (await snapshot(page)).audio.masterGain).toBeGreaterThan(.1);
  await page.keyboard.press('r');
  await expect.poll(async () => Math.abs((await snapshot(page)).flight.speed)).toBeLessThan(.25);
  expect(Number.isFinite((await snapshot(page)).flight.y)).toBe(true);
  await page.getByRole('button', { name: 'Drive mode', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).travelMode).toBe('drive');
  await expect(page.locator('#altitude-readout')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).audio.rotorGain).toBeLessThan(.001);
  await expect.poll(async () => (await snapshot(page)).audio.engineGain).toBeGreaterThan(.1);
  const returned = (await snapshot(page)).state;
  expect(Math.hypot(returned.x - parkedCar.x, returned.z - parkedCar.z)).toBeLessThan(1);
  await page.keyboard.press('2');
  await expect.poll(async () => (await snapshot(page)).travelMode).toBe('helicopter');
  await page.keyboard.press('1');
  await expect.poll(async () => (await snapshot(page)).travelMode).toBe('drive');
  expect(errors).toEqual([]);
});

test.describe('phone flight controls', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  test('touch lift controls remain clear of the instruments', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByTestId('start-drive')).toBeEnabled({ timeout: 60000 });
    await page.getByTestId('start-drive').click();
    await expect(page.locator('#welcome')).toBeHidden();
    await page.getByTestId('mode-helicopter').click();
    await expect.poll(async () => (await snapshot(page)).travelMode).toBe('helicopter');
    const ascend = page.getByRole('button', { name: 'Ascend', exact: true });
    await expect(ascend).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fly forward', exact: true })).toBeVisible();
    const hint=page.locator('#drive-hint');
    await expect(hint).toBeVisible();
    const hintBox=await hint.boundingBox(),modeBox=await page.locator('.travel-switch').boundingBox();
    expect(hintBox!.y).toBeGreaterThan(modeBox!.y+modeBox!.height);
    expect(hintBox!.x).toBeGreaterThanOrEqual(0);
    expect(hintBox!.x+hintBox!.width).toBeLessThanOrEqual(375);
    const instruments = await page.locator('.speed-cluster').boundingBox();
    const lift = await ascend.boundingBox();
    expect(lift!.width).toBeGreaterThanOrEqual(44);
    expect(lift!.y).toBeGreaterThan(instruments!.y + instruments!.height);
    const initial = (await snapshot(page)).flight.y;
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lift!.x + lift!.width / 2, y: lift!.y + lift!.height / 2 }] });
    try { await expect.poll(async () => (await snapshot(page)).flight.y).toBeGreaterThan(initial + 2); }
    finally { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath('helicopter-mobile.png') });
  });
});
