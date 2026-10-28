#!/usr/bin/env node
/** Grade a whole-metro elevation grid for its roads, offline.
 *
 * Applies src/simulation/road-grading.ts (the same prepareRoadTerrain the game
 * runs at boot for the central city) to a metro build written by
 * scripts/build-metro.py. The solver allocates per-cell work arrays and per
 * road-crossed-triangle constraint objects, so the 8.4M-cell metro grid is
 * graded in square chunks: each chunk is a window of interior plus margin,
 * roads are clipped to the window (cut ends are never junctions or pins) and
 * neighbouring windows are blended across a short band inside the margin so
 * no step is left at a seam. Chunks run on a worker pool that shares the raw
 * grid through a SharedArrayBuffer; the main thread blends and writes.
 *
 * Output: <data-dir>/elevation.bin is overwritten with the graded grid (gzip,
 * int16 centimetres), the ungraded grid is kept as elevation-source.bin, and
 * city.json gains elevation.source / elevation.graded / elevation.grading.
 *
 *   node scripts/grade-terrain.mjs [--data-dir public/data] [--chunk 2000]
 *     [--margin 400] [--band 100] [--workers N] [--force]
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseFar } from '../src/simulation/far-format.ts';
import { prepareRoadTerrain } from '../src/simulation/road-grading.ts';

const USAGE=`usage: node scripts/grade-terrain.mjs [options]
  --data-dir <path>  metro build directory holding city.json, elevation.bin, far.bin (default public/data)
  --chunk <metres>   chunk interior size (default 2000)
  --margin <metres>  solver margin graded around every interior and discarded (default 400)
  --band <metres>    blend ramp beyond the interior edge, within the margin (default 100)
  --workers <n>      worker threads (default availableParallelism-1, capped at 10); a dense 2 km window
                     peaks near 0.5 GB of solver objects per worker, so lower this on a small machine
  --force            regrade a directory whose city.json already says elevation.graded`;
const DEFAULT_WORKERS=Math.max(1,Math.min(10,availableParallelism()-1));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function parseArgs(argv){
  const o={dataDir:'public/data',chunk:2000,margin:400,band:100,workers:DEFAULT_WORKERS,force:false};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],value=()=>{if(i+1>=argv.length)throw new Error(`${a} needs a value`);return argv[++i];};
    if(a==='--data-dir')o.dataDir=value();else if(a==='--chunk')o.chunk=Number(value());else if(a==='--margin')o.margin=Number(value());
    else if(a==='--band')o.band=Number(value());else if(a==='--workers')o.workers=Math.floor(Number(value()));else if(a==='--force')o.force=true;
    else if(a==='--help'||a==='-h'){console.log(USAGE);process.exit(0);}else throw new Error(`Unknown argument ${a}\n${USAGE}`);
  }
  for(const k of ['chunk','margin','band','workers'])if(!(o[k]>0))throw new Error(`--${k} must be a positive number`);
  if(o.band>o.margin)throw new Error('--band must not exceed --margin');
  return o;
}

// ---- input
export function loadCity(dataDir){
  const city=JSON.parse(readFileSync(path.join(dataDir,'city.json'),'utf8')),grid=city.elevation;
  if(!grid?.file)throw new Error('city.json has no elevation.file sidecar; grade-terrain only handles metro builds');
  if(grid.encoding!=='int16-gzip')throw new Error(`Unsupported elevation encoding ${grid.encoding}`);
  if(!city.tiles?.far)throw new Error('city.json has no tiles.far building file');
  return city;
}
const exact=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
/** Raw metre heights as Float32, in a SharedArrayBuffer so worker threads read the one copy. */
export function loadHeights(dataDir,grid,shared=true){
  const bytes=gunzipSync(readFileSync(path.join(dataDir,grid.file))),count=grid.width*grid.height;
  if(bytes.byteLength!==count*2)throw new Error(`${grid.file} holds ${bytes.byteLength} bytes, expected ${count*2} for ${grid.width}x${grid.height} int16`);
  const source=new Int16Array(exact(bytes)),heights=new Float32Array(shared?new SharedArrayBuffer(count*4):count),scale=grid.scale??.01;
  for(let i=0;i<count;i++)heights[i]=source[i]*scale;
  return heights;
}
/** Every metro building hull from far.bin, in the shape prepareRoadTerrain protects. */
export function loadBuildings(dataDir,city){
  const far=parseFar(exact(gunzipSync(readFileSync(path.join(dataDir,city.tiles.far))))),buildings=[];
  for(const tile of far.tiles.values())for(const b of tile.buildings)if(!b.fragment)buildings.push({center:b.center,footprint:b.footprint,height:b.height,baseElevation:b.base});
  return buildings;
}

