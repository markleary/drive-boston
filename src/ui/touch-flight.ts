export interface FlightTouchInput {forward:number;strafe:number;yaw:number;lift:number}

type Contact={button:HTMLButtonElement;source:'touch'|'pointer';id:number;pointerType:string};
const neutral=():FlightTouchInput=>({forward:0,strafe:0,yaw:0,lift:0});

/** Native touch snapshots can recover releases missing from the pointer stream.
 * Touch identifiers and pointer IDs are separate namespaces, never interchangeable. */
export function createFlightTouchControls(root:HTMLElement,isActive:()=>boolean){
  const buttons=[...root.querySelectorAll<HTMLButtonElement>('button[data-touch]')];
  const contacts=new Map<string,Contact>(),disposers:(()=>void)[]=[];
  let nativeTouches=false,actions=new Set<string>();
  const canInteract=()=>isActive()&&!document.hidden;
  const on=(target:EventTarget,type:string,handler:EventListener,options?:AddEventListenerOptions)=>{
    target.addEventListener(type,handler,options);disposers.push(()=>target.removeEventListener(type,handler,options));
  };
  const buttonAt=(target:EventTarget|null)=>{
    const button=target instanceof Element?target.closest<HTMLButtonElement>('button[data-touch]'):null;
    return button&&root.contains(button)?button:null;
  };
  const refresh=()=>{
    actions=new Set([...contacts.values()].map(contact=>contact.button.dataset.touch!));
    for(const button of buttons){
      const active=actions.has(button.dataset.touch!);
      button.classList.toggle('held',active);button.setAttribute('aria-pressed',String(active));
    }
  };
  const releaseCapture=(contact:Contact)=>{
    if(contact.source==='pointer'&&contact.button.hasPointerCapture(contact.id))contact.button.releasePointerCapture(contact.id);
  };
  const removeWhere=(predicate:(contact:Contact)=>boolean)=>{
    const removed:Contact[]=[];
    for(const [key,contact] of contacts)if(predicate(contact)){contacts.delete(key);removed.push(contact);}
    // Clear ownership before releasing capture, since lostcapture may reenter.
    removed.forEach(releaseCapture);
  };
  function reset(){removeWhere(()=>true);refresh();}
  const releasePointer=(id:number)=>{removeWhere(contact=>contact.source==='pointer'&&contact.id===id);refresh();};

  on(root,'pointerdown',event=>{
    const e=event as PointerEvent,button=buttonAt(e.target);
    if(!button||!canInteract()||e.button!==0||(e.pointerType==='touch'&&nativeTouches))return;
    e.preventDefault();
    // A fresh primary pointer starts a new gesture; an earlier missed release
    // must not survive it. Other simultaneous pointer types remain independent.
    if(e.isPrimary)removeWhere(contact=>contact.source==='pointer'&&contact.pointerType===e.pointerType);
    removeWhere(contact=>contact.source==='pointer'&&contact.id===e.pointerId);
    contacts.set(`pointer:${e.pointerId}`,{button,source:'pointer',id:e.pointerId,pointerType:e.pointerType});
    try{button.setPointerCapture(e.pointerId);}catch{/* Window-level release also works without capture. */}
    refresh();
  });
  for(const type of ['pointerup','pointercancel'])on(window,type,event=>releasePointer((event as PointerEvent).pointerId),{capture:true});
  on(window,'lostpointercapture',event=>{
    const e=event as PointerEvent,contact=contacts.get(`pointer:${e.pointerId}`);
    // A late event from an old owner must not cancel a reused pointer ID.
    if(contact&&e.target===contact.button&&!contact.button.hasPointerCapture(e.pointerId))releasePointer(e.pointerId);
  },{capture:true});
  on(window,'pointermove',event=>{
    const e=event as PointerEvent;
    if(e.buttons===0&&contacts.has(`pointer:${e.pointerId}`))releasePointer(e.pointerId);
  },{capture:true});

  const reconcileTouches=(event:Event)=>{
    const e=event as TouchEvent;
    nativeTouches=true;
    // Switch touch input to its native stream once available, without counting
    // the preceding pointerdown twice or disturbing mouse/pen contacts.
    removeWhere(contact=>contact.source==='pointer'&&contact.pointerType==='touch');
    if(!canInteract()){reset();return;}
    const active=new Set(Array.from(e.touches,touch=>touch.identifier));
    const ended=e.type==='touchend'||e.type==='touchcancel'?new Set(Array.from(e.changedTouches,touch=>touch.identifier)):new Set<number>();
    removeWhere(contact=>contact.source==='touch'&&(!active.has(contact.id)||ended.has(contact.id)));
    if(e.type==='touchstart'){
      let accepted=false;
      for(const touch of Array.from(e.changedTouches)){
        const button=buttonAt(touch.target);
        if(!button||!active.has(touch.identifier))continue;
        contacts.set(`touch:${touch.identifier}`,{button,source:'touch',id:touch.identifier,pointerType:'touch'});accepted=true;
      }
      // A driving touch must not become a click on a newly opened overlay.
      if(accepted&&e.cancelable)e.preventDefault();
    }
    // Moves reconcile existing contacts only: a finger held through pause or
    // rotation must lift before it can apply input again.
    refresh();
  };
  for(const type of ['touchstart','touchmove','touchend','touchcancel'])on(window,type,reconcileTouches,{capture:true,passive:type!=='touchstart'});
  for(const type of ['blur','pagehide','resize'])on(window,type,reset);
  on(document,'visibilitychange',()=>{if(document.hidden)reset();});
  refresh();
  return{
    reset,
    getInput():FlightTouchInput{
      if(!canInteract())return neutral();
      return{
        forward:Number(actions.has('accelerate'))-Number(actions.has('reverse')),
        strafe:Number(actions.has('right'))-Number(actions.has('left')),
        yaw:Number(actions.has('yaw-right'))-Number(actions.has('yaw-left')),
        lift:Number(actions.has('ascend'))-Number(actions.has('descend')),
      };
    },
    dispose(){reset();disposers.forEach(dispose=>dispose());},
  };
}
