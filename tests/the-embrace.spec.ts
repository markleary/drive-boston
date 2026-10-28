import {test,expect} from '@playwright/test';

type Snapshot={state:{x:number;z:number};embrace:{name:string;position:[number,number];height:number;triangles:number}};

test('The Embrace stands on Boston Common and blocks cars driving into it',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  // Tremont Street, due east of 1965 Freedom Plaza, facing west across the Common.
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:932.293,z:-540.003,yaw:-1.557,roadId:'11757-0-0'})));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const snapshot=()=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
  const embrace=(await snapshot()).embrace;
  expect(embrace.name).toBe('The Embrace');expect(embrace.position).toEqual([858.64,-538.98]);expect(embrace.height).toBe(6.1);
  expect(embrace.triangles).toBeGreaterThan(10000);expect(embrace.triangles).toBeLessThan(60000);
  await page.screenshot({path:testInfo.outputPath('embrace-from-tremont.png')});
  await page.keyboard.down('ArrowUp');
  try{await page.waitForTimeout(7000);}finally{await page.keyboard.up('ArrowUp');}
  const {state}=await snapshot();
  // The retaining wall and bronze both collide; the car never reaches the centre.
  expect(state.x).toBeGreaterThan(embrace.position[0]+3);
  await page.screenshot({path:testInfo.outputPath('embrace-plaza.png')});
  expect(errors).toEqual([]);
});
