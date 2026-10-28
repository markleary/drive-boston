import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Building,CityData} from '../types';
import {sampleElevation} from '../simulation/terrain.ts';
import {canvasTexture,seeded} from './materials.ts';
import { landmarkBuildings } from '../simulation/city-tiles.ts';

export const STATE_HOUSE_ID='BOS-1WKHX-X382F-V5VL1';
export const isStateHouse=(building?:Building)=>building?.id===STATE_HOUSE_ID;
// The measured Bulfinch south wall is rotated 11.3 degrees from east-west.
// Coordinates and elevations come from this building's bundled Boston mesh.
const origin={x:912.52,z:-897.34},yaw=.197,tx=Math.cos(yaw),tz=-Math.sin(yaw),nx=Math.sin(yaw),nz=Math.cos(yaw);
const frame=(x:number,z:number)=>({u:(x-origin.x)*tx+(z-origin.z)*tz,v:(x-origin.x)*nx+(z-origin.z)*nz});
type ShellSurface='brick'|'brickWindows'|'stone'|'roof'|'drum';

/** Material-only partition: retain every source vertex, normal and UV. The
 * lateral marble wings are distinct from Bulfinch's brick central block. */
export function splitStateHouseShell(geometry:THREE.BufferGeometry,isRoof:boolean){
  const source=geometry.index?geometry.toNonIndexed():geometry;
  const p=source.getAttribute('position'),groups=new Map<ShellSurface,number[]>();
  for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    const {u,v}=frame(x,z);
    const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
    const normal=b.sub(a).cross(c.sub(a)).normalize(),front=normal.x*nx+normal.z*nz>.8;
    let kind:ShellSurface=isRoof?'roof':Math.abs(u)>29&&v>-70?'stone':front&&v>7&&Math.abs(u)<28?'brick':'brickWindows';
    if(!isRoof&&y>62.8&&Math.abs(u)<11&&v>-13)kind='drum';
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

/** Original six-metre metric textures; reference photos guide the architecture
 * and palette, and are not redistributed as façade photographs. */
export function createStateHouseShellMaterials(){
  const texture=(stone:boolean,windows:boolean)=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;const c=canvas.getContext('2d')!,random=seeded(stone?9327:1798);
    c.fillStyle=stone?'#c8c6bb':'#857464';c.fillRect(0,0,1024,1024);
    const rows=stone?12:64,cols=stone?4:24,ch=1024/rows,cw=1024/cols;
    for(let row=0;row<rows;row++)for(let col=-1;col<cols;col++){
      const value=(random()-.5)*(stone?8:17);
      c.fillStyle=stone?`rgb(${219+value},${217+value},${204+value})`:`rgb(${135+value},${68+value},${48+value})`;
      c.fillRect((col+(row%2)*.5)*cw+1,row*ch+1,cw-2,ch-2);
    }
    if(windows){
      // A tall sash bay per six metres, rather than the generic office ribbons.
      const x=325,y=190,w=374,h=625;
      c.fillStyle=stone?'#ede9db':'#d2c7ad';c.fillRect(x-20,y-22,w+40,h+46);
      c.fillStyle='#2c3f43';c.fillRect(x,y,w,h);
      const glow=c.createLinearGradient(x,y,x+w,y+h);glow.addColorStop(0,'rgba(114,139,143,.45)');glow.addColorStop(1,'rgba(13,28,32,.12)');c.fillStyle=glow;c.fillRect(x,y,w,h);
      c.fillStyle='#d6d9cb';for(let k=1;k<4;k++)c.fillRect(x+w*k/4-3,y,6,h);for(let k=1;k<7;k++)c.fillRect(x,y+h*k/7-3,w,6);
      c.fillStyle='#b5b1a3';c.fillRect(x-34,y+h+22,w+68,16);c.fillStyle='#f1edde';c.fillRect(x-31,y-37,w+62,18);
    }
    const map=canvasTexture(canvas,true);
    return new THREE.MeshStandardMaterial({map,roughness:stone?.82:.94,metalness:0});
  };
  return {brick:texture(false,false),brickWindows:texture(false,true),stone:texture(true,true),roof:new THREE.MeshStandardMaterial({color:'#677774',roughness:.86,metalness:.15}),drum:new THREE.MeshStandardMaterial({color:'#dedbd0',roughness:.76})};
}

/** Bulfinch façade interpretation aligned with the surveyed south wall.
 * Reference: NPS exterior photograph and Massachusetts State House Art
 * Commission's “Italy under the Golden Dome”. Ornament is simplified. */
