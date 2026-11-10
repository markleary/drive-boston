import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { DrivingPhysics } from '../src/physics/vehicle.ts';
import { closestSidewalk, createWalker, walkSpeed, WALKER } from '../src/simulation/walker.ts';
import { padWalkInput } from '../src/ui/gamepad.ts';

const idle = { forward: 0, strafe: 0, turn: 0, run: false, jump: false };
const parked = { throttle: 0, brake: 1, steer: 0, handbrake: true };
const flatCity = (extra = {}) => ({ bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, buildings: [], roads: [], spawn: { x: 0, z: 0, yaw: 0 }, ...extra });
async function fixture(city = flatCity()) {
  const physics = await DrivingPhysics.create(city), walker = createWalker(city, physics);
  // Stand well clear of the parked car at the spawn.
  walker.place(30, 0, 0, 0);
  const run = (seconds, input = idle, each) => { for (let i = 0; i < Math.round(seconds * 60); i++) { walker.update(1 / 60, input); physics.step(parked, 1 / 60); each?.(walker.state); } return walker.state; };
  run(.2);
  return { physics, walker, run, dispose() { walker.dispose(); physics.dispose(); } };
}

test('the walker walks, runs and strafes relative to the view', async () => {
  const setup = await fixture();
  try {
    const { walker, run } = setup;
    const walked = run(3, { ...idle, forward: 1 });
    assert.ok(Math.abs(walked.speed - WALKER.walkSpeed) < .05, `walking pace ${walked.speed}`);
    assert.ok(walked.z > 4 && Math.abs(walked.x - 30) < .05, 'forward is +Z at yaw 0');
    assert.ok(walked.grounded && Math.abs(walked.y) < .05, 'feet stay on the ground');
    const sprint = run(3, { ...idle, forward: 1, run: true });
    assert.ok(Math.abs(sprint.speed - WALKER.runSpeed) < .1 && sprint.run > .9, `running pace ${sprint.speed}`);
    walker.place(30, 0, 0, 0); run(.1);
    const right = run(.5, { ...idle, strafe: 1 });
    assert.ok(right.x < 30 - .4, 'right is −X while facing +Z');
    assert.ok(right.viewYaw < 0, 'strafing swings the view after the walker');
    walker.place(30, 0, 0, 0); run(.1);
    const turned = run(1, { ...idle, turn: 1 });
    assert.ok(Math.abs(turned.viewYaw + WALKER.turnRate) < .05 && turned.speed < .01, 'turning the view alone does not move the walker');
    assert.equal(walkSpeed(.5, false), WALKER.walkSpeed / 2);
  } finally { setup.dispose(); }
});

test('the walker jumps once per press and lands', async () => {
  const setup = await fixture();
  try {
    const { run } = setup;
    let apex = 0, airborne = 0;
    run(1.2, { ...idle, jump: true }, s => { apex = Math.max(apex, s.y); if (!s.grounded) airborne++; });
    assert.ok(apex > .55 && apex < .9, `jump apex ${apex}`);
    assert.ok(airborne > 30 && airborne < 50, `held jump is a single hop (${airborne} airborne steps)`);
    const landed = run(.3);
    assert.ok(landed.grounded && Math.abs(landed.y) < .05 && landed.air < .1);
  } finally { setup.dispose(); }
});

test('the walker steps up a curb and stops at a wall', async () => {
  const setup = await fixture();
  try {
    const { physics, walker, run } = setup;
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(4, .09, 3).setTranslation(30, .09, 7));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(6, 2, .5).setTranslation(30, 2, 14));
    physics.step(parked, 1 / 60);
    const onCurb = run(3.2, { ...idle, forward: 1 });
    assert.ok(onCurb.z > 4.5 && Math.abs(onCurb.y - .18) < .05, `on the 18 cm curb at z=${onCurb.z}, y=${onCurb.y}`);
    const atWall = run(6, { ...idle, forward: 1, run: true });
    assert.ok(atWall.z > 12.5 && atWall.z < 13.5 - WALKER.radius + .05, `stopped at the wall, z=${atWall.z}`);
    assert.ok(atWall.speed < .05, 'pushing on a wall covers no ground');
    assert.ok(walker.clearAt(30, 0, 0) && !walker.clearAt(30, 0, 14), 'the standing probe sees the wall');
  } finally { setup.dispose(); }
});

