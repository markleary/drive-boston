import assert from 'node:assert/strict';
import test from 'node:test';
import {roundedPath,pathRoad,join,lane,roadGraph} from '../src/simulation/traffic.ts';
import {bridgeBarriers,sampleRoadElevation,RAIL_LIP} from '../src/simulation/road-surfaces.ts';
import {loadMetroCity} from './helpers/metro-city.mjs';

// A ramp or bridge deck ends on an ordinary street at grade. The street keeps its
// own terrain height from the junction on, and the ramp mouth stands open: no
// parapet where the deck edge still sits on the ground (New Rutherford Avenue at
// the Tobin ramps, where a car arriving from the Austin Street deck sat 0.65 m
// into the pavement and the ramp walls ran across the sidewalk corners).

const flat=(ground,size=400)=>({width:2,height:2,cellSize:size,originX:-size/2,originZ:-size/2,heights:[ground,ground,ground,ground]});

test('a lane keeps its own road from the junction on, so a street after a deck follows the terrain',()=>{
  // The deck ends 3 m above a street that climbs 1 m over its 40 m length.
  const elevation={width:3,height:2,cellSize:40,originX:-40,originZ:-40,heights:[0,1,2,0,1,2]};
  const deck={id:'deck',name:'Bridge',width:10,oneway:1,points:[[-40,0],[0,0]],elevations:[3,3]};
  const street={id:'street',name:'Street',width:10,oneway:1,points:[[0,0],[40,0]]};
  const city={roads:[deck,street],elevation};
  const points=[],roads=[];join(points,roads,deck.points.map(p=>[...p]),deck);join(points,roads,street.points.map(p=>[...p]),street);
  const path=roundedPath(points,roads);
  for(const station of [41,50,60,75]){
    const road=pathRoad(path,station);assert.equal(road.id,'street',`station ${station} m is on the street`);
    const [x,z]=path.points[0].map((_,k)=>k?0:station-40);
    assert.ok(Math.abs(sampleRoadElevation(city,road,x,z)-(1+x/40))<1e-6,'the street samples the terrain under the car');
  }
  assert.equal(pathRoad(path,10).id,'deck');
  // The same holds the other way round: a bridge's first span is on the bridge.
  const back=roundedPath(...(()=>{const p=[],r=[];join(p,r,[[-40,0],[0,0]],street);join(p,r,[[0,0],[40,0]],deck);return[p,r];})());
  assert.equal(pathRoad(back,45).id,'deck','the first span of a deck after a street is attributed to the deck');
  // A turn through a junction: the far half of the rounded corner already belongs to the departing road.
  const turned=roundedPath(...(()=>{const p=[],r=[];join(p,r,[[-40,0],[0,0]],deck);join(p,r,[[0,0],[0,40]],street);return[p,r];})());
  const apex=turned.distances[turned.points.findIndex((_,i)=>i>0&&turned.source.vertex[i]===1)+3];
  assert.equal(pathRoad(turned,apex-2).id,'deck');assert.equal(pathRoad(turned,apex+2).id,'street');
});

test('a ramp mouth at grade has no parapets until its deck edge stands off the ground',()=>{
  // A 7 m ramp leaves a street node at terrain height and climbs at 6%.
  const ramp={id:'ramp',name:'Ramp',width:7,oneway:1,points:Array.from({length:21},(_,i)=>[i*5,0]),elevations:Array.from({length:21},(_,i)=>i*5*.06),bridge:{id:'ramp',thickness:.65,clearanceEstimated:true},startLevel:0,endLevel:1};
  const city={roads:[ramp],elevation:flat(0)};
  const rails=bridgeBarriers(city,ramp);assert.ok(rails.length,'the elevated part keeps its parapets');
  const first=Math.min(...rails.map(p=>p.x-Math.abs(Math.sin(p.yaw))*p.length/2));
  assert.ok(first>RAIL_LIP/.06-.5&&first<RAIL_LIP/.06+1.5,`parapets start where the deck is ${RAIL_LIP} m up (${first.toFixed(1)} m along), not at the street`);
  for(const p of rails)assert.ok(p.y-.38>RAIL_LIP-.01,'every rail base stands off the ground');
  // Both edges are protected once the deck is up, and a deck over a drop keeps its rails even when the terrain beside its far side is level with it.
  assert.ok(rails.some(p=>p.z<0)&&rails.some(p=>p.z>0));
  const shelf={id:'shelf',name:'Shelf',width:8,oneway:1,points:[[0,0],[60,0]],elevations:[4,4]};
  const cliff={roads:[shelf],elevation:{width:2,height:3,cellSize:60,originX:-30,originZ:-60,heights:[4,4,4,4,0,0]}};
  const sides=bridgeBarriers(cliff,shelf);
  assert.ok(sides.every(p=>p.z>0)&&sides.length,'the edge over the drop keeps its parapet, the edge on the ground gives none');
});

