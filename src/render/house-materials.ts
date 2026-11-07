import * as THREE from 'three';
import { applyWindowInteriors, windowGrid } from './window-interiors.ts';
import { registerContextTexture } from './context-resources.ts';
import { HOUSE_PALETTES, HOUSE_ROOFS, type HouseRoof } from './house-styles.ts';

const seeded=(seed:number)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
function canvasTexture(source:HTMLCanvasElement,repeat=false){const t=new THREE.CanvasTexture(source);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;if(repeat)t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;}

/** One facade material for every generated northern house: the painted
 * texture is neutral, a class mask marks body clapboard, trim, sash and
 * shutters, and each vertex names its palette (`housePalette`), so twenty
 * paint schemes cost one draw call. Above the eave (gables, a tower's upper
 * stage) the wall map supplies clapboard in the red channel and fish-scale
 * shingles in the green one; the palette picks which. Windows keep the
 * shared interior mapping on a tall 2-over-2 sash grid. */
export const HOUSE_GRID=windowGrid({detail:'clapboard',columns:2,windowWidth:.92,windowHeight:1.72});
const PALETTE_ROWS=5;

function canvas(size=512){const c=document.createElement('canvas');c.width=c.height=size;return {canvas:c,ctx:c.getContext('2d')!};}
function dataTexture(source:HTMLCanvasElement){const t=canvasTexture(source,true);t.colorSpace=THREE.NoColorSpace;return t;}
/** Clapboard luminance at canvas row y: 13 px (about 15 cm) courses with a shadow line under each lap. */
const clapboard=(y:number)=>{const k=y%13;return k===11?.64:k===12?1:.92+.05*k/11;};
/** Fish-scale shingle luminance: rounded butts in half-offset rows, the courses beneath showing between them. */
function fishScale(x:number,y:number){
  const h=13,w=17,row=Math.floor(y/h),fy=(y%h)/h,fx=((x+(row%2)*w/2)%w)/w-.5;
  const edge=1-(.5-Math.sqrt(Math.max(0,.25-fx*fx)))*w/h,d=(fy-edge)*h;
  return Math.abs(d)<.9?.52:d>0?.76:.95-.07*fy;
}

