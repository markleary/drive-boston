import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DrivingPhysics } from '../src/physics/vehicle.ts';
import { FLORENCE_HOUSE, MELROSE_SCHOOL, fitFlorenceWindows, florenceEntrance, schoolEntrance } from '../src/render/melrose-entrances.ts';
import { HOUSE_GRID } from '../src/render/house-materials.ts';
import { HOUSE_PALETTES, housePalette } from '../src/render/house-styles.ts';
import { prepareNeighborhoodArchitecture } from '../src/render/neighborhood-profiles.ts';
import { frame, siteKit } from '../src/render/site-kit.ts';
import { tileShellGeometry } from '../src/render/tile-geometry.ts';
import { insideWindow } from '../src/render/window-interiors.ts';
import { ownFarHulls } from '../src/simulation/city-tiles.ts';
import { pointInside } from '../src/simulation/roads.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { createWalker } from '../src/simulation/walker.ts';
import { installExactMeshes, loadMetroCity, windowCity } from './helpers/metro-city.mjs';

const metro = await loadMetroCity({ tiles: ['0_-12', '0_-13'] });
const school = metro.buildings.find(b => b.id === MELROSE_SCHOOL);
const home = metro.buildings.find(b => b.id === FLORENCE_HOUSE);
const campus = frame([575.046, -12615.21], [743.125, -12640.637], school.center);
const porch = frame([74.91, -11556.945], [71.444, -11550.973], home.center);
const kit = siteKit();
const schoolModel = schoolEntrance(metro, school, kit), houseModel = florenceEntrance(metro, home, kit);

function onPavement(point, [outer, ...holes]) {
  return pointInside(point, outer) && !holes.some(ring => pointInside(point, ring));
}

function hit(meshes, [x, z], height, direction, distance) {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, height, z), new THREE.Vector3(...direction), 0, distance);
  return ray.intersectObjects(meshes, false)[0];
}

test('the school flight and raised court leave the mapped service lane and its return loop open', () => {
  const lane = metro.loadedTiles.get('0_-13').driveways.find(rings => onPavement(campus.W(99, -12), rings));
  assert.ok(lane, 'the service lane spans the foot of the stairs');
  const meshes = schoolModel.meshes('school entrance');
  let inFront = 0, inReturn = 0;
  // A vertical ray over the lane must see neither a tread nor the court. Include
  // the east return, which runs behind the main lane toward the school wings.
  for (let u = 93; u <= 161; u += .5) for (let v = -15; v <= 11; v += .5) {
    const p = campus.W(u, v);
    if (!onPavement(p, lane)) continue;
    if (v < 0 && u < 103) inFront++;
    if (v >= 0) inReturn++;
    assert.ok(!hit(meshes, p, school.baseElevation + 6, [0, -1, 0], 20), `paved lane at ${u}, ${v}`);
  }
  assert.ok(inFront > 80 && inReturn > 500, 'both the lane in front of the flight and the return were exercised');
  for (const mesh of meshes) mesh.geometry.dispose();
});

test('the front door and covered deck at 125 Florence wrap to the right of the clear left driveway', () => {
  const lane = metro.loadedTiles.get('0_-12').driveways.find(rings => onPavement([80.33, -11558.08], rings));
  assert.ok(lane);
  const meshes = houseModel.meshes('Florence entrance');
  const laneEdge = Math.max(...lane[0].map(porch.uOf));
  for (const mesh of meshes) {
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) assert.ok(porch.uOf([p.getX(i), p.getZ(i)]) > laneEdge, 'all porch parts clear the driveway');
  }
  const entry = porch.uOf(home.center), floor = home.baseElevation + .6;
  const door = hit(meshes, porch.W(entry, -.7), floor + 1, [porch.V[0], 0, porch.V[1]], 1);
  assert.equal(door?.object.material, kit.redDoor, 'the door faces Florence Street');
  for (const [u, v] of [[entry, -.8], [7.6, 3]]) {
    const point = porch.W(u, v);
    assert.ok(Math.abs(hit(meshes, point, floor + .2, [0, -1, 0], .5)?.point.y - floor) < .01, 'level deck under both arms');
    assert.equal(hit(meshes, point, floor + 2, [0, 1, 0], 1)?.object.material, kit.cream, 'soffit visible from below');
    assert.equal(hit(meshes, point, floor + 4, [0, -1, 0], 2)?.object.material, kit.shingle, 'roof covers both arms');
  }
  assert.equal(hit(meshes, porch.W(-.3, -.5), floor + 2.75, [porch.U[0], 0, porch.U[1]], .4)?.object.material, kit.cream);
  assert.equal(hit(meshes, porch.W(7.45, 4.4), floor + 2.75, [-porch.V[0], 0, -porch.V[1]], .4)?.object.material, kit.cream);
  for (const mesh of meshes) mesh.geometry.dispose();
});

