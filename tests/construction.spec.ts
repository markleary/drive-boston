import {test,expect} from '@playwright/test';

for(const mobile of [false,true])test(`construction sites render and stream safely on ${mobile?'mobile':'desktop'}`,async({browser},testInfo)=>{
  test.setTimeout(180000);
  const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage(),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|Shader Error/.test(message.text()))errors.push(message.text());});
  // Reproduce one session's random layout on both device profiles.
  await page.addInitScript(()=>{
    const random=crypto.getRandomValues.bind(crypto);
    (crypto as any).getRandomValues=(array:any)=>{const result=random(array);if(array instanceof Uint32Array&&array.length===1)array[0]=12345;return result;};
  });
  try{
    await page.goto('http://127.0.0.1:4173/');
    await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:120000});await page.getByTestId('start-drive').click();
    const sites=await page.evaluate(()=>{
      const game=(window as any).__backbay;
      return game.snapshot().construction.sites.map((site:any)=>({...site,distance:Math.hypot(site.x-game.city.spawn.x,site.z-game.city.spawn.z)})).sort((a:any,b:any)=>a.distance-b.distance);
    });
    expect(sites.length).toBeGreaterThan(25);
    const site=sites[0];
    const arrive=()=>page.evaluate(async site=>{
      const game=(window as any).__backbay,along=-15,offset=site.openOffset;
      return game.travelTo(site.x+Math.sin(site.yaw)*along-Math.cos(site.yaw)*offset,site.z+Math.cos(site.yaw)*along+Math.sin(site.yaw)*offset,site.yaw,site.roadId);
    },site);
    await arrive();
    await expect.poll(()=>page.evaluate(id=>(window as any).__backbay.snapshot().construction.sites.find((s:any)=>s.id===id)?.active,site.id)).toBe(true);
    const resident=await page.evaluate(id=>{
      const game=(window as any).__backbay,group=game.scene.getObjectByName(id),names:string[]=[];
      group.traverse((object:any)=>names.push(object.name));
      return{names,colliders:game.construction.colliders.size,snapshot:game.snapshot().construction};
    },site.id);
    expect(resident.names.some(name=>/dump truck|excavator/i.test(name))).toBe(true);
    expect(resident.snapshot.cones).toBeGreaterThan(15);expect(resident.snapshot.active).toBeLessThanOrEqual(8);expect(resident.colliders).toBeGreaterThan(30);
    await page.keyboard.press('Escape');await page.locator('[data-light="day"]').click();await page.locator('#resume-drive').click();
    await page.waitForTimeout(600);await page.screenshot({path:testInfo.outputPath(`construction-${mobile?'mobile':'desktop'}.png`)});
    await page.keyboard.press('Escape');await page.locator('[data-light="night"]').click();await page.locator('#resume-drive').click();
    await page.waitForTimeout(400);await page.screenshot({path:testInfo.outputPath(`construction-night-${mobile?'mobile':'desktop'}.png`)});
    // A distant trip must remove every collider and mesh for the visited site.
    await page.evaluate(async()=>{const game=(window as any).__backbay,p=game.city.landmarks.find((l:any)=>l.id==='logan-airport').driveStart;return game.travelTo(p.x,p.z,p.yaw);});
    await expect.poll(()=>page.evaluate(id=>!!(window as any).__backbay.scene.getObjectByName(id),site.id)).toBe(false);
    await arrive();
    await expect.poll(()=>page.evaluate(id=>{
      const game=(window as any).__backbay;
      return game.scene.getObjectByName('RoadConstruction').children.filter((s:any)=>s.name===id).length;
    },site.id)).toBe(1);
    const final=await page.evaluate(()=>(window as any).__backbay.snapshot().construction);
    expect(final.active).toBeLessThanOrEqual(8);expect(final.cones).toBe(resident.snapshot.cones);
    expect(errors).toEqual([]);
  }finally{await context.close();}
});
