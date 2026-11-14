import assert from 'node:assert/strict';
import test from 'node:test';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {medianBarriers,medianBarrierBoxes,medianSpans,MEDIAN_REACH,MEDIAN_LEVEL,MEDIAN_STEP,MEDIAN_FOOT,MEDIAN_COVER,MEDIAN_LAP} from '../src/simulation/median-barriers.ts';
import {bridgeBarriers,deckEdge,roadProjection,roadWidthAt,sampleRoadElevation,JERSEY,RAIL_LIP,RAIL_RUN} from '../src/simulation/road-surfaces.ts';
import {tunnelCoveredAt,tunnelGeometry,tunnelStations} from '../src/simulation/tunnels.ts';
import {motorwayLanes} from '../src/simulation/motorway.ts';
import {DrivingPhysics} from '../src/physics/vehicle.ts';

// The median barrier row (tests/median-barriers.test.mjs holds it between two decks) carried on through a highway's walled cuts.
// A cut is a tunnel record open to the sky; the Turnpike changes between deck and cut every few hundred metres, and about a
// third of its open median has a cut on one side or both. Left to the decks alone the row would stop at every such joint, and
// where two cuts' pavements overlap `unionWalls` took both walls out and left nothing between the two directions, or a cut's
// wall stood well inside the other road's inner lane. Synthetic records first, on a terrain grid of 2 m cells; then the package.
const LEVEL=.06,W=10,H=JERSEY.height,line=(x0,x1,z=0,step=3)=>{const n=Math.max(1,Math.round(Math.abs(x1-x0)/step));return Array.from({length:n+1},(_,i)=>[x0+(x1-x0)*i/n,z]);};
const deck=(id,points,highway='i90',extra={})=>({id,name:'Test',kind:'motorway',points,width:W,oneway:1,lanes:2,elevations:points.map(()=>LEVEL),deckWidths:points.map(()=>W),startLevel:1,endLevel:1,bridge:{id:highway,kind:'boston-highway',thickness:.75},...extra});
const cut=(id,points,highway='i90',extra={})=>({...deck(id,points,highway),bridge:undefined,highway,startLevel:-1,endLevel:-1,tunnel:{clearance:3.2,covered:[]},...extra});
function world(roads,height=()=>0){
  const cellSize=2,originX=-120,originZ=-60,width=220,rows=61,heights=new Float32Array(width*rows);
  for(let j=0;j<rows;j++)for(let i=0;i<width;i++)heights[j*width+i]=height(originX+i*cellSize,originZ+j*cellSize)??0;
  return{bounds:{minX:originX,maxX:originX+(width-1)*cellSize,minZ:originZ,maxZ:originZ+(rows-1)*cellSize},buildings:[],roads,spawn:{x:0,z:0,yaw:0},elevation:{width,height:rows,cellSize,originX,originZ,heights}};
}
/** The eastbound road runs along z = 0 with its median on the north; the other runs west, `gap` metres of ground between the two pavements. */
const east=(make=deck,extra={})=>make('i90-eb-01',line(0,120),'i90',extra),west=(gap,make=deck,extra={})=>make('i90-wb-01',line(120,0,-(W+gap)),'i90',extra);
const metres=runs=>runs.reduce((sum,run)=>sum+run.slice(1).reduce((m,s,i)=>m+Math.hypot(s.x-run[i].x,s.z-run[i].z),0),0),railed=(city,road,side)=>bridgeBarriers(city,road).filter(p=>p.side===side).reduce((sum,p)=>sum+p.length,0);
/** The highest surface of one of a cut's meshes over the pavement, within a box in plan. */
function meshTop(mesh,x0,x1,z0,z1){let top=-Infinity;const v=mesh.vertices;for(let i=0;i<v.length;i+=3)if(v[i]>=x0&&v[i]<=x1&&v[i+2]>=z0&&v[i+2]<=z1)top=Math.max(top,v[i+1]-LEVEL);return top;}
const GAP=.75,MID=-W/2-GAP/2;

