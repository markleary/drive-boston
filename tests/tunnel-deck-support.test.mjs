import assert from 'node:assert/strict';
import test from 'node:test';
import {Ray} from '@dimforge/rapier3d-compat';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {roadDeckGeometry,roadNormal,sampleDriveSurface,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';

const road={id:'banked-merge',name:'Banked tunnel merge',width:10,oneway:1,points:[[0,0],[0,30],[15,60]],elevations:[-12,-10,-8],deckEdgeElevations:[[-11.6,-12.4],[-9.8,-10.2],[-8,-8]],tunnel:{clearance:5.2}};
const city={bounds:{minX:-50,maxX:70,minZ:-50,maxZ:100},roads:[road],buildings:[],spawn:{x:0,z:0,yaw:0}};

test('banked ramp support and normals match the physical triangles across the whole ribbon',async()=>{
  const geometry=roadDeckGeometry(city,road),physics=await DrivingPhysics.create(city);
  try{
    for(let i=0;i<geometry.indices.length;i+=3){
      const [a,b,c]=[0,1,2].map(j=>Array.from(geometry.vertices.slice(geometry.indices[i+j]*3,geometry.indices[i+j]*3+3)));
      for(const weights of [[.2,.3,.5],[.7,.2,.1],[.1,.8,.1]]){
        const point=a.map((_,axis)=>[a,b,c].reduce((sum,p,j)=>sum+p[axis]*weights[j],0)),[x,y,z]=point;
        assert.ok(Math.abs(sampleRoadElevation(city,road,x,z)-y)<1e-6,'support follows the ribbon plane, not the projected axis');
        const ray=physics.world.castRay(new Ray({x,y:y+1,z},{x:0,y:-1,z:0}),2,true,undefined,undefined,physics.chassisCollider,physics.body);
        assert.ok(ray&&Math.abs(ray.timeOfImpact-1)<1e-5,'Rapier shares the same banked floor');
        assert.ok(Math.abs(sampleDriveSurface(city,x,z,y+.7,road.id).height-y)<1e-6,'reset/saved-road height uses the physical floor');
        const n=roadNormal(city,road,x,z);
        for(const p of [b,c])assert.ok(Math.abs(n.x*(p[0]-a[0])+n.y*(p[1]-a[1])+n.z*(p[2]-a[2]))<1e-5,'reset orientation lies on the physical floor');
      }
    }
  }finally{physics.dispose();}
});

test('roads without explicit crossfall keep their original deck heights',()=>{
  const flat={...road,deckEdgeElevations:undefined},geometry=roadDeckGeometry(city,flat);
  for(let i=0;i<flat.points.length;i++)for(const side of [0,1])assert.ok(Math.abs(geometry.vertices[(i*2+side)*3+1]-flat.elevations[i])<1e-6);
});
