import {test,expect,type Page} from '@playwright/test';

type Mall={trees:number;benches:number;fencePanels:number;walks:number;monuments:string[]};
type Snapshot={state:{x:number;z:number};walker:{x:number;z:number};tiles:{keys:string[]}};
type Hooks={snapshot():Snapshot;commonwealthMall():Mall;walkTo(x:number,z:number,yaw:number):void;travelTo(x:number,z:number,yaw:number):void};

// The block from Exeter Street to Fairfield Street in its own frame: metres west of its Exeter Street end along the
// axis, metres north of the axis across it (src/simulation/commonwealth-mall.ts).
const EAST=[-466.91,-125.55],AXIS=[-.93859,.3449],NORTH=[-.3449,-.93859],WEST=Math.atan2(AXIS[0],AXIS[1]);
const at=(s:number,v:number):[number,number]=>[EAST[0]+AXIS[0]*s+NORTH[0]*v,EAST[1]+AXIS[1]*s+NORTH[1]*v];
const along=(p:{x:number;z:number})=>(p.x-EAST[0])*AXIS[0]+(p.z-EAST[1])*AXIS[1];

async function hold(page:Page,key:string,ms:number){await page.keyboard.down(key);try{await page.waitForTimeout(ms);}finally{await page.keyboard.up(key);}}

test('the Commonwealth Avenue Mall: a fenced lawn, a walk through its gate, a monument on the block',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)/i.test(message.text()))errors.push(message.text());});
  // Exeter Street, where it crosses the Mall.
  const [startX,startZ]=at(-9.7,-9);
  await page.addInitScript(([x,z])=>localStorage.setItem('backbay-drive-v1',JSON.stringify({x,z,yaw:0})),[startX,startZ]);
  await page.goto('/');
  await expect(page.getByTestId('start-drive')).toBeEnabled({timeout:90000});
  await page.getByTestId('start-drive').click();
  await expect(page.locator('#welcome')).toBeHidden();
  const snapshot=()=>page.evaluate(()=>(window as unknown as {__backbay:Hooks}).__backbay.snapshot());
  const built=()=>page.evaluate(()=>(window as unknown as {__backbay:Hooks}).__backbay.commonwealthMall());
  const walkTo=(p:[number,number])=>page.evaluate(([x,z,yaw])=>(window as unknown as {__backbay:Hooks}).__backbay.walkTo(x,z,yaw),[...p,WEST]);
  // The tile that holds five of the blocks; its fences and monuments stand once its parks are built.
  await expect.poll(async()=>(await built()).monuments.length,{timeout:80000}).toBeGreaterThanOrEqual(5);
  const mall=await built();
  for(const name of ['Patrick Andrew Collins','Vendome Firefighters Memorial','William Lloyd Garrison','Samuel Eliot Morison',"Boston Women's Memorial"])expect(mall.monuments).toContain(name);
  expect(new Set(mall.monuments).size).toBe(mall.monuments.length);
  expect(mall.trees).toBeGreaterThan(200);expect(mall.benches).toBeGreaterThan(40);expect(mall.fencePanels).toBeGreaterThanOrEqual(80);

  // On foot from the Exeter Street sidewalk: the walk leads through the gate, toward Samuel Eliot Morison on his rock.
  await page.keyboard.press('Digit4');
  await walkTo(at(-2.5,.2));
  await page.waitForTimeout(800);
  await page.screenshot({path:testInfo.outputPath('mall-from-exeter-street.png')});
  await hold(page,'KeyW',6000);
  const walked=along((await snapshot()).walker);
  expect(walked,`walked to ${walked.toFixed(1)} m inside the block`).toBeGreaterThan(4);

  // Eight metres north of the walk the fence stands across the lawn's end.
  await walkTo(at(-2.5,8.5));
  await page.waitForTimeout(500);
  await hold(page,'KeyW',4500);
  const stopped=along((await snapshot()).walker);
  expect(stopped,`stopped ${stopped.toFixed(2)} m from the lawn's end`).toBeLessThan(.95);expect(stopped).toBeGreaterThan(-1.2);
  await page.screenshot({path:testInfo.outputPath('mall-fence.png')});

  // A car driven at the fence from Exeter Street does not reach the lawn.
  await page.keyboard.press('Digit1');
  const car=at(-9.7,9);
  await page.evaluate(([x,z,yaw])=>(window as unknown as {__backbay:Hooks}).__backbay.travelTo(x,z,yaw),[...car,WEST]);
  await page.waitForTimeout(1200);
  await hold(page,'ArrowUp',4000);
  const driven=along((await snapshot()).state);
  expect(driven,`the car's centre stopped ${driven.toFixed(2)} m from the lawn's end`).toBeLessThan(.5);expect(driven).toBeGreaterThan(-8);
  await page.screenshot({path:testInfo.outputPath('mall-car-at-fence.png')});
  expect(errors).toEqual([]);
});
