import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Ray } from '@dimforge/rapier3d-compat';
import { sampleElevation, sampleBilinearElevation } from '../src/simulation/terrain.ts';
import { DrivingPhysics } from '../src/physics/vehicle.ts';
import { createTraffic } from '../src/simulation/traffic.ts';
import { createStreetLife } from '../src/render/street-life.ts';
import { pointInside } from '../src/simulation/roads.ts';

import {loadCentralCity} from './helpers/metro-city.mjs';
const STEP = 1 / 60;
const released = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const flatCity = {
  bounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 },
  buildings: [],
  spawn: { x: 0, z: 0, yaw: 0 },
};

function advance(physics, seconds, input = released, dt = STEP) {
  for (let i = 0; i < Math.round(seconds / dt); i++) physics.step(input, dt);
  return physics.getState();
}

test('the imported Back Bay spawn is driveable, with braking and reverse', async () => {
  const city = await loadCentralCity();
  const physics = await DrivingPhysics.create(city);
  try {
    const start = advance(physics, 2);
    assert.ok(start.y > 0.4 && start.y < 1, 'the car must settle on the road, not a roof or inside a building');
    assert.ok([0, 1, 2, 3].every(i => physics.controller.wheelIsInContact(i)), 'all wheels must contact the road');
    const forward = advance(physics, 3, { ...released, throttle: 1 });
    const travel = (forward.x - start.x) * Math.sin(start.yaw) + (forward.z - start.z) * Math.cos(start.yaw);
    assert.ok(travel > 20 && travel < 40, `three-second forward travel was ${travel} m`);
    assert.ok(forward.speed > 10 && forward.speed < 22);

    const stopped = advance(physics, 3, { ...released, brake: 1 });
    assert.ok(Math.abs(stopped.speed) < 0.2, 'brakes must stop the car');
    const reverse = advance(physics, 2, { ...released, throttle: -1 });
    const reverseTravel = (reverse.x - stopped.x) * Math.sin(stopped.yaw) + (reverse.z - stopped.z) * Math.cos(stopped.yaw);
    assert.ok(reverse.speed < -2, 'reverse must produce backwards motion');
    assert.ok(reverseTravel < -5, 'reverse must move the body, not only the visual wheels');
    assert.ok([reverse.x, reverse.y, reverse.z, reverse.yaw].every(Number.isFinite));
  } finally {
    physics.dispose();
  }
});

test('reverse input keeps a forward gear while braking before actual reversal',async()=>{
  const physics=await DrivingPhysics.create(flatCity);
  try{
    const forward=advance(physics,4,{...released,throttle:1});assert.ok(forward.speed>15&&forward.gear>=3);
    const braking=advance(physics,.5,{...released,throttle:-1});
    assert.ok(braking.speed>10&&braking.speed<forward.speed,'reverse input first brakes the forward-moving car');
    assert.ok(braking.gear>0,'holding reverse while moving forward cannot select R');
    assert.ok(braking.rpm<5000,'braking RPM must use the forward gear ratio');
    let reverse=braking;
    for(let i=0;i<6*60&&reverse.speed>=-2;i++){
      reverse=advance(physics,STEP,{...released,throttle:-1});
      if(reverse.speed>.5)assert.ok(reverse.gear>0);
    }
    assert.ok(reverse.speed<-2&&reverse.gear===-1,'R engages after slowing through standstill and reversing');
  }finally{physics.dispose();}
});

