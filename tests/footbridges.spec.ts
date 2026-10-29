import {test,expect} from '@playwright/test';

test('a saved footbridge arrival restores above the streamed deck outside the road margin',async({page})=>{
 const saved={x:-1754.364,z:1088.1545,yaw:-.0572,roadId:'footbridge:osm-way-87890606-0--2_1_0'};
 await page.addInitScript(position=>localStorage.setItem('backbay-drive-v1',JSON.stringify(position)),saved);
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
 const initial=await page.evaluate(()=>(window as any).__backbay.snapshot());
 expect(Math.hypot(initial.state.x-saved.x,initial.state.z-saved.z)).toBeLessThan(.1);
 expect(initial.state.y).toBeGreaterThan(-1.4);
 await page.getByTestId('start-drive').click();await page.keyboard.press('2');await page.waitForTimeout(1000);
 const bike=await page.evaluate(()=>(window as any).__backbay.snapshot().state);
 expect(bike.vehicle).toBe('ultrabee');expect(bike.y).toBeGreaterThan(-1.6);
});

test('Ultra Bee crosses the streamed Back Bay Fens footbridge in both directions',async({page},testInfo)=>{
 test.setTimeout(180000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-1753.652,z:1075.724,yaw:-.0572})));
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();await page.keyboard.press('2');
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 const endpoints=[[-1753.938,1080.716],[-1754.79,1095.593]];
 for(const reverse of [false,true]){
  const a=endpoints[reverse?1:0],b=endpoints[reverse?0:1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
  await page.evaluate(({x,z,yaw})=>(window as any).__backbay.travelTo(x,z,yaw),{x:a[0]-dx*5,z:a[1]-dz*5,yaw:Math.atan2(dx,dz)});
  const held=new Set<string>(),key=async(name:string,down:boolean)=>{if(down&&!held.has(name)){await page.keyboard.down(name);held.add(name);}if(!down&&held.has(name)){await page.keyboard.up(name);held.delete(name);}};
  const began=Date.now();let arrived=false,captured=false;
  try{
   while(Date.now()-began<45000){
    const s=(await snapshot()).state,along=(s.x-a[0])*dx+(s.z-a[1])*dz;
    if(along>length+3){arrived=true;break;}
    if(along>5&&along<length-5){
     expect(s.y,'rider must stay above the arched slab').toBeGreaterThan(-1.65);
     if(!captured){await page.screenshot({path:testInfo.outputPath(`fens-footbridge-${reverse?'northbound':'southbound'}.png`)});captured=true;}
    }
    const desired=Math.atan2(b[0]+dx*8-s.x,b[1]+dz*8-s.z),error=Math.atan2(Math.sin(desired-s.yaw),Math.cos(desired-s.yaw));
    await key('w',s.speed<4);await key('a',error>.02);await key('d',error<-.02);await page.waitForTimeout(80);
   }
  }finally{for(const name of [...held])await key(name,false);}
  expect(arrived,'ride off the opposite bank without sinking through the deck').toBe(true);expect(captured).toBe(true);
  await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await snapshot()).state.speed)).toBeLessThan(.3);await page.keyboard.up('Space');
 }
 expect(errors).toEqual([]);
});
