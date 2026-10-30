import assert from 'node:assert/strict';
import test from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {sampleDriveSurface} from '../src/simulation/road-surfaces.ts';
import {clipTunnelPortals,inTunnelPortal,tunnelAt,tunnelGeometry} from '../src/simulation/tunnels.ts';

const bore={id:'tunnel-main',name:'Central Artery',width:12,oneway:1,points:[[0,-100],[0,0],[0,200]],elevations:[0,-12,-12],tunnel:{clearance:5.2,covered:[[100,300]],capEnd:true}};
const city={bounds:{minX:-250,maxX:250,minZ:-250,maxZ:250},buildings:[],roads:[bore,{id:'surface',name:'Surface Road',width:12,oneway:0,points:[[-200,100],[200,100]]}],spawn:{x:30,z:-180,yaw:0}};
const controls={throttle:0,brake:0,steer:0,handbrake:false};
function run(physics,seconds,input={}){for(let i=0;i<seconds*60;i++)physics.step({...controls,...input},1/60);return physics.getState();}
function rayHeight(physics,x,z,y,down=true,max=50){const result=physics.world.castRay(new Ray({x,y,z},{x:0,y:down?-1:1,z:0}),max,true,undefined,undefined,physics.chassisCollider,physics.body);return result?y+result.timeOfImpact*(down?-1:1):undefined;}

test('tunnel support, explicit reset and saved road IDs distinguish the surface and underground levels',()=>{
  assert.equal(sampleDriveSurface(city,0,100).height,0);
  assert.equal(sampleDriveSurface(city,0,100,-11.3).height,-12);
  assert.equal(sampleDriveSurface(city,0,100,-11.3).road.id,bore.id);
  assert.equal(sampleDriveSurface(city,0,100,undefined,bore.id).height,-12);
  assert.equal(sampleDriveSurface(city,0,-50).height,-6,'an open ramp replaces removed ground');
  assert.equal(tunnelAt(city,0,100,1),undefined,'the surface is outside the bore');
  assert.equal(tunnelAt(city,0,100,-11).covered,true);
  assert.equal(inTunnelPortal(city,0,-50),true);
  assert.equal(inTunnelPortal(city,0,50),false,'covered tunnel has intact terrain above');
});

test('portal clipping preserves exact boundary and triangle interpolation rather than removing whole grid cells',()=>{
  const vertices=new Float32Array([-20,0,-100,20,4,-100,-20,0,0,20,4,0]),indices=new Uint32Array([0,2,1,1,2,3]);
  const clipped=clipTunnelPortals(city,vertices,indices);let area=0;
  for(let i=0;i<clipped.indices.length;i+=3){
    const p=[0,1,2].map(j=>Array.from(clipped.vertices.slice(clipped.indices[i+j]*3,clipped.indices[i+j]*3+3)));
    const x=p.reduce((s,v)=>s+v[0],0)/3,z=p.reduce((s,v)=>s+v[2],0)/3;
    assert.equal(inTunnelPortal(city,x,z),false);
    for(const [x,y]of p)assert.ok(Math.abs(y-(x+20)/10)<1e-5,'split vertices keep the original terrain plane');
    area+=Math.abs((p[1][0]-p[0][0])*(p[2][2]-p[0][2])-(p[1][2]-p[0][2])*(p[2][0]-p[0][0]))/2;
  }
  assert.ok(Math.abs(area-(40-12.6)*100)<.02,`only the 12.6m portal is removed; area=${area}`);
});

test('car and bike enter the graded portal and remain supported far below surface without rescue teleportation',async()=>{
  for(const type of ['car','ultrabee']){
    const p=await DrivingPhysics.create(city);try{
      p.setVehicleType(type);p.reset(0,-87,0,bore.id);run(p,.5,{brake:1});const state=run(p,8,{throttle:1});
      assert.ok(state.z>20&&state.z<190,`${type} drove through portal: ${JSON.stringify(state)}`);
      assert.ok(Math.abs(state.y+12-(type==='car'?.67:.577))<.35,`${type} stays on underground deck`);
      assert.equal(sampleDriveSurface(city,state.x,state.z,state.y).road.id,bore.id);
      assert.ok(Array.from({length:p.controller.numWheels()},(_,i)=>p.controller.wheelIsInContact(i)).every(Boolean));
      p.setVehicleType(type==='car'?'ultrabee':'car');assert.ok(p.getState().y<-10,'vehicle switch retains underground level');
    }finally{p.dispose();}
  }
});

test('covered tunnel floor, roof, side walls and southern stop are physical while surface stays intact',async()=>{
  const p=await DrivingPhysics.create(city);try{
    assert.ok(Math.abs(rayHeight(p,0,100,5))<1e-5,'surface road/Greenway ground remains above the bore');
    assert.ok(Math.abs(rayHeight(p,0,100,-10)+12)<1e-5,'bore floor supports wheel rays');
    assert.ok(Math.abs(rayHeight(p,0,100,-10,false)+6.8)<1e-4,'ceiling underside stops upward movement');
    assert.ok(Math.abs(rayHeight(p,0,-50,5)+6)<1e-4,'portal ground is replaced by the ramp');
    assert.ok(Math.abs(rayHeight(p,8,-50,5))<1e-5,'ground beside ramp is retained');
    const wall=p.world.castRay(new Ray({x:0,y:-10,z:100},{x:1,y:0,z:0}),20,true,undefined,undefined,p.chassisCollider,p.body);
    assert.ok(wall&&wall.timeOfImpact>5.7&&wall.timeOfImpact<6.3,'side wall contains the car');
    p.reset(0,140,0,bore.id);run(p,.5,{brake:1});const stopped=run(p,5,{throttle:1});
    assert.ok(stopped.z<194&&stopped.z>180,`southern concrete barriers stop travel: ${stopped.z}`);
  }finally{p.dispose();}
});

