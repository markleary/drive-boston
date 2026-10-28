import * as THREE from 'three';
import type { Building, LightingMode } from '../types';
import { architectureFor } from './neighborhood-profiles.ts';
import { applyWindowInteriors, interiorLighting, setInteriorLighting, windowGrid } from './window-interiors.ts';
import { isReligiousBuilding } from '../simulation/building-identities.ts';

export interface FacadeStyle {
  id:string; base:string; kind:'brick'|'stone'|'panel'|'wood'; detail:'brick'|'arched'|'brownstone'|'classical'|'terracotta'|'loft'|'office'|'modern'|'gothic'|'clapboard';
  columns:number; windowWidth:number; windowHeight:number; trim:string; frame:string;
}
/** Interpreted material families: semantic identity first, then massing as a
 * fallback, not an address-specific facade survey. Every grid is six metres wide/high. */
export const FACADE_STYLES:FacadeStyle[]=[
  {id:'red-brick-sash',base:'#785044',kind:'brick',detail:'brick',columns:3,windowWidth:1.08,windowHeight:1.86,trim:'#b5a58b',frame:'#b8b4a4'},
  {id:'burgundy-arched-brick',base:'#65453f',kind:'brick',detail:'arched',columns:3,windowWidth:1.14,windowHeight:2.05,trim:'#a38166',frame:'#575447'},
  {id:'warm-brownstone',base:'#8a6d56',kind:'stone',detail:'brownstone',columns:2,windowWidth:1.30,windowHeight:2.12,trim:'#a88c6a',frame:'#303b35'},
  {id:'buff-limestone',base:'#b2a894',kind:'stone',detail:'classical',columns:3,windowWidth:1.30,windowHeight:1.98,trim:'#d0c5ad',frame:'#6b7168'},
  {id:'gray-granite',base:'#92928a',kind:'stone',detail:'classical',columns:3,windowWidth:1.28,windowHeight:1.82,trim:'#bebdb1',frame:'#414d4c'},
  {id:'cream-terracotta',base:'#b8a184',kind:'stone',detail:'terracotta',columns:3,windowWidth:1.20,windowHeight:2.04,trim:'#d3bea0',frame:'#4e635b'},
  {id:'brick-loft',base:'#8b634f',kind:'brick',detail:'loft',columns:2,windowWidth:2.22,windowHeight:2.10,trim:'#9b8b72',frame:'#394745'},
  {id:'masonry-office',base:'#9a9283',kind:'stone',detail:'office',columns:3,windowWidth:1.58,windowHeight:1.66,trim:'#b9b2a0',frame:'#3c464a'},
  {id:'concrete-ribbon-office',base:'#9b9f97',kind:'panel',detail:'office',columns:2,windowWidth:2.48,windowHeight:1.75,trim:'#b5bab2',frame:'#37484d'},
  {id:'bronze-and-glass-panels',base:'#4f5a5b',kind:'panel',detail:'modern',columns:3,windowWidth:1.86,windowHeight:2.48,trim:'#8c938a',frame:'#8a918b'},
  {id:'church-stone-lancets',base:'#89745f',kind:'stone',detail:'gothic',columns:2,windowWidth:1.16,windowHeight:2.34,trim:'#c1ad89',frame:'#474c45'},
  ...['#a8b5a2','#b5b5ad','#9baeb5','#d2c5aa','#afaaa5'].map((base,i)=>({id:`triple-decker-clapboard-${i}`,base,kind:'wood' as const,detail:'clapboard' as const,columns:2,windowWidth:1.24,windowHeight:1.86,trim:'#e1dfd1',frame:'#e1e3d8'})),
];
export function facadeStyleIndex(building?:Building):number {
  if(!building)return 0;
  // Reviewed identities, use tags and names take precedence over height.
  // Landmark Trinity is separately assigned its authored masonry.
  if(isReligiousBuilding(building))return 10;
  const profile=architectureFor(building);if(profile)return 11+profile.palette;
  const p=building.footprint,area=Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
  const n=hash(building.id);
  if(building.height>65)return [7,8,9][n%3];
  if(building.height>36)return [3,4,7,8,7][n%5];
  if(area>1500)return [0,3,4,5,6,7][n%6];
  if(building.height<12)return [0,1,2,6][n%4];
  return [0,0,1,2,3,5][n%6];
}
export const facadeStyleFor=(building:Building)=>FACADE_STYLES[facadeStyleIndex(building)];

