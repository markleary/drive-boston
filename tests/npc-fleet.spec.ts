import {test,expect} from '@playwright/test';

test('approved fleet keeps unique matching MA registrations, paint, and both LODs through lighting and travel',async({page},testInfo)=>{
  test.setTimeout(180000);const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:120000});await page.getByTestId('start-drive').click();
  const initial=await page.evaluate(()=>{const s=(window as any).__backbay.snapshot();return {traffic:s.traffic,parked:s.parkedVehicles};});
  expect(initial.traffic).toHaveLength(77);expect(new Set(initial.traffic.map((v:any)=>v.type)).size).toBe(5);
  const registrations=[...initial.traffic,...initial.parked].map((v:any)=>v.registration);
  expect(new Set(registrations).size).toBe(registrations.length);for(const number of registrations)expect(number).toMatch(/^[1-9][A-Z]{2} \d{3}$/);
  const atlas=await page.evaluate(()=>{
    const group=(window as any).__backbay.scene.getObjectByName('AmbientTraffic'),plate=group.children.find((m:any)=>m.name==='NPC near registration'),paint=group.children.find((m:any)=>m.name==='NPC near paint');
    return {width:plate.material.map.image.width,height:plate.material.map.image.height,plateCount:plate.instanceCount,paintCount:paint.instanceCount,atlas:plate.material.map.image.toDataURL()};
  });
  expect(atlas.plateCount).toBe(77);expect(atlas.paintCount).toBe(77);expect(atlas.width).toBe(2048);expect(atlas.height).toBe(1280);
  const plateView=await page.context().newPage();await plateView.setContent(`<img src="${atlas.atlas}">`);await testInfo.attach('massachusetts-registration-atlas.png',{body:await plateView.locator('img').screenshot(),contentType:'image/png'});await plateView.close();
  for(const light of ['night','day','golden']){await page.keyboard.press('Escape');await page.locator(`[data-light="${light}"]`).click();await page.locator('#resume-drive').click();await page.waitForTimeout(250);}
  await page.evaluate(()=>{const game=(window as any).__backbay;const p=game.city.landmarks.find((p:any)=>p.id==='mission-hill').driveStart;return game.travelTo(p.x,p.z,p.yaw);});
  const after=await page.evaluate(()=>(window as any).__backbay.snapshot());
  expect(after.traffic.map((v:any)=>v.registration)).toEqual(initial.traffic.map((v:any)=>v.registration));expect(after.traffic.map((v:any)=>v.color)).toEqual(initial.traffic.map((v:any)=>v.color));
  expect(after.population.traffic.target).toBe(22);
  await page.screenshot({path:testInfo.outputPath('new-fleet-mission-hill.png')});expect(errors).toEqual([]);
});
