import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type {CityData} from '../types';
import type {DrivingPhysics} from '../physics/vehicle';
import {createConstructionAssets} from '../render/construction.ts';
import {constructionPoint,constructionLocal,type ConstructionZone} from './construction-zones.ts';
import {roadRotation,sampleRoadElevation} from './road-surfaces.ts';

type Position={x:number;z:number};
interface Cone {body:RAPIER.RigidBody;index:number;}
interface Site {zone:ConstructionZone;group:THREE.Group;bodies:RAPIER.RigidBody[];cones:Cone[];coneBatches:THREE.InstancedMesh[];}

/** Cone centres, including both tapers. The inner edge leaves the other lane open. */
export function constructionCones(zone:ConstructionZone){
  const points:{along:number;offset:number}[]=[],half=zone.workLength/2,inner=zone.laneOffset-1.5,curb=zone.pavedWidth/2-.35;
  const taperSteps=Math.ceil(zone.taperLength/3),workSteps=Math.ceil(zone.workLength/3);
  for(let i=0;i<=taperSteps;i++){
    const t=i/taperSteps;
    points.push({along:-half-zone.taperLength+t*zone.taperLength,offset:curb+(inner-curb)*t});
    points.push({along:half+t*zone.taperLength,offset:inner+(curb-inner)*t});
  }
  for(let i=1;i<workSteps;i++)points.push({along:-half+zone.workLength*i/workSteps,offset:inner});
  return points;
}

/** Only nearby, supported sites own meshes and Rapier objects. The city-wide
 * plan stays constant for the session, so NPC routes and streamed sites agree. */
