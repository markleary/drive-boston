import {test,expect} from '@playwright/test';

interface Details {buildingId:string;columns:number;doorBays:number;streetArches:number;clerestoryWindows:number;annexBays:number;triangles:number}
interface Backbay {snapshot():{state:{x:number;z:number};tiles?:{pending:number};cityLandmarks:{symphonyHall:Details}};flyTo(x:number,y:number,z:number,yaw?:number):Promise<void>}

test('Symphony Hall is an atlas destination with its McKim, Mead & White facades',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  // Start where the atlas arrives: the inbound Huntington Avenue carriageway, the portico ahead on the left.
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-893.245461,z:909.546632,yaw:2.371969464})));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const details=await page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.snapshot().cityLandmarks.symphonyHall);
  expect(details.buildingId).toBe('BOS-383I7-LINV0-9U4AI');
  expect(details.columns).toBe(7);expect(details.doorBays).toBe(6);expect(details.streetArches).toBe(7);expect(details.clerestoryWindows).toBe(14);expect(details.annexBays).toBe(20);
  expect(details.triangles).toBeGreaterThan(5000);expect(details.triangles).toBeLessThan(60000);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.snapshot().tiles?.pending??0),{timeout:60000}).toBe(0);
  await page.screenshot({path:testInfo.outputPath('symphony-hall-from-huntington-avenue.png')});
  // The atlas lists the hall and starts the car at the same arrival.
  await page.keyboard.press('m');
  const all=page.getByRole('button',{name:'Show all Boston destinations'});if(await all.isVisible())await all.click();
  const button=page.locator('[data-destination="symphony-hall"]');await expect(button).toContainText('Symphony Hall');await button.click();
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>{const s=(window as unknown as {__backbay:Backbay}).__backbay.snapshot().state;return Math.hypot(s.x+893.245,s.z-909.547);}),{timeout:30000}).toBeLessThan(3);
  // From the air: the Massachusetts Avenue wall and marquee, then the Huntington Avenue portico.
  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('h');
  await expect(page.locator('#interface')).toHaveClass(/hud-off/);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await expect(page.locator('#drive-hint')).toHaveCSS('opacity','0');
  const settled=async()=>{await expect.poll(()=>page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.snapshot().tiles?.pending??0),{timeout:60000}).toBe(0);await expect(page.locator('#toast')).not.toHaveClass(/visible/,{timeout:15000});await page.waitForTimeout(800);};
  await page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.flyTo(-858,9,785,-.73));
  await settled();
  await page.screenshot({path:testInfo.outputPath('symphony-hall-massachusetts-avenue.png')});
  await page.evaluate(()=>(window as unknown as {__backbay:Backbay}).__backbay.flyTo(-834.7,14,865.3,-2.3));
  await settled();
  await page.screenshot({path:testInfo.outputPath('symphony-hall-huntington-portico.png')});
  expect(errors).toEqual([]);
});
