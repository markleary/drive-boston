import {compassHeading,formatLocationReport,type HUDDiagnosticData} from './diagnostic-report';

/** Optional, low-frequency DOM diagnostics. Never reads or changes simulation state. */
export function createDiagnostics(host:HTMLElement,read:()=>HUDDiagnosticData){
  const group=document.createElement('div');group.className='hud diagnostics hidden';
  group.innerHTML=`
    <section id="performance-hud" class="diagnostic-panel performance-panel hidden" aria-label="Performance statistics">
      <div class="diagnostic-heading"><span>Performance</span><button type="button" id="hide-performance" aria-label="Hide performance statistics" title="Hide · P"><kbd>P</kbd> ×</button></div>
      <div class="performance-values"><span><strong id="performance-fps">—</strong> FPS</span><span><strong id="performance-frame">—</strong> ms / frame</span></div>
      <div class="diagnostic-secondary" id="performance-render">— draw calls · — triangles</div>
    </section>
    <section id="debug-hud" class="diagnostic-panel debug-panel hidden" aria-label="Location and debug statistics">
      <div class="diagnostic-heading"><span>Location & debug</span><button type="button" id="hide-debug" aria-label="Hide debug statistics" title="Hide · Backtick"><kbd>&#96;</kbd> ×</button></div>
      <div class="debug-place" id="debug-place">—</div>
      <dl class="debug-coordinates"><div><dt>X · east</dt><dd id="debug-x">—</dd></div><div><dt>Y · up</dt><dd id="debug-y">—</dd></div><div><dt>Z · south</dt><dd id="debug-z">—</dd></div></dl>
      <div class="diagnostic-secondary">World coordinates · meters · local elevation datum</div>
      <dl class="debug-details">
        <div><dt>Road ID</dt><dd id="debug-road-id">—</dd></div>
        <div><dt>Heading</dt><dd id="debug-heading">—</dd></div>
        <div><dt>Ground / above ground</dt><dd id="debug-ground">—</dd></div>
        <div><dt>Vehicle / camera</dt><dd id="debug-mode">—</dd></div>
        <div><dt>Light / graphics</dt><dd id="debug-rendering">—</dd></div>
        <div><dt>Cars / transit / people</dt><dd id="debug-actors">—</dd></div>
        <div><dt>Geometries / textures</dt><dd id="debug-resources">—</dd></div>
      </dl>
      <button type="button" class="debug-copy" id="copy-debug-report">Copy debug report</button>
      <div id="debug-copy-status" class="diagnostic-secondary debug-copy-status" role="status" aria-live="polite"></div>
      <textarea id="debug-report-fallback" class="hidden" readonly rows="5" aria-label="Debug report to copy manually" spellcheck="false"></textarea>
    </section>`;
  host.append(group);
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>group.querySelector<T>(`#${id}`)!;
  let performanceVisible=false,debugVisible=false,suspended=true,lastUpdate=-Infinity,copyTimer=0;
  const format=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
  const put=(id:string,text:string)=>{const node=el(id);if(node.textContent!==text)node.textContent=text;};
  const sync=()=>{
    if(!debugVisible&&el('debug-hud').contains(document.activeElement)&&(document.activeElement instanceof HTMLElement))document.activeElement.blur();
    group.classList.toggle('hidden',suspended||(!performanceVisible&&!debugVisible));
    el('performance-hud').classList.toggle('hidden',!performanceVisible);el('debug-hud').classList.toggle('hidden',!debugVisible);
    host.querySelector('[data-hud="performance"]')?.setAttribute('aria-pressed',String(performanceVisible));
    host.querySelector('[data-hud="debug"]')?.setAttribute('aria-pressed',String(debugVisible));
    lastUpdate=-Infinity;
  };
  const togglePerformance=()=>{performanceVisible=!performanceVisible;sync();update();};
  const toggleDebug=()=>{debugVisible=!debugVisible;sync();update();};
  function update(now=performance.now()){
    if(suspended||(!performanceVisible&&!debugVisible)||now-lastUpdate<250)return;
    lastUpdate=now;const data=read(),p=data.performance;
    if(performanceVisible){
      put('performance-fps',String(Math.round(p.fps)));put('performance-frame',p.frameMs.toFixed(1));
      put('performance-render',`${format.format(p.drawCalls)} draw calls · ${p.triangles>=1e6?`${(p.triangles/1e6).toFixed(2)}M`:format.format(p.triangles)} triangles`);
      el('performance-render').title='Renderer totals include shadow, reflection, and postprocessing passes.';
    }
    if(debugVisible){
      put('debug-place',`${data.neighborhood} · ${data.road.name}`);
      for(const axis of ['x','y','z'] as const)put(`debug-${axis}`,data.state[axis].toFixed(2));
      put('debug-road-id',data.road.id);
      put('debug-heading',`${compassHeading(data.state.yaw).toFixed(1)}° · yaw ${data.state.yaw.toFixed(4)}`);
      put('debug-ground',`${data.groundHeight.toFixed(2)} / ${(data.state.y-data.groundHeight).toFixed(2)} m`);
      put('debug-mode',`${data.travelMode==='helicopter'?'Helicopter':'Drive'} / ${data.camera==='hood'&&data.travelMode==='helicopter'?'cockpit':data.camera}`);
      put('debug-rendering',`${data.lighting==='golden'?'Golden hour':data.lighting==='day'?'Daylight':'Night'} / ${data.quality==='high'?'Detailed':'Balanced'}`);
      put('debug-actors',`${p.traffic} / ${p.transit} / ${p.pedestrians}`);
      put('debug-resources',`${format.format(p.geometries)} / ${format.format(p.textures)}`);
    }
  }
  async function copyReport(){
    const report=formatLocationReport({...read(),timestamp:new Date().toISOString()});
    window.clearTimeout(copyTimer);el('debug-report-fallback').classList.add('hidden');
    try{await navigator.clipboard.writeText(report);put('debug-copy-status','Copied — paste this with your issue.');}
    catch{
      const fallback=el<HTMLTextAreaElement>('debug-report-fallback');fallback.value=report;fallback.classList.remove('hidden');fallback.focus();fallback.select();
      put('debug-copy-status','Copy unavailable. Select and copy the report below.');
    }
    copyTimer=window.setTimeout(()=>put('debug-copy-status',''),5000);
  }
  el('hide-performance').addEventListener('click',togglePerformance);el('hide-debug').addEventListener('click',toggleDebug);
  el('copy-debug-report').addEventListener('click',copyReport);
  return{update,togglePerformance,toggleDebug,suspend(value:boolean){suspended=value;sync();},destroy(){window.clearTimeout(copyTimer);group.remove();}};
}
