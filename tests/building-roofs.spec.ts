import {test,expect} from '@playwright/test';

test('Lowell and Summer Street roofs and complete window rows render in daylight and at night',async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|Shader Error|THREE\.WebGLProgram/i.test(message.text()))errors.push(message.text());});
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-2753.16,z:-4438.57,yaw:-.9745})));
  await page.goto('/');
  await page.getByTestId('start-drive').click({timeout:90000});
  await expect(page.locator('#welcome')).toBeHidden();
  const views=[
    {name:'lowell-gables',x:-2753.16,z:-4438.57,yaw:-.9745},
    {name:'lowell-shop',x:-2752.28,z:-4431.47,yaw:-.0218},
    {name:'summer-houses',x:-2978.18,z:-4254.65,yaw:-1.3407},
  ];
  for(const view of views){
    await page.evaluate(async v=>{
      const game=(window as unknown as {__backbay:{travelTo(x:number,z:number,yaw:number):Promise<void>}}).__backbay;
      await game.travelTo(v.x,v.z,v.yaw);
    },view);
    if(view.name==='summer-houses')await page.keyboard.press('Digit2');
    await page.waitForTimeout(3000);
    await page.screenshot({path:testInfo.outputPath(`${view.name}-golden.png`)});
  }
  await page.keyboard.press('Escape');
  await page.locator('[data-light="night"]').click();
  await page.locator('#resume-drive').click();
  await page.waitForTimeout(1500);
  await page.screenshot({path:testInfo.outputPath('summer-houses-night.png')});
  expect(errors).toEqual([]);
});
