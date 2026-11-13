import assert from 'node:assert/strict';
import test from 'node:test';
import {bridgeEdgeSections} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {loadMetroCity,readJson} from './helpers/metro-city.mjs';

// The two carriageways of Interstate 93 at one height (the twins of scripts/i93_north.py). Solved each on its own
// ground they came out a step apart along 2.2 km of the 5.6 km where no more than a grid cell lies between their
// pavements, and those pavements meet or overlap through most of Medford: where they did, a step under 0.8 m was a
// bare ledge down the middle of the road (the runtime rails no edge another deck covers within that) and a higher one
// a wall. The lower now follows the higher, the ground comes up with it, and what stays apart is listed.
const city=await loadMetroCity({tiles:[]}),twins=readJson('provenance.json').i93North.twins;
const series=prefix=>city.roads.filter(r=>new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>+a.id.split('-').at(-1)-+b.id.split('-').at(-1));
/** A carriageway as one line: its points, heights, widths and, per station, the records (id, index) it belongs to. */
function chain(records){
  const points=[],y=[],w=[],own=[];
  for(const r of records)r.points.forEach((p,i)=>{if(i===0&&points.length){own.at(-1).push([r.id,0]);return;}points.push(p);y.push(r.elevations[i]);w.push(r.deckWidths[i]);own.push([[r.id,i]]);});
  const along=[0];for(let i=1;i<points.length;i++)along.push(along[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
  return{points,y,w,own,along,records};
}
const lanes={nb:chain(series('i93-nb')),sb:chain(series('i93-sb'))};
const tangent=(c,i)=>{const a=c.points[Math.max(0,i-1)],b=c.points[Math.min(c.points.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return[(b[0]-a[0])/l,(b[1]-a[1])/l];};
/** The twin beside station i of a carriageway: its height and half width at the nearest point, what lies between the two
 * pavements, and which side it is on (1: the side of the normal (-tz, tx), as deckEdge counts sides). Undefined beyond the twin's ends or where they do not run the same way. */
function beside(c,i,o){
  const [x,z]=c.points[i];let best;
  for(let k=1;k<o.points.length;k++){
    const a=o.points[k-1],b=o.points[k],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l2)),d=Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);
    if(!best||d<best.d)best={d,k,t,dx,dz,l:Math.sqrt(l2)};
  }
  const {d,k,t,dx,dz,l}=best,s=o.along[k-1]+t*l,[tx,tz]=tangent(c,i);
  if(s<=.5||s>=o.along.at(-1)-.5||Math.abs(tx*dx+tz*dz)/l<.87)return;
  const lerp=v=>v[k-1]+(v[k]-v[k-1])*t,px=o.points[k-1][0]+dx*t,pz=o.points[k-1][1]+dz*t;
  return{height:lerp(o.y),half:lerp(o.w)/2,median:d-c.w[i]/2-lerp(o.w)/2,side:Math.sign((px-x)*-tz+(pz-z)*tx)||1,x:px,z:pz};
}
const listed=new Map();for(const pair of twins.pairs)for(const e of pair.apart)listed.set(e.road,[...(listed.get(e.road)??[]),e]);
const isListed=(c,i)=>c.own[i].some(([id,j])=>(listed.get(id)??[]).some(e=>j>=e.stations[0]-2&&j<=e.stations[1]+2));
const pairs=[['nb','sb'],['sb','nb']];

test('neither carriageway lies a step under the other across the median, but where the stage lists it',()=>{
  assert.deepEqual(twins.pairs.map(p=>p.roads),[['i93-nb','i93-sb']]);
  let checked=0,level=0;
  for(const [mine,theirs] of pairs){
    const c=lanes[mine],o=lanes[theirs];
    for(let i=0;i<c.points.length;i++){
      const twin=beside(c,i,o);if(!twin||twin.median>6)continue;
      checked++;const under=twin.height-c.y[i];if(Math.abs(under)<=.05)level++;
      assert.ok(under<=.05||isListed(c,i),`${c.own[i][0][0]} lies ${under.toFixed(2)} m under its twin at ${c.points[i]}`);
    }
  }
  assert.ok(checked>3800,`${checked} stations have the twin's pavement within 6 m (1,512 of 3,865 lay more than 0.25 m from it before)`);
  assert.ok(level/checked>.95,`${level} of ${checked} lie within 5 cm of their twin (1,130 before)`);
  // What stays apart: the way between two levels in Charlestown, where the southbound road climbs to the lower deck of the
  // viaduct beside the northbound one coming down from the upper, and the room under the Fellsway West bridge, which stands
  // 1.2 m higher over the northbound road than over the southbound one. Everything else is a fade of centimetres.
  const steps=twins.pairs[0].apart.filter(e=>e.by>.25);
  assert.deepEqual(steps.map(e=>e.road),['i93-nb-02','i93-sb-05','i93-sb-06'],JSON.stringify(steps));
  assert.ok(steps[0].by>4.15&&steps[0].stations[1]-steps[0].stations[0]<45,'the Charlestown stretch stands a storey apart for 120 m');
  assert.ok(steps[1].by<.6&&steps[1].stations[1]-steps[1].stations[0]<=12&&steps[2].stations[1]===0,'under the bridge: 0.58 m at most along 30 m');
  assert.ok(twins.pairs[0].apart.filter(e=>e.by<=.25).every(e=>e.by<.15),'and nothing else by more than 15 cm');
  const lifted=twins.pairs[0].lifted;
  assert.ok(lifted['i93-nb'].meters>3000&&lifted['i93-nb'].max<2.3&&lifted['i93-sb'].meters>1500&&lifted['i93-sb'].max<2.7,JSON.stringify(lifted));
});

test('where their pavements meet the two are one surface: no ledge runs down the middle of the road without a rail',()=>{
  // The runtime rails no deck edge that another deck covers within 0.8 m of its height (bridgeEdgeSections), so the two
  // carriageways have no rail between them wherever their pavements overlap, about a kilometre of the road in all: at 92 of
  // those 705 stations they stood 0.25 to 0.8 m apart.
  let unrailed=0,worst=0;
  for(const [mine,theirs] of pairs){
    const c=lanes[mine],o=lanes[theirs];let at=0;
    for(const road of c.records){
      const exposed=new Map();for(const e of bridgeEdgeSections(city,road,.18,-.06))exposed.set(`${e.index},${e.side}`,(exposed.get(`${e.index},${e.side}`)??0)+Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1]));
      for(let j=1;j<road.points.length;j++){
        const i=at+j,twin=beside(c,i,o);if(!twin||twin.median>.5)continue;
        const length=Math.hypot(road.points[j][0]-road.points[j-1][0],road.points[j][1]-road.points[j-1][1]);
        if((exposed.get(`${j},${twin.side}`)??0)>length/2)continue;
        unrailed++;const step=Math.abs(twin.height-c.y[i]);worst=Math.max(worst,step);
        assert.ok(step<=.15,`${road.id} station ${j}: a ${step.toFixed(2)} m ledge to its twin with no rail between them`);
      }
      at+=road.points.length-1;
    }
  }
  assert.ok(unrailed>600,`${unrailed} stations share their pavement with the twin (the worst step there is ${worst.toFixed(2)} m)`);
});

