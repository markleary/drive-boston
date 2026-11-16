import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { loadMetroCity } from './helpers/metro-city.mjs';
import { buildingAt } from '../src/simulation/city-tiles.ts';
import { roadProjection } from '../src/simulation/road-surfaces.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { CONLEY_CRANES, CONLEY_EXTENSION, CONLEY_BERTH_10_LENGTH, conleyPoint, conleyStacks } from '../src/simulation/conley-terminal.ts';
import { addConleyTerminal } from '../src/render/conley-terminal.ts';

const city = await loadMetroCity({ tiles: [] });

test('Conley cargo remains grounded and clear of source buildings and freight routes before tiles load', () => {
  const stacks = conleyStacks(city);
  assert.ok(stacks.length > 450, 'the active terminal has substantial cargo rows');
  const roads = city.roads.filter(r => r.points.some(p => p[0] > 3680 && p[0] < 5050 && p[1] > 850 && p[1] < 1260));
  for (const stack of stacks) {
    for (const a of [-6.095, 0, 6.095]) for (const b of [-1.22, 0, 1.22]) {
      const point = conleyPoint(stack.along + a, stack.inland + b);
      assert.equal(buildingAt(city, ...point), undefined, `cargo intrudes on building at ${point}`);
      assert.ok(stack.base >= sampleElevation(city, ...point) - .01, `cargo sinks into terrain at ${point}`);
      for (const road of roads) assert.ok(roadProjection(road, ...point).distance >= road.width / 2 + 2.8, `cargo blocks ${road.name}`);
    }
  }
});

test('Conley new western berth and low-profile crane height order follow the source scheme', () => {
  assert.ok(Math.abs(CONLEY_BERTH_10_LENGTH - 1275 * .3048) < .1);
  assert.equal(CONLEY_CRANES.length, 7);
  const western = CONLEY_CRANES.filter(c => c.along < CONLEY_BERTH_10_LENGTH);
  assert.deepEqual(western.map(c => c.number), [7, 6, 5]);
  assert.deepEqual(western.map(c => c.height), [62.5, 62.5, 44.2]);
  assert.equal(CONLEY_CRANES.filter(c => c.color === 'blue').length, 2);
  assert.ok(CONLEY_EXTENSION[0][0] < 3740 && CONLEY_EXTENSION[1][0] > 4099);
});

test('desktop and mobile Conley preserve cargo and collision silhouettes with bounded shared geometry', () => {
  const desktop = addConleyTerminal(new THREE.Scene(), city), mobile = addConleyTerminal(new THREE.Scene(), city, { mobile: true });
  const cargo = model => model.group.children.filter(mesh => mesh.isInstancedMesh);
  assert.equal(desktop.group.userData.containers, mobile.group.userData.containers);
  assert.ok(desktop.group.userData.containers > 1200);
  assert.equal(new Set(cargo(desktop).map(mesh => mesh.geometry)).size, 1, 'all cargo cells share a single geometry');
  assert.ok(cargo(mobile)[0].geometry.attributes.position.count < cargo(desktop)[0].geometry.attributes.position.count / 5);
  assert.ok(desktop.group.children.length < 100, 'a large container inventory cannot become thousands of draw calls');
  assert.equal(desktop.collisions[0].vertices.length, mobile.collisions[0].vertices.length);
  assert.ok(desktop.collisions[0].vertices.every(Number.isFinite));
  const ray = new THREE.Raycaster(new THREE.Vector3(...[0, 0, 0]), new THREE.Vector3(0, -1, 0));
  for (const s of [10, 200, 375]) {
    const [x, z] = conleyPoint(s, 4); ray.ray.origin.set(x, 10, z);
    desktop.group.updateMatrixWorld(true);
    const hit = ray.intersectObject(desktop.group, true)[0];
    assert.ok(hit && Math.abs(hit.point.y + .12) < .02, 'new apron has an upward-facing solid surface above the old water');
  }
  for (const model of [desktop, mobile]) {
    const geometries = new Set(), materials = new Set();
    model.group.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
  }
});
