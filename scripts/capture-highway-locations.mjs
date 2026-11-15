/** Matched screenshot audit of the eight November 14 highway reports.
 * Run against a pristine build first, then the repaired build:
 * node scripts/capture-highway-locations.mjs before 4174
 * node scripts/capture-highway-locations.mjs after 4173
 * SITE=06 restricts a diagnostic run to one location. */
import { chromium } from '@playwright/test';
import {fileURLToPath} from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const phase=process.argv[2]||'before',port=process.argv[3]||'4174';
const out=fileURLToPath(new URL('../reports/highway-locations/'+phase+'/',import.meta.url));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|Shader Error|THREE\.WebGLProgram/i.test(m.text()))errors.push(m.text());});
const sites=[
 ['01-western-avenue',-3568.12,-1562.54,.1125,'drive',0,'11821-0-0'],
 ['02-charlestown-ramp',-124.40,-3573.94,-.2705,'air',111.03],
 ['03-atlantic-openings',1941.99,-586.49,-3.1252,'air',55.9],
 ['04-south-station',1491.93,171.44,-1.7763,'air',71.21],
 ['05-i90-opening',1263.28,411.79,1.7397,'air',43.84],
 ['06-building-shells',1289.46,-1709.40,.0093,'air',78.49],
 ['07-leverett-width',724.46,-1803.03,1.6879,'air',44.6],
 ['08-river-street',-3536,-1201.89,.5201,'drive',0,'11818-0-0'],
];
await page.addInitScript(()=>{localStorage.setItem('backbay-drive-v1',JSON.stringify({x:-3568.12,z:-1562.54,yaw:.1125,roadId:'11821-0-0'}));});
await page.goto('http://127.0.0.1:'+port);
await page.getByTestId('start-drive').click({timeout:120000});
await page.waitForFunction(()=>window.__backbay?.ready,undefined,{timeout:120000});
const snapshots=[];
for(const [id,x,z,yaw,mode,y,road] of sites.filter(s=>!process.env.SITE||s[0].startsWith(process.env.SITE))){
 await page.keyboard.press(mode==='air'?'3':'1');
 if(mode==='air'){
  await page.evaluate(async p=>await window.__backbay.flyTo(...p),[x,y,z,yaw]);
  await page.keyboard.press('c');
  await page.mouse.move(800,350);await page.mouse.down();await page.mouse.move(800,535,{steps:12});await page.mouse.up();
 }else{
  await page.evaluate(async p=>await window.__backbay.travelTo(...p),[x,z,yaw,road]);
  await page.keyboard.down('Space'); // Hold the comparison pose on sloping roadbeds.
 }
 await page.waitForTimeout(6500);
 // A slow frame budget can leave neighboring scenery half built long after
 // the teleport's supporting road is ready. Compare settled neighborhoods.
 await page.waitForFunction(()=>{const t=window.__backbay.snapshot().tiles;return !t||(!t.building&&!t.pending&&!t.fetching);},undefined,{timeout:180000,polling:500});
 await page.waitForTimeout(300);
 await page.screenshot({path:out+'/'+id+'.png'});
 snapshots.push({id,requested:{x,z,yaw,mode,y,road},snapshot:await page.evaluate(()=>window.__backbay.snapshot())});
 if(mode==='drive')await page.keyboard.up('Space');
 console.log('captured',phase,id);
 // Switching to drive before the next site resets camera pitch consistently.
 if(mode==='air')await page.keyboard.press('1');
}
await writeFile(out+'/snapshots.json',JSON.stringify({errors,snapshots},null,2));
await browser.close();
if(errors.length){console.error(errors);process.exitCode=1;}
