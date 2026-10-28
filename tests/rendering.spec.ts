import {test,expect} from '@playwright/test';

test('detailed rendering survives reflection refreshes, lighting, resize and tile replacement',async({page},testInfo)=>{
  test.setTimeout(180000);const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:120000});await page.getByTestId('start-drive').click();
  // Sample after the game's RAF, before the browser discards the drawing
  // buffer. One readback per frame detects full-view white flashes; this is
  // intentionally a visual regression check, not an FPS benchmark.
  await page.evaluate(()=>{
    const gl=document.querySelector<HTMLCanvasElement>('#scene canvas')!.getContext('webgl2')!;
    const capture={frames:0,whiteFrames:0,nonBlackFrames:0,active:true};
    (window as any).__renderCapture=capture;
    function sample(){
      const pixels=new Uint8Array(gl.drawingBufferWidth*4);gl.readPixels(0,Math.floor(gl.drawingBufferHeight/2),gl.drawingBufferWidth,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let white=0,lit=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>235&&pixels[i+1]>235&&pixels[i+2]>235)white++;if(pixels[i]+pixels[i+1]+pixels[i+2]>12)lit++;}
      capture.frames++;if(white>gl.drawingBufferWidth*.6)capture.whiteFrames++;if(lit>gl.drawingBufferWidth*.1)capture.nonBlackFrames++;
      if(capture.active)requestAnimationFrame(sample);
    }requestAnimationFrame(sample);
  });
  const frames=async(n:number)=>{const start=await page.evaluate(()=>(window as any).__renderCapture.frames);await expect.poll(()=>page.evaluate(()=>(window as any).__renderCapture.frames),{timeout:30000}).toBeGreaterThanOrEqual(start+n);};
  await page.keyboard.down('w');try{await frames(100);}finally{await page.keyboard.up('w');}
  for(const light of ['night','day','golden']){
    await page.keyboard.press('Escape');await page.locator(`[data-light="${light}"]`).click();await page.locator('#resume-drive').click();await frames(30);
  }
  for(const quality of ['balanced','high']){
    await page.keyboard.press('Escape');await page.locator(`[data-quality="${quality}"]`).click();await page.locator('#resume-drive').click();await frames(25);
  }
  await page.setViewportSize({width:1600,height:1000});await frames(30);
  await page.keyboard.press('m');await page.getByRole('button',{name:'Show all Boston destinations'}).click();await page.locator('[data-destination="mission-hill"]').click();await expect(page.locator('#map-modal')).toBeHidden();await frames(60);
  await page.evaluate(()=>{const game=(window as any).__backbay;return game.travelTo(game.city.spawn.x,game.city.spawn.z,game.city.spawn.yaw);});await frames(60);
  // Put the coupe parallel to a surveyed wall, with room for its chassis but
  // less room than the normal chase boom. Orbit toward the wall to exercise
  // the beige bodywork clipping case without injecting render/physics objects.
  await page.evaluate(()=>{
    const game=(window as any).__backbay,spawn=game.city.spawn;
    const inside=(x:number,z:number,p:number[][])=>{let result=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>z)!==(p[j][1]>z)&&x<(p[j][0]-p[i][0])*(z-p[i][1])/(p[j][1]-p[i][1])+p[i][0])result=!result;return result;};
    const buildings=game.city.buildings.filter((b:any)=>b.height>12).sort((a:any,b:any)=>Math.hypot(a.center[0]-spawn.x,a.center[1]-spawn.z)-Math.hypot(b.center[0]-spawn.x,b.center[1]-spawn.z));
    for(const building of buildings.slice(0,20))for(let i=0;i<building.footprint.length;i++){
      const a=building.footprint[i],b=building.footprint[(i+1)%building.footprint.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<18)continue;
      for(const side of [-1,1]){
        const x=(a[0]+b[0])/2+side*dz/length*1.15,z=(a[1]+b[1])/2-side*dx/length*1.15;
        if(game.city.buildings.some((v:any)=>inside(x,z,v.footprint)))continue;
        return game.travelTo(x,z,Math.atan2(dx,dz));
      }
    }throw new Error('No clear wall fixture near spawn');
  });
  await page.keyboard.down('Space');
  const orbit=async(dx:number)=>{await page.mouse.move(800,500);await page.mouse.down();await page.mouse.move(800+dx,500,{steps:12});await page.mouse.up();await frames(40);};
  await orbit(314);
  if(await page.evaluate(()=>(window as any).__backbay.snapshot().carBodyVisible))await orbit(-628);
  await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().carBodyVisible)).toBe(false);
  await page.screenshot({path:testInfo.outputPath('camera-close-to-wall.png')});
  await page.keyboard.up('Space');
  await page.evaluate(()=>{const game=(window as any).__backbay;return game.travelTo(game.city.spawn.x,game.city.spawn.z,game.city.spawn.yaw);});
  await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().carBodyVisible)).toBe(true);
  await page.keyboard.press('3');await page.keyboard.down('Space');try{await frames(40);}finally{await page.keyboard.up('Space');}await page.keyboard.press('1');
  await page.screenshot({path:testInfo.outputPath('detailed-after-streaming.png')});
  const capture=await page.evaluate(()=>{const result=(window as any).__renderCapture;result.active=false;return result;});
  await testInfo.attach('frame-capture.json',{body:JSON.stringify(capture),contentType:'application/json'});
  expect(capture.frames).toBeGreaterThan(400);expect(capture.nonBlackFrames).toBeGreaterThan(350);expect(capture.whiteFrames).toBe(0);expect(errors).toEqual([]);
});
