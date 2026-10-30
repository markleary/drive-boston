import RAPIER from '@dimforge/rapier3d-compat';
import { BikeDynamics, ULTRA_BEE } from './bike.ts';
import {closestRoad} from '../simulation/roads.ts';
import type { CityData, DriveInput, VehicleState } from '../types';
import { buildTerrainGeometryData, buildingBaseElevation, sampleElevation, sampleTerrainNormal, terrainGrid, rotationFromNormal } from '../simulation/terrain.ts';
import { roadSlabGeometry, bridgeBarriers, bridgeSupports, sampleDriveSurface, registerDriveSurface } from '../simulation/road-surfaces.ts';
import {footbridgeRoad} from '../simulation/footbridges.ts';
import {clipTunnelPortals,tunnelGeometry} from '../simulation/tunnels.ts';

export const VEHICLE = {
  mass: 1240,
  wheelRadius: 0.34,
  wheelbase: 2.66,
  track: 1.72,
  suspensionRest: 0.31,
  spawnHeight: 0.78,
  maxForwardSpeed: 27,
  maxReverseSpeed: 8,
  maxSteering: .52,
  maxLateralAcceleration: 8.5,
};

export const carSteeringLimit=(speed:number)=>Math.min(VEHICLE.maxSteering,Math.atan(VEHICLE.maxLateralAcceleration*VEHICLE.wheelbase/(speed*speed+16)));

export interface PhysicsVehicleState extends VehicleState {
  rotation: { x: number; y: number; z: number; w: number };
  wheelAngles: number[];
  suspension: number[];
  braking: boolean;
  gear: number;
  rpm: number;
  vehicle: 'car' | 'ultrabee';
  lean: number;
  wheelie: number;
  wheelieRemaining: number;
}

/** One hard knock on the player chassis: the velocity change of that physics
 * step beyond gravity (m/s), the speed before it, and the colliders touching
 * the chassis so the caller can tell a car from a bus, a wall or the ground. */
export interface Impact { severity: number; speed: number; colliders: number[]; }
/** Velocity change per step that counts as an impact rather than a bump. The
 * suspension cannot exceed about .7 m/s per step, so curbs stay silent. */
export const IMPACT_THRESHOLD = 1.2;
/** Crumple lever above the chassis contacts (m), share of the stopping torque applied, and its cap (N m s).
 * At 50 mph a head-on into a car lifts the tail about 45 degrees and an offset or side hit spins the car
 * 50 to 70; the cap keeps a full stop against a wall to a nose-stand rather than an end-over-end flip. */
export const CRASH_KICK = { lift: .35, scale: 2.2, limit: 18000 };

let initialization: Promise<void> | undefined;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Rapier owns all movement. The game loop supplies a fixed step, normally 1/60 s. */
export class DrivingPhysics {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  controller!: RAPIER.DynamicRayCastVehicleController;
  private bike?: BikeDynamics;
  get vehicleType(): 'car' | 'ultrabee' { return this.bike ? 'ultrabee' : 'car'; }
  readonly chassisCollider: RAPIER.Collider;
  /** Additional mesh/structure geometry used by flight's continuous sweeps. */
  readonly detailedColliders = new Set<number>();
  private readonly surfaceCleanup=new Map<number,()=>void>();
  readonly meshBuildingIds: ReadonlySet<string>;
  private steering = 0;
  private braking = false;
  private pedal = 0;
  private gear = 1;
  private rpm = 850;
  private rescue: {x:number;z:number;yaw:number;roadId?:string} = { x: 0, z: 0, yaw: 0 };
  private overturnedTime = 0;
  /** Ground colliders (whole-city trimesh or streamed tiles), so an impact can be classified. */
  readonly terrainColliders = new Set<number>();
  private impacts: Impact[] = [];
  /** Impacts recorded since the previous call; the caller plays their sounds. */
  takeImpacts() { const list = this.impacts; this.impacts = []; return list; }
  private readonly bounds: CityData['bounds'];
  private readonly city: CityData;

