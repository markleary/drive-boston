import {test,expect} from '@playwright/test';

// Wadsworth Street: the coarse hull is exactMesh, but a real surveyed wall
// intersects the saved chassis within the permitted 10 m road margin.
const blocked={x:-770.05,z:-1151.84,yaw:-2.7093756232637767,roadId:'osm-8615075-0'};

for(const mobile of [false,true])test.describe(mobile?'mobile saved clearance':'desktop saved clearance',()=>{
  test.use({viewport:mobile?{width:393,height:852}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});
  test('a saved chassis intersecting an exact source wall returns to the normal spawn',async({page},testInfo)=>{
    const errors:string[]=[],tiles:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.ok()&&response.url().includes('/data/tiles/'))tiles.push(response.url());});
    await page.addInitScript(position=>localStorage.setItem('backbay-drive-v1',JSON.stringify(position)),blocked);
    await page.goto('/');await page.getByTestId('start-drive').click({timeout:90000});await expect(page.locator('#welcome')).toBeHidden();
    const result=await page.evaluate(()=>{
      const game=(window as any).__backbay,state=game.snapshot();
      return{state:state.state,mobile:state.mobile,spawn:game.city.spawn};
    });
    expect(result.mobile).toBe(mobile);
    expect(Math.hypot(result.state.x-result.spawn.x,result.state.z-result.spawn.z)).toBeLessThan(1);
    // Mobile may already have evicted this distant tile after falling back.
    expect(tiles.some(url=>url.endsWith('/t_-1_-2.bin'))).toBe(true);
    expect(Math.hypot(result.state.x-blocked.x,result.state.z-blocked.z)).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
    if(mobile)await page.screenshot({path:testInfo.outputPath('blocked-save-safe-spawn.png')});
  });
});

test.describe('mobile open passage',()=>{
  test.use({viewport:{width:393,height:852},hasTouch:true,isMobile:true});
  test('a clear saved arrival under BMC restores after detailed collision validation',async({page},testInfo)=>{
    const saved={x:50,z:1755,yaw:-2.403};
    await page.addInitScript(position=>localStorage.setItem('backbay-drive-v1',JSON.stringify(position)),saved);
    await page.goto('/');await page.getByTestId('start-drive').click({timeout:90000});await expect(page.locator('#welcome')).toBeHidden();
    const result=await page.evaluate(()=>(window as any).__backbay.snapshot());
    expect(result.mobile).toBe(true);expect(Math.hypot(result.state.x-saved.x,result.state.z-saved.z)).toBeLessThan(1);
    expect(result.state.y).toBeLessThan(2);expect(result.tiles.keys).toContain('0_1');
    await page.screenshot({path:testInfo.outputPath('clear-bmc-save-restored.png')});
  });
  test('an unavailable saved neighborhood cannot be mistaken for clear geometry',async({page})=>{
    const saved={x:50,z:1755,yaw:-2.403};
    await page.route('**/data/tiles/t_0_1.bin',route=>route.abort());
    await page.addInitScript(position=>localStorage.setItem('backbay-drive-v1',JSON.stringify(position)),saved);
    await page.goto('/');await page.getByTestId('start-drive').click({timeout:90000});await expect(page.locator('#welcome')).toBeHidden();
    const result=await page.evaluate(()=>{const game=(window as any).__backbay;return{state:game.snapshot().state,spawn:game.city.spawn};});
    expect(Math.hypot(result.state.x-result.spawn.x,result.state.z-result.spawn.z)).toBeLessThan(1);
  });
});
