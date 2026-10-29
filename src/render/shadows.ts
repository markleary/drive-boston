import * as THREE from 'three';

/** Cover the detailed city out to the fog line during high-quality flight.
 * Moving the light back is essential: widening only the orthographic bounds
 * leaves part of that ground behind the shadow camera's near plane. */
export function updateSunShadow(sun:THREE.DirectionalLight,position:THREE.Vector3,groundY:number,direction:THREE.Vector3,flightShadows=false){
  const altitude=Math.max(0,position.y-groundY);
  const extent=flightShadows?1100:Math.max(105,Math.min(330,105+altitude*.72));
  const far=flightShadows?3600:1100;
  sun.target.position.set(position.x,groundY,position.z);
  sun.position.copy(direction);
  if(flightShadows)sun.position.setLength(1800);
  sun.position.add(sun.target.position);
  const camera=sun.shadow.camera;
  if(Math.abs(camera.right-extent)>2||camera.far!==far){
    camera.left=camera.bottom=-extent;camera.right=camera.top=extent;camera.far=far;
    camera.updateProjectionMatrix();
  }
}
