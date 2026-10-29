import {test,expect,type Page} from '@playwright/test';
import {tobinBridgeSpine} from '../src/simulation/tobin-bridge';
import {roadMidpoint} from '../src/simulation/road-tile-coverage';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const streamed=(page:Page)=>expect.poll(()=>page.evaluate(()=>{
 const api=(window as any).__backbay,s=api.snapshot(),p=s.travelMode==='helicopter'?s.flight:s.state,key=`${Math.floor(p.x/1000)}_${Math.floor(p.z/1000)}`;
 // Teleports synchronously load the supporting neighborhood. Distant decoded
 // downloads from the previous location need not drain before this view is ready.
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

test('Chelsea streets, hills, waterfront and Tobin Bridge stream and render',async({page},testInfo)=>{
 test.setTimeout(420000);await page.setViewportSize({width:1600,height:900});
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 for(const id of ['chelsea-square','bellingham-square','mary-omalley-park']){
  await destination(page,id);
  await expect(page.locator('#neighborhood-label')).toContainText('Chelsea');
  const start=await snapshot(page);expect(start.tiles.failed).toBe(0);expect(start.buildings).toBeGreaterThan(100);
  expect(start.population.traffic.level).toBe('mixed');
  expect(start.state.y-start.groundHeight).toBeGreaterThan(.2);expect(start.state.y-start.groundHeight).toBeLessThan(2);
  await page.keyboard.down('w');
  try{await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-start.state.x,s.state.z-start.state.z);}).toBeGreaterThan(5);}finally{await page.keyboard.up('w');}
  await page.keyboard.down('Space');try{await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.3);}finally{await page.keyboard.up('Space');}
  await page.screenshot({path:testInfo.outputPath(`${id}-street.png`)});
 }
 const views=[
  {name:'tobin-main-from-east',x:2577.36,y:120,z:-3620.88,yaw:-2.15,pitch:.55},
  {name:'tobin-main-from-west',x:1857.78,y:110,z:-4216.89,yaw:.8,pitch:.55},
  {name:'tobin-little-mystic',x:2150,y:85,z:-3300,yaw:-1.77,pitch:.3},
  {name:'tobin-rutherford-approaches',x:1100,y:250,z:-2000,yaw:Math.PI,pitch:.55},
  {name:'tobin-chelsea-approaches',x:3000,y:110,z:-4400,yaw:-1.8,pitch:.55},
  {name:'bellingham-square-aerial',x:3460,y:150,z:-4550,yaw:-2.5,pitch:.65},
  {name:'mary-omalley-waterfront',x:1760,y:150,z:-4120,yaw:2.3,pitch:.65},
  {name:'chelsea-hills-aerial',x:3907.39,y:130,z:-5838.61,yaw:-2.8,pitch:1},
  {name:'chelsea-creek-crossing',x:3250,y:120,z:-3800,yaw:-1.86,pitch:.4},
  {name:'chelsea-street-crossing',x:4287.36,y:105,z:-4141.21,yaw:.4,pitch:.9},
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
 await testInfo.attach('chelsea-rendering.json',{body:JSON.stringify(await snapshot(page),null,2),contentType:'application/json'});
 expect(errors).toEqual([]);
});

for(const direction of ['northbound','southbound']as const)test(`Tobin ${direction} deck supports driving and saved-position reload`,async({page,request},testInfo)=>{
 test.setTimeout(120000);
 const city=await(await request.get('/data/city.json')).json(),spine=tobinBridgeSpine(city)!;
 expect(spine).toBeTruthy();
 const p=spine.sample((spine.layout.mainSpan[0]+spine.layout.mainSpan[1])/2),south=direction==='southbound';
 const start=south?city.landmarks.find((l:any)=>l.id==='tobin-bridge-southbound').driveStart:{x:p.x,z:p.z,yaw:p.yaw,roadId:spine.lower.id};
 await page.addInitScript(s=>{if(!sessionStorage.getItem('tobin-test-started')){localStorage.setItem('backbay-drive-v1',JSON.stringify(s));sessionStorage.setItem('tobin-test-started','1');}},start);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const before=await snapshot(page),height=south?p.upper:p.lower;
 await expect(page.locator('#location-label')).toContainText(south?'US 1 South':'US 1 North');
 const owner=roadMidpoint(south?spine.upper:spine.lower);expect(before.tiles.keys).toContain(`${Math.floor(owner[0]/1000)}_${Math.floor(owner[1]/1000)}`);
 expect(Math.abs(before.state.y-height-.67)).toBeLessThan(.3);
 await page.keyboard.down('w');try{await expect.poll(async()=>{const s=await snapshot(page);return Math.hypot(s.state.x-start.x,s.state.z-start.z);}).toBeGreaterThan(35);}finally{await page.keyboard.up('w');}
 await page.keyboard.down('Space');try{await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.3);}finally{await page.keyboard.up('Space');}
 const end=await snapshot(page);expect(Math.abs(end.state.y-height-.67)).toBeLessThan(2);
 await page.screenshot({path:testInfo.outputPath(`tobin-${direction}-deck.png`)});
 expect(end.bridges.tobin.lanesPerDeck).toBe(3);expect(end.bridges.tobin.trussPanels).toBeGreaterThan(40);
 // The game writes the active deck ID into its normal local save, keeping a
 // lower-deck reload below the upper road at the exact same XY position.
 await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('backbay-drive-v1')!).roadId)).toBe(start.roadId);
 await expect.poll(async()=>page.evaluate(p=>{const saved=JSON.parse(localStorage.getItem('backbay-drive-v1')!);return Math.hypot(saved.x-p.x,saved.z-p.z);},end.state)).toBeLessThan(1);
 await page.reload();await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const restored=await snapshot(page);expect(Math.abs(restored.state.y-end.state.y)).toBeLessThan(.35);expect(Math.hypot(restored.state.x-end.state.x,restored.state.z-end.state.z)).toBeLessThan(1);
 expect(errors).toEqual([]);
});
