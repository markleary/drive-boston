import {test,expect} from '@playwright/test';
const ids=['15082-0-0','11255-0-0','14557-0-1','water-link-14557-0-0','14557-0-0','osm-29328400-0','osm-1329523286-0','osm-961263635-0'];
for(const reverse of [false,true])test(`Harvard Bridge full drive ${reverse?'Cambridge to Boston':'Boston to Cambridge'} and Smoots`,async({page},testInfo)=>{
 test.setTimeout(200000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
 const start=reverse?{x:-1461.049,z:-755.826,yaw:.3693,roadId:'osm-961263635-0'}:{x:-1229.994,z:-132.349,yaw:-2.781,roadId:'15082-0-0'};
 await page.addInitScript(s=>localStorage.setItem('backbay-drive-v1',JSON.stringify(s)),start);await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 const points=await page.evaluate(({ids,reverse})=>{
  const city=(window as any).__backbay.city,points:number[][]=[];
  ids.forEach((id,j)=>{const r=city.roads.find((r:any)=>r.id===id),p=points.at(-1),back=j===0||p&&Math.hypot(r.points.at(-1)[0]-p[0],r.points.at(-1)[1]-p[1])<.02;for(const q of back?[...r.points].reverse():r.points)if(!points.length||Math.hypot(q[0]-points.at(-1)![0],q[1]-points.at(-1)![1])>.001)points.push(q);});
  return reverse?points.reverse():points;
 },{ids,reverse});
 const held=new Set<string>(),key=async(name:string,down:boolean)=>{if(down&&!held.has(name)){await page.keyboard.down(name);held.add(name);}if(!down&&held.has(name)){await page.keyboard.up(name);held.delete(name);}};
 let cursor=1,lastProgress=Date.now(),car=(await snapshot()).state,arrived=false;const began=Date.now();
 try{while(Date.now()-began<120000){
  const previous=cursor;while(cursor<points.length-1&&Math.hypot(points[cursor][0]-car.x,points[cursor][1]-car.z)<4)cursor++;
  if(cursor>previous)lastProgress=Date.now();expect(Date.now()-lastProgress,'no seam may stop the car').toBeLessThan(15000);
  if(cursor===points.length-1&&Math.hypot(car.x-points[cursor][0],car.z-points[cursor][1])<2){arrived=true;break;}
  let target=cursor,look=0;while(target<points.length-1&&look<10){look+=Math.hypot(points[target+1][0]-points[target][0],points[target+1][1]-points[target][1]);target++;}
  const desired=Math.atan2(points[target][0]-car.x,points[target][1]-car.z),error=Math.atan2(Math.sin(desired-car.yaw),Math.cos(desired-car.yaw));
  await key('w',car.speed<10);await key('a',error>.025);await key('d',error<-.025);await page.waitForTimeout(80);car=(await snapshot()).state;
 }}finally{for(const name of [...held])await key(name,false);}
 expect(arrived).toBe(true);const harvard=(await snapshot()).bridges.harvard;expect(harvard.markers).toHaveLength(39);expect(harvard.ticks).toBe(366);expect(harvard.markers.at(-1).label).toContain('± 1 EAR');
 await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await snapshot()).state.speed)).toBeLessThan(.3);await page.keyboard.up('Space');await page.screenshot({path:testInfo.outputPath('harvard-complete-crossing.png')});expect(errors).toEqual([]);
});
