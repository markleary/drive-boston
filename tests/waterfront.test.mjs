import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { loadMetroCity } from './helpers/metro-city.mjs';
import { pointInside } from '../src/simulation/roads.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { hardQuayAt, insideWaterfrontPolygon, quayEdges, waterfrontHeight, waterfrontReserved, waterfrontSites } from '../src/simulation/waterfront.ts';
import { waterShore, SHORE_WIDTH } from '../src/render/water-shore.ts';
import { parkSurface, shoreBankGeometry, WATER_SURFACE_OFFSET } from '../src/render/area-surfaces.ts';
import { waterfrontDetailSteps } from '../src/render/waterfront.ts';
import { drain } from '../src/render/pacing.ts';

const city = await loadMetroCity({ tiles: [] });
const distance = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const waterEdges = city.water.flatMap(water => water.rings.flatMap(ring => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length], water }))));
const covers = (geometry, point) => {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i += 3) if (pointInside(point, [0, 1, 2].map(j => [p.getX(i + j), p.getZ(i + j)]))) return true;
  return false;
};
const dispose = group => { const geometries = new Set(); group.traverse(o => { if (o.geometry) geometries.add(o.geometry); }); for (const g of geometries) g.dispose(); };

test('mapped waterfront covers each requested district without treating clipping edges as quay', () => {
  for (const id of ['long-wharf', 'fish-pier', 'conley-terminal', 'piers-park', 'piers-park-ii', 'lopresti-park', 'charlestown-navy-yard', 'chelsea-south-wharves']) {
    assert.ok(waterfrontSites.some(site => site.id === id), `${id} must have a distinct treatment`);
  }
  assert.ok(new Set(waterfrontSites.map(site => site.kind)).size >= 5);
  for (const edge of quayEdges) {
    const midpoint = [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2];
    assert.ok(waterEdges.some(source => distance(midpoint, source.a, source.b) < .01), `${edge.site.id} wall follows a clipping boundary instead of water`);
  }
  const park = waterfrontSites.find(site => site.id === 'piers-park');
  assert.ok(park.lawns.length > 0);
  for (const rings of park.lawns) {
    for (const point of rings[0]) assert.ok(insideWaterfrontPolygon(point, park.rings) || park.rings.some(ring => ring.some((a, i) => distance(point, a, ring[(i + 1) % ring.length]) < .002)), 'manicured lawns stay on the pier');
  }
  const hard = quayEdges.find(edge => edge.site.id === 'piers-park' && Math.hypot(edge.a[0] - edge.b[0], edge.a[1] - edge.b[1]) > 30);
  const point = [(hard.a[0] + hard.b[0]) / 2 + hard.nx, (hard.a[1] + hard.b[1]) / 2 + hard.nz];
  assert.ok(waterfrontReserved(...point), 'the paved perimeter stays reserved against random park trees');
});

test('partially mapped source shoreline edges still suppress natural banks at their quay fragments', () => {
  // Site footprints clip a long source hydro edge; checking only that source
  // edge's midpoint incorrectly left grass against Pier 4 and Fish Pier.
  for (const id of ['pier-4', 'fish-pier', 'long-wharf', 'piers-park']) {
    for (const edge of quayEdges.filter(edge => edge.site.id === id)) {
      if (Math.hypot(edge.a[0] - edge.b[0], edge.a[1] - edge.b[1]) < 9) continue;
      const point = [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2];
      const source = waterEdges.find(source => distance(point, source.a, source.b) < .01);
      assert.ok(source && hardQuayAt(...point));
      assert.ok(waterShore(source.water).distance(...point) > SHORE_WIDTH, `${id} retains a grass bank at ${point}`);
    }
  }
});

