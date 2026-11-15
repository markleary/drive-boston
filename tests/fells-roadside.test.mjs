import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { loadMetroCity } from './helpers/metro-city.mjs';
import { sampleElevation } from '../src/simulation/terrain.ts';
import { roadProjection } from '../src/simulation/road-surfaces.ts';
import { FELLS_TRAILHEAD, FELLS_PULLOFF, fellsRoadsideSpans, fellsRoadsideReserved, fellsRockCutPlan, fellsRoadsideRockAt } from '../src/simulation/fells-roadside.ts';
import { fellsRockCutGeometry, fellsRoadsideSteps } from '../src/render/fells-roadside.ts';

const bounds = { minX: -1000, maxX: 0, minZ: -12000, maxZ: -9700 };
const cityPromise = loadMetroCity({ tiles: ['-1_-12', '-1_-11', '-1_-10'] });
const midpoint = span => [(span.a[0] + span.b[0]) / 2, (span.a[1] + span.b[1]) / 2];

test('Fellsway rails protect actual falling banks while rock cuts cover rising banks', async () => {
  const city = await cityPromise, spans = [...fellsRoadsideSpans(city, bounds)];
  const rails = spans.filter(s => s.kind === 'rail'), rock = spans.filter(s => s.kind === 'rock');
  assert.ok(rails.length > 70, 'substantial downhill road edges get protection');
  assert.ok(rock.length > 100, 'steep hillside is visibly exposed rock');
  for (const span of spans) {
    const p = midpoint(span), base = sampleElevation(city, ...p), offset = span.kind === 'rail' ? 21.2 : 15.5;
    const outside = sampleElevation(city, p[0] + span.outward[0] * offset, p[1] + span.outward[1] * offset);
    if (span.kind === 'rail') {
      const near = sampleElevation(city, p[0] + span.outward[0] * 11.2, p[1] + span.outward[1] * 11.2);
      assert.ok(base - near > 1.29 || base - outside > 2.99, 'a level roadside must stay unguarded');
      assert.ok(roadProjection(span.road, ...p).distance > span.road.width / 2 + .65, 'the rail stays out of the travel lanes');
    } else assert.ok(outside > base, 'a cut never rises out of a downhill void');
  }
});

test('Fellsway guardrails leave mapped trail entrances and the parking pull-off open', async () => {
  const city = await cityPromise;
  for (const span of fellsRoadsideSpans(city, bounds)) {
    if (span.kind !== 'rail') continue;
    for (const p of [span.a, midpoint(span), span.b]) {
      assert.ok(!(p[0] >= FELLS_PULLOFF.minX && p[0] <= FELLS_PULLOFF.maxX && p[1] >= FELLS_PULLOFF.minZ && p[1] <= FELLS_PULLOFF.maxZ));
      for (const path of city.parkPaths) assert.ok(roadProjection(path, ...p).distance >= path.width / 2 + 1.79, 'rideable entrance stays clear of metal rail');
    }
  }
  const access = city.parkPaths.find(p => p.id.startsWith('osm-way-415298819'));
  assert.ok(access, 'fixture contains the parking access path');
  assert.ok(roadProjection(access, FELLS_TRAILHEAD.x, FELLS_TRAILHEAD.z).distance < 8, 'map board stands by the existing access');
  assert.ok(fellsRoadsideReserved(city, FELLS_TRAILHEAD.x, FELLS_TRAILHEAD.z));
  assert.ok(!fellsRoadsideReserved(city, FELLS_TRAILHEAD.x - 30, FELLS_TRAILHEAD.z));
});

test('tile ownership emits roadside spans once, and exposed stone follows shared physics terrain', async () => {
  const city = await cityPromise, all = [...fellsRoadsideSpans(city, bounds)];
  const key = span => `${span.kind}:${span.a.join(',')}:${span.b.join(',')}`;
  const tiled = [-12000, -11000, -10000].flatMap(minZ => [...fellsRoadsideSpans(city, { ...bounds, minZ, maxZ: Math.min(minZ + 1000, bounds.maxZ) })]);
  assert.equal(new Set(tiled.map(key)).size, tiled.length, 'no duplicate rails/collision at tile seams');
  assert.deepEqual(tiled.map(key).sort(), all.map(key).sort());
  for (const span of all.filter(s => s.kind === 'rock').filter((_, i) => i % 13 === 0)) {
    const g = fellsRockCutGeometry(city, span), p = g.getAttribute('position'), n = g.getAttribute('normal');
    let buried = 0, exposed = 0;
    for (let i = 0; i < p.count; i++) {
      const height = p.getY(i) - sampleElevation(city, p.getX(i), p.getZ(i));
      assert.ok(height > -.22 && height < 1.21, `rock is embedded in its supporting hillside: ${height}`);
      if (height < -.1) buried++; else if (height > .2) exposed++;
      assert.ok(n.getY(i) > 0, 'roadside rock faces point outward/up rather than under the terrain');
    }
    if (p.count) {
      assert.ok(buried > 0 && exposed > 0, 'jagged perimeter tucks under soil while fractured center is exposed');
      const cut = fellsRockCutPlan(city, span);
      assert.ok(fellsRoadsideRockAt(city, ...cut.center), 'trunk clearance uses the raised stone footprint');
      assert.ok(cut.halfDepth * cut.halfLength * Math.PI < 15.5 * Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1]) * .75, 'exposure leaves soil gaps instead of covering a rectangular apron');
    }
    g.dispose();
  }
});

test('rendered roadside supplies matching solid rails and rock triangles for physics', async () => {
  const city = await cityPromise, group = new THREE.Group(), solids = [], rocks = [];
  const area = { minX: -1000, maxX: 0, minZ: -11000, maxZ: -10310 }; // excludes the DOM-textured kiosk
  const iterator = fellsRoadsideSteps(city, group, { bounds: area, onSolids: boxes => solids.push(...boxes), onRock: (vertices, indices) => rocks.push({ vertices, indices }) });
  let next; do { next = iterator.next(); } while (!next.done);
  const result = next.value;
  assert.ok(result.userData.guardrailSpans > 0 && result.userData.rockCuts > 0);
  assert.equal(solids.length, result.userData.guardrailSpans);
  assert.equal(rocks.length, 1);
  assert.ok(rocks[0].indices.length > 0);
  assert.ok(solids.every(s => s.height === .4 && s.length > 0 && Number.isFinite(s.slope)));
  assert.ok(result.children.some(mesh => mesh.name === 'Fellsway East exposed rock cuts'));
});
