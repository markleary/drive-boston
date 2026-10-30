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
  await page.waitForTimeout(900);return p;
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
  expect(capStart?capProgress:length-capProgress,'concrete barriers stop the car before the black void').toBeGreaterThan(5.1);
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