test('Mission Hill reverse descent stops promptly with the handbrake and stays parked',async()=>{
  const city=await loadCentralCity();
  const arrival=city.landmarks.find(l=>l.id==='mission-hill').driveStart,physics=await DrivingPhysics.create(city);
  try{
    physics.reset(arrival.x,arrival.z,arrival.yaw);const start=advance(physics,1,{...released,brake:1});
    const along=state=>(state.x-start.x)*Math.sin(start.yaw)+(state.z-start.z)*Math.cos(start.yaw);
    let forward=start;
    for(let i=0;i<10*60&&along(forward)<=12;i++)forward=advance(physics,STEP,{...released,throttle:1});
    assert.ok(along(forward)>12&&forward.speed>8,'actual destination must drive uphill before reversing');
    let reverse=forward;
    for(let i=0;i<10*60&&(reverse.speed>=-1||along(reverse)>=4);i++)reverse=advance(physics,STEP,{...released,throttle:-1});
    assert.ok(reverse.speed<-7&&along(reverse)<4,'reproduce an eight-metre-per-second reverse descent');
    const stopped=advance(physics,2,{...released,handbrake:true});
    assert.ok(Math.abs(stopped.speed)<.05,'handbrake must arrest reverse motion on the real grade');
    assert.ok(Math.hypot(stopped.x-reverse.x,stopped.z-reverse.z)<6,'rear-wheel braking must stop within six metres');
    const startGround=sampleElevation(city,start.x,start.z),uphillChange=sampleElevation(city,forward.x,forward.z)-startGround;
    assert.ok(Math.abs(sampleElevation(city,stopped.x,stopped.z)-startGround)<Math.abs(uphillChange)+.2,'return stays near the starting elevation, matching browser behavior');
    const parked=advance(physics,20,{...released,handbrake:true});
    assert.ok(Math.hypot(parked.x-stopped.x,parked.z-stopped.z)<.05,'parking brake must hold the slope without continual creep');
    assert.ok(Math.abs(parked.speed)<.01);
    const moving=advance(physics,1,{...released,throttle:1});assert.ok(moving.speed>2,'releasing the brake must restore ordinary driving');
  }finally{physics.dispose();}
});

test('a fast car cannot tunnel through a building collision proxy', async () => {
  const wall = {
    id: 'test-wall', name: 'Test wall', center: [0, 41.5], height: 10,
    footprint: [[-30, 40], [30, 40], [30, 43], [-30, 43]],
  };
  const physics = await DrivingPhysics.create({ ...flatCity, buildings: [wall] });
  try {
    const state = advance(physics, 10, { ...released, throttle: 1 });
    assert.ok(state.z > 35 && state.z < 39, `car stopped at z=${state.z}, before the wall at z=40`);
    assert.ok(Math.abs(state.speed) < 1, 'continued throttle must not drive through the wall');
    assert.ok(state.y > 0.3 && state.y < 2, 'collision must remain stable on the ground');
  } finally {
    physics.dispose();
  }
});

test('reset restores the requested heading and removes residual momentum', async () => {
  const physics = await DrivingPhysics.create(flatCity);
  try {
    advance(physics, 2, { ...released, throttle: 1, steer: 0.5 });
    physics.reset(2, 4, Math.PI / 2);
    const state = advance(physics, 2);
    assert.ok(Math.abs(state.x - 2) < 0.1 && Math.abs(state.z - 4) < 0.1);
    assert.ok(Math.abs(state.yaw - Math.PI / 2) < 0.01);
    assert.ok(Math.abs(state.speed) < 0.01);
    assert.ok(Math.abs(state.steering) < 0.001);
    assert.ok(Math.abs(physics.body.angvel().y) < 0.01);
  } finally {
    physics.dispose();
  }
});

test('60 Hz and 120 Hz physics produce similar forward travel', async () => {
  async function run(dt) {
    const physics = await DrivingPhysics.create(flatCity);
    try {
      return advance(physics, 6, { ...released, throttle: 1 }, dt);
    } finally {
      physics.dispose();
    }
  }
  const sixty = await run(1 / 60);
  const oneTwenty = await run(1 / 120);
  assert.ok(Math.abs(sixty.z - oneTwenty.z) < 0.5, 'physics frequency should not materially change travel');
  assert.ok(Math.abs(sixty.speed - oneTwenty.speed) < 0.25);
});

function trafficPositions(scene, count) {
  const mesh = scene.getObjectByName('AmbientTraffic').children[0];
  const matrix = new THREE.Matrix4();
  return Array.from({ length: count }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    assert.ok(matrix.elements.every(Number.isFinite));
    return [matrix.elements[12], matrix.elements[14]];
  });
}

