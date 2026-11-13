import type {CityData,Point2,Road} from '../types';
import {tunnelCoveredAt,tunnelStations} from './tunnels.ts';

/** Tree crowns as the foliage field draws them: `reach` is the widest
 * horizontal extent from the trunk (leaf-card corners included) and `top` the
 * highest point above the trunk base, over every distance level (the far
 * levels use larger cards) at the largest instance scale: street trees 1.12
 * over five species, park specimens 1.65 x 1.12 over six. A node test checks
 * them against crownExtent() in src/render/foliage.ts. */
export interface Canopy{reach:number;top:number;}
export const STREET_CANOPY:Canopy={reach:7.6,top:18};
export const PARK_CANOPY:Canopy={reach:12.5,top:29.5};

type DeckSegment={road?:Road;a:Point2;b:Point2;ya:number;yb:number;sa:number;sb:number;half:number;/** The surveyed roadway's edges left and right of the centre line, where a deck on the ground has them. */left?:number;right?:number};
type DeckCity=Pick<CityData,'roads'|'footbridges'>;
const CELL=64,indexes=new WeakMap<Road[],{footbridges:DeckCity['footbridges'];cells:Map<string,DeckSegment[]>}>();
function index(city:DeckCity){
  const cached=indexes.get(city.roads);if(cached&&cached.footbridges===city.footbridges)return cached.cells;
  const cells=new Map<string,DeckSegment[]>();
  const add=(segment:DeckSegment)=>{
    const {a,b}=segment,m=segment.half+PARK_CANOPY.reach;
    for(let x=Math.floor((Math.min(a[0],b[0])-m)/CELL);x<=Math.floor((Math.max(a[0],b[0])+m)/CELL);x++)for(let z=Math.floor((Math.min(a[1],b[1])-m)/CELL);z<=Math.floor((Math.max(a[1],b[1])+m)/CELL);z++){
      const k=`${x},${z}`,list=cells.get(k);if(list)list.push(segment);else cells.set(k,[segment]);
    }
  };
  for(const road of city.roads){
    if(!road.elevations)continue;const stations=tunnelStations(road);
    for(let i=1;i<road.points.length;i++){
      const ea=road.roadway?.[i-1],eb=road.roadway?.[i],left=ea&&eb?Math.max(ea[0],eb[0]):undefined,right=ea&&eb?Math.max(ea[1],eb[1]):undefined;
      add({road,a:road.points[i-1],b:road.points[i],ya:road.elevations[i-1],yb:road.elevations[i],sa:stations[i-1],sb:stations[i],half:Math.max(road.width,road.deckWidths?.[i-1]??0,road.deckWidths?.[i]??0,2*(left??0),2*(right??0))/2,left,right});
    }
  }
  // A footbridge's deck, ramps and steps (the city lists them whichever tile holds the path): a crown keeps as clear of them as of a road's deck.
  for(const deck of city.footbridges??[])for(let i=1;i<deck.points.length;i++)add({a:deck.points[i-1],b:deck.points[i],ya:deck.elevations[i-1],yb:deck.elevations[i],sa:0,sb:0,half:deck.width/2});
  indexes.set(city.roads,{footbridges:city.footbridges,cells});return cells;
}

/** True where a tree standing at (x, ground, z) would reach into a raised deck
 * (a road's bridge, viaduct or open Central Artery ramp, or a footbridge the
 * city lists): the deck passes over the crown's footprint between 1 m above
 * the trunk base and just over the crown top. A deck within a metre of the
 * ground keeps only its own pavement clear (its whole surveyed roadway where
 * it has one, `Road.roadway`), a deck below the ground (an open
 * trench) and a covered tunnel never block. */
export function canopyHitsDeck(city:DeckCity,x:number,z:number,ground:number,canopy:Canopy){
  for(const s of index(city).get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[]){
    const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=Math.max(0,Math.min(1,((x-s.a[0])*dx+(z-s.a[1])*dz)/(dx*dx+dz*dz||1)));
    const distance=Math.hypot(x-s.a[0]-t*dx,z-s.a[1]-t*dz);if(distance>=s.half+canopy.reach)continue;
    if(s.road?.tunnel&&tunnelCoveredAt(s.road,s.sa+(s.sb-s.sa)*t))continue;
    const rise=s.ya+(s.yb-s.ya)*t-ground;
    if(rise>1){if(rise<canopy.top+1)return true;continue;}
    if(rise<=-1)continue;
    // on the ground a deck keeps its own pavement clear, and the whole surveyed roadway where the lanes are only part of it
    if(s.left===undefined||s.right===undefined){if(distance<s.half+.8)return true;continue;}
    const length=Math.hypot(dx,dz)||1,across=((x-s.a[0])*-dz+(z-s.a[1])*dx)/length,along=((x-s.a[0])*dx+(z-s.a[1])*dz)/length;
    if(along>-.8&&along<length+.8&&across<s.left+.8&&across>-s.right-.8)return true;
  }
  return false;
}
