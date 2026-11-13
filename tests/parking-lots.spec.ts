import {test,expect,type Page} from '@playwright/test';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
/** The headlamp glow of every pooled fleet in the scene (the traffic, the kerbside cars, the cars in the lots), by the group that holds it. */
const lamps=(page:Page)=>page.evaluate(()=>{const out:Record<string,number>={};(window as any).__backbay?.scene?.traverse((o:any)=>{if(o.name==='NPC near lamp')out[o.parent.name]=o.material.emissiveIntensity;});return out;});
const light=(page:Page,mode:string)=>page.evaluate(mode=>(document.querySelector(`[data-light="${mode}"]`) as HTMLElement).click(),mode);

test('the lots by Charles Circle hold parked cars, each drawn as its own model and lit at night with the traffic',async({page},testInfo)=>{
 test.setTimeout(300000);await page.setViewportSize({width:1600,height:900});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 // Golden hour: the three fleets' lamps are dim alike.
 let glow=await lamps(page);expect(Object.keys(glow).sort()).toEqual(['AmbientTraffic','ParkedVehicles','ParkingLots']);
 expect(glow.ParkingLots).toBeLessThan(1);expect(glow.ParkingLots).toBe(glow.AmbientTraffic);expect(glow.ParkingLots).toBe(glow.ParkedVehicles);
 // On Charlesbank Road between the hospital's lots, north of the Longfellow Bridge's approach.
 await page.evaluate(()=>(window as any).__backbay.travelTo(300,-1400,0));
 await expect.poll(async()=>(await snapshot(page)).parkingLots.cars,{timeout:120000}).toBeGreaterThan(40);
 const lots=(await snapshot(page)).parkingLots;expect(lots.cars).toBeLessThanOrEqual(220);expect(lots.stalls).toBeGreaterThan(lots.cars);expect(lots.placed.length).toBe(lots.cars);
 // A slot of the pool draws one model: no car stands in its stall as another.
 for(const car of lots.placed)expect(car.model,`the ${car.type} at ${car.x.toFixed(0)}, ${car.z.toFixed(0)}`).toBe(car.type);
 expect(new Set(lots.placed.map((car:any)=>car.type)).size,'cars of several models').toBeGreaterThanOrEqual(3);
 // At night the lot cars' lamps glow with the traffic's and the kerbside cars', and dim with them again.
 await light(page,'night');expect((await snapshot(page)).lighting).toBe('night');
 glow=await lamps(page);expect(glow.ParkingLots,'the lot cars\' lamps glow at night').toBeGreaterThan(2);expect(glow.ParkingLots).toBe(glow.AmbientTraffic);expect(glow.ParkingLots).toBe(glow.ParkedVehicles);
 await page.waitForTimeout(1500);await page.screenshot({path:testInfo.outputPath('charles-circle-lots-night.png')});
 await light(page,'golden');glow=await lamps(page);expect(glow.ParkingLots).toBeLessThan(1);expect(glow.ParkingLots).toBe(glow.AmbientTraffic);expect(glow.ParkingLots).toBe(glow.ParkedVehicles);
 expect((await snapshot(page)).tiles.failed).toBe(0);expect(errors).toEqual([]);
});
