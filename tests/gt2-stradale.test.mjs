import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { DrivingPhysics, carSteeringLimit } from '../src/physics/vehicle.ts';
import { createCar } from '../src/render/car.ts';
import { GT2_STRADALE } from '../src/render/maserati-gt2-stradale.ts';
import { DriveAudio } from '../src/simulation/audio.ts';
import { GT2, gt2Boost, gt2Downforce, gt2Gear, gt2Gearing, gt2Rpm, gt2Torque } from '../src/simulation/gt2-powertrain.ts';
import { PLAYER_CARS, CAR_POWERTRAINS, ENGINES, carGear, carRpm, gearing } from '../src/simulation/player-cars.ts';

// Maserati GT2 Stradale: the published figures the car is built to, on level ground (public/models/PLAYER_CARS.md).
const id = 'maserati-gt2-stradale', spec = PLAYER_CARS[id], G = 9.81, MPH = .44704, KMH = 1 / 3.6;
const city = { bounds: { minX: -40000, maxX: 40000, minZ: -40000, maxZ: 40000 }, buildings: [], spawn: { x: 0, z: 0, yaw: 0 } };
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false }, full = { ...idle, throttle: 1 };
const advance = (car, input, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) car.step({ ...idle, ...input }, dt); return car.getState(); };
async function fresh() { const car = await DrivingPhysics.create(city); car.setCar(id); advance(car, idle, 2); return car; }

test('the Nettuno has its published torque plateau, rated power and gearing, and the gearbox its eight ratios', () => {
  for (const rpm of [3000, 4200, 5500]) assert.equal(gt2Torque(rpm, 1), 720);
  assert.ok(Math.abs(gt2Torque(7500, 1) * 7500 * Math.PI / 30 - 471000) < 1, '640 PS at 7,500 rpm');
  let peak = 0; for (let rpm = 1000; rpm <= 8000; rpm += 50) peak = Math.max(peak, gt2Torque(rpm, 1) * rpm * Math.PI / 30);
  assert.ok(Math.abs(peak - 471000) < 500, `peak power ${peak} W`);
  assert.ok(gt2Torque(2000, 1) < 720 && gt2Torque(8000, 1) < gt2Torque(7500, 1));
  assert.ok(gt2Torque(4000, 0) < .55 * gt2Torque(4000, 1), 'off boost the 3.0 litres give about half');
  assert.equal(GT2.ratios.length, 8); assert.equal(GT2.finalDrive, 5.174);
  // Road speed at 8,000 rpm in each of the first five gears on the nominal 305/30 R20 (km/h).
  for (const [gear, kmh] of [[1, 69], [2, 115], [3, 165], [4, 229], [5, 308]]) assert.ok(Math.abs(8000 / gt2Gearing(gear) / KMH - kmh) < 1.5, `gear ${gear}`);
  assert.ok(gt2Gearing(-1) > gt2Gearing(2) && gt2Gearing(-1) < gt2Gearing(1));
  assert.equal(gearing(id, 3), gt2Gearing(3)); assert.equal(carRpm(id, 30, 3, 1), gt2Rpm(30, 3, 1)); assert.equal(carGear(id, 30, 3, 1), gt2Gear(30, 3, 1));
  assert.deepEqual(ENGINES[id], { litres: 2.992, idle: 900, redline: 8000 });
  // 324 km/h falls in sixth, short of the limiter.
  assert.equal(gt2Gear(324 * KMH, 1, 1), 6); assert.ok(gt2Rpm(324 * KMH, 6, 1) > 6300 && gt2Rpm(324 * KMH, 6, 1) < 6800);
});

