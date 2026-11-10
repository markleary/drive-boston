import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {CityArea,CityData,ParkPath,Point2} from '../types';
import {pointInside} from '../simulation/roads.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {canopyHitsDeck,PARK_CANOPY} from '../simulation/deck-canopy.ts';
import {isCommonwealthMall,mallPathTest,monumentYaw,planMall,MALL_WALK_HALF,WOMENS_MEMORIAL_RADIUS,type MallMonumentId} from '../simulation/commonwealth-mall.ts';
import {DrapedSurface} from './draped-surface.ts';
import {PartBatches,box,type Part} from './geometry-writer.ts';
import {due,type Pace} from './pacing.ts';
import type {TreePlanting} from './foliage';

/** The Commonwealth Avenue Mall's furnishings, drawn from the plan in `src/simulation/commonwealth-mall.ts`: the
 * iron fence across each end of a block, benches along the centre walk, the four rows of trees and the nine
 * monuments. The lawn is the park renderer's; the walk is the surveyed sidewalk polygon the tile builder drapes.
 * Fence, benches and monuments are original procedural interpretations of the published photographs: the sites
 * are surveyed, the forms are massing studies, not portraits. */

export type MallFinish='granite'|'pale'|'black'|'sandstone'|'bronze';
export interface MonumentModel {
  /** Local metres: the ground at the origin, the monument facing +z. */ parts:{geometry:THREE.BufferGeometry;finish:MallFinish}[];
  /** Solid boxes for collision, in the same frame: centre x and z, width across, depth along the facing, height, turn about the vertical. */
  solids:{x:number;z:number;w:number;d:number;h:number;yaw?:number}[];
  height:number;
}
/** A box collider as `DrivingPhysics.addParapets` takes it: `length` runs along the heading `yaw`. */
export interface SolidBox { x:number; y:number; z:number; yaw:number; slope:number; length:number; width:number; height:number; }

type V3=[number,number,number];
type Arm='down'|'hip'|'chest'|'forward'|'brow'|'out'|'lap'|'rest'|'chin';
type Robe='coat'|'cloak'|'gown'|'none';
interface FigureOptions { height:number; seated?:boolean; robe?:Robe; left?:Arm; right?:Arm; }
const UP=new THREE.Vector3(0,1,0),ONE=new THREE.Vector3(1,1,1);
// Profiles in fractions of the standing height: radius and height, hem to collar (the first point closes the hem).
const ROBES:Record<Robe,{profile:number[][];depth:number;hem:number}>={
  coat:{profile:[[0,.3],[.112,.3],[.104,.42],[.098,.52],[.086,.62],[.104,.73],[.122,.8],[.09,.835],[.038,.86],[.034,.885]],depth:.66,hem:.3},
  cloak:{profile:[[0,.05],[.165,.05],[.15,.3],[.132,.56],[.128,.74],[.125,.8],[.085,.84],[.038,.865],[.034,.885]],depth:.78,hem:.05},
  gown:{profile:[[0,.02],[.15,.02],[.12,.3],[.098,.5],[.078,.62],[.094,.72],[.108,.79],[.08,.83],[.034,.86],[.03,.885]],depth:.7,hem:.02},
  none:{profile:[[0,.5],[.098,.5],[.086,.62],[.104,.73],[.122,.8],[.09,.835],[.038,.86],[.034,.885]],depth:.62,hem:.5},
};
const SEATED=[[0,.25],[.105,.25],[.1,.3],[.088,.4],[.104,.5],[.122,.565],[.09,.6],[.038,.625],[.034,.65]];
// Elbow and wrist per pose, for the left arm (+x); the right mirrors them.
const ARMS:Record<Arm,[V3,V3]>={
  down:[[.158,.63,-.005],[.152,.49,.035]],hip:[[.215,.655,-.035],[.125,.565,.03]],chest:[[.165,.635,.035],[.035,.7,.105]],
  forward:[[.155,.64,.05],[.14,.615,.21]],brow:[[.205,.865,.075],[.07,.948,.085]],out:[[.2,.68,.08],[.3,.72,.2]],
  lap:[[.165,.4,.03],[.09,.335,.2]],rest:[[.175,.4,-.02],[.17,.37,.2]],chin:[[.16,.42,.08],[.05,.6,.1]],
};
function limb(out:THREE.BufferGeometry[],a:V3,b:V3,r0:number,r1:number){
  const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),length=d.length();
  out.push(new THREE.CylinderGeometry(r1,r0,length,8,1,true).applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(UP,d.normalize()),ONE)),
    new THREE.SphereGeometry(r1,6,4).translate(B.x,B.y,B.z));
}
/** A robed standing or seated figure as one smooth mesh (about 700 triangles): a turned body flattened front to
 * back, limbs as tapered tubes with ball joints, an oval head. Feet on the ground at the origin, facing +z. */
