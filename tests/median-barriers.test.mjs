import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {bridgeBarriers,deckEdge,deckEdgeElevation,laneMarkings,roadProjection,sampleRoadElevation,JERSEY,MOUTH_REACH,RAIL_LIP} from '../src/simulation/road-surfaces.ts';
import {tunnelCoveredAt,tunnelStations} from '../src/simulation/tunnels.ts';
import {medianBarriers,medianBarrierMesh,medianBarrierBoxes,MEDIAN_REACH,MEDIAN_WIDENING,MEDIAN_LAP,MEDIAN_FOOT,MEDIAN_UNDER,MEDIAN_PROBE} from '../src/simulation/median-barriers.ts';
import {LANE_WIDTH,isHighwayDeck,motorwayLanes} from '../src/simulation/motorway.ts';
import {roadMidpoint} from '../src/simulation/road-tile-coverage.ts';
import {meshBuildingIds} from '../src/simulation/building-collisions.ts';
import {loadMetroCity,windowCity,installExactMeshes} from './helpers/metro-city.mjs';

// One barrier row on the median of two highway decks that run opposite ways (src/simulation/median-barriers.ts).
// Interstate 93's two pavements meet or overlap through most of Medford and the runtime rails no deck edge that another
// deck covers at its height, so the two directions were one eight-lane pavement with two yellow lines for about a
// kilometre; where a few centimetres lay between the pavements each had its own rail, a hand's width from the other's.
// The Turnpike had the same along 750 m of Allston and Brighton.

// ---- the rule, on two decks 8 m over flat ground. North is -z, so northbound traffic has its median to the west (-x).
const DECK=8,WIDTH=4*LANE_WIDTH+4,LENGTH=300;
const line=(x,from,to)=>Array.from({length:LENGTH/10+1},(_,i)=>[x,from+(to-from)*i/(LENGTH/10)]);
const deck=(id,points,extra={})=>({id,name:id,kind:'motorway',points,width:WIDTH,oneway:1,lanes:4,elevations:points.map(()=>DECK),deckWidths:points.map(()=>WIDTH),bridge:{id:'test',kind:'i93-north',thickness:.75,clearanceEstimated:true},startLevel:1,endLevel:1,...extra});
const fixture=roads=>({bounds:{minX:-120,maxX:120,minZ:-LENGTH-60,maxZ:60},spawn:{x:100,z:0,yaw:0},roads,buildings:[],signals:[],landmarks:[],sources:[]});
/** A northbound deck on x = 0 and a southbound one `gap` metres of pavement to its west. */
const pair=(gap,south={},north={})=>fixture([deck('a-north',line(0,0,-LENGTH),north),deck('b-south',line(-WIDTH-gap,-LENGTH,0),south)]);
const metres=run=>run.slice(1).reduce((sum,s,i)=>sum+Math.hypot(s.x-run[i].x,s.z-run[i].z),0);
const railed=(city,road,side)=>bridgeBarriers(city,road).filter(p=>p.side===side).reduce((sum,p)=>sum+p.length,0);

test('two decks running opposite ways share one barrier row on the middle line, and neither rails that edge',()=>{
  for(const gap of [-.9,-.3,0,.04,.3,.75,2,2.9]){
    const city=pair(gap),[north,south]=city.roads,rows=medianBarriers(city,north);
    assert.equal(rows.length,1,`one row for ${gap} m between the pavements`);
    assert.deepEqual(medianBarriers(city,south),[],'carried by one of the two decks only: the lower id');
    assert.ok(Math.abs(metres(rows[0])-LENGTH)<1e-6,'along the whole of it');
    for(const s of rows[0]){
      assert.ok(Math.abs(s.x-(-WIDTH/2-gap/2))<1e-9&&s.y===DECK,'in the middle of what lies between the two pavement edges, on the pavement');
      assert.ok(Math.abs(s.nx+1)<1e-9&&Math.abs(s.nz)<1e-9&&s.drop[0]===0&&s.drop[1]===0);
      assert.ok(Math.abs(s.half-Math.max(JERSEY.base/2,gap/2+MEDIAN_LAP))<1e-9,'its foot spans the gap and laps onto both pavements');
    }
    for(const road of city.roads){
      assert.equal(railed(city,road,-1),0,`${road.id}: no rail of its own along the median (${gap} m)`);
      assert.ok(Math.abs(railed(city,road,1)-LENGTH)<.5,`${road.id}: its outer edge railed as before`);
    }
  }
});

