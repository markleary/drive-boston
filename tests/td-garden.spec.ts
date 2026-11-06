import {test,expect,type Page} from '@playwright/test';

interface Details {buildingId:string;triangles:number;signs:string[];boards:{video:number;billboard:number;hall:number;departures:number};gantryHeight:number;floodlights:number;bollards:number;obstructionLights:number;shopSigns:number;yard:{tracks:number;platforms:number;canopyBays:number;railCars:number;solids:number}}
interface Backbay {snapshot():{state:{x:number;z:number;speed:number};lighting:string;paused:boolean;tiles?:{keys:string[]};tdGarden:Details};travelTo(x:number,z:number,yaw?:number):Promise<void>;flyTo(x:number,y:number,z:number,yaw?:number):Promise<void>}
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.snapshot());
// The building frame of td-garden.ts: u along the track wall, v toward the tracks (Causeway Street at -150).
const O=[946.187,-1797.851],U=[.80584922,-.5921208],V=[-.5921208,-.80584922];
const world=(u:number,v:number)=>[O[0]+u*U[0]+v*V[0],O[1]+u*U[1]+v*V[1]],frame=(x:number,z:number)=>[(x-O[0])*U[0]+(z-O[1])*U[1],(x-O[0])*V[0]+(z-O[1])*V[1]];
const TOWARD_TRACKS=Math.atan2(V[0],V[1]),TOWARD_ARENA=Math.atan2(-V[0],-V[1]);
// Where the atlas arrives: northbound Canal Street, the gantry across the entrance straight ahead.
const ARRIVAL={x:1185.511794,z:-1632.584856,yaw:-2.436898542};

async function start(page:Page,at:{x:number;z:number;yaw:number}){
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await page.addInitScript(saved=>localStorage.setItem('backbay-drive-v1',JSON.stringify(saved)),at);
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  return errors;
}
// The arena's tile and the two its yard reaches are built; farther tiles keep streaming at the frame budget, which a headless browser starves.
const settled=async(page:Page)=>{await expect.poll(async()=>{const keys=(await snapshot(page)).tiles?.keys??[];return ['1_-2','0_-2','0_-3'].filter(key=>!keys.includes(key));},{timeout:60000}).toEqual([]);await expect(page.locator('#toast')).not.toHaveClass(/visible/,{timeout:15000});await page.waitForTimeout(800);};
// Place the car at a frame point and hold the throttle until it has stopped against something.
async function driveInto(page:Page,u:number,v:number,yaw:number){
  const [x,z]=world(u,v);
  await page.evaluate(([x,z,yaw])=>(window as unknown as {__backbay:Backbay}).__backbay.travelTo(x,z,yaw),[x,z,yaw]);
  await settled(page);
  await page.keyboard.down('w');
  try{await page.waitForTimeout(1500);await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed),{timeout:20000}).toBeLessThan(.2);}
  finally{await page.keyboard.up('w');}
  const {state}=await snapshot(page);return frame(state.x,state.z);
}

test('TD Garden is an atlas destination behind its gantry, boards and bollards',async({page},testInfo)=>{
  const errors=await start(page,ARRIVAL);
  const details=(await snapshot(page)).tdGarden;
  expect(details.buildingId).toBe('BOS-BR66Z-G38QJ-39S5N');expect(details.signs).toEqual(['TD GARDEN','NORTH STATION']);
  expect(details.boards).toEqual({video:5,billboard:2,hall:2,departures:1});expect(details.shopSigns).toBe(10);
  expect(details.gantryHeight).toBeGreaterThan(36);expect(details.gantryHeight).toBeLessThan(39);
  expect(details.floodlights).toBe(18);expect(details.bollards).toBe(9);expect(details.obstructionLights).toBe(8);
  expect(details.yard).toEqual({tracks:6,platforms:4,canopyBays:27,railCars:15,solids:10});
  expect(details.triangles).toBeGreaterThan(10000);expect(details.triangles).toBeLessThan(40000);
  await settled(page);
  await page.screenshot({path:testInfo.outputPath('td-garden-from-canal-street.png')});
  // The atlas lists the arena and starts the car at the same arrival.
  await page.evaluate(([x,z,yaw])=>(window as unknown as {__backbay:Backbay}).__backbay.travelTo(x,z,yaw),[...world(-60,-300),0]);
  await settled(page);
  await page.keyboard.press('m');
  const all=page.getByRole('button',{name:'Show all Boston destinations'});if(await all.isVisible())await all.click();
  const button=page.locator('[data-destination="td-garden"]');await expect(button).toContainText('TD Garden');await button.click();
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect.poll(async()=>{const {state}=await snapshot(page);return Math.hypot(state.x-ARRIVAL.x,state.z-ARRIVAL.z);},{timeout:30000}).toBeLessThan(3);
  // The line of bollards keeps a car on the forecourt, short of the steps into the hall.
  const [u,v]=await driveInto(page,86,-159,TOWARD_TRACKS);
  expect(Math.abs(u-86)).toBeLessThan(2);expect(v).toBeGreaterThan(-155.5);expect(v).toBeLessThan(-152.2);
  await page.screenshot({path:testInfo.outputPath('td-garden-entrance-hall.png')});
  expect(errors).toEqual([]);
});

test("North Station's yard stops a car at its trains and reads from the air by day and night",async({page},testInfo)=>{
  const [x,z]=world(43.5,150),errors=await start(page,{x,z,yaw:TOWARD_ARENA});
  // Track 1 holds a train: three coaches from the bumper, the locomotive's nose 108 m out.
  const [u,v]=await driveInto(page,43.5,150,TOWARD_ARENA);
  expect(Math.abs(u-43.5)).toBeLessThan(2.5);expect(v).toBeGreaterThan(109);expect(v).toBeLessThan(113);
  await page.screenshot({path:testInfo.outputPath('north-station-yard-from-the-tracks.png')});
  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('h');
  await expect(page.locator('#interface')).toHaveClass(/hud-off/);
  await expect(page.locator('#drive-hint')).toHaveCSS('opacity','0');
  const fly=async(u:number,v:number,y:number,yaw:number,name:string)=>{
    await page.evaluate(([x,y,z,yaw])=>(window as unknown as {__backbay:Backbay}).__backbay.flyTo(x,y,z,yaw),[world(u,v)[0],y,world(u,v)[1],yaw]);
    await settled(page);await page.screenshot({path:testInfo.outputPath(name)});
  };
  // Over the throat looking at the track wall, then from the Zakim Bridge side toward the sign board and the stair tower.
  await fly(75,205,42,TOWARD_ARENA,'north-station-yard.png');
  await fly(165,55,40,-.2348,'td-garden-track-side.png');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Night',exact:true}).click();
  await expect.poll(async()=>(await snapshot(page)).lighting).toBe('night');
  await page.keyboard.press('Escape');
  await expect.poll(async()=>(await snapshot(page)).paused).toBe(false);
  await page.waitForTimeout(800);
  await page.screenshot({path:testInfo.outputPath('td-garden-track-side-night.png')});
  expect(errors).toEqual([]);
});
