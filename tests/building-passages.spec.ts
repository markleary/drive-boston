import {test,expect} from '@playwright/test';

test('BMC has a visible passage through both facades and retains saved arrivals under its hull',async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|Shader Error|THREE\.WebGLProgram/i.test(message.text()))errors.push(message.text());});
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:118.21,z:1832.51,yaw:-2.4832})));
  await page.goto('/');await page.getByTestId('start-drive').click({timeout:90000});
  await expect(page.locator('#welcome')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>{
    const game=(window as any).__backbay;if(!game)return Infinity;
    const state=game.snapshot().state;return Math.hypot(state.x-118.21,state.z-1832.51);
  })).toBeLessThan(1);
  await page.waitForTimeout(2500);
  await page.screenshot({path:testInfo.outputPath('bmc-southeast-approach.png')});
  await page.evaluate(()=>(window as any).__backbay.travelTo(50,1755,-2.403));
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await page.waitForTimeout(1500);
  await page.screenshot({path:testInfo.outputPath('bmc-underpass.png')});
  await page.evaluate(()=>(window as any).__backbay.travelTo(4,1701,.74));
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await page.waitForTimeout(1500);
  await page.screenshot({path:testInfo.outputPath('bmc-northwest-approach.png')});
  expect(errors).toEqual([]);
});
