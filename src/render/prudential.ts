import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Building,CityData} from '../types';
import {canvasTexture,seeded} from './materials.ts';

export const PRUDENTIAL_ID='BOS-KBIA4-2XA04-WNETP';

/** Tower shaft measured from the source mesh's vertical walls, corners
 * (-664.97,314.34), (-621.20,298.25), (-602.11,350.17) and (-645.88,366.26).
 * Local x runs along the 46.6 m faces and local z along the 55.3 m faces. */
export const PRUDENTIAL_TOWER={x:-633.54,z:332.255,yaw:.35246,halfX:23.317,halfZ:27.659};

/** Crown levels in the source datum. The shaft roof is at 215.42 m behind a
 * parapet to 216.44 m; the source setback volume rises to a 230.25 m roof and
 * sits 2.3-2.8 m inside the shaft faces (one flue at 1.84 m). Everything here
 * stays outside that volume so the hidden source walls never show through. */
export const PRUDENTIAL_CROWN={
  roof:215.42,parapet:216.44,recessTop:219,slabTop:221,glassTop:228.5,top:230.55,
  overhang:.25,glassInset:.9,recessInset:1.5,
  letterHeight:2.3,letterDepth:.3,letterStandoff:.25,letterTop:228.2,
};
const SOURCE_TOP=236.914;
// A faint daytime glow keeps the white letters reading as white on shaded faces.
const DAY_LETTER_GLOW=.22;
const C=PRUDENTIAL_CROWN,T=PRUDENTIAL_TOWER;

/** Offset from the source datum, should the building's seated base move. */
const buildingLift=(b:Building)=>(b.baseElevation??0)+b.height-SOURCE_TOP;
const datumLift=(city:CityData)=>{const b=city.buildings.find(x=>x.id===PRUDENTIAL_ID);return b?buildingLift(b):undefined;};
const placeOnTower=(g:THREE.BufferGeometry,lift:number)=>g.rotateY(T.yaw).translate(T.x,lift,T.z);

/** The four crown faces in the tower frame: yaw turns +z onto the outward
 * normal, `half` is half the face width, `distance` the shaft face offset. */
export const PRUDENTIAL_FACES=[0,Math.PI/2,Math.PI,-Math.PI/2].map(yaw=>{
  const long=Math.abs(Math.sin(yaw))>.5;
  return {yaw,half:long?T.halfZ:T.halfX,distance:long?T.halfX:T.halfZ};
});

// Original wide Roman capitals in cap-height units: thick stems, hairline
// bars, bracketless serifs. Overlapping pieces share one flat front plane.
const STEM=.17,HAIR=.075,SERIF=.06,WIDE=1.08,TRACK=.5;
function rect(x0:number,y0:number,x1:number,y1:number){
  const s=new THREE.Shape();s.moveTo(x0,y0);s.lineTo(x1,y0);s.lineTo(x1,y1);s.lineTo(x0,y1);s.closePath();return s;
}
function poly(...points:[number,number][]){
  const s=new THREE.Shape();s.moveTo(...points[0]);for(const p of points.slice(1))s.lineTo(...p);s.closePath();return s;
}
/** Half ring between an outer and an inner ellipse; offsetting the inner
 * ellipse gives the thick-and-thin stress of a serif bowl. */
