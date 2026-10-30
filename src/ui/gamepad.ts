import type {DriveInput} from '../types';
import type {FlightInput} from '../simulation/helicopter';

/** Button indices of the W3C "standard" gamepad layout, named for an Xbox controller. */
export const PAD_BUTTONS={A:0,B:1,X:2,Y:3,LB:4,RB:5,LT:6,RT:7,View:8,Menu:9,LS:10,RS:11,Up:12,Down:13,Left:14,Right:15} as const;
export type PadButton=keyof typeof PAD_BUTTONS;
export type PadDirection='up'|'down'|'left'|'right';

/** The parts of a browser Gamepad read here, so tests can pass plain objects. */
export interface GamepadLike{readonly index:number;readonly id:string;readonly connected:boolean;readonly mapping:string;readonly axes:readonly number[];readonly buttons:readonly {readonly pressed:boolean;readonly value:number}[]}

export interface PadFrame{
  /** A controller is connected and selected for this frame. */
  connected:boolean;id:string;
  /** Seconds since the previous poll, capped at 0.1. */
  dt:number;
  /** Sticks after a radial dead zone (x right, y down) and triggers 0..1. */
  lx:number;ly:number;rx:number;ry:number;lt:number;rt:number;
  held:ReadonlySet<PadButton>;
  /** Buttons that went down since the previous poll. */
  pressed:ReadonlySet<PadButton>;
  /** Menu movement from the D-pad or left stick, repeating like a held arrow key. */
  nav:PadDirection|null;
  /** Deliberate input this poll (a press, a stick pushed well past drift, a squeezed trigger). */
  active:boolean;
}

const STICK_DEAD=.16,TRIGGER_DEAD=.06,ACTIVE_STICK=.5,NAV_STICK=.55,NAV_DELAY=380,NAV_REPEAT=110;
/** Above this speed (m/s) a trigger against the direction of travel brakes instead of selecting the other direction. */
const ROLLING=.6;
const NAMES=Object.keys(PAD_BUTTONS) as PadButton[];
const EMPTY:ReadonlySet<PadButton>=new Set();
const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?n:0;
const clamp=(n:number)=>Math.max(-1,Math.min(1,n));

/** Radial dead zone, rescaled so the response starts at zero just outside it. */
export function padStick(x:number,y:number,dead=STICK_DEAD):[number,number]{
  x=finite(x);y=finite(y);const d=Math.hypot(x,y);
  if(d<=dead)return[0,0];
  const k=Math.min(1,(d-dead)/(1-dead))/d;return[x*k,y*k];
}
export function padTrigger(value:number,dead=TRIGGER_DEAD){const v=finite(value);return v<=dead?0:Math.min(1,(v-dead)/(1-dead));}
// Analog triggers report "pressed" at a light touch, so treat them as held only past half travel.
// Some digital triggers report pressed with no value.
const triggerValue=(b:{pressed:boolean;value:number}|undefined)=>!b?0:b.pressed&&!finite(b.value)?1:finite(b.value);
function heldButtons(pad:GamepadLike){
  const held=new Set<PadButton>();
  for(const name of NAMES){
    const i=PAD_BUTTONS[name],b=pad.buttons[i];if(!b)continue;
    if(i===PAD_BUTTONS.LT||i===PAD_BUTTONS.RT?triggerValue(b)>.5:b.pressed||finite(b.value)>.5)held.add(name);
  }
  return held;
}
const idleFrame=(dt:number):PadFrame=>({connected:false,id:'',dt,lx:0,ly:0,rx:0,ry:0,lt:0,rt:0,held:EMPTY,pressed:EMPTY,nav:null,active:false});

/** Polls navigator.getGamepads() once per frame. The controller in use is the one
 * most recently touched, so an idle virtual or second device in slot 0 cannot shadow it. */
