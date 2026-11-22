import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building, CityData, Point2 } from '../types';
import fenway from '../data/fenway-detail.json' with {type:'json'};
import {fenwaySeatingRows,fenwayTreadSupport} from './fenway-seating';
import { fenwayDiamond, fenwayInfield, createFenwayRoofSampler, fenwayScoreboardMount } from './fenway-layout';
import { fenwayFieldPatch, fenwayGrassBoundary, fenwayPlayingSurface } from './fenway-field';
import { sampleElevation } from '../simulation/terrain.ts';
import { due, type Pace } from './pacing';
export { fenwayDiamond } from './fenway-layout';
import { canvasTexture, seeded } from './materials';
import { box, PartBatches, type Part } from './geometry-writer';
import { closestRoad } from '../simulation/roads';

const FENWAY_IDS=new Set(fenway.roofBuildings);
export const isFenwayBuilding=(building?:Building)=>!!building&&FENWAY_IDS.has(building.id);
const feature=(role:string)=>fenway.features.find(f=>f.role===role)!.points as Point2[];

/** Original masonry and painted steel artwork, not photo-derived facade tiles. */
export function createFenwayShellMaterials(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d')!,random=seeded(1912);ctx.fillStyle='#9a6250';ctx.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=8)for(let col=-1;col<25;col++){
    const x=col*23+(Math.floor(y/8)%2)*11.5;ctx.fillStyle=`rgba(${random()>.4?'203,152,113':'66,41,33'},${.12+random()*.16})`;ctx.fillRect(x+.7,y+.5,22,7);
    ctx.fillStyle='#c8b19560';ctx.fillRect(x,y,23,.8);ctx.fillRect(x,y,.7,8);
  }
  const wall=new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),roughness:.92});wall.name='Fenway red brick';
  const roof=new THREE.MeshStandardMaterial({color:'#315c4b',roughness:.74,metalness:.14});roof.name='Fenway painted stadium steel';
  return{wall,roof};
}

