import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { clipShoreTerrainSteps } from '../src/render/shore-terrain.ts';
import { terrainGeometry } from '../src/render/terrain-ground.ts';
import { parkSurface, shoreBankGeometry, WATER_SURFACE_OFFSET } from '../src/render/area-surfaces.ts';
import { waterShore } from '../src/render/water-shore.ts';
import { drain } from '../src/render/pacing.ts';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { waterHeight } from '../src/simulation/water-level.ts';
import { pointInside } from '../src/simulation/roads.ts';
import { loadMetroCity } from './helpers/metro-city.mjs';
import { createWalker } from '../src/simulation/walker.ts';

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const water = { id: 'pond', name: 'Pond', rings: [rect(0, 0, 30, 30)], surfaces: [{ rings: [rect(0, 0, 30, 30)], level: 0 }] };
const city = { bounds: { minX: -6, maxX: 36, minZ: -6, maxZ: 36 }, roads: [], water: [water], elevation: { width: 8, height: 8, originX: -6, originZ: -6, cellSize: 6, heights: new Array(64).fill(4) } };
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const hit = (g, x, z) => new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0)).intersectObject(new THREE.Mesh(g, material))[0]?.point.y;
function surfaces(city, water, surface, bounds) {
  const shore = waterShore(water, surface.rings), bankPositions = [];
  const sheet = parkSurface(city, shore.rings, WATER_SURFACE_OFFSET, surface.level, bounds, true, shore, bankPositions);
  return { sheet, bank: shoreBankGeometry(bankPositions) };
}

test('high DEM grass is replaced by a smooth descending bank with matching collision', async () => {
  const ground = terrainGeometry(city), { sheet, bank } = surfaces(city, water, water.surfaces[0]);
  assert.equal(hit(ground, 4, 12), 4, 'the old terrain protrudes above water');
  drain(clipShoreTerrainSteps(city, ground));
  assert.equal(hit(ground, 4, 12), undefined, 'the grass tooth and its hidden collision are removed');
  assert.equal(hit(ground, -1, 12), 4, 'dry land keeps its original height');
  assert.ok(Math.abs(hit(sheet, 4, 12) - .035) < 1e-6, 'water reaches the mapped bank despite the coarse DEM');
  assert.ok(Math.abs(hit(bank, 1.5, 12) - 2.026) < 1e-5, 'the bank descends smoothly from land to the waterline');
  const p = bank.attributes.position, n = bank.attributes.normal, normals = new Map();
  let shared = 0;
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].join(','), normal = [n.getX(i), n.getY(i), n.getZ(i)];
    if (normals.has(key)) { assert.deepEqual(normal, normals.get(key), 'clipped triangles share smooth bank shading'); shared++; }
    else normals.set(key, normal);
  }
  assert.ok(shared > 100);
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(RAPIER.ColliderDesc.trimesh(ground.attributes.position.array, ground.index.array));
    world.createCollider(RAPIER.ColliderDesc.trimesh(bank.attributes.position.array, Uint32Array.from({ length: bank.attributes.position.count }, (_, i) => i)));
    world.step();
    const contact = world.castRay(new RAPIER.Ray({ x: 1.5, y: 10, z: 12 }, { x: 0, y: -1, z: 0 }), 20, true);
    assert.ok(contact); assert.ok(Math.abs(10 - contact.timeOfImpact - hit(bank, 1.5, 12)) < 1e-5);
    const walker = createWalker({ ...city, spawn: { x: -3, z: 12, yaw: 0 } }, { world });
    try {
      walker.place(3.35, .026, 12, 0);
      for (let i = 0; i < 120; i++) {
        walker.update(1 / 60, { forward: 0, strafe: 0, turn: 0, run: false, jump: i >= 20 && i < 40 }); world.step();
        assert.ok(walker.state.y < 2, 'standing or jumping on the lower bank does not teleport the walker up to the old DEM');
      }
      assert.ok(walker.state.grounded);
      walker.place(12, .026, 12, 0);
      for (let i = 0; i < 20; i++) {
        walker.update(1 / 60, { forward: 0, strafe: 0, turn: 0, run: false, jump: false }); world.step();
      }
      assert.ok(walker.state.y > 3, 'a genuine unsupported hole still triggers recovery');
    } finally { walker.dispose(); }
  } finally { world.free(); ground.dispose(); sheet.dispose(); bank.dispose(); }
});