test('the ground came up with a lifted carriageway: none stands in a pavement, and no deck edge floats over the median',()=>{
  let grounded=0,floating=0,standing=0,worst=0;
  for(const [mine,theirs] of pairs){
    const c=lanes[mine],o=lanes[theirs];
    for(let i=0;i<c.points.length;i++){
      const twin=beside(c,i,o);if(!twin||twin.median>6)continue;
      const [x,z]=c.points[i],[tx,tz]=tangent(c,i),nx=-tz*twin.side,nz=tx*twin.side,y=c.y[i],half=c.w[i]/2;
      // both riding the ground at their centre lines, as the audit that found the class counted them
      if(y-sampleElevation(city,x,z)>.9||twin.height-sampleElevation(city,twin.x,twin.z)>.9)continue;
      grounded++;
      for(let k=0;k<=8;k++){const off=(half-.3)*(k/4-1);if(sampleElevation(city,x+nx*off,z+nz*off)>y+.02){standing++;break;}}
      const over=y-sampleElevation(city,x+nx*(half+.3),z+nz*(half+.3));worst=Math.max(worst,over);if(over>.75)floating++;
    }
  }
  assert.ok(grounded>2300,`${grounded} stations where both carriageways ride the ground`);
  assert.equal(standing,0,'ground stood up to 0.27 m over the southbound pavement at five stations under the Fellsway West bridge');
  // (what is left is where the higher carriageway itself stands that far over its ground: the lifted one then stands beside it as it does)
  assert.ok(floating<=20&&worst<.95,`the median edge stands more than a slab (0.75 m) over the ground at ${floating} stations, ${worst.toFixed(2)} m at most (105 before, 1.53 m)`);
});
