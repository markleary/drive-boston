/** Node-test access to the tiled metro package in public/data.
 *
 * `loadMetroCity()` resolves city.json with its sidecars exactly as the game
 * does (graded elevation grid, far hulls, building index) and additionally
 * loads the tiles intersecting a window so `city.buildings` holds the surveyed
 * metadata there and `city.geometry` the quantized shells. `windowCity()` then
 * cuts a legacy-shaped whole-city object (own elevation grid, roads, buildings,
 * curbs...) out of it, the form the physics, traffic, grading and street-life
 * modules take as a single piece. The default window is the original central
 * study area, where every long-standing fixture lives. */
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {resolveCity,loadTile,isMetroCity} from '../../src/simulation/city-tiles.ts';
import {decodeElevation,tileKey} from '../../src/simulation/tile-format.ts';
import {meshBuildingIds} from '../../src/simulation/building-collisions.ts';
import {addSourceFooting} from '../../src/render/source-footings.ts';
import {tileShellGeometry,tileSourceGeometry,tileCollisionIndices} from '../../src/render/tile-geometry.ts';

export const DATA_DIR=new URL('../../public/data/',import.meta.url);
/** Mission Hill through Chinatown: the original connected central city. */
export const CENTRAL={minX:-3400.365,maxX:2306.061,minZ:-1608.789,maxZ:2695.497};

const exact=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
export const read=async name=>exact(readFileSync(new URL(name,DATA_DIR)));
export const readJson=name=>JSON.parse(readFileSync(new URL(name,DATA_DIR),'utf8'));
export const hasMetroData=()=>existsSync(new URL('far.bin',DATA_DIR));

/** Tile keys whose square intersects a window. */
export function tilesIn(city,bounds){
  const size=city.tiles.size,keys=new Set(city.tiles.keys),out=[];
  for(let tx=Math.floor(bounds.minX/size);tx<=Math.floor(bounds.maxX/size);tx++)for(let tz=Math.floor(bounds.minZ/size);tz<=Math.floor(bounds.maxZ/size);tz++){const key=tileKey(tx,tz);if(keys.has(key))out.push(key);}
  return out;
}

export async function loadMetroCity({bounds=CENTRAL,tiles}={}){
  const city=await resolveCity(readJson('city.json'),read);
  if(!isMetroCity(city))throw new Error('public/data/city.json is not a tiled metro package');
  city.geometry=new Map();city.loadedTiles=new Map();
  for(const key of tiles??tilesIn(city,bounds)){
    const [tx,tz]=key.split('_').map(Number),tile=await loadTile(city,tx,tz,read);
    city.loadedTiles.set(key,tile);
    for(const b of tile.buildings){city.buildings.push(b);city.geometry.set(b.id,tile.geometry.get(b.id));}
    city.curbs.push(...tile.curbs);city.parkPaths.push(...tile.parkPaths);
  }
  return city;
}

/** The ungraded USGS grid that grade-terrain.mjs kept beside the graded one. */
export function rawHeights(city){
  const grid=city.elevation;if(!grid.source)throw new Error('city.json records no elevation.source grid');
  return decodeElevation(exact(gunzipSync(readFileSync(new URL(grid.source,DATA_DIR)))),grid.scale??.01);
}

/** A whole-city view of one window: its own elevation grid (a copy, so grading it
 * in a test touches nothing else), the roads, buildings, curbs, signals, paths,
 * parks, water and landmarks inside, and none of the streaming fields. */
export function windowCity(city,bounds=CENTRAL,{pad=60,heights=city.elevation.heights}={}){
  const grid=city.elevation,cs=grid.cellSize;
  const i0=Math.max(0,Math.floor((bounds.minX-pad-grid.originX)/cs)),i1=Math.min(grid.width,Math.ceil((bounds.maxX+pad-grid.originX)/cs)+1);
  const j0=Math.max(0,Math.floor((bounds.minZ-pad-grid.originZ)/cs)),j1=Math.min(grid.height,Math.ceil((bounds.maxZ+pad-grid.originZ)/cs)+1);
  const w=i1-i0,h=j1-j0,out=new Float32Array(w*h);
  for(let j=j0;j<j1;j++)out.set(heights.subarray(j*grid.width+i0,j*grid.width+i1),(j-j0)*w);
  const inside=p=>p[0]>=bounds.minX&&p[0]<=bounds.maxX&&p[1]>=bounds.minZ&&p[1]<=bounds.maxZ;
  const {tiles,far,index,landmarkBuildings,geometry,loadedTiles,...rest}=city;
  const elevation={width:w,height:h,cellSize:cs,originX:grid.originX+i0*cs,originZ:grid.originZ+j0*cs,heights:out};
  if(heights===city.elevation.heights&&grid.graded){elevation.graded=true;elevation.grading=grid.grading;}
  return {...rest,bounds:{...bounds},elevation,
    roads:city.roads.filter(r=>r.points.some(inside)),buildings:city.buildings.filter(b=>inside(b.center)),
    signals:city.signals.filter(inside),curbs:city.curbs.filter(c=>c.some(inside)),parkPaths:city.parkPaths.filter(p=>p.points.some(inside)),
    parks:city.parks.filter(a=>a.rings[0].some(inside)),water:city.water.filter(a=>a.rings[0].some(inside)),landmarks:city.landmarks.filter(l=>inside(l.position))};
}

/** Shortcut for the common fixture: the central window of the graded package, with its buildings' shells kept on `geometry`. */
export async function loadCentralCity(options){
  const metro=await loadMetroCity(options),city=windowCity(metro,options?.bounds);city.geometry=metro.geometry;city.metro=metro;return city;
}

/** One building part as the renderer builds it from its tile shell. */
export function shellGeometry(city,id,roof=false){
  const data=city.geometry?.get(id),building=city.buildings.find(b=>b.id===id);
  if(!data||!building)throw new Error(`${id} is not in a loaded tile`);
  return tileShellGeometry(data,building,roof);
}

/** Exact-mesh landmark collision and footings, as the tile builder installs them. Returns the ids installed. */
export function installExactMeshes(physics,city,scene=new THREE.Group()){
  const installed=new Set();
  for(const id of meshBuildingIds){
    const data=city.geometry?.get(id),building=city.buildings.find(b=>b.id===id);if(!data||!building)continue;
    physics.addStaticMesh(data.positions,tileCollisionIndices(data));
    const source=tileSourceGeometry(data),footing=building.structure?undefined:addSourceFooting(scene,city,building,source);
    if(footing)physics.addStaticMesh(footing.vertices,footing.indices);
    source.dispose();installed.add(id);
  }
  return installed;
}
