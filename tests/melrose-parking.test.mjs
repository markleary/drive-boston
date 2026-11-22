import assert from 'node:assert/strict';
import test from 'node:test';
import { drawnStreets } from '../src/simulation/drawn-streets.ts';
import { mainStreetParking } from '../src/simulation/melrose-parking.ts';
import { MAIN_STREET_TILE, MAIN_STREET_HEADING, MAIN_STREET_PARKLET, mainStreetEast, mainStreetStation } from '../src/simulation/melrose-main-street.ts';
import { parkedCar } from '../src/simulation/parking-lots.ts';
import { loadTileHeaders, readJson } from './helpers/metro-city.mjs';

test('Main Street parallel parking fits the widened asphalt and faces with traffic on each side', () => {
  const tile = loadTileHeaders(readJson('city.json'), [MAIN_STREET_TILE]).get(MAIN_STREET_TILE);
  const drawn = drawnStreets(tile), { stalls, white } = mainStreetParking();
  assert.ok(stalls.length >= 24);
  const occupied = stalls.map(parkedCar).filter(Boolean);
  assert.ok(occupied.length >= 14 && occupied.length < stalls.length);
  for (const { x, z, yaw, spec } of occupied) {
    const side = Math.sign(mainStreetEast(x, z)), s = mainStreetStation(x, z);
    assert.ok(Math.cos(yaw - MAIN_STREET_HEADING) * side > .99);
    if (side === 1) assert.ok(s < MAIN_STREET_PARKLET[0] - 3 || s > MAIN_STREET_PARKLET[1] + 3);
    for (const halfWidth of [-spec.width / 2, spec.width / 2]) {
      for (const halfLength of [-spec.length / 2, spec.length / 2]) {
        const px = x + Math.cos(yaw) * halfWidth + Math.sin(yaw) * halfLength;
        const pz = z - Math.sin(yaw) * halfWidth + Math.cos(yaw) * halfLength;
        assert.ok(drawn.paved(px, pz), 'wheel and body clear the curb');
        assert.ok(Math.abs(mainStreetEast(px, pz)) > 3.8, 'the through lane stays clear');
      }
    }
  }
  for (const line of white) for (const p of line) assert.ok(drawn.paved(...p), 'T marks lie on asphalt');
});