test('a cut takes part like a deck: the row runs on between the two roads and the cut has no wall of its own there',()=>{
  // a deck beside a cut 0.75 m off, as the Turnpike's are: the lower id carries the row, here the deck
  const a=east(),b=west(GAP,cut),c1=world([a,b]),row=medianBarriers(c1,a),shell=tunnelGeometry(c1,b);
  assert.ok(Math.abs(metres(row)-120)<.2&&row.length===1,`${metres(row).toFixed(1)} m of row in ${row.length} run`);
  for(const s of row[0])assert.ok(Math.abs(s.z-MID)<.01&&Math.abs(s.y-LEVEL)<.01&&Math.abs(s.half-(GAP/2+MEDIAN_LAP))<.01,'on the middle line, on the pavement, its foot across the strip');
  assert.equal(railed(c1,a,-1),0,'the deck has no rail on its median');assert.ok(railed(c1,a,1)>119);
  assert.deepEqual(medianSpans(c1,b,-1).map(([from,to])=>[Math.round(from),Math.round(to)]),[[0,120]]);
  assert.equal(meshTop(shell.walls,2,118,-W-GAP-.3,-W/2),-Infinity,'no wall of the cut\'s along the median');
  assert.ok(meshTop(shell.walls,2,118,-2*W-GAP-1,-W-GAP-W/2)>.79,'its outer side is walled as before');assert.equal(shell.median.indices.length,0,'and the deck draws the row');
  // the other way round the cut carries it, in its own shell: the precast profile on the pavement
  const ca=east(cut),db=west(GAP),c2=world([ca,db]),carried=tunnelGeometry(c2,ca);
  assert.equal(medianBarriers(c2,db).length,0);assert.equal(railed(c2,db,-1),0);
  assert.ok(Math.abs(meshTop(carried.median,1,119,MID-JERSEY.base/2-.01,MID+JERSEY.base/2+.01)-H)<.01,'the row in the cut\'s shell, a barrier\'s height over the road');
  assert.equal(meshTop(carried.walls,2,118,-W/2-.3,-W/2+.3),-Infinity,'and no wall beside it');
  // two cuts, and two whose pavements overlap (where each one's wall was taken out of the other's excavation): one row, drawn once
  for(const gap of [GAP,-.8]){
    const cb=west(gap,cut),c3=world([ca,cb]),sa=tunnelGeometry(c3,ca),sb=tunnelGeometry(c3,cb),mid=-W/2-gap/2;
    assert.ok(Math.abs(meshTop(sa.median,1,119,mid-.4,mid+.4)-H)<.01&&sb.median.indices.length===0,`${gap} m between two cuts: the row in the lower id's shell`);
    for(const s of [sa,sb])assert.equal(meshTop(s.walls,2,118,-W/2-Math.max(0,gap)-.3,-W/2+Math.max(0,-gap)+.3),-Infinity,'no wall of either between the two roads');
    assert.ok(meshTop(sa.walls,2,118,W/2-.3,W/2+.6)>.79&&meshTop(sb.walls,2,118,-W-gap-W/2-.6,-W-gap-W/2+.3)>.79,'both outer walls stand');
  }
  // under a roof the two bores keep their walls: the row is for the open road, and ends at the portal
  const roofed=west(GAP,cut,{tunnel:{clearance:3.2,covered:[[40,80]]}}),c4=world([a,roofed]),open=medianSpans(c4,a,-1).map(([from,to])=>[Math.round(from),Math.round(to)]);
  assert.deepEqual(open,[[0,40],[80,120]],'the westbound road is roofed from x = 40 to 80');assert.ok(Math.abs(metres(medianBarriers(c4,a))-80)<1);
  assert.ok(railed(c4,a,-1)>39&&railed(c4,a,-1)<41,'and the deck has its rail along the roofed stretch');
});

