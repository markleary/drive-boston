import type {DriveInput, TravelMode} from '../types';

export type TouchDrivingMode = 'analog' | 'joystick';
export type TouchDrivingAction = 'gas' | 'brake' | 'handbrake' | 'wheelie';
type Stick = {x:number;y:number};

const DEAD_ZONE = .12;
const GEAR_CHANGE_SPEED = .35;
const emptyInput = ():DriveInput => ({throttle:0,brake:0,steer:0,handbrake:false,wheelie:false});

/** A horizontal pad never couples steering to vertical thumb drift. */
export function normalizeTouchStick(x:number,y:number,mode:TouchDrivingMode):Stick {
  x=Number.isFinite(x)?x:0;y=mode==='joystick'&&Number.isFinite(y)?y:0;
  const distance=Math.hypot(x,y);
  if(distance<=DEAD_ZONE)return{x:0,y:0};
  const strength=(Math.min(1,distance)-DEAD_ZONE)/(1-DEAD_ZONE);
  return{x:x/distance*strength,y:y/distance*strength};
}

/** Input state is independent of DOM capture, so every cancellation clears it identically. */
export function createTouchDrivingState() {
  let mode:TouchDrivingMode='analog',travelMode:TravelMode='drive',suspended=true;
  let gear:1|-1=1,speed=0,stick:Stick={x:0,y:0};
  const held=new Map<number,TouchDrivingAction>();
  const active=()=>!suspended&&travelMode!=='helicopter';
  const isHeld=(action:TouchDrivingAction)=>[...held.values()].includes(action);
  const reset=()=>{held.clear();stick={x:0,y:0};};
  return {
    reset,isHeld,
    getMode:()=>mode,
    getGear:()=>gear,
    getStick:()=>({...stick}),
    canChangeGear:()=>Math.abs(speed)<=GEAR_CHANGE_SPEED,
    setSpeed(value:number){speed=Number.isFinite(value)?value:0;},
    setSuspended(value:boolean){suspended=value;if(value)reset();},
    setMode(value:TouchDrivingMode){if(mode!==value){mode=value;gear=1;reset();}},
    setTravelMode(value:TravelMode){if(travelMode!==value){travelMode=value;gear=1;reset();}},
    setGear(value:1|-1){if(!active()||Math.abs(speed)>GEAR_CHANGE_SPEED)return false;gear=value;reset();return true;},
    press(pointer:number,action:TouchDrivingAction){
      if(!active()||held.has(pointer)||(action==='wheelie'&&travelMode!=='bike')||((action==='gas'||action==='brake')&&mode!=='analog'))return false;
      held.set(pointer,action);return true;
    },
    release(pointer:number){held.delete(pointer);},
    moveStick(x:number,y:number){
      if(!active())return;
      x=Number.isFinite(x)?x:0;y=mode==='joystick'&&Number.isFinite(y)?y:0;
      const distance=Math.hypot(x,y),scale=distance>1?1/distance:1;
      stick={x:x*scale,y:y*scale};
    },
    getInput():DriveInput {
      if(!active())return emptyInput();
      const value=normalizeTouchStick(stick.x,stick.y,mode),brake=mode==='analog'&&isHeld('brake')?1:0;
      return {
        throttle:brake?0:mode==='joystick'?(-value.y||0):isHeld('gas')?gear:0,
        brake,steer:-value.x||0,handbrake:isHeld('handbrake'),wheelie:travelMode==='bike'&&isHeld('wheelie'),
      };
    },
  };
}

export const TOUCH_DRIVING_MARKUP = `
  <div class="touch-controls suspended" id="touch-controls" data-control-mode="analog" aria-label="Touch driving controls">
    <div class="touch-steering-group">
      <span class="touch-control-caption" id="touch-steering-caption">STEER</span>
      <div class="touch-steering analog" id="touch-steering" data-testid="touch-steering" role="slider" tabindex="0" aria-label="Steer" aria-orientation="horizontal" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Centered">
        <span class="touch-steering-left" aria-hidden="true">‹</span><span class="touch-steering-right" aria-hidden="true">›</span>
        <span class="touch-stick-forward" aria-hidden="true" hidden>GAS</span><span class="touch-stick-backward" aria-hidden="true" hidden>BRAKE / R</span>
        <span class="touch-stick-knob" aria-hidden="true"></span>
      </div>
    </div>
    <div class="touch-pedals">
      <button type="button" class="touch-btn touch-pedal touch-brake" data-drive-action="brake" data-testid="touch-brake" aria-label="Brake" aria-pressed="false"><span class="touch-pedal-grip" aria-hidden="true"></span>BRAKE</button>
      <button type="button" class="touch-btn touch-pedal touch-gas" data-drive-action="gas" data-testid="touch-accelerate" aria-label="Accelerate" aria-pressed="false"><span class="touch-pedal-grip" aria-hidden="true"></span>GAS</button>
    </div>
    <div class="touch-gears" role="group" aria-label="Direction: stop before changing">
      <button type="button" class="touch-btn" data-direction="drive" aria-label="Drive gear" aria-pressed="true">D</button>
      <button type="button" class="touch-btn" data-direction="reverse" aria-label="Reverse gear" aria-pressed="false">R</button>
    </div>
    <div class="touch-actions">
      <button type="button" class="touch-btn touch-handbrake" data-drive-action="handbrake" aria-label="Handbrake" aria-pressed="false">HANDBRAKE</button>
      <button type="button" class="touch-btn wheelie-touch" data-drive-action="wheelie" aria-label="Wheelie" aria-pressed="false" hidden>WHEELIE</button>
    </div>
  </div>`;

