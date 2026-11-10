import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Building,CityData} from '../types';
import {canvasTexture,seeded} from './materials.ts';
import {landmarkBuildings} from '../simulation/city-tiles.ts';
import {sampleElevation} from '../simulation/terrain.ts';
import {parkSurface} from './area-surfaces.ts';

/** One surveyed mesh holds the arena, the Hub on Causeway podium, its hotel block and both towers. */
export const TD_GARDEN_ID='BOS-BR66Z-G38QJ-39S5N';
export const isTdGarden=(building?:Building)=>building?.id===TD_GARDEN_ID;
type Point=[number,number];

// Building frame measured on the surveyed shell. The origin is the arena's
// north-west corner; u runs east-north-east along the track wall and v
// north-north-west toward the tracks, so Causeway Street lies beyond v -150.
// Heights are world metres: the shell stands on BASE.
const O:Point=[946.187,-1797.851],U:Point=[.80584922,-.5921208],V:Point=[-.5921208,-.80584922],BASE=.45;
export const tdGardenFrame=(x:number,z:number):Point=>[(x-O[0])*U[0]+(z-O[1])*U[1],(x-O[0])*V[0]+(z-O[1])*V[1]];
export const tdGardenWorld=(u:number,v:number):Point=>[O[0]+u*U[0]+v*V[0],O[1]+u*U[1]+v*V[1]];

/** A wall plane between two frame points given left to right for a viewer the
 * wall faces: `r` runs to that viewer's right, `n` out of the wall. */
interface Face{x:number;z:number;rx:number;rz:number;nx:number;nz:number;length:number;yaw:number}
const face=(a:Point,b:Point):Face=>{
  const [ax,az]=tdGardenWorld(...a),[bx,bz]=tdGardenWorld(...b),length=Math.hypot(bx-ax,bz-az),rx=(bx-ax)/length,rz=(bz-az)/length;
  return{x:ax,z:az,rx,rz,nx:-rz,nz:rx,length,yaw:Math.atan2(-rz,rx)};
};
// Outer wall faces sliced from the bundled mesh.
const FACES={
  north:face([130.84,0],[13.08,-2.26]),              // the arena's track wall, seen from the Zakim Bridge
  corner:face([142.69,-1.6],[130.93,-1.05]),          // the lower north-east block beside it
  towerA:face([1.75,-152.03],[22.75,-152.27]),        // Causeway Street fronts, west to east: residential tower,
  hotel:face([22.96,-149.77],[71.19,-150.28]),        // hotel podium,
  mouth:face([71.2,-148.3],[91.4,-148.7]),            // the recessed entrance,
  officeWest:face([91.32,-153.13],[98.28,-153.37]),   // 100 Causeway's two fronts
  office:face([98.27,-153.87],[143.14,-154.75]),
  wing:face([143.09,-150.78],[153.84,-150.87]),       // and the east wing
  wingEast:face([153.84,-150.87],[150.31,-92.69]),
  towerAWestNorth:face([3.5,-97.1],[2.1,-115.2]),
  towerAWestSouth:face([2.15,-115.2],[1.8,-152]),
};
export type TdGardenFace=keyof typeof FACES;
export const tdGardenFaces=()=>Object.fromEntries(Object.entries(FACES).map(([name,f])=>[name,{from:[f.x,f.z] as Point,to:[f.x+f.rx*f.length,f.z+f.rz*f.length] as Point,normal:[f.nx,f.nz] as Point,length:f.length}]));
/** World point `s` metres along a face, `out` metres proud of it, at height y. */
export function tdGardenPoint(name:TdGardenFace,s:number,y=BASE,out=0){const f=FACES[name];return{x:f.x+f.rx*s+f.nx*out,y,z:f.z+f.rz*s+f.nz*out};}

/** North Station's yard on the lawn behind the arena, in frame metres: an interpretation fitted between the
 * Nashua Street lot and the Leverett Connector's east piers, three of which stand on platforms, whose canopies
 * stop short of them, and one between the wide pair of tracks. `tracks` are the centrelines' u (stub ends at the
 * arena, v 8.2, running out to `end`); `platforms` give west edge, east edge, north end and the canopy's runs
 * on the `bay` grid from v 6; `trains` give the track and the coaches behind the locomotive, which stands at
 * the outbound end (coaches 26 m apart from v 10, the locomotive 20 m). */
export const TD_GARDEN_YARD={
  west:34.2,east:90.6,end:192,bay:12,tracks:[43.5,47.9,57.3,61.7,72.8,81.6],
  platforms:[[35.3,41.8,126,[[6,30],[42,90]]],[49.6,55.6,150,[[6,54],[66,102]]],[63.4,71.1,150,[[6,54],[66,102]]],[83.3,90.2,114,[[6,90]]]] as [number,number,number,Point[]][],
  trains:[[43.5,3],[57.3,5],[81.6,4]] as Point[],
};

export type TdGardenSurface='concrete'|'membrane'|'glass'|'panel'|'hotel'|'podium'|'skylight'|'open'|'other';
/** The towers rise from the street in single wall triangles; they are cut here so their base carries the podium's shopfronts. */
export const TD_GARDEN_PODIUM_TOP=28.3;
// The east gable is glazed above the roof of the lower block in front of it.
const GABLE_SILL=35.2;

function surfaceOf(u:number,v:number,low:number,high:number,nu:number,nv:number,isRoof:boolean):{kind:TdGardenSurface;cut?:number;below?:TdGardenSurface}{
  if(isRoof){
    if(v>-96&&low>44)return{kind:'membrane'};
    if(u>71&&u<92&&v>-149&&v<-102&&Math.abs(high-30.5)<.3&&high-low<.3)return{kind:'skylight'};
    return{kind:'other'};
  }
  // The street wall of the passage between the hotel and 100 Causeway: left out, so the entrance hall behind it shows.
  if(high<31&&low<1&&nv<-.9&&Math.abs(v+148.5)<.8&&u>71&&u<91.6)return{kind:'open'};
  if(v>-96.6||v>-102.6&&high<75)return nu>.9&&nv>.1&&nv<.3&&u>128?{kind:'glass',cut:GABLE_SILL,below:'concrete'}:{kind:'concrete'};
  if(high>75)return{kind:u<50?'panel':'glass',cut:TD_GARDEN_PODIUM_TOP,below:'podium'};
  return{kind:low>34&&u>23&&u<72&&v<-103?'hotel':'podium'};
}

/** Material partition of the surveyed shell: precast and membrane for the
 * arena, curtain wall for 100 Causeway and the arena's east gable, woven
 * panels for the residential tower, dark panels for the hotel and shopfront
 * glazing for the podium. Triangles are kept as surveyed except where a tower
 * wall or the gable crosses a finish line: those are cut along it, every new
 * vertex lying on its source triangle. Arena and hall roofs are re-mapped
 * along the building so their seams follow it. `open` is the passage's street
 * wall, which the renderer drops; `other` keeps the ordinary landmark finish. */
export function splitTdGardenShell(geometry:THREE.BufferGeometry,isRoof:boolean){
  const source=geometry.index?geometry.toNonIndexed():geometry,p=source.getAttribute('position');
  // A corner of an output triangle: source vertex a, source vertex b and the weight of b.
  type Corner=[number,number,number];
  const groups=new Map<TdGardenSurface,Corner[]>();
  const emit=(kind:TdGardenSurface,...corners:Corner[])=>{const list=groups.get(kind)??[];list.push(...corners);groups.set(kind,list);};
  for(let i=0;i<p.count;i+=3){
    const x=[0,1,2].map(k=>p.getX(i+k)),y=[0,1,2].map(k=>p.getY(i+k)),z=[0,1,2].map(k=>p.getZ(i+k)),[u,v]=tdGardenFrame((x[0]+x[1]+x[2])/3,(z[0]+z[1]+z[2])/3);
    const nx=(y[1]-y[0])*(z[2]-z[0])-(z[1]-z[0])*(y[2]-y[0]),nz=(x[1]-x[0])*(y[2]-y[0])-(y[1]-y[0])*(x[2]-x[0]),flat=Math.hypot(nx,nz)||1;
    const low=Math.min(...y),high=Math.max(...y),s=surfaceOf(u,v,low,high,(nx*U[0]+nz*U[1])/flat,(nx*V[0]+nz*V[1])/flat,isRoof),whole=(k:number):Corner=>[i+k,i+k,0];
    if(s.cut===undefined||low>=s.cut-.05){emit(s.kind,whole(0),whole(1),whole(2));continue;}
    if(high<=s.cut+.05){emit(s.below!,whole(0),whole(1),whole(2));continue;}
    const above=y.map(h=>h>=s.cut!),a=above.indexOf(above.filter(Boolean).length===1),b=(a+1)%3,c=(a+2)%3;
    const ab:Corner=[i+a,i+b,(s.cut-y[a])/(y[b]-y[a])],ac:Corner=[i+a,i+c,(s.cut-y[a])/(y[c]-y[a])];
    emit(above[a]?s.kind:s.below!,whole(a),ab,ac);emit(above[a]?s.below!:s.kind,ab,whole(b),whole(c),ab,whole(c),ac);
  }
  const parts=[...groups].map(([kind,corners])=>{
    const part=new THREE.BufferGeometry();
    for(const [name,attribute]of Object.entries(source.attributes)){
      const size=attribute.itemSize,values=new Float32Array(corners.length*size);
      corners.forEach(([a,b,t],j)=>{for(let k=0;k<size;k++){const from=attribute.getComponent(a,k);values[j*size+k]=t?from+(attribute.getComponent(b,k)-from)*t:from;}});
      part.setAttribute(name,new THREE.BufferAttribute(values,size));
    }
    if(kind==='membrane'||kind==='skylight'){
      const q=part.getAttribute('position'),uv=part.getAttribute('uv');
      for(let j=0;j<q.count;j++){const f=tdGardenFrame(q.getX(j),q.getZ(j));uv.setXY(j,f[0]/6,f[1]/6);}
    }
    return{kind,geometry:part};
  });
  if(source!==geometry)source.dispose();
  return parts;
}

