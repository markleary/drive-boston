import {test,expect,type Page} from '@playwright/test';
type Snapshot={state:{x:number;y:number;z:number;speed:number};groundHeight:number;transit:{kind:string;x:number;z:number;speed:number}[];transitCount:number;signalCount:number;exactBuildingColliders:number;paused:boolean;travelMode:string;groundCover:{puddles:number};neighborhoodArchitecture:{tripleDeckers?:number}};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
async function destination(page:Page,id:string){await page.keyboard.press('m');await page.getByRole('button',{name:'Show all Boston destinations'}).click();await page.locator(`[data-destination="${id}"]`).click();await expect(page.locator('#map-modal')).toBeHidden();}

test('free roam has moving MBTA services, clear controls, and a drivable elevated ramp',async({page},testInfo)=>{
  test.setTimeout(120000);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  // Signals and exact building colliders arrive with the streamed tiles around the spawn.
  await expect.poll(async()=>{const s=await snapshot(page);return s.signalCount>180&&s.exactBuildingColliders>=3;},{timeout:60000}).toBe(true);
  let state=await snapshot(page);
  expect(state.transitCount).toBe(4);expect(state.transit.filter(a=>a.kind==='tram')).toHaveLength(2);expect(state.transit.filter(a=>a.kind==='bus')).toHaveLength(2);
  expect(state.signalCount).toBeGreaterThan(180);expect(state.exactBuildingColliders).toBeGreaterThanOrEqual(3);expect(state.groundCover.puddles).toBeGreaterThan(15);
  await destination(page,'huntington-mfa');const initial=(await snapshot(page)).transit;
  await expect.poll(async()=>{const now=(await snapshot(page)).transit;return Math.min(...now.map((a,i)=>Math.hypot(a.x-initial[i].x,a.z-initial[i].z)));},{timeout:20000}).toBeGreaterThan(3);
  await page.screenshot({path:testInfo.outputPath('huntington-services.png')});
  await destination(page,'bowker-overpass');const start=(await snapshot(page)).state;
  await page.keyboard.down('w');
  try{await expect.poll(async()=>{const s=await snapshot(page);return s.state.y-s.groundHeight;},{timeout:20000}).toBeGreaterThan(3);}
  finally{await page.keyboard.up('w');}
  state=await snapshot(page);expect(Math.hypot(state.state.x-start.x,state.state.z-start.z)).toBeGreaterThan(15);
  await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.5);await page.keyboard.up('Space');
  await page.screenshot({path:testInfo.outputPath('bowker-upper-deck.png')});
  await page.keyboard.press('3');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('helicopter');
  await page.keyboard.press('1');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('drive');
  expect((await snapshot(page)).paused).toBe(false);expect(errors).toEqual([]);
});
