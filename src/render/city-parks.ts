import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityArea, CityData, Point2 } from '../types';
import { pointInside } from '../simulation/roads';
import { sampleElevation } from '../simulation/terrain';
import {footbridgeRoad} from '../simulation/footbridges.ts';
import {roadSlabGeometry,deckEdge} from '../simulation/road-surfaces.ts';
import {canopyHitsDeck,PARK_CANOPY} from '../simulation/deck-canopy.ts';
import { canvasTexture, seeded } from './materials';
import { createStreetTrees, type TreeField, type TreePlanting } from './foliage';
import { drapedRibbonInto,clipPortalSurfaceSteps } from './terrain-ground';
import { PartBatches, TriangleWriter, box, type Part } from './geometry-writer';
import { drain, due, type Pace } from './pacing';
import { createGrassMaterial } from './ground-cover';
import { insideEmbracePlaza } from './the-embrace';
import {parkSurfaceSteps,shoreBankSteps,WATER_SURFACE_OFFSET} from './area-surfaces.ts';
import {boundingSphereSteps} from './paced-geometry.ts';
import {waterShore} from './water-shore.ts';
import {createWaterMaterial} from './water-material.ts';
import {applyWaterMotion,waterMotion} from './water-motion.ts';
export {parkSurface} from './area-surfaces.ts';
import {waterHeight} from '../simulation/water-level.ts';
import {inTunnelApproach} from '../simulation/tunnels.ts';
import {inGreenway,replacesGreenwayPark,outsideGreenwayPath} from '../simulation/greenway.ts';
import {greenwayDetailSteps} from './greenway';
import { fellsViewHeight, fellsWoodlandSteps, isFellsWoodland, type FellsViewHeight } from './fells-woodland.ts';
import { christianSciencePlazaSteps, christianScienceTrees, isChristianSciencePool, ownsChristianSciencePlaza } from './christian-science-plaza.ts';
import { BOSTON_COMMON, commonTrees, FROG_POND, FROG_POND_LEVEL, frogPondApron } from '../simulation/boston-common.ts';
export {waterHeight} from '../simulation/water-level.ts';

export interface Bounds { minX:number; maxX:number; minZ:number; maxZ:number; }
const areaExtents=new WeakMap<Pick<CityArea,'rings'>,Bounds>();