test('the dual-clutch gearbox shifts early on a light pedal, holds its gear on a lift and kicks down when floored', () => {
  const cruise = 60 * MPH;
  let gear = 1; for (let i = 0; i < 12; i++) gear = gt2Gear(cruise, gear, .12);
  assert.ok(gear >= 6, `a light pedal at 60 mph settles in a tall gear: ${gear}`);
  assert.ok(gt2Rpm(cruise, gear, .12) < 2600);
  assert.equal(gt2Gear(cruise, gear, 0), gear, 'a lift holds the gear');
  const kick = gt2Gear(cruise, gear, 1); assert.ok(kick <= 3, `flooring it kicks down: ${kick}`);
  assert.ok(gt2Rpm(cruise, kick, 1) >= 5000 && gt2Rpm(cruise, kick, 1) < GT2.shiftRpm);
  assert.equal(gt2Gear(30 * MPH, 1, 1), 1, 'full throttle holds first to the shift lights');
  // No hunting: the gear chosen is stable when asked again, at every speed and pedal.
  for (let v = 2; v < 90; v += 1.7) for (const pedal of [.1, .3, .6, 1]) { let g = 1; for (let i = 0; i < 10; i++) g = gt2Gear(v, g, pedal); assert.equal(gt2Gear(v, g, pedal), g, `${v} m/s at ${pedal}`); }
  // Boost builds in a fraction of a second under load and falls faster on a lift; a gear change does not vent it.
  let boost = 0; for (let i = 0; i < 30; i++) boost = gt2Boost(boost, 4000, 1, 1 / 60); assert.ok(boost > .9, `half a second: ${boost}`);
  for (let i = 0; i < 18; i++) boost = gt2Boost(boost, 4000, 0, 1 / 60); assert.ok(boost < .05);
  assert.equal(gt2Boost(0, 1200, 1, 1), 0, 'no boost below 1,400 rpm');
});

for (const dt of [1 / 60, 1 / 120]) test(`acceleration, gears, top speed and braking match Maserati's figures at ${1 / dt} Hz`, async t => {
  const car = await fresh();
  try {
    assert.equal(car.body.mass(), 1475); assert.equal(car.getState().rpm, 900);
    // The model is drawn as the car stands on its springs: road under the origin, wheel centres under it.
    const rest = car.getState(); assert.ok(Math.abs(rest.y + GT2_STRADALE.ground) < .004, `rests ${rest.y} m over the road`);
    assert.ok(Math.abs(.08 + rest.suspension[0] + spec.wheelRadius + GT2_STRADALE.ground) < .004 && Math.abs(.08 + rest.suspension[2] + spec.rearWheelRadius + GT2_STRADALE.ground) < .006, 'wheels stand on it');
    const start = car.getState(), gears = [], times = {};
    for (let i = 0; i < 60 / dt; i++) {
      car.step(full, dt); const s = car.getState(), time = (i + 1) * dt;
      if (s.gear !== gears.at(-1)) { if (gears.length) assert.ok(s.turboBoost > .9, 'a shift keeps the boost'); gears.push(s.gear); }
      if (i === Math.round(1 / dt)) { const f = [0, 1, 2, 3].map(w => car.controller.wheelEngineForce(w)); assert.ok(f[0] === 0 && f[1] === 0 && f[2] > 6000 && f[2] === f[3], 'rear-wheel drive'); }
      for (const [key, speed] of [['sixty', 60 * MPH], ['hundred', 100 * KMH], ['twoHundred', 200 * KMH]]) if (times[key] === undefined && s.speed >= speed) times[key] = time;
      if (times.quarter === undefined && s.z - start.z >= 402.336) { times.quarter = time; times.trap = s.speed / MPH; }
      assert.ok(Number.isFinite(s.speed + s.y + s.rpm));
    }
    assert.ok(Math.abs(times.hundred - 2.8) < .06, `0 to 100 km/h: ${times.hundred} s (2.8 s published)`);
    assert.ok(times.sixty > 2.55 && times.sixty < times.hundred);
    assert.ok(Math.abs(times.twoHundred - 8.7) < .25, `0 to 200 km/h: ${times.twoHundred} s (8.8 s for the MC20)`);
    assert.ok(times.quarter > 10.2 && times.quarter < 10.8 && times.trap > 132 && times.trap < 141, `quarter mile ${times.quarter} s at ${times.trap} mph`);
    assert.deepEqual(gears, [1, 2, 3, 4, 5, 6]);
    const top = advance(car, full, 25, dt); assert.ok(Math.abs(top.speed - 324 * KMH) < .1, `top speed ${top.speed / KMH} km/h`); assert.equal(top.gear, 6);
    // Downforce is square to the car's travel: held flat out it does not creep past its top speed.
    assert.ok(advance(car, full, 20, dt).speed < 324 * KMH + .1);
    car.reset(0, 0, 0); assert.equal(car.getState().turboBoost, 0); const parked = advance(car, idle, 2, dt);
    car.body.setLinvel({ x: 0, y: 0, z: 100 * KMH }, true); let elapsed = 0;
    while (car.getState().speed > .1 && elapsed < 6) { car.step({ ...idle, brake: 1 }, dt); elapsed += dt; }
    const braking = car.getState().z - parked.z; assert.ok(braking < 30 && braking > 28.5, `100 to 0 km/h: ${braking} m (under 30 m published)`);
    const reverse = advance(car, { throttle: -1 }, 3, dt); assert.ok(reverse.gear === -1 && reverse.speed < -6 && reverse.rpm > 2500);
    t.diagnostic(JSON.stringify({ ...times, braking }));
  } finally { car.dispose(); }
});

