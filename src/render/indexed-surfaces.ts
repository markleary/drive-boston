import * as THREE from 'three';
import type { TriangleSink } from './geometry-writer.ts';

/** Store a shared road vertex once while preserving every Float32 attribute
 * and triangle. The lookup is cleared between ribbons: normals and UV seams
 * remain independent, and no tile-sized string/vertex lookup stays resident. */
export class IndexedSurfaceWriter implements TriangleSink {
  private position = new Float32Array(256 * 3);
  private normal = new Float32Array(256 * 3);
  private uv = new Float32Array(256 * 2);
  private indices = new Uint32Array(256);
  private vertices = 0;
  private count = 0;
  private lookup = new Map<string, number>();
  private values = new Float32Array(8);
  private words = new Uint32Array(this.values.buffer);
  get empty() { return this.count === 0; }
  clearLookup() { this.lookup.clear(); }
  reserve(additional: number) {
    if (this.count + additional <= this.indices.length) return;
    let size = this.indices.length; while (size < this.count + additional) size *= 2;
    const next = new Uint32Array(size); next.set(this.indices); this.indices = next;
  }
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    this.values[0]=x; this.values[1]=y; this.values[2]=z; this.values[3]=nx; this.values[4]=ny; this.values[5]=nz; this.values[6]=u; this.values[7]=v;
    const key = this.words.join(',');
    let index = this.lookup.get(key);
    if (index === undefined) {
      index = this.vertices++;
      if (this.vertices * 3 > this.position.length) {
        const grow = (array: Float32Array) => { const next = new Float32Array(array.length * 2); next.set(array); return next; };
        this.position = grow(this.position); this.normal = grow(this.normal); this.uv = grow(this.uv);
      }
      const p = index * 3, t = index * 2;
      this.position[p]=this.values[0]; this.position[p+1]=this.values[1]; this.position[p+2]=this.values[2];
      this.normal[p]=this.values[3]; this.normal[p+1]=this.values[4]; this.normal[p+2]=this.values[5];
      this.uv[t]=this.values[6]; this.uv[t+1]=this.values[7];
      this.lookup.set(key, index);
    }
    this.reserve(1); this.indices[this.count++] = index;
  }
  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position.slice(0, this.vertices * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normal.slice(0, this.vertices * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.vertices * 2), 2));
    geometry.setIndex(new THREE.BufferAttribute(this.indices.slice(0, this.count), 1));
    geometry.computeBoundingSphere(); return geometry;
  }
}

/** Mobile road surfaces grouped by material/cell, without expanding their
 * shared vertices back into non-indexed triangles during tile assembly. */
export class SurfaceBatches {
  private buckets = new Map<THREE.Material, Map<string, IndexedSurfaceWriter>>();
  readonly cell: number;
  constructor(cell = 500) { this.cell = cell; }
  at(material: THREE.Material, x: number, z: number) {
    let cells = this.buckets.get(material); if (!cells) this.buckets.set(material, cells = new Map());
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    let writer = cells.get(key); if (!writer) cells.set(key, writer = new IndexedSurfaceWriter());
    return writer;
  }
  meshes() {
    const meshes: THREE.Mesh[] = [];
    for (const [material, cells] of this.buckets) for (const writer of cells.values()) if (!writer.empty) {
      const mesh = new THREE.Mesh(writer.geometry(), material); mesh.name = 'Mobile road surfaces'; meshes.push(mesh);
    }
    this.buckets.clear(); return meshes;
  }
}
