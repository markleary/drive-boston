import {test,expect} from '@playwright/test';

test('detailed helicopter shadows cover the district and ground vehicles retain their original range',async({page},testInfo)=>{
  test.setTimeout(180000);const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');await page.getByTestId('start-drive').click({timeout:120000});
  const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
  const ground=await snapshot();expect(ground.shadows.halfExtent).toBeLessThan(110);expect(ground.rendering.shadowMapSize).toBe(4096);
  await page.keyboard.press('3');
  await page.evaluate(()=>(window as any).__backbay.flyTo(402.843,320,-443.84,Math.PI));
  await expect.poll(async()=>(await snapshot()).shadows.halfExtent).toBeGreaterThanOrEqual(1000);
  expect((await snapshot()).shadows.far).toBeGreaterThan(3000);
  for(const light of ['golden','day']){
    await page.keyboard.press('Escape');await page.locator(`[data-light="${light}"]`).click();await page.locator('[data-camera="aerial"]').click();await page.locator('#resume-drive').click();
    await expect.poll(async()=>(await snapshot()).lighting).toBe(light);
    await page.screenshot({path:testInfo.outputPath(`flight-shadows-${light}.png`)});
  }
  await page.keyboard.press('Escape');await page.locator('[data-camera="hood"]').click();await page.locator('#resume-drive').click();
  const start=(await snapshot()).flight;
  await page.keyboard.down('w');
  try{await expect.poll(async()=>Math.hypot((await snapshot()).flight.x-start.x,(await snapshot()).flight.z-start.z),{timeout:30000}).toBeGreaterThan(140);}
  finally{await page.keyboard.up('w');}
  expect((await snapshot()).shadows.halfExtent).toBeGreaterThanOrEqual(1000);
  await page.screenshot({path:testInfo.outputPath('flight-shadows-moving.png')});
  await page.keyboard.press('Escape');await page.locator('[data-quality="balanced"]').click();
  await expect.poll(async()=>(await snapshot()).shadows.halfExtent).toBeLessThanOrEqual(330);
  expect((await snapshot()).rendering.shadowMapSize).toBe(2048);
  await page.locator('[data-quality="high"]').click();
  await expect.poll(async()=>(await snapshot()).shadows.halfExtent).toBeGreaterThanOrEqual(1000);
  expect((await snapshot()).rendering.shadowMapSize).toBe(4096);
  await page.locator('#resume-drive').click();
  for(const key of ['1','2']){
    await page.keyboard.press(key);
    await expect.poll(async()=>(await snapshot()).shadows.halfExtent).toBeLessThan(110);
    expect((await snapshot()).shadows.far).toBe(1100);
  }
  expect(errors).toEqual([]);
});
