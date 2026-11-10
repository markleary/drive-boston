import * as THREE from 'three';
import { drain, due, until, type Pace } from './pacing.ts';

/** Starts linking the shader programs every pass will draw `mesh` with and
 * says when they are all ready (`warm` in graphics.ts). */
export type Warm=(mesh:THREE.Mesh)=>()=>boolean;

/** Submit static tile details sharing a material in one multi-draw, retaining
 * each source mesh's frustum bounds. No geometry, texture or shadow LOD changes.
 * Survey shells remain separate: the world owns their visibility and samplers.
 * A batch's material needs its own batching program variant, which links on
 * the first draw unless `warm` has started it: a paced build keeps the new
 * batch hidden until those programs are ready, so that draw does not wait.
 * Parts go in already placed (see `cullStaticBatch`).
 */
export function batchStaticDetails(root:THREE.Group){return drain(staticDetailBatchSteps(root));}
export function* staticDetailBatchSteps(root:THREE.Group,pace?:Pace,warm?:Warm):Generator<void,{sources:number;batches:number}>{
  const buckets=new Map<string,THREE.Mesh<THREE.BufferGeometry,THREE.Material>[]>();
  root.updateWorldMatrix(true,true);
  root.traverseVisible(object=>{
    if(!(object instanceof THREE.Mesh)||object instanceof THREE.InstancedMesh||object instanceof THREE.BatchedMesh||
      object.name==='Boston surveyed buildings'||!object.visible||!object.frustumCulled||Array.isArray(object.material)||
      object.material.transparent||object.geometry.groups.length||object.customDepthMaterial||object.customDistanceMaterial||
      Object.keys(object.geometry.morphAttributes).length)return;
    const g:THREE.BufferGeometry=object.geometry;if(!g.attributes.position?.count)return;
    const attributes=Object.entries(g.attributes).sort(([a],[b])=>a.localeCompare(b)).map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).join(',');
    const key=[object.material.uuid,!!g.index,attributes,object.castShadow,object.receiveShadow,object.renderOrder,object.layers.mask,!!object.userData.noAO].join('|');
    const list=buckets.get(key)??[];list.push(object);buckets.set(key,list);
  });
  const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert(),matrix=new THREE.Matrix4(),identity=new THREE.Matrix4();
  let sources=0,batches=0;
  for(const list of buckets.values()){
    if(list.length<3)continue;
    const first=list[0];
    // Count spatial parts before allocating the instance matrix texture.
    const parts:{mesh:THREE.Mesh<THREE.BufferGeometry,THREE.Material>;placed?:THREE.BufferGeometry;geometries:THREE.BufferGeometry[]}[]=[];
    for(const mesh of list){
      if(due(pace))yield;
      // A placed source (a signal head, a shopfront fitting) goes in transformed: every part then
      // shares the identity matrix, and which part a draw belongs to no longer matters to the shader.
      const placed=matrix.multiplyMatrices(inverse,mesh.matrixWorld).equals(identity)?undefined:mesh.geometry.clone().applyMatrix4(matrix);
      parts.push({mesh,placed,geometries:yield* splitStaticGeometrySteps(placed??mesh.geometry,128,pace)});
    }
    // Sized from the parts: an indexed mesh split by cell repeats the vertices on its cell borders.
    let count=0,vertices=0,indices=0;
    for(const part of parts)for(const geometry of part.geometries){count++;vertices+=geometry.attributes.position.count;indices+=geometry.index?.count??0;}
    const batch=new THREE.BatchedMesh(count,vertices,indices,first.material);
    batch.name=`Static details: ${first.parent?.name??first.name}`;batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.renderOrder=first.renderOrder;batch.layers.mask=first.layers.mask;batch.userData.noAO=!!first.userData.noAO;
    // Hidden while it fills (drawn empty, it would link yet another variant,
    // without positions) and until its programs are ready; the sources draw meanwhile.
    batch.visible=false;root.add(batch);
    const bounds=new Float64Array(count*4),ranges=new Int32Array(count*2);let n=0;
    for(const {mesh,placed,geometries} of parts){
      for(const geometry of geometries){
        if(due(pace))yield;
        if(!geometry.boundingSphere)geometry.computeBoundingSphere();
        const sphere=geometry.boundingSphere!,id=batch.addGeometry(geometry),range=batch.getGeometryRangeAt(id)!;batch.addInstance(id);
        bounds[n*4]=sphere.center.x;bounds[n*4+1]=sphere.center.y;bounds[n*4+2]=sphere.center.z;bounds[n*4+3]=sphere.radius;ranges[n*2]=range.start;ranges[n*2+1]=range.count;n++;
        if(geometry!==mesh.geometry)geometry.dispose();
      }
      if(placed&&!geometries.includes(placed))placed.dispose();
    }
    // The batch's culling sphere from its parts' (three would walk every vertex again for the same union).
    const whole=new THREE.Sphere().makeEmpty(),sphere=new THREE.Sphere();
    for(let i=0;i<count;i++){sphere.center.set(bounds[i*4],bounds[i*4+1],bounds[i*4+2]);sphere.radius=bounds[i*4+3];whole.union(sphere);}
    batch.boundingSphere=whole;cullStaticBatch(batch,bounds,ranges);
    if(warm){if(due(pace))yield;yield* until(warm(batch),pace);}
    // Swap in one step, so no part draws twice or goes missing for a frame.
    batch.visible=true;
    for(const mesh of list){mesh.removeFromParent();mesh.geometry.dispose();}
    sources+=list.length;batches++;
  }
  // These roots contain static tile details. Material uniforms (signals, lamps)
  // still animate; recomposing thousands of unchanged local matrices does not.
  freezeTransforms(root);
  return {sources,batches};
}

