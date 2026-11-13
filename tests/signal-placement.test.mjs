import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';
import {HEAD_ROOM,planTrafficSignals,POST_GAP,SIGNAL_ROOM} from '../src/simulation/signal-placement.ts';
import {drawnStreets} from '../src/simulation/drawn-streets.ts';
import {closestRoad,pointInside} from '../src/simulation/roads.ts';
import {reserveTransitCorridors,inTransitCorridor} from '../src/simulation/transit-corridors.ts';
import {inTunnelApproach} from '../src/simulation/tunnels.ts';
import {loadCentralCity,loadMetroCity,loadTileHeaders} from './helpers/metro-city.mjs';
import {deckGround,drawnGround,loadStreetCity,openStretchGround,roadIndex,signalHeads,tileFurniture,tileSignals} from './helpers/street-furniture.mjs';
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
 assert.ok(mast.armLength>=2.5&&mast.armLength<=7);for(const head of signalHeads(mast))assert.ok(streets.paved(...head),'both signal heads hang over the roadway');
 // a tile plans the signals whose street is met in it, and no other
 assert.deepEqual(planTrafficSignals(city,{...ground,owns:()=>false}),[]);
 // a tree, lamp or sign already planted there, or a building, sends the mast to another corner
 const moved=planTrafficSignals(city,{...ground,posts:[[x+.4,z+.4]]})[0];assert.ok(moved&&Math.hypot(moved.position[0]-x-.4,moved.position[1]-z-.4)>=POST_GAP&&!streets.near(...moved.position,SIGNAL_ROOM));
 const walled=planTrafficSignals(city,{...ground,hulls:(px,pz)=>Math.hypot(px-x,pz-z)<6?[{footprint:[[x-4,z-4],[x+4,z-4],[x+4,z+4],[x-4,z+4]]}]:[]})[0];
 assert.ok(walled&&Math.hypot(walled.position[0]-x,walled.position[1]-z)>4&&!streets.near(...walled.position,SIGNAL_ROOM));
});

test('no mast stands in a tunnel approach: the open cut of a ramp passes under its footing by the terrain grid',()=>{
 const tile=tileOf(0,0,[[[100,0],[114,0],[114,500],[1000,500],[1000,510],[114,510],[114,1000],[100,1000],[100,510],[0,510],[0,500],[100,500]]]),streets=drawnStreets(tile),ground={streets,owns:()=>true,hulls:()=>[]};
 const [first]=planTrafficSignals(town([main,cross],[[107,505]]),ground),[x,z]=first.position;
 // A ramp in a walled cut, 3 m down, runs where that mast stands. The grid is whole across a cut (the runtime cuts the
 // terrain out), so the road lies under the footing by its heights and the lane test passes it: what keeps the mast
 // out is the tunnel approach, as it keeps every tree, lamp and sign out.
 const cut={id:'cut',name:'Entrance ramp',points:[[x,z-40],[x,z+.5]],width:6,oneway:1,elevations:[-3,-3],tunnel:{clearance:5.2,covered:[]}},city=town([main,cross,cut],[[107,505]]);
 assert.ok(inTunnelApproach(city,x,z),'the fixture: the first corner lies in the cut');
 const [moved]=planTrafficSignals(city,ground);assert.ok(moved&&!inTunnelApproach(city,...moved.position)&&Math.hypot(moved.position[0]-x,moved.position[1]-z)>3.8,`another corner: ${moved?.position}`);
 assert.ok(!streets.near(...moved.position,SIGNAL_ROOM));for(const head of signalHeads(moved))assert.ok(streets.paved(...head));
 // a tile asks the whole city, whose tunnel index is built once (`excavated`); so does the rule without a tile's ground
 const asked=planTrafficSignals(town([main,cross],[[107,505]]),{...ground,excavated:(px,pz)=>Math.hypot(px-x,pz-z)<6})[0];assert.ok(asked&&Math.hypot(asked.position[0]-x,asked.position[1]-z)>=6);
 for(const mast of planTrafficSignals(city))assert.ok(!inTunnelApproach(city,...mast.position));
});

