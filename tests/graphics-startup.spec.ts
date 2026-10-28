import {test,expect,type Page} from '@playwright/test';

async function lose(page:Page){
  await page.locator('#scene canvas').evaluate((canvas:HTMLCanvasElement)=>{
    const ext=canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    Object.assign(window,{__restoreStartupContext:()=>ext.restoreContext()});ext.loseContext();
  });
  await expect(page.locator('#graphics-modal')).toBeVisible();
}
const restore=(page:Page)=>page.evaluate(()=>(window as any).__restoreStartupContext());
async function finish(page:Page){
  await expect(page.locator('#start-drive')).toBeEnabled({timeout:90000});
  await expect(page.locator('#resume-graphics')).toBeEnabled();await page.locator('#resume-graphics').click();
  await page.locator('#start-drive').click();await expect(page.locator('#welcome')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).__backbay.snapshot().paused)).toBe(false);
}
async function instrument(page:Page,holdCompile=false){
  await page.addInitScript(hold=>{
    const state={hold,waiting:false,lostShaderCreates:0};Object.assign(window,{__startupGPU:state});
    const proto=WebGL2RenderingContext.prototype,create=proto.createShader,getExtension=proto.getExtension,getParameter=proto.getProgramParameter;
    let completion:number|undefined;
    proto.createShader=function(type){if(this.isContextLost())state.lostShaderCreates++;return create.call(this,type);};
    proto.getExtension=function(this:WebGL2RenderingContext,name:string):any{const ext=Reflect.apply(getExtension,this,[name]);if(name==='KHR_parallel_shader_compile'&&ext)completion=ext.COMPLETION_STATUS_KHR;return ext;};
    proto.getProgramParameter=function(program,name){
      if((window as any).__backbay&&state.hold&&name===completion&&!this.isContextLost()){state.waiting=true;return false;}
      return getParameter.call(this,program,name);
    };
  },holdCompile);
}
const collectErrors=(page:Page)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||/GL_INVALID|INVALID_(?:OPERATION|VALUE|ENUM)|Shader Error/i.test(m.text()))errors.push(m.text());});
  return errors;
};

for(const mobile of [true,false])test.describe(mobile?'phone startup interruption':'desktop startup interruption',()=>{
  test.use(mobile?{viewport:{width:393,height:852},hasTouch:true,isMobile:true}:{});
  test(mobile?'tile download finishes while graphics stay lost':'context restores while initial tile download is still pending',async({page},testInfo)=>{
    test.setTimeout(180000);const errors=collectErrors(page);await instrument(page);
    let blocked=false,unblock!:()=>void;const downloadGate=new Promise<void>(resolve=>{unblock=resolve;});
    await page.route('**/data/tiles/**',async route=>{if(!blocked){blocked=true;await downloadGate;}await route.continue();});
    try{
      await page.goto('/',{waitUntil:'domcontentloaded'});await expect.poll(()=>blocked,{timeout:90000}).toBe(true);
      await lose(page);await expect(page.locator('#start-drive')).toBeDisabled();
      if(mobile){unblock();await page.waitForTimeout(1000);await expect(page.locator('#start-drive')).toBeDisabled();await restore(page);}
      else{await restore(page);await page.waitForTimeout(500);await expect(page.locator('#resume-graphics')).toBeDisabled();unblock();}
      await finish(page);
      const s=await page.evaluate(()=>(window as any).__backbay.snapshot());
      expect(s.graphicsContext).toEqual({lost:false,losses:1,builds:1});
      expect(await page.evaluate(()=>(window as any).__startupGPU.lostShaderCreates)).toBe(0);
      await page.screenshot({path:testInfo.outputPath('startup-recovered.png')});expect(errors).toEqual([]);
    }finally{unblock();}
  });
});

test('desktop startup retries interrupted shader warm-up without waiting for its old context',async({page},testInfo)=>{
  test.setTimeout(180000);const errors=collectErrors(page);await instrument(page,true);
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect.poll(()=>page.evaluate(()=>(window as any).__startupGPU.waiting),{timeout:90000}).toBe(true);
  await expect(page.locator('#start-drive')).toBeDisabled();await lose(page);
  await page.setViewportSize({width:1000,height:650});await page.waitForTimeout(500);
  await restore(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).__backbay.snapshot().graphicsContext.builds)).toBe(2);
  await expect(page.locator('#resume-graphics')).toBeDisabled();
  await page.evaluate(()=>(window as any).__startupGPU.hold=false);await finish(page);
  expect(await page.evaluate(()=>(window as any).__backbay.snapshot().graphicsContext)).toEqual({lost:false,losses:1,builds:2});
  expect(await page.evaluate(()=>(window as any).__startupGPU.lostShaderCreates)).toBe(0);
  await page.screenshot({path:testInfo.outputPath('warmup-recovered.png')});expect(errors).toEqual([]);
});
