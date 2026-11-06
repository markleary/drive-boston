import {test,expect,type Page} from '@playwright/test';

type Point=[number,number];
async function start(page:Page){
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
}
const landmark=(page:Page,name:string)=>page.evaluate(name=>(window as any).__backbay.city.landmarks.find((l:{name:string})=>l.name===name).position as Point,name);
const gps=(page:Page)=>page.evaluate(()=>(window as any).__backbay.gps.snapshot());
/** Pixels of the route blue (#2a78d4) on a map canvas. */
const routePixels=(page:Page,selector:string)=>page.evaluate(selector=>{
  const canvas=document.querySelector<HTMLCanvasElement>(selector)!,data=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
  let count=0;for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-42)<14&&Math.abs(data[i+1]-120)<14&&Math.abs(data[i+2]-212)<14)count++;return count;
},selector);

test('GPS: a map tap routes there, the HUD gives directions, and Clear destination resets it',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await start(page);
  const guide=page.getByTestId('gps-guide'),card=page.getByTestId('map-route-card'),toast=page.locator('#toast');
  await expect(guide).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('#map-modal')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.locator('#map-route-hint')).toHaveText(/Click any street on the map/);

  // A drag pans the atlas and sets nothing.
  const map=(await page.locator('#fullmap').boundingBox())!;
  await page.mouse.move(map.x+map.width*.4,map.y+map.height*.5);await page.mouse.down();
  await page.mouse.move(map.x+map.width*.4+80,map.y+map.height*.5+30,{steps:6});await page.mouse.up();
  expect((await gps(page)).active).toBe(false);

  // Tapping the harbor, far from any street, sets nothing either and says so over the map.
  const water=await page.evaluate(()=>(window as any).__backbay.gps.mapScreenPoint(4000,2500) as Point);
  await page.mouse.click(...water);
  await expect(toast).toHaveText('No streets near there');
  expect((await gps(page)).active).toBe(false);

  const fenway=await page.evaluate(([x,z])=>(window as any).__backbay.gps.mapScreenPoint(x,z) as Point,await landmark(page,'Fenway Park'));
  await page.mouse.click(...fenway);
  await expect(card).toBeVisible();
  await expect(page.locator('#map-route-hint')).toBeHidden();
  await expect(page.locator('#map-route-name')).toHaveText('Lansdowne Street');
  await expect(page.locator('#map-route-meta')).toHaveText(/^Fenway · [\d.]+ mi · \d+ min$/);
  await expect(page.getByTestId('clear-destination')).toBeVisible();
  await expect(toast).toHaveText(/^Route set · [\d.]+ mi · \d+ min$/);
  const plan=await gps(page);
  expect(plan.active).toBe(true);expect(plan.wrongWay).toBe(false);
  expect(plan.length).toBeGreaterThan(1500);
  expect(plan.steps.at(-1).kind).toBe('arrive');
  expect(await routePixels(page,'#fullmap')).toBeGreaterThan(40);
  await page.screenshot({path:testInfo.outputPath('gps-atlas-route.png')});

  // Driving view: the location pill becomes the turn-by-turn display, and the minimap draws the route.
  await page.keyboard.press('m');
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect(guide).toBeVisible();
  await expect(page.locator('#gps-instruction')).toHaveText(/^(Turn|Bear|Continue|Make|Merge|Take) .+ on [A-Z]/);
  await expect(page.locator('#gps-distance')).toHaveText(/^[\d.]+ (ft|mi)$/);
  await expect(page.locator('#gps-summary')).toHaveText(/ · [\d.]+ mi · \d+ min$/);
  await expect(page.locator('#location-label')).toBeHidden();
  await expect.poll(()=>routePixels(page,'#minimap')).toBeGreaterThan(40);
  await page.screenshot({path:testInfo.outputPath('gps-hud.png')});

  // Driving toward the first maneuver brings it closer.
  const before=(await gps(page)).guidance.distance;
  await page.keyboard.down('KeyW');await page.waitForTimeout(2500);await page.keyboard.up('KeyW');
  await expect.poll(async()=>(await gps(page)).guidance?.distance??Infinity).toBeLessThan(before-5);

  await page.keyboard.press('m');
  await page.getByTestId('clear-destination').click();
  await expect(card).toBeHidden();
  await expect(page.locator('#map-route-hint')).toBeVisible();
  await expect(toast).toHaveText('Destination cleared');
  expect(await routePixels(page,'#fullmap')).toBe(0);
  await page.keyboard.press('m');
  await expect(guide).toBeHidden();
  await expect(page.locator('#location-label')).toBeVisible();
  expect((await gps(page)).active).toBe(false);
  expect(errors).toEqual([]);
});

test('GPS: the helicopter points straight at the destination, and arriving ends the route',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await start(page);
  const house=await landmark(page,'Massachusetts State House');
  expect(await page.evaluate(([x,z])=>(window as any).__backbay.gps.setDestination(x,z),house)).not.toBeNull();
  await expect(page.getByTestId('gps-guide')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#gps-instruction')).toHaveText(/^Destination to the (north|east|northeast)$/);
  await expect(page.locator('#gps-arrow')).toHaveAttribute('style',/rotate\(/);
  await page.screenshot({path:testInfo.outputPath('gps-helicopter.png')});
  await page.keyboard.press('1');
  await expect(page.locator('#gps-instruction')).toHaveText(/^(Turn|Bear|Continue|Make|Merge|Take) /);
  // Arriving at the destination ends guidance.
  const destination=(await gps(page)).destination as Point;
  await page.evaluate(([x,z])=>(window as any).__backbay.travelTo(x,z,0),destination);
  await expect(page.locator('#toast')).toHaveText('You have arrived',{timeout:30000});
  await expect(page.getByTestId('gps-guide')).toBeHidden();
  expect((await gps(page)).active).toBe(false);
  expect(errors).toEqual([]);
});
