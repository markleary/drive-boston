import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_CAR, PLAYER_CARS, CAR_POWERTRAINS, HARBOR_DRIVE, ENGINES, MOVING_TRUCK, isPerformanceCar, isElectricCar, carGear, carRpm, roadLoad, engineBrakeForce, type PlayerCarId } from '../simulation/player-cars.ts';
import { wrxBoost, wrxGearing, wrxTorque } from '../simulation/wrx-powertrain.ts';
import { GT2, gt2Boost, gt2Downforce, gt2Gearing, gt2Torque } from '../simulation/gt2-powertrain.ts';
import {lowClearanceAt} from '../simulation/low-clearance.ts';
import {storrowRecoveryCandidates,storrowRetreatCandidates,storrowSolidRecoveryPlan,type StorrowRecoveryPlan} from '../simulation/storrow-recovery.ts';
import { BikeDynamics, ULTRA_BEE } from './bike.ts';
import {closestRoad,pointInside} from '../simulation/roads.ts';
import {parkRecoveryCandidates} from '../simulation/park-recovery.ts';
import type { CityData, DriveInput, ParkPath, Point2, VehicleState } from '../types';
import { buildTerrainGeometryData, buildingBaseElevation, sampleElevation, sampleTerrainNormal, terrainGrid, rotationFromNormal } from '../simulation/terrain.ts';
import { roadSlabGeometry, bridgeBarriers, bridgeSupports, sampleDriveSurface, sampleVehicleSurface, registerDriveSurface, registerPlayingField, closedEndBarriers, JERSEY } from '../simulation/road-surfaces.ts';
import {footbridgeRoad,footbridgeSupports,FOOTBRIDGE_COLUMN} from '../simulation/footbridges.ts';
import {medianBarriers,medianBarrierBoxes} from '../simulation/median-barriers.ts';
import {clipTunnelPortals,tunnelGeometry} from '../simulation/tunnels.ts';
import {tireSlipIntensity,type TireContact} from '../simulation/tire-tracks.ts';

export const VEHICLE = PLAYER_CARS[DEFAULT_CAR];
/** `grip` is the share by which aerodynamic load raises what the tyres hold (1 without any). */
export const carSteeringLimit=(speed:number,spec:typeof PLAYER_CARS[PlayerCarId]=VEHICLE,grip=1)=>Math.min(spec.maxSteering,Math.atan(spec.maxLateralAcceleration*grip*spec.wheelbase/(speed*speed+16)));

interface VehicleMotion extends VehicleState {
  rotation: { x: number; y: number; z: number; w: number };
  halfLength: number;
  halfWidth: number;
}

export interface PhysicsVehicleState extends VehicleMotion {
  wheelAngles: number[];
  suspension: number[];
  braking: boolean;
  gear: number;
  rpm: number;
  /** Manifold pressure above atmosphere of a turbocharged car with a boost model (WRX, GT2 Stradale), normalized to full boost. */
  turboBoost: number;
  /** 0 to 1: how hard the rear tyres are spinning under power or sliding sideways (smoke, marks and squeal). */
  wheelspin: number;
  vehicle: 'car' | 'ultrabee';
  carId: PlayerCarId;
  lean: number;
  wheelie: number;
  wheelieRemaining: number;
  storrowDamage: number;
  storrowDirection: number;
  storrowed: boolean;
}

/** One hard knock on the player chassis: the velocity change of that physics
 * step beyond gravity (m/s), the speed before it, and the colliders touching
 * the chassis so the caller can tell a car from a bus, a wall or the ground. */
export interface Impact { severity: number; speed: number; colliders: number[]; }
export interface StorrowStrike { severity:number; direction:number; }
/** Velocity change per step that counts as an impact rather than a bump. The
 * suspension cannot exceed about .7 m/s per step, so curbs stay silent. */
export const IMPACT_THRESHOLD = 1.2;
/** Crumple lever above the chassis contacts (m), share of the stopping torque applied, and its cap (N m s).
 * At 50 mph a head-on into a car lifts the tail about 45 degrees and an offset or side hit spins the car
 * 50 to 70; the cap keeps a full stop against a wall to a nose-stand rather than an end-over-end flip. */
export const CRASH_KICK = { lift: .35, scale: 2.2, limit: 18000 };

/** Lift-off regeneration of the electric car: 0.21 g with its road load at town speeds, as coast-down tests of the
 * Model 3 measure it (SAE 2020-01-0883), held down to `walk` (m/s) and eased from there to `ease` of it at rest. */
export const REGEN = { force: 3550, walk: 1.5, ease: .35 };
/** Rear tyres that have let go. `stick` (m/s): a locked wheel slower than this is held by the controller's brake.
 * `grip` (m/s): the sliding speed at which a tyre is giving all it has; below it the pull falls away in proportion,
 * and a rolling tyre sliding slower than this goes back to the controller's own tyre model. */
export const SLIDE = { stick: .5, grip: .45 };
/** Wheelspin under power: the treads outrun the road by as much as the engine's power can drive them against their
 * sliding grip, up to `limit` m/s at full pedal, building at `rise` and dying away at `fall` (1/s). Full throttle
 * therefore tightens a slide into a donut, and part throttle holds a shallower angle. */
export const SPIN = { limit: 30, rise: 10, fall: 6 };
type Vector = { x: number; y: number; z: number };
/** A rear tyre's contact: wheel index, point, load (N), unit directions along and across the wheel in the road's plane, and the patch's velocity along each. */
interface RearPatch { i: number; p: Vector; load: number; along: Vector; side: Vector; forward: number; sideways: number; }

let initialization: Promise<void> | undefined;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

interface PhysicsOptions {
  buildingColliders?: boolean;
  meshBuildingIds?: ReadonlySet<string>;
  streaming?: boolean;
  /** The mobile tile builder installs tunnel shells with their road owners. */
  streamTunnels?: boolean;
}

