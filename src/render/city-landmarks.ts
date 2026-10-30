import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData } from '../types';
import { sampleElevation } from '../simulation/terrain';
import { addFenwayPark } from './fenway-park';
import {addStateHouseFacade} from './state-house';
import {addSymphonyHallFacade} from './symphony-hall';
import { landmarkBuildings } from '../simulation/city-tiles.ts';

/** Original landmark accents. Dome profile follows the actual Boston source
 * mesh's upper rings; the ceremonial gate follows OSM way 212123982's location,
 * alignment and 9.1m height. Decorative details are interpretive. */
export function addCityLandmarkDetails(scene:THREE.Scene,city:CityData){
  addFenwayPark(scene,city);
  const stateHouse=addStateHouseFacade(scene,city);
  const symphonyHall=addSymphonyHallFacade(scene,city);
  const group=new THREE.Group();group.name='Central Boston landmark accents';
  if(stateHouse)group.userData.stateHouse=stateHouse.userData;
  if(symphonyHall)group.userData.symphonyHall=symphonyHall.userData;
  const gold=new THREE.MeshStandardMaterial({color:'#dcb643',metalness:.76,roughness:.29});
  const limestone=new THREE.MeshStandardMaterial({color:'#d5d0bd',roughness:.78});
  const green=new THREE.MeshStandardMaterial({color:'#2d6d54',metalness:.12,roughness:.52});
  const dark=new THREE.MeshStandardMaterial({color:'#253e36',roughness:.7});
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,yaw=0)=>{g.rotateY(yaw);g.translate(x,y,z);const list=batches.get(m)??[];list.push(g);batches.set(m,list);};
  const state=landmarkBuildings(city).find(b=>b.id==='BOS-1WKHX-X382F-V5VL1');
  if(state){
    const x=912.52,z=-897.34,translation=(state.baseElevation??0)+state.height-73.68104;
    const profile=[[8.17,57.78],[8.17,60.51],[7.56,61.98],[6.58,63.46],[4.96,64.93],[2.86,65.66]].map(([r,y])=>new THREE.Vector2(r,y+translation));
    add(new THREE.LatheGeometry(profile,64),gold,x,0,z);
    add(new THREE.CylinderGeometry(2.82,2.82,4.5,24),limestone,x,67.8+translation,z);
    const upper=[[2.9,70.02],[2.5,70.8],[1.93,72.5],[1.79,73.76],[0,74.18]].map(([r,y])=>new THREE.Vector2(r,y+translation));
    add(new THREE.LatheGeometry(upper,32),gold,x,0,z);
    for(let i=0;i<12;i++){
      const a=i*Math.PI/6;add(new THREE.BoxGeometry(.62,2.3,.1),dark,x+Math.sin(a)*2.84,67.6+translation,z+Math.cos(a)*2.84,a);
    }
  }
  if(city.landmarks.some(l=>l.id==='chinatown'||l.id==='chinatown-gate')){
    // OSM gate footprint: central point (-71.059752,42.351187); spans Beach
    // Street almost north-south. Local X runs along the ceremonial gateway.
    const x=1240.5674,z=-124.5439,yaw=1.337,ground=sampleElevation(city,x,z);
    const gateScale=9.1/7.925;
    const local=(g:THREE.BufferGeometry,m:THREE.Material,u:number,y:number,v=0)=>{g.scale(1,gateScale,1);add(g,m,x+Math.cos(yaw)*u+Math.sin(yaw)*v,ground+y*gateScale,z-Math.sin(yaw)*u+Math.cos(yaw)*v,yaw);};
    for(const u of [-6.1,-3.8,3.8,6.1]){
      local(new THREE.BoxGeometry(.54,5.6,.62),limestone,u,2.8);
      local(new THREE.BoxGeometry(.9,.4,.95),limestone,u,.2);
      local(new THREE.BoxGeometry(.76,.25,.82),limestone,u,4.9);
      local(new THREE.BoxGeometry(.88,.22,.96),green,u,5.28);
    }
    local(new THREE.BoxGeometry(8.6,1.0,.68),limestone,0,5.75);
    local(new THREE.BoxGeometry(5.3,.65,.06),dark,0,5.8,.38);
    local(new THREE.BoxGeometry(5.3,.65,.06),dark,0,5.8,-.38);
    for(const side of [-1,1])local(new THREE.BoxGeometry(2.7,.65,.68),limestone,side*4.95,4.78);
    // Layered, upturned tile eaves built as four sloping strips per roof side.
    const roof=(center:number,width:number,base:number,depth:number)=>{
      for(const side of [-1,1])for(let i=0;i<4;i++){
        const t=i/4,next=(i+1)/4,z0=side*t*depth,z1=side*next*depth;
        const y0=base+1.1*(1-t)+.36*t*t*t,y1=base+1.1*(1-next)+.36*next*next*next;
        const g=new THREE.BoxGeometry(width,.15,Math.hypot(z1-z0,y1-y0)+.025);g.rotateX(-Math.atan2(y1-y0,z1-z0));local(g,green,center,(y0+y1)/2,(z0+z1)/2);
      }
      local(new THREE.BoxGeometry(width+.25,.16,.18),green,center,base+1.18);
      for(const side of [-1,1])local(new THREE.ConeGeometry(.16,.55,6),green,center+side*(width/2-.15),base+1.5);
    };
    roof(0,9.3,6.15,1.35);roof(-5.2,3.6,4.98,1.15);roof(5.2,3.6,4.98,1.15);
    const label=document.createElement('canvas');label.width=1024;label.height=128;const ctx=label.getContext('2d')!;
    ctx.font='bold 78px serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#e5d19a';ctx.fillText('天下為公',512,64);
    const texture=new THREE.CanvasTexture(label);texture.colorSpace=THREE.SRGBColorSpace;
    const lettering=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false});
    for(const side of [-1,1]){
      const g=new THREE.PlaneGeometry(3.7,.58);if(side<0)g.rotateY(Math.PI);local(g,lettering,0,5.8,side*.42);
    }
  }
  for(const [material,geometries] of batches){
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(normalized,false);
    if(geometry){geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
    new Set([...geometries,...normalized]).forEach(g=>g.dispose());
  }
  scene.add(group);return group;
}
