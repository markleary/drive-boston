import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DrivingPhysics } from '../src/physics/vehicle.ts';
import { createHelicopterFlight, HELICOPTER } from '../src/simulation/helicopter.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';

const released = { forward: 0, strafe: 0, turn: 0, lift: 0 };
const emptyCity = {
  bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
  buildings: [], roads: [], spawn: { x: 0, z: 0, yaw: 0 },
};
const run = (flight, seconds, input = released, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) flight.update(dt, input);
  return flight.state;
};
async function fixture(city = emptyCity) {
  const physics = await DrivingPhysics.create(city);
  const flight = createHelicopterFlight(city, physics);
  return { flight, dispose() { flight.dispose(); physics.dispose(); } };
}

test('helicopter controls move forward, strafe right, yaw right and hold altitude', async () => {
  const setup = await fixture();
  try {
    const { flight } = setup;
    assert.equal(flight.state.y, 20);
    const forward = run(flight, 4, { ...released, forward: 1 });
    assert.ok(forward.z > 50 && Math.abs(forward.x) < .01);
    assert.ok(forward.speed > 25 && forward.speed <= HELICOPTER.cruiseSpeed);
    assert.ok(Math.abs(forward.y - 20) < .001, 'assisted hover should hold altitude without lift input');
    flight.reset({ x: 0, y: 20, z: 0 }, 0);
    const cruise = run(flight, 10, { ...released, forward: 1 });
    assert.ok(cruise.speed / .44704 > 119.9 && cruise.speed / .44704 <= 120.001, 'sustained forward flight should reach about 120 mph');
    flight.reset({ x: 0, y: 20, z: 0 }, 0);
    const diagonal = run(flight, 10, { ...released, forward: 1, strafe: 1 });
    assert.ok(diagonal.speed / .44704 > 119.9 && diagonal.speed / .44704 <= 120.001, 'combined forward and sideways input must not exceed the same top speed');
    flight.reset({ x: 0, y: 20, z: 0 }, 0);
    const right = run(flight, 3, { ...released, strafe: 1 });
    assert.ok(right.x < -25 && Math.abs(right.z) < .01, 'right is −X while facing +Z in east/south world coordinates');
    flight.reset({ x: 0, y: 20, z: 0 }, 0);
    assert.ok(run(flight, 1, { ...released, turn: 1 }).yaw < -.5, 'positive turn must turn right');
    const hovering = run(flight, 5);
    assert.ok(hovering.speed < .01 && Math.abs(hovering.verticalSpeed) < .01);
  } finally { setup.dispose(); }
});

test('swept helicopter clearance stops from 120 mph at a thin wall and permits sliding along it', async () => {
  const wall = { id: 'thin-wall', name: 'Thin test wall', center: [0, 400], height: 100,
    footprint: [[-200, 400], [200, 400], [200, 400.025], [-200, 400.025]] };
  const setup = await fixture({ ...emptyCity, buildings: [wall] });
  try {
    const { flight } = setup;
    const approach = run(flight, 9, { ...released, forward: 1 }, .25);
    assert.ok(approach.speed / .44704 > 119.5 && approach.z < 400 - HELICOPTER.radius, 'the sweep must be exercised at full cruise speed');
    const stopped = run(flight, 3, { ...released, forward: 1 }, .25);
    assert.ok(stopped.z > 394.4 && stopped.z <= 400 - HELICOPTER.radius, `thin-wall stop was z=${stopped.z}`);
    assert.ok(stopped.speed < .1);
    const sliding = run(flight, 4, { ...released, forward: 1, strafe: 1 });
    assert.ok(sliding.x < -15 && sliding.z <= 400 - HELICOPTER.radius, 'sideways flight should slide along the wall without entering it');
  } finally { setup.dispose(); }
});

test('roofs, the hover floor, map bounds and the ceiling remain solid', async () => {
  const roof = { id: 'roof', name: 'Test roof', center: [0, 0], height: 25,
    footprint: [[-25, -25], [25, -25], [25, 25], [-25, 25]] };
  const setup = await fixture({ ...emptyCity, buildings: [roof] });
  try {
    const { flight } = setup;
    flight.reset({ x: 0, y: 65, z: 0 }, 0);
    const landed = run(flight, 10, { ...released, lift: -1 });
    assert.ok(landed.y >= roof.height + HELICOPTER.verticalClearance && landed.y < 27.5);
    assert.ok(Math.abs(landed.verticalSpeed) < .2);
    flight.reset({ x: 0, y: 8, z: 0 }, 0);
    assert.ok(flight.state.y > roof.height + HELICOPTER.verticalClearance, 'reset inside a building must lift above its roof');
    flight.reset({ x: 100, y: 20, z: 0 }, 0);
    assert.ok(run(flight, 10, { ...released, lift: -1 }).y >= HELICOPTER.minimumAltitude);
    assert.ok(run(flight, 45, { ...released, lift: 1 }).y <= HELICOPTER.maximumAltitude);
    const edge = run(flight, 30, { ...released, forward: 1 });
    assert.ok(edge.z <= emptyCity.bounds.maxZ - HELICOPTER.radius && edge.z > 490);
  } finally { setup.dispose(); }
});

