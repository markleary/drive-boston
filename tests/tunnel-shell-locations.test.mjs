import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {tunnelGeometry,tunnelPointAt,tunnelStations,tunnelCoveredAt} from '../src/simulation/tunnels.ts';

const city=await loadMetroCity({tiles:[]}),roads=city.roads.filter(r=>r.tunnel);
await RAPIER.init();const world=new RAPIER.World({x:0,y:0,z:0});
for(const road of roads)for(const mesh of Object.values(tunnelGeometry(city,road)))if(mesh.indices.length)world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices,mesh.indices));
world.step();after(()=>world.free());
const find=id=>roads.find(r=>r.id===`central-artery-${id}`);
const ray=(from,to)=>{const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z,d=Math.hypot(dx,dy,dz);return world.castRay(new RAPIER.Ray(from,{x:dx/d,y:dy/d,z:dz/d}),d,true);};

test('the reported Haymarket merge has a continuous ceiling across all travel lanes',()=>{
  const road=find('southbound');let checks=0;
  for(let s=295;s<=375;s+=1.5)for(let lateral=-5.5;lateral<=5.5;lateral+=.5){
    const p=tunnelPointAt(road,s),x=p.x+Math.cos(p.yaw)*lateral,z=p.z-Math.sin(p.yaw)*lateral,floor=sampleRoadElevation(city,road,x,z);
    const hit=ray({x,y:floor+1,z},{x,y:floor+12,z});
    assert.ok(hit,`ceiling missing at Haymarket station ${s}, lane offset ${lateral}: ${x},${z}`);checks++;
  }
  assert.ok(checks>1000);
});

test('the North End exit excavation has a guarded surface lip and an open tunnel mouth',()=>{
  const road=find('north-end-north-off'),station=road.tunnel.covered.at(-1)[1],p=tunnelPointAt(road,station),dx=Math.sin(p.yaw),dz=Math.cos(p.yaw),surface=sampleElevation(city,p.x,p.z);
  assert.ok(ray({x:p.x+dx*3,y:surface+.4,z:p.z+dz*3},{x:p.x-dx*3,y:surface+.4,z:p.z-dz*3}),'surface car meets the concrete parapet above the open trench');
  const a=tunnelPointAt(road,station-3),b=tunnelPointAt(road,station+3);
  assert.equal(ray({...a,y:a.y+1},{...b,y:b.y+1}),null,'concrete retaining face leaves the vehicle passage open');
});

test('North Street ramp can continue through its source endpoint onto the surface street',()=>{
  const road=find('government-center-north-off'),total=tunnelStations(road).at(-1),p=tunnelPointAt(road,total),a=tunnelPointAt(road,total-5),b={x:p.x+Math.sin(p.yaw)*5,z:p.z+Math.cos(p.yaw)*5};
  for(const across of [-.9,0,.9])for(const rise of [.4,1,1.6]){
    const dx=Math.cos(p.yaw)*across,dz=-Math.sin(p.yaw)*across;
    assert.equal(ray({x:a.x+dx,y:a.y+rise,z:a.z+dz},{x:b.x+dx,y:sampleElevation(city,b.x,b.z)+rise,z:b.z+dz}),null,'the full car envelope clears the adjoining ramp wall at the actual surface arrival');
  }
});


test('every covered tunnel and ramp keeps an overhead shell across the drivable ribbon',()=>{
  let checks=0;
  for(const road of roads){
    const total=tunnelStations(road).at(-1);
    for(let s=3;s<total-3;s+=3)if(tunnelCoveredAt(road,s))for(const fraction of [-.8,-.4,0,.4,.8]){
      const p=tunnelPointAt(road,s),x=p.x+Math.cos(p.yaw)*p.width/2*fraction,z=p.z-Math.sin(p.yaw)*p.width/2*fraction,y=sampleRoadElevation(city,road,x,z)+1;
      assert.ok(ray({x,y,z},{x,y:y+12,z}),`${road.id} missing roof at ${s}, offset ${fraction}`);checks++;
    }
  }
  assert.ok(checks>10000,'check the full source network, not just its centerlines');
});

// Find where a horizontal ray first leaves the union of actual drivable
// ribbon triangles. This catches a side-wall seam that an upward roof ray or
// centerline driving test cannot see, without depending on shell-cut helpers.
function intervalInDeck(origin,direction,vertices,clearance){
  let lo=0,hi=30;const [a,b,c]=vertices,dx1=b[0]-a[0],dz1=b[2]-a[2],dx2=c[0]-a[0],dz2=c[2]-a[2],det=dx1*dz2-dz1*dx2;if(Math.abs(det)<1e-8)return;
  const gx=((b[1]-a[1])*dz2-(c[1]-a[1])*dz1)/det,gz=(dx1*(c[1]-a[1])-dx2*(b[1]-a[1]))/det;
  const clip=(value,rate)=>{if(Math.abs(rate)<1e-9)return value>=-1e-7;const t=-value/rate;if(rate>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);return hi>=lo;};
  for(let i=0;i<3;i++){const p=vertices[i],q=vertices[(i+1)%3],dx=q[0]-p[0],dz=q[2]-p[2],sign=Math.sign(det);if(!clip(sign*(dx*(origin.z-p[2])-dz*(origin.x-p[0])),sign*(dx*direction.z-dz*direction.x)))return;}
  const height=origin.y-a[1]-gx*(origin.x-a[0])-gz*(origin.z-a[2]),rate=-gx*direction.x-gz*direction.z;
  if(!clip(height,rate)||!clip(clearance-height,-rate))return;return[lo,hi];
}

test('the reported Haymarket wall corner is sealed from every angle inside the chamber',async()=>{
  const {roadDeckGeometry}=await import('../src/simulation/road-surfaces.ts'),origin={x:1366.54,y:-5.5,z:-1539.914},triangles=[];
  for(const road of roads){
    const mesh=roadDeckGeometry(city,road);
    for(let i=0;i<mesh.indices.length;i+=3){const vertices=[0,1,2].map(j=>Array.from(mesh.vertices.slice(mesh.indices[i+j]*3,mesh.indices[i+j]*3+3)));
      if(vertices.every(p=>p[0]<origin.x-32)||vertices.every(p=>p[0]>origin.x+32)||vertices.every(p=>p[2]<origin.z-32)||vertices.every(p=>p[2]>origin.z+32))continue;
      triangles.push({vertices,clearance:road.tunnel.clearance});
    }
  }
  let checked=0;
  for(let angle=0;angle<Math.PI*2;angle+=.002){
    const direction={x:Math.sin(angle),y:0,z:Math.cos(angle)},intervals=triangles.map(t=>intervalInDeck(origin,direction,t.vertices,t.clearance)).filter(Boolean).sort((a,b)=>a[0]-b[0]);let exit=0;
    for(const [lo,hi]of intervals){if(lo>exit+.001)break;exit=Math.max(exit,hi);}
    if(exit<=0||exit>25)continue;
    assert.ok(world.castRay(new RAPIER.Ray(origin,direction),exit+.5,true),`wall seam at angle ${angle}, expected boundary ${exit}m away`);checked++;
  }
  assert.ok(checked>2000,'test sideways enclosure from thousands of viewing angles');
});
