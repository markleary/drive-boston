import {desktopDrivingSoundCount} from './helpers/audio-bank';
import {test,expect} from '@playwright/test';

const ID='tesla-model-3-performance';
test.beforeEach(async({context})=>{await context.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{value:()=>[],configurable:true}));});
const snapshot=(page:any)=>page.evaluate(()=>(window as any).__backbay.snapshot());

test('Tesla dropdown, single-speed drive, reverse sound, lighting and saved selection',async({page},info)=>{
  test.setTimeout(150000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();await page.keyboard.press('Escape');
  const cars=page.getByRole('combobox',{name:'Your car'});
  await expect(cars.locator('option')).toHaveCount(7);
  await cars.selectOption(ID);
  await expect(page.locator('#car-description')).toContainText('163 mph');
  await page.screenshot({path:info.outputPath('tesla-dropdown-desktop.png')});
  await page.getByRole('button',{name:'Keep driving',exact:true}).click();
  await expect.poll(async()=>(await snapshot(page)).audio.loadedCount).toBe(desktopDrivingSoundCount);
  await expect.poll(async()=>(await snapshot(page)).audio.engineProfile).toBe(ID);
  expect((await snapshot(page)).audio.failed).toEqual([]);
  const reverseLoop=await page.evaluate(async()=>{
    const response=await fetch(new URL('audio/tesla-model-3-performance-reverse.wav?v=ufo-pws-3',document.baseURI));
    const encoded=await response.arrayBuffer(),checks=[];
    for(const sampleRate of [44100,48000]){
      const context=new OfflineAudioContext(1,1,sampleRate),buffer=await context.decodeAudioData(encoded.slice(0)),samples=buffer.getChannelData(0);
      const boundaries=[];
      // Check three repetitions through real browser resampling at both device
      // sample rates and both ends of the speed-dependent pitch range.
      for(const rate of [.86,1.22]){
        const period=buffer.duration/rate,render=new OfflineAudioContext(1,Math.ceil(period*3.1*sampleRate),sampleRate);
        const source=render.createBufferSource();source.buffer=buffer;source.loop=true;source.playbackRate.value=rate;source.connect(render.destination);source.start();
        const rendered=(await render.startRendering()).getChannelData(0),ordinary:number[]=[];
        for(let i=2;i<rendered.length;i+=8)if(Math.abs(i/sampleRate/period-Math.round(i/sampleRate/period))>.003)ordinary.push(Math.abs(rendered[i]-rendered[i-1]));
        ordinary.sort((a,b)=>a-b);const usual=ordinary[Math.floor(ordinary.length*.999)];
        for(const repetition of [1,2,3]){
          const centre=Math.round(period*repetition*sampleRate);let delta=0;
          for(let i=centre-48;i<=centre+48;i++)delta=Math.max(delta,Math.abs(rendered[i]-rendered[i-1]));
          boundaries.push({rate,delta,usual});
        }
      }
      let energy=0;for(const value of samples)energy+=value*value;
      checks.push({sampleRate,duration:buffer.duration,rms:Math.sqrt(energy/samples.length),seam:Math.abs(samples[0]-samples.at(-1)!),boundaries});
    }
    return checks;
  });
  for(const check of reverseLoop){
    expect(check.duration).toBeGreaterThan(5);expect(check.duration).toBeLessThan(12);
    expect(check.rms).toBeGreaterThan(.01);expect(check.seam).toBeLessThan(.002);
    for(const {rate,delta,usual} of check.boundaries)expect(delta,`repeat seam at ${check.sampleRate}Hz / rate ${rate}`).toBeLessThan(usual*1.5+.003);
  }
  await expect(page.locator('#gear')).toHaveText('D');
  await expect(page.locator('#gear')).toHaveAttribute('title','Dual-motor electric · single-speed drive');
  await page.screenshot({path:info.outputPath('tesla-boston-day.png')});
  await page.keyboard.down('w');
  try{
    await expect.poll(async()=>(await snapshot(page)).state.speed).toBeGreaterThan(10);
    await expect.poll(async()=>(await snapshot(page)).audio.engineGain).toBeGreaterThan(.02);
    expect((await snapshot(page)).state.gear).toBe(1);
    expect((await snapshot(page)).audio.shiftCount).toBe(0);
  }finally{await page.keyboard.up('w');}
  await page.keyboard.press('r');await page.keyboard.down('s');
  try{
    await expect.poll(async()=>(await snapshot(page)).state.speed).toBeLessThan(-1);
    await expect.poll(async()=>(await snapshot(page)).audio.electricReverseGain).toBeGreaterThan(.02);
    const lowRate=(await snapshot(page)).audio.electricReverseRate;
    await expect.poll(async()=>(await snapshot(page)).state.speed).toBeLessThan(-3);
    await expect.poll(async()=>(await snapshot(page)).audio.electricReverseRate).toBeGreaterThan(lowRate+.02);
    expect((await snapshot(page)).audio.electricReverseRate).toBeLessThanOrEqual(1.22);
    expect((await snapshot(page)).audio.reverseAlarm).toBe(false);
    await expect(page.locator('#gear')).toHaveText('R');
  }finally{await page.keyboard.up('s');}
  await page.keyboard.press('Escape');
  await expect.poll(async()=>(await snapshot(page)).audio.electricReverse).toBe(false);
  await page.locator('[data-light="night"]').click();
  await page.locator('#resume-drive').click();await page.keyboard.press('r');
  await page.screenshot({path:info.outputPath('tesla-boston-night.png')});
  for(const key of ['2','3','4']){
    await page.keyboard.press(key);
    await expect.poll(async()=>(await snapshot(page)).audio.engineProfile).toBe('off');
    expect((await snapshot(page)).audio.electricReverse).toBe(false);
  }
  await page.keyboard.press('1');
  await expect.poll(async()=>(await snapshot(page)).audio.engineProfile).toBe(ID);
  await page.reload();await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();
  expect((await snapshot(page)).carId).toBe(ID);
  await page.keyboard.press('Escape');await expect(cars).toHaveValue(ID);
  // Native type-ahead works on macOS too, where Home does not choose the first
  // option. H must reach the select instead of toggling the game's HUD.
  await cars.focus();await page.keyboard.press('h');
  await expect(cars).toHaveValue('harbor-s4');
  expect((await snapshot(page)).carId).toBe('harbor-s4');
  expect((await snapshot(page)).paused).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-modal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('missing Tesla audio uses an electric fallback without combustion sounds',async({page})=>{
  await page.addInitScript(id=>localStorage.setItem('boston-player-car-v1',id),ID);
  await page.route('**/audio/tesla-model-3-performance-*',route=>route.fulfill({status:404,body:''}));
  await page.goto('/');await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:60000});
  await page.getByTestId('start-drive').click();
  await expect.poll(async()=>(await snapshot(page)).audio.loading).toBe(false);
  await expect.poll(async()=>(await snapshot(page)).audio.engineProfile).toBe('electric-fallback');
  await page.keyboard.down('w');
  try{
    await expect.poll(async()=>(await snapshot(page)).state.speed).toBeGreaterThan(4);
    await expect.poll(async()=>(await snapshot(page)).audio.electricGain).toBeGreaterThan(.01);
    expect((await snapshot(page)).audio.shiftCount).toBe(0);
  }finally{await page.keyboard.up('w');}
});
