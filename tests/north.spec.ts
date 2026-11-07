import {test,expect,type Page} from '@playwright/test';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const streamed=(page:Page)=>expect.poll(()=>page.evaluate(()=>{
 const api=(window as any).__backbay,s=api.snapshot(),p=s.travelMode==='helicopter'?s.flight:s.state,key=`${Math.floor(p.x/1000)}_${Math.floor(p.z/1000)}`;
 return !api.city.tiles.keys.includes(key)||s.tiles.keys.includes(key);
}),{timeout:45000}).toBe(true);
async function destination(page:Page,id:string){
 await page.keyboard.press('m');
 const all=page.getByRole('button',{name:'Show all Boston destinations'});if(await all.isVisible())await all.click();
 await page.locator(`[data-destination="${id}"]`).click();
 await expect(page.locator('#map-modal')).toBeHidden();
 await expect.poll(()=>page.evaluate(id=>{const api=(window as any).__backbay,p=api.snapshot().state,target=api.city.landmarks.find((l:any)=>l.id===id).driveStart;return Math.hypot(p.x-target.x,p.z-target.z);},id),{timeout:90000}).toBeLessThan(2);
 await streamed(page);
}
/** A helicopter view of a point from `distance` metres off to the side of the direction (dx, dz), `rise` metres above it. */
const sideView=(name:string,x:number,y:number,z:number,dx:number,dz:number,distance:number,rise:number,pitch:number)=>{
 const l=Math.hypot(dx,dz)||1,cx=x-dz/l*distance,cz=z+dx/l*distance;return {name,x:cx,y:y+rise,z:cz,yaw:Math.atan2(x-cx,z-cz),pitch};
};

test('Everett, Medford, Malden and Melrose stream, drive and render',async({page,request},testInfo)=>{
 test.setTimeout(600000);await page.setViewportSize({width:1600,height:900});
 const city=await(await request.get('/data/city.json')).json(),rail=await(await request.get('/data/rail.json')).json();
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const oak=city.landmarks.find((l:any)=>l.id==='oak-grove').position;
 // Everett, Medford and Malden are mixed like the inner towns; Melrose is residential outside downtown Main Street.
 for(const [id,town,level] of [['everett-square','Everett','mixed'],['wellington','Medford','mixed'],['medford-square','Medford','mixed'],['malden-center','Malden','mixed'],['oak-grove','Malden','mixed'],['melrose-ymca','Melrose','mixed'],['bellevue-avenue','Melrose','residential'],['melrose-highlands','Melrose','residential']] as const){
  await destination(page,id);
  await expect(page.locator('#neighborhood-label')).toContainText(town);
  const start=await snapshot(page);expect(start.tiles.failed).toBe(0);expect(start.buildings).toBeGreaterThan(100);
  expect(start.population.traffic.level).toBe(level);
  expect(start.state.y-start.groundHeight).toBeGreaterThan(.2);expect(start.state.y-start.groundHeight).toBeLessThan(2);
  await page.keyboard.down('w');
  try{await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-start.state.x,s.state.z-start.state.z);}).toBeGreaterThan(5);}finally{await page.keyboard.up('w');}
  await page.keyboard.down('Space');try{await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.3);}finally{await page.keyboard.up('Space');}
  await page.screenshot({path:testInfo.outputPath(`${id}-street.png`)});
  if(id!=='oak-grove')continue;
  // The track is static: Oak Grove's platforms stand between the Orange Line and the Haverhill Line.
  await expect.poll(()=>page.evaluate(([x,z])=>(window as any).__backbay.railTracks(x,z)?.built??0,oak)).toBeGreaterThan(0);
  const tracks=await page.evaluate(([x,z])=>(window as any).__backbay.railTracks(x,z),oak);
  expect(tracks.tracks).toBe(rail.tracks.length);expect(tracks.nearest.distance).toBeLessThan(30);expect(tracks.colliders).toBeGreaterThan(0);
 }
 // Bridges the district clipping had dropped, and the Haverhill Line's Mystic River bridge.
 const span=(name:string)=>{const r=city.roads.find((r:any)=>r.name===name&&r.bridge?.kind==='restored-water-span');expect(r,name).toBeTruthy();const k=Math.floor(r.points.length/2)-1,a=r.points[k],b=r.points[k+1];return {x:(a[0]+b[0])/2,z:(a[1]+b[1])/2,y:(r.elevations[k]+r.elevations[k+1])/2,dx:b[0]-a[0],dz:b[1]-a[1]};};
 const haverhill=rail.tracks.find((t:any)=>t.id==='haverhill-1'),river=haverhill.bridges.find((b:any)=>b.over.includes('water')),step=haverhill.length/(haverhill.points.length-1),k=Math.round((river.start+river.end)/2/step),[rx,rz,ry]=haverhill.points[k],[nx,nz]=haverhill.points[k+1];
 const fellsway=span('Fellsway'),medfordStreet=span('Medford Street');
 const views=[
  {name:'melrose-ymca-front',x:716.5,y:19,z:-11671.5,yaw:1.174,pitch:.2},
  {name:'melrose-ymca-rear',x:790,y:24,z:-11625,yaw:-.75,pitch:.3},
  {name:'downtown-melrose-main-street',x:680,y:22,z:-11540,yaw:2.77,pitch:.3},
  {name:'bellevue-avenue-victorians',x:1214,y:62,z:-12545,yaw:Math.PI,pitch:.55},
  {name:'ell-pond-bandstand',x:902.2,y:15,z:-12131,yaw:Math.PI,pitch:.25},
  {name:'mount-hood-slayton-tower',x:3404.4,y:86,z:-11286,yaw:Math.PI,pitch:.25},
  {name:'fells-wrights-tower',x:-2520.9,y:75,z:-9146,yaw:Math.PI,pitch:.25},
  {name:'sweetser-circle',x:1150,y:45,z:-5700,yaw:3.3,pitch:.55},
  sideView('wellington-bridge',fellsway.x,fellsway.y,fellsway.z,fellsway.dx,fellsway.dz,140,35,.35),
  sideView('medford-street-malden-river',medfordStreet.x,medfordStreet.y,medfordStreet.z,medfordStreet.dx,medfordStreet.dz,90,25,.35),
  sideView('haverhill-mystic-rail-bridge',rx,ry,rz,nx-rx,nz-rz,120,30,.35),
  sideView('oak-grove-tracks',oak[0],10,oak[1],0,-1,110,45,.55),
 ];
 await page.keyboard.press('3');await page.keyboard.press('c');
 let pitch=.3;
 for(const v of views){
  await page.evaluate(v=>(window as any).__backbay.flyTo(v.x,v.y,v.z,v.yaw),v);
  await expect.poll(async()=>{const p=(await snapshot(page)).flight;return Math.hypot(p.x-v.x,p.z-v.z);}).toBeLessThan(1);
  await page.mouse.move(800,300);await page.mouse.down();await page.mouse.move(800,300+(v.pitch-pitch)/.005,{steps:8});await page.mouse.up();pitch=v.pitch;
  await streamed(page);await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  const s=await snapshot(page);expect(s.tiles.failed).toBe(0);expect(s.travelMode).toBe('helicopter');expect(s.camera).toBe('hood');
  await testInfo.attach(`${v.name}-rendering.json`,{body:JSON.stringify({flight:s.flight,tiles:s.tiles,fps:s.fps,drawCalls:s.drawCalls,triangles:s.triangles},null,2),contentType:'application/json'});
  await page.screenshot({path:testInfo.outputPath(`${v.name}.png`)});
 }
 expect(errors).toEqual([]);
});
