import RAPIER from '@dimforge/rapier3d-compat';
import {NPC_BODY_LIFT,type NPCVehicleSpec} from '../simulation/npc-vehicle-specs.ts';

/** A compound rigid body: shaped lower body, cabin, and tires. Rapier computes
 * its center of mass and angular inertia from these explicit mass shares. */
export function createNPCVehicleColliders(world:RAPIER.World,body:RAPIER.RigidBody,spec:NPCVehicleSpec){
  const parts:{shape:RAPIER.ColliderDesc;share:number}[]=[],w=spec.width/2,l=spec.length/2;
  const box=(half:[number,number,number],center:[number,number,number],share:number)=>parts.push({shape:RAPIER.ColliderDesc.cuboid(...half).setTranslation(center[0],center[1]-NPC_BODY_LIFT,center[2]),share});
  const hull=(rings:{z:number;y:number;width:number}[],bottom:number,share:number)=>{
    const points:number[]=[];
    // Keep the rocker/bumper collision faces vertical. Tapering the lower
    // edge into the floor creates a ramp that launches cars during side hits.
    for(const p of rings)for(const side of [-1,1]){points.push(side*p.width,p.y-NPC_BODY_LIFT,p.z);points.push(side*p.width,bottom-NPC_BODY_LIFT,p.z);}
    const shape=RAPIER.ColliderDesc.convexHull(new Float32Array(points));if(!shape)throw new Error(`Invalid NPC collider: ${spec.type}`);parts.push({shape,share});
  };
  if(spec.type==='box'){
    box([.74,.15,3.16],[0,.51,0],.14);
    hull([{z:.40,y:1.15,width:w*.91},{z:2.9,y:1.03,width:w*.86},{z:l-.04,y:.92,width:w*.82}],.35,.36);
    hull([{z:.45,y:1.15,width:w*.86},{z:spec.rearRoof,y:spec.height-1.10,width:w*.77},{z:spec.frontRoof,y:2.02,width:w*.77},{z:spec.frontGlass,y:1.2,width:w*.86}],1.1,.19);
    box([1.075,1.215,1.85],[0,1.91,-1.44],.27);
  }else{
    hull([{z:-l+.06,y:spec.belt-.08,width:w*.91},{z:spec.rearAxle,y:spec.belt,width:w*.97},{z:spec.frontAxle,y:spec.belt-.02,width:w*.97},{z:l-.06,y:spec.belt-.18,width:w*.89}],.24,.69);
    hull([{z:spec.rearGlass,y:spec.belt+.02,width:w*.89},{z:spec.rearRoof,y:spec.height-.05,width:w*.75},{z:spec.frontRoof,y:spec.height-.05,width:w*.75},{z:spec.frontGlass,y:spec.belt+.02,width:w*.89}],spec.belt-.02,.25);
    const top=spec.type==='pickup'?.82:spec.belt-.10;
    for(const side of [-1,1])box([w*.84,(top-.34)/2,.09],[0,(top+.34)/2,side*(l-.075)],.01);
  }
  // Cylinders lie across the axle. Their contact patches support the body on
  // the rendered tires rather than a sedan-sized box scraping along the road.
  for(const z of [spec.frontAxle,spec.rearAxle])for(const side of [-1,1]){
    const shape=RAPIER.ColliderDesc.cylinder(spec.type==='pickup'?.13:.1125,spec.wheelRadius)
      .setRotation({x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2})
      .setTranslation(side*(spec.width/2-.14),spec.wheelRadius-NPC_BODY_LIFT,z);
    parts.push({shape,share:.01});
  }
  const sum=parts.reduce((n,p)=>n+p.share,0);
  const colliders=parts.map(p=>world.createCollider(p.shape.setMass(spec.mass*p.share/sum).setFriction(.5).setRestitution(.04),body));
  body.enableCcd(true);body.recomputeMassPropertiesFromColliders();
  return colliders;
}
