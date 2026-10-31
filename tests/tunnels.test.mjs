import assert from 'node:assert/strict';
import test from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {sampleDriveSurface} from '../src/simulation/road-surfaces.ts';
import {clipTunnelPortals,inTunnelPortal,inTunnelApproach,tunnelAt,tunnelGeometry} from '../src/simulation/tunnels.ts';

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

test('a terrain crest inside an approach ribbon cannot leave a wedge under one wheel',async()=>{
  const approach={id:'crest-approach',name:'Approach',width:8,oneway:1,points:[[0,-6],[0,6]],elevations:[1,1],tunnel:{clearance:5.2,covered:[]}};
  const heights=Float32Array.from({length:25},(_,i)=>i%5===2?2:0),c={...city,roads:[approach],elevation:{originX:-6,originZ:-6,width:5,height:5,cellSize:3,heights}};
  assert.equal(inTunnelPortal(c,0,0),true,'the terrain crest is removed even though both ribbon edges are lower than the deck');
  assert.equal(inTunnelPortal(c,3,0),false,'the elevated side retains the ground below');
  const p=await DrivingPhysics.create(c);try{
    for(const x of [-.8,0,.8])assert.ok(Math.abs(rayHeight(p,x,0,3)-1)<.001,'both wheel tracks meet the same ramp deck');
  }finally{p.dispose();}
});

test('surface decoration clears level landings as well as excavations and preserves covered ground',()=>{
  const ramp={...bore,points:[[0,0],[0,12],[0,60]],elevations:[0,0,-8],width:8,tunnel:{clearance:5.2,covered:[[48,60]],surfaceLandings:[[0,12]]}},c={...city,roads:[ramp]};
  assert.equal(inTunnelPortal(c,0,6),false,'landing retains its ground');
  for(const x of [-4.5,0,4.5])assert.equal(inTunnelApproach(c,x,6),true,'trees and posts stay out of the entrance and its shoulders');
  assert.equal(inTunnelApproach(c,0,30),true,'open descending ramp remains clear');
  assert.equal(inTunnelApproach(c,0,55),false,'landscaping above a covered tunnel remains');
  assert.equal(inTunnelApproach(c,15,6),false,'adjoining sidewalks remain usable');
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

test('survey clearance clipping clears the shell to the sky over an open-air stretch, slivers beside the deck included',async()=>{
  const {clipTunnelClearance}=await import('../src/simulation/tunnels.ts');
  // Covered for the first 50 m, then a ramp rising out of the bore into the open.
  const road={...bore,points:[[0,-50],[0,0],[0,50]],elevations:[0,0,8],width:6.4,tunnel:{clearance:5.2,covered:[[0,50]]}},c={...city,roads:[road]};
  const wall=z=>{const v=new Float32Array([-30,0,z,30,0,z,-30,45,z,30,45,z]);return clipTunnelClearance(c,v,new Uint32Array([0,1,2,1,3,2]));};
  const area=mesh=>{let a=0;for(let i=0;i<mesh.indices.length;i+=3){const [p,q,r]=[0,1,2].map(j=>Array.from(mesh.vertices.slice(mesh.indices[i+j]*3,mesh.indices[i+j]*3+3)));a+=Math.abs((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]))/2;}return a;};
  const covered=area(wall(-25)),open=wall(25);
  assert.ok(Math.abs(covered-(60*45-(6.4+.8)*(5.2+.45)))<.05,`under cover only the finite aperture opens, area=${covered}`);
  assert.ok(Math.abs(area(open)-(60-(6.4+16))*45)<.05,`over the open ramp a full-height band 8 m past each deck edge goes, area=${area(open)}`);
  for(let i=0;i<open.vertices.length;i+=3)assert.ok(Math.abs(open.vertices[i])>=3.2+8-1e-4,'no sliver stays within the margin');
});

test('a rising merge keeps its roof sealed outside the exact adjoining roof footprint',async()=>{
  const main={...bore,id:'main',points:[[0,-100],[0,400]],elevations:[-12,-12],width:20,tunnel:{clearance:5.2}};
  const branch={id:'branch',name:'Exit',points:[[0,0],[7,250]],elevations:[-12,-2],width:8,oneway:1,tunnel:{clearance:5.2}};
  const c={...city,bounds:{minX:-250,maxX:250,minZ:-250,maxZ:500},roads:[main,branch]},p=await DrivingPhysics.create(c);
  try{
    // The old clearance-volume subtraction removed 0.4m more roof than the
    // adjoining branch actually covered, exposing a strip of sky at this edge.
    const outside=3.08+4.2,height=rayHeight(p,outside,110,-10,false);
    assert.ok(Math.abs(height+6.8)<.01,`mainline ceiling remains over the merge perimeter: ${height}`);
    const side=p.world.castRay(new Ray({x:3.08,y:-3.6,z:110},{x:1,y:0,z:0}),20,true,undefined,undefined,p.chassisCollider,p.body);
    assert.ok(side&&side.timeOfImpact<4.2,'rising branch retains the wall above the lower mainline ceiling');
  }finally{p.dispose();}
});

test('the back of a deep open portal has a surface parapet without closing its driving mouth',async()=>{
  const p=await DrivingPhysics.create(city);try{
    const cast=y=>p.world.castRay(new Ray({x:0,y,z:-5},{x:0,y:0,z:1}),10,true,undefined,undefined,p.chassisCollider,p.body);
    assert.ok(cast(.4)?.timeOfImpact<6,'surface approach cannot fall over the unguarded excavation lip');
    assert.ok(cast(-3)?.timeOfImpact<6,'retaining header seals the earth between the roof and surface');
    assert.equal(cast(-10),null,'the full vehicle opening beneath the ceiling stays open');
  }finally{p.dispose();}
});

test('at-grade ramp terminals allow angled street access while retaining deep excavation guards',async()=>{
  const p=await DrivingPhysics.create(city);try{
    const side=(z)=>p.world.castRay(new Ray({x:10,y:.5,z},{x:-1,y:0,z:0}),12,true,undefined,undefined,p.chassisCollider,p.body);
    assert.equal(side(-99),null,'surface street can enter across the tapered final metre');
    assert.ok(side(-85),'the side of the descending excavation remains guarded at surface height');
  }finally{p.dispose();}
});

test('banked tunnel roofs and walls use the same edge heights as their pavement',async()=>{
  const banked={...bore,points:[[0,0],[0,100]],elevations:[-12,-12],deckEdgeElevations:[[-11.5,-12.5],[-11.5,-12.5]],tunnel:{clearance:5.2}};
  const c={...city,roads:[banked]},p=await DrivingPhysics.create(c);try{
    for(const x of [-5,0,5]){
      const floor=sampleDriveSurface(c,x,50,-10).height,roof=rayHeight(p,x,50,floor+1,false);
      assert.ok(Math.abs(roof-floor-5.2)<.01,`constant clearance across the banked ribbon at ${x}: ${roof-floor}`);
    }
  }finally{p.dispose();}
});
