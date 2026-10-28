import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityArea, CityData, Point2 } from '../types';
import { pointInside } from '../simulation/roads';
import { sampleElevation } from '../simulation/terrain';
import { canvasTexture, seeded } from './materials';
import { createStreetTrees } from './foliage';
import { drapedRibbon } from './terrain-ground';
import { createGrassMaterial } from './ground-cover';

export function insideArea(p:Point2,area:CityArea){
  return !!area.rings[0]&&pointInside(p,area.rings[0])&&!area.rings.slice(1).some(r=>pointInside(p,r));
}

/** Clip polygon triangulation against the exact DEM triangles. This preserves
 * shore/park boundaries and hill crests without recursively oversampling long,
 * thin shoreline triangles. Holes are removed by Earcut before ground clipping. */
export function parkSurface(city:CityData,rings:Point2[][],offset=.024,flatHeight?:number){
  const contour=rings[0]?.map(p=>new THREE.Vector2(...p))??[];
  const holes=rings.slice(1).map(r=>r.map(p=>new THREE.Vector2(...p)));
  const vertices=[...contour,...holes.flat()],faces=THREE.ShapeUtils.triangulateShape(contour,holes);
  const positions:number[]=[],uv:number[]=[];
  const emit=(poly:Point2[])=>{
    for(let i=1;i<poly.length-1;i++){
      const a=poly[0],b=poly[i],c=poly[i+1],cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      if(Math.abs(cross)<1e-7)continue;
      for(const p of cross>0?[a,c,b]:[a,b,c]){positions.push(p[0],(flatHeight??sampleElevation(city,...p))+offset,p[1]);uv.push(p[0]/7,p[1]/7);}
    }
  };
  const clip=(poly:Point2[],nx:number,nz:number,limit:number)=>{
    const out:Point2[]=[];if(!poly.length)return out;
    let a=poly[poly.length-1],da=a[0]*nx+a[1]*nz-limit;
    for(const b of poly){const db=b[0]*nx+b[1]*nz-limit;
      if((da<=0)!==(db<=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
      if(db<=0)out.push(b);a=b;da=db;
    }return out;
  };
  const grid=city.elevation,cell=grid?.cellSize??6,ox=grid?.originX??0,oz=grid?.originZ??0;
  for(const f of faces){
    const triangle=f.map(i=>[vertices[i].x,vertices[i].y] as Point2);
    if(flatHeight!==undefined){emit(triangle);continue;}
    const minX=Math.floor((Math.min(...triangle.map(p=>p[0]))-ox)/cell),maxX=Math.floor((Math.max(...triangle.map(p=>p[0]))-ox)/cell);
    const minZ=Math.floor((Math.min(...triangle.map(p=>p[1]))-oz)/cell),maxZ=Math.floor((Math.max(...triangle.map(p=>p[1]))-oz)/cell);
    for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
      const x=ox+ix*cell,z=oz+iz*cell;
      let polygon=clip(triangle,-1,0,-x);polygon=clip(polygon,1,0,x+cell);polygon=clip(polygon,0,-1,-z);polygon=clip(polygon,0,1,z+cell);
      if(polygon.length<3)continue;
      emit(clip(polygon,1,1,x+z+cell));emit(clip(polygon,-1,-1,-x-z-cell));
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();g.computeBoundingSphere();return g;
}

/** A single water level estimated from interior DEM samples, excluding the
 * shoreline so bank elevations do not set the pond level. */
export function waterHeight(city:CityData,area:CityArea){
  const bounds=areaBounds(area),step=Math.max(6,Math.sqrt((bounds.maxX-bounds.minX)*(bounds.maxZ-bounds.minZ)/1800)),values:number[]=[];
  for(let x=bounds.minX+step/2;x<bounds.maxX;x+=step)for(let z=bounds.minZ+step/2;z<bounds.maxZ;z+=step){if(insideArea([x,z],area)&&!area.rings.some(r=>r.some((p,i)=>distanceToSegment([x,z],p,r[(i+1)%r.length])<3)))values.push(sampleElevation(city,x,z));}
  if(!values.length)values.push(...area.rings[0].map(p=>sampleElevation(city,...p)));
  values.sort((a,b)=>a-b);return values[Math.floor((values.length-1)*.85)];
}

function areaBounds(area:CityArea){
  const p=area.rings[0];return {minX:Math.min(...p.map(p=>p[0])),maxX:Math.max(...p.map(p=>p[0])),minZ:Math.min(...p.map(p=>p[1])),maxZ:Math.max(...p.map(p=>p[1]))};
}
function distanceToSegment(p:Point2,a:Point2,b:Point2){
  const dx=b[0]-a[0],dz=b[1]-a[1],d=dx*dx+dz*dz,t=d?THREE.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d,0,1):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}

/** Real Boston park boundaries, hydrography and mapped pedestrian alignments.
 * Planting, furnishings and bridge details are original procedural interpretations. */
export function addCityParkDetails(scene:THREE.Scene,city:CityData){
  const group=new THREE.Group();group.name='Boston parks and waterways';
  const parks=(city.parks??[]).filter(p=>p.rings[0]?.length>=3);
  const waters=(city.water??[]).filter(p=>p.rings[0]?.length>=3);
  const paths=city.parkPaths??[];
  const lawn=createGrassMaterial('#c7cfb0');
  const gardenLawn=createGrassMaterial('#ccd5b6');
  const pathMaterial=new THREE.MeshStandardMaterial({color:'#c6baa4',roughness:.96});
  const waterMaterial=new THREE.MeshPhysicalMaterial({color:'#507d7b',roughness:.21,metalness:.25,clearcoat:1,clearcoatRoughness:.2});
  const bankMaterial=new THREE.MeshStandardMaterial({color:'#8d9674',roughness:.96});
  const iron=new THREE.MeshStandardMaterial({color:'#303f36',metalness:.35,roughness:.65});
  const wood=new THREE.MeshStandardMaterial({color:'#876b45',roughness:.91});
  const stone=new THREE.MeshStandardMaterial({color:'#baaf96',roughness:.91});
  const lampGlass=new THREE.MeshStandardMaterial({color:'#f4e9ca',emissive:'#ffdba1',emissiveIntensity:.25,roughness:.35});
  const batches=new Map<string,{material:THREE.Material;geometries:THREE.BufferGeometry[]}>();
  const add=(g:THREE.BufferGeometry,m:THREE.Material,x:number,z:number)=>{
    const key=`${m.uuid}:${Math.floor(x/240)}:${Math.floor(z/240)}`;let batch=batches.get(key);if(!batch){batch={material:m,geometries:[]};batches.set(key,batch);}batch.geometries.push(g);
  };
  const part=(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,yaw=0)=>{g.rotateY(yaw);g.translate(x,y,z);add(g,m,x,z);};
  for(const park of parks){
    if(/copley square/i.test(park.name))continue; // Detailed existing landscape owns this plaza.
    const material=/plaza/i.test(park.name)?pathMaterial:/public garden/i.test(park.name)?gardenLawn:lawn;
    const mesh=new THREE.Mesh(parkSurface(city,park.rings),material);mesh.name=park.name;mesh.receiveShadow=true;group.add(mesh);
  }
  for(const water of waters){
    const mesh=new THREE.Mesh(parkSurface(city,water.rings,.095,waterHeight(city,water)),waterMaterial);mesh.name=water.name;mesh.receiveShadow=true;mesh.userData.noAO=true;group.add(mesh);
    // Small pond edges get a narrow ground-following border; river shorelines
    // retain the source's natural geometry without an invented concrete wall.
    const bounds=areaBounds(water);
    if(Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)<350){
      for(const ring of water.rings)add(drapedRibbon(city,[...ring,ring[0]],.65,.085),bankMaterial,ring[0][0],ring[0][1]);
    }
  }
  let bridges=0,benches=0,lamps=0;
  for(const path of paths){
    if(path.points.length<2)continue;
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
          part(new THREE.BoxGeometry(.065,1.05,.065),iron,x,py(m)+.5,z);
          const rail=new THREE.BoxGeometry(.085,.075,Math.hypot(seg,y1-y0)+.05);rail.rotateX(-Math.atan2(y1-y0,seg));
          part(rail,iron,x,(y0+y1)/2+1.04,z,Math.atan2(dx,dz));
        }
      }
    }else{
      const p=path.points[0];add(drapedRibbon(city,path.points,path.width,.052),pathMaterial,...p);
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
  const safe=(p:Point2)=>!wet(p)&&!(buildings.get(key(...p))??[]).some(b=>pointInside(p,b))&&!(segments.get(key(...p))??[]).some(s=>distanceToSegment(p,s.a,s.b)<s.clearance);
  const treePoints:THREE.Vector3[]=[],random=seeded(1877),treeCells=new Map<string,Point2[]>();
  const principal=parks.filter(p=>/common$|public garden|back bay fens|commonwealth avenue mall/i.test(p.name));
  const selected=principal.length?principal:parks;
  const limits=selected.map(p=>/public garden/i.test(p.name)?190:/boston common/i.test(p.name)?260:/fens/i.test(p.name)?190:Math.min(35,Math.round((areaBounds(p).maxX-areaBounds(p).minX)*(areaBounds(p).maxZ-areaBounds(p).minZ)/1300)));
  selected.forEach((park,index)=>{
    const b=areaBounds(park),limit=limits[index];let count=0;
    for(let attempt=0;attempt<limit*25&&count<limit&&treePoints.length<760;attempt++){
      const p:Point2=[b.minX+random()*(b.maxX-b.minX),b.minZ+random()*(b.maxZ-b.minZ)];if(!insideArea(p,park)||!safe(p))continue;
      const cx=Math.floor(p[0]/10),cz=Math.floor(p[1]/10);let near=false;
      for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)if((treeCells.get(`${x},${z}`)??[]).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<8))near=true;
      if(near)continue;const k=`${cx},${cz}`,list=treeCells.get(k)??[];list.push(p);treeCells.set(k,list);
      treePoints.push(new THREE.Vector3(p[0],sampleElevation(city,...p)+.025,p[1]));count++;
    }
  });
  if(treePoints.length){const trees=createStreetTrees(treePoints,{scale:1.65,grates:false});trees.name='Park specimen trees';group.add(trees);}
  // Benches and restrained lamps sit beside real paths. Count is fixed per
  // length rather than per OSM segment, preventing dense clusters at junctions.
  for(const path of paths){
    if('bridge' in path&&path.bridge)continue;
    let next=22+random()*25,distance=0;
    for(let i=1;i<path.points.length&&benches<140;i++){
      const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.1)continue;
      while(next<distance+length&&benches<140){
        const t=(next-distance)/length,side=benches%2?1:-1,offset=path.width/2+2.1;
        const p:Point2=[a[0]+dx*t-dz/length*offset*side,a[1]+dz*t+dx/length*offset*side];next+=58;
        if(!selected.some(park=>insideArea(p,park))||!safe(p))continue;
        const ground=sampleElevation(city,...p),yaw=Math.atan2(-dz,dx);
        part(new THREE.BoxGeometry(2,.08,.48),wood,p[0],ground+.48,p[1],yaw);
        const backX=p[0]-dz/length*.27*side,backZ=p[1]+dx/length*.27*side;
        part(new THREE.BoxGeometry(2,.38,.08),wood,backX,ground+.78,backZ,yaw);
        for(const s of [-1,1])part(new THREE.BoxGeometry(.07,.45,.46),iron,p[0]+dx/length*.72*s,ground+.23,p[1]+dz/length*.72*s,yaw);
        benches++;
        if(benches%3===0){
          const lx=p[0]+dx/length*3.8,lz=p[1]+dz/length*3.8,lp:Point2=[lx,lz];
          if(safe(lp)&&selected.some(park=>insideArea(lp,park))){const y=sampleElevation(city,lx,lz);part(new THREE.CylinderGeometry(.055,.09,3.25,7),iron,lx,y+1.63,lz);part(new THREE.SphereGeometry(.25,8,6),lampGlass,lx,y+3.37,lz);lamps++;}
        }
      }
      distance+=length;
    }
  }
  for(const {material,geometries} of batches.values()){
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g),geometry=mergeGeometries(normalized,false);
    if(geometry){geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=material!==pathMaterial&&material!==bankMaterial;mesh.receiveShadow=true;group.add(mesh);}
    new Set([...geometries,...normalized]).forEach(g=>g.dispose());
  }
  group.userData={parks:parks.length,waterBodies:waters.length,paths:paths.length,bridges,trees:treePoints.length,benches,lamps,source:'Boston GIS park/hydro polygons; OpenStreetMap pedestrian paths',accuracy:'Mapped outlines and paths; planting and furnishings are procedural'};
  scene.add(group);return group;
}

function grassTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!,random=seeded(1634);
  ctx.fillStyle='#77865a';ctx.fillRect(0,0,256,256);
  for(let i=0;i<13000;i++){const x=random()*256,y=random()*256;ctx.strokeStyle=`hsla(${72+random()*20},${20+random()*15}%,${31+random()*26}%,.36)`;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(random()-.5)*1.3,y-1.8-random()*2.3);ctx.stroke();}
  const texture=canvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}
