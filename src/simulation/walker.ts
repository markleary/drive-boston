import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { CityData } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { closestRoad } from './roads.ts';
import { buildingAt } from './city-tiles.ts';
import { isMotorway } from './motorway.ts';
import { sampleElevation } from './terrain.ts';
import { sampleDriveSurface, sampleVehicleSurface } from './road-surfaces.ts';
import { tunnelAt } from './tunnels.ts';
import { startKnock, stepKnock, struckBy, type KnockedDown, type KnockThreat } from './knockdown.ts';

/** Movement is relative to the view: `forward` away from the camera, `strafe` to its right, `turn` swings the view right. */
export interface WalkInput { forward:number; strafe:number; turn:number; run:boolean; jump:boolean; }
export interface WalkerState {
  /** Feet position. */
  x:number; y:number; z:number;
  /** Where the body faces, and where the camera looks. */
  yaw:number; viewYaw:number;
  /** Horizontal speed actually covered (m/s), so a walker pushing on a wall stands still. */
  speed:number; verticalSpeed:number; grounded:boolean;
  /** 0..1 blends for the model: running gait and being off the ground. */
  run:number; air:number;
  /** Metres walked on the ground since the last placement. */
  travelled:number;
  /** Set while knocked down by a vehicle. */
  knocked?:KnockedDown; sprawl:number;
}
export const WALKER = {
  height:1.76, radius:.3, walkSpeed:1.7, runSpeed:5.4, jumpSpeed:4.1, gravity:12,
  /** Highest curb or stair the walker steps onto without jumping. */
  stepHeight:.42, turnRate:2.4,
};
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const axis=(n:number)=>Number.isFinite(n)?clamp(n,-1,1):0;
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const ALL_GROUPS=0xffffffff,SKIN=.05;

/** The walker's speed for a stick deflection `amount` (0..1), running or not. */
export function walkSpeed(amount:number,run:boolean){return clamp(amount,0,1)*(run?WALKER.runSpeed:WALKER.walkSpeed);}

/** The sidewalk spot nearest (x, z): beside the closest surface street, on the walker's side of it
 * unless a building (or `blocked`) is in the way there, facing along the street the way `facing` leans. */
export function closestSidewalk(city:CityData,x:number,z:number,options:{height?:number;facing?:number;blocked?:(x:number,z:number)=>boolean}={}){
  let spot:{x:number;z:number;yaw:number;road:string}|undefined;
  closestRoad(city,x,z,false,{height:options.height,accept:p=>{
    if(p.road.tunnel||p.road.elevations||isMotorway(p.road))return false;
    // Right of the road's direction; the sidewalk band starts at the curb, half the measured roadway out.
    const rx=-Math.cos(p.yaw),rz=Math.sin(p.yaw),side=(x-p.x)*rx+(z-p.z)*rz>=0?1:-1,offset=(p.road.pavedWidth??p.road.width)/2+1.3;
    for(const s of [side,-side]){
      const sx=p.x+rx*offset*s,sz=p.z+rz*offset*s;
      if(buildingAt(city,sx,sz)||options.blocked?.(sx,sz))continue;
      spot={x:sx,z:sz,yaw:options.facing!==undefined&&Math.cos(options.facing-p.yaw)<0?wrap(p.yaw+Math.PI):p.yaw,road:p.road.name};return true;
    }
    return false;
  }});
  return spot;
}

/** The player on foot: a capsule moved by Rapier's character controller over the same colliders the
 * car drives on (terrain tiles, decks, buildings, parked and moving vehicles). The capsule itself is
 * disabled in the world, so no vehicle, wheel ray or camera query ever feels it; a vehicle that
 * reaches the walker at speed knocks them down instead, exactly as it does a sidewalk walker. */
