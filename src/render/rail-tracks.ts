import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type {CityData} from '../types';
import type {DrivingPhysics} from '../physics/vehicle';
import {sampleElevation} from '../simulation/terrain';
import {canvasTexture,seeded} from './materials';
import {RailPath,isRailData,nearestRail,railCells,railRuns,railStations,type RailBridge,type RailCell,type RailData} from '../simulation/rail-tracks';

/** Static Orange Line and Haverhill Line track from rail.json: ballast, ties, rails
 * and contact rail, bridge decks with parapets or through girders, piers and
 * abutments, portals where a track runs under a street or into the Charlestown
 * tunnel, platforms with edge strips and canopies, level crossings and buffer
 * stops. The document is cut into CELL squares built lazily near the camera (one
 * per update), hidden and then dropped with their colliders as it moves away.
 * Each cell is at most four meshes: textured ballast, steel, vertex-coloured
 * structure, and instanced ties (not on phones). */

const CELL=256;
const TOP=.17;          // ballast top below the top of rail
const HALF=1.6;         // ballast top half width (ties 2.6 m)
const SHOULDER=.45;     // shoulder drop below the ballast top on open track
const SLOPE=1.4;        // shoulder run per metre of drop
const FILL=1.5;         // embankment run per metre of drop
const DECK=.52;         // deck top below the top of rail (ballasted deck)
const GAUGE_OFFSET=.7525,HEAD=.035,RAIL_HEIGHT=.15;
const TIE={length:2.6,height:.16,width:.24,spacing:.65};
const PERIOD=TIE.spacing*2; // the ballast texture holds two ties
const TIE_ROW=16,TIE_PX=Math.round(128*TIE.width/PERIOD);
/** Painted tie centres sit at (k + TIE_PHASE) tie spacings (canvas rows run down from v = 1). */
const TIE_PHASE=(2*(1-(TIE_ROW+TIE_PX/2)/128))%1;
const C=(hex:number)=>new THREE.Color(hex);
const COLOR={concrete:C(0x9a988f),deck:C(0x96948b),pier:C(0x8f8d86),steel:C(0x67716d),fill:C(0x6d6955),dark:C(0x050506),yellow:C(0xd6b028),platform:C(0x9c9b93),edge:C(0x85847c),roof:C(0x41474a),post:C(0x5b6165),panel:C(0x2f2f2d),white:C(0xe2e2da),red:C(0x8c1010),black:C(0x1a1a1a),bumper:C(0xb8321e)};

interface Frame{x:number;y:number;z:number;tx:number;tz:number;grade:number;rx:number;rz:number}
type V3=[number,number,number];
type Section=(f:Frame,k:number)=>[number,number];

