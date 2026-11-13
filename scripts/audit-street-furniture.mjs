/** Audit of everything the game stands beside a street, over every tile of the installed package:
 *
 *   node scripts/audit-street-furniture.mjs            (npm run audit:furniture)
 *
 * The street trees, lamps, name signs and signal masts of each tile are planned exactly as the tile builder plans
 * them (src/simulation/street-furniture.ts, signal-placement.ts), and the sidewalk and park walks and the kerbside cars as the street life
 * verifies them with every tile resident (src/render/street-life.ts). Each place is then held against the ground
 * the tiles draw, read from their polygons with no index (tests/helpers/street-furniture.mjs):
 *
 * - no tree, lamp, sign or signal mast in the street pavement or nearer it than its room (1.2 m, 0.6 m, 0.4 m,
 *   0.5 m), in the tile it stands in or the next one;
 * - none in a parking stall, with half that room to spare, and no signal planned by two tiles;
 * - both signal heads of every mast over a roadway: the street pavement, or the deck of a raised road (which no
 *   tile draws as pavement), so an arm reaches back over the kerb its mast stands behind;
 * - no walk in the pavement, nearer it than 0.3 m anywhere along it, or through a stall;
 * - no walk within 0.6 m of a tree, a lamp, a sign pole or a mast (the walkers' own test is 0.76 m at points 25 cm apart);
 * - every kerbside car wholly on the roadway.
 *
 * The planters follow the drawn roadway by rule, so this holds for any package; the audit is what says so for the
 * one installed, and it fails (exit 1) on the first class that does not. The walks are 2,500 km: they are tested
 * through the planters' own index, and every fiftieth point again against the polygons, where the two must agree. */
import * as THREE from 'three';
import '../tests/helpers/npc-fleet.mjs';
import {loadTileHeaders} from '../tests/helpers/metro-city.mjs';
import {alongWalk,deckGround,drawnGround,loadStreetCity,roadIndex,signalHeads,tileStreetside} from '../tests/helpers/street-furniture.mjs';
import {drawnStreets,STALL_REACH} from '../src/simulation/drawn-streets.ts';
import {LAMP_ROOM,SIGN_ROOM,TREE_ROOM} from '../src/simulation/street-furniture.ts';
import {SIGNAL_ROOM} from '../src/simulation/signal-placement.ts';
import {NPC_VEHICLES} from '../src/simulation/npc-vehicle-specs.ts';
import {createStreetLife} from '../src/render/street-life.ts';

