import {test,expect} from '@playwright/test';
import {carSteeringLimit} from '../src/physics/vehicle';

test('Bowker entrance drives across the Harvard approach and onto Storrow East',async({page,request},info)=>{
 test.setTimeout(180000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const city=await(await request.get('/data/city.json')).json(),sidecar=await(await request.get('/data/boston-highways.json')).json();
 const roads=[...city.roads,...sidecar.roads];
 const chain=(prefix:string)=>roads.filter(r=>r.id===prefix||new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>(Number(a.id.slice(prefix.length+1))||1)-(Number(b.id.slice(prefix.length+1))||1));
 const route=[roads.find(r=>r.id==='storrow-eb-entrance-bowker-4'),...chain('storrow-eb-entrance-massachusetts-avenue')].flatMap(r=>r.points);
 const [a,b]=route,start={x:a[0],z:a[1],yaw:Math.atan2(b[0]-a[0],b[1]-a[1]),roadId:'storrow-eb-entrance-bowker-4'};
 await page.addInitScript(s=>{
  localStorage.setItem('backbay-drive-v1',JSON.stringify(s));localStorage.setItem('boston-player-car-v1','tesla-model-3-performance');
  (window as any).__testSteer=0;
  Object.defineProperty(navigator,'getGamepads',{value:()=>[{
   connected:true,index:0,id:'Storrow regression controller',mapping:'standard',
   axes:[-(window as any).__testSteer,0,0,0],buttons:Array.from({length:17},()=>({value:0,pressed:false})),
  }]});
 },start);
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 await page.waitForTimeout(800);await page.screenshot({path:info.outputPath('bowker-entrance-open.png')});
 let cursor=1,lastProgress=Date.now(),arrived=false,car=(await snapshot()).state;
 const end=route.at(-1),previous=route.at(-2),ex=end[0]-previous[0],ez=end[1]-previous[1],span=Math.hypot(ex,ez);
 const began=Date.now();let held=false,maxSteer=0;
 try{while(Date.now()-began<100000){
  const before=cursor;
  while(cursor<route.length-1&&(Math.hypot(route[cursor][0]-car.x,route[cursor][1]-car.z)<3||Math.hypot(route[cursor+1][0]-car.x,route[cursor+1][1]-car.z)<Math.hypot(route[cursor][0]-car.x,route[cursor][1]-car.z)))cursor++;
  if(cursor>before)lastProgress=Date.now();
  // Crossing the merge's end section completes the drive even if traffic
  // carries the car past the exact final waypoint between snapshots.
  if(cursor===route.length-1&&(car.x-end[0])*ex+(car.z-end[1])*ez>=0&&Math.abs((car.x-end[0])*ez-(car.z-end[1])*ex)/span<5){arrived=true;break;}
  expect(Date.now()-lastProgress,`blocked at ${car.x}, ${car.z}`).toBeLessThan(30000);
  let target=cursor,look=0;while(target<route.length-1&&look<6){look+=Math.hypot(route[target+1][0]-route[target][0],route[target+1][1]-route[target][1]);target++;}
  const p=route[target],distance=Math.hypot(p[0]-car.x,p[1]-car.z),angle=Math.atan2(Math.sin(Math.atan2(p[0]-car.x,p[1]-car.z)-car.yaw),Math.cos(Math.atan2(p[0]-car.x,p[1]-car.z)-car.yaw));
  const steer=Math.max(-1,Math.min(1,Math.atan2(2*2.66*Math.sin(angle),Math.max(4,distance))/carSteeringLimit(car.speed)));
  // Undo the controller's radial dead zone for the requested analog input.
  await page.evaluate(v=>{(window as any).__testSteer=Math.sign(v)*(.16+.84*Math.abs(v));},steer);
  const throttle=car.speed<6;if(throttle!==held){await page.keyboard[throttle?'down':'up']('w');held=throttle;}
  await page.waitForTimeout(80);car=(await snapshot()).state;maxSteer=Math.max(maxSteer,Math.abs(car.steering));
 }}finally{await page.keyboard.up('w');await page.evaluate(()=>{(window as any).__testSteer=0;});}
 await info.attach('arrival',{body:JSON.stringify(await snapshot()),contentType:'application/json'});
 expect(arrived).toBe(true);expect(maxSteer).toBeGreaterThan(.01);await page.screenshot({path:info.outputPath('storrow-east-joined.png')});expect(errors).toEqual([]);
});
