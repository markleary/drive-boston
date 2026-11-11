import {test,expect,type Page} from '@playwright/test';

type Road={id:string;name:string;points:[number,number][];elevations?:number[];deckWidths?:number[];width:number;closed?:'start'|'end';tunnel?:{covered:[number,number][];clearance:number};kind?:string};
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const streamed=(page:Page)=>expect.poll(()=>page.evaluate(()=>{
 const api=(window as any).__backbay,s=api.snapshot(),p=s.travelMode==='helicopter'?s.flight:s.state,key=`${Math.floor(p.x/1000)}_${Math.floor(p.z/1000)}`;
 return !api.city.tiles.keys.includes(key)||s.tiles.keys.includes(key);
}),{timeout:60000}).toBe(true);
const length=(r:Road)=>r.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-r.points[i][0],p[1]-r.points[i][1]),0);
/** The point `d` metres along a record, its surface height and the heading a car takes along it. */
function along(r:Road,d:number){
 let left=d;
 for(let i=1;i<r.points.length;i++){
  const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],L=Math.hypot(bx-ax,bz-az);
  if(left<=L||i===r.points.length-1){const t=Math.min(1,left/L),e=r.elevations!;return {x:ax+(bx-ax)*t,z:az+(bz-az)*t,y:e[i-1]+(e[i]-e[i-1])*t,yaw:Math.atan2(bx-ax,bz-az)};}
  left-=L;
 }
 throw new Error(`${r.id} has no length`);
}
/** Nearest point of any of `roads` to (x, z): the road, the distance to its centreline, its height there and the distance along it. */
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

