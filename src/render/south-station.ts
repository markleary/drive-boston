import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Building,CityData} from '../types';
import {canvasTexture,seeded} from './materials.ts';
import {landmarkBuildings} from '../simulation/city-tiles.ts';

export const SOUTH_STATION_ID='BOS-DIPUS-MOOL6-PJ4EY';
export const isSouthStation=(building?:Building)=>building?.id===SOUTH_STATION_ID;
// Heights are metres above the surveyed base of the mesh.
const BASE=2.038;
type Point=[number,number];

// Outer wall faces of the 1899 headhouse, sliced from the bundled Boston mesh
// 20 m above its base (the small pier returns are bridged; the pier facings
// cover them). WEST runs north along the Atlantic Avenue wing and round the
// curve to the Dewey Square pavilion; PAVILION is its west return, its
// 15.4 m front and its east return; EAST runs from the pavilion round the
// curve and along the Summer Street wing.
const WEST:Point[]=[[1570.93,-176.72],[1581.99,-207.92],[1584.03,-215.04],[1585.73,-218.38],[1586.76,-221.51],[1587.78,-223.29],[1588.55,-224.97],[1589.3,-226.6],[1590.32,-228.29],[1591.31,-229.93],[1592.45,-231.42],[1593.56,-232.87],[1594.61,-233.92],[1595.63,-234.93],[1597.31,-236.99],[1598.27,-237.87],[1599.19,-238.73],[1600.3,-239.53],[1601.37,-240.31],[1602.64,-241.03],[1603.86,-241.73],[1604.89,-242.19]];
const PAVILION:Point[]=[[1604.89,-242.19],[1603.64,-244.97],[1618.08,-250.29],[1619.21,-247.33]];
const EAST:Point[]=[[1619.21,-247.33],[1621.43,-247.71],[1623.94,-248.14],[1625.52,-247.93],[1627.31,-247.7],[1631.65,-246.73],[1633.51,-246.25],[1635.61,-245.71],[1638.06,-244.69],[1640.83,-243.55],[1642.46,-242.46],[1644.3,-241.24],[1644.98,-241.89],[1651.43,-237.37],[1658.7,-232.28],[1670.28,-223.07],[1683.83,-213.61],[1688.58,-210.89]];
// Back of the headhouse and its concourse: the platform canopies and the bus
// terminal south of this line keep the ordinary landmark finish.
const BACK:Point[]=[[1500,-197.8],[1567.9,-173.1],[1590.7,-164.8],[1674.6,-191.2],[1688.6,-210.9],[1720,-255]];

interface Run{points:Point[];cum:number[];length:number;smooth:boolean}
const makeRun=(points:Point[],smooth=true):Run=>{
  const cum=[0];for(let i=1;i<points.length;i++)cum.push(cum[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  return{points,cum,length:cum[cum.length-1],smooth};
};
const RUNS={west:makeRun(WEST),pavilion:makeRun(PAVILION,false),east:makeRun(EAST)};
const direction=(r:Run,i:number):Point=>{const a=r.points[i],b=r.points[i+1],l=Math.hypot(b[0]-a[0],b[1]-a[1]);return[(b[0]-a[0])/l,(b[1]-a[1])/l];};
const segmentAt=(r:Run,s:number)=>{let i=0;while(i<r.points.length-2&&r.cum[i+1]<s)i++;return i;};
const vertexTangent=(r:Run,i:number):Point=>{
  if(i<=0)return direction(r,0);if(i>=r.points.length-1)return direction(r,r.points.length-2);
  const a=direction(r,i-1),b=direction(r,i),x=a[0]+b[0],z=a[1]+b[1],l=Math.hypot(x,z);return[x/l,z/l];
};
/** Position, tangent (direction of increasing s) and outward normal s metres along a run. */
const runFrame=(r:Run,s:number)=>{
  const i=segmentAt(r,s),t=(s-r.cum[i])/(r.cum[i+1]-r.cum[i]),a=r.points[i],b=r.points[i+1];
  let [tx,tz]=direction(r,i);
  if(r.smooth){const ta=vertexTangent(r,i),tb=vertexTangent(r,i+1);tx=ta[0]+(tb[0]-ta[0])*t;tz=ta[1]+(tb[1]-ta[1])*t;const l=Math.hypot(tx,tz);tx/=l;tz/=l;}
  return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,tx,tz,nx:tz,nz:-tx};
};
const stationOf=(r:Run,x:number,z:number)=>{
  let best=0,distance=Infinity;
  for(let i=0;i<r.points.length-1;i++){
    const a=r.points[i],b=r.points[i+1],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l2));
    const d=Math.hypot(a[0]+dx*t-x,a[1]+dz*t-z);if(d<distance){distance=d;best=r.cum[i]+t*Math.sqrt(l2);}
  }
  return best;
};
/** World point of a façade station: `run` metres along WEST, PAVILION or EAST, `out` metres proud of the wall, `h` above the base. */
export function southStationPoint(run:keyof typeof RUNS,s:number,out=0,h=0){const f=runFrame(RUNS[run],s);return{x:f.x+f.nx*out,y:BASE+h,z:f.z+f.nz*out};}
export const southStationRuns=()=>Object.fromEntries(Object.entries(RUNS).map(([k,r])=>[k,{points:r.points.map(p=>[...p] as Point),length:r.length}]));