// Night lighting is one switch for the shell finishes and the trim alike.
const glowing:THREE.MeshStandardMaterial[]=[];let night=false;
const glow=(m:THREE.MeshStandardMaterial,day:number,dark:number)=>{m.userData.glow=[day,dark];m.emissiveIntensity=night?dark:day;glowing.push(m);return m;};
const sheet=(w:number,h:number)=>{const canvas=document.createElement('canvas');canvas.width=Math.round(w);canvas.height=Math.round(h);return{canvas,c:canvas.getContext('2d')!};};
/** A canvas drawn in metres, heights rising from its bottom edge. */
const metric=(w:number,h:number,wide:number,high:number)=>{const s=sheet(w,h);s.c.translate(0,s.canvas.height);s.c.scale(s.canvas.width/wide,-s.canvas.height/high);return s;};
const grain=(c:CanvasRenderingContext2D,canvas:HTMLCanvasElement,random:()=>number,amount:number)=>{
  const image=c.getImageData(0,0,canvas.width,canvas.height),d=image.data;
  for(let i=0;i<d.length;i+=4){const n=(random()-.5)*amount;d[i]+=n;d[i+1]+=n;d[i+2]+=n;}
  c.putImageData(image,0,0);
};
const lights=(wide:number,high:number,w:number,h:number)=>{const g=metric(w,h,wide,high);g.c.fillStyle='#000';g.c.fillRect(0,0,wide,high);return g;};

// Original metric textures on the shell's stabilized wall UVs (6 m per unit,
// v from the base). `q` halves the canvases on phones.
const PAINT:Record<Exclude<TdGardenSurface,'open'|'other'>,(q:number)=>THREE.MeshStandardMaterial>={
  // Precast arena walls, 6 m by 54 m: a dark base, panel courses with a row of
  // small windows under the dark metal band that runs up to the eave and gables.
  concrete(q){
    const {canvas,c}=metric(512*q,4096*q,6,54),g=lights(6,54,64*q,512*q),random=seeded(1995);
    c.fillStyle='#8c8577';c.fillRect(0,0,6,54);
    for(let row=0;row<8;row++)for(let col=0;col<2;col++){const t=(random()-.5)*14;c.fillStyle=`rgb(${186+t},${178+t},${163+t})`;c.fillRect(col*3+.03,7.4+row*3.725+.03,2.94,3.665);}
    for(const x of [1.5,4.5]){c.fillStyle='#7d776b';c.fillRect(x-.8,29.95,1.6,1.8);c.fillStyle='#1c262e';c.fillRect(x-.62,30.12,1.24,1.46);c.fillStyle='rgba(160,190,205,.22)';c.fillRect(x-.62,30.9,1.24,.68);g.c.fillStyle=`rgba(255,214,150,${x<3?.9:.5})`;g.c.fillRect(x-.62,30.12,1.24,1.46);}
    c.fillStyle='#4a4743';c.fillRect(0,0,6,6.8);for(let x=0;x<6;x+=1.5){c.fillStyle='rgba(0,0,0,.28)';c.fillRect(x,0,.05,6.8);}
    c.fillStyle='#9a9385';c.fillRect(0,6.8,6,.6);
    c.fillStyle='#3b3a3b';c.fillRect(0,37.2,6,16.8);for(let x=0;x<6;x+=1.5){c.fillStyle='rgba(255,255,255,.06)';c.fillRect(x,37.2,.05,16.8);}
    c.fillStyle='#5a5853';c.fillRect(0,37.2,6,.3);c.fillRect(0,44.2,6,.42);
    grain(c,canvas,random,16);
    const map=canvasTexture(canvas,true),emissiveMap=canvasTexture(g.canvas,true);map.repeat.set(1,1/9);emissiveMap.repeat.set(1,1/9);
    return glow(new THREE.MeshStandardMaterial({map,emissiveMap,emissive:'#ffffff',roughness:.9,metalness:0}),0,.8);
  },
  membrane(q){
    const {canvas,c}=metric(256*q,256*q,6,6),random=seeded(31);
    c.fillStyle='#c6c9c6';c.fillRect(0,0,6,6);c.fillStyle='#afb3b1';for(let x=0;x<6;x+=1.5)c.fillRect(x,0,.07,6);grain(c,canvas,random,10);
    return new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),roughness:.88});
  },
  // Curtain wall, 24 m square: sixteen 1.5 m bays by six 4 m floors of vision glass over spandrels.
  glass(q){
    const {canvas,c}=metric(1024*q,1024*q,24,24),g=lights(24,24,512*q,512*q),random=seeded(100);
    for(let f=0;f<6;f++){
      let run=0;
      for(let b=0;b<16;b++){
        const x=b*1.5,y=f*4,t=random()*10,pane=c.createLinearGradient(0,y+.9,0,y+4);
        pane.addColorStop(0,`rgb(${58+t},${92+t},${112+t})`);pane.addColorStop(1,`rgb(${112+t},${156+t},${178+t})`);
        c.fillStyle=`rgb(${48+t},${72+t},${88+t})`;c.fillRect(x,y,1.5,.9);c.fillStyle=pane;c.fillRect(x,y+.9,1.5,3.1);
        // Offices stay lit in runs of a few bays.
        if(run>0||random()<.09){if(run<=0)run=1+Math.floor(random()*4);run--;g.c.fillStyle=`rgba(255,${228+random()*20},${186+random()*50},${.45+random()*.45})`;g.c.fillRect(x+.05,y+.95,1.4,3);}
      }
    }
    c.fillStyle='#b4c4cb';for(let b=0;b<=16;b++)c.fillRect(b*1.5-.03,0,.06,24);
    for(let f=0;f<=6;f++){c.fillStyle='#b4c4cb';c.fillRect(0,f*4-.03,24,.06);c.fillStyle='#8298a2';c.fillRect(0,f*4+.88,24,.04);}
    const map=canvasTexture(canvas,true),emissiveMap=canvasTexture(g.canvas,true);map.repeat.set(1/4,1/4);emissiveMap.repeat.set(1/4,1/4);
    return glow(new THREE.MeshStandardMaterial({map,emissiveMap,emissive:'#ffffff',roughness:.22,metalness:.1}),0,.8);
  },
  // The residential tower, 24 m square: pale metal panels woven through the glazing, the weave stepping every second floor.
  panel(q){
    const {canvas,c}=metric(1024*q,1024*q,24,24),g=lights(24,24,512*q,512*q),random=seeded(50),weave=[1,0,0,1,1,0,1,0];
    for(let f=0;f<8;f++)for(let b=0;b<16;b++){
      const x=b*1.5,y=f*3,t=random()*12;
      if(weave[(b+2*Math.floor(f/2))%8]){c.fillStyle=`rgb(${204+t},${207+t},${204+t})`;c.fillRect(x,y,1.5,3);c.fillStyle='rgba(60,66,70,.5)';c.fillRect(x,y,.03,3);continue;}
      const pane=c.createLinearGradient(0,y,0,y+3);pane.addColorStop(0,`rgb(${40+t},${60+t},${76+t})`);pane.addColorStop(1,`rgb(${78+t},${106+t},${126+t})`);
      c.fillStyle=pane;c.fillRect(x,y,1.5,3);c.fillStyle='rgba(20,26,30,.6)';c.fillRect(x,y,.04,3);
      if(random()<.34){g.c.fillStyle=`rgba(255,${214+random()*26},${150+random()*60},${.4+random()*.5})`;g.c.fillRect(x+.06,y+.4,1.38,2.5);}
    }
    c.fillStyle='#c3c7c5';for(let f=0;f<8;f++)c.fillRect(0,f*3,24,.3);
    const map=canvasTexture(canvas,true),emissiveMap=canvasTexture(g.canvas,true);map.repeat.set(1/4,1/4);emissiveMap.repeat.set(1/4,1/4);
    return glow(new THREE.MeshStandardMaterial({map,emissiveMap,emissive:'#ffffff',roughness:.45,metalness:.1}),0,.8);
  },
  // The hotel block, 12 m square: charcoal panels and one large window per 3 m bay, some rooms in coloured light.
  hotel(q){
    const {canvas,c}=metric(512*q,512*q,12,12),g=lights(12,12,256*q,256*q),random=seeded(21),moods=['255,226,170','255,226,170','255,226,170','255,120,180','120,210,255','255,170,90'];
    c.fillStyle='#3d4045';c.fillRect(0,0,12,12);
    for(let f=0;f<4;f++)for(let b=0;b<4;b++){
      const x=b*3+.35,y=f*3+.55,t=random()*10,pane=c.createLinearGradient(0,y,0,y+1.95);
      pane.addColorStop(0,`rgb(${44+t},${60+t},${76+t})`);pane.addColorStop(1,`rgb(${96+t},${124+t},${146+t})`);
      c.fillStyle='#1d1f22';c.fillRect(x-.06,y-.06,2.42,2.07);c.fillStyle=pane;c.fillRect(x,y,2.3,1.95);
      if(random()<.45){g.c.fillStyle=`rgba(${moods[Math.floor(random()*moods.length)]},${.45+random()*.5})`;g.c.fillRect(x,y,2.3,1.95);}
    }
    c.fillStyle='#55595f';for(let k=0;k<=4;k++){c.fillRect(k*3-.02,0,.04,12);c.fillRect(0,k*3-.02,12,.04);}
    const map=canvasTexture(canvas,true),emissiveMap=canvasTexture(g.canvas,true);map.repeat.set(1/2,1/2);emissiveMap.repeat.set(1/2,1/2);
    return glow(new THREE.MeshStandardMaterial({map,emissiveMap,emissive:'#ffffff',roughness:.6,metalness:.1}),0,.9);
  },
  // The podium, 6 m by 48 m: lit shopfronts under a bronze fascia, then 4.33 m floors of tinted glazing that end on the 28.3 m podium line.
  podium(q){
    const {canvas,c}=metric(512*q,4096*q,6,48),g=lights(6,48,256*q,2048*q),random=seeded(77);
    c.fillStyle='#1f2224';c.fillRect(0,0,6,48);
    for(const x of [0,3]){
      const shop=c.createLinearGradient(0,.5,0,4.9);shop.addColorStop(0,'#77684a');shop.addColorStop(.5,'#4d4a40');shop.addColorStop(1,'#243038');
      c.fillStyle=shop;c.fillRect(x+.09,.5,2.82,4.32);
      c.fillStyle='rgba(255,220,160,.22)';c.fillRect(x+.3,.6,.8+random(),1.1+random()*1.4);c.fillStyle='rgba(20,22,24,.45)';c.fillRect(x+1.8,.5,.9,2.15);
      c.fillStyle='#1f2224';c.fillRect(x+.09,3.55,2.82,.07);
      const lamp=g.c.createLinearGradient(0,.5,0,4.9);lamp.addColorStop(0,'rgba(255,214,150,.95)');lamp.addColorStop(1,'rgba(255,196,120,.45)');
      g.c.fillStyle=lamp;g.c.fillRect(x+.09,.5,2.82,4.32);
    }
    c.fillStyle='#39342f';c.fillRect(0,0,6,.5);c.fillStyle='#2b2724';c.fillRect(0,4.9,6,1.3);c.fillStyle='#d8c898';c.fillRect(0,4.9,6,.07);
    g.c.fillStyle='rgba(255,236,190,.9)';g.c.fillRect(0,4.9,6,.07);
    for(let f=6.2;f<48;f+=4.33){
      // A whole floor works late or has gone home.
      const late=random()>.45;c.fillStyle='#3a3531';c.fillRect(0,f,6,.75);
      for(let x=0;x<6;x+=1.5){
        const t=random()*14;c.fillStyle=`rgb(${36+t},${60+t},${61+t})`;c.fillRect(x+.07,f+.82,1.36,3.44);c.fillStyle='rgba(170,208,205,.13)';c.fillRect(x+.07,f+2.7,1.36,1.56);
        if(late){g.c.fillStyle=`rgba(255,${222+random()*20},${170+random()*40},${.35+random()*.5})`;g.c.fillRect(x+.07,f+.82,1.36,3.44);}
      }
    }
    grain(c,canvas,random,8);
    const map=canvasTexture(canvas,true),emissiveMap=canvasTexture(g.canvas,true);map.repeat.set(1,1/8);emissiveMap.repeat.set(1,1/8);
    return glow(new THREE.MeshStandardMaterial({map,emissiveMap,emissive:'#ffffff',roughness:.42,metalness:.08}),.12,.95);
  },
  // The glazed roof over the entrance hall.
  skylight(q){
    const {canvas,c}=metric(256*q,256*q,6,6),pane=c.createLinearGradient(0,0,6,6);pane.addColorStop(0,'#7d9fae');pane.addColorStop(1,'#a9c4cd');
    c.fillStyle=pane;c.fillRect(0,0,6,6);c.fillStyle='#e3e8e8';for(let x=0;x<6;x+=2){c.fillRect(x,0,.14,6);c.fillRect(0,x,6,.14);}
    return new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),roughness:.2,metalness:.1});
  },
};
const finishes=new Map<string,THREE.MeshStandardMaterial>();
/** The shell finish of one surface kind, painted on first use and shared by the streamed tile and the entrance hall. */
export function tdGardenFinish(kind:Exclude<TdGardenSurface,'open'|'other'>,mobile=false){
  let material=finishes.get(kind);if(!material){material=PAINT[kind](mobile?.5:1);material.name=`TD Garden ${kind}`;finishes.set(kind,material);}
  return material;
}

