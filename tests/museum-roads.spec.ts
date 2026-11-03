import {test,expect} from '@playwright/test';

test('Museum roads: ramp approaches, dam seam, junction markings and streaming return',async({page},testInfo)=>{
 test.setTimeout(180000);await page.setViewportSize({width:1600,height:1000});const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
 await page.locator('#open-settings').click();await page.locator('[data-light="day"]').click();await page.locator('#resume-drive').click();
 for(const p of [
  {name:'ramps',x:534.2,y:46.93,z:-1826.49,yaw:1.6,pitch:.45},
  {name:'dam',x:401.46,y:57.58,z:-1945.97,yaw:-2.0845,pitch:.9},
  {name:'junction',x:179.97,y:68.01,z:-2116.46,yaw:-2.0845,pitch:1},
 ]){
  await page.keyboard.press('1');await page.keyboard.press('3');await page.keyboard.press('c');
  await page.evaluate(async p=>{await (window as any).__backbay.flyTo(p.x,p.y,p.z,p.yaw);},p);
  await page.mouse.move(800,300);await page.mouse.down();await page.mouse.move(800,300+(p.pitch-.3)/.005,{steps:8});await page.mouse.up();
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(700);
  await page.screenshot({path:testInfo.outputPath(`museum-${p.name}.png`)});
 }
 await page.evaluate(async()=>{const app=(window as any).__backbay;await app.flyTo(-2500,100,900);await app.flyTo(534.2,46.93,-1826.49,1.6);});
 const s=await page.evaluate(()=>{const app=(window as any).__backbay;return{tiles:app.snapshot().tiles,approaches:app.city.roads.filter((r:any)=>r.id.startsWith('museum-storrow')).length};});
 expect(s.tiles.failed).toBe(0);expect(s.approaches).toBe(3);expect(errors).toEqual([]);
});
