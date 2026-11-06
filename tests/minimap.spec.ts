import {test,expect} from '@playwright/test';

test('larger minimap labels nearby roads in drive and helicopter views',async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const map=page.locator('#minimap'),button=page.locator('#minimap-button');
  const box=await button.boundingBox();
  expect(box!.width).toBeGreaterThan(200);
  expect(box!.width).toBeLessThan(240);
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:.*Boylston Street/);
  await page.screenshot({path:testInfo.outputPath('back-bay-labeled-minimap.png')});

  await button.click();
  await expect(page.locator('#map-modal')).toBeVisible();
  await page.locator('[data-destination="mission-hill"]').click();
  await expect(page.locator('#map-modal')).toBeHidden();
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:.*Huntington Avenue/);
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:.*Hillside Street/);
  await page.screenshot({path:testInfo.outputPath('mission-hill-labeled-minimap.png')});

  await page.keyboard.press('3');
  await expect(page.getByTestId('mode-helicopter')).toHaveAttribute('aria-pressed','true');
  await expect(map).toHaveAttribute('aria-label',/Nearby roads:/);
  const flightMap=await button.boundingBox(),hint=await page.locator('#drive-hint').boundingBox();
  expect(flightMap!.x+flightMap!.width).toBeLessThan(hint!.x);
  await page.screenshot({path:testInfo.outputPath('flight-labeled-minimap.png')});
  expect(errors).toEqual([]);
});

test('the minimap draws the Prudential complex by its outline and keeps Huntington Avenue open',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();
  await page.evaluate(()=>(window as any).__backbay.travelTo(-540.5,491,-.74));
  await expect.poll(()=>page.evaluate(()=>{const s=(window as any).__backbay.snapshot().state;return Math.hypot(s.x+540.5,s.z-491);}),{timeout:30000}).toBeLessThan(10);
  // The complex's hidden convex hull spans Huntington Avenue and Belvidere Street; the street
  // vertices inside it must still read as pavement, not building, on the minimap.
  const pavement=()=>page.evaluate(()=>{
    const b=(window as any).__backbay,city=b.city,{x:cx,z:cz}=b.snapshot().state,canvas=document.querySelector<HTMLCanvasElement>('#minimap')!;
    const hull=city.index.near(-472,303,5).find((h:any)=>h.hidden&&!h.fragment).footprint as [number,number][];
    const inside=(x:number,z:number)=>{let c=false;for(let i=0,j=hull.length-1;i<hull.length;j=i++){const [ax,az]=hull[i],[bx,bz]=hull[j];if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)c=!c;}return c;};
    const w=canvas.clientWidth,h=canvas.clientHeight,scale=w/460,dpr=canvas.width/w,data=canvas.getContext('2d')!;
    const light=city.roads.filter((r:any)=>r.name==='Huntington Avenue'||r.name==='Belvidere Street').flatMap((r:any)=>r.points)
      .filter(([x,z]:[number,number])=>inside(x,z)&&Math.abs(x-cx)<180&&Math.abs(z-cz)<180)
      .map(([x,z]:[number,number])=>{const [r,g,bl]=data.getImageData(Math.round(((x-cx)*scale+w/2)*dpr),Math.round(((z-cz)*scale+h/2)*dpr),1,1).data;return r>235&&g>235&&bl>225;});
    return {count:light.length,light:light.filter(Boolean).length};
  });
  await expect.poll(async()=>{const {count,light}=await pavement();return count>=3&&light>=Math.ceil(count*.75);},{timeout:30000}).toBe(true);
  await page.locator('#minimap-button').screenshot({path:testInfo.outputPath('prudential-minimap.png')});
  expect(errors).toEqual([]);
});