test('roads that are no party are left as they were',()=>{
  // a road whose decks lie open on their surveyed roadway (Storrow Drive): its cuts are no parties, and their median is curbed and open
  const open=r=>({...r,roadway:r.points.map(()=>[W/2,W/2])}),pa=open(deck('storrow-eb-01',line(-60,0),'storrow')),ca=cut('storrow-eb-02',line(0,120),'storrow'),cb=cut('storrow-wb-01',line(120,0,-(W+GAP)),'storrow'),c1=world([pa,ca,cb]);
  for(const road of [ca,cb]){assert.deepEqual(medianSpans(c1,road,-1),[]);assert.equal(medianBarriers(c1,road).length,0);assert.equal(tunnelGeometry(c1,road).median.indices.length,0);}
  // a ramp's cut (the Turnpike's ramps lie open as their decks do), and a tunnel record that is no highway's cut
  const ramp={...open(deck('i90-eb-exit-9',line(-60,0,30))),kind:'motorway_link',lanes:1},slot={...cut('i90-eb-exit-9-2',line(0,120,30)),kind:'motorway_link',lanes:1},back={...cut('i90-wb-entrance-9',line(120,0,30-W-GAP)),kind:'motorway_link',lanes:1},c2=world([ramp,slot,back]);
  assert.deepEqual(medianSpans(c2,slot,-1),[]);assert.equal(medianBarriers(c2,slot).length,0);
  const bore={...cut('central-artery-nb',line(0,120)),highway:undefined},other={...cut('central-artery-sb',line(120,0,-(W+GAP))),highway:undefined},c3=world([bore,other]);
  assert.deepEqual(medianSpans(c3,bore,-1),[]);assert.ok(meshTop(tunnelGeometry(c3,bore).walls,2,118,-W/2-.3,-W/2+.3)>.79,'its wall stands');
  // more than MEDIAN_REACH between a deck and a cut, or another level: rail and wall as before
  for(const [gap,lift]of [[MEDIAN_REACH+1.5,0],[GAP,MEDIAN_LEVEL+.4]]){
    const a=east(),b=west(gap,cut,{elevations:line(120,0).map(()=>LEVEL-lift)}),c=world([a,b],(x,z)=>z<-W/2-gap+1?-lift:0);
    assert.equal(medianBarriers(c,a).length,0,`${gap} m apart, ${lift} m lower`);assert.ok(railed(c,a,-1)>119);assert.ok(meshTop(tunnelGeometry(c,b).walls,2,118,-W/2-gap-.3,-W/2-gap+.3)>-lift+.5);
  }
});