/** Re-project each coherent wall orientation from a local building origin.
 * The source GLB used each triangle's normal with absolute district coordinates;
 * survey noise then changed UV phase between adjacent triangles. This changes
 * only UVs, preserving every measured position and normal. */
export function stabilizeFacadeUVs(geometry:THREE.BufferGeometry,building?:Building){
  const p=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  if(!p||!uv||geometry.index)throw new Error('Facade UV stabilization requires non-indexed positions and UVs');
  const triangles:{i:number;nx:number;nz:number;area:number}[]=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  for(let i=0;i<p.count;i+=3){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    normal.crossVectors(b.sub(a),c.sub(a));const area=normal.length(),h=Math.hypot(normal.x,normal.z);
    if(h<1e-8||Math.abs(normal.y)/area>.72)continue;
    triangles.push({i,nx:normal.x/h,nz:normal.z/h,area});
  }
  // Largest faces establish the stable direction. Small survey facets within
  // five degrees share that projection (under .4% scale error); actual bay
  // returns and perpendicular walls retain their own mapping direction.
  triangles.sort((a,b)=>b.area-a.area);
  const orientations:{nx:number;nz:number}[]=[],cosTolerance=Math.cos(Math.PI/36);
  const origin=building?.center??[0,0];
  for(const t of triangles){
    let orientation=orientations.find(n=>n.nx*t.nx+n.nz*t.nz>cosTolerance);
    if(!orientation){orientation={nx:t.nx,nz:t.nz};orientations.push(orientation);}
    for(let j=0;j<3;j++){
      const i=t.i+j;
      const profile=architectureFor(building);
      uv.setXY(i,((p.getX(i)-origin[0])*orientation.nz-(p.getZ(i)-origin[1])*orientation.nx)/6,(p.getY(i)-(building?.baseElevation??0)-(profile?.raisedBase??0))/(profile?profile.floorHeight*2:6));
    }
  }
  uv.needsUpdate=true;geometry.userData.facadeUV={orientations:orientations.length,triangles:triangles.length,origin};
  return geometry;
}

export function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}
export function hash(text: string) { let n = 0; for (const c of text) n = Math.imul(n, 31) + c.charCodeAt(0) | 0; return Math.abs(n); }

export function canvasTexture(canvas: HTMLCanvasElement, repeat = false) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function makeCanvas(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function reliefTexture(canvas: HTMLCanvasElement) {
  const texture = canvasTexture(canvas, true);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function landmarkMasonry(base:string,seed:number,course:number){
  const {canvas,ctx:c}=makeCanvas(),{canvas:relief,ctx:b}=makeCanvas(),random=seeded(seed);
  c.fillStyle=base;c.fillRect(0,0,512,512);b.fillStyle='#808080';b.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=course){
    const block=96,offset=(Math.floor(y/course)%2)*48;
    for(let col=-1;col<6;col++){
      const x=col*block+offset,v=126+Math.floor(random()*5);
      c.fillStyle=random()>.5?'#e8dac021':'#2d27201c';c.fillRect(x+1,y+1,block-1,course-1);
      c.fillStyle='#39362f39';c.fillRect(x,y,block,1);c.fillRect(x,y,1,course);
      c.fillStyle='#e9dabc20';c.fillRect(x+1,y+1,block-2,1);
      b.fillStyle=`rgb(${v},${v},${v})`;b.fillRect(x+1,y+1,block-1,course-1);
      b.fillStyle='#797979';b.fillRect(x,y,block,.8);b.fillRect(x,y,.8,course);
    }
  }
  for(let i=0;i<12000;i++){
    c.fillStyle=random()>.5?'#e9dcc414':'#2a251d10';c.fillRect(random()*512,random()*512,1,1);
  }
  return new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),bumpMap:reliefTexture(relief),bumpScale:.006,roughness:.92,metalness:0});
}