test('downforce presses the car onto its springs and lets it corner and brake harder the faster it goes', async () => {
  assert.ok(Math.abs(gt2Downforce(280 * KMH) / G - 500) < .01, '500 kg at 280 km/h'); assert.equal(gt2Downforce(0), 0);
  const car = await fresh();
  try {
    const rest = car.getState().suspension;
    car.body.setLinvel({ x: 0, y: 0, z: 300 * KMH }, true); const fast = advance(car, full, 3).suspension;
    for (const i of [0, 1, 2, 3]) assert.ok(fast[i] < rest[i], `wheel ${i} is loaded: ${fast[i]} against ${rest[i]}`);
    assert.ok(rest[2] - fast[2] > 2.5 * (rest[0] - fast[0]), 'the wing carries most of it on the rear axle');
    assert.ok(rest[2] - fast[2] < .03, 'and the springs have travel left');
    // A steady full-lock circle: lateral acceleration from the yaw rate.
    const circle = async mph => {
      car.reset(0, 0, 0); advance(car, idle, 2); car.body.setLinvel({ x: 0, y: 0, z: mph * MPH }, true);
      for (let i = 0; i < 8 * 60; i++) car.step({ ...idle, steer: 1, throttle: car.getState().speed < mph * MPH ? .6 : 0 }, 1 / 60);
      const q = car.body.rotation(); assert.ok(1 - 2 * (q.x * q.x + q.z * q.z) > .97, 'stays flat');
      return Math.abs(car.body.angvel().y * car.getState().speed) / G;
    };
    const slow = await circle(45), quick = await circle(140);
    assert.ok(slow > 1.08 && slow < 1.2, `${slow} g at 45 mph`); assert.ok(quick > slow + .3 && quick < 1.75, `${quick} g at 140 mph`);
    assert.ok(carSteeringLimit(60, spec, 1.3) > carSteeringLimit(60, spec) && carSteeringLimit(60, spec) === carSteeringLimit(60, spec, 1));
    // From 200 km/h the car stops shorter than four times its 100 km/h distance, by the load on its tyres.
    const stop = kmh => { car.reset(0, 0, 0); const from = advance(car, idle, 2); car.body.setLinvel({ x: 0, y: 0, z: kmh * KMH }, true); let t = 0; while (car.getState().speed > .1 && t < 12) { car.step({ ...idle, brake: 1 }, 1 / 60); t += 1 / 60; } return car.getState().z - from.z; };
    const short = stop(100), long = stop(200); assert.ok(long < 3.8 * short && long > 3 * short, `${long} m against ${short} m`);
  } finally { car.dispose(); }
});

