import {test,expect,type Page} from '@playwright/test';

type Road={id:string;name:string;points:[number,number][];elevations?:number[];deckWidths?:number[];width:number;closed?:'start'|'end';surveyDeck?:string;kind?:string};
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const streamed=(page:Page)=>expect.poll(()=>page.evaluate(()=>{
 const api=(window as any).__backbay,s=api.snapshot(),p=s.travelMode==='helicopter'?s.flight:s.state,key=`${Math.floor(p.x/1000)}_${Math.floor(p.z/1000)}`;
 return !api.city.tiles.keys.includes(key)||s.tiles.keys.includes(key);
}),{timeout:60000}).toBe(true);
const length=(r:Road)=>r.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-r.points[i][0],p[1]-r.points[i][1]),0);
/** The point `d` metres along a deck record, its deck height and the heading a car takes along it. */
function along(r:Road,d:number){
 let left=d;
 for(let i=1;i<r.points.length;i++){
  const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],L=Math.hypot(bx-ax,bz-az);
  if(left<=L||i===r.points.length-1){const t=Math.min(1,left/L),e=r.elevations!;return {x:ax+(bx-ax)*t,z:az+(bz-az)*t,y:e[i-1]+(e[i]-e[i-1])*t,yaw:Math.atan2(bx-ax,bz-az)};}
  left-=L;
 }
 throw new Error(`${r.id} has no length`);
}
/** Nearest point of any of `roads` to (x, z): the road, the distance to its centreline, the deck height there and the distance along it. */
function nearest(roads:Road[],x:number,z:number){
 let best={road:roads[0],distance:Infinity,y:0,at:0};
 for(const r of roads){
  let run=0;
  for(let i=1;i<r.points.length;i++){
   const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/L2)),d=Math.hypot(x-ax-dx*t,z-az-dz*t);
   if(d<best.distance)best={road:r,distance:d,y:r.elevations![i-1]+(r.elevations![i]-r.elevations![i-1])*t,at:run+Math.sqrt(L2)*t};
   run+=Math.sqrt(L2);
  }
 }
 return best;
}
/** A helicopter view of a point from `distance` metres off to the side of the direction (dx, dz), `rise` metres above it. */
const sideView=(name:string,x:number,y:number,z:number,dx:number,dz:number,distance:number,rise:number,pitch:number)=>{
 const l=Math.hypot(dx,dz)||1,cx=x-dz/l*distance,cz=z+dx/l*distance;return {name,x:cx,y:y+rise,z:cz,yaw:Math.atan2(x-cx,z-cz),pitch};
};

