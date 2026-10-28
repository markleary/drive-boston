import * as THREE from 'three';
import { mergeSpatialGeometries } from './spatial-batches';
import type { CityData } from '../types';
import { pointInside } from '../simulation/roads';
import { hash, seeded } from './materials';
import { architectureFor } from './neighborhood-profiles';
import { isFenwayBuilding } from './fenway-park';

type RoofTriangle={a:THREE.Vector3;b:THREE.Vector3;c:THREE.Vector3};

/** Small original mechanical details placed on the actual surveyed roof surface.
 * A full clearance footprint must lie on a single flat level before placement. */
let roofMaterials:{shell:THREE.Material;dark:THREE.Material;metal:THREE.Material}|undefined;
export function addRooftopDetails(scene:THREE.Scene,city:CityData,options:{buildings?:CityData['buildings'];meshes?:THREE.Mesh[];budget?:number;target?:THREE.Object3D}={}){
  const grid=new Map<string,RoofTriangle[]>(),cell=12,budget=options.budget??300;
  if(!options.meshes)scene.updateMatrixWorld(true);
  const ab=new THREE.Vector3(),ac=new THREE.Vector3(),normal=new THREE.Vector3();
  const visit=(object:THREE.Object3D)=>{
    if(!(object instanceof THREE.Mesh)||object.name!=='Boston surveyed buildings')return;
    const p=object.geometry.getAttribute('position'),index=object.geometry.index;
    for(let i=0;i<(index?.count??p.count);i+=3){
      const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld));
      const [a,b,c]=points;normal.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).normalize();
      if(normal.y<.995||Math.min(a.y,b.y,c.y)<8)continue;
      const tri={a,b,c};
      for(let x=Math.floor(Math.min(a.x,b.x,c.x)/cell);x<=Math.floor(Math.max(a.x,b.x,c.x)/cell);x++)for(let z=Math.floor(Math.min(a.z,b.z,c.z)/cell);z<=Math.floor(Math.max(a.z,b.z,c.z)/cell);z++){
        const key=`${x},${z}`,list=grid.get(key)??[];list.push(tri);grid.set(key,list);
      }
    }
  };
  if(options.meshes)options.meshes.forEach(visit);else scene.traverse(visit);
  function roofHeight(x:number,z:number){
    let top=-Infinity;
    for(const {a,b,c} of grid.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)??[]){
      const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(den)<1e-8)continue;
      const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/den;
      const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/den,w=1-u-v;
      if(u>=-.0001&&v>=-.0001&&w>=-.0001)top=Math.max(top,u*a.y+v*b.y+w*c.y);
    }
    return top;
  }
  const group=new THREE.Group();group.name='Survey-aligned rooftop equipment';
  roofMaterials??={shell:new THREE.MeshStandardMaterial({color:'#b8bbb5',roughness:.72,metalness:.3}),dark:new THREE.MeshStandardMaterial({color:'#3f494a',roughness:.76,metalness:.38}),metal:new THREE.MeshStandardMaterial({color:'#828e8e',roughness:.55,metalness:.55})};
  const {shell,dark,metal}=roofMaterials;
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();let units=0;
  function add(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,yaw:number){
    geometry.rotateY(yaw).translate(x,y,z);const list=batches.get(material)??[];list.push(geometry);batches.set(material,list);
  }
  for(const building of [...(options.buildings??city.buildings)].sort((a,b)=>hash(a.id)-hash(b.id))){
    if(building.landmark||architectureFor(building)||isFenwayBuilding(building)||building.height<11||building.footprint.length<3)continue;
    const polygon=building.footprint,random=seeded(hash(building.id));
    const area=Math.abs(polygon.reduce((a,p,i)=>a+p[0]*polygon[(i+1)%polygon.length][1]-polygon[(i+1)%polygon.length][0]*p[1],0))/2;
    if(area<180)continue;
    const edges=polygon.map((a,i)=>({a,b:polygon[(i+1)%polygon.length]}));
    edges.sort((u,v)=>Math.hypot(v.b[0]-v.a[0],v.b[1]-v.a[1])-Math.hypot(u.b[0]-u.a[0],u.b[1]-u.a[1]));
    const yaw=Math.atan2(edges[0].b[0]-edges[0].a[0],edges[0].b[1]-edges[0].a[1]);
    const sx=Math.sin(yaw),cx=Math.cos(yaw),placed:THREE.Vector2[]=[];
    const minX=Math.min(...polygon.map(p=>p[0])),maxX=Math.max(...polygon.map(p=>p[0]));
    const minZ=Math.min(...polygon.map(p=>p[1])),maxZ=Math.max(...polygon.map(p=>p[1]));
    for(let attempt=0;attempt<22&&placed.length<Math.min(3,Math.ceil(area/800));attempt++){
      const x=minX+(maxX-minX)*(.15+random()*.7),z=minZ+(maxZ-minZ)*(.15+random()*.7);
      if(!pointInside([x,z],polygon)||placed.some(p=>p.distanceTo(new THREE.Vector2(x,z))<7))continue;
      const y=roofHeight(x,z);if(!Number.isFinite(y))continue;
      let clear=true;
      for(const ox of [-1.5,0,1.5])for(const oz of [-2.5,0,2.5]){
        const h=roofHeight(x+ox*cx+oz*sx,z-ox*sx+oz*cx);if(!Number.isFinite(h)||Math.abs(h-y)>.08)clear=false;
      }
      if(!clear)continue;placed.push(new THREE.Vector2(x,z));units++;
      const part=(g:THREE.BufferGeometry,m:THREE.Material,ox:number,oy:number,oz:number)=>add(g,m,x+ox*cx+oz*sx,y+oy,z-ox*sx+oz*cx,yaw);
      part(new THREE.BoxGeometry(1.85,.18,3.15),dark,0,.12,0);
      part(new THREE.BoxGeometry(1.65,.85,2.9),shell,0,.62,0);
      for(const oz of [-.68,.68]){
        part(new THREE.CylinderGeometry(.48,.48,.07,16),dark,0,1.08,oz);
        part(new THREE.TorusGeometry(.49,.035,5,16).rotateX(Math.PI/2),metal,0,1.13,oz);
        for(let k=-2;k<=2;k++)part(new THREE.BoxGeometry(.8,.025,.026),metal,0,1.14,oz+k*.14);
      }
      for(const side of [-1,1])for(let k=0;k<5;k++)part(new THREE.BoxGeometry(.04,.04,2.32),dark,side*.84,.39+k*.11,0);
      part(new THREE.BoxGeometry(.55,.5,.9),metal,.95,.35,.8);
      if(units>=budget)break;
    }
    if(units>=budget)break;
  }
  for(const [material,geometries] of batches){
    for(const mesh of mergeSpatialGeometries(geometries,material)){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  }
  group.userData={units,drawCalls:group.children.length,accuracy:'Procedural equipment on verified flat source roof surfaces'};
  (options.target??scene).add(group);return group;
}
