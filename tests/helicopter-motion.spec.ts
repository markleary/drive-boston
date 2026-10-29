import {test,expect} from '@playwright/test';

test('flight advances smoothly between physics ticks at 50–144 FPS',async({page},testInfo)=>{
  test.setTimeout(180000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    // Keep the real game loop and renderer, but control RAF timestamps so a
    // fast test machine cannot hide the 60 Hz simulation/render mismatch.
    const native=requestAnimationFrame.bind(window),queue:FrameRequestCallback[]=[];
    const clock={manual:false,now:0,
      async start(){this.now=performance.now();this.manual=true;await new Promise(native);},
      step(dt:number){this.now+=dt;for(const callback of queue.splice(0))callback(this.now);},
      resume(){this.manual=false;for(const callback of queue.splice(0))native(callback);}};
    window.requestAnimationFrame=callback=>clock.manual?queue.push(callback):native(now=>{if(clock.manual)queue.push(callback);else callback(now);});
    Object.assign(window,{__flightClock:clock});
  });
  await page.goto('/');await page.getByTestId('start-drive').click({timeout:120000});
  await page.keyboard.press('3');
  await page.evaluate(()=>(window as any).__backbay.flyTo(680,320,-450,-2.2048));
  await page.keyboard.down('w');
  await page.evaluate(()=>(window as any).__flightClock.start());
  const measurements=await page.evaluate(()=>{
    const {__flightClock:clock,__backbay:game}=window as any;
    // Reach steady cruise before measuring the individual frame displacements.
    for(let i=0;i<240;i++)clock.step(50);
    return Object.entries({fifty:[20],sixty:[1000/60],oneTwenty:[1000/120],oneFortyFour:[1000/144],uneven:[12,19,15,18]}).map(([name,intervals])=>{
      const frames:{speed:number;y:number;cameraDistance:number}[]=[];
      let before=game.snapshot().flight;
      for(let i=0;i<180;i++){
        const dt=intervals[i%intervals.length];clock.step(dt);
        const {flight,cameraPosition}=game.snapshot();
        if(i>=100)frames.push({speed:Math.hypot(flight.x-before.x,flight.z-before.z)*1000/dt,y:flight.y,cameraDistance:Math.hypot(cameraPosition.x-flight.x,cameraPosition.z-flight.z)});
        before=flight;
      }
      const range=(key:keyof typeof frames[number])=>Math.max(...frames.map(f=>f[key]))-Math.min(...frames.map(f=>f[key]));
      return{name,speedRange:range('speed'),altitudeRange:range('y'),cameraDistanceRange:range('cameraDistance'),minimumSpeed:Math.min(...frames.map(f=>f.speed))};
    });
  });
  await page.keyboard.up('w');
  await page.evaluate(()=>(window as any).__flightClock.resume());
  await page.screenshot({path:testInfo.outputPath('moving-chase.png')});
  await testInfo.attach('motion-measurements.json',{body:JSON.stringify(measurements,null,2),contentType:'application/json'});
  for(const sample of measurements){
    expect(sample.minimumSpeed,sample.name).toBeGreaterThan(53.6);
    expect(sample.speedRange,sample.name).toBeLessThan(.01);
    expect(sample.altitudeRange,sample.name).toBeLessThan(.001);
    expect(sample.cameraDistanceRange,sample.name).toBeLessThan(.08);
  }
  expect(errors).toEqual([]);
});
