import type { CameraMode, CityData, DriveInput, LightingMode, Point2, TravelMode, VehicleState } from '../types';
import type { QualityMode } from '../render/graphics';
import { areaAt, indexAreas } from './geography';
import {createDiagnostics} from './diagnostics';
import type {HUDPerformanceData} from './diagnostic-report';
import {closestRoad} from '../simulation/roads';
import {sampleDriveSurface} from '../simulation/road-surfaces';
import {HELICOPTER} from '../simulation/helicopter';
import {createMinimapLabeler} from './minimap-labels';

export interface InterfaceCallbacks {
  onReset(): void;
  onCamera(mode: CameraMode): void;
  onLighting(mode: LightingMode): void;
  onPause(paused: boolean): void;
  onDestination(landmarkId: string): void;
  onSound?(enabled: boolean): void;
  onStart?(): void;
  onQuality?(mode: QualityMode): void;
  onTravelMode?(mode: TravelMode): void;
}

export interface InterfaceStats {
  fps?: number;
  distance?: number;
  travelMode?: TravelMode;
  /** Height above the local ground, in meters. */
  altitude?: number;
  verticalSpeed?: number;
  gear?:number;
  rpm?:number;
  performance?:HUDPerformanceData;
  groundHeight?:number;
  quality?:QualityMode;
}

const icons = {
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z"/><path d="M9 3v16M15 5v16"/>',
  camera: '<path d="M3 7h12v12H3zM15 10l6-3v12l-6-3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  target: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
};
const svg = (name: keyof typeof icons) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const cameraNames: Record<CameraMode, string> = { chase: 'Chase camera', hood: 'Hood camera', aerial: 'Aerial camera' };
// Title screen copy. Status lines follow the displayed percentage; tips rotate while the screen is up.
const LOAD_STEPS: [number, string][] = [[12,'Paving the Mass Pike'],[26,'Placing 4,000 orange cones'],[40,'Streaming Back Bay brownstones'],[54,'Timing the lights on Comm Ave'],[68,'Filling the Zakim with traffic'],[82,'Removing turn signals from local drivers'],[100,'Lighting up the Custom House clock']];
const LOAD_TIPS = ['Storrow Drive overpasses are low. Box trucks get “Storrowed” every September.','Rotaries: traffic already in the circle has the right of way. In theory.','The Big Dig put I-93 underground. Follow the overhead signs in the tunnels.','Park in the Seaport and walk to the North End. There are no spots on Hanover Street.','The Harvard Bridge on Mass Ave is 364.4 smoots long, plus or minus one ear.'];
const EMBLEM = '<svg class="welcome-emblem" viewBox="0 0 120 120" role="img" aria-label="Boston Free Drive emblem"><circle cx="60" cy="60" r="55" fill="none" stroke="currentColor" stroke-width="5"/><g stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M60 34 28 78M60 44 42 78M60 34l32 44M60 44l18 34"/></g><g stroke="#f3eee6" stroke-linecap="round" fill="none"><path d="M60 22v36M60 58 50 88M60 58l10 30" stroke-width="7"/><path d="M22 78h76" stroke-width="6"/></g></svg>';

function distanceToSegment(point: Point2, a: Point2, b: Point2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
}