export function createGamepadReader(){
  const previous=new Map<number,Set<PadButton>>(),lastActive=new Map<number,number>();
  let selected=-1,lastPoll=Number.NaN,navDirection:PadDirection|null=null,navAt=0;
  function poll(now:number,pads:ArrayLike<GamepadLike|null|undefined>|null|undefined):PadFrame{
    const dt=Number.isFinite(lastPoll)?Math.min(.1,Math.max(0,(now-lastPoll)/1000)):0;lastPoll=now;
    const connected=Array.from(pads??[]).filter((pad):pad is GamepadLike=>!!pad&&pad.connected);
    for(const index of [...previous.keys()])if(!connected.some(pad=>pad.index===index)){previous.delete(index);lastActive.delete(index);}
    const edges=new Map<number,{held:Set<PadButton>;pressed:Set<PadButton>}>();
    for(const pad of connected){
      const held=heldButtons(pad),before=previous.get(pad.index)??EMPTY,pressed=new Set([...held].filter(name=>!before.has(name)));
      previous.set(pad.index,held);edges.set(pad.index,{held,pressed});
      const a=pad.axes;
      if(pressed.size||Math.hypot(finite(a[0]),finite(a[1]))>ACTIVE_STICK||Math.hypot(finite(a[2]),finite(a[3]))>ACTIVE_STICK)lastActive.set(pad.index,now);
    }
    let pad:GamepadLike|undefined;
    for(const candidate of connected){
      const t=lastActive.get(candidate.index)??-Infinity,best=pad?lastActive.get(pad.index)??-Infinity:-Infinity;
      if(!pad||t>best||(t===best&&(candidate.index===selected||(pad.index!==selected&&candidate.mapping==='standard'&&pad.mapping!=='standard'))))pad=candidate;
    }
    if(!pad){selected=-1;navDirection=null;return idleFrame(dt);}
    selected=pad.index;
    const {held,pressed}=edges.get(pad.index)!;
    const [lx,ly]=padStick(pad.axes[0],pad.axes[1]),[rx,ry]=padStick(pad.axes[2],pad.axes[3]);
    const lt=padTrigger(triggerValue(pad.buttons[PAD_BUTTONS.LT])),rt=padTrigger(triggerValue(pad.buttons[PAD_BUTTONS.RT]));
    let direction:PadDirection|null=held.has('Up')?'up':held.has('Down')?'down':held.has('Left')?'left':held.has('Right')?'right':null;
    if(!direction&&Math.max(Math.abs(lx),Math.abs(ly))>NAV_STICK)direction=Math.abs(lx)>Math.abs(ly)?(lx<0?'left':'right'):(ly<0?'up':'down');
    let nav:PadDirection|null=null;
    if(direction!==navDirection){navDirection=direction;navAt=now+NAV_DELAY;nav=direction;}
    else if(direction&&now>=navAt){nav=direction;navAt=now+NAV_REPEAT;}
    const active=pressed.size>0||Math.hypot(lx,ly)>ACTIVE_STICK||Math.hypot(rx,ry)>ACTIVE_STICK||lt>.3||rt>.3;
    return{connected:true,id:pad.id,dt,lx,ly,rx,ry,lt,rt,held,pressed,nav,active};
  }
  return{poll,idle:()=>idleFrame(0)};
}

/** Racing-game triggers: RT accelerates and LT brakes in proportion while rolling
 * forward, then reverses once nearly stopped. RT brakes a reversing vehicle. */
export function padDriveInput(frame:PadFrame,speed:number):DriveInput{
  if(!frame.connected)return{throttle:0,brake:0,steer:0,handbrake:false,wheelie:false};
  const {rt,lt}=frame;let throttle=0,brake=0;
  if(speed>ROLLING){throttle=rt;brake=lt;}
  else if(speed<-ROLLING){throttle=0-lt;brake=rt;}
  else throttle=rt-lt;
  // Positive steer turns left, so pushing the stick left (negative x) steers left.
  return{throttle,brake,steer:0-frame.lx,handbrake:frame.held.has('A'),wheelie:frame.held.has('X')};
}

/** Left stick flies, right stick (or the bumpers) turns, RT climbs and LT descends. */
export function padFlightInput(frame:PadFrame):FlightInput{
  if(!frame.connected)return{forward:0,strafe:0,turn:0,lift:0};
  const bumpers=Number(frame.held.has('RB'))-Number(frame.held.has('LB'));
  return{forward:0-frame.ly,strafe:frame.lx,turn:clamp(frame.rx+bumpers),lift:frame.rt-frame.lt};
}