export function addStateHouseFacade(scene:THREE.Scene,city:CityData){
  const state=landmarkBuildings(city).find(isStateHouse);if(!state)return;
  const group=new THREE.Group();group.name='Massachusetts State House — Bulfinch facade';
  const white=new THREE.MeshStandardMaterial({color:'#e5e1cf',roughness:.76});
  const granite=new THREE.MeshStandardMaterial({color:'#a5a499',roughness:.92});
  const shell=createStateHouseShellMaterials(),brick=shell.brick;
  for(const [kind,material]of Object.entries(shell))if(kind!=='brick'){material.map?.dispose();material.dispose();}
  const glass=new THREE.MeshStandardMaterial({color:'#23383c',metalness:.18,roughness:.25});
  const recess=new THREE.MeshStandardMaterial({color:'#2b2b28',roughness:.94});
  const iron=new THREE.MeshStandardMaterial({color:'#26332f',metalness:.55,roughness:.5});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const vertical=(state.baseElevation??26.74)-26.74;
  const add=(geometry:THREE.BufferGeometry,material:THREE.Material,u:number,y:number,v:number,angle=0)=>{
    geometry.rotateY(angle);geometry.translate(u,y+vertical,v);geometry.rotateY(yaw);geometry.translate(origin.x,0,origin.z);
    const list=batches.get(material)??[];list.push(geometry);batches.set(material,list);
  };
  const box=(material:THREE.Material,u:number,y:number,v:number,w:number,h:number,d:number)=>add(new THREE.BoxGeometry(w,h,d),material,u,y,v);
  const arch=(w:number,h:number)=>{const shape=new THREE.Shape(),r=w/2;shape.moveTo(-r,0);shape.lineTo(r,0);shape.lineTo(r,h-r);shape.absarc(0,h-r,r,0,Math.PI,false);shape.lineTo(-r,0);return shape;};
  function sash(u:number,y:number,v:number,w:number,h:number,arched=false){
    if(arched){add(new THREE.ShapeGeometry(arch(w+.3,h+.2),16),white,u,y-h/2-.1,v);add(new THREE.ShapeGeometry(arch(w,h),16),glass,u,y-h/2,v+.025);}
    else{box(white,u,y,v,w+.3,h+.25,.15);box(glass,u,y,v+.1,w,h,.055);}
    for(const side of [-1,1])box(white,u+side*w/2,y-.08,v+.17,.075,h-.08,.075);
    box(white,u,y-.05,v+.17,.065,h-.1,.075);
    for(let j=1;j<6;j++)box(white,u,y-h/2+h*j/6,v+.17,w,.055,.075);
    box(white,u,y-h/2-.16,v+.14,w+.55,.22,.36);
    if(!arched)box(white,u,y+h/2+.2,v+.12,w+.47,.22,.30);
  }
  // The source central portico projects four metres beyond the main brick wall.
  // Its flat source face becomes the recess behind the arcade and columns.
  box(granite,0,28.7,13.42,28.5,3.9,.35);
  for(let i=-3;i<=3;i++){
    const u=i*3.7;
    add(new THREE.ShapeGeometry(arch(2.8,8.1),20),recess,u,30.7,13.56);
    sash(u,34.6,13.60,1.77,5.9,true);
    box(white,u,39.05,13.66,.38,.5,.16);
  }
  for(let i=-3;i<=2;i++){
    const u=(i+.5)*3.7;
    add(new THREE.CylinderGeometry(.34,.34,.12,24).rotateX(Math.PI/2),white,u,39.3,13.75);
    add(new THREE.CylinderGeometry(.22,.22,.14,24).rotateX(Math.PI/2),granite,u,39.3,13.84);
  }
  box(white,0,40.55,13.65,29.5,.68,1.05);
  box(white,0,40.1,13.48,28.9,.18,.65);
  for(let i=-3;i<=3;i++)sash(i*3.7,46.55,13.52,2.0,8.3);
  const columnPositions=[-13.4,-12.35,-8.75,-5.25,-1.75,1.75,5.25,8.75,12.35,13.4];
  for(const u of columnPositions){
    box(white,u,41.2,14.22,.98,.52,.98);
    add(new THREE.CylinderGeometry(.37,.47,.28,20),white,u,41.55,14.22);
    add(new THREE.CylinderGeometry(.32,.42,12.1,20),white,u,47.73,14.22);
    // Subtle fluting reads in the near view without dense sculptural meshes.
    for(let j=0;j<12;j++){const a=j*Math.PI/6;add(new THREE.CylinderGeometry(.027,.037,11.8,5),white,u+Math.sin(a)*.36,47.73,14.22+Math.cos(a)*.36);}
    add(new THREE.CylinderGeometry(.51,.35,.6,16),white,u,54.1,14.22);
    box(white,u,54.5,14.22,1.08,.25,1.08);
  }
  for(const [y,w,h,d]of [[55.0,29.5,.68,1.5],[55.54,30.2,.25,1.8],[56.0,30.6,.45,2.0]])box(white,0,y,13.7,w,h,d);
  for(let u=-14.7;u<15;u+=.55)box(white,u,55.62,14.65,.22,.25,.28);
  const balustrade=(center:number,width:number,y:number,v:number)=>{
    box(white,center,y,v,width,.22,.35);box(white,center,y+1.1,v,width+.15,.22,.42);
    for(let u=center-width/2+.25;u<center+width/2;u+=.55)add(new THREE.CylinderGeometry(.075,.115,.9,8),white,u,y+.55,v);
    for(const side of [-1,1])box(white,center+side*width/2,y+.55,v,.45,1.3,.5);
  };
  balustrade(0,29.4,56.35,13.7);
  // Palladian groups in the two original brick wings beside the porch.
  for(const side of [-1,1]){
    const center=side*20.4;
    for(let j=-1;j<=1;j++)sash(center+j*3.25,46.5,9.24,2.12,j===0?8.4:7.5,true);
    for(let j=-1;j<=1;j++)sash(center+j*3.25,34.8,9.24,1.85,5.35);
    box(white,center,40.65,9.28,11.45,.27,.38);
    box(white,center,55.9,9.3,11.55,.65,.8);
    box(white,center,56.6,9.4,12.0,.32,1.0);
    balustrade(center,11.2,57.12,9.3);
  }
  // Raised pediment on the dome's front drum; roof and gold shell stay original.
  const pediment=new THREE.Shape();pediment.moveTo(-10.4,0);pediment.lineTo(10.4,0);pediment.lineTo(0,4.3);pediment.closePath();
  const pedimentGeometry=new THREE.ExtrudeGeometry(pediment,{depth:.22,bevelEnabled:false}),pedimentUV=pedimentGeometry.getAttribute('uv');
  for(let i=0;i<pedimentUV.count;i++)pedimentUV.setXY(i,pedimentUV.getX(i)/6,pedimentUV.getY(i)/6);
  add(pedimentGeometry,brick,0,62.0,10.4);
  box(white,0,62.05,10.72,21.3,.35,.5);
  for(const side of [-1,1]){
    const slope=Math.atan2(4.3,10.4)*side,g=new THREE.BoxGeometry(Math.hypot(10.4,4.3),.36,.55);g.rotateZ(-slope);add(g,white,side*5.2,64.15,10.72);
  }
  for(let i=-2;i<=2;i++)sash(i*3.6,59.8,10.24,2.15,2.2);
  // Grounded entrance steps are supported down to the local hillside.
  for(let i=0;i<13;i++){
    const v=14.0+(i+.5)*.6,top=30.75-i*.24;
    const x=origin.x+nx*v,z=origin.z+nz*v,ground=sampleElevation(city,x,z)-vertical-.12;
    if(top>ground)box(granite,0,(top+ground)/2,v,15.0,top-ground,.65);
  }
  for(const side of [-1,1]){
    const u=side*8.0,v=21.8,x=origin.x+tx*u+nx*v,z=origin.z+tz*u+nz*v,ground=sampleElevation(city,x,z)-vertical;
    box(granite,u,ground+2.35,v,1.35,4.7,1.35);box(white,u,ground+4.78,v,1.65,.24,1.65);
  }
  for(let u=-7.4;u<=7.4;u+=.33)box(iron,u,29.0,22.0,.045,2.45,.045);
  box(iron,0,29.9,22.0,15,.075,.075);box(iron,0,28.2,22.0,15,.075,.075);
  let triangles=0;
  for(const [material,geometries]of batches){
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(normalized,false);if(!geometry)continue;
    geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);triangles+=geometry.getAttribute('position').count/3;
    new Set([...geometries,...normalized]).forEach(g=>g.dispose());
  }
  group.userData={buildingId:state.id,columns:columnPositions.length,arcades:7,palladianGroups:2,triangles,reference:'https://www.nps.gov/places/massachusetts-state-house.htm'};
  scene.add(group);return group;
}