export function insideArea(p:Point2,area:CityArea){
  return !!area.rings[0]&&pointInside(p,area.rings[0])&&!area.rings.slice(1).some(r=>pointInside(p,r));
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

let parkMaterials:{lawn:THREE.Material;gardenLawn:THREE.Material;forestFloor:THREE.Material;pathMaterial:THREE.Material;waterMaterial:THREE.Material;iron:THREE.Material;wood:THREE.Material;stone:THREE.Material;lampGlass:THREE.Material}|undefined;
export interface ParkOptions {
  /** The visible shoreline slopes share their mesh with wheel collision. */
  onShore?:(vertices:Float32Array,indices:Uint32Array)=>void;
  onRock?:(vertices:Float32Array,indices:Uint32Array)=>void;
  fellsViewHeight?:FellsViewHeight;
  mobile?:boolean;
  detailed?:()=>boolean;
  /** Streamed tile: surfaces are clipped to this box and only paths/ponds owned by it are built. */
  bounds?:Bounds; owner?:string; pathOwned?:(path:ParkPath)=>boolean; treeField?:TreeField; target?:THREE.Object3D;
  budgets?:{trees?:number;benches?:number};
  reserved?:(x:number,z:number)=>boolean;
  /** Frame pacing: the generator form pauses between areas, paths and parks once the deadline has passed. */ pace?:Pace;
}
type ParkPath=NonNullable<CityData['parkPaths']>[number];

const frogPondConcrete=new THREE.MeshStandardMaterial({color:'#b7afa3',roughness:.93});

/** This wading pool has a concrete rim and a level surface. The apron ties
 * the rim back into the sloped paths without changing their terrain heights. */
function* frogPondSteps(city:CityData,water:CityArea,waterMaterial:THREE.Material,{onShore,pace}:ParkOptions){
  const level=FROG_POND_LEVEL,rimHeight=level+.23,ring=water.rings[0];
  const apron=yield* parkSurfaceSteps(city,[frogPondApron,ring],{pace,heightAt:p=>{
    const distance=Math.min(...ring.map((a,i)=>distanceToSegment(p,a,ring[(i+1)%ring.length])));
    return Math.max(sampleElevation(city,...p)+.035,rimHeight-.45*distance);
  }});
  const rim=new TriangleWriter();
  rim.append(apron);
  apron.dispose();
  for(const [i,[ax,az]] of ring.entries()){
    const [bx,bz]=ring[(i+1)%ring.length],base=level-.04;
    rim.triangle(ax,base,az,ax,rimHeight,az,bx,base,bz);
    rim.triangle(bx,base,bz,ax,rimHeight,az,bx,rimHeight,bz);
  }
  const concrete=new THREE.Mesh(rim.geometry(),frogPondConcrete);
  concrete.name='Frog Pond concrete rim';
  concrete.receiveShadow=true;

  const surface=yield* parkSurfaceSteps(city,water.rings,{offset:WATER_SURFACE_OFFSET,flatHeight:level,water:true,pace});
  const sheet=new THREE.Mesh(applyWaterMotion(surface,waterMotion(water)),waterMaterial);
  sheet.name='Frog Pond water';
  sheet.receiveShadow=true;
  sheet.userData.noAO=true;
  const pond=new THREE.Group();
  pond.name=FROG_POND;
  pond.add(concrete,sheet);
  const vertices=concrete.geometry.getAttribute('position').array as Float32Array;
  onShore?.(vertices,Uint32Array.from({length:vertices.length/3},(_,i)=>i));
  return pond;
}

/** Real Boston park boundaries, hydrography and mapped pedestrian alignments.
 * Planting, furnishings and bridge details are original procedural interpretations. */
export function addCityParkDetails(scene:THREE.Scene,city:CityData,options:ParkOptions={}){ return drain(cityParkDetailSteps(scene,city,options)); }
export function* cityParkDetailSteps(scene:THREE.Scene,city:CityData,options:ParkOptions={}):Generator<void,THREE.Group>{
  const group=new THREE.Group();group.name='Boston parks and waterways';const pace=options.pace;
  const bounds=options.bounds;
  const parks=(city.parks??[]).filter(p=>p.rings[0]?.length>=3&&!replacesGreenwayPark(p));
  const woodland=parks.filter(isFellsWoodland);
  const waters=(city.water??[]).filter(p=>p.rings[0]?.length>=3);
  const christianSciencePlaza=waters.some(isChristianSciencePool)&&ownsChristianSciencePlaza(bounds);
  const paths=(city.parkPaths??[]).filter(p=>options.pathOwned?options.pathOwned(p):true);
  // Lawns and plazas lie a few centimetres above the terrain (depth bias 4) and
  // below the surveyed sidewalks (bias 2). The same slope factor lets those
  // heights decide at grazing angles; an unbiased lawn would overwrite the
  // concrete of a paved island the parks layer also lists as parkway land.
  const ground=<T extends THREE.Material>(m:T)=>{m.polygonOffset=true;m.polygonOffsetFactor=1;m.polygonOffsetUnits=3;return m;};
  parkMaterials??={lawn:ground(createGrassMaterial('#c7cfb0')),gardenLawn:ground(createGrassMaterial('#ccd5b6')),forestFloor:ground(createGrassMaterial('#a2a087')),pathMaterial:ground(new THREE.MeshStandardMaterial({color:'#c6baa4',roughness:.96})),
    waterMaterial:createWaterMaterial(),
    iron:new THREE.MeshStandardMaterial({color:'#303f36',metalness:.35,roughness:.65}),wood:new THREE.MeshStandardMaterial({color:'#876b45',roughness:.91}),stone:new THREE.MeshStandardMaterial({color:'#baaf96',roughness:.91}),
    lampGlass:new THREE.MeshStandardMaterial({color:'#f4e9ca',emissive:'#ffdba1',emissiveIntensity:.25,roughness:.35})};
  const {lawn,gardenLawn,forestFloor,pathMaterial,waterMaterial,iron,wood,stone,lampGlass}=parkMaterials;
  const treeBudget=options.budgets?.trees??760,benchBudget=options.budgets?.benches??140;
  const batches=new PartBatches(240),matrix=new THREE.Matrix4();
  const part=(g:Part,m:THREE.Material,x:number,y:number,z:number,yaw=0)=>{batches.part(g,m,matrix.makeRotationY(yaw).setPosition(x,y,z));};
  const lawns:THREE.BufferGeometry[]=[],gardens:THREE.BufferGeometry[]=[],woods:THREE.BufferGeometry[]=[],plazas:THREE.BufferGeometry[]=[],waterSheets:THREE.BufferGeometry[]=[],bankPositions:number[]=[];
  for(const park of parks){
    if(due(pace))yield;
    if(/copley square/i.test(park.name))continue; // Detailed existing landscape owns this plaza.
    const list=isFellsWoodland(park)?woods:/plaza/i.test(park.name)||/Malls, Squares/i.test(park.kind??'')?plazas:/public garden/i.test(park.name)?gardens:lawns;
    // A large park or basin covers thousands of DEM cells: its surface is draped a few milliseconds a frame.
    const surface=yield* parkSurfaceSteps(city,park.rings,{bounds,pace});
    const geometry=yield* clipPortalSurfaceSteps(city,surface,pace);if(geometry.attributes.position.count)list.push(geometry);else geometry.dispose();
  }
  for(const water of waters){
    if(due(pace))yield;
    if(isChristianSciencePool(water))continue;
    if(water.name===FROG_POND){
      // This pool fits in one tile. It is also in adjacent tiles' shoreline buffers.
      const [x,z]=water.rings[0][0];
      if(!bounds||x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ){
        group.add(yield* frogPondSteps(city,water,waterMaterial,options));
      }
      continue;
    }
    // The hydro union joins rivers at different elevations to the tidal harbour. Its
    // source basin/reach planes retain their own levels across streamed tiles.
    for(const surface of water.surfaces??[{rings:water.rings,level:waterHeight(city,water)}]){
      const extent=areaBounds(surface);
      if(bounds&&(extent.maxX<bounds.minX||extent.minX>bounds.maxX||extent.maxZ<bounds.minZ||extent.minZ>bounds.maxZ))continue;
      const shore=waterShore(water,surface.rings),geometry=yield* parkSurfaceSteps(city,shore.rings,{offset:WATER_SURFACE_OFFSET,flatHeight:surface.level,bounds,water:true,shore,bankPositions,pace});
      if(geometry.attributes.position.count)waterSheets.push(applyWaterMotion(geometry,waterMotion(water,'source' in surface?surface:undefined)));else geometry.dispose();
    }
  }
  if(bankPositions.length){
    const bank=yield* shoreBankSteps(bankPositions,pace),vertices=bank.getAttribute('position').array as Float32Array,ids=new Uint32Array(vertices.length/3);for(let i=0;i<ids.length;i++)ids[i]=i;
    if(due(pace))yield;
    options.onShore?.(vertices,ids);
    const mesh=new THREE.Mesh(bank,lawn);mesh.name='Sloping water banks';mesh.receiveShadow=true;group.add(mesh);
  }
  for(const [list,material,name] of [[lawns,lawn,'Park lawns'],[gardens,gardenLawn,'Garden lawns'],[woods,forestFloor,'Fells forest floor'],[plazas,pathMaterial,'Plazas'],[waterSheets,waterMaterial,'Water']] as const){
    if(!list.length)continue;
    if(due(pace))yield;
    const merged=mergeGeometries(list,false);list.forEach(g=>g.dispose());if(!merged)continue;yield* boundingSphereSteps(merged,pace);
    const mesh=new THREE.Mesh(merged,material);mesh.name=name;mesh.receiveShadow=true;if(material===waterMaterial)mesh.userData.noAO=true;group.add(mesh);
  }
  let bridges=0,benches=0,lamps=0;
  for(const path of paths){
    if(path.points.length<2)continue;
    if(due(pace))yield;
    const bridge='bridge' in path&&path.bridge;
    if(bridge){
      const road=footbridgeRoad(city,path);if(!road)continue;bridges++;
      const slab=roadSlabGeometry(city,road),deck=new THREE.BufferGeometry();
      deck.setAttribute('position',new THREE.BufferAttribute(slab.vertices,3));deck.setIndex(new THREE.BufferAttribute(slab.indices,1));deck.computeVertexNormals();
      batches.at(stone,path.points[0][0],path.points[0][1]).append(deck);deck.dispose();
      for(let i=1;i<road.points.length;i++){
        const y0=road.elevations![i-1],y1=road.elevations![i];
        for(const side of [-1,1]){
          const a=deckEdge(road,i-1,side,.12),b=deckEdge(road,i,side,.12),dx=b[0]-a[0],dz=b[1]-a[1],seg=Math.hypot(dx,dz),x=(a[0]+b[0])/2,z=(a[1]+b[1])/2;
          part(box(.065,1.05,.065),iron,x,(y0+y1)/2+.5,z);
          const rail=new THREE.BoxGeometry(.085,.075,Math.hypot(seg,y1-y0)+.05);rail.rotateX(-Math.atan2(y1-y0,seg));
          part(rail,iron,x,(y0+y1)/2+1.04,z,Math.atan2(dx,dz));
        }
      }
    }else{
      for(const points of outsideGreenwayPath(path.points)){const p=points[0];drapedRibbonInto(batches.at(pathMaterial,p[0],p[1]),city,points,path.width,.052);}
    }
  }
  // Spatially index roads, buildings and paths so landscape preparation stays
  // bounded when the city grows; every decoration remains clear of travel lanes.
  const cell=50,segments=new Map<string,{a:Point2;b:Point2;clearance:number;trail:boolean}[]>(),buildings=new Map<string,Point2[][]>();
  const woodlandMargin=woodland.length?15:0;
  const key=(x:number,z:number)=>`${Math.floor(x/cell)},${Math.floor(z/cell)}`;
  function segment(a:Point2,b:Point2,clearance:number,trail=false){
    const margin=clearance+woodlandMargin;
    for(let x=Math.floor((Math.min(a[0],b[0])-margin)/cell);x<=Math.floor((Math.max(a[0],b[0])+margin)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-margin)/cell);z<=Math.floor((Math.max(a[1],b[1])+margin)/cell);z++){
      const k=`${x},${z}`,items=segments.get(k)??[];items.push({a,b,clearance,trail});segments.set(k,items);
    }
  }
  for(const r of city.roads){if(r.tunnel)continue;for(let i=1;i<r.points.length;i++)segment(r.points[i-1],r.points[i],r.width/2+3.4);}
  for(const p of paths)for(let i=1;i<p.points.length;i++)segment(p.points[i-1],p.points[i],p.width/2+1.7,true);
  for(const b of city.buildings){
    const p=b.footprint;if(p.length<3)continue;
    for(let x=Math.floor((Math.min(...p.map(v=>v[0]))-woodlandMargin)/cell);x<=Math.floor((Math.max(...p.map(v=>v[0]))+woodlandMargin)/cell);x++)for(let z=Math.floor((Math.min(...p.map(v=>v[1]))-woodlandMargin)/cell);z<=Math.floor((Math.max(...p.map(v=>v[1]))+woodlandMargin)/cell);z++){
      const k=`${x},${z}`,items=buildings.get(k)??[];items.push(p);buildings.set(k,items);
    }
  }
  // Keep furniture and trunks out of the Frog Pond's apron as well as its water.
  const waterBounds=waters.map(w=>{
    const area=w.name===FROG_POND?{...w,rings:[frogPondApron]}:w;
    return {area,...areaBounds(area)};
  });
  const wet=(p:Point2)=>waterBounds.some(w=>p[0]>=w.minX-2&&p[0]<=w.maxX+2&&p[1]>=w.minZ-2&&p[1]<=w.maxZ+2&&insideArea(p,w.area));
  const safe=(p:Point2)=>!options.reserved?.(...p)&&!inGreenway(...p)&&!inTunnelApproach(city,...p)&&!wet(p)&&!insideEmbracePlaza(...p)&&!(buildings.get(key(...p))??[]).some(b=>pointInside(p,b))&&!(segments.get(key(...p))??[]).some(s=>distanceToSegment(p,s.a,s.b)<s.clearance);
  const treePoints:(THREE.Vector3|TreePlanting)[]=[],random=seeded(1877),treeCells=new Map<string,Point2[]>();
  const principal=parks.filter(p=>/common$|public garden|back bay fens|commonwealth avenue mall/i.test(p.name));
  const selected=bounds||!principal.length?parks.filter(p=>!/cemetery|golf/i.test(p.kind??'')):principal;
  const clipped=(p:CityArea):Bounds=>{const b=areaBounds(p);return bounds?{minX:Math.max(b.minX,bounds.minX),maxX:Math.min(b.maxX,bounds.maxX),minZ:Math.max(b.minZ,bounds.minZ),maxZ:Math.min(b.maxZ,bounds.maxZ)}:b;};
  let woodlandTrees=0;
  if(woodland.length){
    const extents=woodland.map(clipped);
    const woodlandBounds={
      minX:Math.min(...extents.map(b=>b.minX)),maxX:Math.max(...extents.map(b=>b.maxX)),
      minZ:Math.min(...extents.map(b=>b.minZ)),maxZ:Math.max(...extents.map(b=>b.maxZ)),
    };
    const nearRing=(p:Point2,ring:Point2[],reach:number)=>ring.some((a,i)=>distanceToSegment(p,a,ring[(i+1)%ring.length])<reach);
    const contains=(p:Point2)=>woodland.some((a,i)=>{
      const b=extents[i];
      return p[0]>=b.minX&&p[0]<b.maxX&&p[1]>=b.minZ&&p[1]<b.maxZ&&insideArea(p,a);
    });
    const clear=(p:Point2,reach:number,solid:boolean)=>{
      const shore=solid?reach+1:1;
      return !inTunnelApproach(city,...p)
        && !(segments.get(key(...p))??[]).some(s=>distanceToSegment(p,s.a,s.b)<s.clearance+(s.trail&&!solid?0:reach))
        && !(buildings.get(key(...p))??[]).some(b=>pointInside(p,b)||nearRing(p,b,reach))
        && !waterBounds.some(w=>p[0]>=w.minX-shore&&p[0]<=w.maxX+shore&&p[1]>=w.minZ-shore&&p[1]<=w.maxZ+shore
          && (insideArea(p,w.area)||w.area.rings.some(r=>nearRing(p,r,shore))));
    };
    woodlandTrees=yield* fellsWoodlandSteps(city,group,{bounds:woodlandBounds,contains,clear,
      viewHeight:options.fellsViewHeight??fellsViewHeight(city),onRock:options.onRock,pace});
  }
  const limits=selected.map(p=>{const b=clipped(p),area=Math.max(0,b.maxX-b.minX)*Math.max(0,b.maxZ-b.minZ);return /public garden/i.test(p.name)?190:/fens/i.test(p.name)?190:Math.min(bounds?60:35,Math.round(area/1300));});
  for(const [index,park] of selected.entries()){
    if(due(pace))yield;
    if(isFellsWoodland(park)||park.name===BOSTON_COMMON)continue;
    const b=clipped(park),limit=limits[index];let count=0;if(b.maxX<=b.minX||b.maxZ<=b.minZ)continue;
    for(let attempt=0;attempt<limit*25&&count<limit&&treePoints.length<treeBudget;attempt++){
      const p:Point2=[b.minX+random()*(b.maxX-b.minX),b.minZ+random()*(b.maxZ-b.minZ)];if(!insideArea(p,park)||!safe(p))continue;
      const cx=Math.floor(p[0]/10),cz=Math.floor(p[1]/10);let near=false;
      for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)if((treeCells.get(`${x},${z}`)??[]).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<8))near=true;
      if(near||canopyHitsDeck(city,p[0],p[1],sampleElevation(city,...p),PARK_CANOPY))continue;const k=`${cx},${cz}`,list=treeCells.get(k)??[];list.push(p);treeCells.set(k,list);
      treePoints.push(new THREE.Vector3(p[0],sampleElevation(city,...p)+.025,p[1]));count++;
    }
  }
  if(christianSciencePlaza)treePoints.push(...christianScienceTrees(city));
  // Use the park inventory independently of the tile's procedural tree budget.
  const common=parks.find(p=>p.name===BOSTON_COMMON);
  if(common){
    const b=clipped(common);
    for(const [x,z,species,scale] of commonTrees){
      if(due(pace))yield;
      const p:Point2=[x,z];
      if(x<b.minX||x>=b.maxX||z<b.minZ||z>=b.maxZ||!insideArea(p,common)||!safe(p))continue;
      const y=sampleElevation(city,x,z);
      if(!canopyHitsDeck(city,x,z,y,PARK_CANOPY))treePoints.push({position:new THREE.Vector3(x,y+.025,z),species,scale});
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
  for(const mesh of batches.meshes()){mesh.castShadow=mesh.material!==pathMaterial;mesh.receiveShadow=true;group.add(mesh);}
  const greenwayGroup=yield* greenwayDetailSteps(city,options);if(greenwayGroup.userData.parcels)group.add(greenwayGroup);
  if(christianSciencePlaza){
    yield* christianSciencePlazaSteps(city,group,options);
  }
  group.userData={parks:parks.length,waterBodies:waters.length,paths:paths.length,bridges,trees:treePoints.length+woodlandTrees+(greenwayGroup.userData.trees??0),benches,lamps,greenway:greenwayGroup.userData,source:'Boston GIS park/hydro polygons, Boston Common tree inventory, and OpenStreetMap pedestrian paths',accuracy:'Mapped outlines, paths and Common tree locations. Outcrops and furnishings are procedural.'};
  (options.target??scene).add(group);return group;
}

function grassTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!,random=seeded(1634);
  ctx.fillStyle='#77865a';ctx.fillRect(0,0,256,256);
  for(let i=0;i<13000;i++){const x=random()*256,y=random()*256;ctx.strokeStyle=`hsla(${72+random()*20},${20+random()*15}%,${31+random()*26}%,.36)`;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(random()-.5)*1.3,y-1.8-random()*2.3);ctx.stroke();}
  const texture=canvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}
