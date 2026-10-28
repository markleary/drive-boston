import {test,expect,type Page} from '@playwright/test';

type Snapshot={mobile:boolean;quality:string;lighting:string;paused:boolean;rendering:{postprocessing:boolean;dynamicReflections:boolean;shadowMapSize:number;pixelRatio:number};farCity:{residentChunks:number;geometryBytes:number};tiles:{loaded:number;fetching:number;pending:number;loadRadius:number};travelMode:string;flight:{y:number};flightGroundHeight:number;state:{x:number;y:number;z:number;speed:number};groundHeight:number};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());

test.describe('mobile startup memory limits',()=>{
  test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:3});
  test('start, touch driving, quality, lighting, rotation and neighborhood travel remain usable',async({page},testInfo)=>{
    test.setTimeout(120000);
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{
      const state=window as unknown as {__mobileMultisamples:number};state.__mobileMultisamples=0;
      const original=WebGL2RenderingContext.prototype.renderbufferStorageMultisample;
      WebGL2RenderingContext.prototype.renderbufferStorageMultisample=function(target,samples,format,width,height){if(samples>0)state.__mobileMultisamples++;return original.call(this,target,samples,format,width,height);};
    });
    await page.goto('/');await expect(page).toHaveTitle(/Boston/);
    await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
    const initial=await snapshot(page);
    expect(initial.mobile).toBe(true);expect(initial.quality).toBe('balanced');expect(initial.paused).toBe(true);
    expect(initial.rendering).toEqual({postprocessing:false,dynamicReflections:false,shadowMapSize:1024,pixelRatio:1});
    expect(initial.tiles.loaded).toBeLessThanOrEqual(2);
    // Waiting at the welcome screen must not expand the detailed neighborhood.
    await page.evaluate(()=>new Promise<void>(resolve=>{let frames=0;const frame=()=>++frames===20?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame);}));
    expect((await snapshot(page)).tiles.loaded).toBe(initial.tiles.loaded);
    const canvas=await page.locator('#scene canvas').evaluate((node:HTMLCanvasElement)=>({w:node.width,h:node.height,antialias:node.getContext('webgl2')!.getContextAttributes()!.antialias}));
    expect(canvas).toEqual({w:393,h:852,antialias:false});
    await page.screenshot({path:testInfo.outputPath('welcome-phone.png')});
    await page.getByTestId('start-drive').tap();await expect(page.locator('#welcome')).toBeHidden();
    const accelerator=page.getByRole('button',{name:'Accelerate',exact:true}),box=(await accelerator.boundingBox())!;
    const session=await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    try{await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeGreaterThan(1);}
    finally{await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    await page.screenshot({path:testInfo.outputPath('driving-phone.png')});
    await page.getByRole('button',{name:'Pause and open settings'}).tap();
    await page.getByRole('button',{name:'Detailed',exact:true}).tap();
    expect((await snapshot(page)).rendering).toEqual(initial.rendering);
    await page.getByRole('button',{name:'Night',exact:true}).tap();
    await expect.poll(async()=>(await snapshot(page)).lighting).toBe('night');
    await page.getByRole('button',{name:'Keep driving'}).tap();
    await page.screenshot({path:testInfo.outputPath('night-phone.png')});
    await page.setViewportSize({width:852,height:393});
    await expect.poll(()=>page.locator('#scene canvas').evaluate((node:HTMLCanvasElement)=>[node.width,node.height])).toEqual([852,393]);
    await page.screenshot({path:testInfo.outputPath('landscape-phone.png')});
    // A distant arrival must have terrain before placing the car, and old city
    // geometry must leave memory after the observer moves to the destination.
    await page.evaluate(async()=>{const game=(window as unknown as {__backbay:{city:{landmarks:{name:string;position:[number,number];driveStart?:{x:number;z:number;yaw:number}}[]};travelTo(x:number,z:number,yaw:number):Promise<void>}}).__backbay;
      const destination=game.city.landmarks.find(l=>l.name.includes('Mattapan'))!;
      const start=destination.driveStart??{x:destination.position[0],z:destination.position[1],yaw:0};
      await game.travelTo(start.x,start.z,start.yaw);
    });
    await expect.poll(async()=>(await snapshot(page)).tiles.loaded).toBeLessThanOrEqual(9);
    await expect.poll(async()=>(await snapshot(page)).farCity.residentChunks).toBeLessThan(25);
    const traveled=await snapshot(page);expect(traveled.tiles.loadRadius).toBe(450);
    expect(traveled.farCity.geometryBytes).toBeLessThan(12*1024*1024);
    expect(traveled.state.y).toBeGreaterThan(traveled.groundHeight-1);
    await page.setViewportSize({width:393,height:852});
    await page.getByRole('button',{name:'Helicopter mode',exact:true}).tap();
    await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('helicopter');
    const ascend=(await page.getByRole('button',{name:'Ascend',exact:true}).boundingBox())!;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ascend.x+ascend.width/2,y:ascend.y+ascend.height/2}]});
    try{await expect.poll(async()=>{const s=await snapshot(page);return s.flight.y-s.flightGroundHeight;}).toBeGreaterThan(30);}
    finally{await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    await page.screenshot({path:testInfo.outputPath('helicopter-phone.png')});
    expect(await page.evaluate(()=>(window as unknown as {__mobileMultisamples:number}).__mobileMultisamples)).toBe(0);
    expect(errors).toEqual([]);
  });
});
