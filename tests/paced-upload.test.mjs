import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createPacedUploads } from '../src/render/paced-upload.ts';

const SLICE = 512 * 1024;
/** A WebGL2 context and renderer reduced to what an upload touches. `render` does what three does for a mesh it has
 * not drawn before: one buffer per attribute, filled by gl.bufferData with the attribute's whole array. */
function fakeRenderer() {
  let ids = 0;
  const gl = {
    ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, COPY_WRITE_BUFFER: 36663, ARRAY_BUFFER_BINDING: 34964, ELEMENT_ARRAY_BUFFER_BINDING: 34965, STATIC_DRAW: 35044,
    bound: new Map(), calls: [],
    bindBuffer(target, buffer) { this.bound.set(target, buffer); },
    bufferData(target, data) {
      const buffer = this.bound.get(target), reserved = typeof data === 'number';
      buffer.bytes = reserved ? new Uint8Array(data) : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      this.calls.push({ call: 'data', id: buffer.id, bytes: buffer.bytes.length, reserved });
    },
    bufferSubData(target, offset, data, from, length) {
      const buffer = this.bound.get(target), bytes = new Uint8Array(data.buffer, data.byteOffset + from * data.BYTES_PER_ELEMENT, length * data.BYTES_PER_ELEMENT);
      buffer.bytes.set(bytes, offset); this.calls.push({ call: 'sub', id: buffer.id, target, offset, bytes: bytes.length });
    },
    getParameter(name) { return name === this.ARRAY_BUFFER_BINDING ? this.bound.get(this.ARRAY_BUFFER) ?? null : name === this.ELEMENT_ARRAY_BUFFER_BINDING ? this.bound.get(this.ELEMENT_ARRAY_BUFFER) ?? null : null; },
  };
  const held = new Map(), renderer = {
    domElement: new EventTarget(), target: null, renders: [], held,
    getContext: () => gl, getRenderTarget() { return this.target; }, setRenderTarget(target) { this.target = target; },
    render(mesh) {
      this.renders.push({ mesh, visible: mesh.visible, culled: mesh.frustumCulled, material: mesh.material, target: this.target });
      const geometry = mesh.geometry;
      for (const [name, attribute] of [...Object.entries(geometry.attributes), ['index', geometry.index]]) {
        if (!attribute || held.has(attribute)) continue;
        const buffer = { id: ++ids }, target = name === 'index' ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
        gl.bindBuffer(target, buffer); gl.bufferData(target, attribute.array, gl.STATIC_DRAW); held.set(attribute, buffer);
      }
    },
  };
  return { gl, renderer };
}
/** A mesh whose position array is `megabytes` long, with a small normal array and an index. */
function bigMesh(megabytes, indexBytes = 0) {
  const geometry = new THREE.BufferGeometry(), position = new Float32Array(megabytes * 1048576 / 4).map((_, i) => i % 251);
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3)); geometry.setAttribute('small', new THREE.BufferAttribute(new Float32Array(300).fill(7), 3));
  if (indexBytes) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexBytes / 4).map((_, i) => i * 3), 1));
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}
const bytesOf = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
const setup = () => { const fake = fakeRenderer(), upload = createPacedUploads(fake.renderer, new THREE.PerspectiveCamera()); fake.gl.calls.length = 0; fake.renderer.renders.length = 0; return { ...fake, upload }; };