/** Stop recomposing the local matrices of a subtree that never moves again. */
export function freezeTransforms(root:THREE.Object3D){root.traverse(object=>{object.updateMatrix();object.matrixAutoUpdate=false;});}

const projection=new THREE.Matrix4(),frustum=new THREE.Frustum(),planes=new Float64Array(24);
/** Cull a finished static batch's parts from bounds taken once, in place of
 * three's per-pass work. BatchedMesh reads every part's matrix back, transforms
 * its bounds, sorts the survivors by depth and uploads a draw-to-part texture,
 * for each camera each frame (the view, the shadow map, the ambient-occlusion
 * normals): a fifth of a desktop frame over a neighbourhood's fifteen thousand
 * parts. These parts never move and share the identity matrix, so the test is
 * six plane distances per part against a fixed sphere (none while the camera
 * sees the whole batch), the draw order stays the build order and the texture
 * is written once. `bounds` holds x, y, z, radius per part in the batch's own
 * frame; `ranges` its draw start and count. */
export function cullStaticBatch(batch:THREE.BatchedMesh,bounds:Float64Array,ranges:Int32Array){
  const internal=batch as unknown as {_multiDrawStarts:Int32Array;_multiDrawCounts:Int32Array;_multiDrawCount:number;_indirectTexture:THREE.DataTexture};
  const count=bounds.length/4,starts=internal._multiDrawStarts,counts=internal._multiDrawCounts,indirect=internal._indirectTexture;
  // An upgrade of three that reshapes these internals keeps its own culling.
  if(!(starts instanceof Int32Array)||!(counts instanceof Int32Array)||starts.length<count||!indirect?.image?.data)return;
  // The indexed multi-draw takes byte offsets.
  const bytes=batch.geometry.index?batch.geometry.index.array.BYTES_PER_ELEMENT:1,all=new Int32Array(count),sizes=new Int32Array(count);
  for(let i=0;i<count;i++){all[i]=ranges[i*2]*bytes;sizes[i]=ranges[i*2+1];(indirect.image.data as Uint32Array)[i]=i;}
  indirect.needsUpdate=true;
  batch.perObjectFrustumCulled=false;batch.sortObjects=false;
  let whole=false;
  batch.onBeforeRender=(_renderer,_scene,camera)=>{
    projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(batch.matrixWorld);
    frustum.setFromProjectionMatrix(projection,camera.coordinateSystem,(camera as THREE.Camera&{reversedDepth?:boolean}).reversedDepth);
    const sphere=batch.boundingSphere;let inside=!!sphere;
    for(let k=0;k<6;k++){
      const plane=frustum.planes[k],normal=plane.normal;planes[k*4]=normal.x;planes[k*4+1]=normal.y;planes[k*4+2]=normal.z;planes[k*4+3]=plane.constant;
      if(inside&&normal.x*sphere!.center.x+normal.y*sphere!.center.y+normal.z*sphere!.center.z+plane.constant<sphere!.radius)inside=false;
    }
    if(inside){
      if(!whole){starts.set(all);counts.set(sizes);whole=true;}
      internal._multiDrawCount=count;return;
    }
    whole=false;let drawn=0;
    for(let i=0,o=0;i<count;i++,o+=4){
      const x=bounds[o],y=bounds[o+1],z=bounds[o+2],reach=-bounds[o+3];
      if(planes[0]*x+planes[1]*y+planes[2]*z+planes[3]<reach||planes[4]*x+planes[5]*y+planes[6]*z+planes[7]<reach||planes[8]*x+planes[9]*y+planes[10]*z+planes[11]<reach||
        planes[12]*x+planes[13]*y+planes[14]*z+planes[15]<reach||planes[16]*x+planes[17]*y+planes[18]*z+planes[19]<reach||planes[20]*x+planes[21]*y+planes[22]*z+planes[23]<reach)continue;
      starts[drawn]=all[i];counts[drawn++]=sizes[i];
    }
    internal._multiDrawCount=drawn;
  };
}

/** Keep every triangle intact, but give long, merged road/trim meshes local
 * bounds. A single distant vertex must not keep an entire district in view. */