test('beyond its reach, at another level, beside a same-way deck, a surveyed roadway or a street landing there is no row',()=>{
  // More than MEDIAN_REACH between the pavements: two roads, each with its rail.
  let city=pair(MEDIAN_REACH+.4);
  assert.ok(city.roads.every(r=>medianBarriers(city,r).length===0&&Math.abs(railed(city,r,-1)-LENGTH)<.5));
  // A rail's height apart or more: two levels, and each edge keeps its rail (the higher one guards the drop).
  city=pair(.3,{elevations:line(0,0,0).map(()=>DECK-1)});
  assert.ok(city.roads.every(r=>medianBarriers(city,r).length===0&&Math.abs(railed(city,r,-1)-LENGTH)<.5));
  // Half a metre apart: one row on the higher pavement, reaching down to the lower one.
  city=pair(.3,{elevations:line(0,0,0).map(()=>DECK-.5)});
  const [stepped]=medianBarriers(city,city.roads[0]);
  assert.ok(stepped.every(s=>s.y===DECK&&s.drop[0]===0&&Math.abs(s.drop[1]-.5)<1e-9));
  assert.ok(medianBarrierBoxes([stepped]).every(b=>Math.abs(b.y-b.height/2-(DECK-.5))<1e-9&&Math.abs(b.y+b.height/2-(DECK+JERSEY.height))<1e-9),'the collider stands on the lower pavement');
  assert.equal(railed(city,city.roads[0],-1)+railed(city,city.roads[1],-1),0);
  // Two decks running the same way with their pavements overlapping (a ramp beside its carriageway, a gore): one surface, as before.
  city=fixture([deck('a-north',line(0,0,-LENGTH)),deck('b-ramp',line(-WIDTH+.5,0,-LENGTH),{kind:'motorway_link'})]);
  assert.ok(city.roads.every(r=>medianBarriers(city,r).length===0));
  assert.equal(railed(city,city.roads[0],-1)+railed(city,city.roads[1],1),0,'no rail between a carriageway and the ramp that shares its pavement');
  // A deck with a surveyed roadway (Storrow Drive) is a street's pavement on its ground: no row, and nothing changes beside it.
  city=pair(-.3,{roadway:line(0,0,0).map(()=>[WIDTH/2,-WIDTH/2])});
  assert.ok(city.roads.every(r=>medianBarriers(city,r).length===0));
  assert.equal(railed(city,city.roads[0],-1),0,'its pavement still covers the other deck\'s edge');
  // A deck that lands on a street: the first MOUTH_REACH metres from the landing are the street's junction.
  city=pair(.3,{endLevel:0});
  const [short]=medianBarriers(city,city.roads[0]);
  assert.ok(short.every(s=>Math.hypot(s.x+WIDTH+.3,s.z)>MOUTH_REACH-.5),'no section of the row within a junction mouth of the landing');
  assert.ok(metres(short)<LENGTH-1&&metres(short)>LENGTH-MOUTH_REACH-1,`the row ends short of the landing (${metres(short).toFixed(1)} m of ${LENGTH})`);
});

test('a row begins and ends where the two decks come within reach, to the centimetre, and the rails take over there',()=>{
  // The southbound deck swings away from 0.5 m to 6.5 m between z = -100 and z = -200.
  const west=z=>-WIDTH-.5-6*Math.min(1,Math.max(0,(-z-100)/100)),points=Array.from({length:LENGTH/10+1},(_,i)=>[west(-LENGTH+i*10),-LENGTH+i*10]);
  const city=fixture([deck('a-north',line(0,0,-LENGTH)),deck('b-south',points)]),[north,south]=city.roads,[row]=medianBarriers(city,north);
  // (what lies between is measured square to the other deck, which runs 6 in 100 off this one's line there)
  const end=Math.min(...row.map(s=>s.z)),expected=-100-100*((WIDTH/2+MEDIAN_REACH)*Math.hypot(1,.06)-WIDTH/2-.5)/6;
  assert.ok(Math.abs(end-expected)<.15,`the row ends where ${MEDIAN_REACH} m lie between the pavements (z ${end.toFixed(2)}, ${expected.toFixed(2)} expected)`);
  assert.ok(Math.abs(row.at(-1).half*2-MEDIAN_REACH-2*MEDIAN_LAP)<.02,'its foot as wide as the reach there');
  for(const [road,side]of [[north,-1],[south,-1]]){
    const rails=bridgeBarriers(city,road).filter(p=>p.side===side),from=Math.max(...rails.map(p=>p.z+Math.abs(Math.cos(p.yaw))*p.length/2));
    assert.ok(Math.abs(from-end)<.5,`${road.id}: its own rail begins where the row ends (z ${from.toFixed(2)})`);
    assert.ok(Math.abs(rails.reduce((sum,p)=>sum+p.length*Math.abs(Math.cos(p.yaw)),0)-(LENGTH+end))<1,'and runs on to the end');
  }
});

test('a median that begins and ends between two stations of a deck is found from either deck: one row, and both rails give way to it',()=>{
  // One deck has a station every 100 m. The other, with one every 2 m, lies 5 m off and swings to 0.4 m of it about z = -150:
  // within reach for some 85 m, all of it inside the first deck's second segment. Probed at its own stations alone the coarse
  // deck saw no median there while the fine one dropped its rail: nothing stood between the two directions where the coarse
  // deck carries the row, and a rail beside the row where it does not.
  const swing=z=>4.6*Math.min(1,Math.max(0,(60-Math.abs(z+150))/40));
  const fine=(x,from,to,sign)=>Array.from({length:LENGTH/2+1},(_,i)=>{const z=from+(to-from)*i/(LENGTH/2);return[x+sign*swing(z),z];}),coarse=(x,from,to)=>[0,1,2,3].map(i=>[x,from+(to-from)*i/3]);
  const edge=road=>road.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-road.points[i][0],p[1]-road.points[i][1]),0);
  assert.ok(100>MEDIAN_PROBE*3);
  for(const [north,south,which]of [[coarse(0,0,-LENGTH),fine(-WIDTH-5,-LENGTH,0,1),'the deck that carries the row'],[fine(0,0,-LENGTH,-1),coarse(-WIDTH-5,-LENGTH,0),'the other deck']]){
    const city=fixture([deck('a-north',north),deck('b-south',south)]),rows=medianBarriers(city,city.roads[0]);
    assert.equal(rows.length,1,`one row where ${which} has its stations 100 m apart`);
    assert.deepEqual(medianBarriers(city,city.roads[1]),[]);
    const length=metres(rows[0]),widths=rows[0].map(s=>s.half*2);
    assert.ok(length>80&&length<92&&rows[0].every(s=>s.z<-103&&s.z>-197),`along the ${length.toFixed(1)} m about z = -150 where the pavements lie within reach (${which})`);
    assert.ok(Math.abs(Math.min(...widths)-JERSEY.base)<1e-9&&Math.abs(Math.max(...widths)-MEDIAN_REACH-2*MEDIAN_LAP)<.02,'its foot as wide as the reach at both ends, the profile alone where 0.4 m lie between the pavements');
    for(const road of city.roads){const gone=edge(road)-railed(city,road,-1);assert.ok(Math.abs(gone-length)<3,`${road.id}: its own rail gives way along the row and nowhere else (${gone.toFixed(1)} m of rail gone, a row of ${length.toFixed(1)} m; ${which})`);}
  }
});

