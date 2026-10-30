import {test,expect,type Page} from '@playwright/test';
import type {Road} from '../src/types';
import {tunnelStations,tunnelPointAt} from '../src/simulation/tunnels';
import {roadProjection} from '../src/simulation/road-surfaces';
import {carSteeringLimit} from '../src/physics/vehicle';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
function interiorStation(road:Road){
  const length=tunnelStations(road).at(-1)!;
  const intervals=road.tunnel!.covered??[[0,length]],longest=intervals.slice().sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
  return longest[0]+Math.min(140,(longest[1]-longest[0])*.3);
}
async function arrive(page:Page,road:Road,station:number,reverse=false){
  const p=tunnelPointAt(road,station);await page.evaluate(async p=>{await (window as any).__backbay.travelTo(p.x,p.z,p.yaw,p.roadId);},{...p,yaw:p.yaw+(reverse?Math.PI:0),roadId:road.id});
  await page.keyboard.down('Space');await page.waitForTimeout(900);await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(220);await page.keyboard.up('Space');return p;
}
async function follow(page:Page,road:Road,start:number,end:number){
  await arrive(page,road,start);const stations=tunnelStations(road),began=Date.now();let current=start,state=(await snapshot(page)).state;
  await page.keyboard.down('w');
  try{while(current<end-4&&Date.now()-began<70000){
    const hit=roadProjection(road,state.x,state.z);current=stations[hit.index]+(stations[hit.index+1]-stations[hit.index])*hit.t;
    const target=tunnelPointAt(road,Math.min(end,current+12)),desired=Math.atan2(target.x-state.x,target.z-state.z),error=Math.atan2(Math.sin(desired-state.yaw),Math.cos(desired-state.yaw));
    const steer=Math.atan2(2*2.66*Math.sin(error),Math.max(4,Math.hypot(target.x-state.x,target.z-state.z)))/carSteeringLimit(state.speed);
    await page.evaluate(value=>{(window as any).__tunnelSteer=value;},Math.max(-1,Math.min(1,steer)));
    if(state.speed<9)await page.keyboard.down('w');else await page.keyboard.up('w');
    await page.waitForTimeout(90);state=(await snapshot(page)).state;
    expect(state.y).toBeLessThan(tunnelPointAt(road,current).y+2.5);
  }}finally{await page.keyboard.up('w');await page.evaluate(()=>{(window as any).__tunnelSteer=0;});await page.keyboard.down('Space');await page.waitForTimeout(500);await page.keyboard.up('Space');}
  expect(current,'vehicle traverses the continuous tunnel route').toBeGreaterThan(end-5);return state;
}

