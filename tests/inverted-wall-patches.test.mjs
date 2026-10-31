import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {loadMetroCity} from './helpers/metro-city.mjs';
import {tileShellGeometry} from '../src/render/tile-geometry.ts';

const city=await loadMetroCity({tiles:['0_-4']});

/** Does any shell surface pass above (x, z) higher than y? */
const covered=(ray,shell,x,y,z)=>{ray.set(new THREE.Vector3(x,400,z),new THREE.Vector3(0,-1,0));return ray.intersectObject(shell).some(hit=>hit.point.y>y+.01);};

test('100 Hood Park Drive renders its main-body walls from the street, not from inside',()=>{
  const b=city.buildings.find(b=>b.id==='BOS-LDZN8-RQ6CN-LJCIO');assert.equal(b.source,'boston-obj');
  const data=city.geometry.get(b.id),walls=tileShellGeometry(data,b,false),roof=tileShellGeometry(data,b,true);
  // Every surface, both sides, for the coverage probes; the walls alone, front faces only, as the facade material draws them.
  const shell=new THREE.Mesh(walls.clone(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),cap=new THREE.Mesh(roof,shell.material),facade=new THREE.Mesh(walls,new THREE.MeshBasicMaterial({side:THREE.FrontSide}));
  const probes=new THREE.Group();probes.add(shell,cap);probes.updateMatrixWorld();facade.updateMatrixWorld();
  const p=walls.attributes.position,n=walls.attributes.normal,ray=new THREE.Raycaster();let inverted=0,confirmed=0;
  for(let i=0;i<p.count;i+=3){
    const ny=n.getY(i);if(Math.abs(ny)>.3)continue;
    const cx=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,cy=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3,cz=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    const h=Math.hypot(n.getX(i),n.getZ(i)),ux=n.getX(i)/h,uz=n.getZ(i)/h;
    // A wall whose normal points under the building's own roof while the other side is open sky is wound into the building:
    // the survey delivered the whole main body that way, so the facade material culled every street-facing wall.
    const front=covered(ray,probes,cx+ux*.3,cy,cz+uz*.3),back=covered(ray,probes,cx-ux*.3,cy,cz-uz*.3);
    if(front&&!back)inverted++;
    if(!front&&back){
      confirmed++;
      ray.set(new THREE.Vector3(cx+ux*2,cy,cz+uz*2),new THREE.Vector3(-ux,0,-uz));
      const hit=ray.intersectObject(facade)[0];assert.ok(hit&&hit.distance<2.01,`wall at (${cx.toFixed(1)}, ${cz.toFixed(1)}) must render with front-face culling`);
    }
  }
  assert.equal(inverted,0,'no wall faces into the building');assert.ok(confirmed>60,`${confirmed} walls confirmed facing out`);
  walls.dispose();roof.dispose();shell.geometry.dispose();shell.material.dispose();facade.material.dispose();
});
