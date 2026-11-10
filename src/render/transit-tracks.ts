import * as THREE from 'three';
import type {CityData,Point2} from '../types';
import type {TransitRoute} from '../simulation/transit.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {box,TriangleWriter} from './geometry-writer.ts';

/** Huntington changes to street running at Brigham Circle. The other branches
 * have their own right of way, including west of Huntington's old x cutoff. */
export function reservedTrack(route:Pick<TransitRoute,'line'>,point:Point2){return route.line!=='Green-E'||point[0]>-2460;}

const CELL=320,VIEW=1400,NEAR=300;
/** Rail, bed, wire and poles in 320 m cells, built as the observer comes within
 * sight of them and dropped behind. Track is drawn out to 1.4 km; the whole
 * network at once is 36 km of it, 1.6 million vertices that a session mostly
 * never sees. Small rail pieces go straight into buffers instead of thousands
 * of meshes, without the texture coordinates these plain finishes never read. */
export function createTransitTracks<R extends TransitRoute>(city:CityData,routes:R[],pointAt:(route:R,distance:number)=>Point2,heightAt:(route:R,distance:number,point:Point2)=>number,hiddenAt:(route:R,distance:number)=>boolean=()=>false){
 const group=new THREE.Group();group.name='Green Line surface infrastructure';
 const iron=new THREE.MeshStandardMaterial({color:0x555c5d,metalness:.7,roughness:.36});
 const concrete=new THREE.MeshStandardMaterial({color:0x777d70,roughness:.95});
 const ballast=new THREE.MeshStandardMaterial({color:0x68665e,roughness:1});
 const cylinder=new THREE.CylinderGeometry(1,1,1,6),wireCylinder=new THREE.CylinderGeometry(1,1,1,4,1,true),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1);
 // The plan: every three-metre piece by the cell its start lies in, with whether it carries a catenary pole
 // (one line of poles per service, about 35 m apart, along reserved track only).
 interface Piece{route:R;s:number;pole:boolean;}
 interface Cell{x:number;z:number;pieces:Piece[];meshes?:THREE.Mesh[];}
 const cells=new Map<string,Cell>(),lines=new Set<string>();
 for(const route of routes.filter(r=>r.kind==='tram')){
  const poles=!lines.has(route.line);lines.add(route.line);let lastPole=-100;
  for(let s=0;s<route.length-1;s+=3){
   if(hiddenAt(route,s+1.5))continue;
   const end=Math.min(route.length,s+3),a=pointAt(route,s),b=pointAt(route,end);if(Math.hypot(b[0]-a[0],b[1]-a[1])<.001)continue;
   const pole=poles&&s-lastPole>34&&reservedTrack(route,a);if(pole)lastPole=s;
   const cx=Math.floor(a[0]/CELL),cz=Math.floor(a[1]/CELL),key=`${cx},${cz}`;let cell=cells.get(key);
   if(!cell)cells.set(key,cell={x:(cx+.5)*CELL,z:(cz+.5)*CELL,pieces:[]});
   cell.pieces.push({route,s,pole});
  }
 }
 function build(cell:Cell){
  const beds=new Map<THREE.Material,TriangleWriter>(),rails=new TriangleWriter(),wires=new TriangleWriter(),supports=new TriangleWriter();
  const beam=(writer:TriangleWriter,a:THREE.Vector3,b:THREE.Vector3,r:number)=>{
   const delta=b.clone().sub(a),length=delta.length();if(length<.001)return;
   q.setFromUnitVectors(up,delta.multiplyScalar(1/length));matrix.compose(a.clone().add(b).multiplyScalar(.5),q,new THREE.Vector3(r,length,r));writer.append(writer===wires?wireCylinder:cylinder,matrix);
  };
  for(const {route,s,pole} of cell.pieces){
   const end=Math.min(route.length,s+3),a=pointAt(route,s),b=pointAt(route,end),dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
   const ya=heightAt(route,s,a),yb=heightAt(route,end,b),cy=(ya+yb)/2,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,yaw=Math.atan2(dx,dz),tilt=-Math.atan2(yb-ya,length),nx=-dz/length,nz=dx/length;
   q.setFromEuler(new THREE.Euler(tilt,yaw,0,'YXZ'));const span=Math.hypot(length,yb-ya)+.025,along=q.clone();
   if(reservedTrack(route,a)){
    const bridge=route.bridges?.some(b=>s>=b.start&&s<=b.end),ground=Math.min(sampleElevation(city,x,z),sampleElevation(city,x+nx*1.25,z+nz*1.25),sampleElevation(city,x-nx*1.25,z-nz*1.25)),depth=bridge?.22:Math.max(.035,cy-ground+.035);
    const material=route.line==='Green-D'?ballast:concrete;let bed=beds.get(material);if(!bed)beds.set(material,bed=new TriangleWriter());
    bed.box(box(2.5,depth,span),matrix.compose(new THREE.Vector3(x,cy+.08-depth/2,z),along,one));
   }
   for(const side of [-1,1])rails.box(box(.065,.04,span),matrix.compose(new THREE.Vector3(x+nx*.7175*side,cy+.095,z+nz*.7175*side),along,one));
   beam(wires,new THREE.Vector3(a[0],ya+5.73,a[1]),new THREE.Vector3(b[0],yb+5.73,b[1]),.012);
   if(pole){
    const px=a[0]+nx*1.9,pz=a[1]+nz*1.9,y=sampleElevation(city,px,pz);
    beam(supports,new THREE.Vector3(px,y,pz),new THREE.Vector3(px,ya+6.3,pz),.08);
    beam(supports,new THREE.Vector3(px,ya+6.1,pz),new THREE.Vector3(a[0]-nx*4,ya+6.1,a[1]-nz*4),.035);
   }
  }
  cell.meshes=[];
  const add=(writer:TriangleWriter,material:THREE.Material,name:string)=>{
   if(writer.empty)return;
   const geometry=writer.geometry();geometry.deleteAttribute('uv');
   const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=writer===supports;mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);cell.meshes!.push(mesh);
  };
  for(const [material,bed] of beds)add(bed,material,'Reserved Green Line rail bed');
  add(rails,iron,'Standard gauge Green Line rails');add(wires,iron,'Green Line overhead wire');add(supports,iron,'Catenary poles');
 }
 function drop(cell:Cell){for(const mesh of cell.meshes??[]){group.remove(mesh);mesh.geometry.dispose();}cell.meshes=undefined;}
 // A cell's pieces start inside it and run at most a few metres past its edge.
 const REACH=CELL*Math.SQRT1_2+8;
 let lastX=Infinity,lastZ=Infinity,pending:Cell[]=[];
 return{group,
  /** Cells planned and currently built (diagnostics and specs). */
  get cellCount(){return cells.size;},get builtCount(){let n=0;for(const cell of cells.values())if(cell.meshes)n++;return n;},
  /** Follow the observer: cells coming into sight are built nearest first, one a call (those right by the observer
   * at once, so an arrival beside the track finds it laid; `all` finishes them in this call), cells well out of
   * sight are dropped, and each built piece is shown within the drawing range. */
  updateVisibility(x:number,z:number,all=false){
   if(Math.hypot(x-lastX,z-lastZ)>=60){
    lastX=x;lastZ=z;pending=[];
    for(const cell of cells.values()){
     const distance=Math.hypot(cell.x-x,cell.z-z);
     if(cell.meshes){if(distance>VIEW+REACH+400)drop(cell);}
     else if(distance<VIEW+REACH)pending.push(cell);
    }
    pending.sort((a,b)=>Math.hypot(b.x-x,b.z-z)-Math.hypot(a.x-x,a.z-z)); // nearest last: popped first
    for(const cell of cells.values())for(const mesh of cell.meshes??[]){const sphere=mesh.geometry.boundingSphere!;mesh.visible=Math.hypot(sphere.center.x-x,sphere.center.z-z)<VIEW+sphere.radius;}
   }
   let built=0;
   while(pending.length){
    const cell=pending[pending.length-1];
    if(!all&&built&&Math.hypot(cell.x-x,cell.z-z)>NEAR+REACH)break;
    pending.pop();build(cell);built++;
    for(const mesh of cell.meshes!){const sphere=mesh.geometry.boundingSphere!;mesh.visible=Math.hypot(sphere.center.x-lastX,sphere.center.z-lastZ)<VIEW+sphere.radius;}
   }
  },
  dispose(){for(const cell of cells.values())drop(cell);cylinder.dispose();wireCylinder.dispose();for(const material of [iron,concrete,ballast])material.dispose();},
 };
}