export function createConstruction(scene:THREE.Scene,city:CityData,physics:DrivingPhysics,zones:readonly ConstructionZone[],options:{hasGround?:(x:number,z:number)=>boolean}={}){
  const group=new THREE.Group();group.name='RoadConstruction';scene.add(group);
  const assets=createConstructionAssets(),active=new Map<string,Site>(),colliders=new Set<number>(),equipmentColliders=new Set<number>();
  const coneTransform=new THREE.Object3D(),hiddenMatrix=new THREE.Matrix4().makeScale(0,0,0);
  const supported=(x:number,z:number)=>options.hasGround?.(x,z)??true;
  const point=(zone:ConstructionZone,along:number,offset:number)=>{
    const p=constructionPoint(zone,along,offset);
    return {x:p[0],y:sampleRoadElevation(city,zone.road,p[0],p[1])+.025,z:p[1]};
  };
  function remove(site:Site){
    for(const body of site.bodies){for(let i=0;i<body.numColliders();i++){const handle=body.collider(i).handle;colliders.delete(handle);equipmentColliders.delete(handle);physics.detailedColliders.delete(handle);}physics.world.removeRigidBody(body);}
    for(const batch of site.coneBatches)batch.dispose();
    group.remove(site.group);active.delete(site.zone.id);
  }
  function add(zone:ConstructionZone){
    const site:Site={zone,group:new THREE.Group(),bodies:[],cones:[],coneBatches:[]};site.group.name=zone.id;group.add(site.group);
    const rigid=(position:{x:number;y:number;z:number},dynamic=false)=>{
      const q=roadRotation(city,zone.road,position.x,position.z,constructionLocal(zone,position.x,position.z).yaw);
      const desc=dynamic?RAPIER.RigidBodyDesc.dynamic().setLinearDamping(.3).setAngularDamping(.65).setCcdEnabled(true):RAPIER.RigidBodyDesc.fixed();
      const body=physics.world.createRigidBody(desc.setTranslation(position.x,position.y,position.z).setRotation(q));site.bodies.push(body);return body;
    };
    const attach=(body:RAPIER.RigidBody,desc:RAPIER.ColliderDesc,detailed=false)=>{
      const collider=physics.world.createCollider(desc,body);colliders.add(collider.handle);if(detailed){physics.detailedColliders.add(collider.handle);equipmentColliders.add(collider.handle);}
    };
    // Parked heavy equipment stays put, like the transit fleet. Separate chassis,
    // cab and equipment boxes leave the visible space above/below it open.
    const position=point(zone,0,zone.laneOffset),truck=rigid(position),model=assets.vehicle(zone.vehicleKind);
    model.position.set(position.x,position.y,position.z);const tq=truck.rotation();model.quaternion.set(tq.x,tq.y,tq.z,tq.w);site.group.add(model);
    if(zone.vehicleKind==='dump-truck'){
      attach(truck,RAPIER.ColliderDesc.cuboid(1.24,.48,3.38).setTranslation(0,.72,0).setFriction(.8).setRestitution(.05),true);
      attach(truck,RAPIER.ColliderDesc.cuboid(1.12,.87,.77).setTranslation(0,2.08,1.55).setFriction(.65),true);
      attach(truck,RAPIER.ColliderDesc.cuboid(.99,.29,.53).setTranslation(0,1.65,2.78).setFriction(.65),true);
      attach(truck,RAPIER.ColliderDesc.cuboid(1.2,.55,1.95).setTranslation(0,1.75,-1.24).setFriction(.65),true);
    }else{
      attach(truck,RAPIER.ColliderDesc.cuboid(1.225,.37,1.65).setTranslation(0,.43,-.48).setFriction(.8).setRestitution(.05),true);
      attach(truck,RAPIER.ColliderDesc.cuboid(1.08,.44,1.3).setTranslation(0,1.28,-.59).setFriction(.65),true);
      attach(truck,RAPIER.ColliderDesc.cuboid(.52,.64,.69).setTranslation(.49,2.12,-.48).setFriction(.65),true);
      const arm=(a:THREE.Vector3,b:THREE.Vector3,width:number,depth:number)=>{
        const mid=a.clone().add(b).multiplyScalar(.5),rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());
        attach(truck,RAPIER.ColliderDesc.cuboid(width/2,a.distanceTo(b)/2,depth/2).setTranslation(mid.x,mid.y,mid.z).setRotation(rotation).setFriction(.65),true);
      };
      const a=new THREE.Vector3(-.43,1.48,.20),b=new THREE.Vector3(-.43,2.48,1.12),c=new THREE.Vector3(-.43,1.37,2.48),d=new THREE.Vector3(-.43,.42,2.73);
      arm(a,b,.40,.46);arm(b,c,.33,.38);arm(c,d,.28,.31);
      attach(truck,RAPIER.ColliderDesc.cuboid(.45,.27,.44).setTranslation(-.43,.34,2.78).setFriction(.8),true);
    }
    const signPosition=point(zone,-zone.workLength/2+2,zone.laneOffset),signBody=rigid(signPosition),sign=assets.sign();
    sign.position.set(signPosition.x,signPosition.y,signPosition.z);const sq=signBody.rotation();sign.quaternion.set(sq.x,sq.y,sq.z,sq.w);site.group.add(sign);
    attach(signBody,RAPIER.ColliderDesc.cuboid(.4,.04,.29).setTranslation(0,.04,0).setFriction(.7),true);
    attach(signBody,RAPIER.ColliderDesc.cylinder(1.02,.03).setTranslation(0,1.09,0).setFriction(.7),true);
    attach(signBody,RAPIER.ColliderDesc.cuboid(.505,.505,.04).setTranslation(0,2.12,0).setRotation({x:0,y:0,z:Math.sin(Math.PI/8),w:Math.cos(Math.PI/8)}).setFriction(.7),true);
    attach(signBody,RAPIER.ColliderDesc.cuboid(.565,.20,.06).setTranslation(0,1.18,-.025).setFriction(.7),true);
    const conePoints=constructionCones(zone),conePrototype=assets.cone();
    for(const mesh of conePrototype.children)if(mesh instanceof THREE.Mesh){
      const batch=new THREE.InstancedMesh(mesh.geometry,mesh.material,conePoints.length);batch.name=`${zone.id} ${mesh.name}`;
      batch.castShadow=true;batch.receiveShadow=true;batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);batch.frustumCulled=false;site.group.add(batch);site.coneBatches.push(batch);
    }
    for(const [index,{along,offset}] of conePoints.entries()){
      const p=point(zone,along,offset),body=rigid(p,true);
      attach(body,RAPIER.ColliderDesc.cuboid(.23,.03,.23).setTranslation(0,.03,0).setMass(3.2).setFriction(.9).setRestitution(.05));
      attach(body,RAPIER.ColliderDesc.cone(.31,.184).setTranslation(0,.405,0).setMass(.8).setFriction(.55).setRestitution(.1));
      body.sleep();site.cones.push({body,index});
    }
    active.set(zone.id,site);
  }
  const zoneSupported=(zone:ConstructionZone)=>[-zone.length/2,0,zone.length/2].every(along=>[-zone.pavedWidth/2,zone.pavedWidth/2].every(offset=>{const p=constructionPoint(zone,along,offset);return supported(p[0],p[1]);}));
  function update(observer:Position,player:Position=observer){
    const range=(zone:ConstructionZone)=>Math.min(Math.hypot(zone.x-observer.x,zone.z-observer.z),Math.hypot(zone.x-player.x,zone.z-player.z));
    const wanted=zones.filter(zone=>range(zone)<(active.has(zone.id)?760:620)&&zoneSupported(zone)).sort((a,b)=>range(a)-range(b)).slice(0,8),ids=new Set(wanted.map(zone=>zone.id));
    for(const site of active.values())if(!ids.has(site.zone.id))remove(site);
    for(const zone of wanted)if(!active.has(zone.id)){
      const {along,offset}=constructionLocal(zone,player.x,player.z);
      // A new randomized session or map arrival may put the player inside a
      // planned worksite. Wait until its closed lane is free before creating it.
      if(Math.abs(along)<zone.length/2+4&&Math.abs(offset-zone.laneOffset)<2.8)continue;
      add(zone);
    }
    for(const site of active.values()){
      for(const cone of site.cones){
      const p=cone.body.translation();
      // A kicked cone must not fall forever after its supporting tile leaves.
      const enabled=supported(p.x,p.z)&&p.y>sampleRoadElevation(city,site.zone.road,p.x,p.z)-5;
      if(cone.body.isEnabled()!==enabled)cone.body.setEnabled(enabled);
      coneTransform.position.set(p.x,p.y,p.z);const q=cone.body.rotation();coneTransform.quaternion.set(q.x,q.y,q.z,q.w);coneTransform.updateMatrix();
      for(const batch of site.coneBatches)batch.setMatrixAt(cone.index,enabled?coneTransform.matrix:hiddenMatrix);
      }
      for(const batch of site.coneBatches)batch.instanceMatrix.needsUpdate=true;
    }
  }
  return {group,zones,colliders,equipmentColliders,update,
    snapshot:()=>({planned:zones.length,active:active.size,cones:[...active.values()].reduce((sum,site)=>sum+site.cones.length,0),sites:zones.map(zone=>({id:zone.id,roadId:zone.roadId,road:zone.road.name,x:zone.x,z:zone.z,yaw:zone.yaw,direction:zone.direction,pavedWidth:zone.pavedWidth,laneOffset:zone.laneOffset,openOffset:zone.openOffset,length:zone.length,vehicleKind:zone.vehicleKind,active:active.has(zone.id)}))}),
    dispose(){for(const site of active.values())remove(site);assets.dispose();scene.remove(group);},
  };
}
