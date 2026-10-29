import {test,expect} from '@playwright/test';
import {ULTRA_BEE} from '../src/physics/bike.ts';

test('Ultra Bee crosses a narrow footbridge tile seam on one continuous arch in both directions',async({page},testInfo)=>{
 test.setTimeout(180000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 const endpoints=[[-2992.205,481.463],[-3002.825,469.115]],seam={x:-3000,z:472.4,deck:-2.3713};
 const dx=endpoints[1][0]-endpoints[0][0],dz=endpoints[1][1]-endpoints[0][1],length=Math.hypot(dx,dz);
 const start={x:endpoints[0][0]-dx/length*6,z:endpoints[0][1]-dz/length*6,yaw:Math.atan2(dx,dz)};
 await page.addInitScript(position=>{
  localStorage.setItem('backbay-drive-v1',JSON.stringify(position));
  (window as any).__bridgeInput={steer:0,throttle:0,brake:0};
  Object.defineProperty(navigator,'getGamepads',{value:()=>{const input=(window as any).__bridgeInput;return[{axes:[-input.steer],buttons:Array.from({length:8},(_,i)=>({value:i===7?input.throttle:i===6?input.brake:0,pressed:false}))}];}});
 },start);
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();await page.keyboard.press('2');
 const snapshot=()=>page.evaluate(()=>(window as any).__backbay.snapshot());
 const input=(steer:number,throttle:number,brake=0)=>page.evaluate(value=>{(window as any).__bridgeInput=value;},{steer,throttle,brake});
 // The reset probe samples the loaded deck before suspension settles. Its
 // known spawn offset distinguishes the complete arch from the old seam dip.
 await page.evaluate(p=>(window as any).__backbay.travelTo(p.x,p.z,0),seam);
 const probe=await snapshot();expect(probe.tiles.keys).toEqual(expect.arrayContaining(['-3_0','-4_0']));
 expect(probe.state.y-ULTRA_BEE.spawnHeight,'the tile seam must use the full bridge deck elevation').toBeCloseTo(seam.deck,1);
 for(const reverse of [false,true]){
  const a=endpoints[reverse?1:0],b=endpoints[reverse?0:1],tx=(b[0]-a[0])/length,tz=(b[1]-a[1])/length;
  await input(0,0);await page.evaluate(v=>(window as any).__backbay.travelTo(v.x,v.z,v.yaw),{x:a[0]-tx*6,z:a[1]-tz*6,yaw:Math.atan2(tx,tz)});
  const began=Date.now();let arrived=false,captured=false,seamSamples=0;
  try{
   while(Date.now()-began<50000){
    const s=(await snapshot()).state,along=(s.x-a[0])*tx+(s.z-a[1])*tz,lateral=(s.x-a[0])*-tz+(s.z-a[1])*tx;
    if(along>length+3){arrived=true;break;}
    if(along>1&&along<length-1)expect(Math.abs(lateral),'the bike must stay on the 1.2 m deck').toBeLessThan(.48);
    if(Math.hypot(s.x-seam.x,s.z-seam.z)<.7){
     seamSamples++;expect(s.y,'the wheels must follow the full arch instead of dropping into the former tile seam').toBeGreaterThan(seam.deck+.38);
     if(!captured){
      await input(0,0,.8);await expect.poll(async()=>Math.abs((await snapshot()).state.speed)).toBeLessThan(.12);
      await expect(page.locator('#toast')).not.toHaveClass(/visible/);
      await page.screenshot({path:testInfo.outputPath(`narrow-footbridge-seam-${reverse?'eastbound':'westbound'}.png`)});captured=true;continue;
     }
    }
    const targetAlong=Math.min(length+4,along+3),targetX=a[0]+tx*targetAlong,targetZ=a[1]+tz*targetAlong;
    const desired=Math.atan2(targetX-s.x,targetZ-s.z),error=Math.atan2(Math.sin(desired-s.yaw),Math.cos(desired-s.yaw));
    const steer=Math.abs(error)<.006?0:Math.sign(error)*Math.max(.14,Math.min(.7,Math.abs(error)*2.5));
    await input(steer,Math.max(0,Math.min(.3,.07+(1.8-s.speed)*.17)),Math.max(0,(s.speed-2.2)*.15));await page.waitForTimeout(80);
   }
  }finally{await input(0,0,.8);}
  expect(arrived,'ride from one bank to the other across the tile boundary').toBe(true);expect(seamSamples).toBeGreaterThan(0);expect(captured).toBe(true);
  await expect.poll(async()=>Math.abs((await snapshot()).state.speed)).toBeLessThan(.12);
 }
 await input(0,0);expect(errors).toEqual([]);
});
