import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {SYMPHONY_HALL_ID,isSymphonyHall,splitSymphonyHallShell,symphonyHallPoint} from '../src/render/symphony-hall.ts';
import {loadMetroCity,shellGeometry} from './helpers/metro-city.mjs';

const city=await loadMetroCity({tiles:['-1_0']});
const triangleRecords=geometry=>{
  const attributes=['position','normal','uv'].filter(name=>geometry.hasAttribute(name)),p=geometry.getAttribute('position'),records=[];
  for(let i=0;i<p.count;i+=3){const row=[];for(const name of attributes){const a=geometry.getAttribute(name);for(let j=0;j<3;j++)for(let k=0;k<a.itemSize;k++)row.push(a.getComponent(i+j,k));}records.push(JSON.stringify(row));}
  return records;
};

test('Symphony Hall is addressed by id before its tile streams in and keeps its surveyed shell',()=>{
  assert.deepEqual(city.buildings.filter(isSymphonyHall).map(b=>b.id),[SYMPHONY_HALL_ID],'only the surveyed hall receives the treatment');
  const hall=city.buildings.find(isSymphonyHall),listed=city.landmarkBuildings.find(isSymphonyHall);
  assert.ok(listed,'city.landmarkBuildings carries the hall for the facade module');
  assert.deepEqual([listed.center,listed.baseElevation,listed.height],[hall.center,hall.baseElevation,hall.height]);
  assert.equal(hall.landmark,undefined,'the tile record stays untagged so tiles and far.bin are byte-identical');
  const corner=symphonyHallPoint(0,0),east=hall.footprint.reduce((best,p)=>Math.hypot(p[0]-corner.x,p[1]-corner.z)<Math.hypot(best[0]-corner.x,best[1]-corner.z)?p:best);
  assert.ok(Math.hypot(east[0]-corner.x,east[1]-corner.z)<.02,'the facade frame origin is the surveyed corner at Massachusetts and Huntington avenues');
  const base=hall.baseElevation;
  for(const roof of [false,true]){
    const source=shellGeometry(city,SYMPHONY_HALL_ID,roof),parts=splitSymphonyHallShell(source,hall,roof);
    assert.deepEqual(parts.flatMap(p=>triangleRecords(p.geometry)).sort(),triangleRecords(source).sort(),'materials must not alter or drop source geometry');
    if(!roof)assert.deepEqual(parts.map(p=>p.kind),['brick']);
    else{
      assert.deepEqual(parts.map(p=>p.kind).sort(),['copper','membrane'],'the pitched auditorium roof is copper above the flat membrane roofs');
      const copper=parts.find(p=>p.kind==='copper').geometry,p=copper.getAttribute('position');
      for(let i=0;i<p.count;i+=3){
        const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
        assert.ok((a.y+b.y+c.y)/3>base+19,'copper stays above the eaves');assert.ok(b.sub(a).cross(c.sub(a)).normalize().y<.97,'copper covers the slopes only');
      }
    }
    source.dispose();parts.forEach(p=>p.geometry.dispose());
  }
});

test('the Symphony Hall destination arrives on the inbound Huntington Avenue carriageway facing the portico',()=>{
  const ids=city.landmarks.map(l=>l.id),landmark=city.landmarks.find(l=>l.id==='symphony-hall');
  assert.ok(landmark,'city.json lists the destination for the atlas');
  assert.equal(ids[ids.indexOf('kenmore-square')+1],'symphony-hall','PLACES order is kept');
  assert.deepEqual(landmark.position,[-895.289,806.657]);assert.equal(landmark.buildingId,SYMPHONY_HALL_ID);
  const start=landmark.driveStart,hall=city.buildings.find(isSymphonyHall);
  assert.ok(start&&Number.isFinite(start.x)&&Number.isFinite(start.z)&&Number.isFinite(start.yaw));
  const road=city.roads.find(r=>r.id==='9276-0-0');assert.ok(road);
  const distance=Math.min(...road.points.slice(1).map((b,i)=>{const a=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((start.x-a[0])*dx+(start.z-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(start.x-a[0]-t*dx,start.z-a[1]-t*dz);}));
  assert.ok(distance<3,`the start sits in the carriageway (${distance.toFixed(2)} m from its centerline)`);
  const heading=[Math.sin(start.yaw),Math.cos(start.yaw)],toHall=[landmark.position[0]-start.x,landmark.position[1]-start.z],range=Math.hypot(...toHall);
  assert.ok(range>60&&range<140&&(heading[0]*toHall[0]+heading[1]*toHall[1])/range>.6,'the hall lies ahead of the car');
  const footprint=hall.footprint;let inside=false;
  for(let i=0,j=footprint.length-1;i<footprint.length;j=i++){const [xi,zi]=footprint[i],[xj,zj]=footprint[j];if(zi>start.z!==zj>start.z&&start.x<(xj-xi)*(start.z-zi)/(zj-zi)+xi)inside=!inside;}
  assert.ok(!inside,'the start is outside the hall footprint');
});