test('Central Artery desktop interiors, surface ramp, Zakim connection and south closure',async({page,request},testInfo)=>{
  test.setTimeout(300000);await page.setViewportSize({width:1600,height:900});const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(m.text()))errors.push(m.text());});
  const data=await(await request.get('/data/central-artery.json')).json(),roads=data.roads as Road[];
  const main=roads.filter(r=>r.tunnel?.capStart||r.tunnel?.capEnd).sort((a,b)=>(tunnelStations(b).at(-1)??0)-(tunnelStations(a).at(-1)??0))[0];expect(main).toBeTruthy();
  const station=interiorStation(main),p=tunnelPointAt(main,station);
  await page.addInitScript(s=>{
    localStorage.setItem('backbay-drive-v1',JSON.stringify(s));(window as any).__tunnelSteer=0;
    Object.defineProperty(navigator,'getGamepads',{value:()=>[{axes:[-(window as any).__tunnelSteer],buttons:Array.from({length:8},()=>({value:0,pressed:false}))}]});
  },{x:p.x,z:p.z,yaw:p.yaw,roadId:main.id});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  await page.waitForTimeout(1400);let s=await snapshot(page);expect(s.state.y).toBeLessThan(p.y+2);expect(s.bridges.tunnels.roads).toBe(roads.length);expect(s.tiles.failed).toBe(0);
  await page.screenshot({path:testInfo.outputPath('central-artery-interior-desktop.png')});
  await follow(page,main,station,station+100);await page.keyboard.press('c');await page.waitForTimeout(500);await page.screenshot({path:testInfo.outputPath('central-artery-hood.png')});
  await page.keyboard.press('c');await page.waitForTimeout(500);s=await snapshot(page);const at=roadProjection(main,s.state.x,s.state.z),current=tunnelStations(main)[at.index]+(tunnelStations(main)[at.index+1]-tunnelStations(main)[at.index])*at.t;
  expect(s.cameraPosition.y).toBeLessThan(tunnelPointAt(main,current).y+main.tunnel!.clearance+.2);await page.keyboard.press('c');
  const ramp=roads.find(r=>r.id==='central-artery-new-chardon-south-on')!;expect(ramp).toBeTruthy();
  {
    const start=Math.min(8,ramp.tunnel!.covered![0][0]*.1),end=Math.min(tunnelStations(ramp).at(-1)!-10,ramp.tunnel!.covered![0][0]+35);
    await arrive(page,ramp,start);await page.screenshot({path:testInfo.outputPath('central-artery-surface-entrance.png')});await follow(page,ramp,start,end);
    await page.screenshot({path:testInfo.outputPath('central-artery-entered-from-surface.png')});
  }
  const length=tunnelStations(main).at(-1)!,capStart=!!main.tunnel!.capStart,capStation=capStart?23:length-23;
  await arrive(page,main,capStation,capStart);await page.screenshot({path:testInfo.outputPath('central-artery-south-closure.png')});
  await page.keyboard.down('w');await page.waitForTimeout(5500);await page.keyboard.up('w');s=await snapshot(page);const capHit=roadProjection(main,s.state.x,s.state.z),capProgress=tunnelStations(main)[capHit.index]+(tunnelStations(main)[capHit.index+1]-tunnelStations(main)[capHit.index])*capHit.t;
  expect(capStart?capProgress:length-capProgress,'concrete barriers stop the car before the unlit continuation').toBeGreaterThan(5.1);
  expect(Math.abs(s.state.speed)).toBeLessThan(2);
  await arrive(page,main,station);await page.keyboard.press('2');await page.waitForTimeout(1200);s=await snapshot(page);expect(s.travelMode).toBe('bike');expect(s.state.y).toBeLessThan(p.y+2);await page.screenshot({path:testInfo.outputPath('central-artery-ultrabee.png')});
  // Drive the ascending northern portal and continue onto the unchanged
  // surveyed Zakim deck: a screenshot alone cannot prove that seam is usable.
  await page.keyboard.press('1');
  const north=roads.find(r=>r.id==='central-artery-northbound')!,northLength=tunnelStations(north).at(-1)!;
  await follow(page,north,northLength-150,northLength-7);await page.screenshot({path:testInfo.outputPath('central-artery-zakim-approach.png')});
  const before=(await snapshot(page)).state;expect(1-2*(before.rotation.x**2+before.rotation.z**2),'Zakim landing must not tip the car onto its median').toBeGreaterThan(.96);await page.keyboard.down('w');await page.waitForTimeout(3200);await page.keyboard.up('w');s=await snapshot(page);
  expect(Math.hypot(s.state.x-before.x,s.state.z-before.z),'cross the tunnel-to-Zakim seam').toBeGreaterThan(8);expect(s.state.y).toBeGreaterThan(8);
  const join=tunnelPointAt(north,northLength),lateral=(s.state.x-join.x)*Math.cos(join.yaw)-(s.state.z-join.z)*Math.sin(join.yaw);
  expect(Math.abs(lateral),'stay in the northbound surveyed carriageway').toBeLessThan(north.width/2-1);
  expect(1-2*(s.state.rotation.x**2+s.state.rotation.z**2),'remain upright across the bridge seam').toBeGreaterThan(.96);
  await page.screenshot({path:testInfo.outputPath('central-artery-zakim-crossed.png')});
  expect(errors).toEqual([]);
});

