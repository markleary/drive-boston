import {test,expect} from '@playwright/test';
const snap=(page:any)=>page.evaluate(()=>(window as any).__backbay.snapshot());
async function start(page:any){await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();}

test('garage selection swaps model and audio, survives bike/flight and reload, and releases old models',async({page},info)=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page);expect((await snap(page)).carId).toBe('harbor-s4');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Harbor S4',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'McLaren GT',exact:true}).click();
  await expect(page.locator('#car-description')).toContainText('203 mph');
  expect((await snap(page)).carId).toBe('mclaren-gt');expect((await snap(page)).paused).toBe(true);
  await page.screenshot({path:info.outputPath('garage-settings.png')});
  await page.getByRole('button',{name:'Keep driving',exact:true}).click();
  await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(26);
  expect((await snap(page)).audio.failed).toEqual([]);
  await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeGreaterThan(.1);
  await page.screenshot({path:info.outputPath('mclaren-gt-boston.png')});
  await page.keyboard.down('w');
  try{await expect.poll(async()=>(await snap(page)).state.speed,{timeout:10000}).toBeGreaterThan(22.5);await expect.poll(async()=>(await snap(page)).audio.shiftCount).toBeGreaterThan(0);}finally{await page.keyboard.up('w');}
  await page.keyboard.press('r');
  for(const key of ['2','3','1']){await page.keyboard.press(key);await expect.poll(async()=>(await snap(page)).travelMode).toBe(key==='2'?'bike':key==='3'?'helicopter':'drive');}
  expect((await snap(page)).state.carId).toBe('mclaren-gt');
  // Repeat swaps without simulation/streaming changes: no mesh accumulation.
  await page.keyboard.press('Escape');const counts:number[]=[];
  for(let i=0;i<3;i++){
    await page.getByRole('button',{name:'Harbor S4',exact:true}).click();
    await page.getByRole('button',{name:'McLaren GT',exact:true}).click();
    counts.push(await page.evaluate(()=>(window as any).__backbay.scene.getObjectByName('PlayerMcLarenGT').children.length));
  }
  expect(new Set(counts).size).toBe(1);
  expect(await page.evaluate(()=>(window as any).__backbay.scene.children.filter((o:any)=>o.name==='PlayerMcLarenGT'||o.name==='PlayerCoupe').length)).toBe(1);
  await page.reload();await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
  expect((await snap(page)).carId).toBe('mclaren-gt');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Harbor S4',exact:true}).click();await page.getByRole('button',{name:'Keep driving',exact:true}).click();
  await page.screenshot({path:info.outputPath('harbor-s4-boston.png')});expect(errors).toEqual([]);
});

test('touch settings expose all four cars in a scrollable panel',async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
  try{
    await start(page);await page.locator('#open-settings').click();
    for(const [name,id] of [['Harbor S4','harbor-s4'],['McLaren GT','mclaren-gt'],['McLaren 720S','mclaren-720s'],['Toyota Supra Mk4','supra-mk4']]){
      const car=page.getByRole('button',{name,exact:true});await car.scrollIntoViewIfNeeded();await car.tap();
      await expect(car).toHaveAttribute('aria-pressed','true');expect((await snap(page)).carId).toBe(id);
      const bounds=await car.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({path:info.outputPath('garage-mobile.png')});await page.locator('#close-settings').tap();
    expect((await snap(page)).paused).toBe(false);
  }finally{await context.close();}
});