/** Paint every finish now (40 ms of canvas work) instead of in the frame that first builds the arena's tile. */
export function prepareTdGardenFinishes(mobile=false){for(const kind of Object.keys(PAINT) as Exclude<TdGardenSurface,'open'|'other'>[])tdGardenFinish(kind,mobile);}

export interface TdGardenDetails{group:THREE.Group;collisions:{id:string;vertices:Float32Array;indices:Uint32Array}[];setNight(night:boolean):void}

/** The 1995 arena over North Station and the Hub on Causeway in front of it,
 * interpreted on the surveyed shell. Track side: the name sign over the
 * video board, the corner billboard, the stair tower with its mast, eave
 * floodlights and the arched roof edges, above North Station's yard (six
 * stub tracks, four platforms under canopies, trains at rest). Causeway
 * Street: the black steel gantry carrying TD GARDEN and NORTH STATION across
 * the entrance, the entrance hall behind it (steps and bollards on a paved
 * forecourt, fins, screens, escalators and a departures board under a glazed
 * roof), beige piers on the hotel podium and terracotta piers in a dark frame
 * under 100 Causeway, shop signs on the fascias. The boards cycle original
 * slides written for the game instead of the advertising they carry, and the
 * shops are invented. Reference: street-level photographs from the Zakim
 * Bridge and Canal Street, not bundled; the yard is fitted to the Leverett
 * Connector's piers, not surveyed (TD_GARDEN_YARD). The bollard line and the
 * yard's walls, platforms and trains collide. */
