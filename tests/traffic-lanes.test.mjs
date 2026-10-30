import assert from 'node:assert/strict';
import test from 'node:test';
import {roadGraph,lane} from '../src/simulation/traffic.ts';

// Traffic lanes must sit inside the roadway the curbs measured, not the class width guess: a car is about 1.9 m wide.
const HALF_CAR=.95;
const road=(id,extra={})=>({id,name:'Huntington Avenue',width:15,oneway:1,points:[[0,0],[200,0]],...extra});
const city=roads=>({bounds:{minX:-100,maxX:300,minZ:-100,maxZ:100},spawn:{x:0,z:0,yaw:0},roads,buildings:[],signals:[]});
const reach=edges=>Math.max(...edges.flatMap(e=>lane(e).map(p=>Math.abs(p[1]))));

test('traffic lanes stay between the measured curbs of a carriageway narrower than its class width',()=>{
 // A one-way Huntington carriageway beside the Green Line reservation: 7.5 m between the curbs, two lanes.
 const wide=roadGraph(city([road('reservation',{pavedWidth:7.5})])).edges;
 assert.equal(wide.length,2,'a 15 m class one-way avenue keeps two lanes where 7.5 m of roadway holds them');
 assert.ok(reach(wide)+HALF_CAR<=7.5/2,`lanes at ${reach(wide)} m from the centerline fit a 7.5 m carriageway`);
 // Segment 9275-0-0 at Copley Place: 5.34 m between the curbs, class width 15, one lane.
 const narrow=roadGraph(city([road('copley',{pavedWidth:5.34})])).edges;
 assert.equal(narrow.length,1,'a 5.34 m roadway carries a single lane');
 assert.ok(reach(narrow)+HALF_CAR<=5.34/2,`lane ${reach(narrow)} m from the centerline fits a 5.34 m roadway`);
 // A two-way street measured at 6 m carries both directions inside it.
 const twoWay=roadGraph(city([road('two-way',{name:'Main Avenue',width:16,oneway:0,pavedWidth:6})])).edges;
 assert.equal(twoWay.length,2);assert.ok(reach(twoWay)+HALF_CAR<=3,`two-way lanes ${reach(twoWay)} m out fit a 6 m roadway`);
 // Without a measurement (decks and tunnels) the class width still decides.
 const guessed=roadGraph(city([road('deck')])).edges;
 assert.equal(guessed.length,2);assert.ok(Math.abs(reach(guessed)-Math.min(3,15*.17))<1e-9);
});
