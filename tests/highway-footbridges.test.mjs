import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {createWalker,WALKER} from '../src/simulation/walker.ts';
import {footbridgeRoad,footbridgeSupports,footbridgeTreads,FOOTBRIDGE_SLAB,FOOTBRIDGE_COLUMN} from '../src/simulation/footbridges.ts';
import {highwayMasts} from '../src/simulation/highway-lighting.ts';
import {deckUndersideAt,roadProjection,roadSlabGeometry,roadWidthAt,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {loadMetroCity,windowCity,readJson} from './helpers/metro-city.mjs';

// The footbridges over the Turnpike and Storrow Drive (scripts/footbridges.py): each is one park path with stored heights.
const record=readJson('provenance.json').footbridges,stations=p=>p.reduce((s,q,i)=>(s.push(i?s[i-1]+Math.hypot(q[0]-p[i-1][0],q[1]-p[i-1][1]):0),s),[]);
const roomFor=r=>r.highway==='storrow'||r.bridge?.id==='storrow'?3.2:r.highway||r.lanes?3.4:4.25;
const covered=(r,x,z)=>{const hit=roadProjection(r,x,z),s=stations(r.points),at=s[hit.index]+(s[hit.index+1]-s[hit.index])*hit.t;return !!r.tunnel?.covered?.some(([a,b])=>at>=a&&at<=b);};
async function bridge(id){
 const b=record.bridges.find(b=>b.id===id),key=b.tiles[0],[tx,tz]=key.split('_').map(Number),metro=await loadMetroCity({tiles:[key]});
 const path=metro.parkPaths.find(p=>p.id===`footbridge-${id}-${key}_0`);assert.ok(path,`${id} is a park path of tile ${key}`);
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z]of path.points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
 const bounds={minX:minX-40,maxX:maxX+40,minZ:minZ-40,maxZ:maxZ+40},city=windowCity(metro,bounds);
 return{b,path,city,metro,road:footbridgeRoad(city,path),tile:[tx,tz]};
}

test('a path with stored heights is its deck as stored: no arch, and steps and columns only where it has them',()=>{
 const flat={elevation:undefined,roads:[],water:[]},path={id:'stored',width:2,bridge:true,name:'Test',points:[[0,0],[2,0],[4,0],[6,0],[8,0]],elevations:[.05,.9,1.75,1.75,1.75],steps:[[0,2]]},road=footbridgeRoad(flat,path);
 assert.deepEqual(road.points,path.points);assert.deepEqual(road.elevations,path.elevations);assert.equal(road.bridge.thickness,FOOTBRIDGE_SLAB);assert.equal(road.name,'Test');assert.equal(road.id,'footbridge:stored');
 const slab=roadSlabGeometry(flat,road);assert.equal(slab.vertices.length,path.points.length*2*2*3,'a closed slab over the stored stations');
 const treads=footbridgeTreads(road,path);assert.equal(treads.length,10,'1.7 m of rise in 17 cm risers');
 assert.ok(treads.every(t=>Math.abs(t.depth-.4)<1e-9&&Math.abs(t.height-.17)<1e-9&&t.width===1.7));assert.ok(treads.every((t,i)=>!i||t.y>treads[i-1].y&&t.x>treads[i-1].x),'the treads climb with the slab');
 assert.ok(Math.abs(treads.at(-1).y+treads.at(-1).height/2-1.75)<1e-9,'the top tread is level with the deck');
 // the arched park bridge is untouched: no steps, no columns
 const arch={id:'arch',width:2,bridge:true,points:[[0,0],[12,0]]},arched=footbridgeRoad(flat,arch);assert.ok(Math.max(...arched.elevations)>.3);assert.deepEqual(footbridgeTreads(arched,arch),[]);assert.deepEqual(footbridgeSupports(flat,arched,arch),[]);
 assert.equal(footbridgeRoad(flat,{...path,elevations:[0,1]}).name,'Park footbridge','heights that do not match the points are ignored');
});

