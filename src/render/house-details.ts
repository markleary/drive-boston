import * as THREE from 'three';
import type { Building, CityData, Point2 } from '../types';
import { sampleElevation } from '../simulation/terrain';
import { PartBatches, TriangleWriter, box, type Part } from './geometry-writer';
import { due, type Pace } from './pacing';
import { housePlan, outwardNormal, type HousePlan } from './house-plan';
import { housePalette, houseRoof, HOUSE_PALETTES, victorianEra } from './house-styles';
import { planPorchStairs, stairFootprint } from './porch-stairs.ts';
import { pointInside } from '../simulation/roads.ts';
import { otherBuildingHulls } from '../simulation/city-tiles.ts';
import { inTunnelApproach } from '../simulation/tunnels.ts';
import { slopeRoofUVs } from './tile-geometry';
import { orientedBox } from '../simulation/oriented-box.ts';

/** Detail for the generated northern houses: a Queen Anne corner tower built
 * with the shell (house paint below, gable finish above the eave, a flared
 * cone in the roof covering), and in the detail stage front porches with
 * turned posts, scroll brackets, spindle friezes, balustrades, lattice skirts
 * and steps, entry porticos on later houses, panelled front doors, corbelled
 * brick chimneys and garage doors. Interpretive, from the assessor style. */

