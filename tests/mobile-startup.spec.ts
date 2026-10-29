import {test,expect,type Page} from '@playwright/test';

type Snapshot={mobile:boolean;quality:string;lighting:string;paused:boolean;rendering:{postprocessing:boolean;dynamicReflections:boolean;shadowMapSize:number;pixelRatio:number};farCity:{residentChunks:number;geometryBytes:number};tiles:{loaded:number;fetching:number;pending:number;loadRadius:number;keys:string[]};travelMode:string;flight:{y:number};flightGroundHeight:number;state:{x:number;y:number;z:number;speed:number};groundHeight:number};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());

test.describe('mobile startup memory limits',()=>{
  test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:3});
  test('saved airport arrival loads road owners without building the default neighborhood',async({page},testInfo)=>{
    const requested:string[]=[],errors:string[]=[];
    page.on('request',request=>{if(request.url().includes('/data/tiles/'))requested.push(request.url());});
    page.on('pageerror',error=>errors.push(error.message));
    const saved={x:5476.109,z:283.192,yaw:0};
    await page.addInitScript(position=>localStorage.setItem('backbay-drive-v1',JSON.stringify(position)),saved);
    await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
    const initial=await snapshot(page);
    expect(initial.paused).toBe(true);
    expect(Math.hypot(initial.state.x-saved.x,initial.state.z-saved.z)).toBeLessThan(.1);
    expect(initial.tiles.keys).toEqual(expect.arrayContaining(['5_0','6_-1','4_-1']));
    expect(requested.some(url=>/t_-1_(0|-1)\.bin$/.test(url))).toBe(false);
    // The two road owners must also survive normal streaming although their
    // bounds lie beyond the mobile load radius at this junction.
    await page.getByTestId('start-drive').tap();await expect(page.locator('#welcome')).toBeHidden();
    await page.evaluate(()=>new Promise<void>(resolve=>{let frames=0;const frame=()=>++frames===30?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame);}));
    expect((await snapshot(page)).tiles.keys).toEqual(expect.arrayContaining(['6_-1','4_-1']));
    await page.screenshot({path:testInfo.outputPath('perimeter-road-phone.png')});
    expect(errors).toEqual([]);
  });

  test('graphics buffers stay bounded after idle streaming and sustained touch driving',async({page},testInfo)=>{
    test.setTimeout(120000);const errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('crash',()=>errors.push('page crashed'));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{
      const state={allocated:0,peak:0},sizes=new WeakMap<WebGLBuffer,number>();
      Object.assign(window,{__mobileBuffers:state});
      const proto=WebGL2RenderingContext.prototype,native=proto.bufferData as (...args:unknown[])=>void;
      proto.bufferData=function(target:number,source:number|AllowSharedBufferSource|null,...rest:unknown[]){
        const binding=target===this.ARRAY_BUFFER?this.ARRAY_BUFFER_BINDING:target===this.ELEMENT_ARRAY_BUFFER?this.ELEMENT_ARRAY_BUFFER_BINDING:this.COPY_WRITE_BUFFER_BINDING;
        const buffer=this.getParameter(binding) as WebGLBuffer|null,bytes=typeof source==='number'?source:source?.byteLength??0;
        if(buffer){state.allocated+=bytes-(sizes.get(buffer)??0);sizes.set(buffer,bytes);state.peak=Math.max(state.peak,state.allocated);}
        return native.call(this,target,source,...rest);
      };
      const remove=proto.deleteBuffer;proto.deleteBuffer=function(buffer){if(buffer){state.allocated-=sizes.get(buffer)??0;sizes.delete(buffer);}return remove.call(this,buffer);};
    });
    await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
    await page.getByTestId('start-drive').tap();await expect(page.locator('#welcome')).toBeHidden();
    // The reported failure occurs while idle about ten seconds after Play.
    // Wait for all four starting tiles, then remain idle beyond that interval.
    await expect.poll(async()=>(await snapshot(page)).tiles.loaded,{timeout:60000}).toBeGreaterThanOrEqual(4);
    for(let second=0;second<15;second++){await page.waitForTimeout(1000);await expect(page.locator('#welcome')).toBeHidden();}
    const session=await page.context().newCDPSession(page),button=(await page.getByRole('button',{name:'Accelerate',exact:true}).boundingBox())!;
    const before=(await snapshot(page)).state;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:button.x+button.width/2,y:button.y+button.height/2}]});
    try{for(let second=0;second<6;second++){await page.waitForTimeout(1000);await expect(page.locator('#welcome')).toBeHidden();}}
    finally{await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    const after=(await snapshot(page)).state;expect(Math.hypot(after.x-before.x,after.z-before.z)).toBeGreaterThan(3);
    const buffers=await page.evaluate(()=>(window as unknown as {__mobileBuffers:{allocated:number;peak:number}}).__mobileBuffers);
    // A deterministic allocation budget catches the previous ~482 MiB buffer
    // expansion even on desktop Chrome, which doesn't share iOS's crash limit.
    expect(buffers.peak).toBeLessThan(160*1024*1024);
    await testInfo.attach('mobile-buffer-budget.json',{body:JSON.stringify(buffers),contentType:'application/json'});
    await page.screenshot({path:testInfo.outputPath('sustained-drive-phone.png')});expect(errors).toEqual([]);
  });

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
    await page.getByRole('button',{name:'Pause and open settings'}).tap();
    await page.locator('#settings-modal [data-travel="helicopter"]').tap();
    await page.getByRole('button',{name:'Keep flying'}).tap();
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