  static async create(city: CityData, options: { buildingColliders?: boolean; meshBuildingIds?:ReadonlySet<string>; streaming?: boolean } = {}) {
    initialization ??= RAPIER.init();
    await initialization;
    return new DrivingPhysics(city, options);
  }

  /** Streaming mode: terrain, decks and building hulls arrive per tile. */
  readonly streaming: boolean;
  private constructor(city: CityData, options: { buildingColliders?: boolean; meshBuildingIds?:ReadonlySet<string>; streaming?: boolean }) {
    this.bounds = city.bounds;
    this.city = city;
    this.meshBuildingIds = new Set([...(options.meshBuildingIds ?? []), ...city.buildings.filter(b => b.collision === 'mesh').map(b => b.id)]);
    this.streaming = !!options.streaming;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.integrationParameters.numSolverIterations = 8;
    const { minX, maxX, minZ, maxZ } = city.bounds;
    if (this.streaming) { /* tiles supply the ground */ } else if (terrainGrid(city)) {
      const raw = buildTerrainGeometryData(city), { vertices, indices } = clipTunnelPortals(city,raw.vertices,raw.indices);
      this.terrainColliders.add(this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
        .setFriction(1).setRestitution(0)).handle);
    } else if(city.roads?.some(r=>r.tunnel)){
      const raw=buildTerrainGeometryData(city),surface=clipTunnelPortals(city,raw.vertices,raw.indices);
      this.terrainColliders.add(this.world.createCollider(RAPIER.ColliderDesc.trimesh(surface.vertices,surface.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setRestitution(0)).handle);
    } else {
      this.terrainColliders.add(this.world.createCollider(RAPIER.ColliderDesc.cuboid((maxX - minX) / 2 + 40, 1, (maxZ - minZ) / 2 + 40)
        .setTranslation((minX + maxX) / 2, -1, (minZ + maxZ) / 2)
        .setFriction(1).setRestitution(0)).handle);
    }

    // Upper decks are closed solids, separate from the original terrain. Wheel
    // rays can support either level while underpass cars retain their own ground.
    for(const road of city.roads??[])if(!this.streaming||road.tunnel)this.addRoadDeck(city,road);
    if(!this.streaming)for(const path of city.parkPaths??[])this.addFootbridge(city,path);

    // Convex footprints are deliberately conservative collision proxies. Exact
    // static meshes can instead be supplied by the renderer with addStaticMesh.
    if (options.buildingColliders !== false && !this.streaming) for (const building of city.buildings) this.addBuildingHull(building);

    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(city.spawn.x, sampleElevation(city, city.spawn.x, city.spawn.z) + VEHICLE.spawnHeight, city.spawn.z)
      .setLinearDamping(0.13).setAngularDamping(1.6).setCcdEnabled(true).setCanSleep(false));
    this.chassisCollider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 0.23, 2.02)
      .setTranslation(0, -0.06, 0)
      .setMassProperties(VEHICLE.mass, { x: 0, y: -0.17, z: 0 }, { x: 2150, y: 2250, z: 720 }, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.3).setRestitution(0.05), this.body);

    this.configureCar();
    this.reset(city.spawn.x, city.spawn.z, city.spawn.yaw);
    // Initialize broad-phase queries before the first wheel raycast.
    this.world.step();
  }

  private configureCar() {
    this.chassisCollider.setShape(new RAPIER.Cuboid(.85, .23, 2.02));
    this.chassisCollider.setMassProperties(VEHICLE.mass, {x:0,y:-.17,z:0}, {x:2150,y:2250,z:720}, {x:0,y:0,z:0,w:1});
    this.body.setLinearDamping(.13); this.body.setAngularDamping(1.6);
    this.controller = this.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    // Front wheels first. The negative X axle gives positive engine force +Z.
    for (const z of [VEHICLE.wheelbase / 2, -VEHICLE.wheelbase / 2]) {
      for (const x of [-VEHICLE.track / 2, VEHICLE.track / 2]) {
        const i = this.controller.numWheels();
        this.controller.addWheel({ x, y: -0.08, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, VEHICLE.suspensionRest, VEHICLE.wheelRadius);
        this.controller.setWheelSuspensionStiffness(i, 32);
        this.controller.setWheelSuspensionCompression(i, 4.4);
        this.controller.setWheelSuspensionRelaxation(i, 5.2);
        this.controller.setWheelMaxSuspensionTravel(i, 0.16);
        this.controller.setWheelMaxSuspensionForce(i, 12500);
        this.controller.setWheelFrictionSlip(i, 1.5);
        this.controller.setWheelSideFrictionStiffness(i, 1.05);
      }
    }
  }

  setVehicleType(kind: 'car' | 'ultrabee') {
    if (kind === this.vehicleType) return;
    const state = this.getState();
    this.world.removeVehicleController(this.controller);
    this.bike = kind === 'ultrabee' ? new BikeDynamics(this.world, this.body, this.chassisCollider) : undefined;
    if (this.bike) this.controller = this.bike.controller; else this.configureCar();
    this.body.recomputeMassPropertiesFromColliders();
    this.reset(state.x, state.z, state.yaw, sampleDriveSurface(this.city,state.x,state.z,state.y).road?.id);
  }

  addStaticMesh(vertices: Float32Array, indices: Uint32Array) {
    return this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.5).setRestitution(0.04));
  }

  /** Ground for one streamed tile: the same trimesh flags as the whole-city collider. */
  addTerrainTile(vertices: Float32Array, indices: Uint32Array) {
    ({vertices,indices}=clipTunnelPortals(this.city,vertices,indices));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setRestitution(0));
    this.terrainColliders.add(collider.handle); return collider;
  }

  /** Same closed arched slab as the park renderer; tile disposal removes both
   * collision and the support used by saved positions / vehicle switches. */
  addFootbridge(city:CityData,path:NonNullable<CityData['parkPaths']>[number]){
    const road=footbridgeRoad(city,path);if(!road)return[];
    const slab=roadSlabGeometry(city,road),collider=this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(slab.vertices,slab.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setRestitution(0));
    this.surfaceCleanup.set(collider.handle,registerDriveSurface(this.city,road));
    return[collider];
  }

  /** Upper decks are closed solids, separate from the original terrain. Wheel
   * rays can support either level while underpass cars retain their own ground.
   * `city` may be a tile-local view so edge and support queries stay bounded. */
  addRoadDeck(city: CityData, road: CityData['roads'][number]) {
    const colliders: RAPIER.Collider[] = [];
    if (!road.elevations) return colliders;
    const slab = roadSlabGeometry(city, road);
    colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(slab.vertices, slab.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setRestitution(0)));
    if(road.tunnel){
      const shell=tunnelGeometry(city,road);
      for(const mesh of Object.values(shell))if(mesh.indices.length)colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices,mesh.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.5).setRestitution(.02)));
      return colliders;
    }
    for (const p of bridgeBarriers(city, road)) {
      // Same yaw/pitch transform as the visible parapet.
      const sx = Math.sin(-p.slope / 2), cx = Math.cos(-p.slope / 2), sy = Math.sin(p.yaw / 2), cy = Math.cos(p.yaw / 2);
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid(.135, .38, p.length / 2).setTranslation(p.x, p.y, p.z).setRotation({ x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx }).setFriction(.4)));
    }
    for (const p of bridgeSupports(city, road)) {
      const rotation={x:0,y:Math.sin(p.yaw/2),z:0,w:Math.cos(p.yaw/2)};
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid(.9, (p.top - p.bottom) / 2, 1.2).setTranslation(p.x, (p.top + p.bottom) / 2, p.z).setRotation(rotation).setFriction(.5)));
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid((p.width - .5) / 2, .275, 1.4).setTranslation(p.x, p.top - .28, p.z).setRotation(rotation).setFriction(.5)));
    }
    return colliders;
  }

  /** Convex footprint proxy, extended below the lowest terrain along the footprint
   * so hillside entries cannot pass through the visible wall under a level base. */
  addBuildingHull(building: CityData['buildings'][number]) {
    if (building.footprint.length < 3 || building.height < 0.5 || building.collision === 'mesh' || this.meshBuildingIds.has(building.id)) return undefined;
    const city = this.city, vertices: number[] = [], base = buildingBaseElevation(city, building);
    let bottom = Math.min(base, sampleElevation(city, building.center[0], building.center[1])) - .5;
    for (let i = 0; i < building.footprint.length; i++) {
      const a = building.footprint[i], b = building.footprint[(i + 1) % building.footprint.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      for (let j = 0; j <= steps; j++) bottom = Math.min(bottom, sampleElevation(city, a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps) - .5);
    }
    for (const [x, z] of building.footprint) vertices.push(x, bottom, z, x, base + Math.min(400, Math.max(2, building.height)), z);
    const descriptor = RAPIER.ColliderDesc.convexHull(new Float32Array(vertices));
    return descriptor ? this.world.createCollider(descriptor.setFriction(0.45).setRestitution(0.05)) : undefined;
  }

  /** Drop a streamed tile's colliders. Waking bodies lets a parked car settle on whatever replaces them. */
  removeColliders(colliders: Iterable<RAPIER.Collider>) {
    for (const collider of colliders) { this.surfaceCleanup.get(collider.handle)?.();this.surfaceCleanup.delete(collider.handle);this.detailedColliders.delete(collider.handle);this.terrainColliders.delete(collider.handle); this.world.removeCollider(collider, true); }
  }

  private addDetailedCollider(descriptor:RAPIER.ColliderDesc){
    const collider=this.world.createCollider(descriptor);this.detailedColliders.add(collider.handle);return collider;
  }

  step(input: DriveInput, dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const timestep = Math.min(dt, 1 / 30);
    this.world.timestep = timestep;
    const state = this.getState();
    if (this.bike) {
      this.bike.step(input, timestep, state.speed, state.yaw);
      this.steering=this.bike.steering;this.braking=this.bike.braking;this.gear=state.speed<-.3?-1:1;this.rpm=0;
    } else {
    const speed = state.speed;
    const throttle = clamp(input.throttle, -1, 1);
    const pedalBrake = clamp(input.brake, 0, 1);
    const changeDirection = throttle * speed < -0.4;
    this.braking = pedalBrake > 0.05 || input.handbrake || changeDirection;
    // Slightly tighter arcs at parking and road speeds; cap lateral demand near .87g.
    const steeringLimit = carSteeringLimit(speed);
    const desiredSteer = clamp(input.steer, -1, 1) * steeringLimit;
    this.steering += (desiredSteer - this.steering) * (1 - Math.exp(-8 * timestep));
    const speedLimit = throttle >= 0 ? VEHICLE.maxForwardSpeed : VEHICLE.maxReverseSpeed;
    const power = clamp(1 - Math.max(0, Math.abs(speed) - speedLimit * 0.7) / (speedLimit * 0.3), 0, 1);
    this.pedal += (throttle-this.pedal)*(1-Math.exp(-(Math.abs(throttle)>Math.abs(this.pedal)?22:14)*timestep));
    if(Math.abs(throttle)<.001&&Math.abs(this.pedal)<.005)this.pedal=0;
    const targetGear=Math.min(5,Math.max(1,1+Math.floor(Math.abs(speed)/7.5)));
    // Reverse input brakes a forward-moving car before selecting reverse.
    // Only select R while actually reversing or nearly stopped with reverse intent.
    this.gear=speed<-.3||(Math.abs(speed)<=.3&&throttle<-.1)?-1:targetGear;
    this.rpm=850+Math.abs(speed)/(this.gear<0?7.5:7.5*targetGear)*3000+Math.abs(this.pedal)*650;
    const tractiveForce=Math.min(8400,125000/Math.max(10,Math.abs(speed)));
    const force = changeDirection || pedalBrake > 0.1 || (input.handbrake&&Math.abs(throttle)<.05) ? 0 : this.pedal * tractiveForce/4 * power;
    // Wheel brake is an impulse, so scale it with the physics step, not render FPS.
    const brakingImpulse = (changeDirection ? 10000 : pedalBrake * 12500) * timestep / 4;
    const rollingImpulse = Math.abs(throttle) < 0.05 ? (90+Math.min(110,Math.abs(speed)*5))*timestep : 0;
    for (let i = 0; i < 4; i++) {
      const radius=VEHICLE.wheelbase/Math.tan(this.steering||1e-8);
      const ackermann=Math.atan(VEHICLE.wheelbase/(radius+(i%2===0?-1:1)*VEHICLE.track/2));
      this.controller.setWheelSteering(i, i < 2 ? ackermann : 0);
      // Rapier chooses engine force before wheel braking. A locked rear wheel
      // must receive exactly zero engine force, including decaying pedal input.
      this.controller.setWheelEngineForce(i, input.handbrake&&i>=2?0:force);
      this.controller.setWheelBrake(i, brakingImpulse*(i<2?1.2:.8) + rollingImpulse + (input.handbrake && i >= 2 ? 16000 * timestep / 2 : 0));
      const slidingTurn=input.handbrake&&Math.abs(input.steer)>.25&&Math.abs(speed)>3;
      this.controller.setWheelSideFrictionStiffness(i, slidingTurn && i >= 2 ? 0.45 : 1.05);
    }
    this.controller.updateVehicle(timestep, undefined, undefined, collider => collider.handle !== this.chassisCollider.handle);
    if(input.handbrake&&Math.abs(throttle)<.05&&Math.abs(speed)<.2&&this.controller.wheelIsInContact(2)&&this.controller.wheelIsInContact(3)){
      // At rest, the locked tires supply static friction against the component
      // of gravity along the road. Rapier's wheel impulse precedes world gravity;
      // compensate that next-step load rather than allowing continual hill creep.
      const normals=[0,1,2,3].filter(i=>this.controller.wheelIsInContact(i)).map(i=>this.controller.wheelContactNormal(i)!);
      const normal=normals.reduce((n,v)=>({x:n.x+v.x,y:n.y+v.y,z:n.z+v.z}),{x:0,y:0,z:0}),length=Math.hypot(normal.x,normal.y,normal.z);
      normal.x/=length;normal.y/=length;normal.z/=length;
      const velocity=this.body.linvel(),vn=velocity.x*normal.x+velocity.y*normal.y+velocity.z*normal.z;
      const tangent={x:velocity.x-vn*normal.x,y:velocity.y-vn*normal.y,z:velocity.z-vn*normal.z};
      if(normal.y>.5&&Math.hypot(tangent.x,tangent.y,tangent.z)<.25){
        const gravity=this.world.gravity,gn=gravity.x*normal.x+gravity.y*normal.y+gravity.z*normal.z,mass=this.body.mass();
        const impulse={x:-(tangent.x+(gravity.x-gn*normal.x)*timestep)*mass,y:-(tangent.y+(gravity.y-gn*normal.y)*timestep)*mass,z:-(tangent.z+(gravity.z-gn*normal.z)*timestep)*mass};
        const size=Math.hypot(impulse.x,impulse.y,impulse.z),limit=mass*9.81*.6*timestep,scale=Math.min(1,limit/(size||1));
        this.body.applyImpulse({x:impulse.x*scale,y:impulse.y*scale,z:impulse.z*scale},true);
      }
    }
    }
    const before = this.body.linvel(), speedBefore = Math.hypot(before.x, before.y, before.z), q0 = this.body.rotation();
    this.world.step();
    // A knock is a velocity change no tire or suspension force can produce in
    // one step. Record what the chassis touched so the sound matches the object.
    const after = this.body.linvel(), gravity = this.world.gravity;
    const severity = Math.hypot(after.x - before.x - gravity.x * timestep, after.y - before.y - gravity.y * timestep, after.z - before.z - gravity.z * timestep);
    if (severity >= IMPACT_THRESHOLD) {
      const colliders: number[] = []; let px = 0, py = 0, pz = 0, points = 0;
      this.world.contactPairsWith(this.chassisCollider, other => {
        colliders.push(other.handle);
        this.world.contactPair(this.chassisCollider, other, manifold => {
          for (let i = 0; i < manifold.numSolverContacts(); i++) { const c = manifold.solverContactPoint(i); if (c) { px += c.x; py += c.y; pz += c.z; points++; } }
        });
      });
      if (this.impacts.length < 8) this.impacts.push({ severity, speed: speedBefore, colliders });
      // The box chassis meets a flat wall across its whole face, so the solver
      // stops it dead without any rotation. A real body crumples above the
      // bumper, so the stopping force acts higher than the chassis contacts:
      // lift the lever toward the roof and apply the matching share of torque.
      // Frontal hits dip the nose and lift the tail, offset hits spin the car
      // and hard side hits can roll it. Vertical knocks (bottoming out on a
      // crest, landing a jump) keep Rapier's own response; the bike keeps its
      // rider balance.
      const horizontal = Math.hypot(after.x - before.x - gravity.x * timestep, after.z - before.z - gravity.z * timestep);
      if (!this.bike && points && horizontal >= 3) {
        const com = this.body.worldCom(), up = { x: 2 * (q0.x * q0.y - q0.w * q0.z), y: 1 - 2 * (q0.x * q0.x + q0.z * q0.z), z: 2 * (q0.y * q0.z + q0.w * q0.x) };
        const { lift, scale, limit } = CRASH_KICK, rx = px / points - com.x + up.x * lift, ry = py / points - com.y + up.y * lift, rz = pz / points - com.z + up.z * lift;
        const mass = this.body.mass(), jx = (after.x - before.x - gravity.x * timestep) * mass, jy = (after.y - before.y - gravity.y * timestep) * mass, jz = (after.z - before.z - gravity.z * timestep) * mass;
        let tx = (ry * jz - rz * jy) * scale, ty = (rz * jx - rx * jz) * scale, tz = (rx * jy - ry * jx) * scale;
        const size = Math.hypot(tx, ty, tz); if (size > limit) { tx *= limit / size; ty *= limit / size; tz *= limit / size; }
        this.body.applyTorqueImpulse({ x: tx, y: ty, z: tz }, true);
      }
    }

    const p = this.body.translation();
    const q = this.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    this.overturnedTime = upY < 0.2 ? this.overturnedTime + timestep : 0;
    if (!Number.isFinite(p.x + p.y + p.z) || p.y < sampleDriveSurface(this.city,p.x,p.z,p.y).height - 8 || this.overturnedTime > 2.5 ||
        p.x < this.bounds.minX - 24 || p.x > this.bounds.maxX + 24 ||
        p.z < this.bounds.minZ - 24 || p.z > this.bounds.maxZ + 24) {
      this.recoverFromCrash(p);
    }
  }

  /** An overturned, fallen or lost vehicle (car or bike) is set upright on the
   * nearest clear road at the crash's level; the last explicit reset point is
   * only the fallback when no local road qualifies. */
  private recoverFromCrash(position:{x:number;y:number;z:number}){
    const spawnHeight=this.bike?ULTRA_BEE.spawnHeight:VEHICLE.spawnHeight;
    if([position.x,position.y,position.z].every(Number.isFinite)&&this.city.roads?.length){
      const crashSurface=sampleDriveSurface(this.city,position.x,position.z,position.y);
      // Keep recovery inside the already-streamed neighborhood.
      const road=closestRoad(this.city,position.x,position.z,false,{height:position.y,maxDistance:200,accept:spot=>{
        if(spot.x<this.bounds.minX+1||spot.x>this.bounds.maxX-1||spot.z<this.bounds.minZ+1||spot.z>this.bounds.maxZ-1)return false;
        const surface=sampleDriveSurface(this.city,spot.x,spot.z,undefined,spot.road.id),n=surface.normal;
        // Level compatibility is a constraint, not a distance tradeoff. Compare
        // the candidate's support plane at the crash point so slopes still match.
        const level=surface.height-(n.x*(position.x-spot.x)+n.z*(position.z-spot.z))/Math.max(.5,n.y);
        if(Math.abs(level-crashSurface.height)>1.25)return false;
        const center={x:spot.x-.06*n.x,y:surface.height+spawnHeight/Math.max(.5,n.y)-.06*n.y,z:spot.z-.06*n.z};
        return !this.world.intersectionWithShape(center,rotationFromNormal(n,spot.yaw),this.chassisCollider.shape,undefined,undefined,this.chassisCollider,this.body);
      }});
      if(Number.isFinite(road.distance)){
        const yaw=road.road.oneway===0&&Math.cos(road.yaw-this.getState().yaw)<0?road.yaw+Math.PI:road.yaw;
        this.reset(road.x,road.z,yaw,road.road.id);return;
      }
    }
    this.reset(this.rescue.x,this.rescue.z,this.rescue.yaw,this.rescue.roadId);
  }

  getState(): PhysicsVehicleState {
    const p = this.body.translation();
    const q = this.body.rotation();
    const velocity = this.body.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    return {
      x: p.x, y: p.y, z: p.z,
      yaw: Math.atan2(fx, fz), speed: this.bike ? (velocity.x*fx+velocity.z*fz)/(Math.hypot(fx,fz)||1) : velocity.x * fx + velocity.y * fy + velocity.z * fz,
      steering: this.steering, rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
      wheelAngles: Array.from({length:this.controller.numWheels()}, (_,i) => this.controller.wheelRotation(i) ?? 0),
      suspension: Array.from({length:this.controller.numWheels()}, (_,i) => this.controller.wheelSuspensionLength(i) ?? VEHICLE.suspensionRest),
      braking: this.braking,gear:this.gear,rpm:this.rpm,vehicle:this.vehicleType,lean:this.bike?.lean??0,wheelie:this.bike?.wheelie??0,wheelieRemaining:this.bike?.wheelieRemaining??0,
    };
  }

  private resetPose(x:number,z:number,yaw:number,roadId?:string){
    const surface=sampleDriveSurface(this.city,x,z,undefined,roadId),normal=surface.normal;
    return{normal,position:{x,y:surface.height+(this.bike?ULTRA_BEE.spawnHeight:VEHICLE.spawnHeight)/Math.max(.5,normal.y),z},rotation:rotationFromNormal(normal,yaw)};
  }

  /** Check a saved arrival against loaded static geometry before moving the car.
   * Query each collider directly: newly streamed colliders are absent from
   * Rapier's broad phase until world.step(), which must not run inside a wall. */
  canResetAt(x:number,z:number,yaw:number,roadId?:string){
    if(![x,z,yaw].every(Number.isFinite))return false;
    const {position,rotation,normal}=this.resetPose(x,z,yaw,roadId),offset=this.chassisCollider.translationWrtParent()?.y??0;
    const center={x:position.x+normal.x*offset,y:position.y+normal.y*offset,z:position.z+normal.z*offset};
    let clear=true;
    this.world.forEachCollider(collider=>{
      if(!clear||collider.handle===this.chassisCollider.handle||collider.isSensor())return;
      const parent=collider.parent();if(parent&&!parent.isFixed())return;
      if(collider.intersectsShape(this.chassisCollider.shape,center,rotation))clear=false;
    });
    return clear;
  }

  reset(x: number, z: number, yaw: number, roadId?:string) {
    if (![x, z, yaw].every(Number.isFinite)) return;
    this.rescue = { x, z, yaw,roadId };
    const {position,rotation}=this.resetPose(x,z,yaw,roadId);
    this.body.setTranslation(position, true);
    this.body.setRotation(rotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.steering = 0;this.pedal=0;this.gear=1;this.rpm=850;
    this.overturnedTime = 0;this.braking=false;this.bike?.reset();
    for (let i = 0; i < this.controller.numWheels(); i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
    }
  }

  dispose() {
    for(const cleanup of this.surfaceCleanup.values())cleanup();this.surfaceCleanup.clear();
    this.world.free();
  }
}
