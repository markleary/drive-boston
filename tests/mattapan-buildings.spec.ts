import {test,expect} from '@playwright/test';

for(const view of [
  {name:'survey-shell',yaw:1.5296,key:'Space',height:38,above:true},
  {name:'masonry-stoop',yaw:-1.9271,key:'Shift',height:17.8,above:false},
])test(`Mattapan River Street: ${view.name} keeps solid geometry and terrain contact`,async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
  await page.addInitScript(yaw=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-1308.15,z:8985.42,yaw})),view.yaw);
  await page.goto('/');await page.getByTestId('start-drive').click({timeout:90000});
  await expect(page.locator('#welcome')).toBeHidden();
  await page.keyboard.press('3');await page.keyboard.press('c');
  await page.keyboard.down(view.key);
  try{
    await page.waitForFunction(v=>{
      const s=(window as any).__backbay.snapshot().flight;
      return v.above?s.y>v.height:s.y<v.height;
    },view,{timeout:20000});
  }finally{await page.keyboard.up(view.key);}
  await page.waitForFunction(()=>Math.abs((window as any).__backbay.snapshot().flight.verticalSpeed)<.1);
  if(view.above){await page.mouse.move(650,280);await page.mouse.down();await page.mouse.move(650,470,{steps:10});await page.mouse.up();}
  const sources=await page.evaluate(()=>(window as any).__backbay.city.buildings.filter((b:any)=>['BOS-NA8BR-YJOW2-4D067','BOS-WYV6T-M2KK0-RW7TK'].includes(b.id)).map((b:any)=>b.source));
  expect(sources).toEqual(['boston-obj','boston-obj']);
  await page.waitForTimeout(500);
  await page.screenshot({path:testInfo.outputPath(`mattapan-${view.name}.png`)});
  expect(errors).toEqual([]);
});
