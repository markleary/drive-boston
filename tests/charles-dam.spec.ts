import {test,expect} from '@playwright/test';

// The reported spot on Charles River Dam Road (road 10963-0-0 at 514, -1863, heading for Cambridge): the roadway was a row of
// bridge decks with raised edges. It is one graded street now, beside the Lechmere Viaduct and the Museum of Science.
test('Charles River Dam Road: a smooth drive from Leverett Circle to Cambridge past the viaduct and the Museum',async({page},testInfo)=>{
 test.setTimeout(240000);await page.setViewportSize({width:1440,height:860});const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{value:()=>[],configurable:true}));
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
 await page.locator('#open-settings').click();await page.locator('[data-light="day"]').click();await page.locator('#resume-drive').click();
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 await page.evaluate(()=>(window as any).__backbay.travelTo(514.07,-1862.63,-1.8561));
 await expect.poll(async()=>(await snapshot()).tiles.keys.includes('0_-2'),{timeout:90000}).toBe(true);
 const roads=await page.evaluate(()=>(window as any).__backbay.city.roads.filter((r:any)=>['10963-0-0','7515-0-0','10965-0-0','14555-0-0','14556-0-0','10964-0-0','10961-0-0','10962-0-0'].includes(r.id)).map((r:any)=>({id:r.id,name:r.name,deck:!!r.elevations})));
 expect(roads.length).toBe(8);for(const road of roads){expect(road.deck,road.id).toBe(false);expect(road.name).toBe('Charles River Dam Road');}
 const structures=(await snapshot()).bridges;expect(structures.lechmere.arches).toBe(10);expect(structures.lechmere.spans).toBe(12);expect(structures.museumOfScience.turbines).toBe(6);
 await page.waitForTimeout(1500);await page.screenshot({path:testInfo.outputPath('dam-road-reported-view.png')});
 // Drive the Cambridge-bound roadway to the Cambridge line: no bump lifts the car or stops it.
 const points=[[511.8,-1867.6],[467.4,-1895.5],[412.5,-1931.7],[336.6,-1986.6],[311,-2002]];
 const held=new Set<string>(),key=async(name:string,down:boolean)=>{if(down&&!held.has(name)){await page.keyboard.down(name);held.add(name);}if(!down&&held.has(name)){await page.keyboard.up(name);held.delete(name);}};
 let cursor=0,car=(await snapshot()).state,progress=Date.now(),arrived=false,pitch=0,roll=0;const started=Date.now();
 try{
  while(Date.now()-started<120000){
   const before=cursor;while(cursor<points.length-1&&Math.hypot(points[cursor][0]-car.x,points[cursor][1]-car.z)<8)cursor++;
   if(cursor>before)progress=Date.now();expect(Date.now()-progress,`the car is held up at ${car.x.toFixed(1)}, ${car.z.toFixed(1)}`).toBeLessThan(25000);
   if(cursor===points.length-1&&Math.hypot(car.x-points[cursor][0],car.z-points[cursor][1])<8){arrived=true;break;}
   const desired=Math.atan2(points[cursor][0]-car.x,points[cursor][1]-car.z),error=Math.atan2(Math.sin(desired-car.yaw),Math.cos(desired-car.yaw));
   await key('w',car.speed<11);await key('a',error>.03);await key('d',error<-.03);await page.waitForTimeout(80);car=(await snapshot()).state;
   pitch=Math.max(pitch,Math.abs(car.rotation.x));roll=Math.max(roll,Math.abs(car.rotation.z));
  }
 }finally{for(const name of [...held])await key(name,false);}
 expect(arrived,'the car reaches the Cambridge line').toBe(true);expect(pitch,'no slab edge pitches the car').toBeLessThan(.12);expect(roll).toBeLessThan(.12);
 await page.screenshot({path:testInfo.outputPath('dam-road-cambridge-end.png')});
 // From the air: the viaduct beside the road and the Museum beyond it.
 await page.keyboard.press('3');await page.evaluate(()=>(window as any).__backbay.flyTo(470,42,-1985,-.35));
 await page.mouse.move(720,300);await page.mouse.down();await page.mouse.move(720,420,{steps:8});await page.mouse.up();await page.waitForTimeout(2500);
 await page.screenshot({path:testInfo.outputPath('dam-viaduct-and-museum.png')});
 expect((await snapshot()).tiles.failed).toBe(0);expect(errors).toEqual([]);
});
