import * as THREE from 'three';
import type {CityData,Point2} from '../types';
import {roadDeckGeometry,roadSlabGeometry,sampleRoadElevation,bridgeSupports,bridgeBarriers,bridgeEdgeSections,closedEndBarriers,laneMarkings,JERSEY,type ClosureUnit} from '../simulation/road-surfaces.ts';
import {drapedRibbon} from './terrain-ground.ts';
import {mergeSpatialGeometries} from './spatial-batches.ts';
import {TriangleWriter} from './geometry-writer.ts';
import {signMaterial} from './tunnels.ts';
import {drain,due,type Pace} from './pacing.ts';

/** Materials of the highway closures and lane paint, shared by every tile. */
let shared:{yellow:THREE.Material;barrier:THREE.Material;amber:THREE.Material;metal:THREE.Material;sign:THREE.Material}|undefined;
const closureMaterials=()=>shared??={
  yellow:new THREE.MeshStandardMaterial({color:'#d9b443',roughness:.87}),barrier:new THREE.MeshStandardMaterial({color:'#b4b2a6',roughness:.93}),
  amber:new THREE.MeshBasicMaterial({color:'#f0b23c'}),metal:new THREE.MeshStandardMaterial({color:'#394342',roughness:.8,metalness:.3}),sign:signMaterial(['ROAD CLOSED','DO NOT ENTER'],true),
};
/** A 15 cm line along `points`, 4 cm over the deck, its corners on the deck. */
function paintLine(writer:TriangleWriter,points:Point2[],surface:(x:number,z:number)=>number){
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.01)continue;
    const rx=-dz/length*.075,rz=dx/length*.075,corner=(p:Point2,side:number):[number,number,number]=>{const x=p[0]+rx*side,z=p[1]+rz*side;return[x,surface(x,z)+.04,z];};
    const [ar,br,al,bl]=[corner(a,1),corner(b,1),corner(a,-1),corner(b,-1)];
    writer.triangle(...ar,...br,...al);writer.triangle(...al,...br,...bl);
  }
}
/** One precast unit: its face profile in the YZ plane, extruded across the road along X. */
function jerseyUnit(length:number){
  const h=JERSEY.base/2,t=JERSEY.top/2,profile=[[h,0],[h,.075],[t+.03,.33],[t,JERSEY.height],[-t,JERSEY.height],[-t-.03,.33],[-h,.075],[-h,0]];
  return new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([x,y])=>new THREE.Vector2(x,y))),{depth:length,bevelEnabled:false,curveSegments:1}).translate(0,0,-length/2).rotateY(Math.PI/2);
}
const unitMatrix=(u:ClosureUnit)=>new THREE.Matrix4().compose(new THREE.Vector3(u.x,u.y-.02,u.z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,u.yaw,u.roll,'YXZ')),new THREE.Vector3(1,1,1));

/** The source-defined upper road is independent from the streets beneath it. */
export function addRoadStructures(scene:THREE.Object3D,city:CityData,asphalt?:THREE.Material,structures=city.roads.filter(r=>r.elevations)){return drain(roadStructureSteps(scene,city,asphalt,structures));}
/** `addRoadStructures` as paced steps: a tile's highway decks, with their lane
 * lines, parapets and piers, take several frames' worth of work. */
