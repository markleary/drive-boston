import {test,expect,type Page} from '@playwright/test';
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():{state:{x:number;y:number;z:number;steering:number};flight:{x:number;y:number;z:number};paused:boolean}}}).__backbay.snapshot());
async function start(page:Page){await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();await expect(page.locator('#welcome')).toBeHidden();}

test('diagnostic shortcuts, live counters, clipboard and helicopter location leave steering intact',async({page,context},testInfo)=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await context.grantPermissions(['clipboard-read','clipboard-write']);await start(page);
  await expect(page.locator('#performance-hud')).toBeHidden();await expect(page.locator('#debug-hud')).toBeHidden();
  await page.keyboard.down('p');await expect(page.locator('#performance-hud')).toBeVisible();await page.keyboard.down('p');await page.keyboard.up('p');await expect(page.locator('#performance-hud')).toBeVisible();
  await expect.poll(async()=>Number(await page.locator('#performance-fps').textContent())).toBeGreaterThan(0);
  await expect.poll(async()=>Number(await page.locator('#performance-frame').textContent())).toBeGreaterThan(0);
  await expect(page.locator('#performance-render')).toContainText('draw calls');
  await page.keyboard.press('Backquote');await expect(page.locator('#debug-hud')).toBeVisible();expect((await snapshot(page)).paused).toBe(false);
  await page.keyboard.down('d');try{await expect.poll(async()=>(await snapshot(page)).state.steering).toBeLessThan(-.1);}finally{await page.keyboard.up('d');}
  await expect(page.locator('#debug-hud')).toBeVisible();
  await page.getByRole('button',{name:'Copy debug report',exact:true}).click();await expect(page.locator('#debug-copy-status')).toContainText('Copied');
  const report=await page.evaluate(()=>navigator.clipboard.readText()),position=(await snapshot(page)).state;
  expect(report).toContain('Active vehicle: drive');expect(report).toContain('Road ID:');expect(report).toContain('World meters:');
  const copied=report.match(/X=(-?[\d.]+), Y=(-?[\d.]+), Z=(-?[\d.]+)/)!;
  expect(Math.abs(Number(copied[1])-position.x)).toBeLessThan(.1);expect(Math.abs(Number(copied[3])-position.z)).toBeLessThan(.1);
  await page.screenshot({path:testInfo.outputPath('diagnostics-desktop.png')});
  await page.keyboard.press('p');await expect(page.locator('#performance-hud')).toBeHidden();await expect(page.locator('#debug-hud')).toBeVisible();
  await page.keyboard.press('3');await expect(page.locator('#debug-mode')).toContainText('Helicopter');
  await page.keyboard.down('Space');await page.waitForTimeout(800);await page.keyboard.up('Space');
  await expect.poll(async()=>{const s=await snapshot(page);return Math.abs(Number(await page.locator('#debug-y').textContent())-s.flight.y);}).toBeLessThan(2);
  await page.getByRole('button',{name:'Copy debug report',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('Active vehicle: helicopter');
  await page.keyboard.press('m');await expect(page.locator('#debug-hud')).toBeHidden();await page.keyboard.press('m');await expect(page.locator('#debug-hud')).toBeVisible();
  // Clipboard denial still gives a selectable report, and typing there never drives or toggles the HUD.
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('Clipboard unavailable'))}}));
  await page.getByRole('button',{name:'Copy debug report',exact:true}).click();await expect(page.locator('#debug-report-fallback')).toBeVisible();await expect(page.locator('#debug-report-fallback')).toHaveValue(/Active vehicle: helicopter/);
  await page.keyboard.press('p');await page.keyboard.press('Backquote');await expect(page.locator('#performance-hud')).toBeHidden();await expect(page.locator('#debug-hud')).toBeVisible();
  await page.getByRole('button',{name:'Hide debug statistics'}).click();await expect(page.locator('#debug-hud')).toBeHidden();await page.keyboard.press('Backquote');await expect(page.locator('#debug-hud')).toBeVisible();
  expect(errors).toEqual([]);
});

test('diagnostics fit a phone and are accessible through settings',async({page},testInfo)=>{
  await page.setViewportSize({width:375,height:812});await start(page);await page.keyboard.press('Escape');
  await page.locator('[data-hud="performance"]').click();await page.locator('[data-hud="debug"]').click();
  await expect(page.locator('[data-hud="performance"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-hud="debug"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('#resume-drive').click();await expect(page.locator('#debug-hud')).toBeVisible();
  const panel=await page.locator('.diagnostics').boundingBox();expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.x+panel!.width).toBeLessThanOrEqual(375);expect(panel!.y+panel!.height).toBeLessThan(650);
  await page.getByRole('button',{name:'Copy debug report',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('diagnostics-phone.png')});
});