const WALK_ROOM=.3,POST_ROOM=.6,began=performance.now();
const city=await loadStreetCity(),tiles=loadTileHeaders(city),roads=roadIndex(city),ground=drawnGround(tiles),size=city.tiles.size;
const failures=[],fail=(what,list)=>{if(list.length)failures.push(`${list.length} ${what}: ${list.slice(0,5).map(p=>`(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`).join(' ')}${list.length>5?' ...':''}`);};

// ---- trees, lamps, name signs and signal masts, tile by tile
const kinds=['trees','lamps','signs','masts'],count={trees:0,lamps:0,signs:0,masts:0},plans=new Map(),inRoadway={trees:[],lamps:[],signs:[],masts:[]},inStall={trees:[],lamps:[],signs:[],masts:[]},signalled=new Map(),headsOff=[];
const deck=deckGround(roads);let heads=0;
for(const [key,tile] of tiles){
  const plan=tileStreetside(city,tile,roads);plans.set(key,plan);
  for(const mast of plan.masts){
    const source=mast.source.join(','),planners=signalled.get(source);if(planners)planners.add(key);else signalled.set(source,new Set([key]));
    for(const head of signalHeads(mast)){heads++;if(!ground.roadway(...head)&&!deck(...head))headsOff.push(head);}
  }
  for(const [kind,places,room] of [['trees',plan.trees,TREE_ROOM],['lamps',plan.lamps,LAMP_ROOM],['signs',plan.signs.map(sign=>sign.position),SIGN_ROOM],['masts',plan.masts.map(mast=>mast.position),SIGNAL_ROOM]]){
    count[kind]+=places.length;
    for(const p of places){
      // (a hair inside the room: a place drawn in from a border stands at exactly its room from it)
      if(ground.roadway(p[0],p[1],room-1e-6))inRoadway[kind].push(p);
      if(ground.stall(p[0],p[1],room/2-1e-6))inStall[kind].push(p);
    }
  }
}
for(const kind of kinds){fail(`${kind} in the street pavement or within their room of it`,inRoadway[kind]);fail(`${kind} in a parking stall`,inStall[kind]);}
const twice=[...signalled].filter(([,planners])=>planners.size>1).map(([source])=>source.split(',').map(Number));fail('signals planned by two tiles',twice);
fail('signal heads hanging over no roadway (street pavement or a deck)',headsOff);
const sum=lists=>kinds.reduce((n,kind)=>n+lists[kind].length,0),signals=new Set(city.signals.map(signal=>signal.join(',')));
console.log(`${tiles.size} tiles: ${count.trees} street trees, ${count.lamps} lamps, ${count.signs} name signs, ${count.masts} signal masts; in the roadway or too near it ${sum(inRoadway)}, in a stall ${sum(inStall)}`);
console.log(`${signals.size} signals: ${signalled.size} with a mast, none planned by two tiles (${twice.length}); ${signals.size-signalled.size} without one (no street within 35 m, or no clear kerb); signal heads over no roadway ${headsOff.length} of ${heads}`);

// ---- the walks, with every tile resident (the street life verifies a walk once its tiles are in)
const loaded=new Map();for(const [key,tile] of tiles)loaded.set(key,{tile,posts:plans.get(key).posts});
const life=createStreetLife(new THREE.Scene(),city,undefined,[],{tiles:{loaded}});
const walks=new Set();
for(let x=city.bounds.minX;x<city.bounds.maxX+1500;x+=1500)for(let z=city.bounds.minZ;z<city.bounds.maxZ+1500;z+=1500)for(const route of life.walksNear(x,z,1100))walks.add(route);
const streetsAt=(tx,tz)=>{const tile=tiles.get(`${tx}_${tz}`);return tile&&drawnStreets(tile);};
const about=(x,z,reach,test)=>{for(let tx=Math.floor((x-reach)/size);tx<=Math.floor((x+reach)/size);tx++)for(let tz=Math.floor((z-reach)/size);tz<=Math.floor((z+reach)/size);tz++){const streets=streetsAt(tx,tz);if(streets&&test(streets))return true;}return false;};
// (every post of the package by 2 m cell, an index of this script's own: the walkers look theirs up tile by tile)
const postCells=new Map(),postCell=(i,j)=>(i+50000)*100003+j+50000;
for(const plan of plans.values())for(const post of plan.posts){const cell=postCell(Math.floor(post[0]/2),Math.floor(post[1]/2)),list=postCells.get(cell);if(list)list.push(post);else postCells.set(cell,[post]);}
const atPost=(x,z)=>{const ci=Math.floor(x/2),cj=Math.floor(z/2);for(let i=ci-1;i<=ci+1;i++)for(let j=cj-1;j<=cj+1;j++)for(const post of postCells.get(postCell(i,j))??[])if((post[0]-x)**2+(post[1]-z)**2<POST_ROOM**2)return true;return false;};
let metres=0,points=0,checked=0;const paved=[],stalled=[],posted=[],disagree=[];
for(const route of walks){
  metres+=route.length;
  for(const [x,z] of alongWalk(route)){
    const road=about(x,z,WALK_ROOM,streets=>streets.inset(x,z)>-WALK_ROOM&&streets.near(x,z,WALK_ROOM)),stall=about(x,z,STALL_REACH+WALK_ROOM,streets=>streets.stall(x,z,WALK_ROOM));
    if(road)paved.push([x,z]);if(stall)stalled.push([x,z]);if(atPost(x,z))posted.push([x,z]);
    if(points++%50===0){checked++;if(road!==ground.roadway(x,z,WALK_ROOM)||stall!==ground.stall(x,z,WALK_ROOM))disagree.push([x,z]);}
  }
}
fail(`points of walks in the street pavement or within ${WALK_ROOM} m of it`,paved);fail(`points of walks within ${WALK_ROOM} m of a parking stall`,stalled);fail(`points of walks within ${POST_ROOM} m of a tree, lamp or sign pole`,posted);fail('points where the planters\' index and the polygons disagree',disagree);
console.log(`${walks.size} walks (${[...walks].filter(route=>route.park).length} on park paths), ${(metres/1000).toFixed(0)} km, ${points} points: in the roadway or within ${WALK_ROOM} m of it ${paved.length}, at a stall ${stalled.length}, within ${POST_ROOM} m of a tree or post ${posted.length}; ${checked} points checked against the polygons, ${disagree.length} disagree`);

// ---- the kerbside cars about the spawn: all four corners on the roadway
const offRoad=[];
for(const car of life.parked){
  const spec=NPC_VEHICLES.find(s=>s.type===car.type),f=[Math.sin(car.yaw),Math.cos(car.yaw)];
  if(![[-1,-1],[1,-1],[1,1],[-1,1]].every(([a,b])=>ground.roadway(car.x+f[0]*a*spec.length/2+f[1]*b*spec.width/2,car.z+f[1]*a*spec.length/2-f[0]*b*spec.width/2)))offRoad.push([car.x,car.z]);
  if(car.meter&&ground.roadway(car.meter[0],car.meter[1],.2))offRoad.push(car.meter);
}
fail('kerbside cars off the roadway (or meters in it)',offRoad);
console.log(`${life.parked.length} kerbside cars, ${life.meterCount} meters: off the roadway ${offRoad.length}`);
life.dispose();

console.log(`${((performance.now()-began)/1000).toFixed(1)} s`);
if(failures.length){console.error('\nStreet furniture audit failed:\n- '+failures.join('\n- '));process.exit(1);}
console.log('Street furniture audit passed.');
