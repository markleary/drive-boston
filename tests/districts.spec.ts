import { test, expect, type Page } from '@playwright/test';

interface Position { x:number; y:number; z:number; yaw:number; speed:number; }
interface Snapshot {
  state:Position; flight:Position; groundHeight:number; flightGroundHeight:number;
  paused:boolean; travelMode:'drive'|'helicopter';
}
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:{snapshot():Snapshot}}).__backbay.snapshot());
async function start(page:Page){
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
}
const newPlaces=['fenway-park','kenmore-square','state-house','downtown-crossing','chinatown-gate','boston-common','public-garden'];

test('connected Boston: visit the new districts and parks, drive, and inspect the Common from above',async({page},testInfo)=>{
  test.setTimeout(180000);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  await start(page);
  await page.keyboard.press('m');
  await page.getByRole('button',{name:'Show all Boston destinations'}).click();
  for(const id of newPlaces)await expect(page.locator(`[data-destination="${id}"]`)).toHaveCount(1);
  const metadata=await page.evaluate(()=>{
    const city=(window as unknown as {__backbay:{city:{neighborhoods:{name:string}[];parks:{name:string}[]}}}).__backbay.city;
    return{neighborhoods:city.neighborhoods.map(n=>n.name),parks:city.parks.map(p=>p.name)};
  });
  expect(metadata.neighborhoods).toEqual(expect.arrayContaining(['Fenway','Back Bay','Beacon Hill','Downtown','Chinatown','Mission Hill']));
  expect(metadata.parks).toEqual(expect.arrayContaining(['Boston Common','Public Garden']));
  await page.screenshot({path:testInfo.outputPath('boston-city-atlas.png')});
  for(const id of newPlaces){
    if(!(await page.locator('#map-modal').isVisible()))await page.keyboard.press('m');
    const destination=page.locator(`[data-destination="${id}"]`);
    await destination.scrollIntoViewIfNeeded();
    const before=(await snapshot(page)).state;
    await destination.click();
    await expect(page.locator('#map-modal')).toBeHidden();
    await expect.poll(async()=>{const now=(await snapshot(page)).state;return Math.hypot(now.x-before.x,now.z-before.z);}).toBeGreaterThan(30);
    await expect.poll(async()=>{const now=await snapshot(page);return now.state.y-now.groundHeight;}).toBeGreaterThan(.2);
    await expect.poll(async()=>{const now=await snapshot(page);return now.state.y-now.groundHeight;}).toBeLessThan(2.5);
    expect((await snapshot(page)).paused).toBe(false);
    const district:Record<string,string>={'fenway-park':'Fenway','kenmore-square':'Fenway','state-house':'Beacon Hill','downtown-crossing':'Downtown','chinatown-gate':'Chinatown','boston-common':'Beacon Hill','public-garden':'Beacon Hill'};
    await expect(page.locator('#neighborhood-label')).toContainText(district[id]);
    if(['fenway-park','state-house','chinatown-gate'].includes(id)){
      const arrival=(await snapshot(page)).state;
      await page.keyboard.down('w');
      try{await expect.poll(async()=>{const now=(await snapshot(page)).state;return Math.hypot(now.x-arrival.x,now.z-arrival.z);},{timeout:15000}).toBeGreaterThan(2);}
      finally{await page.keyboard.up('w');}
      await page.keyboard.down('Space');
      try{await expect.poll(async()=>Math.abs((await snapshot(page)).state.speed)).toBeLessThan(.4);}
      finally{await page.keyboard.up('Space');}
      await page.screenshot({path:testInfo.outputPath(`${id}-drive.png`)});
    }
  }
  await page.keyboard.press('3');
  await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('helicopter');
  await page.keyboard.press('m');
  await page.locator('[data-destination="boston-common"]').click();
  const airborne=await snapshot(page);
  await page.keyboard.down('Space');
  try{await expect.poll(async()=>(await snapshot(page)).flight.y,{timeout:15000}).toBeGreaterThan(airborne.flight.y+12);}
  finally{await page.keyboard.up('Space');}
  await expect.poll(async()=>{const current=await snapshot(page),displayed=Number(await page.locator('#altitude-value').textContent());return Math.abs(displayed-(current.flight.y-current.flightGroundHeight)*3.28084);}).toBeLessThan(2);
  await page.screenshot({path:testInfo.outputPath('common-helicopter.png')});
  await page.keyboard.press('1');
  await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('drive');
  expect(errors).toEqual([]);
});

test.describe('expanded atlas on phone',()=>{
  test.use({viewport:{width:375,height:812},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  test('all destinations remain reachable without covering the map',async({page},testInfo)=>{
    test.setTimeout(120000);
    await start(page);
    await page.getByRole('button',{name:'Open map',exact:true}).click();
    const places=await page.locator('#map-places').boundingBox();
    expect(places!.height).toBeLessThan(280);
    expect(places!.y).toBeGreaterThan(450);
    for(const id of newPlaces){
      const destination=page.locator(`[data-destination="${id}"]`);
      await destination.scrollIntoViewIfNeeded();
      const box=await destination.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(15);
      expect(box!.x+box!.width).toBeLessThanOrEqual(360);
      expect(box!.y).toBeGreaterThanOrEqual(places!.y);
      expect(box!.y+box!.height).toBeLessThanOrEqual(places!.y+places!.height);
    }
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({path:testInfo.outputPath('boston-atlas-phone.png')});
    await page.locator('[data-destination="public-garden"]').click();
    await expect(page.locator('#map-modal')).toBeHidden();
    await expect(page.getByRole('button',{name:'Accelerate',exact:true})).toBeVisible();
  });
});
