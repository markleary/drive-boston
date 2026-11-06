import assert from 'node:assert/strict';
import test from 'node:test';
import {TD_GARDEN_ID,TD_GARDEN_PODIUM_TOP,TD_GARDEN_YARD,isTdGarden,splitTdGardenShell,tdGardenFaces,tdGardenFrame,tdGardenPoint,tdGardenWorld} from '../src/render/td-garden.ts';
import {bridgeSupports,sampleRoadElevation} from '../src/simulation/road-surfaces.ts';
import {sampleElevation} from '../src/simulation/terrain.ts';
import {loadMetroCity,shellGeometry} from './helpers/metro-city.mjs';

// The arena's tile and the two its yard reaches.
const city=await loadMetroCity({tiles:['1_-2','0_-2','0_-3']});
const corners=geometry=>{const p=geometry.getAttribute('position'),list=[];for(let i=0;i<p.count;i++)list.push([p.getX(i),p.getY(i),p.getZ(i)]);return list;};
const area=geometry=>{
  const v=corners(geometry);let total=0;
  for(let i=0;i<v.length;i+=3){const a=v[i],b=v[i+1],c=v[i+2],e=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],f=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];total+=Math.hypot(e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0])/2;}
  return total;
};
const segmentDistance=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);};
const within=(polygon,x,z)=>{let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [xi,zi]=polygon[i],[xj,zj]=polygon[j];if(zi>z!==zj>z&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;}return inside;};

test('the TD Garden is addressed by id before its tile streams in and keeps its surveyed shell',()=>{
  assert.deepEqual(city.buildings.filter(isTdGarden).map(b=>b.id),[TD_GARDEN_ID],'only the surveyed arena and podium receive the treatment');
  const garden=city.buildings.find(isTdGarden),listed=city.landmarkBuildings.find(isTdGarden);
  assert.ok(listed,'city.landmarkBuildings carries the building for the signs, the hall and the yard');
  assert.deepEqual([listed.center,listed.baseElevation,listed.height],[garden.center,garden.baseElevation,garden.height]);
  for(const roof of [false,true]){
    const indexed=shellGeometry(city,TD_GARDEN_ID,roof),source=indexed.index?indexed.toNonIndexed():indexed,parts=splitTdGardenShell(indexed,roof),known=new Set(corners(source).map(String));
    assert.deepEqual(parts.map(p=>p.kind).sort(),roof?['membrane','other','skylight']:['concrete','glass','hotel','open','panel','podium'],'every wall has a finish of its own; roofs other than the arena and the hall keep the ordinary one');
    const total=parts.reduce((sum,p)=>sum+area(p.geometry),0),surveyed=area(source);
    assert.ok(Math.abs(total-surveyed)<surveyed*1e-6,`the finishes cover the surveyed shell exactly (${total.toFixed(2)} of ${surveyed.toFixed(2)} m2)`);
    // Triangles are kept as surveyed except along the two finish lines, where the new vertices lie.
    const cuts=parts.flatMap(p=>corners(p.geometry)).filter(v=>!known.has(String(v))).map(v=>v[1]);
    if(roof)assert.deepEqual(cuts,[],'roof triangles are kept whole');
    else{
      assert.ok(cuts.length>0&&cuts.every(y=>Math.abs(y-TD_GARDEN_PODIUM_TOP)<1e-3||Math.abs(y-35.2)<1e-3),'walls are cut only at the podium top under the towers and at the sill of the glazed east gable');
      assert.ok(cuts.some(y=>Math.abs(y-TD_GARDEN_PODIUM_TOP)<1e-3)&&cuts.some(y=>Math.abs(y-35.2)<1e-3));
      // The street wall of the passage is the only surface left out, so the entrance hall shows behind the gantry.
      const open=corners(parts.find(p=>p.kind==='open').geometry),mouth=tdGardenFaces().mouth;
      assert.equal(open.length,6,'two triangles');
      for(const [x,y,z] of open){assert.ok(segmentDistance(x,z,mouth.from,mouth.to)<.1,'on the entrance face');assert.ok(y<31);}
      assert.ok(Math.abs(area(parts.find(p=>p.kind==='open').geometry)-mouth.length*(Math.max(...open.map(v=>v[1]))-Math.min(...open.map(v=>v[1]))))<2,'the whole opening between the hotel and 100 Causeway');
    }
    source.dispose();if(indexed!==source)indexed.dispose();parts.forEach(p=>p.geometry.dispose());
  }
});