test('where ground stands between two cuts their walls hold it as before, and the row gives way for runs, not for stubs',()=>{
  // Two cuts 2 m apart. The terrain row inside the strip (z = -6) carries a ridge; the pavements' own cells stay level.
  const ca=east(cut),cb=west(2,cut),strip=(ridges)=>world([ca,cb],(x,z)=>z===-6?(ridges.find(([from,to])=>x>=from&&x<=to)?.[2]??0):0);
  const spans=(city,road=ca)=>medianSpans(city,road,-1),wall=(city,road,x0,x1)=>meshTop(tunnelGeometry(city,road).walls,x0,x1,road===ca?-W/2-.3:-W/2-2-.3,road===ca?-W/2+.3:-W/2-2+.3);
  // a ridge a metre high from x = 40 to 80: under a street bridge the grid between two cuts is the street's
  const high=strip([[40,80,1]]),open=spans(high);
  assert.equal(open.length,2);assert.ok(open[0][0]<.01&&Math.abs(open[0][1]-39)<2.5&&Math.abs(open[1][0]-81)<2.5&&Math.abs(open[1][1]-120)<.01,`the row runs to ${open[0][1].toFixed(1)} and on from ${open[1][0].toFixed(1)}`);
  // (each wall stands 0.8 m over the ground at its own line, which is half way up the ridge's flank on this grid)
  for(const road of [ca,cb]){assert.ok(wall(high,road,45,75)>1.1,'both cuts wall the ridge');assert.equal(wall(high,road,2,35),-Infinity);assert.equal(wall(high,road,85,118),-Infinity);}
  // the two records agree where the row gives way: each one's wall begins where the row ends, to the metre
  const [from,to]=[open[0][1],open[1][0]],theirs=spans(high,cb);
  assert.ok(Math.abs((120-theirs[0][1])-to)<1&&Math.abs((120-theirs[1][0])-from)<1,'the westbound cut opens its wall at the same two places');
  const rows=medianBarriers(high,ca);assert.equal(rows.length,2);assert.ok(Math.abs(Math.max(...rows[0].map(s=>s.x))-from)<.5&&Math.abs(Math.min(...rows[1].map(s=>s.x))-to)<.5);
  // ground up to RAIL_LIP over the pavements is covered by the foot instead: a low raised median, the row unbroken
  const low=strip([[40,80,.26]]),run=medianBarriers(low,ca);
  assert.equal(run.length,1);assert.ok(Math.abs(metres(run)-120)<.2);assert.deepEqual(spans(low).map(([a,b])=>[Math.round(a),Math.round(b)]),[[0,120]]);
  for(const s of run[0]){
    if(s.x>44&&s.x<76)assert.ok(Math.abs(s.foot-(.26-LEVEL+MEDIAN_COVER))<.02,`the foot stands ${s.foot?.toFixed(2)} m over the pavement at x ${s.x.toFixed(0)}, over ${(.26-LEVEL).toFixed(2)} m of ground`);
    if(s.x<34||s.x>86)assert.equal(s.foot,undefined);
  }
  assert.ok(.26-LEVEL<RAIL_LIP&&.26-LEVEL>MEDIAN_FOOT);
  // a clear stretch shorter than a rail's run between two ridges would be a stub of row between two walls: the walls run on
  const stub=strip([[20,50,1],[58,90,1]]),left=spans(stub);
  assert.ok(58-50<RAIL_RUN);assert.equal(left.length,2,'one stretch of wall from the first ridge to the second');assert.ok(left[0][1]<21&&left[1][0]>89);
  assert.ok(wall(stub,ca,52,56)>.79,'walled across the gap between the ridges');
  // a clear stretch longer than that carries the row
  assert.equal(spans(strip([[20,40,1],[70,90,1]])).length,3);
});

test('two cuts that overlap a step apart: the row stands on the higher road\'s edge and reaches down to the lower',()=>{
  // The Turnpike west of the Prudential tunnel: the westbound road up to a metre over the eastbound one, their pavements 1.8 m into each other.
  const step=.9,overlap=1.2,ca=east(cut),cb=west(-overlap,cut,{elevations:line(120,0).map(()=>LEVEL+step)}),city=world([ca,cb]);
  assert.ok(step>MEDIAN_LEVEL&&step<MEDIAN_STEP);
  const rows=medianBarriers(city,ca);assert.equal(rows.length,1);assert.ok(Math.abs(metres(rows)-120)<.2);
  for(const s of rows[0]){
    // the higher pavement's edge lies 1.2 m inside the lower one's; the profile stands on it, its base flush with the slab's face
    assert.ok(Math.abs(s.z-(-W/2+overlap-JERSEY.base/2))<.01,`on the ledge: z ${s.z.toFixed(2)}`);
    assert.ok(Math.abs(s.y-(LEVEL+step))<.01&&Math.abs(Math.max(...s.drop)-step)<.01,'on the higher pavement, the lower one a step under it');
  }
  const box=medianBarrierBoxes(rows)[0];assert.ok(Math.abs(box.height-(H+step))<.01&&Math.abs(box.y-box.height/2-LEVEL)<.01,'the solid reaches from the lower pavement to the barrier\'s top');
  for(const road of [ca,cb])assert.equal(meshTop(tunnelGeometry(city,road).walls,2,118,-W/2-.4,-W/2+overlap+.4),-Infinity,'no wall of either cut in the overlap');
  // half way to a ledge the row is half way there; level, it is on the middle of the overlap
  const at=lift=>medianBarriers(world([ca,west(-overlap,cut,{elevations:line(120,0).map(()=>LEVEL+lift)})]),ca)[0][5].z;
  assert.ok(Math.abs(at(0)-(-W/2+overlap/2))<.01&&Math.abs(at(.05)-at(0))<.001,'level, or a few centimetres apart: the middle');
  assert.ok(at(.22)>at(0)+.02&&at(.22)<at(.9)-.02);
  // more than MEDIAN_STEP apart they are two levels, and two decks a step apart keep the rule of the decks
  assert.equal(medianBarriers(world([ca,west(-overlap,cut,{elevations:line(120,0).map(()=>LEVEL+MEDIAN_STEP+.3)})]),ca).length,0);
  const da=east(),db=west(-overlap,deck,{elevations:line(120,0).map(()=>LEVEL+step)});assert.equal(medianBarriers(world([da,db]),da).length,0,'two decks 0.9 m apart have their own rails');
});

