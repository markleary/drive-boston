import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityArea, CityData, Point2 } from '../types';
import { pointInside } from '../simulation/roads';
import { sampleElevation } from '../simulation/terrain';
import { canvasTexture, seeded } from './materials';
import { createStreetTrees, type TreeField } from './foliage';
import { drapedRibbonInto } from './terrain-ground';
import { PartBatches, box, type Part } from './geometry-writer';
import { drain, due, type Pace } from './pacing';
import { createGrassMaterial } from './ground-cover';
import { insideEmbracePlaza } from './the-embrace';
import {parkSurface,WATER_SURFACE_OFFSET} from './area-surfaces.ts';
import {createWaterMaterial} from './water-material.ts';
export {parkSurface} from './area-surfaces.ts';

export interface Bounds { minX:number; maxX:number; minZ:number; maxZ:number; }
const waterLevels=new WeakMap<CityArea,number>();
const areaExtents=new WeakMap<Pick<CityArea,'rings'>,Bounds>();

export function insideArea(p:Point2,area:CityArea){
  return !!area.rings[0]&&pointInside(p,area.rings[0])&&!area.rings.slice(1).some(r=>pointInside(p,r));
}

/** A single water level estimated from interior DEM samples, excluding the
 * shoreline so bank elevations do not set the pond level. */
export function waterHeight(city:CityData,area:CityArea){
  const cached=waterLevels.get(area);if(cached!==undefined)return cached;
  const bounds=areaBounds(area),step=Math.max(6,Math.sqrt((bounds.maxX-bounds.minX)*(bounds.maxZ-bounds.minZ)/1800)),values:number[]=[];
  // Shore samples are rejected by distance to the nearest ring edge; a cell
  // index over the ring edges keeps that bounded for harbour-sized outlines.
  const cell=24,edges=new Map<string,[Point2,Point2][]>();
  for(const r of area.rings)for(let i=0;i<r.length;i++){
    const a=r[i],b=r[(i+1)%r.length];
    for(let x=Math.floor((Math.min(a[0],b[0])-3)/cell);x<=Math.floor((Math.max(a[0],b[0])+3)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-3)/cell);z<=Math.floor((Math.max(a[1],b[1])+3)/cell);z++){const key=`${x},${z}`,list=edges.get(key)??[];list.push([a,b]);edges.set(key,list);}
  }
  const nearShore=(p:Point2)=>(edges.get(`${Math.floor(p[0]/cell)},${Math.floor(p[1]/cell)}`)??[]).some(([a,b])=>distanceToSegment(p,a,b)<3);
  for(let x=bounds.minX+step/2;x<bounds.maxX;x+=step)for(let z=bounds.minZ+step/2;z<bounds.maxZ;z+=step){if(!nearShore([x,z])&&insideArea([x,z],area))values.push(sampleElevation(city,x,z));}
  if(!values.length)values.push(...area.rings[0].map(p=>sampleElevation(city,...p)));
  values.sort((a,b)=>a-b);const level=values[Math.floor((values.length-1)*.85)];waterLevels.set(area,level);return level;
}
export function areaBoundsOf(area:CityArea){return areaBounds(area);}

function areaBounds(area:Pick<CityArea,'rings'>){
  const cached=areaExtents.get(area);if(cached)return cached;
  const p=area.rings[0],bounds={minX:Math.min(...p.map(p=>p[0])),maxX:Math.max(...p.map(p=>p[0])),minZ:Math.min(...p.map(p=>p[1])),maxZ:Math.max(...p.map(p=>p[1]))};areaExtents.set(area,bounds);return bounds;
}
function distanceToSegment(p:Point2,a:Point2,b:Point2){
  const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?THREE.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d,0,1):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}

let parkMaterials:{lawn:THREE.Material;gardenLawn:THREE.Material;pathMaterial:THREE.Material;waterMaterial:THREE.Material;bankMaterial:THREE.Material;iron:THREE.Material;wood:THREE.Material;stone:THREE.Material;lampGlass:THREE.Material}|undefined;
export interface ParkOptions {
  /** Streamed tile: surfaces are clipped to this box and only paths/ponds owned by it are built. */
  bounds?:Bounds; owner?:string; pathOwned?:(path:ParkPath)=>boolean; treeField?:TreeField; target?:THREE.Object3D;
  budgets?:{trees?:number;benches?:number};
  /** Frame pacing: the generator form pauses between areas, paths and parks once the deadline has passed. */ pace?:Pace;
}
type ParkPath=NonNullable<CityData['parkPaths']>[number];
/** Real Boston park boundaries, hydrography and mapped pedestrian alignments.
 * Planting, furnishings and bridge details are original procedural interpretations. */
