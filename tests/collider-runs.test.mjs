import assert from 'node:assert/strict';
import test from 'node:test';
import { DrivingPhysics } from '../src/physics/vehicle.ts';
import { meshChunks } from '../src/simulation/mesh-chunks.ts';
import { createWalker, WALKER } from '../src/simulation/walker.ts';

const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
/** Every triangle as nine coordinates, in order. */
const triangles = ({ vertices, indices }) => Array.from(indices, i => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]]).flat();

test('a mesh within the limit is passed through untouched', () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]), indices = new Uint32Array([0, 2, 1, 1, 2, 3]);
  const parts = [...meshChunks(vertices, indices, 2)];
  assert.equal(parts.length, 1);
  assert.equal(parts[0].vertices, vertices);
  assert.equal(parts[0].indices, indices);
});

test('runs keep every triangle, in order, with only the vertices each uses', () => {
  const random = seeded(11);
  for (const indexed of [true, false]) {
    // A lattice strip like a shore bank: shared corners when indexed, a soup otherwise.
    const w = 37, h = 9, grid = [];
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) grid.push(i * .75 + 600, random() * 2, j * .75 - 2500);
    let vertices = new Float32Array(grid), ids = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const a = j * (w + 1) + i, b = a + 1, c = a + w + 1, d = c + 1; ids.push(a, c, b, b, c, d); }
    let indices = new Uint32Array(ids);
    if (!indexed) { vertices = new Float32Array(triangles({ vertices, indices })); indices = Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i); }
    const whole = triangles({ vertices, indices }), limit = 100, parts = [...meshChunks(vertices, indices, limit)];
    assert.equal(parts.length, Math.ceil(indices.length / 3 / limit));
    assert.deepEqual(parts.flatMap(triangles), whole, 'the same triangles in the same order');
    for (const [n, part] of parts.entries()) {
      assert.ok(part.indices.length / 3 <= limit && part.indices.length % 3 === 0);
      if (n < parts.length - 1) assert.equal(part.indices.length / 3, limit);
      const used = new Set(part.indices);
      assert.equal(used.size, part.vertices.length / 3, 'no vertex a run does not use');
      assert.ok(Math.max(...part.indices) < part.vertices.length / 3);
      if (indexed) assert.ok(part.vertices.length / 3 < part.indices.length, 'shared corners stay shared within a run');
    }
  }
});

test('a trailing partial triangle is ignored and the default run is a few thousand triangles', () => {
  const count = 20000, vertices = new Float32Array(count * 9).map((_, i) => i % 17), indices = Uint32Array.from({ length: count * 3 + 2 }, (_, i) => Math.min(i, count * 3 - 1));
  const parts = [...meshChunks(vertices, indices)];
  assert.deepEqual(parts.map(p => p.indices.length / 3), [8192, 8192, 3616]);
});

test('walking and running across the seams between runs is walking across the whole mesh', async () => {
  const idle = { forward: 0, strafe: 0, turn: 0, run: false, jump: false }, parked = { throttle: 0, brake: 1, steer: 0, handbrake: true };
  const flatCity = () => ({ bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, buildings: [], roads: [], spawn: { x: 0, z: 0, yaw: 0 } });
  // A bank like a shore's: a 0.75 m lattice rising smoothly from the ground to 1.4 m across its width, undulating along it.
  const X0 = 60, Z0 = -30, W = 32, L = 80, STEP = .75;
  const height = (x, z) => { const t = Math.min(1, Math.max(0, (x - X0) / 12)), blend = t * t * (3 - 2 * t); return .026 + 1.4 * blend + .12 * Math.sin(z * .21) * blend; };
  const soup = [];
  for (let i = 0; i < W; i++) for (let j = 0; j < L; j++) {
    const x = X0 + i * STEP, z = Z0 + j * STEP;
    for (const [px, pz] of [[x, z], [x, z + STEP], [x + STEP, z], [x + STEP, z], [x, z + STEP], [x + STEP, z + STEP]]) soup.push(px, height(px, pz), pz);
  }
  const vertices = new Float32Array(soup), indices = Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i);
  const walks = [
    { name: 'along the bank, mid slope', start: [X0 + 6, Z0 + 4], yaw: 0, seconds: 30 },
    { name: 'running along its top', start: [X0 + 14, Z0 + 4], yaw: 0, run: true, seconds: 10 },
    { name: 'up the bank, across every row', start: [X0 + 1, Z0 + 20], yaw: Math.PI / 2, seconds: 14 },
    { name: 'down the bank', start: [X0 + 22, Z0 + 31], yaw: -Math.PI / 2, seconds: 14 },
    { name: 'diagonally', start: [X0 + 2, Z0 + 3], yaw: Math.PI / 5, seconds: 22 },
    { name: 'running back diagonally', start: [X0 + 21, Z0 + 55], yaw: Math.PI * 1.2, run: true, seconds: 8 },
  ];
  const tracks = [];
  for (const limit of [Infinity, 1024]) {
    const physics = await DrivingPhysics.create(flatCity()), walker = createWalker(flatCity(), physics); let colliders = 0;
    try {
      for (const part of meshChunks(vertices, indices, limit)) { physics.addStaticMesh(part.vertices, part.indices); colliders++; }
      assert.equal(colliders, limit === Infinity ? 1 : 5);
      tracks.push(walks.map(w => {
        walker.place(w.start[0], height(...w.start), w.start[1], w.yaw); const track = [], input = { ...idle, forward: 1, run: !!w.run };
        for (let i = 0; i < w.seconds * 60; i++) { walker.update(1 / 60, input); physics.step(parked, 1 / 60); const s = walker.state; track.push([s.x, s.y, s.z, s.speed]); }
        return track;
      }));
    } finally { walker.dispose(); physics.dispose(); }
  }
  const [whole, cut] = tracks;
  walks.forEach((w, n) => {
    const pace = w.run ? WALKER.runSpeed : WALKER.walkSpeed; let gap = 0, slow = 0, stalled = false;
    for (let i = 0; i < cut[n].length; i++) {
      gap = Math.max(gap, Math.hypot(cut[n][i][0] - whole[n][i][0], cut[n][i][1] - whole[n][i][1], cut[n][i][2] - whole[n][i][2]));
      // Past the first third of a second (getting up to pace), on the bank: under half pace for a tenth of a second is a stall.
      if (i > 20 && cut[n][i][0] > X0 + 1 && cut[n][i][3] < pace * .5) { if (++slow >= 6) stalled = true; } else slow = 0;
    }
    assert.ok(gap < .05, `${w.name}: within 5 cm of the walk over the whole mesh at every step (${(gap * 1000).toFixed(1)} mm)`);
    assert.equal(stalled, false, `${w.name}: no seam holds the walker`);
  });
});
