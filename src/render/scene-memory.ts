import * as THREE from 'three';

/** Retained vertex/index/instance backing arrays, counted once when shared.
 * This is a CPU-array subtotal, not GPU allocation or total browser memory. */
export function sceneAttributeBytes(scene:THREE.Object3D){
  const buffers=new Set<ArrayBufferLike>();
  // Streamed tile arrays released after upload (upload-release.ts) are null.
  const add=(attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute|null)=>{if(attribute?.array)buffers.add(attribute.array.buffer);};
  scene.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const geometry:THREE.BufferGeometry=object.geometry;
    for(const attribute of Object.values(geometry.attributes))add(attribute);
    add(geometry.index);
    if(object instanceof THREE.InstancedMesh){add(object.instanceMatrix);add(object.instanceColor);}
  });
  let bytes=0;for(const buffer of buffers)bytes+=buffer.byteLength;return bytes;
}
