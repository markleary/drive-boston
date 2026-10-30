import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Building,CityData} from '../types';
import {sampleElevation} from '../simulation/terrain.ts';
import {canvasTexture,seeded} from './materials.ts';
import {landmarkBuildings} from '../simulation/city-tiles.ts';

export const SYMPHONY_HALL_ID='BOS-383I7-LINV0-9U4AI';
export const isSymphonyHall=(building?:Building)=>building?.id===SYMPHONY_HALL_ID;
// Frame measured from the bundled Boston mesh: the hall's east corner at
// Massachusetts and Huntington avenues. Local x (b) runs south-west along the
// Huntington Avenue portico front, local z (a) north-west along the
// Massachusetts Avenue street wall. Heights are metres above the mesh base.
const CORNER={x:-852.82,z:818.18},YAW=-2.3011,BASE=.874,cs=Math.cos(YAW),sn=Math.sin(YAW);
/** World position of a point b metres along Huntington Avenue and a metres along Massachusetts Avenue from the corner. */
export const symphonyHallPoint=(b:number,a:number)=>({x:CORNER.x+cs*b+sn*a,z:CORNER.z-sn*b+cs*a});
type ShellSurface='brick'|'copper'|'membrane';

/** Material-only partition that keeps every surveyed vertex, normal and UV:
 * walls, attic and pediment are brick; the pitched auditorium roof is copper,
 * the flat roofs membrane. */
export function splitSymphonyHallShell(geometry:THREE.BufferGeometry,building:Building,isRoof:boolean){
  const source=geometry.index?geometry.toNonIndexed():geometry;
  const p=source.getAttribute('position'),groups=new Map<ShellSurface,number[]>(),eaves=(building.baseElevation??BASE)+19;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<p.count;i+=3){
    let kind:ShellSurface='brick';
    if(isRoof){
      a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
      const y=(a.y+b.y+c.y)/3,normal=b.sub(a).cross(c.sub(a)).normalize();
      kind=normal.y<.97&&y>eaves?'copper':'membrane';
    }
    const indices=groups.get(kind)??[];indices.push(i,i+1,i+2);groups.set(kind,indices);
  }
  const parts=[...groups].map(([kind,indices])=>{
    const part=new THREE.BufferGeometry();
    for(const [name,attribute]of Object.entries(source.attributes)){
      const values=new Float32Array(indices.length*attribute.itemSize);
      indices.forEach((index,j)=>{for(let k=0;k<attribute.itemSize;k++)values[j*attribute.itemSize+k]=attribute.getComponent(index,k);});
      part.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize));
    }
    return{kind,geometry:part};
  });
  if(source!==geometry)source.dispose();
  return parts;
}

/** Original metric textures: Flemish-bond red brick at six metres per tile (a
 * stretcher and a darker header every 30 cm, 88 courses), verdigris copper and
 * grey membrane for the roofs. Reference photographs guide the palette only. */
export function createSymphonyHallMaterials(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const c=canvas.getContext('2d')!,random=seeded(1900);
  c.fillStyle='#b3a48f';c.fillRect(0,0,1024,1024);
  const courses=88,ch=1024/courses,period=51.2,joint=1.6;
  for(let row=0;row<courses;row++){
    const y=row*ch,offset=(row%2)*period/2,tones=Array.from({length:20},()=>[(random()-.5)*28,(random()-.5)*20]);
    for(let k=-1;k<20;k++){
      const [s,h]=tones[(k+20)%20],x=k*period+offset;
      c.fillStyle=`rgb(${126+s},${61+s*.6},${48+s*.5})`;c.fillRect(x+joint,y+joint,period*2/3-joint,ch-joint);
      c.fillStyle=`rgb(${96+h},${50+h*.6},${46+h*.5})`;c.fillRect(x+period*2/3+joint,y+joint,period/3-joint,ch-joint);
    }
  }
  const map=canvasTexture(canvas,true);
  return {brick:new THREE.MeshStandardMaterial({map,roughness:.93,metalness:0}),copper:new THREE.MeshStandardMaterial({color:'#79a58f',roughness:.62,metalness:.22}),membrane:new THREE.MeshStandardMaterial({color:'#c9c9c4',roughness:.9})};
}

