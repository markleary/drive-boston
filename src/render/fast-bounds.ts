import * as THREE from 'three';

/** `geometry.computeBoundingBox()` and `computeBoundingSphere()` for a plain Float32 position attribute, in two tight
 * passes over its array: three reads every vertex through an accessor and walks the attribute three times, and a
 * tile's static parts hold millions of vertices. The same box, centre and radius; anything else (no positions,
 * another array type, morph targets, a coordinate that is not a finite number) takes three's own path, with its
 * console message. `box: false` leaves the bounding box as it was (three's computeBoundingSphere does). */
export function computeBounds(geometry: THREE.BufferGeometry, box = true) {
  const attribute = geometry.attributes.position as THREE.BufferAttribute | undefined, a = attribute?.array;
  if (attribute && a instanceof Float32Array && attribute.itemSize === 3 && !(attribute as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute && a.length >= 3 && !geometry.morphAttributes.position) {
    const n = a.length - a.length % 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i += 3) {
      const x = a[i], y = a[i + 1], z = a[i + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (Number.isFinite(minX + maxX + minY + maxY + minZ + maxZ)) {
      if (box) { const b = geometry.boundingBox ??= new THREE.Box3(); b.min.set(minX, minY, minZ); b.max.set(maxX, maxY, maxZ); }
      const cx = (minX + maxX) * .5, cy = (minY + maxY) * .5, cz = (minZ + maxZ) * .5; let radius = 0;
      for (let i = 0; i < n; i += 3) { const dx = cx - a[i], dy = cy - a[i + 1], dz = cz - a[i + 2]; radius = Math.max(radius, dx * dx + dy * dy + dz * dz); }
      const sphere = geometry.boundingSphere ??= new THREE.Sphere(); sphere.center.set(cx, cy, cz); sphere.radius = Math.sqrt(radius);
      return;
    }
  }
  if (box) geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
