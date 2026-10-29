import {test,expect,type Page,type Locator,type CDPSession} from '@playwright/test';

type FlightTouchInput={forward:number;strafe:number;yaw:number;lift:number};
type Snapshot={paused:boolean;travelMode:string;flight:{x:number;y:number;z:number;speed:number;verticalSpeed:number};flightTouchInput:FlightTouchInput};
type TouchPoint={x:number;y:number;id:number};
type TouchProbe={dropEnds:boolean;lastPointer:number};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
const button=(page:Page,action:string)=>page.locator(`#flight-touch [data-touch="${action}"]`);
const neutralInput={forward:0,strafe:0,yaw:0,lift:0};
async function input(page:Page,expected:FlightTouchInput){await expect.poll(async()=>(await snapshot(page)).flightTouchInput).toEqual(expected);}
async function center(locator:Locator,id:number):Promise<TouchPoint>{const box=(await locator.boundingBox())!;expect(box).not.toBeNull();return{x:box.x+box.width/2,y:box.y+box.height/2,id};}
async function gesture(session:CDPSession,type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',touchPoints:TouchPoint[]){await session.send('Input.dispatchTouchEvent',{type,touchPoints});}
function errorsFrom(page:Page){const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});return errors;}

async function startFlying(page:Page){
  // Register before application listeners so dropped pointer events are genuinely
  // unavailable to the controller; native touchend/cancel still reaches it.
  await page.addInitScript(()=>{
    const probe:TouchProbe={dropEnds:false,lastPointer:0};Object.assign(window,{__flightTouchProbe:probe});
    window.addEventListener('pointerdown',event=>{if(event.target instanceof Element&&event.target.closest('#flight-touch'))probe.lastPointer=event.pointerId;},true);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])window.addEventListener(type,event=>{if(probe.dropEnds)event.stopImmediatePropagation();},true);
  });
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').tap();await expect(page.locator('#welcome')).toBeHidden();
  await page.locator('#open-settings').tap();await page.locator('#settings-modal [data-travel="helicopter"]').tap();await page.locator('#resume-drive').tap();
  await expect(page.locator('#flight-touch')).toBeVisible();
}
const dropPointerEnds=(page:Page,value:boolean)=>page.evaluate(drop=>{(window as unknown as {__flightTouchProbe:TouchProbe}).__flightTouchProbe.dropEnds=drop;},value);
async function retargetEnd(page:Page,type:'pointerup'|'pointercancel',selector='body',pointerType='touch'){
  await page.locator(selector).evaluate((target,event)=>{
    const pointerId=(window as unknown as {__flightTouchProbe:TouchProbe}).__flightTouchProbe.lastPointer;
    target.dispatchEvent(new PointerEvent(event.type,{pointerId,pointerType:event.pointerType,button:0,buttons:0,bubbles:true,cancelable:true}));
  },{type,pointerType});
}

