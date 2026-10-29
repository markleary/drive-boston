import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';
import {planTrafficSignals} from '../src/simulation/signal-placement.ts';
import {closestRoad,pointInside} from '../src/simulation/roads.ts';
import {reserveTransitCorridors,inTransitCorridor} from '../src/simulation/transit-corridors.ts';
import {loadCentralCity,loadMetroCity} from './helpers/metro-city.mjs';
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
