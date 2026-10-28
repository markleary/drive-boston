import {test,expect} from '@playwright/test';

test('Longfellow is drivable through the restored span and keeps visible water during flight',async({page},testInfo)=>{
 test.setTimeout(180000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
 await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-61.279,z:-1260.645,yaw:1.469,roadId:'water-link-14614-0-0'})));
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 await expect.poll(async()=>(await snapshot()).state.y).toBeGreaterThan(3.5);
 const start=(await snapshot()).state;
 await page.keyboard.down('w');
 try{await expect.poll(async()=>(await snapshot()).state.x,{timeout:45000}).toBeGreaterThan(128);}finally{await page.keyboard.up('w');}
 expect((await snapshot()).state.x-start.x).toBeGreaterThan(180);
 expect((await snapshot()).state.y).toBeGreaterThan(3.5);
 await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await snapshot()).state.speed)).toBeLessThan(.3);await page.keyboard.up('Space');
 await page.screenshot({path:testInfo.outputPath('longfellow-connected-deck.png')});
 expect((await snapshot()).bridges.longfellow.towers).toBe(4);
 await page.keyboard.press('2');const launch=(await snapshot()).flight;
 await page.keyboard.down('Space');try{await expect.poll(async()=>(await snapshot()).flight.y,{timeout:20000}).toBeGreaterThan(launch.y+30);}finally{await page.keyboard.up('Space');}
 await page.keyboard.press('c');await page.keyboard.press('c');await page.waitForTimeout(1200);
 await page.screenshot({path:testInfo.outputPath('longfellow-water-and-towers.png')});
 expect(errors).toEqual([]);
});
