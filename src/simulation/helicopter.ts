import RAPIER from '@dimforge/rapier3d-compat';
import type { CityData, Point2 } from '../types';
import type { DrivingPhysics } from '../physics/vehicle';
import { buildingBaseElevation, sampleElevation, sampleTerrainNormal, terrainGrid, terrainRange } from './terrain.ts';
import { isMetroCity, type IndexedBuilding, type MetroCity } from './city-tiles.ts';

export interface FlightInput { forward: number; strafe: number; turn: number; lift: number; }
export interface HelicopterState {
  x: number; y: number; z: number; yaw: number; speed: number; verticalSpeed: number; bank: number; pitch: number;
}
export const HELICOPTER = {
  radius: 5.4, verticalClearance: 2.4, minimumAltitude: 4, maximumAltitude: 350,
  // Simulation speeds are metres per second; forward cruise is 120 mph.
  cruiseSpeed: 120 * .44704, reverseSpeed: 18, strafeSpeed: 22, climbSpeed: 10, descentSpeed: 8,
};
type Position = { x: number; y: number; z: number };
type Hit = { t: number; nx: number; ny: number; nz: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const axis = (value: number) => Number.isFinite(value) ? clamp(value, -1, 1) : 0;
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
function inside(x: number, z: number, polygon: Point2[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function edgeDistance(x: number, z: number, a: Point2, b: Point2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** Assisted flight, with continuous swept rotor clearance against surveyed buildings. */
export function createHelicopterFlight(city: CityData, physics: DrivingPhysics) {
  const { radius, verticalClearance, minimumAltitude } = HELICOPTER;
  const grid = terrainGrid(city), elevationRange = terrainRange(city);
  const maximumAltitude = Math.max(0, elevationRange.max) + HELICOPTER.maximumAltitude;
  const absoluteFloor = elevationRange.min + minimumAltitude;
  const diagonal = radius / Math.SQRT2;
  const supports: Point2[] = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius],
    [diagonal, diagonal], [-diagonal, diagonal], [diagonal, -diagonal], [-diagonal, -diagonal]];
  const terrainFloor = (x: number, z: number) => minimumAltitude + Math.max(...supports.map(([dx, dz]) => sampleElevation(city, x + dx, z + dz)));
  const launchHeight = () => sampleElevation(city, city.spawn.x, city.spawn.z) + 20;
  type Obstacle = { polygon: Point2[]; top: number; minX: number; maxX: number; minZ: number; maxZ: number };
  const obstacle = (polygon: Point2[], top: number): Obstacle => ({
    polygon, top: top + verticalClearance,
    minX: Math.min(...polygon.map(p => p[0])) - radius, maxX: Math.max(...polygon.map(p => p[0])) + radius,
    minZ: Math.min(...polygon.map(p => p[1])) - radius, maxZ: Math.max(...polygon.map(p => p[1])) + radius,
  });
  // A metro city answers from its hull index whether or not a tile is loaded;
  // exact-mesh complexes are queried through their colliders instead.
  const staticObstacles = isMetroCity(city) ? undefined : city.buildings.filter(b => b.footprint.length >= 3 && b.height > 0 && !physics.meshBuildingIds.has(b.id)).map(b => obstacle(b.footprint, buildingBaseElevation(city, b) + b.height));
  const indexed = new WeakMap<IndexedBuilding, Obstacle | null>();
  const obstaclesIn = (minX: number, maxX: number, minZ: number, maxZ: number): Obstacle[] => {
    if (staticObstacles) return staticObstacles;
    const result: Obstacle[] = [];
    for (const b of (city as MetroCity).index.query(minX - radius, maxX + radius, minZ - radius, maxZ + radius)) {
      let record = indexed.get(b);
      if (record === undefined) { record = b.exactMesh || b.footprint.length < 3 || b.height <= 0 ? null : obstacle(b.footprint, b.base + b.height); indexed.set(b, record); }
      if (record) result.push(record);
    }
    return result;
  };
  const bounds = { minX: city.bounds.minX + radius, maxX: city.bounds.maxX - radius, minZ: city.bounds.minZ + radius, maxZ: city.bounds.maxZ - radius };
  const overlaps = (x: number, z: number, building: Obstacle) =>
    x >= building.minX && x <= building.maxX && z >= building.minZ && z <= building.maxZ &&
    (inside(x, z, building.polygon) || building.polygon.some((a, i, points) => edgeDistance(x, z, a, points[(i + 1) % points.length]) <= radius + .001));
  const current: HelicopterState = { x: city.spawn.x, y: launchHeight(), z: city.spawn.z, yaw: city.spawn.yaw, speed: 0, verticalSpeed: 0, bank: 0, pitch: 0 };
  let vx = 0, vy = 0, vz = 0, yawSpeed = 0;
  // Rapier carries the cabin in the shared world. Flight clearance uses analytic
  // sweeps, so it stays valid before/after a physics step and cannot skip thin walls.
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(.45, 1.0).setFriction(.5), body);
  const clearanceShape=new RAPIER.Cylinder(verticalClearance,radius),identity={x:0,y:0,z:0,w:1};
  const isDetail=(candidate:RAPIER.Collider)=>physics.detailedColliders.has(candidate.handle);

  function safePosition(requested: Position): Position {
    const inspect = (x: number, z: number, y: number): Position | undefined => {
      x = clamp(x, bounds.minX, bounds.maxX); z = clamp(z, bounds.minZ, bounds.maxZ);
      y = Math.max(y, terrainFloor(x, z));
      for (const building of obstaclesIn(x, x, z, z)) if (overlaps(x, z, building)) y = Math.max(y, building.top + .2);
      // Exact source complexes may contain a street-sized opening. Query their
      // triangles rather than filling the opening with their footprint's roof.
      if(physics.detailedColliders.size){
        const ceiling=maximumAltitude+verticalClearance+.5;
        const hit=physics.world.castShape({x,y:ceiling,z},identity,{x:0,y:y-ceiling,z:0},clearanceShape,.01,1,true,undefined,undefined,collider,body,isDetail);
        if(hit)y=Math.max(y,ceiling+(y-ceiling)*hit.time_of_impact+.02);
      }
      return y <= maximumAltitude ? { x, y: clamp(y, absoluteFloor, maximumAltitude), z } : undefined;
    };
    const direct = inspect(requested.x, requested.z, requested.y); if (direct) return direct;
    const home = inspect(city.spawn.x, city.spawn.z, launchHeight()); if (home) return home;
    // A very tall building under a requested reset must not put the aircraft
    // inside it at the ceiling. Search actual road centers for a safe launch.
    for (const road of city.roads) for (const [x, z] of road.points) { const clear = inspect(x, z, sampleElevation(city, x, z) + 20); if (clear) return clear; }
    throw new Error('No clear helicopter launch position inside the district.');
  }
  function reset(position?: Position, yaw = city.spawn.yaw) {
    const requested = position && [position.x, position.y, position.z].every(Number.isFinite) ? position : { x: city.spawn.x, y: launchHeight(), z: city.spawn.z };
    const safe = safePosition({ x: requested.x, y: clamp(requested.y, absoluteFloor, maximumAltitude), z: requested.z });
    Object.assign(current, safe, { yaw: Number.isFinite(yaw) ? angle(yaw) : city.spawn.yaw, speed: 0, verticalSpeed: 0, bank: 0, pitch: 0 });
    vx = vy = vz = yawSpeed = 0;
    body.setTranslation(safe, true); body.setRotation({ x: 0, y: Math.sin(current.yaw / 2), z: 0, w: Math.cos(current.yaw / 2) }, true);
    body.setNextKinematicTranslation(safe); body.setNextKinematicRotation(body.rotation());
  }

  function sweep(start: Position, delta: Position): Hit | undefined {
    let hit: Hit | undefined;
    const accept = (t: number, nx: number, ny: number, nz: number) => {
      if (t < -1e-8 || t > 1 || (hit && t >= hit.t) || nx * delta.x + ny * delta.y + nz * delta.z >= -1e-10) return;
      hit = { t: Math.max(0, t), nx, ny, nz };
    };
    if (delta.x < 0) accept((bounds.minX - start.x) / delta.x, 1, 0, 0);
    if (delta.x > 0) accept((bounds.maxX - start.x) / delta.x, -1, 0, 0);
    if (delta.z < 0) accept((bounds.minZ - start.z) / delta.z, 0, 0, 1);
    if (delta.z > 0) accept((bounds.maxZ - start.z) / delta.z, 0, 0, -1);
    if (!grid) {
      if (delta.y < 0) accept((minimumAltitude - start.y) / delta.y, 0, 1, 0);
    } else if (Math.min(start.y, start.y + delta.y) <= elevationRange.max + minimumAltitude) {
      // Each support follows a piecewise planar heightfield. Split its sweep at
      // all grid/diagonal crossings, then solve the exact linear clearance root.
      // Checking endpoints alone would skip a narrow ridge between two valleys.
      for (const [ox, oz] of supports) {
        const parameters = [0, 1];
        const crossings = (origin: number, change: number) => {
          if (Math.abs(change) < 1e-12) return;
          const end = origin + change;
          for (let k = Math.ceil(Math.min(origin, end)); k <= Math.floor(Math.max(origin, end)); k++) {
            const t = (k - origin) / change; if (t > 1e-9 && t < 1 - 1e-9) parameters.push(t);
          }
        };
        const x0 = (start.x + ox - grid.originX) / grid.cellSize, z0 = (start.z + oz - grid.originZ) / grid.cellSize;
        crossings(x0, delta.x / grid.cellSize); crossings(z0, delta.z / grid.cellSize);
        crossings(x0 + z0, (delta.x + delta.z) / grid.cellSize);
        parameters.sort((a, b) => a - b);
        for (let k = 1; k < parameters.length; k++) {
          const a = parameters[k - 1], b = parameters[k]; if (b - a < 1e-10) continue;
          const clearance = (t: number) => start.y + delta.y * t - sampleElevation(city, start.x + ox + delta.x * t, start.z + oz + delta.z * t) - minimumAltitude;
          const ca = clearance(a), cb = clearance(b);
          if (cb >= 0 || ca < -.001) continue;
          const t = a + Math.max(0, ca) / (ca - cb || 1) * (b - a);
          const mid = (a + b) / 2;
          const normal = sampleTerrainNormal(city, start.x + ox + delta.x * mid, start.z + oz + delta.z * mid);
          accept(t, normal.x, normal.y, normal.z);
        }
      }
    }
    if (delta.y > 0) accept((maximumAltitude - start.y) / delta.y, 0, -1, 0);
    // The same closed bridge decks and exact complex walls support both driving
    // and flight. A kinematic cabin does not receive collision response itself.
    if(physics.detailedColliders.size){
      const detail=physics.world.castShape(start,identity,delta,clearanceShape,.01,1,true,undefined,undefined,collider,body,isDetail);
      if(detail)accept(detail.time_of_impact,detail.normal1.x,detail.normal1.y,detail.normal1.z);
    }
    for (const building of obstaclesIn(Math.min(start.x, start.x + delta.x), Math.max(start.x, start.x + delta.x), Math.min(start.z, start.z + delta.z), Math.max(start.z, start.z + delta.z))) {
      if (Math.min(start.y, start.y + delta.y) > building.top + .001 ||
        Math.max(start.x, start.x + delta.x) < building.minX || Math.min(start.x, start.x + delta.x) > building.maxX ||
        Math.max(start.z, start.z + delta.z) < building.minZ || Math.min(start.z, start.z + delta.z) > building.maxZ) continue;
      if (delta.y < 0) {
        const t = (building.top - start.y) / delta.y;
        if (t >= 0 && t <= 1 && overlaps(start.x + delta.x * t, start.z + delta.z * t, building)) accept(t, 0, 1, 0);
      }
      const side = (t: number, nx: number, nz: number) => {
        if (start.y + delta.y * t <= building.top + .001) accept(t, nx, 0, nz);
      };
      for (let i = 0; i < building.polygon.length; i++) {
        const a = building.polygon[i], b = building.polygon[(i + 1) % building.polygon.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], length = Math.hypot(ex, ez);
        if (length < 1e-7) continue;
        const ux = ex / length, uz = ez / length, nx = -uz, nz = ux;
        const signedDistance = (start.x - a[0]) * nx + (start.z - a[1]) * nz;
        const rate = delta.x * nx + delta.z * nz;
        if (Math.abs(rate) > 1e-10) for (const sign of [-1, 1]) {
          const t = (sign * radius - signedDistance) / rate;
          if (t < 0 || t > 1) continue;
          const along = (start.x + delta.x * t - a[0]) * ux + (start.z + delta.z * t - a[1]) * uz;
          if (along >= 0 && along <= length) side(t, nx * sign, nz * sign);
        }
        // Circular edge caps protect polygon corners, including diagonal sweeps.
        const px = start.x - a[0], pz = start.z - a[1];
        const aa = delta.x * delta.x + delta.z * delta.z;
        if (aa < 1e-14) continue;
        const bb = 2 * (px * delta.x + pz * delta.z), cc = px * px + pz * pz - radius * radius;
        const discriminant = bb * bb - 4 * aa * cc;
        if (discriminant >= 0) {
          const t = (-bb - Math.sqrt(discriminant)) / (2 * aa);
          if (t >= 0 && t <= 1) side(t, (px + delta.x * t) / radius, (pz + delta.z * t) / radius);
        }
      }
    }
    return hit;
  }
  function move(delta: Position) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const length = Math.hypot(delta.x, delta.y, delta.z); if (length < 1e-8) break;
      const hit = sweep(current, delta);
      if (!hit) { current.x += delta.x; current.y += delta.y; current.z += delta.z; break; }
      const safe = Math.max(0, hit.t - .005 / length);
      current.x += delta.x * safe; current.y += delta.y * safe; current.z += delta.z * safe;
      delta = { x: delta.x * (1 - hit.t), y: delta.y * (1 - hit.t), z: delta.z * (1 - hit.t) };
      const into = Math.min(0, delta.x * hit.nx + delta.y * hit.ny + delta.z * hit.nz);
      delta.x -= hit.nx * into; delta.y -= hit.ny * into; delta.z -= hit.nz * into;
      const velocityInto = Math.min(0, vx * hit.nx + vy * hit.ny + vz * hit.nz);
      vx -= hit.nx * velocityInto; vy -= hit.ny * velocityInto; vz -= hit.nz * velocityInto;
    }
  }
  function update(dt: number, input: FlightInput) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const duration = Math.min(dt, .25), steps = Math.max(1, Math.ceil(duration * 120)), step = duration / steps;
    const forward = axis(input.forward), strafe = axis(input.strafe), turn = axis(input.turn), lift = axis(input.lift);
    for (let i = 0; i < steps; i++) {
      yawSpeed += (-turn * .85 - yawSpeed) * (1 - Math.exp(-5 * step));
      current.yaw = angle(current.yaw + yawSpeed * step);
      const f = forward * (forward >= 0 ? HELICOPTER.cruiseSpeed : HELICOPTER.reverseSpeed);
      const s = strafe * HELICOPTER.strafeSpeed;
      let tx = Math.sin(current.yaw) * f - Math.cos(current.yaw) * s;
      let tz = Math.cos(current.yaw) * f + Math.sin(current.yaw) * s;
      const targetLength = Math.hypot(tx, tz);
      if (targetLength > HELICOPTER.cruiseSpeed) { tx *= HELICOPTER.cruiseSpeed / targetLength; tz *= HELICOPTER.cruiseSpeed / targetLength; }
      const previousX = vx, previousY = vy, previousZ = vz;
      let ax = (tx - vx) * 1.5, az = (tz - vz) * 1.5;
      const acceleration = Math.hypot(ax, az);
      if (acceleration > 9) { ax *= 9 / acceleration; az *= 9 / acceleration; }
      vx += ax * step; vz += az * step;
      const targetY = lift * (lift >= 0 ? HELICOPTER.climbSpeed : HELICOPTER.descentSpeed);
      vy += clamp((targetY - vy) * 2.2, -7, 7) * step;
      move({ x: (previousX + vx) * .5 * step, y: (previousY + vy) * .5 * step, z: (previousZ + vz) * .5 * step });
      const smooth = 1 - Math.exp(-4 * step);
      current.bank += (strafe * .24 + turn * .07 - current.bank) * smooth;
      current.pitch += (forward * .18 - current.pitch) * smooth;
    }
    current.speed = Math.hypot(vx, vz); current.verticalSpeed = vy;
    body.setNextKinematicTranslation(current);
    body.setNextKinematicRotation({ x: 0, y: Math.sin(current.yaw / 2), z: 0, w: Math.cos(current.yaw / 2) });
  }
  reset();
  return {
    body, collider, update, reset,
    get state(): HelicopterState { return { ...current }; },
    dispose() { physics.world.removeRigidBody(body); },
  };
}