export function addCityParkDetails(scene:THREE.Scene,city:CityData,options:ParkOptions={}){ return drain(cityParkDetailSteps(scene,city,options)); }
export function* cityParkDetailSteps(scene:THREE.Scene,city:CityData,options:ParkOptions={}):Generator<void,THREE.Group>{
  const group=new THREE.Group();group.name='Boston parks and waterways';const pace=options.pace;
  const bounds=options.bounds,owned=(p:Point2)=>!bounds||(p[0]>=bounds.minX&&p[0]<bounds.maxX&&p[1]>=bounds.minZ&&p[1]<bounds.maxZ);
  const parks=(city.parks??[]).filter(p=>p.rings[0]?.length>=3);
  const waters=(city.water??[]).filter(p=>p.rings[0]?.length>=3);
  const paths=(city.parkPaths??[]).filter(p=>options.pathOwned?options.pathOwned(p):true);
  parkMaterials??={lawn:createGrassMaterial('#c7cfb0'),gardenLawn:createGrassMaterial('#ccd5b6'),pathMaterial:new THREE.MeshStandardMaterial({color:'#c6baa4',roughness:.96}),
    waterMaterial:createWaterMaterial(),bankMaterial:new THREE.MeshStandardMaterial({color:'#8d9674',roughness:.96}),
    iron:new THREE.MeshStandardMaterial({color:'#303f36',metalness:.35,roughness:.65}),wood:new THREE.MeshStandardMaterial({color:'#876b45',roughness:.91}),stone:new THREE.MeshStandardMaterial({color:'#baaf96',roughness:.91}),
    lampGlass:new THREE.MeshStandardMaterial({color:'#f4e9ca',emissive:'#ffdba1',emissiveIntensity:.25,roughness:.35})};
  const {lawn,gardenLawn,pathMaterial,waterMaterial,bankMaterial,iron,wood,stone,lampGlass}=parkMaterials;
  const treeBudget=options.budgets?.trees??760,benchBudget=options.budgets?.benches??140;
  const batches=new PartBatches(240),matrix=new THREE.Matrix4();
  const part=(g:Part,m:THREE.Material,x:number,y:number,z:number,yaw=0)=>{batches.part(g,m,matrix.makeRotationY(yaw).setPosition(x,y,z));};
  const lawns:THREE.BufferGeometry[]=[],gardens:THREE.BufferGeometry[]=[],plazas:THREE.BufferGeometry[]=[],waterSheets:THREE.BufferGeometry[]=[];
  for(const park of parks){
    if(due(pace))yield;
    if(/copley square/i.test(park.name))continue; // Detailed existing landscape owns this plaza.
    const list=/plaza/i.test(park.name)||/Malls, Squares/i.test(park.kind??'')?plazas:/public garden/i.test(park.name)?gardens:lawns;
    const geometry=parkSurface(city,park.rings,.024,undefined,bounds);if(geometry.attributes.position.count)list.push(geometry);else geometry.dispose();
  }
  for(const water of waters){
    if(due(pace))yield;
    // The hydro union joins rivers at different elevations to the tidal harbour. Its
    // source basin/reach planes retain their own levels across streamed tiles.
    for(const surface of water.surfaces??[{rings:water.rings,level:waterHeight(city,water)}]){
      const extent=areaBounds(surface);
      if(bounds&&(extent.maxX<bounds.minX||extent.minX>bounds.maxX||extent.maxZ<bounds.minZ||extent.minZ>bounds.maxZ))continue;
      const geometry=parkSurface(city,surface.rings,WATER_SURFACE_OFFSET,surface.level,bounds,true);if(geometry.attributes.position.count)waterSheets.push(geometry);else geometry.dispose();
    }
    // Small pond edges get a narrow ground-following border; river shorelines
    // retain the source's natural geometry without an invented concrete wall.
    const extent=areaBounds(water);
    if(Math.max(extent.maxX-extent.minX,extent.maxZ-extent.minZ)<350&&owned(water.rings[0][0])){
      for(const ring of water.rings)drapedRibbonInto(batches.at(bankMaterial,ring[0][0],ring[0][1]),city,[...ring,ring[0]],.65,.085);
    }
  }
  for(const [list,material,name] of [[lawns,lawn,'Park lawns'],[gardens,gardenLawn,'Garden lawns'],[plazas,pathMaterial,'Plazas'],[waterSheets,waterMaterial,'Water']] as const){
    if(!list.length)continue;
    const merged=mergeGeometries(list,false);list.forEach(g=>g.dispose());if(!merged)continue;merged.computeBoundingSphere();
    const mesh=new THREE.Mesh(merged,material);mesh.name=name;mesh.receiveShadow=true;if(material===waterMaterial)mesh.userData.noAO=true;group.add(mesh);
  }
  let bridges=0,benches=0,lamps=0;
  for(const path of paths){
    if(path.points.length<2)continue;
    if(due(pace))yield;
    const bridge='bridge' in path&&path.bridge;
    if(bridge){
      bridges++;
      const points=path.points,a=points[0],b=points[points.length-1];
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<1)continue;
      // Both ends meet mapped paths; a shallow arch leaves the lagoon visible.
      const count=Math.ceil(length/2),nx=-dz/length,nz=dx/length;
      const start=sampleElevation(city,...a)+.12,end=sampleElevation(city,...b)+.12;
      const py=(t:number)=>start+(end-start)*t+Math.sin(t*Math.PI)*Math.min(1.9,length*.035);
      for(let i=0;i<count;i++){
        const t0=i/count,t1=(i+1)/count,m=(t0+t1)/2,y0=py(t0),y1=py(t1),seg=length/count;
        const centerX=a[0]+dx*m,centerZ=a[1]+dz*m;
        const deck=new THREE.BoxGeometry(path.width,.22,Math.hypot(seg,y1-y0));deck.rotateX(-Math.atan2(y1-y0,seg));
        part(deck,stone,centerX,(y0+y1)/2-.11,centerZ,Math.atan2(dx,dz));
        for(const side of [-1,1]){
          const x=centerX+nx*side*(path.width*.5-.12),z=centerZ+nz*side*(path.width*.5-.12);
          part(box(.065,1.05,.065),iron,x,py(m)+.5,z);
          const rail=new THREE.BoxGeometry(.085,.075,Math.hypot(seg,y1-y0)+.05);rail.rotateX(-Math.atan2(y1-y0,seg));
          part(rail,iron,x,(y0+y1)/2+1.04,z,Math.atan2(dx,dz));
        }
      }
    }else{
      const p=path.points[0];drapedRibbonInto(batches.at(pathMaterial,p[0],p[1]),city,path.points,path.width,.052);
    }
  }
  // Spatially index roads, buildings and paths so landscape preparation stays
  // bounded when the city grows; every decoration remains clear of travel lanes.
  const cell=50,segments=new Map<string,{a:Point2;b:Point2;clearance:number}[]>(),buildings=new Map<string,Point2[][]>();
  const key=(x:number,z:number)=>`${Math.floor(x/cell)},${Math.floor(z/cell)}`;
  function segment(a:Point2,b:Point2,clearance:number){
    for(let x=Math.floor((Math.min(a[0],b[0])-clearance)/cell);x<=Math.floor((Math.max(a[0],b[0])+clearance)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-clearance)/cell);z<=Math.floor((Math.max(a[1],b[1])+clearance)/cell);z++){
      const k=`${x},${z}`,items=segments.get(k)??[];items.push({a,b,clearance});segments.set(k,items);
    }
  }
  for(const r of city.roads)for(let i=1;i<r.points.length;i++)segment(r.points[i-1],r.points[i],r.width/2+3.4);
  for(const p of paths)for(let i=1;i<p.points.length;i++)segment(p.points[i-1],p.points[i],p.width/2+1.7);
  for(const b of city.buildings){
    const p=b.footprint;if(p.length<3)continue;
    for(let x=Math.floor(Math.min(...p.map(v=>v[0]))/cell);x<=Math.floor(Math.max(...p.map(v=>v[0]))/cell);x++)for(let z=Math.floor(Math.min(...p.map(v=>v[1]))/cell);z<=Math.floor(Math.max(...p.map(v=>v[1]))/cell);z++){
      const k=`${x},${z}`,items=buildings.get(k)??[];items.push(p);buildings.set(k,items);
    }
  }
  const waterBounds=waters.map(w=>({area:w,...areaBounds(w)}));
  const wet=(p:Point2)=>waterBounds.some(w=>p[0]>=w.minX-2&&p[0]<=w.maxX+2&&p[1]>=w.minZ-2&&p[1]<=w.maxZ+2&&insideArea(p,w.area));
  const safe=(p:Point2)=>!wet(p)&&!insideEmbracePlaza(...p)&&!(buildings.get(key(...p))??[]).some(b=>pointInside(p,b))&&!(segments.get(key(...p))??[]).some(s=>distanceToSegment(p,s.a,s.b)<s.clearance);
  const treePoints:THREE.Vector3[]=[],random=seeded(1877),treeCells=new Map<string,Point2[]>();
  const principal=parks.filter(p=>/common$|public garden|back bay fens|commonwealth avenue mall/i.test(p.name));
  const selected=bounds||!principal.length?parks.filter(p=>!/cemetery|golf/i.test(p.kind??'')):principal;
  const clipped=(p:CityArea):Bounds=>{const b=areaBounds(p);return bounds?{minX:Math.max(b.minX,bounds.minX),maxX:Math.min(b.maxX,bounds.maxX),minZ:Math.max(b.minZ,bounds.minZ),maxZ:Math.min(b.maxZ,bounds.maxZ)}:b;};
  const limits=selected.map(p=>{const b=clipped(p),area=Math.max(0,b.maxX-b.minX)*Math.max(0,b.maxZ-b.minZ);return /public garden/i.test(p.name)?190:/boston common/i.test(p.name)?260:/fens/i.test(p.name)?190:Math.min(bounds?60:35,Math.round(area/1300));});
  for(const [index,park] of selected.entries()){
    if(due(pace))yield;
    const b=clipped(park),limit=limits[index];let count=0;if(b.maxX<=b.minX||b.maxZ<=b.minZ)continue;
    for(let attempt=0;attempt<limit*25&&count<limit&&treePoints.length<treeBudget;attempt++){
      const p:Point2=[b.minX+random()*(b.maxX-b.minX),b.minZ+random()*(b.maxZ-b.minZ)];if(!insideArea(p,park)||!safe(p))continue;
      const cx=Math.floor(p[0]/10),cz=Math.floor(p[1]/10);let near=false;
      for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)if((treeCells.get(`${x},${z}`)??[]).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<8))near=true;
      if(near)continue;const k=`${cx},${cz}`,list=treeCells.get(k)??[];list.push(p);treeCells.set(k,list);
      treePoints.push(new THREE.Vector3(p[0],sampleElevation(city,...p)+.025,p[1]));count++;
    }
  }
  if(treePoints.length){if(options.treeField)options.treeField.add(options.owner??'parks',treePoints);else{const trees=createStreetTrees(treePoints,{scale:1.65,grates:false});trees.name='Park specimen trees';group.add(trees);}}
  // Benches and restrained lamps sit beside real paths. Count is fixed per
  // length rather than per OSM segment, preventing dense clusters at junctions.
  for(const path of paths){
    if('bridge' in path&&path.bridge)continue;
    if(due(pace))yield;
    let next=22+random()*25,distance=0;
    for(let i=1;i<path.points.length&&benches<benchBudget;i++){
      const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.1)continue;
      while(next<distance+length&&benches<benchBudget){
        const t=(next-distance)/length,side=benches%2?1:-1,offset=path.width/2+2.1;
        const p:Point2=[a[0]+dx*t-dz/length*offset*side,a[1]+dz*t+dx/length*offset*side];next+=58;
        if(!selected.some(park=>insideArea(p,park))||!safe(p))continue;
        const ground=sampleElevation(city,...p),yaw=Math.atan2(-dz,dx);
        part(box(2,.08,.48),wood,p[0],ground+.48,p[1],yaw);
        const backX=p[0]-dz/length*.27*side,backZ=p[1]+dx/length*.27*side;
        part(box(2,.38,.08),wood,backX,ground+.78,backZ,yaw);
        for(const s of [-1,1])part(box(.07,.45,.46),iron,p[0]+dx/length*.72*s,ground+.23,p[1]+dz/length*.72*s,yaw);
        benches++;
        if(benches%3===0){
          const lx=p[0]+dx/length*3.8,lz=p[1]+dz/length*3.8,lp:Point2=[lx,lz];
          if(safe(lp)&&selected.some(park=>insideArea(lp,park))){const y=sampleElevation(city,lx,lz);part(new THREE.CylinderGeometry(.055,.09,3.25,7),iron,lx,y+1.63,lz);part(new THREE.SphereGeometry(.25,8,6),lampGlass,lx,y+3.37,lz);lamps++;}
        }
      }
      distance+=length;
    }
  }
  for(const mesh of batches.meshes()){mesh.castShadow=mesh.material!==pathMaterial&&mesh.material!==bankMaterial;mesh.receiveShadow=true;group.add(mesh);}
  group.userData={parks:parks.length,waterBodies:waters.length,paths:paths.length,bridges,trees:treePoints.length,benches,lamps,source:'Boston GIS park/hydro polygons; OpenStreetMap pedestrian paths',accuracy:'Mapped outlines and paths; planting and furnishings are procedural'};
  (options.target??scene).add(group);return group;
}

function grassTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!,random=seeded(1634);
  ctx.fillStyle='#77865a';ctx.fillRect(0,0,256,256);
  for(let i=0;i<13000;i++){const x=random()*256,y=random()*256;ctx.strokeStyle=`hsla(${72+random()*20},${20+random()*15}%,${31+random()*26}%,.36)`;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(random()-.5)*1.3,y-1.8-random()*2.3);ctx.stroke();}
  const texture=canvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}
