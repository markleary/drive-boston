import {test,expect} from '@playwright/test';

interface Details {buildingId:string;columns:number;entranceArches:number;windows:number;piers:number;inscription:string;clock:boolean;eagle:boolean;triangles:number}
interface Backbay {snapshot():{state:{x:number;z:number};tiles?:{pending:number};cityLandmarks:{southStation:Details}};flyTo(x:number,y:number,z:number,yaw?:number):Promise<void>}

test('South Station is an atlas destination with its granite headhouse',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  // Start where the atlas arrives: eastbound Summer Street, the Dewey Square pavilion ahead on the right.
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:1558.273867,z:-295.021974,yaw:1.125764396})));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const details=await page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.snapshot().cityLandmarks.southStation);
  expect(details.buildingId).toBe('BOS-DIPUS-MOOL6-PJ4EY');
  expect(details.columns).toBe(16);expect(details.entranceArches).toBe(3);expect(details.piers).toBe(4);expect(details.windows).toBeGreaterThan(150);
  expect(details.inscription).toBe('ERECTED BOSTON TERMINAL COMPANY MDCCCXCVII');expect(details.clock).toBe(true);expect(details.eagle).toBe(true);
  expect(details.triangles).toBeGreaterThan(5000);expect(details.triangles).toBeLessThan(80000);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.snapshot().tiles?.pending??0),{timeout:60000}).toBe(0);
  await page.screenshot({path:testInfo.outputPath('south-station-from-summer-street.png')});
  // The atlas lists the station and starts the car at the same arrival.
  await page.keyboard.press('m');
  const all=page.getByRole('button',{name:'Show all Boston destinations'});if(await all.isVisible())await all.click();
  const button=page.locator('[data-destination="south-station"]');await expect(button).toContainText('South Station');await button.click();
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>{const s=(window as unknown as {__backbay:Backbay}).__backbay.snapshot().state;return Math.hypot(s.x-1558.274,s.z+295.022);}),{timeout:30000}).toBeLessThan(3);
  // From the air: the Dewey Square front with its clock and eagle, then the Atlantic Avenue wing.
  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('h');
  await expect(page.locator('#interface')).toHaveClass(/hud-off/);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await expect(page.locator('#drive-hint')).toHaveCSS('opacity','0');
  const settled=async()=>{await expect.poll(()=>page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.snapshot().tiles?.pending??0),{timeout:60000}).toBe(0);await expect(page.locator('#toast')).not.toHaveClass(/visible/,{timeout:15000});await page.waitForTimeout(800);};
  await page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.flyTo(1592,22,-296,.353));
  await settled();
  await page.screenshot({path:testInfo.outputPath('south-station-dewey-square.png')});
  await page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.flyTo(1562,12,-300,.55));
  await settled();
  await page.screenshot({path:testInfo.outputPath('south-station-atlantic-avenue.png')});
  expect(errors).toEqual([]);
});
