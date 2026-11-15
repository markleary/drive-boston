import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {resolveCity,loadTile} from '../src/simulation/city-tiles.ts';
import {parseTile,gunzip} from '../src/simulation/tile-format.ts';
import {TUNNEL_PASSAGE_BUILDING_IDS,TUNNEL_PASSAGE_FAR,REMNANT_SPAN,farPassageFootprints,isTunnelPassageFar,prepareBuildingTunnelPassage} from '../src/simulation/tunnel-passages.ts';
import {roadProjection,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {tunnelCoveredAt,tunnelStations,inOpenSkyClearance} from '../src/simulation/tunnels.ts';
import {orientedBox} from '../src/simulation/oriented-box.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {sourceFootingGeometry,addSourceFooting} from '../src/render/source-footings.ts';
import {tileSourceGeometry} from '../src/render/tile-geometry.ts';
import {read,readJson} from './helpers/metro-city.mjs';

const city=await resolveCity(readJson('city.json'),read),raw=parseTile(await gunzip(await read('tiles/t_1_-2.bin'))),loaded=await loadTile(city,1,-2,read);
const roads=city.roads.filter(r=>r.tunnel);
function triangles(data,kind){const result=[];for(let i=0;i<data[kind].length;i+=3)result.push([0,1,2].map(j=>Array.from(data.positions.subarray(data[kind][i+j]*3,data[kind][i+j]*3+3))));return result;}
/** Horizontal distance beyond the deck edge to the nearest stretch of a ramp open to the sky (openOnly) or of any ramp.
 * `strip` measures only alongside open stretches, which are cut square at their stations (lenient at bends and ends). */
function deckClearance(x,z,openOnly,strip=false){
 let best=Infinity;
 for(const r of roads){const s=tunnelStations(r);for(let i=1;i<r.points.length;i++){
  const a=r.points[i-1],b=r.points[i],dx=b[0]-a[0],dz=b[1]-a[1],u=((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),t=Math.max(0,Math.min(1,u));
  // Open stretches are cut square at their stations, so only the strip alongside them counts.
  if(openOnly&&(strip&&(u<0||u>1)||tunnelCoveredAt(r,s[i-1]+(s[i]-s[i-1])*t)))continue;
  best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)-Math.max(r.width,r.deckWidths?.[i-1]??0,r.deckWidths?.[i]??0)/2);
 }}
 return best;
}
function inPassage(x,y,z){return roads.some(r=>{const p=roadProjection(r,x,z),floor=sampleRoadElevation(city,r,x,z);return p.distance<r.width/2+.38&&y>floor-.48&&y<floor+r.tunnel.clearance+.43;});}

