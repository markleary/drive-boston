import type {CityData,Point2,Road} from '../types';
import {tunnelCoveredAt,tunnelStations} from './tunnels.ts';

/** Tree crowns as the foliage field draws them: `reach` is the widest
 * horizontal extent from the trunk (leaf-card corners included) and `top` the
 * highest point above the trunk base, over every distance level (the far
 * levels use larger cards) at the largest instance scale: street trees 1.12
 * over three species, park specimens 1.65 x 1.12 over four. A node test checks
 * them against crownExtent() in src/render/foliage.ts. */
export interface Canopy{reach:number;top:number;}
export const STREET_CANOPY:Canopy={reach:7.6,top:18};
export const PARK_CANOPY:Canopy={reach:12.5,top:29.5};

type DeckSegment={road:Road;a:Point2;b:Point2;ya:number;yb:number;sa:number;sb:number;half:number};
const CELL=64,indexes=new WeakMap<Road[],Map<string,DeckSegment[]>>();
function index(city:Pick<CityData,'roads'>){
  let cells=indexes.get(city.roads);if(cells)return cells;cells=new Map();
  for(const road of city.roads){
    if(!road.elevations)continue;const stations=tunnelStations(road);
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],half=Math.max(road.width,road.deckWidths?.[i-1]??0,road.deckWidths?.[i]??0)/2,m=half+PARK_CANOPY.reach;
      const segment:DeckSegment={road,a,b,ya:road.elevations[i-1],yb:road.elevations[i],sa:stations[i-1],sb:stations[i],half};
      for(let x=Math.floor((Math.min(a[0],b[0])-m)/CELL);x<=Math.floor((Math.max(a[0],b[0])+m)/CELL);x++)for(let z=Math.floor((Math.min(a[1],b[1])-m)/CELL);z<=Math.floor((Math.max(a[1],b[1])+m)/CELL);z++){
        const k=`${x},${z}`,list=cells.get(k);if(list)list.push(segment);else cells.set(k,[segment]);
      }
    }
  }
  indexes.set(city.roads,cells);return cells;
}

/** True where a tree standing at (x, ground, z) would reach into a raised road
 * deck (bridge, viaduct or open Central Artery ramp): the deck passes over the
 * crown's footprint between 1 m above the trunk base and just over the crown
 * top. A deck within a metre of the ground keeps only its own pavement clear,
 * a deck below the ground (an open trench) and a covered tunnel never block. */
export function canopyHitsDeck(city:Pick<CityData,'roads'>,x:number,z:number,ground:number,canopy:Canopy){
  for(const s of index(city).get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[]){
    const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=Math.max(0,Math.min(1,((x-s.a[0])*dx+(z-s.a[1])*dz)/(dx*dx+dz*dz||1)));
    const distance=Math.hypot(x-s.a[0]-t*dx,z-s.a[1]-t*dz);if(distance>=s.half+canopy.reach)continue;
    if(s.road.tunnel&&tunnelCoveredAt(s.road,s.sa+(s.sb-s.sa)*t))continue;
    const rise=s.ya+(s.yb-s.ya)*t-ground;
    if(rise>1?rise<canopy.top+1:rise>-1&&distance<s.half+.8)return true;
  }
  return false;
}
