import {test,expect} from '@playwright/test';

test('Back Street has a grass separation at Exeter and remains drivable',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-590,z:-369.75,yaw:-1.222,roadId:'13245-0-0'})));
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  await expect.poll(()=>page.evaluate(()=>{
    const api=(window as any).__backbay;let vertices=0;
    api?.scene.traverse((o:any)=>{if(o.name==='Street grass verges')vertices+=o.geometry?.attributes.position.count??0;});
    return vertices;
  }),{timeout:60000}).toBeGreaterThan(100);
  await page.evaluate(()=>(document.querySelector('[data-light="day"]') as HTMLElement).click());
  await page.evaluate(()=>(document.querySelector('[data-camera="aerial"]') as HTMLElement).click());
  await page.waitForTimeout(1500);
  await page.screenshot({path:testInfo.outputPath('back-street-exeter-aerial.png')});
  const start=await page.evaluate(()=>(window as any).__backbay.snapshot().state);
  await page.evaluate(()=>(document.querySelector('[data-camera="chase"]') as HTMLElement).click());
  await page.keyboard.down('w');
  try{await expect.poll(()=>page.evaluate(([x,z])=>{const s=(window as any).__backbay.snapshot().state;return Math.hypot(s.x-x,s.z-z);},[start.x,start.z]),{timeout:20000}).toBeGreaterThan(35);}
  finally{await page.keyboard.up('w');}
  const end=await page.evaluate(()=>(window as any).__backbay.snapshot());
  expect(end.state.speed).toBeGreaterThan(5);
  expect(Math.abs(end.state.y-start.y)).toBeLessThan(1.5);
  expect(end.tiles.failed).toBe(0);
  await page.screenshot({path:testInfo.outputPath('back-street-driving.png')});
  expect(errors).toEqual([]);
});
