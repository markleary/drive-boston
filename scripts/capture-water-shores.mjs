import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// PORT=4184 LABEL=before SITE=dam node scripts/capture-water-shores.mjs
const out = new URL('../artifacts/water-shores/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const mobile = process.env.MOBILE === '1';
  const page = await browser.newPage({ viewport: mobile ? { width: 852, height: 393 } : { width: 1600, height: 1000 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /GL_INVALID|Shader Error/.test(m.text())) errors.push(m.text()); });
  await page.route('**/node_modules/three/build/*.js', route => route.fulfill({ path: new URL('../node_modules/three/build/' + new URL(route.request().url()).pathname.split('/').at(-1), import.meta.url).pathname, contentType: 'text/javascript' }));
  await page.addInitScript(() => localStorage.setItem('backbay-drive-v1', JSON.stringify({ x: 425, z: -2015, yaw: -1.5587 })));
  await page.goto('http://127.0.0.1:' + (process.env.PORT ?? 4184));
  await page.getByTestId('start-drive').click({ timeout: 120000 });
  await page.waitForFunction(() => window.__backbay?.ready, undefined, { timeout: 120000 });
  await page.keyboard.press('3');
  const snapshots = [];
  let loadedAt;
  const sites = [
    ['dam', [425.14, 44.41, -2015.42], [50, -8, -2020]],
    ['dam-close', [375, 14, -2015], [300, -3, -1990]],
    ['charles', [-210, 100, -1430], [-560, -3.18, -1300]],
    ['fens', [-1810, 65, 1245], [-1850, -2.6, 1170]],
    ['neponset', [-1182, 70, 8898], [-1000, 1.18, 9000]],
    ['harbor', [2903, 80, 120], [3020, 0, -130]],
  ];
  for (const [name, eye, target] of sites.filter(s => !process.env.SITE || process.env.SITE.split(',').includes(s[0]))) {
    // Nearby inspection cameras share the loaded neighborhood. Moving the
    // aircraft for each close-up needlessly starts another streaming cycle.
    if (!loadedAt || Math.hypot(eye[0] - loadedAt[0], eye[2] - loadedAt[2]) > 100) {
      await page.evaluate(([x, y, z]) => window.__backbay.flyTo(x, y + 80, z, -1.5587), eye);
      try {
        await page.waitForFunction(() => { const t = window.__backbay.snapshot().tiles; return !t || (!t.underConstruction && !t.pending && !t.fetching && !t.downloaded); }, undefined, { timeout: 180000, polling: 500 });
      } catch (error) { console.error(name, await page.evaluate(() => window.__backbay.snapshot().tiles)); throw error; }
      loadedAt = eye;
    }
    const capture = await page.evaluate(async ({ eye, target }) => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const d = window.__backbay, camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .15, 4000);
      camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld();
      d.renderer.render(d.scene, camera);
      const s = d.snapshot();
      return { image: d.renderer.domElement.toDataURL('image/png'), snapshot: { mobile: s.mobile, fps: s.fps, triangles: s.triangles, drawCalls: s.drawCalls, graphicsContext: s.graphicsContext, tiles: s.tiles } };
    }, { eye, target });
    assert.equal(capture.snapshot.mobile, mobile);
    assert.equal(capture.snapshot.graphicsContext.losses, 0);
    assert.equal(capture.snapshot.tiles.failed, 0);
    const prefix = (process.env.LABEL ?? 'after') + (mobile ? '-mobile' : '');
    await writeFile(new URL(`${prefix}-${name}.png`, out), Buffer.from(capture.image.split(',')[1], 'base64'));
    snapshots.push({ name, ...capture.snapshot });
    console.log('Captured', name);
  }
  await writeFile(new URL(`${process.env.LABEL ?? 'after'}${mobile ? '-mobile' : ''}${process.env.SITE ? '-' + process.env.SITE.replaceAll(',', '-') : ''}-audit.json`, out), JSON.stringify({ errors, snapshots }, null, 2));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