test('a car driven at the median of a cut stays on its own carriageway, whichever record carries the row',async()=>{
  // The row a deck carries collides as boxes, the row a cut carries as part of its shell: both must stop a car.
  const released={throttle:0,brake:0,steer:0,handbrake:false},SPEED=18;
  for(const [name,roads,carrier]of [['two cuts',[east(cut),west(GAP,cut)],'cut'],['a cut that carries beside a deck',[east(cut),west(GAP)],'cut'],['a deck that carries beside a cut',[east(),west(GAP,cut)],'deck']]){
    const city=world(roads),physics=await DrivingPhysics.create(city);
    assert.equal(tunnelGeometry(city,roads[0]).median?.indices.length>0?'cut':medianBarriers(city,roads[0]).length?'deck':'none',carrier,name);
    try{
      for(const angle of [.35,.9,Math.PI/2]){
        // eastbound, inner lane, turned north toward the median, already doing 18 m/s, the throttle held for four seconds
        const yaw=Math.PI/2+angle;physics.reset(40,-1.8,yaw,roads[0].id);for(let i=0;i<40;i++)physics.step({...released,brake:1},1/60);
        physics.body.setLinvel({x:Math.sin(yaw)*SPEED,y:0,z:Math.cos(yaw)*SPEED},true);
        let north=Infinity,low=Infinity,speed=0;
        for(let i=0;i<240;i++){physics.step({...released,throttle:1},1/60);const state=physics.getState();north=Math.min(north,state.z);low=Math.min(low,state.y);speed=Math.max(speed,Math.abs(state.speed));}
        const state=physics.getState();
        assert.ok(speed>SPEED-3,`${name}: the car drives (${speed.toFixed(1)} m/s)`);
        assert.ok(north>MID+.6,`${name}, at ${angle.toFixed(2)} rad: the car gets to z ${north.toFixed(2)}, the middle of the row is ${MID.toFixed(2)}`);
        assert.ok(low>LEVEL-.2&&Math.abs(state.z)<W/2,`${name}: and stays on its own road (z ${state.z.toFixed(2)}, lowest y ${low.toFixed(2)})`);
      }
    }finally{physics.dispose();}
  }
});

