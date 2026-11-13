import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';
import {planTrafficSignals,POST_GAP,SIGNAL_ROOM} from '../src/simulation/signal-placement.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {closestRoad,pointInside} from '../src/simulation/roads.ts';
import {reserveTransitCorridors,inTransitCorridor} from '../src/simulation/transit-corridors.ts';
import {loadCentralCity,loadMetroCity,loadTileHeaders} from './helpers/metro-city.mjs';
import {drawnGround,loadStreetCity,roadIndex,tileFurniture,tileSignals} from './helpers/street-furniture.mjs';
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};
test('signal poles stand clear of every travel lane and building at real angled Boston intersections',async()=>{
 const city=await loadCentralCity();
 reserveTransitCorridors(city,JSON.parse(fs.readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8')).routes);
 const placed=planTrafficSignals(city);assert.ok(placed.length>180,'retain controls throughout the city');
 for(const signal of placed)assert.equal(inTransitCorridor(city,...signal.position),false,'rail vehicle envelope stays clear');
 for(const signal of placed){for(const road of city.roads.filter(r=>!r.elevations))for(let i=1;i<road.points.length;i++)assert.ok(distance(signal.position,road.points[i-1],road.points[i])>=road.width/2+.54,`pole in ${road.name}`);assert.ok(city.buildings.every(b=>!pointInside(signal.position,b.footprint)));assert.ok(Math.hypot(signal.position[0]-signal.source[0],signal.position[1]-signal.source[1])<45);}
});

test('production signals retain major-road ownership outside the repaired Harvard approaches',async()=>{
 const city=await loadMetroCity({tiles:[]}),placed=planTrafficSignals(city);
 const reported=placed.find(s=>s.source[0]===-1061.941&&s.source[1]===996.024);
 assert.ok(reported,'retain the reported signal instead of losing it on a private alley');
 assert.equal(closestRoad(city,...reported.source).road.name,'Private Alley No. 817','fixture must reproduce the nearer unrelated alley');
 assert.equal(reported.road.name,'Huntington Avenue');
 assert.ok(placed.length>1000,'audit ownership across the complete production signal set');
 for(const signal of placed){
  if(signal.road.elevations&&signal.road.bridge?.id==='harvard-memorial-approach')continue;
  assert.equal(signal.road.id,closestRoad(city,...signal.source,true).road.id,`major-road ownership changed at ${signal.source}`);
 }
});

// ---- with a streamed tile at hand a mast stands behind the kerb as that tile draws it
const tileOf=(tx,tz,rings)=>({tx,tz,size:1000,driveways:[],streetPavement:[rings.map(ring=>ring.map(([x,z])=>[tx*1000+x,tz*1000+z]))]});
const town=(roads,signals)=>({roads,signals,buildings:[],spawn:{x:0,z:0,yaw:0},bounds:{minX:0,maxX:1000,minZ:0,maxZ:1000}});
const main={id:'a',name:'Main Street',points:[[107,0],[107,1000]],width:10},cross={id:'b',name:'Cross Street',points:[[0,505],[1000,505]],width:10};
test('a mast stands behind the kerb as drawn, at a corner of the junction, where the class width put it in a 14 m roadway',()=>{
 // Main Street is 14 m between its kerbs and 10 m by its class; Cross Street 10 m. The signal is where their lines cross.
 const tile=tileOf(0,0,[[[100,0],[114,0],[114,500],[1000,500],[1000,510],[114,510],[114,1000],[100,1000],[100,510],[0,510],[0,500],[100,500]]]),streets=drawnStreets(tile),city=town([main,cross],[[107,505]]);
 const byClass=planTrafficSignals(city);assert.equal(byClass.length,1);assert.ok(streets.paved(...byClass[0].position),'half the class width and 1.25 m from the centre line is in the lane');
 const ground={streets,owns:()=>true,hulls:()=>[]},[mast]=planTrafficSignals(city,ground);
 assert.ok(mast&&!streets.near(...mast.position,SIGNAL_ROOM),'clear of every roadway by its room');
 const [x,z]=mast.position;assert.ok(Math.abs(x-107)>7+1&&Math.abs(z-505)>5+1&&Math.hypot(x-107,z-505)<16,`at a corner, not along a kerb: ${mast.position}`);
 // the arm reaches back over the kerb, the heads over the roadway
 assert.ok(mast.armLength>=2.5&&mast.armLength<=7);const head=[x+Math.sin(mast.armYaw)*(mast.armLength-.35),z+Math.cos(mast.armYaw)*(mast.armLength-.35)];assert.ok(streets.paved(...head),'the signal heads hang over the roadway');
 // a tile plans the signals whose street is met in it, and no other
 assert.deepEqual(planTrafficSignals(city,{...ground,owns:()=>false}),[]);
 // a tree, lamp or sign already planted there, or a building, sends the mast to another corner
 const moved=planTrafficSignals(city,{...ground,posts:[[x+.4,z+.4]]})[0];assert.ok(moved&&Math.hypot(moved.position[0]-x-.4,moved.position[1]-z-.4)>=POST_GAP&&!streets.near(...moved.position,SIGNAL_ROOM));
 const walled=planTrafficSignals(city,{...ground,hulls:(px,pz)=>Math.hypot(px-x,pz-z)<6?[{footprint:[[x-4,z-4],[x+4,z-4],[x+4,z+4],[x-4,z+4]]}]:[]})[0];
 assert.ok(walled&&Math.hypot(walled.position[0]-x,walled.position[1]-z)>4&&!streets.near(...walled.position,SIGNAL_ROOM));
});

test('where a street\'s perpendiculars run on across a wide junction, the mast takes the nearest kerb to the signal itself',()=>{
 // Main Street crosses a paved place 160 m by 60 m: beside every station of the street the pavement runs on 80 m
 const place=tileOf(0,1,[[[102,0],[112,0],[112,470],[187,470],[187,530],[112,530],[112,1000],[102,1000],[102,530],[27,530],[27,470],[102,470]]]),streets=drawnStreets(place);
 const street={...main,points:[[107,1000],[107,2000]]},[mast]=planTrafficSignals({...town([street],[[107,1500]]),bounds:{minX:0,maxX:1000,minZ:1000,maxZ:2000}},{streets,owns:()=>true,hulls:()=>[]});
 assert.ok(mast&&!streets.near(...mast.position,SIGNAL_ROOM));assert.ok(Math.abs(mast.position[1]-1500)>30&&Math.abs(mast.position[0]-107)>5+SIGNAL_ROOM,`beyond the place's kerb, beside the street: ${mast.position}`);
 assert.ok(mast.armLength>=2.5&&mast.armLength<=7);
});

const street=await loadStreetCity(),network=roadIndex(street);
test('the shipped signals: every mast clear of the roadway its tile draws, each signal planned by one tile',()=>{
 // Newmarket Square and Massachusetts Avenue; Huntington Avenue across the border between two tiles
 const tiles=loadTileHeaders(street,['0_2','-2_0','-2_1']),ground=drawnGround(tiles),planned=new Map();
 for(const [key,tile] of tiles){
  const furniture=tileFurniture(street,tile,network),masts=tileSignals(street,tile,network,furniture);assert.ok(masts.length>=10,`${masts.length} masts in tile ${key}`);
  for(const mast of masts){
   const [x,z]=mast.position;planned.set(mast.source.join(),[...(planned.get(mast.source.join())??[]),key]);
   assert.ok(!ground.roadway(x,z,SIGNAL_ROOM-1e-6),`tile ${key}: the mast at ${x.toFixed(1)}, ${z.toFixed(1)} stands in the roadway or within ${SIGNAL_ROOM} m of it`);
   assert.ok(!ground.stall(x,z,SIGNAL_ROOM/2-1e-6));assert.ok(furniture.posts.every(post=>Math.hypot(post[0]-x,post[1]-z)>=POST_GAP),'clear of the trees, lamps and signs planted before it');
   assert.ok(Math.hypot(x-mast.source[0],z-mast.source[1])<45&&mast.armLength>=2.5&&mast.armLength<=7);
  }
 }
 // by class width, with every tile within 40 m of a signal planning it: masts in the roadway, and the same signal twice
 const tile=tiles.get('0_2'),about=network.near({minX:-80,maxX:1080,minZ:1920,maxZ:3080}),own=street.signals.filter(s=>s[0]>=0&&s[0]<1000&&s[1]>=2000&&s[1]<3000);
 const before=planTrafficSignals({...street,roads:about,signals:own,buildings:[]});assert.ok(before.filter(mast=>ground.roadway(...mast.position)).length>=3,'the rule this replaces stood masts in the roadway of this tile');
 // Huntington Avenue's signal at Opera Place stands 4 m inside one tile and its avenue 29 m off in the next: the tile that draws the avenue's kerbs plans it
 const reported=planned.get([-1061.941,996.024].join());assert.deepEqual(reported,['-2_1'],'planned once, by the tile its street is met in');
 for(const [source,keys] of planned)assert.equal(new Set(keys).size,1,`the signal at ${source} is planned by ${keys}`);
 assert.ok(tile&&planned.size>=40);
});
