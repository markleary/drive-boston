import * as THREE from 'three';
import type { LightingMode } from '../types';

/** Window grid of one six-unit facade tile, shared by the canvas painter and the
 * interior-mapping shader so both agree on every opening to the pixel. Units are
 * canvas tile units: six per tile horizontally (always six metres) and six per
 * tile vertically (six metres, or two floors of a neighborhood profile). Row
 * zero sits at the building base, or at a profile's raised ground floor; the
 * wall below it is exposed foundation and gets no glazing. */
export interface WindowGrid {
  columns:number; spacing:number; width:number; height:number;
  /** Window-center heights of the two rows above the tile base. */
  rows:[number,number];
  /** 0 flat lintel, 1 semicircular arch, 2 pointed lancet. */
  head:0|1|2;
  /** Vertical and horizontal mullion counts inside the opening (1 means none). */
  bars:[number,number];
}
export interface WindowGridStyle { detail:string; columns:number; windowWidth:number; windowHeight:number; }
export function windowGrid(style:WindowGridStyle):WindowGrid {
  const pointed=style.detail==='gothic',arched=style.detail==='arched';
  const gx=style.detail==='loft'?3:style.detail==='office'?2:style.detail==='modern'?1:2;
  const gy=style.detail==='loft'?3:style.detail==='modern'||pointed?1:2;
  return {columns:style.columns,spacing:6/style.columns,width:style.windowWidth,height:style.windowHeight,rows:[1.56,4.56],head:pointed?2:arched?1:0,bars:[gx,gy]};
}
/** Analytic glazing test for a point in tile units; mirrors the shader's
 * opening and mullion tests so node tests can check it against the painter. */
export function insideWindow(grid:WindowGrid,u:number,v:number):boolean {
  if(v<0)return false;
  const cu=((u%6)+6)%6,cv=((v%6)+6)%6;
  const col=Math.floor(cu/grid.spacing),du=cu-grid.spacing*(col+.5);
  const row=cv<3?0:1,dv=cv-grid.rows[row];
  const w=grid.width,h=grid.height;
  if(Math.abs(du)>w/2||Math.abs(dv)>h/2)return false;
  const fromTop=h/2-dv,dx=Math.abs(du);
  if(grid.head===1){const head=w/2;if(fromTop<head&&dx>Math.sqrt(Math.max(0,head*head-(head-fromTop)*(head-fromTop))))return false;}
  if(grid.head===2){const head=w*.82,t=Math.sqrt(Math.max(0,1-2*dx/w));if(fromTop<head*(1-t)*(1-.3*t))return false;}
  const wx=(du+w/2)/w,wy=(dv+h/2)/h;
  const barX=Math.abs(((wx*grid.bars[0]+.5)%1)-.5)*w/grid.bars[0],barY=Math.abs(((wy*grid.bars[1]+.5)%1)-.5)*h/grid.bars[1];
  return barX>.0175&&barY>.0175;
}

/** Live interior lighting shared by every facade material. x: emitted glow of
 * lit rooms, y: fraction of rooms with their lights on, z: daylight reaching
 * unlit rooms. Golden hour already shows some early lamps. */
export const interiorLighting={value:new THREE.Vector3(.32,.3,.72)};
export function setInteriorLighting(mode:LightingMode){
  if(mode==='night')interiorLighting.value.set(.8,.44,.12);
  else if(mode==='day')interiorLighting.value.set(.05,.12,1);
  else interiorLighting.value.set(.32,.3,.72);
}

const GLSL_PARS=/* glsl */`
uniform vec4 interiorGrid; // spacing, window width, window height, head shape
uniform vec4 interiorRooms; // seed, minimum room bays, maximum room bays, warmth
uniform vec2 interiorBars; // mullion counts across and up
uniform vec3 interiorLighting;
varying vec3 vInteriorWorld;
float interiorHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
`;

const GLSL_VERTEX=/* glsl */`
#include <project_vertex>
vInteriorWorld=(modelMatrix*vec4(transformed,1.0)).xyz;
`;

/** Parallax room behind each painted opening. Coordinates are tile units: the
 * horizontal axis follows the stabilized facade UV (six metres per tile), the
 * vertical axis is world height over the building base. */