export function statueFigure(o:FigureOptions){
  const parts:THREE.BufferGeometry[]=[],robe=ROBES[o.robe??'coat'],profile=o.seated?SEATED:robe.profile,depth=o.seated?.66:robe.depth;
  parts.push(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),12).applyMatrix4(new THREE.Matrix4().makeScale(1,1,depth)));
  const shoulder=o.seated?.56:.795,head=o.seated?.703:.938;
  parts.push(new THREE.SphereGeometry(.064,10,8).applyMatrix4(new THREE.Matrix4().makeScale(.92,1.16,1).setPosition(0,head,.008)));
  for(const side of [1,-1]){
    if(o.seated){
      const knee:V3=[side*.075,.295,.27];limb(parts,[side*.062,.3,.02],knee,.055,.047);limb(parts,knee,[side*.078,.04,.3],.044,.035);
      parts.push(new THREE.BoxGeometry(.075,.045,.17).translate(side*.078,.0225,.34));
    }else if(robe.hem>.08){
      limb(parts,[side*.055,robe.hem+.03,0],[side*.055,.045,0],.05,.036);
      parts.push(new THREE.BoxGeometry(.075,.045,.17).translate(side*.055,.0225,.03));
    }
    const [elbow,wrist]=ARMS[(side>0?o.left:o.right)??(o.seated?'lap':'down')],drop=o.seated&&!['lap','rest','chin'].includes((side>0?o.left:o.right)??'lap')?-.235:0;
    const e:V3=[elbow[0]*side,elbow[1]+drop,elbow[2]],w:V3=[wrist[0]*side,wrist[1]+drop,wrist[2]];
    limb(parts,[side*.128,shoulder,0],e,.04,.034);limb(parts,e,w,.034,.03);
  }
  for(const g of parts)g.deleteAttribute('uv');
  const merged=mergeGeometries(parts,false)!;for(const g of parts)g.dispose();
  return merged.applyMatrix4(new THREE.Matrix4().makeScale(o.height,o.height,o.height));
}
const block=(w:number,h:number,d:number,x:number,y:number,z:number,yaw=0)=>{const g=new THREE.BoxGeometry(w,h,d);g.deleteAttribute('uv');if(yaw)g.rotateY(yaw);return g.translate(x,y+h/2,z);};
const turned=(g:THREE.BufferGeometry,x:number,y:number,z:number,yaw=0)=>{g.deleteAttribute('uv');if(yaw)g.rotateY(yaw);return g.translate(x,y,z);};
/** Courses of a pedestal stacked from the ground: [width, height, depth] each; returns the top. */
function courses(parts:MonumentModel['parts'],finish:MallFinish,list:V3[],y=0){
  for(const [w,h,d] of list){parts.push({geometry:block(w,h,d,0,y,0),finish});y+=h;}
  return y;
}
/** A weathered boulder: an icosphere pulled about by a fixed sequence, flat underneath. */
function boulder(rx:number,ry:number,rz:number,seed:number){
  const g=new THREE.IcosahedronGeometry(1,2),p=g.getAttribute('position'),shift=new Map<string,number>();
  const random=()=>(seed=(Math.imul(seed,1664525)+1013904223)|0,(seed>>>0)/4294967296);
  for(let i=0;i<p.count;i++){
    const key=`${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;let k=shift.get(key);if(k===undefined)shift.set(key,k=.84+random()*.3);
    p.setXYZ(i,p.getX(i)*k*rx,Math.max(-.25,p.getY(i)*k)*ry,p.getZ(i)*k*rz);
  }
  g.deleteAttribute('uv');g.computeVertexNormals();return g.translate(0,ry*.25,0);
}

/** One monument in its own frame. Pure geometry: usable without a DOM. */
export function buildMonument(id:MallMonumentId):MonumentModel{
  const parts:MonumentModel['parts']=[],solids:MonumentModel['solids']=[];
  const bronze=(geometry:THREE.BufferGeometry,x:number,y:number,z:number,yaw=0)=>{parts.push({geometry:turned(geometry,x,y,z,yaw),finish:'bronze'});};
  let top=0;
  if(id==='hamilton'){
    // Granite throughout: a cloaked figure on a tall stepped pedestal.
    top=courses(parts,'granite',[[2.9,.3,2.9],[2.4,.3,2.4],[2,.45,2],[1.55,1.9,1.55],[1.9,.28,1.9],[1.6,.2,1.6]]);
    parts.push({geometry:turned(statueFigure({height:2.85,robe:'cloak',right:'chest'}),0,top,0),finish:'pale'});
    solids.push({x:0,z:0,w:2.4,d:2.4,h:top+1});top+=2.85;
  }else if(id==='glover'){
    top=courses(parts,'granite',[[2.6,.35,2.6],[2.1,.4,2.1],[1.6,1.6,1.6],[1.95,.25,1.95]]);
    bronze(statueFigure({height:2.45,robe:'cloak',left:'hip',right:'forward'}),0,top,-.05);
    // His sword point rests on the plinth; a cannon lies under his left foot.
    bronze(new THREE.BoxGeometry(.05,1.25,.03),-.36,top+.85,.42);bronze(new THREE.CylinderGeometry(.1,.13,1.05,8).rotateX(Math.PI/2),.3,top+.13,.28,.5);
    solids.push({x:0,z:0,w:2.1,d:2.1,h:top+1});top+=2.45;
  }else if(id==='collins'){
    // A granite shaft carrying the bust, Erin and Columbia in bronze at its sides.
    parts.push({geometry:block(4.4,.45,2,0,0,0),finish:'granite'},{geometry:block(1.7,.5,1.3,0,.45,0),finish:'granite'},{geometry:block(1.25,3.6,.95,0,.95,0),finish:'granite'},{geometry:block(1.5,.22,1.15,0,4.55,0),finish:'granite'});
    top=4.77;
    bronze(new THREE.LatheGeometry([[0,0],[.34,0],[.36,.16],[.24,.34],[.1,.42],[.09,.5]].map(([r,y])=>new THREE.Vector2(r,y)),10).applyMatrix4(new THREE.Matrix4().makeScale(1,1,.6)),0,top,0);
    bronze(new THREE.SphereGeometry(.2,10,8).applyMatrix4(new THREE.Matrix4().makeScale(.9,1.15,1)),0,top+.7,.02);
    for(const side of [1,-1])bronze(statueFigure({height:2.05,robe:'gown',left:side>0?'out':'chest',right:side>0?'chest':'out'}),side*1.55,.45,.15,-side*.25);
    solids.push({x:0,z:0,w:4.4,d:2,h:2.6},{x:0,z:0,w:1.3,d:1,h:top});top+=.93;
  }else if(id==='vendome'){
    // A waist-high arc of black granite along the walk, 8.7 m round its face, open to the north; a fire helmet and coat lie on it in bronze.
    const R=5,half=50*Math.PI/180,n=14,cx=R*(1+Math.cos(half))/2;
    for(let i=0;i<n;i++){
      const a=-half+(i+.5)*2*half/n;parts.push({geometry:block(.62,.92,2*R*Math.tan(half/n)+.02,cx-R*Math.cos(a),0,R*Math.sin(a),a),finish:'black'});
    }
    for(const a of [-half*.66,0,half*.66])solids.push({x:cx-R*Math.cos(a),z:R*Math.sin(a),w:.7,d:2.9,h:.92,yaw:a});
    bronze(new THREE.SphereGeometry(.17,10,6,0,Math.PI*2,0,Math.PI/2).applyMatrix4(new THREE.Matrix4().makeScale(1,.85,1.25)),cx-R*Math.cos(.35),.92,R*Math.sin(.35));
    bronze(new THREE.BoxGeometry(.78,.07,.6),cx-R*Math.cos(.5),.955,R*Math.sin(.5),.5);bronze(new THREE.BoxGeometry(.06,.5,.56),cx-R*Math.cos(.5)+.36,.7,R*Math.sin(.5),.5);
    top=1.07;
  }else if(id==='garrison'){
    // Seated in an armchair, half again life size, on a long granite block.
    top=courses(parts,'granite',[[2.9,.4,3.6],[2.5,.4,3.2],[2.1,1.55,2.8],[2.4,.25,3.1]]);
    const h=3,seat=top+.25*h;
    bronze(new THREE.BoxGeometry(1.2,.16,1.15),0,seat-.08,-.05);bronze(new THREE.BoxGeometry(1.05,seat-top-.16,.95),0,(seat+top)/2-.08,-.1);
    bronze(new THREE.BoxGeometry(1.2,1.25,.14),0,seat+.62,-.62,0);
    for(const side of [1,-1]){bronze(new THREE.BoxGeometry(.13,.5,1),side*.6,seat+.25,-.08);}
    bronze(statueFigure({height:h,seated:true,left:'rest',right:'lap'}),0,top,-.12);
    solids.push({x:0,z:0,w:2.5,d:3.2,h:top+1.2});top+=.78*h;
  }else if(id==='morison'){
    // The historian in oilskins on a granite boulder, looking out to sea.
    const rock=boulder(1.75,1.5,2.3,31).translate(0,0,-.2),p=rock.getAttribute('position'),h=2.7;
    parts.push({geometry:rock,finish:'granite'},{geometry:boulder(.8,.55,.95,77).translate(1.25,0,1.55),finish:'granite'},{geometry:boulder(.6,.4,.7,113).translate(-1.35,0,1.25),finish:'granite'});
    // He sits on the rock's own crown, wherever the weathering left it.
    for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<.5&&Math.abs(p.getZ(i))<.5)top=Math.max(top,p.getY(i));
    top-=.06;bronze(statueFigure({height:h,seated:true,left:'lap',right:'rest'}),0,top-.25*h,.1);
    solids.push({x:0,z:-.2,w:3.4,d:4.6,h:top});top+=.53*h;
  }else if(id==='women'){
    // Three figures at ground level, each using her own pedestal: Abigail Adams leans on hers, Lucy Stone writes
    // at hers, Phillis Wheatley sits at hers.
    // Each stands at an angle round the centre and looks outward; a block turned by that angle has its width across her view.
    const at=(angle:number,radius:number):[number,number]=>[Math.sin(angle)*radius,Math.cos(angle)*radius];
    const stone=(w:number,h:number,d:number,angle:number,radius:number)=>{const [x,z]=at(angle,radius);parts.push({geometry:block(w,h,d,x,0,z,angle),finish:'granite'});solids.push({x,z,w,d,h,yaw:angle});};
    const figure=(g:THREE.BufferGeometry,angle:number,radius:number,y=0)=>{const [x,z]=at(angle,radius);bronze(g,x,y,z,angle);};
    stone(.95,1.72,.72,.4,1.75);figure(statueFigure({height:1.95,robe:'gown',left:'chest'}),.4,2.42);
    stone(2.15,.62,.9,2.55,2.35);figure(statueFigure({height:1.9,seated:true,left:'forward',right:'lap'}),2.55,2.15,.62-.25*1.9);
    stone(1.3,.92,.8,-1.75,2.75);stone(.62,.475,.62,-1.75,1.72);figure(statueFigure({height:1.9,seated:true,left:'chin',right:'forward'}),-1.75,1.78);
    top=1.95;
  }else if(id==='sarmiento'){
    top=courses(parts,'granite',[[2.6,.35,2],[2.1,1.15,1.5]]);
    bronze(statueFigure({height:3.3,robe:'coat',left:'down',right:'chest'}),0,top,0);
    solids.push({x:0,z:0,w:2.1,d:1.5,h:top+1.2});top+=3.3;
  }else{
    // Red sandstone: a boat-shaped kerb, the shaft with a prow before it and a stern behind, and the young
    // explorer in bronze shading his eyes.
    const length=6.2,beam=2.3,n=18,rim:THREE.BufferGeometry[]=[];
    for(const side of [1,-1])for(let i=0;i<n;i++){
      const t0=i/n*2-1,t1=(i+1)/n*2-1,x0=side*beam*(1-t0*t0),x1=side*beam*(1-t1*t1),z0=t0*length,z1=t1*length,l=Math.hypot(x1-x0,z1-z0);
      rim.push(block(.32,.36,l+.06,(x0+x1)/2,0,(z0+z1)/2,Math.atan2(x1-x0,z1-z0)));
    }
    parts.push({geometry:mergeGeometries(rim,false)!,finish:'sandstone'});for(const g of rim)g.dispose();
    top=courses(parts,'sandstone',[[2.3,.5,3.1],[1.6,2.25,1.6],[1.85,.26,1.85]]);
    // Each a narrow wedge rising out of the shaft's face.
    for(const side of [1,-1])parts.push({geometry:turned(new THREE.ConeGeometry(.5,1.7,4).rotateY(Math.PI/4).applyMatrix4(new THREE.Matrix4().makeScale(.5,1,1)).rotateX(side*1.12),0,1.5,side*1.02),finish:'sandstone'});
    bronze(statueFigure({height:2.6,robe:'none',left:'brow',right:'hip'}),0,top,0);
    solids.push({x:0,z:0,w:1.9,d:3.1,h:top+1});top+=2.6;
  }
  return {parts,solids,height:top};
}

interface Finishes { iron:THREE.MeshStandardMaterial; pickets:THREE.MeshStandardMaterial; wood:THREE.MeshStandardMaterial; edging:THREE.MeshStandardMaterial; paving:THREE.MeshStandardMaterial; concrete:THREE.MeshStandardMaterial; stone:Record<MallFinish,THREE.MeshStandardMaterial>; }
let finishes:Finishes|undefined;
/** One 0.5 m repeat of the fence between its top and bottom rails, as an alpha mask: four spear-headed pickets,
 * a band of rings under the top rail and a low rail of short dog bars. */
function picketMask(){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;const c=canvas.getContext('2d')!,Y=(h:number)=>(1-h/FENCE_HEIGHT)*256;
  c.fillStyle='#000';c.fillRect(0,0,128,256);c.fillStyle=c.strokeStyle='#fff';
  for(const x of [16,48,80,112]){
    c.fillRect(x-3,Y(.94),6,Y(0)-Y(.94));
    c.beginPath();c.moveTo(x,Y(FENCE_HEIGHT-.01));c.lineTo(x+6.5,Y(.985));c.lineTo(x+3,Y(.93));c.lineTo(x-3,Y(.93));c.lineTo(x-6.5,Y(.985));c.closePath();c.fill();
  }
  for(const x of [0,32,64,96,128]){
    c.fillRect(x-2.5,Y(.4),5,Y(0)-Y(.4));c.beginPath();c.moveTo(x,Y(.47));c.lineTo(x+5,Y(.415));c.lineTo(x-5,Y(.415));c.closePath();c.fill();
    c.lineWidth=4.5;c.beginPath();c.ellipse(x,Y(.826),11.6,10.8,0,0,Math.PI*2);c.stroke();
  }
  c.fillRect(0,Y(.39),128,Y(.355)-Y(.39));c.fillRect(0,Y(.775),128,Y(.745)-Y(.775));
  const texture=new THREE.CanvasTexture(canvas);texture.wrapS=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}
function mallFinishes(mobile:boolean):Finishes{
  if(finishes)return finishes;
  const standard=(color:string,roughness:number,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const ground=<T extends THREE.Material>(m:T,units:number)=>{m.polygonOffset=true;m.polygonOffsetFactor=1;m.polygonOffsetUnits=units;return m;};
  const iron=standard('#1b1d1c',.58,.45);
  // Cut out by the mask: on the multisampled desktop target coverage smooths the bars' edges; the cutout keeps
  // every other pass (shadow depth, reflection captures, a phone's plain framebuffer) from drawing the whole panel.
  const pickets=new THREE.MeshStandardMaterial({color:'#1b1d1c',roughness:.58,metalness:.45,alphaMap:picketMask(),alphaTest:mobile?.4:.3,alphaToCoverage:!mobile,side:THREE.DoubleSide});
  finishes={iron,pickets,wood:standard('#7b6243',.9),edging:standard('#a8a69b',.93),paving:ground(standard('#9d9a90',.9),2),concrete:ground(standard('#a5a297',.96),2),
    stone:{granite:standard('#bcb8ac',.9),pale:standard('#cdc9bd',.88),black:standard('#26282a',.32,.1),sandstone:standard('#8d5d4a',.92),bronze:standard('#5c6556',.5,.38)}};
  return finishes;
}

const FENCE_HEIGHT=1.08;
/** A path as a ring: its line offset half the width to both sides, mitred at the bends. */
export function strokeRing(points:Point2[],width:number):Point2[]{
  const half=width/2,left:Point2[]=[],right:Point2[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[Math.max(0,i-1)],b=points[i],c=points[Math.min(points.length-1,i+1)];
    let ux=b[0]-a[0],uz=b[1]-a[1],vx=c[0]-b[0],vz=c[1]-b[1];const ul=Math.hypot(ux,uz),vl=Math.hypot(vx,vz);
    if(ul>1e-6){ux/=ul;uz/=ul;}
    if(vl>1e-6){vx/=vl;vz/=vl;}else{vx=ux;vz=uz;}
    if(ul<=1e-6){ux=vx;uz=vz;}
    // The mitre along the bisector of the two normals, held to twice the half width at a sharp bend.
    let nx=-(uz+vz),nz=ux+vx;const nl=Math.hypot(nx,nz);if(nl<1e-6){nx=-uz;nz=ux;}else{nx/=nl;nz/=nl;}
    const reach=half/Math.max(.5,nx*-uz+nz*ux);
    left.push([b[0]+nx*reach,b[1]+nz*reach]);right.push([b[0]-nx*reach,b[1]-nz*reach]);
  }
  return [...left,...right.reverse()];
}

export interface MallOptions {
  /** A streamed tile draws what stands inside its square. */ bounds?:{minX:number;maxX:number;minZ:number;maxZ:number};
  pace?:Pace; mobile?:boolean;
  /** The tile's surveyed sidewalk polygons: a mapped path they already outline is not paved twice, and no trunk stands on them. */ sidewalks?:readonly {rings:Point2[][]}[];
  /** The sidewalk concrete, for a walk the inventory does not cover. */ paving?:THREE.Material;
}
export interface MallDetails { meshes:THREE.Mesh[]; trees:TreePlanting[]; solids:SolidBox[]; stats:{trees:number;benches:number;fencePanels:number;monuments:string[];walks:number}; }

/** Everything the Mall adds to the parks of `city` (a tile's sub-city or a whole city), or nothing where none of
 * its lawns is in view. `paths` are the park paths the caller owns; those on the Mall are drawn here. */
export function* mallDetailSteps(city:CityData,parks:readonly CityArea[],paths:readonly ParkPath[],options:MallOptions={}):Generator<void,MallDetails|undefined>{
  if(!parks.some(isCommonwealthMall))return undefined;
  const {bounds,pace}=options,plan=planMall(parks),m=mallFinishes(!!options.mobile);
  const owned=(x:number,z:number)=>!bounds||x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ;
  const ground=(x:number,z:number)=>sampleElevation(city,x,z);
  const batches=new PartBatches(240),matrix=new THREE.Matrix4(),turn=new THREE.Matrix4();
  const place=(part:Part,material:THREE.Material,x:number,y:number,z:number,yaw=0,pitch=0)=>{
    matrix.makeRotationY(yaw);if(pitch)matrix.multiply(turn.makeRotationX(-pitch));batches.part(part,material,matrix.setPosition(x,y,z));
  };
  const solids:SolidBox[]=[],meshes:THREE.Mesh[]=[],stats:MallDetails['stats']={trees:0,benches:0,fencePanels:0,monuments:[],walks:0};
  // Surveyed walks near the Mall's lawns, each with its box.
  const boxed=(rings:Point2[][])=>{
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z] of rings[0]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
    return {rings,minX,maxX,minZ,maxZ};
  };
  const lawns=parks.filter(isCommonwealthMall).map(p=>boxed(p.rings));
  const walks=(options.sidewalks??[]).filter(w=>w.rings[0]?.length>=3).map(w=>boxed(w.rings))
    .filter(w=>lawns.some(l=>w.minX<=l.maxX&&w.maxX>=l.minX&&w.minZ<=l.maxZ&&w.maxZ>=l.minZ&&w.rings[0].some(p=>pointInside(p,l.rings[0]))));
  const surveyed=(x:number,z:number,holes=false)=>walks.some(w=>x>=w.minX&&x<=w.maxX&&z>=w.minZ&&z<=w.maxZ&&pointInside([x,z],w.rings[0])&&!(holes&&w.rings.slice(1).some(h=>pointInside([x,z],h))));

  // Walks: a mapped path the inventory already outlines is its polygon; any other is paved in the same concrete.
  const onMall=mallPathTest(parks),paved=new DrapedSurface(city,{bounds,pace,offset:.03});
  for(const path of paths){
    if(path.bridge||!onMall(path))continue;
    if(due(pace))yield;
    let samples=0,covered=0;
    for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1],b=path.points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));
      for(let k=0;k<=n;k++){samples++;if(surveyed(a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n))covered++;}
    }
    if(covered>=samples*.8)continue;
    yield* paved.add([strokeRing(path.points,Math.min(path.width,MALL_WALK_HALF*2))]);stats.walks++;
  }
  if(paved.stats.polygons){
    const geometry=yield* paved.geometrySteps();
    if(geometry.index!.count){const mesh=new THREE.Mesh(geometry,options.paving??m.concrete);mesh.name='Commonwealth Avenue Mall walks';mesh.receiveShadow=true;mesh.renderOrder=-2;meshes.push(mesh);}else geometry.dispose();
  }

  // Fences: a granite edging, two rails and the picket mask between each pair of posts; one solid box a panel, as
  // wide as the edging (a car's chassis travels 17 cm a step at city speed).
  for(const run of plan.fences){
    if(due(pace))yield;
    for(const [i,post] of run.posts.entries()){
      const [x,z]=post.at,y=ground(x,z);
      if(owned(x,z)){
        if(post.kind==='stone'){place(box(.44,1.18,.44),m.stone.granite,x,y+.59,z,Math.atan2(run.posts[1].at[0]-x,run.posts[1].at[1]-z));place(new THREE.ConeGeometry(.31,.2,4).rotateY(Math.PI/4),m.stone.granite,x,y+1.28,z,Math.atan2(run.posts[1].at[0]-x,run.posts[1].at[1]-z));}
        else if(post.kind==='gate')place(GATE_POST,m.iron,x,y,z);
        else{const w=post.kind==='end'?.085:.06;place(box(w,FENCE_HEIGHT+.08,w),m.iron,x,y+(FENCE_HEIGHT+.08)/2,z);place(FINIAL,m.iron,x,y+FENCE_HEIGHT+.08,z);}
      }
      const next=run.posts[i+1];if(!next)continue;
      const [qx,qz]=next.at,mx=(x+qx)/2,mz=(z+qz)/2;if(!owned(mx,mz))continue;
      const qy=ground(qx,qz),length=Math.hypot(qx-x,qz-z),yaw=Math.atan2(qx-x,qz-z),pitch=Math.atan2(qy-y,length),my=(y+qy)/2,run3=Math.hypot(length,qy-y);
      place(box(.24,.16,run3),m.edging,mx,my+.04,mz,yaw,pitch);
      for(const h of [.11,.9])place(box(.045,.05,run3),m.iron,mx,my+h,mz,yaw,pitch);
      const repeats=Math.max(1,Math.round(length/.5)),writer=batches.at(m.pickets,mx,mz);
      writer.triangle(x,y,z,qx,qy,qz,qx,qy+FENCE_HEIGHT,qz,0,0,repeats,0,repeats,1);writer.triangle(x,y,z,qx,qy+FENCE_HEIGHT,qz,x,y+FENCE_HEIGHT,z,0,0,repeats,1,0,1);
      solids.push({x:mx,y:my+.55,z:mz,yaw,slope:pitch,length:run3,width:.24,height:1.1});stats.fencePanels++;
    }
  }

  // Benches: slatted seat and back on iron ends, facing the walk.
  for(const bench of plan.benches){
    if(!owned(bench.x,bench.z))continue;
    if(due(pace))yield;
    const y=ground(bench.x,bench.z),fx=Math.sin(bench.yaw),fz=Math.cos(bench.yaw),sx=Math.cos(bench.yaw),sz=-Math.sin(bench.yaw);
    const at=(side:number,forward:number):[number,number]=>[bench.x+sx*side+fx*forward,bench.z+sz*side+fz*forward];
    for(const forward of [-.15,0,.15]){const [x,z]=at(0,forward);place(box(1.86,.045,.13),m.wood,x,y+.45,z,bench.yaw);}
    for(const [h,back] of [[.62,-.275],[.78,-.31]]){const [x,z]=at(0,back);place(box(1.86,.13,.04),m.wood,x,y+h,z,bench.yaw,.2);}
    for(const side of [-.86,0,.86]){
      const [x,z]=at(side,-.02),[bx,bz]=at(side,-.3);
      place(box(.05,.05,.52),m.iron,x,y+.415,z,bench.yaw);place(box(.05,.87,.05),m.iron,bx,y+.435,bz,bench.yaw,.12);
      const [lx,lz]=at(side,.2);place(box(.05,.42,.05),m.iron,lx,y+.21,lz,bench.yaw);
      if(side){const [hx,hz]=at(side,-.04);place(box(.05,.04,.5),m.iron,hx,y+.64,hz,bench.yaw);}
    }
    stats.benches++;
  }

  // Monuments.
  for(const monument of plan.monuments){
    const [x,z]=monument.at;if(!owned(x,z))continue;
    if(due(pace))yield;
    const y=ground(x,z)-.04,yaw=monumentYaw(monument),model=buildMonument(monument.id),sin=Math.sin(yaw),cos=Math.cos(yaw);
    matrix.makeRotationY(yaw).setPosition(x,y,z);
    for(const part of model.parts){batches.at(m.stone[part.finish],x,z).append(part.geometry,matrix);part.geometry.dispose();}
    for(const s of model.solids)solids.push({x:x+s.x*cos+s.z*sin,y:y+s.h/2,z:z-s.x*sin+s.z*cos,yaw:yaw+(s.yaw??0),slope:0,length:s.d,width:s.w,height:s.h});
    if(monument.id==='women'){
      // The granite round the figures share, on the island the inventory leaves open.
      const round=new DrapedSurface(city,{bounds,pace,offset:.04}),ring:Point2[]=[];
      // A little wider than the island, so no sliver of lawn shows between it and the walk around it.
      for(let i=0;i<40;i++)ring.push([x+Math.cos(i/40*Math.PI*2)*(WOMENS_MEMORIAL_RADIUS+.35),z+Math.sin(i/40*Math.PI*2)*(WOMENS_MEMORIAL_RADIUS+.35)]);
      yield* round.add([ring]);const geometry=yield* round.geometrySteps();
      if(geometry.index!.count){const mesh=new THREE.Mesh(geometry,m.paving);mesh.name="Boston Women's Memorial paving";mesh.receiveShadow=true;mesh.renderOrder=-2;meshes.push(mesh);}else geometry.dispose();
    }
    stats.monuments.push(monument.name);
  }

  // Trees: the planned rows, less any trunk the tile's surveyed paving or a raised deck would meet.
  const trees:TreePlanting[]=[];
  for(const tree of plan.trees){
    if(!owned(tree.x,tree.z)||surveyed(tree.x,tree.z,true))continue;
    const y=ground(tree.x,tree.z);if(canopyHitsDeck(city,tree.x,tree.z,y,PARK_CANOPY))continue;
    trees.push({position:new THREE.Vector3(tree.x,y+.025,tree.z),species:tree.species,scale:tree.scale});
  }
  stats.trees=trees.length;
  for(const mesh of batches.meshes()){
    const material=mesh.material as THREE.Material;
    mesh.name=material===m.pickets?'Commonwealth Avenue Mall fence pickets':'Commonwealth Avenue Mall furnishings';mesh.castShadow=material!==m.edging;mesh.receiveShadow=true;
    // The normal pass GTAO draws with cannot cut the mask out: it would shade the panels as walls.
    if(material===m.pickets)mesh.userData.noAO=true;
    meshes.push(mesh);
  }
  return {meshes,trees,solids,stats};
}

// A cast iron gate post, turned: a broad foot, a banded shaft and a ball.
const GATE_POST=new THREE.LatheGeometry([[0,0],[.15,0],[.15,.1],[.115,.14],[.1,.2],[.1,.92],[.125,.95],[.125,1],[.095,1.04],[.085,1.14],[.12,1.18],[.12,1.22],[.06,1.27],[.085,1.32],[.095,1.38],[.07,1.45],[0,1.47]].map(([r,y])=>new THREE.Vector2(r,y)),12);
const FINIAL=new THREE.ConeGeometry(.055,.11,4).rotateY(Math.PI/4).translate(0,.055,0);
GATE_POST.deleteAttribute('uv');FINIAL.deleteAttribute('uv');