for(const id of TUNNEL_PASSAGE_BUILDING_IDS){
const building=raw.buildings.find(b=>b.id===id),source=raw.geometry.get(id),adapted=loaded.geometry.get(id);
test(`${building.name} gets finite apertures under cover; source and upper floors over the covered bores stay intact`,()=>{
 assert.notEqual(adapted,source);const before=source.positions.slice();prepareBuildingTunnelPassage(city,building,source);assert.deepEqual(source.positions,before,'runtime adaptation cannot mutate source survey vertices');
 const other=raw.buildings.find(b=>!TUNNEL_PASSAGE_BUILDING_IDS.has(b.id)),otherData=raw.geometry.get(other.id);assert.equal(prepareBuildingTunnelPassage(city,other,otherData),otherData);
 let upperTotal=0;
 for(const kind of ['facade','roof']){
  const retained=new Set(triangles(adapted,kind).map(t=>JSON.stringify(t)));
  for(const triangle of triangles(source,kind))if(triangle.every(p=>p[1]>20&&deckClearance(p[0],p[2],true)>9+REMNANT_SPAN))assert.ok(retained.has(JSON.stringify(triangle)),'upper survey triangles away from the open ramps remain exact');
  upperTotal+=triangles(adapted,kind).filter(t=>t.every(p=>p[1]>20)).length;
 }
 assert.ok(upperTotal>0,'upper floors over the covered bores remain');
});
test(`${building.name} streamed facade and roof triangles leave the vehicle corridors open, to the sky over the open ramps`,()=>{
 const area=triangle=>{const [a,b,c]=triangle,u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);return Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;};let originalArea=0,adaptedArea=0,untouchedArea=0;
 for(const kind of ['facade','roof']){
  for(const triangle of triangles(source,kind)){originalArea+=area(triangle);if(triangle.every(p=>deckClearance(p[0],p[2],false)>9))untouchedArea+=area(triangle);}
  for(const triangle of triangles(adapted,kind)){
   adaptedArea+=area(triangle);const center=[0,1,2].map(k=>triangle.reduce((sum,p)=>sum+p[k],0)/3);
   assert.equal(inPassage(...center),false,'adapted shell must not refill a tunnel passage');
   // At a bend/portal the mitered footprint is not perpendicular to either
   // centerline segment. Use the actual clearance union: a point just behind
   // the portal can project onto the previous segment just before its cover.
   // Float32 world coordinates round a clipped boundary by fractions of a
   // millimetre. Only a point strictly inside all four 1 mm probes is intruding.
   assert.equal([[.001,0],[-.001,0],[0,.001],[0,-.001]].every(([x,z])=>inOpenSkyClearance(city,center[0]+x,center[2]+z)),false,`nothing of the shell stands in the open-air clearance (${center.map(v=>v.toFixed(1))})`);
  }
 }
 assert.ok(originalArea-adaptedArea>10,'a finite part of the actual obstructing source shell is removed');
 assert.ok(untouchedArea>0&&adaptedArea>=untouchedArea*.999,'the measured building away from the approaches remains');
});
test(`${building.name} generated footings share the adapted render/collision aperture`,()=>{
 const input=tileSourceGeometry(adapted),geometry=sourceFootingGeometry(city,building,input),p=geometry.attributes.position;
 for(let i=0;i<p.count;i+=3){const center=[0,1,2].map(k=>[0,1,2].reduce((sum,j)=>sum+p.array[(i+j)*3+k],0)/3);assert.equal(inPassage(...center),false);}
 const scene=new THREE.Scene(),collision=addSourceFooting(scene,city,building,input);
 if(collision)assert.deepEqual(collision.vertices,scene.children[0].geometry.attributes.position.array,'the exact visible footing supplies Rapier');
 geometry.dispose();input.dispose();for(const object of scene.children)object.geometry.dispose();
});

}

test('each passage building has one far hull, boxed by the pieces its detailed shell keeps',()=>{
 assert.deepEqual([...TUNNEL_PASSAGE_BUILDING_IDS].sort(),TUNNEL_PASSAGE_FAR.map(p=>p.id).sort());
 for(const passage of TUNNEL_PASSAGE_FAR){
  const building=raw.buildings.find(b=>b.id===passage.id);
  assert.ok(Math.hypot(building.center[0]-passage.center[0],building.center[1]-passage.center[1])<.02&&Math.abs(building.height-passage.height)<.01,'recorded centre and height match the survey');
  const far=[...city.far.tiles.values()].flatMap(t=>t.buildings.filter(b=>!b.hidden&&isTunnelPassageFar(t.key,b)&&pointInside(passage.center,b.footprint)&&Math.abs(b.height-passage.height)<.02));
  assert.equal(far.length,1,`${building.name} matches exactly one far hull`);
  const pieces=farPassageFootprints(city,far[0]);assert.ok(pieces.length>=1,'part of the building stays in the distance as it does up close');
  const kept=pieces.reduce((sum,p)=>sum+orientedBox(p).area,0),whole=orientedBox(far[0].footprint).area;assert.ok(kept<whole*.9,`the distant block loses the cleared ramps too (${(kept/whole).toFixed(2)})`);
  let samples=0,open=0;
  for(const piece of pieces){
   const xs=piece.map(p=>p[0]),zs=piece.map(p=>p[1]);
   for(let x=Math.min(...xs);x<=Math.max(...xs);x+=1)for(let z=Math.min(...zs);z<=Math.max(...zs);z+=1)if(pointInside([x,z],piece)){samples++;if(inOpenSkyClearance(city,x,z))open++;}
  }
  // Only the 2 m raster's edge cells may overhang the cleared columns.
  assert.ok(open<samples*.08,`the far boxes of ${building.name} stay off the open ramps (${open}/${samples})`);
 }
});

