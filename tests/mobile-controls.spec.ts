import {test,expect,type Page,type Locator,type CDPSession} from '@playwright/test';

type TouchInput={throttle:number;brake:number;steer:number;handbrake:boolean;wheelie?:boolean};
type Bounds={left:number;right:number;top:number;bottom:number};
type Snapshot={paused:boolean;state:{x:number;z:number;speed:number;steering:number};touchInput:TouchInput;vehicleScreenBounds:Bounds|null};
type TouchPoint={x:number;y:number;id:number};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
const bounds=async(locator:Locator):Promise<Bounds>=>{const r=(await locator.boundingBox())!;expect(r).not.toBeNull();return{left:r.x,right:r.x+r.width,top:r.y,bottom:r.y+r.height};};
const overlap=(a:Bounds,b:Bounds)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
async function center(locator:Locator,id:number):Promise<TouchPoint>{const r=await bounds(locator);return{x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,id};}
async function gesture(session:CDPSession,type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',touchPoints:TouchPoint[]){await session.send('Input.dispatchTouchEvent',{type,touchPoints});}
async function enter(page:Page){await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').tap();await expect(page.locator('#welcome')).toBeHidden();}
async function start(page:Page){await page.goto('/');await enter(page);}
async function neutral(page:Page){await expect.poll(async()=>{const i=(await snapshot(page)).touchInput;return[i.throttle,i.brake,i.steer,i.handbrake,!!i.wheelie];}).toEqual([0,0,0,false,false]);}

test.describe('mobile driving controls',()=>{
  test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:1,actionTimeout:15000});

  test('portrait keeps the car clear of thumb controls and landscape restores the upper-left map',async({page},testInfo)=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await start(page);
    await expect(page.locator('#touch-controls')).toHaveAttribute('data-control-mode','analog');
    await expect(page.getByTestId('touch-steering')).toBeVisible();
    await expect(page.locator('#minimap-button')).toBeHidden();
    await expect(page.getByRole('button',{name:'Open map',exact:true})).toBeVisible();
    for(const control of [page.getByTestId('touch-steering'),page.getByTestId('touch-accelerate'),page.getByTestId('touch-brake'),page.getByRole('button',{name:'Reverse gear',exact:true})]){
      const r=await bounds(control);expect(r.right-r.left).toBeGreaterThanOrEqual(44);expect(r.bottom-r.top).toBeGreaterThanOrEqual(44);expect(r.left).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(393);expect(r.bottom).toBeLessThan(852);
    }
    await expect.poll(async()=>{
      const car=(await snapshot(page)).vehicleScreenBounds;if(!car)return false;
      return !overlap(car,await bounds(page.getByTestId('touch-steering')))&&!overlap(car,await bounds(page.locator('.touch-pedals')));
    }).toBe(true);
    expect(await page.locator('#location-label').evaluate(el=>getComputedStyle(el).userSelect)).toBe('none');
    await page.screenshot({path:testInfo.outputPath('portrait-analog-controls.png')});
    // Browser chrome can leave a small phone with substantially less playfield.
    await page.setViewportSize({width:320,height:480});
    await expect(page.locator('#minimap-button')).toBeHidden();
    const compactControls=await page.locator('#touch-steering, .touch-pedals .touch-btn:visible, .touch-gears .touch-btn:visible, .touch-actions .touch-btn:visible').all();
    await expect.poll(async()=>{
      const car=(await snapshot(page)).vehicleScreenBounds;if(!car)return false;
      const controls=await Promise.all(compactControls.map(control=>bounds(control)));
      return car.left>=0&&car.right<=320&&car.top>=0&&car.bottom<=480&&controls.every(control=>!overlap(car,control));
    }).toBe(true);
    await page.screenshot({path:testInfo.outputPath('portrait-compact-controls.png')});
    await page.setViewportSize({width:393,height:852});
    await page.getByRole('button',{name:'Open map',exact:true}).tap();
    await expect(page.locator('#map-modal')).toBeVisible();expect((await snapshot(page)).paused).toBe(true);
    const mapSession=await page.context().newCDPSession(page);
    try{
      const mapBefore=await page.locator('#fullmap').screenshot();
      const fingers=[{x:155,y:340,id:1},{x:235,y:340,id:2}];
      await gesture(mapSession,'touchStart',fingers);
      await gesture(mapSession,'touchMove',[{...fingers[0],x:95},{...fingers[1],x:295}]);
      expect(await page.locator('#fullmap').screenshot()).not.toEqual(mapBefore);
      expect(await page.evaluate(()=>window.visualViewport!.scale)).toBe(1);
      await page.screenshot({path:testInfo.outputPath('portrait-map-pinch.png')});
      // Close and rotate during a gesture: stale fingers must not pan a reopened map.
      await page.keyboard.press('m');await expect(page.locator('#map-modal')).toBeHidden();
      await page.setViewportSize({width:852,height:393});
      await page.keyboard.press('m');await expect(page.locator('#map-modal')).toBeVisible();
      const reopened=await page.locator('#fullmap').screenshot();
      await gesture(mapSession,'touchMove',[{x:350,y:180,id:1},{x:450,y:180,id:2}]);
      expect(await page.locator('#fullmap').screenshot()).toEqual(reopened);
      await gesture(mapSession,'touchEnd',[]);
      await gesture(mapSession,'touchStart',[{x:350,y:180,id:1}]);
      await gesture(mapSession,'touchMove',[{x:420,y:200,id:1}]);
      expect(await page.locator('#fullmap').screenshot()).not.toEqual(reopened);
      await gesture(mapSession,'touchEnd',[]);
    }finally{await mapSession.detach().catch(()=>{});}
    await page.getByRole('button',{name:'Back to driving'}).tap();
    await expect(page.locator('#minimap-button')).toBeVisible();
    const mini=await bounds(page.locator('#minimap-button'));
    expect(mini.left).toBeLessThan(110);expect(mini.top).toBeLessThan(90);
    for(const selector of ['.touch-steering-group','.touch-pedals','#open-map','#cycle-camera','#open-settings','.speed-cluster'])expect(overlap(mini,await bounds(page.locator(selector))),selector).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(852);
    await page.screenshot({path:testInfo.outputPath('landscape-analog-controls.png')});
    expect(errors).toEqual([]);
  });

  test('analog steering is proportional, works with gas, and the brake stops without selecting reverse',async({page},testInfo)=>{
    await start(page);
    const session=await page.context().newCDPSession(page),pad=await bounds(page.getByTestId('touch-steering'));
    const middle={x:(pad.left+pad.right)/2,y:(pad.top+pad.bottom)/2,id:1};
    const partial={...middle,x:middle.x-(pad.right-pad.left)*.12},full={...middle,x:pad.left+3};
    const gas=await center(page.getByTestId('touch-accelerate'),2),brake=await center(page.getByTestId('touch-brake'),3);
    try{
      await gesture(session,'touchStart',[partial]);
      await expect.poll(async()=>(await snapshot(page)).touchInput.steer).toBeGreaterThan(.1);
      const part=(await snapshot(page)).touchInput.steer;expect(part).toBeLessThan(.75);
      await expect.poll(async()=>(await snapshot(page)).state.steering).toBeGreaterThan(.03);
      await gesture(session,'touchMove',[full]);
      await expect.poll(async()=>(await snapshot(page)).touchInput.steer).toBeGreaterThan(.95);
      await gesture(session,'touchMove',[partial]);
      await gesture(session,'touchStart',[partial,gas]);
      await expect.poll(async()=>{const i=(await snapshot(page)).touchInput;return i.throttle===1&&i.steer>.1&&i.steer<.75;}).toBe(true);
      await expect.poll(async()=>(await snapshot(page)).state.speed).toBeGreaterThan(2);
      await expect(page.getByRole('button',{name:'Reverse gear',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Drive gear',exact:true})).toHaveAttribute('aria-pressed','true');
      await gesture(session,'touchEnd',[]);
      await gesture(session,'touchStart',[brake]);
      await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.3);
      await page.waitForTimeout(750);
      const stopped=await snapshot(page);expect(stopped.state.speed).toBeGreaterThan(-.3);expect(stopped.touchInput.brake).toBe(1);expect(stopped.touchInput.throttle).toBe(0);expect(stopped.touchInput.handbrake).toBe(false);
      await expect(page.getByRole('button',{name:'Reverse gear',exact:true})).toBeEnabled();
      await gesture(session,'touchEnd',[]);
      await page.getByRole('button',{name:'Reverse gear',exact:true}).tap();
      await expect(page.getByRole('button',{name:'Reverse gear',exact:true})).toHaveAttribute('aria-pressed','true');
      await gesture(session,'touchStart',[gas]);
      await expect.poll(async()=>(await snapshot(page)).state.speed).toBeLessThan(-1);
      await gesture(session,'touchEnd',[]);await neutral(page);
      await page.screenshot({path:testInfo.outputPath('portrait-reverse-controls.png')});
    }finally{await session.detach().catch(()=>{});}
  });

  test('joystick preference survives reload and cancel, pause and rotation release held input',async({page},testInfo)=>{
    test.setTimeout(120000);
    await start(page);
    await page.getByRole('button',{name:'Pause and open settings'}).tap();
    await expect(page.locator('#settings-title')).toBeInViewport();
    await expect(page.locator('[data-touch-mode="joystick"]')).toBeInViewport();
    await page.locator('[data-touch-mode="joystick"]').tap();
    await expect(page.locator('[data-touch-mode="joystick"]')).toHaveAttribute('aria-pressed','true');
    await page.screenshot({path:testInfo.outputPath('mobile-control-settings.png')});
    await page.getByRole('button',{name:'Keep driving'}).tap();
    await page.reload();await enter(page);
    await expect(page.locator('#touch-controls')).toHaveAttribute('data-control-mode','joystick');
    await expect(page.getByTestId('touch-accelerate')).toBeHidden();
    const session=await page.context().newCDPSession(page),pad=await bounds(page.getByTestId('touch-steering'));
    const middle={x:(pad.left+pad.right)/2,y:(pad.top+pad.bottom)/2,id:1};
    const partial={...middle,x:middle.x-(pad.right-pad.left)*.1,y:middle.y-(pad.bottom-pad.top)*.1};
    const up={...middle,y:pad.top+3},down={...middle,y:pad.bottom-3};
    try{
      await gesture(session,'touchStart',[partial]);
      await expect.poll(async()=>{const i=(await snapshot(page)).touchInput;return i.steer>.1&&i.steer<.9&&i.throttle>.1&&i.throttle<.9;}).toBe(true);
      await gesture(session,'touchCancel',[]);await neutral(page);
      await gesture(session,'touchStart',[up]);
      await expect.poll(async()=>(await snapshot(page)).touchInput.throttle).toBeGreaterThan(.95);
      await expect.poll(async()=>(await snapshot(page)).state.speed).toBeGreaterThan(1);
      await gesture(session,'touchMove',[down]);
      await expect.poll(async()=>(await snapshot(page)).touchInput.throttle).toBeLessThan(-.95);
      await expect.poll(async()=>(await snapshot(page)).state.speed).toBeLessThan(-.5);
      await gesture(session,'touchCancel',[]);await neutral(page);
      await page.screenshot({path:testInfo.outputPath('portrait-joystick-controls.png')});
      await gesture(session,'touchStart',[up]);
      await expect.poll(async()=>(await snapshot(page)).touchInput.throttle).toBeGreaterThan(.95);
      // Activate pause while a finger is still down, without relying on browser
      // click synthesis for a non-primary touch in the same gesture.
      await page.getByRole('button',{name:'Pause and open settings'}).evaluate((button:HTMLButtonElement)=>button.click());
      await expect(page.locator('#settings-modal')).toBeVisible();await neutral(page);
      await expect(page.locator('#settings-title')).toBeInViewport();
      await expect(page.locator('[data-touch-mode="joystick"]')).toBeInViewport();
      // Releasing an interrupted driving touch must not click a new menu item.
      await gesture(session,'touchEnd',[]);
      await expect(page.locator('#settings-modal')).toBeVisible();
      await neutral(page);
      await page.getByRole('button',{name:'Keep driving'}).tap();
      await neutral(page);
      await gesture(session,'touchStart',[up]);
      await expect.poll(async()=>(await snapshot(page)).touchInput.throttle).toBeGreaterThan(.95);
      await page.setViewportSize({width:852,height:393});await neutral(page);
      const landscape=await bounds(page.getByTestId('touch-steering'));
      const newUp={x:(landscape.left+landscape.right)/2,y:landscape.top+3,id:1};
      // A finger held through rotation must lift before driving again.
      await gesture(session,'touchMove',[newUp]);await neutral(page);
      await gesture(session,'touchEnd',[]);await gesture(session,'touchStart',[newUp]);
      await expect.poll(async()=>(await snapshot(page)).touchInput.throttle).toBeGreaterThan(.95);
      await gesture(session,'touchEnd',[]);await neutral(page);
      await page.screenshot({path:testInfo.outputPath('landscape-joystick-controls.png')});
    }finally{await session.detach().catch(()=>{});}
  });
});