test.describe('mobile tunnel view',()=>{
  test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:3});
  test('portrait car and bike remain inside the tunnel',async({page,request},testInfo)=>{
    test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const data=await(await request.get('/data/central-artery.json')).json(),road=(data.roads as Road[]).find(r=>r.tunnel?.capEnd||r.tunnel?.capStart)!;const p=tunnelPointAt(road,interiorStation(road));
    await page.addInitScript(s=>localStorage.setItem('backbay-drive-v1',JSON.stringify(s)),{x:p.x,z:p.z,yaw:p.yaw,roadId:road.id});
    await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').tap();await page.waitForTimeout(1500);
    let s=await snapshot(page);expect(s.mobile).toBe(true);expect(s.cameraPosition.y).toBeLessThan(p.y+road.tunnel!.clearance+.2);expect(s.graphicsContext.losses).toBe(0);await page.screenshot({path:testInfo.outputPath('central-artery-interior-mobile.png')});
    await page.locator('#open-settings').tap();await page.locator('#settings-modal [data-travel="bike"]').tap();await page.locator('#resume-drive').tap();await page.waitForTimeout(900);
    s=await snapshot(page);expect(s.travelMode).toBe('bike');expect(s.state.y).toBeLessThan(p.y+2);expect(s.cameraPosition.y).toBeLessThan(p.y+road.tunnel!.clearance+.2);await page.screenshot({path:testInfo.outputPath('central-artery-bike-mobile.png')});expect(errors).toEqual([]);
  });
});

test('reported tunnel junctions, portal edges and reverse-facing signs',async({page,request},testInfo)=>{
  test.setTimeout(180000);await page.setViewportSize({width:1600,height:1000});const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(m.text()))errors.push(m.text());});
  const locations=[
    {name:'north-street-surface-merge',x:1615.40,z:-1272.73,yaw:-1.0177,roadId:undefined,y:.97},
    {name:'haymarket-junction-roof',x:1360.24,z:-1543.36,yaw:-2.0711,roadId:'central-artery-southbound',y:-7.84},
    {name:'government-center-sign-rear',x:1339.78,z:-1573.02,yaw:-2.3482,roadId:'central-artery-southbound',y:-6.07},
    {name:'mercantile-portal-edge',x:1799.67,z:-1194.68,yaw:-2.1767,roadId:undefined,y:.05},
  ];
  await page.addInitScript(s=>localStorage.setItem('backbay-drive-v1',JSON.stringify(s)),locations[0]);
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  for(const place of locations){
    await page.evaluate(async p=>{await (window as any).__backbay.travelTo(p.x,p.z,p.yaw,p.roadId);},place);await page.keyboard.down('Space');await page.waitForTimeout(1400);await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(220);
    const state=await snapshot(page);expect(state.tiles.failed).toBe(0);expect(state.graphicsContext.losses).toBe(0);
    expect(Math.abs(state.state.y-place.y),'reported position remains supported without falling through the roadway').toBeLessThan(1.5);
    await page.screenshot({path:testInfo.outputPath(`${place.name}.png`)});await page.keyboard.up('Space');
  }
  // The same exit sign is approached in the legal traffic direction as well
  // as from its back in the user report; only its front should carry text.
  const roads=(await(await request.get('/data/central-artery.json')).json()).roads as Road[],south=roads.find(r=>r.id==='central-artery-southbound')!;
  await arrive(page,south,270);await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(220);await page.screenshot({path:testInfo.outputPath('government-center-sign-front.png')});
  expect(errors).toEqual([]);
});

