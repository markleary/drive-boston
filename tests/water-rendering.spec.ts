import {test,expect,type Page} from '@playwright/test';

const riverStreet={x:-1182.55,z:8898.28,yaw:.5293};
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const frames=(page:Page,count=24)=>page.evaluate(n=>new Promise<void>(resolve=>{
  let elapsed=0;const next=()=>++elapsed>=n?resolve():requestAnimationFrame(next);requestAnimationFrame(next);
}),count);
const settleView=async(page:Page,x:number,z:number)=>{
  await expect.poll(async()=>{const {tiles}=await snapshot(page);return tiles.keys.includes(`${Math.floor(x/tiles.tileSize)}_${Math.floor(z/tiles.tileSize)}`);},{timeout:20000}).toBe(true);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);await frames(page,48);
};
function errorsFrom(page:Page){
  const errors:string[]=[];
  const record=(message:string)=>{if(!errors.includes(message))errors.push(message);};
  page.on('pageerror',e=>record(e.message));
  page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))record(m.text());});
  return errors;
}
async function startAtRiver(page:Page){
  await page.addInitScript(position=>localStorage.setItem('backbay-drive-v1',JSON.stringify(position)),riverStreet);
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();await frames(page);
}

test('water renders at River Street, the Public Garden and the Charles through lighting and quality changes',async({page},testInfo)=>{
  test.setTimeout(180000);const errors=errorsFrom(page);
  await startAtRiver(page);
  expect(errors).toEqual([]);
  const initial=await snapshot(page);
  expect(Math.hypot(initial.state.x-riverStreet.x,initial.state.z-riverStreet.z)).toBeLessThan(2);
  await page.screenshot({path:testInfo.outputPath('mattapan-water-golden.png')});
  for(const light of ['day','night','golden']){
    await page.keyboard.press('Escape');await page.locator(`[data-light="${light}"]`).click();await page.locator('#resume-drive').click();await frames(page);
    expect((await snapshot(page)).lighting).toBe(light);
    if(light==='day')await page.screenshot({path:testInfo.outputPath('mattapan-water-day.png')});
  }
  await page.keyboard.press('Escape');await page.locator('[data-quality="balanced"]').click();await page.locator('#resume-drive').click();await frames(page);
  expect((await snapshot(page)).quality).toBe('balanced');
  await page.screenshot({path:testInfo.outputPath('mattapan-water-balanced.png')});
  await page.keyboard.press('Escape');await page.locator('[data-quality="high"]').click();await page.locator('#resume-drive').click();
  await page.keyboard.press('3');await page.keyboard.press('c');
  for(const view of [
    {name:'public-garden-water',x:410,y:11,z:-545,yaw:-.2},
    {name:'charles-water',x:-210,y:18,z:-1430,yaw:.9},
  ]){
    await page.evaluate(v=>(window as any).__backbay.flyTo(v.x,v.y,v.z,v.yaw),view);await settleView(page,view.x,view.z);
    const state=await snapshot(page);expect(state.graphicsContext.lost).toBe(false);expect(state.paused).toBe(false);
    await page.screenshot({path:testInfo.outputPath(`${view.name}.png`)});
  }
  expect(errors).toEqual([]);
});

test.describe('mobile water',()=>{
  test.use({viewport:{width:852,height:393},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  test('River Street stays visible using the sky reflection fallback',async({page},testInfo)=>{
    test.setTimeout(120000);const errors=errorsFrom(page);await startAtRiver(page);
    const state=await snapshot(page);expect(state.mobile).toBe(true);expect(state.rendering.dynamicReflections).toBe(false);expect(state.graphicsContext.lost).toBe(false);
    await page.screenshot({path:testInfo.outputPath('mattapan-water-mobile.png')});expect(errors).toEqual([]);
  });
});