test('a short widening or a jog in the pavements does not break the row; a long one does, and the rails stand along it',()=>{
  // The southbound deck eases out to 3.6 m between the pavements over 20 m, stays there for `long` metres about z = -150 and eases back (0.6 m elsewhere).
  const swing=long=>{const points=Array.from({length:LENGTH/2+1},(_,i)=>{const z=-LENGTH+i*2,out=Math.max(0,Math.min(1,(long/2+20-Math.abs(z+150))/20));return[-WIDTH-.6-3*out,z];});return fixture([deck('a-north',line(0,0,-LENGTH)),deck('b-south',points)]);};
  let city=swing(2);
  assert.equal(medianBarriers(city,city.roads[0]).length,1,'a widening shorter than a rail\'s run is bridged');
  assert.ok(Math.abs(metres(medianBarriers(city,city.roads[0])[0])-LENGTH)<1);
  assert.ok(Math.max(...medianBarriers(city,city.roads[0])[0].map(s=>s.half*2))>MEDIAN_REACH+.5,'by a foot as wide as the widening');
  assert.equal(railed(city,city.roads[0],-1)+railed(city,city.roads[1],-1),0,'and no rail stands for those few metres');
  city=swing(40);
  const rows=medianBarriers(city,city.roads[0]),between=LENGTH-rows.reduce((sum,run)=>sum+metres(run),0);
  assert.equal(rows.length,2,'a long one parts the row');
  assert.ok(between>44&&between<52,`for the ${between.toFixed(1)} m along which more than ${MEDIAN_REACH} m lie between the pavements`);
  for(const road of city.roads)assert.ok(Math.abs(railed(city,road,-1)-between)<3,`${road.id}: railed along the widening (${railed(city,road,-1).toFixed(1)} m of ${between.toFixed(1)})`);
  assert.ok(MEDIAN_WIDENING>=.5);
  // Both pavements jog a metre sideways within 8 m, one a little after the other (surveyed curbs do): the row follows.
  const jog=(x,from,to,at)=>Array.from({length:LENGTH/2+1},(_,i)=>{const z=from+(to-from)*i/(LENGTH/2);return[x+Math.max(0,Math.min(1,(at-z)/8)),z];});
  city=fixture([deck('a-north',jog(0,0,-LENGTH,-150)),deck('b-south',jog(-WIDTH-.6,-LENGTH,0,-153))]);
  assert.equal(medianBarriers(city,city.roads[0]).length,1,'one row through the jog');
  assert.ok(Math.abs(metres(medianBarriers(city,city.roads[0])[0])-LENGTH)<2);
});

test('the row is one closed solid: every face outward, a face at both ends, the foot under it where a gap is wider than the profile',()=>{
  const volume=mesh=>{let v=0;for(let i=0;i<mesh.length;i+=9)v+=(mesh[i]*(mesh[i+4]*mesh[i+8]-mesh[i+5]*mesh[i+7])-mesh[i+1]*(mesh[i+3]*mesh[i+8]-mesh[i+5]*mesh[i+6])+mesh[i+2]*(mesh[i+3]*mesh[i+7]-mesh[i+4]*mesh[i+6]))/6;return v;};
  const closed=mesh=>{
    const edges=new Map(),key=i=>`${mesh[i].toFixed(4)},${mesh[i+1].toFixed(4)},${mesh[i+2].toFixed(4)}`;
    for(let i=0;i<mesh.length;i+=9)for(let k=0;k<3;k++){const e=`${key(i+k*3)}>${key(i+(k+1)%3*3)}`;edges.set(e,(edges.get(e)??0)+1);}
    for(const [e,n]of edges){const [a,b]=e.split('>');assert.equal(n,1,`edge ${e} is used once`);assert.equal(edges.get(`${b}>${a}`),1,`and once the other way (${e})`);}
  };
  // (the profile's area over the foot: its toe, its lower slope and its upper wall)
  const b=JERSEY.base/2,t=JERSEY.top/2,profile=(.075-MEDIAN_FOOT)*2*b+(.33-.075)*(b+t+.03)+(JERSEY.height-.33)*(2*t+.03);
  for(const [gap,side]of [[-.6,'north'],[2,'north'],[.3,'mirrored']]){
    // (mirrored: the carrying deck southbound, the other to its east, so the row runs the other way round)
    const city=side==='north'?pair(gap):fixture([deck('a-south',line(0,-LENGTH,0)),deck('b-north',line(WIDTH+gap,0,-LENGTH))]),rows=medianBarriers(city,city.roads[0]),mesh=medianBarrierMesh(rows,.75);
    closed(mesh);
    const foot=Math.max(JERSEY.base,gap+2*MEDIAN_LAP)*(.75+MEDIAN_UNDER+MEDIAN_FOOT);
    assert.ok(Math.abs(volume(mesh)-(foot+profile)*LENGTH)<.01*LENGTH,`wound outward: ${volume(mesh).toFixed(1)} m3 for ${((foot+profile)*LENGTH).toFixed(1)}`);
    const ys=[];for(let i=1;i<mesh.length;i+=3)ys.push(mesh[i]);
    assert.ok(Math.abs(Math.max(...ys)-(DECK+JERSEY.height))<1e-6&&Math.abs(Math.min(...ys)-(DECK-.75-MEDIAN_UNDER))<1e-6,'from under the slab to the profile\'s top');
    // (a cross-section at every station, 10 m apart here, and at the probes between two stations: MEDIAN_PROBE)
    const boxes=medianBarrierBoxes(rows,.75),sections=LENGTH/10*Math.ceil(10/MEDIAN_PROBE);
    assert.equal(boxes.filter(q=>q.width===JERSEY.base).length,sections);
    assert.equal(boxes.filter(q=>q.width>JERSEY.base).length,gap>JERSEY.base?sections:0,'the foot collides where it is wider than the profile');
  }
});

