import { test, expect, type Page } from '@playwright/test';

interface Position { x:number; y:number; z:number; yaw:number; speed:number; }
interface Snapshot {
  state:Position; flight:Position; groundHeight:number; flightGroundHeight:number;
  paused:boolean; travelMode:'drive'|'helicopter'; camera:string;
}
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());

test('Mission Hill: travel by map, drive a real grade, inspect above ground, and return to Back Bay',async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const backBay=await snapshot(page);
  await page.getByRole('button',{name:'Open map',exact:true}).click();
  await page.getByRole('button',{name:'Show all Boston destinations',exact:true}).click();
  const hill=page.locator('[data-destination="mission-hill"]');
  await expect(hill).toContainText('Mission Hill');
  await hill.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('boston-expanded-map.png')});
  await hill.click();
  await expect.poll(async()=>(await snapshot(page)).groundHeight).toBeGreaterThan(backBay.groundHeight+15);
  await expect(page.locator('#neighborhood-label')).toContainText('Mission Hill');
  const start=await snapshot(page);
  expect(Math.hypot(start.state.x-backBay.state.x,start.state.z-backBay.state.z)).toBeGreaterThan(1500);
  const along=(state:Position)=>(state.x-start.state.x)*Math.sin(start.state.yaw)+(state.z-start.state.z)*Math.cos(start.state.yaw);
  const heights=[start.groundHeight];
  await page.keyboard.down('w');
  try{
    await expect.poll(async()=>{const current=await snapshot(page);heights.push(current.groundHeight);return along(current.state);},{timeout:20000,intervals:[100,150]}).toBeGreaterThan(12);
  }finally{await page.keyboard.up('w');}
  const forward=await snapshot(page);
  expect(Math.max(...heights)-Math.min(...heights)).toBeGreaterThan(.15);
  expect(forward.state.y-forward.groundHeight).toBeGreaterThan(.25);
  expect(forward.state.y-forward.groundHeight).toBeLessThan(1.8);
  await page.screenshot({path:testInfo.outputPath('mission-hill-drive.png')});
  await page.keyboard.down('s');
  try{
    await expect.poll(async()=>(await snapshot(page)).state.speed).toBeLessThan(-1);
    await expect.poll(async()=>along((await snapshot(page)).state),{timeout:20000,intervals:[100,150]}).toBeLessThan(4);
  }finally{await page.keyboard.up('s');}
  await page.keyboard.down('Space');
  try{await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.3);}
  finally{await page.keyboard.up('Space');}
  const returned=await snapshot(page);
  expect(Math.abs(returned.groundHeight-start.groundHeight)).toBeLessThan(Math.abs(forward.groundHeight-start.groundHeight)+.2);
  await page.keyboard.press('c');
  await expect.poll(async()=>(await snapshot(page)).camera).toBe('hood');
  await page.keyboard.press('3');
  await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('helicopter');
  await expect.poll(async()=>{const current=await snapshot(page);const displayed=Number(await page.locator('#altitude-value').textContent());return Math.abs(displayed-(current.flight.y-current.flightGroundHeight)*3.28084);}).toBeLessThan(2);
  const airborne=await snapshot(page);
  expect(airborne.flightGroundHeight).toBeGreaterThan(backBay.groundHeight+15);
  const initialAltitude=Number(await page.locator('#altitude-value').textContent());
  expect(Math.abs(initialAltitude-(airborne.flight.y-airborne.flightGroundHeight)*3.28084)).toBeLessThan(2);
  await page.keyboard.down('Space');
  try{await expect.poll(async()=>(await snapshot(page)).flight.y).toBeGreaterThan(airborne.flight.y+5);}
  finally{await page.keyboard.up('Space');}
  await page.screenshot({path:testInfo.outputPath('mission-hill-helicopter.png')});
  await page.keyboard.press('1');
  await page.keyboard.press('m');
  await page.locator('[data-destination="library"]').click();
  await expect.poll(async()=>(await snapshot(page)).groundHeight).toBeLessThan(backBay.groundHeight+5);
  await expect(page.locator('#neighborhood-label')).toContainText('Back Bay');
  expect((await snapshot(page)).travelMode).toBe('drive');
  expect(errors).toEqual([]);
});