test('no parapet stands on the ground anywhere in the metro, and the Tobin ramps open onto New Rutherford Avenue',async()=>{
  const city=await loadMetroCity({tiles:[]}),{sampleElevation}=await import('../src/simulation/terrain.ts'),{roadProjection}=await import('../src/simulation/road-surfaces.ts');
  const offenders=[];let rails=0;
  for(const road of city.roads){
    if(!road.elevations||road.tunnel)continue;
    for(const p of bridgeBarriers(city,road)){
      rails++;const hit=roadProjection(road,p.x,p.z),n=Math.hypot(p.x-hit.x,p.z-hit.z)||1,ox=(p.x-hit.x)/n,oz=(p.z-hit.z)/n,base=p.y-.38;
      // The rule's own probes, just outside the rail and 1.5 m further out: a rail whose deck sits on the ground at both is a wall across a street.
      const lip=Math.max(base-sampleElevation(city,p.x+ox*.3,p.z+oz*.3),base-sampleElevation(city,p.x+ox*1.5,p.z+oz*1.5));
      if(lip<RAIL_LIP-.02)offenders.push(`${road.id} ${road.name} (${p.x.toFixed(1)},${p.z.toFixed(1)}) lip ${lip.toFixed(2)}`);
    }
  }
  assert.ok(rails>20000,'the metro still has its elevated parapets');
  assert.deepEqual(offenders.slice(0,10),[],`${offenders.length} grounded rails`);
  // The reported junction: both ramps land at the shared New Rutherford Avenue node and their first 15 m, through the junction's crosswalks, have no walls.
  const node=[794.4,-2471.8];
  for(const id of ['tobin-boston-north','tobin-boston-south']){
    const ramp=city.roads.find(r=>r.id===id),near=bridgeBarriers(city,ramp).filter(p=>Math.hypot(p.x-node[0],p.z-node[1])<15);
    assert.ok([ramp.points[0],ramp.points.at(-1)].some(p=>Math.hypot(p[0]-node[0],p[1]-node[1])<.1),`${id} lands at the junction node`);
    assert.deepEqual(near,[],`${id} has no parapet inside the junction`);
    assert.ok(bridgeBarriers(city,ramp).some(p=>Math.hypot(p.x-node[0],p.z-node[1])<45),`${id} is railed once it has climbed off the ground`);
  }
});

test('every traffic lane leaving a junction follows its own road, including New Rutherford Avenue after the Austin Street deck',async()=>{
  const city=await loadMetroCity({tiles:[]}),{edges}=roadGraph(city),outgoing=new Map();
  for(const e of edges){const l=outgoing.get(e.start)??[];l.push(e);outgoing.set(e.start,l);}
  // Before the fix a street's first segment took the height of the deck a car had just left (or a deck took the street's), by up to 3 m.
  let pairs=0;const bad=[];
  for(const prev of edges)for(const next of outgoing.get(prev.end)??[]){
    if(next.road===prev.road||!(prev.road.elevations||next.road.elevations))continue;pairs++;
    const points=[],roads=[];join(points,roads,lane(prev),prev.road);join(points,roads,lane(next),next.road);
    const path=roundedPath(points,roads),entry=path.source.vertex.findIndex(v=>path.source.roads[v]===next.road&&v>0),cut=path.distances[Math.max(1,entry)];
    for(const station of [cut+7.5,path.length-.5])if(station>cut+7&&station<path.length&&pathRoad(path,station)!==next.road)bad.push(`${prev.road.id} -> ${next.road.id} at ${station.toFixed(1)} m: ${pathRoad(path,station).id}`);
  }
  assert.ok(pairs>500);assert.deepEqual(bad.slice(0,10),[],`${bad.length} misattributed stations`);
  // The reported case: the westbound Austin Street deck 17660-0-0 ends 2.91 m up where New Rutherford Avenue 17661-0-0 climbs to 3.58 m at the Tobin ramps.
  const deck=edges.find(e=>e.road.id==='17660-0-0'),street=edges.find(e=>e.road.id==='17661-0-0');assert.ok(deck&&street&&deck.end===street.start);
  const points=[],roads=[];join(points,roads,lane(deck),deck.road);join(points,roads,lane(street),street.road);
  const path=roundedPath(points,roads),station=path.length-8,[x,z]=path.points.at(-1);
  assert.equal(pathRoad(path,station).id,'17661-0-0');
  assert.ok(Math.abs(sampleRoadElevation(city,pathRoad(path,station),x,z)-sampleRoadElevation(city,street.road,x,z))<1e-9,'the car at the junction rides on the street surface');
  assert.ok(sampleRoadElevation(city,street.road,x,z)-deck.road.elevations.at(-1)>.5,'the fixture still has the step that sank cars');
});
