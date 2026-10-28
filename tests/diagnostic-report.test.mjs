import assert from 'node:assert/strict';
import test from 'node:test';
import {compassHeading,formatLocationReport} from '../src/ui/diagnostic-report.ts';

test('debug compass follows Boston world axes, including wrapped headings',()=>{
  const cases=[{yaw:Math.PI,bearing:0},{yaw:Math.PI/2,bearing:90},{yaw:0,bearing:180},{yaw:-Math.PI/2,bearing:270}];
  for(const {yaw,bearing} of cases)for(const revolutions of [-2,0,3]){
    const result=compassHeading(yaw+revolutions*Math.PI*2);
    const difference=Math.abs(((result-bearing+540)%360)-180);
    assert.ok(difference<1e-9,`yaw ${yaw} should face bearing ${bearing}`);
  }
});

test('copied location identifies the active elevated vehicle and exact road without implying geographic coordinates',()=>{
  const data={
    state:{x:-1440.125,y:88.752,z:112.5,yaw:Math.PI/2,speed:4.2,steering:0},
    groundHeight:-.5,road:{name:'Bowker Overpass',id:'deck-upper-42'},neighborhood:'Fenway',
    camera:'chase',lighting:'golden',quality:'high',travelMode:'helicopter',timestamp:'2026-10-27T20:15:00.000Z',
    performance:{fps:59,frameMs:16.95,drawCalls:850,triangles:2100000,geometries:190,textures:48,traffic:20,transit:4,pedestrians:26},
  };
  const report=formatLocationReport(data);
  assert.match(report,/Active vehicle: helicopter/);
  assert.match(report,/Road ID: deck-upper-42/);
  assert.match(report,/X=-1440\.125, Y=88\.752, Z=112\.500/);
  assert.match(report,/Heading: 90\.0 deg \/ yaw=1\.570796 rad/);
  assert.match(report,/above terrain: 89\.25 m/);
  assert.match(report,/Captured: 2026-10-27T20:15:00\.000Z/);
  assert.match(report,/2,100,000 triangles \(all passes\)/);
  assert.match(report,/20 traffic cars \/ 4 transit vehicles \/ 26 pedestrians/);
  assert.doesNotMatch(report,/latitude|longitude|GPS/i);
  assert.equal(formatLocationReport({...data,timestamp:undefined}).includes('Captured:'),false);
  assert.equal(data.state.y,88.752,'reporting must not mutate live vehicle data');
});