function bowl(cx:number,cy:number,rx:number,ry:number,icx:number,irx:number,iry:number,from:number,to:number){
  const s=new THREE.Shape();s.moveTo(cx+Math.cos(from)*rx,cy+Math.sin(from)*ry);
  s.absellipse(cx,cy,rx,ry,from,to,false);s.lineTo(icx+Math.cos(to)*irx,cy+Math.sin(to)*iry);
  s.absellipse(icx,cy,irx,iry,to,from,true);s.closePath();return s;
}
const up=Math.PI/2,stem=(x=.085)=>rect(x,0,x+STEM,1);
const pBowl=()=>[stem(),rect(0,0,.34,SERIF),rect(0,1-HAIR,.5,1),rect(.255,.44,.5,.44+HAIR),bowl(.5,.72,.3,.28,.5,.13,.205,-up,up)];
const GLYPHS:Record<string,{width:number;pieces:()=>THREE.Shape[]}>={
  P:{width:.8,pieces:pBowl},
  R:{width:.95,pieces:()=>[...pBowl(),poly([.4,.47],[.575,.47],[.86,0],[.68,0]),rect(.62,0,.95,SERIF)]},
  U:{width:.905,pieces:()=>[rect(.085,.34,.255,1),rect(.745,.34,.82,1),bowl(.4525,.34,.3675,.34,.5,.245,.265,Math.PI,2*Math.PI),rect(0,1-SERIF,.34,1),rect(.66,1-SERIF,.905,1)]},
  D:{width:.9,pieces:()=>[stem(),rect(0,1-HAIR,.42,1),rect(0,0,.42,HAIR),bowl(.42,.5,.48,.5,.42,.3,.425,-up,up)]},
  E:{width:.74,pieces:()=>[stem(),rect(0,1-HAIR,.7,1),rect(0,0,.74,HAIR),rect(.255,.465,.6,.535),rect(.645,.76,.7,1),rect(.685,0,.74,.25),rect(.565,.39,.6,.62)]},
  N:{width:.885,pieces:()=>[rect(.1,0,.175,1),poly([.1,1],[.29,1],[.8,0],[.61,0]),rect(.725,0,.8,1),rect(.015,0,.26,SERIF),rect(.015,1-SERIF,.29,1),rect(.64,1-SERIF,.885,1)]},
  T:{width:.8,pieces:()=>[rect(0,1-HAIR,.8,1),stem(.315),rect(.23,0,.57,SERIF),rect(0,.76,.055,1),rect(.745,.76,.8,1)]},
  I:{width:.34,pieces:()=>[stem(),rect(0,0,.34,SERIF),rect(0,1-SERIF,.34,1)]},
  A:{width:1,pieces:()=>[poly([.42,1],[.58,1],[.92,0],[.74,0]),poly([.42,1],[.49,1],[.145,0],[.075,0]),rect(.2,.27,.76,.345),rect(0,0,.235,SERIF),rect(.66,0,1,SERIF)]},
  L:{width:.72,pieces:()=>[stem(),rect(0,1-SERIF,.34,1),rect(0,0,.72,HAIR),rect(.665,0,.72,.25)]},
};
export const PRUDENTIAL_WORD='PRUDENTIAL';

/** Letter origins along the word, in metres from its left end. */
export function prudentialWordLayout(){
  const h=C.letterHeight;let x=0;
  const letters=[...PRUDENTIAL_WORD].map(char=>{const at=x;x+=(GLYPHS[char].width*WIDE+TRACK)*h;return {char,x:at,width:GLYPHS[char].width*WIDE*h};});
  return {letters,width:x-TRACK*h};
}

/** Extruded word for one face in that face's frame (x right, y up, z out),
 * split into white letter faces and dark returns. */
export function prudentialLettering(){
  const h=C.letterHeight,layout=prudentialWordLayout(),faces:THREE.BufferGeometry[]=[],returns:THREE.BufferGeometry[]=[];
  for(const letter of layout.letters){
    const extruded=new THREE.ExtrudeGeometry(GLYPHS[letter.char].pieces(),{depth:C.letterDepth/h,bevelEnabled:false,curveSegments:10});
    extruded.scale(h*WIDE,h,h).translate(letter.x-layout.width/2,C.letterTop-h,0);
    const [front,sides]=splitByMaterial(extruded);faces.push(front);returns.push(sides);extruded.dispose();
  }
  const merge=(list:THREE.BufferGeometry[])=>{const g=mergeGeometries(list,false)!;list.forEach(x=>x.dispose());return g;};
  return {faces:merge(faces),returns:merge(returns),width:layout.width};
}

/** Copy the listed vertices of a non-indexed geometry, every attribute intact. */
function pickVertices(geometry:THREE.BufferGeometry,indices:number[]){
  const part=new THREE.BufferGeometry();
  for(const [name,a]of Object.entries(geometry.attributes)){
    const values=new Float32Array(indices.length*a.itemSize);
    indices.forEach((index,j)=>{for(let k=0;k<a.itemSize;k++)values[j*a.itemSize+k]=a.getComponent(index,k);});
    part.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize));
  }
  return part;
}

/** Extrusion caps (material 0) and side walls (material 1) as two geometries. */
function splitByMaterial(geometry:THREE.BufferGeometry){
  const lists:number[][]=[[],[]];
  for(const group of geometry.groups)for(let i=group.start;i<group.start+group.count;i++)lists[group.materialIndex??0].push(i);
  return lists.map(indices=>pickVertices(geometry,indices));
}

export const isPrudential=(building?:Building)=>building?.id===PRUDENTIAL_ID;

/** Material-only partition of the source facade: the mechanical penthouse
 * and flues rising above the crown roof take dark ribbed metal instead of
 * office windows. Every source vertex, normal and UV is retained. */