function architecturalFacade(style:FacadeStyle,seed:number){
  const {canvas,ctx:c}=makeCanvas(),{canvas:glow,ctx:e}=makeCanvas(),{canvas:relief,ctx:b}=makeCanvas(),{canvas:rough,ctx:r}=makeCanvas();
  const random=seeded(seed),S=512/6,grid=windowGrid(style),spacing=grid.spacing;
  c.fillStyle=style.base;c.fillRect(0,0,512,512);
  e.fillStyle='#000';e.fillRect(0,0,512,512);
  b.fillStyle='#808080';b.fillRect(0,0,512,512);
  r.fillStyle='#f4f4f4';r.fillRect(0,0,512,512);
  if(style.kind==='wood'){
    // Narrow overlapping clapboards: continuous horizontal courses, without
    // masonry's vertical mortar joints or broad waviness in the relief map.
    for(let y=0;y<512;y+=13){
      c.fillStyle='#e9e6d818';c.fillRect(0,y,512,10);
      c.fillStyle='#293d3938';c.fillRect(0,y+11,512,1);
      c.fillStyle='#f2efde3b';c.fillRect(0,y+12,512,1);
      b.fillStyle='#838383';b.fillRect(0,y,512,10);b.fillStyle='#7c7c7c';b.fillRect(0,y+11,512,1);
    }
  }else if(style.kind!=='panel'){
    const course=style.kind==='brick'?8:style.detail==='gothic'?16:style.detail==='brownstone'?24:32;
    const block=style.kind==='brick'?512/24:style.detail==='terracotta'?64:96;
    for(let y=0;y<512;y+=course)for(let col=-1;col<Math.ceil(512/block);col++){
      const x=col*block+(Math.floor(y/course)%2)*block/2,v=Math.floor(126+random()*5);
      c.fillStyle=random()>.5?`rgba(235,221,197,${.025+random()*.075})`:`rgba(29,26,23,${.025+random()*.09})`;
      c.fillRect(x+1,y+1,block-1,course-1);
      c.fillStyle=style.kind==='brick'?'#d2c2a536':'#463f3730';c.fillRect(x,y,block,.75);c.fillRect(x,y,.65,course);
      b.fillStyle=`rgb(${v},${v},${v})`;b.fillRect(x+1,y+1,block-1,course-1);
      b.fillStyle='#797979';b.fillRect(x,y,block,.7);b.fillRect(x,y,.7,course);
    }
  }else{
    for(let row=0;row<2;row++){
      const y=row*256;c.fillStyle=style.detail==='modern'?'#303d42':'#737d7977';c.fillRect(0,y+219,512,35);
      c.fillStyle='#d6d9cf66';c.fillRect(0,y+252,512,3);c.fillStyle='#202c3044';c.fillRect(0,y+255,512,1);
    }
  }
  // A few low-contrast stone/brick grains; no broad height-map clouds that
  // would make an otherwise planar wall look inflated in reflected light.
  for(let i=0;i<10000;i++){
    c.fillStyle=random()>.5?'#ede6d00c':'#201e1a0d';c.fillRect(random()*512,random()*512,1,1);
  }
  if(style.detail==='office'||style.detail==='terracotta')for(let row=0;row<2;row++){
    const y=row*256+231;
    c.fillStyle=style.detail==='office'?'#565e5b':'#978068';c.fillRect(0,y,512,9);
    c.fillStyle='#e0d5bd66';c.fillRect(0,y+9,512,3);
  }
  if(style.detail==='gothic')for(let row=0;row<2;row++){
    c.fillStyle='#c5af8b50';c.fillRect(0,row*256+242,512,9);
    c.fillStyle='#483f3433';c.fillRect(0,row*256+251,512,2);
  }
  if(style.detail==='terracotta')for(let col=0;col<style.columns;col++){
    const x=(col*spacing+.05)*S;c.fillStyle='#d9c2a06b';c.fillRect(x,0,9,512);c.fillStyle='#76614b55';c.fillRect(x+9,0,3,512);
  }
  for(let row=0;row<2;row++)for(let col=0;col<style.columns;col++){
    // The interior-mapping shader derives every opening from the same grid.
    const w=grid.width*S,h=grid.height*S,x=(spacing*(col+.5))*S-w/2,y=(6-grid.rows[row])*S-h/2;
    const arched=grid.head===1,pointed=grid.head===2,head=pointed?w*.82:arched?w/2:0;
    const opening=(ctx:CanvasRenderingContext2D)=>{
      ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w,y+head);
      if(pointed){ctx.quadraticCurveTo(x+w,y+head*.35,x+w/2,y);ctx.quadraticCurveTo(x,y+head*.35,x,y+head);}
      else if(arched)ctx.arc(x+w/2,y+head,w/2,0,Math.PI,true);else ctx.lineTo(x+w,y);
      ctx.lineTo(x,y+head);ctx.closePath();
    };
    // Masonry depth is real geometry. The relief map stays flat across panes
    // and surrounds so glossy windows retain a stable, planar reflection.
    b.fillStyle='#808080';b.fillRect(x-13,y-15,w+26,h+30);
    c.fillStyle='#1c2424';
    if(arched||pointed){opening(c);c.fill();}else c.fillRect(x-4,y-4,w+8,h+9);
    if(style.detail!=='modern'&&!arched&&!pointed){
      c.fillStyle=style.trim;c.fillRect(x-7,y-9,w+14,6);c.fillRect(x-8,y+h+3,w+16,7);
      c.fillStyle='#201f1c55';c.fillRect(x-7,y+h+10,w+14,3);
    }
    for(const ctx of [c,e,r]){ctx.save();opening(ctx);ctx.clip();}
    const sky=c.createLinearGradient(x,y,x+w*.08,y+h);
    const modern=style.detail==='modern'||style.detail==='office';
    sky.addColorStop(0,modern?'#617c87':'#566f79');sky.addColorStop(.45,modern?'#344d59':'#334b52');sky.addColorStop(1,'#192a30');
    c.fillStyle=sky;c.fillRect(x,y,w,h);
    // Subdued reflected skyline, with straight pane geometry and varied interiors.
    for(let k=0;k<4;k++){
      const top=y+h*(.52+random()*.2);c.fillStyle=k%2?'#7b80721f':'#111c2b3d';c.fillRect(x+k*w/4,top,w/4+1,y+h-top);
    }
    c.fillStyle='#d6e4df16';c.fillRect(x+2,y+5,w-4,h*.11);
    r.fillStyle=modern?'#414141':'#565656';r.fillRect(x,y,w,h);
    // Every opening carries its glow; the shader switches rooms on per window
    // so the lit share does not repeat with the six-metre tile.
    e.fillStyle=['#b18d60','#dbc09a','#caad81','#809497'][Math.floor(random()*4)];e.fillRect(x,y,w,h);
    e.fillStyle='#292b27';e.fillRect(x+w*.12,y+h*.78,w*.72,h*.22);
    if(!modern&&style.detail!=='loft'&&random()>.4){
      const cw=w*(.15+random()*.12);
      for(const xx of [x,x+w-cw]){
        c.fillStyle='#d1c7b073';c.fillRect(xx,y,cw,h);
        e.fillStyle='#7e6c50';e.fillRect(xx,y,cw,h);
        for(let j=3;j<cw;j+=5){c.fillStyle='#2c302a22';c.fillRect(xx+j,y,1,h);}
      }
    }
    if(random()>.66){
      const bh=h*(.15+random()*.39);c.fillStyle=modern?'#989c9088':'#a49b8488';c.fillRect(x,y,w,bh);
      e.fillStyle='#625b47';e.fillRect(x,y,w,bh);
    }
    const [gx,gy]=grid.bars;
    c.strokeStyle=style.frame;c.lineWidth=style.detail==='modern'?2.3:3.5;opening(c);c.stroke();
    c.fillStyle=style.frame;e.fillStyle='#000';r.fillStyle='#d0d0d0';
    for(let i=1;i<gx;i++)for(const ctx of [c,e,r])ctx.fillRect(x+i*w/gx-1.5,y,3,h);
    for(let i=1;i<gy;i++)for(const ctx of [c,e,r])ctx.fillRect(x,y+i*h/gy-1.5,w,3);
    for(const ctx of [c,e,r])ctx.restore();
    if(arched||pointed){c.strokeStyle=style.trim;c.lineWidth=8;opening(c);c.stroke();}
  }
  const material=new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),bumpMap:reliefTexture(relief),bumpScale:style.kind==='panel'?0:.006,roughnessMap:reliefTexture(rough),roughness:.94,metalness:0,envMapIntensity:1.5,emissiveMap:canvasTexture(glow,true),emissive:0xffffff,emissiveIntensity:.008});
  material.name=style.id;material.userData.facadeStyle=style;
  // Rooms behind the glass up close; the painted glazing and night glow remain
  // the filtered far-distance look.
  return applyWindowInteriors(material,grid,seed,style.kind==='panel'?.55:.8);
}

