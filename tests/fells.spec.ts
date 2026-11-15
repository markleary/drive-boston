import { test, expect, type Page } from '@playwright/test';
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());

test('Fells woodland, trailhead and rideable soil paths render and recover locally',async({page},testInfo)=>{
  test.setTimeout(240000);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Daylight',exact:true}).click();await page.getByRole('button',{name:'Keep driving',exact:true}).click();
  await page.keyboard.press('2');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('bike');
  await page.evaluate(()=>(window as any).__backbay.travelTo(-416,-10307,-1.57));
  await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x+416,s.state.z+10307);},{timeout:90000}).toBeLessThan(2);
  await expect.poll(()=>page.evaluate(()=>{let count=0;(window as any).__backbay.scene.traverse((o:any)=>{if(/trailhead/i.test(o.name))count++;});return count;}),{timeout:30000}).toBeGreaterThan(0);
  await page.keyboard.press('c');
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await page.screenshot({path:testInfo.outputPath('fells-trailhead.png')});
  const scenery=await page.evaluate(()=>{
    const api=(window as any).__backbay,woods:any[]=[],roads:any[]=[],materials=new Set<string>();
    api.scene.traverse((o:any)=>{if(o.name==='Middlesex Fells woodland')woods.push(o.userData);if(o.name==='Fellsway East roadside')roads.push(o.userData);if(o.material?.name)materials.add(o.material.name);});
    return{woods,roads,materials:[...materials]};
  });
  expect(scenery.woods.reduce((n,w)=>n+w.trees,0)).toBeGreaterThan(100);
  expect(scenery.woods.reduce((n,w)=>n+w.shrubs,0)).toBeGreaterThan(100);
  expect(scenery.materials).toContain('Compacted earth with leaf-strewn edges');
  expect(scenery.materials).toContain('Dry oak leaves and forest humus');
  // An actual interior hiking trail, far from the road. The same R reset the
  // player uses must stay on this streamed trail, and throttle must move it.
  const start={x:-846.9645,z:-10057.006,yaw:2.6252384539644966};
  await page.evaluate(p=>(window as any).__backbay.travelTo(p.x,p.z,p.yaw),start);
  await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-start.x,s.state.z-start.z);},{timeout:90000}).toBeLessThan(2);
  await page.keyboard.press('r');
  await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-start.x,s.state.z-start.z);}).toBeLessThan(3);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await page.screenshot({path:testInfo.outputPath('fells-hiking-trail.png')});
  const before=(await snapshot(page)).state;
  await page.keyboard.down('w');
  try{await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-before.x,s.state.z-before.z);}).toBeGreaterThan(4);}finally{await page.keyboard.up('w');}
  await page.keyboard.down('Space');try{await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.4);}finally{await page.keyboard.up('Space');}
  await page.evaluate(()=>(window as any).__backbay.travelTo(-414,-10055,Math.PI));
  await expect.poll(async()=>{const s=await snapshot(page);return Math.abs(s.state.z+10055);},{timeout:90000}).toBeLessThan(2);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await page.screenshot({path:testInfo.outputPath('fellsway-east.png')});
  const final=await snapshot(page);expect(final.tiles.failed).toBe(0);expect(final.graphicsContext.losses).toBe(0);
  await testInfo.attach('fells-rendering.json',{body:JSON.stringify({scenery,fps:final.fps,drawCalls:final.drawCalls,triangles:final.triangles,tiles:final.tiles},null,2),contentType:'application/json'});
  console.log(JSON.stringify({project:testInfo.project.name,fps:final.fps,frameMs:final.frameMs,drawCalls:final.drawCalls,triangles:final.triangles,mobile:final.mobile,roads:scenery.roads}));
  expect(errors).toEqual([]);
});
