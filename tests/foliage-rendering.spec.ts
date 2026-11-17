import { test, expect } from '@playwright/test';

test('leaf cutouts stay opaque through distance blends and vehicle motion', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /GL_INVALID|INVALID_(OPERATION|VALUE|ENUM)|Shader Error/.test(message.text())) errors.push(message.text());
  });
  await page.goto('/');
  await page.getByTestId('start-drive').click({ timeout: 120000 });

  // Use the game's real materials, shaders and geometry in a small MSAA
  // target. On an opaque background a cutout must leave opaque pixels:
  // fractional leaf alpha is the pale fringe path, even in the nearest LOD
  // while its cards shrink. A legacy material is the positive control.
  // Three.js disables its OPAQUE shader define when alphaToCoverage is on,
  // even with transparent=false. Its alpha-test chunk then emits smoothstep
  // alpha into covered samples; resolving against alpha-1 background samples
  // still leaves fractional alpha. This measures emitted alpha, not RGB coverage.
  const coverage = await page.evaluate(async () => {
    const game = (window as any).__backbay, renderer = game.renderer;
    const render = renderer.render;
    const view: any = await new Promise(resolve => {
      renderer.render = function(scene: any, camera: any) {
        if (scene === game.scene && !scene.overrideMaterial && this.getRenderTarget()?.samples === 4) {
          renderer.render = render;
          resolve({ camera, Target: this.getRenderTarget().constructor });
        }
        return render.call(this, scene, camera);
      };
    });
    const scene = new game.scene.constructor();
    scene.background = game.scene.fog.color.clone().setRGB(.02, .02, .02);
    for (const light of game.scene.children.filter((o: any) => o.isHemisphereLight)) scene.add(light.clone());
    const camera = view.camera.clone(); camera.aspect = 1; camera.fov = 40; camera.near = .1; camera.far = 1000; camera.clearViewOffset(); camera.updateProjectionMatrix();
    const size = 1024, target = new view.Target(size, size, { samples: 4 });
    const pixels = new Uint8Array(size * size * 4), sources = new Map<string, any>();
    game.scene.traverse((o: any) => { if (/foliage LOD/.test(o.name)) sources.set(o.name, o); });
    const species = [...new Set([...sources.keys()].map(name => name.replace(/ foliage LOD\d$/, '')))];
    const results: { species: string; distance: number; partial: number; green: number }[] = [];
    const previous = renderer.getRenderTarget();
    let legacyPartial = 0;
    try {
      for (const name of species) for (const distance of [25, 55, 70, 85, 99, 101, 215, 260, 305, 321]) {
        const lod = distance < 100 ? 0 : distance < 320 ? 1 : 2;
        const source = sources.get(`${name} foliage LOD${lod}`);
        const mesh = new source.constructor(source.geometry, source.material, 1);
        mesh.setMatrixAt(0, source.matrix.clone().makeTranslation(5000, 0, 5000));
        mesh.frustumCulled = false; scene.add(mesh);
        camera.position.set(5000, 18, 5000 + Math.sqrt(distance ** 2 - 18 ** 2)); camera.lookAt(5000, 8, 5000);
        const shader: any = { uniforms: {}, vertexShader: '#include <begin_vertex>' };
        source.material.onBeforeCompile(shader);
        shader.uniforms.treeObserver.value.copy(camera.position); shader.uniforms.treeTime.value = 2;
        const sample = () => {
          renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.setRenderTarget(null);
          renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
          let partial = 0, green = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 255) partial++;
            if (pixels[i + 1] > pixels[i] + 2 && pixels[i + 1] > pixels[i + 2] + 2) green++;
          }
          return { partial, green };
        };
        results.push({ species: name, distance, ...sample() });
        if (name === 'maple' && distance === 70) {
          const legacy = source.material.clone(); legacy.onBeforeCompile = source.material.onBeforeCompile;
          legacy.customProgramCacheKey = source.material.customProgramCacheKey; legacy.alphaToCoverage = true;
          mesh.material = legacy; legacyPartial = sample().partial; legacy.dispose();
        }
        scene.remove(mesh); mesh.dispose();
      }
    } finally { renderer.setRenderTarget(previous); target.dispose(); }
    return { results, legacyPartial };
  });
  await testInfo.attach('foliage-coverage.json', { body: JSON.stringify(coverage, null, 2), contentType: 'application/json' });
  expect(coverage.legacyPartial).toBeGreaterThan(100);
  expect(coverage.results.length).toBe(60);
  for (const sample of coverage.results) {
    expect(sample.green, `${sample.species} at ${sample.distance} m draws leaves`).toBeGreaterThan(0);
    expect(sample.partial, `${sample.species} at ${sample.distance} m keeps leaf edges opaque`).toBe(0);
  }

  await page.keyboard.press('Escape'); await page.locator('[data-light="day"]').click(); await page.locator('#resume-drive').click();
  await page.keyboard.press('3');
  await page.evaluate(() => (window as any).__backbay.flyTo(-800, 65, 100, 1.8));
  await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 });
  const start = await page.evaluate(() => ({ ...(window as any).__backbay.snapshot().flight }));
  await page.keyboard.down('w');
  try {
    await page.waitForTimeout(5000);
    for (let frame = 0; frame < 3; frame++) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: testInfo.outputPath(`flight-leaves-${frame}.png`) });
    }
  } finally { await page.keyboard.up('w'); }
  const end = await page.evaluate(() => (window as any).__backbay.snapshot().flight);
  expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(30);

  await page.keyboard.press('1');
  await page.evaluate(() => (window as any).__backbay.travelTo(-2205.07, 296.089, 1.937, '15627-0-0'));
  await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 20000 });
  await page.keyboard.down('w');
  try {
    await page.waitForTimeout(6000);
    for (let frame = 0; frame < 3; frame++) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: testInfo.outputPath(`driving-leaves-${frame}.png`) });
    }
  } finally { await page.keyboard.up('w'); }
  expect(errors).toEqual([]);
});