export function splitPrudentialShell(geometry:THREE.BufferGeometry,building:Building){
  const source=geometry.index?geometry.toNonIndexed():geometry,p=source.getAttribute('position');
  const lift=buildingLift(building),cos=Math.cos(T.yaw),sin=Math.sin(T.yaw);
  const lists={facade:[] as number[],penthouse:[] as number[]};
  for(let i=0;i<p.count;i+=3){
    let high=-Infinity,x=0,z=0;
    for(let j=i;j<i+3;j++){high=Math.max(high,p.getY(j));x+=p.getX(j)/3;z+=p.getZ(j)/3;}
    const u=(x-T.x)*cos-(z-T.z)*sin,v=(x-T.x)*sin+(z-T.z)*cos;
    const above=high>C.top-.25+lift&&Math.abs(u)<T.halfX&&Math.abs(v)<T.halfZ;
    lists[above?'penthouse':'facade'].push(i,i+1,i+2);
  }
  const parts=(Object.entries(lists) as ['facade'|'penthouse',number[]][]).filter(([,indices])=>indices.length).map(([kind,indices])=>({kind,geometry:pickVertices(source,indices)}));
  if(source!==geometry)source.dispose();
  return parts;
}

/** Dark corrugated cladding on six-metre facade UVs: 30 cm ribs, 3 m seams. */
export function createPrudentialPenthouseMaterial(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d')!,random=seeded(2207);
  c.fillStyle='#3c4042';c.fillRect(0,0,512,512);
  for(let x=0;x<512;x+=25.6){
    const tone=(random()-.5)*8;c.fillStyle=`rgb(${78+tone},${83+tone},${86+tone})`;c.fillRect(x,0,5,512);
    c.fillStyle='#24282a';c.fillRect(x+18,0,4,512);
  }
  c.fillStyle='#202325';c.fillRect(0,0,512,5);c.fillRect(0,254,512,4);
  return new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),roughness:.62,metalness:.35});
}

/** Solid crown envelope for driving, camera and helicopter queries. The
 * source collision volume is the setback box, so the slab overhangs need it. */
export function prudentialCrownCollider(city:CityData){
  const lift=datumLift(city);if(lift===undefined)return;
  const hx=T.halfX+C.overhang,hz=T.halfZ+C.overhang,y0=C.roof+lift,y1=C.top+.1+lift;
  const local=[0,1,2,3,4,5,6,7].map(i=>new THREE.Vector3(i&1?hx:-hx,i&2?y1:y0,i&4?hz:-hz));
  const world=local.map(p=>p.clone().applyAxisAngle(new THREE.Vector3(0,1,0),T.yaw).add(new THREE.Vector3(T.x,0,T.z)));
  const quads=[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]],indices:number[]=[];
  for(const [a,b,c,d]of quads)for(const tri of [[a,b,c],[a,c,d]]){
    // Wind every triangle outward from the box centre.
    const [p,q,r]=tri.map(i=>local[i]),normal=q.clone().sub(p).cross(r.clone().sub(p)),centroid=p.clone().add(q).add(r).divideScalar(3);
    centroid.y-=(y0+y1)/2;indices.push(...(normal.dot(centroid)>0?tri:[tri[0],tri[2],tri[1]]));
  }
  return {id:`${PRUDENTIAL_ID}:crown`,vertices:new Float32Array(world.flatMap(p=>[p.x,p.y,p.z])),indices:new Uint32Array(indices)};
}

/** Twelve-metre glazing modules for the crown: 1.5 m mullions over the band height. */
function glazingMaterial(kind:'band'|'recess'){
  const band=kind==='band',w=1024,h=band?1024:256,random=seeded(band?6122:4481);
  const map=document.createElement('canvas'),glow=document.createElement('canvas');
  map.width=glow.width=w;map.height=glow.height=h;
  const c=map.getContext('2d')!,g=glow.getContext('2d')!;g.fillStyle='#000';g.fillRect(0,0,w,h);
  const module=w/8,transom=band?Math.round(h*.37):-1,frame=band?'#3a4246':'#101416';
  for(let i=0;i<8;i++){
    const x=i*module;
    for(const [top,bottom]of band?[[0,transom],[transom,h]]:[[0,h]]){
      const tone=(random()-.5)*16;
      const fill=c.createLinearGradient(x,top,x+module*.6,bottom);
      if(band){fill.addColorStop(0,`rgb(${206+tone},${215+tone},${218+tone})`);fill.addColorStop(.55,`rgb(${160+tone},${176+tone},${184+tone})`);fill.addColorStop(1,`rgb(${118+tone},${134+tone},${143+tone})`);}
      else if(random()<.3){fill.addColorStop(0,`rgb(${98+tone},${110+tone},${116+tone})`);fill.addColorStop(1,`rgb(${70+tone},${80+tone},${86+tone})`);}
      else{fill.addColorStop(0,`rgb(${40+tone},${50+tone},${55+tone})`);fill.addColorStop(1,`rgb(${24+tone},${31+tone},${35+tone})`);}
      c.fillStyle=fill;c.fillRect(x,top,module,bottom-top);
      const light=band?.45+random()*.5:random()*.35;
      g.fillStyle=band?`rgba(255,218,166,${light})`:`rgba(214,226,232,${light})`;g.fillRect(x,top,module,bottom-top);
    }
  }
  for(let i=0;i<=8;i++){c.fillStyle=frame;c.fillRect(i*module-4,0,8,h);g.fillStyle='#000';g.fillRect(i*module-4,0,8,h);}
  for(const y of band?[0,transom-5,h-8]:[0,h-6]){c.fillStyle=frame;c.fillRect(0,y,w,band?10:6);g.fillStyle='#000';g.fillRect(0,y,w,band?10:6);}
  return new THREE.MeshStandardMaterial({map:canvasTexture(map,true),emissiveMap:canvasTexture(glow,true),emissive:0xffffff,emissiveIntensity:0,
    roughness:band?.12:.3,metalness:band?.2:.25,envMapIntensity:band?1.4:.9});
}

