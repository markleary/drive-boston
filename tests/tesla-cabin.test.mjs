import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {geometryParts} from '../src/render/car.ts';
import {addTeslaCabin} from '../src/render/tesla-cabin.ts';

test('rear seat backs and head restraints remain at least 5 cm beneath the curved Highland glass',()=>{
  const parts=geometryParts(),add=parts.add,captured=[];
  // Capture the actual individual meshes before material merging, so the
  // seats can be checked independently of the rubber floor and other trim.
  parts.add=(surface,geometry)=>{
    captured.push({surface,geometry:geometry.clone()});
    add(surface,geometry);
  };
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  try{
    addTeslaCabin(parts);
    const glass=captured.filter(part=>part.surface==='cabinGlass')
      .map(part=>new THREE.Mesh(part.geometry,material));
    const rearSeats=captured.filter(({surface,geometry})=>{
      geometry.computeBoundingBox();
      const bounds=geometry.boundingBox;
      return surface==='rubber'&&bounds.max.z<-.95&&bounds.max.y>.39;
    });
    assert.ok(rearSeats.length>=4,'check the rear backrest and all three head restraints');
    const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
    let checked=0;
    for(const {geometry} of rearSeats){
      const positions=geometry.getAttribute('position');
      for(let i=0;i<positions.count;i++){
        const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
        if(y<.35)continue;
        ray.set(new THREE.Vector3(x,2,z),down);
        const hit=ray.intersectObjects(glass,false)[0];
        assert.ok(hit,`rear seat vertex (${x}, ${y}, ${z}) must be inside the glazed cabin`);
        const clearance=hit.point.y-y;
        assert.ok(clearance>=.05,`rear seat vertex (${x}, ${y}, ${z}) has only ${clearance.toFixed(4)} m of glass clearance`);
        checked++;
      }
    }
    assert.ok(checked>100,'sample the curved upholstery surfaces, not only seat centres');
  }finally{
    for(const {geometry} of captured)geometry.dispose();
    for(const geometry of parts.finish().values())geometry.dispose();
    material.dispose();
  }
});