const backZ=(x:number)=>{
  for(let i=0;i<BACK.length-1;i++){const a=BACK[i],b=BACK[i+1];if(x<=b[0]||i===BACK.length-2){const t=(x-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*t;}}
  return BACK[BACK.length-1][1];
};
/** True north of the headhouse's back line (z decreases northward). */
export const inSouthStationHeadhouse=(x:number,z:number)=>z<backZ(x)+1;
type ShellSurface='granite'|'roof'|'other';

/** Material-only partition that keeps every surveyed vertex, normal and UV:
 * the headhouse walls are granite and its roofs membrane; the platform
 * canopies and bus terminal behind it are returned as `other` for the
 * ordinary landmark finish. */
export function splitSouthStationShell(geometry:THREE.BufferGeometry,isRoof:boolean){
  const source=geometry.index?geometry.toNonIndexed():geometry;
  const p=source.getAttribute('position'),groups=new Map<ShellSurface,number[]>();
  for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    const kind:ShellSurface=inSouthStationHeadhouse(x,z)?(isRoof?'roof':'granite'):'other';
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

/** Original metric texture of pinkish Stony Creek-style granite on the shell's
 * stabilized wall UVs (6 m per unit, v from the base): rusticated courses with
 * deep channels below the 13 m balcony, fine ashlar above. One canvas spans
 * 6 m by 48 m so the rustication stops at the right height. */
export function createSouthStationMaterials(){
  const W=512,H=4096,ppm=H/48,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const c=canvas.getContext('2d')!,random=seeded(1897);
  c.fillStyle='#8a7b71';c.fillRect(0,0,W,H);
  for(let h=-.6;h<48;){
    const plinth=h<.6,rustic=h<13,course=plinth?1.2:rustic?.62:.52,top=H-(h+course)*ppm,bottom=H-h*ppm;
    const joint=rustic?7:2,offset=random()*W;
    for(let x=offset;x<offset+W;){
      let length=(rustic?1.3+random()*1.1:.9+random()*1.3)*ppm;if(x+length>offset+W-.6*ppm)length=offset+W-x;
      const tone=(random()-.5)*20,warm=(random()-.5)*8;
      const fill=plinth?`rgb(${152+tone},${138+tone},${130+tone})`:`rgb(${204+tone+warm},${187+tone},${174+tone-warm})`;
      for(const shift of [-W,0]){
        const x0=x+shift+joint/2,w=length-joint;c.fillStyle=fill;c.fillRect(x0,top+joint/2,w,bottom-top-joint);
        if(rustic&&!plinth){c.fillStyle='rgba(255,240,225,.16)';c.fillRect(x0,top+joint/2,w,4);c.fillStyle='rgba(40,28,22,.22)';c.fillRect(x0,bottom-joint/2-5,w,5);}
      }
      x+=length;
    }
    h+=course;
  }
  const image=c.getImageData(0,0,W,H),d=image.data;
  for(let i=0;i<d.length;i+=4){const r=random(),n=r<.035?-34:r>.975?24:(random()-.5)*22;d[i]+=n;d[i+1]+=n;d[i+2]+=n;}
  c.putImageData(image,0,0);
  const map=canvasTexture(canvas,true);map.repeat.set(1,1/8);
  return {granite:new THREE.MeshStandardMaterial({map,roughness:.86,metalness:0}),roof:new THREE.MeshStandardMaterial({color:'#7d7a74',roughness:.93})};
}

function lettering(text:string,length:number,height:number,ink:string,ground:string,font:string,emissive=0){
  const h=128,w=Math.min(4096,Math.max(256,Math.round(h*length/height))),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const c=canvas.getContext('2d')!;c.fillStyle=ground;c.fillRect(0,0,w,h);c.font=font.replace('SIZE',String(Math.round(h*.62)));c.textAlign='center';c.textBaseline='middle';
  const chars=[...text],step=w/(chars.length+1);
  chars.forEach((ch,i)=>{const x=step*(i+1);if(!emissive){c.fillStyle='rgba(255,246,232,.35)';c.fillText(ch,x,h/2+3);}c.fillStyle=ink;c.fillText(ch,x,h/2);});
  const map=canvasTexture(canvas);
  return new THREE.MeshStandardMaterial({map,roughness:.82,...(emissive?{emissive:'#ffffff',emissiveMap:map,emissiveIntensity:emissive}:{})});
}

function clockDial(){
  const S=512,canvas=document.createElement('canvas');canvas.width=canvas.height=S;const c=canvas.getContext('2d')!,r=S/2;
  c.fillStyle='#3a3530';c.fillRect(0,0,S,S);c.fillStyle='#efe8d4';c.beginPath();c.arc(r,r,r-6,0,Math.PI*2);c.fill();
  c.strokeStyle='#22201d';c.lineWidth=5;c.beginPath();c.arc(r,r,r-34,0,Math.PI*2);c.stroke();c.beginPath();c.arc(r,r,r-58,0,Math.PI*2);c.stroke();
  for(let i=0;i<60;i++){const a=i/60*Math.PI*2,inner=r-(i%5?44:58);c.lineWidth=i%5?2:5;c.beginPath();c.moveTo(r+Math.sin(a)*inner,r-Math.cos(a)*inner);c.lineTo(r+Math.sin(a)*(r-34),r-Math.cos(a)*(r-34));c.stroke();}
  c.fillStyle='#1d1b18';c.font='bold 46px Georgia, serif';c.textAlign='center';c.textBaseline='middle';
  ['XII','I','II','III','IIII','V','VI','VII','VIII','IX','X','XI'].forEach((n,i)=>{const a=i/12*Math.PI*2;c.save();c.translate(r+Math.sin(a)*(r-96),r-Math.cos(a)*(r-96));c.rotate(a);c.fillText(n,0,0);c.restore();});
  const hand=(a:number,length:number,width:number)=>{c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(r-Math.sin(a)*24,r+Math.cos(a)*24);c.lineTo(r+Math.sin(a)*length,r-Math.cos(a)*length);c.stroke();};
  c.strokeStyle='#14120f';hand((10+8/60)/12*Math.PI*2,r*.5,14);hand(8/60*Math.PI*2,r*.76,9);c.fillStyle='#14120f';c.beginPath();c.arc(r,r,14,0,Math.PI*2);c.fill();
  const map=canvasTexture(canvas);return new THREE.MeshStandardMaterial({map,emissive:'#ffffff',emissiveMap:map,emissiveIntensity:.32,roughness:.5});
}

/** Shepley, Rutan & Coolidge's 1899 granite headhouse at Dewey Square,
 * interpreted on the surveyed shell: the pavilion's paired Ionic columns,
 * pediment, clock attic and stone eagle over the arched main entrance; the
 * curved colonnades of two and four columns either side between piers, with
 * their side arches, balcony balustrades and the BOSTON TERMINAL COMPANY
 * inscription; and the Atlantic Avenue and Summer Street wings. Reference:
 * Wikimedia Commons photographs of the exterior, not bundled. Ornament is
 * simplified; nothing here collides. */
export function addSouthStationFacade(scene:THREE.Scene,city:CityData){
  const station=landmarkBuildings(city).find(isSouthStation);if(!station)return;
  const group=new THREE.Group();group.name='South Station - granite headhouse facades';
  const stone=new THREE.MeshStandardMaterial({color:'#cbb8a8',roughness:.84});
  const shaft=new THREE.MeshStandardMaterial({color:'#d3c2b4',roughness:.78});
  const dark=new THREE.MeshStandardMaterial({color:'#9d8b7f',roughness:.9});
  const panel=new THREE.MeshStandardMaterial({color:'#b6a292',roughness:.88});
  const recess=new THREE.MeshStandardMaterial({color:'#3f3530',roughness:.95});
  const glass=new THREE.MeshStandardMaterial({color:'#1f2a2e',emissive:'#a8844e',emissiveIntensity:.12,metalness:.3,roughness:.25});
  const sash=new THREE.MeshStandardMaterial({color:'#3a3832',metalness:.35,roughness:.55});
  const bronze=new THREE.MeshStandardMaterial({color:'#7a6236',metalness:.7,roughness:.35});
  const iron=new THREE.MeshStandardMaterial({color:'#1d2123',metalness:.5,roughness:.5});
  const awning=new THREE.MeshStandardMaterial({color:'#a3232b',roughness:.8,side:THREE.DoubleSide});
  const lamp=new THREE.MeshStandardMaterial({color:'#f3e2b8',emissive:'#ffd98f',emissiveIntensity:.6,roughness:.4});
  const eagleStone=new THREE.MeshStandardMaterial({color:'#ae9b8e',roughness:.88});
  const serif='600 SIZEpx Georgia, "Times New Roman", serif';
  const sign=lettering('SOUTH STATION',6.2,.8,'#d9ba6a','#1c2924','bold SIZEpx Georgia, serif',.35),dial=clockDial();
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material)=>{const list=batches.get(m)??[];list.push(g);batches.set(m,list);};
  const {west:W,pavilion:P,east:E}=RUNS;
  // Geometry authored facing +z (out of the wall) with +x to the right of a
  // viewer on the street, placed s metres along a run, h above the base and
  // `out` metres proud of the wall. `span` takes the normal from the chord of
  // a wide element so a flat piece on the curve stands clear of the wall.
  const put=(r:Run,g:THREE.BufferGeometry,m:THREE.Material,s:number,h:number,out:number,span=0)=>{
    const f=runFrame(r,s);let nx=f.nx,nz=f.nz;
    if(span){const a=runFrame(r,Math.max(0,s-span/2)),b=runFrame(r,Math.min(r.length,s+span/2)),dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);nx=dz/l;nz=-dx/l;}
    g.rotateY(Math.atan2(nx,nz));g.translate(f.x+nx*out,BASE+h,f.z+nz*out);add(g,m);
  };
  const box=(r:Run,m:THREE.Material,s:number,h:number,out:number,w:number,height:number,d:number,span=0)=>put(r,new THREE.BoxGeometry(w,height,d),m,s,h,out,span);
  // A moulding swept along a run between two stations: a closed rectangular
  // section from o0 to o1 proud of the wall and h0 to h1 high, mitred at the
  // surveyed vertices so it stays parallel to the curved wall.
  const edge=(r:Run,s:number)=>{
    const f=runFrame(r,s),i=r.cum.findIndex((c,k)=>k>0&&k<r.cum.length-1&&Math.abs(c-s)<1e-3);
    if(i<0){const [tx,tz]=direction(r,segmentAt(r,s));return{x:f.x,z:f.z,mx:tz,mz:-tx,tx,tz};}
    const a=direction(r,i-1),b=direction(r,i),n1:Point=[a[1],-a[0]],n2:Point=[b[1],-b[0]],nx=n1[0]+n2[0],nz=n1[1]+n2[1],l=Math.hypot(nx,nz),k=1/Math.max(.5,(nx*n1[0]+nz*n1[1])/l);
    return{x:r.points[i][0],z:r.points[i][1],mx:nx/l*k,mz:nz/l*k,tx:(a[0]+b[0])/2,tz:(a[1]+b[1])/2};
  };
  const quad=(out:number[],a:number[],b:number[],c:number[],d:number[],want:number[])=>{
    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(n[0]*want[0]+n[1]*want[1]+n[2]*want[2]>=0)out.push(...a,...b,...c,...a,...c,...d);else out.push(...a,...c,...b,...a,...d,...c);
  };
  const raw=(positions:number[],uvs:number[]|undefined,m:THREE.Material)=>{
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs??new Array(positions.length/3*2).fill(0),2));g.computeVertexNormals();add(g,m);
  };
  const band=(r:Run,s0:number,s1:number,h0:number,h1:number,o0:number,o1:number,m:THREE.Material)=>{
    const stations=[s0,...r.cum.filter(c=>c>s0+1e-3&&c<s1-1e-3),s1].map(s=>edge(r,s)),pos:number[]=[];
    const at=(e:ReturnType<typeof edge>,o:number,h:number)=>[e.x+e.mx*o,BASE+h,e.z+e.mz*o];
    for(let k=0;k<stations.length-1;k++){
      const a=stations[k],b=stations[k+1],n=[a.mx+b.mx,0,a.mz+b.mz];
      quad(pos,at(a,o1,h0),at(b,o1,h0),at(b,o1,h1),at(a,o1,h1),n);quad(pos,at(a,o0,h0),at(b,o0,h0),at(b,o0,h1),at(a,o0,h1),[-n[0],0,-n[2]]);
      quad(pos,at(a,o0,h1),at(b,o0,h1),at(b,o1,h1),at(a,o1,h1),[0,1,0]);quad(pos,at(a,o0,h0),at(b,o0,h0),at(b,o1,h0),at(a,o1,h0),[0,-1,0]);
    }
    for(const [e,sign] of [[stations[0],-1],[stations[stations.length-1],1]] as const)quad(pos,at(e,o0,h0),at(e,o1,h0),at(e,o1,h1),at(e,o0,h1),[e.tx*sign,0,e.tz*sign]);
    raw(pos,undefined,m);
  };
  // A lettered strip on a curved frieze: u runs right to left in s so the
  // inscription reads left to right from the street.
  const inscription=(r:Run,s0:number,s1:number,h0:number,h1:number,out:number,text:string)=>{
    const m=lettering(text,s1-s0,h1-h0,'#4a3a30','#cbb8a8',serif),pos:number[]=[],uv:number[]=[],n=Math.max(2,Math.ceil((s1-s0)/.5));
    for(let k=0;k<n;k++){
      const sa=s0+(s1-s0)*k/n,sb=s0+(s1-s0)*(k+1)/n,a=runFrame(r,sa),b=runFrame(r,sb),ua=(s1-sa)/(s1-s0),ub=(s1-sb)/(s1-s0);
      const A=(f:typeof a,h:number)=>[f.x+f.nx*out,BASE+h,f.z+f.nz*out];
      pos.push(...A(a,h0),...A(b,h0),...A(b,h1),...A(a,h0),...A(b,h1),...A(a,h1));uv.push(ua,0,ub,0,ub,1,ua,0,ub,1,ua,1);
    }
    raw(pos,uv,m);
  };
  const archShape=(w:number,h:number)=>{const shape=new THREE.Shape(),r=w/2;shape.moveTo(-r,0);shape.lineTo(r,0);shape.lineTo(r,h-r);shape.absarc(0,h-r,r,0,Math.PI,false);shape.lineTo(-r,0);return shape;};
  let windows=0;
  const win=(r:Run,s:number,h0:number,h1:number,w:number)=>{
    const h=h1-h0;windows++;
    box(r,stone,s,h0+h/2,.02,w+.34,h+.3,.12,w);box(r,glass,s,h0+h/2,.1,w,h,.05,w);
    if(w>1.15)box(r,sash,s,h0+h/2,.14,.07,h,.05,w);box(r,sash,s,h0+h*.64,.14,w,.07,.05,w);
    box(r,stone,s,h0-.12,.12,w+.5,.18,.3,w);box(r,stone,s,h1+.26,.08,w+.5,.22,.2,w);
  };
  const shop=(r:Run,s:number,w:number,awned:boolean)=>{
    windows++;box(r,stone,s,2.2,.03,w+.5,3.3,.14,w);box(r,glass,s,2.15,.1,w,2.9,.06,w);box(r,bronze,s,2.15,.14,.08,2.9,.05,w);box(r,bronze,s,3.15,.14,w,.08,.05,w);
    if(awned){const g=new THREE.BoxGeometry(w+.4,.06,1.3);g.rotateX(.38);put(r,g,awning,s,4.05,.68,w);box(r,awning,s,3.72,1.28,w+.4,.32,.03,w);}
  };
  const archedShop=(r:Run,s:number,w:number,crown:number)=>{
    windows++;const ring=archShape(w+.7,crown+.35);ring.holes.push(archShape(w,crown));
    put(r,new THREE.ExtrudeGeometry(ring,{depth:.3,bevelEnabled:false,curveSegments:10}),stone,s,0,-.02,w);
    put(r,new THREE.ShapeGeometry(archShape(w,crown),10),glass,s,0,.06,w);box(r,bronze,s,3.4,.12,w,.1,.06,w);box(r,bronze,s,crown/2,.12,.08,crown-.3,.05,w);
  };
  // Granite arch with doors, transom and an iron fanlight; the voussoir ring
  // stands proud so the opening reads deep.
  const entrance=(r:Run,s:number,w:number,crown:number,jamb:number,signed:boolean)=>{
    const ring=archShape(w+2*jamb,crown+jamb);ring.holes.push(archShape(w,crown));
    put(r,new THREE.ExtrudeGeometry(ring,{depth:.6,bevelEnabled:false,curveSegments:18}),stone,s,0,-.05,w+2*jamb);
    put(r,new THREE.ShapeGeometry(archShape(w,crown),18),glass,s,0,.04,w);
    box(r,bronze,s,1.8,.1,w-.2,3.6,.1,w);for(let k=1;k<6;k++)box(r,iron,s+(k/6-.5)*(w-.2),1.8,.17,.06,3.6,.04,w);
    box(r,bronze,s,3.75,.14,w,.3,.14,w);box(r,bronze,s,(3.9+(signed?5.75:crown-w/2))/2,.1,.07,(signed?5.75:crown-w/2)-3.9,.06,w);
    const spring=crown-w/2;
    if(signed){box(r,iron,s,6.3,.12,w,.95,.16,w);put(r,new THREE.PlaneGeometry(w-.4,.78),sign,s,6.3,.21,w);}
    box(r,iron,s,spring,.12,w,.14,.12,w);
    for(let k=1;k<8;k++){const a=k/8*Math.PI,g=new THREE.BoxGeometry(.06,w/2-.1,.05);g.translate(0,(w/2-.1)/2,0);g.rotateZ(a-Math.PI/2);put(r,g,iron,s,spring,.1,w);}
    put(r,new THREE.TorusGeometry(w*.27,.05,4,20,Math.PI),iron,s,spring,.1,w);
    box(r,stone,s,crown+.55,.45,.95,1.6,.9,w);box(r,stone,s,12.7,.8,.8,.6,1.6,w);
  };
  const column=(r:Run,s:number,out:number)=>{
    box(r,stone,s,14.08,out,1.75,.56,1.75);put(r,new THREE.CylinderGeometry(.86,.9,.22,20),stone,s,14.47,out);
    put(r,new THREE.TorusGeometry(.8,.09,6,20).rotateX(Math.PI/2),stone,s,14.63,out);
    put(r,new THREE.CylinderGeometry(.66,.78,13.5,24),shaft,s,21.45,out);put(r,new THREE.TorusGeometry(.68,.06,4,20).rotateX(Math.PI/2),shaft,s,28.15,out);
    put(r,new THREE.CylinderGeometry(.84,.7,.32,20),stone,s,28.42,out);box(r,stone,s,28.62,out,1.5,.34,1.3);
    for(const side of [-1,1])put(r,new THREE.TorusGeometry(.21,.1,6,12).translate(side*.74,0,.58),stone,s,28.55,out);
    box(r,stone,s,29.07,out,1.95,.26,1.95);
  };
  const balusters=(r:Run,s0:number,s1:number,skip:number[])=>{
    band(r,s0,s1,13.8,13.96,1.5,2.05,stone);band(r,s0,s1,14.9,15.1,1.45,2.1,stone);
    for(let s=s0+.2;s<s1-.1;s+=.34){if(skip.some(c=>Math.abs(c-s)<1))continue;put(r,new THREE.CylinderGeometry(.08,.11,.94,6),stone,s,14.43,1.78);}
  };
  // The colonnade entablature, deep enough to rest on the columns, with
  // modillions under the corona; the wings carry a shallow version.
  const entablature=(r:Run,s0:number,s1:number,deep:boolean)=>{
    if(deep){
      band(r,s0,s1,29.2,30.25,-.05,1.95,stone);band(r,s0,s1,30.25,30.35,-.05,2.02,stone);band(r,s0,s1,30.35,31.8,-.05,1.92,stone);
      band(r,s0,s1,31.8,32.15,-.05,2.25,stone);band(r,s0,s1,32.15,32.75,-.05,2.62,stone);band(r,s0,s1,32.75,33,-.05,2.5,stone);
      for(let s=s0+.3;s<s1;s+=.6)box(r,stone,s,32.02,2.35,.22,.26,.42);
    }else{
      band(r,s0,s1,29.2,30.2,-.05,.22,stone);band(r,s0,s1,31.8,32.2,-.05,.55,stone);band(r,s0,s1,32.2,32.8,-.05,.95,stone);band(r,s0,s1,32.8,33,-.05,.85,stone);
      for(let s=s0+.2;s<s1;s+=.45)box(r,stone,s,32.1,.62,.16,.2,.2);
    }
  };
  const attic=(r:Run,s0:number,s1:number)=>{band(r,s0,s1,33,36.25,-.5,.15,stone);band(r,s0,s1,36.25,36.6,-.55,.35,stone);};
  const atticPanel=(r:Run,s:number,w:number)=>{
    box(r,recess,s,34.75,.17,w,1.25,.06,w);box(r,stone,s,35.42,.24,w+.1,.14,.18,w);
    for(let x=-w/2+.2;x<w/2-.1;x+=.28)box(r,stone,s+x,34.72,.24,.13,1.08,.13);
  };
  const pier=(r:Run,s0:number,s1:number,cap:boolean)=>{
    const s=(s0+s1)/2,w=s1-s0+.1;box(r,stone,s,21.5,.95,w,15.4,2.1,w);
    if(cap){box(r,stone,s,37.4,.2,w+.3,1.6,1.4,w);box(r,stone,s,38.33,.2,w+.6,.26,1.7,w);}
  };
  const lantern=(r:Run,s:number,h:number)=>{box(r,iron,s,h+.6,.5,.1,.1,.95);box(r,lamp,s,h,.98,.42,.62,.42);put(r,new THREE.ConeGeometry(.36,.36,4).rotateY(Math.PI/4),iron,s,h+.49,.98);};

  // Section stations: the piers sit on the surveyed pier returns.
  const pw0=stationOf(W,1595.63,-234.93),pw1=stationOf(W,1597.31,-236.99),pe0=stationOf(E,1627.31,-247.7),pe1=stationOf(E,1631.65,-246.73);
  const outerW:[number,number]=[pw0-15.7,pw0],endW:[number,number]=[pw0-19.1,pw0-15.7],outerE:[number,number]=[pe1,pe1+13.9],endE:[number,number]=[pe1+13.9,pe1+17.3];
  const SIDE=P.cum[1],FRONT=P.cum[2]-P.cum[1],pb=(b:number)=>SIDE+b,MID=FRONT/2;
  const inner={west:[W.length-3,W.length-6.4],east:[3,6.4]};
  const outerColumns=(range:[number,number])=>[0,1,2,3].map(i=>range[0]+(range[1]-range[0])*(i+.5)/4);
  const columns={west:[...outerColumns(outerW),...inner.west],east:[...inner.east,...outerColumns(outerE)],pavilion:[1.15,3.35,FRONT-3.35,FRONT-1.15].map(pb)};
  // Plinth, balcony, entablature and attic along the whole front.
  for(const r of [W,P,E])band(r,0,r.length,-1.6,.55,-.05,.22,dark);
  band(W,0,endW[0],13,13.7,-.05,.55,stone);band(W,endW[0],W.length,13,13.8,-.05,2.15,stone);band(P,0,P.length,13,13.8,-.05,2.15,stone);
  band(E,0,endE[1],13,13.8,-.05,2.15,stone);band(E,endE[1],E.length,13,13.7,-.05,.55,stone);
  entablature(W,0,endW[0],false);entablature(W,endW[0],W.length,true);entablature(P,0,P.length,true);entablature(E,0,endE[1],true);entablature(E,endE[1],E.length,false);
  attic(W,0,W.length);attic(E,0,E.length);attic(P,0,SIDE);attic(P,SIDE+FRONT,P.length);
  balusters(W,outerW[0],outerW[1],columns.west);balusters(W,pw1,W.length,columns.west);balusters(E,0,pe0,columns.east);balusters(E,outerE[0],outerE[1],columns.east);
  balusters(P,pb(0),pb(FRONT),columns.pavilion);
  for(const s of columns.west)column(W,s,1.1);for(const s of columns.east)column(E,s,1.1);for(const s of columns.pavilion)column(P,s,1.1);
  pier(W,pw0,pw1,true);pier(E,pe0,pe1,true);pier(W,endW[0],endW[1],true);pier(E,endE[0],endE[1],true);
  // Windows behind the colonnades: three storeys in every intercolumniation.
  const ROWS:[number,number][]=[[15.5,18.3],[19.5,23.2],[24.3,27.9]];
  const bays=(r:Run,centres:number[],w:number)=>{for(const s of centres)for(const [h0,h1] of ROWS)win(r,s,h0,h1,w);};
  const gaps=(cols:number[])=>cols.slice(1).map((c,i)=>(c+cols[i])/2);
  bays(W,[...gaps(outerColumns(outerW)),W.length-4.7,W.length-1.4],1.6);bays(E,[1.4,4.7,...gaps(outerColumns(outerE))],1.6);
  bays(P,[pb(MID-2.4),pb(MID+2.4)],1.5);bays(P,[pb(MID)],2.3);
  // Ground floor: the three entrance arches, lanterns, and shop windows under
  // the outer colonnades.
  entrance(P,pb(MID),6.6,11.2,.8,true);entrance(W,W.length-4.7,5.2,10.6,.65,false);entrance(E,4.7,5.2,10.6,.65,false);
  for(const b of [2.25,FRONT-2.25])lantern(P,pb(b),6.6);
  for(const s of gaps(outerColumns(outerW))){shop(W,s,2,true);win(W,s,6.3,9.4,1.5);}
  for(const s of gaps(outerColumns(outerE))){shop(E,s,2,true);win(E,s,6.3,9.4,1.5);}
  for(const range of [outerW,outerE]){const r=range===outerW?W:E,n=3,step=(range[1]-range[0])/n;for(let i=0;i<n;i++)atticPanel(r,range[0]+step*(i+.5),2.2);}
  // Wings: rusticated ground floor (arched windows on Atlantic Avenue,
  // awnings on Summer Street), three storeys of windows in recessed panels,
  // attic lights in the frieze and balustrade panels in the parapet.
  const wing=(r:Run,s0:number,s1:number,arched:boolean)=>{
    const n=Math.round((s1-s0)/3.6),step=(s1-s0)/n;
    for(let i=0;i<n;i++){
      const s=s0+step*(i+.5);box(r,panel,s,21.75,.01,2.3,13.3,.06,2.3);bays(r,[s],1.5);win(r,s,30.45,31.55,1.1);atticPanel(r,s,2.2);
      if(arched)archedShop(r,s,2.3,6.4);else{shop(r,s,2.1,i%4!==3);win(r,s,6.3,9.4,1.5);}
    }
  };
  wing(W,.4,endW[0]-.2,true);wing(E,endE[1]+.2,E.length-.4,false);
  // The frieze inscription: BOSTON TERMINAL COMPANY between ERECTED and the
  // date, read from Dewey Square.
  inscription(E,outerE[0]+1.2,outerE[1]-1.2,30.55,31.6,1.935,'ERECTED');inscription(E,.8,pe0-.4,30.55,31.6,1.935,'BOSTON');
  inscription(W,pw1+.4,W.length-.8,30.55,31.6,1.935,'COMPANY');inscription(W,outerW[0]+1.2,outerW[1]-1.2,30.55,31.6,1.935,'MDCCCXCVII');
  put(P,new THREE.PlaneGeometry(9.4,1.05),lettering('TERMINAL',9.4,1.05,'#4a3a30','#cbb8a8',serif),pb(MID),31.075,1.935);
  // Pediment, clock attic with its dial between carved pilasters, scrolled
  // shoulders and crest, and the stone eagle on its pedestal.
  {
    const rise=3.9,half=MID+.5,tri=new THREE.Shape();tri.moveTo(-half,0);tri.lineTo(half,0);tri.lineTo(0,rise);tri.lineTo(-half,0);
    put(P,new THREE.ExtrudeGeometry(tri,{depth:.8,bevelEnabled:false}).translate(0,0,-.4),stone,pb(MID),33,0);
    const slope=Math.atan2(rise,half),length=Math.hypot(rise,half)+.5;
    for(const side of [-1,1]){const g=new THREE.BoxGeometry(length,.6,1.5);g.rotateZ(-side*slope);g.translate(side*half/2,rise/2+.32,0);put(P,g,stone,pb(MID),33,.7);}
    box(P,stone,pb(MID),33+rise+.75,.6,1,.8,1);
  }
  const C=7.6,ATTIC:[number,number]=[33,42.9];
  box(P,stone,pb(C),(ATTIC[0]+ATTIC[1])/2,-3.4,13.6,ATTIC[1]-ATTIC[0],5.8);
  for(const x of [-5.9,-3.1,3.1,5.9]){box(P,stone,pb(C+x),38.15,-.33,.9,9,.34);box(P,panel,pb(C+x),38.15,-.13,.5,7.6,.08);}
  put(P,new THREE.TorusGeometry(2.02,.2,8,40),stone,pb(C),40.3,-.38);put(P,new THREE.CircleGeometry(1.85,48),dial,pb(C),40.3,-.42);
  box(P,stone,pb(C),43.25,-3.4,14.6,.7,6.6);for(let x=-7;x<=7.01;x+=.7)box(P,stone,pb(C+x),42.82,-.05,.2,.18,.25);
  {
    const crest=new THREE.Shape();crest.moveTo(-4.4,0);for(let k=0;k<=24;k++){const x=-4.4+8.8*k/24;crest.lineTo(x,2.4*Math.sqrt(Math.max(0,1-(x/4.4)**2)));}crest.lineTo(-4.4,0);
    put(P,new THREE.ExtrudeGeometry(crest,{depth:4.6,bevelEnabled:false}).translate(0,0,-4.6),stone,pb(C),43.6,-.6);
    put(P,new THREE.SphereGeometry(1,16,10).scale(.75,.95,.2),stone,pb(C),44.55,-.55);
    for(const side of [-1,1])put(P,new THREE.TorusGeometry(.42,.17,6,16),stone,pb(C+side*4.1),44.05,-.5);
    for(const side of [-1,1]){
      const shoulder=new THREE.Shape(),inner=6.8,outer=8.6,top=ATTIC[1]-1.1;shoulder.moveTo(side*inner,0);
      for(let k=0;k<=16;k++){const t=k/16,x=inner+(outer-inner)*t;shoulder.lineTo(side*x,(top-ATTIC[0])*Math.sqrt(Math.max(0,1-t*t)));}
      shoulder.lineTo(side*inner,0);
      put(P,new THREE.ExtrudeGeometry(shoulder,{depth:5,bevelEnabled:false}).translate(0,0,-5),stone,pb(C),ATTIC[0],-1.3);
      put(P,new THREE.TorusGeometry(.55,.22,6,16),stone,pb(C-side*(outer-.4)),ATTIC[0]+.75,-1.15);
    }
    box(P,stone,pb(C-.05),46.55,-4,2.9,1.5,2.9);box(P,stone,pb(C-.05),47.38,-4,3.2,.2,3.2);
    // The eagle: body, head and beak facing the square, wings raised.
    const E0=47.48,ex=pb(C-.05),eo=-3.45;
    put(P,new THREE.SphereGeometry(1,14,10).scale(.58,.92,.66),eagleStone,ex,E0+1.0,eo);put(P,new THREE.SphereGeometry(.3,12,8),eagleStone,ex,E0+2.02,eo+.28);
    put(P,new THREE.ConeGeometry(.11,.34,8).rotateX(Math.PI/2),dark,ex,E0+1.95,eo+.7);put(P,new THREE.BoxGeometry(.55,.22,.75).rotateX(-.5),eagleStone,ex,E0+.25,eo-.5);
    for(const side of [-1,1]){
      const wingShape=new THREE.Shape(),pts:Point[]=[[.35,.9],[.8,1.6],[1.35,2.35],[1.85,2.75],[2.05,2.6],[1.9,2],[1.7,1.4],[1.45,.8],[1.3,.1],[.9,0],[.45,.3]];
      wingShape.moveTo(side*pts[0][0],pts[0][1]);for(const [x,y] of pts.slice(1))wingShape.lineTo(side*x,y);wingShape.lineTo(side*pts[0][0],pts[0][1]);
      put(P,new THREE.ExtrudeGeometry(wingShape,{depth:1.3,bevelEnabled:false}).translate(0,0,-.65),eagleStone,ex,E0,eo);
    }
  }
  let triangles=0;
  for(const [material,geometries]of batches){
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(normalized,false);if(!geometry)continue;
    geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);triangles+=geometry.getAttribute('position').count/3;
    new Set([...geometries,...normalized]).forEach(g=>g.dispose());
  }
  group.userData={buildingId:station.id,columns:columns.west.length+columns.east.length+columns.pavilion.length,entranceArches:3,windows,piers:4,inscription:'ERECTED BOSTON TERMINAL COMPANY MDCCCXCVII',clock:true,eagle:true,triangles,reference:'https://commons.wikimedia.org/wiki/Category:South_Station_(Boston)'};
  scene.add(group);return group;
}