const GLSL_FRAGMENT=/* glsl */`
#include <emissivemap_fragment>
{
  float spacing=interiorGrid.x,winW=interiorGrid.y,winH=interiorGrid.z;
  vec2 tile=vMapUv*6.0,inTile=fract(vMapUv)*6.0;
  float col=floor(inTile.x/spacing),du=inTile.x-spacing*(col+0.5);
  float row=step(3.0,inTile.y),dv=inTile.y-(1.56+row*3.0);
  float px=fwidth(tile.x)+1e-5,aa=px*0.75,inset=0.02;
  float cover=smoothstep(winW*0.5-inset+aa,winW*0.5-inset-aa,abs(du))*smoothstep(winH*0.5-inset+aa,winH*0.5-inset-aa,abs(dv));
  float fromTop=winH*0.5-dv,dx=abs(du);
  if(interiorGrid.w>1.5){
    float head=winW*0.82,tt=sqrt(max(0.0,1.0-2.0*dx/winW)),rim=head*(1.0-tt)*(1.0-0.3*tt);
    cover*=smoothstep(rim+inset-aa,rim+inset+aa,fromTop);
  }else if(interiorGrid.w>0.5){
    float head=winW*0.5,rim=sqrt(max(0.0,head*head-(head-fromTop)*(head-fromTop)));
    cover*=mix(1.0,smoothstep(rim-inset+aa,rim-inset-aa,dx),step(fromTop,head));
  }
  // Mullions keep the painted frame colour; far windows return to the painted
  // texture, which already carries its own filtered glazing and night glow.
  vec2 win=vec2((du+winW*0.5)/winW,(dv+winH*0.5)/winH);
  float barHalf=0.0175;
  float barX=abs(fract(win.x*interiorBars.x+0.5)-0.5)*winW/interiorBars.x;
  float barY=abs(fract(win.y*interiorBars.y+0.5)-0.5)*winH/interiorBars.y;
  cover*=smoothstep(barHalf-aa,barHalf+aa,barX)*smoothstep(barHalf-aa,barHalf+aa,barY);
  float near=1.0-smoothstep(0.1,0.25,px);
  cover*=near;
  // The painted night glow is filtered and bleeds past the analytic opening,
  // so up close it is cleared across the whole window rather than blended.
  float region=smoothstep(winW*0.5+0.05+aa,winW*0.5+0.05-aa,abs(du))*smoothstep(winH*0.5+0.05+aa,winH*0.5+0.05-aa,abs(dv))*near;
  // Rooms span whole window bays so partitions always meet masonry piers.
  float floorIdx=floor(tile.y/3.0);
  float f1=interiorHash(vec2(floorIdx,interiorRooms.x)),f2=interiorHash(vec2(interiorRooms.x*1.7,floorIdx));
  float bays=mix(interiorRooms.y,interiorRooms.z,step(0.5,f1));
  float phase=floor(f2*bays);
  float gridU=tile.x/spacing,roomU=(gridU+phase)/bays;
  vec2 roomId=vec2(floor(roomU),floorIdx);
  float lit=step(1.0-interiorLighting.y,interiorHash(roomId+vec2(63.2,interiorRooms.x*0.7)));
  // Every painted window glows, so each is masked by its room's light switch,
  // which keeps far windows in step with the rooms seen up close. Once a bay
  // shrinks to a few pixels the mask settles to the lit share to avoid shimmer.
  float litMask=mix(lit,interiorLighting.y,smoothstep(0.35,0.9,px/spacing));
  totalEmissiveRadiance*=litMask*(1.0-region);
  // Below tile row zero a neighborhood profile raises the ground floor above
  // the surveyed base, so that band of wall is exposed foundation: footing
  // concrete with a shadow line under the first course and a small basement
  // light under each bay, never the painted texture's lower window row, whose
  // head would otherwise show half buried on top of the footing skirt.
  float py=fwidth(tile.y)+1e-5;
  float basement=1.0-smoothstep(-py,py,tile.y);
  if(basement>0.002){
    float lightY=abs(tile.y+0.34);
    float light=smoothstep(0.34+aa,0.34-aa,dx)*smoothstep(0.13+py,0.13-py,lightY);
    float pane=smoothstep(0.29+aa,0.29-aa,dx)*smoothstep(0.09+py,0.09-py,lightY);
    vec3 footing=vec3(0.223,0.202,0.153)*mix(1.0,0.72,smoothstep(0.035+py,0.035-py,-tile.y));
    footing=mix(footing,mix(vec3(0.46,0.45,0.41),vec3(0.028,0.034,0.034),pane),light);
    diffuseColor.rgb=mix(diffuseColor.rgb,footing,basement);
    roughnessFactor=mix(roughnessFactor,0.95,basement);
    normal=normalize(mix(normal,nonPerturbedNormal,basement));
    totalEmissiveRadiance*=1.0-basement;
  }
  cover*=1.0-basement;
  if(cover>0.002){
    vec3 ray=normalize(vInteriorWorld-cameraPosition);
    vec3 wallN=transformDirectionByInverseViewMatrix(nonPerturbedNormal,viewMatrix);
    // The facade UV's own screen derivatives give the exact direction in which
    // u increases along this wall, whatever the surveyed triangle winding.
    vec3 dpx=dFdx(vInteriorWorld),dpy=dFdy(vInteriorWorld);
    vec2 dux=dFdx(vMapUv),duy=dFdy(vMapUv);
    float det=dux.x*duy.y-dux.y*duy.x;
    vec3 along=(dpx*duy.y-dpy*dux.y)*sign(det);
    vec3 tangent=length(along)>1e-7?normalize(along):normalize(cross(vec3(0.0,1.0,0.0),wallN));
    float dirX=dot(ray,tangent),dirY=ray.y,dirZ=max(abs(dot(ray,wallN)),0.05);
    float roomW=spacing*bays,roomH=2.9,depth=4.6,setback=0.1;
    float originX=(fract(roomU)-0.5)*roomW,originY=tile.y-floorIdx*3.0-0.05-roomH*0.5;
    float halfW=roomW*0.5-0.06,halfH=roomH*0.5;
    float tX=(halfW-originX*sign(dirX))/max(abs(dirX),1e-4);
    float tY=(halfH-originY*sign(dirY))/max(abs(dirY),1e-4);
    float tZ=(setback+depth)/dirZ;
    float t=min(min(tX,tY),tZ);
    vec3 hit=vec3(originX+dirX*t,originY+dirY*t,dirZ*t);
    vec3 q=clamp(vec3(hit.x/roomW+0.5,hit.y/roomH+0.5,(hit.z-setback)/depth),0.0,1.0);
    float onBack=step(tZ,tX)*step(tZ,tY);
    float onY=step(tY,tX)*step(tY,tZ);
    float onCeil=onY*step(0.0,dirY),onFloor=onY*(1.0-step(0.0,dirY));
    float s1=interiorHash(roomId+vec2(interiorRooms.x,19.4)),s2=interiorHash(roomId+vec2(83.1,interiorRooms.x*1.9));
    vec3 warm=mix(vec3(1.0,0.72,0.27),vec3(1.0,0.89,0.61),s1),cool=mix(vec3(0.87,0.91,1.0),vec3(0.62,0.71,1.0),s2);
    vec3 lightCol=mix(cool,warm,step(1.0-interiorRooms.w,s2));
    // Plaster walls with a dark skirting, boards and a rug, a lamp in the
    // ceiling, and a door plus picture on the back wall.
    vec3 wallBase=mix(mix(vec3(0.6,0.55,0.45),vec3(0.44,0.48,0.51),s1),vec3(0.73,0.68,0.59),s2*0.6);
    vec3 wallCol=mix(wallBase,wallBase*0.5,smoothstep(0.06,0.04,q.y));
    float seam=step(0.92,fract(q.x*7.0));
    vec3 boards=mix(vec3(0.29,0.2,0.125),vec3(0.42,0.3,0.19),s1)*(1.0-seam*0.3);
    vec3 rug=mix(vec3(0.48,0.23,0.2),vec3(0.23,0.34,0.38),s2);
    float inRug=step(abs(q.x-0.5),0.28)*step(abs(q.z-0.58),0.25);
    vec3 floorCol=mix(boards,rug,inRug*0.88);
    float lamp=smoothstep(0.18,0.11,length(vec2(q.x-0.5,q.z-0.5)));
    vec3 ceilCol=mix(mix(wallBase,vec3(0.91,0.89,0.84),0.28),lightCol*mix(0.85,3.8,lit),lamp);
    float doorX=mix(0.24,0.76,s1);
    vec3 doorCol=mix(vec3(0.35,0.27,0.19),vec3(0.22,0.22,0.24),step(0.5,s2));
    float inDoor=step(abs(q.x-doorX),0.09)*step(abs(q.y-0.34),0.34);
    float picX=mix(0.72,0.28,step(0.5,s1));
    float inFrame=step(abs(q.x-picX),0.085)*step(abs(q.y-0.56),0.095);
    float inCanvas=step(abs(q.x-picX),0.065)*step(abs(q.y-0.56),0.075);
    vec3 picCol=mix(vec3(0.17,0.23,0.29),vec3(0.48,0.35,0.23),fract(s1+s2));
    vec3 backCol=mix(mix(mix(wallCol,doorCol,inDoor),vec3(0.08,0.07,0.06),inFrame),picCol,inCanvas);
    vec3 shell=mix(mix(mix(wallCol,floorCol,onFloor),ceilCol,onCeil),backCol,onBack);
    float aoX=smoothstep(0.0,0.16,q.x)*smoothstep(0.0,0.16,1.0-q.x);
    float aoY=smoothstep(0.0,0.16,q.y)*smoothstep(0.0,0.16,1.0-q.y);
    float aoZ=smoothstep(0.0,0.16,q.z)*smoothstep(0.0,0.16,1.0-q.z);
    float edgeAO=mix(mix(aoY*aoZ,aoX*aoZ,onY),aoX*aoY,onBack);
    vec3 room=shell*mix(0.66,1.0,edgeAO)*mix(1.0,0.42,q.z);
    // Drapes hang just inside the glass and a few shades are drawn part way.
    float cx=clamp(win.x+dirX/dirZ*0.06/winW,0.0,1.0);
    vec2 cellId=vec2(floor(gridU),floorIdx);
    float w1=interiorHash(cellId+vec2(interiorRooms.x*0.8,41.2)),w2=interiorHash(cellId+vec2(17.9,interiorRooms.x*1.3)),w3=interiorHash(cellId+vec2(5.3,interiorRooms.x*2.1));
    float sL=smoothstep(0.18,1.0,w1),sR=smoothstep(0.18,1.0,w2),lw=sL*sL*0.48,rw=sR*sR*0.48;
    float dAA=fwidth(cx)+0.015;
    float inDrape=clamp(max(smoothstep(lw+dAA,lw-dAA,cx)*step(0.03,lw),smoothstep(1.0-rw-dAA,1.0-rw+dAA,cx)*step(0.03,rw)),0.0,1.0);
    float shadeDrop=step(0.66,w3)*(0.15+fract(w3*7.0)*0.4);
    float inShade=smoothstep(1.0-shadeDrop-0.01,1.0-shadeDrop+0.01,win.y)*step(0.01,shadeDrop);
    float pick=fract(s1*5.7)*5.0;
    vec3 fabric=mix(mix(mix(mix(mix(vec3(0.79,0.75,0.65),vec3(0.85,0.8,0.72),s2),mix(vec3(0.54,0.48,0.39),vec3(0.61,0.55,0.45),s2),step(1.0,pick)),mix(vec3(0.37,0.44,0.47),vec3(0.44,0.51,0.55),s2),step(2.0,pick)),mix(vec3(0.42,0.46,0.35),vec3(0.47,0.51,0.37),s2),step(3.0,pick)),mix(vec3(0.55,0.35,0.27),vec3(0.6,0.42,0.32),s2),step(4.0,pick));
    float pleat=sin(cx*48.0+w1*6.28)*0.205*(1.0-smoothstep(0.6,1.6,fwidth(cx)*48.0))+0.945;
    vec3 drape=fabric*pleat*0.92;
    vec3 shade=mix(vec3(0.72,0.68,0.58),vec3(0.6,0.62,0.56),s2);
    vec3 fill=mix(mix(room,drape,inDrape),shade,inShade);
    float transmit=mix(mix(1.0,0.2,inDrape),0.12,inShade);
    vec3 roomTint=mix(vec3(1.0),lightCol,lit*0.85);
    vec3 roomColor=fill*roomTint*mix(0.85,1.35,lit);
    // Daylight through the glass lights unlit rooms by the scene; lit rooms glow.
    vec3 glass=vec3(0.86,0.92,0.93);
    diffuseColor.rgb=mix(diffuseColor.rgb,roomColor*glass*0.55,cover);
    roughnessFactor=mix(roughnessFactor,0.14,cover);
    vec3 glow=roomColor*glass*(lit*transmit*interiorLighting.x+interiorLighting.z*0.03);
    totalEmissiveRadiance+=glow*cover;
  }
}
`;