// ---- chunk layout
/** Square interiors of about `chunk` metres tiling the grid exactly (the last row and column may be narrower),
 * each with a `margin` of solver context on every side clamped to the grid. All sizes in cells. */
export function planChunks(grid,{chunk,margin,band}){
  const nx=Math.max(1,Math.ceil(grid.width*grid.cellSize/chunk)),nz=Math.max(1,Math.ceil(grid.height*grid.cellSize/chunk));
  const cols=Math.ceil(grid.width/nx),rows=Math.ceil(grid.height/nz),pad=Math.ceil(margin/grid.cellSize),ramp=Math.ceil(band/grid.cellSize),chunks=[];
  for(let cz=0;cz<nz;cz++)for(let cx=0;cx<nx;cx++){
    const i0=cx*cols,i1=Math.min(grid.width,i0+cols),j0=cz*rows,j1=Math.min(grid.height,j0+rows);if(i0>=i1||j0>=j1)continue;
    chunks.push({index:chunks.length,cx,cz,i0,i1,j0,j1,x0:Math.max(0,i0-pad),x1:Math.min(grid.width,i1+pad),z0:Math.max(0,j0-pad),z1:Math.min(grid.height,j1+pad)});
  }
  return {chunks,cols,rows,pad,ramp,nx,nz};
}
/** A single window with the given interior cell rectangle, for ad hoc checks (seam comparisons). */
export function windowChunk(grid,i0,i1,j0,j1,pad){
  return {index:0,cx:0,cz:0,i0,i1,j0,j1,x0:Math.max(0,i0-pad),x1:Math.min(grid.width,i1+pad),z0:Math.max(0,j0-pad),z1:Math.min(grid.height,j1+pad)};
}

// ---- roads and buildings per window
const boxes=(items,points)=>{
  const out=new Float64Array(items.length*4);
  for(let n=0;n<items.length;n++){let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const [x,z]of points(items[n])){if(x<x0)x0=x;if(x>x1)x1=x;if(z<z0)z0=z;if(z>z1)z1=z;}out.set([x0,z0,x1,z1],n*4);}
  return out;
};
const hits=(b,n,r)=>b[n*4]<=r[2]&&b[n*4+2]>=r[0]&&b[n*4+1]<=r[3]&&b[n*4+3]>=r[1];
/** Liang-Barsky: the parameter range of segment a-b inside rect [x0,z0,x1,z1], or null. */
const clipSegment=(a,b,r)=>{
  let t0=0,t1=1;const dx=b[0]-a[0],dz=b[1]-a[1];
  for(const [p,q]of [[-dx,a[0]-r[0]],[dx,r[2]-a[0]],[-dz,a[1]-r[1]],[dz,r[3]-a[1]]]){
    if(p===0){if(q<0)return null;continue;}
    const t=q/p;if(p<0){if(t>t1)return null;if(t>t0)t0=t;}else{if(t<t0)return null;if(t<t1)t1=t;}
  }
  return t0<t1?[t0,t1]:null;
};
/** Split every road into the polyline pieces inside the window rectangle. A cut end is not a junction
 * (its node has one end) and never a pin: elevated pieces interpolate `elevations` along the cut and
 * take level 1 at a cut end, while a real end keeps the road's own level. Pieces under 1 m are dropped. */
