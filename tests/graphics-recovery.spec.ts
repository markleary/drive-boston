import {test,expect,type Page} from '@playwright/test';

type GameState={state:{x:number;y:number;z:number};travelMode:string;paused:boolean;graphicsContext:{lost:boolean;losses:number;builds:number};audio:{activeLoops:number};tiles:{keys:string[]}};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():GameState}}).__backbay.snapshot());
const lose=async(page:Page)=>page.locator('#scene canvas').evaluate((canvas:HTMLCanvasElement)=>{
  const extension=canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context');
  if(!extension)throw new Error('Browser lacks WEBGL_lose_context');
  Object.assign(window,{__restoreGraphics:()=>extension.restoreContext()});extension.loseContext();
});
const restore=async(page:Page)=>page.evaluate(()=>(window as unknown as {__restoreGraphics():void}).__restoreGraphics());

for(const mobile of [true,false])test.describe(mobile?'phone graphics recovery':'desktop graphics recovery',()=>{
  test.use(mobile?{viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:3}:{});
  test('real context loss pauses in place and resumes the same vehicle; report survives reload',async({page,context},testInfo)=>{
    test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(m.text()))errors.push(m.text());});
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
    await page.getByTestId('start-drive').click();await expect(page.locator('#welcome')).toBeHidden();
    await page.getByTestId('mode-bike').click();await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('bike');
    const before=await snapshot(page);
    await lose(page);await expect(page.getByRole('heading',{name:'Graphics interrupted.'})).toBeVisible();
    await expect(page.locator('#resume-graphics')).toBeDisabled();
    await expect.poll(async()=>(await snapshot(page)).graphicsContext.lost).toBe(true);
    // Phone rotation and desktop resize can arrive before restoration.
    await page.setViewportSize(mobile?{width:852,height:393}:{width:1100,height:700});
    const stopped=await snapshot(page);await page.keyboard.press('2');await page.keyboard.down('w');
    await page.waitForTimeout(500);await page.keyboard.up('w');
    expect((await snapshot(page)).state).toEqual(stopped.state);expect(stopped.paused).toBe(true);
    // The diagnostic is available while graphics are unavailable, not behind a paused HUD.
    await page.locator('#copy-graphics-report').click();
    const report=await page.evaluate(()=>navigator.clipboard.readText());
    expect(report).toContain('Vehicle: bike');expect(report).toContain('Context losses this page: 1');
    expect(report).toContain('Resources at loss:');
    await page.evaluate(()=>Object.assign(window,{__originalClipboard:navigator.clipboard}));
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('Clipboard denied'))}}));
    await page.locator('#copy-graphics-report').click();await expect(page.locator('#graphics-report')).toHaveValue(report);
    await expect(page.locator('#graphics-report')).toBeFocused();await page.keyboard.press('Tab');
    await expect(page.locator('#reload-graphics')).toBeFocused();
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:(window as any).__originalClipboard}));
    await page.screenshot({path:testInfo.outputPath('graphics-interrupted.png')});
    await restore(page);await expect(page.getByRole('heading',{name:'Ready to resume.'})).toBeVisible({timeout:20000});
    await page.locator('#resume-graphics').click();await expect(page.locator('#graphics-modal')).toBeHidden();
    const resumed=await snapshot(page);expect(resumed.travelMode).toBe(before.travelMode);expect(resumed.paused).toBe(false);
    expect(resumed.graphicsContext.builds).toBe(2);
    await expect.poll(()=>page.locator('#scene canvas').evaluate((c:HTMLCanvasElement)=>[c.clientWidth,c.clientHeight])).toEqual(mobile?[852,393]:[1100,700]);
    expect(Math.hypot(resumed.state.x-stopped.state.x,resumed.state.z-stopped.state.z)).toBeLessThan(.1);
    expect(resumed.tiles.keys).toEqual(expect.arrayContaining(before.tiles.keys));
    await page.waitForTimeout(800);await page.screenshot({path:testInfo.outputPath('graphics-resumed.png')});
    // A second loss must be handled as well, without creating another world/audio graph.
    await page.locator('#open-map').click();await expect(page.locator('#map-modal')).toBeVisible();
    await lose(page);await expect(page.locator('#graphics-modal')).toBeVisible();
    expect(await page.evaluate(()=>localStorage.getItem('backbay-graphics-interruption-v1'))).toContain('Context losses this page: 2');
    await restore(page);await expect(page.locator('#resume-graphics')).toBeEnabled({timeout:20000});
    await page.locator('#resume-graphics').click();
    expect((await snapshot(page)).paused).toBe(true);await expect(page.locator('#map-modal')).toBeVisible();
    await page.locator('#close-map').click();expect((await snapshot(page)).paused).toBe(false);
    // Old tile listeners must not retain handles from either lost context.
    await page.evaluate(async()=>{await (window as any).__backbay.travelTo(5476.109,283.192,0);});
    await expect.poll(async()=>(await snapshot(page)).tiles.keys.includes('-1_0'),{timeout:20000}).toBe(false);
    await page.reload();await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
    await page.getByTestId('start-drive').click();await expect(page.locator('#welcome')).toBeHidden();
    await page.keyboard.press('Backquote');await page.locator('#copy-debug-report').click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('Context losses this page: 2');
    expect(errors).toEqual([]);
  });
});
