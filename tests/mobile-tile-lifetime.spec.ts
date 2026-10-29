import {test,expect} from '@playwright/test';

test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
test('paced tiles download once and leave no orphan scenes or colliders after revisiting neighborhoods',async({page})=>{
  test.setTimeout(180000);
  const requests:string[]=[];
  page.on('request',request=>{if(request.url().includes('/data/tiles/'))requests.push(request.url());});
  const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
  const settled=async()=>{
    await expect.poll(async()=>{const s=await snapshot();return !s.tiles.building&&!s.tiles.fetching&&!s.tiles.pending&&s.tiles.loaded>=4;},{timeout:60000}).toBe(true);
    await page.waitForTimeout(1000);
  };
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').tap();await page.getByTestId('mode-bike').tap();await settled();
  // A second request for an in-progress tile used to enqueue a duplicate build.
  expect(requests.length).toBe(new Set(requests).size);
  const start=await page.evaluate(()=>(window as any).__backbay.city.spawn);
  const hill=await page.evaluate(()=>(window as any).__backbay.city.landmarks.find((l:any)=>l.id==='mission-hill').driveStart);
  const visits:Record<string,any>[]=[];
  for(const destination of [hill,start,hill,start]){
    await page.evaluate(async p=>{await (window as any).__backbay.travelTo(p.x,p.z,p.yaw);},destination);await settled();
    const s=await snapshot();expect(s.tiles.residentGroups).toBe(s.tiles.loaded);
    visits.push({keys:[...s.tiles.keys].sort(),colliders:s.physicsColliders,objects:s.sceneObjects});
  }
  expect(visits[2]).toEqual(visits[0]);expect(visits[3]).toEqual(visits[1]);
});