/** Rapier owns all movement. The game loop supplies a fixed step, normally 1/60 s. */
export class DrivingPhysics {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  controller!: RAPIER.DynamicRayCastVehicleController;
  private bike?: BikeDynamics;
  private selectedCar: PlayerCarId = DEFAULT_CAR;
  get carId(){return this.selectedCar;}
  private get carSpec(){return PLAYER_CARS[this.selectedCar];}
  private shiftRemaining=0;
  private turboBoost=0;
  get vehicleType(): 'car' | 'ultrabee' { return this.bike ? 'ultrabee' : 'car'; }
  readonly chassisCollider: RAPIER.Collider;
  private truckColliders:RAPIER.Collider[]=[];
  private cargoCollider?:RAPIER.Collider;
  private storrow?:StorrowRecoveryPlan&{damage:number;direction:number;elapsed:number;anchor?:RAPIER.RigidBody;};
  private storrowStrikes:StorrowStrike[]=[];
  private truckApproachSpeed=0;
  private truckApproachAge=0;
  takeStorrowStrikes(){const events=this.storrowStrikes;this.storrowStrikes=[];return events;}
  /** Additional mesh/structure geometry used by flight's continuous sweeps. */
  readonly detailedColliders = new Set<number>();
  private readonly surfaceCleanup=new Map<number,()=>void>();
  private readonly parkPathGroups=new Set<{paths:readonly ParkPath[]}>();
  readonly meshBuildingIds: ReadonlySet<string>;
  private steering = 0;
  private braking = false;
  private pedal = 0;
  /** Free engine speed while the handbrake holds the clutch open (rpm). */
  private revs = 0;
  /** Speed of the rear treads over the road speed while they spin under power (m/s), and whether traction is given up to it. */
  private slip = 0;
  private loose = false;
  /** The rear axle is on the sliding tyre model (locked, spinning or sliding sideways). */
  private sliding = false;
  /** The electric car's Hold: stopped on the friction brakes with the pedal released. */
  private held = false;
  private handbrakeHeld = false;
  private wheelspin = 0;
  private wheelTurn = [0, 0, 0, 0];
  private wheelSeen = [0, 0, 0, 0];
  private gear = 1;
  private rpm = 850;
  private rescue: {x:number;z:number;yaw:number;roadId?:string} = { x: 0, z: 0, yaw: 0 };
  private overturnedTime = 0;
  /** Ground colliders (whole-city trimesh or streamed tiles), so an impact can be classified. */
  readonly terrainColliders = new Set<number>();
  private impacts: Impact[] = [];
  /** Break visual tire trails across resets, travel and vehicle changes. */
  poseRevision=0;
  /** Impacts recorded since the previous call; the caller plays their sounds. */
  takeImpacts() { const list = this.impacts; this.impacts = []; return list; }
  private readonly bounds: CityData['bounds'];
  private readonly city: CityData;

  static async create(city: CityData, options: PhysicsOptions = {}) {
    initialization ??= RAPIER.init();
    await initialization;
    return new DrivingPhysics(city, options);
  }