const released={throttle:0,brake:0,steer:0,handbrake:false};
const SPEED=18;
/** Sets the car on `id` at (x, z) heading `yaw`, already doing 18 m/s (65 km/h), and holds the throttle down for four seconds. */
function launch(physics,x,z,yaw,id){
  physics.reset(x,z,yaw,id);for(let i=0;i<40;i++)physics.step({...released,brake:1},1/60);
  physics.body.setLinvel({x:Math.sin(yaw)*SPEED,y:0,z:Math.cos(yaw)*SPEED},true);
}
/** Launches the car and returns how far it got across (`sign` times x) and how low. */
function charge(physics,x,z,yaw,id,sign){
  launch(physics,x,z,yaw,id);
  let across=-Infinity,low=Infinity,speed=0;
  for(let i=0;i<240;i++){physics.step({...released,throttle:1},1/60);const s=physics.getState();across=Math.max(across,sign*s.x);low=Math.min(low,s.y);speed=Math.max(speed,Math.abs(s.speed));}
  return{across,low,speed,state:physics.getState()};
}
test('a car driven at the median from either side stays on its own carriageway',async()=>{
  for(const gap of [-.6,.3,2]){
    const city=pair(gap),physics=await DrivingPhysics.create(city),middle=-WIDTH/2-gap/2;
    try{
      for(const angle of [.35,.9,Math.PI/2]){
        // northbound, inner lane, turned west toward the median; then southbound, turned east
        const north=charge(physics,-1.5*LANE_WIDTH,-80,Math.PI+angle,'a-north',-1);
        assert.ok(north.speed>SPEED-3,`the car drives (${north.speed.toFixed(1)} m/s)`);
        assert.ok(north.across<-middle-.6,`northbound at ${angle.toFixed(2)} rad, ${gap} m between the pavements: the car gets to x ${(-north.across).toFixed(2)}, the middle of the row is ${middle.toFixed(2)}`);
        // (a crash at this speed throws the nose up; what matters is that the car comes down on its own deck, not between the two or beyond)
        assert.ok(north.low>DECK&&Math.abs(north.state.x)<WIDTH/2,`and stays on its deck (x ${north.state.x.toFixed(2)}, lowest y ${north.low.toFixed(2)})`);
        const south=charge(physics,-WIDTH-gap+1.5*LANE_WIDTH,-220,angle,'b-south',1);
        assert.ok(south.across<middle-.6,`southbound at ${angle.toFixed(2)} rad: the car gets to x ${south.across.toFixed(2)}, the middle of the row is ${middle.toFixed(2)}`);
        assert.ok(south.low>DECK&&Math.abs(south.state.x+WIDTH+gap)<WIDTH/2,`southbound: on its deck (x ${south.state.x.toFixed(2)}, lowest y ${south.low.toFixed(2)})`);
      }
    }finally{physics.dispose();}
  }
  // The same drive beside a deck with a surveyed roadway, where no row stands, goes straight across: the row is what stops it.
  const city=pair(-.6,{roadway:line(0,0,0).map(()=>[WIDTH/2,-WIDTH/2])}),physics=await DrivingPhysics.create(city);
  try{assert.ok(charge(physics,-1.5*LANE_WIDTH,-80,Math.PI+.9,'a-north',-1).across>WIDTH,'without a row the car crosses onto the other deck');}finally{physics.dispose();}
});

// ---- the installed package
const city=await loadMetroCity({tiles:[]});
const series=prefix=>city.roads.filter(r=>new RegExp(`^${prefix}-\\d+$`).test(r.id)).sort((a,b)=>+a.id.split('-').at(-1)-+b.id.split('-').at(-1));
const HIGHWAYS=[['Interstate 93','i93-nb','i93-sb'],['the Turnpike','i90-eb','i90-wb']];
/** Segments [ax, az, bx, bz, ...] in a 16 m grid, and those of them a segment crosses, by the distance along it. */
function grid(segments){
  const cells=new Map();
  for(const s of segments)for(let x=Math.floor(Math.min(s[0],s[2])/16);x<=Math.floor(Math.max(s[0],s[2])/16);x++)for(let z=Math.floor(Math.min(s[1],s[3])/16);z<=Math.floor(Math.max(s[1],s[3])/16);z++){const k=`${x},${z}`,l=cells.get(k);if(l)l.push(s);else cells.set(k,[s]);}
  return(ax,az,bx,bz)=>{
    const seen=new Set(),hits=[],rx=bx-ax,rz=bz-az;
    for(let x=Math.floor(Math.min(ax,bx)/16);x<=Math.floor(Math.max(ax,bx)/16);x++)for(let z=Math.floor(Math.min(az,bz)/16);z<=Math.floor(Math.max(az,bz)/16);z++)for(const s of cells.get(`${x},${z}`)??[]){
      if(seen.has(s))continue;seen.add(s);
      const sx=s[2]-s[0],sz=s[3]-s[1],det=rx*sz-rz*sx;if(Math.abs(det)<1e-12)continue;
      const t=((s[0]-ax)*sz-(s[1]-az)*sx)/det,u=((s[0]-ax)*rz-(s[1]-az)*rx)/det;
      if(t>=0&&t<=1&&u>=-1e-6&&u<=1+1e-6)hits.push({at:t*Math.hypot(rx,rz),along:Math.max(0,Math.min(1,u)),segment:s});
    }
    // (two pieces that meet on the line count once)
    return hits.sort((p,q)=>p.at-q.at).filter((h,k,all)=>!k||h.at-all[k-1].at>.3);
  };
}
const railSegments=roads=>roads.flatMap(road=>bridgeBarriers(city,road).map(p=>{const h=p.length*Math.cos(p.slope)/2,sx=Math.sin(p.yaw)*h,sz=Math.cos(p.yaw)*h;return[p.x-sx,p.z-sz,p.x+sx,p.z+sz,p.y-.38,road.id];}));
const rowSegments=roads=>roads.flatMap(road=>medianBarriers(city,road).flatMap(run=>run.slice(1).map((s,i)=>[run[i].x,run[i].z,s.x,s.z,run[i].y,road.id,s.y])));
/** The pavement of the other carriageway's decks beyond a point of a deck's edge: metres to it (negative inside it) and its height
 * there. Reckoned here from the records alone, not with the rule's own function. Undefined where no deck of it runs the opposite way beside the point. */