export interface NavBox{left:number;top:number;right:number;bottom:number}
/** Index of the nearest box in a direction, or -1. A candidate must lie beyond the
 * current box's edge and inside a 2:1 cone, so a press never jumps to a far row;
 * up and down fall back to the nearest box past the edge when the cone is empty. */
export function spatialNeighbor(from:NavBox,boxes:readonly NavBox[],direction:PadDirection):number{
  const vertical=direction==='up'||direction==='down';
  let best=-1,bestScore=Infinity,fallback=-1,fallbackScore=Infinity;
  boxes.forEach((box,i)=>{
    const size=vertical?Math.min(from.bottom-from.top,box.bottom-box.top):Math.min(from.right-from.left,box.right-box.left);
    const gap=direction==='down'?box.top-from.bottom:direction==='up'?from.top-box.bottom:direction==='right'?box.left-from.right:from.left-box.right;
    if(gap<-size*.3)return;
    const primary=Math.max(0,gap);
    const cross=vertical?Math.max(0,box.left-from.right,from.left-box.right):Math.max(0,box.top-from.bottom,from.top-box.bottom);
    const offset=vertical?Math.abs(box.left+box.right-from.left-from.right)/2:Math.abs(box.top+box.bottom-from.top-from.bottom)/2;
    const score=primary+cross*2+offset*.25;
    if(cross<=primary*2+1){if(score<bestScore){best=i;bestScore=score;}}
    else if(vertical&&score<fallbackScore){fallback=i;fallbackScore=score;}
  });
  return best>=0?best:fallback;
}

export type PadGlyph=PadButton|'L3'|'R3'|'DpadLR'|'DpadUD'|'DpadDown'|'Dpad';
const LABELS:Record<PadGlyph,string>={A:'A button',B:'B button',X:'X button',Y:'Y button',LB:'Left bumper',RB:'Right bumper',LT:'Left trigger',RT:'Right trigger',View:'View button',Menu:'Menu button',LS:'Left stick',RS:'Right stick',L3:'Press left stick',R3:'Press right stick',Up:'D-pad up',Down:'D-pad down',Left:'D-pad left',Right:'D-pad right',DpadLR:'D-pad left or right',DpadUD:'D-pad up or down',DpadDown:'D-pad down',Dpad:'D-pad'};
// An outlined cross with the arms that matter filled in.
const CROSS='M9 2.5h6V9h6.5v6H15v6.5H9V15H2.5V9H9z';
const ARMS={up:'M9 2.5h6V9H9z',down:'M9 15h6v6.5H9z',left:'M2.5 9H9v6H2.5z',right:'M15 9h6.5v6H15z'};
const dpad=(lit:readonly (keyof typeof ARMS)[])=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${CROSS}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>${lit.map(arm=>`<path d="${ARMS[arm]}"/>`).join('')}</svg>`;
const ICONS:Partial<Record<PadGlyph,string>>={
  View:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="11" height="9" rx="1.5"/><rect x="9.5" y="10.5" width="11" height="9" rx="1.5"/></svg>',
  Menu:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  Up:dpad(['up']),Down:dpad(['down']),Left:dpad(['left']),Right:dpad(['right']),DpadDown:dpad(['down']),DpadLR:dpad(['left','right']),DpadUD:dpad(['up','down']),Dpad:dpad(['up','down','left','right']),
};
const TEXT:Partial<Record<PadGlyph,string>>={L3:'LS',R3:'RS'};
/** Xbox-style button badge, sized to sit where a keyboard key cap would. */
export function padGlyph(name:PadGlyph){
  const kind=name==='A'||name==='B'||name==='X'||name==='Y'?`face pad-${name.toLowerCase()}`:ICONS[name]?(name==='View'||name==='Menu'?'icon':'dpad'):name==='LS'||name==='RS'||name==='L3'||name==='R3'?`stick${name.endsWith('3')?' click':''}`:'shoulder';
  return`<span class="pad-glyph ${kind}" role="img" aria-label="${LABELS[name]}" title="${LABELS[name]}">${ICONS[name]??TEXT[name]??name}</span>`;
}
