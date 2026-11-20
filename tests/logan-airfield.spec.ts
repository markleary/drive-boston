import {test,expect,type Page} from '@playwright/test';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const airfield=(page:Page)=>page.evaluate(()=>(window as any).__backbay.airfield());
type Runway={id:string;width:number;ends:{name:string;point:[number,number];displaced:number}[]};
type Aircraft={stand:string;kind:string;nose:[number,number];heading:[number,number]};

test('Logan: the runways are drawn, a car rolls down one, and the helicopter comes to rest on a parked airliner',async({page,request},testInfo)=>{
 test.setTimeout(420000);await page.setViewportSize({width:1600,height:900});
 const data=await(await request.get('/data/airfield.json')).json(),runway:Runway=data.runways.find((r:Runway)=>r.id==='15R/33L');expect(runway).toBeTruthy();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 const built=await airfield(page);expect(built.runways).toEqual(['04L/22R','04R/22L','09/27','14/32','15L/33R','15R/33L']);
 expect(Object.values(built.aircraft as Record<string,number>).reduce((a,b)=>a+b,0)).toBe(data.aircraft.length);expect(built.jetBridges).toBe(data.jetBridges.length);expect(built.lights).toBeGreaterThan(1500);

 // A car on runway 33L, 300 m in from its end, facing down the runway: the tile streams, the pavement drapes, the car rolls on it.
 const [a,b]=[runway.ends[1].point,runway.ends[0].point],length=Math.hypot(b[0]-a[0],b[1]-a[1]),u=[(b[0]-a[0])/length,(b[1]-a[1])/length],start=[a[0]+u[0]*300,a[1]+u[1]*300],yaw=Math.atan2(u[0],u[1]);
 await page.evaluate(([x,z,yaw])=>(window as any).__backbay.travelTo(x,z,yaw),[start[0],start[1],yaw]);
 await expect.poll(async()=>(await snapshot(page)).tiles.keys.includes(`${Math.floor(start[0]/1000)}_${Math.floor(start[1]/1000)}`),{timeout:120000}).toBe(true);
 await expect.poll(async()=>(await airfield(page)).built,{timeout:120000}).toBeGreaterThan(0);
 await page.evaluate(([x,z,yaw])=>(window as any).__backbay.travelTo(x,z,yaw),[start[0],start[1],yaw]);await page.waitForTimeout(1500);
 let s=await snapshot(page);const y0=s.state.y;await page.screenshot({path:testInfo.outputPath('logan-runway-33L.png')});
 await page.keyboard.down('w');
 try{await expect.poll(async()=>{s=await snapshot(page);return (s.state.x-start[0])*u[0]+(s.state.z-start[1])*u[1];},{timeout:60000}).toBeGreaterThan(220);}finally{await page.keyboard.up('w');}
 const across=Math.abs(-(s.state.x-start[0])*u[1]+(s.state.z-start[1])*u[0]);expect(across,'the car is still on the runway').toBeLessThan(runway.width/2);expect(Math.abs(s.state.y-y0),'a runway is level').toBeLessThan(1.2);
 expect((await airfield(page)).triangles).toBeGreaterThan(5000);

 // The helicopter let down onto a parked wide-body comes to rest on its fuselage, not on the apron under it.
 const plane:Aircraft=data.aircraft.find((p:Aircraft)=>p.kind==='wide'),x=plane.nose[0]-plane.heading[0]*24,z=plane.nose[1]-plane.heading[1]*24;
 await page.getByTestId('mode-helicopter').click();await page.evaluate(([x,z])=>(window as any).__backbay.flyTo(x,60,z,0),[x,z]);
 await expect.poll(async()=>(await snapshot(page)).tiles.keys.includes(`${Math.floor(x/1000)}_${Math.floor(z/1000)}`),{timeout:120000}).toBe(true);
 await page.evaluate(([x,z])=>(window as any).__backbay.flyTo(x,40,z,0),[x,z]);
 await page.keyboard.down('Shift');
 try{await page.waitForTimeout(9000);}finally{await page.keyboard.up('Shift');}
 s=await snapshot(page);await page.screenshot({path:testInfo.outputPath('logan-helicopter-on-airliner.png')});const height=s.flight.y-s.flightGroundHeight;
 expect(Math.hypot(s.flight.x-x,s.flight.z-z)).toBeLessThan(12);expect(height,'held up by the fuselage, 8 m over the apron').toBeGreaterThan(6);expect(height).toBeLessThan(13);
 expect(s.tiles.failed).toBe(0);expect(errors).toEqual([]);
});
