import * as THREE from 'three';
import type { CityData, Point2 } from '../types';
import { sampleElevation } from '../simulation/terrain';
import { sourceWallSampler, type DetailOptions } from './facade-details';
import { PartBatches, box, type Part } from './geometry-writer';
import { drain, due } from './pacing';
import { architectureFor, prepareNeighborhoodArchitecture } from './neighborhood-profiles';
import { planPorchStairs, stairFootprint } from './porch-stairs.ts';
import { pointInside } from '../simulation/roads.ts';
import { otherBuildingHulls } from '../simulation/city-tiles.ts';
export { architectureFor, prepareNeighborhoodArchitecture } from './neighborhood-profiles';
let porchMaterials:{trim:THREE.Material;shadow:THREE.Material;deck:THREE.Material;door:THREE.Material}|undefined;

/** Three-floor architectural details attached to eligible measured house walls.
 * Porches occupy verified setbacks; existing source bay projections are retained. */
export function addNeighborhoodDetails(scene:THREE.Scene,city:CityData,options:DetailOptions={}){ return drain(neighborhoodDetailSteps(scene,city,options)); }
export function* neighborhoodDetailSteps(scene:THREE.Scene,city:CityData,options:DetailOptions={}):Generator<void,THREE.Group>{
  const buildings=options.buildings??city.buildings,stats=prepareNeighborhoodArchitecture(city,options.buildings),sampler=options.sampler??sourceWallSampler(scene),budget=options.budget??150,pace=options.pace;
  const group=new THREE.Group();group.name='Mission Hill triple-decker architecture';
  porchMaterials??={trim:new THREE.MeshStandardMaterial({color:'#dedfd2',roughness:.78}),shadow:new THREE.MeshStandardMaterial({color:'#75837a',roughness:.91}),deck:new THREE.MeshStandardMaterial({color:'#9d9e8f',roughness:.95}),door:new THREE.MeshStandardMaterial({color:'#354a43',roughness:.72})};
  const {trim,shadow,deck,door}=porchMaterials;
  const batches=new PartBatches(),matrix=new THREE.Matrix4();let porches=0,windows=0,cornices=0,sideStairs=0,porchSupports=0;
  const add=(g:Part,m:THREE.Material,x:number,y:number,z:number,yaw:number)=>{
    batches.part(g,m,matrix.makeRotationY(yaw).setPosition(x,y,z));
  };
  for(const building of buildings){
    if(due(pace))yield;
    const profile=architectureFor(building);if(profile?.kind!=='triple-decker')continue;
    const base=building.baseElevation??0,fh=profile.floorHeight;
    for(let e=0;e<building.footprint.length;e++){
      const a=building.footprint[e],b=building.footprint[(e+1)%building.footprint.length];
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<2.7)continue;
      const nx=dz/length,nz=-dx/length,tx=dx/length,tz=dz/length,yaw=Math.atan2(nx,nz),mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
      if(nx*profile.front.nx+nz*profile.front.nz<-.1)continue;
      const center=sampler.sample(mx,mz,nx,nz,base+profile.raisedBase+fh*.52);if(!center||Math.abs(center.depth)>.45)continue;
      const draw=(g:Part,m:THREE.Material,u:number,y:number,d=.12)=>add(g,m,mx+tx*u+nx*(center.depth+d),base+y,mz+tz*u+nz*(center.depth+d),yaw);
      // Trim stops at the surveyed wall: a hip or gable roof ends the facade
      // below three nominal floors and a lower wing shortens it near the top.
      const wall=(u:number,y:number)=>{const hit=sampler.sample(mx+tx*u,mz+tz*u,nx,nz,base+y);return !!hit&&Math.abs(hit.depth-center.depth)<.2;};
      const wallTop=(u:number,from:number,to:number)=>{let top=-Infinity;for(let y=from;y<=to+1e-6;y+=.15){if(!wall(u,y))break;top=y;}return top;};
      const start=Math.ceil((center.u-length/2+.85-1.5)/3),end=Math.floor((center.u+length/2-.85-1.5)/3);
      for(let column=start;column<=end;column++){
        const u=1.5+column*3-center.u;
        for(let floor=0;floor<3;floor++){
          const y=profile.raisedBase+fh*(floor+.52),h=1.86*fh/3;
          if(y+h/2+.22*fh/3>(building.eaveHeight??building.height))continue;
          const hits=[-.7,0,.7].map(offset=>sampler.sample(mx+tx*(u+offset),mz+tz*(u+offset),nx,nz,base+y));
          if(hits.some(hit=>!hit||Math.abs(hit.depth-center.depth)>.15)||wallTop(u,y,y+h/2+.3)<y+h/2+.15)continue;
          for(const side of [-1,1])draw(box(.11,h+.16,.15),trim,u+side*.68,y,.12);
          draw(box(1.58,.14,.26),trim,u,y+h/2+.13,.17);
          draw(box(1.63,.13,.34),trim,u,y-h/2-.08,.21);
          draw(box(1.47,.06,.18),shadow,u,y-h/2-.16,.14);windows++;
        }
      }
      const eave=wallTop(0,profile.raisedBase+3*fh-.4,Math.min(profile.raisedBase+3*fh+.5,building.eaveHeight??building.height)),corniceY=Math.min(profile.raisedBase+3*fh+.18,eave-.22);
      if(eave>-Infinity){
        const solid=(u:number)=>wall(u,corniceY+.2)&&wall(u,corniceY-.3);
        let u0=-length/2+.3,u1=length/2-.3;
        while(u0<u1&&!solid(u0))u0+=.75;while(u1>u0&&!solid(u1))u1-=.75;
        if(u1-u0>=1.5){
          const span=u1-u0+.4,mid=(u0+u1)/2;
          draw(box(span,.19,.28),trim,mid,corniceY,.14);
          draw(box(span+.12,.12,.46),trim,mid,corniceY+.16,.23);
          for(let u=u0+.1;u<u1;u+=.75)draw(box(.13,.3,.25),trim,u,corniceY-.19,.14);
          cornices++;
        }
      }
    }
    const {a,b,nx,nz,setback}=profile.front,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(setback<3.25||length<7||porches>=budget)continue;
    const tx=(b[0]-a[0])/length,tz=(b[1]-a[1])/length,yaw=Math.atan2(nx,nz);
    const width=Math.min(3.15,length*.38),u=length*.23;
    const x=(a[0]+b[0])/2+tx*u,z=(a[1]+b[1])/2+tz*u,depth=Math.min(1.72,setback-1.65);
    const probes=[-.9,0,.9].flatMap(offset=>[.8,fh+1,2*fh+1].map(y=>sampler.sample(x+tx*offset,z+tz*offset,nx,nz,base+profile.raisedBase+y)));
    if(probes.some(hit=>!hit||Math.abs(hit.depth)>.35))continue;
    const frontDepth=probes[1]!.depth;
    const neighbors=otherBuildingHulls(city,building,x,z,35);
    const stairs=planPorchStairs({origin:[x,z],tangent:[tx,tz],normal:[nx,nz],frontDepth,width,depth,frontage:length,along:u,setback,landingY:base+profile.raisedBase+.085},
      (x,z)=>sampleElevation(city,x,z),p=>!neighbors.some(other=>pointInside(p,other.footprint)));
    if(!stairs)continue;
    const draw=(g:Part,m:THREE.Material,along:number,y:number,d:number)=>add(g,m,x+tx*along+nx*(frontDepth+d),base+y,z+tz*along+nz*(frontDepth+d),yaw);
    for(let floor=0;floor<3;floor++){
      const y=profile.raisedBase+fh*floor;
      draw(box(width,.17,depth),deck,0,y,depth/2);
      draw(box(width+.08,.22,.17),trim,0,y-.05,depth);
      draw(box(1.04,2.12,.1),door,0,y+1.14,.07);
      for(const side of [-1,1])draw(box(.13,2.28,.17),trim,side*.59,y+1.16,.13);
      draw(box(1.35,.15,.2),trim,0,y+2.37,.14);
      for(const side of [-1,1]){
        draw(box(.14,fh-.16,.14),trim,side*(width/2-.11),y+fh/2,depth-.11);
        if(floor===0&&stairs.entry===(side===-1?'left':'right'))continue;
        for(let d=.22;d<depth;d+=.24)draw(box(.045,.79,.045),trim,side*(width/2-.08),y+.54,d);
        draw(box(.08,.09,depth),trim,side*(width/2-.08),y+.99,depth/2);
      }
      for(let u=-width/2+.22;u<width/2;u+=.24){if(floor===0&&stairs.entry==='front'&&Math.abs(u)<.65)continue;draw(box(.045,.79,.045),trim,u,y+.54,depth-.08);}
      if(floor>0||stairs.entry!=='front')draw(box(width,.09,.09),trim,0,y+.99,depth-.08);
      else for(const side of [-1,1])draw(box((width-1.3)/2,.09,.09),trim,side*(width+1.3)/4,y+.99,depth-.08);
      draw(box(width+.15,.14,depth+.1),trim,0,y+fh-.11,depth/2);
    }
    // Each footing reaches the terrain below its own footprint, including the
    // downhill side of a sloped yard. The raised bottom porch is never suspended.
    for(const side of [-1,1])for(const d of [.16,depth-.11]){
      const along=side*(width/2-.11),px=x+tx*along+nx*(frontDepth+d),pz=z+tz*along+nz*(frontDepth+d);
      const ground=Math.min(...stairFootprint([px,pz],[nx,nz],.36,.36).map(p=>sampleElevation(city,...p)))-.12;
      const top=base+profile.raisedBase-.085,footTop=Math.min(top,ground+.45);
      if(top<=ground)continue;
      add(box(.36,footTop-ground,.36),deck,px,(ground+footTop)/2,pz,yaw);
      if(top>footTop)add(box(.19,top-footTop,.19),trim,px,(footTop+top)/2,pz,yaw);
      porchSupports++;
    }
    const stairYaw=Math.atan2(stairs.direction[0],stairs.direction[1]);
    for(const step of [...stairs.steps,stairs.landing])add(box(step.width,step.top-step.bottom,step.depth),deck,step.center[0],(step.top+step.bottom)/2,step.center[1],stairYaw);
    const beam=(a:THREE.Vector3,b:THREE.Vector3)=>{
      const delta=b.clone().sub(a),g=new THREE.CylinderGeometry(.035,.035,delta.length(),6);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
      const center=a.clone().add(b).multiplyScalar(.5);add(g,trim,center.x,center.y,center.z,0);
    };
    for(const side of [-1,1]){
      const across:Point2=[stairs.direction[1]*side*(stairs.width/2-.07),-stairs.direction[0]*side*(stairs.width/2-.07)];
      let previous:THREE.Vector3|undefined;
      for(let i=0;i<=stairs.steps.length;i++){
        const distance=i===0?0:(i-.5)*.28,stepTop=i===0?base+profile.raisedBase+.085:stairs.steps[i-1].top;
        const p=new THREE.Vector3(stairs.start[0]+stairs.direction[0]*distance+across[0],stepTop+.9,stairs.start[1]+stairs.direction[1]*distance+across[1]);
        if(previous)beam(previous,p);
        if(i===0||i===stairs.steps.length||i%3===0)beam(p.clone().setY(stepTop),p);
        previous=p;
      }
    }
    if(stairs.entry!=='front')sideStairs++;
    porches++;
  }
  for(const mesh of batches.meshes()){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  group.userData={...stats,porches,windows,cornices,sideStairs,porchSupports,accuracy:'Inferred three-story wood typology on measured detached Mission Hill houses; decorative details are interpretive'};
  (options.target??scene).add(group);return group;
}
