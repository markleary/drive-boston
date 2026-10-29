import {test,expect,type Page} from '@playwright/test';

type Tram={kind:string;line:string;route:string;carCount:number;covered:boolean;x:number;y:number;z:number;yaw:number;speed:number};
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());

test('all four Green Line branches run single articulated cars through the streamed city',async({page},testInfo)=>{
 test.setTimeout(180000);const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(message.text()))errors.push(message.text());});
 await page.goto('/');await page.getByTestId('start-drive').click({timeout:90000});
 const initial=(await snapshot(page)).transit as Tram[];
 expect(initial.filter(t=>t.kind==='tram')).toHaveLength(10);expect(initial.filter(t=>t.kind==='bus')).toHaveLength(32);
 expect([...new Set(initial.filter(t=>t.kind==='tram').map(t=>t.line))].sort()).toEqual(['Green-B','Green-C','Green-D','Green-E']);
 expect(initial.every(t=>t.carCount===1)).toBe(true);
 await page.keyboard.press('3');await page.keyboard.press('Escape');await page.locator('[data-camera="hood"]').click();await page.locator('#resume-drive').click();
 for(const line of ['Green-B','Green-C','Green-D','Green-E']){
  const tram=((await snapshot(page)).transit as Tram[]).find(t=>t.line===line&&!t.covered)!;
  const x=tram.x+Math.sin(tram.yaw)*32+Math.cos(tram.yaw)*15,z=tram.z+Math.cos(tram.yaw)*32-Math.sin(tram.yaw)*15,yaw=Math.atan2(tram.x-x,tram.z-z);
  await page.evaluate(({x,y,z,yaw})=>(window as any).__backbay.flyTo(x,y,z,yaw),{x,y:tram.y+11,z,yaw});
  await expect.poll(async()=>{
   const now=((await snapshot(page)).transit as Tram[]).find(t=>t.route===tram.route)!;
   return Math.hypot(now.x-tram.x,now.z-tram.z);
  },{timeout:30000}).toBeGreaterThan(2);
  await expect(page.getByText('Loading the neighborhood',{exact:true})).toBeHidden({timeout:30000});
  await page.screenshot({path:testInfo.outputPath(`${line.toLowerCase()}.png`)});
 }
 const final=await snapshot(page);
 expect(final.graphicsContext.losses).toBe(0);expect(errors).toEqual([]);
 await testInfo.attach('green-line-fleet.json',{body:JSON.stringify({transit:final.transit,fps:final.fps,drawCalls:final.drawCalls,triangles:final.triangles,geometries:final.geometries,textures:final.textures}),contentType:'application/json'});
});