/** The Prudential Tower crown: a dark recessed floor, two cantilevered cream
 * slabs around a tall glass band, and the PRUDENTIAL wordmark on all four
 * faces. Proportions follow photographs of the 1964 tower; the letterforms
 * are original and the glazing pattern is simplified. */
export function addPrudentialCrown(scene:THREE.Scene,city:CityData){
  const group=new THREE.Group();group.name='Prudential Tower crown';
  const lift=datumLift(city);
  const concrete=new THREE.MeshStandardMaterial({color:'#d4cbb3',roughness:.84});
  const roof=new THREE.MeshStandardMaterial({color:'#6d6e68',roughness:.93});
  const band=glazingMaterial('band'),recess=glazingMaterial('recess');
  const letterFace=new THREE.MeshStandardMaterial({color:'#f3f1e8',roughness:.45,emissive:'#fff6e6',emissiveIntensity:DAY_LETTER_GLOW});
  const letterReturn=new THREE.MeshStandardMaterial({color:'#4a4843',roughness:.6,metalness:.2});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material)=>{const list=batches.get(m)??[];list.push(placeOnTower(g,lift??0));batches.set(m,list);};
  let letters=0;
  if(lift!==undefined){
    const slab=(bottom:number,top:number)=>add(new THREE.BoxGeometry(2*(T.halfX+C.overhang),top-bottom,2*(T.halfZ+C.overhang)).translate(0,(bottom+top)/2,0),concrete);
    slab(C.recessTop,C.slabTop);slab(C.glassTop,C.top);
    // A roof membrane inside a concrete edge; the source penthouse stands on it.
    add(new THREE.BoxGeometry(2*(T.halfX+C.overhang-.7),.1,2*(T.halfZ+C.overhang-.7)).translate(0,C.top+.05,0),roof);
    const lettering=prudentialLettering();
    for(const face of PRUDENTIAL_FACES){
      const wall=(inset:number,bottom:number,top:number,material:THREE.Material)=>{
        const width=2*(face.half-inset),g=new THREE.PlaneGeometry(width,top-bottom),uv=g.getAttribute('uv');
        for(let i=0;i<uv.count;i++)uv.setX(i,uv.getX(i)*width/12);
        add(g.translate(0,(bottom+top)/2,face.distance-inset).rotateY(face.yaw),material);
      };
      wall(C.glassInset,C.slabTop,C.glassTop,band);
      wall(C.recessInset,C.roof,C.recessTop,recess);
      // Slender posts carry the lower slab edge over the recessed floor.
      const posts=Math.round(2*face.half/5.8);
      for(let i=1;i<posts;i++)add(new THREE.BoxGeometry(.16,C.recessTop-C.parapet,.16).translate(-face.half+i*2*face.half/posts,(C.parapet+C.recessTop)/2,face.distance-.12).rotateY(face.yaw),concrete);
      const z=face.distance-C.glassInset+C.letterStandoff;
      add(lettering.faces.clone().translate(0,0,z).rotateY(face.yaw),letterFace);
      add(lettering.returns.clone().translate(0,0,z).rotateY(face.yaw),letterReturn);
      letters+=PRUDENTIAL_WORD.length;
    }
    lettering.faces.dispose();lettering.returns.dispose();
  }
  let triangles=0;
  for(const [material,geometries]of batches){
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(normalized,false);
    if(geometry){
      geometry.computeBoundingSphere();triangles+=geometry.getAttribute('position').count/3;
      const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    }
    new Set([...geometries,...normalized]).forEach(g=>g.dispose());
  }
  group.userData={buildingId:lift===undefined?undefined:PRUDENTIAL_ID,word:PRUDENTIAL_WORD,faces:lift===undefined?0:4,letters,triangles,
    crownTop:lift===undefined?undefined:C.top+lift,provenance:'Original crown and lettering aligned to the surveyed tower shaft'};
  scene.add(group);
  return {group,setNight(night:boolean){
    band.emissiveIntensity=night?.95:0;recess.emissiveIntensity=night?.35:0;letterFace.emissiveIntensity=night?1.1:DAY_LETTER_GLOW;
  }};
}
