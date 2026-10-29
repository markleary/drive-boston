import {test,expect} from '@playwright/test';

const viewpoints=[
 {name:'longfellow-memorial-ramp',x:-383.57,y:93.06,z:-1307.09,yaw:.9006,pitch:1.2},
 {name:'bu-bridge',x:-3204.54,y:136.68,z:-195.67,yaw:1.7922,pitch:.5},
 {name:'new-rutherford',x:740,y:89.37,z:-2452.05,yaw:3.0796,pitch:1.1},
 {name:'charlestown-avenue',x:336.63,y:82.39,z:-2352.49,yaw:2.8805,pitch:.7},
 {name:'brookline-avenue',x:-2987.2,y:60.83,z:1702.05,yaw:2.8222,pitch:.85},
 {name:'leverett-river-loop',x:930,y:120,z:-1900,yaw:0,pitch:.3,aerial:true},
 {name:'leverett-street-landings',x:600,y:70,z:-2050,yaw:.05,pitch:1},
 {name:'leverett-below-viaduct',x:450,y:24,z:-2400,yaw:1.3,pitch:.3},
];

test('reported roadway connections and Leverett ramps render cleanly',async({page},testInfo)=>{
 test.setTimeout(240000);
 await page.setViewportSize({width:1600,height:900});
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');
 await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
 await page.getByTestId('start-drive').click();
 for(const p of viewpoints){
  // Reset camera drag through the regular travel controls, then reproduce the
  // helicopter position from the user's diagnostic overlay.
  await page.keyboard.press('1');await page.keyboard.press('3');await page.keyboard.press('c');
  if(p.aerial)await page.keyboard.press('c');
  await page.evaluate(p=>(window as any).__backbay.flyTo(p.x,p.y,p.z,p.yaw),p);
  await page.mouse.move(800,300);await page.mouse.down();
  await page.mouse.move(800,300+(p.pitch-.3)/.005,{steps:8});await page.mouse.up();
  await page.waitForTimeout(2000);
  const state=await page.evaluate(()=>(window as any).__backbay.snapshot());
  expect(state.travelMode).toBe('helicopter');expect(state.camera).toBe(p.aerial?'aerial':'hood');
  expect(state.tiles.keys).toContain(`${Math.floor(p.x/1000)}_${Math.floor(p.z/1000)}`);expect(state.tiles.failed).toBe(0);
  expect(Math.hypot(state.flight.x-p.x,state.flight.z-p.z)).toBeLessThan(.1);
  await page.screenshot({path:testInfo.outputPath(`${p.name}.png`)});
 }
 expect(errors).toEqual([]);
});
