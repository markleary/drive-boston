import assert from 'node:assert/strict';
import test from 'node:test';
import {loadMetroCity,readJson} from './helpers/metro-city.mjs';
import {bridgeBarriers,roadProjection} from '../src/simulation/road-surfaces.ts';
import {canopyHitsDeck,STREET_CANOPY} from '../src/simulation/deck-canopy.ts';
import {tunnelPointAt} from '../src/simulation/tunnels.ts';
import {isHighwayDeck,stations} from '../src/simulation/motorway.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {bareCurbStretches} from '../src/simulation/tile-format.ts';
import {tileStalls} from '../src/simulation/parking-lots.ts';

// The surveyed roadways of the Turnpike and Storrow Drive (scripts/highway_roadways.py): a deck on the ground carries
// the edges of its roadway (`roadway`), which the tile paves, and a cut is as wide as its surveyed trench.
const line=(x0,x1,step=3)=>Array.from({length:Math.round((x1-x0)/step)+1},(_,i)=>[x0+i*step,0]);
const deck=(points,extra={})=>({id:'storrow-wb-01',name:'Storrow Drive West · Test',kind:'motorway',points,width:6.6,oneway:1,lanes:2,elevations:points.map(()=>.35),deckWidths:points.map(()=>6.6),startLevel:1,endLevel:1,bridge:{id:'storrow',kind:'boston-highway',thickness:.75},...extra});

test('nothing is planted in the surveyed roadway beside a deck\'s lanes',()=>{
  const points=line(0,60),paved=deck(points,{roadway:points.map(()=>[6,3.3])}),plain=deck(points);
  // the road runs toward +x: its left, as the pavement records name their sides, is +z
  const hits=(road,z)=>canopyHitsDeck({roads:[road],footbridges:[]},30,z,0,STREET_CANOPY);
  assert.ok(hits(paved,5.5)&&hits(paved,6.5),'inside the roadway on the wide side, and within a trunk\'s room of its edge');
  assert.ok(!hits(paved,7.2),'beyond it a tree may stand');
  assert.ok(hits(paved,-3.9)&&!hits(paved,-4.5),'the other side keeps its own edge');
  assert.ok(!hits(plain,5.5)&&hits(plain,3.9),'a deck without one keeps only its own pavement clear');
  const part=deck(points,{roadway:points.map((_,i)=>i<10?[6,3.3]:null)});
  assert.ok(canopyHitsDeck({roads:[part],footbridges:[]},12,5.5,0,STREET_CANOPY)&&!canopyHitsDeck({roads:[part],footbridges:[]},45,5.5,0,STREET_CANOPY),'only the stations that have a roadway');
});

test('roadside signs stand beyond the surveyed roadway',()=>{
  const points=line(0,60),paved=deck(points,{roadway:points.map((_,i)=>[4+i*.1,3.3])});
  assert.equal(tunnelPointAt(deck(points),30).edge,3.3);
  assert.ok(Math.abs(tunnelPointAt(paved,30).edge-5)<1e-9,'the left edge, between two stations');
  assert.equal(tunnelPointAt(deck(points,{roadway:points.map(()=>[2,2])}),30).edge,3.3,'never inside the deck');
});

test('beside a paved roadway a rail stands in runs, never as a stub where the ground dips for a few metres',()=>{
  // ground 6 cm under the deck everywhere but on its left (+z) for 6 m at x 30 and for 36 m from x 60, where it lies 0.75 m under it
  const columns=41,rows=[-12,-9,-6,-3,0,3,6,9,12],low=x=>(x>=30&&x<=36)||(x>=60&&x<=96);
  const elevation={width:columns,height:rows.length,cellSize:3,originX:0,originZ:-12,heights:rows.flatMap(z=>Array.from({length:columns},(_,i)=>z>=3&&low(i*3)?-.4:.29))};
  const points=line(0,120),paved=deck(points,{roadway:points.map(()=>[5,5])}),rails=bridgeBarriers({roads:[paved],elevation},paved);
  assert.ok(rails.length&&rails.every(r=>r.z>0),'only the side the ground falls away on');
  assert.ok(rails.every(r=>r.x>55&&r.x<101),`no rail at the short dip: ${rails.filter(r=>r.x<=55).map(r=>r.x.toFixed(0))}`);
  const total=rails.reduce((sum,r)=>sum+r.length,0);assert.ok(total>30&&total<44,`${total.toFixed(1)} m along the long one`);
  // a carriageway with no surveyed roadway is railed all along, as before
  const plain=deck(points),all=bridgeBarriers({roads:[plain],elevation},plain);assert.ok(all.some(r=>r.x>28&&r.x<38)&&all.some(r=>r.z<0));
});