function across(others,x,z,tx,tz,ox,oz){
  let best;
  for(const other of others){
    if(x<other.box[0]-30||x>other.box[1]+30||z<other.box[2]-30||z>other.box[3]+30)continue;
    const road=other.road,hit=roadProjection(road,x,z),a=road.points[hit.index],b=road.points[hit.index+1],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);
    if((tx*dx+tz*dz)/l>-.87||(hit.x-x)*ox+(hit.z-z)*oz<=0)continue;
    if(hit.index===0&&hit.t<=0&&(x-a[0])*dx+(z-a[1])*dz<0||hit.index===road.points.length-2&&hit.t>=1&&(x-b[0])*dx+(z-b[1])*dz>0)continue;
    const wa=road.deckWidths?.[hit.index]??road.width,wb=road.deckWidths?.[hit.index+1]??road.width,gap=hit.distance-(wa+(wb-wa)*hit.t)/2;
    if(!best||gap<best.gap)best={gap,height:sampleRoadElevation(city,road,x,z),road};
  }
  return best;
}
const boxed=roads=>roads.map(road=>({road,box:[Math.min(...road.points.map(p=>p[0])),Math.max(...road.points.map(p=>p[0])),Math.min(...road.points.map(p=>p[1])),Math.max(...road.points.map(p=>p[1]))]}));

for(const [name,first,second]of HIGHWAYS)test(`${name}: wherever the decks of its two carriageways lie within reach, exactly one barrier stands between them and no rail`,()=>{
  const sides=[series(first),series(second)].map(list=>list.filter(isHighwayDeck)),decks=sides.flat(),rows=grid(rowSegments(decks)),rails=grid(railSegments(decks));
  let within=0,close=0,apart=0;
  for(const [mine,theirs]of [sides,[...sides].reverse()]){
    const others=boxed(theirs);
    for(const road of mine)for(let i=0;i<road.points.length;i++)for(const side of [-1,1]){
      const [x,z]=deckEdge(road,i,side),p=road.points[i],half=Math.hypot(x-p[0],z-p[1]),ox=(x-p[0])/half,oz=(z-p[1])/half,y=deckEdgeElevation(road,i,side);
      const twin=across(others,x,z,oz*side,-ox*side,ox,oz);if(!twin||Math.abs(twin.height-y)>.7)continue;
      const where=`${road.id}[${i}] at ${x.toFixed(0)}, ${z.toFixed(0)}, ${twin.gap.toFixed(2)} m from the pavement of ${twin.road.id}`;
      const line=[x-ox*2.2,z-oz*2.2,x+ox*(twin.gap+2.2),z+oz*(twin.gap+2.2)],between=rows(...line);
      if(twin.gap>MEDIAN_REACH+.3){if(twin.gap<6){apart++;assert.equal(between.length,0,`a barrier row between two roads that have parted: ${where}`);assert.equal(rails(...line).length,2,`and each keeps its own rail: ${where}`);}continue;}
      if(twin.gap>MEDIAN_REACH-.3)continue;
      within++;if(twin.gap<=.5)close++;
      assert.equal(between.length,1,`${between.length} barrier rows between the two carriageways: ${where}`);
      assert.ok(Math.abs(between[0].at-2.2-twin.gap/2)<.2,`the row stands ${(between[0].at-2.2).toFixed(2)} m beyond the edge, not in the middle: ${where}`);
      const top=between[0].segment[4]+(between[0].segment[6]-between[0].segment[4])*between[0].along;
      assert.ok(Math.abs(top-Math.max(y,twin.height))<.05,`the row stands at ${top.toFixed(2)}, the higher pavement at ${Math.max(y,twin.height).toFixed(2)}: ${where}`);
      assert.equal(rails(...line).length,0,`a rail beside the barrier row: ${where}`);
    }
  }
  console.log(`${name}: ${within} deck stations with the other carriageway's deck within ${MEDIAN_REACH} m (${close} within 0.5 m), ${apart} with it 3.3 to 6 m off`);
  // (Interstate 93's inner shoulders overlap through Medford; the Turnpike's stage parts its carriageways by the barrier's footprint, so none of its pavements lie that close)
  assert.ok(within>2000&&(first==='i90-eb'?close===0:close>500),`${within} stations on a median, ${close} of them with half a metre or less between the pavements`);
});