/** Detailed, source-aligned field over the measured open stadium shell. */
export function* fenwayParkSteps(target:THREE.Object3D,city:CityData,stadium:Building,
  onField:(vertices:Float32Array,indices:Uint32Array,boundary:Point2[])=>void,pace?:Pace):Generator<void,THREE.Group>{
  const group=new THREE.Group();group.name='Fenway Park field and grandstands';
  const translation=(stadium.baseElevation??3.048)-3.048;
  const {y:fieldY,boundary:trackBoundary,geometry:trackSurface,vertices,indices}=fenwayPlayingSurface(stadium);
  const batches=new PartBatches(300),matrix=new THREE.Matrix4();
  const add=(geometry:THREE.BufferGeometry,material:THREE.Material)=>{
    batches.at(material,...stadium.center).append(geometry);geometry.dispose();
  };
  const part=(shape:Part,material:THREE.Material,x:number,y:number,z:number,yaw=0)=>{
    batches.part(shape,material,matrix.makeRotationY(yaw).setPosition(x,y,z));
    if(shape instanceof THREE.BufferGeometry)shape.dispose();
  };
  const green=new THREE.MeshStandardMaterial({color:'#245b49',roughness:.78});
  const dark=new THREE.MeshStandardMaterial({color:'#1c302b',roughness:.75,metalness:.4});
  const iron=new THREE.MeshStandardMaterial({color:'#52645b',metalness:.65,roughness:.46});
  const white=new THREE.MeshStandardMaterial({color:'#e3e0cc',roughness:.82});
  const yellow=new THREE.MeshStandardMaterial({color:'#e9b82e',roughness:.56,metalness:.15});
  const clay=new THREE.MeshStandardMaterial({color:'#a77b56',roughness:1});
  const track=new THREE.MeshStandardMaterial({color:'#997b61',roughness:1});
  const grassCanvas=document.createElement('canvas');grassCanvas.width=grassCanvas.height=512;const gc=grassCanvas.getContext('2d')!,random=seeded(1934);
  gc.fillStyle='#527d3c';gc.fillRect(0,0,512,512);gc.fillStyle='#5c8543';gc.fillRect(0,0,256,512);
  for(let i=0;i<17000;i++){
    gc.fillStyle=random()>.5?'#d7d79516':'#1e392119';gc.fillRect(random()*512,random()*512,1,2);
    if(i%1024===0&&due(pace))yield;
  }
  const grass=new THREE.MeshStandardMaterial({map:canvasTexture(grassCanvas,true),roughness:1});
  onField(vertices,indices,trackBoundary);
  add(trackSurface,track);add(fenwayFieldPatch(fenwayGrassBoundary,fieldY+.025),grass);
  const diamond=fenwayDiamond(),{home,first,second,third,mound,firstDirection}=diamond;
  const infield=fenwayInfield(diamond);
  add(fenwayFieldPatch(infield.dirt,fieldY+.045),clay);
  add(fenwayFieldPatch(infield.grass,fieldY+.065),grass);
  part(new THREE.CylinderGeometry(2.75,2.9,.14,48),clay,mound[0],fieldY+.12,mound[1]);
  const pitchYaw=Math.atan2(mound[0]-home[0],mound[1]-home[1]);
  part(box(.61,.03,.15),white,mound[0],fieldY+.205,mound[1],pitchYaw);
  for(const base of [first,second,third])part(box(.46,.09,.46),white,base[0],fieldY+.092,base[1],Math.atan2(-firstDirection[1],firstDirection[0]));
  const plate=[[0,0],[.216,.216],[.216,.432],[-.216,.432],[-.216,.216]].map(([x,z])=>infield.platePoint(x,z));
  add(fenwayFieldPatch(plate,fieldY+.098),white);
  const strip=(a:Point2,b:Point2,width:number,y:number,material:THREE.Material)=>{const dx=b[0]-a[0],dz=b[1]-a[1];part(box(width,.025,Math.hypot(dx,dz)),material,(a[0]+b[0])/2,y,(a[1]+b[1])/2,Math.atan2(dx,dz));};
  for(const [base,pole] of [[third,diamond.left],[first,diamond.right]]){
    strip(home,base,.12,fieldY+.072,white);strip(base,pole,.12,fieldY+.072,white);
  }
  for(const side of [-1,1]){
    const corners=[[-.61,-.92],[.61,-.92],[.61,.92],[-.61,.92]].map(([x,z])=>infield.platePoint(side*.98+x,.216+z));
    for(let i=0;i<4;i++)strip(corners[i],corners[(i+1)%4],.065,fieldY+.084,white);
  }
  const [a,b]=feature('monster-wall'),monsterLength=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const wallYaw=Math.atan2(a[1]-b[1],b[0]-a[0]),wallHeight=fenway.dimensions.monsterHeight;
  const wallPart=(geometry:Part,material:THREE.Material,along:number,height:number,depth:number)=>
    part(geometry,material,a[0]+along*Math.cos(wallYaw)+depth*Math.sin(wallYaw),fieldY+height,
      a[1]-along*Math.sin(wallYaw)+depth*Math.cos(wallYaw),wallYaw);
  wallPart(box(monsterLength,wallHeight,.58),green,monsterLength/2,wallHeight/2,0);
  for(let d=.06;d<monsterLength;d+=3.1)wallPart(box(.08,11.3,.11),iron,d,5.67,.32);
  // Scoreboard artwork is fictional game information on the real wall location.
  const board=document.createElement('canvas');board.width=2048;board.height=256;const bc=board.getContext('2d')!;
  bc.fillStyle='#264f42';bc.fillRect(0,0,2048,256);bc.strokeStyle='#d3dac4';bc.lineWidth=2;
  bc.font='bold 30px monospace';bc.fillStyle='#d8dfcb';bc.fillText('AMERICAN LEAGUE',35,42);
  bc.font='bold 29px monospace';bc.fillText('BOSTON',35,114);bc.fillText('VISITORS',35,171);
  for(let i=0;i<12;i++){const x=280+i*139;bc.strokeRect(x,67,123,128);bc.fillText(i<9?String(i+1):['R','H','E'][i-9],x+42,48);bc.fillText('0',x+42,114);bc.fillText('0',x+42,171);}
  const boardMaterial=new THREE.MeshStandardMaterial({map:canvasTexture(board),roughness:.75});
  // The plates cover the raised steel ribs and follow the slight skew of the wall.
  wallPart(box(33.18,4.31,.12),dark,monsterLength/2-10,3.3,.35);
  wallPart(new THREE.PlaneGeometry(33,4.13),boardMaterial,monsterLength/2-10,3.3,.416);
  function sign(text:string,width:number,height:number,color:string,background:string){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle=background;ctx.fillRect(0,0,1024,128);ctx.fillStyle=color;ctx.font='bold 72px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,67,980);
    return new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map:canvasTexture(canvas),roughness:.69}));
  }
  const monsterTitle=sign('FENWAY PARK',19,2.37,'#e4dfc7','#245b49');
  wallPart(box(19.14,2.51,.12),green,monsterLength-12,8.8,.35);
  wallPart(monsterTitle.geometry,monsterTitle.material,monsterLength-12,8.8,.416);
  // Foul poles and short right-field barriers preserve the asymmetric silhouette.
  for(const pole of [diamond.left,diamond.right]){
    const height=pole===diamond.left?21:16;part(new THREE.CylinderGeometry(.105,.13,height,8),yellow,pole[0],fieldY+height/2,pole[1]);
    for(let y=4;y<height;y+=.8)part(box(.8,.035,.035),yellow,pole[0]+.35,fieldY+y,pole[1]);
  }
  for(let i=4;i<10;i++){
    const a=trackBoundary[i],b=trackBoundary[i+1],height=i<6?5.18:1.4,dx=b[0]-a[0],dz=b[1]-a[1];
    part(box(.24,height,Math.hypot(dx,dz)),green,(a[0]+b[0])/2,fieldY+height/2,(a[1]+b[1])/2,Math.atan2(dx,dz));
  }
  for(const bullpen of fenway.features.filter(f=>f.role==='bullpen')){
    add(fenwayFieldPatch(bullpen.points as Point2[],fieldY+.07),grass);
    const p=bullpen.points;for(let i=0;i<p.length;i++){
      const a=p[i] as Point2,b=p[(i+1)%p.length] as Point2,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length>5)for(let j=0;j<length;j+=2){const t=j/length;part(new THREE.CylinderGeometry(.035,.035,1.65,5),iron,a[0]+dx*t,fieldY+.9,a[1]+dz*t);}
      strip(a,b,.055,fieldY+1.7,iron);
    }
  }
  const roofAt=createFenwayRoofSampler(translation);
  const seats:{x:number;y:number;z:number;yaw:number;red:boolean}[]=[];
  const treads:{x:number;y:number;z:number;yaw:number;depth:number;height:number}[]=[];
  for(const {start,end,out,step,startStation,roofLimit} of fenwaySeatingRows(roofAt)){
    const dx=end[0]-start[0],dz=end[1]-start[1],length=Math.hypot(dx,dz),yaw=Math.atan2(-out[0],-out[1]);
    // Keep chair columns and aisles aligned to the front row as ends taper.
    for(let column=Math.ceil((startStation+.285)/.57);;column++){
      const along=column*.57-startStation;
      if(along>length-.285)break;
      const x=start[0]+dx/length*along,z=start[1]+dz/length*along;
      const support=fenwayTreadSupport(roofAt,x,z,out,step,roofLimit);
      if(!support||support.top>fieldY+18||support.top<fieldY+.7)continue;
      treads.push({x,y:(support.top+support.bottom)/2,z,yaw,depth:step,height:support.top-support.bottom});
      // Concrete stair aisles remain visible between chair sections.
      if(((column%24)+24)%24<2||along<.9||length-along<.9)continue;
      seats.push({x,y:support.top,z,yaw,red:false});
    }
    if(due(pace))yield;
  }
  if(seats.length){
    const far=seats.filter(s=>s.x> -1778&&s.z<390);if(far.length)far[Math.floor(far.length*.62)].red=true;
    const seatMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.67});
    const chairParts=[
      new THREE.BoxGeometry(.46,.12,.44).translate(0,.42,0),
      new THREE.BoxGeometry(.46,.47,.09).translate(0,.68,-.2),
      new THREE.BoxGeometry(.14,.38,.16).translate(0,.18,-.05)
    ];
    const chairs=new THREE.InstancedMesh(mergeGeometries(chairParts),seatMaterial,seats.length),dummy=new THREE.Object3D();
    chairParts.forEach(g=>g.dispose());
    const seatColors=['#4c805d','#618e6e','#be3e36'].map(value=>new THREE.Color(value));
    for(let i=0;i<seats.length;i++){
      const seat=seats[i];
      dummy.rotation.set(0,seat.yaw,0);dummy.position.set(seat.x,seat.y,seat.z);dummy.updateMatrix();
      chairs.setMatrixAt(i,dummy.matrix);chairs.setColorAt(i,seatColors[seat.red?2:i%7?0:1]);
      if(i%256===0&&due(pace))yield;
    }
    chairs.castShadow=chairs.receiveShadow=true;chairs.name='Fenway grandstand chairs';group.add(chairs);
    const terraces=new THREE.InstancedMesh(new THREE.BoxGeometry(.57,1,1),new THREE.MeshStandardMaterial({color:'#a6aaa0',roughness:.96}),treads.length);
    terraces.name='Fenway concrete seating treads';terraces.receiveShadow=true;
    for(let i=0;i<treads.length;i++){
      const tread=treads[i];dummy.position.set(tread.x,tread.y,tread.z);dummy.rotation.set(0,tread.yaw,0);
      dummy.scale.set(1,tread.height,tread.depth);dummy.updateMatrix();terraces.setMatrixAt(i,dummy.matrix);
      if(i%256===0&&due(pace))yield;
    }
    group.add(terraces);
  }
  // Compact light banks and their trusses are anchored at the real shell roof.
  for(const [x,z,yaw] of [[-1940,410,-Math.PI/2],[-1918,478,Math.PI],[-1848,476,Math.PI],[-1757,377,Math.PI/2],[-1810,347,0]]){
    const feet=[-3,3].map(offset=>{
      const px=x+Math.cos(yaw)*offset,pz=z-Math.sin(yaw)*offset;
      return {x:px,z:pz,y:roofAt(px,pz)};
    });
    if(feet.some(foot=>!Number.isFinite(foot.y)))continue;
    const bankY=(feet[0].y+feet[1].y)/2+9;
    for(const foot of feet){
      const base=foot.y-.1,top=bankY+.85;
      part(new THREE.CylinderGeometry(.11,.16,top-base,7),iron,foot.x,(top+base)/2,foot.z);
    }
    part(box(9,.9,.25),iron,x,bankY+.25,z,yaw);
    const towardField=Math.sign((mound[0]-x)*Math.sin(yaw)+(mound[1]-z)*Math.cos(yaw));
    const faceX=x+.18*Math.sin(yaw)*towardField,faceZ=z+.18*Math.cos(yaw)*towardField;
    for(let i=0;i<12;i++)for(let row=0;row<2;row++)part(box(.49,.4,.28),white,faceX+Math.cos(yaw)*(i-5.5)*.66,bankY+row*.5,faceZ-Math.sin(yaw)*(i-5.5)*.66,yaw);
  }
  const scoreboard=fenwayScoreboardMount(roofAt);
  if(scoreboard){
    const {x,z,yaw,feet,bottom}=scoreboard,width=24,height=5.6,depth=.9;
    for(const foot of feet){
      // Embed the foot on the slope and carry the post into the cabinet.
      const base=foot.y-.16,top=bottom+.12;
      part(box(.48,top-base,.52),iron,foot.x,(top+base)/2,foot.z,yaw);
    }
    part(box(width,height,depth),dark,x,bottom+height/2,z,yaw);
    const display=document.createElement('canvas');display.width=1024;display.height=232;
    const dc=display.getContext('2d')!;
    dc.fillStyle='#244d40';dc.fillRect(0,0,1024,232);
    dc.fillStyle='#eee9d4';dc.font='bold 64px Georgia, serif';dc.textAlign='center';
    dc.fillText('BOSTON RED SOX',512,66);
    dc.fillStyle='#142c27';dc.fillRect(12,82,1000,138);
    dc.fillStyle='#eee9d4';dc.font='bold 27px monospace';dc.textAlign='left';
    dc.fillText('VISITORS',32,162);dc.fillText('BOSTON',32,202);
    dc.textAlign='center';
    for(const [index,label] of ['1','2','3','4','5','6','7','8','9','R','H','E'].entries()){
      const column=250+index*65;
      dc.fillStyle='#b0c6ae';dc.fillText(label,column,117);
      dc.fillStyle='#f3de9d';dc.fillText('0',column,162);dc.fillText('0',column,202);
    }
    const face=new THREE.Mesh(new THREE.PlaneGeometry(width-.24,height-.24),
      new THREE.MeshStandardMaterial({map:canvasTexture(display),roughness:.75}));
    face.name='Fenway center-field scoreboard face';face.rotation.y=yaw;
    face.position.set(x+Math.sin(yaw)*(depth/2+.012),bottom+height/2,z+Math.cos(yaw)*(depth/2+.012));
    face.receiveShadow=true;group.add(face);
  }
  // Probe the walls and their terrain footings after the stadium shell is built.
  const shells=target.children.filter(o=>o instanceof THREE.Mesh&&(
    o.name==='Boston surveyed buildings'&&!Array.isArray(o.material)&&o.material.name==='Fenway red brick'||
    o.name==='Source wall footings'&&o.userData.buildingId===stadium.id));
  const wallRay=new THREE.Raycaster();wallRay.far=4;
  const glass=new THREE.MeshStandardMaterial({color:'#233c3a',roughness:.26,metalness:.34});
  const stone=new THREE.MeshStandardMaterial({color:'#c3ba9f',roughness:.87});
  const wallHit=(x:number,z:number,nx:number,nz:number,y:number)=>{
    wallRay.ray.origin.set(x+nx*2,y,z+nz*2);wallRay.ray.direction.set(-nx,0,-nz);
    return wallRay.intersectObjects(shells,false).find(h=>h.face&&h.face.normal.x*nx+h.face.normal.z*nz>.94);
  };
  type Bay={x:number;z:number;base:number;nx:number;nz:number;street:string};
  const bays:Bay[]=[];
  function wallFits(bay:Bay,width:number,bottom:number,top:number){
    const {x,z,base,nx,nz}=bay;
    for(const u of [-width/2,0,width/2])for(const v of [bottom,top]){
      const h=wallHit(x+nz*u,z-nx*u,nx,nz,base+v);
      if(!h||Math.abs(2-h.distance)>.035)return false;
    }
    return true;
  }
  for(let edge=0;edge<stadium.footprint.length;edge++){
    const a=stadium.footprint[edge],b=stadium.footprint[(edge+1)%stadium.footprint.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const tx=dx/length,tz=dz/length;
    for(let along=3.5;along<length-3;along+=7.5){
      if(due(pace))yield;
      const x=a[0]+tx*along,z=a[1]+tz*along,road=closestRoad(city,x,z,true);
      if(!road.road||road.distance>road.road.width/2+25||((road.x-x)*tz-(road.z-z)*tx)/Math.max(.1,road.distance)<.5)continue;
      const hit=wallHit(x,z,tz,-tx,fieldY+3.3);if(!hit?.face||Math.abs(2-hit.distance)>.55)continue;
      const wall=hit.point,normal=hit.face.normal,n=Math.hypot(normal.x,normal.z),nx=normal.x/n,nz=normal.z/n,yaw=Math.atan2(nx,nz);
      const base=Math.min(...[-1.7,0,1.7].map(u=>sampleElevation(city,wall.x+nz*u+nx*.22,wall.z-nx*u+nz*.22)));
      const bay={x:wall.x,z:wall.z,base,nx,nz,street:road.road.name};
      if(!wallFits(bay,3.65,.4,7.5))continue;
      const partAt=(g:Part,m:THREE.Material,u:number,y:number,d:number)=>part(g,m,wall.x+nz*u+nx*d,base+y,wall.z-nx*u+nz*d,yaw);
      partAt(box(3.05,3.9,.12),green,0,1.87,.055);
      for(const side of[-1,1])partAt(box(.18,4.2,.22),stone,side*1.65,2,.105);
      partAt(box(3.65,.24,.28),stone,0,4.18,.135);
      for(let u=-1.3;u<=1.3;u+=.27)partAt(box(.055,3.65,.08),iron,u,1.96,.14);
      partAt(box(2.9,1.5,.08),glass,0,6.45,.035);
      for(const u of[-1.5,0,1.5])partAt(box(.13,1.74,.16),green,u,6.45,.10);
      for(const y of[5.62,6.45,7.28])partAt(box(3.13,.13,.17),green,0,y,.10);
      partAt(box(3.52,.16,.3),stone,0,5.5,.14);
      bays.push(bay);
    }
  }
  function plaque(label:string,width:number,height:number,y:number,street:string,near:Point2){
    const candidates=bays.filter(b=>b.street===street);
    const distance=(b:Bay)=>Math.hypot(b.x-near[0],b.z-near[1]);
    const site=candidates.sort((a,b)=>distance(a)-distance(b)).find(b=>distance(b)<25&&wallFits(b,width,y-height/2,y+height/2));
    if(!site)return;
    const {x,z,base,nx,nz}=site;
    const face=sign(label,width,height,'#eee6cf','#254e3d');
    face.name=`Fenway street plaque: ${label} (${street})`;face.rotation.y=Math.atan2(nx,nz);
    face.position.set(x+nx*.04,base+y,z+nz*.04);face.receiveShadow=true;group.add(face);
  }
  const gateA=fenway.markers.gateA as Point2;
  plaque('GATE A   •   JERSEY STREET',5.6,.8,4.86,'Jersey Street',gateA);
  plaque('FENWAY PARK',12,1.5,8.65,'Jersey Street',gateA);
  plaque('FENWAY PARK',6.2,.95,8.5,'Van Ness Street',[-1806,482]);
  for(const mesh of batches.meshes()){
    mesh.castShadow=mesh.material!==grass&&mesh.material!==clay&&mesh.material!==track;
    mesh.receiveShadow=true;group.add(mesh);
  }
  group.userData={seats:seats.length,seatingTreads:treads.length,gateBays:bays.length,monsterHeight:fenway.dimensions.monsterHeight,sourceFeatures:fenway.features.length,source:fenway.source.url,accuracy:fenway.notes};
  target.add(group);return group;
}