test('hard quay keeps its straight mapped edge and water reaches the wall above a blended DEM', () => {
  const edge = quayEdges.find(edge => edge.site.id === 'conley-terminal' && Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]) > 400);
  const length = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]), tx = (edge.b[0] - edge.a[0]) / length, tz = (edge.b[1] - edge.a[1]) / length;
  const center = [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2];
  const p = (along, offshore) => [center[0] + tx * along - edge.nx * offshore, center[1] + tz * along - edge.nz * offshore];
  const water = { id: 'quay-test', name: 'Quay test basin', rings: [[p(-15, 0), p(15, 0), p(15, 24), p(-15, 24)]] };
  const fixture = { bounds: { minX: center[0] - 40, maxX: center[0] + 40, minZ: center[1] - 40, maxZ: center[1] + 40 }, roads: [], buildings: [], parkPaths: [], water: [water], elevation: { width: 15, height: 15, cellSize: 6, originX: center[0] - 42, originZ: center[1] - 42, heights: new Float32Array(225) } };
  const shore = waterShore(water), bankPositions = [], geometry = parkSurface(fixture, shore.rings, WATER_SURFACE_OFFSET, -2, undefined, true, shore, bankPositions), bank = shoreBankGeometry(bankPositions);
  assert.ok(shore.rings[0].some(vertex => Math.hypot(vertex[0] - water.rings[0][0][0], vertex[1] - water.rings[0][0][1]) < .001), 'quay corner cannot be rounded into the pier');
  assert.ok(covers(geometry, p(.13, .4)), 'water reaches the vertical face despite the raised coarse terrain');
  assert.ok(!covers(bank, p(.13, .4)), 'no synthetic grass slope covers the hard waterfront');
  for (const y of Array.from(geometry.attributes.position.array).filter((_, i) => i % 3 === 1)) assert.ok(Math.abs(y + 2 - WATER_SURFACE_OFFSET) < 1e-5, 'water stays horizontal');
  geometry.dispose(); bank.dispose();
});

test('streamed waterfront paving shares collision heights and original quay stations across tile seams', () => {
  const bounds = { minX: 2080, maxX: 2200, minZ: -1160, maxZ: -1040 }, seam = 2140;
  const build = bounds => {
    const group = new THREE.Group(), colliders = [], solids = [];
    const stats = drain(waterfrontDetailSteps(city, group, { bounds, mobile: true, onShore: (vertices, indices) => colliders.push({ vertices, indices }), onSolids: boxes => solids.push(...boxes) }));
    for (const mesh of group.children.filter(mesh => mesh.name.endsWith('paved deck'))) {
      const p = mesh.geometry.attributes.position;
      assert.ok(colliders.some(collider => collider.vertices === p.array), 'physics uses the exact deck tessellation');
      for (let i = 0; i < p.count; i++) assert.ok(Math.abs(p.getY(i) - waterfrontHeight(city, p.getX(i), p.getZ(i))) < .004, 'rendered deck follows its authoritative surface height');
    }
    return { group, colliders, solids, stats };
  };
  const whole = build(bounds), left = build({ ...bounds, maxX: seam }), right = build({ ...bounds, minX: seam });
  const station = solid => [solid.x, solid.y, solid.z, solid.yaw, solid.length].map(value => value.toFixed(4)).join(',');
  assert.deepEqual([...left.solids, ...right.solids].map(station).sort(), whole.solids.map(station).sort(), 'rail stations cannot duplicate or restart at a tile border');
  assert.equal(left.stats.quays + right.stats.quays, whole.stats.quays);
  assert.equal(left.stats.benches + right.stats.benches, whole.stats.benches);
  assert.equal(left.stats.lamps + right.stats.lamps, whole.stats.lamps);
  const seamHeights = model => new Set(model.colliders.flatMap(({ vertices }) => Array.from({ length: vertices.length / 3 }, (_, i) => i).filter(i => Math.abs(vertices[i * 3] - seam) < .0002).map(i => `${vertices[i * 3 + 2].toFixed(4)},${vertices[i * 3 + 1].toFixed(4)}`)));
  assert.ok(seamHeights(left).size > 0);
  assert.deepEqual(seamHeights(left), seamHeights(right), 'both loaded tiles agree on the same waterfront surface at the seam');
  assert.equal(waterfrontHeight(city, 0, 0), sampleElevation(city, 0, 0) + .031, 'inland terrain is not reshaped');
  for (const model of [whole, left, right]) dispose(model.group);
});