// (Interstate 93 has one unbroken median from the Somerville line to Roosevelt Circle; the Turnpike's runs on through its walled cuts and is parted by its
// tunnels, by the stretches where the two roads part or lie on two levels, and by ground standing between two cuts: nine rows on this package)
for(const [name,first,second,least,most]of [['Interstate 93','i93-nb','i93-sb',1,1],['the Turnpike','i90-eb','i90-wb',6,12]])test(`${name}: no two rails stand side by side on its median, and a row ends only where the two decks part or one of them ends`,()=>{
  const [a,b]=[series(first),series(second)].map(list=>list.filter(isHighwayDeck)),theirs=grid(railSegments(b));
  for(const rail of railSegments(a)){
    const mx=(rail[0]+rail[2])/2,mz=(rail[1]+rail[3])/2,l=Math.hypot(rail[2]-rail[0],rail[3]-rail[1])||1,nx=-(rail[3]-rail[1])/l,nz=(rail[2]-rail[0])/l;
    const near=theirs(mx-nx*1.5,mz-nz*1.5,mx+nx*1.5,mz+nz*1.5).filter(h=>Math.abs(h.segment[4]-rail[4])<.8);
    assert.equal(near.length,0,`a rail of ${rail[5]} at ${mx.toFixed(0)}, ${mz.toFixed(0)} has one of ${near[0]?.segment[5]} ${near.length?Math.abs(near[0].at-1.5).toFixed(2):''} m beside it`);
  }
  // (every record of the two carriageways that carries a piece of the row: a walled cut carries it on between two decks, tests/median-cuts.test.mjs)
  const runs=[...series(first),...series(second)].flatMap(road=>medianBarriers(city,road).map(run=>({road,run})));
  assert.ok(runs.every(r=>r.road.id.startsWith(first)),'one carriageway carries every row of the pair');
  // A run ends where the next record's begins (the same section) or in the open: there the two decks have parted beyond
  // the reach, or one of them has ended (it carries on as a walled cut, whose wall is the barrier, or the road is closed).
  const sides=[boxed(a),boxed(b)];let open=0;
  const meets=(end,run)=>[run[0],run.at(-1)].some(s=>Math.hypot(s.x-end.x,s.z-end.z)<.05&&Math.abs(s.y-end.y)<.05&&Math.abs(s.half-end.half)<.05);
  // A record's piece of a row may be short, a row may not: the pieces that meet end to end are measured as one row.
  const rows=[],placed=new Set();
  for(const seed of runs){
    if(placed.has(seed))continue;
    const row=[seed];placed.add(seed);
    for(let k=0;k<row.length;k++)for(const o of runs)if(!placed.has(o)&&[row[k].run[0],row[k].run.at(-1)].some(end=>meets(end,o.run))){placed.add(o);row.push(o);}
    rows.push({pieces:row,length:row.reduce((sum,r)=>sum+metres(r.run),0)});
  }
  for(const row of rows)assert.ok(row.length>=10,`a row of ${row.length.toFixed(1)} m on ${row.pieces.map(r=>r.road.id).join(', ')}`);
  for(const {road,run}of runs){
    const joined=end=>runs.some(o=>o.run!==run&&meets(end,o.run));
    for(const [end,inner]of [[run[0],run[1]],[run.at(-1),run.at(-2)]]){
      if(joined(end))continue;
      open++;
      // two metres on along the row's line: the pavements of both carriageways' decks, if they are still there
      const l=Math.hypot(end.x-inner.x,end.z-inner.z),ux=(end.x-inner.x)/l,uz=(end.z-inner.z)/l,x=end.x+ux*2,z=end.z+uz*2;
      const [own,other]=sides.map((decks,k)=>across(decks,x,z,k?ux*Math.sign(-1):ux,k?-uz:uz,k?end.nx:-end.nx,k?end.nz:-end.nz));
      const still=own&&other&&Math.abs(own.height-other.height)<.7&&own.gap+other.gap<MEDIAN_REACH-.3;
      assert.ok(!still,`the row on ${road.id} ends at ${end.x.toFixed(0)}, ${end.z.toFixed(0)} with ${still?(own.gap+other.gap).toFixed(2):''} m between the two decks beyond it`);
    }
  }
  console.log(`${name}: ${runs.length} runs in ${rows.length} rows of ${Math.min(...rows.map(r=>r.length)).toFixed(0)} to ${Math.max(...rows.map(r=>r.length)).toFixed(0)} m, ${runs.reduce((sum,r)=>sum+metres(r.run),0).toFixed(0)} m, ${open} ends in the open`);
  assert.ok(open%2===0&&open/2>=least&&open/2<=most,`${open/2} unbroken stretches of median (${least===most?least:`${least} to ${most}`} expected)`);
  assert.equal(rows.length,open/2,'every row is a chain of pieces with two ends in the open');
});

test('the rows are the same on a tile\'s road view as on the whole city, and the classes the rule leaves alone carry none',()=>{
  const size=city.tiles.size,box=new Map(city.roads.map(r=>[r,[Math.min(...r.points.map(p=>p[0])),Math.max(...r.points.map(p=>p[0])),Math.min(...r.points.map(p=>p[1])),Math.max(...r.points.map(p=>p[1]))]])),views=new Map();
  const view=(tx,tz)=>{const k=`${tx}_${tz}`;let v=views.get(k);if(!v)views.set(k,v={...city,roads:city.roads.filter(r=>{const [a,b,c,d]=box.get(r);return a<=(tx+1)*size+80&&b>=tx*size-80&&c<=(tz+1)*size+80&&d>=tz*size-80;})});return v;};
  const signature=list=>list.map(p=>`${p.side}|${p.x.toFixed(2)}|${p.z.toFixed(2)}|${p.length.toFixed(2)}`).sort().join(';');
  let compared=0;
  for(const [,first,second]of HIGHWAYS)for(const road of [...series(first),...series(second)].filter(isHighwayDeck)){
    // (the game builds a deck with its tile: the roads within 80 m of the tile for what covers an edge, the whole city for the median)
    const m=roadMidpoint(road),tile=view(Math.floor(m[0]/size),Math.floor(m[1]/size));compared++;
    assert.equal(signature(bridgeBarriers(tile,road,city)),signature(bridgeBarriers(city,road)),`${road.id}: the rails on its tile's view`);
  }
  assert.ok(compared>120);
  const carrying=city.roads.filter(r=>r.elevations&&medianBarriers(city,r).length);
  // (a walled cut of such a carriageway carries the row on: tests/median-cuts.test.mjs)
  assert.ok(carrying.every(r=>(isHighwayDeck(r)||!!r.tunnel&&!!r.highway)&&!r.roadway&&r.kind==='motorway'),'only carriageways without a surveyed roadway carry a row');
  assert.deepEqual([...new Set(carrying.map(r=>r.id.replace(/-\d+$/,'')))].sort(),['i90-eb','i93-nb'],'Interstate 93 and the Turnpike; Storrow Drive and the ramps as they were');
  // No row within a junction mouth of a street landing, none across a closed end's barrier row.
  const landings=city.roads.filter(isHighwayDeck).flatMap(r=>[r.startLevel===0?r.points[0]:undefined,r.endLevel===0?r.points.at(-1):undefined].filter(Boolean));
  for(const road of carrying)for(const run of medianBarriers(city,road))for(const s of run)assert.ok(!landings.some(l=>Math.hypot(l[0]-s.x,l[1]-s.z)<MOUTH_REACH-1),`${road.id}: a row at a street landing`);
});

