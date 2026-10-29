import {test,expect} from '@playwright/test';
import {carSteeringLimit} from '../src/physics/vehicle.ts';
import type {Road} from '../src/types';

type Waypoint={x:number;z:number};
const main=['osm-961263635-0','osm-826552799-0','osm-961263634-0','osm-379698390-0','osm-86792411-0','osm-1267768719-0','osm-1264680796-0','osm-1417967613-0','osm-1264679770-0','osm-1321779880-0'];
function route(roads:Road[],ids:string[],offset=0){
 const points:Waypoint[]=[];
 for(const id of ids){const r=roads.find(r=>r.id===id)!;let p=r.points.map(([x,z])=>({x,z}));if(points.length&&Math.hypot(points.at(-1)!.x-p.at(-1)!.x,points.at(-1)!.z-p.at(-1)!.z)<.02)p.reverse();points.push(...(points.length?p.slice(1):p));}
 const shifted=points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],n=Math.hypot(b.x-a.x,b.z-a.z)||1;return{x:p.x-(b.z-a.z)/n*offset,z:p.z+(b.x-a.x)/n*offset};});
 const sampled:Waypoint[]=[];for(let i=1;i<shifted.length;i++){const a=shifted[i-1],b=shifted[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/3));for(let j=0;j<n;j++)sampled.push({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n});}sampled.push(shifted.at(-1)!);return sampled;
}

test('Cambridge Harvard Bridge junction has an uninterrupted upper route and two clear Memorial Drive underpasses',async({page,request},testInfo)=>{
 test.setTimeout(300000);const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
 const city=await(await request.get('/data/city.json')).json(),points=route(city.roads,main,2.2),[a,b]=points;
 await page.addInitScript(start=>{
  localStorage.setItem('backbay-drive-v1',JSON.stringify(start));(window as any).__junctionSteer=0;
  Object.defineProperty(navigator,'getGamepads',{value:()=>[{axes:[-(window as any).__junctionSteer],buttons:Array.from({length:8},()=>({value:0,pressed:false}))}]});
 },{...a,yaw:Math.atan2(b.x-a.x,b.z-a.z),roadId:main[0]});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 await page.locator('#open-settings').click();await page.locator('[data-light="day"]').click();await page.keyboard.press('Escape');
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 await page.screenshot({path:testInfo.outputPath('cambridge-upper-approach.png')});
 const drive=async(path:Waypoint[],lower=false)=>{
  let cursor=1,lastProgress=Date.now(),car=(await snapshot()).state,arrived=false,crossing=false,photographed=false;const began=Date.now();
  try{while(Date.now()-began<75000){
   const previous=cursor;while(cursor<path.length-1&&(Math.hypot(path[cursor].x-car.x,path[cursor].z-car.z)<4||Math.hypot(path[cursor+1].x-car.x,path[cursor+1].z-car.z)<Math.hypot(path[cursor].x-car.x,path[cursor].z-car.z)))cursor++;
   if(cursor>previous)lastProgress=Date.now();expect(Date.now()-lastProgress,'a slab or barrier must not block the junction').toBeLessThan(40000);
   const s=await snapshot();car=s.state;
   if(lower)expect(car.y-s.groundHeight,'the car must stay beneath the overpass').toBeLessThan(1.3);
   else if(car.z<-760&&car.z>-796){expect(car.y,'Massachusetts Avenue must remain above Memorial Drive').toBeGreaterThan(2.8);crossing=true;if(!photographed){await page.screenshot({path:testInfo.outputPath('cambridge-connected-junction.png')});photographed=true;}}
   if(cursor===path.length-1&&Math.hypot(car.x-path[cursor].x,car.z-path[cursor].z)<4){arrived=true;break;}
   let target=cursor,look=0;while(target<path.length-1&&look<9){look+=Math.hypot(path[target+1].x-path[target].x,path[target+1].z-path[target].z);target++;}
   const p=path[target],angle=Math.atan2(Math.sin(Math.atan2(p.x-car.x,p.z-car.z)-car.yaw),Math.cos(Math.atan2(p.x-car.x,p.z-car.z)-car.yaw)),steer=Math.atan2(2*2.66*Math.sin(angle),Math.max(4,Math.hypot(p.x-car.x,p.z-car.z)));
   await page.evaluate(value=>{(window as any).__junctionSteer=value;},Math.max(-1,Math.min(1,steer/carSteeringLimit(car.speed))));
   if(car.speed<7)await page.keyboard.down('w');else await page.keyboard.up('w');await page.waitForTimeout(80);
  }}finally{await page.keyboard.up('w');await page.evaluate(()=>{(window as any).__junctionSteer=0;});}
  expect(arrived).toBe(true);if(!lower)expect(crossing).toBe(true);
  await page.keyboard.down('Space');await page.waitForTimeout(600);await page.keyboard.up('Space');
 };
 await drive(points);
 for(const id of ['osm-138789021-0','osm-138789031-0']){
  const lower=route(city.roads,[id]).filter(p=>Math.hypot(p.x+1470,p.z+783)<70),[a,b]=lower;
  await page.evaluate(({a,b})=>(window as any).__backbay.travelTo(a.x,a.z,Math.atan2(b.x-a.x,b.z-a.z)),{a,b});
  await drive(lower,true);await page.screenshot({path:testInfo.outputPath(`${id}-underpass.png`)});
 }
 expect(errors).toEqual([]);
});
