import {test,expect} from '@playwright/test';

test('State House has its own brick and columned facade beneath the existing dome',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  // Start on the real Beacon Street centerline facing the south facade.
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:920,z:-833.726,yaw:-2.94459265,roadId:'11965-0-0'})));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const details=await page.evaluate(()=>(window as unknown as {__backbay:{snapshot():{cityLandmarks:{stateHouse:{buildingId:string;columns:number;arcades:number;palladianGroups:number;triangles:number}}}}}).__backbay.snapshot().cityLandmarks.stateHouse);
  expect(details.buildingId).toBe('BOS-1WKHX-X382F-V5VL1');
  expect(details.columns).toBe(10);expect(details.arcades).toBe(7);expect(details.palladianGroups).toBe(2);
  expect(details.triangles).toBeGreaterThan(1000);expect(details.triangles).toBeLessThan(60000);
  await page.screenshot({path:testInfo.outputPath('state-house-from-beacon-street.png')});
  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.down('Space');await page.keyboard.down('s');
  try {await page.waitForTimeout(2200);}finally{await page.keyboard.up('Space');await page.keyboard.up('s');}
  await page.keyboard.press('h');
  await expect(page.locator('#interface')).toHaveClass(/hud-off/);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await expect(page.locator('#drive-hint')).toHaveCSS('opacity','0');
  await page.screenshot({path:testInfo.outputPath('state-house-facade-and-dome.png')});
  expect(errors).toEqual([]);
});
