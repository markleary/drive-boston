import {test,expect,type Page} from '@playwright/test';

type Deck={id:string;width:number;points:[number,number][];elevations:number[]};
type Road={id:string;points:[number,number][];elevations?:number[];width:number};
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).__backbay.snapshot());
const streamed=(page:Page,x:number,z:number)=>expect.poll(()=>page.evaluate(([x,z])=>{
 const api=(window as any).__backbay,s=api.snapshot(),key=`${Math.floor(x/1000)}_${Math.floor(z/1000)}`;return s.tiles.keys.includes(key);
},[x,z]),{timeout:120000}).toBe(true);
const nearest=(r:{points:[number,number][]},x:number,z:number)=>{let best=Infinity;for(let i=1;i<r.points.length;i++){const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t));}return best;};

test('a footbridge over Storrow Drive is whole: a walker crosses the Dartmouth Street span over both carriageways',async({page,request},testInfo)=>{
 test.setTimeout(300000);await page.setViewportSize({width:1600,height:900});
 const city=await(await request.get('/data/city.json')).json(),deck:Deck=city.footbridges.find((d:Deck)=>d.id==='dartmouth-street');
 expect(deck,'the city lists the deck').toBeTruthy();expect(city.footbridges.map((d:Deck)=>d.id)).toEqual(['marsh-chapel','silber-way','fairfield-street','dartmouth-street','arthur-fiedler','franklin-street']);
 const top=Math.max(...deck.elevations),level=deck.points.map((p,i)=>({p,i})).filter(({i})=>deck.elevations[i]===top);
 // The level span, a few stations inside each of its ends (which turn onto the ramps).
 const a=level[3].p,b=level.at(-4)!.p,length=Math.hypot(b[0]-a[0],b[1]-a[1]),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);expect(length).toBeGreaterThan(20);
 const storrow:Road[]=city.roads.filter((r:Road)=>/^storrow-(eb|wb)-\d+$/.test(r.id)&&r.elevations),lanes=storrow.filter(r=>nearest(r,(a[0]+b[0])/2,(a[1]+b[1])/2)<30);
 expect(lanes.length,'both carriageways pass under the span').toBeGreaterThanOrEqual(2);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
 await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});await page.getByTestId('start-drive').click();
 await page.keyboard.press('4');await expect.poll(async()=>(await snapshot(page)).travelMode).toBe('walk');
 // Stream the tile first, then stand the walker on the deck: its collider comes with the tile.
 await page.evaluate(([x,z,yaw])=>(window as any).__backbay.walkTo(x,z,yaw),[a[0],a[1],yaw]);await streamed(page,a[0],a[1]);
 await page.evaluate(([x,z,yaw,y])=>(window as any).__backbay.walkTo(x,z,yaw,y),[a[0],a[1],yaw,top]);await page.waitForTimeout(600);
 let s=await snapshot(page);expect(Math.abs(s.walker.y-top),'the walker stands on the deck, not on the road under it').toBeLessThan(.15);expect(s.walker.grounded).toBe(true);
 await page.screenshot({path:testInfo.outputPath('dartmouth-footbridge-deck.png')});
 let over=0,lowest=Infinity;await page.keyboard.down('w');
 try{
  const began=Date.now();
  while(Date.now()-began<60000){
   s=await snapshot(page);const w=s.walker,along=(w.x-a[0])*Math.sin(yaw)+(w.z-a[1])*Math.cos(yaw);lowest=Math.min(lowest,w.y);
   if(lanes.some(r=>nearest(r,w.x,w.z)<r.width/2))over++;
   if(along>length-1)break;
   await page.waitForTimeout(100);
  }
 }finally{await page.keyboard.up('w');}
 s=await snapshot(page);expect(Math.hypot(s.walker.x-b[0],s.walker.z-b[1]),'across the span').toBeLessThan(2.5);
 expect(top-lowest,'level all the way: never through the deck').toBeLessThan(.15);expect(over,'over the lanes').toBeGreaterThan(20);
 expect(s.tiles.failed).toBe(0);expect(errors).toEqual([]);
 // From the air: the span and its ramps on both banks.
 await page.keyboard.press('3');await page.evaluate(([x,y,z,yaw])=>(window as any).__backbay.flyTo(x,y,z,yaw),[(a[0]+b[0])/2-45,top+22,(a[1]+b[1])/2+25,1.1]);await page.waitForTimeout(2500);
 await page.screenshot({path:testInfo.outputPath('dartmouth-footbridge-air.png')});
});