export function addTdGardenDetails(scene:THREE.Scene,city:CityData,mobile=false):TdGardenDetails|undefined{
  const garden=landmarkBuildings(city).find(isTdGarden);if(!garden)return;
  const group=new THREE.Group(),q=mobile?.5:1;group.name='TD Garden and North Station - signs, gantry, entrance hall and yard';
  const steel=new THREE.MeshStandardMaterial({color:'#1b1d20',roughness:.55,metalness:.3});
  const frame=new THREE.MeshStandardMaterial({color:'#2c2e31',roughness:.7,metalness:.15});
  const precast=new THREE.MeshStandardMaterial({color:'#bcb5a6',roughness:.9});
  const beige=new THREE.MeshStandardMaterial({color:'#cbbd9c',roughness:.85});
  const terracotta=new THREE.MeshStandardMaterial({color:'#a2573d',roughness:.8});
  const bronze=new THREE.MeshStandardMaterial({color:'#2e2a26',roughness:.6,metalness:.4});
  const stone=new THREE.MeshStandardMaterial({color:'#a9a59a',roughness:.9});
  const strip=new THREE.MeshStandardMaterial({color:'#2a4c6c',roughness:.2,metalness:.15});
  const railGlass=new THREE.MeshStandardMaterial({color:'#9dbcc6',roughness:.15,metalness:.1});
  const post=new THREE.MeshStandardMaterial({color:'#a3a8aa',roughness:.4,metalness:.45});
  const lamp=glow(new THREE.MeshStandardMaterial({color:'#f3e8cc',emissive:'#ffdf9e',roughness:.4}),.35,2.4);
  const beacon=glow(new THREE.MeshStandardMaterial({color:'#7a1512',emissive:'#ff2a1f',roughness:.4}),.5,1.5);
  const green=glow(new THREE.MeshStandardMaterial({color:'#2f8f52',emissive:'#3dff7a',roughness:.4}),.6,1.6);
  const safety=new THREE.MeshStandardMaterial({color:'#e2b93b',roughness:.8});
  const canopy=new THREE.MeshStandardMaterial({color:'#c4c8c8',roughness:.6,metalness:.1});
  // Canopy undersides sit in their own shade, so they carry the light of their lamps.
  const soffit=glow(new THREE.MeshStandardMaterial({color:'#d4d7d4',emissive:'#f1ead8',roughness:.8}),.22,.13);
  // The hall is roofed, so its fins and floor carry a little light of their own.
  const fin=glow(new THREE.MeshStandardMaterial({color:'#cbbd9c',emissive:'#cbbd9c',roughness:.85}),.3,.24);
  const podium=tdGardenFinish('podium',mobile);
  const sans='"Helvetica Neue", Arial, sans-serif',mono='"Courier New", monospace';
  // Centred text; the `mono` weight is the amber message-board face.
  const write=(c:CanvasRenderingContext2D,text:string,x:number,y:number,size:number,color:string,weight='900',max?:number)=>{c.font=weight==='mono'?`bold ${size}px ${mono}`:`${weight} ${size}px ${sans}`;c.textAlign='center';c.textBaseline='middle';c.fillStyle=color;c.fillText(text,x,y,max);};
  // The arena's name as its signs carry it: white letters on a green tile, then gold capitals.
  const nameSign=(()=>{
    const {canvas,c}=sheet(1024,170);c.fillStyle='#0c100f';c.fillRect(0,0,1024,170);c.font=`900 124px ${sans}`;c.textBaseline='middle';
    const letters=[...'GARDEN'],widths=letters.map(ch=>c.measureText(ch).width),gap=20,total=190+widths.reduce((a,b)=>a+b,0)+gap*(letters.length-1);let x=(1024-total)/2;
    c.fillStyle='#1c8a45';c.fillRect(x,14,150,142);write(c,'TD',x+75,88,100,'#ffffff');x+=190;
    c.font=`900 124px ${sans}`;c.textAlign='left';c.fillStyle='#dcb75e';letters.forEach((ch,i)=>{c.fillText(ch,x,90);x+=widths[i]+gap;});
    const map=canvasTexture(canvas);return glow(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',roughness:.6}),.22,1.05);
  })();
  // Free-standing letters: an alpha-tested strip, evenly spaced like channel letters on a truss.
  const lettering=(text:string,w:number,h:number)=>{
    const {canvas,c}=sheet(w,h),chars=[...text],step=w/(chars.length+.6);
    chars.forEach((ch,i)=>write(c,ch,step*(i+.8),h*.53,Math.round(h*.86),'#f4f4ee'));
    const map=canvasTexture(canvas);map.generateMipmaps=false;map.minFilter=THREE.LinearFilter;
    return glow(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',alphaTest:.4,roughness:.5,side:THREE.DoubleSide}),.3,1.1);
  };
  const station=lettering('NORTH STATION',1024,128),numerals=lettering('100',256,128);
  // Slides stacked in one canvas; a board shows one at a time through its texture offset.
  type Slide=(c:CanvasRenderingContext2D)=>void;
  const slideshow=(w:number,h:number,slides:Slide[])=>{
    const {canvas,c}=sheet(w*q,h*q*slides.length);
    slides.forEach((draw,i)=>{c.save();c.translate(0,i*h*q);c.scale(q,q);c.beginPath();c.rect(0,0,w,h);c.clip();draw(c);c.strokeStyle='#050607';c.lineWidth=10;c.strokeRect(0,0,w,h);c.restore();});
    const map=canvasTexture(canvas);map.repeat.set(1,1/slides.length);return{map,count:slides.length};
  };
  const fill=(c:CanvasRenderingContext2D,color:string|CanvasGradient,w:number,h:number)=>{c.fillStyle=color;c.fillRect(0,0,w,h);};
  const video=slideshow(1024,256,[
    c=>{
      const sky=c.createLinearGradient(0,0,1024,0);sky.addColorStop(0,'#0a1630');sky.addColorStop(1,'#163868');fill(c,sky,1024,256);
      c.fillStyle='#f0bf2c';for(let i=0;i<4;i++){c.beginPath();c.moveTo(-50+i*36,256);c.lineTo(-22+i*36,256);c.lineTo(78+i*36,0);c.lineTo(50+i*36,0);c.fill();}
      write(c,'TONIGHT AT THE GARDEN',570,50,40,'#f0bf2c');write(c,'BOSTON vs. EVERYBODY',570,132,90,'#ffffff','900',800);write(c,'PUCK DROPS 7:00  ·  DOORS 6:00',570,214,36,'#a9c8ee','700');
    },
    c=>{
      fill(c,'#0b0b0b',1024,256);write(c,'CHANGING LANES?',512,78,88,'#ffab1a','mono');write(c,'USE YA BLINKAH',512,180,88,'#ffab1a','mono');
      c.fillStyle='rgba(0,0,0,.4)';for(let x=0;x<1024;x+=5)c.fillRect(x,0,1.5,256);for(let y=0;y<256;y+=5)c.fillRect(0,y,1024,1.5);
    },
    c=>{
      fill(c,'#0d4b57',1024,256);
      [['LOST?','M'],['STUCK?','R'],['ANGRY?','F']].forEach(([word,key],i)=>{
        const x=180+i*332;write(c,word,x,62,58,'#ffffff');write(c,'PRESS',x-56,166,40,'#a8d8de','700');
        c.fillStyle='#b9b4a4';c.fillRect(x+22,118,100,104);c.fillStyle='#f2efe4';c.fillRect(x+22,118,100,92);write(c,key,x+72,166,70,'#17303a');
      });
    },
    c=>{
      fill(c,'#8f1d21',1024,256);write(c,'YOU ARE NOT STUCK IN TRAFFIC.',512,62,56,'#ffd9d0','700');write(c,'YOU ARE TRAFFIC.',512,142,88,'#ffffff');
      for(let i=0;i<14;i++){const x=28+i*70;c.fillStyle=i%5===2?'#f1c232':'#3a0c0e';c.fillRect(x,214,52,16);c.fillRect(x+10,201,30,14);}
    },
    c=>{
      fill(c,'#1c1740',1024,256);const random=seeded(7);
      for(let y=0;y<4;y++)for(let x=0;x<16;x++){c.fillStyle=`rgba(120,140,255,${.05+random()*.22})`;c.fillRect(x*64+3,y*64+3,58,58);}
      c.fillStyle='#ff4040';c.beginPath();c.arc(318,56,13,0,Math.PI*2);c.fill();write(c,'NOW STREAMING',530,58,44,'#ffffff','700');
      write(c,'GREATER BOSTON',512,134,96,'#ffffff');write(c,'ONE SQUARE KILOMETRE AT A TIME',512,214,38,'#c9ccff','700');
    },
  ]);
  const billboard=slideshow(768,440,[
    c=>{
      fill(c,'#f2e9d5',768,440);
      c.fillStyle='#6b4a2f';c.beginPath();c.moveTo(92,150);c.lineTo(268,150);c.lineTo(244,392);c.lineTo(116,392);c.fill();
      c.fillStyle='rgba(255,255,255,.75)';for(const [x,y,s] of [[124,176,44],[186,200,40],[150,250,46],[206,268,36],[136,322,40]])c.fillRect(x,y,s,s);
      c.fillStyle='#fdfaf2';c.fillRect(80,128,200,26);c.strokeStyle='#1b7f86';c.lineWidth=14;c.beginPath();c.moveTo(214,152);c.lineTo(246,40);c.stroke();
      write(c,'ICED',524,112,128,'#5a3a22');write(c,'COFFEE',524,226,104,'#5a3a22','900',430);write(c,'YES, IN JANUARY.',524,338,46,'#1b7f86','700');
    },
    c=>{fill(c,'#14335c',768,440);write(c,'HONK IF YOU',384,118,92,'#ffd23f');write(c,'LOVE BOSTON',384,230,104,'#ffffff','900',700);write(c,'(PRESS F. THEY CAN TAKE IT.)',384,350,40,'#a9c8ee','700');},
  ]);
  const hallSlides:Slide[]=[
    c=>{
      fill(c,'#101216',512,288);c.fillStyle='#f0bf2c';for(let i=0;i<9;i++){c.beginPath();c.moveTo(i*72-40,288);c.lineTo(i*72-10,288);c.lineTo(i*72+50,232);c.lineTo(i*72+20,232);c.fill();}
      write(c,"LET'S GO",256,78,76,'#f0bf2c');write(c,'BOSTON',256,164,104,'#ffffff');
    },
    c=>{fill(c,'#123f2a',512,288);write(c,'GAME DAY',256,96,92,'#ffffff');write(c,'DOORS OPEN 6:00',256,190,44,'#bfe8cf','700');write(c,'TRAINS DOWNSTAIRS. HOCKEY UPSTAIRS.',256,246,22,'#bfe8cf','700');},
  ];
  const departures=slideshow(1024,328,[c=>{
    fill(c,'#07090a',1024,328);c.textBaseline='middle';c.textAlign='left';c.font=`bold 40px ${mono}`;c.fillStyle='#ffffff';c.fillText('NORTH STATION DEPARTURES',30,40);
    c.font=`bold 34px ${mono}`;c.fillStyle='#ffab1a';
    [['5:15','ROCKPORT','2','ALL ABOARD'],['5:30','LOWELL','5','ON TIME'],['5:40','HAVERHILL','3','ON TIME-ISH'],['6:05','FITCHBURG','6','SIGNAL PROBLEM'],['6:20','PORTLAND ME','1','WICKED LATE']].forEach((row,i)=>{
      const y=100+i*46;c.fillText(row[0],30,y);c.fillText(row[1],152,y);c.fillText(`TRK ${row[2]}`,482,y);c.fillText(row[3],662,y);
    });
  }]);

  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material)=>{const list=batches.get(m)??[];list.push(g);batches.set(m,list);};
  // Geometry is authored facing +z with +x to the right of a viewer in front of
  // the face, then placed s metres along it, at height y, `out` metres proud.
  const local=(f:Face,g:THREE.BufferGeometry,s:number,y:number,out:number)=>{g.translate(s,y,out);g.rotateY(f.yaw);g.translate(f.x,0,f.z);return g;};
  const set=(f:Face,g:THREE.BufferGeometry,m:THREE.Material,s:number,y:number,out:number)=>add(local(f,g,s,y,out),m);
  const box=(f:Face,m:THREE.Material,s:number,y:number,out:number,w:number,h:number,d:number)=>set(f,new THREE.BoxGeometry(w,h,d),m,s,y,out);
  const plane=(f:Face,m:THREE.Material,s:number,y:number,out:number,w:number,h:number)=>set(f,new THREE.PlaneGeometry(w,h),m,s,y,out);
  // A straight member between two points (s, y, out) of a face frame: geometry authored along +x is turned onto the line.
  type At=[number,number,number];
  const member=(f:Face,g:THREE.BufferGeometry,m:THREE.Material,a:At,b:At)=>{
    const ds=b[0]-a[0],dy=b[1]-a[1],dout=b[2]-a[2];
    g.rotateZ(Math.atan2(dy,Math.hypot(ds,dout)));g.rotateY(Math.atan2(-dout,ds));set(f,g,m,(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
  };
  // A box member t thick; `across` is its width square to a vertical plane through it.
  const strut=(f:Face,m:THREE.Material,a:At,b:At,t:number,across=t)=>member(f,new THREE.BoxGeometry(Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]),t,across),m,a,b);
  // A wall sheet that takes a shell finish: the same 6 m units and base as the surveyed walls.
  const wall=(f:Face,m:THREE.Material,s0:number,s1:number,y0:number,y1:number)=>{
    const g=new THREE.PlaneGeometry(s1-s0,y1-y0),uv=g.getAttribute('uv');
    for(let i=0;i<uv.count;i++)uv.setXY(i,(s0+uv.getX(i)*(s1-s0))/6,(y0+uv.getY(i)*(y1-y0)-BASE)/6);
    set(f,g,m,(s0+s1)/2,(y0+y1)/2,0);
  };
  const slab=(f:Face,m:THREE.Material,s:number,y:number,out:number,w:number,d:number,up:boolean,tile:number)=>{
    const g=new THREE.PlaneGeometry(w,d),uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w/tile,uv.getY(i)*d/tile);
    g.rotateX(up?-Math.PI/2:Math.PI/2);set(f,g,m,s,y,out);
  };
  const screens:THREE.MeshBasicMaterial[]=[];
  const screen=(f:Face,s:number,y:number,out:number,w:number,h:number,show:{map:THREE.Texture;count:number},name:string,period:number)=>{
    const material=new THREE.MeshBasicMaterial({map:show.map}),mesh=new THREE.Mesh(local(f,new THREE.PlaneGeometry(w,h),s,y,out),material);
    mesh.name=name;mesh.userData={slides:show.count,period};
    // `hold` pins a slide for a still; otherwise the board steps through them on the wall clock.
    mesh.onBeforeRender=()=>{const k=mesh.userData.hold??Math.floor(performance.now()/1000/period)%show.count;show.map.offset.y=1-(k+1)/show.count;};
    group.add(mesh);screens.push(material);return mesh;
  };
  // Boxes the car and the helicopter meet, placed like the trim.
  const collisions:TdGardenDetails['collisions']=[];
  const solid=(id:string,f:Face,w:number,h:number,d:number,s:number,y:number,out:number)=>{
    const g=local(f,new THREE.BoxGeometry(w,h,d),s,y,out);collisions.push({id,vertices:new Float32Array(g.getAttribute('position').array),indices:Uint32Array.from(g.index!.array)});g.dispose();
  };
  const F=FACES,N=F.north,R=face([0,0],[1,0]);

  // Light thrown on a surface: an additive sheet shown at night only.
  const thrown=(canvas:HTMLCanvasElement)=>new THREE.MeshBasicMaterial({map:canvasTexture(canvas),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,visible:false});
  // Track side. The eave coping and its gooseneck floodlights, clear of the stair tower; at night each throws a pool down the wall.
  const wash=(()=>{
    const {canvas,c}=sheet(64,128),down=c.createLinearGradient(0,0,0,128),across=c.createLinearGradient(0,0,64,0);
    down.addColorStop(0,'#000');down.addColorStop(.07,'#b08a50');down.addColorStop(1,'#000');across.addColorStop(0,'#000');across.addColorStop(.5,'#fff');across.addColorStop(1,'#000');
    fill(c,down,64,128);c.globalCompositeOperation='multiply';fill(c,across,64,128);return thrown(canvas);
  })();
  const TOWER=10.79;let floodlights=0;
  box(N,frame,N.length/2,45.25,.2,N.length+.6,.55,.8);
  for(let s=4;s<N.length-2;s+=6){if(Math.abs(s-TOWER)<4.4)continue;box(N,steel,s,44.35,.8,.09,.09,1.6);set(N,new THREE.BoxGeometry(.6,.18,.42).rotateX(.55),lamp,s,44.2,1.62);plane(N,wash,s,38.6,.14,6,11);floodlights++;}
  // The stair tower: a precast pier with a strip of dark glass, a railed deck on top and the mast with its beacon.
  box(N,precast,TOWER,27.7,.6,5.7,54.5,1.2);box(N,strip,TOWER,29.6,1.23,2.3,45,.08);
  for(let y=9.2;y<52;y+=3.6)box(N,frame,TOWER,y,1.3,2.5,.16,.1);
  for(const side of [-1,1])box(N,frame,TOWER+side*1.2,29.6,1.3,.14,45.2,.1);
  box(N,frame,TOWER,55.2,-5.4,7.4,.5,12.4);
  for(const side of [-1,1]){
    box(N,steel,TOWER,56.2,-5.4+side*6.1,7.4,.07,.07);box(N,steel,TOWER+side*3.65,56.2,-5.4,.07,.07,12.3);
    for(const end of [-1,1])box(N,steel,TOWER+side*3.65,55.8,-5.4+end*6.1,.07,.8,.07);
  }
  set(N,new THREE.CylinderGeometry(.2,.42,21,10),steel,TOWER,65.95,-5.4);
  for(const [y,ds] of [[60.5,.55],[63.5,-.55],[67,.5]])box(N,frame,TOWER+ds,y,-5.4,.3,1.9,.22);
  set(N,new THREE.SphereGeometry(.34,10,8),beacon,TOWER,76.75,-5.4);
  // The sign board: the name over a 36 m video board in a steel surround, with a service catwalk below.
  const BOARD=45.85;
  box(N,frame,BOARD,28.2,.38,38.8,16,.66);
  for(const y of [30.38,21.02])box(N,steel,BOARD,y,.88,36.9,.34,.4);
  for(const side of [-1,1])box(N,steel,BOARD+side*18.28,25.7,.88,.34,9.7,.4);
  plane(N,nameSign,BOARD,33.3,.86,26,4.32);
  box(N,steel,BOARD,19.95,1.3,37.4,.1,1.2);box(N,steel,BOARD,20.95,1.86,37.4,.06,.06);
  for(let s=-18.6;s<=18.61;s+=3.1)box(N,steel,BOARD+s,20.45,1.86,.06,1,.06);
  screen(N,BOARD,25.7,.84,36,9,video,'TD Garden video board',8);
  // The corner block's billboard.
  const K=F.corner;
  box(K,frame,K.length/2,29.6,.3,11.4,6.9,.5);
  for(const dy of [-3.27,3.27])box(K,steel,K.length/2,29.6+dy,.72,11.2,.3,.36);
  for(const side of [-1,1])box(K,steel,K.length/2+side*5.55,29.6,.72,.3,6.84,.36);
  screen(K,K.length/2,29.6,.68,10.8,6.17,billboard,'TD Garden corner billboard',11);
  // Fascias along the arched roof edges of both gables, on the surveyed vault profile.
  const arch=(points:At[])=>{for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];strut(R,frame,[a[0],a[2],-a[1]],[b[0],b[2],-b[1]],.9,.8);}};
  arch([[131.2,0,45.4],[131.55,-4.05,46.7],[135.85,-25.3,49.8],[141.35,-52.6,51.35],[143.75,-64.4,50.1],[149.55,-92.7,45.05]]);
  arch([[12.8,-2.3,45.4],[10.25,-6,46.7],[9.6,-27.3,49.8],[8.7,-54.9,51.35]]);arch([[-2.55,-55,51.35],[-2.75,-66.9,50.1],[-3.15,-95.3,45.05]]);
  // Red obstruction lights on both towers.
  for(const [u,v,y] of [[2.6,-141.6,150.4],[23,-141.8,150.4],[3.9,-97.5,150.4],[22,-97.7,150.4],[92.2,-102,153.9],[135.2,-102.2,153.9],[135,-136.5,153.9],[92,-145.2,153.9]])set(R,new THREE.SphereGeometry(.4,8,6),beacon,u,y,-v);

  // Shop signs for the street fascias: no real tenants, only places a Boston driver might pull over for.
  const SHOPS=[['REGULAH COFFEE CO.','#3b2a1d','#f3e2c0'],['FIVE-HOLE DONUTS','#f1e7d3','#b0343c'],['THE SIN BIN TAVERN','#16261f','#e9c46a'],['CHOWDAH HOUSE','#143a5c','#ffffff'],['GARDEN VARIETY GROCER','#e8ecdf','#2f6b3a'],['HAT TRICK HATS','#1c1c1f','#ffffff'],['ZAMBONI DRIVING SCHOOL','#dff0f4','#17506b'],['PARQUET PIZZA','#7a2a20','#f6d98b'],['STORROW TRUCK RENTAL','#f2c230','#1a1a1a'],['TRACK 6 NEWS','#22252b','#ffab1a']];
  const shopSigns=(()=>{
    const {canvas,c}=sheet(640*q,92*q*SHOPS.length);c.scale(q,q);
    SHOPS.forEach(([name,ground,ink],i)=>{c.fillStyle=ground;c.fillRect(0,i*92,640,92);c.strokeStyle=ink;c.lineWidth=3;c.strokeRect(9,i*92+9,622,74);write(c,name,320,i*92+48,50,ink,'900',580);});
    const map=canvasTexture(canvas);return glow(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',roughness:.6}),.18,.95);
  })();
  let shops=0;
  // The next sign of the sheet, a little inside its row so neighbours do not bleed in.
  const shopSign=(f:Face,s:number,y:number,out:number)=>{
    const g=new THREE.PlaneGeometry(4.6,.66),uv=g.getAttribute('uv');for(let k=0;k<uv.count;k++)uv.setY(k,1-(shops+.97-.94*uv.getY(k))/SHOPS.length);set(f,g,shopSigns,s,y,out);shops++;
  };
  // Causeway Street. Beige piers, a parapet band, a bronze shopfront fascia and canopies on the hotel podium and the residential tower's base.
  const TOP=TD_GARDEN_PODIUM_TOP;
  const piers=(f:Face,m:THREE.Material,n:number,top:number,w:number)=>{for(let i=0;i<=n;i++)box(f,m,f.length*i/n,(BASE+top)/2+.02,.3,w,top-BASE,.6);};
  for(const f of [F.towerA,F.hotel]){
    const n=Math.round(f.length/6);piers(f,beige,n,TOP,1.1);box(f,beige,f.length/2,TOP-.2,.34,f.length+1.1,1.2,.68);box(f,bronze,f.length/2,6,.24,f.length,1.3,.48);
    for(let i=0;i<n;i+=2){box(f,steel,f.length*(i+.5)/n,5.2,1.15,f.length/n-1.3,.14,1.8);shopSign(f,f.length*(i+.5)/n,6,.62);}
  }
  for(const f of [F.towerAWestNorth,F.towerAWestSouth]){piers(f,beige,Math.round(f.length/6),TOP,1.1);box(f,beige,f.length/2,TOP-.2,.34,f.length+.6,1.2,.68);}
  // 100 Causeway's base and the east wing: terracotta piers in a dark steel frame, the street number beside the entrance.
  for(const [f,top] of [[F.officeWest,TOP],[F.office,TOP],[F.wing,38.7],[F.wingEast,38.7]] as const){
    piers(f,terracotta,Math.max(1,Math.round(f.length/5.6)),top,.9);
    for(let y=6.65;y<top-1;y+=4.33)box(f,steel,f.length/2,y,.2,f.length,.5,.4);
    box(f,steel,f.length/2,top-.15,.3,f.length+.6,1,.62);
  }
  plane(F.officeWest,numerals,F.officeWest.length/2,8.9,.5,5.4,2.5);
  for(const bay of [1,3,5,6])shopSign(F.office,F.office.length*(bay+.5)/Math.round(F.office.length/5.6),BASE+5.55,.14);

  // The entrance: steps up from the sidewalk to the hall floor behind a line of bollards.
  const M=F.mouth,ground=sampleElevation(city,...tdGardenWorld(81.3,-151)),FLOOR=BASE+.05,rise=(FLOOR-ground)/6,DEPTH=45.7,CEILING=30.38;
  for(let k=1;k<6;k++){const top=FLOOR-rise*k;box(M,stone,M.length/2,(top+ground-.6)/2,.17*k,M.length,top-ground+.6,.34*k);}
  box(M,stone,M.length/2,FLOOR-.3,-.2,M.length,.6,.4);
  let bollards=0;for(let s=3.6;s<M.length-3.4;s+=1.65){set(M,new THREE.CylinderGeometry(.13,.13,1,10),post,s,ground+.5,2.6);bollards++;}
  solid('td-garden-entrance-bollards',M,M.length,1.6,.3,M.length/2,ground+.3,2.6);
  // The gantry: two lattice legs, a deep truss carrying the name and a lighter one carrying NORTH STATION in white letters on a dark band.
  const G=face([71.2,-151],[91.4,-151]),legs=[1.3,G.length-1.3],HEIGHT=37.2,half=.95,corners:Point[]=[[-half,-half],[half,-half],[half,half],[-half,half]];
  for(const s of legs){
    for(const [ds,dout] of corners)strut(G,steel,[s+ds,ground-.2,dout],[s+ds,HEIGHT,dout],.26);
    for(let k=0;k*2.3<HEIGHT-ground-.4;k++){
      const y0=ground+.4+k*2.3,y1=Math.min(HEIGHT,y0+2.3);
      corners.forEach((a,i)=>{const b=corners[(i+1)%4],[p,r]=k%2?[b,a]:[a,b];strut(G,steel,[s+a[0],y0,a[1]],[s+b[0],y0,b[1]],.13);strut(G,steel,[s+p[0],y0,p[1]],[s+r[0],y1,r[1]],.11);});
    }
  }
  const truss=(y0:number,y1:number,depth:number,panels:number,chord:number,web:number)=>{
    const s0=legs[0]-half,s1=legs[1]+half,step=(s1-s0)/panels;
    for(const out of [-depth,depth]){
      for(const y of [y0,y1])strut(G,steel,[s0,y,out],[s1,y,out],chord);
      for(let i=0;i<=panels;i++){const s=s0+step*i;strut(G,steel,[s,y0,out],[s,y1,out],web);if(i<panels)strut(G,steel,[s,i%2?y1:y0,out],[s+step,i%2?y0:y1,out],web);}
    }
    for(let i=0;i<=panels;i++)for(const y of [y0,y1])strut(G,steel,[s0+step*i,y,-depth],[s0+step*i,y,depth],web);
  };
  truss(31.6,37,half,8,.3,.14);truss(15.5,17,.6,14,.22,.1);
  box(G,frame,G.length/2,34.3,half+.22,16.4,3.2,.14);plane(G,nameSign,G.length/2,34.3,half+.42,15.6,2.6);
  box(G,frame,G.length/2,18.15,.62,15.6,2.5,.1);plane(G,station,G.length/2,18.15,.82,14.6,1.9);
  // The entrance hall, seen through the passage: paved floor, podium glazing behind beige fins and gallery edges, a glazed roof on steel trusses.
  const W=face([71.35,-148.4],[71.35,-148.4+DEPTH]),E=face([91.25,-148.5+DEPTH],[91.25,-148.5]),BACK=face([71.35,-102.75],[91.25,-102.75]);
  const paving=(()=>{
    const {canvas,c}=sheet(256,256),random=seeded(64);fill(c,'#b9b5aa',256,256);
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){const t=random()*18;c.fillStyle=`rgb(${176+t},${172+t},${162+t})`;c.fillRect(x*64+1,y*64+1,62,62);}
    grain(c,canvas,random,12);const map=canvasTexture(canvas,true);return glow(new THREE.MeshStandardMaterial({map,color:'#f3e7d2',emissiveMap:map,emissive:'#ffe6c4',roughness:.5}),.3,.26);
  })();
  const ceiling=(()=>{
    const {canvas,c}=sheet(256,256);fill(c,'#cfe3ec',256,256);c.fillStyle='#f4f6f6';for(let x=0;x<256;x+=64){c.fillRect(x,0,7,256);c.fillRect(0,x,256,7);}
    const map=canvasTexture(canvas,true);return glow(new THREE.MeshStandardMaterial({map,emissiveMap:map,emissive:'#ffffff',roughness:.6}),.6,.05);
  })();
  slab(M,paving,M.length/2,FLOOR,-DEPTH/2,M.length,DEPTH,true,3);slab(M,ceiling,M.length/2,CEILING,-DEPTH/2,M.length,DEPTH,false,6);
  // The forecourt: the same pavers from the steps to the kerb, laid on the ground over the surveyed sidewalk and
  // over the gap that survey leaves east of it, a driveway mouth built over since.
  {
    const court=parkSurface(city,[[[70.6,-154.5],[92,-154.9],[92,-148.6],[70.6,-148.2]].map(([u,v])=>tdGardenWorld(u,v))],.07),p=court.getAttribute('position'),uv=court.getAttribute('uv');
    for(let i=0;i<p.count;i++){const [u,v]=tdGardenFrame(p.getX(i),p.getZ(i));uv.setXY(i,u/3,v/3);}
    add(court,new THREE.MeshStandardMaterial({map:paving.map,roughness:.85,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
  }
  wall(W,podium,0,DEPTH,BASE,CEILING);wall(E,podium,0,DEPTH,BASE,CEILING);wall(BACK,podium,0,BACK.length,BASE,CEILING);
  for(const f of [W,E]){
    for(let s=2.2;s<DEPTH-1;s+=2.3)box(f,fin,s,18.2,.45,.34,24.2,.9);
    for(let y=6.65;y<CEILING-1;y+=4.33)box(f,fin,DEPTH/2,y,.35,DEPTH,.45,.7);
  }
  for(let out=5;out<DEPTH;out+=9){box(M,steel,M.length/2,CEILING-.7,-out,M.length,1.1,.35);for(let s=2.6;s<M.length;s+=5)box(M,lamp,s,CEILING-1.35,-out,.9,.12,.5);}
  ([[W,13,0],[E,DEPTH-13,1]] as const).forEach(([f,s,first])=>{box(f,steel,s,13.4,1.02,12.6,7.3,.2);screen(f,s,13.4,1.2,12,6.75,slideshow(512,288,[hallSlides[first],hallSlides[1-first]]),'North Station hall screen',9);});
  // The back of the hall: doors under a gallery, the departures board above it and three escalators lit green along their skirts.
  box(BACK,stone,BACK.length/2,7,2.1,BACK.length,.5,4.2);box(BACK,railGlass,BACK.length/2,7.8,4.15,BACK.length,1.1,.06);box(BACK,steel,BACK.length/2,8.38,4.15,BACK.length,.06,.1);
  for(let i=0;i<=5;i++)box(BACK,steel,BACK.length*i/5,3.6,.14,.22,6.3,.2);box(BACK,steel,BACK.length/2,3.3,.14,BACK.length,.2,.2);
  box(BACK,steel,BACK.length/2,12.6,.32,10.8,4,.24);screen(BACK,BACK.length/2,12.6,.5,10,3.2,departures,'North Station departures board',60);
  for(const s of [6.2,9.95,13.7]){
    strut(BACK,steel,[s,FLOOR-.15,15.6],[s,7,4.2],.5,1.5);
    for(const side of [-1,1]){strut(BACK,railGlass,[s+side*.78,FLOOR+.55,15.6],[s+side*.78,7.7,4.2],.9,.05);strut(BACK,green,[s+side*.78,FLOOR+.08,15.6],[s+side*.78,7.23,4.2],.12,.1);}
  }

  // North Station's yard (TD_GARDEN_YARD): stub tracks on ballast, platforms under canopies, trains at rest.
  const YARD=TD_GARDEN_YARD,TRACKS=YARD.tracks,PLATFORMS=YARD.platforms,TRAINS=YARD.trains,APRON=BASE-.1,BAY=YARD.bay;
  const Y=face([YARD.east,0],[YARD.west,0]),wide=YARD.east-YARD.west,along=(u:number)=>YARD.east-u,land=(u:number,v:number)=>sampleElevation(city,...tdGardenWorld(u,v));
  const bays=(from:number,to:number)=>{const list:number[]=[];for(let v=from;v<to-.01;v+=BAY)list.push(v);return[...list,to];};
  // Ballast across the whole yard in one sheet sixteen times wider than long, ties and rails painted at the tracks.
  const ballast=(()=>{
    const {canvas,c}=sheet(2048*q,128*q),random=seeded(1894),k=canvas.width/wide;fill(c,'#757067',canvas.width,canvas.height);
    for(const u of TRACKS){
      const x=along(u)*k;c.fillStyle='#625d55';c.fillRect(x-1.75*k,0,3.5*k,canvas.height);
      c.fillStyle='#3e3832';for(let i=0;i<6;i++)c.fillRect(x-1.3*k,(i+.3)*canvas.height/6,2.6*k,.24*k);
      for(const side of [-1,1]){c.fillStyle='#2f2c2a';c.fillRect(x+side*.72*k-.08*k,0,.16*k,canvas.height);c.fillStyle='#c2c5c6';c.fillRect(x+side*.72*k-.03*k,0,.06*k,canvas.height);}
    }
    grain(c,canvas,random,24);
    return new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),roughness:.95,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  })();
  {
    const field=parkSurface(city,[[[YARD.west,.5],[YARD.east,.5],[YARD.east,YARD.end],[YARD.west,YARD.end]].map(([u,v])=>tdGardenWorld(u,v))],.07),p=field.getAttribute('position'),uv=field.getAttribute('uv');
    for(let i=0;i<p.count;i++){const [u,v]=tdGardenFrame(p.getX(i),p.getZ(i));uv.setXY(i,along(u)/wide,v*16/wide);}
    add(field,ballast);
  }
  const pool=(()=>{const {canvas,c}=sheet(64,64),round=c.createRadialGradient(32,32,3,32,32,32);round.addColorStop(0,'#7d6b48');round.addColorStop(1,'#000');fill(c,round,64,64);return thrown(canvas);})();
  // A wall along each side, and the concourse apron under its lit canopy at the arena wall.
  for(const [u,name] of [[YARD.west-.1,'west'],[YARD.east+.05,'east']] as const){
    const vs=bays(-1.9,YARD.end);for(let k=1;k<vs.length;k++)strut(Y,stone,[along(u),land(u,vs[k-1])+.45,vs[k-1]],[along(u),land(u,vs[k])+.45,vs[k]],1.3,.3);
    solid(`north-station-yard-wall-${name}`,Y,.3,2.8,YARD.end+1.9,along(u),land(u,YARD.end/2)+.6,YARD.end/2-.95);
  }
  const A0=PLATFORMS[0][0],A1=PLATFORMS[PLATFORMS.length-1][1],MID=along((A0+A1)/2);
  box(Y,stone,MID,APRON-1.2,2,A1-A0,2.4,8.04);box(Y,safety,MID,APRON+.02,5.7,A1-A0,.05,.6);box(Y,canopy,MID,APRON+4.4,2.4,A1-A0+1.4,.2,7.6);box(Y,soffit,MID,APRON+4.27,2.4,A1-A0+1.3,.04,7.5);box(Y,frame,MID,APRON+4.25,6.1,A1-A0+1.4,.5,.2);
  for(let k=0,n=Math.round((A1-A0)/9);k<n;k++){const s=along(A1)+(A1-A0)*(k+.5)/n;box(Y,lamp,s,APRON+4.2,2.6,2.4,.08,.3);set(Y,new THREE.PlaneGeometry((A1-A0)/n,6).rotateX(-Math.PI/2),pool,s,APRON+.07,3);}
  solid('north-station-concourse-apron',Y,A1-A0,3,11.1,MID,APRON-1.5,3.55); // out to the bumpers, so a car stops short of them
  // Platforms follow the ground in bays, 1.3 m over it, ramping up to the apron; yellow edges, a canopy on a
  // spine of posts with a lamp in every bay and its pool on the platform at night.
  let canopyBays=0;
  PLATFORMS.forEach(([u0,u1,end,roofs],i)=>{
    const c=(u0+u1)/2,s=along(c),w=u1-u0,vs=bays(6,end),h=vs.map(v=>v>6?land(c,v)+1.3:APRON);
    const top=(v:number)=>{const k=Math.min(vs.length-2,Math.floor((v-6)/BAY));return h[k]+(h[k+1]-h[k])*(v-vs[k])/BAY;};
    for(let k=1;k<vs.length;k++){
      strut(Y,stone,[s,h[k-1]-1.2,vs[k-1]],[s,h[k]-1.2,vs[k]],2.4,w);
      for(const side of [-1,1])strut(Y,safety,[s+side*(w/2-.4),h[k-1]+.02,vs[k-1]],[s+side*(w/2-.4),h[k]+.02,vs[k]],.05,.6);
    }
    for(const [from,to] of roofs)for(let v=from;v<to;v+=BAY){
      const a=top(v)+4.3,b=top(v+BAY)+4.3;strut(Y,canopy,[s,a,v],[s,b,v+BAY],.2,w-1.2);strut(Y,soffit,[s,a-.13,v],[s,b-.13,v+BAY],.04,w-1.3);strut(Y,steel,[s,a-.22,v],[s,b-.22,v+BAY],.24,.3);
      box(Y,lamp,s,(a+b)/2-.38,v+BAY/2,.3,.08,2.4);member(Y,new THREE.PlaneGeometry(BAY,w-.4).rotateX(-Math.PI/2),pool,[s,a-4.24,v],[s,b-4.24,v+BAY]);
      for(const at of v+BAY<to?[v+.3]:[v+.3,to-.3])box(Y,steel,s,top(at)+2,at,.26,4,.26);
      canopyBays++;
    }
    solid(`north-station-platform-${i+1}`,Y,w,3,end-6,s,h.reduce((sum,y)=>sum+y,0)/h.length-1.5,(6+end)/2);
  });
  // Push-pull trains: stainless coaches with a purple band, their windows lit at night. One sheet per type:
  // an end at the top left (76 by 96 px), the roof colour beside it, the side below.
  const livery=(w:number,end:(c:CanvasRenderingContext2D,g:CanvasRenderingContext2D)=>void,side:(c:CanvasRenderingContext2D,g:CanvasRenderingContext2D)=>void)=>{
    const {canvas,c}=sheet(w,256),g=sheet(w,256);fill(c,'#5d6165',w,256);fill(g.c,'#000',w,256);end(c,g.c);c.translate(0,96);g.c.translate(0,96);side(c,g.c);
    const material=glow(new THREE.MeshStandardMaterial({map:canvasTexture(canvas),emissiveMap:canvasTexture(g.canvas),emissive:'#ffffff',roughness:.5,metalness:.1}),0,.85);material.userData.end=76/w;return material;
  };
  const running=(c:CanvasRenderingContext2D,w:number,axles:number[])=>{c.fillStyle='#232527';c.fillRect(0,126,w,34);c.fillStyle='#0e0f10';for(const x of axles){c.beginPath();c.arc(x,146,13,0,Math.PI*2);c.fill();}};
  const coach=livery(1024,c=>{
    fill(c,'#aeb2b6',76,96);c.fillStyle='#6b2d7d';c.fillRect(0,55,76,11);c.fillStyle='#3a3d42';c.fillRect(24,14,28,62);c.fillStyle='#18232b';c.fillRect(30,20,16,18);c.fillStyle='#232527';c.fillRect(0,76,76,20);
  },(c,g)=>{
    c.fillStyle='#b9bdc1';c.fillRect(0,13,1024,113);c.fillStyle='rgba(255,255,255,.2)';for(let y=22;y<126;y+=7)c.fillRect(0,y,1024,1.5);
    c.fillStyle='#7d8287';c.fillRect(0,13,1024,6);c.fillStyle='#6b2d7d';c.fillRect(0,90,1024,18);c.fillStyle='#e9bb2f';c.fillRect(0,108,1024,3);
    for(let x=84;x<930;x+=66){c.fillStyle='#18232b';c.fillRect(x,42,46,34);g.fillStyle='rgba(255,232,186,.85)';g.fillRect(x,42,46,34);}
    for(const x of [22,964]){c.fillStyle='#8f9499';c.fillRect(x,34,38,92);c.fillStyle='#18232b';c.fillRect(x+9,42,20,30);}
    running(c,1024,[70,150,874,954]);
  });
  const loco=livery(512,(c,g)=>{
    fill(c,'#3a3d44',76,96);c.fillStyle='#18232b';c.fillRect(8,12,26,18);c.fillRect(42,12,26,18);c.fillStyle='#6b2d7d';c.fillRect(0,40,76,24);c.fillStyle='#e9bb2f';c.fillRect(0,64,76,4);
    for(const x of [14,62]){c.fillStyle='#f4f1e4';c.beginPath();c.arc(x,52,5,0,Math.PI*2);c.fill();g.fillStyle='#fff4d6';g.beginPath();g.arc(x,52,5,0,Math.PI*2);g.fill();}
    c.fillStyle='#232527';c.fillRect(0,76,76,20);
  },(c,g)=>{
    c.fillStyle='#3a3d44';c.fillRect(0,13,512,113);c.fillStyle='#6b2d7d';c.fillRect(0,64,512,34);c.fillStyle='#e9bb2f';c.fillRect(0,98,512,5);
    c.fillStyle='#22242a';for(let x=110;x<400;x+=14)c.fillRect(x,24,8,30);
    c.fillStyle='#18232b';c.fillRect(450,26,42,26);g.fillStyle='rgba(255,232,186,.6)';g.fillRect(450,26,42,26);
    running(c,512,[46,96,146,366,416,466]);
  });
  const car=(m:THREE.Material,u:number,v0:number,v1:number,h:number)=>{
    const g=new THREE.BoxGeometry(v1-v0,h,3.1),uv=g.getAttribute('uv'),end=m.userData.end;
    // Box faces in order: two ends, roof and floor, two sides (the far one mirrored back so both read the same way round).
    for(let i=0;i<24;i++){const x=uv.getX(i),y=uv.getY(i);if(i<8)uv.setXY(i,(.04+.92*x)*end,.635+.355*y);else if(i<16)uv.setXY(i,.5,.9);else uv.setXY(i,i<20?x:1-x,y*.625);}
    member(Y,g,m,[along(u),land(u,v0)+.3+h/2,v0],[along(u),land(u,v1)+.3+h/2,v1]);
  };
  let railCars=0;
  TRAINS.forEach(([u,coaches],i)=>{
    const end=10+coaches*26;for(let k=0;k<coaches;k++)car(coach,u,10+k*26,35.4+k*26,3.9);car(loco,u,end,end+20,4.3);railCars+=coaches+1;
    solid(`north-station-train-${i+1}`,Y,3.1,5,end+10,along(u),land(u,end/2+15)+2.6,end/2+15);
  });
  // A bumper with a red lamp at the end of every track, and a signal bridge across the throat.
  const SIGNALS=YARD.end-4,beam=Math.max(land(YARD.west,SIGNALS),land(YARD.east,SIGNALS))+7;
  for(const u of TRACKS){
    const y=land(u,8.2);box(Y,steel,along(u),y+.4,8.6,2.5,.5,1);box(Y,safety,along(u),y+.85,8.2,2.3,.7,.3);set(Y,new THREE.SphereGeometry(.14,8,6),beacon,along(u),y+1.4,8.2);
    box(Y,frame,along(u),beam-.75,SIGNALS,.55,1.2,.35);for(const side of [-1,1])set(Y,new THREE.SphereGeometry(.13,8,6),beacon,along(u),beam-.5,SIGNALS+side*.22);
  }
  for(const s of [.4,wide-.4])strut(Y,steel,[s,land(YARD.east-s,SIGNALS)-.2,SIGNALS],[s,beam+1.2,SIGNALS],.4);
  for(const y of [beam,beam+1.2])strut(Y,steel,[.4,y,SIGNALS],[wide-.4,y,SIGNALS],.2);
  for(let i=0;i<=12;i++){const s=.4+(wide-.8)*i/12;strut(Y,steel,[s,beam,SIGNALS],[s,beam+1.2,SIGNALS],.1);if(i<12)strut(Y,steel,[s,i%2?beam+1.2:beam,SIGNALS],[s+(wide-.8)/12,i%2?beam:beam+1.2,SIGNALS],.1);}

  let triangles=0;
  for(const [material,geometries]of batches){
    const flat=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(flat,false);if(!geometry)continue;
    geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=!material.transparent;group.add(mesh);triangles+=geometry.getAttribute('position').count/3;
    new Set([...geometries,...flat]).forEach(g=>g.dispose());
  }
  const setNight=(value:boolean)=>{night=value;for(const m of glowing)m.emissiveIntensity=m.userData.glow[value?1:0];for(const m of screens)m.color.setScalar(value?.82:1);wash.visible=pool.visible=value;};
  group.userData={buildingId:garden.id,triangles,signs:['TD GARDEN','NORTH STATION'],boards:{video:video.count,billboard:billboard.count,hall:2,departures:departures.count},gantryHeight:HEIGHT-ground,floodlights,bollards,obstructionLights:8,shopSigns:shops,yard:{tracks:TRACKS.length,platforms:PLATFORMS.length,canopyBays,railCars,solids:collisions.length-1},reference:'Street-level photographs from the Zakim Bridge and Canal Street, not bundled'};
  scene.add(group);return{group,collisions,setNight};
}
