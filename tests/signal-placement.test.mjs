import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';
import {planTrafficSignals} from '../src/simulation/signal-placement.ts';
import {pointInside} from '../src/simulation/roads.ts';
import {reserveTransitCorridors,inTransitCorridor} from '../src/simulation/transit-corridors.ts';
import {loadCentralCity} from './helpers/metro-city.mjs';
const distance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);};
test('signal poles stand clear of every travel lane and building at real angled Boston intersections',async()=>{
 const city=await loadCentralCity();
 reserveTransitCorridors(city,JSON.parse(fs.readFileSync(new URL('../public/data/transit.json',import.meta.url),'utf8')).routes);
 const placed=planTrafficSignals(city);assert.ok(placed.length>180,'retain controls throughout the city');
 for(const signal of placed)assert.equal(inTransitCorridor(city,...signal.position),false,'rail vehicle envelope stays clear');
 for(const signal of placed){for(const road of city.roads.filter(r=>!r.elevations))for(let i=1;i<road.points.length;i++)assert.ok(distance(signal.position,road.points[i-1],road.points[i])>=road.width/2+.54,`pole in ${road.name}`);assert.ok(city.buildings.every(b=>!pointInside(signal.position,b.footprint)));assert.ok(Math.hypot(signal.position[0]-signal.source[0],signal.position[1]-signal.source[1])<45);}
});
