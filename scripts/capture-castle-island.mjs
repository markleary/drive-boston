import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=new URL('../artifacts/castle-island/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
const mobile=process.env.MOBILE==='1';
const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1600,height:1000},...(mobile?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})}),errors=[];
await page.route('**/node_modules/three/build/*.js',route=>route.fulfill({path:new URL('../node_modules/three/build/'+new URL(route.request().url()).pathname.split('/').at(-1),import.meta.url).pathname,contentType:'text/javascript'}));
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error/.test(m.text()))errors.push(m.text());});
await page.addInitScript(()=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x:4905.7,z:1226.57,yaw:1.525})));
await page.goto('http://127.0.0.1:'+(process.env.PORT??4180));
await page.getByTestId('start-drive').click({timeout:120000});
await page.waitForFunction(()=>window.__backbay?.ready,undefined,{timeout:120000});
console.log('Game ready');
await page.keyboard.press('3');
await page.evaluate(()=>window.__backbay.flyTo(5150,110,1400,Math.PI));
console.log('At Castle Island');
for(let attempt=0;attempt<12;attempt++){
 const t=await page.evaluate(()=>window.__backbay.snapshot().tiles);console.log(JSON.stringify({loaded:t.loaded,underConstruction:t.underConstruction,pending:t.pending,fetching:t.fetching,downloaded:t.downloaded}));
 if(!t.underConstruction&&!t.pending&&!t.fetching)break;
 
 await page.waitForTimeout(15000);
 if(attempt===11)throw new Error('Castle Island streaming did not settle');
}
const shots=[['bay',[4800,1350,1900],[4800,0,1700]],['fort',[5440,240,1450],[5260,8,1290]],['harbor',[5440,32,1170],[5260,10,1280]],['gate',[5168,11,1304],[5230,9,1295]]];
for(const [name,eye,target] of shots){
 const image=await page.evaluate(async({eye,target})=>{const THREE=await import('/node_modules/three/build/three.module.js');const d=window.__backbay,c=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,eye[1]>100?5:.15,4000);c.position.set(...eye);c.lookAt(...target);c.updateMatrixWorld();const fog=d.scene.fog;d.scene.fog=null;d.renderer.render(d.scene,c);const image=d.renderer.domElement.toDataURL('image/png');d.scene.fog=fog;return image;},{eye,target});
 await writeFile(new URL((process.env.BEFORE?'before-':'')+name+(mobile?'-mobile':'')+'.png',out),Buffer.from(image.split(',')[1],'base64'));console.log('Captured',name);
}
if(process.env.WALK==='1'){
 await page.keyboard.press('4');
 await page.evaluate(()=>window.__backbay.walkTo(5183.67,1298.182,Math.atan2(.965,-.261),7));
 await page.waitForTimeout(1000);
 await page.keyboard.down('w');await page.keyboard.down('Shift');
 let passed=false,minimumY=Infinity;
 try{
  for(let i=0;i<80;i++){
   const p=await page.evaluate(()=>window.__backbay.snapshot().walker),depth=(p.x-5195.25)*.965+(p.z-1295.05)*(-.261);minimumY=Math.min(minimumY,p.y);
   if(depth>24){passed=true;break;}
   await page.waitForTimeout(300);
  }
 }finally{await page.keyboard.up('w');await page.keyboard.up('Shift');}
 assert.ok(passed,'walk through the public gateway into the parade ground');assert.ok(minimumY>4.5,'the gateway approach stays supported');
 await page.screenshot({path:new URL('courtyard-walk.png',out).pathname});console.log('Walked through the fort gateway');
 await page.evaluate(()=>window.__backbay.walkTo(5216,1271,Math.atan2(41,-34),7));
 await page.waitForTimeout(700);await page.keyboard.down('w');await page.keyboard.down('Shift');
 let climbed=false;
 try{for(let i=0;i<110;i++){const p=await page.evaluate(()=>window.__backbay.snapshot().walker);if(p.y>13.5&&Math.hypot(p.x-5257,p.z-1237)<6){climbed=true;break;}await page.waitForTimeout(300);}}
 finally{await page.keyboard.up('w');await page.keyboard.up('Shift');}
 assert.ok(climbed,'walk up the ramp to the upper fort walkway');
 await page.screenshot({path:new URL('ramp-walk.png',out).pathname});console.log('Walked up the ramparts');
}
const s=await page.evaluate(()=>window.__backbay.snapshot());
assert.equal(s.mobile,mobile);assert.equal(s.graphicsContext.losses,0);assert.equal(s.tiles.failed,0);
await writeFile(new URL((process.env.BEFORE?'before-':'')+'audit'+(mobile?'-mobile':'')+'.json',out),JSON.stringify({errors,mobile:s.mobile,fps:s.fps,drawCalls:s.drawCalls,triangles:s.triangles,graphicsContext:s.graphicsContext,tiles:s.tiles,castleIsland:s.bridges.castleIsland},null,2));
assert.deepEqual(errors,[]);
} finally { await browser.close(); }
