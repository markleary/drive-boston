/** Audit of everything the game stands beside a street, over every tile of the installed package:
 *
 *   node scripts/audit-street-furniture.mjs            (npm run audit:furniture)
 *
 * The street trees, lamps and name signs of each tile are planned exactly as the tile builder plans them
 * (src/simulation/street-furniture.ts), and the sidewalk and park walks and the kerbside cars as the street life
 * verifies them with every tile resident (src/render/street-life.ts). Each place is then held against the ground
 * the tiles draw, read from their polygons with no index (tests/helpers/street-furniture.mjs):
 *
 * - no tree, lamp or sign in the street pavement or nearer it than its room (1.2 m, 0.6 m, 0.4 m), in the tile it
 *   stands in or the next one;
 * - none in a parking stall, with half that room to spare;
 * - no walk in the pavement, nearer it than 0.3 m anywhere along it, or through a stall;
 * - every kerbside car wholly on the roadway.
 *
 * The planters follow the drawn roadway by rule, so this holds for any package; the audit is what says so for the
 * one installed, and it fails (exit 1) on the first class that does not. The walks are 2,500 km: they are tested
 * through the planters' own index, and every fiftieth point again against the polygons, where the two must agree. */
import * as THREE from 'three';
import '../tests/helpers/npc-fleet.mjs';
import {loadTileHeaders} from '../tests/helpers/metro-city.mjs';
import {alongWalk,drawnGround,loadStreetCity,residentTiles,roadIndex,tileFurniture} from '../tests/helpers/street-furniture.mjs';
import {drawnStreets,STALL_REACH} from '../src/simulation/drawn-streets.ts';
import {LAMP_ROOM,SIGN_ROOM,TREE_ROOM} from '../src/simulation/street-furniture.ts';
import {NPC_VEHICLES} from '../src/simulation/npc-vehicle-specs.ts';
import {createStreetLife} from '../src/render/street-life.ts';

const WALK_ROOM=.3,began=performance.now();
const city=await loadStreetCity(),tiles=loadTileHeaders(city),roads=roadIndex(city),ground=drawnGround(tiles),size=city.tiles.size;
const failures=[],fail=(what,list)=>{if(list.length)failures.push(`${list.length} ${what}: ${list.slice(0,5).map(p=>`(${p[0].toFixed(1)}, ${p[1].toFixed(1)})`).join(' ')}${list.length>5?' ...':''}`);};

// ---- trees, lamps and name signs, tile by tile
const count={trees:0,lamps:0,signs:0},plans=new Map(),inRoadway={trees:[],lamps:[],signs:[]},inStall={trees:[],lamps:[],signs:[]};
for(const [key,tile] of tiles){
  const plan=tileFurniture(city,tile,roads);plans.set(key,plan);
  for(const [kind,places,room] of [['trees',plan.trees,TREE_ROOM],['lamps',plan.lamps,LAMP_ROOM],['signs',plan.signs.map(sign=>sign.position),SIGN_ROOM]]){
    count[kind]+=places.length;
    for(const p of places){
      // (a hair inside the room: a place drawn in from a border stands at exactly its room from it)
      if(ground.roadway(p[0],p[1],room-1e-6))inRoadway[kind].push(p);
      if(ground.stall(p[0],p[1],room/2-1e-6))inStall[kind].push(p);
    }
  }
}
for(const kind of ['trees','lamps','signs']){fail(`${kind} in the street pavement or within their room of it`,inRoadway[kind]);fail(`${kind} in a parking stall`,inStall[kind]);}
console.log(`${tiles.size} tiles: ${count.trees} street trees, ${count.lamps} lamps, ${count.signs} name signs; in the roadway or too near it ${inRoadway.trees.length+inRoadway.lamps.length+inRoadway.signs.length}, in a stall ${inStall.trees.length+inStall.lamps.length+inStall.signs.length}`);

// ---- the walks, with every tile resident (the street life verifies a walk once its tiles are in)
const loaded=new Map();for(const [key,tile] of tiles)loaded.set(key,{tile,posts:plans.get(key).posts});
const life=createStreetLife(new THREE.Scene(),city,undefined,[],{tiles:{loaded}});
const walks=new Set();
for(let x=city.bounds.minX;x<city.bounds.maxX+1500;x+=1500)for(let z=city.bounds.minZ;z<city.bounds.maxZ+1500;z+=1500)for(const route of life.walksNear(x,z,1100))walks.add(route);
const streetsAt=(tx,tz)=>{const tile=tiles.get(`${tx}_${tz}`);return tile&&drawnStreets(tile);};
const about=(x,z,reach,test)=>{for(let tx=Math.floor((x-reach)/size);tx<=Math.floor((x+reach)/size);tx++)for(let tz=Math.floor((z-reach)/size);tz<=Math.floor((z+reach)/size);tz++){const streets=streetsAt(tx,tz);if(streets&&test(streets))return true;}return false;};
let metres=0,points=0,checked=0;const paved=[],stalled=[],disagree=[];
for(const route of walks){
  metres+=route.length;
  for(const [x,z] of alongWalk(route)){
    const road=about(x,z,WALK_ROOM,streets=>streets.inset(x,z)>-WALK_ROOM&&streets.near(x,z,WALK_ROOM)),stall=about(x,z,STALL_REACH+WALK_ROOM,streets=>streets.stall(x,z,WALK_ROOM));
    if(road)paved.push([x,z]);if(stall)stalled.push([x,z]);
    if(points++%50===0){checked++;if(road!==ground.roadway(x,z,WALK_ROOM)||stall!==ground.stall(x,z,WALK_ROOM))disagree.push([x,z]);}
  }
}
fail(`points of walks in the street pavement or within ${WALK_ROOM} m of it`,paved);fail(`points of walks within ${WALK_ROOM} m of a parking stall`,stalled);fail('points where the planters\' index and the polygons disagree',disagree);
console.log(`${walks.size} walks (${[...walks].filter(route=>route.park).length} on park paths), ${(metres/1000).toFixed(0)} km, ${points} points: in the roadway or within ${WALK_ROOM} m of it ${paved.length}, at a stall ${stalled.length}; ${checked} points checked against the polygons, ${disagree.length} disagree`);

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