export function splitStaticGeometry(geometry:THREE.BufferGeometry,cellSize=128):THREE.BufferGeometry[]{return drain(splitStaticGeometrySteps(geometry,cellSize));}
/** splitStaticGeometry as a generator that pauses once `pace`'s deadline has passed (a tile's road ribbons hold a million vertices). */
export function* splitStaticGeometrySteps(geometry:THREE.BufferGeometry,cellSize=128,pace?:Pace):Generator<void,THREE.BufferGeometry[]>{
  const p=geometry.attributes.position,index=geometry.index,corners=index?index.count:p?.count??0;
  if(!p||corners<300||Object.values(geometry.attributes).some(a=>a instanceof THREE.InterleavedBufferAttribute))return [geometry];
  geometry.computeBoundingBox();const box=geometry.boundingBox!,size=box.getSize(new THREE.Vector3());
  if(Math.max(size.x,size.z)<=cellSize)return [geometry];
  // Triangles by cell, counted first so each cell's corner list is filled in place (no key or list per triangle).
  // A triangle with a vertex that is not a finite number (a degenerate detail part) gets a cell of its own.
  const ids=index?.array,positions=p.array,triangles=corners/3;
  let minX=box.min.x,maxX=box.max.x,minZ=box.min.z,maxZ=box.max.z;
  if(![minX,maxX,minZ,maxZ].every(Number.isFinite)){
    minX=minZ=Infinity;maxX=maxZ=-Infinity;
    for(let i=0;i<p.count;i++){const x=positions[i*3],z=positions[i*3+2];if(!Number.isFinite(x)||!Number.isFinite(z))continue;if(x<minX)minX=x;if(x>maxX)maxX=x;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;}
    if(!(minX<=maxX))return [geometry];
  }
  const cx0=Math.floor(minX/cellSize),cz0=Math.floor(minZ/cellSize),columns=Math.floor(maxX/cellSize)-cx0+1,rows=Math.floor(maxZ/cellSize)-cz0+1,stray=columns*rows;
  const cellOf=new Int32Array(triangles),counts=new Int32Array(stray+1);
  for(let t=0;t<triangles;t++){
    if(t%8192===0&&t&&due(pace))yield;
    const i=t*3,a=(ids?ids[i]:i)*3,b=(ids?ids[i+1]:i+1)*3,c=(ids?ids[i+2]:i+2)*3,x=(positions[a]+positions[b]+positions[c])/3,z=(positions[a+2]+positions[b+2]+positions[c+2])/3;
    const cell=Number.isFinite(x)&&Number.isFinite(z)?Math.min(columns-1,Math.max(0,Math.floor(x/cellSize)-cx0))+Math.min(rows-1,Math.max(0,Math.floor(z/cellSize)-cz0))*columns:stray;cellOf[t]=cell;counts[cell]++;
  }
  let used=0;for(let cell=0;cell<counts.length;cell++)if(counts[cell])used++;
  if(used<2)return [geometry];
  // Cells in the order their first triangle appears, as the keyed map listed them.
  const order:number[]=[],slot=new Int32Array(counts.length).fill(-1),lists:Uint32Array[]=[],filled:number[]=[];
  for(let t=0;t<triangles;t++){
    if(t%16384===0&&t&&due(pace))yield;
    const cell=cellOf[t];let n=slot[cell];if(n<0){n=slot[cell]=order.length;order.push(cell);lists.push(new Uint32Array(counts[cell]*3));filled.push(0);}
    const i=t*3,list=lists[n],o=filled[n];list[o]=ids?ids[i]:i;list[o+1]=ids?ids[i+1]:i+1;list[o+2]=ids?ids[i+2]:i+2;filled[n]=o+3;
  }
  const parts:THREE.BufferGeometry[]=[],sources=Object.entries(geometry.attributes) as [string,THREE.BufferAttribute][];
  // An indexed mesh (draped pavement) keeps its shared vertices: each part takes the ones its triangles use.
  const remap=index?new Int32Array(p.count).fill(-1):undefined;
  for(const corner of lists){
    if(due(pace))yield;
    const part=new THREE.BufferGeometry();let vertices:ArrayLike<number>=corner,count=corner.length;
    if(remap){
      const local=new Uint32Array(corner.length),picked=new Uint32Array(corner.length);count=0;
      for(let i=0;i<corner.length;i++){const v=corner[i];let n=remap[v];if(n<0){n=remap[v]=count;picked[count++]=v;}local[i]=n;}
      for(let i=0;i<count;i++)remap[picked[i]]=-1;
      vertices=picked;part.setIndex(new THREE.BufferAttribute(count>65535?local:Uint16Array.from(local),1));
    }
    for(const [name,a] of sources){
      const size=a.itemSize,from=a.array,array=new (from.constructor as typeof Float32Array)(count*size);
      for(let i=0;i<count;i++){const v=vertices[i]*size,o=i*size;for(let j=0;j<size;j++)array[o+j]=from[v+j];}
      const attribute=new THREE.BufferAttribute(array,size,a.normalized);attribute.gpuType=a.gpuType;part.setAttribute(name,attribute);
    }
    part.computeBoundingBox();part.computeBoundingSphere();parts.push(part);
  }
  return parts;
}
