import {desktopDrivingSoundCount} from './helpers/audio-bank';
import {test,expect} from '@playwright/test';
// These exercise keyboard/touch; a host's connected controller must not steer
// the car into traffic during acceleration checks. Controller input has its own suite.
test.beforeEach(async({context})=>{await context.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{value:()=>[],configurable:true}));});
const snap=(page:any)=>page.evaluate(()=>(window as any).__backbay.snapshot());
async function start(page:any){await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();}

test('garage selection swaps model and audio, survives bike/flight and reload, and releases old models',async({page},info)=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page);expect((await snap(page)).carId).toBe('harbor-s4');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox',{name:'Your car'})).toHaveValue('harbor-s4');
  await page.getByRole('combobox',{name:'Your car'}).selectOption('mclaren-gt');
  await expect(page.locator('#car-description')).toContainText('203 mph');
  expect((await snap(page)).carId).toBe('mclaren-gt');expect((await snap(page)).paused).toBe(true);
  await page.screenshot({path:info.outputPath('garage-settings.png')});
  await page.getByRole('button',{name:'Keep driving',exact:true}).click();
  await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(desktopDrivingSoundCount);
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
    await page.getByRole('combobox',{name:'Your car'}).selectOption('harbor-s4');
    await page.getByRole('combobox',{name:'Your car'}).selectOption('mclaren-gt');
    counts.push(await page.evaluate(()=>(window as any).__backbay.scene.getObjectByName('PlayerMcLarenGT').children.length));
  }
  expect(new Set(counts).size).toBe(1);
  expect(await page.evaluate(()=>(window as any).__backbay.scene.children.filter((o:any)=>o.name==='PlayerMcLarenGT'||o.name==='PlayerCoupe').length)).toBe(1);
  await page.reload();await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
  expect((await snap(page)).carId).toBe('mclaren-gt');
  await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'Your car'}).selectOption('harbor-s4');await page.getByRole('button',{name:'Keep driving',exact:true}).click();
  await page.screenshot({path:info.outputPath('harbor-s4-boston.png')});expect(errors).toEqual([]);
});

test('touch settings expose all eight cars and load only the selected engine bank',async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
  try{
    await context.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{value:()=>[],configurable:true}));
    const requests:string[]=[];
    page.on('request',request=>{
      const path=new URL(request.url()).pathname;
      if(path.includes('/audio/'))requests.push(path.split('/').at(-1)!);
    });
    await page.addInitScript(()=>{
      localStorage.setItem('boston-player-car-v1','supra-mk4');
      const decode=AudioContext.prototype.decodeAudioData;
      let active=0,peak=0;
      Object.assign(window,{audioDecodePeak:()=>peak});
      AudioContext.prototype.decodeAudioData=function(...args){
        peak=Math.max(peak,++active);
        return decode.apply(this,args).finally(()=>active--);
      };
    });
    await start(page);
    await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(16);
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('supra-mk4');
    expect(requests.filter(name=>name.startsWith('supra-mk4'))).toHaveLength(5);
    expect(requests.some(name=>name.startsWith('mclaren')||name.startsWith('subaru-wrx')||name.startsWith('maserati'))).toBe(false);
    const supraBytes=(await snap(page)).audio.decodedBytes;
    await page.locator('#open-settings').click();
    for(const [name,id] of [['Harbor S4','harbor-s4'],['McLaren GT','mclaren-gt'],['McLaren 720S','mclaren-720s'],['Maserati GT2 Stradale','maserati-gt2-stradale'],['Moving Truck','moving-truck'],['Subaru WRX','subaru-wrx'],['Tesla Model 3 Performance','tesla-model-3-performance'],['Toyota Supra Mk4','supra-mk4']]){
      const car=page.getByRole('combobox',{name:'Your car'});await car.scrollIntoViewIfNeeded();await car.selectOption({label:name});
      await expect(car).toHaveValue(id);expect((await snap(page)).carId).toBe(id);
      const bounds=await car.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
      if(id==='tesla-model-3-performance'){
        await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(13);
        expect((await snap(page)).audio.failed).toEqual([]);
        expect(requests.filter(name=>name.startsWith('tesla-model-3-performance'))).toHaveLength(2);
      }
      if(id==='moving-truck'){
        await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(20);
        expect((await snap(page)).audio.failed).toEqual([]);
        expect(requests.filter(name=>name.startsWith('moving-truck'))).toHaveLength(9);
      }
      if(id==='maserati-gt2-stradale'){
        await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(16);
        expect((await snap(page)).audio.failed).toEqual([]);
        expect(requests.filter(name=>name.startsWith('maserati-gt2-stradale'))).toHaveLength(5);
      }
      if(id==='subaru-wrx'){
        await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(17);
        expect((await snap(page)).audio.failed).toEqual([]);
        expect(requests.filter(name=>name.startsWith('subaru-wrx'))).toHaveLength(6);
      }
      if(id==='harbor-s4'){
        const audio=(await snap(page)).audio;
        expect(audio.loadedCount).toBe(11);
        expect(audio.activeLoops).toBe(6);
        expect(audio.decodedBytes).toBeLessThan(supraBytes);
      }
    }
    await page.screenshot({path:info.outputPath('garage-mobile.png')});await page.locator('#close-settings').tap();
    expect((await snap(page)).paused).toBe(false);
    await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(16);
    const audio=(await snap(page)).audio;
    expect(audio.engineProfile).toBe('supra-mk4');
    expect(audio.decodedBytes).toBe(supraBytes);
    expect(audio.failed).toEqual([]);
    expect(await page.evaluate(()=>(window as any).audioDecodePeak())).toBe(1);
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

