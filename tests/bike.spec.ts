import {test,expect,type Page} from '@playwright/test';
type State={x:number;y:number;z:number;speed:number;vehicle:string;wheelie:number;wheelieRemaining:number;wheelAngles:number[];rotation:{x:number;y:number;z:number;w:number}};
type Snapshot={state:State;travelMode:string;paused:boolean;camera:string;cameraPosition:{x:number;y:number;z:number};audio:{engineGain:number;electricGain:number;rotorGain:number}};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
async function start(page:Page){await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();await expect(page.locator('#welcome')).toBeHidden();}

test('Ultra Bee: switch, ride, wheelie, pause, camera, reset and return to car',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
  await start(page);await expect(page.getByRole('button',{name:'Wheelie',exact:true})).toBeHidden();
  await page.keyboard.press('3');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('bike');
  await expect(page.getByTestId('mode-bike')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#drive-hint')).toContainText('Wheelie');
  expect((await snapshot(page)).state.wheelAngles).toHaveLength(2);
  await page.screenshot({path:testInfo.outputPath('ultra-bee-chase.png')});
  await page.mouse.move(550,380);await page.mouse.down();await page.mouse.move(820,380,{steps:15});await page.mouse.up();
  await page.waitForTimeout(400);await page.screenshot({path:testInfo.outputPath('ultra-bee-profile.png')});
  await page.keyboard.press('c');await page.keyboard.press('c');await page.keyboard.press('c');
  await page.keyboard.down('w');
  try{
    await expect.poll(async()=>(await snapshot(page)).state.speed).toBeGreaterThan(3);
    await page.keyboard.down('x');
    await expect.poll(async()=>(await snapshot(page)).state.wheelieRemaining).toBeGreaterThan(1);
    await expect.poll(async()=>(await snapshot(page)).state.wheelie).toBeGreaterThan(.35);
    await expect(page.locator('#journey-label')).toContainText('WHEELIE');
    await page.screenshot({path:testInfo.outputPath('ultra-bee-wheelie.png')});
  }finally{await page.keyboard.up('x');await page.keyboard.up('w');}
  await expect.poll(async()=>(await snapshot(page)).audio.engineGain).toBeLessThan(.001);
  await expect.poll(async()=>(await snapshot(page)).audio.electricGain).toBeGreaterThan(.005);
  await page.keyboard.press('m');const paused=(await snapshot(page)).state;
  await page.keyboard.down('w');await page.keyboard.down('x');await page.waitForTimeout(300);await page.keyboard.up('x');await page.keyboard.up('w');
  expect((await snapshot(page)).state.x).toBe(paused.x);expect((await snapshot(page)).state.wheelieRemaining).toBe(paused.wheelieRemaining);
  await page.keyboard.press('m');await page.keyboard.press('r');
  await expect.poll(async()=>(await snapshot(page)).state.wheelieRemaining).toBe(0);
  await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.2);
  await page.keyboard.press('c');await expect(page.locator('#camera-label')).toHaveText('Rider camera');
  await page.screenshot({path:testInfo.outputPath('ultra-bee-rider.png')});
  // A first-person viewpoint must remain on the moving rider rather than trail
  // several meters behind the bike like the chase camera.
  const eyeDistance=(s:Snapshot)=>Math.hypot(s.cameraPosition.x-s.state.x,s.cameraPosition.y-s.state.y,s.cameraPosition.z-s.state.z);
  await page.keyboard.down('w');
  try{
    await expect.poll(async()=>(await snapshot(page)).state.speed).toBeGreaterThan(8);
    expect(eyeDistance(await snapshot(page))).toBeLessThan(1.2);
    await page.screenshot({path:testInfo.outputPath('ultra-bee-rider-moving.png')});
    await page.keyboard.down('x');
    await expect.poll(async()=>(await snapshot(page)).state.wheelie).toBeGreaterThan(.35);
    expect(eyeDistance(await snapshot(page))).toBeLessThan(1.2);
    await page.screenshot({path:testInfo.outputPath('ultra-bee-rider-wheelie.png')});
  }finally{await page.keyboard.up('x');await page.keyboard.up('w');}

  await page.keyboard.press('2');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('helicopter');
  await expect(page.locator('#drive-hint')).not.toContainText('Wheelie');
  await page.keyboard.press('3');await expect.poll(async()=>(await snapshot(page)).state.vehicle).toBe('ultrabee');
  await page.keyboard.press('1');await expect.poll(async()=>(await snapshot(page)).state.vehicle).toBe('car');
  expect((await snapshot(page)).state.wheelAngles).toHaveLength(4);
  await expect(page.locator('#drive-hint')).toContainText('Handbrake');
  await expect.poll(async()=>(await snapshot(page)).audio.electricGain).toBeLessThan(.001);
  expect(errors).toEqual([]);
});

test.describe('phone bike controls',()=>{
  test.use({viewport:{width:375,height:812},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  test('touch wheelie button fits beside the brake and responds while riding',async({page},testInfo)=>{
    await start(page);await page.getByTestId('mode-bike').tap();
    const wheelie=page.getByRole('button',{name:'Wheelie',exact:true}),accelerate=page.getByRole('button',{name:'Accelerate',exact:true});
    await expect(wheelie).toBeVisible();await expect(page.getByRole('button',{name:'Brake bike',exact:true})).toBeVisible();
    const w=(await wheelie.boundingBox())!,a=(await accelerate.boundingBox())!;
    for(const selector of ['.travel-switch','.touch-controls','#drive-hint']){const r=(await page.locator(selector).boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(375);}
    const touch=await page.context().newCDPSession(page);
    const point=(r:{x:number;y:number;width:number;height:number},id:number)=>({x:r.x+r.width/2,y:r.y+r.height/2,id});
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(a,1)]});
    try{
      await expect.poll(async()=>(await snapshot(page)).state.speed).toBeGreaterThan(3);
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(a,1),point(w,2)]});
      await expect.poll(async()=>(await snapshot(page)).state.wheelieRemaining).toBeGreaterThan(1);
      await page.screenshot({path:testInfo.outputPath('ultra-bee-mobile-wheelie.png')});
    }finally{await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();}
    await page.getByTestId('mode-drive').tap();await expect(wheelie).toBeHidden();
  });
});
