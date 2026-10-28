import * as THREE from 'three';
import type { Building, CityData, Point2 } from '../types';
import fenway from '../data/fenway-detail.json' with {type:'json'};
import { fenwayDiamond, createFenwayRoofSampler } from './fenway-layout';
import { landmarkBuildings } from '../simulation/city-tiles.ts';
export { fenwayDiamond } from './fenway-layout';
import { canvasTexture, seeded } from './materials';
import { mergeSpatialGeometries } from './spatial-batches';
import { closestRoad } from '../simulation/roads';

const FENWAY_IDS=new Set(['BOS-73AP7-T4BL0-O4QDM','BOS-DA4MQ-LLJZX-89MF5','BOS-2ZJZB-IWPEJ-JUBMC','BOS-0HKZL-2YJWH-V1GAU']);
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

function planePolygon(points:Point2[],y:number){
  const vectors=points.map(p=>new THREE.Vector2(...p)),faces=THREE.ShapeUtils.triangulateShape(vectors,[]),p:number[]=[],uv:number[]=[];
  for(const face of faces){const [a,b,c]=face.map(i=>points[i]),order=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0?[a,c,b]:[a,b,c];for(const v of order){p.push(v[0],y,v[1]);uv.push(v[0]/12,v[1]/12);}}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();return geometry;
}

