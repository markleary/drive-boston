import assert from 'node:assert/strict';
import test from 'node:test';
import { storefrontGrade } from '../src/render/storefront-grade.ts';
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
    const { threshold, bottom } = storefrontGrade(city, x, z, nx, nz, width);
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
