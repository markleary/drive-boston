import * as THREE from 'three';
import type {CityData} from '../types';
import {tobinBridgeSpine} from '../simulation/tobin-bridge.ts';
import {roadProjection,sampleRoadElevation} from '../simulation/road-surfaces.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {buildingAt} from '../simulation/city-tiles.ts';
import {PartBatches,TriangleWriter,box} from './geometry-writer.ts';

/** An original procedural model on the source-aligned decks: built-up green
 * steel, two cantilever peaks over the main river, and the Little Mystic Warren
 * span. Truss proportions follow the published 1,525/800/439-foot spans; the
 * model is an interpretation, not a surveyed engineering model. */
export function addTobinBridgeDetails(scene:THREE.Object3D,city:CityData){
  const group=new THREE.Group();group.name='Tobin Bridge · green double-deck cantilever';
  const collisions:{id:string;vertices:Float32Array;indices:Uint32Array}[]=[];
  const spine=tobinBridgeSpine(city);if(!spine)return{group,collisions};
  const {layout,lower,upper,sample,length}=spine;
  const green=new THREE.MeshStandardMaterial({color:'#398264',roughness:.67,metalness:.27});
  const lightGreen=new THREE.MeshStandardMaterial({color:'#539575',roughness:.69,metalness:.22});
  const darkGreen=new THREE.MeshStandardMaterial({color:'#275b45',roughness:.72,metalness:.28});
  const concrete=new THREE.MeshStandardMaterial({color:'#aaa28b',roughness:.94});
  const paleConcrete=new THREE.MeshStandardMaterial({color:'#bcb49b',roughness:.92});
  const paint=new THREE.MeshStandardMaterial({color:'#e6e6d5',roughness:.88});
  const steel=new THREE.MeshStandardMaterial({color:'#65716e',roughness:.52,metalness:.55});
  const lamps=new THREE.MeshStandardMaterial({color:'#fff3d3',emissive:'#ffd89c',emissiveIntensity:.2,roughness:.42});
  const batches=new PartBatches(256),solid=new TriangleWriter(),matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),unit=new THREE.Vector3(1,1,1),axis=new THREE.Vector3(0,0,1);
  const point=(s:number,a:number,y:number)=>{const p=sample(s,a);return new THREE.Vector3(p.x,y,p.z);};
  const placedBox=(w:number,h:number,d:number,p:THREE.Vector3,q:THREE.Quaternion,material:THREE.Material,collision=false)=>{
    matrix.compose(p,q,unit);batches.part(box(w,h,d),material,matrix);if(collision)solid.box(box(w,h,d),matrix);
  };
  const at=(w:number,h:number,d:number,s:number,a:number,y:number,material:THREE.Material,collision=false)=>{
    rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),sample(s).yaw);placedBox(w,h,d,point(s,a,y),rotation,material,collision);
  };
  const beam=(a:THREE.Vector3,b:THREE.Vector3,w:number,h:number,material=green,collision=false,builtUp=false)=>{
    const direction=b.clone().sub(a),distance=direction.length();if(distance<.01)return;
    const center=a.clone().add(b).multiplyScalar(.5),q=new THREE.Quaternion().setFromUnitVectors(axis,direction.normalize());
    placedBox(w,h,distance,center,q,material,collision);
    if(builtUp)for(const sign of [-1,1])placedBox(w*1.6,.09,distance,center.clone().add(new THREE.Vector3(0,sign*h*.5,0).applyQuaternion(q)),q,lightGreen);
  };
  const half=lower.width/2,trussAcross=half+1.16,mainStart=layout.mainSpan[0],mainEnd=layout.mainSpan[1],[pierA,pierB]=layout.mainPiers;
  const center=(pierA+pierB)/2,hangA=center-48,hangB=center+48;
  const trussHeight=(s:number)=>{
    if(s<pierA)return 13.4+21.65*Math.pow((s-mainStart)/(pierA-mainStart),1.7);
    if(s<hangA)return 19+16.05*Math.pow((hangA-s)/(hangA-pierA),1.7);
    if(s<hangB)return 19;
    if(s<pierB)return 19+16.05*Math.pow((s-hangB)/(pierB-hangB),1.7);
    return 13.4+21.65*Math.pow((mainEnd-s)/(mainEnd-pierB),1.7);
  };
  const stations=(breaks:number[],spacing:number)=>{
    const out=[breaks[0]];for(let j=1;j<breaks.length;j++){const n=Math.max(1,Math.round((breaks[j]-breaks[j-1])/spacing));for(let i=1;i<=n;i++)out.push(breaks[j-1]+(breaks[j]-breaks[j-1])*i/n);}return out;
  };
  let panels=0,gussets=0,rivets=0;
  const gusset=(s:number,across:number,y:number,side:number)=>{
    at(.12,1.32,1.48,s,across,y,lightGreen);gussets++;
    // Small raised square bolt heads are visible from the deck without adding
    // individual mesh objects or textures to the metro package.
    for(const ds of [-.45,0,.45])for(const dy of [-.42,.42]){at(.065,.085,.085,s+ds,across+side*.08,y+dy,darkGreen);rivets++;}
  };
  const truss=(nodes:number[],height:(s:number)=>number)=>{
    panels+=nodes.length-1;
    for(let i=0;i<nodes.length;i++){
      const s=nodes[i],deck=sample(s).lower,bottom=deck-1.12,top=bottom+height(s);
      for(const side of [-1,1]){
        const across=side*trussAcross;
        beam(point(s,across,bottom),point(s,across,top),.48,.62,green,true,true);
        gusset(s,across,bottom+.45,side);gusset(s,across,top-.36,side);
        if(top-deck>14)gusset(s,across,sample(s).upper-.4,side);
      }
      // Portal frames sit above upper-deck clearance; the roadway remains
      // completely open on both levels.
      beam(point(s,-trussAcross,top-.18),point(s,trussAcross,top-.18),.36,.48,green,true,true);
      beam(point(s,-trussAcross,bottom-.12),point(s,trussAcross,bottom-.12),.42,.58,darkGreen);
      if(i===0)continue;
      const prev=nodes[i-1],low=sample(prev).lower-1.12,high=low+height(prev);
      for(const side of [-1,1]){
        const across=side*trussAcross;
        beam(point(prev,across,low),point(s,across,bottom),.62,.72,green,true,true);
        beam(point(prev,across,high),point(s,across,top),.68,.78,green,true,true);
        beam(point(prev,across,i%2?low:high),point(s,across,i%2?top:bottom),.46,.58,green,true,true);
        // Additional lower-storey diagonals, visible through the upper truss.
        beam(point(prev,across,low),point(s,across,sample(s).upper-.7),.16,.2,darkGreen);
      }
      beam(point(prev,-trussAcross,high-.24),point(s,trussAcross,top-.24),.17,.2,lightGreen);
      beam(point(prev,trussAcross,high-.24),point(s,-trussAcross,top-.24),.17,.2,lightGreen);
      beam(point(prev,-trussAcross,low-.2),point(s,trussAcross,bottom-.2),.18,.24,darkGreen);
      beam(point(prev,trussAcross,low-.2),point(s,-trussAcross,bottom-.2),.18,.24,darkGreen);
    }
  };
  truss(stations([mainStart,pierA,hangA,hangB,pierB,mainEnd],12.5),trussHeight);
  const [littleA,littleB]=layout.littleSpan;
  truss(stations([littleA,littleA+14,littleB-14,littleB],12.5),s=>13.4+6.4*Math.min(1,(s-littleA)/14,(littleB-s)/14));
  const inTruss=(s:number,margin=0)=>(s>=mainStart-margin&&s<=mainEnd+margin)||(s>=littleA-margin&&s<=littleB+margin);

  // Two tall, tapered concrete legs and a transverse cap leave an open portal
  // under each river pier, rather than a wall filling the river opening.
  const pier=(s:number,large:boolean)=>{
    const p=sample(s),base=Math.min(sampleElevation(city,p.x,p.z)-1,-2),top=p.lower-1.5,across=trussAcross-.5;
    for(const side of [-1,1]){
      at(large?5.6:4.5,2.3,large?9.5:7,s,side*across,base+.75,concrete,true);
      const h=top-base-2.6,g=new THREE.CylinderGeometry(large?1.5:1.1,large?2.2:1.6,h,4).rotateY(Math.PI/4).scale(1,1,large?1.8:1.5);
      matrix.makeRotationY(p.yaw);matrix.setPosition(point(s,side*across,base+2+h/2));batches.part(g,concrete,matrix);solid.append(g,matrix);g.dispose();
      at(large?4.5:3.6,.55,large?6.8:5.5,s,side*across,top-.4,paleConcrete,true);
      at(1.7,.48,2,s,side*trussAcross,top+.15,darkGreen,true);
    }
    at(trussAcross*2+3,2.1,large?5.3:4,s,0,top-1.4,concrete,true);
  };
  for(const s of [mainStart,pierA,pierB,mainEnd])pier(s,true);
  for(const s of [littleA,littleB])pier(s,false);

  const bents:number[]=[];
  for(let s=18;s<length-10;s+=31){
    if(inTruss(s,9))continue;
    const p=sample(s),top=p.lower-1.3,footAcross=trussAcross+.4;
    if(top-sampleElevation(city,p.x,p.z)<4)continue;
    // Keep columns out of mapped ground streets and independent ramps.
    const columns=[-1,1].map(side=>{const q=sample(s,side*footAcross);return{side,q,base:sampleElevation(city,q.x,q.z)};});
    if(columns.some(({q})=>[[-1,-1],[-1,1],[1,-1],[1,1]].some(([dx,dz])=>buildingAt(city,q.x+dx*1.2,q.z+dz*1.2))))continue;
    if(columns.some(({q,base})=>city.roads.some(r=>r!==lower&&r!==upper&&roadProjection(r,q.x,q.z).distance<r.width/2+1.4&&sampleRoadElevation(city,r,q.x,q.z)<top+1&&sampleRoadElevation(city,r,q.x,q.z)>base-2)))continue;
    bents.push(s);
    for(const {side,q,base} of columns){
      at(2.1,1.1,2.6,s,side*footAcross,base+.45,concrete,true);
      beam(new THREE.Vector3(q.x,base+.7,q.z),new THREE.Vector3(q.x,top,q.z),.62,.74,green,true,true);
    }
    beam(point(s,-footAcross,top),point(s,footAcross,top),.65,.85,green,true,true);
    // Lower bracing stops well above street traffic; no diagonal crosses an
    // underpass at vehicle height.
    if(top-Math.max(...columns.map(c=>c.base))>11){
      beam(point(s,-footAcross,top-5),point(s,footAcross,top-.5),.22,.3,darkGreen);
      beam(point(s,footAcross,top-5),point(s,-footAcross,top-.5),.22,.3,darkGreen);
    }
  }

  const deckNodes=stations([0,length],6);
  for(let i=1;i<deckNodes.length;i++){
    const a=deckNodes[i-1],b=deckNodes[i],pa=sample(a),pb=sample(b);
    for(const level of ['lower','upper']as const)for(const side of [-1,1]){
      // Deep longitudinal plate girders and the narrow maintenance walk.
      beam(point(a,side*(half+.06),pa[level]-.65),point(b,side*(half+.06),pb[level]-.65),.24,1.15,green);
      beam(point(a,side*(half+.51),pa[level]-.13),point(b,side*(half+.51),pb[level]-.13),.78,.24,darkGreen);
      beam(point(a,side*(half+.91),pa[level]+.88),point(b,side*(half+.91),pb[level]+.88),.07,.08,lightGreen);
      beam(point(a,side*(half+.91),pa[level]+.44),point(b,side*(half+.91),pb[level]+.44),.055,.06,green);
      beam(point(a,side*(half+.91),pa[level]),point(a,side*(half+.91),pa[level]+.92),.075,.075,green);
      if(!inTruss(a)&&level==='lower'&&i%2===0)beam(point(a,side*trussAcross,pa.lower-1),point(a,side*trussAcross,pa.upper-.7),.3,.38,green,true,true);
    }
    if(!inTruss(a)&&i%2===0)beam(point(a,-trussAcross,pa.upper-.65),point(a,trussAcross,pa.upper-.65),.28,.48,darkGreen);
  }
  // Two dashed separators give the two 36-foot decks their three real lanes.
  for(let s=3;s<length-3;s+=9)for(const level of ['lower','upper']as const)for(const side of [-1,1]){
    const end=Math.min(length-.3,s+3),pa=sample(s),pb=sample(end),a=point(s,side*lower.width/6,pa[level]+.048),b=point(end,side*lower.width/6,pb[level]+.048);
    beam(a,b,.12,.012,paint);
  }
  for(let s=12;s<length-12;s+=45)for(const side of [-1,1]){
    const p=sample(s),a=side*(half+.72);
    beam(point(s,a,p.upper+.2),point(s,a,p.upper+7.4),.105,.105,steel);
    beam(point(s,a,p.upper+7.4),point(s,a-side*2.5,p.upper+7.9),.105,.105,steel);
    at(.62,.18,1.15,s,a-side*2.5,p.upper+7.85,steel);
    at(.52,.06,.95,s,a-side*2.5,p.upper+7.73,lamps);
  }
  const meshes=batches.meshes();for(const mesh of meshes){mesh.castShadow=mesh.material!==paint&&mesh.material!==lamps;mesh.receiveShadow=true;group.add(mesh);}
  const geometry=solid.geometry();collisions.push({id:'tobin-structure',vertices:new Float32Array(geometry.attributes.position.array),indices:Uint32Array.from({length:solid.count},(_,i)=>i)});geometry.dispose();
  group.userData={mainSpanMeters:mainEnd-mainStart,mainChannelMeters:pierB-pierA,littleSpanMeters:littleB-littleA,trussPanels:panels,concretePiers:6,approachBents:bents.length,gussets,rivets,meshes:meshes.length,lanesPerDeck:3,accuracy:'Source-aligned procedural steel cantilever; estimated vertical profile'};
  scene.add(group);return{group,collisions,setLighting:(night:boolean)=>{lamps.emissiveIntensity=night?3.5:.2;}};
}
