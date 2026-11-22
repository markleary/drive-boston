import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { MAIN_STREET_FRONTAGES } from '../src/render/melrose-main-street-data.ts';
import { MELROSE_YMCA_ID } from '../src/render/melrose-landmarks.ts';
import { wallFrames } from '../src/render/site-kit.ts';
import { closestRoad } from '../src/simulation/roads.ts';
import { parseTileHeader } from '../src/simulation/tile-format.ts';

test('the downtown rows face Main Street in the shop order visible from Foster north to Essex', () => {
  const data = new URL('../public/data/', import.meta.url);
  const city = JSON.parse(readFileSync(new URL('city.json', data), 'utf8'));
  const bytes = gunzipSync(readFileSync(new URL('tiles/t_0_-12.bin', data)));
  const tile = parseTileHeader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const sides = { west: [], east: [] };
  for (const [id, frontage] of Object.entries(MAIN_STREET_FRONTAGES)) {
    const building = tile.buildings.find(b => b.id === id);
    assert.ok(building, `mapped footprint for ${id}`);
    const wall = wallFrames(building.footprint)[frontage.edgeIndex];
    const [x, z] = wall.at(wall.length / 2);
    const road = closestRoad(city, x, z, false, { maxDistance: 15, accept: q => q.road.name === 'Main Street' });
    const towardRoad = (road.x - x) * wall.n[0] + (road.z - z) * wall.n[1];
    assert.ok(towardRoad > road.distance * .94, `${id} faces Main Street`);
    const shops = sides[x < road.x ? 'west' : 'east'];
    const total = frontage.shops.reduce((sum, shop) => sum + shop.weight, 0);
    let u = 0;
    for (const shop of frontage.shops) {
      const width = wall.length * shop.weight / total;
      const [, shopZ] = wall.at(u + width / 2);
      shops.push({ name: shop.name, z: shopZ });
      u += width;
    }
  }
  // Probe adjacent tenants as well as different footprints. Reversing one wall
  // can otherwise put both shops on the correct block, but above the wrong doors.
  const checkOrder = (side, landmarks) => {
    const names = sides[side].sort((a, b) => b.z - a.z).map(s => s.name);
    assert.deepEqual(names.filter(name => landmarks.includes(name)), landmarks);
  };
  checkOrder('west', ['EAGLE HILL HOMES', 'Santander', 'BRUEGGER’S BAGELS', 'EdwardJones', 'JEFF CARBONE', 'CVS/pharmacy', 'Reading Cooperative Bank', 'CAFFÈ NERO', 'LEADING EDGE', 'Victoria Hill']);
  checkOrder('east', ['RISING EAGLE', 'btone', 'the beauty cafe', 'TENOCH', 'STARBUCKS COFFEE', 'PLANTED', 'BUCKALEW’S', 'BIG FIN', 'PLAZA BARBER SHOP', 'PEPPERBERRY']);
  assert.equal(MAIN_STREET_FRONTAGES[MELROSE_YMCA_ID], undefined, 'the existing YMCA has its own model');
});