/** Indexed triangles with flat or per-lane normals, optional vertex colours. */
class Builder{
 readonly p:number[]=[];readonly n:number[]=[];readonly uv:number[]=[];readonly c:number[]=[];readonly index:number[]=[];
 constructor(readonly colors:boolean){}
 get empty(){return this.index.length===0;}
 vertex(x:number,y:number,z:number,nx:number,ny:number,nz:number,u:number,v:number,color?:THREE.Color){
  const i=this.p.length/3;this.p.push(x,y,z);this.n.push(nx,ny,nz);this.uv.push(u,v);if(this.colors){const c=color??COLOR.concrete;this.c.push(c.r,c.g,c.b);}return i;
 }
 quad(a:number,b:number,c:number,d:number){this.index.push(a,b,c,a,c,d);}
 /** A lane from section edge `a` to edge `c` along the frames; walking the section clockwise as seen looking forward faces it outward. */
 lane(frames:Frame[],a:Section,c:Section,color?:THREE.Color,ua=0,uc=1,v?:(k:number)=>number){
  const base=this.p.length/3;
  frames.forEach((f,k)=>{
   const [oa,ya]=a(f,k),[oc,yc]=c(f,k),ax=f.x+f.rx*oa,az=f.z+f.rz*oa,cx=f.x+f.rx*oc,cz=f.z+f.rz*oc,Ax=cx-ax,Ay=yc-ya,Az=cz-az;
   let nx=Ay*f.tz-Az*f.grade,ny=Az*f.tx-Ax*f.tz,nz=Ax*f.grade-Ay*f.tx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
   const vv=v?v(k):0;this.vertex(ax,ya,az,nx,ny,nz,ua,vv,color);this.vertex(cx,yc,cz,nx,ny,nz,uc,vv,color);
  });
  for(let k=0;k<frames.length-1;k++){const i=base+k*2;this.quad(i,i+1,i+3,i+2);}
 }
 /** A section (points clockwise looking forward) swept along the frames; `closed` adds the lane from the last point back to the first. */
 sweep(frames:Frame[],section:(f:Frame)=>[number,number][],color?:THREE.Color,closed=true){
  const sections=frames.map(section),m=sections[0].length;
  for(let i=0;i<(closed?m:m-1);i++){const j=(i+1)%m;this.lane(frames,(_,k)=>sections[k][i],(_,k)=>sections[k][j],color);}
 }
 /** A box: centre, right-handed unit axes u, v, w (u x v = w) and half extents; `front` recolours the +w face. */
 box(c:V3,u:V3,v:V3,w:V3,hu:number,hv:number,hw:number,color?:THREE.Color,front?:THREE.Color){
  // [normal, p, q] with p x q = normal for the + face; the - face swaps p and q.
  const faces:[V3,number,V3,number,V3,number][]=[[u,hu,v,hv,w,hw],[v,hv,w,hw,u,hu],[w,hw,u,hu,v,hv]];
  for(const [n,hn,p,hp,q,hq]of faces)for(const sign of [1,-1]){
   const P=sign>0?p:q,Q=sign>0?q:p,HP=sign>0?hp:hq,HQ=sign>0?hq:hp,base=this.p.length/3,tint=front&&n===w&&sign>0?front:color;
   for(const [a,b]of [[-1,-1],[1,-1],[1,1],[-1,1]])this.vertex(c[0]+n[0]*hn*sign+P[0]*HP*a+Q[0]*HQ*b,c[1]+n[1]*hn*sign+P[1]*HP*a+Q[1]*HQ*b,c[2]+n[2]*hn*sign+P[2]*HP*a+Q[2]*HQ*b,n[0]*sign,n[1]*sign,n[2]*sign,(a+1)/2,(b+1)/2,tint);
   this.quad(base,base+1,base+2,base+3);
  }
 }
 geometry(){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(this.uv,2));
  if(this.colors)g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));
  g.setIndex(this.index);g.computeBoundingSphere();return g;
 }
}

/** Unit axes for a box facing yaw (w forward, u right-handed across, v up), pitched by `grade`. */
function axes(yaw:number,grade=0):[V3,V3,V3]{
 const cp=1/Math.hypot(1,grade),sp=grade*cp,sy=Math.sin(yaw),cy=Math.cos(yaw);
 const w:V3=[sy*cp,sp,cy*cp],v:V3=[-sy*sp,cp,-cy*sp],u:V3=[v[1]*w[2]-v[2]*w[1],v[2]*w[0]-v[0]*w[2],v[0]*w[1]-v[1]*w[0]];
 return [u,v,w];
}

function ballastTexture(){
 if(typeof document==='undefined')return null;
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!,random=seeded(7031);
 ctx.fillStyle='#7b766c';ctx.fillRect(0,0,128,128);
 for(let i=0;i<2600;i++){const g=88+random()*70|0;ctx.fillStyle=`rgb(${g+6},${g},${g-8})`;ctx.fillRect(random()*128,random()*128,1+random()*2,1+random()*2);}
 // Two ties per repeat, 2.6 m of the 3.2 m top; rail seats darkened by oil and rust.
 const x0=Math.round(128*(HALF-TIE.length/2)/(HALF*2)),x1=128-x0,h=TIE_PX;
 for(const y0 of [TIE_ROW,TIE_ROW+64]){
  ctx.fillStyle='#4f463d';ctx.fillRect(x0,y0,x1-x0,h);
  for(let i=0;i<40;i++){const g=60+random()*30|0;ctx.fillStyle=`rgba(${g},${g-6},${g-14},.6)`;ctx.fillRect(x0+random()*(x1-x0),y0+random()*h,6+random()*14,1);}
 }
 for(const side of [-1,1]){const x=64+side*Math.round(128*GAUGE_OFFSET/(HALF*2));ctx.fillStyle='rgba(70,52,38,.35)';ctx.fillRect(x-7,0,14,128);}
 const texture=canvasTexture(canvas,true);texture.wrapS=THREE.ClampToEdgeWrapping;return texture;
}

