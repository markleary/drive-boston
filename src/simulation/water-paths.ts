import data from '../data/water-paths.json' with {type:'json'};
import type {ParkPath,Point2} from '../types.ts';
import type {CityTile} from './tile-format.ts';

const paths=data.paths as ParkPath[];
const wayId=(id:string)=>/^osm-way-\d+/.exec(id)?.[0];
const replaced=new Set(paths.map(p=>wayId(p.id)));
/** Clip only at ownership seams, never at a park boundary in mid-crossing.
 * All pieces retain the complete profile, including source stair connections. */
export function restoreWaterPaths(tile:Pick<CityTile,'tx'|'tz'|'size'|'parkPaths'>){
  const x0=tile.tx*tile.size,z0=tile.tz*tile.size,x1=x0+tile.size,z1=z0+tile.size;
  const result=tile.parkPaths.filter(p=>p.elevations||!replaced.has(wayId(p.id)));
  for(const path of paths){
    if(tile.parkPaths.some(p=>p.elevations&&wayId(p.id)===wayId(path.id)))continue;
    const pieces:Point2[][]=[];let piece:Point2[]=[];
    for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1];let lo=0,hi=1;
      for(const [p,q]of [[-dx,a[0]-x0],[dx,x1-a[0]],[-dz,a[1]-z0],[dz,z1-a[1]]]){
        if(!p){if(q<0)hi=-1;continue;}
        if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);
      }
      if(hi<=lo){if(piece.length>1)pieces.push(piece);piece=[];continue;}
      const at=(t:number):Point2=>[a[0]+dx*t,a[1]+dz*t],start=at(lo),end=at(hi);
      // A line exactly on a boundary belongs to its positive-side tile only.
      if(start[0]===x1&&end[0]===x1||start[1]===z1&&end[1]===z1)continue;
      if(piece.length&&Math.hypot(piece.at(-1)![0]-start[0],piece.at(-1)![1]-start[1])>1e-6){pieces.push(piece);piece=[];}
      if(!piece.length)piece.push(start);piece.push(end);
    }
    if(piece.length>1)pieces.push(piece);
    pieces.forEach((points,i)=>result.push({...path,points,id:`${path.id}-${tile.tx}_${tile.tz}_${i}`}));
  }
  return result;
}