test('same-level merging tunnel ramps have no wall across their shared driving opening',async()=>{
  const ramp={id:'branch',name:'Exit',width:8,oneway:1,points:[[-30,50],[0,110]],elevations:[-12,-12],tunnel:{clearance:5.2}};
  const c={...city,roads:[bore,ramp]},shell=tunnelGeometry(c,bore),p=await DrivingPhysics.create(c);
  try{
    assert.ok(shell.walls.indices.length>0);
    const opening=p.world.castRay(new Ray({x:-12,y:-10,z:86},{x:.4472136,y:0,z:.8944272}),30,true,undefined,undefined,p.chassisCollider,p.body);
    assert.ok(!opening||opening.timeOfImpact>20,'ramp merge shares an open perimeter');
  }finally{p.dispose();}
});

test('streaming physics installs tunnels before surface tiles arrive',async()=>{
  const p=await DrivingPhysics.create(city,{streaming:true});try{
    assert.ok(Math.abs(rayHeight(p,0,100,-10)+12)<1e-5);
    p.reset(0,100,0,bore.id);const state=run(p,1,{brake:1});assert.ok(Math.abs(state.y+11.33)<.2);
  }finally{p.dispose();}
});

test('overturned underground car recovers on the bore beneath the surface road',async()=>{
  const p=await DrivingPhysics.create(city);try{
    p.reset(0,100,0,bore.id);p.body.setTranslation({x:0,y:-11.6,z:100},true);p.body.setRotation({x:0,y:0,z:1,w:0},true);
    const recovered=run(p,4,{brake:1});assert.ok(Math.abs(recovered.y+11.33)<.2,'recovery keeps the underground level');
    assert.ok(1-2*(recovered.rotation.x**2+recovered.rotation.z**2)>.98,'car is upright again');
    assert.ok(Math.hypot(recovered.x,recovered.z-100)<2,'recovery remains at the local crash');
  }finally{p.dispose();}
});

test('an open elevated Zakim approach preserves the surface below until its grade meets terrain',async()=>{
  const approach={id:'approach',name:'Zakim approach',width:12,oneway:1,points:[[0,-100],[0,100]],elevations:[10,-10],tunnel:{clearance:5.2,covered:[]}},c={...city,roads:[approach]};
  assert.equal(inTunnelPortal(c,0,-80),false,'elevated approach does not excavate the street below');
  assert.equal(inTunnelPortal(c,0,40),true,'descending approach opens the surface when below grade');
  const p=await DrivingPhysics.create(c);try{
    assert.ok(Math.abs(rayHeight(p,0,-80,3))<1e-5,'lower surface stays physically present');
    assert.ok(Math.abs(rayHeight(p,0,40,3)+4)<1e-4,'underground ramp has no terrain lid');
  }finally{p.dispose();}
});

test('a rising branch opens the lower mainline ceiling throughout their shared bore volume',async()=>{
  const main={...bore,id:'lower-main',points:[[0,-100],[0,400]],elevations:[-12,-12],width:20,tunnel:{clearance:5.2}};
  const branch={id:'rising-branch',name:'Exit',points:[[0,0],[7,250]],elevations:[-12,-2],width:8,oneway:1,tunnel:{clearance:5.2}};
  const c={...city,bounds:{minX:-250,maxX:250,minZ:-250,maxZ:500},roads:[main,branch]},p=await DrivingPhysics.create(c);
  try{
    assert.equal(p.canResetAt(3.08,110,Math.atan2(7,250),branch.id),true,'lower roof must not slice through the rising exit car');
    const floor=-12+110/250*10;
    const hit=rayHeight(p,3.08,110,floor+1,false);assert.ok(Math.abs(hit-(floor+5.2))<.08,'upper branch ceiling covers the shared open chamber');
  }finally{p.dispose();}
});

test('survey clearance clipping opens only a finite tunnel aperture and retains the facade above it',async()=>{
  const {clipTunnelClearance}=await import('../src/simulation/tunnels.ts');
  const road={...bore,points:[[0,-50],[0,50]],elevations:[0,0],tunnel:{clearance:5.2}},c={...city,roads:[road]};
  const vertices=new Float32Array([-20,-5,0,20,-5,0,-20,30,0,20,30,0]),indices=new Uint32Array([0,1,2,1,3,2]),mesh=clipTunnelClearance(c,vertices,indices);
  let area=0;
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=[0,1,2].map(j=>Array.from(mesh.vertices.slice(mesh.indices[i+j]*3,mesh.indices[i+j]*3+3)));area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
  assert.ok(Math.abs(area-(40*35-12.8*6.15))<.02,`only the bore opening is removed, area=${area}`);
  const p=await DrivingPhysics.create({...city,roads:[]});try{
    const collider=p.addStaticMesh(mesh.vertices,mesh.indices);p.world.step();
    assert.ok(collider.castRay(new Ray({x:0,y:2,z:-5},{x:0,y:0,z:1}),10,true)<0,'driving-height aperture is open');
    assert.ok(collider.castRay(new Ray({x:0,y:15,z:-5},{x:0,y:0,z:1}),10,true)>=0,'upper facade remains');
    assert.ok(collider.castRay(new Ray({x:9,y:2,z:-5},{x:0,y:0,z:1}),10,true)>=0,'facade beside the portal remains');
  }finally{p.dispose();}
});
