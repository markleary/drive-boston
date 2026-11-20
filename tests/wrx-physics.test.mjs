import assert from 'node:assert/strict';
import test from 'node:test';
import {DrivingPhysics} from '../src/physics/vehicle.ts';
import {wrxGear, wrxTorque} from '../src/simulation/wrx-powertrain.ts';

const city = {bounds:{minX:-20000,maxX:20000,minZ:-20000,maxZ:20000}, buildings:[], spawn:{x:0,z:0,yaw:0}};
const idle = {throttle:0,brake:0,steer:0,handbrake:false};
const full = {...idle,throttle:1};
const mph = .44704;

function advance(car, input, seconds, dt) {
  for (let i = 0; i < Math.round(seconds / dt); i++) car.step(input, dt);
  return car.getState();
}

test('WRX torque curve reaches Subaru’s midrange plateau and rated power', () => {
  for (const rpm of [2000, 3500, 5200]) assert.ok(Math.abs(wrxTorque(rpm, 1) / 1.35582 - 258) < .1);
  assert.ok(Math.abs(wrxTorque(5600, 1) * 5600 * Math.PI / 30 / 745.7 - 271) < .1);
  assert.ok(wrxTorque(3500, 0) < .6 * wrxTorque(3500, 1));
  assert.ok(wrxGear(30 * mph, 1, .2) > 1, 'early upshift under light throttle');
  assert.equal(wrxGear(30 * mph, 1, 1), 1, 'full throttle holds first');
  assert.equal(wrxGear(30 * mph, 3, 0), 3, 'lifting holds third');
});

for (const dt of [1/60, 1/120]) test(`WRX AWD, boost, timed shifts, acceleration and braking at ${1/dt} Hz`, async t => {
  const car = await DrivingPhysics.create(city);
  try {
    car.setCar('subaru-wrx');
    const start = advance(car, idle, 2, dt);
    assert.equal(car.body.mass(), 1523);
    assert.equal(start.rpm, 800);
    const gears = [];
    let rollout, sixty, quarter, trap, lowestSecondGearBoost = 1;
    for (let i = 0; i < 90 / dt; i++) {
      car.step(full, dt);
      const state = car.getState(), time = (i + 1) * dt, distance = state.z - start.z;
      if (state.gear !== gears.at(-1)) {
        if (gears.length) {
          assert.equal(car.controller.wheelEngineForce(0), 0, 'clutch opens on upshift');
          assert.ok(state.turboBoost > .8, 'compressor was on boost before the shift');
        }
        gears.push(state.gear);
      }
      if (state.gear === 2) lowestSecondGearBoost = Math.min(lowestSecondGearBoost, state.turboBoost);
      if (i === Math.round(1 / dt)) {
        const forces = [0, 1, 2, 3].map(wheel => car.controller.wheelEngineForce(wheel));
        assert.ok(forces[0] > 2000 && forces.every(f => f === forces[0]), '50:50 centre split drives all tyres');
        assert.ok(state.turboBoost > .95, 'intake has reached full boost');
      }
      if (rollout === undefined && distance >= .3048) rollout = time;
      if (sixty === undefined && state.speed >= 60 * mph) { sixty = time; assert.equal(state.gear, 3); }
      if (quarter === undefined && distance >= 402.336) { quarter = time; trap = state.speed / mph; }
    }
    assert.deepEqual(gears, [1, 2, 3, 4, 5, 6]);
    assert.ok(lowestSecondGearBoost < .1, 'upshift vents boost before it builds again');
    assert.ok(Math.abs(sixty - rollout - 5.5) < .12, `60 mph after rollout: ${sixty-rollout} s`);
    assert.ok(Math.abs(quarter - rollout - 13.9) < .16, `quarter mile after rollout: ${quarter-rollout} s`);
    assert.ok(Math.abs(trap - 101) < 1.2, `quarter-mile terminal speed: ${trap} mph`);
    assert.ok(Math.abs(car.getState().speed / mph - 145) < .1);
    assert.ok(advance(car, idle, .4, dt).turboBoost < .05, 'lift vents boost');

    car.reset(0, 0, 0);
    assert.equal(car.getState().turboBoost, 0);
    const parked = advance(car, idle, 2, dt);
    car.body.setLinvel({x:0,y:0,z:70*mph}, true);
    advance(car, {...idle,brake:1}, 5, dt);
    const feet = (car.getState().z - parked.z) / .3048;
    assert.ok(Math.abs(feet - 153) < 3, `70–0 braking: ${feet} ft`);
    const reverse = advance(car, {...idle,throttle:-1}, 3, dt);
    assert.ok(reverse.gear === -1 && reverse.speed < -8 && reverse.rpm > 3000);
    t.diagnostic(JSON.stringify({standingSeconds:sixty,rolloutSeconds:rollout,quarterSeconds:quarter-rollout,trapMph:trap,brakingFeet:feet}));
  } finally { car.dispose(); }
});

test('WRX coasting downshift disconnects engine braking while the service brakes stay available', async () => {
  const car = await DrivingPhysics.create(city), dt = 1/60;
  const wheelBrakes = () => [0, 1, 2, 3].map(i => car.controller.wheelBrake(i));
  try {
    car.setCar('subaru-wrx');
    advance(car, idle, 2, dt);
    assert.equal(advance(car, full, 3.4, dt).gear, 2);
    for (let i = 0; i < 30 / dt && car.getState().gear === 2; i++) car.step(idle, dt);
    assert.equal(car.getState().gear, 1);
    assert.deepEqual(wheelBrakes(), [0, 0, 0, 0], 'open clutch isolates the engine');
    car.step({...idle, brake: .3}, dt);
    assert.ok(wheelBrakes().every(impulse => impulse > 0), 'brake pedal still acts on all four wheels');
    advance(car, idle, .15, dt);
    assert.deepEqual(wheelBrakes(), [0, 0, 0, 0]);
    advance(car, idle, .2, dt);
    assert.ok(wheelBrakes().every(impulse => impulse > 0), 'engine braking returns in first gear');
  } finally { car.dispose(); }
});

test('WRX sustains a 300-foot skidpad turn and loads the outside suspension in either direction', async () => {
  const car = await DrivingPhysics.create(city), dt = 1/60;
  const target = Math.sqrt(.95 * 9.81 * 45.72);
  try {
    car.setCar('subaru-wrx');
    for (const steer of [-1, 1]) {
      car.reset(0, 0, 0);
      advance(car, idle, 2, dt);
      car.body.setLinvel({x:0,y:0,z:target}, true);
      let lateralG = 0, samples = 0;
      for (let i = 0; i < 8 / dt; i++) {
        const state = car.getState(), throttle = Math.max(0, Math.min(1, .1 + 2 * (target - state.speed)));
        car.step({...idle,steer,throttle}, dt);
        if (i < 4 / dt) continue;
        lateralG += state.speed * car.body.angvel().y / 9.81 * steer;
        samples++;
        assert.ok((state.suspension[1] - state.suspension[0]) * steer > .025, 'outside front spring compresses');
        assert.ok(Math.abs(state.speed - target) < .2, 'steady test speed');
      }
      assert.ok(Math.abs(lateralG / samples - .95) < .04);
    }
  } finally { car.dispose(); }
});