test('the collision box reaches the splitter and the tail, whose overhangs differ', async () => {
  const wall = z => ({ id: 'wall', name: 'Wall', center: [0, z], height: 20, footprint: [[-50, z - 1.5], [50, z - 1.5], [50, z + 1.5], [-50, z + 1.5]] });
  for (const direction of [1, -1]) {
    const car = await DrivingPhysics.create({ ...city, buildings: [wall(direction * 21.5)] }); car.setCar(id);
    try {
      advance(car, idle, 2); car.body.setLinvel({ x: 0, y: 0, z: direction * 4 }, true); let furthest = 0;
      for (let i = 0; i < 600; i++) { car.step(idle, 1 / 60); furthest = Math.max(furthest, direction * car.getState().z); }
      const reach = 20 - furthest, overhang = spec.wheelbase / 2 + GT2.overhang[direction > 0 ? 0 : 1];
      assert.ok(Math.abs(reach - overhang) < .12, `${direction > 0 ? 'nose' : 'tail'} stops ${reach} m from the car's origin, ${overhang} m by its overhang`);
    } finally { car.dispose(); }
  }
  assert.ok(Math.abs(spec.halfLength * 2 - 4.669) < .001); assert.ok(Math.abs(GT2.overhang[0] + GT2.overhang[1] + spec.wheelbase - 4.669) < .001);
  // CCD stops it at top speed.
  const car = await DrivingPhysics.create({ ...city, buildings: [wall(81.5)] }); car.setCar(id);
  try {
    advance(car, idle, 2); car.body.setLinvel({ x: 0, y: 0, z: spec.maxForwardSpeed }, true); let furthest = 0, impacts = 0;
    for (let i = 0; i < 90; i++) { car.step(idle, 1 / 60); furthest = Math.max(furthest, car.getState().z); impacts += car.takeImpacts().length; }
    assert.ok(impacts > 0 && furthest < 79, `chassis reached ${furthest}`);
  } finally { car.dispose(); }
});