test('where a street\'s perpendiculars run on across a wide junction, the mast takes the nearest kerb to the signal itself',()=>{
 // Main Street crosses a paved place 160 m by 60 m: beside every station of the street the pavement runs on 80 m
 const place=tileOf(0,1,[[[102,0],[112,0],[112,470],[187,470],[187,530],[112,530],[112,1000],[102,1000],[102,530],[27,530],[27,470],[102,470]]]),streets=drawnStreets(place);
 const street={...main,points:[[107,1000],[107,2000]]},[mast]=planTrafficSignals({...town([street],[[107,1500]]),bounds:{minX:0,maxX:1000,minZ:1000,maxZ:2000}},{streets,owns:()=>true,hulls:()=>[]});
 assert.ok(mast&&!streets.near(...mast.position,SIGNAL_ROOM));assert.ok(Math.abs(mast.position[1]-1500)>30&&Math.abs(mast.position[0]-107)>5+SIGNAL_ROOM,`beyond the place's kerb, beside the street: ${mast.position}`);
 assert.ok(mast.armLength>=2.5&&mast.armLength<=7);
 // The street's own line lies 13 m from that kerb, along the verge: an arm toward it (the rule this replaces) hung
 // both heads over the verge. The arm reaches back over the kerb the mast stands behind, toward the signal.
 const [x,z]=mast.position,toLine=Math.sign(107-x);assert.ok([.35,1.25].every(back=>!streets.paved(x+toLine*(7-back),z)),'the fixture: an arm toward the street\'s line reaches no roadway');
 for(const head of signalHeads(mast))assert.ok(streets.paved(...head),`both signal heads hang over the roadway: ${head}`);
 assert.ok(Math.sin(mast.armYaw)*(107-x)+Math.cos(mast.armYaw)*(1500-z)>.99*Math.hypot(107-x,1500-z),'back along the bearing the kerb was found on');
});

test('the arm brings both signal heads over the roadway on a street narrower than its class',()=>{
 // Main Street is 10 m by its class and 4 m between its kerbs: to the middle of the roadway less 1.2 m the arm would
 // be 2.05 m, and at the old least length of 2.5 m the inner head hung over the kerb line itself.
 const tile=tileOf(0,0,[[[105,0],[109,0],[109,500],[1000,500],[1000,510],[109,510],[109,1000],[105,1000],[105,510],[0,510],[0,500],[105,500]]]),streets=drawnStreets(tile);
 const [mast]=planTrafficSignals(town([main,cross],[[107,505]]),{streets,owns:()=>true,hulls:()=>[]});assert.ok(mast&&!streets.near(...mast.position,SIGNAL_ROOM));
 const ux=Math.sin(mast.armYaw),uz=Math.cos(mast.armYaw);
 for(const [hx,hz] of signalHeads(mast))for(const along of [-(HEAD_ROOM-.01),0,HEAD_ROOM-.01])assert.ok(streets.paved(hx+ux*along,hz+uz*along),`a head ${HEAD_ROOM} m inside the kerbs: ${hx}, ${hz}`);
 assert.ok(mast.armLength>2.5&&mast.armLength<4);
});

test('beside a raised road a mast stands only where its heads hang over that road\'s deck or a street\'s pavement',()=>{
 // Bridge Street leaves Main Street on a deck, which no tile draws as street pavement. The stations along its line
 // run on 27 m beyond its end, across Main Street: a mast there stood in the grass with its arm away from every road.
 const bridge={id:'c',name:'Bridge Street',points:[[107,505],[300,505]],width:10,elevations:[0,6]},streets=drawnStreets(tileOf(0,0,[[[100,0],[114,0],[114,1000],[100,1000]]]));
 const city=town([main,bridge],[[125,505]]),ground={streets,owns:()=>true,hulls:()=>[]},[mast]=planTrafficSignals(city,ground);
 assert.ok(mast&&mast.road===bridge&&Math.abs(mast.position[0]-125)<.01&&Math.abs(Math.abs(mast.position[1]-505)-6.25)<.01,`beside the deck at the signal: ${mast?.position}`);
 for(const [hx,hz] of signalHeads(mast))assert.ok(hx>107&&hx<300&&Math.abs(hz-505)<5&&!streets.paved(hx,hz),'both heads over the deck');
 // buildings along the deck leave only the stations beyond the road's end, west of Main Street: no mast, rather than one whose heads hang over the verge there
 const walled={...ground,hulls:px=>px>114.5&&px<160?[{footprint:[[114.5,480],[160,480],[160,530],[114.5,530]]}]:[]};
 assert.ok(postsClearWest(streets),'the fixture: the verge west of Main Street is a place a post may stand');assert.deepEqual(planTrafficSignals(city,walled),[]);
});

