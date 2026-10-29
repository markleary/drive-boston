import * as THREE from 'three';
import type {CityData} from '../types';
import {planTrafficSignals} from '../simulation/signal-placement.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {sampleRoadElevation} from '../simulation/road-surfaces.ts';
import {signalAxis,signalPhase} from '../simulation/signals.ts';
import {mergeSpatialGeometries} from './spatial-batches.ts';

let shared:{iron:THREE.Material;back:THREE.Material;rim:THREE.Material;lenses:THREE.MeshStandardMaterial[][]}|undefined;
/** One set of lens materials drives every signal head, whichever tile built it. */
function signalMaterials(){
  shared??={iron:new THREE.MeshStandardMaterial({color:'#33443c',roughness:.58,metalness:.38}),back:new THREE.MeshStandardMaterial({color:'#222b29',roughness:.62}),rim:new THREE.MeshStandardMaterial({color:'#b5a46b',roughness:.64,metalness:.2}),
    lenses:[0,1].map(()=>[new THREE.MeshStandardMaterial({color:'#6c2926',emissive:'#ff3427',emissiveIntensity:.02,roughness:.24}),new THREE.MeshStandardMaterial({color:'#5b4824',emissive:'#ffb833',emissiveIntensity:.02,roughness:.25}),new THREE.MeshStandardMaterial({color:'#275344',emissive:'#70ffb4',emissiveIntensity:.02,roughness:.24})])};
  return shared;
}
export function updateTrafficSignals(time:number){const {lenses}=signalMaterials();for(let axis=0;axis<2;axis++){const phase=signalPhase(time,axis?Math.PI/2:0);lenses[axis].forEach((m,i)=>m.emissiveIntensity=(i===0&&phase==='red'||i===1&&phase==='amber'||i===2&&phase==='green')?3.2:.015);}}
export function createTrafficSignals(scene:THREE.Object3D,city:CityData,placements=planTrafficSignals(city)){
  const group=new THREE.Group();group.name='Curbside traffic signals';scene.add(group);
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const {iron,back,rim,lenses}=signalMaterials();
  const add=(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,yaw=0)=>{g.rotateY(yaw).translate(x,y,z);const batch=batches.get(m)??[];batch.push(g);batches.set(m,batch);};
  for(const signal of placements){
    const[x,z]=signal.position,footing=sampleElevation(city,x,z),y=signal.road.elevations?Math.max(footing,sampleRoadElevation(city,signal.road,...signal.roadPoint)):footing,nx=Math.sin(signal.armYaw),nz=Math.cos(signal.armYaw),length=signal.armLength;
    const mastHeight=y+5.65-footing;
    add(new THREE.CylinderGeometry(.085,.14,mastHeight,10),iron,x,footing+mastHeight/2,z);
    add(new THREE.CylinderGeometry(.21,.26,.18,10),iron,x,footing+.09,z);
    add(new THREE.CylinderGeometry(.065,.085,length,8).rotateX(Math.PI/2),iron,x+nx*length*.5,y+5.5,z+nz*length*.5,signal.armYaw);
    for(const side of [0,1]){
      const sx=x+nx*(length-.35-side*.9),sz=z+nz*(length-.35-side*.9),yaw=signal.yaw+side*Math.PI,axis=signalAxis(yaw);
      add(new THREE.BoxGeometry(.65,1.52,.08),rim,sx,y+4.94,sz,yaw);
      add(new THREE.BoxGeometry(.53,1.39,.27),back,sx,y+4.94,sz,yaw);
      for(let bulb=0;bulb<3;bulb++){
        const by=y+5.37-bulb*.43,fx=Math.sin(yaw),fz=Math.cos(yaw);
        add(new THREE.CircleGeometry(.146,18),back,sx+fx*.145,by,sz+fz*.145,yaw);
        add(new THREE.CircleGeometry(.12,18),lenses[axis][bulb],sx+fx*.151,by,sz+fz*.151,yaw);
        add(new THREE.CylinderGeometry(.157,.157,.20,12,1,true,0,Math.PI).rotateX(Math.PI/2),back,sx+fx*.23,by+.025,sz+fz*.23,yaw);
      }
    }
    // A compact pedestrian signal box at the curb makes the pole's location
    // legible from the driver's seat without adding more street furniture.
    add(new THREE.BoxGeometry(.36,.43,.25),back,x,y+2.55,z,signal.yaw);
  }
  for(const[m,gs]of batches)for(const mesh of mergeSpatialGeometries(gs,m)){mesh.castShadow=m===iron||m===back;mesh.receiveShadow=true;group.add(mesh);}
  const update=updateTrafficSignals;
  update(0);group.userData.count=placements.length;return{group,placements,update};
}