test('North Street exit continues onto its surface street beyond the ramp endpoint',async({page,request},testInfo)=>{
  test.setTimeout(150000);const data=await(await request.get('/data/central-artery.json')).json(),ramp=(data.roads as Road[]).find(r=>r.id==='central-artery-government-center-north-off')!;
  const length=tunnelStations(ramp).at(-1)!,end=tunnelPointAt(ramp,length),p=tunnelPointAt(ramp,length-45);
  const surface=((await(await request.get('/data/city.json')).json()).roads as Road[]).find(r=>r.id==='13160-0-0')!;
  const continuation=surface.points.slice(0,-1).reverse();
  const continued:Road={...ramp,points:[...ramp.points,...continuation],elevations:[...ramp.elevations!,...continuation.map(()=>end.y)]};
  await page.addInitScript(s=>{
    localStorage.setItem('backbay-drive-v1',JSON.stringify(s));(window as any).__tunnelSteer=0;
    Object.defineProperty(navigator,'getGamepads',{value:()=>[{axes:[-(window as any).__tunnelSteer],buttons:Array.from({length:8},()=>({value:0,pressed:false}))}]});
  },{x:p.x,z:p.z,yaw:p.yaw,roadId:ramp.id});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  const state=await follow(page,continued,length-45,length+15);
  expect((state.x-end.x)*Math.sin(end.yaw)+(state.z-end.z)*Math.cos(end.yaw),'drive onto the street, beyond merely reaching the ramp endpoint').toBeGreaterThan(9);
  expect(1-2*(state.rotation.x**2+state.rotation.z**2),'exit without riding over a barrier').toBeGreaterThan(.97);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.screenshot({path:testInfo.outputPath('north-street-exit-onto-surface.png')});
});

