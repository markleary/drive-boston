import {NPC_VEHICLES,type NPCVehicleSpec} from './npc-vehicle-specs.ts';

/** Cars parked in the surface lots. build-street-surfaces.py lays every lot's stalls out
 * (scripts/parking_lots.py, the tile header's `parking`); a fixed share of them is occupied, the same ones on
 * every visit, and the cars of the stalls nearest the player are drawn from a small pool (src/render/parking-lots.ts). */
export interface Stall {x:number;z:number;/** Vehicle yaw of a car parked nose in. */yaw:number}
export interface ParkedCar extends Stall {spec:NPCVehicleSpec;color:number;key:string}
/** Share of the stalls that hold a car. */
export const OCCUPANCY=.58;
/** No box trucks in a car park: the passenger types, the everyday ones twice as likely. */
const TYPES=['compact','sedan','compact','sedan','minivan','pickup'] as const;

/** The stalls of a tile, in world metres. */
export function tileStalls(tile:{tx:number;tz:number;size:number;parking?:number[]}):Stall[]{
  const p=tile.parking??[],ox=tile.tx*tile.size,oz=tile.tz*tile.size,out:Stall[]=[];
  for(let i=0;i+2<p.length;i+=3)out.push({x:ox+p[i]/100,z:oz+p[i+1]/100,yaw:p[i+2]/100*Math.PI/180});
  return out;
}
/** Four independent values in [0, 1) from a stall's place: whether it is taken, the car's type, its paint and which way it faces. */
export function stallDraw(x:number,z:number){
  let h=(Math.imul(Math.round(x*100),374761393)^Math.imul(Math.round(z*100),668265263))>>>0;
  const next=()=>{h=Math.imul(h^(h>>>13),1274126177)>>>0;h=(h^(h>>>16))>>>0;return h/4294967296;};
  return [next(),next(),next(),next()] as const;
}
/** The car standing in a stall, or undefined when it is empty. One in eight is backed in. A van or a truck takes
 * a stall as it is; nothing longer than the stall is parked. */
export function parkedCar(stall:Stall):ParkedCar|undefined{
  const [taken,type,paint,turn]=stallDraw(stall.x,stall.z);if(taken>=OCCUPANCY)return undefined;
  const spec=NPC_VEHICLES.find(s=>s.type===TYPES[Math.floor(type*TYPES.length)])!;
  return{...stall,yaw:turn<.125?stall.yaw+Math.PI:stall.yaw,spec,color:spec.colors[Math.floor(paint*spec.colors.length)],key:`${Math.round(stall.x*100)},${Math.round(stall.z*100)}`};
}
/** The `count` parked cars nearest (x, z) within `radius`, nearest first. */
export function nearestParked(cars:readonly ParkedCar[],x:number,z:number,count:number,radius:number){
  const r2=radius*radius,near:[number,ParkedCar][]=[];
  for(const car of cars){const d=(car.x-x)**2+(car.z-z)**2;if(d<=r2)near.push([d,car]);}
  near.sort((a,b)=>a[0]-b[0]||(a[1].key<b[1].key?-1:1));return near.slice(0,count).map(([,car])=>car);
}
/** Half the width of a stall and the length of the line painted along each of its sides (scripts/parking_lots.py STALL). */
export const STALL_HALF=1.3,STALL_LINE=4.9;
/** The painted lines of a tile's stalls: [x0, z0, x1, z1] in world metres, one along each side of every stall,
 * the line two neighbours share once (stalls in a row stand a stall's width apart, so their side lines coincide). */
export function stallLines(stalls:readonly Stall[]):[number,number,number,number][]{
  const seen=new Set<string>(),out:[number,number,number,number][]=[];
  for(const s of stalls){
    const fx=Math.sin(s.yaw),fz=Math.cos(s.yaw),rx=fz,rz=-fx;
    for(const side of [-1,1]){
      const cx=s.x+rx*side*STALL_HALF,cz=s.z+rz*side*STALL_HALF,key=`${Math.round(cx*4)},${Math.round(cz*4)}`;
      if(seen.has(key))continue;seen.add(key);
      out.push([cx-fx*STALL_LINE/2,cz-fz*STALL_LINE/2,cx+fx*STALL_LINE/2,cz+fz*STALL_LINE/2]);
    }
  }
  return out;
}