export function clipRoads(roads,roadBoxes,rect){
  const out=[];
  for(let n=0;n<roads.length;n++){
    const road=roads[n],pts=road.points,last=pts.length-1;if(last<1||!hits(roadBoxes,n,rect))continue;
    const ev=road.elevations;let piece=null,part=0;
    const lerp=(i,t)=>[pts[i][0]+(pts[i+1][0]-pts[i][0])*t,pts[i][1]+(pts[i+1][1]-pts[i][1])*t];
    const close=endCut=>{
      if(!piece)return;let length=0;for(let i=1;i<piece.points.length;i++)length+=Math.hypot(piece.points[i][0]-piece.points[i-1][0],piece.points[i][1]-piece.points[i-1][1]);
      if(piece.points.length>=2&&length>=1){
        const r={id:`${road.id}#${part++}`,name:road.name,points:piece.points,width:road.width,oneway:road.oneway};
        if(ev){r.elevations=piece.elevations;r.startLevel=piece.startCut?1:road.startLevel;r.endLevel=endCut?1:road.endLevel;if(road.bridge)r.bridge=road.bridge;}
        out.push(r);
      }
      piece=null;
    };
    for(let i=0;i<last;i++){
      const span=clipSegment(pts[i],pts[i+1],rect);if(!span){close(true);continue;}
      const [t0,t1]=span;
      if(t0>0||!piece){close(true);piece={points:[lerp(i,t0)],elevations:ev?[ev[i]+(ev[i+1]-ev[i])*t0]:undefined,startCut:t0>0||i>0};}
      piece.points.push(lerp(i,t1));if(ev)piece.elevations.push(ev[i]+(ev[i+1]-ev[i])*t1);
      if(t1<1)close(true);
    }
    close(false);
  }
  return out;
}
export function buildContext(grid,heights,roads,buildings){
  return {grid,heights,roads,roadBoxes:boxes(roads,r=>r.points),buildings,buildingBoxes:boxes(buildings,b=>b.footprint)};
}
/** Grade one chunk window from the raw grid and return its graded heights (window-local, row-major). */
export function gradeChunk(ctx,c){
  const {grid}=ctx,W=grid.width,ww=c.x1-c.x0,wh=c.z1-c.z0,window=new Float32Array(ww*wh);
  for(let j=c.z0;j<c.z1;j++)window.set(ctx.heights.subarray(j*W+c.x0,j*W+c.x1),(j-c.z0)*ww);
  const rect=[grid.originX+c.x0*grid.cellSize,grid.originZ+c.z0*grid.cellSize,grid.originX+(c.x1-1)*grid.cellSize,grid.originZ+(c.z1-1)*grid.cellSize];
  const roads=clipRoads(ctx.roads,ctx.roadBoxes,rect),buildings=[];
  for(let n=0;n<ctx.buildings.length;n++)if(hits(ctx.buildingBoxes,n,rect))buildings.push(ctx.buildings[n]);
  // prepareRoadTerrain caches its result per city object, so every window is a fresh object.
  const sub={bounds:{minX:rect[0],maxX:rect[2],minZ:rect[1],maxZ:rect[3]},roads,buildings,elevation:{width:ww,height:wh,cellSize:grid.cellSize,originX:rect[0],originZ:rect[1],heights:window}};
  const stats=prepareRoadTerrain(sub),graded=new Set();
  for(const r of roads)if(!r.elevations)graded.add(r.id.slice(0,r.id.lastIndexOf('#')));
  return {heights:sub.elevation.heights,stats,roads:roads.length,gradedIds:[...graded],buildings:buildings.length};
}

// ---- seam blending
/** 1 over [lo,hi), falling linearly to 0 across `band` cells beyond either edge. */
export const ramp=(i,lo,hi,band)=>{const d=i<lo?lo-i:i>=hi?i-hi+1:0;return d>=band?0:1-d/band;};
export function blendChunk(accum,weight,grid,c,band,heights){
  const W=grid.width,ww=c.x1-c.x0,xa=Math.max(c.x0,c.i0-band),xb=Math.min(c.x1,c.i1+band),za=Math.max(c.z0,c.j0-band),zb=Math.min(c.z1,c.j1+band);
  for(let j=za;j<zb;j++){
    const wz=ramp(j,c.j0,c.j1,band);if(wz<=0)continue;const row=(j-c.z0)*ww-c.x0,base=j*W;
    for(let i=xa;i<xb;i++){const w=wz*ramp(i,c.i0,c.i1,band);if(w<=0)continue;accum[base+i]+=w*heights[row+i];weight[base+i]+=w;}
  }
}

// ---- worker pool
function runPool(o,grid,heights,roads,buildings,chunks,onResult){
  return new Promise((resolve,reject)=>{
    const queue=chunks.slice(),count=Math.max(1,Math.min(o.workers,chunks.length));let done=0,failed=false;
    const header={width:grid.width,height:grid.height,cellSize:grid.cellSize,originX:grid.originX,originZ:grid.originZ};
    const fail=error=>{if(failed)return;failed=true;for(const w of workers)w.terminate();reject(error);};
    const workers=[];
    for(let n=0;n<count;n++){
      const worker=new Worker(fileURLToPath(import.meta.url),{workerData:{grid:header,shared:heights.buffer,roads,buildings}});workers.push(worker);
      let retired=false;
      const feed=()=>{const c=queue.shift();if(c)worker.postMessage(c);else{retired=true;worker.terminate();}};
      worker.on('message',message=>{if(failed)return;onResult(message);feed();if(++done===chunks.length)resolve();});
      worker.on('error',fail);
      worker.on('exit',code=>{if(!retired&&code!==0)fail(new Error(`worker exited with code ${code}`));});
      feed();
    }
  });
}
if(!isMainThread&&workerData?.shared){
  const ctx=buildContext(workerData.grid,new Float32Array(workerData.shared),workerData.roads,workerData.buildings);
  parentPort.on('message',c=>{
    const began=performance.now(),result=gradeChunk(ctx,c),heights=result.heights instanceof Float32Array?result.heights:Float32Array.from(result.heights);
    parentPort.postMessage({index:c.index,heights,stats:result.stats,roads:result.roads,gradedIds:result.gradedIds,buildings:result.buildings,elapsedMs:performance.now()-began},[heights.buffer]);
  });
}

