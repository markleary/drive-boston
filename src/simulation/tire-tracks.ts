import type {CityData,DriveInput,Point2} from '../types';
import type {CityTile} from './tile-format.ts';
import {pavementEdges} from './tile-format.ts';
import {pointInside} from './roads.ts';
import {roadProjection,sampleDriveSurface} from './road-surfaces.ts';

export type TireSurface='pavement'|'grass';
export interface TireContact {
  wheel:number; x:number; y:number; z:number;
  normal:{x:number;y:number;z:number}; width:number; intensity:number;
}
export const TRACK_LIFETIME={pavement:24,grass:35};
export function tireSlipIntensity(input:DriveInput,speed:number,lateralSpeed:number,rear:boolean,bike=false){
  const v=Math.abs(speed),reverse=input.throttle*speed<-.4;
  const brake=Math.max(input.brake,reverse?.8:0,input.handbrake&&(rear||bike)?1:0);
  const stopping=v>3?Math.max(0,(brake-.55)/.45)*Math.min(1,(v-3)/4):0;
  const sliding=Math.hypot(speed,lateralSpeed)>2?Math.max(0,(Math.abs(lateralSpeed)-1.5)/3):0;
  return Math.min(1,Math.max(stopping,sliding));
}

const AREA_CELL=256,LINE_CELL=128;
type Area={rings:Point2[][];surface:TireSurface|null;minX:number;maxX:number;minZ:number;maxZ:number};
class SurfaceIndex {
  private cells=new Map<string,Area[]>();
  add(rings:Point2[][],surface:TireSurface|null){
    if(!rings[0]?.length)return;
    const a:Area={rings,surface,minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
    for(const p of rings[0]){a.minX=Math.min(a.minX,p[0]);a.maxX=Math.max(a.maxX,p[0]);a.minZ=Math.min(a.minZ,p[1]);a.maxZ=Math.max(a.maxZ,p[1]);}
    for(let x=Math.floor(a.minX/AREA_CELL);x<=Math.floor(a.maxX/AREA_CELL);x++)for(let z=Math.floor(a.minZ/AREA_CELL);z<=Math.floor(a.maxZ/AREA_CELL);z++){
      const key=`${x},${z}`,list=this.cells.get(key)??[];list.push(a);this.cells.set(key,list);
    }
  }
  at(x:number,z:number){return(this.cells.get(`${Math.floor(x/AREA_CELL)},${Math.floor(z/AREA_CELL)}`)??[]).filter(a=>x>=a.minX&&x<=a.maxX&&z>=a.minZ&&z<=a.maxZ&&pointInside([x,z],a.rings[0])&&!a.rings.slice(1).some(r=>pointInside([x,z],r)));}
}

/** Use the same curb-bounded polygons as the renderer; a park's paved paths,
 * driveways, sidewalks and islands take precedence over its lawn. */
export function createTireSurfaceSampler(city:CityData,tiles:()=>Iterable<CityTile>=()=>[]){
  const areas=new SurfaceIndex(),cached=new WeakMap<CityTile,SurfaceIndex>();
  let lastTiles:CityTile[]=[],measured=new Set<string>();
  for(const p of city.parks??[])areas.add(p.rings,/plaza|copley square/i.test(p.name)||/Malls, Squares/i.test(p.kind??'')?'pavement':'grass');
  for(const w of city.water??[])areas.add(w.rings,null);
  // Roads/paths are indexed by segment so each wheel only visits nearby lines.
  const lines=new Map<string,{points:Point2[];width:number;id:string;elevated:boolean}[]>();
  for(const r of [...(city.roads??[]),...(city.parkPaths??[])]){
    const entry={points:r.points,width:r.width+('oneway' in r?5.8:0),id:r.id,elevated:'elevations' in r&&!!r.elevations},keys=new Set<string>();
    for(let i=1;i<r.points.length;i++){
      const a=r.points[i-1],b=r.points[i],radius=entry.width/2;
      for(let x=Math.floor((Math.min(a[0],b[0])-radius)/LINE_CELL);x<=Math.floor((Math.max(a[0],b[0])+radius)/LINE_CELL);x++)for(let z=Math.floor((Math.min(a[1],b[1])-radius)/LINE_CELL);z<=Math.floor((Math.max(a[1],b[1])+radius)/LINE_CELL);z++)keys.add(`${x},${z}`);
    }
    for(const key of keys){const list=lines.get(key)??[];list.push(entry);lines.set(key,list);}
  }
  return(x:number,y:number,z:number):TireSurface|null=>{
    const support=sampleDriveSurface(city,x,z,y+.15);
    if(Math.abs(support.height-y)>.4)return null; // Roofs, traffic and other raised objects aren't lawns.
    if(support.road)return'pavement';
    const resident=[...tiles()];
    if(resident.length!==lastTiles.length||resident.some((tile,i)=>tile!==lastTiles[i])){
      measured=new Set(resident.flatMap(tile=>tile.pavements.map(p=>p.road)));lastTiles=resident;
    }
    for(const tile of resident){
      let index=cached.get(tile);
      if(!index){
        index=new SurfaceIndex();
        for(const p of tile.pavements){
          const {left,right}=pavementEdges(tile,p);
          const band=(edge:Point2[],other:Point2[])=>edge.map((p,i):Point2=>{const dx=p[0]-other[i][0],dz=p[1]-other[i][1],scale=2.9/(Math.hypot(dx,dz)||1);return[p[0]+dx*scale,p[1]+dz*scale];});
          const outerLeft=p.walk?.[0]?left:band(left,right),outerRight=p.walk?.[1]?right:band(right,left);
          for(let i=1;i<left.length;i++)index.add([[outerLeft[i-1],outerLeft[i],outerRight[i],outerRight[i-1]]],'pavement');
        }
        for(const rings of [...tile.driveways,...tile.islands,...tile.sidewalks.map(w=>w.rings)])index.add(rings,'pavement');
        cached.set(tile,index);
      }
      if(index.at(x,z).length)return'pavement';
      for(const p of tile.parkPaths)if(roadProjection(p,x,z).distance<=p.width/2)return'pavement';
    }
    for(const line of lines.get(`${Math.floor(x/LINE_CELL)},${Math.floor(z/LINE_CELL)}`)??[]){
      if(line.elevated||measured.has(line.id))continue;
      if(roadProjection(line,x,z).distance<=line.width/2)return'pavement';
    }
    const hits=areas.at(x,z);if(hits.some(a=>a.surface===null))return null;
    // The base terrain uses the grass material even outside mapped parks.
    return hits.find(a=>a.surface==='pavement')?.surface??hits[0]?.surface??'grass';
  };
}
