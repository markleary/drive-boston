import {test,expect} from '@playwright/test';

test('Purchase Street is laterally level in the rendered game and remains drivable',async({page},testInfo)=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:1917.3601466,z:-700.6414604,yaw:3.1224848193,roadId:'13085-0-0'})));
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  const snapshot=()=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():{state:{x:number;y:number;z:number;speed:number;rotation:{x:number;y:number;z:number;w:number}};roadGrading:{roads:number}}}}).__backbay.snapshot());
  await page.keyboard.down('Space');await page.waitForTimeout(1500);await page.keyboard.up('Space');
  const start=await snapshot(),q=start.state.rotation;
  expect(start.roadGrading.roads).toBeGreaterThan(2000);
  expect(Math.abs(2*(q.x*q.y+q.w*q.z)),'vehicle cross-slope follows the corrected physical roadbed').toBeLessThan(.025);
  await page.screenshot({path:testInfo.outputPath('purchase-level-road.png')});
  await page.keyboard.down('w');
  try{await expect.poll(async()=>{const s=(await snapshot()).state;return Math.hypot(s.x-start.state.x,s.z-start.state.z);},{timeout:15000}).toBeGreaterThan(35);}
  finally{await page.keyboard.up('w');}
  const driven=await snapshot();expect(driven.state.speed).toBeGreaterThan(8);
  expect(Math.abs(2*(driven.state.rotation.x*driven.state.rotation.y+driven.state.rotation.w*driven.state.rotation.z))).toBeLessThan(.04);
  expect(errors).toEqual([]);
});
