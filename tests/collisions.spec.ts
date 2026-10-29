import {test,expect,type Page} from '@playwright/test';
type Snapshot={state:{x:number;y:number;z:number;yaw:number;speed:number};traffic:{x:number;z:number;yaw:number;speed:number;knocked:boolean;rejoining:boolean;dynamic:boolean}[];walkers:{x:number;y:number;z:number;yaw:number;knocked:string|null}[];audio:{loadedCount:number;failed:string[];impactCount:number;activeOneShots:number};paused:boolean};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
const travelTo=(page:Page,x:number,z:number,yaw:number)=>page.evaluate(([x,z,yaw])=>(window as unknown as {__backbay:{travelTo(x:number,z:number,yaw:number):Promise<void>}}).__backbay.travelTo(x,z,yaw),[x,z,yaw] as const);

test('driving into traffic knocks the car and plays a crash; a struck walker goes down and gets back up',async({page},testInfo)=>{
  test.setTimeout(150000);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  await expect.poll(async()=>(await snapshot(page)).audio.loadedCount,{timeout:20000}).toBe(11);
  expect((await snapshot(page)).audio.failed).toEqual([]);
  // Boylston opens with lane keepers ahead; full throttle catches one from behind.
  const start=await snapshot(page);expect(start.traffic.every(a=>!a.knocked&&!a.dynamic)).toBe(true);
  await page.keyboard.down('w');
  let struck:Snapshot|undefined;
  try{
    await expect.poll(async()=>{const s=await snapshot(page);if(s.traffic.some(a=>a.knocked))struck=s;return !!struck;},{timeout:40000}).toBe(true);
  }finally{await page.keyboard.up('w');}
  expect(struck!.traffic.filter(a=>a.knocked).every(a=>a.dynamic)).toBe(true);
  await expect.poll(async()=>(await snapshot(page)).audio.impactCount).toBeGreaterThan(0);
  await page.screenshot({path:testInfo.outputPath('traffic-knock.png')});
  // Every struck car comes to rest and is a lane keeper again within a quarter minute.
  await expect.poll(async()=>(await snapshot(page)).traffic.every(a=>!a.knocked&&!a.rejoining&&!a.dynamic),{timeout:30000}).toBe(true);
  expect((await snapshot(page)).traffic.every(a=>[a.x,a.z,a.yaw].every(Number.isFinite))).toBe(true);

  // Approach the nearest walker along their sidewalk from a few metres back.
  const here=await snapshot(page);
  const walker=here.walkers.map(w=>({w,d:Math.hypot(w.x-here.state.x,w.z-here.state.z)})).filter(({w})=>w.knocked===null).sort((a,b)=>a.d-b.d)[0].w;
  const index=here.walkers.indexOf(walker),impactsBefore=here.audio.impactCount;
  await travelTo(page,walker.x-Math.sin(walker.yaw)*9,walker.z-Math.cos(walker.yaw)*9,walker.yaw);
  await page.keyboard.down('w');
  try{await expect.poll(async()=>(await snapshot(page)).walkers[index].knocked,{timeout:20000}).not.toBeNull();}
  finally{await page.keyboard.up('w');}
  await page.keyboard.down('Space');
  await page.screenshot({path:testInfo.outputPath('walker-knocked.png')});
  await expect.poll(async()=>(await snapshot(page)).audio.impactCount).toBeGreaterThan(impactsBefore);
  await expect.poll(async()=>(await snapshot(page)).walkers[index].knocked,{timeout:20000}).toBeNull();
  await page.keyboard.up('Space');
  await page.screenshot({path:testInfo.outputPath('walker-recovered.png')});
  expect((await snapshot(page)).paused).toBe(false);expect(errors).toEqual([]);
});
