import type {CityData,Point2,Road} from '../types';
import {sampleElevation} from '../simulation/terrain.ts';
import {deckEdge} from '../simulation/road-surfaces.ts';
import {footbridgeRoad} from '../simulation/footbridges.ts';

type Cutout={points:Point2[];minX:number;maxX:number;minZ:number;maxZ:number;minimumWaterLevel?:number};
const indexes=new WeakMap<CityData,Map<string,Cutout[]>>(),bankIndexes=new WeakMap<CityData,Map<string,Cutout[]>>(),CELL=64;
/** Hydro outlines sometimes include the paved riverbank and its underpass.
 * Remove those pavement footprints from water, including low source decks at
 * their ground landings. Keep water beneath genuinely elevated crossings. */
function index(city:CityData,banks=false){
  const cache=banks?bankIndexes:indexes;let cells=cache.get(city);if(cells)return cells;cells=new Map();
  const corridors:{road:Road;margin:number;kind:'road'|'path'|'approach'}[]=city.roads.map(road=>({road,margin:road.elevations?.3:6.1,kind:'road'}));
  for(const path of city.parkPaths??[]){
    const bridge=footbridgeRoad(city,path);
    if(banks)corridors.push({road:bridge??{id:path.id,points:path.points,width:path.width,name:'Park path',oneway:0},margin:.1,kind:'path'});
    else if(bridge)corridors.push({road:bridge,margin:.3,kind:'approach'});
  }
  for(const {road,margin,kind} of corridors){
    const expanded={...road,width:road.width+margin,deckWidths:road.deckWidths?.map(w=>w+margin)};
    for(let i=1;i<road.points.length;i++){
      const points=[deckEdge(expanded,i-1,-1),deckEdge(expanded,i-1,1),deckEdge(expanded,i,1),deckEdge(expanded,i,-1)];
      if(road.elevations&&kind==='road'){
        // Only clip an elevated ribbon where it actually merges with the bank.
        // A bridge can have two ground-level ends and still span deep water.
        const probes=[...points,road.points[i-1],road.points[i]],low=Math.min(road.elevations[i-1],road.elevations[i]);
        if(probes.every(p=>low-sampleElevation(city,...p)>.25))continue;
      }
      const area=points.reduce((n,p,j)=>{const q=points[(j+1)%4];return n+p[0]*q[1]-q[0]*p[1];},0);if(Math.abs(area)<.0001)continue;if(area<0)points.reverse();
      const cutout={points,minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minZ:Math.min(...points.map(p=>p[1])),maxZ:Math.max(...points.map(p=>p[1])),minimumWaterLevel:kind==='approach'?Math.min(road.elevations![i-1],road.elevations![i])-.1:undefined};
      for(let x=Math.floor(cutout.minX/CELL);x<=Math.floor(cutout.maxX/CELL);x++)for(let z=Math.floor(cutout.minZ/CELL);z<=Math.floor(cutout.maxZ/CELL);z++){const key=`${x},${z}`,list=cells.get(key)??[];list.push(cutout);cells.set(key,list);}
    }
  }
  cache.set(city,cells);return cells;
}
function clip(poly:Point2[],nx:number,nz:number,limit:number){
  const out:Point2[]=[];if(!poly.length)return out;let a=poly.at(-1)!,da=a[0]*nx+a[1]*nz-limit;
  for(const b of poly){const db=b[0]*nx+b[1]*nz-limit;if((da<=0)!==(db<=0)){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}if(db<=0)out.push(b);a=b;da=db;}return out;
}
function uncovered(city:CityData,poly:Point2[],banks=false,flatHeight?:number){
  if(poly.length<3)return[];const cells=index(city,banks),minX=Math.min(...poly.map(p=>p[0])),maxX=Math.max(...poly.map(p=>p[0])),minZ=Math.min(...poly.map(p=>p[1])),maxZ=Math.max(...poly.map(p=>p[1]));
  const candidates=new Set<Cutout>();
  for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++)for(const c of cells.get(`${x},${z}`)??[])if(c.maxX>=minX&&c.minX<=maxX&&c.maxZ>=minZ&&c.minZ<=maxZ&&(c.minimumWaterLevel===undefined||flatHeight!==undefined&&flatHeight>=c.minimumWaterLevel))candidates.add(c);
  let pieces=[poly];
  for(const c of candidates){
    const outside:Point2[][]=[];
    for(const piece of pieces){
      let inside=piece;
      for(let i=0;i<c.points.length&&inside.length>=3;i++){
        const a=c.points[i],b=c.points[(i+1)%c.points.length],nx=b[1]-a[1],nz=a[0]-b[0],limit=nx*a[0]+nz*a[1];
        const part=clip(inside,-nx,-nz,-limit);if(part.length>=3)outside.push(part);inside=clip(inside,nx,nz,limit);
      }
    }
    pieces=outside;if(!pieces.length)break;
  }
  return pieces;
}
export function uncoveredWater(city:CityData,poly:Point2[],flatHeight?:number){return uncovered(city,poly,false,flatHeight);}
/** Raised shoreline must not bury ground paths or protrude through footbridge
 * slabs. Water itself still continues beneath elevated pedestrian crossings. */
export function uncoveredBank(city:CityData,poly:Point2[]){return uncovered(city,poly,true);}