test('shore cuts preserve overlapping ground paths, road foundations, islands and submerged beds', () => {
  const holed = { ...water, rings: [water.rings[0], rect(12, 12, 18, 18)] };
  holed.surfaces = [{ rings: holed.rings, level: 0 }];
  const fixture = { ...city, water: [holed], roads: [{ id: 'road', width: 2, points: [[-6, 6], [36, 6]] }], parkPaths: [{ id: 'walk', width: 2, points: [[-6, 24], [36, 24]] }, { id: 'cross', width: 2, points: [[24, -6], [24, 36]] }] };
  const ground = drain(clipShoreTerrainSteps(fixture, terrainGeometry(fixture)));
  for (const [x, z] of [[15, 15], [15, 6], [15, 24], [24, 24]]) assert.equal(hit(ground, x, z), 4, `support remains at ${x}, ${z}`);
  assert.equal(hit(ground, 7, 16), undefined);
  const low = { ...city, elevation: { ...city.elevation, heights: new Array(64).fill(-2) } };
  const bed = terrainGeometry(low), original = bed.attributes.position;
  drain(clipShoreTerrainSteps(low, bed));
  assert.equal(bed.attributes.position, original); assert.equal(hit(bed, 15, 15), -2);
  ground.dispose(); bed.dispose();
});

test('neighboring tiles carve the same diagonal shoreline and retain bank coverage at their seam', () => {
  const slanted = { ...water, rings: [[[0, 0], [30, 0], [24, 30], [6, 30]]] };
  slanted.surfaces = [{ rings: slanted.rings, level: 0 }];
  const fixture = { ...city, water: [slanted] };
  const seam = (originZ, height) => {
    const part = { ...fixture, elevation: { ...fixture.elevation, originZ, height, heights: new Array(8 * height).fill(4) } };
    const geometry = drain(clipShoreTerrainSteps(part, terrainGeometry(part))), p = geometry.attributes.position;
    const points = new Set();
    for (let i = 0; i < p.count; i++) if (p.getZ(i) === 12) points.add(`${p.getX(i)},${p.getY(i)}`);
    // Earcut can add collinear vertices on just one side of a tile boundary.
    // The dry spans and their shoreline endpoints must still match exactly.
    const xs = [...points].map(p => Number(p.split(',')[0]));
    geometry.dispose(); return [Math.min(...xs), Math.max(...xs.filter(x => x < 15)), Math.min(...xs.filter(x => x > 15)), Math.max(...xs)];
  };
  assert.deepEqual(seam(-6, 4), seam(12, 5));
  for (const bounds of [{ minX: -6, maxX: 36, minZ: -6, maxZ: 12 }, { minX: -6, maxX: 36, minZ: 12, maxZ: 36 }]) {
    const { sheet, bank } = surfaces(fixture, slanted, slanted.surfaces[0], bounds);
    assert.ok(Math.abs(hit(sheet, 9, 12) - .035) < 1e-6);
    assert.ok(hit(bank, 4, 12) > .026);
    sheet.dispose(); bank.dispose();
  }
});

test('reported dam shoreline and other affected waterways no longer contain DEM grass wedges', async () => {
  const metro = await loadMetroCity({ tiles: [] });
  const inside = (p, rings) => pointInside(p, rings[0]) && !rings.slice(1).some(r => pointInside(p, r));
  for (const [name, x, z] of [['Charles River Dam', 229, -2083], ['Charles', -960, -974], ['Fens', -1858, 1180], ['Neponset', -1221, 8999]]) {
    const water = metro.water.find(w => inside([x, z], w.rings));
    const surface = (water.surfaces ?? [{ rings: water.rings, level: waterHeight(metro, water) }]).find(s => inside([x, z], s.rings));
    assert.ok(sampleElevation(metro, x, z) > surface.level + .1, `${name}: fixture reproduces the protruding DEM`);
    const bounds = { minX: x - 6, maxX: x + 6, minZ: z - 6, maxZ: z + 6 };
    const ground = parkSurface(metro, [rect(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ)]);
    drain(clipShoreTerrainSteps(metro, ground));
    const { sheet, bank } = surfaces(metro, water, surface, bounds);
    assert.equal(hit(ground, x, z), undefined, `${name}: no grass remains inside open water`);
    assert.ok(Math.abs(hit(sheet, x, z) - surface.level - WATER_SURFACE_OFFSET) < 1e-5, `${name}: horizontal water covers the old wedge`);
    ground.dispose(); sheet.dispose(); bank.dispose();
  }
});
