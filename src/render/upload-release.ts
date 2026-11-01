import * as THREE from 'three';

/** Frees the CPU copies of static tile geometry once WebGL holds them.
 * three.js keeps every vertex and index array after upload; on a phone the
 * streamed tiles alone hold about 175 MB of them. A tile still building is only
 * watched (later stages sample its shells); release() drops what was uploaded
 * and arms the rest. A released attribute cannot be uploaded again, so after a
 * context restore its tile must be rebuilt. Tile geometry is private to its
 * tile (see tile-resources.ts), so no other mesh can need the dropped arrays. */
export function createUploadRelease(){
  const watched=new WeakSet<THREE.BufferAttribute>(),uploaded=new WeakSet<THREE.BufferAttribute>(),releasing=new WeakSet<THREE.BufferAttribute>();
  const totals={bytes:0,attributes:0};
  const drop=(attribute:THREE.BufferAttribute)=>{if(!attribute.array)return;totals.bytes+=attribute.array.byteLength;totals.attributes++;(attribute as {array:unknown}).array=null;};
  const visit=(root:THREE.Object3D,each:(attribute:THREE.BufferAttribute)=>void)=>root.traverse(object=>{
    // Instanced, batched and skinned meshes rewrite their buffers at run time.
    if(!(object instanceof THREE.Mesh)||object instanceof THREE.InstancedMesh||object instanceof THREE.BatchedMesh||object instanceof THREE.SkinnedMesh)return;
    const geometry=object.geometry as THREE.BufferGeometry;if(Object.keys(geometry.morphAttributes).length)return;
    // Culling needs the bounds after the positions are gone.
    if(geometry.attributes.position&&!geometry.boundingSphere)geometry.computeBoundingSphere();
    for(const attribute of [...Object.values(geometry.attributes),geometry.index])if(attribute instanceof THREE.BufferAttribute&&attribute.usage===THREE.StaticDrawUsage&&attribute.array)each(attribute);
  });
  const watch=(attribute:THREE.BufferAttribute)=>{
    if(watched.has(attribute))return;watched.add(attribute);
    attribute.onUpload(()=>{uploaded.add(attribute);if(releasing.has(attribute))drop(attribute);});
  };
  return{
    /** Record uploads without freeing anything; call before each frame a partial tile may draw. */
    watch(root:THREE.Object3D){visit(root,watch);},
    /** Drop uploaded arrays now and the rest on their first upload. */
    release(root:THREE.Object3D){visit(root,attribute=>{watch(attribute);releasing.add(attribute);if(uploaded.has(attribute))drop(attribute);});},
    get releasedBytes(){return totals.bytes;},
    get releasedAttributes(){return totals.attributes;},
  };
}
