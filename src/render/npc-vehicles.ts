import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createNPCPlateAtlas} from './npc-license-plates.ts';
import {NPC_VEHICLES,type NPCVehicleType} from '../simulation/npc-vehicle-specs.ts';

type Detail='near'|'far';
type Surface='paint'|'black'|'rubber'|'chrome'|'rim'|'darkRim'|'glass'|'lamp'|'red'|'amber'|'white'|'seam'|'box'|'registration';
let templates:Map<string,Map<Surface,THREE.BufferGeometry>>|undefined;
const sharedBuffers=new Map<string,{geometry:THREE.BufferGeometry;owners:number}>();
/** Parse once before constructing traffic/street life; retained CPU geometry
 * also rebuilds the GPU batches after a WebGL context recovery. */
export async function prepareNPCVehicles(data:ArrayBuffer){
  if(templates)return;
  const gltf=await new GLTFLoader().parseAsync(data,'');
  const prepared=new Map<string,Map<Surface,THREE.BufferGeometry>>();
  for(const spec of NPC_VEHICLES)for(const detail of ['near','far'] as const){
    const root=gltf.scene.getObjectByName(`${spec.type}-${detail}`);if(!root)throw new Error(`Missing NPC model ${spec.type}-${detail}`);
    const surfaces=new Map<Surface,THREE.BufferGeometry>();
    root.traverse(object=>{if(object instanceof THREE.Mesh){const material=object.material as THREE.Material;surfaces.set(material.name as Surface,object.geometry);material.dispose();}});
    if(!surfaces.has('paint')||!surfaces.has('registration'))throw new Error(`Incomplete NPC model ${spec.type}-${detail}`);
    prepared.set(`${spec.type}-${detail}`,surfaces);
  }
  templates=prepared;
}
function vehicleMaterials(){
  const standard=(color:number,roughness=.5,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide});
  return {
    paint:new THREE.MeshPhysicalMaterial({color:0xffffff,metalness:.28,roughness:.26,clearcoat:.75,clearcoatRoughness:.19,side:THREE.DoubleSide}),
    black:standard(0x151b1e,.48,.24),rubber:standard(0x171a1b,.94),chrome:standard(0xb8bec0,.21,.9),rim:standard(0x9fa7af,.28,.78),darkRim:standard(0x3e454c,.38,.62),
    glass:new THREE.MeshPhysicalMaterial({color:0x142b35,metalness:.36,roughness:.11,clearcoat:1,clearcoatRoughness:.09,side:THREE.DoubleSide}),
    lamp:new THREE.MeshStandardMaterial({color:0xdde5df,emissive:0xffedce,emissiveIntensity:.45,roughness:.2,side:THREE.DoubleSide}),
    red:new THREE.MeshStandardMaterial({color:0x8e1d16,emissive:0xe5281d,emissiveIntensity:.35,roughness:.27,metalness:.15,side:THREE.DoubleSide}),
    amber:standard(0xb0651d,.3),white:standard(0xe4e6dd),seam:standard(0x26323a,.65),box:standard(0xe5e5dc,.57,.12),registration:new THREE.MeshStandardMaterial({color:0xffffff,roughness:.49,metalness:.04}),
  } satisfies Record<Surface,THREE.MeshStandardMaterial>;
}

/** One batch per material/LOD, with all five silhouettes in each batch. Actor
 * instance IDs remain independent of model and LOD, including sparse surfaces. */
export function createNPCVehicleBatches(parent:THREE.Group,capacity:number){
  if(!templates)throw new Error('Prepare NPC vehicle assets before creating traffic');
  const materials=vehicleMaterials();
  const plates=createNPCPlateAtlas(capacity);materials.registration.map=plates.texture;
  const batches:{mesh:THREE.BatchedMesh;surface:Surface;detail:Detail;shapes:Map<NPCVehicleType,number>;instances:number[];sharedKey:string|null}[]=[];
  for(const detail of ['near','far'] as const)for(const surface of Object.keys(materials) as Surface[]){
    const geometries=NPC_VEHICLES.flatMap(spec=>{const g=templates!.get(`${spec.type}-${detail}`)!.get(surface);return g?[{type:spec.type,g}]:[];});
    if(!geometries.length)continue;
    const vertices=surface==='registration'?capacity*Math.max(...geometries.map(p=>p.g.attributes.position.count)):geometries.reduce((n,p)=>n+p.g.attributes.position.count,0),indices=surface==='registration'?capacity*Math.max(...geometries.map(p=>p.g.index?.count??0)):geometries.reduce((n,p)=>n+(p.g.index?.count??0),0);
    const mesh=new THREE.BatchedMesh(capacity,vertices,indices,materials[surface]);mesh.name=`NPC ${detail} ${surface}`;mesh.castShadow=true;mesh.receiveShadow=false;
    const shapes=new Map<NPCVehicleType,number>();if(surface!=='registration')for(const {type,g} of geometries)shapes.set(type,mesh.addGeometry(g));
    // Both pools contain the same immutable model buffers in the same order.
    // Share those GPU buffers; instance transforms/colors and plate UVs remain
    // private. BatchedMesh.dispose assumes sole ownership, handled below.
    const sharedKey=surface==='registration'?null:`${detail}-${surface}`;
    if(sharedKey){const shared=sharedBuffers.get(sharedKey);if(shared){mesh.geometry.dispose();mesh.geometry=shared.geometry;shared.owners++;}else sharedBuffers.set(sharedKey,{geometry:mesh.geometry,owners:1});}
    parent.add(mesh);batches.push({mesh,surface,detail,shapes,instances:Array(capacity).fill(-1),sharedKey});
  }
  const details:Detail[]=Array(capacity).fill('near');
  return {
    bind(index:number,type:NPCVehicleType){plates.assign(index);for(const batch of batches){let shape=batch.shapes.get(type);if(batch.surface==='registration'){const source=templates!.get(`${type}-${batch.detail}`)!.get('registration')!;const geometry=plates.geometry(source,index);shape=batch.mesh.addGeometry(geometry);geometry.dispose();}if(shape!==undefined){const id=batch.mesh.addInstance(shape);batch.instances[index]=id;batch.mesh.setVisibleAt(id,false);}}},
    registration:plates.number,
    draw(index:number,matrix:THREE.Matrix4,color:THREE.Color,distance:number){
      details[index]=distance>(details[index]==='near'?110:90)?'far':'near';
      for(const batch of batches){const id=batch.instances[index];if(id<0)continue;const visible=batch.detail===details[index];batch.mesh.setVisibleAt(id,visible);batch.mesh.setMatrixAt(id,matrix);if(!visible)continue;if(batch.surface==='paint')batch.mesh.setColorAt(id,color);}
    },
    flush(){for(const batch of batches)batch.mesh.computeBoundingSphere();},
    setNight(night:boolean){materials.lamp.emissiveIntensity=night?2.5:.45;materials.red.emissiveIntensity=night?1.5:.35;materials.amber.emissive.setHex(night?0xd37817:0);materials.amber.emissiveIntensity=night?.4:.12;},
    dispose(){for(const batch of batches){parent.remove(batch.mesh);if(batch.sharedKey){const shared=sharedBuffers.get(batch.sharedKey)!;if(--shared.owners)batch.mesh.geometry=new THREE.BufferGeometry();else sharedBuffers.delete(batch.sharedKey);}batch.mesh.dispose();}plates.dispose();Object.values(materials).forEach(m=>m.dispose());},
  };
}