/** Detailed, source-aligned field over the measured open stadium shell. */
export function addFenwayPark(scene:THREE.Scene,city:CityData){
  const stadium=landmarkBuildings(city).find(b=>b.id==='BOS-73AP7-T4BL0-O4QDM');
  const group=new THREE.Group();group.name='Fenway Park field and grandstands';if(!stadium)return group;
  const translation=(stadium.baseElevation??3.048)-3.048,fieldY=3.16+translation;
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(geometry:THREE.BufferGeometry,material:THREE.Material)=>{const list=batches.get(material)??[];list.push(geometry);batches.set(material,list);};
  const part=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,yaw=0)=>add(geometry.rotateY(yaw).translate(x,y,z),material);
  const green=new THREE.MeshStandardMaterial({color:'#245b49',roughness:.78});
  const dark=new THREE.MeshStandardMaterial({color:'#1c302b',roughness:.75,metalness:.4});
  const iron=new THREE.MeshStandardMaterial({color:'#52645b',metalness:.65,roughness:.46});
  const white=new THREE.MeshStandardMaterial({color:'#e3e0cc',roughness:.82});
  const yellow=new THREE.MeshStandardMaterial({color:'#e9b82e',roughness:.56,metalness:.15});
  const clay=new THREE.MeshStandardMaterial({color:'#a77b56',roughness:1});
  const track=new THREE.MeshStandardMaterial({color:'#997b61',roughness:1});
  const grassCanvas=document.createElement('canvas');grassCanvas.width=grassCanvas.height=512;const gc=grassCanvas.getContext('2d')!,random=seeded(1934);
  gc.fillStyle='#527d3c';gc.fillRect(0,0,512,512);gc.fillStyle='#5c8543';gc.fillRect(0,0,256,512);
  for(let i=0;i<17000;i++){gc.fillStyle=random()>.5?'#d7d79516':'#1e392119';gc.fillRect(random()*512,random()*512,1,2);}
  const grass=new THREE.MeshStandardMaterial({map:canvasTexture(grassCanvas,true),roughness:1});
  const field=feature('field'),center:Point2=[-1845,395];
  // Preserve the mapped grass edge, with a modest warning track around it.
  const trackBoundary=field.map(p=>{const dx=p[0]-center[0],dz=p[1]-center[1],d=Math.hypot(dx,dz);return[p[0]+dx/d*4.5,p[1]+dz/d*4.5] as Point2;});
  add(planePolygon(trackBoundary,fieldY),track);add(planePolygon(field,fieldY+.025),grass);
  const diamond=fenwayDiamond(),{home,first,second,third,mound,firstDirection,thirdDirection}=diamond;
  const infield:Point2[]=[home];for(let i=0;i<=40;i++){const a=i/40*Math.PI/2;infield.push([home[0]+(firstDirection[0]*Math.cos(a)+thirdDirection[0]*Math.sin(a))*40.5,home[1]+(firstDirection[1]*Math.cos(a)+thirdDirection[1]*Math.sin(a))*40.5]);}
  add(planePolygon(infield,fieldY+.045),clay);
  add(planePolygon(feature('infield'),fieldY+.065),grass);
  part(new THREE.CylinderGeometry(2.75,2.9,.14,48),clay,mound[0],fieldY+.12,mound[1]);
  part(new THREE.BoxGeometry(.61,.03,.15),white,mound[0],fieldY+.205,mound[1],Math.atan2(firstDirection[1],firstDirection[0]));
  for(const base of [first,second,third])part(new THREE.BoxGeometry(.46,.09,.46),white,base[0],fieldY+.11,base[1]);
  part(new THREE.CylinderGeometry(.29,.29,.045,5).rotateY(Math.PI),white,home[0],fieldY+.095,home[1]);
  const strip=(a:Point2,b:Point2,width:number,y:number,material:THREE.Material)=>{const dx=b[0]-a[0],dz=b[1]-a[1];part(new THREE.BoxGeometry(width,.025,Math.hypot(dx,dz)),material,(a[0]+b[0])/2,y,(a[1]+b[1])/2,Math.atan2(dx,dz));};
  for(const pole of [diamond.left,diamond.right])strip(home,pole,.12,fieldY+.082,white);
  for(const side of [-1,1]){
    const x=home[0]+thirdDirection[0]*side*.9,z=home[1]+thirdDirection[1]*side*.9;
    const corners:Point2[]=[[-.61,-.92],[.61,-.92],[.61,.92],[-.61,.92]].map(([a,b])=>[x+firstDirection[0]*a+thirdDirection[0]*b,z+firstDirection[1]*a+thirdDirection[1]*b]);
    for(let i=0;i<4;i++)strip(corners[i],corners[(i+1)%4],.065,fieldY+.084,white);
  }
  const monster=feature('monster-wall'),a=monster[0],b=monster[1],monsterLength=Math.hypot(b[0]-a[0],b[1]-a[1]),wallYaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
  part(new THREE.BoxGeometry(.58,fenway.dimensions.monsterHeight,monsterLength),green,(a[0]+b[0])/2,fieldY+fenway.dimensions.monsterHeight/2,(a[1]+b[1])/2,wallYaw);
  for(let d=0;d<=monsterLength;d+=3.1){const t=d/monsterLength;part(new THREE.BoxGeometry(.08,11.3,.11),iron,a[0]+(b[0]-a[0])*t,fieldY+5.67,a[1]+(b[1]-a[1])*t+.35);}
  // Scoreboard artwork is fictional game information on the real wall location.
  const board=document.createElement('canvas');board.width=2048;board.height=256;const bc=board.getContext('2d')!;
  bc.fillStyle='#264f42';bc.fillRect(0,0,2048,256);bc.strokeStyle='#d3dac4';bc.lineWidth=2;
  bc.font='bold 30px monospace';bc.fillStyle='#d8dfcb';bc.fillText('AMERICAN LEAGUE',35,42);
  bc.font='bold 29px monospace';bc.fillText('BOSTON',35,114);bc.fillText('VISITORS',35,171);
  for(let i=0;i<12;i++){const x=280+i*139;bc.strokeRect(x,67,123,128);bc.fillText(i<9?String(i+1):['R','H','E'][i-9],x+42,48);bc.fillText('0',x+42,114);bc.fillText('0',x+42,171);}
  const boardMaterial=new THREE.MeshStandardMaterial({map:canvasTexture(board),roughness:.75});
  part(new THREE.PlaneGeometry(33,4.13),boardMaterial,(a[0]+b[0])/2-10,fieldY+3.3,(a[1]+b[1])/2+.36,0);
  function sign(text:string,width:number,height:number,color:string,background:string){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle=background;ctx.fillRect(0,0,1024,128);ctx.fillStyle=color;ctx.font='bold 72px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,67,980);
    return new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map:canvasTexture(canvas),roughness:.69}));
  }
  const monsterTitle=sign('FENWAY PARK',19,2.37,'#e4dfc7','#245b49');monsterTitle.position.set(-1832,fieldY+8.8,347.06);group.add(monsterTitle);
  // Foul poles and short right-field barriers preserve the asymmetric silhouette.
  for(const pole of [diamond.left,diamond.right]){
    const height=pole===diamond.left?21:16;part(new THREE.CylinderGeometry(.105,.13,height,8),yellow,pole[0],fieldY+height/2,pole[1]);
    for(let y=4;y<height;y+=.8)part(new THREE.BoxGeometry(.8,.035,.035),yellow,pole[0]+.35,fieldY+y,pole[1]);
  }
  for(let i=4;i<10;i++){
    const a=trackBoundary[i],b=trackBoundary[i+1],height=i<6?5.18:1.4,dx=b[0]-a[0],dz=b[1]-a[1];
    part(new THREE.BoxGeometry(.24,height,Math.hypot(dx,dz)),green,(a[0]+b[0])/2,fieldY+height/2,(a[1]+b[1])/2,Math.atan2(dx,dz));
  }
  for(const bullpen of fenway.features.filter(f=>f.role==='bullpen')){
    add(planePolygon(bullpen.points as Point2[],fieldY+.07),grass);
    const p=bullpen.points;for(let i=0;i<p.length;i++){
      const a=p[i] as Point2,b=p[(i+1)%p.length] as Point2,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length>5)for(let j=0;j<length;j+=2){const t=j/length;part(new THREE.CylinderGeometry(.035,.035,1.65,5),iron,a[0]+dx*t,fieldY+.9,a[1]+dz*t);}
      strip(a,b,.055,fieldY+1.7,iron);
    }
  }
  const roofAt=createFenwayRoofSampler(translation);
  const seats:{x:number;y:number;z:number;yaw:number;red:boolean}[]=[];
  const treads:{x:number;y:number;z:number;yaw:number;depth:number}[]=[];
  function seatRows(a:Point2,b:Point2,out:Point2,rows:number,step=.84,overrideY?:number){
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    for(let row=0;row<rows;row++)for(let along=.6;along<length-.5;along+=.57){
      const x=a[0]+dx/length*along+out[0]*(row+.5)*step,z=a[1]+dz/length*along+out[1]*(row+.5)*step;
      const support=roofAt(x,z);if(overrideY===undefined&&!Number.isFinite(support))continue;
      const y=overrideY===undefined?Math.max(support,roofAt(x+out[0]*step*.48,z+out[1]*step*.48),roofAt(x-out[0]*step*.48,z-out[1]*step*.48))+.08:overrideY+row*.25;
      if(!Number.isFinite(y)||y>fieldY+18||y<fieldY+.7)continue;
      const yaw=Math.atan2(-out[0],-out[1]);treads.push({x,y,z,yaw,depth:step+.015});
      // Concrete stair aisles remain visible between chair sections.
      if(Math.floor(along/.57)%24<2)continue;
      seats.push({x,y,z,yaw,red:false});
    }
  }
  seatRows([-1818,349],[-1784,368],[.49,-.87],17);
  seatRows([-1784,368],[-1768,411],[.939,-.344],30);
  seatRows([-1901,438],[-1900,396],[-1,-.02],27);
  seatRows([-1883,455],[-1800,435],[.234,.972],21);
  seatRows([-1902,444],[-1883,455],[-.5,.866],23);
  seatRows([a[0],a[1]-.1],[b[0],b[1]-.1],[0,-1],3,.9,fieldY+11.5);
  if(seats.length){
    const far=seats.filter(s=>s.x> -1778&&s.z<390);if(far.length)far[Math.floor(far.length*.62)].red=true;
    const seatMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.67});
    const bottoms=new THREE.InstancedMesh(new THREE.BoxGeometry(.46,.12,.44),seatMaterial,seats.length),backs=new THREE.InstancedMesh(new THREE.BoxGeometry(.46,.47,.09),seatMaterial,seats.length),dummy=new THREE.Object3D();
    seats.forEach((seat,i)=>{
      dummy.rotation.set(0,seat.yaw,0);dummy.position.set(seat.x,seat.y+.42,seat.z);dummy.updateMatrix();bottoms.setMatrixAt(i,dummy.matrix);
      dummy.position.set(seat.x-Math.sin(seat.yaw)*.2,seat.y+.68,seat.z-Math.cos(seat.yaw)*.2);dummy.updateMatrix();backs.setMatrixAt(i,dummy.matrix);
      const color=new THREE.Color(seat.red?'#be3e36':i%7?'#4c805d':'#618e6e');bottoms.setColorAt(i,color);backs.setColorAt(i,color);
    });bottoms.castShadow=backs.castShadow=true;bottoms.receiveShadow=backs.receiveShadow=true;group.add(bottoms,backs);
    bottoms.name='Fenway green seat pans';backs.name='Fenway green seat backs';
    const terraces=new THREE.InstancedMesh(new THREE.BoxGeometry(.58,.16,1),new THREE.MeshStandardMaterial({color:'#a6aaa0',roughness:.96}),treads.length);
    terraces.name='Fenway concrete seating treads';terraces.receiveShadow=true;
    treads.forEach((tread,i)=>{dummy.position.set(tread.x,tread.y-.08,tread.z);dummy.rotation.set(0,tread.yaw,0);dummy.scale.set(1,1,tread.depth);dummy.updateMatrix();terraces.setMatrixAt(i,dummy.matrix);});
    group.add(terraces);
  }
  // Compact light banks and their trusses are anchored at the real shell roof.
  for(const [x,z,yaw] of [[-1940,410,-Math.PI/2],[-1918,478,Math.PI],[-1848,476,Math.PI],[-1757,377,Math.PI/2],[-1810,347,0]]){
    const roof=roofAt(x,z),base=Number.isFinite(roof)?roof:fieldY+18;
    for(const side of [-1,1])part(new THREE.CylinderGeometry(.11,.16,10,7),iron,x+Math.cos(yaw)*side*3,base+5,z-Math.sin(yaw)*side*3);
    part(new THREE.BoxGeometry(9,.3,.45),iron,x,base+9,z,yaw);
    for(let i=0;i<12;i++)for(let row=0;row<2;row++)part(new THREE.BoxGeometry(.49,.4,.28),white,x+Math.cos(yaw)*(i-5.5)*.66,base+9+row*.5,z-Math.sin(yaw)*(i-5.5)*.66,yaw);
  }
  const scoreboard=sign('BOSTON RED SOX',25,3.12,'#eee9d4','#1e3b32');scoreboard.position.set(fenway.markers.centerScoreboard[0],fieldY+22,fenway.markers.centerScoreboard[1]);scoreboard.rotation.y=Math.atan2(home[0]-scoreboard.position.x,home[1]-scoreboard.position.z);group.add(scoreboard);
  const exterior=sign('FENWAY PARK',18,2.25,'#ece3c9','#294e3e');exterior.position.set(-1958,13.7+translation,435);exterior.rotation.y=-Math.PI/2-.37;group.add(exterior);
  const gate=sign('GATE A   •   JERSEY STREET',12,1.5,'#e3dfc7','#264b3b');gate.position.set(-1933,8.1+translation,498);group.add(gate);
  // Original stadium gate/window bays fitted to actual street-facing brick
  // planes. A missing source wall never becomes an invented floating facade.
  const shells=scene.children.filter(o=>o instanceof THREE.Mesh&&o.name==='Boston surveyed buildings'&&!Array.isArray(o.material)&&o.material.name==='Fenway red brick');
  const wallRay=new THREE.Raycaster(),glass=new THREE.MeshStandardMaterial({color:'#233c3a',roughness:.26,metalness:.34});
  const stone=new THREE.MeshStandardMaterial({color:'#c3ba9f',roughness:.87});let gateBays=0,streetTitle=false;
  const wallDepth=(x:number,z:number,nx:number,nz:number,y:number)=>{
    wallRay.set(new THREE.Vector3(x+nx*2,y,z+nz*2),new THREE.Vector3(-nx,0,-nz));wallRay.far=4;
    const hit=wallRay.intersectObjects(shells,false).find(h=>h.face&&h.face.normal.x*nx+h.face.normal.z*nz>.94);
    return hit?2-hit.distance:undefined;
  };
  for(let edge=0;edge<stadium.footprint.length;edge++){
    const a=stadium.footprint[edge],b=stadium.footprint[(edge+1)%stadium.footprint.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<7)continue;
    const tx=dx/length,tz=dz/length,nx=tz,nz=-tx,yaw=Math.atan2(nx,nz);
    for(let along=3.5;along<length-3;along+=7.5){
      const x=a[0]+tx*along,z=a[1]+tz*along,road=closestRoad(city,x,z,true);
      if(road.distance>road.road.width/2+25||((road.x-x)*nx+(road.z-z)*nz)/Math.max(.1,road.distance)<.5)continue;
      const depth=wallDepth(x,z,nx,nz,fieldY+3.3);if(depth===undefined||Math.abs(depth)>.55)continue;
      const probes=[-1.8,1.8].flatMap(u=>[1,7.5].map(y=>wallDepth(x+tx*u,z+tz*u,nx,nz,fieldY+y)));
      if(probes.some(hit=>hit===undefined||Math.abs(hit-depth)>.15))continue;
      const bay=(g:THREE.BufferGeometry,m:THREE.Material,u:number,y:number,d=.1)=>part(g,m,x+tx*u+nx*(depth+d),fieldY+y,z+tz*u+nz*(depth+d),yaw);
      bay(new THREE.BoxGeometry(3.05,3.5,.12),green,0,2.1);
      for(const side of[-1,1])bay(new THREE.BoxGeometry(.18,3.8,.22),stone,side*1.65,2.16,.15);
      bay(new THREE.BoxGeometry(3.65,.24,.28),stone,0,4.18,.17);
      for(let u=-1.3;u<=1.3;u+=.27)bay(new THREE.BoxGeometry(.055,3.2,.08),iron,u,2.13,.20);
      bay(new THREE.BoxGeometry(2.9,1.5,.08),glass,0,6.45);
      for(const u of[-1.5,0,1.5])bay(new THREE.BoxGeometry(.13,1.74,.16),green,u,6.45,.16);
      for(const y of[5.62,6.45,7.28])bay(new THREE.BoxGeometry(3.13,.13,.17),green,0,y,.17);
      bay(new THREE.BoxGeometry(3.52,.16,.3),stone,0,5.5,.21);
      if(!streetTitle&&/Van Ness/i.test(road.road.name)){
        const title=sign('FENWAY PARK',6.2,.95,'#eee6cf','#254e3d');title.position.set(x+nx*(depth+.16),fieldY+8.5,z+nz*(depth+.16));title.rotation.y=yaw;group.add(title);streetTitle=true;
      }
      gateBays++;
    }
  }
  for(const [material,geometry]of batches){
    const normalized=geometry.map(g=>g.index?g.toNonIndexed():g);
    for(const mesh of mergeSpatialGeometries(normalized,material,300)){mesh.castShadow=material!==grass&&material!==clay&&material!==track;mesh.receiveShadow=true;group.add(mesh);}
    geometry.forEach(g=>g.dispose());
  }
  group.userData={seats:seats.length,seatingTreads:treads.length,gateBays,monsterHeight:fenway.dimensions.monsterHeight,sourceFeatures:fenway.features.length,source:fenway.source.url,accuracy:fenway.notes};
  scene.add(group);return group;
}
