import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics,REGEN} from '../src/physics/vehicle.ts';
import {PLAYER_CARS,ENGINES,engineBrakeForce,roadLoad,gearing} from '../src/simulation/player-cars.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';

// Lift-off, handbrake and wheelspin behaviour of every car on level ground, against the figures the rules are set by.
const G=9.81,MPH=.44704,STEP=1/60;
const flat={bounds:{minX:-20000,maxX:20000,minZ:-20000,maxZ:20000},buildings:[],spawn:{x:0,z:0,yaw:0}};
const idle={throttle:0,brake:0,steer:0,handbrake:false};
const advance=(p,seconds,input=idle,dt=STEP,each)=>{for(let i=0;i<Math.round(seconds/dt);i++){p.step({...idle,...input},dt);each?.(p.getState(),(i+1)*dt);}return p.getState();};
async function car(id,city=flat){const p=await DrivingPhysics.create(city);p.setCar(id);advance(p,2);return p;}
const rolling=(p,speed)=>{p.reset(0,0,0);advance(p,2);p.body.setLinvel({x:0,y:0,z:speed},true);};
/** Deceleration (g) over one second with the pedals released, half a second after rolling at `mph`. */
const coast=(p,mph,dt=STEP)=>{rolling(p,mph*MPH);const a=advance(p,.5,idle,dt).speed,b=advance(p,1,idle,dt).speed;return(a-b)/G;};
const stop=(p,speed,input,dt=STEP)=>{rolling(p,speed);const from=p.getState();let t=0;while(p.getState().speed>.1&&t<40){p.step({...idle,...input},dt);t+=dt;}const s=p.getState();return{distance:Math.hypot(s.x-from.x,s.z-from.z),seconds:t,yaw:s.yaw};};
const upright=p=>{const q=p.body.rotation();return 1-2*(q.x*q.x+q.z*q.z);};
const COMBUSTION=Object.keys(ENGINES),ALL=Object.keys(PLAYER_CARS);

test('a closed throttle leaves the engine to be turned by the driven wheels, by its friction through the gearing',async()=>{
  // The force is the motoring torque (1 bar of mean effective pressure at idle to 2.9 bar at the redline, over the
  // swept volume) times the gear, so a low gear at high revs slows the car hard and a tall gear hardly at all.
  const gt=engineBrakeForce('mclaren-gt',4750,1),tall=engineBrakeForce('mclaren-gt',4750,6);
  assert.ok(gt>2200&&gt<2700,`4.0 litres at 4,750 rpm in first: ${gt} N`);assert.ok(tall<gt/3,'the same revs in sixth turn the wheels a third as hard');
  assert.equal(engineBrakeForce('tesla-model-3-performance',9000,1),0);assert.equal(engineBrakeForce('supra-mk4',900,1),0,'at idle the clutch has let go');
  assert.ok(gearing('mclaren-gt',1)>gearing('mclaren-gt',2));
  const measured={};
  for(const id of COMBUSTION){
    const p=await car(id);
    try{
      const g=coast(p,30),s=p.getState(),load=roadLoad(id,s.speed)/PLAYER_CARS[id].mass/G;measured[id]=g;
      assert.ok(g>load+.02,`${id} slows by more than its road load at 30 mph: ${g} g against ${load} g`);
      assert.ok(g<.22,`${id}: ${g} g`);
      // Never pushes a stopped car backwards, and gives way to the pedal.
      const rest=advance(p,90);assert.ok(Math.abs(rest.speed)<.06&&rest.speed>-.01,`${id} coasts to rest: ${rest.speed}`);
      rolling(p,30*MPH);const driven=advance(p,1,{throttle:1});assert.ok(driven.speed>30*MPH,`${id} accelerates under power`);
    }finally{p.dispose();}
  }
  // First gear near its top in the supercars, third in the loaded diesel.
  assert.ok(measured['mclaren-gt']>.14&&measured['mclaren-720s']>.14&&measured['supra-mk4']>.11,JSON.stringify(measured));
  assert.ok(measured['moving-truck']>.035&&measured['moving-truck']<.08,JSON.stringify(measured));
});