test('the model has the published length, width and height, nine-spoke wheels on the suspension pivots and clear plates', () => {
  const car = createCar(id);
  try {
    const travel = [.16, .17, .15, .16], angles = [.1, .2, .3, .4];
    car.update({ x: 0, y: 0, z: 0, yaw: 0, speed: 3, steering: .2, suspension: travel, wheelAngles: angles }, false); car.group.updateMatrixWorld(true);
    const paint = car.group.children.find(o => o.isMesh && o.material.isMeshPhysicalMaterial && o.material.sheen > 0), box = new THREE.Box3().setFromObject(car.group), size = box.getSize(new THREE.Vector3());
    assert.equal(paint.material.color.getHex(), GT2_STRADALE.paint); assert.ok(paint.material.color.r >= paint.material.color.g && paint.material.color.g > 4 * paint.material.color.b, 'yellow');
    paint.geometry.computeBoundingBox(); const body = paint.geometry.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.z - 4.669) < .012, `length ${size.z}`); assert.ok(Math.abs(box.max.z - spec.wheelbase / 2 - GT2.overhang[0]) < .008 && Math.abs(box.min.z + spec.wheelbase / 2 + GT2.overhang[1]) < .008, 'overhangs');
    assert.ok(Math.abs(body.x - 1.965) < .004, `body width ${body.x}`); assert.ok(size.x > 2.0 && size.x <= 2.18, `width with mirrors ${size.x}`);
    const ground = GT2_STRADALE.ground; assert.ok(Math.abs(box.max.y - ground - 1.222) < .006, `height ${box.max.y - ground}`);
    let triangles = 0, meshes = 0;
    car.group.traverse(o => { if (!o.isMesh) return; meshes++; const p = o.geometry.attributes.position, n = o.geometry.attributes.normal; triangles += (o.geometry.index?.count ?? p.count) / 3; for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i) + n.getX(i) + n.getY(i) + n.getZ(i))); });
    assert.ok(triangles < 90000, `${triangles} triangles`); assert.ok(meshes <= 36, `${meshes} meshes`);
    for (const name of ['Gt2Graphite', 'Gt2Satin', 'Gt2Tridents', 'Gt2ExhaustTips']) assert.ok(car.group.getObjectByName(name), name);
    // Two defects reported on earlier versions of the model. Behind the rear wheels the flank stopped short of the valance and
    // daylight showed between them: from the side and from behind, every sight line between the sill and the deck now
    // ends on the outer skin.
    const tail = -spec.wheelbase / 2 - GT2.overhang[1], sight = new THREE.Raycaster(), first = (from, to) => { sight.set(new THREE.Vector3(...from), new THREE.Vector3(...to)); return sight.intersectObject(car.group, true)[0]?.point; };
    for (let z = tail + .12; z < -spec.wheelbase / 2 - spec.rearWheelRadius - .06; z += .045) for (let h = .30; h < .73; h += .06) for (const side of [-1, 1]) {
      const hit = first([side * 3, ground + h, z], [-side, 0, 0]); assert.ok(hit && side * hit.x > .55, `open flank ${z.toFixed(2)} m along, ${h.toFixed(2)} m up`);
    }
    for (let x = -.76; x < .77; x += .08) for (let h = .30; h < .79; h += .06) { const hit = first([x, ground + h, -4], [0, 0, 1]); assert.ok(hit && hit.z < tail + .45, `open tail ${x.toFixed(2)} m across, ${h.toFixed(2)} m up`); }
    // And the tail lamps reached past the body seen from behind: at every height their widest point lies inside the
    // body's widest, and none stands behind the tail.
    const lamps = car.group.children.find(o => o.isMesh && o.material.emissive?.getHex() === 0xe5281d), widest = (mesh, keep = () => true) => { const p = mesh.geometry.attributes.position, by = new Map(); for (let i = 0; i < p.count; i++) if (keep(p.getZ(i))) { const k = Math.round((p.getY(i) - ground) / .02); by.set(k, Math.max(by.get(k) ?? 0, Math.abs(p.getX(i)))); } return by; };
    const lampWidth = widest(lamps, z => z < tail + .6), bodyWidth = widest(paint); assert.ok(lampWidth.size > 5);
    for (const [k, x] of lampWidth) assert.ok(x < Math.max(bodyWidth.get(k - 1) ?? 0, bodyWidth.get(k) ?? 0, bodyWidth.get(k + 1) ?? 0) - .012, `a lamp ${x.toFixed(3)} m out at ${(k * .02).toFixed(2)} m up`);
    lamps.geometry.computeBoundingBox(); assert.ok(lamps.geometry.boundingBox.min.z > tail - .002, 'lamps behind the tail');
    // Both plates face outward and nothing stands in front of them.
    const plates = car.group.getObjectByName('PlayerMassachusettsPlates'), pos = plates.geometry.attributes.position, norm = plates.geometry.attributes.normal;
    assert.equal(pos.count, 8); for (let i = 0; i < pos.count; i++) assert.equal(Math.sign(norm.getZ(i)), Math.sign(pos.getZ(i)));
    for (const sign of [-1, 1]) {
      const corners = Array.from({ length: pos.count }, (_, i) => i).filter(i => sign * pos.getZ(i) > 0), mean = axis => corners.reduce((sum, i) => sum + pos[axis](i) / corners.length, 0), x = mean('getX'), y = mean('getY');
      for (const dx of [-.14, 0, .14]) for (const dy of [-.07, 0, .07]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(x + dx, y + dy, sign * 4), new THREE.Vector3(0, 0, -sign));
        assert.equal(ray.intersectObject(car.group, true)[0]?.object, plates, `obstructed plate at ${dx}, ${dy} on end ${sign}`);
      }
    }
    for (let i = 0; i < 4; i++) {
      const pivot = car.group.getObjectByName(`Gt2WheelPivot${i}`), spin = car.group.getObjectByName(`Gt2WheelSpin${i}`), front = i < 2, radius = front ? spec.wheelRadius : spec.rearWheelRadius;
      assert.equal(pivot.position.x, (i % 2 ? 1 : -1) * (front ? spec.track : spec.rearTrack) / 2); assert.equal(pivot.position.z, (front ? 1 : -1) * spec.wheelbase / 2);
      assert.equal(pivot.position.y, -.08 - travel[i]); assert.equal(pivot.rotation.y, front ? .2 : 0); assert.equal(spin.parent, pivot); assert.equal(spin.rotation.x, angles[i]);
      const tyre = spin.children.find(mesh => mesh.material.color.getHex() === 0x171a1b); tyre.geometry.computeBoundingBox(); const t = tyre.geometry.boundingBox.getSize(new THREE.Vector3());
      assert.ok(Math.abs(t.x - (front ? .245 : .305)) < .001 && Math.abs(t.y / 2 - radius) < .001, 'a 245/35 R20 front and a 305/30 R20 rear');
      // The caliper is carried by the upright: it steers and rides with the wheel but does not turn with it.
      const caliper = car.group.getObjectByName(`Gt2BrakeCaliper${i}`); assert.equal(caliper.parent, pivot); assert.equal(caliper.material.color.getHex(), GT2_STRADALE.caliper);
      caliper.geometry.computeBoundingSphere(); assert.ok(caliper.geometry.boundingSphere.radius < .2 && Math.hypot(caliper.geometry.boundingSphere.center.y, caliper.geometry.boundingSphere.center.z) < .254, 'inside the 20-inch rim');
      // Nine spokes: a ring halfway out the wheel's face, begun between two of them, crosses nine blades.
      const face = spin.children.find(mesh => mesh.material.color.getHex() === GT2_STRADALE.wheel), outward = i % 2 ? 1 : -1; let crossings = 0, inside = false;
      const local = new THREE.Raycaster(); spin.updateMatrixWorld(true);
      for (let k = 0; k < 720; k++) {
        const a = Math.PI / 9 + k / 720 * Math.PI * 2, origin = spin.localToWorld(new THREE.Vector3(outward * .4, Math.cos(a) * .15, Math.sin(a) * .15)), direction = new THREE.Vector3(-outward, 0, 0).transformDirection(spin.matrixWorld);
        local.set(origin, direction); local.far = .32; const hit = local.intersectObject(face, false).length > 0; if (hit && !inside) crossings++; inside = hit;
      }
      assert.equal(crossings, 9, `wheel ${i} has ${crossings} spokes`);
    }
  } finally { car.dispose(); }
});

