import assert from 'node:assert/strict';
import test from 'node:test';
import {SOUTH_STATION_ID,isSouthStation,splitSouthStationShell,southStationPoint,southStationRuns,inSouthStationHeadhouse} from '../src/render/south-station.ts';
import {loadMetroCity,shellGeometry} from './helpers/metro-city.mjs';

const city=await loadMetroCity({tiles:['1_-1']});
const triangleRecords=geometry=>{
  const attributes=['position','normal','uv'].filter(name=>geometry.hasAttribute(name)),p=geometry.getAttribute('position'),records=[];
  for(let i=0;i<p.count;i+=3){const row=[];for(const name of attributes){const a=geometry.getAttribute(name);for(let j=0;j<3;j++)for(let k=0;k<a.itemSize;k++)row.push(a.getComponent(i+j,k));}records.push(JSON.stringify(row));}
  return records;
};
const segmentDistance=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);};

test('South Station is addressed by id before its tile streams in and keeps its surveyed shell',()=>{
  assert.deepEqual(city.buildings.filter(isSouthStation).map(b=>b.id),[SOUTH_STATION_ID],'only the surveyed station receives the treatment');
  const station=city.buildings.find(isSouthStation),listed=city.landmarkBuildings.find(isSouthStation);
  assert.ok(listed,'city.landmarkBuildings carries the station for the facade module');
  assert.deepEqual([listed.center,listed.baseElevation,listed.height],[station.center,station.baseElevation,station.height]);
  for(const roof of [false,true]){
    const source=shellGeometry(city,SOUTH_STATION_ID,roof),parts=splitSouthStationShell(source,roof);
    assert.deepEqual(parts.flatMap(p=>triangleRecords(p.geometry)).sort(),triangleRecords(source).sort(),'materials must not alter or drop source geometry');
    assert.deepEqual(parts.map(p=>p.kind).sort(),roof?['other','roof']:['granite','other'],'the headhouse is granite and membrane; the canopies and bus terminal behind it keep the ordinary finish');
    for(const part of parts){
      const p=part.geometry.getAttribute('position');
      for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;assert.equal(inSouthStationHeadhouse(x,z),part.kind!=='other');}
    }
    source.dispose();parts.forEach(p=>p.geometry.dispose());
  }
});

test('the South Station facade frame follows the surveyed headhouse walls',()=>{
  // Slice the wall shell 20 m above its base, where the frame was measured.
  const source=shellGeometry(city,SOUTH_STATION_ID,false),p=source.getAttribute('position'),y=southStationPoint('west',0,0,20).y,slices=[];
  for(let i=0;i<p.count;i+=3){
    const v=[0,1,2].map(k=>[p.getX(i+k),p.getY(i+k),p.getZ(i+k)]),hits=[];
    for(let k=0;k<3;k++){const a=v[k],b=v[(k+1)%3];if((a[1]-y)*(b[1]-y)<0){const t=(y-a[1])/(b[1]-a[1]);hits.push([a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t]);}}
    if(hits.length===2)slices.push(hits);
  }
  source.dispose();
  assert.ok(slices.length>50,'the wall shell crosses the measuring height');
  const runs=southStationRuns();let worst=0;
  for(const [name,run] of Object.entries(runs))for(let s=0;s<=run.length;s+=1){
    const q=southStationPoint(name,s,0,20),d=Math.min(...slices.map(([a,b])=>segmentDistance(q.x,q.z,a,b)));
    worst=Math.max(worst,d);
  }
  assert.ok(worst<1.2,`every station of the frame lies on a surveyed wall or a bridged pier return (${worst.toFixed(2)} m)`);
  const pavilion=runs.pavilion,front=southStationPoint('pavilion',pavilion.length/2,1,0),centre=southStationPoint('pavilion',pavilion.length/2,0,0);
  assert.ok(front.z<centre.z,'the pavilion faces north over Dewey Square');
});

test('the South Station destination arrives on Summer Street with the Dewey Square pavilion ahead',()=>{
  const ids=city.landmarks.map(l=>l.id),landmark=city.landmarks.find(l=>l.id==='south-station');
  assert.ok(landmark,'city.json lists the destination for the atlas');
  assert.equal(ids[ids.indexOf('chinatown-gate')+1],'south-station','PLACES order is kept');
  assert.deepEqual(landmark.position,[1611.518,-246.877]);assert.equal(landmark.buildingId,SOUTH_STATION_ID);
  const start=landmark.driveStart,station=city.buildings.find(isSouthStation);
  assert.ok(start&&Number.isFinite(start.x)&&Number.isFinite(start.z)&&Number.isFinite(start.yaw));
  const road=city.roads.find(r=>r.id==='16420-0-0');assert.ok(road);
  const distance=Math.min(...road.points.slice(1).map((b,i)=>segmentDistance(start.x,start.z,road.points[i],b)));
  assert.ok(distance<3,`the start sits in the carriageway (${distance.toFixed(2)} m from its centerline)`);
  const heading=[Math.sin(start.yaw),Math.cos(start.yaw)],toStation=[landmark.position[0]-start.x,landmark.position[1]-start.z],range=Math.hypot(...toStation);
  assert.ok(range>40&&range<140&&(heading[0]*toStation[0]+heading[1]*toStation[1])/range>.6,'the pavilion lies ahead of the car');
  const footprint=station.footprint;let inside=false;
  for(let i=0,j=footprint.length-1;i<footprint.length;j=i++){const [xi,zi]=footprint[i],[xj,zj]=footprint[j];if(zi>start.z!==zj>start.z&&start.x<(xj-xi)*(start.z-zi)/(zj-zi)+xi)inside=!inside;}
  assert.ok(!inside,'the start is outside the station footprint');
});