// ---- the two pavements of a road (the generator's rule: `part` in scripts/highway_roadways.py, held on the records by its `median_check`)
const LANE_ROOM=1.2,STOREY=4.15;   // (motorwayLanes keeps a lane's centre 1.2 m inside its pavement; a slab and the room under it: a road that far over another passes over it)
const stationAt=(road,hit)=>{const a=road.points[hit.index],b=road.points[hit.index+1]??a;return tunnelStations(road)[hit.index]+Math.hypot(b[0]-a[0],b[1]-a[1])*hit.t;};
const roofed=(road,hit)=>!!road.tunnel&&tunnelCoveredAt(road,stationAt(road,hit));
/** Every metre of both carriageways, deck or walled cut, in the open: what lies between its pavement and the other carriageway's beside it at its level. */
function pavementGaps(first,second){
  const sides=[series(first),series(second)].map(list=>list.filter(r=>r.lanes!==undefined&&r.elevations));const out={metres:0,least:Infinity,where:'',shared:0,tight:0};
  for(const [mine,theirs]of [sides,[...sides].reverse()]){
    const others=boxed(theirs);
    for(const road of mine){
      const along=tunnelStations(road);
      for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],length=along[i]-along[i-1],count=Math.max(1,Math.round(length)),tx=(b[0]-a[0])/(length||1),tz=(b[1]-a[1])/(length||1);
        for(let k=i===1?0:1;k<=count;k++){
          const t=k/count,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;if(road.tunnel&&tunnelCoveredAt(road,along[i-1]+length*t))continue;
          const half=((road.deckWidths?.[i-1]??road.width)*(1-t)+(road.deckWidths?.[i]??road.width)*t)/2,y=road.elevations[i-1]*(1-t)+road.elevations[i]*t;
          // (the other carriageway lies to the left of travel: `across` reads from an edge point, so from the left edge, the pavement beyond it)
          const twin=across(others,x+tz*half,z-tx*half,tx,tz,tz,-tx);if(!twin||Math.abs(twin.height-y)>=STOREY||roofed(twin.road,roadProjection(twin.road,x,z)))continue;
          out.metres+=length/count;if(twin.gap<-.005)out.shared+=length/count;if(twin.gap<JERSEY.base-.005)out.tight+=length/count;
          if(twin.gap<out.least){out.least=twin.gap;out.where=`${road.id} at ${x.toFixed(0)}, ${z.toFixed(0)} beside ${twin.road.id}`;}
        }
      }
    }
  }
  return out;
}

test('the Turnpike\'s two carriageways never share pavement: the barrier\'s footprint lies between them at every metre, deck or cut',()=>{
  // Each carriageway was fitted to its own curbs alone, and where the survey shows no median their pavements lay in each other (1.2 km of
  // median, by up to 1.95 m in Brighton) or closer than the barrier is wide (0.8 km more). The stage now parts them: each ends half the
  // barrier's footprint short of the middle line between the two.
  const i90=pavementGaps('i90-eb','i90-wb');console.log(`the Turnpike: ${i90.metres.toFixed(0)} m of carriageway beside the other in the open, at least ${i90.least.toFixed(2)} m between the pavements (${i90.where})`);
  assert.ok(i90.metres>15000);assert.equal(i90.shared,0,`${i90.shared.toFixed(0)} m of pavement in the other carriageway's, ${(-i90.least).toFixed(2)} m at ${i90.where}`);
  assert.equal(i90.tight,0,`${i90.tight.toFixed(0)} m with less than the barrier's ${JERSEY.base} m between the pavements, ${i90.least.toFixed(2)} m at ${i90.where}`);
  // Interstate 93's inner shoulders overlap across its narrow median by design (MEDIAN_SLACK in scripts/i93_north.py, up to 1 m): its decks are
  // 18.8 m and more for four lanes, the overlap lies under the barrier and beside it on the shoulders, and the lanes keep their room (next test).
  const i93=pavementGaps('i93-nb','i93-sb');console.log(`Interstate 93: ${i93.metres.toFixed(0)} m beside the other, ${i93.shared.toFixed(0)} m of it with the shoulders in each other, by ${(-i93.least).toFixed(2)} m at most (${i93.where})`);
  assert.ok(i93.metres>7000&&i93.least>=-1.0,`${(-i93.least).toFixed(2)} m of overlap at ${i93.where}`);
});

