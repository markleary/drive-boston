import * as THREE from 'three';
import type {CityData,Point2} from '../types';
import {sampleElevation} from '../simulation/terrain.ts';
import type {Bounds} from './city-parks';
import {uncoveredWater,uncoveredBank} from './water-pavement.ts';
import {SHORE_FADE,type WaterShore} from './water-shore.ts';
// Above lawn decals (.024 m), below ground-road asphalt (.045 m).
export const WATER_SURFACE_OFFSET=.035;
const triangulations=new WeakMap<Point2[][],{vertices:THREE.Vector2[];faces:number[][]}>();

export function shoreBankGeometry(positions:number[]){
  const g=new THREE.BufferGeometry(),uv:number[]=[];
  for(let i=0;i<positions.length;i+=3)uv.push(positions[i]/4,positions[i+2]/4);
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();g.computeBoundingSphere();return g;
}

/** Clip polygon triangulation against the exact DEM triangles. This preserves
 * shore/park boundaries and hill crests without recursively oversampling long,
 * thin shoreline triangles. Holes are removed by Earcut before ground clipping. */
export function parkSurface(city:CityData,rings:Point2[][],offset=.024,flatHeight?:number,bounds?:Bounds,water=false,shore?:WaterShore,bankPositions:number[]=[]){
  let triangulated=triangulations.get(rings);
  if(!triangulated){
    const contour=rings[0]?.map(p=>new THREE.Vector2(...p))??[];
    const holes=rings.slice(1).map(r=>r.map(p=>new THREE.Vector2(...p)));
    triangulated={vertices:[...contour,...holes.flat()],faces:THREE.ShapeUtils.triangulateShape(contour,holes)};triangulations.set(rings,triangulated);
  }
  const {vertices,faces}=triangulated;
  const positions:number[]=[],uv:number[]=[];
  const emitTriangles=(poly:Point2[],bank=false,height?:(p:Point2)=>number)=>{
    for(let i=1;i<poly.length-1;i++){
      const a=poly[0],b=poly[i],c=poly[i+1];
      // Tiny contour/pavement slivers can collapse at world-coordinate Float32
      // precision. Cull them after that conversion so normals stay upward.
      const ax=Math.fround(a[0]),az=Math.fround(a[1]),bx=Math.fround(b[0]),bz=Math.fround(b[1]),cx=Math.fround(c[0]),cz=Math.fround(c[1]),cross=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
      if(Math.abs(cross)<1e-7)continue;
      for(const p of cross>0?[a,c,b]:[a,b,c]){
        (bank?bankPositions:positions).push(p[0],height?height(p):(flatHeight??sampleElevation(city,...p))+offset,p[1]);if(!bank)uv.push(p[0]/7,p[1]/7);
      }
    }
  };
  const emit=(poly:Point2[])=>{
    if(shore&&flatHeight!==undefined&&poly.length){
      // A narrow land strip rises from the DEM to the waterline *inside* the
      // mapped outline. This closes low-bank gaps without hanging a water sheet
      // over dry land or sloping the water itself. Pavement remains untouched.
      const values=new WeakMap<Point2,number>();for(const p of poly)values.set(p,Math.min(shore.width+12,shore.distance(...p)));
      const split=(input:Point2[],bank:boolean)=>{
        const limit=shore.width+(bank?Math.min(SHORE_FADE,shore.width/3):0),result:Point2[]=[];let a=input.at(-1)!,da=values.get(a)!-limit;
        for(const b of input){const db=values.get(b)!-limit;
          if((da<=0)!==(db<=0)){const t=da/(da-db),p:Point2=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];values.set(p,limit);result.push(p);}
          if(bank?db<=0:db>=0)result.push(b);a=b;da=db;
        }return result;
      };
      const bank=split(poly,true),height=(p:Point2)=>{
        const ground=sampleElevation(city,...p),t=Math.min(1,(values.get(p)??shore.distance(...p))/shore.width),blend=t*t*(3-2*t);
        return ground+Math.max(0,flatHeight-ground)*blend+.026;
      };
      for(const part of uncoveredBank(city,bank))emitTriangles(part,true,height);
      poly=split(poly,false);
    }
    // Intersect each DEM face with a horizontal water plane. A bank can rise
    // through the surface, but must never pull the water's vertices uphill.
    if(water&&flatHeight!==undefined&&poly.length){
      const out:Point2[]=[];let a=poly.at(-1)!,da=sampleElevation(city,...a)-flatHeight;
      for(const b of poly){const db=sampleElevation(city,...b)-flatHeight;
        if((da<=0)!==(db<=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
        if(db<=0)out.push(b);a=b;da=db;
      }poly=out;
    }
    for(const part of water?uncoveredWater(city,poly,flatHeight):[poly])emitTriangles(part);
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
    if(flatHeight!==undefined&&!water){emit(triangle);continue;}
    const minX=Math.floor((Math.min(...triangle.map(p=>p[0]))-ox)/cell),maxX=Math.floor((Math.max(...triangle.map(p=>p[0]))-ox)/cell);
    const minZ=Math.floor((Math.min(...triangle.map(p=>p[1]))-oz)/cell),maxZ=Math.floor((Math.max(...triangle.map(p=>p[1]))-oz)/cell);
    for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){
      const x=ox+ix*cell,z=oz+iz*cell;
      let polygon=clip(triangle,-1,0,-x);polygon=clip(polygon,1,0,x+cell);polygon=clip(polygon,0,-1,-z);polygon=clip(polygon,0,1,z+cell);
      if(polygon.length<3)continue;
      const faces=[clip(polygon,1,1,x+z+cell),clip(polygon,-1,-1,-x-z-cell)];
      if(shore&&shore.distance(x+cell/2,z+cell/2)<shore.width+SHORE_FADE+cell){
        // Only the shoreline needs sub-metre sampling. Keep the DEM's exact
        // diagonals, and use a world-aligned lattice on both sides of tile seams.
        const count=Math.ceil(cell/.75),step=cell/count;
        for(const face of faces){if(face.length<3)continue;
          for(let j=0;j<count;j++)for(let k=0;k<count;k++){
            let part=clip(face,-1,0,-x-j*step);part=clip(part,1,0,x+(j+1)*step);part=clip(part,0,-1,-z-k*step);part=clip(part,0,1,z+(k+1)*step);
            if(part.length>=3)emit(part);
          }
        }
      }else for(const face of faces)emit(face);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  if(water){const edge=new Float32Array(positions.length/3);for(let i=0;i<edge.length;i++)edge[i]=shore?Math.max(0,Math.min(1,(shore.distance(positions[i*3],positions[i*3+2])-shore.width)/Math.min(SHORE_FADE,shore.width/3))):1;g.setAttribute('waterEdge',new THREE.BufferAttribute(edge,1));}
  g.computeVertexNormals();g.computeBoundingSphere();return g;
}
