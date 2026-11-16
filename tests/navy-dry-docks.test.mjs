import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { navyDryDocks, navyDryDockSteps, isNavyDryDockEdge } from '../src/render/navy-dry-docks.ts';
import { drain } from '../src/render/pacing.ts';
import { loadMetroCity } from './helpers/metro-city.mjs';

const city = await loadMetroCity({ tiles: [] });
function build(bounds) {
  const group = new THREE.Group(), solids = [];
  const stats = drain(navyDryDockSteps(city, group, { bounds, onShore: (vertices, indices) => solids.push({ vertices, indices }) }));
  return { group, stats, solids };
}
const whole = build();

test('the Navy Yard keeps Dock 1 gated and Dock 2 open, without inventing another caisson', () => {
  assert.equal(whole.stats.docks, 2);
  assert.equal(whole.stats.caissons, 1);
  assert.ok(whole.stats.terraces > 1000);
  const { vertices, indices } = whole.solids[0], geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
  for (const [index, dock] of navyDryDocks.entries()) {
    const [a, b] = dock.mouth, x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
    const hits = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0), 0, 40).intersectObject(mesh);
    assert.equal(hits.length > 0, index === 0, `${dock.name} has the correct open or closed entrance`);
    assert.ok(isNavyDryDockEdge(a, b), 'the ordinary quay renderer yields the dock entrance');
  }
  assert.ok(!isNavyDryDockEdge([1000, -2500], [1100, -2500]));
  geometry.dispose(); mesh.material.dispose();
});

test('dry dock parts and collision clip at tile bounds without overlapping ownership', () => {
  const split = 1600, boxes = [{ minX: 1500, maxX: split, minZ: -2800, maxZ: -2400 }, { minX: split, maxX: 1900, minZ: -2800, maxZ: -2400 }];
  const area = group => {
    let sum = 0;
    for (const mesh of group.children) {
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
        sum += b.sub(a).cross(c.sub(a)).length() / 2;
      }
    }
    return sum;
  };
  let splitArea = 0;
  for (const bounds of boxes) {
    const result = build(bounds); splitArea += area(result.group);
    for (const array of [...result.group.children.map(m => m.geometry.attributes.position.array), ...result.solids.map(s => s.vertices)]) {
      for (let i = 0; i < array.length; i += 3) {
        assert.ok(array[i] >= bounds.minX - .0002 && array[i] <= bounds.maxX + .0002);
        assert.ok(array[i + 2] >= bounds.minZ - .0002 && array[i + 2] <= bounds.maxZ + .0002);
      }
    }
  }
  const expected = area(whole.group);
  assert.ok(Math.abs(splitArea - expected) / expected < .00002, 'two clipped tiles exactly cover the complete masonry');
});

test('dry dock geometry and its simple colliders remain finite and bounded', () => {
  assert.ok(whole.group.children.length <= 6, 'shared finishes are merged');
  let triangles = 0;
  for (const mesh of whole.group.children) {
    triangles += mesh.geometry.attributes.position.count / 3;
    for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
  }
  assert.ok(triangles < 30000);
  assert.ok(whole.solids.every(s => s.vertices.every(Number.isFinite)));
});