function paintFacade(mobile:boolean){
  const S=512/6,g=HOUSE_GRID,random=seeded(4271);
  const color=canvas(),mask=canvas(),glow=canvas(),relief=canvas(),rough=canvas(),wall=canvas();
  const c=color.ctx,m=mask.ctx,e=glow.ctx,b=relief.ctx,r=rough.ctx;
  // Neutral clapboard body (mask red) and the wall map's two gable finishes.
  const body=c.createImageData(512,512),gable=wall.ctx.createImageData(512,512);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
    const i=(y*512+x)*4,grain=(random()-.5)*.025,v=Math.round(Math.min(1,clapboard(y)+grain)*247);
    body.data[i]=body.data[i+1]=body.data[i+2]=v;body.data[i+3]=255;
    gable.data[i]=v;gable.data[i+1]=Math.round(Math.min(1,fishScale(x,y)+grain)*247);gable.data[i+2]=0;gable.data[i+3]=255;
  }
  c.putImageData(body,0,0);wall.ctx.putImageData(gable,0,0);
  m.fillStyle='#ff0000';m.fillRect(0,0,512,512);
  e.fillStyle='#000';e.fillRect(0,0,512,512);
  b.fillStyle='#808080';b.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=13){b.fillStyle='#848484';b.fillRect(0,y,512,10);b.fillStyle='#7a7a7a';b.fillRect(0,y+11,512,1);}
  r.fillStyle='#f0f0f0';r.fillRect(0,0,512,512);
  const paint=(fill:string,cls:string,x:number,y:number,w:number,h:number)=>{c.fillStyle=fill;c.fillRect(x,y,w,h);m.fillStyle=cls;m.fillRect(x,y,w,h);b.fillStyle='#808080';b.fillRect(x,y,w,h);};
  const BODY='#ff0000',TRIM='#00ff00',SASH='#ffff00',SHUTTER='#0000ff',GLASS='#000000';
  for(let row=0;row<2;row++)for(let col=0;col<g.columns;col++){
    const w=g.width*S,h=g.height*S,x=(g.spacing*(col+.5))*S-w/2,y=(6-g.rows[row])*S-h/2;
    // Louvred shutters (shown only by palettes that carry them).
    const sw=w*.48;
    for(const sx of [x-.13*S-sw,x+w+.13*S]){
      paint('#efefef',SHUTTER,sx,y-2,sw,h+4);
      for(let k=y+5;k<y+h-2;k+=5){c.fillStyle='#bdbdbd';c.fillRect(sx+3,k,sw-6,1.4);}
      c.fillStyle='#d2d2d2';c.fillRect(sx,y-2,sw,3);c.fillRect(sx,y+h+1,sw,3);c.fillRect(sx,y+h/2-1,sw,3);
    }
    // Casings, a hood with its cap and a sill; a shadow on the clapboard under the sill.
    paint('#f6f6f6',TRIM,x-.12*S,y-.02*S,.12*S,h+.04*S);paint('#f6f6f6',TRIM,x+w,y-.02*S,.12*S,h+.04*S);
    paint('#f2f2f2',TRIM,x-.15*S,y-.22*S,w+.3*S,.2*S);paint('#fafafa',TRIM,x-.21*S,y-.3*S,w+.42*S,.08*S);
    c.fillStyle='#b9b9b9';c.fillRect(x-.15*S,y-.22*S,w+.3*S,2);
    paint('#f4f4f4',TRIM,x-.17*S,y+h+.02*S,w+.34*S,.08*S);
    c.fillStyle='#8c8c8c';c.fillRect(x-.17*S,y+h+.1*S,w+.34*S,3);
    // Glass with the reflected sky, curtains and blinds (unmasked colour).
    paint('#1c2424',GLASS,x,y,w,h);
    const sky=c.createLinearGradient(x,y,x+w*.08,y+h);sky.addColorStop(0,'#566f79');sky.addColorStop(.45,'#334b52');sky.addColorStop(1,'#192a30');
    c.fillStyle=sky;c.fillRect(x,y,w,h);
    for(let k=0;k<4;k++){const top=y+h*(.52+random()*.2);c.fillStyle=k%2?'#7b80721f':'#111c2b3d';c.fillRect(x+k*w/4,top,w/4+1,y+h-top);}
    c.fillStyle='#d6e4df16';c.fillRect(x+2,y+5,w-4,h*.11);
    r.fillStyle='#565656';r.fillRect(x,y,w,h);
    e.fillStyle=['#b18d60','#dbc09a','#caad81','#809497'][Math.floor(random()*4)];e.fillRect(x,y,w,h);
    e.fillStyle='#292b27';e.fillRect(x+w*.12,y+h*.78,w*.72,h*.22);
    if(random()>.35){
      const cw=w*(.16+random()*.12);
      for(const xx of [x,x+w-cw]){c.fillStyle='#d8cfb98a';c.fillRect(xx,y,cw,h);e.fillStyle='#7e6c50';e.fillRect(xx,y,cw,h);for(let j=3;j<cw;j+=5){c.fillStyle='#2c302a22';c.fillRect(xx+j,y,1,h);}}
    }
    if(random()>.6){const bh=h*(.15+random()*.35);c.fillStyle='#b3a88f99';c.fillRect(x,y,w,bh);e.fillStyle='#625b47';e.fillRect(x,y,w,bh);}
    // Sash: a frame, the meeting rail and one muntin per sash (2-over-2), tinted by the palette.
    const sash=(sx:number,sy:number,sw2:number,sh:number)=>{paint('#f4f4f4',SASH,sx,sy,sw2,sh);e.fillStyle='#000';e.fillRect(sx,sy,sw2,sh);r.fillStyle='#d0d0d0';r.fillRect(sx,sy,sw2,sh);};
    sash(x,y,w,4);sash(x,y+h-4,w,4);sash(x,y,4,h);sash(x+w-4,y,4,h);sash(x,y+h/2-2.5,w,5);sash(x+w/2-1.5,y,3,h);
  }
  if(mobile)for(const source of [color.canvas,mask.canvas,glow.canvas,relief.canvas,rough.canvas,wall.canvas]){
    const reduced=canvas(256);reduced.ctx.drawImage(source,0,0,256,256);source.width=source.height=256;source.getContext('2d')!.drawImage(reduced.canvas,0,0);
  }
  return {color:color.canvas,mask:mask.canvas,glow:glow.canvas,relief:relief.canvas,rough:rough.canvas,wall:wall.canvas};
}

