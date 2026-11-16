import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import shell from '../src/data/schrafft-shell.json' with { type: 'json' };
import { SCHRAFFT_ID, SCHRAFFT_FIRST, schrafftWorld, schrafftFrame } from '../src/render/schrafft-center.ts';
import { CITGO, CITGO_SUPPORT_COLUMNS, buildCitgoSign, citgoSequence, citgoSupportX } from '../src/render/citgo-sign.ts';
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
  assert.ok(CITGO.bottom > host.base + host.height + 10);
  assert.ok(Math.abs(CITGO.bottom - (26.407 + 40 * .3048 + 30 * .3048)) < .001);
});

test('all six CITGO legs and the access ladder attach to the detailed stepped roof', () => {
  const source = city.geometry.get('BOS-HNZB1-9VG44-I6AIK');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(source.roof, 1));
  const roof = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  // Canvas drawing is covered by the browser test; here inspect the actual
  // batched frame geometry and survey triangles, not the coarse height hull.
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = new Proxy({ measureText: () => ({ width: 500 }) }, { get: (target, name) => target[name] ?? (() => {}) });
  let sign;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try { sign = buildCitgoSign().group; }
  finally { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; }
  sign.updateMatrixWorld(true);
  const [nx, nz] = CITGO.normal;
  const world = (x, y, z) => new THREE.Vector3(CITGO.position[0] + nz * x + nx * z, y, CITGO.position[1] - nx * x + nz * z);
  const roofAt = (x, z) => new THREE.Raycaster(world(x, 100, z), new THREE.Vector3(0, -1, 0)).intersectObject(roof)[0]?.point.y;
  try {
    for (const { x, roof: expected } of CITGO_SUPPORT_COLUMNS) for (const z of [-1.55, 1.55]) {
      const foot = citgoSupportX(x, CITGO.frameBase), actual = roofAt(foot, z);
      assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < .001, 'foot matches its survey terrace');
      assert.ok(CITGO.frameBase - actual > 4, 'fixture exposes the old floating-frame gap');
      for (const dx of [-.4, .4]) for (const dz of [-.4, .4]) {
        assert.ok(Math.abs(roofAt(foot + dx, z + dz) - actual) < .001, 'the whole base plate is seated on the roof');
      }
      const bottom = new THREE.Raycaster(world(foot, actual - 1, z), new THREE.Vector3(0, 1, 0)).intersectObject(sign, true)[0];
      assert.ok(bottom && bottom.point.y < actual && bottom.point.y > actual - .2, 'leg enters the roof instead of ending above it');
      for (const y of [actual + .5, (actual + CITGO.frameBase) / 2, CITGO.frameBase - .15]) {
        const hits = new THREE.Raycaster(world(foot, y, z - 1), new THREE.Vector3(nx, 0, nz), 0, 1).intersectObject(sign, true);
        assert.ok(hits.some(hit => Math.abs(hit.distance - .885) < .003), `continuous steel leg at ${foot}, ${y}, ${z}`);
      }
    }
    for (const x of [5.6, 6.2]) {
      const actual = roofAt(x, 1.8);
      const bottom = new THREE.Raycaster(world(x, actual - 1, 1.8), new THREE.Vector3(0, 1, 0)).intersectObject(sign, true)[0];
      assert.ok(bottom && bottom.point.y < actual && bottom.point.y > actual - .2, 'ladder reaches the same roof terrace');
    }
  } finally {
    geometry.dispose(); roof.material.dispose();
    sign.traverse(object => { if (object.isMesh) { object.geometry.dispose(); object.material.map?.dispose(); object.material.dispose(); } });
  }
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