test('the Harbor S4 rolls on tyre and air drag instead of body damping, and reaches its 60 mph',async()=>{
  const p=await car('harbor-s4');
  try{
    assert.equal(p.body.linearDamping(),0);
    let sixty;const top=advance(p,20,{throttle:1},STEP,(s,t)=>{if(sixty===undefined&&s.speed>=59.9*MPH)sixty=t;});
    assert.ok(sixty>6.5&&sixty<8,`0 to 60 mph in ${sixty} s`);assert.ok(Math.abs(top.speed/MPH-60)<.1);
    const g=coast(p,60);assert.ok(g>.04&&g<.09,`lift-off at 60 mph: ${g} g (body damping gave .37)`);
    const braked=stop(p,60*MPH,{brake:1});assert.ok(braked.distance>32&&braked.distance<37,`60 to 0 in ${braked.distance} m`);
  }finally{p.dispose();}
});

for(const dt of [1/60,1/120])test(`Model 3 lift-off regeneration holds .21 g to a stop and Hold keeps the car there at ${1/dt} Hz`,async()=>{
  const p=await car('tesla-model-3-performance');
  try{
    // SAE 2020-01-0883: two Model 3s averaged .21 g of steady coast-down deceleration in Standard mode.
    for(const mph of [20,30,45]){const g=coast(p,mph,dt);assert.ok(Math.abs(g-.21)<.012,`${mph} mph: ${g} g`);}
    rolling(p,30*MPH);let rest;advance(p,10,idle,dt,(s,t)=>{if(rest===undefined&&Math.abs(s.speed)<.05)rest=t;});
    assert.ok(rest>6&&rest<7.2,`30 mph to rest in ${rest} s (6.5 s at a constant .21 g)`);
    const held=p.getState();assert.ok(held.braking,'Hold shows the brake lamps');
    assert.ok(REGEN.force/PLAYER_CARS['tesla-model-3-performance'].mass/G<.21);
    // In reverse as well.
    rolling(p,-5);const back=advance(p,4,idle,dt);assert.ok(Math.abs(back.speed)<.05,`regeneration stops a reversing car: ${back.speed}`);
  }finally{p.dispose();}
});

test('Hold keeps the Model 3 on a 22% grade with the pedals released, where a combustion car rolls away',async()=>{
  const city=await loadCentralCity(),at=city.landmarks.find(l=>l.id==='mission-hill').driveStart,moved={};
  for(const id of ['tesla-model-3-performance','mclaren-gt']){
    const p=await DrivingPhysics.create(city);p.setCar(id);
    try{
      p.reset(at.x,at.z,at.yaw);advance(p,1,{brake:1});
      // Up the hill, lift, and wait.
      advance(p,1.5,{throttle:.6});advance(p,6);const a=p.getState(),b=advance(p,5);moved[id]=Math.hypot(b.x-a.x,b.z-a.z);
      if(id.startsWith('tesla')){
        assert.ok(moved[id]<.05&&Math.abs(b.speed)<.01,`held: ${moved[id]} m`);
        const away=advance(p,1.5,{throttle:1});assert.ok(away.speed>4,'the pedal releases Hold');
      }
    }finally{p.dispose();}
  }
  assert.ok(moved['mclaren-gt']>3,`a car in gear with no brake rolls back down: ${moved['mclaren-gt']} m`);
});

for(const dt of [1/60,1/120])test(`the handbrake is the rear tyres alone at their sliding grip at ${1/dt} Hz`,async()=>{
  for(const id of ALL){
    const p=await car(id);
    try{
      const hand=stop(p,30*MPH,{handbrake:true},dt),g=(30*MPH)**2/2/hand.distance/G,foot=stop(p,30*MPH,{brake:1},dt);
      // Four fifths of the tyre's peak, on the share of the weight the rear axle keeps as the car pitches forward.
      assert.ok(g>.3&&g<.6,`${id}: ${g} g over ${hand.distance} m`);
      if(id!=='moving-truck')assert.ok(hand.distance>foot.distance*1.7,`${id}: ${hand.distance} m against ${foot.distance} m on all four`);
      assert.ok(Math.abs(hand.yaw)<.03,`${id} stays straight with the wheel straight: ${hand.yaw}`);
      const parked=advance(p,3,{handbrake:true},dt);assert.ok(Math.abs(parked.speed)<.01);
    }finally{p.dispose();}
  }
});