test('a tile\'s undrawn curb stretches are read in metres along each curb',()=>{
  const bare=bareCurbStretches({bareCurbs:[3,0,1250,3,4000,5200,7,210,900]});
  assert.deepEqual(bare.get(3),[[0,12.5],[40,52]]);assert.deepEqual(bare.get(7),[[2.1,9]]);assert.equal(bareCurbStretches({}).size,0);
});

// ---- the installed package
const city=await loadMetroCity({tiles:['0_-1','0_-2']});
const byId=new Map(city.roads.filter(r=>/^(i90|storrow|route1a)-/.test(r.id)).map(r=>[r.id,r]));
const inside=(p,rings)=>{let hit=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
const paved=p=>[...city.loadedTiles.values()].some(tile=>(tile.streetPavement??[]).some(rings=>inside(p,rings)));
const frame=(road,i)=>{const a=road.points[Math.max(0,i-1)],b=road.points[Math.min(road.points.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return{p:road.points[i],n:[-(b[1]-a[1])/l,(b[0]-a[0])/l]};};

test('Storrow Drive West at Arlington Street is paved between its surveyed curbs, flush with the ground and without rails',()=>{
  const road=byId.get('storrow-wb-01');assert.ok(road?.roadway,'the deck carries its roadway');
  const along=stations(road.points),wide=road.roadway.map(e=>e?e[0]+e[1]:0);
  assert.ok(Math.max(...wide)>=11,`the roadway the on-ramp from Beacon Street shares is ${Math.max(...wide).toFixed(1)} m wide (the lanes' deck is ${road.width} m)`);
  // 60 m of it at least are 10 m wide or more: Storrow Drive does not narrow to its two lanes where the footbridge crosses
  assert.ok(wide.filter(w=>w>=10).length*3>=60);
  let flush=0,checked=0;
  for(let i=8;i<road.points.length-8;i+=4){
    const e=road.roadway[i];if(!e)continue;
    const {p,n}=frame(road,i),y=road.elevations[i];if(p[0]<e[0]+e[1]+2)continue;   // (the record runs on into tile -1_-1, which is not loaded here)
    for(const o of [e[0]-.6,0,-(e[1]-.6)]){
      const q=[p[0]+n[0]*o,p[1]+n[1]*o];checked++;
      assert.ok(paved(q),`asphalt ${o.toFixed(1)} m across the deck at ${p}`);
      const under=y-sampleElevation(city,q[0],q[1]);assert.ok(under>=.01&&under<.5,`the ground lies ${under.toFixed(2)} m under the deck ${o.toFixed(1)} m across it at ${p}`);if(under<.2)flush++;
    }
  }
  assert.ok(checked>40&&flush>checked*.8,`${flush} of ${checked} points lie within 20 cm of the deck: the roadway is one surface`);
  const rails=bridgeBarriers(city,road).reduce((sum,r)=>sum+r.length,0);
  assert.ok(rails<.05*2*along.at(-1),`${rails.toFixed(0)} m of rail along a street's pavement`);
});

test('the Turnpike keeps its rails: only a deck with a surveyed roadway on the ground loses them',()=>{
  const railed=[...byId.values()].filter(r=>isHighwayDeck(r)&&r.id.startsWith('i90-eb-')&&!r.roadway&&/^i90-eb-\d+$/.test(r.id)).slice(0,6);
  assert.ok(railed.length>=3&&railed.every(r=>bridgeBarriers(city,r).length>0));
});

test('the tunnel\'s exit and the Berkeley Street entrance run in cuts as wide as their surveyed trenches',()=>{
  const exit=byId.get('storrow-eb-21'),entrance=byId.get('storrow-eb-entrance-berkeley-3');
  const open=r=>r.deckWidths.filter((_,i)=>!r.tunnel.covered.some(([a,b])=>stations(r.points)[i]>=a-.01&&stations(r.points)[i]<=b+.01));
  assert.ok(Math.max(...open(exit))>=9,`the exit's cut is ${Math.max(...open(exit))} m wide at most (6.05 m as sized by its lanes)`);
  assert.ok(exit.deckWidths.at(-1)>=7.5,'and still wide where it meets the street');
  assert.ok(Math.max(...open(entrance))>=6.8,`the entrance's cut is ${Math.max(...open(entrance))} m wide at most (4.6 m by its lane)`);
  // no step in either
  for(const r of [exit,entrance])for(let i=1;i<r.deckWidths.length;i++)assert.ok(Math.abs(r.deckWidths[i]-r.deckWidths[i-1])/2<=3.2/8+.06,`${r.id} steps at station ${i}`);
});

test('Charles Circle has its ramps to and from Storrow Drive',()=>{
  const vertices=new Map();
  for(const r of city.roads)if(!/^(i90|storrow|route1a)-/.test(r.id))for(const p of r.points)vertices.set(`${p[0]},${p[1]}`,r);
  const route=id=>[...byId.values()].filter(r=>r.id===id||new RegExp(`^${id}-\\d+$`).test(r.id)).sort((a,b)=>(Number(a.id.slice(id.length+1))||1)-(Number(b.id.slice(id.length+1))||1));
  for(const [id,from,to] of [['storrow-wb-exit-charles-circle','Charlesbank Road','Cambridge Street'],['storrow-wb-entrance-charles-circle','Cambridge Street','Charlesbank Road']]){
    const chain=route(id);assert.ok(chain.length>=2,`${id} is installed`);
    const start=vertices.get(chain[0].points[0].join(',')),end=vertices.get(chain.at(-1).points.at(-1).join(','));
    assert.equal(start?.name,from,`${id} starts on a vertex of ${from}`);assert.ok(end&&[to,'Charles Street'].includes(end.name),`${id} ends on a vertex of ${to}`);
    for(let i=1;i<chain.length;i++)assert.deepEqual(chain[i-1].points.at(-1),chain[i].points[0]);
    // it lands on the ground at both ends and crosses the northbound road on a deck
    assert.ok(Math.abs(chain[0].elevations[0]-sampleElevation(city,...chain[0].points[0]))<.2&&Math.abs(chain.at(-1).elevations.at(-1)-sampleElevation(city,...chain.at(-1).points.at(-1)))<.2);
    const top=Math.max(...chain.flatMap(r=>r.elevations.map((y,i)=>y-sampleElevation(city,...r.points[i]))));assert.ok(top>4.5,`${id} rises ${top.toFixed(1)} m over the ground`);
  }
  // the branch to the Longfellow Bridge leaves the exit ramp at a record seam and climbs to Cambridge Street's approach
  const branch=route('storrow-wb-exit-charles-circle-longfellow');assert.ok(branch.length>=1&&vertices.get(branch.at(-1).points.at(-1).join(','))?.name==='Cambridge Street','the branch ends on a vertex of Cambridge Street');
  assert.ok(route('storrow-wb-exit-charles-circle').some(r=>`${r.points.at(-1)}`===`${branch[0].points[0]}`),'and starts where a record of the exit ramp ends');
});

test('no curb is drawn standing alone, and the lots by Charles Circle have their stalls',()=>{
  const surfaces=[...city.loadedTiles.values()].flatMap(tile=>[...(tile.streetPavement??[]),...(tile.streetSidewalks??[]),...tile.sidewalks.map(w=>w.rings),...tile.islands,...tile.driveways]);
  const near=(p,d)=>surfaces.some(rings=>{if(inside(p,rings))return true;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)<=d)return true;}return false;});
  const decks=city.roads.filter(r=>r.elevations);
  const onDeck=p=>decks.some(r=>{const b=r.points;if(p[0]<Math.min(b[0][0],b.at(-1)[0])-400||p[0]>Math.max(b[0][0],b.at(-1)[0])+400)return false;return roadProjection(r,p[0],p[1]).distance<=Math.max(r.width,...(r.deckWidths??[]))/2+.6;});
  const tile=city.loadedTiles.get('0_-1'),bare=bareCurbStretches(tile);let drawn=0,alone=0,hidden=0;
  // around the Arlington Street ramps: every stretch of curb that is drawn has a roadway, a sidewalk, an island or a lot beside it
  for(const [index,curb] of tile.curbs.entries()){
    let along=0;
    for(let i=1;i<curb.length;i++){
      const a=curb[i-1],b=curb[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(let s=1;s<length;s+=2){
        const p=[a[0]+(b[0]-a[0])*s/length,a[1]+(b[1]-a[1])*s/length];if(p[0]<-20||p[0]>220||p[1]<-800||p[1]>-600)continue;
        if(bare.get(index)?.some(([lo,hi])=>along+s>=lo&&along+s<=hi)){hidden++;continue;}
        drawn++;if(!near(p,1.6)&&!onDeck(p))alone++;
      }
      along+=length;
    }
  }
  assert.ok(drawn>300,`${drawn} curb samples drawn around the ramps`);assert.ok(alone<=drawn*.01,`${alone} of ${drawn} drawn curb samples have nothing beside them`);
  const stalls=tileStalls(city.loadedTiles.get('0_-2')).filter(s=>s.x>150&&s.x<450&&s.z>-1600&&s.z<-1250);
  assert.ok(stalls.length>=40,`${stalls.length} stalls in the lots north of the Longfellow Bridge`);
});

// The two carriageways of a road at one height (the twins of scripts/boston_highways.py). Solved each on its own ground they
// stood 0.3 to 0.5 m apart along Storrow Drive between Massachusetts Avenue and Dartmouth Street, and the 6 m grid cannot hold
// two levels a lane apart: the eastbound one stood proud of the ground on its median side, behind a rail.
const twins=readJson('provenance.json').bostonHighways.twins;
const decksOf=route=>[...byId.values()].filter(r=>isHighwayDeck(r)&&new RegExp(`^${route}-\\d+$`).test(r.id));
/** The deck of the other carriageway beside station i of `road`: its height and grade there, what lies between the two
 * pavements and the side it is on, or nothing where no deck of it runs alongside. */
function beside(road,i,others){
  const [x,z]=road.points[i];let best;
  for(const o of others){const hit=roadProjection(o,x,z);if(!best||hit.distance<best.hit.distance)best={o,hit};}
  if(!best)return;
  const {o,hit}=best,k=hit.index,a=o.points[k],b=o.points[k+1],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,{n}=frame(road,i);
  if((k===0&&hit.t<=0)||(k===o.points.length-2&&hit.t>=1)||Math.abs((b[0]-a[0])*n[1]-(b[1]-a[1])*n[0])/l<.87)return;
  const at=v=>v[k]+(v[k+1]-v[k])*hit.t;
  return{road:o,height:at(o.elevations),grade:Math.abs(o.elevations[k+1]-o.elevations[k])/l,median:hit.distance-(road.deckWidths[i]+at(o.deckWidths))/2,side:Math.sign((hit.x-x)*n[0]+(hit.z-z)*n[1])||1};
}

test('the two carriageways of Storrow Drive lie at one height from Massachusetts Avenue to Dartmouth Street',()=>{
  const west=decksOf('storrow-wb');let near=0,level=0,edges=0,flush=0,rail=0,length=0;
  for(const id of ['storrow-eb-12','storrow-eb-14','storrow-eb-16','storrow-eb-18','storrow-eb-19']){
    const road=byId.get(id);assert.ok(road&&isHighwayDeck(road)&&road.roadway,`${id} is a deck with its roadway`);
    length+=stations(road.points).at(-1);rail+=bridgeBarriers(city,road).reduce((sum,r)=>sum+r.length,0);
    for(let i=0;i<road.points.length;i++){
      const twin=beside(road,i,west);if(!twin||twin.median>6)continue;
      near++;if(Math.abs(road.elevations[i]-twin.height)<=.05)level++;
      // the edge of its roadway on the median's side lies on the ground: no ledge, no rail
      const e=road.roadway[i];if(!e)continue;
      const {p,n}=frame(road,i),o=twin.side*((twin.side>0?e[0]:e[1])-.3);edges++;if(road.elevations[i]-sampleElevation(city,p[0]+n[0]*o,p[1]+n[1]*o)<.25)flush++;
    }
  }
  assert.ok(near>200,`${near} stations of the eastbound decks have the westbound deck within 6 m`);
  assert.ok(level>=near*.97,`${level} of ${near} lie within 5 cm of it (6 of 237 before the two were brought level)`);
  assert.ok(flush>=edges*.95,`${flush} of ${edges} median-side edges lie within 0.25 m of the ground (50 of 230 before)`);
  assert.ok(rail<.1*length,`${rail.toFixed(0)} m of rail along ${length.toFixed(0)} m of roadway (389 m before)`);
});

test('no carriageway deck lies a step under its twin across a median, but where the stage lists it',()=>{
  assert.deepEqual(twins.pairs.map(p=>p.roads),[['i90-eb','i90-wb'],['storrow-eb','storrow-wb']]);
  const listed=new Map();for(const pair of twins.pairs)for(const e of pair.apart)listed.set(e.road,[...(listed.get(e.road)??[]),e.stations]);
  let checked=0;
  for(const pair of twins.pairs)for(const [mine,theirs] of [pair.roads,[...pair.roads].reverse()]){
    const others=decksOf(theirs);
    for(const road of decksOf(mine))for(let i=0;i<road.points.length;i++){
      const twin=beside(road,i,others);if(!twin||twin.median>3)continue;
      checked++;const under=twin.height-road.elevations[i];
      // (the records lie where the curb survey put them, a few metres from the lines the stage paired: 2 m along the twin's grade)
      assert.ok(under<=.05+2*twin.grade||(listed.get(road.id)??[]).some(([lo,hi])=>i>=lo-2&&i<=hi+2),`${road.id} lies ${under.toFixed(2)} m under ${twin.road.id} at ${road.points[i]}`);
    }
  }
  assert.ok(checked>3500,`${checked} deck stations have the twin's deck within 3 m (1,446 of 4,009 lay a step under it before)`);
  // what could not be brought level (a fade before a portal, a street landing or a building, the room under a bridge) is a small part of it
  const apart=twins.pairs.map(p=>p.apart.reduce((sum,e)=>sum+e.stations[1]-e.stations[0]+1,0)),beside_=twins.pairs.map(p=>p.alongsideMeters);
  assert.ok(apart[0]*3<=.1*beside_[0],`${apart[0]} stations of the Turnpike left apart along ${beside_[0]} m`);assert.ok(apart[1]*3<=.02*beside_[1],`${apart[1]} of Storrow Drive along ${beside_[1]} m`);
  const lifted=twins.pairs[1].lifted;assert.ok(lifted['storrow-wb'].meters>1500&&lifted['storrow-wb'].max<.9,`Storrow Drive West rose over ${lifted['storrow-wb'].meters} m, by ${lifted['storrow-wb'].max} m at most`);
});

test('the ground came up with a Turnpike carriageway its twin has lifted: no deck edge floats over the median',()=>{
  let checked=0,floating=0;
  for(const [mine,theirs] of [['i90-eb','i90-wb'],['i90-wb','i90-eb']]){
    const others=decksOf(theirs);
    for(const road of decksOf(mine))for(let i=0;i<road.points.length;i++){
      const twin=beside(road,i,others);if(!twin||twin.median>3)continue;
      const {p,n}=frame(road,i),y=road.elevations[i];if(y-sampleElevation(city,p[0],p[1])>1)continue;   // (on the ground: a viaduct has none)
      const o=twin.side*(road.deckWidths[i]/2-.3);checked++;if(y-sampleElevation(city,p[0]+n[0]*o,p[1]+n[1]*o)>.75)floating++;
    }
  }
  assert.ok(checked>2000,`${checked} Turnpike deck stations on the ground beside the twin's deck`);
  assert.ok(floating<=checked*.03,`the median-side edge of ${floating} stands more than its slab (0.75 m) over the ground (255 of 2,490 before)`);
});