/** rail.json from the package, or undefined when the package has none (an older
 * package, or a dev server answering a missing file with index.html). */
export async function loadRailData(url:string):Promise<RailData|undefined>{
 try{const response=await fetch(url);if(!response.ok)return undefined;const data=JSON.parse(await response.text());return isRailData(data)?data:undefined;}catch{return undefined;}
}

export function createRailTracks(scene:THREE.Scene,city:CityData,physics:DrivingPhysics|undefined,data:RailData,{mobile=false}:{mobile?:boolean}={}){
 const group=new THREE.Group();group.name='Orange Line and Haverhill Line track';scene.add(group);
 const paths=data.tracks.map(t=>new RailPath(t)),cells=[...railCells(data,CELL).values()].sort((a,b)=>a.key<b.key?-1:1);
 const spacing=mobile?4:2,buildRadius=mobile?650:950,disposeRadius=mobile?900:1250,tieRadius=380;
 const texture=ballastTexture();
 const ballast=new THREE.MeshStandardMaterial({map:texture,color:texture?0xffffff:0x76716a,roughness:1});
 const steel=new THREE.MeshStandardMaterial({color:0x5d6263,metalness:.65,roughness:.38});
 const structure=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9});
 const tieMaterial=new THREE.MeshStandardMaterial({color:0x564d44,roughness:.95});
 const tieGeometry=new THREE.BoxGeometry(TIE.length,TIE.height,TIE.width);
 const ground=(x:number,z:number)=>sampleElevation(city,x,z);
 const frameAt=(path:RailPath,s:number):Frame=>{
  const p=path.sample(s),a=path.sample(Math.max(0,s-1.5)),b=path.sample(Math.min(path.length,s+1.5)),dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);
  const tx=l>1e-6?dx/l:p.tx,tz=l>1e-6?dz/l:p.tz;return{x:p.x,y:p.y,z:p.z,tx,tz,grade:p.grade,rx:-tz,rz:tx};
 };
 const built=new Map<string,{group:THREE.Group;ties?:THREE.InstancedMesh;colliders:RAPIER.Collider[];cell:RailCell}>();

 function buildCell(cell:RailCell){
  const ballastB=new Builder(false),steelB=new Builder(false),s=new Builder(true),ties:THREE.Matrix4[]=[],colliders:RAPIER.Collider[]=[];
  const collide=(c:V3,[u,v,w]:[V3,V3,V3],hu:number,hv:number,hw:number)=>{
   if(!physics||hu<=.01||hv<=.01||hw<=.01)return;
   const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...u),new THREE.Vector3(...v),new THREE.Vector3(...w)));
   const collider=physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hu,hv,hw).setTranslation(c[0],c[1],c[2]).setRotation({x:q.x,y:q.y,z:q.z,w:q.w}).setFriction(.6).setRestitution(.03));
   physics.detailedColliders.add(collider.handle);colliders.push(collider);
  };
  const solid=(c:V3,ax:[V3,V3,V3],hu:number,hv:number,hw:number,color:THREE.Color,collidable=true)=>{s.box(c,ax[0],ax[1],ax[2],hu,hv,hw,color);if(collidable)collide(c,ax,hu,hv,hw);};
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),scale=new THREE.Vector3(1,1,1);
  for(const [t,from,to]of cell.pieces){
   const path=paths[t],track=path.track,last=to>=track.length-1e-6,v=(f:Frame[])=>(k:number)=>stationsOf(f)[k]/PERIOD;
   const stationMap=new Map<Frame[],number[]>(),stationsOf=(f:Frame[])=>stationMap.get(f)!;
   for(const run of railRuns(path,railStations(path,from,to,spacing))){
    if(run.kind==='covered')continue;
    const frames=run.stations.map(st=>frameAt(path,st));stationMap.set(frames,run.stations);
    const bridge=run.bridge,top=(f:Frame)=>f.y-TOP;
    if(bridge){
     // Ballast on the deck, the deck slab, and its parapets or through girders.
     const yd=(f:Frame)=>f.y-DECK,through=bridge.kind==='through',th=through?.45:1.0,[hl,hr]=bridge.half,shoulder=HALF+(DECK-TOP)*SLOPE;
     ballastB.lane(frames,f=>[-shoulder,yd(f)],f=>[-HALF,top(f)],undefined,0,.04,v(frames));
     ballastB.lane(frames,f=>[-HALF,top(f)],f=>[HALF,top(f)],undefined,0,1,v(frames));
     ballastB.lane(frames,f=>[HALF,top(f)],f=>[shoulder,yd(f)],undefined,.96,1,v(frames));
     s.sweep(frames,f=>[[-hl,yd(f)-th],[-hl,yd(f)],[hr,yd(f)],[hr,yd(f)-th]],COLOR.deck);
     const wall=through?{height:2.1,thick:.42,color:COLOR.steel}:{height:1.05,thick:.25,color:COLOR.concrete};
     if(bridge.walls[0])s.sweep(frames,f=>[[-hl,yd(f)-(through?th:.05)],[-hl,yd(f)+wall.height],[-hl+wall.thick,yd(f)+wall.height],[-hl+wall.thick,yd(f)]],wall.color);
     if(bridge.walls[1])s.sweep(frames,f=>[[hr-wall.thick,yd(f)],[hr-wall.thick,yd(f)+wall.height],[hr,yd(f)+wall.height],[hr,yd(f)-(through?th:.05)]],wall.color);
     // Deck and wall colliders in pieces of at most 12 m, pitched to the profile.
     for(let i=0;i<frames.length-1;){
      let j=i+1;while(j<frames.length-1&&run.stations[j]-run.stations[i]<12)j++;
      const a=frames[i],b=frames[j],len=Math.hypot(b.x-a.x,b.z-a.z),grade=(b.y-a.y)/(len||1),yaw=Math.atan2(b.x-a.x,b.z-a.z),ax=axes(yaw,grade),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2,my=(a.y+b.y)/2-DECK,rx=(a.rx+b.rx)/2,rz=(a.rz+b.rz)/2,off=(hr-hl)/2;
      collide([mx+rx*off,my-th/2,mz+rz*off],ax,(hl+hr)/2,th/2,len/2+.05);
      for(const [side,h]of [[-1,hl],[1,hr]]as const)if(bridge.walls[side<0?0:1])collide([mx+rx*side*(h-wall.thick/2),my+wall.height/2,mz+rz*side*(h-wall.thick/2)],ax,wall.thick/2,wall.height/2,len/2+.05);
      i=j;
     }
     // Piers and abutments belong to the piece holding their station.
     for(const d of bridge.piers)if(d>=from&&(d<to||last))pier(path,bridge,d,th);
     for(const [d,out]of [[bridge.start,-1],[bridge.end,1]]as const)if((d>=from&&d<to)||(last&&d===to))abutment(path,bridge,d,out,th);
    }else{
     // Open track: ballast prism, and an embankment down to the graded terrain where the bed stands above it.
     const shoulder=HALF+SHOULDER*SLOPE;
     ballastB.lane(frames,f=>[-shoulder,top(f)-SHOULDER],f=>[-HALF,top(f)],undefined,0,.04,v(frames));
     ballastB.lane(frames,f=>[-HALF,top(f)],f=>[HALF,top(f)],undefined,0,1,v(frames));
     ballastB.lane(frames,f=>[HALF,top(f)],f=>[shoulder,top(f)-SHOULDER],undefined,.96,1,v(frames));
     const foot=frames.map(f=>([-1,1]as const).map(side=>{
      const yb=top(f)-SHOULDER,g0=ground(f.x+f.rx*side*(shoulder+1),f.z+f.rz*side*(shoulder+1)),drop=Math.min(6,Math.max(0,yb-g0)),o=shoulder+drop*FILL+.6;
      return [side*o,Math.min(yb-.4,ground(f.x+f.rx*side*o,f.z+f.rz*side*o)-.3)] as [number,number];
     }));
     s.lane(frames,(_,k)=>foot[k][0],f=>[-shoulder,top(f)-SHOULDER],COLOR.fill);
     s.lane(frames,f=>[shoulder,top(f)-SHOULDER],(_,k)=>foot[k][1],COLOR.fill);
    }
    // Rails, contact rail and ties on open track and decks alike.
    for(const side of [-1,1]){const o=side*GAUGE_OFFSET;steelB.sweep(frames,f=>[[o-HEAD,f.y-RAIL_HEIGHT],[o-HEAD,f.y],[o+HEAD,f.y],[o+HEAD,f.y-RAIL_HEIGHT]],undefined,false);}
    let runStart=-1;
    const third=(i:number)=>path.thirdRailSide((run.stations[i]+run.stations[i+1])/2);
    for(let i=0;i<=frames.length-1;i++){
     const side=i<frames.length-1?third(i):0;
     if(runStart>=0&&(i===frames.length-1||side!==third(runStart))){
      const sd=third(runStart),o=sd*1.45;if(sd&&i>runStart)steelB.sweep(frames.slice(runStart,i+1),f=>[[o-.05,f.y-.08],[o-.05,f.y+.05],[o+.05,f.y+.05],[o+.05,f.y-.08]],undefined,false);
      runStart=-1;
     }
     if(runStart<0&&side)runStart=i;
    }
    // Rubber panels where a street crosses at grade.
    for(const c of track.crossings){
     const a=Math.max(c.start,run.stations[0]),b=Math.min(c.end,run.stations[run.stations.length-1]);if(b-a<.5)continue;
     const st:number[]=[];for(let d=a;d<b;d+=spacing)st.push(d);st.push(b);const fr=st.map(d=>frameAt(path,d));
     s.sweep(fr,f=>[[-1.3,f.y-.12],[-1.3,f.y-.02],[1.3,f.y-.02],[1.3,f.y-.12]],COLOR.panel);
    }
    if(!mobile){
     const s0=run.stations[0],s1=run.stations[run.stations.length-1];
     for(let k=Math.ceil(s0/TIE.spacing-TIE_PHASE);(k+TIE_PHASE)*TIE.spacing<s1;k++){
      const d=(k+TIE_PHASE)*TIE.spacing;if(d<s0||path.crossing(d))continue;const f=frameAt(path,d);
      q.setFromAxisAngle(up,Math.atan2(f.tx,f.tz));matrix.compose(new THREE.Vector3(f.x,f.y-RAIL_HEIGHT-TIE.height/2,f.z),q,scale);ties.push(matrix.clone());
     }
    }
   }
  }
  function pier(path:RailPath,bridge:RailBridge,d:number,th:number){
   const f=frameAt(path,d),[hl,hr]=bridge.half,off=(hr-hl)/2,cx=f.x+f.rx*off,cz=f.z+f.rz*off,capTop=f.y-DECK-th,yaw=Math.atan2(f.tx,f.tz),ax=axes(yaw);
   const g=Math.min(ground(cx,cz),ground(cx+f.tx*.8,cz+f.tz*.8),ground(cx-f.tx*.8,cz-f.tz*.8))-.6;
   solid([cx,capTop-.45,cz],ax,(hl+hr)/2+.2,.45,.9,COLOR.pier);
   if(capTop-.9>g)solid([cx,(capTop-.9+g)/2,cz],ax,.75,(capTop-.9-g)/2,.75,COLOR.pier);
  }
  function abutment(path:RailPath,bridge:RailBridge,d:number,out:number,th:number){
   const at=Math.min(path.length,Math.max(0,d+out*1.2));if(path.covered(at))return;
   const f=frameAt(path,at),[hl,hr]=bridge.half,off=(hr-hl)/2,cx=f.x+f.rx*off,cz=f.z+f.rz*off,deck=f.y-DECK,yaw=Math.atan2(f.tx,f.tz);
   let g=Infinity;for(const o of [-hl,0,hr])g=Math.min(g,ground(f.x+f.rx*o,f.z+f.rz*o));g-=.6;
   const bottom=Math.min(g,deck-th-.5);solid([cx,(deck+bottom)/2,cz],axes(yaw),(hl+hr)/2+.35,(deck-bottom)/2,1.2,COLOR.concrete);
  }
  for(const i of cell.platforms)platform(data.platforms[i]);
  function platform(p:RailData['platforms'][number]){
   const ring=p.ring,n=ring.length;if(n<3)return;
   let cx=0,cz=0,bottom=Infinity;for(const [x,z]of ring){cx+=x/n;cz+=z/n;bottom=Math.min(bottom,ground(x,z));}
   bottom=Math.min(bottom,p.top-1.4)-.4;
   const contour=ring.map(([x,z])=>new THREE.Vector2(x,z));
   for(const [a,b,c]of THREE.ShapeUtils.triangulateShape(contour,[])){
    const A=ring[a],B=ring[b],Cc=ring[c],up=(B[1]-A[1])*(Cc[0]-A[0])-(B[0]-A[0])*(Cc[1]-A[1])>0;
    const order=up?[A,B,Cc]:[A,Cc,B],base=s.p.length/3;for(const [x,z]of order)s.vertex(x,p.top,z,0,1,0,0,0,COLOR.platform);s.index.push(base,base+1,base+2);
   }
   ring.forEach((a,i)=>{
    const b=ring[(i+1)%n],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<.01)return;
    let nx=dz/l,nz=-dx/l;if(nx*((a[0]+b[0])/2-cx)+nz*((a[1]+b[1])/2-cz)<0){nx=-nx;nz=-nz;}
    const base=s.p.length/3;for(const [x,z,y]of [[a[0],a[1],bottom],[b[0],b[1],bottom],[b[0],b[1],p.top],[a[0],a[1],p.top]])s.vertex(x,y,z,nx,0,nz,0,0,COLOR.edge);
    // Outward faces wind counter-clockwise seen from outside.
    if(nx*dz-nz*dx<0)s.quad(base,base+1,base+2,base+3);else s.quad(base,base+3,base+2,base+1);
    if(!p.edges.includes(i)||l<2)return;
    const ix=-nx*.6,iz=-nz*.6,y=p.top+.008,e=s.p.length/3;
    for(const [x,z]of [[a[0],a[1]],[b[0],b[1]],[b[0]+ix,b[1]+iz],[a[0]+ix,a[1]+iz]])s.vertex(x,y,z,0,1,0,0,0,COLOR.yellow);
    const cross=(dx*iz-dz*ix)<0;if(cross)s.quad(e,e+1,e+2,e+3);else s.quad(e,e+3,e+2,e+1);
   });
   if(physics){
    const points:number[]=[];for(const [x,z]of ring)points.push(x,bottom,z,x,p.top,z);
    const desc=RAPIER.ColliderDesc.convexHull(new Float32Array(points));
    if(desc){const collider=physics.world.createCollider(desc.setFriction(.6));physics.detailedColliders.add(collider.handle);colliders.push(collider);}
   }
   if(p.canopy){
    const [x0,z0,x1,z1,width]=p.canopy,len=Math.hypot(x1-x0,z1-z0),yaw=Math.atan2(x1-x0,z1-z0),ax=axes(yaw),roof=p.top+(p.level==='low'?3.0:3.3);
    solid([(x0+x1)/2,roof,(z0+z1)/2],ax,width/2,.14,len/2,COLOR.roof,false);
    const posts=Math.max(2,Math.round(len/9)+1);
    for(let i=0;i<posts;i++){const u=i/(posts-1),x=x0+(x1-x0)*u,z=z0+(z1-z0)*u;solid([x,(p.top+roof)/2,z],ax,.13,(roof-p.top)/2,.13,COLOR.post);}
   }
  }
  for(const i of cell.portals){
   const p=data.portals[i],[u,v,w]=axes(p.yaw),opening=Math.max(4.4,p.width-1.6),side=(p.width-opening)/2,base=p.bottom-.6,depth=8;
   const at=(across:number,y:number,back:number):V3=>[p.x+u[0]*across-w[0]*back,y,p.z+u[2]*across-w[2]*back];
   // The opening: a box reaching back into the cover, dark on its face just inside the frame and
   // concrete outside (a cut-and-cover box where it stands above the ground). Its roof stays under
   // the ground: everywhere over an underpass (a street only a little over the rails leaves a low
   // slot), and over the inner half of a tunnel mouth (the DEM often carries the approach cut past the face).
   let roof=p.bottom+Math.min(p.top-p.bottom-.6,5.2);
   for(let a=-4;a<=4;a++)for(const back of p.kind==='tunnel'?[depth/2+.3,depth*.75+.3,depth+.3]:[.3,2.3,4.3,6.3,depth+.3]){const [x,,z]=at(a/4*opening/2,0,back);roof=Math.min(roof,ground(x,z)-.2);}
   const height=Math.max(.3,roof-p.bottom);
   for(const sign of [-1,1])solid(at(sign*(opening/2+side/2),(base+p.top)/2,.45),[u,v,w],side/2,(p.top-base)/2,.45,COLOR.concrete);
   if(p.top>p.bottom+height)solid(at(0,(p.bottom+height+p.top)/2,.45),[u,v,w],opening/2,(p.top-p.bottom-height)/2,.45,COLOR.concrete);
   s.box(at(0,p.bottom+height/2,.3+depth/2),u,v,w,opening/2,height/2,depth/2,COLOR.concrete,COLOR.dark);
   collide(at(0,(base+p.top)/2,.45),[u,v,w],p.width/2,(p.top-base)/2,.45);
  }
  for(const i of cell.crossings){
   const c=data.crossings[i],ux=Math.sin(c.yaw),uz=Math.cos(c.yaw),px=-uz,pz=ux;
   // A signal mast on each approach, on that approach's right side of the road.
   for(const sign of [-1,1]){
    const along=sign*(c.half+2.2),lateral=-sign*(c.road+.9),x=c.x+ux*along+px*lateral,z=c.z+uz*along+pz*lateral,g=ground(x,z),face=Math.atan2(sign*ux,sign*uz),ax=axes(face);
    solid([x,g+1.8,z],ax,.08,1.8,.08,COLOR.white);
    for(const tilt of [Math.PI/4,-Math.PI/4]){
     const cu=Math.cos(tilt),su=Math.sin(tilt),bu:V3=[ax[0][0]*cu+ax[1][0]*su,ax[0][1]*cu+ax[1][1]*su,ax[0][2]*cu+ax[1][2]*su],bv:V3=[-ax[0][0]*su+ax[1][0]*cu,-ax[0][1]*su+ax[1][1]*cu,-ax[0][2]*su+ax[1][2]*cu];
     s.box([x+ax[2][0]*.12,g+3.2,z+ax[2][2]*.12],bu,bv,ax[2],.62,.11,.02,COLOR.white);
    }
    s.box([x+ax[2][0]*.1,g+2.55,z+ax[2][2]*.1],ax[0],ax[1],ax[2],.5,.07,.05,COLOR.black);
    for(const o of [-.42,.42])s.box([x+ax[0][0]*o+ax[2][0]*.16,g+2.55,z+ax[0][2]*o+ax[2][2]*.16],ax[0],ax[1],ax[2],.15,.15,.06,COLOR.red);
    // The gate arm, raised.
    s.box([x-ax[0][0]*.35,g+3.0,z-ax[0][2]*.35],ax[0],ax[1],ax[2],.06,1.9,.06,COLOR.white);
   }
  }
  for(const i of cell.bumpers){
   const b=data.bumpers[i],ax=axes(b.yaw),at=(back:number,across:number,y:number):V3=>[b.x-ax[2][0]*back+ax[0][0]*across,y,b.z-ax[2][2]*back+ax[0][2]*across];
   solid(at(.15,0,b.y+.55),ax,1.2,.18,.18,COLOR.bumper);
   for(const o of [-.85,.85])solid(at(-.35,o,b.y+.2),ax,.14,.5,.5,COLOR.steel,false);
  }
  const g=new THREE.Group();g.name=`Rail cell ${cell.key}`;
  for(const [builder,material,name]of [[ballastB,ballast,'Track ballast'],[steelB,steel,'Running and contact rails'],[s,structure,'Rail structures']]as const){
   if(builder.empty)continue;const mesh=new THREE.Mesh(builder.geometry(),material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=builder===s&&!mobile;mesh.matrixAutoUpdate=false;mesh.updateMatrix();g.add(mesh);
  }
  let tieMesh:THREE.InstancedMesh|undefined;
  if(ties.length){tieMesh=new THREE.InstancedMesh(tieGeometry,tieMaterial,ties.length);tieMesh.name='Track ties';ties.forEach((m,i)=>tieMesh!.setMatrixAt(i,m));tieMesh.computeBoundingSphere();tieMesh.receiveShadow=true;tieMesh.matrixAutoUpdate=false;g.add(tieMesh);}
  group.add(g);built.set(cell.key,{group:g,ties:tieMesh,colliders,cell});
 }
 function disposeCell(key:string){
  const entry=built.get(key);if(!entry)return;built.delete(key);group.remove(entry.group);
  for(const object of entry.group.children){if(object instanceof THREE.InstancedMesh)object.dispose();else (object as THREE.Mesh).geometry.dispose();}
  if(physics&&entry.colliders.length)physics.removeColliders(entry.colliders);
 }
 const distanceTo=(cell:RailCell,x:number,z:number)=>Math.hypot(Math.max(0,Math.abs(x-cell.cx)-CELL/2),Math.max(0,Math.abs(z-cell.cz)-CELL/2));
 let lastX=Infinity,lastZ=Infinity,pending=0;
 return{group,paths,
  /** Build the nearest missing cell (one per call), drop distant ones, show ties only near the camera. */
  update(x:number,z:number){
   if(!pending&&Math.hypot(x-lastX,z-lastZ)<16)return;lastX=x;lastZ=z;
   let next:RailCell|undefined,best=Infinity;pending=0;
   for(const cell of cells){
    const d=distanceTo(cell,x,z),entry=built.get(cell.key);
    if(entry){if(d>disposeRadius){disposeCell(cell.key);continue;}entry.group.visible=d<buildRadius+120;if(entry.ties)entry.ties.visible=d<tieRadius;}
    else if(d<buildRadius){pending++;if(d<best){best=d;next=cell;}}
   }
   if(next){buildCell(next);pending--;const entry=built.get(next.key)!;if(entry.ties)entry.ties.visible=best<tieRadius;}
  },
  /** Browser specs: what is built and the nearest drawn track to a point. */
  snapshot(x?:number,z?:number){
   let colliders=0,ties=0;for(const e of built.values()){colliders+=e.colliders.length;ties+=e.ties?.count??0;}
   return{tracks:data.tracks.length,cells:cells.length,built:built.size,pending,colliders,ties,platforms:data.platforms.length,portals:data.portals.length,crossings:data.crossings.length,
    nearest:x===undefined||z===undefined?undefined:nearestRail(paths,x,z)};
  },
  dispose(){for(const key of [...built.keys()])disposeCell(key);scene.remove(group);tieGeometry.dispose();for(const m of [ballast,steel,structure,tieMaterial])m.dispose();texture?.dispose();},
 };
}
