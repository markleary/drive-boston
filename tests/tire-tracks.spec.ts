import {test,expect} from '@playwright/test';

test('hard braking leaves fading pavement and grass tracks in the live game',async({page},testInfo)=>{
  test.setTimeout(150000);
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
  const stats=()=>page.evaluate(()=>(window as any).__backbay.tireTracks.stats());
  await page.keyboard.down('w');
  try{await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().state.speed)).toBeGreaterThan(12);}
  finally{await page.keyboard.up('w');}
  expect((await stats()).totalPavement).toBe(0);
  await page.keyboard.down('Space');
  try{
    await expect.poll(async()=>(await stats()).pavement).toBeGreaterThan(8);
    await expect.poll(()=>page.evaluate(()=>Math.abs((window as any).__backbay.snapshot().state.speed))).toBeLessThan(.3);
  }
  finally{await page.keyboard.up('Space');}
  await page.screenshot({path:testInfo.outputPath('pavement-skids.png')});
  // Find an open 40 m strip in the Common, away from streets and buildings.
  const spot=await page.evaluate(()=>{
    const city=(window as any).__backbay.city,park=city.parks.find((p:any)=>p.name==='Boston Common'),ring=park.rings[0];
    const inside=(x:number,z:number)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
    const distance=(x:number,z:number,points:number[][])=>{let best=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));}return best;};
    for(let z=Math.min(...ring.map((p:number[])=>p[1]))+20;z<Math.max(...ring.map((p:number[])=>p[1]))-60;z+=8)for(let x=Math.min(...ring.map((p:number[])=>p[0]))+20;x<Math.max(...ring.map((p:number[])=>p[0]))-20;x+=8){
      if([0,10,20,30,40].every(d=>inside(x,z+d)&&city.roads.every((r:any)=>distance(x,z+d,r.points)>r.width/2+6)&&(!city.index||!city.index.query(x-3,x+3,z+d-3,z+d+3).length)))return{x,z};
    }
    throw new Error('No clear lawn strip in Boston Common');
  });
  await page.evaluate(async({x,z})=>{await(window as any).__backbay.travelTo(x,z,0);},spot);
  await page.keyboard.down('w');
  try{await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().state.speed)).toBeGreaterThan(8);}
  finally{await page.keyboard.up('w');}
  await page.keyboard.down('Space');
  try{
    await expect.poll(async()=>(await stats()).grass).toBeGreaterThan(4);
    await expect.poll(()=>page.evaluate(()=>Math.abs((window as any).__backbay.snapshot().state.speed))).toBeLessThan(.3);
  }
  finally{await page.keyboard.up('Space');}
  await page.screenshot({path:testInfo.outputPath('torn-grass.png')});
  await expect.poll(async()=>(await stats()).grass,{timeout:45000}).toBe(0);
  expect((await stats()).pavement).toBe(0);
  expect(errors).toEqual([]);
});
