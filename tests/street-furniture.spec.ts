import {test,expect,type Page} from '@playwright/test';

/** `inRoadway`, `onRoadway` and `meterInRoadway` are absent for a walker or a car whose tile has streamed out. */
type Streetside={tiles:{key:string;trees:number;lamps:number;signs:number;posts:number;postsInRoadway:number;lampsInRoadway:number}[];walkers:{x:number;z:number;road:string;park:boolean;inRoadway?:boolean}[];waiting:number;parked:{x:number;z:number;road:string;onRoadway?:boolean;meterInRoadway?:boolean}[]};
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const streetside=(page:Page):Promise<Streetside>=>page.evaluate(()=>(window as any).__backbay.streetside());
/** Nothing a resident tile planted, no walker and no kerbside car's meter stands in the roadway its tile draws. */
function expectClear(side:Streetside){
 for(const tile of side.tiles){expect(tile.postsInRoadway,`trees, lamps and signs of tile ${tile.key} in its roadway`).toBe(0);expect(tile.lampsInRoadway,`lamps of tile ${tile.key} in its roadway`).toBe(0);}
 for(const walker of side.walkers)expect(walker.inRoadway??false,`a walker of ${walker.road} at ${walker.x.toFixed(0)}, ${walker.z.toFixed(0)}`).toBe(false);
 for(const car of side.parked){expect(car.onRoadway??true,`the car parked on ${car.road} at ${car.x.toFixed(0)}, ${car.z.toFixed(0)}`).toBe(true);expect(car.meterInRoadway??false).toBe(false);}
}

test('street trees, lamps, signs and walkers keep off the roadway as the tiles draw it: the spawn and Newmarket Square',async({page},testInfo)=>{
 test.setTimeout(300000);await page.setViewportSize({width:1600,height:900});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 // About the spawn: the tiles there are resident before the street life starts, so the whole pool walks at once.
 let side=await streetside(page);
 expect(side.tiles.length).toBeGreaterThanOrEqual(1);expect(side.walkers.length+side.waiting).toBe(112);expect(side.walkers.length).toBeGreaterThan(60);
 expect(side.parked.length).toBe(8);expect(side.parked.every(car=>car.onRoadway===true),'every kerbside car about the spawn is judged, and stands on the roadway').toBe(true);expectClear(side);
 for(const tile of side.tiles)expect(tile.posts,`tile ${tile.key} lists what it planted`).toBeGreaterThanOrEqual(tile.trees+tile.lamps+tile.signs);
 // Newmarket Square: a roadway 21 m wide where its street's median is 9 m, and the line that stands for it runs down one
 // side. By the median the square's trees, a lamp and its walkers stood in the asphalt.
 await page.evaluate(()=>(window as any).__backbay.travelTo(718,2548,Math.atan2(20,-40)));
 await expect.poll(async()=>(await snapshot(page)).tiles.keys.includes('0_2'),{timeout:120000}).toBe(true);
 await expect.poll(async()=>(await streetside(page)).walkers.filter(w=>Math.hypot(w.x-725,w.z-2545)<330).length,{timeout:60000}).toBeGreaterThan(8);
 side=await streetside(page);expectClear(side);
 const square=side.tiles.find(tile=>tile.key==='0_2')!;expect(square.trees).toBeGreaterThan(300);expect(square.lamps).toBeGreaterThan(150);expect(square.posts).toBeGreaterThanOrEqual(square.trees+square.lamps+square.signs);
 // The walkers stay clear as they pace: a few seconds on, and after the neighbourhood has filled from the pool.
 await page.waitForTimeout(4000);side=await streetside(page);expectClear(side);
 expect(side.walkers.filter(w=>Math.hypot(w.x-725,w.z-2545)<330).length).toBeGreaterThan(8);
 // From the helicopter over the square, in daylight.
 await page.evaluate(()=>(document.querySelector('[data-light="day"]') as HTMLElement).click());
 await page.getByTestId('mode-helicopter').click();await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('helicopter');
 const ground=(await snapshot(page)).groundHeight;
 await page.evaluate(g=>(window as any).__backbay.flyTo(728,g+62,2596,Math.PI),ground);
 await page.waitForTimeout(3500);await page.screenshot({path:testInfo.outputPath('newmarket-square-from-the-air.png')});
 expectClear(await streetside(page));
 expect((await snapshot(page)).tiles.failed).toBe(0);expect(errors).toEqual([]);
});
