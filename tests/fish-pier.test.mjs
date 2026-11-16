import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildFishPier, FISH_PIER_BUILDINGS, fishPierFrame, fishPierWorld, insideFishPierWorkingArea } from '../src/render/fish-pier.ts';
import { loadMetroCity } from './helpers/metro-city.mjs';

const city = await loadMetroCity({ tiles: ['2_-1', '3_-1', '2_0'] });
const model = buildFishPier(city);

test('Fish Pier replaces the two surveyed halls and Exchange without selecting neighboring wharves', () => {
  for (const source of FISH_PIER_BUILDINGS) {
    const building = city.buildings.find(b => b.id === source.id);
    assert.ok(building, `${source.name} belongs to the packaged survey`);
    assert.deepEqual(building.footprint[0], source.first);
    const far = city.far.tiles.get(source.tile).buildings.filter(b => !b.fragment && Math.hypot(b.footprint[0][0] - source.first[0], b.footprint[0][1] - source.first[1]) < .14);
    assert.equal(far.length, 1, 'each replacement resolves to exactly one far hull before its tile streams in');
    assert.ok(insideFishPierWorkingArea(...building.center));
  }
  assert.equal(FISH_PIER_BUILDINGS.length, 3);
  const neighbor = city.buildings.find(b => b.name === 'Commonwealth Pier Revitalization Project');
  assert.ok(neighbor && !insideFishPierWorkingArea(...neighbor.center));
  assert.ok(!FISH_PIER_BUILDINGS.some(b => b.id === neighbor.id));
});

test('Fish Pier collision leaves the working central truck lane open', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(model.collision.vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(model.collision.indices, 1));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  for (const u of [-4, 0, 4]) for (let v = 0; v > -232; v -= 4) {
    const [x, z] = fishPierWorld(u, v);
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 25, z), new THREE.Vector3(0, -1, 0), 0, 26);
    assert.equal(ray.intersectObject(mesh).length, 0, `no new building, parked truck, dock or canopy in the aisle at ${u}, ${v}`);
  }
  for (const u of [-22, 24]) {
    const [x, z] = fishPierWorld(u, -100);
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 25, z), new THREE.Vector3(0, -1, 0), 0, 26);
    assert.ok(ray.intersectObject(mesh).length > 0, 'both halls have solid roofs and walls');
  }
  geometry.dispose(); mesh.material.dispose();
});

test('Fish Pier batches finite geometry and follows the measured pier frame', () => {
  assert.ok(model.group.children.length <= 20);
  assert.ok(model.group.userData.triangles < 35000);
  assert.ok(model.collision.vertices.length / 9 < 500);
  for (const mesh of model.group.children) for (const attribute of Object.values(mesh.geometry.attributes)) {
    assert.ok(attribute.array.every(Number.isFinite));
  }
  for (const point of [[-46, 55], [48, -280], [12, -160]]) {
    const actual = fishPierFrame(...fishPierWorld(...point));
    assert.ok(Math.hypot(actual[0] - point[0], actual[1] - point[1]) < 1e-9);
  }
});