// No downshift clip: the engine loops carry a downshift (the generated blip stood apart from them and read as a dog's bark).
const layers = ['idle', 'drive', 'high', 'upshift', 'turbo'], sound = layer => `${id}-${layer}`;
test('the five effects match their ElevenLabs generation records', async () => {
  const dir = new URL('../public/audio/', import.meta.url), library = JSON.parse(await readFile(new URL('provenance.json', dir))), clips = library.clips.filter(clip => clip.id.startsWith(id));
  assert.deepEqual(clips.map(clip => clip.id).sort(), layers.map(sound).sort());
  assert.equal(clips.reduce((seconds, clip) => seconds + clip.seconds, 0), 21);
  for (const clip of clips) {
    const data = await readFile(new URL(clip.file, dir));
    assert.equal(clip.model, 'eleven_text_to_sound_v3'); assert.equal(clip.loop, ['idle', 'drive', 'high', 'turbo'].map(sound).includes(clip.id));
    assert.ok(clip.prompt.length <= 450, 'within the provider\'s prompt limit');
    assert.equal(data.length, clip.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), clip.sha256);
  }
});

test('the engine mix keeps one pitch across its layers, the turbos follow the boost and only an upshift plays a clip', t => {
  const saved = globalThis.document; globalThis.document = { hidden: false }; t.after(() => { globalThis.document = saved; });
  const audio = new DriveAudio(), param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const context = { currentTime: 0, createBufferSource: () => ({ playbackRate: param(), connect() {}, start() {} }), createBiquadFilter: () => ({ frequency: param(), Q: param(), connect() {} }), createGain: () => ({ gain: param(), connect() {} }) };
  audio.context = context; audio.master = { gain: param() }; audio.setCar(id);
  for (const layer of ['idle', 'drive', 'high', 'turbo']) audio.createLoop(sound(layer), {});
  audio.buffers.set(sound('upshift'), 'upshift');
  const shots = []; audio.playOneShot = (...args) => { shots.push(args); };
  const loop = layer => audio.loops.get(sound(layer)), settle = (rpm, throttle = 1, boost = 1, gear = 3, extra = {}) => { for (let i = 0; i < 90; i++) { context.currentTime += 1 / 60; audio.update(30, throttle, false, { rpm, gear, turboBoost: boost, ...extra }); } return audio.getStatus(); };
  assert.equal(settle(4000).engineProfile, id);
  // The loops' strongest tones (124 Hz and 202 Hz as generated) coincide wherever both are heard.
  for (const rpm of [4800, 5400, 6000, 6500]) {
    settle(rpm); const drive = loop('drive'), high = loop('high');
    assert.ok(drive.gain.gain.value > .01 && high.gain.gain.value > .01, `both layers at ${rpm} rpm`);
    assert.ok(Math.abs(124 * drive.source.playbackRate.value - 202 * high.source.playbackRate.value) < 4, `one pitch at ${rpm} rpm`);
  }
  settle(3000); const low = 124 * loop('drive').source.playbackRate.value; settle(7800); assert.ok(202 * loop('high').source.playbackRate.value > 2.4 * low, 'the note rises with the revs');
  assert.ok(loop('drive').gain.gain.value < .001 && loop('idle').gain.gain.value < .001, 'only the high loop at the top');
  const loud = settle(5000, 1).engineGain, shut = settle(5000, 0, 0).engineGain; assert.ok(shut < .5 * loud, 'a closed throttle is quieter');
  assert.ok(loop('drive').filter.frequency.value < 1600, 'and duller');
  const rest = settle(900, 0, 0, 1).engineGain; assert.ok(loop('idle').gain.gain.value > .3 && loop('drive').gain.gain.value < .01, 'idle alone at rest');
  // Every loop is normalized to one level as it loads, so gains compare as loudness: the idle stays under the engine at
  // work and at the other cars' idle (.48 and .50). At 1.7 it played 7 dB over this car's own full throttle.
  assert.ok(rest < .6 * loud && rest <= .55, `idle ${rest} against ${loud} at full power`);
  // Induction noise: with the boost, part throttle included, never over the exhaust, gone on the brakes.
  const turbo = loop('turbo'); assert.equal(turbo.filter.type, 'bandpass');
  assert.equal(settle(4000, 0, 0).turboGain, 0);
  const part = settle(4000, .4, .6).turboGain, flat = settle(4000, 1, 1); assert.ok(part > .01 && flat.turboGain > 2 * part);
  assert.ok(flat.turboGain < .2 * flat.engineGain); assert.ok(Math.abs(turbo.filter.frequency.value - 611 * turbo.source.playbackRate.value) < 1);
  assert.equal(settle(4000, 1, 1, 3, { brake: 1 }).turboGain, 0);
  // Shifts: a hard upshift under load and a soft one on a light pedal, entered where the thump begins.
  shots.length = 0; settle(5000, 1, 1, 3); context.currentTime += 1; audio.update(30, 1, false, { rpm: 5000, gear: 4, turboBoost: 1 });
  assert.equal(shots.length, 1); assert.deepEqual([shots[0][0], shots[0][3], shots[0][5]], ['upshift', 'thump', .5]); const hard = shots[0][1];
  for (let i = 0; i < 90; i++) { context.currentTime += 1 / 60; audio.update(30, .05, false, { rpm: 3000, gear: 4, turboBoost: 0 }); }
  context.currentTime += 1; audio.update(30, .05, false, { rpm: 2500, gear: 5, turboBoost: 0 }); assert.ok(shots[1][1] < .6 * hard, 'a light-pedal shift is soft');
  // A downshift plays nothing beside the engine, whose note rises with the revs; the other cars keep their clips.
  const before = loop('drive').source.playbackRate.value; context.currentTime += 1; audio.update(30, .05, false, { rpm: 3500, gear: 4, turboBoost: 0 }); assert.equal(shots.length, 2, 'no clip on a downshift');
  for (let i = 0; i < 30; i++) { context.currentTime += 1 / 60; audio.update(30, .05, false, { rpm: 3500, gear: 4, turboBoost: 0 }); } assert.ok(loop('drive').source.playbackRate.value > 1.15 * before && shots.length === 2, 'the engine carries it');
  assert.ok(!audio.vehicleSounds.includes(`${id}-downshift`) && audio.vehicleSounds.includes(sound('upshift')) && audio.vehicleSounds.includes('subaru-wrx-downshift') && audio.vehicleSounds.includes('mclaren-720s-downshift'));
  // A phone keeps this car's turbo loop only while the car is selected.
  const mobile = new DriveAudio(true); mobile.setCar(id); assert.ok(mobile.vehicleSounds.includes(sound('turbo')) && !mobile.vehicleSounds.includes('subaru-wrx-turbo-spool'));
  mobile.setCar('subaru-wrx'); assert.ok(!mobile.vehicleSounds.includes(sound('turbo')));
  assert.equal(CAR_POWERTRAINS[id].shiftSeconds, .07);
});
