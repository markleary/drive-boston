import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createNPCPlateAtlas} from './npc-license-plates.ts';
import {NPC_VEHICLES,type NPCVehicleType} from '../simulation/npc-vehicle-specs.ts';

type Detail='near'|'far';
type Surface='paint'|'black'|'rubber'|'chrome'|'rim'|'darkRim'|'glass'|'lamp'|'red'|'amber'|'white'|'seam'|'box'|'registration';
type Surfaces=Map<Surface,THREE.BufferGeometry>;
interface VehicleParts {body:Surfaces;wheels:{pivot:THREE.Vector3;surfaces:Surfaces}[];}
let templates:Map<string,VehicleParts>|undefined;
const sharedBuffers=new Map<string,{geometry:THREE.BufferGeometry;owners:number}>();
/** Parse once before constructing traffic/street life; retained CPU geometry
 * also rebuilds the GPU batches after a WebGL context recovery. */
export async function prepareNPCVehicles(data:ArrayBuffer){
  if(templates)return;
  const gltf=await new GLTFLoader().parseAsync(data,'');
  const prepared=new Map<string,VehicleParts>();
  const read=(objects:THREE.Object3D[])=>{const surfaces:Surfaces=new Map();for(const object of objects)if(object instanceof THREE.Mesh){const material=object.material as THREE.Material;surfaces.set(material.name as Surface,object.geometry);material.dispose();}return surfaces;};
  for(const spec of NPC_VEHICLES)for(const detail of ['near','far'] as const){
    const root=gltf.scene.getObjectByName(`${spec.type}-${detail}`);if(!root)throw new Error(`Missing NPC model ${spec.type}-${detail}`);
    const body=read(root.children),wheels=Array.from({length:4},(_,i)=>{const node=root.children.find(o=>o.userData.npcWheel===i);if(!node)throw new Error(`Missing ${spec.type} wheel ${i}`);return{pivot:node.position.clone(),surfaces:read(node.children)};});
    if(!body.has('paint')||!body.has('registration'))throw new Error(`Incomplete NPC model ${spec.type}-${detail}`);
    prepared.set(`${spec.type}-${detail}`,{body,wheels});
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

/** Body and four local wheel pivots share each material/LOD batch. This keeps
 * spinning tires and steering on all silhouettes without a draw call per wheel. */
export function createNPCVehicleBatches(parent:THREE.Group,capacity:number){
  if(!templates)throw new Error('Prepare NPC vehicle assets before creating traffic');
  const materials=vehicleMaterials();
  const plates=createNPCPlateAtlas(capacity);materials.registration.map=plates.texture;
  const batches:{mesh:THREE.BatchedMesh;surface:Surface;detail:Detail;shapes:Map<string,number>;instances:number[][];sharedKey:string|null}[]=[];
  for(const detail of ['near','far'] as const)for(const surface of Object.keys(materials) as Surface[]){
    const geometries=NPC_VEHICLES.flatMap(spec=>{const parts=templates!.get(`${spec.type}-${detail}`)!;return[parts.body,...parts.wheels.map(w=>w.surfaces)].flatMap((part,i)=>{const g=part.get(surface);return g?[{key:`${spec.type}:${i}`,g}]:[];});});
    if(!geometries.length)continue;
    const vertices=surface==='registration'?capacity*Math.max(...geometries.map(p=>p.g.attributes.position.count)):geometries.reduce((n,p)=>n+p.g.attributes.position.count,0),indices=surface==='registration'?capacity*Math.max(...geometries.map(p=>p.g.index?.count??0)):geometries.reduce((n,p)=>n+(p.g.index?.count??0),0);
    const mesh=new THREE.BatchedMesh(capacity*(surface==='registration'?1:5),vertices,indices,materials[surface]);mesh.name=`NPC ${detail} ${surface}`;mesh.castShadow=true;mesh.receiveShadow=false;
    const shapes=new Map<string,number>();if(surface!=='registration')for(const {key,g} of geometries)shapes.set(key,mesh.addGeometry(g));
    // Both pools contain the same immutable model buffers in the same order.
    // Instance transforms/colors and plate UVs remain private.
    const sharedKey=surface==='registration'?null:`${detail}-${surface}`;
    if(sharedKey){const shared=sharedBuffers.get(sharedKey);if(shared){mesh.geometry.dispose();mesh.geometry=shared.geometry;shared.owners++;}else sharedBuffers.set(sharedKey,{geometry:mesh.geometry,owners:1});}
    const instances=Array.from({length:capacity},()=>Array(5).fill(-1));mesh.userData.npcInstances=instances;
    parent.add(mesh);batches.push({mesh,surface,detail,shapes,instances,sharedKey});
  }
  const details:Detail[]=Array(capacity).fill('near'),types:NPCVehicleType[]=[],angles=Array(capacity).fill(0),previous:(THREE.Vector3|undefined)[]=Array(capacity),wheelMatrices=Array.from({length:4},()=>new THREE.Matrix4()),spin=new THREE.Matrix4(),steer=new THREE.Matrix4(),point=new THREE.Vector3();
  return {
    bind(index:number,type:NPCVehicleType){types[index]=type;plates.assign(index);for(const batch of batches)for(let part=0;part<5;part++){let shape=batch.shapes.get(`${type}:${part}`);if(batch.surface==='registration'&&part===0){const source=templates!.get(`${type}-${batch.detail}`)!.body.get('registration')!;const geometry=plates.geometry(source,index);shape=batch.mesh.addGeometry(geometry);geometry.dispose();}if(shape!==undefined){const id=batch.mesh.addInstance(shape);batch.instances[index][part]=id;batch.mesh.setVisibleAt(id,false);}}},
    registration:plates.number,
    draw(index:number,matrix:THREE.Matrix4,color:THREE.Color,distance:number,steering=0){
      const spec=NPC_VEHICLES.find(s=>s.type===types[index])!,e=matrix.elements,last=previous[index];point.setFromMatrixPosition(matrix);
      // Signed displacement handles reverse motion and struck/parked cars too.
      // Teleports do not wind the wheels through an entire map journey.
      if(last&&point.distanceToSquared(last)<25)angles[index]=(angles[index]+((point.x-last.x)*e[8]+(point.y-last.y)*e[9]+(point.z-last.z)*e[10])/spec.wheelRadius)%(Math.PI*2);
      if(last)last.copy(point);else previous[index]=point.clone();
      const parts=templates!.get(`${spec.type}-near`)!;spin.makeRotationX(angles[index]);steer.makeRotationY(steering);
      for(let wheel=0;wheel<4;wheel++){const m=wheelMatrices[wheel].makeTranslation(parts.wheels[wheel].pivot);if(wheel<2)m.multiply(steer);m.multiply(spin).premultiply(matrix);}
      details[index]=distance>(details[index]==='near'?110:90)?'far':'near';
      for(const batch of batches)for(let part=0;part<5;part++){const id=batch.instances[index][part];if(id<0)continue;const visible=batch.detail===details[index];batch.mesh.setVisibleAt(id,visible);batch.mesh.setMatrixAt(id,part?wheelMatrices[part-1]:matrix);if(visible&&batch.surface==='paint')batch.mesh.setColorAt(id,color);}
    },
    flush(){for(const batch of batches)batch.mesh.computeBoundingSphere();},
    setNight(night:boolean){materials.lamp.emissiveIntensity=night?2.5:.45;materials.red.emissiveIntensity=night?1.5:.35;materials.amber.emissive.setHex(night?0xd37817:0);materials.amber.emissiveIntensity=night?.4:.12;},
    dispose(){for(const batch of batches){parent.remove(batch.mesh);if(batch.sharedKey){const shared=sharedBuffers.get(batch.sharedKey)!;if(--shared.owners)batch.mesh.geometry=new THREE.BufferGeometry();else sharedBuffers.delete(batch.sharedKey);}batch.mesh.dispose();}plates.dispose();Object.values(materials).forEach(m=>m.dispose());},
  };
}