function shellHit(data,origin,direction){
 const ray=new THREE.Ray(new THREE.Vector3(...origin),new THREE.Vector3(...direction)),target=new THREE.Vector3();let nearest=Infinity;
 for(const t of triangles(data,'facade')){
  if(ray.intersectTriangle(...t.map(p=>new THREE.Vector3(...p)),true,target))nearest=Math.min(nearest,target.distanceTo(ray.origin));
 }
 return nearest;
}

test('a clipped building receives outward-facing reveal walls on both sides of an open ramp',()=>{
 // The road cuts through a whole box. Both remaining roof pieces must become
 // solids, including the piece <25 m across that the old heuristic discarded.
 const geometry=new THREE.BoxGeometry(20,30,40).translate(0,15,0),position=geometry.attributes.position.array,indices=geometry.index.array;
 const facade=[],roof=[];
 for(let i=0;i<indices.length;i+=3){const ids=Array.from(indices.subarray(i,i+3));(ids.every(n=>position[n*3+1]===30)?roof:facade).push(...ids);}
 const city={roads:[{id:'open',name:'Open ramp',width:4,points:[[-30,0],[30,0]],elevations:[-1,-1],tunnel:{clearance:4,covered:[]}}]};
 const adapted=prepareBuildingTunnelPassage(city,{id:[...TUNNEL_PASSAGE_BUILDING_IDS][0],baseElevation:0},{positions:position,facade:Uint32Array.from(facade),roof:Uint32Array.from(roof)});
 for(const z of [-1,1])for(const x of [-8,0,8])for(const y of [2,15,28]){
  const distance=shellHit(adapted,[x,y,z*5],[0,0,z]);
  assert.ok(Math.abs(distance-5.01)<.02,`new cut wall faces the ramp at ${x},${y},${z}: ${distance}`);
 }
 assert.equal(shellHit(adapted,[-25,15,0],[1,0,0]),Infinity,'the complete open-air corridor remains clear');
 // Another, covered ramp crosses the new reveal below its roof. The solid
 // closure must use the same finite bore subtraction as the original shell.
 const crossing={id:'covered',name:'Covered crossing',width:4,points:[[0,-30],[0,30]],elevations:[1,3],tunnel:{clearance:4}};
 const crossed=prepareBuildingTunnelPassage({roads:[...city.roads,crossing]},{id:[...TUNNEL_PASSAGE_BUILDING_IDS][0],baseElevation:0},{positions:position,facade:Uint32Array.from(facade),roof:Uint32Array.from(roof)});
 assert.equal(shellHit(crossed,[0,4,5],[0,0,1]),Infinity,'finite crossing stays open through both the reveal and original exterior wall');
 assert.ok(Math.abs(shellHit(crossed,[0,10,5],[0,0,1])-5.01)<.02,'solid resumes above the covered bore');
 assert.ok(Math.abs(shellHit(crossed,[5,4,5],[0,0,1])-5.01)<.02,'solid stays beside the covered bore');
 // A real elevated source wing retains its open space below its soffit;
 // a closure cannot blindly extrude its roof all the way to the building datum.
 const elevated=new THREE.BoxGeometry(20,20,40).translate(0,20,0),ep=elevated.attributes.position.array,ei=elevated.index.array,ef=[],er=[];
 for(let i=0;i<ei.length;i+=3){const ids=Array.from(ei.subarray(i,i+3));(ids.every(n=>ep[n*3+1]===30)||ids.every(n=>ep[n*3+1]===10)?er:ef).push(...ids);}
 const wing=prepareBuildingTunnelPassage(city,{id:[...TUNNEL_PASSAGE_BUILDING_IDS][0],baseElevation:0},{positions:ep,facade:Uint32Array.from(ef),roof:Uint32Array.from(er)});
 assert.equal(shellHit(wing,[0,5,5],[0,0,1]),Infinity,'an elevated wing does not grow a wall below its source soffit');
 assert.ok(Math.abs(shellHit(wing,[0,15,5],[0,0,1])-5.01)<.02,'the wing itself receives a closed side');
 elevated.dispose();geometry.dispose();
});

