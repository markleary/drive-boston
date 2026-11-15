import {test,expect} from '@playwright/test';
const snapshot=(page:any)=>page.evaluate(()=>(window as any).__backbay.snapshot());
test('Moving Truck strikes Longfellow, gets Storrowed once, and R repairs beyond the bridge',async({page},info)=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('boston-player-car-v1','moving-truck');localStorage.setItem('backbay-drive-v1',JSON.stringify({x:194.9,z:-1208,yaw:3.075,roadId:'13129-0-0'}));});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 await expect.poll(async()=>(await snapshot(page)).audio.engineProfile).toBe('moving-truck');
 await expect.poll(async()=>(await snapshot(page)).audio.loadedCount).toBe(35);
 await page.waitForTimeout(600); // Let the welcome-screen fade finish before the reference screenshot.
 await page.screenshot({path:info.outputPath('moving-truck-longfellow-before.png')});
 await page.keyboard.down('s');try{await expect.poll(async()=>(await snapshot(page)).state.speed).toBeLessThan(-.5);await expect.poll(async()=>(await snapshot(page)).audio.reverseAlarm).toBe(true);}finally{await page.keyboard.up('s');}
 await page.keyboard.down('w');try{await expect.poll(async()=>(await snapshot(page)).audio.reverseAlarm).toBe(false);await expect.poll(async()=>(await snapshot(page)).state.storrowed,{timeout:40000}).toBe(true);}finally{await page.keyboard.up('w');await info.attach('truck-state',{body:JSON.stringify(await snapshot(page)),contentType:'application/json'});}
 await expect(page.locator('#storrow-toast')).toHaveText('You Got Storrowed!');
 await expect(page.locator('#storrow-toast')).toHaveClass(/visible/);
 await expect(page.locator('#storrow-recovery')).toBeVisible();
 await expect.poll(async()=>(await snapshot(page)).audio.storrowCount).toBe(1);
 await page.waitForTimeout(500);const stuck=await snapshot(page);
 expect(stuck.state.storrowDamage).toBeGreaterThan(.3);expect(Math.abs(stuck.state.speed)).toBeLessThan(.1);
 await page.screenshot({path:info.outputPath('moving-truck-storrowed.png')});
 for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(viewport);
  const banner=await page.locator('#storrow-toast').boundingBox(),repair=await page.locator('#storrow-recovery').boundingBox();
  expect(banner!.y).toBeGreaterThan(viewport.height*.25);expect(banner!.y+banner!.height).toBeLessThan(repair!.y);
  expect(banner!.x).toBeGreaterThanOrEqual(0);expect(banner!.x+banner!.width).toBeLessThanOrEqual(viewport.width);
  expect(repair!.x).toBeGreaterThanOrEqual(0);expect(repair!.x+repair!.width).toBeLessThanOrEqual(viewport.width);
  const style=await page.locator('#storrow-toast').evaluate(el=>({color:getComputedStyle(el).color,size:parseFloat(getComputedStyle(el).fontSize)}));
  expect(style.color).toBe('rgb(240, 68, 56)');expect(style.size).toBeGreaterThanOrEqual(32);
  if(viewport.width===390)await page.screenshot({path:info.outputPath('moving-truck-storrowed-portrait.png')});
 }
 await page.setViewportSize({width:1280,height:800});
 await page.keyboard.down('s');await page.waitForTimeout(1200);await page.keyboard.up('s');
 const held=await snapshot(page);expect(Math.hypot(held.state.x-stuck.state.x,held.state.z-stuck.state.z)).toBeLessThan(.1);expect(held.audio.storrowCount).toBe(1);expect(held.audio.reverseAlarm).toBe(false);
 await page.keyboard.press('r');await expect.poll(async()=>(await snapshot(page)).state.storrowed).toBe(false);
 const repaired=await snapshot(page);expect(repaired.state.storrowDamage).toBe(0);expect(repaired.state.z).toBeLessThan(-1264);await expect(page.locator('#storrow-recovery')).toBeHidden();
 await page.screenshot({path:info.outputPath('moving-truck-repaired.png')});
 expect(repaired.audio.failed).toEqual([]);expect(errors).toEqual([]);
});
