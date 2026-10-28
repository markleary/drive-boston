import * as THREE from 'three';

const customTextures=new WeakMap<THREE.Material,THREE.Texture>();
/** Textures captured by onBeforeCompile closures are absent from material.map. */
export function registerContextTexture(material:THREE.Material,texture:THREE.Texture){customTextures.set(material,texture);}

/** Notify the old renderer while the context is still lost. Keep CPU geometry,
 * textures and instance data so the restored renderer can upload the same scene.
 * Otherwise old disposal listeners survive and later delete stale GL handles. */
export function releaseSceneContext(scene: THREE.Scene) {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  scene.traverse(object=>{
    if(object instanceof THREE.Mesh){
      geometries.add(object.geometry);
      for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
      // Dispatch only: BatchedMesh.dispose() destroys its CPU instance textures.
      object.dispatchEvent({type:'dispose'});
    }
    // Includes scene environment/background and BatchedMesh's data textures,
    // without depending on the names of Three's internal texture fields.
    for(const value of Object.values(object))if(value instanceof THREE.Texture)textures.add(value);
  });
  for(const material of materials){
    for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);
    if(material instanceof THREE.ShaderMaterial)for(const uniform of Object.values(material.uniforms))if(uniform.value instanceof THREE.Texture)textures.add(uniform.value);
    const custom=customTextures.get(material);if(custom)textures.add(custom);
    material.dispose();
  }
  for(const geometry of geometries)geometry.dispose();
  for(const texture of textures)texture.dispose();
}
