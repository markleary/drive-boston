import * as THREE from 'three';
import { due, nextFrame, type Pace } from './pacing.ts';

/** Sends the vertex and index arrays of new meshes to the GPU a slice at a time, pausing whenever `pace`'s deadline
 * has passed, and returns once they are all there. A mesh waiting for its arrays is hidden until then. */
export type Upload = (meshes: THREE.Mesh[], pace?: Pace) => Generator<void, void>;

/** Arrays below MIN_BYTES go the ordinary way (a few microseconds each); the rest travel SLICE_BYTES at a time, one
 * slice a frame while the build is paced (25 MB a second at 50 fps, a tile's worth in under two seconds). More in
 * one frame fills the browser's transfer buffer, and the next call then waits for the GPU process: 26 to 39 ms. */
const MIN_BYTES = 128 * 1024, SLICE_BYTES = 512 * 1024;
type Sendable = ArrayBufferView & { readonly length: number; readonly BYTES_PER_ELEMENT: number };
type Job = { buffer: WebGLBuffer; array: Sendable; sent: number; cancelled: boolean };

/** three uploads a geometry whole, in the frame that first draws it: `gl.bufferData` copies about a gigabyte a
 * second, so a tile's static batch (tens of megabytes) held that frame for 40 to 70 ms, and turning the camera onto
 * tiles built behind it did the same. Here a new mesh is drawn once into a one-pixel target while `gl.bufferData`
 * only reserves the storage for its large arrays; three then holds the buffers and their vertex array state as
 * usual, and the contents follow through `gl.bufferSubData`, paced. Nothing of three's is replaced: it never
 * uploads those arrays again unless an attribute's version changes. */
const created = new WeakMap<THREE.WebGLRenderer, Upload>();
export function createPacedUploads(renderer: THREE.WebGLRenderer, camera: THREE.Camera): Upload {
  let upload = created.get(renderer); if (!upload) created.set(renderer, upload = pacedUploads(renderer, camera)); return upload;
}
function pacedUploads(renderer: THREE.WebGLRenderer, camera: THREE.Camera): Upload {
  const gl = renderer.getContext() as WebGL2RenderingContext, reserve = gl.bufferData.bind(gl) as (target: number, data: unknown, usage: number, ...rest: number[]) => void;
  if (typeof gl.COPY_WRITE_BUFFER !== 'number') return function* () {};
  /** Arrays whose next bufferData reserves storage only, with the geometry that owns them. */
  const waiting = new Map<ArrayBufferView, THREE.BufferGeometry>(), sent = new WeakSet<ArrayBufferView>(), jobs: Job[] = [];
  let reserved: Job[] = [];
  gl.bufferData = ((target: number, data: unknown, usage: number, ...rest: number[]) => {
    const geometry = ArrayBuffer.isView(data) ? waiting.get(data) : undefined;
    const buffer = geometry ? gl.getParameter(target === gl.ELEMENT_ARRAY_BUFFER ? gl.ELEMENT_ARRAY_BUFFER_BINDING : gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null : null;
    if (!geometry || !buffer) { reserve(target, data, usage, ...rest); return; }
    const array = data as Sendable, job: Job = { buffer, array, sent: 0, cancelled: false };
    waiting.delete(array); reserve(target, array.byteLength, usage);
    jobs.push(job); reserved.push(job);
    // A tile abandoned mid-build disposes its geometry: three deletes the buffer, the rest is not sent.
    geometry.addEventListener('dispose', () => { job.cancelled = true; });
  }) as typeof gl.bufferData;
  // After a lost context three builds every buffer again at its next draw, whole.
  renderer.domElement.addEventListener('webglcontextlost', () => { for (const job of jobs) job.cancelled = true; jobs.length = 0; waiting.clear(); });

  // The draw that has three create the buffers: no colour, no depth, one pixel. Its two program variants (plain and
  // batched) are linked here, while the game is still loading.
  const standIn = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }), pixel = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const draw = (mesh: THREE.Mesh) => {
    const { visible, frustumCulled, material } = mesh, previous = renderer.getRenderTarget();
    mesh.visible = true; mesh.frustumCulled = false; mesh.material = standIn; renderer.setRenderTarget(pixel);
    try { renderer.render(mesh, camera); } finally { mesh.visible = visible; mesh.frustumCulled = frustumCulled; mesh.material = material; renderer.setRenderTarget(previous); }
  };
  {
    const triangle = new THREE.BufferGeometry(); triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const plain = new THREE.Mesh(triangle, standIn), batched = new THREE.BatchedMesh(1, 3, 0, standIn); batched.addInstance(batched.addGeometry(triangle));
    draw(plain); draw(batched); batched.dispose(); triangle.dispose();
  }
  const arraysOf = (geometry: THREE.BufferGeometry) => [...Object.values(geometry.attributes), geometry.index].filter((a): a is THREE.BufferAttribute => !!a && !(a as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute && !!a.array).map(a => a.array as Sendable);

  return function* upload(meshes: THREE.Mesh[], pace?: Pace): Generator<void, void> {
    const hidden: THREE.Mesh[] = [];
    for (const mesh of meshes) {
      const arrays = arraysOf(mesh.geometry).filter(array => array.byteLength >= MIN_BYTES && !sent.has(array));
      if (!arrays.length) continue;
      for (const array of arrays) { waiting.set(array, mesh.geometry); sent.add(array); }
      reserved = []; draw(mesh);
      // An array three already held (the mesh has been drawn) was not asked for again.
      for (const array of arrays) waiting.delete(array);
      // Until its arrays are complete the mesh would draw triangles from unsent (zero) vertices.
      if (reserved.length && mesh.visible) { mesh.visible = false; hidden.push(mesh); }
      if (due(pace)) yield;
    }
    while (jobs.length) {
      const job = jobs[0];
      if (job.cancelled) { jobs.shift(); continue; }
      const count = Math.min(job.array.length - job.sent, Math.ceil(SLICE_BYTES / job.array.BYTES_PER_ELEMENT));
      // The copy binding leaves the vertex array object and the array buffer binding as three left them.
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, job.buffer);
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, job.sent * job.array.BYTES_PER_ELEMENT, job.array, job.sent, count);
      job.sent += count; if (job.sent >= job.array.length) jobs.shift();
      // The streamer gives the rest of this frame's slice to another tile (pacing.ts).
      if (jobs.length) { gl.bindBuffer(gl.COPY_WRITE_BUFFER, null); yield* nextFrame(pace); }
    }
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    for (const mesh of hidden) mesh.visible = true;
  };
}