test('Florence windows fit each wall including the painted trim, leaving the gable shingles intact', () => {
  prepareNeighborhoodArchitecture(metro, [home]);
  const walls = tileShellGeometry(metro.geometry.get(home.id), home, false);
  const { position, uv } = walls.attributes, original = uv.array.slice();
  fitFlorenceWindows(walls, home);
  const mesh = new THREE.Mesh(walls);

  // Ray-sample the triangles at eye height on both floors, starting just
  // outside each measured wall. Include the painter's projecting hood or the
  // wider shutters when the house palette has them, so a clipped hood counts.
  const halfFinish = HOUSE_GRID.width / 2 + (HOUSE_PALETTES[housePalette(home)].shutter ? .13 + HOUSE_GRID.width * .48 : .21);
  function scan(label, a, b, out, height, expected) {
    const start = porch.W(...a), end = porch.W(...b), runs = [];
    let run;
    for (let i = 0; i <= 200; i++) {
      const t = i / 200, x = start[0] + (end[0] - start[0]) * t, z = start[1] + (end[1] - start[1]) * t;
      const face = hit([mesh], [x + .18 * out[0], z + .18 * out[1]], height, [-out[0], 0, -out[1]], .3);
      assert.ok(face, `${label} is sampled on the real wall at ${t}`);
      const u = face.uv.x * 6, v = face.uv.y * 6, spacing = HOUSE_GRID.spacing;
      const center = (Math.floor(u / spacing) + .5) * spacing;
      if (Math.abs(u - center) <= halfFinish) {
        assert.ok(i > 0 && i < 200, `${label} cuts through a window or trim at its corner`);
        if (!run) { run = { from: t, to: t, pane: false }; runs.push(run); }
        run.to = t;
        run.pane ||= insideWindow(HOUSE_GRID, u, v);
      } else run = undefined;
    }
    assert.equal(runs.length, expected, label);
    assert.ok(runs.every(r => r.pane), `${label} has no isolated trim without a glazed opening`);
    return runs;
  }
  const left = porch.U.map(v => -v), front = porch.V.map(v => -v);
  for (const height of [home.baseElevation + 2.6, home.baseElevation + 5.75]) {
    const trim = scan('front', [.02, 0], [6.88, 0], front, height, 2);
    const entry = (porch.uOf(home.center) - .02) / (6.88 - .02);
    assert.ok(trim[0].to < entry && entry < trim[1].from, 'the windows flank the front door');
    scan('front left side', [0, .02], [0, 3.18], left, height, 1);
    scan('long left side', [-1.34, 3.24], [-1.34, 10.9], left, height, 3);
    scan('recessed return', [-1.30, 3.21], [-.03, 3.21], front, height, 0);
    scan('right side', [6.9, .03], [6.9, 10.49], porch.U, height, 0);
  }
  let gables = 0;
  for (let i = 0; i < position.count; i += 3) {
    if ([i, i + 1, i + 2].some(j => position.getY(j) < home.baseElevation + home.eaveHeight - .02)) continue;
    assert.deepEqual(uv.array.subarray(i * 2, (i + 3) * 2), original.subarray(i * 2, (i + 3) * 2));
    gables++;
  }
  assert.ok(gables >= 2, 'the test exercised the packaged gable UVs');
  walls.dispose(); mesh.material.dispose();
});

