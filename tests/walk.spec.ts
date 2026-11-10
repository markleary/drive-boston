import {test,expect,type Page} from '@playwright/test';
type Walker={x:number;y:number;z:number;yaw:number;viewYaw:number;speed:number;grounded:boolean;run:number;air:number;knocked:string|null;sprawl:number};
type Snapshot={state:{x:number;y:number;z:number;speed:number};walker:Walker;travelMode:string;camera:string;vehicleScreenBounds:unknown;audio:{engineGain:number}};
type Hooks={snapshot():Snapshot;walker:{strike(threats:object[]):number|undefined};city:{roads:{points:[number,number][];width:number;pavedWidth?:number;elevations?:number[];tunnel?:unknown}[]}};
const snapshot=(page:Page)=>page.evaluate(()=>(window as unknown as {__backbay:Hooks}).__backbay.snapshot());
async function start(page:Page){await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();await expect(page.locator('#welcome')).toBeHidden();}
/** Distance from (x, z) to the nearest surface street's centreline, less half its roadway: positive on the sidewalk side of the curb. */
const beyondCurb=(page:Page,x:number,z:number)=>page.evaluate(([x,z])=>{
  let best=Infinity,margin=0;
  for(const road of (window as unknown as {__backbay:Hooks}).__backbay.city.roads){
    if(road.elevations||road.tunnel)continue;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1))),d=Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
      if(d<best){best=d;margin=d-(road.pavedWidth??road.width)/2;}
    }
  }
  return margin;
},[x,z]);

test('walk mode: step out, walk, run, jump, first person, sidewalk reset and back to the car',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(m.text()))errors.push(m.text());});
  await start(page);
  const car=(await snapshot(page)).state;
  await page.keyboard.press('4');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('walk');
  await expect(page.getByTestId('mode-walk')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#drive-hint')).toContainText('Run');await expect(page.locator('#drive-hint')).toContainText('Jump');
  await expect(page.locator('#camera-label')).toHaveText('Over the shoulder');
  const out=(await snapshot(page)).walker;
  expect(Math.hypot(out.x-car.x,out.z-car.z),'steps out beside the car').toBeLessThan(3.5);
  expect(Math.hypot(out.x-car.x,out.z-car.z)).toBeGreaterThan(1);
  await expect.poll(async()=>(await snapshot(page)).walker.grounded).toBe(true);
  expect((await snapshot(page)).vehicleScreenBounds,'the walker is on screen').not.toBeNull();
  await page.screenshot({path:testInfo.outputPath('walk-standing.png')});
  await page.keyboard.down('w');
  try{
    await expect.poll(async()=>(await snapshot(page)).walker.speed).toBeGreaterThan(1.5);
    expect((await snapshot(page)).walker.speed,'a walk, not a run').toBeLessThan(2);
    await expect(page.locator('#gear')).toHaveText('W');await expect(page.locator('#journey-label')).toHaveText('ON FOOT');
    await page.keyboard.down('Shift');
    await expect.poll(async()=>(await snapshot(page)).walker.speed).toBeGreaterThan(5);
    await expect(page.locator('#journey-label')).toHaveText('RUNNING');
    await expect.poll(async()=>(await snapshot(page)).walker.run).toBeGreaterThan(.9);
    await page.screenshot({path:testInfo.outputPath('walk-running.png')});
    await page.keyboard.press('Space');
    await expect.poll(async()=>(await snapshot(page)).walker.grounded,{intervals:[30]}).toBe(false);
    await expect.poll(async()=>(await snapshot(page)).walker.grounded).toBe(true);
  }finally{await page.keyboard.up('Shift');await page.keyboard.up('w');}
  await expect.poll(async()=>(await snapshot(page)).walker.speed).toBeLessThan(.05);
  const parked=(await snapshot(page)).state;
  expect(Math.hypot(parked.x-car.x,parked.z-car.z),'the car stays where it was left').toBeLessThan(.5);
  await expect.poll(async()=>(await snapshot(page)).audio.engineGain).toBeLessThan(.001);
  // First person hides the body and looks where the walker faces.
  await page.keyboard.press('c');await expect(page.locator('#camera-label')).toHaveText('First-person view');
  expect((await snapshot(page)).vehicleScreenBounds).toBeNull();
  await page.screenshot({path:testInfo.outputPath('walk-first-person.png')});
  await page.keyboard.press('c');await page.keyboard.press('c');await expect(page.locator('#camera-label')).toHaveText('Over the shoulder');
  // R returns to the closest sidewalk: beyond the curb of the nearest street.
  await page.keyboard.press('r');await expect(page.locator('#toast')).toHaveText('Back on the sidewalk.');
  const reset=(await snapshot(page)).walker;
  expect(await beyondCurb(page,reset.x,reset.z)).toBeGreaterThan(.8);expect(await beyondCurb(page,reset.x,reset.z)).toBeLessThan(2.5);
  await expect.poll(async()=>(await snapshot(page)).walker.grounded).toBe(true);
  await page.screenshot({path:testInfo.outputPath('walk-sidewalk.png')});
  // Back behind the wheel: the car comes to the nearest street when the walker has left it behind.
  await page.keyboard.press('1');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('drive');
  const back=await snapshot(page);
  expect(Math.hypot(back.state.x-reset.x,back.state.z-reset.z)).toBeLessThan(30);
  expect(errors).toEqual([]);
});

test('walk mode: a vehicle at speed knocks the player down, who gets up and walks on',async({page},testInfo)=>{
  await start(page);await page.keyboard.press('4');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('walk');
  await expect.poll(async()=>(await snapshot(page)).walker.grounded).toBe(true);
  const before=(await snapshot(page)).walker;
  // A car's footprint passing over the walker at 25 mph, as traffic reports it.
  const speed=await page.evaluate(w=>(window as unknown as {__backbay:Hooks}).__backbay.walker.strike([{x:w.x-Math.sin(w.yaw),y:w.y+.5,z:w.z-Math.cos(w.yaw),yaw:w.yaw,speed:11,halfLength:2.1,halfWidth:.9}]),before);
  expect(speed).toBe(11);
  await expect.poll(async()=>(await snapshot(page)).walker.knocked).toBe('air');
  await page.waitForTimeout(350);await page.screenshot({path:testInfo.outputPath('walk-thrown.png')});
  await expect.poll(async()=>(await snapshot(page)).walker.knocked,{timeout:20000}).toBe('down');
  const lying=(await snapshot(page)).walker;
  expect(Math.hypot(lying.x-before.x,lying.z-before.z),'thrown along the road').toBeGreaterThan(3);expect(lying.sprawl).toBe(1);
  await page.keyboard.down('w');
  try{
    expect((await snapshot(page)).walker.speed,'no walking while down').toBe(0);
    await expect.poll(async()=>(await snapshot(page)).walker.knocked,{timeout:20000}).toBe(null);
    await expect.poll(async()=>(await snapshot(page)).walker.speed).toBeGreaterThan(1.5);
  }finally{await page.keyboard.up('w');}
  expect((await snapshot(page)).walker.sprawl).toBe(0);
});
