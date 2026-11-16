import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { clipWaterfrontTerrainSteps, inWaterfrontTerrainCut, waterfrontTerrainCuts } from '../src/render/waterfront-terrain.ts';
import { drain } from '../src/render/pacing.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { loadMetroCity } from './helpers/metro-city.mjs';

const rect = (l, r, b, f) => [[l, b], [r, b], [r, f], [l, f]];
const cuts = [[rect(4, 9, 1, 9), rect(6, 7, 3, 5)], [rect(0, 1, 0, 10)]];
const city = { roads: [], buildings: [], bounds: {}, spawn: {} };
function terrain(left = 0, right = 10, step = 2.5) {
  const position = [], normal = [], uv = [], indices = [], width = Math.round((right - left) / step) + 1, height = Math.round(10 / step) + 1;
  const n = new THREE.Vector3(-.3, 1, -.4).normalize();
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = left + i * step, z = j * step;
    position.push(x, 20 + .3 * x + .4 * z, z); normal.push(...n.toArray()); uv.push(x * .7 + z * .2, x * .1 - z * .3);
  }
  for (let j = 0; j < height - 1; j++) for (let i = 0; i < width - 1; i++) { const a = j * width + i, b = a + 1, c = a + width, d = c + 1; indices.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); return g;
}
const area = g => {
  const p = g.attributes.position, ids = g.index; let sum = 0;
  for (let i = 0; i < ids.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => ids.getX(i + k));
    sum += Math.abs((p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) - (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a))) / 2;
  }
  return sum;
};
const clip = (g, polygons = cuts) => drain(clipWaterfrontTerrainSteps(city, g, undefined, polygons));

test('waterfront cuts exactly remove high terrain in water while retaining polygon holes and dry land', () => {
  const geometry = terrain(), result = clip(geometry);
  assert.equal(result, geometry, 'the caller retains the same geometry object');
  assert.ok(result.index.array instanceof Uint32Array, 'render and collider use the same explicit triangle index');
  assert.ok(Math.abs(area(result) - 52) < .0001, `100m² minus38m² holed polygon minus10m² strip =52m²; got ${area(result)}`);
  const mesh = new THREE.Mesh(result, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
  const hits = (x, z) => new THREE.Raycaster(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0), 0, 50).intersectObject(mesh);
  assert.equal(hits(5, 5).length, 0, 'high DEM does not leave a hidden water-side collider');
  assert.equal(hits(.5, 5).length, 0);
  assert.ok(hits(6.5, 4).length > 0, 'a road/land island hole retains its ground');
  assert.ok(hits(3, 5).length > 0, 'land outside the cut remains');
  assert.ok(Math.abs(hits(3, 5)[0].point.y - 22.9) < 1e-5);
  assert.equal(inWaterfrontTerrainCut(5, 5, cuts), true);
  assert.equal(inWaterfrontTerrainCut(6.5, 4, cuts), false);
  assert.equal(inWaterfrontTerrainCut(3, 5, cuts), false);
  mesh.material.dispose(); result.dispose();
});

test('new cut vertices preserve the source triangle height, smooth normal and arbitrary UV mapping', () => {
  const g = clip(terrain()), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, expected = new THREE.Vector3(-.3, 1, -.4).normalize();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    assert.ok(Math.abs(p.getY(i) - (20 + .3 * x + .4 * z)) < 3e-6);
    assert.ok(Math.abs(uv.getX(i) - (x * .7 + z * .2)) < 2e-6);
    assert.ok(Math.abs(uv.getY(i) - (x * .1 - z * .3)) < 2e-6);
    assert.ok(new THREE.Vector3().fromBufferAttribute(n, i).distanceTo(expected) < 1e-6);
  }
  g.dispose();
});

test('independently clipped neighboring tiles share an identical shoreline seam', () => {
  const left = clip(terrain(0, 5)), right = clip(terrain(5, 10)), whole = clip(terrain());
  const seam = g => {
    const p = g.attributes.position, out = new Set();
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - 5) < 1e-6) out.add([p.getY(i), p.getZ(i)].join(','));
    return [...out].sort();
  };
  assert.deepEqual(seam(left), seam(right));
  assert.ok(Math.abs(area(left) + area(right) - area(whole)) < 1e-5);
  left.dispose(); right.dispose(); whole.dispose();
});

test('inland terrain keeps its original buffers and pacing can yield throughout clipping', () => {
  const g = terrain(), p = g.attributes.position, ids = g.index;
  assert.equal(clip(g, [[rect(100, 110, 100, 110)]]), g);
  assert.equal(g.attributes.position, p); assert.equal(g.index, ids);
  const steps = clipWaterfrontTerrainSteps(city, g, { deadline: -Infinity }, cuts);
  let yields = 0, next = steps.next(); while (!next.done) { yields++; next = steps.next(); }
  assert.ok(yields >= 3, 'index/vertex/triangle/bounds passes yield under a closed frame budget');
  assert.ok(waterfrontTerrainCuts.length > 0, 'the real package supplies the mapped water mask');
  g.dispose();
});

test('the packaged Fish Pier and Piers Park offshore DEM wedges are removed while the Fish Pier approach survives', async () => {
  const metro = await loadMetroCity({ tiles: [] });
  const probes = [[3059.53, -1655.41], [3057.42, -1652], [3055.31, -1648.6], [3005.59, 13.75], [2986.06, 57.02]];
  for (const [x, z] of probes) {
    assert.ok(sampleElevation(metro, x, z) > -4.8, 'this source DEM sample protrudes above the -4.95m harbor surface');
    assert.ok(inWaterfrontTerrainCut(x, z), 'mapped water includes the reported offshore wedge');
    const positions = [], ids = [];
    for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
      const px = x - 6 + i * 3, pz = z - 6 + j * 3;
      positions.push(px, sampleElevation(metro, px, pz), pz);
    }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const a = j * 5 + i; ids.push(a, a + 5, a + 1, a + 1, a + 5, a + 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(ids); g.computeVertexNormals();
    drain(clipWaterfrontTerrainSteps(metro, g));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
    assert.equal(new THREE.Raycaster(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0), 0, 60).intersectObject(mesh).length, 0);
    g.dispose(); mesh.material.dispose();
  }
  assert.ok(!inWaterfrontTerrainCut(2956.658, 8.99), 'the central Fish Pier ground-road approach remains supported');
});
