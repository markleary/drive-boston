import * as THREE from 'three';
import type {CityData,Point2} from '../types';
import {sampleElevation} from '../simulation/terrain.ts';
import type {Bounds} from './city-parks';
const triangulations=new WeakMap<Point2[][],{vertices:THREE.Vector2[];faces:number[][]}>();

/** Clip polygon triangulation against the exact DEM triangles. This preserves
 * shore/park boundaries and hill crests without recursively oversampling long,
 * thin shoreline triangles. Holes are removed by Earcut before ground clipping. */
export function parkSurface(city:CityData,rings:Point2[][],offset=.024,flatHeight?:number,bounds?:Bounds,coverTerrain=false){
  let triangulated=triangulations.get(rings);
  if(!triangulated){
    const contour=rings[0]?.map(p=>new THREE.Vector2(...p))??[];
    const holes=rings.slice(1).map(r=>r.map(p=>new THREE.Vector2(...p)));
    triangulated={vertices:[...contour,...holes.flat()],faces:THREE.ShapeUtils.triangulateShape(contour,holes)};triangulations.set(rings,triangulated);
  }
  const {vertices,faces}=triangulated;
  const positions:number[]=[],uv:number[]=[];
  const emit=(poly:Point2[])=>{
    for(let i=1;i<poly.length-1;i++){
      const a=poly[0],b=poly[i],c=poly[i+1],cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      if(Math.abs(cross)<1e-7)continue;
      for(const p of cross>0?[a,c,b]:[a,b,c]){const ground=sampleElevation(city,...p);positions.push(p[0],(coverTerrain?Math.max(flatHeight??ground,ground):flatHeight??ground)+offset,p[1]);uv.push(p[0]/7,p[1]/7);}
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
    let triangle=f.map(i=>[vertices[i].x,vertices[i].y] as Point2);
    // A streamed tile keeps only its own part of a park that spans several tiles.
    if(bounds){
      triangle=clip(triangle,-1,0,-bounds.minX);triangle=clip(triangle,1,0,bounds.maxX);triangle=clip(triangle,0,-1,-bounds.minZ);triangle=clip(triangle,0,1,bounds.maxZ);
      if(triangle.length<3)continue;
    }
    if(flatHeight!==undefined&&!coverTerrain){emit(triangle);continue;}
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
