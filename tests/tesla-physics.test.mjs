import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {PLAYER_CARS} from '../src/simulation/player-cars.ts';

const id='tesla-model-3-performance',spec=PLAYER_CARS[id];
const city={bounds:{minX:-20000,maxX:20000,minZ:-20000,maxZ:20000},buildings:[],spawn:{x:0,z:0,yaw:0}};
const idle={throttle:0,brake:0,steer:0,handbrake:false};
const advance=(p,seconds,input=idle,dt=1/60)=>{for(let i=0;i<Math.round(seconds/dt);i++)p.step(input,dt);return p.getState();};

for(const dt of [1/60,1/120])test(`Model 3 Performance measures rollout launch, single-speed AWD and governor at ${1/dt} Hz`,async t=>{
  const p=await DrivingPhysics.create(city);p.setCar(id);
  try{
    const start=advance(p,2,idle,dt);assert.ok(Math.abs(p.body.mass()-1839)<.001);assert.ok(start.rpm<1,'an EV has no combustion idle');
    const gears=new Set();let rollout,sixty;
    for(let i=0;i<120/dt;i++){
      p.step({...idle,throttle:1},dt);const s=p.getState(),time=(i+1)*dt;gears.add(s.gear);
      if(rollout===undefined&&s.z-start.z>=.3048)rollout=time;
      if(sixty===undefined&&s.speed>=60*.44704)sixty=time;
      assert.ok(Number.isFinite(s.speed+s.rpm+s.y));
    }
    assert.ok(Math.abs(sixty-rollout-2.9)<.06,`rollout-corrected 0–60 ${sixty-rollout}s`);
    assert.ok(sixty>3.1&&sixty<3.3,`standing-start 0–60 ${sixty}s must include rollout`);
    assert.deepEqual([...gears],[1],'fixed reduction must never invent forward gear changes');
    assert.ok(Math.abs(p.getState().speed/.44704-163)<.05);
    for(let i=0;i<4;i++)assert.ok(p.controller.wheelEngineForce(i)>0,'both axles propel the EV');
    assert.ok(p.body.localCom().y<-.25,'battery lowers the loaded center of mass');
    t.diagnostic(JSON.stringify({standingStartSeconds:sixty,rolloutSeconds:rollout,correctedSeconds:sixty-rollout,topMph:p.getState().speed/.44704}));
  }finally{p.dispose();}
});

for(const dt of [1/60,1/120])test(`Model 3 regenerative braking, service brakes and reverse at ${1/dt} Hz`,async t=>{
  const p=await DrivingPhysics.create(city);p.setCar(id);
  try{
    advance(p,2,idle,dt);p.body.setLinvel({x:0,y:0,z:20},true);
    const coasting=advance(p,4,idle,dt);
    assert.ok(coasting.speed>11&&coasting.speed<13,'lift-off should provide roughly .2g deceleration');
    assert.ok(coasting.braking,'strong regenerative slowing illuminates brake lamps');
    const stopped=advance(p,12,idle,dt);assert.ok(Math.abs(stopped.speed)<.05,'regen should settle without driving backward');
    p.reset(0,0,0);advance(p,2,idle,dt);p.body.setLinvel({x:0,y:0,z:100/3.6},true);
    const start=p.getState().z;let elapsed=0;
    while(p.getState().speed>.1&&elapsed<6){p.step({...idle,brake:1},dt);elapsed+=dt;}
    const distance=p.getState().z-start;assert.ok(distance>36&&distance<39,`100–0 stopping distance ${distance}m`);
    const reverse=advance(p,5,{...idle,throttle:-1},dt);assert.equal(reverse.gear,-1);
    assert.ok(Math.abs(reverse.speed+spec.maxReverseSpeed)<.05);
    assert.ok(reverse.rpm>0&&reverse.rpm<2500);
    // A direction change brakes first; it never snaps velocity from R to D.
    p.step({...idle,throttle:1},dt);assert.equal(p.getState().gear,-1);assert.ok(p.getState().braking);
    const forward=advance(p,4,{...idle,throttle:1},dt);assert.equal(forward.gear,1);assert.ok(forward.speed>10);
    p.step({...idle,throttle:1,handbrake:true},dt);
    assert.equal(p.controller.wheelEngineForce(2),0);assert.equal(p.controller.wheelEngineForce(3),0);
    t.diagnostic(JSON.stringify({brakingMetres:distance,regenSpeedAfter4Seconds:coasting.speed,reverseMps:reverse.speed}));
  }finally{p.dispose();}
});

test('Model 3 turns symmetrically without rolling and collides at its governed top speed',async()=>{
  const wall={id:'wall',name:'Wall',center:[0,81.5],height:20,footprint:[[-50,80],[50,80],[50,83],[-50,83]]};
  const p=await DrivingPhysics.create({...city,buildings:[wall]});p.setCar(id);
  try{
    const turns=[];
    for(const steer of [-1,1]){
      p.reset(0,0,0);advance(p,2);p.body.setLinvel({x:0,y:0,z:12},true);
      const s=advance(p,1,{...idle,throttle:.3,steer}),q=p.body.rotation();turns.push(s.yaw);
      assert.ok(1-2*(q.x*q.x+q.z*q.z)>.9);assert.ok(Math.abs(s.yaw)>.15);
    }
    assert.ok(turns[0]*turns[1]<0);assert.ok(Math.abs(Math.abs(turns[0])-Math.abs(turns[1]))<.05);
    p.reset(0,0,0);advance(p,2);p.body.setLinvel({x:0,y:0,z:spec.maxForwardSpeed},true);
    let furthest=0,impacts=0;
    for(let i=0;i<90;i++){p.step({...idle,throttle:1},1/60);furthest=Math.max(furthest,p.getState().z);impacts+=p.takeImpacts().length;}
    assert.ok(impacts>0);assert.ok(furthest<79,`chassis tunneled to ${furthest}`);
  }finally{p.dispose();}
});
