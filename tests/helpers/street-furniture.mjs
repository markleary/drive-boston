/** The street furniture and the sidewalk walks of the installed package, planned as the game plans them, and the
 * ground they must keep off read straight from the tiles' polygons. Shared by tests/street-furniture.test.mjs and
 * scripts/audit-street-furniture.mjs. */
import {roadCells} from '../../src/simulation/road-cells.ts';
import {tileFurnitureSteps} from '../../src/simulation/street-furniture.ts';
import {planTileSignals,SIGNAL_HEADS} from '../../src/simulation/signal-placement.ts';
import {roadWidthAt,sampleRoadElevation} from '../../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../../src/simulation/terrain.ts';
import {openStretches} from '../../src/simulation/motorway.ts';
import {reserveTransitCorridors} from '../../src/simulation/transit-corridors.ts';
import {STALL_DEPTH,STALL_HALF,tileStalls} from '../../src/simulation/parking-lots.ts';
import {insideIcaForecourt} from '../../src/render/ica-boston.ts';
import {loadMetroCity,readJson} from './metro-city.mjs';

/** The metro as main.ts hands it to the tile builder: resolved, with the rail corridors reserved. */
export async function loadStreetCity(options={tiles:[]}){
  const city=await loadMetroCity(options);reserveTransitCorridors(city,readJson('transit.json').routes);return city;
}
export const roadIndex=city=>roadCells(city.roads);
/** The trees, lamps, name signs and posts of a tile, exactly as src/render/tile-builder.ts plans them. */
export function tileFurniture(city,tile,roads=roadIndex(city)){
  const steps=tileFurnitureSteps(city,tile,roads,insideIcaForecourt);let step=steps.next();while(!step.done)step=steps.next();return step.value;
}
/** The signal masts of a tile, exactly as src/render/tile-builder.ts plans them once the tile's furniture is planted. */
export const tileSignals=(city,tile,roads=roadIndex(city),furniture=tileFurniture(city,tile,roads))=>planTileSignals(city,tile,roads,furniture.posts);
/** Where the two signal heads of a mast hang, as src/render/traffic-signals.ts draws them: SIGNAL_HEADS back from the tip of its arm. */
export const signalHeads=mast=>SIGNAL_HEADS.map(back=>[mast.position[0]+Math.sin(mast.armYaw)*(mast.armLength-back),mast.position[1]+Math.cos(mast.armYaw)*(mast.armLength-back)]);
const offLine=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);};
/** Whether a point lies over the deck of a raised road, which no tile draws as street pavement: within the road's own
 * width of its line, every road about the point tried segment by segment (`roads`: roadIndex(city)). */
export function deckGround(roads){
  return (x,z)=>roads.near({minX:x-40,maxX:x+40,minZ:z-40,maxZ:z+40}).some(road=>road.elevations&&road.points.some((p,i)=>i>0&&offLine(x,z,road.points[i-1],p)<roadWidthAt(road,x,z)/2));
}
/** The open stretches of the tunnel records (a highway's walled cut, a ramp on its way up to a viaduct), which the
 * tunnel builder draws and no tile lists as street pavement. For a point within the pavement of one: how far that
 * road lies over the terrain there (negative in a cut, the least of several); undefined anywhere else. Every record
 * about the point is tried segment by segment, with no index but the roads' own (`roads`: roadIndex(city)). */
export function openStretchGround(city,roads){
  const open=new Map(),stretches=road=>{let lines=open.get(road);if(!lines){lines=openStretches(road);open.set(road,lines);}return lines;};
  return (x,z)=>{
    let rise;
    for(const road of roads.near({minX:x-40,maxX:x+40,minZ:z-40,maxZ:z+40})){
      if(!road.tunnel||!stretches(road).some(line=>line.some((p,i)=>i>0&&offLine(x,z,line[i-1],p)<roadWidthAt(road,x,z)/2)))continue;
      const over=sampleRoadElevation(city,road,x,z)-sampleElevation(city,x,z);rise=rise===undefined?over:Math.min(rise,over);
    }
    return rise;
  };
}
/** Everything a tile stands beside its streets: its furniture, its signal masts, and `posts`, the list the built tile keeps of them all. */
export function tileStreetside(city,tile,roads=roadIndex(city)){
  const furniture=tileFurniture(city,tile,roads),signals=tileSignals(city,tile,roads,furniture);
  return {...furniture,masts:signals,posts:[...furniture.posts,...signals.map(signal=>signal.position)]};
}
/** The resident tiles as the streamer lists them to the street life: each tile with the posts it planted. */
export function residentTiles(city,tiles,roads=roadIndex(city)){
  const loaded=new Map();for(const [key,tile] of tiles)loaded.set(key,{tile,posts:tileStreetside(city,tile,roads).posts});return {loaded};
}

/** The ground as the tiles draw it, read from their polygons edge by edge with no index of any kind, so that it
 * checks what src/simulation/drawn-streets.ts answers as much as what the planters did with it. `tiles`: every tile
 * a point's surroundings can fall in (a place beside a border is tested against both tiles). */
export function drawnGround(tiles){
  const edges=new Map(),stalls=new Map();
  const edgesOf=key=>{
    let flat=edges.get(key);if(flat)return flat;
    const list=[];for(const rings of tiles.get(key)?.streetPavement??[])for(const ring of rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if(a[0]!==b[0]||a[1]!==b[1])list.push(a[0],a[1],b[0],b[1]);}
    flat=Float64Array.from(list);edges.set(key,flat);return flat;
  };
  const stallsOf=key=>{let list=stalls.get(key);if(!list){const tile=tiles.get(key);list=tile?tileStalls(tile):[];stalls.set(key,list);}return list;};
  const size=tiles.values().next().value?.size??1000;
  const about=(x,z,reach,test)=>{for(let tx=Math.floor((x-reach)/size);tx<=Math.floor((x+reach)/size);tx++)for(let tz=Math.floor((z-reach)/size);tz<=Math.floor((z+reach)/size);tz++)if(test(`${tx}_${tz}`))return true;return false;};
  /** Whether (x, z) lies in street pavement, or within `room` of it. */
  const roadway=(x,z,room=0)=>about(x,z,room,key=>{
    const e=edgesOf(key);let inside=false,near=false;
    for(let i=0;i<e.length&&!near;i+=4){
      const ax=e[i],az=e[i+1],bx=e[i+2],bz=e[i+3];
      if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
      if(room>0){const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));if((x-ax-t*dx)**2+(z-az-t*dz)**2<room*room)near=true;}
    }
    return inside||near;
  });
  /** Whether (x, z) lies in the painted box of a parking stall, or within `room` of it. */
  const stall=(x,z,room=0)=>about(x,z,Math.hypot(STALL_DEPTH/2,STALL_HALF)+room,key=>stallsOf(key).some(s=>{
    const dx=x-s.x,dz=z-s.z,sin=Math.sin(s.yaw),cos=Math.cos(s.yaw);return Math.abs(dx*sin+dz*cos)<STALL_DEPTH/2+room&&Math.abs(dx*cos-dz*sin)<STALL_HALF+room;
  }));
  return {roadway,stall};
}
/** Points along a walk, `step` apart at most, both ends included. */
export function alongWalk(route,step=.25){
  const n=Math.max(1,Math.ceil(route.length/step)),out=[];
  for(let i=0;i<=n;i++)out.push([route.start[0]+(route.end[0]-route.start[0])*i/n,route.start[1]+(route.end[1]-route.start[1])*i/n]);
  return out;
}