// ---- main
async function main(){
  const o=parseArgs(process.argv.slice(2)),began=performance.now(),city=loadCity(o.dataDir),grid=city.elevation;
  if(grid.graded&&!o.force)throw new Error(`${path.join(o.dataDir,'city.json')} already records elevation.graded; elevation.bin is a graded grid, so grading it again would compound the correction. Rebuild the metro first, or pass --force to grade anyway.`);
  const heights=loadHeights(o.dataDir,grid),buildings=loadBuildings(o.dataDir,city),count=grid.width*grid.height;
  const plan=planChunks(grid,o),{chunks}=plan,workers=Math.max(1,Math.min(o.workers,chunks.length));
  console.log(`grid ${grid.width}x${grid.height} cells at ${grid.cellSize} m, ${city.roads.length} roads, ${buildings.length} buildings`);
  console.log(`${chunks.length} chunks (${plan.nx}x${plan.nz} of ${plan.cols}x${plan.rows} cell interiors, margin ${plan.pad} cells, blend band ${plan.ramp} cells), ${workers} workers`);
  const accum=new Float64Array(count),weight=new Float32Array(count),gradedRoads=new Set();let profiles=0,chunkChanged=0,finished=0;
  await runPool({...o,workers},grid,heights,city.roads,buildings,chunks,message=>{
    const c=chunks[message.index];blendChunk(accum,weight,grid,c,plan.ramp,message.heights);profiles+=message.stats.roads;chunkChanged+=message.stats.changedVertices;for(const id of message.gradedIds)gradedRoads.add(id);
    console.log(`chunk ${++finished}/${chunks.length} (${c.cx},${c.cz}) ${message.roads} road pieces, ${message.buildings} buildings, ${message.stats.changedVertices} changed cells, cut ${message.stats.maxCut.toFixed(2)} fill ${message.stats.maxFill.toFixed(2)} in ${(message.elapsedMs/1000).toFixed(1)} s; ${((performance.now()-began)/1000).toFixed(1)} s elapsed`);
  });
  const out=new Int16Array(count);let changed=0,maxCut=0,maxFill=0,nan=0,unweighted=0;
  for(let k=0;k<count;k++){
    let h=weight[k]>0?accum[k]/weight[k]:(unweighted++,heights[k]);if(Number.isNaN(h)){nan++;h=heights[k];}
    const d=h-heights[k];if(Math.abs(d)>.001)changed++;if(-d>maxCut)maxCut=-d;if(d>maxFill)maxFill=d;
    out[k]=clamp(Math.round(h*100),-32768,32767);
  }
  if(nan)throw new Error(`${nan} graded cells are NaN; nothing written`);
  if(unweighted)console.warn(`warning: ${unweighted} cells received no chunk weight and keep their raw height`);
  // The ungraded DEM stays beside the graded grid as source evidence (tests and the validator compare the two).
  const sourceFile=grid.source??'elevation-source.bin';if(!grid.source)copyFileSync(path.join(o.dataDir,grid.file),path.join(o.dataDir,sourceFile));
  const elevation=gzipSync(Buffer.from(out.buffer),{level:9});writeFileSync(path.join(o.dataDir,grid.file),elevation);
  // roads counts distinct source roads that produced a graded profile, and changedVertices/maxCut/maxFill
  // describe the final blended grid against the raw one; per-chunk sums would double count the margins.
  const grading={roads:gradedRoads.size,changedVertices:changed,maxCut:Math.round(maxCut*1000)/1000,maxFill:Math.round(maxFill*1000)/1000,elapsedMs:Math.round(performance.now()-began),chunks:chunks.length,workers};
  city.elevation={...grid,source:sourceFile,graded:true,grading};
  writeFileSync(path.join(o.dataDir,'city.json'),JSON.stringify(city)+'\n');
  console.log(JSON.stringify({...grading,chunkProfiles:profiles,chunkChangedVertices:chunkChanged,elevationBytes:elevation.length,dataDir:o.dataDir}));
}
if(isMainThread&&process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error?.stack??error);process.exit(1);});
