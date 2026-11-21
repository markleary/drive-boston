import assert from 'node:assert/strict';
import test from 'node:test';
import { storefrontGrade } from '../src/render/storefront-grade.ts';
import { closestRoad } from '../src/simulation/roads.ts';
import { sampleRoadElevation } from '../src/simulation/road-surfaces.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { loadMetroCity } from './helpers/metro-city.mjs';

test('both shop doors at 333 Main Street meet the graded frontage, with masonry under the downhill display', async () => {
  const city = await loadMetroCity({ tiles: ['0_-12'] });
  const building = city.buildings.find(b => b.id === 'osm-way-29871475');
  const [a, b] = building.footprint;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (b[1] - a[1]) / length, nz = -(b[0] - a[0]) / length;
  const thresholds = [];
  for (const distance of [4.4, 12.4]) {
    const x = a[0] - nz * distance, z = a[1] + nx * distance, width = 6;
    const ground = (along, depth) => sampleElevation(city, x + nz * along + nx * depth, z - nx * along + nz * depth);
    const { road } = closestRoad(city, x, z, true);
    assert.equal(road.name, 'Main Street');
    const { threshold, bottom } = storefrontGrade(city, road, x, z, nx, nz, width);
    const door = width / 2 - .69, high = Math.max(ground(door - .525, .43), ground(door, .43), ground(door + .525, .43));
    assert.ok(building.baseElevation - high > 1.5, 'the shell stands on an exposed uphill foundation');
    assert.ok(threshold >= high && threshold - high < .05, 'one small threshold at the door');
    for (let along = -width / 2; along <= width / 2; along += .15) {
      for (const depth of [0, .24, .48]) assert.ok(bottom < ground(along, depth), 'no daylight under the shop');
    }
    thresholds.push(threshold);
  }
  assert.ok(thresholds[0] - thresholds[1] > .3, 'neighboring bays follow the change in street grade');
});

test('Beacon and Summer Street bridges end short of the storefronts above the rail cuts', async () => {
  const city = await loadMetroCity({ tiles: ['-3_0', '2_0'] });
  for (const [id, edge, roadId] of [
    ['BOS-XPZIH-0GKW7-TRP7Y', 1, '15627-0-0'],
    ['BOS-FQSC0-COSWW-V8E2V', 3, '15055-0-0'],
  ]) {
    const building = city.buildings.find(b => b.id === id);
    const [a, b] = building.footprint.slice(edge, edge + 2);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = (b[1] - a[1]) / length, nz = -(b[0] - a[0]) / length;
    const x = a[0] - nz * 4.4, z = a[1] + nx * 4.4;
    const facing = closestRoad(city, x, z, true);
    assert.equal(facing.road.id, roadId);
    assert.ok(facing.distance > facing.road.width / 2 + 1.5);
    assert.ok(sampleRoadElevation(city, facing.road, facing.x, facing.z) - sampleElevation(city, x, z) > 2);
    assert.equal(storefrontGrade(city, facing.road, x, z, nx, nz, 6), undefined);
  }
});

test('a storefront supported by a banked deck follows its actual surface and a grounded approach keeps its shops', () => {
  const city = {}, bridge = {points: [[0, -20], [0, 20]], width: 10, elevations: [4, 4], deckEdgeElevations: [[4.5, 3.5], [4.5, 3.5]]};
  const y = sampleRoadElevation(city, bridge, 4.9 - .43, 0);
  assert.ok(y > 4.4, 'the shop faces the raised side of the bank');
  assert.ok(Math.abs(storefrontGrade(city, bridge, 4.9, 0, -1, 0, 6).threshold - y - .04) < 1e-7);
  assert.equal(storefrontGrade(city, bridge, 4.9, 20.2, -1, 0, 6), undefined, 'the door lies beyond the end of the slab');
  const landing = {...bridge, elevations: [0, 0], deckEdgeElevations: undefined};
  assert.equal(storefrontGrade(city, landing, 8, 0, -1, 0, 6).threshold, .04);
});
