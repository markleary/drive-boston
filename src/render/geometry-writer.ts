import * as THREE from 'three';

/** A box part: the six faces BoxGeometry builds (same corners, normals and
 * UVs), written straight into a TriangleWriter instead of becoming a geometry. */
export interface BoxPart { w: number; h: number; d: number; }
export const box = (w: number, h: number, d: number): BoxPart => ({ w, h, d });
export type Part = THREE.BufferGeometry | BoxPart;

// BoxGeometry's buildPlane calls: u, v, w axes (0 x, 1 y, 2 z), u/v direction, the box
// extent along u and v, and the signed extent along w (its half is the face offset).
const FACES: [number, number, number, number, number, 'w' | 'h' | 'd', 'w' | 'h' | 'd', 'w' | 'h' | 'd', number][] = [
  [2, 1, 0, -1, -1, 'd', 'h', 'w', 1], [2, 1, 0, 1, -1, 'd', 'h', 'w', -1],
  [0, 2, 1, 1, 1, 'w', 'd', 'h', 1], [0, 2, 1, 1, -1, 'w', 'd', 'h', -1],
  [0, 1, 2, 1, -1, 'w', 'h', 'd', 1], [0, 1, 2, -1, -1, 'w', 'h', 'd', -1],
];
const corner = [0, 0, 0], normalMatrix = new THREE.Matrix3();

/** Non-indexed triangles (position, flat normal, uv) accumulated in growing
 * typed arrays, so thousands of small parts (window trim, curb segments, lane
 * dashes) never exist as BufferGeometry objects before they are merged. */