test('a vehicle at speed knocks the walker down, who then gets up and walks again', async () => {
  const setup = await fixture();
  try {
    const { walker, run } = setup;
    const crawl = { x: 30, y: .5, z: -1, yaw: 0, speed: 1, halfLength: 2.1, halfWidth: .9 };
    assert.equal(walker.strike([crawl]), undefined, 'a crawling car only nudges');
    assert.equal(walker.strike([{ ...crawl, speed: 12, x: 34 }]), undefined, 'a car in the next lane misses');
    assert.equal(walker.strike([{ ...crawl, speed: 12 }]), 12);
    assert.equal(walker.state.knocked.phase, 'air');
    const phases = new Set(); let thrown = 0, top = 0;
    run(12, { ...idle, forward: 1, jump: true }, s => { if (s.knocked) { phases.add(s.knocked.phase); thrown = Math.max(thrown, s.z); top = Math.max(top, s.knocked.hip.y); } });
    assert.deepEqual([...phases], ['air', 'down', 'rising']);
    assert.ok(thrown > 3 && top > 1.2, `thrown ahead of the car (${thrown} m, hip ${top} m)`);
    const up = walker.state;
    assert.equal(up.knocked, undefined); assert.equal(up.sprawl, 0);
    assert.ok(up.grounded && Math.abs(up.y) < .05, 'standing on the ground again');
    const before = up.z, after = run(1, { ...idle, forward: 1 });
    assert.ok(after.z > before + 1, 'walks again after getting up');
  } finally { setup.dispose(); }
});

test('reset returns the walker to the closest sidewalk on their side of the street', async () => {
  const street = { id: 'main', name: 'Main Street', width: 10, points: [[0, -200], [0, 200]] };
  const far = { id: 'far', name: 'Far Street', width: 8, points: [[300, -200], [300, 200]] };
  const deck = { id: 'deck', name: 'Viaduct', width: 10, points: [[40, -200], [40, 200]], elevations: [8, 8] };
  const city = flatCity({ roads: [street, far, deck], spawn: { x: 0, z: -150, yaw: 0 } });
  const east = closestSidewalk(city, 45, 10, { facing: Math.PI });
  assert.ok(Math.abs(east.x - 6.3) < 1e-9 && Math.abs(east.z - 10) < 1e-9, 'curb plus 1.3 m on the near side, never the viaduct overhead');
  assert.ok(Math.abs(Math.abs(east.yaw) - Math.PI) < 1e-9, 'facing along the street the way the walker faced');
  assert.equal(closestSidewalk(city, -3, 10).x, -6.3);
  const built = flatCity({ roads: [street, far], buildings: [{ id: 'b', footprint: [[5.5, -50], [30, -50], [30, 50], [5.5, 50]] }] });
  assert.equal(closestSidewalk(built, 40, 10).x, -6.3, 'a building on the near sidewalk sends the walker across');
  assert.equal(closestSidewalk(built, 40, 10, { blocked: x => x < 100 }).x, 300 - 5.3, 'a blocked street falls through to the next');
  const setup = await fixture(flatCity({ roads: [street, far], spawn: { x: 0, z: -150, yaw: 0 } }));
  try {
    const { walker, run } = setup;
    walker.place(60, 0, 20, 1); run(.1);
    assert.ok(walker.resetToSidewalk());
    assert.ok(Math.abs(walker.state.x - 6.3) < 1e-3 && Math.abs(walker.state.z - 20) < 1e-3 && walker.state.speed === 0);
    assert.ok(run(.5).grounded);
  } finally { setup.dispose(); }
});

test('the controller walks with the left stick, runs on RT, X or a stick click and jumps on A', () => {
  const frame = (over = {}) => ({ connected: true, id: 'pad', lost: false, dt: 1 / 60, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, held: new Set(), pressed: new Set(), nav: null, active: false, ...over });
  assert.deepEqual(padWalkInput(frame({ connected: false })), idle);
  assert.deepEqual(padWalkInput(frame({ lx: .5, ly: -1, rx: .25 })), { forward: 1, strafe: .5, turn: .25, run: false, jump: false });
  assert.equal(padWalkInput(frame({ rt: .6 })).run, true);
  assert.equal(padWalkInput(frame({ rt: .1 })).run, false);
  for (const button of ['X', 'LS']) assert.equal(padWalkInput(frame({ held: new Set([button]) })).run, true);
  assert.deepEqual(padWalkInput(frame({ held: new Set(['A']) })), { ...idle, jump: true });
});
