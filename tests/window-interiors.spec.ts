import {test,expect,type Page} from '@playwright/test';
interface Snapshot { lighting:string; windowInteriors:{styles:number;glow:number;litFraction:number;daylight:number}; }
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());

test('facade windows show parallax rooms that light up at night without shader errors',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(message.text()))errors.push(message.text());});
  // Start on Newbury Street beside the brick rows so the chase camera faces glazing.
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:23.3,z:-183.3,yaw:-1.218})));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const golden=await snapshot(page);
  expect(golden.windowInteriors.styles).toBe(16);
  expect(golden.lighting).toBe('golden');
  expect(golden.windowInteriors.glow).toBeGreaterThan(0);
  expect(golden.windowInteriors.glow).toBeLessThan(1);
  await page.waitForTimeout(1200);
  await page.screenshot({path:testInfo.outputPath('window-interiors-golden.png')});
  await page.keyboard.press('Escape');
  await page.locator('[data-light="night"]').click();
  await page.locator('#resume-drive').click();
  const night=await snapshot(page);
  expect(night.lighting).toBe('night');
  expect(night.windowInteriors.glow).toBeGreaterThan(golden.windowInteriors.glow*2);
  expect(night.windowInteriors.litFraction).toBeGreaterThan(golden.windowInteriors.litFraction);
  expect(night.windowInteriors.daylight).toBeLessThan(golden.windowInteriors.daylight);
  await page.waitForTimeout(1200);
  await page.screenshot({path:testInfo.outputPath('window-interiors-night.png')});
  expect(errors).toEqual([]);
});