test('a large array is reserved at the stand-in draw and arrives whole, a slice at a time, without touching three\'s bindings', () => {
  const { gl, renderer, upload } = setup(), mesh = bigMesh(1.25, 600 * 1024), material = mesh.material;
  for (const _ of upload([mesh])); // not paced
  // One draw into the one-pixel target, shown, unculled, with the stand-in material; then everything as it was.
  assert.equal(renderer.renders.length, 1);
  const draw = renderer.renders[0];
  assert.equal(draw.visible, true); assert.equal(draw.culled, false); assert.notEqual(draw.material, material); assert.ok(draw.target, 'offscreen');
  assert.equal(mesh.material, material); assert.equal(mesh.visible, true); assert.equal(mesh.frustumCulled, true); assert.equal(renderer.target, null);
  const { position, small } = mesh.geometry.attributes, index = mesh.geometry.index;
  const data = gl.calls.filter(c => c.call === 'data');
  assert.deepEqual(data.map(c => [c.bytes, c.reserved]), [[position.array.byteLength, true], [small.array.byteLength, false], [index.array.byteLength, true]], 'the small array goes the ordinary way');
  for (const attribute of [position, small, index]) assert.deepEqual(renderer.held.get(attribute).bytes, bytesOf(attribute.array), 'every byte arrived');
  const slices = gl.calls.filter(c => c.call === 'sub');
  assert.ok(slices.every(c => c.target === gl.COPY_WRITE_BUFFER && c.bytes <= SLICE), 'through the copy binding, a slice at a time');
  assert.deepEqual(slices.filter(c => c.id === renderer.held.get(position).id).map(c => c.offset), [0, SLICE, 2 * SLICE], 'in order');
  assert.equal(gl.bound.get(gl.COPY_WRITE_BUFFER), null, 'the copy binding is cleared');
  // A second pass has nothing left to send and does not draw again.
  for (const _ of upload([mesh]));
  assert.equal(renderer.renders.length, 1); assert.equal(gl.calls.filter(c => c.call === 'sub').length, slices.length);
});

test('a paced upload sends one slice a frame and keeps the mesh hidden until its arrays are complete', () => {
  const { gl, upload } = setup(), mesh = bigMesh(2), pace = { deadline: 0 }, steps = upload([mesh], pace);
  let frames = 0, result;
  do {
    pace.deadline = performance.now() + 1e4; result = steps.next();
    if (!result.done) {
      frames++;
      assert.equal(gl.calls.filter(c => c.call === 'sub').length, frames, 'one slice in this frame');
      assert.equal(pace.deadline, -Infinity, 'the rest of the frame is given back (pacing.ts)');
      assert.equal(mesh.visible, false, 'not drawn from half-sent arrays');
    }
  } while (!result.done);
  assert.equal(frames, 3, 'four slices: three frames ended, the last slice finished the upload');
  assert.equal(mesh.visible, true);
});

test('a mesh three already holds is not sent again, and a hidden one stays hidden', () => {
  const { gl, renderer, upload } = setup(), drawn = bigMesh(1), hidden = bigMesh(1);
  renderer.render(drawn); gl.calls.length = 0; renderer.renders.length = 0; hidden.visible = false;
  for (const _ of upload([drawn, hidden]));
  assert.equal(gl.calls.filter(c => c.id === renderer.held.get(drawn.geometry.attributes.position).id).length, 0, 'nothing for the mesh that was drawn before');
  assert.equal(drawn.visible, true); assert.equal(hidden.visible, false);
  assert.deepEqual(renderer.held.get(hidden.geometry.attributes.position).bytes, bytesOf(hidden.geometry.attributes.position.array));
  // Its array is not left marked: an ordinary first draw elsewhere uploads whole as usual.
  const other = new THREE.Mesh(drawn.geometry.clone(), drawn.material); renderer.render(other);
  assert.equal(gl.calls.at(-2).reserved, false);
});

test('a disposed geometry and a lost context stop what was still to be sent', () => {
  for (const stop of ['dispose', 'lost']) {
    const { gl, renderer, upload } = setup(), mesh = bigMesh(2), pace = { deadline: performance.now() + 1e4 }, steps = upload([mesh], pace);
    steps.next();
    assert.equal(gl.calls.filter(c => c.call === 'sub').length, 1);
    if (stop === 'dispose') mesh.geometry.dispose(); else renderer.domElement.dispatchEvent(new Event('webglcontextlost'));
    pace.deadline = performance.now() + 1e4;
    assert.equal(steps.next().done, true, stop);
    assert.equal(gl.calls.filter(c => c.call === 'sub').length, 1, `${stop}: no slice after it`);
  }
});

test('one uploader per renderer, and none where the context cannot copy between buffers', () => {
  const { renderer } = fakeRenderer(), camera = new THREE.PerspectiveCamera();
  assert.equal(createPacedUploads(renderer, camera), createPacedUploads(renderer, camera), 'a restored context builds a new pipeline on the same renderer');
  const old = fakeRenderer(); delete old.gl.COPY_WRITE_BUFFER;
  const upload = createPacedUploads(old.renderer, camera), mesh = bigMesh(1);
  for (const _ of upload([mesh]));
  assert.equal(old.renderer.renders.length, 0, 'the mesh uploads at its first draw, as before');
});