async function walkIn(building, entrance, frontage, along, start, seconds, { direction = frontage.V, height } = {}) {
  const [cx, cz] = building.center;
  const city = windowCity(metro, { minX: cx - 170, maxX: cx + 170, minZ: cz - 170, maxZ: cz + 170 });
  city.buildings = [building]; city.geometry = metro.geometry;
  city.spawn = { x: cx - 115, z: cz + 115, yaw: 0 };
  const physics = await DrivingPhysics.create(city), walker = createWalker(city, physics);
  try {
    installExactMeshes(physics, city);
    const vertices = new Float32Array(entrance.solid);
    physics.addStaticMesh(vertices, Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i));
    const [x, z] = frontage.W(along, start);
    walker.place(x, height ?? sampleElevation(city, x, z), z, Math.atan2(direction[0], direction[1]));
    for (let i = 0; i < seconds * 60; i++) {
      walker.update(1 / 60, { forward: 1, strafe: 0, turn: 0, run: false, jump: false });
      physics.step({ throttle: 0, brake: 1, steer: 0, handbrake: true }, 1 / 60);
    }
    const state = walker.state;
    assert.ok(state.grounded);
    return { along: frontage.uOf([state.x, state.z]), depth: frontage.vOf([state.x, state.z]), feet: state.y };
  } finally {
    walker.dispose(); physics.dispose();
  }
}

test('walking from the grass reaches both the school courtyard and the Florence front door without jumping', async () => {
  const hulls = ownFarHulls(metro, school);
  assert.ok(hulls.length && hulls.every(b => b.exactMesh), 'the helicopter also uses the open school plan');
  for (const lane of [97.5, 100.5]) {
    const upper = await walkIn(school, schoolModel, campus, lane, -19, 26);
    assert.ok(upper.depth > 14 && Math.abs(upper.feet - school.baseElevation) < .08, `climbed the stair lane at u=${lane} and continued across the court`);
  }
  const deck = await walkIn(home, houseModel, porch, porch.uOf(home.center), -7, 8);
  assert.ok(deck.depth > -.6 && deck.depth < 0 && Math.abs(deck.feet - (home.baseElevation + .6)) < .08, 'climbed to the porch and stopped at the door');
});

test('the school guardrails stop a walker above the drop and the stair handrails separate the lanes', async () => {
  const outward = campus.V.map(x => -x), left = campus.U.map(x => -x);
  for (const [u, edge] of [[65, .15], [132, 11.15]]) {
    const stopped = await walkIn(school, schoolModel, campus, u, edge + 2, 4, { direction: outward, height: school.baseElevation });
    assert.ok(stopped.depth > edge && stopped.depth < edge + .6, `walker stopped at the guardrail at u=${u}`);
    assert.ok(Math.abs(stopped.feet - school.baseElevation) < .08, 'walker stayed on the raised court');
  }
  const meshes = schoolModel.meshes('school entrance');
  for (const [start, direction, rail] of [[97.4, left, 95.12], [97.4, campus.U, 99], [100.6, campus.U, 102.88]]) {
    const point = campus.W(start, -3);
    const tread = hit(meshes, point, school.baseElevation + 1, [0, -1, 0], 15);
    assert.equal(tread?.object.material, kit.concrete);
    const stopped = await walkIn(school, schoolModel, campus, start, -3, 3, { direction, height: tread.point.y });
    assert.ok((stopped.along - rail) * (start - rail) > 0 && Math.abs(stopped.along - rail) < .6, `walker stopped at handrail u=${rail}`);
    assert.ok(Math.abs(stopped.feet - tread.point.y) < .1, 'walker stayed on the flight');
  }
  for (const mesh of meshes) mesh.geometry.dispose();
  const service = await walkIn(school, schoolModel, campus, 93, -12, 8, { direction: campus.U });
  assert.ok(service.along > 104 && Math.abs(service.depth + 12) < .25, 'the service lane crosses the entire stair frontage');
});