test('ambient traffic stops before a parked player and stays within imported roads', async () => {
  const city = await loadCentralCity();
  const physics = await DrivingPhysics.create(city);
  const scene = new THREE.Scene();
  const traffic = createTraffic(scene, city, physics);
  try {
    traffic.update(STEP, physics.getState());
    const matrix = new THREE.Matrix4();
    scene.getObjectByName('AmbientTraffic').children[0].getMatrixAt(0, matrix);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
    matrix.decompose(position, quaternion, new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    physics.reset(position.x + direction.x * 12, position.z + direction.z * 12, Math.atan2(direction.x, direction.z));
    const parked = physics.getState();
    let closest = Infinity;
    for (let step = 0; step < 20 * 60; step++) {
      traffic.update(STEP, physics.getState());
      // The expanded district includes steep streets. A parked car must hold
      // its brakes; coasting would test gravity, not following distance.
      physics.step({ ...released, brake: 1, handbrake: true }, STEP);
      const positions = trafficPositions(scene, traffic.count);
      closest = Math.min(closest, Math.hypot(positions[0][0] - parked.x, positions[0][1] - parked.z));
      if (step % 60 !== 0) continue;
      for (const [x, z] of positions) {
        let outside = Infinity;
        for (const road of city.roads) for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
          outside = Math.min(outside, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - road.width / 2);
        }
        assert.ok(outside < 0.25, `traffic center left the road by ${outside} m`);
      }
    }
    const end = physics.getState();
    assert.ok(closest > 5, 'following traffic must leave a gap before touching the player');
    assert.ok(Math.hypot(end.x - parked.x, end.z - parked.z) < 0.3, 'kinematic traffic must not push a parked player');
  } finally {
    traffic.dispose();
    physics.dispose();
  }
});

test('traffic waits through the shared red phase and resumes on green', async () => {
  // Control the signal approaches independently of where a growing real-world
  // dataset happens to distribute its bounded ambient vehicles.
  const city={...flatCity,spawn:{x:-500,z:-500,yaw:0},roads:[],signals:[]};
  const coordinates=[-75,0,75];
  for(const x of coordinates)for(const z of coordinates)city.signals.push([x,z]);
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){
    city.roads.push({id:`east-${i}-${j}`,name:`Avenue ${i}`,width:14,oneway:0,points:[[coordinates[j],coordinates[i]],[coordinates[j+1],coordinates[i]]]});
    city.roads.push({id:`north-${i}-${j}`,name:`Street ${i}`,width:14,oneway:0,points:[[coordinates[i],coordinates[j]],[coordinates[i],coordinates[j+1]]]});
  }
  const physics = await DrivingPhysics.create(city);
  const scene = new THREE.Scene();
  const traffic = createTraffic(scene, city, physics);
  try {
    const stopped=new Map(),resumed=new Set();
    for(let step=1;step<=65*60;step++){
      traffic.update(STEP,physics.getState());physics.step(released,STEP);
      if(step%15)continue;
      traffic.snapshot().forEach((actor,index)=>{
        if(actor.signal==='red'&&actor.stopGap<2&&actor.speed<.12)stopped.set(index,{x:actor.x,z:actor.z});
        const waiting=stopped.get(index);
        if(waiting&&actor.signal==='green'&&Math.hypot(actor.x-waiting.x,actor.z-waiting.z)>2)resumed.add(index);
      });
    }
    assert.ok(stopped.size>=2,'at least two vehicles must wait behind their own red approach');
    assert.ok(resumed.size>=2,'waiting vehicles must move again on their own green approach');

  } finally {
    traffic.dispose();
    physics.dispose();
  }
});


