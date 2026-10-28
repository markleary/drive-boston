import {test,expect} from '@playwright/test';

test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:3});
test('five-minute library drive alternates car and Ultra Bee without growing graphics buffers',async({page},testInfo)=>{
  test.setTimeout(420000);const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('crash',()=>errors.push('page crashed'));
  await page.addInitScript(()=>{
    const p=WebGL2RenderingContext.prototype,upload=p.bufferData,remove=p.deleteBuffer,sizes=new WeakMap<WebGLBuffer,number>();
    const stats={allocated:0,peak:0,losses:0};Object.assign(window,{__sessionBuffers:stats});
    document.addEventListener('webglcontextlost',()=>stats.losses++,true);
    p.bufferData=function(this:WebGL2RenderingContext,target:number,data:number|ArrayBufferView|ArrayBuffer|null,...rest:unknown[]){
      const buffer=this.getParameter(target===this.ARRAY_BUFFER?this.ARRAY_BUFFER_BINDING:target===this.ELEMENT_ARRAY_BUFFER?this.ELEMENT_ARRAY_BUFFER_BINDING:this.COPY_WRITE_BUFFER_BINDING) as WebGLBuffer|null;
      const size=typeof data==='number'?data:data?.byteLength??0;
      if(buffer){stats.allocated+=size-(sizes.get(buffer)??0);sizes.set(buffer,size);stats.peak=Math.max(stats.peak,stats.allocated);}
      return Reflect.apply(upload,this,[target,data,...rest]);
    } as typeof p.bufferData;
    p.deleteBuffer=function(buffer){if(buffer){stats.allocated-=sizes.get(buffer)??0;sizes.delete(buffer);}return remove.call(this,buffer);};
  });
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  const origin=await page.evaluate(()=>(window as any).__backbay.snapshot().state);
  await page.getByTestId('start-drive').tap();await expect(page.locator('#welcome')).toBeHidden();
  const session=await page.context().newCDPSession(page),samples:Record<string,any>[]=[];
  for(let cycle=0;cycle<10;cycle++){
    await page.getByTestId(cycle%2?'mode-bike':'mode-drive').tap();
    // Repeat the same local stretch by the library; test duration, not distance
    // into unrelated neighborhoods, matches the reported three-minute failure.
    await page.evaluate(async position=>{await (window as any).__backbay.travelTo(position.x,position.z,position.yaw);},origin);
    const box=(await page.getByRole('button',{name:'Accelerate',exact:true}).boundingBox())!;
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    try{await page.waitForTimeout(12000);}finally{await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    await page.keyboard.down('Space');await page.waitForTimeout(18000);await page.keyboard.up('Space');
    const sample=await page.evaluate(()=>{
      const s=(window as any).__backbay.snapshot();
      return{...(window as any).__sessionBuffers,geometries:s.geometries,textures:s.textures,colliders:s.physicsColliders,tiles:s.tiles.keys,mode:s.travelMode,paused:s.paused,x:s.state.x,z:s.state.z};
    });samples.push({second:(cycle+1)*30,...sample});
    expect(sample.losses).toBe(0);expect(sample.paused).toBe(false);
    expect(sample.mode).toBe(cycle%2?'bike':'drive');
    expect(Math.hypot(sample.x-origin.x,sample.z-origin.z)).toBeGreaterThan(10);
  }
  console.log('Library five-minute resources:',JSON.stringify(samples));
  await testInfo.attach('five-minute-resources',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
  // These are allocated vertex/index/instance bytes, not total browser or GPU memory.
  const steady=samples.slice(2).map(s=>s.allocated);
  expect(Math.max(...steady)-Math.min(...steady)).toBeLessThan(8*1024*1024);
  expect(Math.max(...samples.map(s=>s.peak))).toBeLessThan(200*1024*1024);
  expect(Math.max(...samples.slice(2).map(s=>s.geometries))-Math.min(...samples.slice(2).map(s=>s.geometries))).toBeLessThan(20);
  expect(errors).toEqual([]);await page.screenshot({path:testInfo.outputPath('library-five-minutes.png')});
});