export function* roadStructureSteps(scene:THREE.Object3D,city:CityData,asphalt?:THREE.Material,structures=city.roads.filter(r=>r.elevations),pace?:Pace,continuationCity=city):Generator<void,THREE.Group>{
  const group=new THREE.Group();group.name='Elevated roads and water crossings';
  const concrete=new THREE.MeshStandardMaterial({color:'#9b9a8e',roughness:.92});
  const steel=new THREE.MeshStandardMaterial({color:'#525f58',roughness:.7,metalness:.45});
  const paint=new THREE.MeshStandardMaterial({color:'#dbd9bc',roughness:.87});
  asphalt??=new THREE.MeshStandardMaterial({color:'#50565a',roughness:.94});
  const decks:THREE.BufferGeometry[]=[],slabs:THREE.BufferGeometry[]=[],markings:THREE.BufferGeometry[]=[],rails:THREE.BufferGeometry[]=[],piers:THREE.BufferGeometry[]=[];
  const yellow:THREE.BufferGeometry[]=[],jerseys:THREE.BufferGeometry[]=[],glints:THREE.BufferGeometry[]=[];let closures=0;
  for(const road of structures){
    if(!road.elevations||road.tunnel)continue;
    if(due(pace))yield;
    const deck=roadDeckGeometry(city,road,road.width,.025),top=new THREE.BufferGeometry();
    top.setAttribute('position',new THREE.BufferAttribute(deck.vertices,3));top.setAttribute('uv',new THREE.BufferAttribute(deck.uv,2));top.setIndex(new THREE.BufferAttribute(deck.indices,1));top.computeVertexNormals();decks.push(top);
    const slab=roadSlabGeometry(city,road),base=new THREE.BufferGeometry();base.setAttribute('position',new THREE.BufferAttribute(slab.vertices,3));base.setIndex(new THREE.BufferAttribute(slab.indices,1));base.computeVertexNormals();slabs.push(base);
    if(due(pace))yield;
    const surface=(x:number,z:number)=>sampleRoadElevation(city,road,x,z),lanes=laneMarkings(city,road,continuationCity);
    if(lanes.length){
      // A highway deck paints its own lanes instead of the edge lines and centre dash below.
      const white=new TriangleWriter(),amber=new TriangleWriter();
      for(const line of lanes)paintLine(line.color==='yellow'?amber:white,line.points,surface);
      markings.push(white.geometry());yellow.push(amber.geometry());
    }
    const closure=closedEndBarriers(city,road);
    if(closure){
      // The tunnel caps' closure in the open: a full-width row of precast units
      // with amber reflectors and lamps, and the warning sign on posts behind it.
      const {barrier,metal,sign}=closureMaterials(),unit=jerseyUnit(closure.units[0].length),side=closure.face===closure.units[0].yaw?1:-1;closures++;
      for(const u of closure.units){
        const m=unitMatrix(u);jerseys.push(unit.clone().applyMatrix4(m));
        glints.push(new THREE.BoxGeometry(.3,.09,.02).translate(0,.75,side*.125).applyMatrix4(m),new THREE.BoxGeometry(.16,.14,.07).translate(0,JERSEY.height+.07,0).applyMatrix4(m));
      }
      unit.dispose();
      const width=Math.min(6.6,closure.width-1),height=width/4,fx=Math.sin(closure.face),fz=Math.cos(closure.face),lift=1.5;
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(width,height),sign);panel.name='Road Closed / Do Not Enter';panel.userData.roadId=road.id;
      panel.position.set(closure.x-fx*1.2,closure.y+lift+height/2,closure.z-fz*1.2);panel.rotation.y=closure.face;
      const back=new THREE.Mesh(new THREE.BoxGeometry(width,height,.08),metal);back.position.z=-.055;panel.add(back);
      for(const x of [-1,1]){const post=new THREE.Mesh(new THREE.BoxGeometry(.12,lift+height,.12),metal);post.position.set(x*(width/2-.5),-lift/2,-.16);post.castShadow=true;panel.add(post);}
      group.add(panel);
    }
    if(!lanes.length)for(const edge of bridgeEdgeSections(city,road,.55)){
      const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],lengthSquared=dx*dx+dz*dz;
      const edgeHeight=(x:number,z:number)=>edge.ya+(edge.yb-edge.ya)*Math.max(0,Math.min(1,((x-edge.a[0])*dx+(z-edge.a[1])*dz)/(lengthSquared||1)));
      markings.push(drapedRibbon(city,[edge.a,edge.b],.13,.04,edgeHeight));
    }
    let distance=0;
    if(!lanes.length&&road.width>8&&road.id!==city.tobinBridge?.lowerRoadId&&road.id!==city.tobinBridge?.upperRoadId)for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(Math.floor(distance/5)%2===0)markings.push(drapedRibbon(city,[a,b],.12,.04,surface));distance+=length;
    }
    if(due(pace))yield;
    for(const p of bridgeBarriers(city,road)){
      const g=new THREE.BoxGeometry(.27,.76,p.length).rotateX(-p.slope).rotateY(p.yaw).translate(p.x,p.y,p.z);rails.push(g);
    }
    if(due(pace))yield;
    for(const p of bridgeSupports(city,road)){
      piers.push(new THREE.BoxGeometry(1.8,p.top-p.bottom,2.4).rotateY(p.yaw).translate(p.x,(p.top+p.bottom)/2,p.z));
      piers.push(new THREE.BoxGeometry(p.width-.5,.55,2.8).rotateY(p.yaw).translate(p.x,p.top-.28,p.z));
    }
  }
  const lanePaint=yellow.length?closureMaterials().yellow:paint,{barrier,amber}=closures?closureMaterials():{barrier:concrete,amber:paint};
  for(const [geometries,material]of [[decks,asphalt],[slabs,steel],[markings,paint],[yellow,lanePaint],[rails,concrete],[piers,concrete],[jerseys,barrier],[glints,amber]]as const){
    for(const mesh of mergeSpatialGeometries(geometries,material)){mesh.castShadow=geometries!==markings&&geometries!==yellow&&geometries!==glints;mesh.receiveShadow=true;group.add(mesh);}
  }
  group.userData={roads:structures.length,closures,deckHeight:'Estimated profile on official source alignments',collision:'Independent closed decks; clear mapped underpasses'};
  scene.add(group);return group;
}