function paletteTexture(){
  // Rows: body (alpha: shutters), trim, sash, gable accent (alpha: fish-scale shingles), shutter; the sRGB bytes the palette names.
  const n=HOUSE_PALETTES.length,data=new Uint8Array(n*PALETTE_ROWS*4);
  HOUSE_PALETTES.forEach((p,i)=>{
    const rows:[string,number][]=[[p.body,p.shutter?255:0],[p.trim,255],[p.sash,255],[p.accent,p.scales?255:0],[p.shutter??p.body,255]];
    rows.forEach(([hex,flag],row)=>{const v=parseInt(hex.slice(1),16),k=(row*n+i)*4;data[k]=v>>16&255;data[k+1]=v>>8&255;data[k+2]=v&255;data[k+3]=flag;});
  });
  const texture=new THREE.DataTexture(data,n,PALETTE_ROWS,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  return texture;
}

const GLSL_PARS=/* glsl */`
uniform sampler2D houseMask;
uniform sampler2D housePaletteMap;
uniform float housePaletteSize;
varying float vHousePalette;
vec4 housePaint(float row){return texture2D(housePaletteMap,vec2((vHousePalette+0.5)/housePaletteSize,(row+0.5)/${PALETTE_ROWS}.0));}
vec3 houseGable(vec3 w){vec4 accent=housePaint(3.0);return mix(w.r*housePaint(0.0).rgb,w.g*accent.rgb,accent.a);}
// Coursed fieldstone footing: two rough courses with recessed joints.
vec3 houseFooting(vec2 t){
  float course=floor(t.y/0.28);vec2 q=vec2(t.x/0.62+fract(course*0.5)*1.0,t.y/0.28);vec2 id=floor(q),f=fract(q);
  float joint=smoothstep(0.02,0.07,f.x)*smoothstep(0.98,0.93,f.x)*smoothstep(0.03,0.1,f.y)*smoothstep(0.97,0.9,f.y);
  float h=interiorHash(id+vec2(11.3,4.7));
  vec3 stone=mix(vec3(0.27,0.26,0.24),vec3(0.43,0.41,0.37),h)*mix(0.86,1.0,interiorHash(id*1.7));
  return mix(vec3(0.15,0.145,0.13),stone,joint);
}
`;
const GLSL_TINT=/* glsl */`
#include <color_fragment>
{
  vec4 classes=texture2D(houseMask,vMapUv);
  float sashW=min(classes.r,classes.g),bodyW=max(classes.r-sashW,0.0),trimW=max(classes.g-sashW,0.0);
  vec4 body=housePaint(0.0);
  vec3 lum=diffuseColor.rgb,clap=texture2D(interiorWallMap,vMapUv).rgb;
  vec3 paint=mix(lum,lum*body.rgb,bodyW);
  paint=mix(paint,lum*housePaint(1.0).rgb,trimW);
  paint=mix(paint,lum*housePaint(2.0).rgb,sashW);
  paint=mix(paint,mix(clap.r*body.rgb,lum*housePaint(4.0).rgb,body.a),classes.b);
  diffuseColor.rgb=paint;
}
`;

export interface HouseMaterials { facade:THREE.MeshStandardMaterial; roofs:THREE.MeshStandardMaterial[]; trim:THREE.MeshStandardMaterial; }
export function createHouseMaterials(mobile=false):HouseMaterials {
  const p=paintFacade(mobile),mask=dataTexture(p.mask),palette=paletteTexture(),wall=canvasTexture(p.wall,true);
  const relief=dataTexture(p.relief),rough=dataTexture(p.rough);
  const facade=new THREE.MeshStandardMaterial({map:canvasTexture(p.color,true),bumpMap:relief,bumpScale:.006,roughnessMap:rough,roughness:.92,metalness:0,envMapIntensity:1.4,emissiveMap:canvasTexture(p.glow,true),emissive:0xffffff,emissiveIntensity:.008});
  facade.name='house-clapboard';
  applyWindowInteriors(facade,HOUSE_GRID,4271,.82,wall);
  const interiors=facade.onBeforeCompile;
  facade.onBeforeCompile=(shader,renderer)=>{
    interiors.call(facade,shader,renderer);
    Object.assign(shader.uniforms,{houseMask:{value:mask},housePaletteMap:{value:palette},housePaletteSize:{value:HOUSE_PALETTES.length}});
    shader.vertexShader=shader.vertexShader.replace('attribute float facadeTop;','attribute float facadeTop;\nattribute float housePalette;\nvarying float vHousePalette;').replace('vFacadeTop=facadeTop;','vFacadeTop=facadeTop;\nvHousePalette=housePalette;');
    const hash='float interiorHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}';
    shader.fragmentShader=shader.fragmentShader.replace(hash,hash+'\n'+GLSL_PARS).replace('#include <color_fragment>',GLSL_TINT)
      .replace('diffuseColor.rgb=texture2D(interiorWallMap,vMapUv).rgb;','diffuseColor.rgb=houseGable(texture2D(interiorWallMap,vMapUv).rgb);')
      .replace('vec3 footing=vec3(0.223,0.202,0.153)*','vec3 footing=houseFooting(tile)*');
  };
  facade.customProgramCacheKey=()=>'boston-house-paint-1';
  for(const texture of [mask,palette])registerContextTexture(facade,texture);
  const roofs=HOUSE_ROOFS.map((roof,i)=>roofMaterial(roof,577+i*131,mobile));
  const trim=new THREE.MeshStandardMaterial({color:'#e8e3d4',roughness:.82,metalness:0});trim.name='house-trim';
  return {facade,roofs,trim};
}

/** Asphalt architectural shingles (14 cm courses, tabs of mixed width and tone) or
 * slate (18 cm courses of 30 cm slates, some banded in fish-scale rows), at the
 * six-metre repeat of the slope-aligned house roof UVs: courses run along the eaves. */
function roofMaterial(roof:HouseRoof,seed:number,mobile:boolean){
  const {canvas:map,ctx:c}=canvas(),{canvas:bump,ctx:b}=canvas(),random=seeded(seed),base=new THREE.Color(roof.base);
  const tone=(spread:number,tint?:THREE.Color)=>{const k=1+(random()-.5)*spread;const col=(tint??base).clone().multiplyScalar(k);return `#${col.getHexString()}`;};
  c.fillStyle=roof.base;c.fillRect(0,0,512,512);b.fillStyle='#808080';b.fillRect(0,0,512,512);
  if(roof.kind==='shingle'){
    for(let y=0;y<512;y+=12)for(let x=-random()*30;x<512;){
      const w=18+random()*24;c.fillStyle=tone(.34);c.fillRect(x,y,w-1,12);
      const v=128+Math.floor(random()*14);b.fillStyle=`rgb(${v},${v},${v})`;b.fillRect(x,y,w-1,12);
      c.fillStyle='#14161870';c.fillRect(x+w-1,y,1,12);x+=w;
    }
    for(let y=0;y<512;y+=12){c.fillStyle='#0d0f1166';c.fillRect(0,y+10,512,2);b.fillStyle='#5c5c5c';b.fillRect(0,y+10,512,2);}
    for(let i=0;i<34000;i++){c.fillStyle=random()>.5?'#e8e2d012':'#0a0c0e14';c.fillRect(random()*512,random()*512,1,1);}
  }else{
    const purple=new THREE.Color('#5a4c63'),green=new THREE.Color('#4c5a4e'),red=new THREE.Color('#7a4036'),rows=Math.round(512/15);
    for(let row=0;row<rows;row++){
      const y=row*512/rows,h=512/rows,banded=roof.kind==='patterned-slate'&&(row%17>=6&&row%17<10),band=row%34<17?red:purple;
      for(let x=-(row%2)*13;x<512;x+=26){
        const tint=banded?band:random()>.85?purple:random()>.9?green:undefined;
        c.fillStyle=tone(.2,tint);
        if(banded){c.beginPath();c.moveTo(x+.5,y);c.lineTo(x+25.5,y);c.lineTo(x+25.5,y+h*.45);c.arc(x+13,y+h*.45,12.5,0,Math.PI);c.closePath();c.fill();}
        else c.fillRect(x+.5,y,25,h-1);
        b.fillStyle='#8a8a8a';b.fillRect(x+1,y,24,h-2);
        c.fillStyle='#1a1c2088';c.fillRect(x,y,1,h);
      }
      c.fillStyle='#0c0d1070';c.fillRect(0,y+h-1.5,512,1.5);b.fillStyle='#606060';b.fillRect(0,y+h-1.5,512,1.5);
    }
    for(let i=0;i<14000;i++){c.fillStyle=random()>.5?'#dfe3ea0d':'#05060812';c.fillRect(random()*512,random()*512,1,1);}
  }
  if(mobile)for(const source of [map,bump]){const reduced=canvas(256);reduced.ctx.drawImage(source,0,0,256,256);source.width=source.height=256;source.getContext('2d')!.drawImage(reduced.canvas,0,0);}
  const material=new THREE.MeshStandardMaterial({map:canvasTexture(map,true),bumpMap:dataTexture(bump),bumpScale:.004,roughness:roof.kind==='shingle'?.93:.72,metalness:0});
  material.name=`house-roof-${roof.id}`;return material;
}