const TAU=Math.PI*2;
type Attrs={position:number[];normal:number[];uv:number[];facadeTop:number[];housePalette?:number[]};
function geometryOf(a:Attrs){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(a.position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(a.normal,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(a.uv,2));g.setAttribute('facadeTop',new THREE.Float32BufferAttribute(a.facadeTop,1));
  if(a.housePalette)g.setAttribute('housePalette',new THREE.Float32BufferAttribute(a.housePalette,1));
  return g;
}
/** Append triangle p0 p1 p2 wound to face `out` (flat normal). */
function tri(a:Attrs,p:number[][],out:number[],uv:number[][]=[[0,0],[0,0],[0,0]]){
  const [p0,p1,p2]=p,ux=p1[0]-p0[0],uy=p1[1]-p0[1],uz=p1[2]-p0[2],vx=p2[0]-p0[0],vy=p2[1]-p0[1],vz=p2[2]-p0[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const flip=nx*out[0]+ny*out[1]+nz*out[2]<0,l=Math.hypot(nx,ny,nz)||1;
  if(flip){nx=-nx;ny=-ny;nz=-nz;}
  const order=flip?[0,2,1]:[0,1,2];
  for(const k of order){a.position.push(...p[k]);a.normal.push(nx/l,ny/l,nz/l);a.uv.push(...uv[k]);}
}

/** The tower's shell parts: walls in the house material (palette attribute, facade UVs centring a window on each face), the cone and the flare's underside. */
export function houseTowerGeometry(b:Building,plan:HousePlan){
  const t=plan.tower;if(!t)return undefined;
  const base=b.baseElevation??0,eave=b.eaveHeight??b.height,vertical=plan.floorHeight*2,wallTop=(eave-plan.foundation)/vertical*6,palette=housePalette(b);
  const R=t.radius/Math.cos(Math.PI/8),ring:Point2[]=[];
  for(let k=0;k<8;k++){const a=t.phase+k*TAU/8;ring.push([t.center[0]+Math.cos(a)*R,t.center[1]+Math.sin(a)*R]);}
  const walls:Attrs={position:[],normal:[],uv:[],facadeTop:[],housePalette:[]};
  for(let k=0;k<8;k++){
    const p=ring[k],q=ring[(k+1)%8],mx=(p[0]+q[0])/2-t.center[0],mz=(p[1]+q[1])/2-t.center[1],out=[mx,0,mz];
    // u runs with (nz,-nx) like the stabilized shell UVs; each face centres a window column (1.5 m).
    const ml=Math.hypot(mx,mz)||1,nx=mx/ml,nz=mz/ml,su=(pt:Point2)=>((pt[0]-(p[0]+q[0])/2)*nz-(pt[1]-(p[1]+q[1])/2)*nx);
    const V=(pt:Point2,y:number)=>[pt[0],y,pt[1]],U=(pt:Point2,y:number)=>[(1.5+su(pt))/6,(y-base-plan.foundation)/vertical];
    tri(walls,[V(p,base),V(q,base),V(q,t.top)],out,[U(p,base),U(q,base),U(q,t.top)]);
    tri(walls,[V(p,base),V(q,t.top),V(p,t.top)],out,[U(p,base),U(q,t.top),U(p,t.top)]);
  }
  for(let i=0;i<walls.position.length/3;i++){walls.facadeTop.push(wallTop);walls.housePalette!.push(palette);}
  const flare=(R+.3)/R,cone:Attrs={position:[],normal:[],uv:[],facadeTop:[]},under:Attrs={position:[],normal:[],uv:[],facadeTop:[]},y=t.top-.1,apex=[t.center[0],t.apex,t.center[1]];
  for(let k=0;k<8;k++){
    const p=ring[k],q=ring[(k+1)%8],P=[t.center[0]+(p[0]-t.center[0])*flare,y,t.center[1]+(p[1]-t.center[1])*flare],Q=[t.center[0]+(q[0]-t.center[0])*flare,y,t.center[1]+(q[1]-t.center[1])*flare];
    const out=[(p[0]+q[0])/2-t.center[0],R*.6,(p[1]+q[1])/2-t.center[1]];
    tri(cone,[P,Q,apex],out);tri(under,[P,Q,[t.center[0],y,t.center[1]]],[0,-1,0]);
  }
  const coneUV=new Float32Array(cone.position.length/3*2);slopeRoofUVs(cone.position,coneUV,b);cone.uv=Array.from(coneUV);
  for(const a of [cone,under])for(let i=0;i<a.position.length/3;i++)a.facadeTop.push(1e6);
  return {facade:geometryOf(walls),roof:geometryOf(cone),trim:geometryOf(under),footprint:ring,top:t.top,apex};
}

interface Materials { trim:Record<string,THREE.MeshStandardMaterial>; balusters:Record<string,THREE.MeshStandardMaterial>; frieze:Record<string,THREE.MeshStandardMaterial>; lattice:THREE.MeshStandardMaterial; deck:THREE.MeshStandardMaterial; doors:THREE.MeshStandardMaterial[]; glass:THREE.MeshStandardMaterial; brick:THREE.MeshStandardMaterial; cap:THREE.MeshStandardMaterial; garage:THREE.MeshStandardMaterial; finial:THREE.MeshStandardMaterial; }
let shared:Materials|undefined;
function canvasMap(w:number,h:number,paint:(c:CanvasRenderingContext2D)=>void,repeat=true){
  const c=document.createElement('canvas');c.width=w;c.height=h;paint(c.getContext('2d')!);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;if(repeat)t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function materials():Materials {
  if(shared)return shared;
  // Turned balusters between rails (0.6 m of balustrade per repeat), a spindle frieze and diagonal lattice.
  const balusters=canvasMap(128,64,c=>{
    c.fillStyle='#fff';c.fillRect(0,0,128,7);c.fillRect(0,57,128,7);
    for(let x=16;x<128;x+=32){c.beginPath();c.moveTo(x-4,7);c.lineTo(x+4,7);c.lineTo(x+4,13);c.quadraticCurveTo(x+9,30,x+4,44);c.lineTo(x+5,57);c.lineTo(x-5,57);c.lineTo(x-4,44);c.quadraticCurveTo(x-9,30,x-4,13);c.closePath();c.fill();}
  });
  const frieze=canvasMap(128,32,c=>{
    c.fillStyle='#fff';c.fillRect(0,0,128,6);c.fillRect(0,26,128,6);
    for(let x=4;x<128;x+=8){c.fillRect(x-1,6,2,20);c.beginPath();c.arc(x,16,2.4,0,TAU);c.fill();}
  });
  const lattice=canvasMap(64,64,c=>{
    c.fillStyle='#262824';c.fillRect(0,0,64,64);c.strokeStyle='#e9e6da';c.lineWidth=5;
    for(let k=-64;k<=128;k+=21){c.beginPath();c.moveTo(k,0);c.lineTo(k+64,64);c.stroke();c.beginPath();c.moveTo(k,64);c.lineTo(k+64,0);c.stroke();}
  });
  const brick=canvasMap(128,128,c=>{
    let seed=91;const r=()=>(seed=(Math.imul(seed,1664525)+1013904223)|0,(seed>>>0)/4294967296);
    c.fillStyle='#8e8373';c.fillRect(0,0,128,128);
    for(let y=0;y<128;y+=8)for(let x=-(y/8%2)*16;x<128;x+=32){const v=r();c.fillStyle=`rgb(${Math.round(118+v*36)},${Math.round(58+v*20)},${Math.round(44+v*14)})`;c.fillRect(x+1,y+1,30,6);}
  });
  const garage=canvasMap(128,128,c=>{
    c.fillStyle='#ecebe4';c.fillRect(0,0,128,128);
    for(let row=0;row<4;row++)for(let col=0;col<4;col++){const x=col*32+4,y=row*32+5;c.fillStyle='#d6d4ca';c.fillRect(x,y,24,22);c.fillStyle='#f7f6f0';c.fillRect(x+2,y+2,20,18);}
    c.fillStyle='#b9b7ad';for(let row=1;row<4;row++)c.fillRect(0,row*32,128,1.5);
  },false);
  const trim:Record<string,THREE.MeshStandardMaterial>={},rails:Record<string,THREE.MeshStandardMaterial>={},friezes:Record<string,THREE.MeshStandardMaterial>={};
  for(const colour of new Set(HOUSE_PALETTES.map(p=>p.trim))){
    trim[colour]=new THREE.MeshStandardMaterial({color:colour,roughness:.76});
    rails[colour]=new THREE.MeshStandardMaterial({color:colour,map:balusters,alphaTest:.5,side:THREE.DoubleSide,roughness:.76});
    friezes[colour]=new THREE.MeshStandardMaterial({color:colour,map:frieze,alphaTest:.5,side:THREE.DoubleSide,roughness:.76});
  }
  shared={trim,balusters:rails,frieze:friezes,lattice:new THREE.MeshStandardMaterial({map:lattice,roughness:.9}),
    deck:new THREE.MeshStandardMaterial({color:'#7f837d',roughness:.88}),
    doors:['#5b1f24','#253b30','#1d2730','#6b4a2b'].map(color=>new THREE.MeshStandardMaterial({color,roughness:.55})),
    glass:new THREE.MeshStandardMaterial({color:'#1d282c',roughness:.18,metalness:.2}),
    brick:new THREE.MeshStandardMaterial({map:brick,roughness:.9}),cap:new THREE.MeshStandardMaterial({color:'#8d8a80',roughness:.92}),
    garage:new THREE.MeshStandardMaterial({map:garage,roughness:.7}),finial:new THREE.MeshStandardMaterial({color:'#4f6b5c',roughness:.5,metalness:.35})};
  return shared;
}
/** A turned post one metre tall (scaled to the porch): square plinth and neck around a lathe-turned shaft. */
let turned:THREE.BufferGeometry|undefined;
const turnedPost=()=>turned??=new THREE.LatheGeometry([[0,.15],[.05,.15],[.045,.22],[.065,.36],[.04,.5],[.058,.64],[.04,.8],[.05,.9],[0,.9]].map(([r,y])=>new THREE.Vector2(r,y)),6);

export interface HouseDetailOptions { buildings:Building[]; roofs:THREE.Material[]; trimRoof:THREE.Material; roofTop:(b:Building,x:number,z:number)=>number|undefined; porchBudget?:number; target?:THREE.Object3D; pace?:Pace; mobile?:boolean; }
export function* houseDetailSteps(scene:THREE.Scene,city:CityData,options:HouseDetailOptions):Generator<void,THREE.Group>{
  const group=new THREE.Group();group.name='Northern house details';
  const houses=options.buildings.filter(b=>b.houseStyle&&b.footprint.length>=3);
  const m=materials(),batches=new PartBatches(500),matrix=new THREE.Matrix4(),euler=new THREE.Euler(0,0,0,'YXZ'),q=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1),pos=new THREE.Vector3();
  const stats={porches:0,porticos:0,chimneys:0,doors:0,garageDoors:0,finials:0};
  const place=(part:Part,material:THREE.Material,x:number,y:number,z:number,yaw:number,pitch=0,roll=0,scale=one)=>{euler.set(pitch,yaw,roll);q.setFromEuler(euler);batches.part(part,material,matrix.compose(pos.set(x,y,z),q,scale));};
  // Showpieces first: the nineteenth-century houses take the porch budget before later ones.
  const order=[...houses.filter(b=>victorianEra(b)),...houses.filter(b=>!victorianEra(b))];
  let budget=options.porchBudget??140;
  for(const b of order){
    if(due(options.pace))yield;
    const plan=housePlan(city,b),base=b.baseElevation??0,palette=HOUSE_PALETTES[housePalette(b)],trim=m.trim[palette.trim];
    if(b.houseStyle==='garage'){garageDoor(b,plan);continue;}
    if(plan.chimney)chimney(b,plan.chimney);
    if(plan.tower){place(box(.07,.9,.07),m.finial,plan.tower.center[0],plan.tower.apex+.4,plan.tower.center[1],0);stats.finials++;}
    const f=plan.front;if(!f)continue;
    const yaw=Math.atan2(f.nx,f.nz),tx=f.nz,tz=-f.nx,flip=((f.b[0]-f.a[0])*tx+(f.b[1]-f.a[1])*tz)<0;
    const ox=(f.a[0]+f.b[0])/2,oz=(f.a[1]+f.b[1])/2,floor=base+plan.foundation;
    // Local frame: x along (nz,-nx) from the wall's midpoint, d out from the wall.
    const P=(x:number,d:number):Point2=>[ox+tx*x+f.nx*d,oz+tz*x+f.nz*d];
    const at=(part:Part,material:THREE.Material,x:number,y:number,d:number,pitch=0,roll=0,scale=one)=>{const [px,pz]=P(x,d);place(part,material,px,y,pz,yaw,pitch,roll,scale);};
    // The facade's u along this wall, so a door lands between two window columns.
    const u0=(ox-b.center[0])*f.nz-(oz-b.center[1])*f.nx;
    const doorAt=(lo:number,hi:number)=>{const mid=(lo+hi)/2,x=Math.round((u0+mid)/3)*3-u0;return x-.75>=lo&&x+.75<=hi?x:mid;};
    const door=(x:number)=>{
      const d=m.doors[Math.floor(housePalette(b)+b.id.length)%m.doors.length];
      at(box(.98,2.12,.07),d,x,floor+1.06,.035);at(box(.62,.85,.08),m.glass,x,floor+1.6,.04);
      at(box(.98,.36,.06),m.glass,x,floor+2.36,.03);
      for(const s of [-1,1])at(box(.13,2.62,.1),trim,x+s*.555,floor+1.31,.05);
      at(box(1.36,.17,.12),trim,x,floor+2.66,.06);at(box(1.46,.07,.18),trim,x,floor+2.78,.09);
      stats.doors++;
    };
    // A front door without a porch stands on a granite stoop with its own steps.
    const stoop=()=>{
      if(f.setback<3.2)return;
      const x=doorAt(-f.length/2+.8,f.length/2-.8),neighbours=otherBuildingHulls(city,b,ox,oz,30),clear=(p:Point2)=>!inTunnelApproach(city,...p)&&!neighbours.some(o=>pointInside(p,o.footprint));
      const landing=P(x,.5),ground=sampleElevation(city,...landing);if(ground>floor-.1||!clear(landing))return;
      const steps=planPorchStairs({origin:P(x,0),tangent:[tx,tz],normal:[f.nx,f.nz],frontDepth:0,width:1.5,depth:1,frontage:f.length,along:x,setback:f.setback-1.5,landingY:floor-.02},(px,pz)=>sampleElevation(city,px,pz),clear);
      if(!steps)return;
      const low=Math.min(...stairFootprint(landing,[f.nx,f.nz],1.5,1).map(p=>sampleElevation(city,...p)))-.12;
      at(box(1.5,floor-.02-low,1),m.cap,x,(floor-.02+low)/2,.5);
      const stairYaw=Math.atan2(steps.direction[0],steps.direction[1]);
      for(const step of [...steps.steps,steps.landing])place(box(step.width,step.top-step.bottom,step.depth),m.cap,step.center[0],(step.top+step.bottom)/2,step.center[1],stairYaw);
      door(x);
    };
    const porch=plan.porch;
    if(!porch||budget<=0){stoop();continue;}
    const [x0,x1]=flip?[-porch.to,-porch.from]:[porch.from,porch.to],width=x1-x0,mid=(x0+x1)/2,depth=porch.depth,victorian=victorianEra(b)&&porch.kind==='porch';
    const corners=[P(x0,0),P(x1,0),P(x0,depth),P(x1,depth),P(mid,depth)],grounds=corners.map(p=>sampleElevation(city,...p));
    const neighbours=otherBuildingHulls(city,b,ox,oz,35),clear=(p:Point2)=>!inTunnelApproach(city,...p)&&!neighbours.some(o=>pointInside(p,o.footprint));
    if(Math.max(...grounds)>floor-.12||!corners.every(clear)){stoop();continue;}
    const stairs=planPorchStairs({origin:P(mid,0),tangent:[tx,tz],normal:[f.nx,f.nz],frontDepth:0,width:porch.kind==='portico'?Math.min(width,2.2):width,depth,frontage:f.length,along:mid,setback:f.setback-1.5,landingY:floor-.02},(x,z)=>sampleElevation(city,x,z),clear);
    if(!stairs){stoop();continue;}
    budget--;porch.kind==='portico'?stats.porticos++:stats.porches++;
    const H=Math.min(2.6,plan.floorHeight-.35),top=floor+H,low=Math.min(...grounds)-.1;
    // Deck, skirt and steps.
    at(box(width,.14,depth),m.deck,mid,floor-.09,depth/2);
    at(box(width+.06,.2,.06),trim,mid,floor-.12,depth+.01);
    const skirt=(xa:number,da:number,xb:number,db:number)=>{
      const [ax,az]=P(xa,da),[bx,bz]=P(xb,db),length=Math.hypot(bx-ax,bz-az),h=floor-.16-low;if(h<.08||length<.1)return;
      const w=batches.at(m.lattice,ax,az),nx=-(bz-az)/length,nz=(bx-ax)/length;
      const n=[nx,0,nz],s=length/.5,v=h/.5;
      w.reserve(6);const v0=[ax,low,az],v1=[bx,low,bz],v2=[bx,floor-.16,bz],v3=[ax,floor-.16,az];
      for(const [p,uv] of [[v0,[0,0]],[v1,[s,0]],[v2,[s,v]],[v0,[0,0]],[v2,[s,v]],[v3,[0,v]]] as [number[],number[]][])w.vertex(p[0],p[1],p[2],n[0],n[1],n[2],uv[0],uv[1]);
      const back=batches.at(m.lattice,ax,az);back.reserve(6);
      for(const [p,uv] of [[v0,[0,0]],[v2,[s,v]],[v1,[s,0]],[v0,[0,0]],[v3,[0,v]],[v2,[s,v]]] as [number[],number[]][])back.vertex(p[0],p[1],p[2],-n[0],-n[1],-n[2],uv[0],uv[1]);
    };
    skirt(x0,depth,x1,depth);skirt(x0,0,x0,depth);skirt(x1,depth,x1,0);
    const stairYaw=Math.atan2(stairs.direction[0],stairs.direction[1]);
    for(const step of [...stairs.steps,stairs.landing])place(box(step.width,step.top-step.bottom,step.depth),m.deck,step.center[0],(step.top+step.bottom)/2,step.center[1],stairYaw);
    door(doorAt(x0,x1));
    if(porch.kind==='portico'){
      // Two columns, an entablature and a small gable or flat hood over the door.
      for(const s of [-1,1]){const x=mid+s*(width/2-.18);at(turnedPost(),trim,x,floor,depth-.18,0,0,new THREE.Vector3(2.6,H,2.6));at(box(.3,.12,.3),trim,x,floor+.06,depth-.18);at(box(.32,.16,.32),trim,x,top-.08,depth-.18);}
      at(box(width,.26,depth+.05),trim,mid,top+.13,depth/2);
      at(box(width+.3,.08,depth+.25),options.roofs[Math.max(0,houseRoof(b))]??options.trimRoof,mid,top+.3,depth/2+.1,.12);
      continue;
    }
    // Posts with plinths and caps, scroll brackets, beams, a spindle frieze and a shed roof.
    const count=Math.max(2,Math.round(width/2.3)+1),posts:number[]=[];
    for(let i=0;i<count;i++)posts.push(x0+.12+(width-.24)*i/(count-1));
    for(const x of posts){
      if(options.mobile||!victorian)at(box(.14,H,.14),trim,x,floor+H/2,depth-.12);
      else{at(box(.16,.42,.16),trim,x,floor+.21,depth-.12);at(turnedPost(),trim,x,floor,depth-.12,0,0,new THREE.Vector3(1.25,H,1.25));at(box(.15,.3,.15),trim,x,top-.15,depth-.12);}
      if(victorian&&!options.mobile)for(const s of [-1,1]){if((x<=x0+.2&&s<0)||(x>=x1-.2&&s>0))continue;at(box(.42,.06,.06),trim,x+s*.18,top-.2,depth-.12,0,s*Math.PI/4);}
    }
    at(box(width+.1,.22,.18),trim,mid,top+.11,depth-.12);
    for(const x of [x0+.06,x1-.06])at(box(.16,.22,depth),trim,x,top+.11,depth/2);
    const quad=(material:THREE.Material,a:Point2,bp:Point2,y0:number,y1:number,su:number,sv:number)=>{
      const length=Math.hypot(bp[0]-a[0],bp[1]-a[1]),nx=-(bp[1]-a[1])/length,nz=(bp[0]-a[0])/length,w=batches.at(material,a[0],a[1]);
      w.reserve(6);for(const [x,y,z,u,v] of [[a[0],y0,a[1],0,0],[bp[0],y0,bp[1],su,0],[bp[0],y1,bp[1],su,sv],[a[0],y0,a[1],0,0],[bp[0],y1,bp[1],su,sv],[a[0],y1,a[1],0,sv]])w.vertex(x,y,z,nx,0,nz,u,v);
    };
    if(victorian)for(const [a,bp] of [[P(x0,depth-.12),P(x1,depth-.12)],[P(x0+.06,.05),P(x0+.06,depth-.12)],[P(x1-.06,depth-.12),P(x1-.06,.05)]] as [Point2,Point2][]){
      const length=Math.hypot(bp[0]-a[0],bp[1]-a[1]);quad(m.frieze[palette.trim],a,bp,top-.34,top-.02,length/.6,1);
    }
    // Balustrade on three sides, open where the steps arrive.
    const rail=(a:Point2,bp:Point2)=>{const length=Math.hypot(bp[0]-a[0],bp[1]-a[1]);if(length<.3)return;quad(m.balusters[palette.trim],a,bp,floor,floor+.86,length/.6,1);
      const yawR=Math.atan2(bp[1]-a[1],bp[0]-a[0]);place(box(length,.07,.11),trim,(a[0]+bp[0])/2,floor+.88,(a[1]+bp[1])/2,-yawR);};
    if(stairs.entry==='front'){const gap=.68;rail(P(x0+.12,depth-.12),P(mid-gap,depth-.12));rail(P(mid+gap,depth-.12),P(x1-.12,depth-.12));}
    else rail(P(x0+.12,depth-.12),P(x1-.12,depth-.12));
    // planPorchStairs runs in this frame: a 'left' flight leaves from the x0 end whichever way the wall runs.
    if(stairs.entry!=='left')rail(P(x0+.06,.1),P(x0+.06,depth-.2));
    if(stairs.entry!=='right')rail(P(x1-.06,.1),P(x1-.06,depth-.2));
    // Ceiling and the roof sloping from the wall to beyond the beam.
    const roofMaterial=options.roofs[Math.max(0,houseRoof(b))]??options.trimRoof,rise=.42,run=depth+.32,slope=Math.atan2(rise,run),length=Math.hypot(rise,run);
    at(box(width+.3,.06,depth),trim,mid,top+.19,depth/2);
    at(box(width+.5,.09,length),roofMaterial,mid,top+.26+rise/2,run/2,slope);
    for(const s of [-1,1])at(box(.05,.26,length),trim,mid+s*(width/2+.25),top+.2+rise/2,run/2,slope);
    at(box(width+.5,.18,.05),trim,mid,top+.17,run);
  }
  for(const mesh of batches.meshes()){mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
  group.userData={...stats,accuracy:'Interpretive porches, towers, doors and chimneys on generated houses from the assessor style'};
  (options.target??scene).add(group);return group;

  function chimney(b:Building,spot:Point2){
    const roof=[[0,0],[1.1,0],[-1.1,0],[0,1.1],[0,-1.1]].map(([dx,dz])=>options.roofTop(b,spot[0]+dx,spot[1]+dz)).filter((v):v is number=>v!==undefined);
    const here=options.roofTop(b,spot[0],spot[1]);if(here===undefined||!roof.length)return;
    const victorian=victorianEra(b),top=Math.max(...roof)+(victorian?1.15:.85),bottom=here-.45,box2=orientedBox(b.footprint);
    const yaw=Math.atan2(box2.ux,box2.uz),w=victorian?.62:.56,d=victorian?.92:.78;
    const writer=batches.at(m.brick,spot[0],spot[1]);prism(writer,spot,yaw,w,d,bottom,top-.3);
    // Corbelled cap: two projecting brick courses and a stone cap.
    prism(writer,spot,yaw,w+.12,d+.12,top-.3,top-.18);prism(writer,spot,yaw,w+.06,d+.06,top-.18,top-.06);
    prism(batches.at(m.cap,spot[0],spot[1]),spot,yaw,w+.02,d+.02,top-.06,top);
    stats.chimneys++;
  }
  function garageDoor(b:Building,plan:HousePlan){
    let a:Point2,c:Point2,nx:number,nz:number;
    if(plan.front){a=plan.front.a;c=plan.front.b;nx=plan.front.nx;nz=plan.front.nz;}
    else{let best=-1,k=0;for(let i=0;i<b.footprint.length;i++){const p=b.footprint[i],r=b.footprint[(i+1)%b.footprint.length],l=Math.hypot(r[0]-p[0],r[1]-p[1]);if(l>best){best=l;k=i;}}a=b.footprint[k];c=b.footprint[(k+1)%b.footprint.length];[nx,nz]=outwardNormal(b.footprint,k);}
    const length=Math.hypot(c[0]-a[0],c[1]-a[1]);if(length<2.6)return;
    const yaw=Math.atan2(nx,nz),tx=nz,tz=-nx,cx=(a[0]+c[0])/2,cz=(a[1]+c[1])/2,base=b.baseElevation??0,y=Math.max(base,sampleElevation(city,cx+nx*.5,cz+nz*.5));
    const doors=length>=5.8?2:1,w=Math.min(2.6,(length-.5*(doors+1))/doors);
    for(let i=0;i<doors;i++){const x=(i-(doors-1)/2)*(w+.45);place(box(w,2.08,.06),m.garage,cx+tx*x+nx*.03,y+1.06,cz+tz*x+nz*.03,yaw);}
    stats.garageDoors++;
  }
  /** A brick shaft with metric UVs (open bottom), oriented with the house. */
  function prism(w:TriangleWriter,c:Point2,yaw:number,width:number,depth:number,y0:number,y1:number){
    const ax=Math.cos(yaw),az=-Math.sin(yaw),bx=Math.sin(yaw),bz=Math.cos(yaw),hx=width/2,hz=depth/2;
    const corner=(i:number,j:number):[number,number]=>[c[0]+ax*hx*i+bx*hz*j,c[1]+az*hx*i+bz*hz*j];
    const ring=[corner(-1,-1),corner(1,-1),corner(1,1),corner(-1,1)];
    for(let k=0;k<4;k++){
      const p=ring[k],r=ring[(k+1)%4],l=Math.hypot(r[0]-p[0],r[1]-p[1]),mx=(p[0]+r[0])/2-c[0],mz=(p[1]+r[1])/2-c[1],s=l/.6,t0=y0/.6,t1=y1/.6;
      const nl=Math.hypot(mx,mz)||1;let ux=r[0]-p[0],uz=r[1]-p[1];const cross=uz*mx-ux*mz;
      const [a,b2]=cross>0?[r,p]:[p,r];ux=b2[0]-a[0];uz=b2[1]-a[1];
      w.reserve(6);for(const [x,yy,z,u,v] of [[a[0],y0,a[1],0,t0],[b2[0],y0,b2[1],s,t0],[b2[0],y1,b2[1],s,t1],[a[0],y0,a[1],0,t0],[b2[0],y1,b2[1],s,t1],[a[0],y1,a[1],0,t1]])w.vertex(x,yy,z,mx/nl,0,mz/nl,u,v);
    }
    w.reserve(6);const T=(p:Point2)=>[p[0],y1,p[1],(p[0]-c[0])/.6,(p[1]-c[1])/.6];
    for(const p of [T(ring[0]),T(ring[2]),T(ring[1]),T(ring[0]),T(ring[3]),T(ring[2])])w.vertex(p[0],p[1],p[2],0,1,0,p[3],p[4]);
  }
}