/** DOM HUD and north-up map. World coordinates are east (+x), south (+z), in meters. */
export function createInterface(city: CityData, callbacks: InterfaceCallbacks) {
  const host = document.querySelector<HTMLElement>('#interface')!;
  if (!host) throw new Error('Missing game interface container');
  host.classList.add('not-started');
  host.innerHTML = `
    <div class="hud brand"><div class="brand-symbol" aria-hidden="true">B</div><div><div class="brand-name">BOSTON</div><div class="brand-subtitle" id="neighborhood-label">Back Bay, Massachusetts</div></div></div>
    <div class="hud location-pill"><span class="location-dot"></span><span id="location-label">Copley Square</span></div>
    <nav class="hud travel-switch" aria-label="Travel mode"><button data-travel="drive" data-testid="mode-drive" class="active" aria-pressed="true" aria-label="Drive mode">Drive <kbd>1</kbd></button><button data-travel="helicopter" data-testid="mode-helicopter" aria-pressed="false" aria-label="Helicopter mode">Helicopter <kbd>2</kbd></button></nav>
    <nav class="hud toolbar" aria-label="Drive controls">
      <button class="tool-btn wide" id="open-map" aria-label="Open map" title="Map · M">${svg('map')}<span>Map <span class="key">M</span></span></button>
      <button class="tool-btn" id="cycle-camera" aria-label="Change camera" title="Change camera · C">${svg('camera')}</button>
      <button class="tool-btn" id="open-settings" aria-label="Pause and open settings" title="Pause · Esc">${svg('menu')}</button>
    </nav>
    <div class="hud minimap-wrap"><button class="minimap-button" id="minimap-button" aria-label="Open Boston map"><canvas id="minimap" aria-label="Your position in Boston"></canvas></button><span class="minimap-north">N</span><div class="map-caption">Explore Boston <kbd>M</kbd></div></div>
    <div class="hud speed-cluster" aria-label="Vehicle instruments"><div class="speed-label"><span id="gear" class="gear">D</span><span id="journey-label">AFTERNOON DRIVE</span></div><div><span class="speed-value" id="speed-value">0</span><span class="speed-unit">MPH</span></div><div class="altitude-readout hidden" id="altitude-readout"><div class="altitude-number"><span id="altitude-value">0</span><span class="altitude-unit">FT</span></div><div class="altitude-caption">Above ground <span id="vertical-speed">LEVEL</span></div></div><div class="speed-line"><div class="speed-fill" id="speed-fill"></div></div><div class="camera-label" id="camera-label">Chase camera</div></div>
    <div class="hud hint" id="drive-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Drive</span><span><kbd>Space</kbd> Handbrake</span><span><kbd>R</kbd> Reset</span></div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <section class="welcome" id="welcome" aria-label="Welcome to Boston">
      <img class="welcome-scene" id="welcome-scene" src="${import.meta.env.BASE_URL}title-scene.jpg" alt="" aria-hidden="true"><div class="welcome-veil" id="welcome-veil" aria-hidden="true"></div><div class="welcome-shade" aria-hidden="true"></div>
      <div class="welcome-top">${EMBLEM}<div class="welcome-wordmark"><span>BOSTON</span><span class="welcome-slash">/</span><span class="welcome-accent">FREE DRIVE</span></div></div>
      <div class="welcome-content"><div class="welcome-eyebrow">NO MISSIONS. NO TIMER.</div><h1>Boston.</h1><p class="welcome-description">Just the city, from the Pike to the Tobin. Pick a direction and drive.</p>
        <div class="welcome-loader"><div class="loading-row"><span class="loading-copy" id="loading-copy" role="status">${LOAD_STEPS[0][1]}</span><span class="loading-pct" id="loading-pct" aria-hidden="true">0%</span></div><div class="loading-track" id="loading-track" role="progressbar" aria-label="Loading Boston" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="loading-progress" id="loading-progress"></div></div>
          <div class="ready-row"><span class="ready-copy">Your car is ready.</span><button class="welcome-start" id="start-drive" disabled data-testid="start-drive">Start driving ${svg('arrow')}</button></div></div>
        <div class="welcome-foot">Single player / Keyboard, touch or gamepad</div></div>
      <div class="welcome-tip"><span class="welcome-tip-count" id="welcome-tip-count">TIP 01 / 05</span><p id="welcome-tip">${LOAD_TIPS[0]}</p></div>
      <div class="welcome-coordinate">42.3499° N &nbsp; 71.0773° W</div>
    </section>
    <section class="modal-scrim hidden" id="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="panel"><button class="close-btn" id="close-settings" aria-label="Resume driving">${svg('close')}</button><div class="eyebrow">Take a moment</div><h2 id="settings-title">Your afternoon.</h2>
        <span class="setting-label">Time of day</span><div class="segments" aria-label="Time of day"><button data-light="golden" class="active" aria-pressed="true">Golden hour</button><button data-light="day" aria-pressed="false">Daylight</button><button data-light="night" aria-pressed="false">Night</button></div>
        <span class="setting-label">Your view</span><div class="segments" aria-label="Camera"><button data-camera="chase" class="active" aria-pressed="true">Chase</button><button data-camera="hood" aria-pressed="false">Hood</button><button data-camera="aerial" aria-pressed="false">Aerial</button></div>
        <span class="setting-label">City sound</span><div class="segments" aria-label="City sound"><button data-sound="on" class="active" aria-pressed="true">Sound on</button><button data-sound="off" aria-pressed="false">Muted</button></div>
        <span class="setting-label">Graphics</span><div class="segments" aria-label="Graphics quality"><button data-quality="high" class="active" aria-pressed="true">Detailed</button><button data-quality="balanced" aria-pressed="false">Balanced</button></div>
        <span class="setting-label">HUD diagnostics</span><div class="segments" aria-label="HUD diagnostics"><button data-hud="performance" aria-pressed="false">Performance <kbd>P</kbd></button><button data-hud="debug" aria-pressed="false">Debug <kbd>&#96;</kbd></button></div>
        <div class="controls-grid" id="controls-help"><span>Accelerate / brake & reverse</span><span><kbd>W</kbd> <kbd>S</kbd></span><span>Steer</span><span><kbd>A</kbd> <kbd>D</kbd></span><span>Handbrake</span><kbd>Space</kbd><span>Drive / helicopter</span><span><kbd>1</kbd> <kbd>2</kbd></span><span>Map / change camera</span><span><kbd>M</kbd> <kbd>C</kbd></span><span>Horn / mute sound</span><span><kbd>F</kbd> <kbd>N</kbd></span><span>Reset car / hide interface</span><span><kbd>R</kbd> <kbd>H</kbd></span><span>Pause</span><kbd>Esc</kbd></div>
        <div class="panel-actions"><button class="primary" id="resume-drive">Keep driving ${svg('arrow')}</button><button class="text-btn" id="reset-drive">Reset car</button></div><div style="margin-top:20px"><button class="text-btn" id="open-credits">About this city</button></div>
      </div>
    </section>
    <section class="modal-scrim hidden" id="credits-modal" role="dialog" aria-modal="true" aria-labelledby="credits-title"><div class="panel"><button class="close-btn" id="close-credits" aria-label="Back to settings">${svg('close')}</button><div class="eyebrow">An independent prototype</div><h2 id="credits-title">A real place.</h2><div class="credits-copy"><p>Built around Boston’s real streets, building shapes, and hills. Façades and street details are artistic interpretations; this is an exploration game, not a navigation service.</p><ul id="source-list"></ul><p>Original game implementation with Three.js and Rapier.</p></div></div></section>
    <section class="map-modal hidden" id="map-modal" role="dialog" aria-modal="true" aria-labelledby="map-title"><div class="map-header"><div><div class="eyebrow">The Boston atlas</div><h2 id="map-title">Find your next turn.</h2></div><button class="close-map" id="close-map">Back to driving <kbd>M</kbd></button></div><canvas id="fullmap" aria-label="Interactive map of Boston streets, buildings and landmarks"></canvas><div class="map-tools"><button id="map-zoom-in" aria-label="Zoom map in">+</button><button id="map-zoom-out" aria-label="Zoom map out">−</button><button id="map-center" aria-label="Center map on car">${svg('target')}</button><button id="map-overview" aria-label="Show all Boston destinations" title="Show all destinations">${svg('map')}</button></div><aside class="map-places" id="map-places"><div class="map-places-heading">Places to explore<span>Choose a place to start nearby</span></div><div class="map-destinations" id="map-destinations" role="navigation" aria-label="Landmark destinations"></div></aside><div class="map-note">Drag to explore · Scroll to zoom</div></section>
    <div class="touch-controls suspended" id="touch-controls" aria-label="Touch driving controls"><div class="touch-pad"><button class="touch-btn" data-touch="left" aria-label="Steer left">←</button><button class="touch-btn" data-touch="right" aria-label="Steer right">→</button></div><button class="touch-btn brake" data-touch="handbrake" aria-label="Handbrake">BRAKE</button><div class="touch-pad"><button class="touch-btn" data-touch="reverse" aria-label="Brake and reverse">↓</button><button class="touch-btn" data-touch="accelerate" aria-label="Accelerate">↑</button></div></div>
    <div class="flight-touch suspended" id="flight-touch" aria-label="Helicopter lift and rotation"><button class="touch-btn" data-touch="yaw-left" aria-label="Rotate helicopter left">↶</button><button class="touch-btn" data-touch="yaw-right" aria-label="Rotate helicopter right">↷</button><button class="touch-btn" data-touch="descend" aria-label="Descend">⇩</button><button class="touch-btn" data-touch="ascend" aria-label="Ascend">⇧</button></div>
  `;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const disposers: (() => void)[] = [];
  const on = (target: EventTarget, event: string, listener: EventListener, options?: AddEventListenerOptions) => {
    target.addEventListener(event, listener, options); disposers.push(() => target.removeEventListener(event, listener, options));
  };
  const click = (id: string, fn: () => void) => on(el(id), 'click', fn);
  const mini = el<HTMLCanvasElement>('minimap'), full = el<HTMLCanvasElement>('fullmap');
  const miniContext = mini.getContext('2d')!, fullContext = full.getContext('2d')!;
  const minimapLabels=createMinimapLabeler(city.roads);
  let started = false, ready = false, mapOpen = false, settingsOpen = false, creditsOpen = false;
  let camera: CameraMode = 'chase', lighting: LightingMode = 'golden', sound = true;
  let travelMode: TravelMode = 'drive', altitude = 0;
  let state: VehicleState = { ...city.spawn, y: 1, speed: 0, steering: 0 };
  let lastMapDraw = 0, lastLocation = 0, toastTimer = 0;
  let mapCenter: Point2 = [(city.bounds.minX + city.bounds.maxX) / 2, (city.bounds.minZ + city.bounds.maxZ) / 2];
  let mapZoom = 1;
  let previousFocus: HTMLElement | null = null;
  const held = new Set<string>();
  const neighborhoods=indexAreas(city.neighborhoods??[]);
  const mapRoads=city.roads.map(road=>({road,minX:Math.min(...road.points.map(p=>p[0])),maxX:Math.max(...road.points.map(p=>p[0])),minZ:Math.min(...road.points.map(p=>p[1])),maxZ:Math.max(...road.points.map(p=>p[1]))}));
  const mapExtent=Math.max(city.bounds.maxX-city.bounds.minX,city.bounds.maxZ-city.bounds.minZ);
  const neighborhoodAt=(x:number,z:number)=>areaAt(neighborhoods,x,z)?.name??'Boston';
  let latestStats:InterfaceStats={};
  const diagnostics=createDiagnostics(host,()=>{
    const road=(travelMode==='drive'?sampleDriveSurface(city,state.x,state.z,state.y).road:undefined)??closestRoad(city,state.x,state.z).road;
    return{state:{...state},groundHeight:latestStats.groundHeight??0,road:{name:road.name,id:road.id},neighborhood:neighborhoodAt(state.x,state.z),camera,lighting,quality:latestStats.quality??'high',travelMode,
      performance:latestStats.performance??{fps:latestStats.fps??0,frameMs:0,drawCalls:0,triangles:0,geometries:0,textures:0,traffic:0,transit:0,pedestrians:0}};
  });
  const statsHelp='<span>Performance / debug stats</span><span><kbd>P</kbd> <kbd>&#96;</kbd></span>';
  el('controls-help').insertAdjacentHTML('beforeend',statsHelp);

  function isPaused() { return !started || mapOpen || settingsOpen || creditsOpen; }
  function updatePause() {
    const paused = isPaused();
    held.clear(); host.querySelectorAll('.touch-btn').forEach(b => b.classList.remove('held'));
    el('touch-controls').classList.toggle('suspended', paused);
    el('flight-touch').classList.toggle('suspended', paused);
    callbacks.onPause(paused);
    diagnostics.suspend(paused);
  }
  function focusModal(id: string, first: string) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el(id).classList.remove('hidden'); el(first).focus();
  }
  function restoreFocus() { previousFocus?.focus(); previousFocus = null; }
  function setMap(open: boolean) {
    if (!started) return;
    mapOpen = open;
    if (open) {
      settingsOpen = false; creditsOpen = false;
      el('settings-modal').classList.add('hidden'); el('credits-modal').classList.add('hidden');
      mapCenter = [(city.bounds.minX + city.bounds.maxX) / 2, (city.bounds.minZ + city.bounds.maxZ) / 2];
      mapZoom = 1;
      focusModal('map-modal', 'close-map'); resize(); drawFullMap();
    } else { el('map-modal').classList.add('hidden'); restoreFocus(); }
    updatePause();
  }
  function setSettings(open: boolean) {
    if (!started) return;
    settingsOpen = open;
    if (open) { if (mapOpen) setMap(false); focusModal('settings-modal', 'resume-drive'); }
    else { el('settings-modal').classList.add('hidden'); restoreFocus(); }
    updatePause();
  }
  function setCamera(mode: CameraMode, notify = false) {
    camera = mode; const name = travelMode === 'helicopter' && mode === 'hood' ? 'Cockpit camera' : cameraNames[mode]; el('camera-label').textContent = name;
    host.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b => { const active = b.dataset.camera === mode; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    if (notify) { callbacks.onCamera(mode); toast(name); }
  }
  function setLighting(mode: LightingMode, notify = false) {
    lighting = mode;
    host.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(b => { const active = b.dataset.light === mode; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    if (notify) callbacks.onLighting(mode);
  }
  function cycleCamera() { const modes: CameraMode[] = ['chase', 'hood', 'aerial']; setCamera(modes[(modes.indexOf(camera) + 1) % modes.length], true); }
  function setSound(enabled: boolean, notify = false) {
    sound = enabled;
    host.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach(b => { const active = (b.dataset.sound === 'on') === enabled; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    if (notify) { callbacks.onSound?.(enabled); toast(enabled ? 'City sound on' : 'Sound muted'); }
  }
  function setQuality(mode: QualityMode, notify = false) {
    host.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach(button => { const active=button.dataset.quality===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active)); });
    if(notify)callbacks.onQuality?.(mode);
  }
  function setTravelMode(mode: TravelMode, notify = false) {
    const changed = travelMode !== mode;
    travelMode = mode;
    const flying = mode === 'helicopter';
    host.classList.toggle('flying', flying);
    held.clear(); host.querySelectorAll('.touch-btn').forEach(button => button.classList.remove('held'));
    host.querySelectorAll<HTMLButtonElement>('[data-travel]').forEach(button => { const active = button.dataset.travel === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    el('altitude-readout').classList.toggle('hidden', !flying);
    el('journey-label').textContent = flying ? 'ABOVE BOSTON' : 'AFTERNOON DRIVE';
    el('resume-drive').innerHTML = `${flying ? 'Keep flying' : 'Keep driving'} ${svg('arrow')}`;
    el('reset-drive').textContent = flying ? 'Reset helicopter' : 'Reset car';
    el('close-settings').setAttribute('aria-label', flying ? 'Resume flying' : 'Resume driving');
    el('close-map').innerHTML = `Back to ${flying ? 'flying' : 'driving'} <kbd>M</kbd>`;
    el('map-center').setAttribute('aria-label', flying ? 'Center map on helicopter' : 'Center map on car');
    host.querySelector('.toolbar')?.setAttribute('aria-label', flying ? 'Flight controls' : 'Drive controls');
    host.querySelector<HTMLButtonElement>('[data-camera="hood"]')!.textContent = flying ? 'Cockpit' : 'Hood';
    el('drive-hint').innerHTML = flying
      ? '<span><kbd>W</kbd><kbd>S</kbd> Forward / back</span><span><kbd>A</kbd><kbd>D</kbd> Strafe</span><span><kbd>Q</kbd><kbd>E</kbd> Turn</span><span><kbd>Space</kbd> Up</span><span><kbd>Shift</kbd> Down</span>'
      : '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Drive</span><span><kbd>Space</kbd> Handbrake</span><span><kbd>R</kbd> Reset</span>';
    el('controls-help').innerHTML = flying
      ? '<span>Forward / backward</span><span><kbd>W</kbd> <kbd>S</kbd></span><span>Move left / right</span><span><kbd>A</kbd> <kbd>D</kbd></span><span>Turn left / right</span><span><kbd>Q</kbd> <kbd>E</kbd></span><span>Rise / descend</span><span><kbd>Space</kbd> <kbd>Shift</kbd></span><span>Drive / helicopter</span><span><kbd>1</kbd> <kbd>2</kbd></span><span>Map / change camera</span><span><kbd>M</kbd> <kbd>C</kbd></span><span>Reset helicopter / mute</span><span><kbd>R</kbd> <kbd>N</kbd></span><span>Pause</span><kbd>Esc</kbd>'
      : '<span>Accelerate / brake & reverse</span><span><kbd>W</kbd> <kbd>S</kbd></span><span>Steer</span><span><kbd>A</kbd> <kbd>D</kbd></span><span>Handbrake</span><kbd>Space</kbd><span>Drive / helicopter</span><span><kbd>1</kbd> <kbd>2</kbd></span><span>Map / change camera</span><span><kbd>M</kbd> <kbd>C</kbd></span><span>Horn / mute sound</span><span><kbd>F</kbd> <kbd>N</kbd></span><span>Reset car / hide interface</span><span><kbd>R</kbd> <kbd>H</kbd></span><span>Pause</span><kbd>Esc</kbd>';
    el('controls-help').insertAdjacentHTML('beforeend',statsHelp);
    const labels = flying ? { left:'Move helicopter left', right:'Move helicopter right', reverse:'Fly backward', accelerate:'Fly forward' } : { left:'Steer left', right:'Steer right', reverse:'Brake and reverse', accelerate:'Accelerate' };
    for (const [touch, label] of Object.entries(labels)) host.querySelector(`[data-touch="${touch}"]`)?.setAttribute('aria-label', label);
    el('touch-controls').setAttribute('aria-label', flying ? 'Touch flight movement' : 'Touch driving controls');
    host.querySelectorAll<HTMLButtonElement>('[data-destination]').forEach(button => { const name = button.querySelector('strong')?.textContent; button.setAttribute('aria-label', `${flying ? 'Fly' : 'Start driving'} near ${name}`); });
    setCamera(camera);
    if (notify && changed) { callbacks.onTravelMode?.(mode); toast(flying ? (matchMedia('(pointer: coarse)').matches ? 'Helicopter · Upper arrows control altitude' : 'Helicopter · Space to rise, Shift to descend') : 'Back behind the wheel.'); }
  }
  function toast(message: string) {
    el('toast').textContent = message; el('toast').classList.add('visible'); window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el('toast').classList.remove('visible'), 2600);
  }
  function reset() { callbacks.onReset(); toast(travelMode === 'helicopter' ? 'Ready to lift off.' : 'Back on the road.'); }
  // Title screen progress. Boot reports a few coarse stages, so the shown value eases toward the
  // latest stage, then creeps toward the next while a long step runs. The scene fades in with it.
  let loadTarget=0,loadShown=0,loadSince=performance.now(),loadStep=0,loadFrame=0,loadFailed=false,tipIndex=Math.floor(Math.random()*LOAD_TIPS.length);
  function showTip(){el('welcome-tip').textContent=LOAD_TIPS[tipIndex];el('welcome-tip-count').textContent=`TIP ${String(tipIndex+1).padStart(2,'0')} / ${String(LOAD_TIPS.length).padStart(2,'0')}`;}
  const tipTimer=window.setInterval(()=>{tipIndex=(tipIndex+1)%LOAD_TIPS.length;showTip();},6000);showTip();
  function drawLoading(){
    const pct=Math.floor(loadShown*100),step=Math.max(0,LOAD_STEPS.findIndex(([limit])=>pct<limit));
    el('loading-progress').style.width=`${(loadShown*100).toFixed(1)}%`;el('loading-pct').textContent=`${pct}%`;el('loading-track').setAttribute('aria-valuenow',String(pct));
    el('welcome-veil').style.opacity=(.94-.54*loadShown).toFixed(3);
    if(!loadFailed&&step!==loadStep){loadStep=step;el('loading-copy').textContent=LOAD_STEPS[step][1];}
  }
  function animateLoading(now:number){
    if(ready||loadFailed)return;
    const ceiling=loadTarget+(.97-loadTarget)*.75*(1-Math.exp(-(now-loadSince)/7000));
    loadShown+=(Math.max(loadShown,ceiling)-loadShown)*.06;drawLoading();loadFrame=requestAnimationFrame(animateLoading);
  }
  loadFrame=requestAnimationFrame(animateLoading);
  function start() {
    if (!ready || started) return;
    window.clearInterval(tipTimer);
    started = true; host.classList.remove('not-started'); el('welcome').classList.add('leaving');
    window.setTimeout(() => el('welcome').classList.add('hidden'), 700);
    callbacks.onStart?.(); updatePause();
    el('start-drive').blur();
  }
  click('start-drive', start); click('open-map', () => setMap(true)); click('minimap-button', () => setMap(true)); click('close-map', () => setMap(false));
  click('cycle-camera', cycleCamera); click('open-settings', () => setSettings(true)); click('close-settings', () => setSettings(false)); click('resume-drive', () => setSettings(false));
  click('reset-drive', () => { reset(); setSettings(false); });
  click('open-credits', () => { creditsOpen = true; el('settings-modal').classList.add('hidden'); focusModal('credits-modal', 'close-credits'); updatePause(); });
  click('close-credits', () => { creditsOpen = false; el('credits-modal').classList.add('hidden'); el('settings-modal').classList.remove('hidden'); el('open-credits').focus(); updatePause(); });
  host.querySelectorAll<HTMLButtonElement>('[data-light]').forEach(b => on(b, 'click', () => setLighting(b.dataset.light as LightingMode, true)));
  host.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(b => on(b, 'click', () => setCamera(b.dataset.camera as CameraMode, true)));
  host.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach(b => on(b, 'click', () => setSound(b.dataset.sound === 'on', true)));
  host.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach(b => on(b, 'click', () => setQuality(b.dataset.quality as QualityMode, true)));
  host.querySelector('[data-hud="performance"]')!.addEventListener('click',diagnostics.togglePerformance);
  host.querySelector('[data-hud="debug"]')!.addEventListener('click',diagnostics.toggleDebug);
  host.querySelectorAll<HTMLButtonElement>('[data-travel]').forEach(b => on(b, 'click', () => { if (started && !isPaused()) { setTravelMode(b.dataset.travel as TravelMode, true); b.blur(); } }));
  for (const source of city.sources) {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = source.name;
    li.append(a, document.createTextNode(` — ${source.license}`)); el('source-list').append(li);
  }
  for (const landmark of city.landmarks) {
    const button = document.createElement('button'); button.className = 'map-destination'; button.dataset.destination = landmark.id;
    const name = document.createElement('strong'), action = document.createElement('span'); name.textContent = landmark.name; action.textContent = `${neighborhoodAt(...landmark.position)} · Start nearby ↗`; button.append(name, action);
    button.setAttribute('aria-label', `Explore ${landmark.name}`);
    on(button, 'click', () => { callbacks.onDestination(landmark.id); setMap(false); toast(`Exploring ${landmark.name}`); }); el('map-destinations').append(button);
  }
  function resizeCanvas(canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (rect.width > 0 && rect.height > 0) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  }
  let mapViewport={left:30,top:120,right:800,bottom:700};
  function resize() {
    resizeCanvas(mini);
    if(mapOpen){
      resizeCanvas(full);
      const rect=full.getBoundingClientRect(),places=el('map-places').getBoundingClientRect();
      mapViewport=rect.width<=700
        ?{left:18,top:124,right:rect.width-18,bottom:places.top-rect.top-24}
        :{left:78,top:122,right:places.left-rect.left-28,bottom:rect.height-54};
    }
    drawMiniMap();if(mapOpen)drawFullMap();
  }
  function drawMap(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, center: Point2, scale: number, large: boolean) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#edece1'; ctx.fillRect(0, 0, w, h);
    const viewport=large?mapViewport:{left:0,top:0,right:w,bottom:h};
    const centerX=(viewport.left+viewport.right)/2,centerY=(viewport.top+viewport.bottom)/2;
    const project = ([x,z]: Point2): Point2 => [(x - center[0]) * scale + centerX, (z - center[1]) * scale + centerY];
    const inside = (p: Point2, margin = 30) => p[0] > -margin && p[0] < w + margin && p[1] > -margin && p[1] < h + margin;
    // A quiet geographic frame; real road and footprint coordinates carry the map.
    const b1 = project([city.bounds.minX, city.bounds.minZ]), b2 = project([city.bounds.maxX, city.bounds.maxZ]);
    ctx.fillStyle = '#e3e6d7';
    if(city.coverage?.length){for(const polygon of city.coverage){ctx.beginPath();polygon.forEach((point,i)=>{const p=project(point);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.closePath();ctx.fill();}}
    else ctx.fillRect(b1[0], b1[1], b2[0] - b1[0], b2[1] - b1[1]);
    const traceRings=(rings:Point2[][])=>{ctx.beginPath();for(const ring of rings){ring.forEach((point,i)=>{const p=project(point);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.closePath();}};
    for(const park of city.parks??[]){traceRings(park.rings);ctx.fillStyle='#c6d4b3';ctx.fill('evenodd');}
    for(const water of city.water??[]){traceRings(water.rings);ctx.fillStyle='#a7c8ca';ctx.fill('evenodd');}
    for(const path of city.parkPaths??[]){
      if(path.points.length<2)continue;
      ctx.beginPath();path.points.forEach((point,i)=>{const p=project(point);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});
      ctx.strokeStyle='#f4efdb';ctx.lineWidth=Math.max(.6,path.width*scale);ctx.stroke();
    }
    if(large&&scale<.8){
      ctx.strokeStyle='#72857366';ctx.lineWidth=.8;ctx.setLineDash([3,5]);
      for(const area of neighborhoods){traceRings(area.rings);ctx.stroke();}ctx.setLineDash([]);
    }
    const visibleRoads=mapRoads.filter(item=>item.maxX>center[0]-centerX/scale-30&&item.minX<center[0]+(w-centerX)/scale+30&&item.maxZ>center[1]-centerY/scale-30&&item.minZ<center[1]+(h-centerY)/scale+30);
    for (const {road} of visibleRoads) {
      if (road.points.length < 2) continue;
      ctx.beginPath(); road.points.forEach((p,i) => { const q = project(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#c3ccc0'; ctx.lineWidth = Math.max(2, (road.width + 4) * scale); ctx.stroke();
      ctx.strokeStyle = '#faf8f0'; ctx.lineWidth = Math.max(1.4, road.width * scale); ctx.stroke();
    }
    for (const building of city.buildings) {
      if (!building.footprint.length || !inside(project(building.center), large ? 180 : 90)) continue;
      ctx.beginPath(); building.footprint.forEach((p,i) => { const q = project(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0],q[1]); }); ctx.closePath();
      ctx.fillStyle = building.landmark ? '#b9a28b' : '#bbc3b7'; ctx.fill();
      if (large && scale > .8) { ctx.strokeStyle = '#8a9b8e55'; ctx.lineWidth = .55; ctx.stroke(); }
    }
    const labels:{left:number;right:number;top:number;bottom:number}[]=[];
    const canLabel=(left:number,right:number,top:number,bottom:number)=>left>viewport.left&&right<viewport.right&&top>viewport.top&&bottom<viewport.bottom&&!labels.some(label=>left<label.right+6&&right>label.left-6&&top<label.bottom+4&&bottom>label.top-4);
    if(large&&scale<.45){
      ctx.textAlign='center';ctx.font='600 11px "Avenir Next",sans-serif';
      for(const area of neighborhoods){
        const p=project(area.label),name=area.name.toUpperCase(),width=ctx.measureText(name).width;
        if(!canLabel(p[0]-width/2,p[0]+width/2,p[1]-10,p[1]+3))continue;
        ctx.lineWidth=4;ctx.strokeStyle='#edece1df';ctx.strokeText(name,...p);ctx.fillStyle='#5f7465';ctx.fillText(name,...p);
        labels.push({left:p[0]-width/2,right:p[0]+width/2,top:p[1]-10,bottom:p[1]+3});
      }
    }
    if (large && scale>.22) {
      const names = new Set<string>();
      for (const {road} of visibleRoads) {
        if (!road.name || names.has(road.name) || road.points.length < 2) continue;
        const first = project(road.points[0]), last = project(road.points[road.points.length - 1]);
        if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 75) continue;
        const p: Point2 = [(first[0]+last[0])/2, (first[1]+last[1])/2]; if (!inside(p, -50)) continue;
        let angle = Math.atan2(last[1]-first[1],last[0]-first[0]); if (angle > Math.PI/2) angle -= Math.PI; if (angle < -Math.PI/2) angle += Math.PI;
        ctx.save(); ctx.translate(...p); ctx.rotate(angle); ctx.fillStyle = '#5d7468'; ctx.textAlign = 'center'; ctx.font = '500 9px "DM Sans", sans-serif'; ctx.fillText(road.name,0,3); ctx.restore(); names.add(road.name);
      }
    }
    if(!large){
      const fontSize=w<170?10:11;
      ctx.font=`600 ${fontSize}px "Avenir Next",sans-serif`;
      const roadLabels=minimapLabels({center,scale,width:w,height:h,fontSize,
        measureText:text=>ctx.measureText(text).width,
        reserved:city.landmarks.map(landmark=>{const [x,y]=project(landmark.position);return{x,y,radius:7};}),
      });
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
      for(const label of roadLabels){
        ctx.save();ctx.translate(label.x,label.y);ctx.rotate(label.angle);
        ctx.lineWidth=3;ctx.strokeStyle='#faf8f0';ctx.strokeText(label.text,0,0);
        ctx.fillStyle='#344c45';ctx.fillText(label.text,0,0);ctx.restore();
      }
      ctx.textBaseline='alphabetic';
      const description=`Your position in Boston${roadLabels.length?`. Nearby roads: ${roadLabels.map(label=>label.name).join(', ')}`:''}`;
      if(canvas.getAttribute('aria-label')!==description)canvas.setAttribute('aria-label',description);
    }
    for (const landmark of city.landmarks) {
      const p = project(landmark.position); if (!inside(p)) continue;
      ctx.fillStyle = '#b06f49'; ctx.strokeStyle = '#fffaf0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0],p[1],large?4.5:3,0,Math.PI*2); ctx.fill();ctx.stroke();
      if (large) {
        ctx.font='600 10px "Avenir Next",sans-serif';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#f3f0e5';
        const width=ctx.measureText(landmark.name).width;
        for(const dy of [-12,22,-29,39]){const y=p[1]+dy;if(!canLabel(p[0]-width/2,p[0]+width/2,y-9,y+2))continue;
          ctx.strokeText(landmark.name,p[0],y);ctx.fillStyle='#3b5148';ctx.fillText(landmark.name,p[0],y);labels.push({left:p[0]-width/2,right:p[0]+width/2,top:y-9,bottom:y+2});break;
        }
      }
    }
    const player = project([state.x,state.z]);
    ctx.fillStyle='#233b3b13';ctx.beginPath();ctx.arc(player[0],player[1],large?20:17,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(...player);ctx.rotate(Math.PI-state.yaw);ctx.fillStyle='#234b4a';ctx.strokeStyle='#fff9ee';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-10);ctx.lineTo(6.5,7);ctx.lineTo(0,4);ctx.lineTo(-6.5,7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    if (large) {
      ctx.textAlign='left';ctx.fillStyle='#6b8073';ctx.font='600 10px "DM Sans",sans-serif';ctx.fillText('N',32,128);ctx.strokeStyle='#6b8073';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(36,136);ctx.lineTo(36,158);ctx.moveTo(32,141);ctx.lineTo(36,136);ctx.lineTo(40,141);ctx.stroke();
      const meters=[25,50,100,200,500,1000,2000,5000].find(value=>value*scale>=70)??2000;
      const length=meters*scale,rx=viewport.right,y=viewport.bottom+10;ctx.beginPath();ctx.moveTo(rx-length,y);ctx.lineTo(rx,y);ctx.moveTo(rx-length,y-4);ctx.lineTo(rx-length,y+4);ctx.moveTo(rx,y-4);ctx.lineTo(rx,y+4);ctx.stroke();ctx.textAlign='right';ctx.fillText(meters>=1000?`${meters/1000} km`:`${meters} m`,rx,y-9);
    }
  }
  function fullScale() {
    return Math.min((mapViewport.right-mapViewport.left) / (city.bounds.maxX-city.bounds.minX), (mapViewport.bottom-mapViewport.top) / (city.bounds.maxZ-city.bounds.minZ)) * mapZoom;
  }
  function drawMiniMap() { drawMap(miniContext,mini,[state.x,state.z],mini.clientWidth / (travelMode === 'helicopter' ? 460 + Math.max(0, altitude - 30) * 2 : 460),false); }
  function drawFullMap() { if (mapOpen) drawMap(fullContext,full,mapCenter,fullScale(),true); }
  function zoom(factor: number) { mapZoom = Math.max(.65, Math.min(Math.max(24,mapExtent/150), mapZoom * factor)); drawFullMap(); }
  click('map-zoom-in', () => zoom(1.3)); click('map-zoom-out', () => zoom(1/1.3)); click('map-center', () => { mapCenter=[state.x,state.z];mapZoom=Math.max(1.8,Math.min(20,mapExtent/850));drawFullMap(); });
  click('map-overview',()=>{mapCenter=[(city.bounds.minX+city.bounds.maxX)/2,(city.bounds.minZ+city.bounds.maxZ)/2];mapZoom=1;drawFullMap();});
  on(full, 'wheel', event => { const e = event as WheelEvent; e.preventDefault(); zoom(e.deltaY < 0 ? 1.12 : 1/1.12); }, { passive:false });
  let drag: { id: number; x: number; y: number; center: Point2 } | null = null;
  on(full,'pointerdown',event=>{const e=event as PointerEvent;drag={id:e.pointerId,x:e.clientX,y:e.clientY,center:[...mapCenter]};full.setPointerCapture(e.pointerId);});
  on(full,'pointermove',event=>{const e=event as PointerEvent;if(!drag||drag.id!==e.pointerId)return;const scale=fullScale();mapCenter=[drag.center[0]-(e.clientX-drag.x)/scale,drag.center[1]-(e.clientY-drag.y)/scale];drawFullMap();});
  on(full,'pointerup',()=>{drag=null;});on(full,'pointercancel',()=>{drag=null;});
  host.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(button=>{
    on(button,'pointerdown',event=>{if(isPaused())return;const e=event as PointerEvent;e.preventDefault();button.setPointerCapture(e.pointerId);held.add(button.dataset.touch!);button.classList.add('held');});
    const release=()=>{held.delete(button.dataset.touch!);button.classList.remove('held');};on(button,'pointerup',release);on(button,'pointercancel',release);on(button,'lostpointercapture',release);
  });
  on(window,'blur',()=>{held.clear();if(started&&!isPaused())setSettings(true);});
  on(window,'resize',resize);
  on(window,'keydown',event=>{
    const e=event as KeyboardEvent;
    if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||(e.target instanceof HTMLElement&&e.target.isContentEditable))return;
    if(e.code==='Tab'&&isPaused()){
      const active=mapOpen?el('map-modal'):creditsOpen?el('credits-modal'):settingsOpen?el('settings-modal'):el('welcome');
      const focusable=Array.from(active.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));const first=focusable[0],last=focusable[focusable.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;
    }
    if(!started)return;
    if(e.code==='KeyM'){e.preventDefault();setMap(!mapOpen);}
    else if(e.code==='Escape'){e.preventDefault();if(creditsOpen){el('close-credits').click();}else if(mapOpen)setMap(false);else setSettings(!settingsOpen);}
    else if(e.code==='KeyC'&&!isPaused()){e.preventDefault();cycleCamera();}
    else if(e.code==='KeyR'&&!isPaused()){e.preventDefault();reset();}
    else if(e.code==='KeyH'&&!isPaused()){e.preventDefault();host.classList.toggle('hud-off');}
    else if(e.code==='KeyP'&&!isPaused()){e.preventDefault();diagnostics.togglePerformance();}
    else if(e.code==='Backquote'&&!isPaused()){e.preventDefault();diagnostics.toggleDebug();}
    else if(e.code==='KeyN'){e.preventDefault();setSound(!sound,true);}
    else if((e.code==='Digit1'||e.code==='Digit2')&&!isPaused()){e.preventDefault();setTravelMode(e.code==='Digit1'?'drive':'helicopter',true);}
  });

  function update(next: VehicleState, stats?: InterfaceStats) {
    if(stats?.travelMode && stats.travelMode!==travelMode)setTravelMode(stats.travelMode);
    state=next;latestStats=stats??{};const speed=Math.abs(state.speed)*2.236936;
    const speedScale=travelMode==='helicopter'?HELICOPTER.cruiseSpeed*2.236936:65;
    el('speed-value').textContent=String(Math.round(speed));el('speed-fill').style.width=`${Math.min(100,speed/speedScale*100)}%`;el('gear').textContent=travelMode==='helicopter'?'H':state.speed<-.3?'R':`D${stats?.gear&&stats.gear>0?stats.gear:''}`;
    el('gear').title=travelMode==='drive'&&stats?.rpm?`Automatic transmission · ${Math.round(stats.rpm)} rpm`:'';
    if(travelMode==='helicopter'){
      altitude=Math.max(0,stats?.altitude??state.y);el('altitude-value').textContent=String(Math.round(altitude*3.28084));
      const climb=stats?.verticalSpeed??0;el('vertical-speed').textContent=Math.abs(climb)<.25?'LEVEL':`${climb>0?'↑':'↓'} ${Math.round(Math.abs(climb)*3.28084)} FT/S`;
    }
    const now=performance.now();
    diagnostics.update(now);
    if(now-lastMapDraw>90){drawMiniMap();if(mapOpen)drawFullMap();lastMapDraw=now;}
    if(now-lastLocation>500){
      const neighborhood=neighborhoodAt(state.x,state.z);
      let nearest=Infinity,label=neighborhood;
      for(const road of city.roads){if(!road.name)continue;for(let i=1;i<road.points.length;i++){const d=distanceToSegment([state.x,state.z],road.points[i-1],road.points[i]);if(d<nearest){nearest=d;label=road.name;}}}
      if(nearest>110)label=neighborhood;
      el('neighborhood-label').textContent=`${neighborhood}, Massachusetts`;
      if(travelMode==='helicopter')el('journey-label').textContent=`Above ${neighborhood}`;
      el('location-label').textContent=travelMode==='helicopter'?`Above ${label}`:label;lastLocation=now;
    }
  }
  resize();updatePause();
  return {
    update,isPaused,isMapOpen:()=>mapOpen,
    getTouchInput:():DriveInput=>({throttle:isPaused()?0:Number(held.has('accelerate'))-Number(held.has('reverse')),brake:0,steer:isPaused()?0:Number(held.has('left'))-Number(held.has('right')),handbrake:!isPaused()&&held.has('handbrake')}),
    getFlightTouchInput:()=>({forward:isPaused()?0:Number(held.has('accelerate'))-Number(held.has('reverse')),strafe:isPaused()?0:Number(held.has('right'))-Number(held.has('left')),yaw:isPaused()?0:Number(held.has('yaw-right'))-Number(held.has('yaw-left')),lift:isPaused()?0:Number(held.has('ascend'))-Number(held.has('descend'))}),
    setLoading(message:string,progress?:number){el('loading-track').setAttribute('aria-valuetext',message);if(progress!==undefined){loadTarget=Math.max(loadTarget,Math.min(1,progress));loadSince=performance.now();}},
    setReady(){ready=true;cancelAnimationFrame(loadFrame);loadShown=1;drawLoading();el('welcome').classList.add('ready');el<HTMLButtonElement>('start-drive').disabled=false;el('start-drive').focus();},
    setError(message:string){loadFailed=true;cancelAnimationFrame(loadFrame);el('loading-copy').textContent=message;el('loading-copy').style.color='#ffd1ad';el('welcome').classList.remove('hidden','leaving','ready');host.classList.add('not-started');el<HTMLButtonElement>('start-drive').disabled=true;ready=false;started=false;updatePause();},
    setCamera:(mode:CameraMode)=>setCamera(mode),setLighting:(mode:LightingMode)=>setLighting(mode),setSound:(enabled:boolean)=>setSound(enabled),setQuality:(mode:QualityMode)=>setQuality(mode),setTravelMode:(mode:TravelMode)=>setTravelMode(mode),toast,
    destroy(){diagnostics.destroy();disposers.forEach(fn=>fn());window.clearTimeout(toastTimer);host.innerHTML='';},
  };
}
