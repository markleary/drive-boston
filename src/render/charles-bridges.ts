import * as THREE from 'three';
import type {CityData} from '../types';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {sampleElevation} from '../simulation/terrain.ts';
import {roadSlabGeometry} from '../simulation/road-surfaces.ts';
import {LONGFELLOW_LENGTH,LONGFELLOW_YAW,longfellowPoint,longfellowProfile} from '../simulation/longfellow.ts';
import {lowClearanceCrossings,longfellowPortalLayout} from '../simulation/low-clearance.ts';

/** Original procedural interpretation on the retained Longfellow alignment.
 * Four granite towers flank the central arch; engineering dimensions are estimated.
 * Reference: https://www.sgh.com/project/longfellow-bridge/ */
export function addCharlesBridgeDetails(scene:THREE.Object3D,city:CityData){
  const group=new THREE.Group();group.name='Longfellow granite towers and steel arches';
  const collisions:{id:string;vertices:Float32Array;indices:Uint32Array}[]=[];
  if(!city.roads.some(r=>r.name==='Longfellow Bridge'))return{group,collisions};
  const stone=new THREE.MeshStandardMaterial({color:'#aaa69d',roughness:.95});
  const trim=new THREE.MeshStandardMaterial({color:'#c6beb0',roughness:.9});
  const steel=new THREE.MeshStandardMaterial({color:'#465e55',metalness:.5,roughness:.65});
  const dark=new THREE.MeshStandardMaterial({color:'#303d39',roughness:.8});
  const ballast=new THREE.MeshStandardMaterial({color:'#79766d',roughness:1});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const length=LONGFELLOW_LENGTH,yaw=LONGFELLOW_YAW,height=longfellowProfile(city);
  const bostonPortal=lowClearanceCrossings(city).find(site=>site.roadId==='13519-0-0');
  const bostonBearings:{x:number;y:number;z:number;side:number}[]=[];
  // The retained river frame stops at the road-name seam, short of the Boston
  // bank. Its last ribs must reach the actual portal pier, whose other face
  // supports the Storrow arch while leaving the riverside path open.
  const lastBearing=(side:number)=>{
    if(!bostonPortal)return length;
    const {left,pierOffset,pierWidth}=longfellowPortalLayout(bostonPortal),target=-(left+pierOffset)-pierWidth/2+.15;
    const origin=longfellowPoint(0,side),unit=longfellowPoint(1,side),cos=Math.cos(bostonPortal.yaw),sin=Math.sin(bostonPortal.yaw);
    const start=(origin[0]-bostonPortal.x)*cos-(origin[1]-bostonPortal.z)*sin,direction=(unit[0]-origin[0])*cos-(unit[1]-origin[1])*sin;
    return(target-start)/direction;
  };
  const position=(along:number,across:number,y:number)=>{const p=longfellowPoint(along,across);return new THREE.Vector3(p[0],y,p[1]);};
  const add=(g:THREE.BufferGeometry,m:THREE.Material,solid=false)=>{
    const list=batches.get(m)??[];list.push(g);batches.set(m,list);
    if(solid){const p=g.getAttribute('position');collisions.push({id:'longfellow-detail',vertices:new Float32Array(p.array),indices:g.index?new Uint32Array(g.index.array):Uint32Array.from({length:p.count},(_,i)=>i)});}
  };
  const box=(w:number,h:number,d:number,along:number,across:number,y:number,m:THREE.Material,solid=false)=>add(new THREE.BoxGeometry(w,h,d).rotateY(yaw).translate(...position(along,across,y).toArray()),m,solid);
  const beam=(a:THREE.Vector3,b:THREE.Vector3,w:number,h:number,m:THREE.Material)=>{
    const v=b.clone().sub(a),g=new THREE.BoxGeometry(w,h,v.length());g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),v.normalize()));g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());add(g,m);
  };
  const strip=(width:number,thickness:number,across:number,start:number,end:number,offset:number,m:THREE.Material,solid=false)=>{
    const count=Math.ceil((end-start)/2),points=[],elevations=[];
    for(let i=0;i<=count;i++){const d=start+(end-start)*i/count;points.push(longfellowPoint(d,across));elevations.push(height(d)+offset);}
    const slab=roadSlabGeometry(city,{id:'longfellow-detail',name:'Longfellow detail',points,elevations,width,oneway:0,bridge:{id:'longfellow-detail',thickness,clearanceEstimated:true}});
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(slab.vertices,3));g.setIndex(new THREE.BufferAttribute(slab.indices,1));g.computeVertexNormals();add(g,m,solid);
  };
  // The reserved strip follows the bridge's centre, between the one-lane decks.
  strip(5.1,.28,0,20,length-20,-.04,ballast);
  for(const side of [-1,1]){
    strip(2.6,.42,side*13.5,17.5,length-17.5,.03,stone,true);
    strip(.24,1,side*14.75,17.5,length-17.5,1,stone,true);
    for(const rail of [-.72,.72])strip(.07,.12,side*1.35+rail,20,length-20,.08,steel);
  }
  for(let d=22;d<length-20;d+=1.8)box(4.7,.1,.18,d,0,height(d)-.03,dark);
  const spans=11,span=length/spans;
  for(let i=1;i<spans;i++){
    const d=i*span,deck=height(d),p=position(d,0,0),bottom=sampleElevation(city,p.x,p.z)-.6;
    box(30,deck-bottom-1.2,4.4,d,0,(bottom+deck-1.2)/2,stone,true);
    box(31,.7,5.2,d,0,deck-1.15,trim);
  }
  // Open spandrel arch ribs, cross bracing, and vertical deck posts.
  for(let i=0;i<spans;i++)for(const side of [-12,0,12]){
    const start=i*span,end=i===spans-1?lastBearing(side):(i+1)*span,station=(t:number)=>start+(end-start)*t;
    for(let j=0;j<12;j++){
      const point=(t:number)=>position(station(t),side,height(station(t))-5+4.05*Math.sin(Math.PI*t));
      beam(point(j/12),point((j+1)/12),.42,.55,steel);
      if(j>0&&j%2===0){const p=point(j/12);beam(p,position(station(j/12),side,height(station(j/12))-.55),.22,.22,steel);}
    }
    if(side===0){const d=(start+end)/2;beam(position(d,-12,height(d)-1),position(d,12,height(d)-1),.3,.35,steel);}
    if(i===spans-1&&bostonPortal){
      const y=height(end)-5,p=position(end,side,y);bostonBearings.push({x:p.x,y:p.y,z:p.z,side});
      // A granite corbel overlaps the pier body. The bottom plate and web shoe
      // carry the rib end into that masonry rather than leaving a cut-off beam.
      box(1.6,.65,1.6,end-.25,side,y-.82,stone,true);
      box(1.1,.16,1.3,end-.25,side,y-.415,steel);
      box(.68,.25,.65,end-.1,side,y-.21,steel);
      box(.78,.7,.14,end+.08,side,y-.02,steel);
    }
  }
  for(const d of [5*span,6*span])for(const side of [-1,1]){
    const a=side*16.5,deck=height(d);
    box(7.1,3.4,7.5,d,a,deck-.8,stone,true);
    box(7.4,.65,7.8,d,a,deck+1.1,trim);
    box(5.8,6.6,6.1,d,a,deck+4.7,stone,true);
    for(let course=0;course<9;course++)box(5.88,.09,6.18,d,a,deck+1.7+course*.73,trim);
    for(const across of [-1,1]){
      box(.08,3.5,1.8,d,a+across*2.96,deck+5.6,dark);
      for(const corner of [-1,1])box(.58,6.4,.65,d+corner*2.6,a+across*2.8,deck+4.7,trim);
    }
    box(6.8,.6,7.1,d,a,deck+8.1,trim);
    const at=position(d,a,deck+9.5);
    add(new THREE.CylinderGeometry(2.55,2.95,2.3,8).rotateY(Math.PI/8).translate(...at.toArray()),stone,true);
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,p=position(d+Math.cos(angle)*2.56,a+Math.sin(angle)*2.56,deck+9.5);
      add(new THREE.CylinderGeometry(.2,.25,2.1,8).translate(...p.toArray()),trim);
    }
    add(new THREE.CylinderGeometry(3.35,3.15,.45,16).translate(...position(d,a,deck+10.85).toArray()),trim);
    add(new THREE.SphereGeometry(3.12,20,12,0,Math.PI*2,0,Math.PI/2).scale(1,.9,1).translate(...position(d,a,deck+11.05).toArray()),stone,true);
    add(new THREE.CylinderGeometry(.3,.65,1.1,10).translate(...position(d,a,deck+14.1).toArray()),trim);
    add(new THREE.SphereGeometry(.48,10,8).translate(...position(d,a,deck+14.85).toArray()),trim);
  }
  for(const [m,parts]of batches){
    const normalized=parts.map(g=>{const n=g.index?g.toNonIndexed():g;n.deleteAttribute('uv');return n;});const geometry=mergeGeometries(normalized,false)!;
    new Set([...parts,...normalized]).forEach(g=>g.dispose());const mesh=new THREE.Mesh(geometry,m);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  group.userData={towers:4,archSpans:11,bostonBearings,accuracy:'Procedural granite towers, piers, steel arches and central rail reservation on source road alignments'};scene.add(group);return{group,collisions};
}