function curtainWall(){
  const {canvas,ctx}=makeCanvas();const sky=ctx.createLinearGradient(0,0,100,512);
  sky.addColorStop(0,'#638595');sky.addColorStop(.45,'#466879');sky.addColorStop(1,'#253e51');ctx.fillStyle=sky;ctx.fillRect(0,0,512,512);
  ctx.fillStyle='#98afba';ctx.fillRect(0,0,2,512);ctx.fillRect(0,0,512,2);
  ctx.fillStyle='#1e3445';ctx.fillRect(510,0,2,512);ctx.fillRect(0,510,512,2);
  const map=canvasTexture(canvas,true);map.repeat.set(6/3.1,6/4.05);
  return new THREE.MeshPhysicalMaterial({map,roughness:.16,metalness:.55,clearcoat:1,clearcoatRoughness:.08,envMapIntensity:2.4});
}

function paving() {
  const { canvas, ctx } = makeCanvas();
  const random = seeded(311);
  ctx.fillStyle = '#918f83'; ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) {
    const v = Math.floor(151 + random() * 15);
    ctx.fillStyle = `rgb(${v + 5},${v + 3},${v - 5})`;
    ctx.fillRect(x + 1, y + 1, 126, 126);
    ctx.fillStyle = '#e7dfc430'; ctx.fillRect(x + 2, y + 2, 124, 1);
    ctx.fillStyle = '#4f50452b'; ctx.fillRect(x + 126, y + 2, 1, 124);
  }
  for (let i = 0; i < 18000; i++) {
    ctx.fillStyle = random() > .5 ? '#f2e9ce13' : '#333a3012';
    ctx.fillRect(random() * 512, random() * 512, 1 + random(), 1);
  }
  const map = canvasTexture(canvas, true);
  // The sidewalk underlay has normalized UVs across the 827 by 670 m district.
  map.repeat.set(207, 168);
  return new THREE.MeshStandardMaterial({ map, roughness: .98 });
}