for(const [id,name,model] of [['mclaren-720s','McLaren 720S','PlayerMcLaren720S'],['supra-mk4','Toyota Supra Mk4','PlayerSupraMk4'],['subaru-wrx','Subaru WRX','PlayerSubaruWRX'],['maserati-gt2-stradale','Maserati GT2 Stradale','PlayerMaseratiGT2Stradale']]){
  test(`${name}: selection, actual shifting, matching plates, mode changes and persistence`,async({page},info)=>{
    test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await start(page);await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'Your car'}).selectOption(id);
    await page.getByRole('button',{name:'Keep driving',exact:true}).click();
    await expect.poll(async()=>(await snap(page)).audio.loadedCount).toBe(desktopDrivingSoundCount);
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe(id);
    expect((await snap(page)).audio.failed).toEqual([]);
    const plates=await page.evaluate(model=>{const g=(window as any).__backbay.scene.getObjectByName(model),p=g.getObjectByName('PlayerMassachusettsPlates');return {car:g.userData.carId,vertices:p.geometry.attributes.position.count,texture:!!p.material.map};},model);
    expect(plates).toEqual({car:id,vertices:8,texture:true});
    await page.screenshot({path:info.outputPath(`${id}-boston.png`)});
    if(id==='subaru-wrx'){
      await expect(page.locator('#gear')).toHaveAttribute('title',/Six-speed manual with shift assist/);
      await page.keyboard.down('w');
      try{
        await expect.poll(async()=>(await snap(page)).audio.turboGain).toBeGreaterThan(.012);
      }finally{await page.keyboard.up('w');}
      await expect.poll(async()=>(await snap(page)).audio.turboGain).toBeLessThan(.005);
    }
    if(id==='maserati-gt2-stradale'){
      await expect(page.locator('#gear')).toHaveAttribute('title',/Eight-speed dual-clutch transmission/);
      await expect(page.locator('#car-description')).toContainText('Nettuno V6');
      const accents=await page.evaluate(()=>{const g=(window as any).__backbay.scene.getObjectByName('PlayerMaseratiGT2Stradale');return ['Gt2Tridents','Gt2ExhaustTips','Gt2BrakeCaliper0','Gt2BrakeCaliper3'].map(name=>!!g.getObjectByName(name));});
      expect(accents).toEqual([true,true,true,true]);
      await page.keyboard.down('w');
      try{await expect.poll(async()=>(await snap(page)).audio.turboGain).toBeGreaterThan(.05);}finally{await page.keyboard.up('w');}
      await expect.poll(async()=>(await snap(page)).audio.turboGain).toBeLessThan(.01);
    }
    await page.keyboard.down('w');
    try{await expect.poll(async()=>(await snap(page)).audio.shiftCount,{timeout:15000}).toBeGreaterThan(0);}finally{await page.keyboard.up('w');}
    await page.keyboard.press('r');
    for(const key of ['2','3']){await page.keyboard.press(key);await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('off');await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeLessThan(.001);}
    await page.keyboard.press('1');await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe(id);
    await page.keyboard.press('Escape');await expect.poll(async()=>(await snap(page)).audio.masterGain).toBeLessThan(.001);
    for(let i=0;i<3;i++){await page.getByRole('combobox',{name:'Your car'}).selectOption('harbor-s4');await page.getByRole('combobox',{name:'Your car'}).selectOption(id);}
    expect(await page.evaluate(()=>(window as any).__backbay.scene.children.filter((o:any)=>o.userData.carId).length)).toBe(1);
    await page.reload();await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});await page.getByTestId('start-drive').click();
    expect((await snap(page)).carId).toBe(id);await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe(id);expect(errors).toEqual([]);
  });
  test(`${name}: corrupt dedicated loop falls back and recovers on car switch`,async({page})=>{
    await page.addInitScript(id=>localStorage.setItem('boston-player-car-v1',id),id);
    await page.route(`**/audio/${id}-high.mp3*`,route=>route.fulfill({contentType:'audio/mpeg',body:'invalid audio'}));
    await start(page);await expect.poll(async()=>(await snap(page)).audio.loading).toBe(false);
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('generic');await expect.poll(async()=>(await snap(page)).audio.engineGain).toBeGreaterThan(.1);
    await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'Your car'}).selectOption('mclaren-gt');await page.getByRole('button',{name:'Keep driving',exact:true}).click();
    await expect.poll(async()=>(await snap(page)).audio.engineProfile).toBe('mclaren-gt');
  });
}
