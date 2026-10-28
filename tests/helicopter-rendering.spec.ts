import {test,expect} from '@playwright/test';

test.use({viewport:{width:1728,height:1117},deviceScaleFactor:2});

test('cockpit flight past Back Bay towers keeps the composited canvas intact',async({page},testInfo)=>{
  test.setTimeout(180000);const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');await page.getByTestId('start-drive').click({timeout:120000});
  await page.evaluate(async()=>{const game=(window as any).__backbay;await game.travelTo(680,-450,-2.2048);});
  await page.keyboard.press('3');
  await page.evaluate(()=>{(window as any).__backbay.snapshot().flight.y=180;});
  await page.keyboard.press('Escape');await page.locator('[data-camera="hood"]').click();await page.locator('#resume-drive').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().camera)).toBe('hood');
  // The flash exposes the page background. Make it unmistakable and inspect
  // browser-composited frames, without synchronously reading the WebGL canvas
  // (which changes GPU timing and missed this regression in the older test).
  await page.addStyleTag({content:':root{background:#ff00ff!important}'});
  const cdp=await page.context().newCDPSession(page);
  let frames=0,flashes=0,busy=false,firstFlash:string|undefined;
  const pending=new Set<Promise<void>>();
  cdp.on('Page.screencastFrame',({data,sessionId})=>{
    const work=(async()=>{
      await cdp.send('Page.screencastFrameAck',{sessionId});if(busy)return;busy=true;
      try{
        const exposed=await page.evaluate(async encoded=>{
          const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
          const image=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
          const canvas=new OffscreenCanvas(80,45),context=canvas.getContext('2d')!;
          context.drawImage(image,0,0,80,45);image.close();const pixels=context.getImageData(0,0,80,45).data;
          let magenta=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>230&&pixels[i+1]<30&&pixels[i+2]>230)magenta++;
          return magenta/3600;
        },data);
        frames++;if(exposed>.01){flashes++;firstFlash??=data;}
      }catch(error){errors.push(String(error));}finally{busy=false;}
    })();pending.add(work);void work.finally(()=>pending.delete(work));
  });
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:80,maxWidth:960,maxHeight:620,everyNthFrame:2});
  await page.keyboard.down('w');
  try{
    await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().flight.x),{timeout:45000}).toBeLessThan(-100);
  }finally{
    await page.keyboard.up('w');await cdp.send('Page.stopScreencast');await Promise.all(pending);await cdp.detach();
  }
  await page.screenshot({path:testInfo.outputPath('cockpit-after-towers.png')});
  if(firstFlash)await testInfo.attach('canvas-flash.svg',{body:`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="620"><image width="960" height="620" href="data:image/jpeg;base64,${firstFlash}"/></svg>`,contentType:'image/svg+xml'});
  await testInfo.attach('composited-frames.json',{body:JSON.stringify({frames,flashes}),contentType:'application/json'});
  expect(frames).toBeGreaterThan(60);expect(flashes).toBe(0);expect(errors).toEqual([]);
});
