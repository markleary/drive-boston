import {test,expect} from '@playwright/test';

test('approved fleet keeps unique matching MA registrations, paint, and both LODs through lighting and travel',async({page},testInfo)=>{
  test.setTimeout(180000);const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:120000});await page.getByTestId('start-drive').click();
  const initial=await page.evaluate(()=>{const s=(window as any).__backbay.snapshot();return {traffic:s.traffic,parked:s.parkedVehicles,tileSize:s.tiles.tileSize};});
  expect(initial.traffic).toHaveLength(77);expect(new Set(initial.traffic.map((v:any)=>v.type)).size).toBe(5);
  const registrations=[...initial.traffic,...initial.parked].map((v:any)=>v.registration);
  expect(new Set(registrations).size).toBe(registrations.length);for(const number of registrations)expect(number).toMatch(/^[1-9][A-Z]{2} \d{3}$/);
  const atlas=await page.evaluate(()=>{
    const group=(window as any).__backbay.scene.getObjectByName('AmbientTraffic'),plate=group.children.find((m:any)=>m.name==='NPC near registration'),paint=group.children.find((m:any)=>m.name==='NPC near paint');
    return {width:plate.material.map.image.width,height:plate.material.map.image.height,plateCount:plate.instanceCount,paintCount:paint.instanceCount,atlas:plate.material.map.image.toDataURL()};
  });
  expect(atlas.plateCount).toBe(77);expect(atlas.paintCount).toBe(77);expect(atlas.width).toBe(2048);expect(atlas.height).toBe(1280);
  const wheelPhases=()=>page.evaluate(()=>{
    const g=(window as any).__backbay,s=g.snapshot(),group=g.scene.getObjectByName('AmbientTraffic'),body=group.children.find((m:any)=>m.name==='NPC near paint'),rubber=group.children.find((m:any)=>m.name==='NPC near rubber');
    return s.traffic.map((v:any,i:number)=>{
      const b=body.matrixWorld.clone(),w=b.clone();body.getMatrixAt(body.userData.npcInstances[i][0],b);rubber.getMatrixAt(rubber.userData.npcInstances[i][3],w);
      const dot=(column:number)=>b.elements[column*4]*w.elements[4]+b.elements[column*4+1]*w.elements[5]+b.elements[column*4+2]*w.elements[6];
      return{type:v.type,speed:v.speed,angle:Math.atan2(dot(2),dot(1))};
    });
  });
  await expect.poll(async()=>new Set((await wheelPhases()).filter((v:any)=>v.speed>2).map((v:any)=>v.type)).size).toBe(5);
  const wheelsBefore=await wheelPhases();await page.waitForTimeout(200);const wheelsAfter=await wheelPhases();
  const rolling=new Set(wheelsBefore.flatMap((v:any,i:number)=>v.speed>2&&Math.abs(Math.atan2(Math.sin(wheelsAfter[i].angle-v.angle),Math.cos(wheelsAfter[i].angle-v.angle)))>.04?[v.type]:[]));expect(rolling.size).toBe(5);
  await page.keyboard.press('Escape');const pausedWheels=await wheelPhases();await page.waitForTimeout(200);expect(await wheelPhases()).toEqual(pausedWheels);await page.locator('#resume-drive').click();
  const plateView=await page.context().newPage();await plateView.setContent(`<img src="${atlas.atlas}">`);await testInfo.attach('massachusetts-registration-atlas.png',{body:await plateView.locator('img').screenshot(),contentType:'image/png'});await plateView.close();
  for(const light of ['night','day','golden']){await page.keyboard.press('Escape');await page.locator(`[data-light="${light}"]`).click();await page.locator('#resume-drive').click();await page.waitForTimeout(250);}
  await page.evaluate(()=>{const game=(window as any).__backbay;const p=game.city.landmarks.find((p:any)=>p.id==='mission-hill').driveStart;return game.travelTo(p.x,p.z,p.yaw);});
  const after=await page.evaluate(()=>(window as any).__backbay.snapshot());
  expect(after.traffic.map((v:any)=>v.registration)).toEqual(initial.traffic.map((v:any)=>v.registration));expect(after.traffic.map((v:any)=>v.color)).toEqual(initial.traffic.map((v:any)=>v.color));
  expect(after.population.traffic.target).toBe(22);
  await page.screenshot({path:testInfo.outputPath('new-fleet-mission-hill.png')});
  // A distant trip must actually unload every supporting spawn-area tile.
  const parkedTiles=initial.parked.map((v:any)=>`${Math.floor(v.x/initial.tileSize)}_${Math.floor(v.z/initial.tileSize)}`);
  await page.evaluate(()=>{const game=(window as any).__backbay,p=game.city.landmarks.find((p:any)=>p.id==='logan-airport').driveStart;return game.travelTo(p.x,p.z,p.yaw);});
  await expect.poll(()=>page.evaluate((keys:string[])=>{const loaded=(window as any).__backbay.snapshot().tiles.keys;return keys.every(key=>!loaded.includes(key));},parkedTiles),{timeout:30000}).toBe(true);
  await page.waitForTimeout(2000);
  const checkParked=async()=>{
    const parked=await page.evaluate(()=>(window as any).__backbay.snapshot().parkedVehicles);
    expect(parked.map((v:any)=>v.registration)).toEqual(initial.parked.map((v:any)=>v.registration));
    for(const [i,v] of parked.entries())expect(Math.abs(v.y-initial.parked[i].y)).toBeLessThan(.3);
  };
  await checkParked();
  await page.evaluate(()=>{const game=(window as any).__backbay,p=game.city.spawn;return game.travelTo(p.x,p.z,p.yaw);});
  await page.waitForTimeout(1000);await checkParked();
  expect(errors).toEqual([]);
});
