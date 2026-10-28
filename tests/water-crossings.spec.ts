import {test,expect} from '@playwright/test';

const routes=[
 {name:'Cambridge to Boston',ids:['osm-1228698551-0','14614-0-0','water-link-14614-0-0','14614-0-1'],start:{x:-373.101,z:-1289.584,yaw:1.4676,roadId:'osm-1228698551-0'}},
 {name:'Boston to Cambridge',ids:['14615-0-0','water-link-14615-0-0','14615-0-1','osm-1501638153-0','osm-1305820996-0'],start:{x:137.881,z:-1257.231,yaw:-1.686,roadId:'14615-0-0'}},
];
for(const route of routes)test(`Longfellow full approach drive: ${route.name}`,async({page},testInfo)=>{
 test.setTimeout(180000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
 await page.addInitScript(start=>localStorage.setItem('backbay-drive-v1',JSON.stringify(start)),route.start);
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 const points=await page.evaluate(ids=>{
  const city=(window as any).__backbay.city;
  return ids.flatMap(id=>{const road=city.roads.find((r:any)=>r.id===id);return road.points.flatMap((p:number[],i:number)=>{
   const q=road.points[i+1];if(!q)return[p];const count=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/3));
   return Array.from({length:count},(_,j)=>[p[0]+(q[0]-p[0])*j/count,p[1]+(q[1]-p[1])*j/count]);
  });});
 },route.ids);
 const held=new Set<string>(),key=async(name:string,down:boolean)=>{if(down&&!held.has(name)){await page.keyboard.down(name);held.add(name);}if(!down&&held.has(name)){await page.keyboard.up(name);held.delete(name);}};
 let cursor=1,lastProgress=Date.now(),car=(await snapshot()).state;const started=Date.now();let arrived=false;
 try{
  while(Date.now()-started<100000){
   const previous=cursor;while(cursor<points.length-1&&Math.hypot(points[cursor][0]-car.x,points[cursor][1]-car.z)<4)cursor++;
   if(cursor>previous)lastProgress=Date.now();expect(Date.now()-lastProgress,'car must clear every approach pier').toBeLessThan(15000);
   if(cursor===points.length-1&&Math.hypot(car.x-points[cursor][0],car.z-points[cursor][1])<2){arrived=true;break;}
   let target=cursor,look=0;while(target<points.length-1&&look<10){look+=Math.hypot(points[target+1][0]-points[target][0],points[target+1][1]-points[target][1]);target++;}
   const desired=Math.atan2(points[target][0]-car.x,points[target][1]-car.z),error=Math.atan2(Math.sin(desired-car.yaw),Math.cos(desired-car.yaw));
   await key('w',car.speed<9);await key('a',error>.025);await key('d',error<-.025);await page.waitForTimeout(80);car=(await snapshot()).state;
  }
 }finally{for(const name of [...held])await key(name,false);}
 expect(arrived,'complete the entire source approach, basin span, and opposite landing').toBe(true);
 await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await snapshot()).state.speed)).toBeLessThan(.3);await page.keyboard.up('Space');
 await page.screenshot({path:testInfo.outputPath('longfellow-complete-crossing.png')});
 expect((await snapshot()).bridges.longfellow.towers).toBe(4);
 await page.keyboard.press('2');const launch=(await snapshot()).flight;
 await page.keyboard.down('Space');try{await expect.poll(async()=>(await snapshot()).flight.y,{timeout:20000}).toBeGreaterThan(launch.y+30);}finally{await page.keyboard.up('Space');}
 await page.keyboard.press('c');await page.keyboard.press('c');await page.waitForTimeout(1200);
 await page.screenshot({path:testInfo.outputPath('longfellow-approach-water-and-towers.png')});
 expect(errors).toEqual([]);
});