test('the pedal revs the engine against the handbrake, and letting go with the wheel straight launches hooked up',async()=>{
  for(const id of ALL){
    const p=await car(id),electric=id.startsWith('tesla');
    try{
      const from=p.getState();let peak=0;
      const held=advance(p,2,{throttle:1,handbrake:true},STEP,s=>{peak=Math.max(peak,s.rpm);});
      assert.ok(Math.hypot(held.x-from.x,held.z-from.z)<.02&&Math.abs(held.speed)<.02,`${id} stays where it is: ${held.z-from.z} m`);
      for(let i=0;i<4;i++)assert.equal(p.controller.wheelEngineForce(i),0,'the clutch is open');
      if(electric)assert.ok(peak<1,'a motor does not rev at rest');
      else{const e=ENGINES[id];assert.ok(Math.abs(peak-.72*e.redline)<.03*e.redline,`${id} holds ${peak} rpm`);}
      const eased=advance(p,.5,{handbrake:true});if(!electric)assert.ok(eased.rpm<peak*.6,'the revs fall with the pedal');
      // Launch: as quick as flooring it from rest, less the time the pedal takes to travel.
      advance(p,1.5,{throttle:1,handbrake:true});let launched,spun=0;const mark=(id==='moving-truck'?8:20)*MPH;
      advance(p,6,{throttle:1},STEP,(s,t)=>{spun=Math.max(spun,s.wheelspin);if(launched===undefined&&s.speed>=mark)launched=t;});
      p.reset(0,0,0);advance(p,2);let plain;advance(p,6,{throttle:1},STEP,(s,t)=>{if(plain===undefined&&s.speed>=mark)plain=t;});
      assert.ok(launched<=plain&&launched>plain-.15,`${id}: ${launched} s against ${plain} s`);assert.equal(spun,0,'no wheelspin with the wheel straight');
    }finally{p.dispose();}
  }
});

test('released with the wheel turned, the cars with the power for it spin their rear tyres into a donut until the pedal lifts',async()=>{
  const turns=async id=>{
    const p=await car(id);
    try{
      advance(p,1,{throttle:1,steer:1,handbrake:true});
      let turned=0,last=p.getState().yaw,spun=0,least=1,minX=0,maxX=0,minZ=0,maxZ=0,revs=0;
      advance(p,7,{throttle:1,steer:1},STEP,s=>{
        turned+=Math.atan2(Math.sin(s.yaw-last),Math.cos(s.yaw-last));last=s.yaw;spun=Math.max(spun,s.wheelspin);least=Math.min(least,upright(p));revs=Math.max(revs,s.rpm);
        minX=Math.min(minX,s.x);maxX=Math.max(maxX,s.x);minZ=Math.min(minZ,s.z);maxZ=Math.max(maxZ,s.z);
      });
      const span=Math.max(maxX-minX,maxZ-minZ),marks=p.getTireContacts({...idle,throttle:1,steer:1}).filter(c=>c.wheel>=2).map(c=>c.intensity);
      // Lift: the tyres hook up again and the car drives straight on.
      const lifted=advance(p,1.5),rate=Math.abs(p.body.angvel().y);
      return{turned:turned/2/Math.PI,spun,least,span,revs,marks,after:lifted.wheelspin,rate,forward:lifted.speed};
    }finally{p.dispose();}
  };
  for(const id of ['mclaren-gt','mclaren-720s','supra-mk4','tesla-model-3-performance']){
    const r=await turns(id);
    assert.ok(r.turned>1,`${id} goes round more than once in seven seconds: ${r.turned}`);assert.ok(r.span<26,`${id} in a ${r.span} m square`);
    assert.ok(r.spun>.9&&r.least>.97,`${id}: wheelspin ${r.spun}, upright ${r.least}`);
    assert.ok(r.marks.length===2&&r.marks.every(i=>i>.9),`${id} lays rubber from both rear tyres: ${r.marks}`);
    assert.ok(r.after===0&&r.rate<.05&&r.forward>0,`${id} recovers on lifting: wheelspin ${r.after}, yaw rate ${r.rate}`);
  }
  // The everyday coupe and the loaded truck have less first-gear force than their rear tyres' grip: they drive round on the lock.
  for(const id of ['harbor-s4','moving-truck']){const r=await turns(id);assert.equal(r.spun,0,`${id} cannot spin its tyres`);}
});

