import assert from 'node:assert/strict';
import test from 'node:test';
import {terrainTiles,drapedRibbon,clipPortalSurface} from '../src/render/terrain-ground.ts';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildTerrainGeometryData} from '../src/simulation/terrain.ts';
import {clipTunnelPortals,inTunnelPortal} from '../src/simulation/tunnels.ts';

const road={id:'test-portal',name:'Ramp',points:[[0,-40],[0,0],[0,40]],elevations:[0,-5,-10],width:8,oneway:1,tunnel:{clearance:5,covered:[[50,80]]}};
const city={bounds:{minX:-60,maxX:60,minZ:-60,maxZ:60},roads:[road],elevation:{originX:-60,originZ:-60,width:21,height:21,cellSize:6,heights:new Float32Array(441)}};
function area(vertices,indices){let area=0;for(let i=0;i<indices.length;i+=3){const [a,b,c]=[0,1,2].map(j=>indices[i+j]*3);area+=Math.abs((vertices[b]-vertices[a])*(vertices[c+2]-vertices[a+2])-(vertices[b+2]-vertices[a+2])*(vertices[c]-vertices[a]))/2;}return area;}
function verifyOpen(geometry){const p=geometry.attributes.position,indices=geometry.index?.array??Uint32Array.from({length:p.count},(_,i)=>i);for(let i=0;i<indices.length;i+=3){const ids=[indices[i],indices[i+1],indices[i+2]],x=ids.reduce((s,j)=>s+p.getX(j),0)/3,z=ids.reduce((s,j)=>s+p.getZ(j),0)/3;assert.equal(inTunnelPortal(city,x,z),false,'surface triangle cannot cover the portal');}for(const name of ['position','normal','uv'])assert.ok([...geometry.attributes[name].array].every(Number.isFinite));return area(p.array,indices);}

test('render terrain cuts match physical portal area across render tile boundaries',()=>{
 const raw=buildTerrainGeometryData(city),physical=clipTunnelPortals(city,raw.vertices,raw.indices),tiles=terrainTiles(city,4);let renderedArea=0;
 for(const tile of tiles){renderedArea+=verifyOpen(tile);tile.dispose();}
 assert.ok(Math.abs(renderedArea-area(physical.vertices,physical.indices))<.001,'render and collision retain the same ground around the cut');
});
test('surface asphalt opens at tunnel portals while explicit upper decks remain whole',()=>{
 const street=drapedRibbon(city,[[-20,-20],[20,-20]],12,.045),bridge=drapedRibbon(city,[[-20,-20],[20,-20]],12,0,()=>8);
 const groundArea=verifyOpen(street),v=bridge.attributes.position.array,upperArea=area(v,Uint32Array.from({length:v.length/3},(_,i)=>i));
 assert.ok(groundArea<400);assert.ok(Math.abs(upperArea-480)<.001);street.dispose();bridge.dispose();
});
test('clipped park paving keeps the nonindexed format needed for surface batching',()=>{
 const a=drapedRibbon(city,[[-20,-20],[20,-20]],12,.024,()=>0),b=drapedRibbon(city,[[-20,55],[20,55]],12,.024,()=>0);
 clipPortalSurface(city,a);assert.equal(a.index,null);const merged=mergeGeometries([a,b]);assert.ok(merged);merged.dispose();a.dispose();b.dispose();
});
