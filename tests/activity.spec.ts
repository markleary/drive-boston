import {test,expect,type Page} from '@playwright/test';

interface Population {level:string;target:number;local:number;nearby:number;total:number;forward?:number;}
interface Snapshot {
  fps:number;drawCalls:number;triangles:number;
  trafficCount:number;pedestrians:number;
  population:{traffic:Population;pedestrians:Population};
  traffic:{x:number;z:number;speed:number}[];
}
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
async function destination(page:Page,id:string){
  await page.keyboard.press('m');
  const all=page.getByRole('button',{name:'Show all Boston destinations'});
  if(await all.isVisible())await all.click();
  await page.locator(`[data-destination="${id}"]`).click();
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect(page.locator('#neighborhood-label')).toContainText(id==='mission-hill'?'Mission Hill':'Downtown');
}

test('busy neighborhoods have visible moving traffic and sidewalks; residential destinations stay quieter',async({page},testInfo)=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const initial=await snapshot(page);
  expect(initial.population.traffic.level).toBe('busy');
  expect(initial.population.traffic.local).toBeGreaterThanOrEqual(40);
  expect(initial.population.traffic.nearby).toBeGreaterThanOrEqual(12);
  expect(initial.population.traffic.forward).toBeGreaterThanOrEqual(5);
  expect(initial.population.pedestrians.local).toBeGreaterThanOrEqual(60);
  expect(initial.population.pedestrians.nearby).toBeGreaterThanOrEqual(20);
  expect(initial.trafficCount).toBeLessThanOrEqual(64);
  expect(initial.pedestrians).toBeLessThanOrEqual(112);
  await expect.poll(async()=>{const next=await snapshot(page);return next.traffic.filter((car,i)=>Math.hypot(car.x-initial.traffic[i].x,car.z-initial.traffic[i].z)>2).length;},{timeout:15000}).toBeGreaterThan(4);
  const samples=[];
  for(let i=0;i<8;i++){await page.waitForTimeout(750);const s=await snapshot(page);samples.push({fps:s.fps,drawCalls:s.drawCalls,triangles:s.triangles,population:s.population});}
  await page.screenshot({path:testInfo.outputPath('back-bay-busy-streets.png')});
  await testInfo.attach('back-bay-performance.json',{body:JSON.stringify(samples,null,2),contentType:'application/json'});

  await destination(page,'downtown-crossing');
  const downtown=await snapshot(page);
  expect(downtown.population.traffic.level).toBe('busy');
  expect(downtown.population.traffic.local).toBeGreaterThanOrEqual(40);
  expect(downtown.population.traffic.nearby).toBeGreaterThanOrEqual(8);
  expect(downtown.population.traffic.forward).toBeGreaterThanOrEqual(5);
  expect(downtown.population.pedestrians.local).toBeGreaterThanOrEqual(60);
  expect(downtown.population.pedestrians.nearby).toBeGreaterThanOrEqual(15);
  await page.screenshot({path:testInfo.outputPath('downtown-busy-streets.png')});

  await destination(page,'mission-hill');
  const residential=await snapshot(page);
  expect(residential.population.traffic.level).toBe('residential');
  expect(residential.population.traffic.local).toBeLessThan(downtown.population.traffic.local);
  expect(residential.population.pedestrians.local).toBeLessThan(downtown.population.pedestrians.local);
  expect(residential.trafficCount).toBe(initial.trafficCount);
  expect(residential.pedestrians).toBe(initial.pedestrians);
  await page.screenshot({path:testInfo.outputPath('mission-hill-quieter-streets.png')});
  expect(errors).toEqual([]);
});