test('southern tunnel closures have tiled ceilings, a falling-tile warning and dark depth beyond intact barriers',async({page,request},testInfo)=>{
  test.setTimeout(180000);await page.setViewportSize({width:1600,height:1000});const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(m.text()))errors.push(m.text());});
  const roads=((await(await request.get('/data/central-artery.json')).json()).roads as Road[]).filter(r=>r.tunnel?.capStart||r.tunnel?.capEnd);
  const reported={x:1168.76,z:328.89,yaw:-.2685,roadId:'central-artery-southbound'};
  await page.addInitScript(s=>localStorage.setItem('backbay-drive-v1',JSON.stringify(s)),reported);
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
  await page.keyboard.down('Space');await page.waitForTimeout(1400);await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(220);
  let state=await snapshot(page);expect(Math.abs(state.state.y+11.34)).toBeLessThan(.8);await page.screenshot({path:testInfo.outputPath('southbound-closure-reported-position.png')});await page.keyboard.up('Space');
  const appearance=await page.evaluate(routes=>{
    const scene=(window as any).__backbay.scene,signs:string[]=[];scene.traverse((o:any)=>{if(o.userData.tunnelSignFace)signs.push(o.name);});
    scene.updateMatrixWorld(true);
    return{signs,ceilings:routes.map(({name})=>{const ceiling=scene.getObjectByName(`${name} ceiling`);return{name,textured:!!ceiling?.material?.map,uvCount:ceiling?.geometry?.attributes?.uv?.count??0};}),extensions:routes.map(route=>{
      const group=scene.getObjectByName(`${route.name} unlit continuation`);let depth=0,lights=0;
      group?.traverse((o:any)=>{if(o.isLight)lights++;const p=o.geometry?.attributes?.position;if(p)for(let i=0;i<p.count;i++){const point=o.localToWorld(o.position.clone().set(p.getX(i),p.getY(i),p.getZ(i)));depth=Math.max(depth,(point.x-route.x)*route.dx+(point.z-route.z)*route.dz);}});
      return{roadId:group?.userData?.terminalRoadId,depth,lights,darknessDistance:group?.userData?.darknessDistance,oldFlatCap:!!scene.getObjectByName(`${route.name} black void`)};
    })};
  },roads.map(r=>{const p=tunnelPointAt(r,r.tunnel!.capStart?0:tunnelStations(r).at(-1)!),yaw=p.yaw+(r.tunnel!.capStart?Math.PI:0);return{name:r.name,x:p.x,z:p.z,dx:Math.sin(yaw),dz:Math.cos(yaw)};}));
  expect(appearance.signs.some(name=>/BOSTON LURE/i.test(name)),'the old plaque is replaced').toBe(false);
  expect(appearance.signs.filter(name=>/FALLING CEILING TILES/i.test(name))).toHaveLength(2);
  for(const ceiling of appearance.ceilings){expect(ceiling.textured,`${ceiling.name} has visible tilework`).toBe(true);expect(ceiling.uvCount).toBeGreaterThan(0);}
  for(const extension of appearance.extensions){expect(extension.roadId).toBeTruthy();expect(extension.depth,'darkness has real tunnel depth beyond the barrier').toBeGreaterThan(80);expect(extension.darknessDistance).toBeLessThan(extension.depth);expect(extension.lights).toBe(0);expect(extension.oldFlatCap).toBe(false);}
  for(const road of roads){
    const total=tunnelStations(road).at(-1)!,atStart=!!road.tunnel!.capStart,station=(distance:number)=>atStart?distance:total-distance;
    await arrive(page,road,station(35),atStart);await page.screenshot({path:testInfo.outputPath(`${road.id}-dark-closure-approach.png`)});
    await arrive(page,road,station(12),atStart);await page.keyboard.press('c');await page.waitForTimeout(500);await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(220);
    await page.screenshot({path:testInfo.outputPath(`${road.id}-dark-closure-hood.png`)});
    await page.keyboard.press('c');await page.keyboard.press('c');
    await arrive(page,road,station(24),atStart);await page.keyboard.down('w');await page.waitForTimeout(5500);await page.keyboard.up('w');state=await snapshot(page);
    const hit=roadProjection(road,state.state.x,state.state.z),stations=tunnelStations(road),progress=stations[hit.index]+(stations[hit.index+1]-stations[hit.index])*hit.t;
    expect(atStart?progress:total-progress,'the visual continuation does not let the car bypass concrete barriers').toBeGreaterThan(5.1);
    expect(Math.abs(state.state.speed)).toBeLessThan(2);expect(1-2*(state.state.rotation.x**2+state.state.rotation.z**2)).toBeGreaterThan(.96);
    await arrive(page,road,station(45),!atStart);await page.screenshot({path:testInfo.outputPath(`${road.id}-ceiling-facing-interior.png`)});
  }
  state=await snapshot(page);expect(state.tiles.failed).toBe(0);expect(state.graphicsContext.losses).toBe(0);expect(errors).toEqual([]);
});

test.describe('mobile terminal atmosphere',()=>{
  test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true,deviceScaleFactor:3});
  test('dark southern continuation remains visible in portrait',async({page,request},testInfo)=>{
    test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(m.text()))errors.push(m.text());});
    const data=await(await request.get('/data/central-artery.json')).json(),roads=data.roads as Road[],road=roads.find(r=>r.id==='central-artery-southbound')!,p=tunnelPointAt(road,tunnelStations(road).at(-1)!-22);
    await page.addInitScript(s=>localStorage.setItem('backbay-drive-v1',JSON.stringify(s)),{x:p.x,z:p.z,yaw:p.yaw,roadId:road.id});
    await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').tap();await page.waitForTimeout(1800);await page.locator('#cycle-camera').tap();await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.waitForTimeout(220);
    const state=await snapshot(page);expect(state.mobile).toBe(true);expect(state.camera).toBe('hood');expect(state.bridges.tunnels.darkContinuations).toBe(2);expect(state.graphicsContext.losses).toBe(0);expect(state.state.y).toBeLessThan(-10);
    await page.screenshot({path:testInfo.outputPath('southbound-dark-closure-mobile.png')});expect(errors).toEqual([]);
  });
});