  /** Streaming mode: terrain, decks and building hulls arrive per tile. */
  readonly streaming: boolean;
  readonly streamsTunnels: boolean;
  private constructor(city: CityData, options: PhysicsOptions) {
    this.bounds = city.bounds;
    this.city = city;
    this.meshBuildingIds = new Set([...(options.meshBuildingIds ?? []), ...city.buildings.filter(b => b.collision === 'mesh').map(b => b.id)]);
    this.streaming = !!options.streaming;
    this.streamsTunnels = this.streaming && !!options.streamTunnels;
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
    for(const road of city.roads??[])if(!this.streaming||(road.tunnel&&!this.streamsTunnels))this.addRoadDeck(city,road);
    if(!this.streaming){
      for(const path of city.parkPaths??[])this.addFootbridge(city,path);
      this.registerParkPaths(city.parkPaths??[]);
    }

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
    const spec=this.carSpec,id=this.selectedCar,performance=isPerformanceCar(id),drive=performance?CAR_POWERTRAINS[id]:null;
    this.clearTruckBody();
    // The GT2 Stradale's nose overhangs its front axle by more than its tail the rear one.
    this.chassisCollider.setTranslationWrtParent({x:0,y:-.06,z:id==='maserati-gt2-stradale'?(GT2.overhang[0]-GT2.overhang[1])/2:0});
    this.chassisCollider.setShape(new RAPIER.Cuboid(spec.halfWidth, performance?.19:.23, spec.halfLength));
    this.chassisCollider.setMassProperties(spec.mass, {x:0,y:isElectricCar(id)?-.24:performance?-.15:-.17,z:drive?.cgZ??0}, id==='mclaren-gt'?{x:2500,y:2850,z:750}:performance?{x:spec.mass*1.63,y:spec.mass*1.86,z:spec.mass*.49}:{x:2150,y:2250,z:720}, {x:0,y:0,z:0,w:1});
    this.body.setLinearDamping(spec.linearDamping); this.body.setAngularDamping(1.6);
    if(id==='moving-truck'){
      const chassis=MOVING_TRUCK.chassis;
      this.chassisCollider.setTranslationWrtParent(chassis.center);
      this.chassisCollider.setShape(new RAPIER.Cuboid(chassis.halfExtents.x,chassis.halfExtents.y,chassis.halfExtents.z));
      // A loaded cargo body carries its centre of mass above the frame. The
      // larger inertia resists twitchy yaw while allowing suspension pitch/roll.
      this.chassisCollider.setMassProperties(spec.mass,{x:0,y:.38,z:-.55},{x:spec.mass*5.2,y:spec.mass*5.5,z:spec.mass*1.25},{x:0,y:0,z:0,w:1});
      for(const part of [MOVING_TRUCK.cab,MOVING_TRUCK.cargo]){
        const h=part.halfExtents,c=part.center;
        const collider=this.world.createCollider(RAPIER.ColliderDesc.cuboid(h.x,h.y,h.z).setTranslation(c.x,c.y,c.z).setMass(0).setFriction(.65).setRestitution(.015),this.body);
        this.truckColliders.push(collider);
      }
      this.cargoCollider=this.truckColliders[1];
      this.body.setAngularDamping(2.1);
    }
    this.controller = this.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    // Front wheels first. The negative X axle gives positive engine force +Z.
    for (const z of [spec.wheelbase / 2, -spec.wheelbase / 2]) {
      for (const x of [-(z>0?spec.track:spec.rearTrack)/2,(z>0?spec.track:spec.rearTrack)/2]) {
        const i = this.controller.numWheels();
        this.controller.addWheel({ x, y: -0.08, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspensionRest, z>0?spec.wheelRadius:spec.rearWheelRadius);
        this.controller.setWheelSuspensionStiffness(i, spec.stiffness);
        this.controller.setWheelSuspensionCompression(i, spec.compression);
        this.controller.setWheelSuspensionRelaxation(i, spec.relaxation);
        this.controller.setWheelMaxSuspensionTravel(i, spec.travel);
        this.controller.setWheelMaxSuspensionForce(i, id==='moving-truck'?48000:12500);
        this.controller.setWheelFrictionSlip(i, spec.friction);
        this.controller.setWheelSideFrictionStiffness(i, 1.05);
      }
    }
  }

  /** Switching cars parks the chassis upright on its current drive surface.
   * Bike/flight retain the selection for the next time Drive is chosen. */
  setCar(id:PlayerCarId){
    if(id===this.selectedCar)return;
    this.selectedCar=id;
    if(this.bike)return;
    const state=this.getMotionState(),surface=sampleVehicleSurface(this.city,state.x,state.z,state.y);
    this.world.removeVehicleController(this.controller);this.configureCar();
    this.body.recomputeMassPropertiesFromColliders();
    if(this.canResetAt(state.x,state.z,state.yaw,surface.road?.id))this.reset(state.x,state.z,state.yaw,surface.road?.id);
    else this.recoverFromCrash(state);
  }

  setVehicleType(kind: 'car' | 'ultrabee') {
    if (kind === this.vehicleType) return;
    const state = this.getMotionState();
    this.world.removeVehicleController(this.controller);
    this.clearTruckBody();
    this.bike = kind === 'ultrabee' ? new BikeDynamics(this.world, this.body, this.chassisCollider) : undefined;
    if (this.bike) this.controller = this.bike.controller; else this.configureCar();
    this.body.recomputeMassPropertiesFromColliders();
    const roadId=sampleVehicleSurface(this.city,state.x,state.z,state.y).road?.id;
    if(this.canResetAt(state.x,state.z,state.yaw,roadId))this.reset(state.x,state.z,state.yaw,roadId);
    else this.recoverFromCrash(state);
  }

  addStaticMesh(vertices: Float32Array, indices: Uint32Array) {
    return this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.5).setRestitution(0.04));
  }

  addPlayingField(vertices:Float32Array,indices:Uint32Array,boundary:Point2[]){
    const collider=this.addStaticMesh(vertices,indices);
    this.surfaceCleanup.set(collider.handle,registerPlayingField(this.city,boundary,vertices[1]));
    return collider;
  }

  /** Ground for one streamed tile: the same trimesh flags as the whole-city collider. */
  addTerrainTile(vertices: Float32Array, indices: Uint32Array) {
    ({vertices,indices}=clipTunnelPortals(this.city,vertices,indices));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setRestitution(0));
    this.terrainColliders.add(collider.handle); return collider;
  }

  /** A tile's paths become recovery destinations with its landscape collision,
   * and leave with that tile, so a bike cannot reset onto unloaded terrain. */
  registerParkPaths(paths:readonly ParkPath[]){
    const group={paths};this.parkPathGroups.add(group);
    return()=>{this.parkPathGroups.delete(group);};
  }

  /** Same closed arched slab as the park renderer; tile disposal removes both
   * collision and the support used by saved positions / vehicle switches. */
  addFootbridge(city:CityData,path:NonNullable<CityData['parkPaths']>[number]){
    const road=footbridgeRoad(city,path);if(!road)return[];
    const slab=roadSlabGeometry(city,road),collider=this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(slab.vertices,slab.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setRestitution(0));
    this.surfaceCleanup.set(collider.handle,registerDriveSurface(this.city,road));
    const colliders=[collider];
    // The columns under a deck over a road, as drawn.
    for(const s of footbridgeSupports(city,road,path)){
      const half=FOOTBRIDGE_COLUMN/2;
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid(half,(s.top-s.bottom)/2,half).setTranslation(s.x,(s.top+s.bottom)/2,s.z).setRotation({x:0,y:Math.sin(s.yaw/2),z:0,w:Math.cos(s.yaw/2)}).setFriction(.5)));
    }
    return colliders;
  }

  /** Upper decks are closed solids, separate from the original terrain. Wheel
   * rays can support either level while underpass cars retain their own ground.
   * `city` may be a tile-local view so edge and support queries stay bounded. */
  addRoadDeck(city: CityData, road: CityData['roads'][number], tunnelShell?:ReturnType<typeof tunnelGeometry>) {
    const colliders: RAPIER.Collider[] = [];
    if (!road.elevations) return colliders;
    const slab = roadSlabGeometry(city, road);
    colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(slab.vertices, slab.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(1).setRestitution(0)));
    if(road.tunnel){
      const shell=tunnelShell??tunnelGeometry(city,road);
      for(const mesh of Object.values(shell))if(mesh.indices.length)colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices,mesh.indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(.5).setRestitution(.02)));
      return colliders;
    }
    // (rails and the median row are reckoned on the whole city: a tile's view may not hold the deck across the median)
    for (const p of bridgeBarriers(city, road, this.city)) {
      // Same yaw/pitch transform as the visible parapet.
      const sx = Math.sin(-p.slope / 2), cx = Math.cos(-p.slope / 2), sy = Math.sin(p.yaw / 2), cy = Math.cos(p.yaw / 2);
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid(.135, .38, p.length / 2).setTranslation(p.x, p.y, p.z).setRotation({ x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx }).setFriction(.4)));
    }
    // The median barrier this deck carries between itself and the deck running the opposite way: its profile and its foot, as drawn.
    colliders.push(...this.addParapets(medianBarrierBoxes(medianBarriers(this.city, road), road.bridge?.thickness)));
    // A closed end's barrier units, solid boxes of the full profile, set like the rendered row.
    for (const u of closedEndBarriers(city, road)?.units ?? []) {
      const sy = Math.sin(u.yaw / 2), cy = Math.cos(u.yaw / 2), sz = Math.sin(u.roll / 2), cz = Math.cos(u.roll / 2), h = JERSEY.height / 2;
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid(u.length / 2, h, JERSEY.base / 2).setTranslation(u.x - Math.sin(u.roll) * Math.cos(u.yaw) * h, u.y - .02 + Math.cos(u.roll) * h, u.z + Math.sin(u.roll) * Math.sin(u.yaw) * h).setRotation({ x: sy * sz, y: sy * cz, z: cy * sz, w: cy * cz }).setFriction(.4).setRestitution(.05)));
    }
    for (const p of bridgeSupports(city, road)) {
      const rotation={x:0,y:Math.sin(p.yaw/2),z:0,w:Math.cos(p.yaw/2)};
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid(.9, (p.top - p.bottom) / 2, 1.2).setTranslation(p.x, (p.top + p.bottom) / 2, p.z).setRotation(rotation).setFriction(.5)));
      colliders.push(this.addDetailedCollider(RAPIER.ColliderDesc.cuboid((p.width - .5) / 2, .275, 1.4).setTranslation(p.x, p.top - .28, p.z).setRotation(rotation).setFriction(.5)));
    }
    return colliders;
  }

  /** Solid parapet boxes set like the rendered ones (a surveyed deck's generated parapets). */
  addParapets(parapets: readonly {x:number;y:number;z:number;yaw:number;slope:number;length:number;width:number;height:number}[]) {
    return parapets.map(p => {
      const sx = Math.sin(-p.slope / 2), cx = Math.cos(-p.slope / 2), sy = Math.sin(p.yaw / 2), cy = Math.cos(p.yaw / 2);
      return this.addDetailedCollider(RAPIER.ColliderDesc.cuboid(p.width / 2, p.height / 2, p.length / 2).setTranslation(p.x, p.y, p.z).setRotation({ x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx }).setFriction(.4));
    });
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

  private clearStorrow(){
    if(this.storrow?.anchor)this.world.removeRigidBody(this.storrow.anchor);
    this.storrow=undefined;this.storrowStrikes=[];this.truckApproachSpeed=0;this.truckApproachAge=0;
  }

  private clearTruckBody(){
    this.clearStorrow();
    for(const collider of this.truckColliders)this.world.removeCollider(collider,true);
    this.truckColliders=[];this.cargoCollider=undefined;
  }

  /** A tall box contacting a solid above an otherwise open lane is a bridge
   * strike. Side walls, vehicles, pavement and upside-down contacts do not
   * qualify. Rapier supplies the actual contact and stopping impulse. */
  private detectStorrow(before:VehicleMotion,severity:number){
    const cargo=this.cargoCollider!;
    if(1-2*(before.rotation.x**2+before.rotation.z**2)<.8)return;
    let hit:RAPIER.Collider|undefined,point:{x:number;y:number;z:number}|undefined;
    this.world.contactPairsWith(cargo,other=>{
      if(hit||other.isSensor()||other.parent()&&!other.parent()!.isFixed()||this.terrainColliders.has(other.handle))return;
      const consider=(p:{x:number;y:number;z:number}|null)=>{
        if(!p||p.y<before.y+1.7)return;
        // At this same horizontal point, a clear space below the impact
        // distinguishes an overhead beam from a wall or a support column.
        if(other.intersectsShape(new RAPIER.Cuboid(.14,.55,.14),{x:p.x,y:before.y+.3,z:p.z},{x:0,y:0,z:0,w:1}))return;
        hit=other;point={x:p.x,y:p.y,z:p.z};
      };
      this.world.contactPair(cargo,other,manifold=>{
        for(let i=0;i<manifold.numSolverContacts();i++){
          consider(manifold.solverContactPoint(i));if(hit)break;
        }
      });
      // Persistent CCD contacts against a thin triangle-mesh rib can have
      // manifold contacts but zero solver points. Query their world-space
      // witness directly instead of losing a real stopped cargo-box strike.
      if(!hit){const contact=cargo.contactCollider(other,.03);if(contact)consider(contact.point2);}
    });
    if(!hit||!point)return;
    const direction=before.speed<0?-1:1,site=lowClearanceAt(this.city,point.x,point.z,2);
    let recovery:StorrowRecoveryPlan;
    if(site&&Math.abs(before.y-site.roadY-this.carSpec.spawnHeight)<1.5){
      recovery={
        exits:storrowRecoveryCandidates(this.city,site,before,direction,this.carSpec.halfLength,this.carSpec.halfWidth),
        retreats:storrowRetreatCandidates(this.city,site,before,direction,this.carSpec.halfLength,this.carSpec.halfWidth),
      };
    }else{
      // Project the actual solid onto the road corridor. Its far side follows
      // bends and source seams, and includes the full truck footprint. A tall
      // query avoids accepting a higher-clearance gap inside the same portal.
      const footprint=new RAPIER.Cuboid(this.carSpec.halfWidth,1000,this.carSpec.halfLength),solid=hit,impactY=point.y;
      recovery=storrowSolidRecoveryPlan(this.city,before,sampleVehicleSurface(this.city,before.x,before.z,before.y).height,direction,this.carSpec.halfLength,this.carSpec.halfWidth,
        candidate=>solid.intersectsShape(footprint,{x:candidate.x,y:impactY,z:candidate.z},{x:0,y:Math.sin(candidate.yaw/2),z:0,w:Math.cos(candidate.yaw/2)}));
    }
    this.storrow={damage:clamp(.35+Math.abs(before.speed)*.032,.35,1),direction,elapsed:0,...recovery};
    this.storrowStrikes.push({severity:Math.max(severity,Math.abs(before.speed)),direction});
  }

  step(input: DriveInput, dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const timestep = Math.min(dt, 1 / 30);
    this.world.timestep = timestep;
    const state = this.getMotionState();
    if(this.cargoCollider){
      if(Math.abs(state.speed)>.25){this.truckApproachSpeed=state.speed;this.truckApproachAge=.3;}
      else this.truckApproachAge=Math.max(0,this.truckApproachAge-timestep);
    }
    if(this.storrow){
      this.storrow.elapsed+=timestep;
      input={throttle:0,brake:1,steer:0,handbrake:true};
      // Let the initial high contact load pitch the truck and compress its
      // suspension, then constrain the crushed box to the bridge. The joint
      // keeps the wreck wedged even if the surrounding tile streams away.
      if(this.storrow.elapsed>=.16&&!this.storrow.anchor){
        const p=this.body.translation(),q=this.body.rotation();
        const anchor=this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x,p.y,p.z).setRotation(q));
        this.world.createImpulseJoint(RAPIER.JointData.fixed({x:0,y:0,z:0},{x:0,y:0,z:0,w:1},{x:0,y:0,z:0},{x:0,y:0,z:0,w:1}),anchor,this.body,true);
        this.storrow.anchor=anchor;
        this.body.setLinvel({x:0,y:0,z:0},true);this.body.setAngvel({x:0,y:0,z:0},true);
      }
    }
    if (this.bike) {
      this.bike.step(input, timestep, state.speed, state.yaw);
      this.steering=this.bike.steering;this.braking=this.bike.braking;this.gear=state.speed<-.3?-1:1;this.rpm=0;
    } else {
    const speed = state.speed,spec=this.carSpec,id=this.selectedCar,performance=isPerformanceCar(id),electric=isElectricCar(id),drive=performance?CAR_POWERTRAINS[id]:null;
    const throttle = clamp(input.throttle, -1, 1),handbrake=input.handbrake,c=this.controller;
    const pedalBrake = clamp(input.brake, 0, 1);
    const changeDirection = throttle * speed < -0.4;
    // The rear tyres as they stand on the road: load, heading and the velocity of each contact patch.
    const q=this.body.rotation(),fx=2*(q.x*q.z+q.w*q.y),fy=2*(q.y*q.z-q.w*q.x),fz=1-2*(q.x*q.x+q.y*q.y);
    const lin=this.body.linvel(),ang=this.body.angvel(),com=this.body.worldCom(),rear:RearPatch[]=[];
    for(const i of [2,3]){
      if(!c.wheelIsInContact(i))continue;
      const p=c.wheelContactPoint(i),n=c.wheelContactNormal(i),load=c.wheelSuspensionForce(i)??0,ground=c.wheelGroundObject(i)?.parent();
      if(!p||!n||load<=0||n.y<.3||ground&&!ground.isFixed())continue;
      const fn=fx*n.x+fy*n.y+fz*n.z;let ax=fx-n.x*fn,ay=fy-n.y*fn,az=fz-n.z*fn;const length=Math.hypot(ax,ay,az);if(length<.2)continue;
      ax/=length;ay/=length;az/=length;
      const sx=n.y*az-n.z*ay,sy=n.z*ax-n.x*az,sz=n.x*ay-n.y*ax,rx=p.x-com.x,ry=p.y-com.y,rz=p.z-com.z;
      const vx=lin.x+ang.y*rz-ang.z*ry,vy=lin.y+ang.z*rx-ang.x*rz,vz=lin.z+ang.x*ry-ang.y*rx;
      rear.push({i,p,load,along:{x:ax,y:ay,z:az},side:{x:sx,y:sy,z:sz},forward:vx*ax+vy*ay+vz*az,sideways:vx*sx+vy*sy+vz*sz});
    }
    const rearLoad=rear.reduce((sum,w)=>sum+w.load,0),rearSlide=rear.reduce((most,w)=>Math.max(most,Math.abs(w.sideways)),0),rearTravel=rear.reduce((most,w)=>Math.max(most,Math.hypot(w.forward,w.sideways)),0);
    // A tyre that slides holds four fifths of what it holds at its braking peak.
    const wrx=id==='subaru-wrx',gt2=id==='maserati-gt2-stradale';
    // Aerodynamic load presses the tyres down, so they corner and brake harder the faster the car goes.
    const downforce=gt2?gt2Downforce(speed):0,aeroGrip=1+downforce/(spec.mass*9.81);
    const rearShare=wrx||!performance ? .5 : electric ? .6 : 1;
    const grip=Math.max(.7,.8*spec.brakeForce/(spec.mass*9.81)),efficiency=(drive??HARBOR_DRIVE).efficiency;
    // The handbrake locks the rear wheels and opens the clutch (the electric car cuts its motors), so the pedal only
    // holds revs against it. Let go of it with the pedal down and the wheel turned, or put the power down while the
    // tail is already out, and the rear tyres spin for as long as the engine can outrun their grip and the pedal stays
    // down. Released with the wheel straight, the car launches hooked up, as it does from rest without the handbrake.
    const released=this.handbrakeHeld&&!handbrake;this.handbrakeHeld=handbrake;
    const canSpin=rearLoad>0&&spec.traction*spec.wheelspin*rearShare>grip*rearLoad;
    if(handbrake||pedalBrake>.1||changeDirection||throttle<=0||this.pedal<.2||speed<-1||!canSpin)this.loose=false;
    else if(!this.loose&&this.pedal>.5&&(released&&Math.abs(input.steer)>.2||this.sliding&&rearSlide>1.2))this.loose=true;
    const road=Math.max(0,speed),spin=this.loose?Math.max(0,Math.min(this.pedal*SPIN.limit,spec.power*efficiency*rearShare*this.pedal/(grip*rearLoad)-road)):0;
    this.slip=handbrake?0:this.slip+(spin-this.slip)*(1-Math.exp(-(spin>this.slip?SPIN.rise:SPIN.fall)*timestep));
    if(this.loose&&spin<.3&&this.slip<.5)this.loose=false;
    if(!this.loose&&this.slip<.05)this.slip=0;
    const locked=handbrake&&rear.length>0;
    // The rear axle is off the controller's tyre model while it is locked and moving, spinning, or still sliding sideways afterwards.
    this.sliding=rear.length>0&&(locked?rearTravel>SLIDE.stick:this.slip>.3||this.sliding&&rearSlide>SLIDE.grip);
    // Slightly tighter arcs at parking and road speeds; cap lateral demand at the car's cornering limit. With the tail
    // out the front wheels may also turn by the angle the car is sliding at, or opposite lock could not catch it.
    const drift=this.sliding?Math.atan2(rearSlide,Math.max(1,Math.abs(speed))):0;
    const steeringLimit = Math.min(spec.maxSteering,carSteeringLimit(speed,spec,aeroGrip)+drift);
    const desiredSteer = clamp(input.steer, -1, 1) * steeringLimit;
    this.steering += (desiredSteer - this.steering) * (1 - Math.exp(-(id==='moving-truck'?3.2:8) * timestep));
    const speedLimit = throttle >= 0 ? spec.maxForwardSpeed : spec.maxReverseSpeed;
    this.pedal += (throttle-this.pedal)*(1-Math.exp(-(Math.abs(throttle)>Math.abs(this.pedal)?22:14)*timestep));
    if(Math.abs(throttle)<.001&&Math.abs(this.pedal)<.005)this.pedal=0;
    // The gearbox and the tachometer follow the driven tread, which outruns the road while the tyres spin.
    const tread=speed+(speed>-1?this.slip:0);
    const targetGear=performance?carGear(id,Math.max(0,tread),this.gear,throttle):Math.min(5,Math.max(1,1+Math.floor(Math.abs(tread)/7.5)));
    const previousGear=this.gear;
    // Reverse input brakes a forward-moving car before selecting reverse.
    // Only select R while actually reversing or nearly stopped with reverse intent.
    this.gear=speed<-.3||(Math.abs(speed)<=.3&&throttle<-.1)?-1:targetGear;
    this.rpm=isPerformanceCar(this.selectedCar)?carRpm(this.selectedCar,tread,this.gear,this.pedal):850+Math.abs(tread)/(this.gear<0?7.5:7.5*targetGear)*3000+Math.abs(this.pedal)*650;
    if(!electric){
      // Declutched by the handbrake, the engine revs freely with the pedal; let in again, the flare dies away as the clutch bites.
      const engine=ENGINES[id as keyof typeof ENGINES],free=handbrake&&throttle>0?engine.idle+this.pedal*(.72*engine.redline-engine.idle):0;
      this.revs+=(free-this.revs)*(1-Math.exp(-(free>this.revs?7:4)*timestep));
      this.rpm=Math.min(engine.redline,Math.max(this.rpm,this.revs));
    }
    if(drive&&previousGear>0&&this.gear>0&&previousGear!==this.gear)this.shiftRemaining=drive.shiftSeconds;
    this.shiftRemaining=Math.max(0,this.shiftRemaining-timestep);
    // Rolling resistance and aerodynamic drag act on the body whatever the pedals do.
    const resistance=roadLoad(id,speed);
    if(Math.abs(speed)>.05){
      const drag=-Math.sign(speed)*resistance*timestep;
      this.body.applyImpulse({x:fx*drag,y:fy*drag,z:fz*drag},true);
    }
    // The WRX's clutch opens for each shift. Its common boost state supplies
    // both the torque curve at the driven tyres and the compressor audio.
    const clutchOpen=handbrake||(wrx&&this.shiftRemaining>0);
    let wheelForce=spec.power*efficiency/Math.max(10,Math.abs(speed));
    if(wrx){
      const load=clutchOpen||changeDirection||pedalBrake>.1?0:Math.abs(this.pedal);
      this.turboBoost=wrxBoost(this.turboBoost,this.rpm,load,timestep);
      wheelForce=wrxTorque(this.rpm,this.turboBoost)*wrxGearing(this.gear)*Math.PI/30*efficiency;
    }
    if(gt2){
      // The Nettuno's torque curve through the gear engaged. The twin clutches hand over without venting boost.
      const load=handbrake||changeDirection||pedalBrake>.1?0:Math.abs(this.pedal);
      this.turboBoost=gt2Boost(this.turboBoost,this.rpm,load,timestep);
      wheelForce=gt2Torque(this.rpm,this.turboBoost)*gt2Gearing(this.gear)*Math.PI/30*efficiency;
      if(downforce>0&&[0,1,2,3].filter(i=>c.wheelIsInContact(i)).length>=2){
        // Splitter and wing: the load acts over each axle in the share Maserati gives for them.
        // It is square to the car's travel, not to its floor: along the floor's normal, the pitch of the body
        // would turn a share of it into thrust.
        let ux=2*(q.x*q.y-q.w*q.z),uy=1-2*(q.x*q.x+q.z*q.z),uz=2*(q.y*q.z+q.w*q.x);
        const travel=Math.hypot(lin.x,lin.y,lin.z)||1,along=(ux*lin.x+uy*lin.y+uz*lin.z)/travel;
        ux-=along*lin.x/travel;uy-=along*lin.y/travel;uz-=along*lin.z/travel;
        const at=this.body.translation(),half=spec.wheelbase/2,size=Math.hypot(ux,uy,uz)||1;
        for(const [share,z] of [[GT2.frontShare,half],[1-GT2.frontShare,-half]]){
          const push=-downforce*share*timestep/size;
          this.body.applyImpulseAtPoint({x:ux*push,y:uy*push,z:uz*push},{x:at.x+fx*z,y:at.y+fy*z,z:at.z+fz*z},true);
        }
      }
    }
    const tractiveForce=Math.min(spec.traction,wheelForce);
    const governedForce=Math.min(tractiveForce,Math.max(0,speedLimit-Math.abs(speed))*spec.mass*4+resistance);
    const held=electric&&!handbrake&&Math.abs(throttle)<.05&&(Math.abs(speed)<.25||this.held&&Math.abs(speed)<1);
    const force = changeDirection || pedalBrake > 0.1 || clutchOpen || held ? 0 : this.pedal * governedForce*(this.shiftRemaining>0?.2:1);
    const lift=1-Math.min(1,Math.abs(this.pedal)/.15);
    // Lift-off regeneration holds its rate down to a walk and then eases the car to rest, where Hold keeps it on
    // the friction brakes until the pedal is pressed again. It blends with the service brakes; actual braking
    // remains tire/contact dependent.
    const regenForce=electric&&!changeDirection&&!handbrake?REGEN.force*lift*Math.min(1,REGEN.ease+Math.abs(speed)/REGEN.walk):0;
    this.held=held;
    // A closed throttle leaves the engine to be turned by the driven wheels.
    const engineBrake=electric||clutchOpen||this.loose||changeDirection?0:engineBrakeForce(id,this.rpm,this.gear)*lift;
    this.braking = pedalBrake > 0.05 || handbrake || changeDirection || this.held || regenForce>spec.mass*1.3;
    // Wheel brake is an impulse, so scale it with the physics step, not render FPS.
    const brakingImpulse = (changeDirection ? spec.brakeForce*Math.abs(throttle) : Math.max(pedalBrake * spec.brakeForce*aeroGrip,this.held?spec.brakeForce*.5:0)) * timestep / 4;
    const rollingImpulse = !performance&&Math.abs(throttle) < 0.05&&Math.abs(speed)<1.5 ? 90*timestep : 0;
    for (let i = 0; i < 4; i++) {
      const radius=spec.wheelbase/Math.tan(this.steering||1e-8);
      const ackermann=Math.atan(spec.wheelbase/(radius+(i%2===0?-1:1)*spec.track/2));
      c.setWheelSteering(i, i < 2 ? ackermann : 0);
      // Rapier chooses engine force before wheel braking. A locked or spinning rear wheel
      // must receive exactly zero engine force, including decaying pedal input.
      const back=i>=2,driveShare=(back?rearShare:1-rearShare)/2;
      // For the same reason the pedal's last tenths and the lift-off retardation that comes in under them (regeneration,
      // engine braking) are one force at the wheel, the difference of the two: set side by side, the retardation would
      // wait out the 0.4 s the pedal takes to come all the way up and then arrive at once.
      const drive=back&&(locked||this.loose)?0:force*driveShare,coast=electric?regenForce*(i<2?1.2:.8)/4:engineBrake*driveShare;
      const net=drive*speed>0?Math.abs(drive)-coast:Infinity,retard=net===Infinity?coast:Math.max(0,-net);
      c.setWheelEngineForce(i, net===Infinity?drive:Math.sign(drive)*Math.max(0,net));
      const patch=back?rear.find(w=>w.i===i):undefined;
      // A locked rear wheel that has come to rest is held by the tyre's grip on the road under it.
      const service=back&&this.sliding&&(locked||this.loose)?0:back&&locked?grip*(patch?.load??0)*timestep:Math.max(brakingImpulse*(i<2?1.2:.8),retard*timestep) + rollingImpulse;
      c.setWheelBrake(i, service);
      c.setWheelSideFrictionStiffness(i, back&&this.sliding ? 0 : 1.05);
      // While the tail slides the front tyres hold no more than a tyre's peak either, so they cannot whip the car round.
      c.setWheelFrictionSlip(i, this.sliding&&!back ? grip/.8 : spec.friction);
    }
    // A tyre that has let go pushes back with its sliding grip against the way its tread moves over the road:
    // against the car's travel when the wheel is locked, mostly forwards when it spins, sideways when it only slides.
    // The pull fades in over the first half metre a second of sliding, where a rolling tyre would still be gripping.
    if(this.sliding)for(const w of rear){
      const along=locked?w.forward:this.loose||this.slip>0?-this.slip:0,size=Math.hypot(along,w.sideways);if(size<1e-4)continue;
      const impulse=grip*w.load*timestep*Math.min(1,size/SLIDE.grip)/size,a=-along*impulse,b=-w.sideways*impulse;
      this.body.applyImpulseAtPoint({x:w.along.x*a,y:w.along.y*a,z:w.along.z*a},w.p,true);
      // (the sideways part acts near the height of the centre of mass, as the controller's own tyres do, so a slide does not trip the car)
      const ux=2*(q.x*q.y-q.w*q.z),uy=1-2*(q.x*q.x+q.z*q.z),uz=2*(q.y*q.z+q.w*q.x),rise=((com.x-w.p.x)*ux+(com.y-w.p.y)*uy+(com.z-w.p.z)*uz)*.9;
      this.body.applyImpulseAtPoint({x:w.side.x*b,y:w.side.y*b,z:w.side.z*b},{x:w.p.x+ux*rise,y:w.p.y+uy*rise,z:w.p.z+uz*rise},true);
    }
    // The picture of a rear wheel stands still while it is locked and runs ahead of the road while it spins.
    for(const i of [2,3]){
      const angle=c.wheelRotation(i)??0,turned=angle-this.wheelSeen[i];this.wheelSeen[i]=angle;
      if(locked)this.wheelTurn[i]-=turned;else if(this.slip>0)this.wheelTurn[i]+=this.slip*timestep/spec.rearWheelRadius;
    }
    this.wheelspin=clamp(Math.max(this.slip/6,this.sliding?(rearSlide-1.5)/4:0),0,1);
    c.updateVehicle(timestep, undefined, undefined, collider => collider.parent()?.handle !== this.body.handle);
    if(wrx){
      // Rapier applies its lateral tyre impulse near the centre of mass. Its
      // moment about the sedan's lower roll centre loads the outside springs.
      const v=this.body.linvel();
      const sideDelta=(v.x-lin.x)*(1-2*(q.y*q.y+q.z*q.z))+(v.y-lin.y)*2*(q.x*q.y+q.w*q.z)+(v.z-lin.z)*2*(q.x*q.z-q.w*q.y);
      const rollImpulse=clamp(sideDelta,-12*timestep,12*timestep)*spec.mass*.34;
      this.body.applyTorqueImpulse({x:fx*rollImpulse,y:fy*rollImpulse,z:fz*rollImpulse},true);
    }
    if((handbrake||this.held)&&Math.abs(speed)<.2&&c.wheelIsInContact(2)&&c.wheelIsInContact(3)){
      // At rest, the locked tires supply static friction against the component
      // of gravity along the road. Rapier's wheel impulse precedes world gravity;
      // compensate that next-step load rather than allowing continual hill creep.
      const normals=[0,1,2,3].filter(i=>c.wheelIsInContact(i)).map(i=>c.wheelContactNormal(i)!);
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
    // world.step() minus its closing pass over every collider handle. Rapier maps there the handles a step
    // itself created or removed, which only its soft bodies do; with a neighbourhood's ten thousand static
    // colliders streamed in, those two wasm calls per collider cost more than the step.
    const w = this.world;
    w.physicsPipeline.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver);
    // A knock is a velocity change no tire or suspension force can produce in
    // one step. Record what the chassis touched so the sound matches the object.
    const after = this.body.linvel(), gravity = this.world.gravity;
    const severity = Math.hypot(after.x - before.x - gravity.x * timestep, after.y - before.y - gravity.y * timestep, after.z - before.z - gravity.z * timestep);
    // Trimesh CCD can stop the body one step before solver contacts become
    // available. Retain that approach speed briefly so the next contact still
    // registers, including a truck creeping into the beam on the throttle.
    if(this.cargoCollider&&!this.storrow&&(Math.abs(state.speed)>.1||this.truckApproachAge>0||Math.abs(input.throttle)>.1)){
      const contactSpeed=Math.abs(state.speed)>.25?state.speed:this.truckApproachAge>0?this.truckApproachSpeed:input.throttle*.3;
      this.detectStorrow({...state,speed:contactSpeed},severity);
    }
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
      if (!this.bike && !this.cargoCollider && points && horizontal >= 3) {
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
    if (!this.storrow&&(!Number.isFinite(p.x + p.y + p.z) || p.y < sampleDriveSurface(this.city,p.x,p.z,p.y).height - 8 || this.overturnedTime > 2.5 ||
        p.x < this.bounds.minX - 24 || p.x > this.bounds.maxX + 24 ||
        p.z < this.bounds.minZ - 24 || p.z > this.bounds.maxZ + 24)) {
      this.recoverFromCrash(p);
    }
  }

  /** The player's reset (R): the same safe placement as crash recovery.
   * The Ultra Bee can also return to a closer park trail or walkway. */
  resetToRoad():'retreated'|'blocked'|undefined{
    if(this.storrow){
      // Prefer the far side of this same crossing, retaining lane/direction.
      // Longer search covers a queue immediately beyond the bridge.
      let exitFits=false;
      for(const at of this.storrow.exits){
        if(!this.canResetAt(at.x,at.z,at.yaw,at.roadId))continue;
        exitFits=true;
        if(this.canResetAt(at.x,at.z,at.yaw,at.roadId,true)){this.reset(at.x,at.z,at.yaw,at.roadId);return;}
      }
      // A temporarily occupied exit should wait for traffic. If the complete
      // truck cannot fit beyond the entrance at all (or the road ends), move
      // back along the connected approach, never into grass or a nearby road.
      if(!exitFits)for(const at of this.storrow.retreats){
        if(this.canResetAt(at.x,at.z,at.yaw,at.roadId,true)){this.reset(at.x,at.z,at.yaw,at.roadId);return 'retreated';}
      }
      return 'blocked';
    }
    this.recoverFromCrash(this.body.translation());
  }
  /** Bring the vehicle to the nearest safe road (or bike path) at `position`, as when the player walked away from it and wants it back. */
  resetNear(position:{x:number;y:number;z:number}){this.recoverFromCrash({x:position.x,y:position.y+.5,z:position.z});}

  /** Recover locally, preferring a closer safe path for the Ultra Bee. Roads
   * retain their level constraints; the saved pose is only a final fallback. */
  private recoverFromCrash(position:{x:number;y:number;z:number}){
    const spawnHeight=this.bike?ULTRA_BEE.spawnHeight:this.carSpec.spawnHeight;
    if([position.x,position.y,position.z].every(Number.isFinite)){
      const crashSurface=sampleVehicleSurface(this.city,position.x,position.z,position.y);
      const heading=this.getMotionState().yaw;
      // Keep recovery inside the already-streamed neighborhood (and on a survey mesh's traces only after a crash on one, where the mesh is loaded).
      const accept=(spot:{x:number;z:number;yaw:number;road:CityData['roads'][number]})=>{
        if(spot.x<this.bounds.minX+1||spot.x>this.bounds.maxX-1||spot.z<this.bounds.minZ+1||spot.z>this.bounds.maxZ-1)return false;
        const surface=sampleDriveSurface(this.city,spot.x,spot.z,undefined,spot.road.id),n=surface.normal;
        // Level compatibility is a constraint, not a distance tradeoff. Compare
        // the candidate's support plane at the crash point so slopes still match.
        const level=surface.height-(n.x*(position.x-spot.x)+n.z*(position.z-spot.z))/Math.max(.5,n.y);
        if(Math.abs(level-crashSurface.height)>1.25)return false;
        const center={x:spot.x-.06*n.x,y:surface.height+spawnHeight/Math.max(.5,n.y)-.06*n.y,z:spot.z-.06*n.z};
        return !this.world.intersectionWithShape(center,rotationFromNormal(n,spot.yaw),this.chassisCollider.shape,undefined,undefined,this.chassisCollider,this.body)&&this.canResetAt(spot.x,spot.z,spot.yaw,spot.road.id);
      };
      let road=closestRoad(this.city,position.x,position.z,false,{height:position.y,maxDistance:200,survey:!!crashSurface.road?.surveyDeck,accept});
      if(this.bike){
        const paths=[...this.parkPathGroups].flatMap(group=>group.paths);
        for(const spot of parkRecoveryCandidates(paths,position.x,position.z,Math.min(200,road.distance))){
          // A road wins an equal-distance junction. Bridge paths must still
          // have their physical deck registered; ordinary paths use terrain.
          if(spot.distance>=road.distance)break;
          if(spot.x<this.bounds.minX+1||spot.x>this.bounds.maxX-1||spot.z<this.bounds.minZ+1||spot.z>this.bounds.maxZ-1)continue;
          const roadId=spot.path.bridge?`footbridge:${spot.path.id}`:undefined;
          const surface=sampleDriveSurface(this.city,spot.x,spot.z,undefined,roadId),n=surface.normal;
          if((roadId&&surface.road?.id!==roadId)||n.y<.55)continue;
          if(roadId){
            const level=surface.height-(n.x*(position.x-spot.x)+n.z*(position.z-spot.z))/Math.max(.5,n.y);
            if(Math.abs(level-crashSurface.height)>1.25)continue;
          }else{
            // Ground trails can climb uneven hills. Compare support at the
            // crash, not a distant tangent plane, while retaining overpasses.
            if(Math.abs(crashSurface.height-sampleElevation(this.city,position.x,position.z))>1.25)continue;
            if(this.city.water?.some(w=>w.rings[0]?.length&&pointInside([spot.x,spot.z],w.rings[0])&&!w.rings.slice(1).some(r=>pointInside([spot.x,spot.z],r))))continue;
          }
          const yaw=Math.cos(spot.yaw-heading)<0?spot.yaw+Math.PI:spot.yaw;
          if(!this.canResetAt(spot.x,spot.z,yaw,roadId,true))continue;
          this.reset(spot.x,spot.z,yaw,roadId);return;
        }
      }
      // A bike can fit beneath a bridge where the selected truck cannot. A
      // single projection on that road is blocked, but a nearby station on the
      // same level is safe; search along it before using the saved rescue pose.
      if(!Number.isFinite(road.distance)&&this.cargoCollider){
        for(let distance=8;distance<=80&&!Number.isFinite(road.distance);distance+=8)for(const sign of [1,-1]){
          road=closestRoad(this.city,position.x+Math.sin(heading)*distance*sign,position.z+Math.cos(heading)*distance*sign,false,{height:position.y,maxDistance:12,accept});
          if(Number.isFinite(road.distance))break;
        }
      }
      if(Number.isFinite(road.distance)){
        const yaw=road.road.oneway===0&&Math.cos(road.yaw-this.getMotionState().yaw)<0?road.yaw+Math.PI:road.yaw;
        this.reset(road.x,road.z,yaw,road.road.id);return;
      }
    }
    this.reset(this.rescue.x,this.rescue.z,this.rescue.yaw,this.rescue.roadId);
  }

  /** Current chassis movement and footprint, used by the fixed-step simulation. */
  getMotionState(): VehicleMotion {
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
      halfLength:this.bike?.8:this.carSpec.halfLength,halfWidth:this.bike?.4:this.carSpec.halfWidth,
    };
  }

  getState(): PhysicsVehicleState {
    const wheels=this.controller.numWheels();
    return {
      ...this.getMotionState(),
      wheelAngles: Array.from({length:wheels}, (_,i) => (this.controller.wheelRotation(i) ?? 0)+(this.bike?0:this.wheelTurn[i]??0)),
      suspension: Array.from({length:wheels}, (_,i) => this.controller.wheelSuspensionLength(i) ?? this.carSpec.suspensionRest),
      braking: this.braking,gear:this.gear,rpm:this.rpm,turboBoost:this.turboBoost,wheelspin:this.bike?0:this.wheelspin,vehicle:this.vehicleType,carId:this.carId,
      lean:this.bike?.lean??0,wheelie:this.bike?.wheelie??0,wheelieRemaining:this.bike?.wheelieRemaining??0,
      storrowDamage:this.storrow?.damage??0,storrowDirection:this.storrow?.direction??1,storrowed:!!this.storrow,
    };
  }

  getTireContacts(input:DriveInput):TireContact[]{
    const c=this.controller,p=this.body.translation(),q=this.body.rotation(),v=this.body.linvel(),w=this.body.angvel(),contacts:TireContact[]=[];
    const yaw=Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y)),bike=!!this.bike,up=1-2*(q.x*q.x+q.z*q.z);
    if(up<.4)return contacts;
    for(let i=0;i<c.numWheels();i++){
      if(!c.wheelIsInContact(i))continue;
      const point=c.wheelContactPoint(i),normal=c.wheelContactNormal(i),ground=c.wheelGroundObject(i);
      const parent=ground?.parent();
      if(!point||!normal||normal.y<.5||!ground||parent&&!parent.isFixed())continue;
      const rx=point.x-p.x,ry=point.y-p.y,rz=point.z-p.z;
      const vx=v.x+w.y*rz-w.z*ry,vz=v.z+w.x*ry-w.y*rx,heading=yaw+(c.wheelSteering(i)??0);
      const speed=vx*Math.sin(heading)+vz*Math.cos(heading),side=vx*Math.cos(heading)-vz*Math.sin(heading);
      contacts.push({wheel:i,x:point.x,y:point.y,z:point.z,normal:{x:normal.x,y:normal.y,z:normal.z},width:bike?.11:this.carId==='supra-mk4'?(i<2?.235:.255):this.carId==='mclaren-720s'||this.carId==='maserati-gt2-stradale'?(i<2?.245:.305):this.carId==='mclaren-gt'?(i<2?.225:.295):.235,intensity:Math.max(tireSlipIntensity(input,speed,side,bike?i===1:i>=2,bike),!bike&&i>=2?Math.min(1,this.slip/3):0)});
    }
    return contacts;
  }

  private resetPose(x:number,z:number,yaw:number,roadId?:string){
    const surface=sampleDriveSurface(this.city,x,z,undefined,roadId),normal=surface.normal;
    return{normal,position:{x,y:surface.height+(this.bike?ULTRA_BEE.spawnHeight:this.carSpec.spawnHeight)/Math.max(.5,normal.y),z},rotation:rotationFromNormal(normal,yaw)};
  }

  private colliderCenter(collider:RAPIER.Collider,position:{x:number;y:number;z:number},q:{x:number;y:number;z:number;w:number}){
    const v=collider.translationWrtParent()??{x:0,y:0,z:0};
    const tx=2*(q.y*v.z-q.z*v.y),ty=2*(q.z*v.x-q.x*v.z),tz=2*(q.x*v.y-q.y*v.x);
    return{x:position.x+v.x+q.w*tx+q.y*tz-q.z*ty,y:position.y+v.y+q.w*ty+q.z*tx-q.x*tz,z:position.z+v.z+q.w*tz+q.x*ty-q.y*tx};
  }

  /** Check a saved arrival against loaded static geometry before moving the car.
   * Query each collider directly: newly streamed colliders are absent from
   * Rapier's broad phase until world.step(), which must not run inside a wall. */
  canResetAt(x:number,z:number,yaw:number,roadId?:string,includeTraffic=false){
    if(![x,z,yaw].every(Number.isFinite))return false;
    const {position,rotation}=this.resetPose(x,z,yaw,roadId);
    const shapes=[this.chassisCollider,...this.truckColliders].map(collider=>({shape:collider.shape,center:this.colliderCenter(collider,position,rotation)}));
    let clear=true;
    this.world.forEachCollider(collider=>{
      if(!clear||collider.parent()?.handle===this.body.handle||collider.isSensor())return;
      const parent=collider.parent();if(!includeTraffic&&parent&&!parent.isFixed())return;
      if(shapes.some(({shape,center})=>collider.intersectsShape(shape,center,rotation)))clear=false;
    });
    return clear;
  }

  reset(x: number, z: number, yaw: number, roadId?:string) {
    if (![x, z, yaw].every(Number.isFinite)) return;
    this.clearStorrow();
    this.poseRevision++;
    this.rescue = { x, z, yaw,roadId };
    const {position,rotation}=this.resetPose(x,z,yaw,roadId);
    this.body.setTranslation(position, true);
    this.body.setRotation(rotation, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.steering = 0;this.pedal=0;this.gear=1;this.rpm=this.bike||isElectricCar(this.selectedCar)?0:ENGINES[this.selectedCar].idle;
    this.revs=0;this.slip=0;this.loose=false;this.sliding=false;this.held=false;this.handbrakeHeld=false;this.wheelspin=0;
    this.turboBoost=0;
    this.overturnedTime = 0;this.shiftRemaining=0;this.braking=false;this.bike?.reset();
    for (let i = 0; i < this.controller.numWheels(); i++) {
      this.controller.setWheelEngineForce(i, 0);
      this.controller.setWheelBrake(i, 0);
      this.controller.setWheelSteering(i, 0);
    }
  }

  dispose() {
    for(const cleanup of this.surfaceCleanup.values())cleanup();this.surfaceCleanup.clear();
    this.parkPathGroups.clear();
    this.world.free();
  }
}
