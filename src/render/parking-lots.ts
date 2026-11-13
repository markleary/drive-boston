import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CityData } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { createNPCVehicleBatches } from './npc-vehicles.ts';
import { createNPCVehicleColliders } from '../physics/npc-vehicle.ts';
import { NPC_BODY_LIFT, type NPCVehicleType } from '../simulation/npc-vehicle-specs.ts';
import { sampleElevation, sampleTerrainNormal, terrainRotation } from '../simulation/terrain.ts';
import { nearestParked, parkedCar, stallLines, tileStalls, type ParkedCar } from '../simulation/parking-lots.ts';

/** The resident tiles, as the streamer lists them. */
export interface ParkingTiles { readonly loaded: ReadonlyMap<string, { tile: { tx: number; tz: number; size: number; parking?: number[] } }>; }
/** Slot types of the pool in turn: the mix parkedCar draws from, so most cars find a slot of their own type. */
const SLOT_TYPES: NPCVehicleType[] = ['compact', 'sedan', 'compact', 'sedan', 'minivan', 'pickup'];
/** Cars within this distance of the player are solid. */
const SOLID = 70;
/** Width of a painted stall line and its lift over the lot's asphalt. */
const LINE = .11, LIFT = .045;

/** The stall lines of one tile as a single mesh: each line two quads end to end, so it follows the ground over a cell boundary. */
function stallLineMesh(city: CityData, stalls: ReturnType<typeof tileStalls>, material: THREE.Material) {
  const lines = stallLines(stalls); if (!lines.length) return undefined;
  const position = new Float32Array(lines.length * 18), index = new Uint32Array(lines.length * 12); let p = 0, q = 0;
  for (const [x0, z0, x1, z1] of lines) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * LINE / 2, nz = dx / l * LINE / 2, base = p / 3;
    for (const f of [0, .5, 1]) {
      const x = x0 + dx * f, z = z0 + dz * f, y = sampleElevation(city, x, z) + LIFT;
      position[p++] = x + nx; position[p++] = y; position[p++] = z + nz; position[p++] = x - nx; position[p++] = y; position[p++] = z - nz;
    }
    for (const k of [0, 2]) { index[q++] = base + k; index[q++] = base + k + 2; index[q++] = base + k + 1; index[q++] = base + k + 1; index[q++] = base + k + 2; index[q++] = base + k + 3; }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(position, 3)); geometry.setIndex(new THREE.BufferAttribute(index, 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Parking stall lines'; mesh.receiveShadow = true; mesh.userData.noAO = true; mesh.matrixAutoUpdate = false; return mesh;
}

/** Cars standing in the surface lots near the player: the occupied stalls of the resident tiles
 * (src/simulation/parking-lots.ts), the nearest drawn from one pooled fleet of the traffic's models and re-chosen as
 * the player moves. A stall always holds the same car, so a lot looks the same on every visit. */
export function createParkingLots(scene: THREE.Scene, city: CityData, physics: DrivingPhysics | undefined, options: { tiles?: ParkingTiles; mobile?: boolean } = {}) {
  const group = new THREE.Group(); group.name = 'ParkingLots'; scene.add(group);
  // (a lot reads as one from the air by the cars in it: the desktop pool reaches as far as the helicopter's view of the ground, 220 cars within 520 m)
  const capacity = options.mobile ? 30 : 220, radius = options.mobile ? 150 : 520;
  // Plates at the phone's resolution on every device: the atlas grows with the pool, and nobody reads a plate across a parking lot.
  const fleet = createNPCVehicleBatches(group, capacity, true);
  for (let i = 0; i < capacity; i++) fleet.bind(i, SLOT_TYPES[i % SLOT_TYPES.length]);
  const slots: (ParkedCar | undefined)[] = Array(capacity).fill(undefined), bySlot = new Map<string, number>(), bodies: (RAPIER.RigidBody | undefined)[] = Array(capacity).fill(undefined);
  const colliders = new Set<number>(), handles: number[][] = Array.from({ length: capacity }, () => []);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  // Painted stalls, a mesh a tile, built one tile a frame as the tiles stream in (not on phones).
  const paint = new THREE.MeshStandardMaterial({ color: '#d6d2c0', roughness: .94, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const striped = new Map<string, THREE.Mesh | null>();
  const stripe = (loaded: ParkingTiles['loaded']) => {
    for (const [key, mesh] of striped) if (!loaded.has(key)) { if (mesh) { group.remove(mesh); mesh.geometry.dispose(); } striped.delete(key); }
    if (options.mobile) return;
    for (const [key, entry] of loaded) {
      if (striped.has(key)) continue;
      const mesh = stallLineMesh(city, tileStalls(entry.tile), paint) ?? null; striped.set(key, mesh); if (mesh) { group.add(mesh); mesh.updateMatrixWorld(true); scene.userData.version = (scene.userData.version ?? 0) + 1; }
      return;
    }
  };
  let cars: ParkedCar[] = [], tilesSeen = '', last: { x: number; z: number } | undefined, elapsed = 0;
  const unsolid = (slot: number) => { const body = bodies[slot]; if (body && physics) { for (const h of handles[slot]) colliders.delete(h); handles[slot] = []; physics.world.removeRigidBody(body); bodies[slot] = undefined; } };
  const place = (slot: number, car: ParkedCar, observer: { x: number; z: number }) => {
    const y = sampleElevation(city, car.x, car.z), q = terrainRotation(city, car.x, car.z, car.yaw);
    dummy.position.set(car.x, y, car.z); dummy.quaternion.set(q.x, q.y, q.z, q.w); dummy.updateMatrix();
    fleet.draw(slot, dummy.matrix, color.setHex(car.color), Math.hypot(car.x - observer.x, car.z - observer.z));
  };
  const solid = (slot: number, car: ParkedCar) => {
    if (!physics || bodies[slot]) return;
    const y = sampleElevation(city, car.x, car.z), n = sampleTerrainNormal(city, car.x, car.z), q = terrainRotation(city, car.x, car.z, car.yaw);
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(car.x + n.x * NPC_BODY_LIFT, y + n.y * NPC_BODY_LIFT, car.z + n.z * NPC_BODY_LIFT).setRotation(q));
    handles[slot] = createNPCVehicleColliders(physics.world, body, car.spec).map(c => c.handle); for (const h of handles[slot]) colliders.add(h); bodies[slot] = body;
  };
  function update(dt: number, observer: { x: number; z: number }) {
    const loaded = options.tiles?.loaded; if (!loaded) return;
    elapsed += dt; stripe(loaded);
    const keys = [...loaded.keys()].sort().join(' ');
    if (keys !== tilesSeen) {
      tilesSeen = keys; last = undefined; cars = [];
      for (const key of [...loaded.keys()].sort()) for (const stall of tileStalls(loaded.get(key)!.tile)) { const car = parkedCar(stall); if (car) cars.push(car); }
    }
    // Re-choose the nearest when the player has moved a few car lengths; in between only the solid set follows, twice a second.
    if (!last || Math.hypot(observer.x - last.x, observer.z - last.z) > 12) {
      last = { x: observer.x, z: observer.z };
      const wanted = nearestParked(cars, observer.x, observer.z, capacity, radius), keep = new Set(wanted.map(car => car.key));
      for (let slot = 0; slot < capacity; slot++) { const car = slots[slot]; if (car && !keep.has(car.key)) { unsolid(slot); fleet.hide(slot); bySlot.delete(car.key); slots[slot] = undefined; } }
      for (const car of wanted) {
        let slot = bySlot.get(car.key);
        if (slot === undefined) {
          // its own type's slot where one is free, else whichever is
          slot = slots.findIndex((taken, i) => !taken && SLOT_TYPES[i % SLOT_TYPES.length] === car.spec.type); if (slot < 0) slot = slots.findIndex(taken => !taken); if (slot < 0) continue;
          slots[slot] = car; bySlot.set(car.key, slot);
        }
        place(slot, car, observer);
      }
      fleet.flush(); elapsed = 1;
    }
    if (elapsed >= .5) {
      elapsed = 0;
      for (let slot = 0; slot < capacity; slot++) { const car = slots[slot]; if (!car) continue; const d = Math.hypot(car.x - observer.x, car.z - observer.z); if (d < SOLID) solid(slot, car); else if (d > SOLID + 20) unsolid(slot); }
    }
  }
  return {
    group, update,
    /** Collider handles of the parked cars that are solid now, so an impact can be classified as a vehicle. */
    colliders,
    get count() { return bySlot.size; },
    /** Diagnostics: the cars drawn now. */
    get cars() { return slots.filter((car): car is ParkedCar => !!car).map(car => ({ x: car.x, z: car.z, yaw: car.yaw, type: car.spec.type })); },
    get stalls() { return cars.length; },
    /** Diagnostics: the tiles whose stall lines are drawn. */
    get striped() { return [...striped].filter(([, mesh]) => mesh).length; },
  };
}
