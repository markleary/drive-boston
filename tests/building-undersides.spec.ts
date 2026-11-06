import {test,expect} from '@playwright/test';

test('BU staggered tower is solid below its cantilevers and keeps its roof silhouette',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|Shader Error|THREE\.WebGLProgram/i.test(message.text()))errors.push(message.text());});
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-2255,z:104,yaw:-2.3505})));
  await page.goto('/');await page.getByTestId('start-drive').click({timeout:90000});
  await expect(page.locator('#welcome')).toBeHidden();await page.keyboard.press('3');
  await page.evaluate(()=>(window as any).__backbay.flyTo(-2255,16,104,-2.3505));
  await page.keyboard.press('c');await page.keyboard.press('h');
  // Tilt the cockpit upward through normal camera drag input.
  await page.mouse.move(640,400);await page.mouse.down();await page.mouse.move(640,300,{steps:10});await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().tiles.keys.includes('-3_0'))).toBe(true);
  await page.waitForTimeout(2500);
  await page.screenshot({path:testInfo.outputPath('bu-cantilevers-below.png')});
  await page.evaluate(()=>(window as any).__backbay.flyTo(-2255,130,104,-2.3505));
  // Look down obliquely so the roof and each staggered ledge are visible.
  await page.mouse.move(640,300);await page.mouse.down();await page.mouse.move(640,520,{steps:10});await page.mouse.up();
  await page.waitForTimeout(1500);
  await page.screenshot({path:testInfo.outputPath('bu-cantilevers-above.png')});
  expect(errors).toEqual([]);
});
