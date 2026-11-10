/** Cut a triangle mesh into runs of at most `limit` triangles, in triangle order, each with only the vertices it
 * uses. The physics engine builds a mesh collider's tree in one call, about 0.3 µs a triangle: a harbour tile's
 * shore bank is 190,000 triangles, 58 ms in one frame. The tile builder adds the runs between frames instead (a run
 * of 8,192 takes under 3 ms). A mesh within the limit is passed through as it is.
 *
 * Runs meet at seams the engine's internal-edge fix does not see across. Measured on a bank of that size
 * (tests/collider-runs.test.mjs holds a small version): 240 random walks and runs of twelve seconds never stall,
 * most are identical to the bit, and the rest differ by a one-frame blip of a few millimetres at a seam, as the
 * whole mesh gives on uneven ground anyway; 80 sliding car bodies travel the same distance on average. */
export function* meshChunks(vertices: Float32Array, indices: Uint32Array, limit = 8192): Generator<{ vertices: Float32Array; indices: Uint32Array }> {
  const triangles = Math.floor(indices.length / 3);
  if (triangles <= limit) { yield { vertices, indices }; return; }
  const remap = new Int32Array(vertices.length / 3).fill(-1);
  for (let from = 0; from < triangles; from += limit) {
    const to = Math.min(triangles, from + limit), local = new Uint32Array((to - from) * 3), picked: number[] = [];
    for (let i = from * 3; i < to * 3; i++) { const v = indices[i]; let n = remap[v]; if (n < 0) { n = remap[v] = picked.length; picked.push(v); } local[i - from * 3] = n; }
    const part = new Float32Array(picked.length * 3);
    for (let i = 0; i < picked.length; i++) { const v = picked[i] * 3; part[i * 3] = vertices[v]; part[i * 3 + 1] = vertices[v + 1]; part[i * 3 + 2] = vertices[v + 2]; remap[picked[i]] = -1; }
    yield { vertices: part, indices: local };
  }
}
