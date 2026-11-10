import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { computeBounds } from '../src/render/fast-bounds.ts';

const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const geometryOf = positions => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3)); return g; };
/** three's own bounds for the same positions. */
const reference = positions => { const g = geometryOf(positions.slice()); g.computeBoundingBox(); g.computeBoundingSphere(); return g; };
const same = (g, r, message) => {
  assert.deepEqual(g.boundingSphere.center.toArray(), r.boundingSphere.center.toArray(), `${message}: centre`);
  assert.equal(g.boundingSphere.radius, r.boundingSphere.radius, `${message}: radius`);
  if (g.boundingBox) { assert.deepEqual(g.boundingBox.min.toArray(), r.boundingBox.min.toArray(), `${message}: box min`); assert.deepEqual(g.boundingBox.max.toArray(), r.boundingBox.max.toArray(), `${message}: box max`); }
};

test('the fast bounds are three\'s bounds, to the bit', () => {
  const random = seeded(7);
  for (let round = 0; round < 60; round++) {
    // World-scale coordinates (kilometres from the origin, metres apart), as a tile's parts have.
    const count = 1 + Math.floor(random() * 400), ox = (random() - .5) * 16000, oz = (random() - .5) * 24000, spread = 10 ** (random() * 4 - 1);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { positions[i * 3] = ox + (random() - .5) * spread; positions[i * 3 + 1] = random() * 80 - 5; positions[i * 3 + 2] = oz + (random() - .5) * spread; }
    const g = geometryOf(positions); computeBounds(g);
    same(g, reference(positions), `round ${round}`);
    assert.ok(g.boundingBox);
  }
});

test('sphere only leaves the bounding box alone', () => {
  const positions = new Float32Array([0, 0, 0, 10, 2, -4, -3, 7, 5]), g = geometryOf(positions);
  computeBounds(g, false);
  assert.equal(g.boundingBox, null);
  same(g, reference(positions), 'sphere');
  // An existing sphere and box are reused, not replaced.
  const sphere = g.boundingSphere; positions[3] = 40; computeBounds(g);
  assert.equal(g.boundingSphere, sphere);
  same(g, reference(positions), 'recomputed');
});

test('anything three treats specially takes three\'s own path', t => {
  const errors = t.mock.method(console, 'error', () => {});
  // A coordinate that is not a finite number: three reports it and so does this.
  for (const bad of [NaN, Infinity]) {
    const positions = new Float32Array([0, 0, 0, 1, bad, 0, 0, 1, 1]), g = geometryOf(positions), r = reference(positions), before = errors.mock.callCount();
    computeBounds(g);
    assert.ok(errors.mock.callCount() > before, 'three\'s message');
    assert.equal(Number.isNaN(g.boundingSphere.radius), Number.isNaN(r.boundingSphere.radius));
    assert.deepEqual(g.boundingBox.min.toArray().map(String), r.boundingBox.min.toArray().map(String));
  }
  // No vertices, another array type, an interleaved attribute.
  const empty = geometryOf(new Float32Array(0)); computeBounds(empty); assert.equal(empty.boundingSphere.radius, reference(new Float32Array(0)).boundingSphere.radius);
  const doubles = new THREE.BufferGeometry(); doubles.setAttribute('position', new THREE.BufferAttribute(new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 10]), 3)); computeBounds(doubles);
  const expected = new THREE.BufferGeometry(); expected.setAttribute('position', new THREE.BufferAttribute(new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 10]), 3)); expected.computeBoundingBox(); expected.computeBoundingSphere();
  same(doubles, expected, 'Float64');
  const buffer = new THREE.InterleavedBuffer(new Float32Array([0, 0, 0, 9, 9, 5, 0, 0, 9, 9, 0, 5, 0, 9, 9]), 5), interleaved = new THREE.BufferGeometry(); interleaved.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  computeBounds(interleaved);
  assert.deepEqual(interleaved.boundingBox.max.toArray(), [5, 5, 0], 'the stride is honoured, not read as packed positions');
});