test('the Turnpike and Storrow Drive: the car rides their decks, cuts and tunnels, under level street bridges, to the barrier at the Newton line',async({page,request},testInfo)=>{
 test.setTimeout(900000);await page.setViewportSize({width:1600,height:900});
 const city=await(await request.get('/data/city.json')).json(),sidecar=await(await request.get('/data/boston-highways.json')).json();
 const streets:Road[]=city.roads,highway:Road[]=[...streets.filter(r=>/^(i90|storrow|route1a)-/.test(r.id)),...sidecar.roads];
 const family=(prefix:string)=>highway.filter(r=>new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>Number(a.id.split('-').at(-1))-Number(b.id.split('-').at(-1)));
 expect(family('i90-wb').length).toBeGreaterThan(40);expect(family('storrow-eb').length).toBeGreaterThan(10);
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const place=async(r:Road,d:number)=>{const p=along(r,d);await page.evaluate(([x,z,yaw,id])=>(window as any).__backbay.travelTo(x,z,yaw,id),[p.x,p.z,p.yaw,r.id] as const);await streamed(page);return p;};
 const drive=async(metres:number,from:{x:number,z:number})=>{
  await page.keyboard.down('w');
  try{await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-from.x,s.state.z-from.z);},{timeout:60000}).toBeGreaterThan(metres);}finally{await page.keyboard.up('w');}
 };
 const rides=async(roads:Road[],what:string)=>{const s=await snapshot(page),on=nearest(roads,s.state.x,s.state.z);expect(on.distance,`${what}: on ${on.road.id}`).toBeLessThan(10);expect(Math.abs(s.state.y-on.y),`${what}: at the height of ${on.road.id}`).toBeLessThan(1.5);return s;};

 // Westbound through the South End's walled cut: under the Tremont Street bridge, which spans both carriageways.
 const tremont=streets.find(r=>r.id==='16346-0-0')!,under=nearest(family('i90-wb'),...tremont.points[0]);
 expect(under.distance,'the westbound carriageway passes under the Tremont Street bridge').toBeLessThan(12);
 const start=await place(under.road,Math.max(0,under.at-90));
 await expect(page.locator('#location-label')).toContainText('I-90 West');
 await drive(180,start);let s=await rides(family('i90-wb'),'under Tremont Street');
 expect((await snapshot(page)).tiles.failed).toBe(0);
 // The Turnpike carries highway traffic, on its own records.
 await expect.poll(async()=>{const t=(await snapshot(page)).traffic;return t.filter((a:any)=>a.motorway>0&&Math.hypot(a.x-s.state.x,a.z-s.state.z)<600).length;},{timeout:60000}).toBeGreaterThanOrEqual(4);
 await page.screenshot({path:testInfo.outputPath('south-end-cut-westbound.png')});

 // Columbus Avenue crosses the cut on a level bridge: no ramp, no wall across it.
 const ramp=streets.find(r=>r.id==='14733-0-0-deck')!,street=streets.find(r=>r.id==='14733-0-0')!;
 expect(ramp?.elevations&&street&&!street.elevations,'the bridge is carried on to where the avenue has climbed out of the cut').toBeTruthy();
 const landing=ramp.points.at(-1)!,node=ramp.points[0],heading=Math.atan2(node[0]-landing[0],node[1]-landing[1]);
 await page.evaluate(([x,z,yaw])=>(window as any).__backbay.travelTo(x,z,yaw),[landing[0]+Math.sin(heading)*-12,landing[1]+Math.cos(heading)*-12,heading] as const);await streamed(page);
 const before=(await snapshot(page)).state;
 await drive(110,before);s=await snapshot(page);
 expect(Math.abs(s.state.y-before.y),'the avenue stays level across the Turnpike').toBeLessThan(2.2);
 await page.screenshot({path:testInfo.outputPath('columbus-avenue-bridge.png')});

 // Through its longest roofed stretch (the Ted Williams Tunnel): headroom overhead, the car on the roadway.
 const roofed=family('i90-wb').filter(r=>r.tunnel?.covered.some(([a,b])=>b-a>300)).sort((a,b)=>length(b)-length(a))[0];
 expect(roofed,'a long roofed stretch').toBeTruthy();
 const inside=await place(roofed,roofed.tunnel!.covered[0][0]+40);
 await drive(150,inside);await rides(family('i90-wb'),'in the tunnel');
 await page.screenshot({path:testInfo.outputPath('harbor-tunnel.png')});

 // Exit 131 is signed ahead of its gore.
 const exit=highway.find(r=>r.id==='i90-wb-exit-131')!,gore=nearest(family('i90-wb'),...exit.points[0]);
 await place(gore.road,Math.max(0,gore.at-160));
 await expect.poll(()=>page.evaluate(()=>!!(window as any).__backbay.scene.getObjectByName('Advance exit sign: i90-wb-exit-131')),{timeout:60000}).toBe(true);

 // The westbound carriageway ends at concrete barriers at the Newton line, which the car cannot pass.
 const end=highway.find(r=>r.closed==='end')!,endLength=length(end);
 expect(end.id.startsWith('i90-wb-')).toBe(true);
 await place(end,Math.max(0,endLength-110));
 for(let held=false,t=0;;t++){
  const s=await snapshot(page),near=nearest([end],s.state.x,s.state.z);
  if((near.distance<10&&near.at>endLength-45)||t>300){if(held)await page.keyboard.up('w');break;}
  const want=s.state.speed<15;if(want!==held){await (want?page.keyboard.down('w'):page.keyboard.up('w'));held=want;}
  await page.waitForTimeout(100);
 }
 await expect.poll(async()=>{const s=await snapshot(page);return nearest([end],s.state.x,s.state.z).at>endLength-30&&Math.abs(s.state.speed)<.5;},{timeout:30000}).toBe(true);
 s=await snapshot(page);const stopped=nearest([end],s.state.x,s.state.z);
 expect(stopped.distance,'the car is on the closed piece').toBeLessThan(10);expect(stopped.at,'and stops at the barriers').toBeLessThan(endLength);
 await page.screenshot({path:testInfo.outputPath('newton-line-closure.png')});

 // Storrow Drive East: warnings ahead of its low tunnel, and the car through it.
 const tunnel=family('storrow-eb').find(r=>r.tunnel?.covered.some(([a,b])=>b-a>100))!;
 expect(tunnel.tunnel!.clearance,'the tunnel at the Esplanade keeps its low clearance').toBe(3.2);
 await place(tunnel,Math.max(0,tunnel.tunnel!.covered[0][0]-80));
 await expect(page.locator('#location-label')).toContainText('Storrow Drive East');
 await expect.poll(()=>page.evaluate(()=>{let low=0,cars=0;(window as any).__backbay.scene.traverse((o:any)=>{if(/^Warning sign: LOW CLEARANCE/.test(o.name))low++;if(/^Warning sign: CARS ONLY/.test(o.name))cars++;});return low>0&&cars>0;}),{timeout:60000}).toBe(true);
 await page.screenshot({path:testInfo.outputPath('storrow-low-clearance.png')});
 // The tunnel curves, and the car is driven without steering: short runs from three places under its roof.
 const [from,to]=tunnel.tunnel!.covered.find(([a,b])=>b-a>100)!;
 for(const share of [.15,.5,.8]){
  const inside=await place(tunnel,from+(to-from)*share);
  await drive(22,inside);await rides(family('storrow-eb'),'in the Storrow Drive tunnel');
 }
 await page.screenshot({path:testInfo.outputPath('storrow-tunnel.png')});
 expect(errors).toEqual([]);
});
