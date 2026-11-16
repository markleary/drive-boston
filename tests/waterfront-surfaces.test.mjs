import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { loadMetroCity } from './helpers/metro-city.mjs';
import { waterfrontDetailSteps } from '../src/render/waterfront.ts';
import { waterfrontSites } from '../src/simulation/waterfront.ts';
import { drain } from '../src/render/pacing.ts';

const city = await loadMetroCity({ tiles: [] });

test('Navy Yard paving shares smooth normals across its DEM triangle boundaries', () => {
  const group = new THREE.Group(), colliders = [];
  drain(waterfrontDetailSteps(city, group, { bounds: { minX: 1430, maxX: 1520, minZ: -2560, maxZ: -2450 }, mobile: true,
    onShore: (vertices, indices) => colliders.push({ vertices, indices }) }));
  const decks = group.children.filter(mesh => mesh.name.endsWith('paved deck'));
  assert.ok(decks.length > 0);
  let varyingTriangles = 0, sharedVertices = 0;
  const seen = new Map();
  for (const mesh of decks) {
    const { position: p, normal: n } = mesh.geometry.attributes;
    assert.ok(colliders.some(c => c.vertices === p.array), 'normal smoothing leaves exact collision positions intact');
    for (let i = 0; i < p.count; i++) {
      const normal = [n.getX(i), n.getY(i), n.getZ(i)], key = `${p.getX(i)},${p.getZ(i)}`;
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6);
      const previous = seen.get(key);
      if (previous) {
        assert.deepEqual(normal, previous, 'coincident corners cannot reveal a flat-shading crease');
        sharedVertices++;
      } else seen.set(key, normal);
      if (i % 3 === 0 && Math.hypot(n.getX(i) - n.getX(i + 1), n.getY(i) - n.getY(i + 1), n.getZ(i) - n.getZ(i + 1)) > 1e-5) varyingTriangles++;
    }
  }
  assert.ok(sharedVertices > 100);
  assert.ok(varyingTriangles > 100, 'broad pavement interpolates the terrain normals within each face');
  for (const mesh of group.children) mesh.geometry.dispose();
});

test('only waterfront ground layers receive a constant depth bias beneath surveyed asphalt', () => {
  for (const id of ['piers-park', 'charlestown-navy-yard', 'east-boston-chelsea-creek']) {
    const site = waterfrontSites.find(s => s.id === id), group = new THREE.Group();
    drain(waterfrontDetailSteps(city, group, { bounds: site.bounds, mobile: true }));
    const ground = group.children.filter(mesh => /paved deck|inset lawn/.test(mesh.name));
    assert.ok(ground.length > 0);
    for (const mesh of ground) {
      assert.equal(mesh.material.polygonOffset, true);
      assert.equal(mesh.material.polygonOffsetFactor, 0, 'clipped Float32 sliver slopes cannot push the deck behind its underlying lawn');
      assert.equal(mesh.material.polygonOffsetUnits, 3, 'unbiased asphalt remains in front despite millimetre height separation');
    }
    if (id === 'piers-park') assert.ok(ground.some(mesh => mesh.name.endsWith('inset lawn')));
    for (const mesh of group.children.filter(mesh => mesh.name === 'Wharf walls, railings and furnishings')) assert.equal(mesh.material.polygonOffset, false, 'structural quay faces do not inherit a ground decal bias');
    for (const mesh of group.children) mesh.geometry.dispose();
  }
});