test('the TD Garden frame follows the surveyed walls',()=>{
  const [u,v]=tdGardenFrame(...tdGardenWorld(81.3,-148.5));assert.ok(Math.abs(u-81.3)<1e-4&&Math.abs(v+148.5)<1e-4,'frame and world coordinates invert each other');
  // Slice the wall shell 10 m up, below every podium roof.
  const source=shellGeometry(city,TD_GARDEN_ID,false),flat=source.index?source.toNonIndexed():source,p=corners(flat),y=10,slices=[];
  for(let i=0;i<p.length;i+=3){
    const hits=[];
    for(let k=0;k<3;k++){const a=p[i+k],b=p[i+(k+1)%3];if((a[1]-y)*(b[1]-y)<0){const t=(y-a[1])/(b[1]-a[1]);hits.push([a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t]);}}
    if(hits.length===2)slices.push(hits);
  }
  source.dispose();if(flat!==source)flat.dispose();
  assert.ok(slices.length>50,'the wall shell crosses the measuring height');
  const faces=tdGardenFaces();let worst=0;
  for(const [name,face] of Object.entries(faces))for(let s=0;s<=face.length;s+=1){
    const q=tdGardenPoint(name,s,y);worst=Math.max(worst,Math.min(...slices.map(([a,b])=>segmentDistance(q.x,q.z,a,b))));
  }
  assert.ok(worst<.5,`every station of every face lies on a surveyed wall (${worst.toFixed(2)} m)`);
  // Normals in the frame: the track wall looks toward the tracks, the Causeway Street fronts the other way.
  const toward=name=>{const {normal:[nx,nz]}=faces[name],[a,b]=tdGardenWorld(0,0),[c,d]=tdGardenWorld(0,1);return nx*(c-a)+nz*(d-b);};
  assert.ok(toward('north')>.95,'the track wall faces the yard');
  for(const name of ['towerA','hotel','mouth','officeWest','office','wing'])assert.ok(toward(name)<-.95,`${name} faces Causeway Street`);
});

