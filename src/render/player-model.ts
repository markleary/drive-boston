import * as THREE from 'three';
import { createPedestrianModel, strideScale, type PedestrianAppearance } from './pedestrian-model';
import { WALKER, type WalkerState } from '../simulation/walker';

/** The player on foot: the sidewalk walkers' tailored figure, one instance of it, in the player's own
 * clothes, posed from the walker's motion (walk, run, jump, and the limp tumble after a knock-down). */
export function createPlayerModel(scene:THREE.Scene){
  const group=new THREE.Group();group.name='PlayerOnFoot';scene.add(group);
  const materials=new Set<THREE.Material>();
  // The model's standing figure is 1.74 units tall at height 1.
  const person:PedestrianAppearance={id:0,position:new THREE.Vector3(),yaw:0,height:WALKER.height/1.74,width:1,speed:WALKER.walkSpeed,bag:false,scarf:false,outfit:0,
    look:{coat:0x9a3b2e,trousers:0x27384d,shoes:0xd9d6cc,soles:0xf1efe6,skin:0xc39976,hair:0x3a2c22,shirt:0x6f2a21}};
  const model=createPedestrianModel(group,[person],materials,{closeUp:true});
  let strides=0,travelled=0,gaze=0,footfalls=0,heard=0;
  return {group,
    update(state:WalkerState,dt:number){
      // Advance the gait by the ground covered, in strides of the current length, so the planted foot does not slide when the pace changes.
      const moved=state.travelled-travelled;travelled=state.travelled;
      if(moved>0&&moved<2)strides+=moved/strideScale(state.run);
      // Two footfalls to a gait cycle.
      footfalls=Math.floor(strides/(1.12*person.height)*2);
      person.position.set(state.x,state.y+.02,state.z);person.yaw=state.yaw;person.run=state.run;person.air=state.air;
      person.orientation=state.knocked?.orientation;person.sprawl=state.sprawl;
      // The head leads the body toward where the player is looking.
      const look=Math.atan2(Math.sin(state.viewYaw-state.yaw),Math.cos(state.viewYaw-state.yaw));
      gaze+=(THREE.MathUtils.clamp(Math.abs(look)>2.2?0:look,-.75,.75)-gaze)*(1-Math.exp(-6*Math.max(0,dt)));person.gaze=gaze;
      model.pose(0,person,strides,state.knocked?0:Math.min(1,state.speed/1.1),dt,true);model.flush();
    },
    /** Footfalls since the previous call, for their sound. */
    takeSteps(){const steps=Math.min(2,Math.max(0,footfalls-heard));heard=footfalls;return steps;},
    dispose(){
      model.dispose();group.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.dispose();});
      materials.forEach(material=>material.dispose());scene.remove(group);
    }};
}
