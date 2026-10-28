import {test,expect} from '@playwright/test';

test('Mission Church keeps stone spires, round-arched belfries and a rose window in flight',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
  // Delle Avenue, south of the church: reproduce the user's elevated front view
  // with normal flight controls, so the real streamed tile/material path runs.
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-2074.4015,z:2064.6631,yaw:2.9651})));
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();await expect(page.locator('#welcome')).toBeHidden();
  await page.keyboard.press('3');await page.keyboard.press('c');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.down('Space');
  try{await page.waitForFunction(()=>((window as any).__backbay.snapshot().flight.y)>81,{timeout:20000});}
  finally{await page.keyboard.up('Space');}
  const result=await page.evaluate(()=>{
    const d=(window as any).__backbay,s=d.snapshot();
    return {camera:s.camera,buildings:d.city.buildings.filter((b:{id:string})=>['BOS-ADQVO-277LT-NQB6N','BOS-U59XZ-OVMVF-D1IT5'].includes(b.id)).map((b:{name:string;kind:string;landmark:string})=>({name:b.name,kind:b.kind,landmark:b.landmark})),tiles:s.tiles.keys};
  });
  expect(result.camera).toBe('hood');expect(result.tiles).toContain('-3_1');expect(result.buildings).toHaveLength(2);
  for(const b of result.buildings)expect(b).toEqual({name:'Basilica of Our Lady of Perpetual Help',kind:'church',landmark:'mission-church'});
  await page.screenshot({path:testInfo.outputPath('mission-church-stone-facade.png')});
  await page.keyboard.press('1');await expect(page.getByTestId('mode-drive')).toHaveAttribute('aria-pressed','true');
  expect(errors).toEqual([]);
});