export function createWalker(city:CityData,physics:DrivingPhysics){
  const world=physics.world,half=WALKER.height/2-WALKER.radius,centre=WALKER.height/2;
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider=world.createCollider(RAPIER.ColliderDesc.capsule(half,WALKER.radius),body);collider.setEnabled(false);
  // A 5 cm skin: with a thinner one this controller creeps into flat ground over a few seconds.
  const controller=world.createCharacterController(SKIN);
  controller.enableAutostep(WALKER.stepHeight,.15,false);controller.enableSnapToGround(.35);
  controller.setMaxSlopeClimbAngle(50*Math.PI/180);controller.setMinSlopeSlideAngle(56*Math.PI/180);
  // A slimmer, raised probe for "may I stand here": it must not touch the ground the walker stands on.
  const probe=new RAPIER.Capsule(.42,.26),upright={x:0,y:0,z:0,w:1};
  const state:WalkerState={x:city.spawn.x,y:sampleElevation(city,city.spawn.x,city.spawn.z),z:city.spawn.z,yaw:city.spawn.yaw,viewYaw:city.spawn.yaw,speed:0,verticalSpeed:0,grounded:true,run:0,air:0,travelled:0,sprawl:0};
  const feet=new THREE.Vector3(),down=new RAPIER.Ray({x:0,y:0,z:0},{x:0,y:-1,z:0});
  const STATIC_ONLY=RAPIER.QueryFilterFlags.EXCLUDE_SENSORS|RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC|RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
  let vx=0,vz=0,jumpHeld=false,coyote=0,falling=0,settle=0;
  const groundAt=(x:number,z:number,y:number)=>sampleDriveSurface(city,x,z,y).height;
  /** No loaded collider overlaps a standing body with its feet at (x, y, z). */
  function clearAt(x:number,y:number,z:number){
    let clear=true;
    // Query each collider directly: newly streamed ones are absent from the broad phase until the next step.
    world.forEachCollider(c=>{if(clear&&c.isEnabled()&&!c.isSensor()&&c.intersectsShape(probe,{x,y:y+1.05,z},upright))clear=false;});
    return clear;
  }
  function place(x:number,y:number,z:number,yaw:number,viewYaw=yaw){
    if(![x,y,z,yaw].every(Number.isFinite))return;
    Object.assign(state,{x,y,z,yaw:wrap(yaw),viewYaw:wrap(viewYaw),speed:0,verticalSpeed:0,grounded:true,run:0,air:0,travelled:0,knocked:undefined,sprawl:0});
    vx=vz=0;coyote=falling=0;settle=2;
    body.setTranslation({x,y:y+centre+SKIN,z},true);body.setNextKinematicTranslation({x,y:y+centre+SKIN,z});
  }
  /** Back on the closest sidewalk, as after getting stuck. False when no street is in reach. */
  function resetToSidewalk(x=state.x,z=state.z){
    const options={facing:state.yaw,blocked:(sx:number,sz:number)=>!clearAt(sx,sampleElevation(city,sx,sz),sz)};
    // A spot under an overpass or beside a parked car may be taken; an occupied one still beats none.
    const spot=closestSidewalk(city,x,z,options)??closestSidewalk(city,x,z,{facing:state.yaw});
    if(!spot)return false;
    place(spot.x,sampleElevation(city,spot.x,spot.z),spot.z,spot.yaw);return true;
  }
  /** Step out beside a vehicle: the driver's side first, then the other, behind and ahead; else the nearest sidewalk. */
  function placeBeside(vehicle:{x:number;y:number;z:number;yaw:number;halfWidth:number;halfLength:number}){
    const fx=Math.sin(vehicle.yaw),fz=Math.cos(vehicle.yaw),lx=Math.cos(vehicle.yaw),lz=-Math.sin(vehicle.yaw),out=vehicle.halfWidth+.75,along=vehicle.halfLength+.8;
    for(const [dx,dz] of [[lx*out,lz*out],[-lx*out,-lz*out],[-fx*along,-fz*along],[fx*along,fz*along]]){
      const x=vehicle.x+dx,z=vehicle.z+dz,y=sampleVehicleSurface(city,x,z,vehicle.y+.3).height;
      if(Math.abs(y-vehicle.y)<1.6&&clearAt(x,y,z)){place(x,y,z,vehicle.yaw);return;}
    }
    if(!resetToSidewalk(vehicle.x,vehicle.z))place(vehicle.x,vehicle.y+1.2,vehicle.z,vehicle.yaw);
  }
  /** Knock the walker down if one of the moving vehicles has reached them. Returns the vehicle's speed (m/s) on a hit. */
  function strike(threats:readonly KnockThreat[]){
    if(state.knocked)return undefined;
    for(const threat of threats){
      const across=struckBy(state.x,state.y+.5,state.z,threat,WALKER.radius);if(across===undefined)continue;
      state.knocked=startKnock(state,state.yaw,1,threat,across,Math.random);state.sprawl=1;state.speed=0;state.run=0;state.air=0;vx=vz=0;
      return Math.abs(threat.speed??0);
    }
    return undefined;
  }
  function update(dt:number,input:WalkInput,firstPerson=false){
    if(!Number.isFinite(dt)||dt<=0)return;
    dt=Math.min(dt,1/30);
    const k=state.knocked;
    if(k){
      const step=stepKnock(k,dt,1,(x,z)=>groundAt(x,z,k.hip.y+.2),()=>state.yaw,Math.random,feet);
      state.x=feet.x;state.y=feet.y;state.z=feet.z;state.sprawl=step.sprawl;state.speed=0;
      if(step.done){const yaw=state.yaw,view=state.viewYaw;place(k.hip.x,step.ground,k.hip.z,yaw,view);}
      return;
    }
    const forward=axis(input.forward),strafe=axis(input.strafe),amount=Math.min(1,Math.hypot(forward,strafe));
    // Behind the walker, strafing swings the view after them, so the keyboard alone walks an arc.
    state.viewYaw=wrap(state.viewYaw-(axis(input.turn)*WALKER.turnRate+(firstPerson?0:strafe*.9*Math.min(1,state.speed/WALKER.walkSpeed)))*dt);
    const sin=Math.sin(state.viewYaw),cos=Math.cos(state.viewYaw),top=walkSpeed(amount,input.run)/(amount||1);
    const wantX=(sin*forward-cos*strafe)*top,wantZ=(cos*forward+sin*strafe)*top;
    const grip=1-Math.exp(-(state.grounded?12:2.5)*dt);vx+=(wantX-vx)*grip;vz+=(wantZ-vz)*grip;
    coyote=state.grounded?.12:Math.max(0,coyote-dt);
    if(input.jump&&!jumpHeld&&coyote>0&&settle===0){state.verticalSpeed=WALKER.jumpSpeed;state.grounded=false;coyote=0;}
    jumpHeld=input.jump;
    // On the ground a slight press keeps contact and lets the controller step up curbs and snap down slopes.
    if(state.grounded)state.verticalSpeed=-.3;else state.verticalSpeed=Math.max(-40,state.verticalSpeed-WALKER.gravity*dt);
    let mx=0,my=0,mz=0;
    if(settle>0)settle--;
    else{
      // A filter flag, not a predicate: a predicate that asks the collider set anything re-enters the borrow this query holds.
      controller.computeColliderMovement(collider,{x:vx*dt,y:state.verticalSpeed*dt,z:vz*dt},RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,ALL_GROUPS);
      const moved=controller.computedMovement();mx=moved.x;my=moved.y;mz=moved.z;
      const rising=state.verticalSpeed>0;
      // A jump that meets a ceiling stops rising; a fall that meets the ground lands.
      if(rising&&my<state.verticalSpeed*dt*.5)state.verticalSpeed=0;
      state.grounded=!rising&&controller.computedGrounded();
    }
    state.x+=mx;state.y+=my;state.z+=mz;
    // Whatever the controller allowed, the feet never end a step below the fixed surface under the body's middle.
    if(state.verticalSpeed<=0){
      down.origin.x=state.x;down.origin.y=state.y+centre;down.origin.z=state.z;
      const floor=world.castRay(down,centre,false,STATIC_ONLY,ALL_GROUPS);
      if(floor&&floor.timeOfImpact<centre-.005){state.y+=centre-floor.timeOfImpact;state.grounded=true;}
    }
    const covered=Math.hypot(mx,mz);state.speed=covered/dt;if(state.grounded)state.travelled+=covered;
    // Below the terrain with no tunnel around is a hole in the loaded world, not a place to be.
    const ground=sampleElevation(city,state.x,state.z);
    if(state.y<ground-3&&!tunnelAt(city,state.x,state.z,state.y)){state.y=ground+.05;state.verticalSpeed=0;}
    falling=state.grounded?0:falling+dt;
    if(falling>6&&!resetToSidewalk()){state.y=ground+.05;falling=0;}
    if(firstPerson)state.yaw=state.viewYaw;
    else if(Math.hypot(wantX,wantZ)>.2)state.yaw=wrap(state.yaw+wrap(Math.atan2(wantX,wantZ)-state.yaw)*(1-Math.exp(-11*dt)));
    state.run+=(clamp((state.speed-1)/(WALKER.runSpeed-.4-1),0,1)-state.run)*(1-Math.exp(-8*dt));
    state.air+=((state.grounded?0:1)-state.air)*(1-Math.exp(-(state.grounded?14:9)*dt));
    body.setNextKinematicTranslation({x:state.x,y:state.y+centre+SKIN,z:state.z});
  }
  return {
    state,update,place,placeBeside,resetToSidewalk,strike,clearAt,
    /** The walker as traffic sees it: a small slow obstacle in the lane. */
    obstacle:()=>({x:state.x,y:state.y+.4,z:state.z,halfLength:.4,halfWidth:.4,speed:0,yaw:state.yaw}),
    dispose(){world.removeCharacterController(controller);world.removeRigidBody(body);},
  };
}