test('a handbrake turn swings the tail round, and the pedal held through it carries the slide on under power',async()=>{
  for(const id of ['mclaren-gt','supra-mk4','harbor-s4']){
    const p=await car(id);
    try{
      rolling(p,30*MPH);const plain=advance(p,.7,{steer:1});
      rolling(p,30*MPH);let least=1;const swung=advance(p,.7,{steer:1,handbrake:true},STEP,()=>{least=Math.min(least,upright(p));});
      assert.ok(swung.yaw>plain.yaw+.1&&swung.yaw<1.4,`${id}: ${swung.yaw} rad with the handbrake, ${plain.yaw} without`);
      assert.ok(swung.speed>6,`${id} keeps its speed through the turn: ${swung.speed} m/s`);assert.ok(least>.97);
      const settled=advance(p,2);assert.ok(Math.abs(p.body.angvel().y)<.05&&settled.speed>2,`${id} straightens once the handbrake is off`);
    }finally{p.dispose();}
  }
  // Power on as the handbrake comes off at 35 mph, with a driver who holds opposite lock against the slide and feathers
  // the pedal to keep it near 25 degrees (full throttle would tighten it into a donut): the slide stands for eight seconds.
  for(const id of ['mclaren-gt','mclaren-720s','supra-mk4','tesla-model-3-performance']){
    const p=await car(id);
    try{
      rolling(p,35*MPH);advance(p,.5,{steer:1,handbrake:true,throttle:1});
      const angle=()=>{const s=p.getState(),v=p.body.linvel();return Math.atan2(v.x*Math.cos(s.yaw)-v.z*Math.sin(s.yaw),Math.max(.5,Math.abs(v.x*Math.sin(s.yaw)+v.z*Math.cos(s.yaw))));};
      let most=0,least=9,spun=1;
      for(let i=0;i<8*60;i++){
        const b=angle(),a=Math.abs(b);p.step({...idle,throttle:Math.max(.25,Math.min(1,.55+(.45-a)*2.5)),steer:Math.max(-1,Math.min(1,(-b+.3)/.3))},STEP);
        if(i>90){most=Math.max(most,a);least=Math.min(least,a);spun=Math.min(spun,p.getState().wheelspin);}
      }
      assert.ok(least>.25&&most<.65,`${id}: the slide holds between ${least} and ${most} rad`);assert.ok(spun>.5,`${id}: the tyres keep spinning: ${spun}`);assert.ok(upright(p)>.97);
    }finally{p.dispose();}
  }
});

test('the brake key is the whole pedal: holding reverse at speed stops as short as the brake',async()=>{
  for(const id of ['mclaren-gt','tesla-model-3-performance','harbor-s4']){
    const p=await car(id);
    try{
      const v=Math.min(100/3.6,PLAYER_CARS[id].maxForwardSpeed),pedal=stop(p,v,{brake:1});
      rolling(p,v);const from=p.getState().z;let t=0;while(p.getState().speed>.5&&t<20){p.step({...idle,throttle:-1},STEP);t+=STEP;}
      const key=p.getState().z-from;assert.ok(Math.abs(key-pedal.distance)<pedal.distance*.04,`${id}: ${key} m on the key, ${pedal.distance} m on the pedal`);
    }finally{p.dispose();}
  }
});