/** Attach the interior mapping to a painted facade material. Every style
 * shares one program; the grid, head shape and seed are uniforms. */
export function applyWindowInteriors(material:THREE.MeshStandardMaterial,grid:WindowGrid,seed:number,warmth=.78){
  const minBays=grid.spacing<2.5?2:1,maxBays=minBays+1;
  const uniforms={
    interiorGrid:{value:new THREE.Vector4(grid.spacing,grid.width,grid.height,grid.head)},
    interiorRooms:{value:new THREE.Vector4((seed%977)/13,minBays,maxBays,warmth)},
    interiorBars:{value:new THREE.Vector2(grid.bars[0],grid.bars[1])},
    interiorLighting,
  };
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vInteriorWorld;').replace('#include <project_vertex>',GLSL_VERTEX);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+GLSL_PARS).replace('#include <emissivemap_fragment>',GLSL_FRAGMENT);
  };
  material.customProgramCacheKey=()=>'boston-window-interiors-2';
  material.userData.windowInteriors={head:grid.head,bars:grid.bars,bays:[minBays,maxBays],seed:uniforms.interiorRooms.value.x};
  return material;
}
export const windowInteriorShader={pars:GLSL_PARS,vertex:GLSL_VERTEX,fragment:GLSL_FRAGMENT};