function roofFinish(){
  const {canvas,ctx:c}=makeCanvas(),{canvas:relief,ctx:b}=makeCanvas(),random=seeded(861);
  c.fillStyle='#62635d';c.fillRect(0,0,512,512);b.fillStyle='#808080';b.fillRect(0,0,512,512);
  // Fine gravel over weathered bituminous courses. Source roof UVs are already
  // six metres per repeat, so this does not alter measured roof shape or scale.
  for(let row=0;row<4;row++){
    c.fillStyle=row%2?'#343b3804':'#dbd4b404';c.fillRect(0,row*128,512,128);
    c.fillStyle='#29332e0a';c.fillRect(0,row*128,512,1);
  }
  for(let i=0;i<24000;i++){
    const x=random()*512,y=random()*512,v=95+Math.floor(random()*50),size=random()>.93?2:1;
    c.fillStyle=`rgba(${v+5},${v+5},${v},.24)`;c.fillRect(x,y,size,size);
    b.fillStyle=random()>.5?'#858585':'#7b7b7b';b.fillRect(x,y,size,size);
  }
  return new THREE.MeshStandardMaterial({map:canvasTexture(canvas,true),roughness:.96,bumpMap:reliefTexture(relief),bumpScale:.003});
}

export function createMaterials() {
  const facades = FACADE_STYLES.map((style,i)=>architecturalFacade(style,139+i*73));
  const glass = curtainWall();
  const library = landmarkMasonry('#a99b83',25,32);
  const church = landmarkMasonry('#907258',22,24);
  const roof = roofFinish();
  const { canvas: asphaltCanvas, ctx } = makeCanvas();
  const rand = seeded(17);
  ctx.fillStyle = '#414749'; ctx.fillRect(0, 0, 512, 512);
  // Fine aggregate and faded repairs stay quiet at driving speed.
  for (let i = 0; i < 36; i++) {
    const x = rand() * 512, y = rand() * 512, radius = 30 + rand() * 90;
    const stain = ctx.createRadialGradient(x, y, 0, x, y, radius);
    stain.addColorStop(0, rand() > .5 ? '#c2bca40b' : '#10171917');
    stain.addColorStop(1, '#333a3b00');
    ctx.fillStyle = stain; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < 48000; i++) {
    ctx.fillStyle = rand() > .54 ? '#cac9b718' : '#0b13181e';
    ctx.fillRect(rand() * 512, rand() * 512, rand() > .96 ? 2 : 1, 1);
  }
  ctx.strokeStyle = '#222b2d45'; ctx.lineWidth = .65;
  for (let i = 0; i < 4; i++) {
    let x = rand() * 512, y = rand() * 512;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) { x += (rand() - .45) * 24; y += 7 + rand() * 14; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const asphalt = new THREE.MeshStandardMaterial({ map: canvasTexture(asphaltCanvas, true), roughness: .97 });
  const sidewalk = paving();
  const curb = new THREE.MeshStandardMaterial({ color: '#a9a89b', roughness: .94 });
  const paint = new THREE.MeshStandardMaterial({ color: '#dbd7c4', roughness: .94 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#c6a850', roughness: .94 });
  return { facades, glass, library, church, roof, asphalt, sidewalk, curb, paint, yellow,
    setLighting(mode: LightingMode) { setInteriorLighting(mode); for (const m of facades) m.emissiveIntensity = mode === 'night' ? .78 : .008; },
    interiors() { const v = interiorLighting.value; return { styles: facades.filter(m => m.userData.windowInteriors).length, glow: v.x, litFraction: v.y, daylight: v.z }; },
  };
}

export function textSign(text: string, color = '#e9e1ca', background = '#254539', width = 512, height = 96) {
  const c = document.createElement('canvas'); c.width=width;c.height=height;
  const ctx=c.getContext('2d')!;ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
  ctx.strokeStyle=color;ctx.lineWidth=3;ctx.strokeRect(5,5,width-10,height-10);
  ctx.fillStyle=color;ctx.font=`600 ${Math.min(43, width/text.length*1.5)}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,width/2,height/2,width-24);
  return new THREE.MeshStandardMaterial({map:canvasTexture(c),roughness:.85,side:THREE.DoubleSide});
}
