import {test,expect,type Page} from '@playwright/test';

interface Crown {buildingId:string;word:string;faces:number;letters:number;triangles:number;crownTop:number}
interface Snapshot {prudential:Crown;exactBuildingColliders:number;lighting:string;paused:boolean;flight:{y:number}}
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());

test('Prudential Tower carries its separated crown floors and PRUDENTIAL lettering',async({page},testInfo)=>{
  test.setTimeout(150000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  // Boylston Street south-west of the tower, facing the crown.
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-693.49,z:182.83,yaw:.38,roadId:'11984-0-0'})));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  // The exact source meshes stream in with the Back Bay tile; the crown envelope is there from the start.
  await expect.poll(async()=>(await snapshot(page)).exactBuildingColliders,{timeout:60000}).toBeGreaterThanOrEqual(4);
  const initial=await snapshot(page);
  expect(initial.prudential).toMatchObject({buildingId:'BOS-KBIA4-2XA04-WNETP',word:'PRUDENTIAL',faces:4,letters:40});
  expect(initial.prudential.triangles).toBeGreaterThan(2000);expect(initial.prudential.triangles).toBeLessThan(20000);
  expect(initial.prudential.crownTop).toBeCloseTo(230.55,1);
  // The three exact source meshes plus the solid crown envelope.
  expect(initial.exactBuildingColliders).toBeGreaterThanOrEqual(4);
  await page.keyboard.press('2');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.down('Space');
  try {await expect.poll(async()=>(await snapshot(page)).flight.y,{timeout:60000}).toBeGreaterThan(224);}
  finally {await page.keyboard.up('Space');}
  await page.keyboard.press('h');
  await expect(page.locator('#interface')).toHaveClass(/hud-off/);
  await expect(page.locator('#drive-hint')).toHaveCSS('opacity','0');
  await page.screenshot({path:testInfo.outputPath('prudential-crown-golden.png')});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Night',exact:true}).click();
  await expect.poll(async()=>(await snapshot(page)).lighting).toBe('night');
  await page.keyboard.press('Escape');
  await expect.poll(async()=>(await snapshot(page)).paused).toBe(false);
  await page.screenshot({path:testInfo.outputPath('prudential-crown-night.png')});
  expect(errors).toEqual([]);
});
