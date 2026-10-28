import {test,expect} from '@playwright/test';
import {harvardBridgeSpine} from '../src/simulation/harvard-bridge';
import {deckEdge} from '../src/simulation/road-surfaces';
const ids=['15082-0-0','11255-0-0','14557-0-1','water-link-14557-0-0','14557-0-0','osm-29328400-0','osm-1329523286-0','osm-961263635-0'];
for(const reverse of [false,true])test(`Harvard Bridge full drive ${reverse?'Cambridge to Boston':'Boston to Cambridge'} and Smoots`,async({page,request},testInfo)=>{
 test.setTimeout(200000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
 const city=await(await request.get('/data/city.json')).json(),spine=harvardBridgeSpine(city)!;
 const points=spine.road.points.map((_,i)=>deckEdge(spine.road,i,reverse?-1:1,spine.road.deckWidths![i]*.18));if(reverse)points.reverse();
 const start={x:points[0][0],z:points[0][1],yaw:Math.atan2(points[1][0]-points[0][0],points[1][1]-points[0][1]),roadId:reverse?ids.at(-1):ids[0]};
 // Exercise the supported analog gamepad steering input; full-lock keyboard
 // corrections oscillate on a narrow lane when WebGL runs at a low frame rate.
 await page.addInitScript(s=>{
  localStorage.setItem('backbay-drive-v1',JSON.stringify(s));
  (window as any).__testSteer=0;
  Object.defineProperty(navigator,'getGamepads',{value:()=>[{axes:[-(window as any).__testSteer],buttons:Array.from({length:8},()=>({value:0,pressed:false}))}]});
 },start);
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 const waypointRadius=4; // Allow an occupied shore junction without requiring the car's centre on its exact endpoint.
 const held=new Set<string>(),key=async(name:string,down:boolean)=>{if(down&&!held.has(name)){await page.keyboard.down(name);held.add(name);}if(!down&&held.has(name)){await page.keyboard.up(name);held.delete(name);}};
 let cursor=1,lastProgress=Date.now(),car=(await snapshot()).state,arrived=false;const began=Date.now();
 try{while(Date.now()-began<120000){
  const previous=cursor;while(cursor<points.length-1&&Math.hypot(points[cursor][0]-car.x,points[cursor][1]-car.z)<waypointRadius)cursor++;
  if(cursor>previous)lastProgress=Date.now();expect(Date.now()-lastProgress,'no seam may stop the car').toBeLessThan(15000);
  if(cursor===points.length-1&&Math.hypot(car.x-points[cursor][0],car.z-points[cursor][1])<waypointRadius){arrived=true;break;}
  let target=cursor,look=0;while(target<points.length-1&&look<10){look+=Math.hypot(points[target+1][0]-points[target][0],points[target+1][1]-points[target][1]);target++;}
  const desired=Math.atan2(points[target][0]-car.x,points[target][1]-car.z),error=Math.atan2(Math.sin(desired-car.yaw),Math.cos(desired-car.yaw));
  const steer=Math.atan2(2*2.66*Math.sin(error),Math.max(4,Math.hypot(points[target][0]-car.x,points[target][1]-car.z))),limit=Math.min(.48,Math.atan(7.8*2.66/(car.speed*car.speed+16)));
  await page.evaluate(value=>{(window as any).__testSteer=value;},Math.max(-1,Math.min(1,steer/limit)));
  await key('w',car.speed<8);await page.waitForTimeout(80);car=(await snapshot()).state;
 }}finally{await page.evaluate(()=>{(window as any).__testSteer=0;});for(const name of [...held])await key(name,false);}
 expect(arrived).toBe(true);const harvard=(await snapshot()).bridges.harvard;expect(harvard.markers).toHaveLength(39);expect(harvard.ticks).toBe(366);expect(harvard.markers.at(-1).label).toContain('± 1 EAR');
 await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await snapshot()).state.speed)).toBeLessThan(.3);await page.keyboard.up('Space');await page.screenshot({path:testInfo.outputPath('harvard-complete-crossing.png')});expect(errors).toEqual([]);
});