test.describe('helicopter touch release',()=>{
  test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:1,actionTimeout:15000});

  test('native touch end recovers a missing pointer release and repeated forward/backward taps stay neutral',async({page},testInfo)=>{
    const errors=errorsFrom(page);await startFlying(page);
    const session=await page.context().newCDPSession(page),forward=button(page,'accelerate'),backward=button(page,'reverse');
    try{
      await gesture(session,'touchStart',[await center(forward,1)]);await expect(forward).toHaveClass(/held/);
      await dropPointerEnds(page,true);await gesture(session,'touchEnd',[]);await dropPointerEnds(page,false);
      // This reproduces the reported orange Forward button after its finger lifts.
      await expect.soft(forward).not.toHaveClass(/held/,{timeout:1000});
      for(const control of [forward,backward,forward,backward]){
        await control.tap();await expect.soft(page.locator('#flight-touch .held')).toHaveCount(0,{timeout:1000});
      }
      await input(page,neutralInput);
      await page.screenshot({path:testInfo.outputPath('flight-after-orphaned-release.png')});
      expect(errors).toEqual([]);
    }finally{await dropPointerEnds(page,false);await session.detach().catch(()=>{});}
  });

  test('pen fallback retargeted release, cancel and pointer reuse clear their original action',async({page},testInfo)=>{
    const errors=errorsFrom(page);await startFlying(page);
    const session=await page.context().newCDPSession(page),forward=button(page,'accelerate'),backward=button(page,'reverse');
    const point=await center(forward,1);
    const pen=async(type:'mousePressed'|'mouseReleased')=>session.send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,pointerType:'pen'});
    try{
      for(const end of ['pointerup','pointercancel'] as const){
        await pen('mousePressed');await input(page,{...neutralInput,forward:1});
        await retargetEnd(page,end,end==='pointerup'?'body':'#flight-touch [data-touch="reverse"]','pen');
        await input(page,neutralInput);await expect(forward).not.toHaveClass(/held/);await expect(backward).not.toHaveClass(/held/);
        await pen('mouseReleased');
      }
      // Reusing a pointer ID for another action must not leave its old action held.
      await pen('mousePressed');
      await backward.evaluate(target=>{
        const pointerId=(window as unknown as {__flightTouchProbe:TouchProbe}).__flightTouchProbe.lastPointer;
        target.dispatchEvent(new PointerEvent('pointerdown',{pointerId,pointerType:'pen',button:0,buttons:1,bubbles:true,cancelable:true}));
      });
      await input(page,{...neutralInput,forward:-1});await expect(forward).not.toHaveClass(/held/);await expect(backward).toHaveClass(/held/);
      await pen('mouseReleased');await input(page,neutralInput);await expect(page.locator('#flight-touch .held')).toHaveCount(0);
      await page.screenshot({path:testInfo.outputPath('flight-retargeted-release.png')});expect(errors).toEqual([]);
    }finally{await session.detach().catch(()=>{});}
  });

  test('real simultaneous forward and ascend touches release independently in either order',async({page},testInfo)=>{
    const errors=errorsFrom(page);await startFlying(page);
    const session=await page.context().newCDPSession(page),forward=button(page,'accelerate'),ascend=button(page,'ascend');
    const movement=await center(forward,1),lift=await center(ascend,2),secondMovement={...movement,x:movement.x+8,id:3};
    try{
      const initial=(await snapshot(page)).flight;
      await gesture(session,'touchStart',[movement,lift]);await input(page,{...neutralInput,forward:1,lift:1});
      // A stray PointerEvent cannot cancel a finger still present in native touches.
      await retargetEnd(page,'pointerup');await input(page,{...neutralInput,forward:1,lift:1});
      await expect.poll(async()=>(await snapshot(page)).flight.y-initial.y).toBeGreaterThan(1);
      await expect.poll(async()=>(await snapshot(page)).flight.speed).toBeGreaterThan(1);
      // For a partial CDP touchEnd, identify the contact being released.
      await gesture(session,'touchEnd',[movement]);await input(page,{...neutralInput,lift:1});
      await expect(forward).not.toHaveClass(/held/);await expect(ascend).toHaveClass(/held/);
      const released=(await snapshot(page)).flight.y;await expect.poll(async()=>(await snapshot(page)).flight.y-released).toBeGreaterThan(1);
      await expect.poll(async()=>(await snapshot(page)).flight.speed).toBeLessThan(.5);
      await gesture(session,'touchEnd',[]);await input(page,neutralInput);
      await gesture(session,'touchStart',[movement,lift]);await gesture(session,'touchEnd',[lift]);
      await input(page,{...neutralInput,forward:1});await expect(ascend).not.toHaveClass(/held/);
      await gesture(session,'touchEnd',[]);await input(page,neutralInput);
      // Lifting one of two fingers on the same button keeps the other one active.
      await gesture(session,'touchStart',[movement,secondMovement]);await gesture(session,'touchEnd',[movement]);
      await input(page,{...neutralInput,forward:1});await expect(forward).toHaveClass(/held/);
      await gesture(session,'touchCancel',[]);await input(page,neutralInput);await expect(page.locator('#flight-touch .held')).toHaveCount(0);
      await page.screenshot({path:testInfo.outputPath('flight-multitouch-released.png')});
      // An interrupted finger must lift before a later movement can fly again.
      await gesture(session,'touchStart',[movement]);await input(page,{...neutralInput,forward:1});
      await page.locator('#open-settings').evaluate((control:HTMLButtonElement)=>control.click());await input(page,neutralInput);
      await gesture(session,'touchMove',[{...movement,x:movement.x+3}]);await input(page,neutralInput);
      await page.locator('#resume-drive').evaluate((control:HTMLButtonElement)=>control.click());
      await gesture(session,'touchMove',[movement]);await input(page,neutralInput);await gesture(session,'touchEnd',[]);
      await gesture(session,'touchStart',[movement]);await input(page,{...neutralInput,forward:1});
      await page.setViewportSize({width:852,height:393});await input(page,neutralInput);
      const landscapeForward=await center(forward,1);
      await gesture(session,'touchMove',[landscapeForward]);await input(page,neutralInput);await gesture(session,'touchEnd',[]);
      await gesture(session,'touchStart',[landscapeForward]);await input(page,{...neutralInput,forward:1});
      await gesture(session,'touchEnd',[]);await input(page,neutralInput);await expect(page.locator('#flight-touch .held')).toHaveCount(0);
      await page.screenshot({path:testInfo.outputPath('flight-after-pause-and-rotation.png')});expect(errors).toEqual([]);
    }finally{await session.detach().catch(()=>{});}
  });
});