test('street life stays on clear sidewalks and parked cars block the player', async () => {
  const city = await loadCentralCity();
  const physics = await DrivingPhysics.create(city);
  const life = createStreetLife(new THREE.Scene(), city, physics);
  try {
    assert.ok(life.count >= 72 && life.count <= 112, 'the city should keep a bounded crowd with enough walkers for busy neighborhoods');
    assert.ok(life.parkedCount >= 6 && life.parkedCount <= 8, 'only verified curb spaces should receive parked cars');
    const roadSegments = city.roads.flatMap(road => road.points.slice(1).map((b, i) => ({ a: road.points[i], b, width: road.width })));
    for (let time = 0; time <= 160; time += 2) {
      life.update(2, time);
      for (const pedestrian of life.pedestrians) {
        const point = [pedestrian.position.x, pedestrian.position.z];
        assert.ok(point.every(Number.isFinite));
        assert.ok(!city.buildings.some(building => pointInside(point, building.footprint)), 'walkers must stay outside surveyed buildings');
        for (const { a, b, width } of roadSegments) {
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
          assert.ok(Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t) > width / 2 + .35,
            'walkers must leave room between their centers and the road edge, including at turns');
        }
      }
    }
    const parked = life.parked[0];
    physics.reset(parked.x - Math.sin(parked.yaw) * 12, parked.z - Math.cos(parked.yaw) * 12, parked.yaw);
    const state = advance(physics, 4, { ...released, throttle: 1 });
    const separation = Math.hypot(state.x - parked.x, state.z - parked.z);
    assert.ok(separation > 3.9 && separation < 4.6, `the parked car should stop the player at its bumper (gap ${separation} m)`);
    assert.ok(Math.abs(state.speed) < .15, 'continued throttle must not pass through a parked car');
  } finally {
    life.dispose();
    physics.dispose();
  }
});


test('terrain height queries match Rapier rays on both halves of a nonplanar grid cell', async () => {
  const city = { ...flatCity, bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, spawn: { x: 1, z: 1, yaw: 0 },
    elevation: { width: 2, height: 2, cellSize: 10, originX: 0, originZ: 0, heights: [0, 4, 2, 10] } };
  const physics = await DrivingPhysics.create(city);
  try {
    assert.equal(sampleElevation(city, 5, 5), 3, 'the shared mesh diagonal must define the surface');
    assert.equal(sampleBilinearElevation(city, 5, 5), 4, 'bilinear interpolation is a separate inspection API');
    for (const [x, z] of [[2, 3], [8, 7], [5, 5], [9, 2]]) {
      const hit = physics.world.castRay(new Ray({ x, y: 30, z }, { x: 0, y: -1, z: 0 }), 50, true,
        undefined, undefined, physics.chassisCollider, physics.body);
      assert.ok(hit, 'the collision terrain must cover each rendered cell');
      assert.ok(Math.abs(30 - hit.timeOfImpact - sampleElevation(city, x, z)) < .0001, 'render queries and the collision surface must use the same diagonal and datum');
    }
  } finally { physics.dispose(); }
});

test('the raycast car follows a raised slope and collides with buildings at their elevated base', async () => {
  const heights = [];
  for (let z = -120; z <= 120; z += 10) for (let x = -120; x <= 120; x += 10) heights.push(100 + .04 * x + .1 * z);
  const wall = { id: 'hill-wall', name: 'Hill wall', center: [0, 41.5], baseElevation: 108, height: 8,
    footprint: [[-25, 40], [25, 40], [25, 43], [-25, 43]] };
  const city = { ...flatCity, bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, buildings: [wall],
    elevation: { width: 25, height: 25, cellSize: 10, originX: -120, originZ: -120, heights } };
  const physics = await DrivingPhysics.create(city);
  try {
    const start = advance(physics, 2, { ...released, brake: 1 });
    assert.ok(start.y > 100.5 && start.y < 100.9, 'spawn must sit above the elevated surface');
    assert.ok([0, 1, 2, 3].every(i => physics.controller.wheelIsInContact(i)));
    const climbing = advance(physics, 3, { ...released, throttle: 1 });
    assert.ok(climbing.z > 18 && climbing.y > start.y + 1.5, 'driving uphill must gain real elevation');
    assert.ok(climbing.rotation.x < -.025, 'wheel support must pitch the car uphill');
    assert.ok(Math.abs(climbing.y - sampleElevation(city, climbing.x, climbing.z) - .67) < .15);
    // Full throttle until the hit, then brake: the crash kick may stand the car on its nose and
    // land it turned, and a held throttle would then scrape it along the wall.
    let hit = null, maxZ = -Infinity;
    for (let i = 0; i < 60 * 5; i++) { physics.step({ ...released, ...(hit ? { brake: 1 } : { throttle: 1 }) }, 1 / 60); maxZ = Math.max(maxZ, physics.getState().z); hit ??= physics.takeImpacts()[0] ?? null; }
    const stopped = physics.getState();
    assert.ok(hit && hit.colliders.length, 'the car strikes the foundation');
    assert.ok(maxZ < 39.5 && stopped.z > 35 && stopped.z < 39 && Math.abs(stopped.speed) < 1, `the foundation below a level base at 108 m must stop the car on ground at 104 m (max z ${maxZ.toFixed(2)}, stopped at ${stopped.z.toFixed(2)})`);
    physics.reset(4, -20, Math.PI);
    const reset = advance(physics, 2, { ...released, brake: 1 });
    assert.ok(Math.abs(reset.y - sampleElevation(city, reset.x, reset.z) - .67) < .15, 'reset must preserve terrain alignment at another elevation');
  } finally { physics.dispose(); }
});