test('Interstate 93: the car rides its decks to the barriers at the Stoneham line, among highway traffic, and GPS takes it',async({page,request},testInfo)=>{
 test.setTimeout(900000);await page.setViewportSize({width:1600,height:900});
 const city=await(await request.get('/data/city.json')).json(),roads:Road[]=city.roads;
 const decks=roads.filter(r=>r.id.startsWith('i93-')&&!r.surveyDeck),carriageway=(dir:'nb'|'sb')=>decks.filter(r=>new RegExp(`^i93-${dir}-\\d+$`).test(r.id));
 expect(carriageway('nb').length).toBeGreaterThan(20);expect(carriageway('sb').length).toBeGreaterThan(20);
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const place=async(r:Road,d:number)=>{const p=along(r,d);await page.evaluate(([x,z,yaw,id])=>(window as any).__backbay.travelTo(x,z,yaw,id),[p.x,p.z,p.yaw,r.id] as const);await streamed(page);return p;};
 const drive=async(metres:number,from:{x:number,z:number})=>{
  await page.keyboard.down('w');
  try{await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-from.x,s.state.z-from.z);},{timeout:60000}).toBeGreaterThan(metres);}finally{await page.keyboard.up('w');}
 };

 // Northbound through Medford: the car rides the deck and the HUD names the interstate.
 const medford=carriageway('nb').filter(r=>r.name.includes('Medford')).sort((a,b)=>length(b)-length(a))[0];
 const start=await place(medford,length(medford)/2);
 let s=await snapshot(page);expect(s.tiles.failed).toBe(0);expect(Math.abs(s.state.y-start.y)).toBeLessThan(1.5);
 await expect(page.locator('#location-label')).toContainText('I-93 North');
 await drive(80,start);
 s=await snapshot(page);let on=nearest(decks,s.state.x,s.state.z);
 expect(on.distance).toBeLessThan(10);expect(Math.abs(s.state.y-on.y)).toBeLessThan(1.5);
 // The interstate carries the densest traffic, and nobody walks on it.
 await expect.poll(async()=>{const t=(await snapshot(page)).traffic;return t.filter((a:any)=>a.motorway>0&&Math.hypot(a.x-s.state.x,a.z-s.state.z)<600).length;},{timeout:60000}).toBeGreaterThanOrEqual(8);
 s=await snapshot(page);
 const highway=s.traffic.filter((a:any)=>a.motorway>0&&!a.parked&&Math.hypot(a.x-s.state.x,a.z-s.state.z)<600);
 for(const a of highway){const n=nearest(decks,a.x,a.z);expect(n.distance<12&&Math.abs(a.y-n.y)<3,`a highway car rides ${n.road.id}`).toBe(true);}
 for(const w of s.walkers){const n=nearest(decks,w.x,w.z);expect(n.distance>n.road.width/2+1||Math.abs(w.y-n.y)>2.5,`a pedestrian walks on ${n.road.id}`).toBe(true);}
 await page.screenshot({path:testInfo.outputPath('medford-northbound.png')});

 // The northbound carriageway ends at a row of concrete barriers the car cannot pass.
 const end=decks.find(r=>r.closed==='end')!,endLength=length(end),before=carriageway('nb').find(r=>r.points.at(-1)![0]===end.points[0][0]&&r.points.at(-1)![1]===end.points[0][1])!;
 await place(before,Math.max(0,length(before)-(110-endLength)));
 await page.screenshot({path:testInfo.outputPath('northern-closure-approach.png')});
 // Hold about 33 mph to 45 m from the closed end, then coast into the barriers.
 for(let held=false,t=0;;t++){
  const s=await snapshot(page),near=nearest([end],s.state.x,s.state.z);
  if((near.distance<10&&near.at>endLength-45)||t>300){if(held)await page.keyboard.up('w');break;}
  const want=s.state.speed<15;if(want!==held){await (want?page.keyboard.down('w'):page.keyboard.up('w'));held=want;}
  await page.waitForTimeout(100);
 }
 await expect.poll(async()=>{const s=await snapshot(page);return nearest([end],s.state.x,s.state.z).at>endLength-30&&Math.abs(s.state.speed)<.5;},{timeout:30000}).toBe(true);
 s=await snapshot(page);on=nearest([end],s.state.x,s.state.z);
 expect(on.distance,'the car is on the closed piece').toBeLessThan(10);expect(on.at,'the car reaches the barriers').toBeGreaterThan(endLength-30);
 expect(on.at,'and stops at them').toBeLessThan(endLength);expect(Math.abs(s.state.y-on.y)).toBeLessThan(1.5);
 await page.screenshot({path:testInfo.outputPath('northern-closure.png')});

 // The southbound lower deck beneath the Charlestown viaduct: the car rides it, not the survey deck above.
 const lower=carriageway('sb').filter(r=>r.elevations!.every(y=>y>24&&y<29)).sort((a,b)=>length(b)-length(a))[0];
 expect(lower,'a held lower-deck piece').toBeTruthy();
 const below=await place(lower,length(lower)/3);
 s=await snapshot(page);expect(Math.abs(s.state.y-below.y)).toBeLessThan(1.5);
 await drive(60,below);s=await snapshot(page);on=nearest(decks,s.state.x,s.state.z);expect(Math.abs(s.state.y-on.y)).toBeLessThan(1.5);
 // The viaduct overhead is the Zakim survey mesh, streamed with its own tile; cars on its traces are hidden until it is built.
 const surveyTile=(()=>{const b=city.landmarkBuildings.find((b:any)=>b.landmark==='zakim-bridge');return `${Math.floor(b.center[0]/1000)}_${Math.floor(b.center[1]/1000)}`;})();
 await expect.poll(async()=>(await snapshot(page)).tiles.keys.includes(surveyTile),{timeout:120000}).toBe(true);
 await expect.poll(()=>page.evaluate(([bx,bz])=>{
  const api=(window as any).__backbay,traces:Road[]=api.city.surveyRoads;
  const onTrace=(a:any)=>traces.some(r=>r.points.some((p,i)=>{
   if(!i)return false;const q=r.points[i-1],dx=p[0]-q[0],dz=p[1]-q[1],t=Math.max(0,Math.min(1,((a.x-q[0])*dx+(a.z-q[1])*dz)/(dx*dx+dz*dz||1))),e=r.elevations!;
   return Math.hypot(a.x-q[0]-dx*t,a.z-q[1]-dz*t)<r.width/2&&Math.abs(a.y-.65-(e[i-1]+(e[i]-e[i-1])*t))<1.5;
  }));
  return api.snapshot().traffic.some((a:any)=>!a.hidden&&!a.parked&&Math.hypot(a.x-bx,a.z-bz)<400&&onTrace(a));
 },[below.x,below.z] as const),{timeout:60000}).toBe(true);
 await page.screenshot({path:testInfo.outputPath('charlestown-lower-deck.png')});

 // GPS from Faneuil Hall to Medford Square runs through the tunnel and up the interstate.
 const from=city.landmarks.find((l:any)=>l.id==='faneuil-hall'),to=city.landmarks.find((l:any)=>l.id==='medford-square');
 const arrival=from.driveStart??{x:from.position[0],z:from.position[1],yaw:0};
 await page.evaluate(([x,z,yaw])=>(window as any).__backbay.travelTo(x,z,yaw),[arrival.x,arrival.z,arrival.yaw] as const);await streamed(page);
 expect(await page.evaluate(([x,z])=>!!(window as any).__backbay.gps.setDestination(x,z),to.position)).toBe(true);
 const route=await page.evaluate(()=>(window as any).__backbay.gps.snapshot());
 expect(route.active).toBe(true);expect(route.wrongWay).toBe(false);
 expect(route.steps.some((step:any)=>/I-93/.test(`${step.road??''} ${step.text}`)),JSON.stringify(route.steps.map((step:any)=>step.text))).toBe(true);
 await testInfo.attach('faneuil-hall-to-medford-square.json',{body:JSON.stringify({length:route.length,duration:route.duration,steps:route.steps},null,2),contentType:'application/json'});
 await page.evaluate(()=>(window as any).__backbay.gps.clear());

 // Aerial views: the barriers, the Roosevelt Circle trench, the Mystic River crossing and the City Square climb onto the Zakim.
 const point=(r:Road,d:number)=>{const p=along(r,d),q=along(r,Math.min(length(r),d+5));return {...p,dx:q.x-p.x,dz:q.z-p.z};};
 const closure=point(end,Math.max(0,endLength-20));
 const on93=(x:number,z:number)=>{const n=nearest(carriageway('nb'),x,z);return point(n.road,n.at);};
 const circle=roads.find(r=>r.name==='Roosevelt Circle'&&r.elevations)!,roosevelt=on93(...circle.points[Math.floor(circle.points.length/2)]);
 const mystic=on93(-2420.6,-7171.4);
 const climb=carriageway('sb').at(-1)!,citySquare=point(climb,Math.max(0,length(climb)-80));
 const views=[
  sideView('northern-closure-aerial',closure.x,closure.y,closure.z,closure.dx,closure.dz,60,25,.4),
  sideView('roosevelt-circle-trench',roosevelt.x,roosevelt.y,roosevelt.z,roosevelt.dx,roosevelt.dz,90,30,.4),
  sideView('mystic-river-crossing',mystic.x,mystic.y,mystic.z,mystic.dx,mystic.dz,120,35,.35),
  sideView('city-square-climb',citySquare.x,citySquare.y,citySquare.z,citySquare.dx,citySquare.dz,90,25,.3),
 ];
 await page.keyboard.press('3');await page.keyboard.press('c');
 let pitch=.3;
 for(const v of views){
  await page.evaluate(v=>(window as any).__backbay.flyTo(v.x,v.y,v.z,v.yaw),v);
  await expect.poll(async()=>{const p=(await snapshot(page)).flight;return Math.hypot(p.x-v.x,p.z-v.z);}).toBeLessThan(1);
  await page.mouse.move(800,300);await page.mouse.down();await page.mouse.move(800,300+(v.pitch-pitch)/.005,{steps:8});await page.mouse.up();pitch=v.pitch;
  await streamed(page);await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  s=await snapshot(page);expect(s.tiles.failed).toBe(0);
  await page.screenshot({path:testInfo.outputPath(`${v.name}.png`)});
 }
 expect(errors).toEqual([]);
});
