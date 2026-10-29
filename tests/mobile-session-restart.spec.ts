import {test,expect} from '@playwright/test';

test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
test('a renderer process crash leaves a copyable previous-session report on the next load',async({page,context},testInfo)=>{
  test.setTimeout(120000);await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.goto('/');await expect(page.locator('#start-drive')).toBeEnabled({timeout:90000});
  await expect(page.locator('#previous-session')).toBeHidden();
  await page.locator('#start-drive').tap();await expect(page.locator('#welcome')).toBeHidden();
  await page.getByTestId('mode-bike').tap();
  // Observe a real periodic snapshot after the vehicle switch, before killing
  // the renderer without pagehide or JavaScript error callbacks.
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('backbay-session-v1')??'null')?.report),{timeout:25000}).toContain('Vehicle: bike');
  // Exercise the persisted lifecycle transition explicitly: Playwright's
  // Chromium launch disables bfcache, so this is not a native cache restore.
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('backbay-session-v1')!).exit)).toBe('pagehide');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('backbay-session-v1')!).exit)).toBe('active');
  const cdp=await context.newCDPSession(page),crashed=page.waitForEvent('crash');
  void cdp.send('Page.crash').catch(()=>{});await crashed;
  const reopened=await context.newPage();const errors:string[]=[];reopened.on('pageerror',e=>errors.push(e.message));
  await reopened.goto('/');await expect(reopened.locator('#copy-session-report')).toBeVisible();
  await reopened.locator('#copy-session-report').tap();
  const report=await reopened.evaluate(()=>navigator.clipboard.readText());
  expect(report).toContain('no pagehide recorded');expect(report).toContain('Vehicle: bike');
  expect(report).toContain('context losses: 0');expect(report).toContain('Detailed tiles:');expect(report).toContain('FPS:');
  expect(report).toContain('Resident scene attribute bytes:');expect(report).toContain('Resident tile groups:');
  await reopened.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}}));
  await reopened.locator('#copy-session-report').tap();await expect(reopened.locator('#session-report')).toHaveValue(report);
  await reopened.screenshot({path:testInfo.outputPath('previous-session-phone.png')});
  await expect(reopened.locator('#start-drive')).toBeEnabled({timeout:90000});await reopened.locator('#start-drive').tap();
  await expect(reopened.locator('#previous-session')).toBeHidden();expect(errors).toEqual([]);
  // Capturing a new session must not recursively include the old saved report.
  expect(await reopened.evaluate(()=>JSON.parse(localStorage.getItem('backbay-session-v1')!).report)).not.toContain('Last saved session:');
});