export function createTouchDrivingControls(host:HTMLElement,options:{isPaused:()=>boolean;onUsed?:()=>void}) {
  const root=host.querySelector<HTMLElement>('#touch-controls')!;
  const pad=root.querySelector<HTMLElement>('#touch-steering')!,knob=pad.querySelector<HTMLElement>('.touch-stick-knob')!;
  const buttons=[...root.querySelectorAll<HTMLButtonElement>('[data-drive-action]')];
  const gears=[...root.querySelectorAll<HTMLButtonElement>('[data-direction]')];
  const state=createTouchDrivingState(),disposers:(()=>void)[]=[];
  const captures=new Map<number,HTMLElement>(),stickKeys=new Set<string>();
  let stickPointer:number|null=null,travelMode:TravelMode='drive',suspended=true;
  const on=(element:EventTarget,type:string,handler:EventListener)=>{element.addEventListener(type,handler);disposers.push(()=>element.removeEventListener(type,handler));};
  const canInteract=()=>!suspended&&!options.isPaused()&&travelMode!=='helicopter'&&!document.hidden;
  const radii=()=>({x:Math.max(1,(pad.clientWidth-knob.offsetWidth)/2-10),y:Math.max(1,(pad.clientHeight-knob.offsetHeight)/2-10)});
  const refreshGears=()=>{for(const button of gears){button.disabled=!state.canChangeGear();button.setAttribute('aria-pressed',String((button.dataset.direction==='drive'?1:-1)===state.getGear()));}};
  const refresh=()=>{
    const stick=state.getStick(),radius=radii();
    const reach=state.getMode()==='joystick'?Math.min(radius.x,radius.y):radius.x;
    knob.style.setProperty('--touch-x',`${stick.x*reach}px`);knob.style.setProperty('--touch-y',`${stick.y*reach}px`);
    if(state.getMode()==='analog'){
      const steer=Math.round(-state.getInput().steer*100);
      pad.setAttribute('aria-valuenow',String(steer));pad.setAttribute('aria-valuetext',steer===0?'Centered':`${Math.abs(steer)} percent ${steer<0?'left':'right'}`);
    }
    pad.classList.toggle('held',stickPointer!==null||stickKeys.size>0);
    for(const button of buttons){const held=state.isHeld(button.dataset.driveAction as TouchDrivingAction);button.classList.toggle('held',held);button.setAttribute('aria-pressed',String(held));}
    refreshGears();
  };
  const releaseCapture=(id:number,element:HTMLElement)=>{if(element.hasPointerCapture(id))element.releasePointerCapture(id);};
  function reset(){
    stickPointer=null;stickKeys.clear();state.reset();
    const releasing=[...captures];captures.clear();
    for(const [id,element] of releasing)releaseCapture(id,element);
    refresh();
  }
  const release=(id:number)=>{
    const element=captures.get(id);captures.delete(id);state.release(id);
    if(stickPointer===id){stickPointer=null;state.moveStick(0,0);}
    if(element)releaseCapture(id,element);refresh();
  };
  for(const [index,button] of buttons.entries()){
    const action=button.dataset.driveAction as TouchDrivingAction;
    on(button,'pointerdown',event=>{
      const e=event as PointerEvent;if(!canInteract()||e.button!==0||captures.has(e.pointerId))return;
      e.preventDefault();e.stopPropagation();
      if(!state.press(e.pointerId,action))return;
      captures.set(e.pointerId,button);button.setPointerCapture(e.pointerId);options.onUsed?.();refresh();
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])on(button,type,event=>release((event as PointerEvent).pointerId));
    const keyboardPointer=-index-1;
    on(button,'keydown',event=>{const e=event as KeyboardEvent;if(![' ','Enter'].includes(e.key)||!canInteract())return;e.preventDefault();e.stopPropagation();if(state.press(keyboardPointer,action))options.onUsed?.();refresh();});
    on(button,'keyup',event=>{const e=event as KeyboardEvent;if(![' ','Enter'].includes(e.key))return;e.preventDefault();e.stopPropagation();state.release(keyboardPointer);refresh();});
    on(button,'blur',()=>{state.release(keyboardPointer);refresh();});
  }
  const moveStick=(e:PointerEvent)=>{
    if(e.pointerId!==stickPointer||!canInteract())return;
    e.preventDefault();e.stopPropagation();
    const box=pad.getBoundingClientRect(),radius=radii();
    const reach=state.getMode()==='joystick'?Math.min(radius.x,radius.y):radius.x;
    state.moveStick((e.clientX-box.left-box.width/2)/reach,(e.clientY-box.top-box.height/2)/reach);refresh();
  };
  on(pad,'pointerdown',event=>{
    const e=event as PointerEvent;if(!canInteract()||e.button!==0||stickPointer!==null||captures.has(e.pointerId))return;
    e.preventDefault();e.stopPropagation();stickKeys.clear();stickPointer=e.pointerId;captures.set(e.pointerId,pad);pad.setPointerCapture(e.pointerId);options.onUsed?.();moveStick(e);
  });
  on(pad,'pointermove',event=>moveStick(event as PointerEvent));
  for(const type of ['pointerup','pointercancel','lostpointercapture'])on(pad,type,event=>release((event as PointerEvent).pointerId));
  const updateKeyboardStick=()=>{state.moveStick(Number(stickKeys.has('ArrowRight'))-Number(stickKeys.has('ArrowLeft')),Number(stickKeys.has('ArrowDown'))-Number(stickKeys.has('ArrowUp')));refresh();};
  on(pad,'keydown',event=>{
    const e=event as KeyboardEvent;if(!canInteract()||stickPointer!==null||!['ArrowLeft','ArrowRight',...(state.getMode()==='joystick'?['ArrowUp','ArrowDown']:[])].includes(e.key))return;
    e.preventDefault();e.stopPropagation();stickKeys.add(e.key);options.onUsed?.();updateKeyboardStick();
  });
  on(pad,'keyup',event=>{const e=event as KeyboardEvent;if(!stickKeys.has(e.key))return;e.preventDefault();e.stopPropagation();stickKeys.delete(e.key);updateKeyboardStick();});
  on(pad,'blur',()=>{stickKeys.clear();if(stickPointer===null){state.moveStick(0,0);refresh();}});
  for(const button of gears)on(button,'click',()=>{if(!canInteract())return;if(state.setGear(button.dataset.direction==='drive'?1:-1)){reset();options.onUsed?.();}});
  on(window,'blur',reset);on(window,'resize',reset);on(document,'visibilitychange',()=>{if(document.hidden)reset();});
  function setMode(mode:TouchDrivingMode){
    reset();state.setMode(mode);root.dataset.controlMode=mode;
    pad.classList.toggle('analog',mode==='analog');pad.classList.toggle('joystick',mode==='joystick');
    pad.setAttribute('role',mode==='analog'?'slider':'group');pad.setAttribute('aria-label',mode==='analog'?'Steer':'Move and steer');
    pad.setAttribute('aria-description',mode==='analog'?'Drag left or right to steer. Release to center.':'Drag up to accelerate, down to brake then reverse, and left or right to steer. Release to stop applying input.');
    if(mode==='analog'){pad.setAttribute('aria-orientation','horizontal');pad.setAttribute('aria-valuemin','-100');pad.setAttribute('aria-valuemax','100');}
    else for(const attribute of ['aria-orientation','aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'])pad.removeAttribute(attribute);
    root.querySelector<HTMLElement>('#touch-steering-caption')!.textContent=mode==='analog'?'STEER':'MOVE & STEER';
    root.querySelectorAll<HTMLElement>('.touch-pedals,.touch-gears').forEach(element=>element.hidden=mode==='joystick');
    root.querySelectorAll<HTMLElement>('.touch-stick-forward,.touch-stick-backward').forEach(element=>element.hidden=mode==='analog');refresh();
  }
  function setTravelMode(mode:TravelMode){
    if(travelMode!==mode)reset();travelMode=mode;state.setTravelMode(mode);root.hidden=mode==='helicopter';
    const handbrake=root.querySelector<HTMLButtonElement>('.touch-handbrake')!;
    handbrake.textContent=mode==='bike'?'BIKE BRAKE':'HANDBRAKE';handbrake.setAttribute('aria-label',mode==='bike'?'Brake bike':'Handbrake');
    root.querySelector<HTMLElement>('.wheelie-touch')!.hidden=mode!=='bike';refresh();
  }
  setMode('analog');setTravelMode('drive');
  return {
    getInput:():DriveInput=>canInteract()?state.getInput():emptyInput(),
    setMode,getMode:state.getMode,setTravelMode,
    setSpeed(speed:number){const previous=state.canChangeGear();state.setSpeed(speed);if(previous!==state.canChangeGear())refreshGears();},
    setSuspended(value:boolean){suspended=value;state.setSuspended(value);if(value)reset();root.classList.toggle('suspended',value);},
    reset,
    dispose(){reset();disposers.forEach(dispose=>dispose());},
  };
}