for(const scenario of ['missing GT loops','corrupt high-RPM loop','only generic idle survives','only generic drive survives','all engine loops unavailable'] as const){
  test(`GT engine fallback: ${scenario}`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>localStorage.setItem('boston-player-car-v1','mclaren-gt'));
    const gtLoops=['mclaren-gt-idle','mclaren-gt-drive','mclaren-gt-high'];
    await page.route('**/audio/*.mp3*',async route=>{
      const name=new URL(route.request().url()).pathname.split('/').at(-1)!.replace('.mp3','');
      if(scenario==='corrupt high-RPM loop'){
        if(name==='mclaren-gt-high'){await route.fulfill({contentType:'audio/mpeg',body:'not decodable MP3 audio'});return;}
      }else if(gtLoops.includes(name)||(name==='engine-idle'&&(scenario==='only generic drive survives'||scenario==='all engine loops unavailable'))||(name==='engine-drive'&&(scenario==='only generic idle survives'||scenario==='all engine loops unavailable'))){
        await route.fulfill({status:404,body:''});return;
      }
      await route.continue();
    });
    await start(page);
    await expect.poll(async()=>(await snap(page)).audio.loading).toBe(false);
    const synthesized=scenario==='all engine loops unavailable';
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe(synthesized?'synthesized':'generic');
    await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeGreaterThan(synthesized?.02:.1);
    expect((await snap(page)).carId).toBe('mclaren-gt');
    await page.keyboard.down('w');
    try{await expect.poll(async()=>(await snap(page)).state.speed).toBeGreaterThan(7);await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeGreaterThan(synthesized?.04:.1);}finally{await page.keyboard.up('w');}
    await page.keyboard.press('2');await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('off');
    await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeLessThan(.001);
    await page.keyboard.press('1');await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeGreaterThan(synthesized?.02:.1);
    await page.keyboard.press('Escape');await expect.poll(async()=>(await snap(page)).audio.masterGain).toBeLessThan(.001);
    expect(errors).toEqual([]);
  });
}

for(const [id,name,model] of [['mclaren-720s','McLaren 720S','PlayerMcLaren720S'],['supra-mk4','Toyota Supra Mk4','PlayerSupraMk4']]){
  test(`${name}: selection, actual shifting, matching plates, mode changes and persistence`,async({page},info)=>{
    test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await start(page);await page.keyboard.press('Escape');await page.getByRole('button',{name,exact:true}).click();
    await page.getByRole('button',{name:'Keep driving',exact:true}).click();
    await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(26);
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe(id);
    expect((await snap(page)).audio.failed).toEqual([]);
    const plates=await page.evaluate(model=>{const g=(window as any).__backbay.scene.getObjectByName(model),p=g.getObjectByName('PlayerMassachusettsPlates');return {car:g.userData.carId,vertices:p.geometry.attributes.position.count,texture:!!p.material.map};},model);
    expect(plates).toEqual({car:id,vertices:8,texture:true});
    await page.screenshot({path:info.outputPath(`${id}-boston.png`)});
    await page.keyboard.down('w');
    try{await expect.poll(async()=>(await snap(page)).audio.shiftCount,{timeout:15000}).toBeGreaterThan(0);}finally{await page.keyboard.up('w');}
    await page.keyboard.press('r');
    for(const key of ['2','3']){await page.keyboard.press(key);await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('off');await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeLessThan(.001);}
    await page.keyboard.press('1');await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe(id);
    await page.keyboard.press('Escape');await expect.poll(async()=>(await snap(page)).audio.masterGain).toBeLessThan(.001);
    for(let i=0;i<3;i++){await page.getByRole('button',{name:'Harbor S4',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();}
    expect(await page.evaluate(()=>(window as any).__backbay.scene.children.filter((o:any)=>o.userData.carId).length)).toBe(1);
    await page.reload();await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
    expect((await snap(page)).carId).toBe(id);await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe(id);expect(errors).toEqual([]);
  });
  test(`${name}: corrupt dedicated loop falls back and recovers on car switch`,async({page})=>{
    await page.addInitScript(id=>localStorage.setItem('boston-player-car-v1',id),id);
    await page.route(`**/audio/${id}-high.mp3*`,route=>route.fulfill({contentType:'audio/mpeg',body:'invalid audio'}));
    await start(page);await expect.poll(async()=>(await snap(page)).audio.loading).toBe(false);
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('generic');await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeGreaterThan(.1);
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'McLaren GT',exact:true}).click();await page.getByRole('button',{name:'Keep driving',exact:true}).click();
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('mclaren-gt');
  });
}