test('real Back Bay launch is clear and 60/120 Hz flight produces the same path', async () => {
  const city = JSON.parse(readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
  const setup = await fixture(city);
  try {
    const { flight } = setup;
    const launchGround = sampleElevation(city, city.spawn.x, city.spawn.z);
    assert.ok(flight.state.y >= launchGround + 20 && flight.state.y < launchGround + 40, 'initial flight should start over the street, below nearby roofs');
    const initial = flight.state;
    const input = { forward: .8, strafe: .25, turn: .15, lift: .4 };
    const sixty = run(flight, 4, input, 1 / 60);
    flight.reset(initial, initial.yaw);
    const oneTwenty = run(flight, 4, input, 1 / 120);
    assert.ok(Math.hypot(sixty.x - oneTwenty.x, sixty.y - oneTwenty.y, sixty.z - oneTwenty.z) < .001);
    assert.ok(Math.abs(sixty.yaw - oneTwenty.yaw) < .001);
    flight.reset(initial, initial.yaw);
    const restored = run(flight, 2);
    assert.ok(Math.hypot(restored.x - initial.x, restored.y - initial.y, restored.z - initial.z) < .001, 'reset must clear movement and yaw momentum');
  } finally { setup.dispose(); }
});


test('helicopter launch, low flight and roof clearance follow elevated terrain', async () => {
  const heights = [];
  for (let z = -120; z <= 120; z += 10) for (let x = -120; x <= 120; x += 10) heights.push(100 + .1 * z);
  const city = { ...emptyCity, bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    elevation: { width: 25, height: 25, cellSize: 10, originX: -120, originZ: -120, heights } };
  const setup = await fixture(city);
  try {
    const { flight } = setup;
    assert.equal(flight.state.y, 120, 'default launch must be 20 m above the local ground');
    run(flight, 5, { ...released, lift: -1 });
    for (let i = 0; i < 5 * 60; i++) {
      flight.update(1 / 60, { ...released, forward: 1 });
      const state = flight.state;
      assert.ok(state.y >= sampleElevation(city, state.x, state.z + HELICOPTER.radius) + HELICOPTER.minimumAltitude - .001,
        'the rising terrain under the rotor must never pass through the hover clearance');
    }
    assert.ok(flight.state.z > 30 && flight.state.y > 107, 'low forward flight should follow the hillside');
  } finally { setup.dispose(); }

  const roof = { id: 'high-roof', name: 'Elevated roof', center: [0, 0], baseElevation: 100, height: 25,
    footprint: [[-20, -20], [20, -20], [20, 20], [-20, 20]] };
  const withRoof = await fixture({ ...city, buildings: [roof] });
  try {
    withRoof.flight.reset({ x: 0, y: 8, z: 0 }, 0);
    assert.ok(withRoof.flight.state.y > 125 + HELICOPTER.verticalClearance, 'building roofs must include their base elevation');
  } finally { withRoof.dispose(); }
});

test('continuous terrain sweeps cannot skip a narrow ridge between low endpoints', async () => {
  const heights = [];
  for (let z = -50; z <= 50; z++) for (let x = -10; x <= 10; x++) heights.push(z === 20 ? 70 : 0);
  const city = { ...emptyCity, bounds: { minX: -10, maxX: 10, minZ: -50, maxZ: 50 },
    elevation: { width: 21, height: 101, cellSize: 1, originX: -10, originZ: -50, heights } };
  const setup = await fixture(city);
  try {
    setup.flight.reset({ x: 0, y: 10, z: 0 }, 0);
    const blocked = run(setup.flight, 5, { ...released, forward: 1 }, .25);
    assert.ok(blocked.z < 14, `low flight must not tunnel through the ridge; z=${blocked.z}`);
    setup.flight.reset({ x: 0, y: 85, z: 0 }, 0);
    assert.ok(run(setup.flight, 5, { ...released, forward: 1 }, .25).z > 30, 'the same ridge should be passable with sufficient altitude');
  } finally { setup.dispose(); }
});

test('flight over the imported Parker Hill summit preserves its terrain clearance', async () => {
  const city = JSON.parse(readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
  const setup = await fixture(city);
  try {
    const x = -2529.88, z = 2264.24, ground = sampleElevation(city, x, z);
    assert.ok(ground > 55 && ground < 65, 'the actual Mission Hill summit must retain its elevation relative to Back Bay');
    setup.flight.reset({ x, y: ground + 20, z }, 0);
    assert.ok(Math.abs(setup.flight.state.y - ground - 20) < .001);
    for (let i = 0; i < 8 * 60; i++) {
      setup.flight.update(1 / 60, { ...released, lift: -1 });
      const state = setup.flight.state;
      assert.ok(state.y >= sampleElevation(city, state.x, state.z) + HELICOPTER.minimumAltitude - .001,
        'descent over real hillside terrain must never use the old sea-level hover floor');
    }
    assert.ok(setup.flight.state.y < ground + 6, 'the aircraft should reach the local hover floor');
  } finally { setup.dispose(); }
});