for(const id of TUNNEL_PASSAGE_BUILDING_IDS){
 const building=raw.buildings.find(b=>b.id===id),adapted=loaded.geometry.get(id);
 test(`${building.name} retained cut roofs have visible walls beneath their exposed edges`,()=>{
  let checked=0;
  for(const t of triangles(adapted,'roof')){
   const normal=new THREE.Vector3().crossVectors(new THREE.Vector3(...t[1]).sub(new THREE.Vector3(...t[0])),new THREE.Vector3(...t[2]).sub(new THREE.Vector3(...t[0])));
   if(normal.y<=0)continue;
   for(let j=0;j<3;j++){
    const a=t[j],b=t[(j+1)%3],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<.1)continue;
    const x=(a[0]+b[0])/2,z=(a[2]+b[2])/2,nx=-dz/length,nz=dx/length;
    const left=inOpenSkyClearance(city,x+nx*.025,z+nz*.025),right=inOpenSkyClearance(city,x-nx*.025,z-nz*.025);if(left===right)continue;
    const sign=left?1:-1,y=(a[1]+b[1])/2-1;
    if(y<(building.baseElevation??0)+.2||inPassage(x,y,z))continue;
    const distance=shellHit(adapted,[x+nx*sign*.1,y,z+nz*sign*.1],[-nx*sign,0,-nz*sign]);
    assert.ok(distance<.13,`open shell at ${[x,y,z].map(v=>v.toFixed(2))}: ${distance}`);checked++;
   }
  }
  assert.ok(checked>3,'exercise multiple exposed roof boundaries in the actual survey');
 });
}


test('closed passage-building shells leave surrounding street lanes unobstructed',()=>{
 const ray=new THREE.Ray(),target=new THREE.Vector3();let probes=0;
 for(const id of TUNNEL_PASSAGE_BUILDING_IDS){
  const building=raw.buildings.find(b=>b.id===id),data=loaded.geometry.get(id),faces=triangles(data,'facade').map(t=>t.map(p=>new THREE.Vector3(...p)));
  const xs=building.footprint.map(p=>p[0]),zs=building.footprint.map(p=>p[1]),minX=Math.min(...xs)-20,maxX=Math.max(...xs)+20,minZ=Math.min(...zs)-20,maxZ=Math.max(...zs)+20;
  for(const road of city.roads){
   if(road.elevations||road.tunnel)continue;
   for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i];if(Math.max(a[0],b[0])<minX||Math.min(a[0],b[0])>maxX||Math.max(a[1],b[1])<minZ||Math.min(a[1],b[1])>maxZ)continue;
    const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.01)continue;
    for(const offset of [0,-Math.max(0,road.width/2-1),Math.max(0,road.width/2-1)])for(let s=0;s<length;s+=2)for(const height of [1,3]){
     const x=a[0]+dx*s/length-dz/length*offset,z=a[1]+dz*s/length+dx/length*offset;
     ray.set(new THREE.Vector3(x,sampleElevation(city,x,z)+height,z),new THREE.Vector3(dx/length,0,dz/length));probes++;
     for(const face of faces){
      if(ray.intersectTriangle(...face,false,target))assert.ok(target.distanceTo(ray.origin)>Math.min(2,length-s)+.001,`${building.name} obstructs ${road.name} ${road.id} at ${target.toArray()}`);
     }
    }
   }
  }
 }
 assert.ok(probes>100,'check the ordinary streets around both adapted buildings');
});