const postsClearWest=streets=>!streets.near(98,498.75,SIGNAL_ROOM)&&streets.inset(98,498.75)>SIGNAL_ROOM;

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

test('the shipped signals: both heads of every mast hang over a roadway, the arm across its street where that reaches one',()=>{
 // Commercial Street at the Mystic Valley Parkway and Francis Street (masts found from the signal itself, 12 and 19 m from their street's
 // line), Beacon Street at Marion Street (an island's nose), Ukraine Way (a raised road that ends at its junction), Summer
 // Street's viaduct in the Seaport (over a Turnpike ramp's open cut) and the three tiles above. A head can hang across a
 // tile border, so the ground is read with the tiles about each.
 const keys=['-2_-6','-3_1','-5_1','-4_5','2_0','0_2','-2_0','-2_1'],about=new Set(keys.flatMap(key=>{const [tx,tz]=key.split('_').map(Number);return [-1,0,1].flatMap(i=>[-1,0,1].map(j=>`${tx+i}_${tz+j}`));}).filter(key=>street.tiles.keys.includes(key)));
 const tiles=loadTileHeaders(street,[...about]),ground=drawnGround(tiles),deck=deckGround(network),openStretch=openStretchGround(street,network),planned=new Map();let heads=0;
 for(const key of keys){
  const masts=tileSignals(street,tiles.get(key),network);planned.set(key,masts);
  // (a mast is 5.65 m tall: under a ramp that passes more than 6.2 m over its footing it stands as under a viaduct)
  for(const mast of masts){const over=openStretch(...mast.position);assert.ok((over===undefined||over>=6.2)&&!inTunnelApproach(street,...mast.position),`tile ${key}: the mast at ${mast.position.map(v=>v.toFixed(1))} stands in a tunnel record's open cut or ramp`);}
  for(const mast of masts)for(const head of signalHeads(mast)){heads++;assert.ok(ground.roadway(...head)||deck(...head),`tile ${key}: a head of the mast at ${mast.position.map(v=>v.toFixed(1))} hangs over no roadway (${head.map(v=>v.toFixed(1))})`);}
 }
 assert.ok(heads>=200,`${heads} signal heads`);
 const of=(key,source)=>{const mast=planned.get(key).find(m=>m.source[0]===source[0]&&m.source[1]===source[1]);assert.ok(mast,`the signal at ${source} has a mast in tile ${key}`);return mast;};
 const acrossStreet=mast=>Math.abs(Math.sin(mast.armYaw-mast.yaw)),toSignal=mast=>(Math.sin(mast.armYaw)*(mast.source[0]-mast.position[0])+Math.cos(mast.armYaw)*(mast.source[1]-mast.position[1]))/Math.hypot(mast.source[0]-mast.position[0],mast.source[1]-mast.position[1]);
 // found on the far kerb of the parkway Commercial Street ends at, 12 m along that kerb from its line: the arm reaches back over the kerb, toward the signal
 for(const source of [[-1205.253,-5978.446],[-1179.121,-5991.69]]){const mast=of('-2_-6',source);assert.ok(toSignal(mast)>.99&&acrossStreet(mast)<.2,`Commercial Street: ${mast.armYaw}`);}
 assert.ok(toSignal(of('-3_1',[-2681.706,1598.431]))>.99,'Francis Street');
 // where an arm across the signal's street does reach its roadway, it stays across it
 assert.ok(acrossStreet(of('-5_1',[-4265.353,1046.605]))>.99,'Beacon Street');
 // The signal on Summer Street's viaduct: its mast stood 1.2 m off the centre line of the Turnpike's entrance ramp from the
 // Haul Road, in the ramp's open cut beneath the viaduct, 2 m over the road. It stands beside the Haul Road now.
 const summer=of('2_0',[2432.49,224.301]);assert.ok(openStretch(2436.3,218.4)<0&&inTunnelApproach(street,2436.3,218.4),'the fixture: the old place lies in the cut');
 assert.ok(summer.road.elevations&&openStretch(...summer.position)===undefined&&Math.hypot(summer.position[0]-2436.3,summer.position[1]-218.4)>8,`Summer Street: ${summer.position}`);
 // beside Ukraine Way's deck, its heads over the deck, not across Washington Street from the end of it
 const ukraine=of('-4_5',[-3352.152,5766.657]);assert.ok(ukraine.road.elevations&&signalHeads(ukraine).every(head=>deck(...head))&&ukraine.position[0]>-3345,`Ukraine Way: ${ukraine.position}`);
});