export class TriangleWriter {
  position: Float32Array; normal: Float32Array; uv: Float32Array;
  /** Vertices written so far. */
  count = 0;
  constructor(capacity = 256) { this.position = new Float32Array(capacity * 3); this.normal = new Float32Array(capacity * 3); this.uv = new Float32Array(capacity * 2); }
  get empty() { return this.count === 0; }
  reserve(vertices: number) {
    const needed = this.count + vertices; if (needed * 3 <= this.position.length) return;
    let size = this.position.length / 3; while (size < needed) size *= 2;
    const grow = (array: Float32Array, items: number) => { const next = new Float32Array(size * items); next.set(array); return next; };
    this.position = grow(this.position, 3); this.normal = grow(this.normal, 3); this.uv = grow(this.uv, 2);
  }
  /** Callers reserve before writing vertices. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    const i = this.count++, p = this.position, n = this.normal;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; n[i * 3] = nx; n[i * 3 + 1] = ny; n[i * 3 + 2] = nz; this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
  }
  /** One flat-shaded triangle: the face normal computeVertexNormals gives a non-indexed mesh (zero for a degenerate triangle). */
  triangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, au = 0, av = 0, bu = 0, bv = 0, cu = 0, cv = 0) {
    const abx = ax - bx, aby = ay - by, abz = az - bz, cbx = cx - bx, cby = cy - by, cbz = cz - bz;
    let nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
    const length = Math.hypot(nx, ny, nz); if (length > 0) { nx /= length; ny /= length; nz /= length; }
    this.reserve(3); this.vertex(ax, ay, az, nx, ny, nz, au, av); this.vertex(bx, by, bz, nx, ny, nz, bu, bv); this.vertex(cx, cy, cz, nx, ny, nz, cu, cv);
  }
  /** A box placed by `m` (rotation and translation; normals use its normal matrix). */
  box(part: BoxPart, m?: THREE.Matrix4) {
    const e = m?.elements, n = m ? normalMatrix.getNormalMatrix(m).elements : undefined;
    this.reserve(36);
    const c = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], t = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const [u, v, w, udir, vdir, wu, wv, ww, sign] of FACES) {
      const width = part[wu], height = part[wv], half = part[ww] / 2 * sign;
      corner[0] = 0; corner[1] = 0; corner[2] = 0; corner[w] = sign;
      let nx = corner[0], ny = corner[1], nz = corner[2];
      if (n) { const x = n[0] * nx + n[3] * ny + n[6] * nz, y = n[1] * nx + n[4] * ny + n[7] * nz, z = n[2] * nx + n[5] * ny + n[8] * nz, l = Math.hypot(x, y, z) || 1; nx = x / l; ny = y / l; nz = z / l; }
      // Corners in buildPlane order: (ix, iy) = (0,0) a, (0,1) b, (1,1) c, (1,0) d.
      for (let k = 0; k < 4; k++) {
        const ix = k === 2 || k === 3 ? 1 : 0, iy = k === 1 || k === 2 ? 1 : 0;
        corner[u] = (ix * width - width / 2) * udir; corner[v] = (iy * height - height / 2) * vdir; corner[w] = half;
        let x = corner[0], y = corner[1], z = corner[2];
        if (e) { const px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14]; x = px; y = py; z = pz; }
        c[k * 3] = x; c[k * 3 + 1] = y; c[k * 3 + 2] = z; t[k * 2] = ix; t[k * 2 + 1] = 1 - iy;
      }
      for (const k of [0, 1, 3, 1, 2, 3]) this.vertex(c[k * 3], c[k * 3 + 1], c[k * 3 + 2], nx, ny, nz, t[k * 2], t[k * 2 + 1]);
    }
  }
  /** Any geometry, expanded to triangles and placed by `m`; missing normals or UVs are written as zero. */
  append(geometry: THREE.BufferGeometry, m?: THREE.Matrix4) {
    const p = geometry.getAttribute('position'), nm = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv'), index = geometry.index;
    if (!p) return;
    const count = index ? index.count : p.count, e = m?.elements, n = m ? normalMatrix.getNormalMatrix(m).elements : undefined;
    this.reserve(count);
    for (let i = 0; i < count; i++) {
      const k = index ? index.getX(i) : i;
      let x = p.getX(k), y = p.getY(k), z = p.getZ(k), nx = nm ? nm.getX(k) : 0, ny = nm ? nm.getY(k) : 0, nz = nm ? nm.getZ(k) : 0;
      if (e && n) {
        const px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14]; x = px; y = py; z = pz;
        const qx = n[0] * nx + n[3] * ny + n[6] * nz, qy = n[1] * nx + n[4] * ny + n[7] * nz, qz = n[2] * nx + n[5] * ny + n[8] * nz, l = Math.hypot(qx, qy, qz) || 1; nx = qx / l; ny = qy / l; nz = qz / l;
      }
      this.vertex(x, y, z, nx, ny, nz, uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0);
    }
  }
  part(part: Part, m?: THREE.Matrix4) { if (part instanceof THREE.BufferGeometry) this.append(part, m); else this.box(part, m); }
  /** Recompute flat normals for the triangles written since vertex `from`, after their positions were adjusted. */
  flatNormals(from: number) {
    const p = this.position, n = this.normal;
    for (let i = from; i + 2 < this.count; i += 3) {
      const ax = p[i * 3], ay = p[i * 3 + 1], az = p[i * 3 + 2], bx = p[i * 3 + 3], by = p[i * 3 + 4], bz = p[i * 3 + 5], cx = p[i * 3 + 6], cy = p[i * 3 + 7], cz = p[i * 3 + 8];
      const abx = ax - bx, aby = ay - by, abz = az - bz, cbx = cx - bx, cby = cy - by, cbz = cz - bz;
      let nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
      const length = Math.hypot(nx, ny, nz); if (length > 0) { nx /= length; ny /= length; nz /= length; }
      for (let k = 0; k < 3; k++) { n[(i + k) * 3] = nx; n[(i + k) * 3 + 1] = ny; n[(i + k) * 3 + 2] = nz; }
    }
  }
  /** The accumulated triangles as one geometry with its bounding sphere (empty attributes when nothing was written). */
  geometry() {
    const g = new THREE.BufferGeometry(), n = this.count;
    g.setAttribute('position', new THREE.BufferAttribute(this.position.slice(0, n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.normal.slice(0, n * 3), 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    if (n) g.computeBoundingSphere(); return g;
  }
}

/** Writers keyed by material and spatial cell: the batching mergeSpatialGeometries
 * did (nearby parts together, distant ones frustum-cullable) without the
 * intermediate geometries. Parts are bucketed by their placement point. */
export class PartBatches {
  readonly cell: number;
  private readonly buckets = new Map<THREE.Material, Map<string, TriangleWriter>>();
  constructor(cell = 320) { this.cell = cell; }
  at(material: THREE.Material, x: number, z: number): TriangleWriter {
    let cells = this.buckets.get(material); if (!cells) this.buckets.set(material, cells = new Map());
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; let writer = cells.get(key); if (!writer) cells.set(key, writer = new TriangleWriter());
    return writer;
  }
  /** Place a part by `m`, bucketed at its translation. */
  part(part: Part, material: THREE.Material, m: THREE.Matrix4) { this.at(material, m.elements[12], m.elements[14]).part(part, m); }
  /** One mesh per material and non-empty cell. */
  meshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [material, cells] of this.buckets) for (const writer of cells.values()) if (!writer.empty) meshes.push(new THREE.Mesh(writer.geometry(), material));
    return meshes;
  }
}