test('columns stand at the edges of a roadway and along the ramps, never in the lanes',()=>{
 const lanes={id:'lanes',name:'',width:8,oneway:1,points:[[20,-30],[20,30]],elevations:[0,0],bridge:{id:'x',thickness:.75}},roofed={id:'roofed',name:'',width:8,oneway:1,points:[[36,-30],[36,30]],elevations:[-6,-6],tunnel:{clearance:4,covered:[[0,60]]}};
 const city={elevation:undefined,roads:[lanes,roofed],water:[]},points=[],elevations=[];
 for(let x=0;x<=50;x+=2){points.push([x,0]);elevations.push(Math.min(4,x*.5)+.05);}
 const path={id:'p',width:2.4,bridge:true,points,elevations},road=footbridgeRoad(city,path),supports=footbridgeSupports(city,road,path);
 assert.ok(supports.length>=4);assert.ok(supports.every(s=>Math.abs(s.x-20)>=4+.8+FOOTBRIDGE_COLUMN/2-1e-9),'none in the roadway or within its shoulder');
 assert.ok(supports.some(s=>s.x<16&&s.x>=14)&&supports.some(s=>s.x>24&&s.x<=26),'one at each edge of the roadway');
 assert.ok(supports.some(s=>Math.abs(s.x-36)<4),'a column may stand on a tunnel record\'s roof');
 assert.ok(supports.every(s=>s.top-s.bottom>1.2&&Math.abs(s.top-(Math.min(4,s.x*.5)+.05-FOOTBRIDGE_SLAB))<1e-9&&s.width===2.4),'each reaches the slab');
 assert.ok(supports.every((s,i)=>!i||s.x-supports[i-1].x<=Math.max(9,8+2*(.8+FOOTBRIDGE_COLUMN/2)+2)+1e-9),'no gap longer than the spacing, or a roadway with its shoulders');
 assert.ok(!supports.some(s=>s.x<2.4),'none where the ramp is still at the ground');assert.equal(supports[0].x,3,'the first where the ramp has risen 1.2 m');
});

for(const b of record.bridges)test(`${b.id}: the installed bridge is whole, lands on the ground and leaves the roads beneath their room`,async()=>{
 const {path,city,metro,road}=await bridge(b.id),p=path.points,e=path.elevations,along=stations(p);
 assert.equal(e.length,p.length);assert.ok(Math.abs(along.at(-1)-b.length)<.05);assert.ok(along.every((s,i)=>!i||s-along[i-1]<=2+1e-6));
 for(const way of b.ways)assert.ok(!metro.parkPaths.some(q=>q.id.startsWith(`osm-way-${way}-`)),`no clipped piece of way ${way} is left`);
 for(const i of [0,p.length-1])assert.ok(Math.abs(e[i]-sampleElevation(city,...p[i])-.052)<.01,'an end stands on the ground at a path\'s height');
 assert.ok(e.every((h,i)=>h>=sampleElevation(city,...p[i])+.04),'the deck is never under the ground');assert.equal(Math.max(...e),b.deck);
 // Under every station of the deck that lies over an open roadway, across the roadway's width.
 let over=0;
 for(const c of b.crossings){
  const under=city.roads.find(r=>r.id===c.road);assert.ok(under,`${c.road} is a road of the window`);
  p.forEach(([x,z],i)=>{
   if(roadProjection(under,x,z).distance>roadWidthAt(under,x,z)/2||covered(under,x,z))return;
   over++;assert.ok(e[i]-FOOTBRIDGE_SLAB-sampleRoadElevation(city,under,x,z)>=roomFor(under)-.01,`${(e[i]-FOOTBRIDGE_SLAB-sampleRoadElevation(city,under,x,z)).toFixed(2)} m over ${c.road} at station ${along[i].toFixed(0)}`);
  });
 }
 assert.ok(over>=4,'the deck crosses its roads');
 const supports=footbridgeSupports(city,road,path);assert.ok(supports.length>=3,`${supports.length} columns`);
 for(const s of supports)for(const r of city.roads){
  const hit=roadProjection(r,s.x,s.z);if(hit.distance>roadWidthAt(r,s.x,s.z)/2+.5||sampleRoadElevation(city,r,s.x,s.z)>s.top-1||covered(r,s.x,s.z))continue;
  assert.fail(`a column stands ${hit.distance.toFixed(1)} m from the centre line of ${r.id}`);
 }
 // The city lists the deck, so what stands under it knows of it whichever tile is loaded: the Turnpike's lighting masts,
 // 10 m tall beside its lanes, are planned (as the tile builder plans them) without one that would come up through a deck.
 const listed=city.footbridges.find(d=>d.id===b.id);assert.deepEqual(listed,{id:b.id,width:path.width,points:p,elevations:e});
 const mid=Math.floor(p.length/2);assert.ok(Math.abs(deckUndersideAt(city,...p[mid],e[mid]-1)-(e[mid]-FOOTBRIDGE_SLAB))<1e-6,'the deck is what stands over its own line');
 assert.equal(deckUndersideAt({...city,footbridges:[]},...p[mid],e[mid]-1),Infinity);
 for(const r of city.roads)for(const m of highwayMasts(r,(x,z,above)=>deckUndersideAt(city,x,z,above)))assert.ok(roadProjection(road,m.x,m.z).distance>path.width/2+.5,`a lighting mast of ${r.id} stands in the deck or against its rail`);
});

