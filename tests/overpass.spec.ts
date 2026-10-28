import {test,expect} from '@playwright/test';

test('keyboard driving clears both Bowker merge obstructions',async({page},testInfo)=>{
  test.setTimeout(120000);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  await page.keyboard.press('m');await page.getByRole('button',{name:'Show all Boston destinations'}).click();
  await page.locator('[data-destination="bowker-overpass"]').click();await expect(page.locator('#map-modal')).toBeHidden();
  const route=await page.evaluate(()=>{
    const game=(window as unknown as {__backbay:{city:{roads:{id:string;points:number[][]}[]}}}).__backbay;
    return [21327,23520,24120,20011].flatMap(id=>game.city.roads.find(r=>r.id===`${id}-0-bridge`)!.points);
  });
  const state=()=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():{state:{x:number;y:number;z:number;yaw:number;speed:number}}}}).__backbay.snapshot().state);
  const held=new Set<string>();
  const key=async(name:string,down:boolean)=>{
    if(down&&!held.has(name)){await page.keyboard.down(name);held.add(name);}
    if(!down&&held.has(name)){await page.keyboard.up(name);held.delete(name);}
  };
  let cursor=5,car=await state();const started=Date.now();
  try{
    while(car.z<338&&Date.now()-started<65000){
      while(cursor<route.length-1&&Math.hypot(route[cursor][0]-car.x,route[cursor][1]-car.z)<4)cursor++;
      let target=cursor,look=0;
      while(target<route.length-1&&look<9){look+=Math.hypot(route[target+1][0]-route[target][0],route[target+1][1]-route[target][1]);target++;}
      const desired=Math.atan2(route[target][0]-car.x,route[target][1]-car.z);
      const error=Math.atan2(Math.sin(desired-car.yaw),Math.cos(desired-car.yaw));
      await key('w',car.speed<7);await key('a',error>.025);await key('d',error<-.025);
      await page.waitForTimeout(80);car=await state();
    }
  }finally{for(const name of [...held])await key(name,false);}
  expect(car.z,'drive past both the acute merge at z=269 and descending ramp rail at z=317').toBeGreaterThan(338);
  expect(car.y).toBeGreaterThan(6.8);
  await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await state()).speed)).toBeLessThan(.3);await page.keyboard.up('Space');
  await page.screenshot({path:testInfo.outputPath('bowker-clear-through-lanes.png')});
  await page.keyboard.press('2');await page.keyboard.down('Space');await page.waitForTimeout(2500);await page.keyboard.up('Space');
  await page.keyboard.press('c');await page.keyboard.press('c');await page.waitForTimeout(700);
  await page.screenshot({path:testInfo.outputPath('bowker-merge-aerial.png')});
  expect(errors).toEqual([]);
});
