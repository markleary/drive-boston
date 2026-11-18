import * as THREE from 'three';
import type {CityData,Point2} from '../types.ts';
import {buildingAt} from '../simulation/city-tiles.ts';
import {sampleElevation,terrainGrid} from '../simulation/terrain.ts';
import {insideWaterfrontPolygon,quayEdges,waterfrontHeight,waterfrontOverlaps,waterfrontSites,type QuayEdge} from '../simulation/waterfront.ts';
import {longWharfGangwayOpening} from '../simulation/long-wharf.ts';
import {parkSurfaceSteps} from './area-surfaces.ts';
import type {ParkOptions} from './city-parks.ts';
import {PartBatches,box} from './geometry-writer.ts';
import {createGrassMaterial} from './ground-cover.ts';
import {due,type Pace} from './pacing.ts';
import {surfaceNormal} from './draped-surface.ts';
import type {SolidBox} from './commonwealth-mall.ts';
import {isNavyDryDockEdge,navyDryDockSteps} from './navy-dry-docks.ts';

function pavingTexture(stone=false){
  if(typeof document==='undefined')return undefined;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle=stone?'#5d6260':'#8b8274';ctx.fillRect(0,0,256,256);
  const cols=stone?4:16,rows=stone?8:32,w=256/cols,h=256/rows;
  for(let row=0;row<rows;row++)for(let col=-1;col<cols;col++){
    const value=(row*17+col*37+97)%23;
    ctx.fillStyle=stone?`rgb(${137+value},${138+value},${130+value})`:`rgb(${133+value},${84+value},${64+value})`;
    ctx.fillRect(col*w+(row%2?w/2:0)+.7,row*h+.7,w-1.4,h-1.4);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;return texture;
}
let materials:ReturnType<typeof makeMaterials>|undefined;
function makeMaterials(){
  const ground=(color:string,map?:THREE.Texture)=>new THREE.MeshStandardMaterial({color,...(map?{map}:{}),roughness:.96});
  const result={brick:ground('#ddd4c5',pavingTexture()),concrete:ground('#aaa99f'),asphalt:ground('#737878'),
    granite:ground('#c5c2b5',pavingTexture(true)),cap:ground('#b9b4a5'),iron:ground('#293c3b'),wood:ground('#68513b'),
    yellow:ground('#c5a548'),paint:ground('#d5d4c6'),lawn:typeof document==='undefined'?ground('#8caa69'):createGrassMaterial('#b1c593'),
    glass:new THREE.MeshStandardMaterial({color:'#fff2c9',emissive:'#ffde98',emissiveIntensity:.4,roughness:.5})};
  // Constant depth units keep surveyed asphalt above this deck at long
  // viewing distances. Do not apply a slope factor to these clipped slivers:
  // Float32 rounding makes their depth derivatives disagree with the full
  // terrain triangles and can push paving behind the underlying park lawn.
  for(const material of [result.brick,result.concrete,result.asphalt,result.lawn]){
    material.polygonOffset=true;material.polygonOffsetFactor=0;material.polygonOffsetUnits=3;
  }
  return result;
}

/** Use the same interpolated DEM normals as the roads and source terrain.
 * Flat triangle normals make the broad quay aprons show a checkerboard at
 * each DEM diagonal, even though their surface heights are continuous. */
function* waterfrontNormalsSteps(city:CityData,geometry:THREE.BufferGeometry,pace?:Pace):Generator<void,void>{
  const grid=terrainGrid(city);if(!grid)return;
  const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal'),normal=[0,1,0];
  for(let i=0;i<positions.count;i++){
    if((i&4095)===0&&due(pace))yield;
    surfaceNormal(grid,positions.getX(i),positions.getZ(i),normal);
    normals.setXYZ(i,normal[0],normal[1],normal[2]);
  }
  normals.needsUpdate=true;
}

/** Raised, hard-edged wharves. Footprints are clipped offline to the city's
 * hydrography; terrain, road markings and retained building shells stay aligned.
 * Geometry and colliders belong to their streamed tile, including long quays. */
export function* waterfrontDetailSteps(city:CityData,group:THREE.Group,options:ParkOptions):Generator<void,{sites:number;quays:number;benches:number;lamps:number}>{
  const {bounds,pace}=options,m=materials??=makeMaterials(),batches=new PartBatches(240),matrix=new THREE.Matrix4(),solids:SolidBox[]=[];
  const sites=waterfrontSites.filter(s=>!bounds||waterfrontOverlaps(s.bounds,bounds));
  const selected=new Set(sites.map(s=>s.id));
  const owns=(x:number,z:number)=>!bounds||x>=bounds.minX&&x<bounds.maxX&&z>=bounds.minZ&&z<bounds.maxZ;
  const part=(w:number,h:number,d:number,material:THREE.Material,x:number,y:number,z:number,yaw=0)=>{
    matrix.makeRotationY(yaw);matrix.setPosition(x,y,z);batches.part(box(w,h,d),material,matrix);
  };
  const ground=(x:number,z:number)=>waterfrontHeight(city,x,z);
  const clear=(x:number,z:number)=>!options.reserved?.(x,z)&&!buildingAt(city,x,z)&&!city.roads.some(r=>!r.elevations&&!r.tunnel&&r.points.some((a,i)=>{
    const b=r.points[i+1];if(!b)return false;const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<r.width/2+1;
  }));
  for(const site of sites){
    if(due(pace))yield;
    for(const rings of site.paving??[site.rings]){
    const surface=yield* parkSurfaceSteps(city,rings,{bounds,pace,heightAt:p=>ground(...p)});
    if(surface.attributes.position.count){
      yield* waterfrontNormalsSteps(city,surface,pace);
      const mesh=new THREE.Mesh(surface,site.kind==='working'||site.kind==='parking'?m.asphalt:site.kind==='naval'?m.concrete:m.brick);
      mesh.name=`${site.name} paved deck`;mesh.receiveShadow=true;group.add(mesh);
      const p=surface.attributes.position;options.onShore?.(p.array as Float32Array,Uint32Array.from({length:p.count},(_,i)=>i));
    }else surface.dispose();}
    for(const rings of site.lawns??[]){
      const lawn=yield* parkSurfaceSteps(city,rings,{bounds,pace,heightAt:p=>ground(...p)+.009});
      if(!lawn.attributes.position.count){lawn.dispose();continue;}
      yield* waterfrontNormalsSteps(city,lawn,pace);
      const mesh=new THREE.Mesh(lawn,m.lawn);mesh.name=`${site.name} inset lawn`;mesh.receiveShadow=true;group.add(mesh);
      const p=lawn.attributes.position;options.onShore?.(p.array as Float32Array,Uint32Array.from({length:p.count},(_,i)=>i));
    }
  }
  const levelAt=(edge:QuayEdge,x:number,z:number)=>{
    const p:Point2=[x-edge.nx*2,z-edge.nz*2];
    for(const water of city.water??[])for(const s of water.surfaces??[]){if(insideWaterfrontPolygon(p,s.rings))return s.level;}
    return Math.min(sampleElevation(city,...p),ground(x,z)-2);
  };
  let quays=0,benches=0,lamps=0;
  for(const edge of quayEdges){
    if(!selected.has(edge.site.id)||isNavyDryDockEdge(edge.a,edge.b))continue;
    const {a,b,nx,nz,site}=edge,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),tx=dx/length,tz=dz/length,yaw=Math.atan2(dx,dz);
    if(bounds&&!waterfrontOverlaps({minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minZ:Math.min(a[1],b[1]),maxZ:Math.max(a[1],b[1])},bounds))continue;
    const publicWalk=site.kind==='park'||site.kind==='promenade';
    const level=levelAt(edge,(a[0]+b[0])/2,(a[1]+b[1])/2),count=Math.ceil(length/3);
    for(let i=0;i<count;i++){
      if(due(pace))yield;
      const d=(i+.5)*length/count,x=a[0]+tx*d,z=a[1]+tz*d;if(!owns(x,z))continue;
      const y=ground(x,z),bottom=Math.min(level-.6,y-1.2),h=y-bottom,span=length/count+.03;
      // A continuous vertical granite/concrete face descends below the water.
      part(.65,h,span,m.granite,x+nx*.18,y-h/2,z+nz*.18,yaw);
      part(.9,.18,span+.04,m.cap,x+nx*.15,y+.06,z+nz*.15,yaw);
      if(publicWalk&&!(site.id==='long-wharf'&&longWharfGangwayOpening(x,z))){
        const rx=x+nx*.55,rz=z+nz*.55,ry=ground(rx,rz);
        for(const height of [.45,1.1])part(.055,.06,span,m.iron,rx,ry+height,rz,yaw);
        part(.075,1.15,.075,m.iron,rx,ry+.575,rz);
        if(!options.mobile)for(const s of [-.9,-.45,.45,.9])if(Math.abs(s)<span/2)part(.025,.97,.025,m.iron,rx+tx*s,ry+.54,rz+tz*s);
        solids.push({x:rx,y:ry+.6,z:rz,yaw,slope:0,length:span,width:.15,height:1.2});
      }else if(!publicWalk&&i%3===0){
        // Timber fenders and mooring bitts on the working faces.
        part(.42,h+.25,.45,m.wood,x-nx*.36,y-h/2+.08,z-nz*.36,yaw);
        const bx=x+nx*1.4,bz=z+nz*1.4,by=ground(bx,bz);
        part(.3,.65,.3,m.iron,bx,by+.32,bz);part(.65,.15,.3,m.iron,bx,by+.58,bz,yaw);
      }
      quays++;
    }
    // Stations use the original edge, never a clipped tile's endpoint.
    for(let d=12;publicWalk&&d<length-5;d+=26){
      const x=a[0]+tx*d+nx*2.6,z=a[1]+tz*d+nz*2.6;if(!clear(x,z)||!insideWaterfrontPolygon([x,z],site.rings))continue;
      const y=ground(x,z),benchYaw=Math.atan2(-tz,tx);
      if(owns(x,z)){
      for(const s of [-.19,0,.19])part(2.1,.065,.14,m.wood,x+nx*s,y+.49,z+nz*s,benchYaw);
      for(const h of [.72,.91])part(2.1,.14,.06,m.wood,x+nx*.28,y+h,z+nz*.28,benchYaw);
      for(const s of [-.78,.78])part(.09,.46,.58,m.iron,x+tx*s,y+.25,z+tz*s,benchYaw);
      benches++;}
      const lx=x+tx*3.6,lz=z+tz*3.6;if(!owns(lx,lz)||!clear(lx,lz))continue;
      const ly=ground(lx,lz);
      part(.14,3.8,.14,m.iron,lx,ly+1.9,lz);part(.3,.22,.3,m.iron,lx,ly+.11,lz);
      part(.45,.1,.45,m.iron,lx,ly+3.85,lz);part(.26,.38,.26,m.glass,lx,ly+3.61,lz);lamps++;
    }
    if(site.kind==='parking'&&length>45){
      for(let d=9;d<length-9;d+=2.8){
        const x=a[0]+tx*d+nx*7,z=a[1]+tz*d+nz*7;if(!owns(x,z)||!clear(x,z)||!insideWaterfrontPolygon([x,z],site.rings))continue;
        part(4.8,.014,.1,m.paint,x,ground(x,z)+.012,z,yaw);
      }
    }
  }
  for(const mesh of batches.meshes()){mesh.name='Wharf walls, railings and furnishings';mesh.receiveShadow=true;mesh.castShadow=true;group.add(mesh);}
  if(solids.length)options.onSolids?.(solids);
  yield* navyDryDockSteps(city,group,options);
  return {sites:sites.length,quays,benches,lamps};
}