test('the rows keep off the lanes: a car in the lane next to the median passes clear of the barrier',()=>{
  // The innermost lane's centre to the barrier's face, at every section of every row, for every record of both carriageways beside it, deck or
  // walled cut. Interstate 93 keeps a shoulder's width. The Turnpike's pavements leave the barrier's footprint between them (the test above) and
  // none is narrower than its lanes take with their centres 1.2 m inside its edges, so the barrier's face comes no closer to a lane's centre than
  // that: 1.21 m on the Allston viaduct, whose decks carry four lanes on 13.35 m (the face stood 0.84 m from a lane's centre there while the two
  // decks overlapped; the widest traffic vehicle, the box truck, is 2.17 m wide). The face is the profile's base and, for a road that lies more
  // than a kerb's height (`RAIL_LIP`) under the row, the side of the foot the row stands on, which laps 5 cm onto its pavement: the two cuts west
  // of the Prudential tunnel stand up to a metre apart in height with the barrier's footprint between them. A lower foot is a kerb at the edge.
  for(const [name,first,second,least]of [['Interstate 93','i93-nb','i93-sb',1.6],['the Turnpike','i90-eb','i90-wb',LANE_ROOM]]){
    const records=[...series(first),...series(second)].filter(r=>r.lanes!==undefined&&r.elevations);let worst=Infinity,where='',sections=0,stepped=0;
    for(const road of series(first))for(const run of medianBarriers(city,road))for(const s of run){
      sections++;
      for(const record of records){
        const hit=roadProjection(record,s.x,s.z);if(hit.distance>(record.deckWidths?.[hit.index]??record.width)/2+MEDIAN_REACH||hit.t<=0&&hit.index===0||hit.t>=1&&hit.index===record.points.length-2||roofed(record,hit))continue;
        const face=s.y-sampleRoadElevation(city,record,s.x,s.z)>RAIL_LIP?Math.max(s.half,JERSEY.base/2):JERSEY.base/2;if(face>JERSEY.base/2)stepped++;
        const room=hit.distance-Math.max(...motorwayLanes(record).map(Math.abs))-face;if(room<worst){worst=room;where=`${record.id} at ${s.x.toFixed(0)}, ${s.z.toFixed(0)}`;}
      }
    }
    console.log(`${name}: least room from an innermost lane's centre to the barrier's face ${worst.toFixed(2)} m (${where}), over ${sections} sections (${stepped} times the face of a step)`);
    assert.ok(sections>1000&&worst>=least,`${name}: ${worst.toFixed(2)} m from a lane's centre to the barrier at ${where}`);
  }
});

test('no deck of either highway loses its yellow edge line to the other carriageway',()=>{
  // A lane line is cut where another deck covers it, so inside an overlap of the two pavements wider than the shoulder neither road had its
  // yellow line: 406 m of the Turnpike's decks, most of it in Brighton. Each deck's left edge line is as long with the other carriageway there as without.
  const left=(view,road)=>laneMarkings(view,road,city).filter(l=>l.kind==='left').reduce((sum,l)=>sum+l.points.slice(1).reduce((d,p,i)=>d+Math.hypot(p[0]-l.points[i][0],p[1]-l.points[i][1]),0),0);
  for(const [name,first,second]of HIGHWAYS)for(const [mine,theirs]of [[first,second],[second,first]]){
    const other=new Set(series(theirs)),alone={...city,roads:city.roads.filter(r=>!other.has(r))};let hidden=0,worst='';
    for(const road of series(mine).filter(isHighwayDeck)){const lost=left(alone,road)-left(city,road);if(lost>hidden){hidden=lost;worst=road.id;}}
    assert.ok(hidden<1,`${name}: ${hidden.toFixed(0)} m of the yellow line of ${worst} lie under the other carriageway's deck`);
  }
});

test('on the package: a car driven at Interstate 93\'s median north of Medford Square stays on its own carriageway, from either side',async()=>{
  // Where the two pavements overlap and nothing stood between the directions (i93-nb-29 beside i93-sb-06, by Exit 24).
  const at=[-2344,-8970],bounds={minX:at[0]-160,maxX:at[0]+160,minZ:at[1]-160,maxZ:at[1]+160},tiles=[];
  for(let tx=Math.floor(bounds.minX/1000);tx<=Math.floor(bounds.maxX/1000);tx++)for(let tz=Math.floor(bounds.minZ/1000);tz<=Math.floor(bounds.maxZ/1000);tz++)tiles.push(`${tx}_${tz}`);
  const metro=await loadMetroCity({tiles}),local=windowCity(metro,bounds);local.geometry=metro.geometry;
  const physics=await DrivingPhysics.create(local,{meshBuildingIds});installExactMeshes(physics,local);
  try{
    const rows=local.roads.flatMap(r=>medianBarriers(local,r)),nearest=(x,z)=>{let best;for(const run of rows)for(const s of run){const d=Math.hypot(s.x-x,s.z-z);if(!best||d<best.d)best={d,s};}return best.s;};
    assert.ok(rows.length,'the window holds the row');
    for(const prefix of ['i93-nb','i93-sb']){
      const road=local.roads.filter(r=>r.id.startsWith(prefix+'-')&&isHighwayDeck(r)).map(r=>({r,hit:roadProjection(r,...at)})).sort((p,q)=>p.hit.distance-q.hit.distance)[0],{r,hit}=road;
      const a=r.points[hit.index],b=r.points[hit.index+1],l=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/l,tz=(b[1]-a[1])/l,row=nearest(hit.x,hit.z);
      // toward the median: the row's side of this deck's centre line
      const sign=Math.sign((row.x-hit.x)*-tz+(row.z-hit.z)*tx),mx=-tz*sign,mz=tx*sign,inner=Math.max(...motorwayLanes(r).map(Math.abs));
      for(const angle of [.5,1.2]){
        const x=hit.x+mx*inner-tx*30,z=hit.z+mz*inner-tz*30,heading=Math.atan2(tx*Math.cos(angle)+mx*Math.sin(angle),tz*Math.cos(angle)+mz*Math.sin(angle));
        launch(physics,x,z,heading,r.id);
        let beyond=-Infinity,speed=0;
        for(let i=0;i<240;i++){physics.step({...released,throttle:1},1/60);const s=physics.getState(),here=nearest(s.x,s.z);beyond=Math.max(beyond,(s.x-here.x)*mx+(s.z-here.z)*mz);speed=Math.max(speed,Math.abs(s.speed));}
        const s=physics.getState();
        assert.ok(speed>SPEED-3,`${r.id}: the car drives (${speed.toFixed(1)} m/s)`);
        assert.ok(beyond<-.6,`${r.id} at ${angle} rad: the car's middle comes ${(-beyond).toFixed(2)} m short of the row's middle line and never past it`);
        assert.ok(Math.abs(s.y-sampleRoadElevation(local,r,s.x,s.z))<1.5,`${r.id}: and it is still on its deck (y ${s.y.toFixed(2)})`);
      }
    }
  }finally{physics.dispose();}
});
