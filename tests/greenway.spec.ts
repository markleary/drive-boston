import {test,expect,type Page} from '@playwright/test';

const stats=(page:Page)=>page.evaluate(()=>{
  const app=(window as any).__backbay,groups:any[]=[];
  app.scene.traverse((o:any)=>{if(o.name==='Rose Kennedy Greenway')groups.push(o.userData);});
  const snapshot=app.snapshot();return {groups,mobile:snapshot.mobile,tiles:snapshot.tiles,flight:snapshot.flight};
});
async function start(page:Page){
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
  await page.locator('#open-settings').click();await page.locator('[data-light="day"]').click();
  const mobileSwitch=page.locator('#settings-modal [data-travel="helicopter"]');
  if(await mobileSwitch.isVisible()){await mobileSwitch.click();await page.locator('#resume-drive').click();}
  else{await page.locator('#resume-drive').click();await page.getByRole('button',{name:'Helicopter mode',exact:true}).click();}
}
async function fly(page:Page,x:number,y:number,z:number,yaw=0){
  await page.evaluate(async p=>{await (window as any).__backbay.flyTo(...p);},[x,y,z,yaw]);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(500);
}

test('Greenway landscape: screenshot location, connected park corridor, street view and streaming return',async({page},testInfo)=>{
  test.setTimeout(180000);await page.setViewportSize({width:1500,height:1000});const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
  await start(page);await page.keyboard.press('c');
  await page.mouse.move(750,400);await page.mouse.down();await page.mouse.move(750,570,{steps:10});await page.mouse.up();
  await fly(page,1313.05,96.3,-1579.82,.4617);await page.screenshot({path:testInfo.outputPath('greenway-ramp-correction.png')});
  const first=await stats(page);expect(first.groups.reduce((n,g)=>n+g.features,0)).toBe(8);expect(first.groups.reduce((n,g)=>n+g.trees,0)).toBeGreaterThan(120);
  await fly(page,1470,72,-1454,.6);await page.screenshot({path:testInfo.outputPath('greenway-north-end.png')});
  // The frontage must not inherit the ordinary sidewalk bias, which pushes
  // even a physically higher brick face behind the road in the depth buffer.
  expect(await page.evaluate(()=>{
    const mesh=(window as any).__backbay.scene.getObjectByName('Cross Street brick frontage');
    return !!mesh?.visible&&(!mesh.material.polygonOffset||mesh.material.polygonOffsetFactor<=0);
  })).toBe(true);
  await fly(page,1501,24,-1454,.6);await page.screenshot({path:testInfo.outputPath('greenway-cross-street-frontage.png')});
  await fly(page,1749,80,-1260,.3);await page.screenshot({path:testInfo.outputPath('greenway-armenian-heritage.png')});
  // Top-down views keep nearby towers from hiding these narrower parcels.
  await page.keyboard.press('c');
  for(const [name,x,z] of [['rings',1882,-994],['fort-point',1818,-487],['dewey',1670,-389],['chinatown',1295,-179],['north-meadow',1323,-1640]] as const){
    await fly(page,x,65,z);await page.screenshot({path:testInfo.outputPath(`greenway-${name}.png`)});
  }
  // A low view checks terrain contact and the actual sidewalk scale.
  await page.keyboard.press('c');await page.keyboard.press('c');
  await page.mouse.move(750,570);await page.mouse.down();await page.mouse.move(750,400,{steps:10});await page.mouse.up();
  await fly(page,1500,3,-1359,Math.PI);await page.screenshot({path:testInfo.outputPath('greenway-street-view.png')});
  await fly(page,-2500,100,900);await fly(page,1313.05,96.3,-1579.82,.4617);
  const returned=await stats(page);
  expect(returned.groups.map(g=>[g.parcels,g.trees,g.features]).sort()).toEqual(first.groups.map(g=>[g.parcels,g.trees,g.features]).sort());
  expect(returned.tiles.failed).toBe(0);expect(errors).toEqual([]);
});

test.describe('Greenway mobile',()=>{
  test.use({viewport:{width:844,height:390},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  test('mapped landscape survives mobile buffer release',async({page},testInfo)=>{
    test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page);
    await fly(page,1774,80,-1209);await page.locator('#cycle-camera').click();await page.locator('#cycle-camera').click();
    await page.screenshot({path:testInfo.outputPath('greenway-mobile.png')});const s=await stats(page);
    expect(s.mobile).toBe(true);expect(s.groups.some(g=>g.features>=4)).toBe(true);expect(s.tiles.failed).toBe(0);expect(errors).toEqual([]);
  });
});