test('a walker crosses Storrow Drive on the Silber Way footbridge, up the ramp that turns back and down beside Back Street',async()=>{
 const {path,city,road}=await bridge('silber-way'),p=path.points,e=path.elevations,along=stations(p);
 Object.assign(city,{buildings:[],parkPaths:[path],spawn:{x:p[0][0]-30,z:p[0][1]-20,yaw:0}});
 const physics=await DrivingPhysics.create(city),walker=createWalker(city,physics),parked={throttle:0,brake:1,steer:0,handbrake:true};
 try{
  const yaw0=Math.atan2(p[1][0]-p[0][0],p[1][1]-p[0][1]);walker.place(p[0][0]-Math.sin(yaw0)*2,sampleElevation(city,p[0][0],p[0][1]),p[0][1]-Math.cos(yaw0)*2,yaw0);
  const storrow=city.roads.filter(r=>/^storrow-(eb|wb)-\d+$/.test(r.id));assert.ok(storrow.length>=2);
  let target=0,overRoad=0,highest=-Infinity,arrived=false;
  for(let step=0;step<60*150&&!arrived;step++){
   const s=walker.state;
   while(target<p.length-1&&Math.hypot(p[target][0]-s.x,p[target][1]-s.z)<1.1)target++;
   s.viewYaw=Math.atan2(p[target][0]-s.x,p[target][1]-s.z);
   walker.update(1/60,{forward:1,strafe:0,turn:0,run:false,jump:false});physics.step(parked,1/60);
   const hit=roadProjection(road,s.x,s.z),deck=sampleRoadElevation(city,road,s.x,s.z);
   if(hit.distance<path.width/2-.1&&target>1&&target<p.length-1)assert.ok(Math.abs(s.y-deck)<.25,`the walker stands on the deck (${s.y.toFixed(2)} against ${deck.toFixed(2)} at ${s.x.toFixed(1)}, ${s.z.toFixed(1)})`);
   highest=Math.max(highest,s.y);
   for(const r of storrow)if(roadProjection(r,s.x,s.z).distance<roadWidthAt(r,s.x,s.z)/2){overRoad++;assert.ok(s.y-sampleRoadElevation(city,r,s.x,s.z)>3.2,'over the lanes the walker is on the span, not in them');}
   arrived=target===p.length-1&&Math.hypot(p.at(-1)[0]-s.x,p.at(-1)[1]-s.z)<.6;
  }
  assert.ok(arrived,`the walker reaches the far landing (stopped at station ${along[target].toFixed(0)} of ${along.at(-1).toFixed(0)})`);
  assert.ok(Math.abs(highest-Math.max(...e))<.2,'over the top of the deck');assert.ok(overRoad>60*4,'and across both carriageways');
  assert.ok(Math.abs(walker.state.y-sampleElevation(city,walker.state.x,walker.state.z))<.3,'down to the ground beside Back Street');assert.ok(WALKER.walkSpeed>1);
 }finally{walker.dispose();physics.dispose();}
});