test("North Station's yard is clear of the Connector's piers, the roads over it and the buildings beside it",()=>{
  const {west,east,end,bay,tracks,platforms,trains}=TD_GARDEN_YARD,COLUMN=1.5,CAR=1.55; // a 1.8 by 2.4 m column's half diagonal; half a 3.1 m car
  assert.ok(tracks.every((u,i)=>u>west+CAR&&u<east-CAR&&(!i||u-tracks[i-1]>=2*CAR+1.2)),'tracks lie inside the walls, trains passing each other');
  for(const [u0,u1,north,roofs] of platforms){
    assert.ok(u0>=west&&u1<=east&&north<=end&&(north-6)%bay===0,'platforms stand inside the yard on the bay grid');
    assert.ok(tracks.every(u=>u<=u0-CAR||u>=u1+CAR),'no platform edge fouls a car');
    assert.ok(tracks.some(u=>Math.abs(u-(u0-CAR))<.4||Math.abs(u-(u1+CAR))<.4),'every platform serves a track');
    assert.ok(roofs.every(([from,to],i)=>from>=6&&to<=north&&(from-6)%bay===0&&(to-from)%bay===0&&(!i||from>roofs[i-1][1])),'canopies run in whole bays');
  }
  for(const [u,coaches] of trains){assert.ok(tracks.includes(u));assert.ok(10+coaches*26+20<end-8,'the train stands short of the signal bridge');}
  // Piers as the renderer and the physics place them, on the roads around the yard.
  const [cx,cz]=tdGardenWorld((west+east)/2,end/2),reach=Math.hypot(east-west,end)/2+15,roads=city.roads.filter(r=>r.points.some(([x,z],i)=>i&&segmentDistance(cx,cz,r.points[i-1],[x,z])<reach));
  const piers=roads.filter(r=>r.elevations&&r.bridge).flatMap(road=>bridgeSupports(city,road).map(s=>tdGardenFrame(s.x,s.z))).filter(([u,v])=>u>west-COLUMN&&u<east+COLUMN&&v>0&&v<end);
  const inside=piers.filter(([u])=>u>west&&u<east),standing=inside.filter(([u])=>platforms.some(([u0,u1])=>u>u0&&u<u1));
  assert.equal(inside.length,4,'four Connector piers stand in the yard');assert.equal(standing.length,3,'three of them on platforms');
  for(const [u,v] of piers){
    for(const track of tracks)assert.ok(Math.abs(u-track)>=COLUMN+CAR,`the pier at ${u.toFixed(1)}, ${v.toFixed(1)} is clear of the track at ${track}`);
    for(const [u0,u1,,roofs] of platforms)if(u+COLUMN>u0+.6&&u-COLUMN<u1-.6)for(const [from,to] of roofs)assert.ok(v+COLUMN<=from||v-COLUMN>=to,`the canopy from ${from} to ${to} stops short of the pier at ${u.toFixed(1)}, ${v.toFixed(1)}`);
  }
  // Nothing but the Connector's decks crosses the yard, high over the canopies and the signal bridge.
  let crossings=0;
  for(const road of roads)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));
    for(let k=0;k<=n;k++){
      const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n,[u,v]=tdGardenFrame(x,z);if(u<west-road.width/2||u>east+road.width/2||v<0||v>end)continue;
      assert.ok(road.elevations&&road.bridge,`${road.name} (${road.id}) runs through the yard at grade`);crossings++;
      const clear=sampleRoadElevation(city,road,x,z)-road.bridge.thickness-sampleElevation(city,x,z);assert.ok(clear>9,`${road.name} passes ${clear.toFixed(1)} m over the yard`);
    }
  }
  assert.ok(crossings>50,'the Connector crosses the yard');
  const ring=[[west,.5],[east,.5],[east,end],[west,end]].map(([u,v])=>tdGardenWorld(u,v));
  for(const building of city.buildings){
    if(isTdGarden(building)||!building.footprint)continue;
    assert.ok(!building.footprint.some(([x,z])=>within(ring,x,z))&&!ring.some(([x,z])=>within(building.footprint,x,z)),`${building.id} stands in the yard`);
  }
});

test('the TD Garden destination arrives on Canal Street with the gantry ahead',()=>{
  const landmark=city.landmarks.find(l=>l.id==='td-garden');
  assert.ok(landmark,'city.json lists the destination for the atlas');
  assert.deepEqual(landmark.position,[1030.261,-1802.186]);assert.equal(landmark.buildingId,TD_GARDEN_ID);
  const start=landmark.driveStart,garden=city.buildings.find(isTdGarden);
  assert.ok(start&&Number.isFinite(start.x)&&Number.isFinite(start.z)&&Number.isFinite(start.yaw));
  const road=city.roads.find(r=>r.id==='15123-0-0');assert.equal(road?.name,'Canal Street');
  const distance=Math.min(...road.points.slice(1).map((b,i)=>segmentDistance(start.x,start.z,road.points[i],b)));
  assert.ok(distance<3,`the start sits in the carriageway (${distance.toFixed(2)} m from its centerline)`);
  const mouth=tdGardenFaces().mouth,entrance=tdGardenPoint('mouth',mouth.length/2),heading=[Math.sin(start.yaw),Math.cos(start.yaw)],to=[entrance.x-start.x,entrance.z-start.z],range=Math.hypot(...to);
  assert.ok(range>100&&range<140,`the whole gantry fits the view (${range.toFixed(0)} m away)`);
  assert.ok((heading[0]*to[0]+heading[1]*to[1])/range>.98,'the entrance lies straight ahead of the car');
  assert.ok(-(heading[0]*mouth.normal[0]+heading[1]*mouth.normal[1])>.98,'the car faces the entrance square on');
  assert.ok(!within(garden.footprint,start.x,start.z),'the start is outside the building footprint');
});