test('the imported Parker Hill Avenue supports uphill driving, downhill driving and braking', async t => {
  const city = await loadCentralCity();
  const physics = await DrivingPhysics.create(city);
  try {
    for (const roadId of ['16540-0-0', '4953-0-0']) for (const direction of [1, -1]) {
      const road = city.roads.find(road => road.id === roadId);
      assert.equal(road?.name, 'Parker Hill Avenue', 'exercise the surveyed Mission Hill street, with its real terrain and buildings');
      const [a, b] = road.points, dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      const fraction = direction === 1 ? .17 : .83;
      const yaw = Math.atan2(dx * direction, dz * direction);
      physics.reset(a[0] + dx * fraction - dz / length * direction * 1.3,
        a[1] + dz * fraction + dx / length * direction * 1.3, yaw);
      const start = advance(physics, 1, { ...released, brake: 1 });
      // The graded roadbed keeps the surveyed bases of the triple-deckers lining
      // the hill, which leaves short humps mid-block; at speed the car may hop
      // over one for a few frames, but it must never leave the street for long.
      let airborne = 0, longestHop = 0;
      for (let i = 0; i < 180; i++) {
        physics.step({ ...released, throttle: 1 }, STEP);
        airborne = [0, 1, 2, 3].some(w => physics.controller.wheelIsInContact(w)) ? 0 : airborne + 1; longestHop = Math.max(longestHop, airborne);
      }
      const moving = physics.getState();
      const travel = (moving.x - start.x) * Math.sin(yaw) + (moving.z - start.z) * Math.cos(yaw);
      assert.ok(travel > 17 && travel < 40, 'the car must travel along the street without a collision or rescue reset');
      assert.ok((moving.y - start.y) * direction > 2.5, 'height must follow the actual hill in each direction');
      assert.ok(Math.abs(moving.y - sampleElevation(city, moving.x, moving.z) - .67) < .15, 'wheels must remain supported on the measured surface');
      assert.ok(longestHop <= 15, `the car must not fly over the graded humps: ${longestHop} frames airborne`);
      assert.ok([0, 1, 2, 3].filter(i => physics.controller.wheelIsInContact(i)).length >= 3, 'the raycast wheels must settle back onto the road');
      const stopped = advance(physics, 3, { ...released, brake: 1 });
      assert.ok(Math.abs(stopped.speed) < .15, 'brakes must stop and hold on the hill in either direction');
      assert.ok(stopped.y > 8, 'braking and reset must retain the Mission Hill elevation datum');
      t.diagnostic(`${roadId} ${direction === 1 ? 'uphill' : 'downhill'}: ${travel.toFixed(1)} m travelled, ${(moving.y - start.y).toFixed(2)} m elevation change, ${stopped.speed.toFixed(3)} m/s after braking.`);
    }
  } finally { physics.dispose(); }
});
