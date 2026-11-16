import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// Run against a built preview: PORT=4180 DRIVE=1 node scripts/capture-waterfront.mjs
// SITE accepts comma-separated tour stops; MOBILE=1 exercises the mobile renderer.
const out=new URL('../artifacts/waterfront/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const mobile=process.env.MOBILE==='1';
const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1600,height:1000},...(mobile?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})}),errors=[];
// The production preview does not expose dependencies. Supply the same local
// Three modules only to this test page for its inspection camera.
await page.route('**/node_modules/three/build/*.js',route=>route.fulfill({path:new URL('../node_modules/three/build/'+new URL(route.request().url()).pathname.split('/').at(-1),import.meta.url).pathname,contentType:'text/javascript'}));
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:2956,z:50,yaw:2.64})));
await page.goto('http://127.0.0.1:'+(process.env.PORT??4174));
await page.getByTestId('start-drive').click({timeout:120000});
await page.waitForFunction(()=>window.__backbay?.ready,undefined,{timeout:120000});
await page.keyboard.press('3');
const sites=[
  ['fish-pier',[2980,70,-70],[2903,24,120],[3020,5,-130]],
  ['piers-park',[3100,90,-1530],[2850,115,-1300],[3130,0,-1570]],
  ['downtown-wharves',[2080,110,-1580],[2370,180,-1250],[2010,0,-1600]],
  ['conley-terminal',[4300,100,1000],[4320,100,580],[4320,18,1040]],
  ['navy-yard',[1640,100,-2630],[1870,130,-2400],[1550,0,-2650]],
  ['chelsea',[3000,110,-3900],[3150,170,-3550],[2900,0,-3950]],
];
const snapshots=[];
for(const [name,fly,eye,target] of sites.filter(s=>!process.env.SITE||process.env.SITE.split(',').includes(s[0]))){
  await page.evaluate(async p=>window.__backbay.flyTo(...p),[fly[0],fly[1],fly[2],Math.PI]);
  await page.waitForFunction(()=>{const t=window.__backbay.snapshot().tiles;return !t||(!t.underConstruction&&!t.pending&&!t.fetching&&!t.downloaded);},undefined,{timeout:180000,polling:500});
  await page.screenshot({path:new URL(name+(mobile?'-mobile':'')+'-game.png',out).pathname});
  const capture=await page.evaluate(async({eye,target})=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const d=window.__backbay,camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.15,4000);
    camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld();
    d.renderer.render(d.scene,camera);
    const image=d.renderer.domElement.toDataURL('image/png');
    const waterfront=[];d.scene.traverse(o=>{if(o.userData.waterfront)waterfront.push(o.userData.waterfront);});
    const s=d.snapshot();
    return {image,waterfront,snapshot:{mobile:s.mobile,fps:s.fps,drawCalls:s.drawCalls,triangles:s.triangles,textures:s.textures,geometries:s.geometries,graphicsContext:s.graphicsContext,tiles:{loaded:s.tiles?.loaded,failed:s.tiles?.failed,cpuMs:s.tiles?.cpuMs},conley:s.bridges.conley,fishPier:s.bridges.fishPier}};
  },{eye,target});
  assert.equal(capture.snapshot.mobile,mobile,'requested desktop/mobile rendering path is active');
  assert.equal(capture.snapshot.graphicsContext.losses,0,`${name}: graphics context remains healthy`);
  assert.equal(capture.snapshot.tiles.failed,0,`${name}: all requested tiles load`);
  await writeFile(new URL(name+(mobile?'-mobile':'')+'.png',out),Buffer.from(capture.image.split(',')[1],'base64'));
  snapshots.push({name,waterfront:capture.waterfront,snapshot:capture.snapshot});
  console.log('Captured',name);
  if(process.env.DRIVE==='1'&&name==='fish-pier'){
    await page.keyboard.press('1');
    await page.evaluate(()=>window.__backbay.travelTo(2963.864,-4.161,2.64045));
    const began=Date.now(),held=new Set();let passed=false,minimumY=Infinity;
    const key=async(k,down)=>{if(down&&!held.has(k)){await page.keyboard.down(k);held.add(k);}else if(!down&&held.has(k)){await page.keyboard.up(k);held.delete(k);}};
    try{
      while(Date.now()-began<60000){
        const s=await page.evaluate(()=>window.__backbay.snapshot().state),u=(s.x-2956.658)*.877+(s.z-8.99)*.4805,v=-(s.x-2956.658)*.4805+(s.z-8.99)*.877;
        minimumY=Math.min(minimumY,s.y);
        if(v< -210){passed=true;break;}
        const yaw=2.64045+Math.max(-.18,Math.min(.18,u*.025)),error=Math.atan2(Math.sin(yaw-s.yaw),Math.cos(yaw-s.yaw));
        await key('w',s.speed<10);await key('a',error>.018);await key('d',error<-.018);await page.waitForTimeout(120);
      }
    }finally{for(const k of held)await page.keyboard.up(k);}
    assert.ok(passed,'drive the full central Fish Pier aisle without a new obstruction');
    assert.ok(minimumY>-2,'vehicle stays supported by the pier');
    console.log('Fish Pier drive aisle passed');
    await page.screenshot({path:new URL('fish-pier-driven.png',out).pathname});await page.keyboard.press('3');
  }
}
await writeFile(new URL('audit'+(mobile?'-mobile':'')+(process.env.SITE?'-'+process.env.SITE.replaceAll(',','-'):'')+'.json',out),JSON.stringify({errors,snapshots},null,2));
await browser.close();if(errors.length){console.error(errors);process.exitCode=1;}
