import assert from 'node:assert/strict';
import test from 'node:test';
import shell from '../src/data/schrafft-shell.json' with { type: 'json' };
import { SCHRAFFT_ID, SCHRAFFT_FIRST, schrafftWorld, schrafftFrame } from '../src/render/schrafft-center.ts';
import { CITGO, citgoSequence, citgoSupportX } from '../src/render/citgo-sign.ts';
import { loadMetroCity } from './helpers/metro-city.mjs';

const city = await loadMetroCity({ tiles: ['0_-4', '-2_0'] });

test('Schrafft preserves the survey footprint, shell and collision, with one matching far hull', () => {
  const source = city.geometry.get(SCHRAFFT_ID), building = city.buildings.find(b => b.id === SCHRAFFT_ID);
  assert.deepEqual(building.footprint, shell.building.footprint);
  assert.deepEqual(Array.from(source.facade), shell.facade);
  assert.deepEqual(Array.from(source.roof), shell.roof);
  assert.equal(source.positions.length, shell.positions.length);
  source.positions.forEach((p, i) => assert.ok(Math.abs(p - shell.positions[i]) < .00051));
  const matches = city.far.tiles.get('0_-4').buildings.filter(b => !b.fragment && Math.hypot(b.footprint[0][0] - SCHRAFFT_FIRST[0], b.footprint[0][1] - SCHRAFFT_FIRST[1]) < .14);
  assert.equal(matches.length, 1);
  for (const p of [[0, 0], [13.36, 13.12], [56, 145]]) {
    const q = schrafftFrame(...schrafftWorld(...p)); assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9);
  }
});

test('restored CITGO sits on the redevelopment roof with its real 60-foot faces', () => {
  assert.ok(Math.abs(CITGO.width - 60 * .3048) < 1e-9);
  assert.equal(CITGO.width, CITGO.height);
  assert.ok(Math.abs(CITGO.position[0] - CITGO.original[0] - 120 * .3048) < 1e-9);
  const host = city.index.at(...CITGO.position);
  assert.ok(host, 'new supports land on a building, not Beacon Street');
  assert.ok(Math.abs(host.base + host.height - CITGO.roof) < .1);
  for (const x of [-6.3, 0, 6.3]) for (const z of [-1.55, 1.55]) {
    const foot = citgoSupportX(x, CITGO.roof), [nx, nz] = CITGO.normal;
    const roof = city.index.at(CITGO.position[0] + nz * foot + nx * z, CITGO.position[1] - nx * foot + nz * z);
    assert.ok(roof && Math.abs(roof.base + roof.height - CITGO.roof) < .1, 'every support foot lands on the host roof');
  }
  assert.ok(CITGO.bottom > CITGO.roof + 10);
  assert.ok(Math.abs(CITGO.bottom - (26.407 + 40 * .3048 + 30 * .3048)) < .001);
});

test('CITGO sequence retains the blue letters through wipes and two flashes', () => {
  for (const t of [0, 6, 11, 16, 21, 24.3, 25.5, 27]) assert.equal(citgoSequence(t).letters, true);
  assert.ok(citgoSequence(6).white < citgoSequence(0).white);
  assert.ok(citgoSequence(11).white < citgoSequence(14).white);
  assert.ok(citgoSequence(16).triangle < 1);
  assert.ok(citgoSequence(21).triangle < 1);
  assert.equal(citgoSequence(24.3).flash, true); assert.equal(citgoSequence(25.5).flash, true); assert.equal(citgoSequence(27).flash, false);
  assert.deepEqual(citgoSequence(0), citgoSequence(28));
});