// The installed package.
const city=await loadMetroCity({tiles:[]}),CAR=.95,carriageways=city.roads.filter(r=>r.elevations&&r.lanes!==undefined&&r.kind==='motorway'&&(r.tunnel?r.highway:r.bridge)&&!r.roadway);
const roadOf=r=>r.highway??r.bridge.id,mains=carriageways.filter(r=>['i90','i93'].includes(roadOf(r))),shells=new Map(mains.filter(r=>r.tunnel).map(r=>[r,tunnelGeometry(city,r)]));
/** Everything that stands along the carriageways, by 8 m cell: rails and the rows' solids as rectangles, the cuts' walls and rows as the plan of their faces. */
const CELL=8,boxes=new Map(),faces=new Map(),put=(map,x0,x1,z0,z1,item)=>{for(let x=Math.floor(x0/CELL);x<=Math.floor(x1/CELL);x++)for(let z=Math.floor(z0/CELL);z<=Math.floor(z1/CELL);z++){const k=`${x},${z}`,list=map.get(k);if(list)list.push(item);else map.set(k,[item]);}};
const rect=(p,width,top,row)=>{const half=p.length*Math.cos(p.slope)/2;put(boxes,p.x-half-1,p.x+half+1,p.z-half-1,p.z+half+1,{x:p.x,z:p.z,sx:Math.sin(p.yaw),sz:Math.cos(p.yaw),half,width:width/2,top,row});};
for(const road of mains.filter(r=>!r.tunnel)){for(const p of bridgeBarriers(city,road))rect(p,.27,p.y+.38,false);for(const p of medianBarrierBoxes(medianBarriers(city,road),road.bridge.thickness))rect(p,p.width,p.y+p.height/2,true);}
for(const shell of shells.values())for(const [mesh,row]of [[shell.walls,false],[shell.median,true]]){
  const v=mesh.vertices;
  for(let i=0;i<mesh.indices.length;i+=3){
    const a=mesh.indices[i]*3,b=mesh.indices[i+1]*3,c=mesh.indices[i+2]*3;if(Math.abs((v[b]-v[a])*(v[c+2]-v[a+2])-(v[b+2]-v[a+2])*(v[c]-v[a]))<1e-6)continue;
    put(faces,Math.min(v[a],v[b],v[c]),Math.max(v[a],v[b],v[c]),Math.min(v[a+2],v[b+2],v[c+2]),Math.max(v[a+2],v[b+2],v[c+2]),{a:[v[a],v[a+1],v[a+2]],b:[v[b],v[b+1],v[b+2]],c:[v[c],v[c+1],v[c+2]],row});
  }
}
/** What stands over a point more than 0.45 m over `y`: undefined, or whether it is the median row. */
function standing(x,z,y){
  let top=-Infinity,row=false;const k=`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;
  for(const r of boxes.get(k)??[]){const dx=x-r.x,dz=z-r.z;if(Math.abs(dx*r.sx+dz*r.sz)<=r.half&&Math.abs(dx*r.sz-dz*r.sx)<=r.width&&r.top>top){top=r.top;row=r.row;}}
  for(const {a,b,c,row:m}of faces.get(k)??[]){
    const d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]),l1=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d,l2=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d,l3=1-l1-l2;
    if(l1<-1e-6||l2<-1e-6||l3<-1e-6)continue;const y2=l1*a[1]+l2*b[1]+l3*c[1];if(y2>top){top=y2;row=m;}
  }
  return top>y+.45?{row}:undefined;
}
const unit=(r,i)=>{const a=r.points[Math.max(0,i-1)],b=r.points[Math.min(r.points.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return[(b[0]-a[0])/l,(b[1]-a[1])/l];};
/** Every metre of a carriageway's open road where the pavement of the one that runs the other way lies within `MEDIAN_REACH` of its left edge:
 * the line from this road's inner lane centre to the other's, walked 3 cm at a time, and what stands on it. */
function medianStations(road){
  const st=tunnelStations(road),total=st.at(-1),n=Math.max(1,Math.round(total)),lanes=motorwayLanes(road),out=[];
  for(let j=0;j<=n;j++){
    const s=total*j/n;if(road.tunnel&&tunnelCoveredAt(road,s))continue;
    let i=1;while(i<st.length-1&&st[i]<s)i++;
    const t=(s-st[i-1])/((st[i]-st[i-1])||1),p=[road.points[i-1][0]+(road.points[i][0]-road.points[i-1][0])*t,road.points[i-1][1]+(road.points[i][1]-road.points[i-1][1])*t];
    const ea=deckEdge(road,i-1,-1),eb=deckEdge(road,i,-1),e=[ea[0]+(eb[0]-ea[0])*t,ea[1]+(eb[1]-ea[1])*t],[tx,tz]=unit(road,i-1+(t>.5?1:0)),half=Math.hypot(e[0]-p[0],e[1]-p[1]),nx=(e[0]-p[0])/half,nz=(e[1]-p[1])/half;
    let twin,gap=Infinity;
    for(const other of mains){
      if(other===road||roadOf(other)!==roadOf(road))continue;
      const hit=roadProjection(other,e[0],e[1]);if(hit.distance>30||(hit.index===0&&hit.t<=0)||(hit.index===other.points.length-2&&hit.t>=1))continue;
      const [ux,uz]=unit(other,Math.min(other.points.length-1,hit.index+(hit.t>.5?1:0)));if(tx*ux+tz*uz>-.5||(hit.x-e[0])*nx+(hit.z-e[1])*nz<=0)continue;
      const so=tunnelStations(other);if(other.tunnel&&tunnelCoveredAt(other,so[hit.index]+(so[hit.index+1]-so[hit.index])*hit.t))continue;
      const g=hit.distance-roadWidthAt(other,e[0],e[1])/2;if(g<gap){gap=g;twin=other;}
    }
    if(!twin||gap>MEDIAN_REACH)continue;
    const c=roadProjection(twin,p[0],p[1]),ux=(c.x-p[0])/c.distance,uz=(c.z-p[1])/c.distance,from=Math.abs(lanes[0]),to=c.distance-Math.abs(motorwayLanes(twin)[0]);
    const ya=sampleRoadElevation(city,road,e[0],e[1]),yb=sampleRoadElevation(city,twin,e[0],e[1]);
    let barriers=0,inside=false,row=false,room=Infinity;
    for(let d=from;d<=to+1e-9;d+=.03){const hit=standing(p[0]+ux*d,p[1]+uz*d,Math.max(ya,yb)-.05);if(hit){if(!inside)barriers++;inside=true;row||=hit.row;room=Math.min(room,d-from-CAR,to-d-CAR);}else inside=false;}
    out.push({s,twin,gap,step:yb-ya,barriers,row,room,x:e[0],z:e[1],cut:!!road.tunnel||!!twin.tunnel});
  }
  return out;
}
const stations=new Map(mains.map(road=>[road,medianStations(road)]));

test('along the Turnpike\'s and Interstate 93\'s medians something stands between the two directions at every metre, and where the row stands nothing else does',()=>{
  // On the package of 13 Nov 2026 (main, before the row): of 16,314 m of the Turnpike's median sides with the other carriageway within 3 m,
  // 1,626 m had nothing between the two directions, and at the Prudential tunnel's west portal a cut's wall stood half a metre inside the path
  // of a car in the oncoming road's inner lane. Interstate 93 had nothing along 2,049 m.
  const count={i90:[0,0,0],i93:[0,0,0]};
  for(const [road,list]of stations)for(const p of list){
    const c=count[roadOf(road)];c[0]++;if(p.row)c[1]++;if(p.cut&&p.row)c[2]++;
    assert.ok(p.barriers>=1,`${road.id}: nothing between it and ${p.twin.id} at station ${p.s.toFixed(0)} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}), the pavements ${p.gap.toFixed(2)} m apart`);
    // (at a station where the row begins, the two edge barriers it takes over from may still be met beside its end)
    assert.ok(!p.row||p.barriers===1||p.barriers===2&&p.gap>.3,`${road.id}: ${p.barriers} barriers on the median at station ${p.s.toFixed(0)} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}), the row among them`);
  }
  assert.ok(count.i90[0]>15000&&count.i90[1]>count.i90[0]*.95,`the Turnpike: the row at ${count.i90[1]} of ${count.i90[0]} stations`);
  assert.ok(count.i90[2]>4500,`${count.i90[2]} of them with a cut on one side or both`);
  assert.ok(count.i93[0]>7500&&count.i93[1]===count.i93[0],`Interstate 93: the row at ${count.i93[1]} of ${count.i93[0]} stations`);
});

test('the Turnpike\'s row runs through its cuts: a few long runs, joined across deck and cut at every joint',()=>{
  const pieces=mains.filter(r=>roadOf(r)==='i90').flatMap(road=>medianBarriers(city,road).map(run=>({road,run})));
  // join the runs of consecutive records end to end
  const chains=[],used=new Set();
  for(let i=0;i<pieces.length;i++){
    if(used.has(i))continue;used.add(i);const chain={first:pieces[i].run[0],last:pieces[i].run.at(-1),length:metres([pieces[i].run]),kinds:new Set([pieces[i].road.tunnel?'cut':'deck']),joint:0};
    for(let grew=true;grew;){grew=false;for(let j=0;j<pieces.length;j++){if(used.has(j))continue;const run=pieces[j].run;
      for(const end of ['first','last'])for(const [near,far]of [[run[0],run.at(-1)],[run.at(-1),run[0]]]){
        const d=Math.hypot(chain[end].x-near.x,chain[end].z-near.z);if(d>.4||used.has(j))continue;
        used.add(j);chain.joint=Math.max(chain.joint,d,Math.abs(chain[end].y-near.y));chain[end]=far;chain.length+=metres([run]);chain.kinds.add(pieces[j].road.tunnel?'cut':'deck');grew=true;
      }}}
    chains.push(chain);
  }
  const total=chains.reduce((sum,c)=>sum+c.length,0);
  // (5,313 m in 12 stretches while only decks took part; the breaks left are the roofed tunnels, the roads parting in Allston, and six places where ground stands between two cuts)
  assert.ok(chains.length<=10&&total>7500,`${total.toFixed(0)} m of row in ${chains.length} runs`);
  assert.ok(chains.filter(c=>c.kinds.size===2).length>=5,'most runs pass from deck to cut and back');
  for(const c of chains){assert.ok(c.length>=RAIL_RUN,`a run of ${c.length.toFixed(1)} m at (${c.first.x.toFixed(0)}, ${c.first.z.toFixed(0)})`);assert.ok(c.joint<.05,`a joint ${c.joint.toFixed(2)} m apart in a run from (${c.first.x.toFixed(0)}, ${c.first.z.toFixed(0)})`);}
  // the row's foot stands over what ground there is in the strip, and never higher than a kerb
  const feet=pieces.flatMap(p=>p.run).filter(s=>s.foot!==undefined).map(s=>s.foot);
  assert.ok(feet.length>0&&feet.length<200&&Math.max(...feet)<=RAIL_LIP+MEDIAN_COVER+1e-9,`${feet.length} sections with a raised foot, ${Math.max(...feet).toFixed(2)} m at most`);
});

test('a cut on the median has the row or its wall, never both and never neither; other tunnel records are as they were',()=>{
  let onMedian=0,walled=0;
  for(const [road,shell]of shells){
    const spans=medianSpans(city,road,-1),st=tunnelStations(road),total=st.at(-1);assert.deepEqual(medianSpans(city,road,1),[],`${road.id}: a median on its outer side`);
    for(const p of stations.get(road)){
      if(p.s<.5||p.s>total-.5)continue;
      const inside=spans.some(([a,b])=>p.s>=a+.5&&p.s<=b-.5),outside=!spans.some(([a,b])=>p.s>=a-.5&&p.s<=b+.5);if(!inside&&!outside)continue;
      // the cut's own wall line, 8 cm outside its pavement
      let i=1;while(i<st.length-1&&st[i]<p.s)i++;const t=(p.s-st[i-1])/((st[i]-st[i-1])||1),a=deckEdge(road,i-1,-1,-.08),b=deckEdge(road,i,-1,-.08),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,y=sampleRoadElevation(city,road,x,z);
      let own=-Infinity;const v=shell.walls.vertices;for(let k=0;k<shell.walls.indices.length;k+=3){const [q,r,u]=[0,1,2].map(m=>shell.walls.indices[k+m]*3);if(Math.min(Math.hypot(v[q]-x,v[q+2]-z),Math.hypot(v[r]-x,v[r+2]-z),Math.hypot(v[u]-x,v[u+2]-z))<1.2)own=Math.max(own,v[q+1],v[r+1],v[u+1]);}
      if(inside){onMedian++;assert.ok(p.row&&p.barriers>=1,`${road.id}: on a median span at station ${p.s.toFixed(0)} without the row`);}
      else if(own>y+.45)walled++;
    }
  }
  assert.ok(onMedian>2500&&walled>250,`${onMedian} stations of a cut's median with the row, ${walled} with the cut's own wall`);
  // ramps, Storrow Drive and the Central Artery: no span, no row in any shell
  for(const road of city.roads)if(road.tunnel&&road.elevations&&!shells.has(road)){assert.deepEqual([medianSpans(city,road,-1),medianSpans(city,road,1)],[[],[]],road.id);assert.equal(tunnelGeometry(city,road).median.indices.length,0,road.id);}
});
