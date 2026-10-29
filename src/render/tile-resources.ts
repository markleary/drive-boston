import * as THREE from 'three';

/** Tile geometry and instances are private; most city materials are shared.
 * Only explicitly owned materials (street-name plates) leave with the tile. */
export function disposeTileResources(group: THREE.Group, owned: THREE.Material[] = []) {
  const geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.BatchedMesh) { object.dispose(); return; }
    // Instance matrices/colors have their own WebGL buffers. Disposing only
    // the shared base geometry leaves those buffers and binding states alive.
    if (object instanceof THREE.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of new Set(owned)) {
    const m = material as THREE.MeshStandardMaterial;
    if (m.map) textures.add(m.map);
    if (m.emissiveMap) textures.add(m.emissiveMap);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  owned.length = 0;
  group.removeFromParent();
  group.clear();
}