function marqueeLettering(){
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=32;const c=canvas.getContext('2d')!;
  c.fillStyle='#f1e7cd';c.fillRect(0,0,2048,32);c.fillStyle='#2a221c';c.font='bold 26px Georgia, serif';c.textAlign='center';c.textBaseline='middle';c.fillText('S Y M P H O N Y   H A L L',1024,17);
  const map=canvasTexture(canvas);return new THREE.MeshStandardMaterial({map,emissive:'#ffffff',emissiveMap:map,emissiveIntensity:.45,roughness:.6});
}

/** McKim, Mead & White's 1900 Renaissance Revival hall, interpreted on the
 * surveyed shell: the Huntington Avenue portico (seven Ionic columns, six
 * double doors, garland attic, pediment with oculus), the Massachusetts Avenue
 * street wall (seven round-headed bays under a lit marquee), the auditorium
 * clerestory, the St Stephen Street gable and the Huntington Avenue annex.
 * Reference: Wikimedia Commons photographs of the exterior, not bundled.
 * Ornament is simplified; nothing here collides. */
export function addSymphonyHallFacade(scene:THREE.Scene,city:CityData){
  const hall=landmarkBuildings(city).find(isSymphonyHall);if(!hall)return;
  const group=new THREE.Group();group.name='Symphony Hall - McKim, Mead & White facades';
  const base=hall.baseElevation??BASE;
  const limestone=new THREE.MeshStandardMaterial({color:'#d8cfb8',roughness:.8});
  const field=new THREE.MeshStandardMaterial({color:'#cbc0a6',roughness:.84});
  const granite=new THREE.MeshStandardMaterial({color:'#9a9a92',roughness:.9});
  const glass=new THREE.MeshStandardMaterial({color:'#24363a',emissive:'#9e7843',emissiveIntensity:.16,metalness:.2,roughness:.3});
  const wood=new THREE.MeshStandardMaterial({color:'#5e4028',roughness:.7});
  const marble=new THREE.MeshStandardMaterial({color:'#3f4b47',roughness:.45,metalness:.08});
  const metal=new THREE.MeshStandardMaterial({color:'#2a2d2b',metalness:.5,roughness:.5});
  const lit=new THREE.MeshStandardMaterial({color:'#f1e7cd',emissive:'#f1e7cd',emissiveIntensity:.45,roughness:.6});
  const fascia=marqueeLettering();
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material,b:number,y:number,a:number)=>{g.translate(b,y+base,a);g.rotateY(YAW);g.translate(CORNER.x,0,CORNER.z);const list=batches.get(m)??[];list.push(g);batches.set(m,list);};
  const ground=(b:number,a:number)=>{const p=symphonyHallPoint(b,a);return sampleElevation(city,p.x,p.z)-base;};
  // Each wall places geometry authored facing +z (towards the street) at s
  // metres along it, y above the base and `out` metres proud of the surveyed
  // plane; `dir` is the s direction a viewer on the street sees as their right.
  type Put=((g:THREE.BufferGeometry,m:THREE.Material,s:number,y:number,out:number)=>void)&{dir:number};
  const wall=(facing:number,dir:number,at:(s:number,out:number)=>[number,number]):Put=>Object.assign((g:THREE.BufferGeometry,m:THREE.Material,s:number,y:number,out:number)=>{g.rotateY(facing);const [b,a]=at(s,out);add(g,m,b,y,a);},{dir});
  const portico=wall(Math.PI,-1,(b,out)=>[b,-.45-out]),pavilions=wall(Math.PI,-1,(b,out)=>[b,.05-out]);
  const massAve=wall(-Math.PI/2,1,(a,out)=>[-out,a]),clerestoryNE=wall(-Math.PI/2,1,(a,out)=>[10.2-out,a]);
  const clerestorySW=wall(Math.PI/2,-1,(a,out)=>[35.7+out,a]),alley=wall(Math.PI/2,-1,(a,out)=>[45.8+out,a]);
  const stStephen=wall(0,1,(b,out)=>[b,64.3+out]),gable=wall(0,1,(b,out)=>[b,64.24+out]);
  const annex=wall(Math.PI,-1,(b,out)=>[b,.1-out]),annexEnd=wall(Math.PI/2,-1,(a,out)=>[173+out,a]);
  const box=(put:Put,m:THREE.Material,s:number,y:number,out:number,w:number,h:number,d:number)=>put(new THREE.BoxGeometry(w,h,d),m,s,y,out);
  const slab=(put:Put,m:THREE.Material,s:number,y0:number,y1:number,w:number,d:number,back=0)=>box(put,m,s,(y0+y1)/2,back+d/2,w,y1-y0,d);
  const disk=(put:Put,m:THREE.Material,s:number,y:number,out:number,r:number,d:number)=>put(new THREE.CylinderGeometry(r,r,d,28).rotateX(Math.PI/2),m,s,y,out+d/2);
  const archShape=(w:number,h:number)=>{const shape=new THREE.Shape(),r=w/2;shape.moveTo(-r,0);shape.lineTo(r,0);shape.lineTo(r,h-r);shape.absarc(0,h-r,r,0,Math.PI,false);shape.lineTo(-r,0);return shape;};
  const archWindow=(put:Put,s:number,sill:number,w:number,h:number,jamb:number,key=true,back=0)=>{
    const ring=archShape(w+2*jamb,h+jamb);ring.holes.push(archShape(w,h));
    put(new THREE.ExtrudeGeometry(ring,{depth:.24,bevelEnabled:false,curveSegments:14}),limestone,s,sill,back);
    put(new THREE.ShapeGeometry(archShape(w,h),14),glass,s,sill,back+.05);
    if(w>1){box(put,limestone,s,sill+h/2-.05,back+.09,.08,h-.1,.05);box(put,limestone,s,sill+h*.4,back+.09,w,.07,.05);}
    if(key)box(put,limestone,s,sill+h-.05,back+.17,w*.16+.2,.8,.34);
    slab(put,limestone,s,sill-.3,sill-.05,w+2*jamb+.4,.32,back);
  };
  const sash=(put:Put,s:number,sill:number,w:number,h:number,back=0)=>{
    slab(put,limestone,s,sill-.05,sill+h+.2,w+.5,.16,back);slab(put,glass,s,sill,sill+h,w,.08,back+.12);
    box(put,limestone,s,sill+h/2,back+.2,.07,h,.05);box(put,limestone,s,sill+h*.55,back+.2,w,.07,.05);
    slab(put,limestone,s,sill-.35,sill-.05,w+.8,.32,back);
  };
  const door=(put:Put,s:number,floor:number,w:number,h:number,transom=.5)=>{
    slab(put,wood,s,floor,floor+h,w,.12,.16);box(put,metal,s,floor+h/2,.3,.06,h-.1,.05);
    if(transom)slab(put,glass,s,floor+h+.05,floor+h+transom,w,.08,.18);
    const top=floor+h+(transom?transom+.05:0);
    for(const side of [-1,1])slab(put,limestone,s+side*(w/2+.17),floor,top+.02,.34,.4);
    slab(put,limestone,s,top,top+.45,w+.9,.42);return top+.45;
  };
  const column=(put:Put,s:number,out:number)=>{
    box(put,limestone,s,.22,out,1.3,.24,1.3);put(new THREE.CylinderGeometry(.6,.66,.2,24),limestone,s,.44,out);
    put(new THREE.CylinderGeometry(.46,.54,9.1,24),limestone,s,5.09,out);put(new THREE.CylinderGeometry(.6,.48,.4,24),limestone,s,9.84,out);
    for(const side of [-1,1])put(new THREE.TorusGeometry(.2,.1,8,20),limestone,s+side*.62,9.9,out);
    box(put,limestone,s,10.29,out,1.36,.46,1.36);
  };
  const cornice=(put:Put,center:number,width:number,y:number,top:number,depth:number,dentil=.5)=>{
    for(let s=center-width/2+.25;s<center+width/2;s+=dentil)box(put,limestone,s,y+.14,.15,.25,.28,.3);
    slab(put,limestone,center,y+.28,top-.3,width+.2,depth);slab(put,limestone,center,top-.3,top,width+.4,depth+.2);
  };
  const raking=(put:Put,sApex:number,yApex:number,sCorner:number,yCorner:number)=>{
    const ex=put.dir*(sCorner-sApex),dy=yCorner-yApex,g=new THREE.BoxGeometry(Math.hypot(ex,dy)+.6,.42,.6);
    g.rotateZ(Math.atan2(dy,ex));put(g,limestone,(sApex+sCorner)/2,(yApex+yCorner)/2+.3,.3);
  };
  const oculus=(put:Put,s:number,y:number,r:number)=>{put(new THREE.TorusGeometry(r+.1,.16,10,32),limestone,s,y,.16);disk(put,glass,s,y,.02,r,.08);};
  const pavilion=(put:Put,center:number,width:number,floor?:number)=>{
    if(floor!==undefined){door(put,center,floor,1.8,3.2,.45);slab(put,limestone,center,floor+4.2,floor+4.5,3.4,.5);slab(put,granite,center,floor-.2,floor,2.8,.5);}
    else sash(put,center,1.6,1.5,2.2);
    slab(put,limestone,center,4.9,5.25,width,.2);archWindow(put,center,6.2,1.3,2.3,.28,false);
    for(const side of [-1,1])slab(put,limestone,center+side*1.55,9.4,12.2,.3,.16);
    slab(put,limestone,center,9.4,9.7,3.4,.16);slab(put,limestone,center,11.9,12.2,3.4,.16);
    slab(put,limestone,center,13.2,13.5,width+.3,.35);slab(put,limestone,center,13.5,13.97,width+.5,.6);
  };
  const plinth=(put:Put,s0:number,s1:number)=>slab(put,granite,(s0+s1)/2,-2,.7,s1-s0,.14);
  // Steps are grounded segment by segment on the sampled sidewalk.
  const flight=(put:Put,s0:number,s1:number,top:number,out0:number,riser:number,tread:number,groundAt:(s:number,out:number)=>number,segments:number)=>{
    for(let seg=0;seg<segments;seg++){
      const a0=s0+(s1-s0)*seg/segments,a1=a0+(s1-s0)/segments,sc=(a0+a1)/2;
      for(let i=0;i<14;i++){const y=top-(i+1)*riser,out=out0+i*tread,g=groundAt(sc,out+tread)-.1;if(y<=g)break;put(new THREE.BoxGeometry(a1-a0,y-g,tread),granite,sc,(y+g)/2,out+tread/2);}
    }
  };
  // Huntington Avenue: granite base, the broad flight, seven Ionic columns and
  // six double doors under the limestone entablature, framed by end pavilions.
  plinth(pavilions,0,9.68);plinth(pavilions,36.37,45.65);
  slab(portico,granite,23.03,-2,.1,26.7,1.9);
  flight(portico,10.2,35.8,.1,1.9,.19,.25,(b,out)=>ground(b,-.45-out),6);
  for(let i=0;i<7;i++)column(portico,11.58+3.81*i,1.2);
  const BAYS=[13.49,17.3,21.1,24.9,28.7,32.5];
  BAYS.forEach((b,k)=>{
    door(portico,b,.1,2.3,3.6,.55);
    if(k%2){disk(portico,limestone,b,6.45,0,.74,.08);disk(portico,marble,b,6.45,.06,.58,.1);}
    else{slab(portico,limestone,b,5.9,7,1.9,.12);slab(portico,field,b,6.05,6.85,1.6,.16);}
  });
  slab(portico,limestone,23.03,10.52,11.4,26.7,2);slab(portico,limestone,23.03,11.4,12.35,26.7,1.9);
  for(const b of [10.7,35.3])portico(new THREE.TorusGeometry(.34,.08,8,24),limestone,b,11.87,1.95);
  slab(portico,limestone,23.03,12.35,12.65,26.9,2.15);
  for(let b=9.9;b<36.3;b+=.36)box(portico,limestone,b,12.8,2.2,.2,.3,.3);
  slab(portico,limestone,23.03,12.95,13.5,27.3,2.6);slab(portico,limestone,23.03,13.5,13.97,27.6,2.9);
  pavilion(pavilions,4.84,9.68,ground(4.84,-.4)+.15);pavilion(pavilions,41.01,9.28,ground(41.01,-.4)+.15);
  // Attic with the garland parapet, inscription panel and marble squares, then
  // the brick pediment with its corbel table, raking cornices and oculus.
  slab(portico,limestone,23.03,13.97,15.3,26.7,.16);
  for(let i=0;i<7;i++){const b=11.58+3.81*i;disk(portico,field,b,14.63,.16,.36,.06);if(i<6)slab(portico,field,b+1.9,14.4,14.86,1.3,.06,.16);}
  slab(portico,limestone,23.03,15.3,15.58,27,.24);slab(portico,limestone,23.03,21.5,21.8,27,.24);
  slab(portico,limestone,23.03,18,21,17,.12);slab(portico,field,23.03,18.3,20.7,16.4,.16);
  for(const side of [-1,1]){slab(portico,limestone,23.03+side*10.5,18.55,20.65,2.1,.1);slab(portico,marble,23.03+side*10.5,18.8,20.4,1.6,.16);}
  slab(portico,limestone,23.03,22.6,22.85,26.7,.2);
  for(let b=9.95;b<36.3;b+=.5)box(portico,limestone,b,23,.15,.3,.3,.3);
  slab(portico,limestone,23.03,23.15,23.6,27.4,.6);
  raking(portico,23.03,28.6,9.68,23.44);raking(portico,23.03,28.6,36.38,23.44);
  oculus(portico,23.03,26,1);box(portico,limestone,23.03,28.95,.35,1.1,.9,.7);
  for(const b of [9.9,36.15])box(portico,limestone,b,23.85,.35,.9,.6,.7);
  // Massachusetts Avenue: the two-storey street wall with seven round-headed
  // bays (the taller entrance arch in the middle) over doors and paired
  // windows, the lit marquee on its chains, the corner pavilion and the
  // plainer stage end.
  plinth(massAve,0,64.16);pavilion(massAve,4.75,9.5);
  const ARCHES=[12.95,17.55,22.15,26.75,31.35,35.95,40.55];
  ARCHES.forEach((a,i)=>{
    if(i===3){archWindow(massAve,a,4.5,4.6,6.4,.45);door(massAve,a,0,3.2,3.8,0);}
    else{archWindow(massAve,a,6.4,3.2,3.8,.35);if(i===0||i===6)for(const side of [-1,1])sash(massAve,a+side*.9,2,1,1.6);else door(massAve,a,0,2.4,3.3,.45);}
  });
  slab(massAve,limestone,26.75,8.45,8.75,32.6,.22);slab(massAve,limestone,26.75,6.05,6.35,32.6,.26);
  flight(massAve,15.5,38,0,0,.17,.3,(a,out)=>ground(-out,a),3);
  slab(massAve,metal,26.75,3.9,4.35,22.5,3,.1);massAve(new THREE.PlaneGeometry(22.2,.34),fascia,26.75,4.125,3.11);
  for(const side of [-1,1]){const g=new THREE.PlaneGeometry(2.9,.34);g.rotateY(side*Math.PI/2);massAve(g,lit,26.75+side*11.26,4.125,1.6);}
  for(const a of [16.5,20.6,24.7,28.8,32.9,37]){const g=new THREE.BoxGeometry(.05,4.25,.05);g.rotateX(-Math.atan2(2.9,3.15));massAve(g,metal,a,5.9,1.5);}
  for(const a of [48,52.5,58.5]){sash(massAve,a,7,1.5,2.4);sash(massAve,a,2,1.3,1.8);}
  const stageDoor=ground(-.5,61.5)+.05;door(massAve,61.5,stageDoor,1.6,2.8,0);
  {const g=new THREE.BoxGeometry(2.6,.08,1.3);g.rotateX(-.3);massAve(g,metal,61.5,stageDoor+3.5,.6);}
  cornice(massAve,36.83,54.66,12.75,13.97,.55);
  // Auditorium clerestory on both flanks, the St Stephen Street gable and
  // wall, the alley wall and the long Huntington Avenue annex.
  const CLER=[14.06,20.37,26.69,33,39.31,45.63,51.94];
  for(const put of [clerestoryNE,clerestorySW]){
    for(const a of CLER)archWindow(put,a,16.1,3,3.9,.32);
    for(let i=0;i<6;i++){const a=(CLER[i]+CLER[i+1])/2;disk(put,limestone,a,21.1,0,.6,.08);disk(put,marble,a,21.1,.06,.46,.1);}
    slab(put,limestone,33.05,15.75,16.05,44.3,.22);cornice(put,33.05,44.3,22.35,23.09,.5,.6);
  }
  slab(gable,limestone,23.05,16.6,21.6,11,.1);
  for(let i=0;i<6;i++)archWindow(gable,23.05+(i-2.5)*1.6,17.6,.75,3.4,.18,false,.1);
  slab(gable,limestone,23,15.3,15.58,26.7,.24);slab(gable,limestone,23,22.6,22.85,26.7,.2);
  for(let b=9.95;b<36.3;b+=.5)box(gable,limestone,b,23,.15,.3,.3,.3);
  slab(gable,limestone,23,23.15,23.6,27.4,.6);raking(gable,22.9,28.6,11.06,23.44);raking(gable,22.9,28.6,36.2,23.44);
  oculus(gable,22.9,26,.8);box(gable,limestone,22.9,28.95,.35,1.1,.9,.7);
  plinth(stStephen,0,45.9);cornice(stStephen,22.95,45.9,12.75,13.97,.5);
  for(const b of [5,12,19,26,33,40])sash(stStephen,b,7,1.6,2.6);
  for(const b of [5,12,33,40])sash(stStephen,b,2,1.4,1.8);
  door(stStephen,22.5,ground(22.5,64.8)+.05,3.4,3.8,0);
  plinth(alley,33.6,64.5);cornice(alley,49.05,30.9,12.75,13.97,.5);
  for(const a of [37,43,49,55,61]){sash(alley,a,7,1.4,2.2);sash(alley,a,2,1.2,1.6);}
  plinth(annex,47.5,173);plinth(annexEnd,0,33.6);
  slab(annex,limestone,110.25,3.1,3.35,125.5,.2);slab(annex,limestone,110.25,9.4,9.9,125.9,.5);slab(annexEnd,limestone,16.8,9.4,9.9,33.8,.5);
  for(let i=0;i<20;i++){const b=51.5+6.2*i;archWindow(annex,b,3.6,2.2,3.1,.3);sash(annex,b,.9,1.6,1.7);}
  let triangles=0;
  for(const [material,geometries]of batches){
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(normalized,false);if(!geometry)continue;
    geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);triangles+=geometry.getAttribute('position').count/3;
    new Set([...geometries,...normalized]).forEach(g=>g.dispose());
  }
  group.userData={buildingId:hall.id,columns:7,doorBays:BAYS.length,streetArches:ARCHES.length,clerestoryWindows:CLER.length*2,annexBays:20,triangles,reference:'https://commons.wikimedia.org/wiki/Category:Symphony_Hall_(Boston)'};
  scene.add(group);return group;
}
