import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {PRUDENTIAL_CROWN as C,PRUDENTIAL_FACES,PRUDENTIAL_ID,PRUDENTIAL_TOWER as T,PRUDENTIAL_WORD,isPrudential,prudentialCrownCollider,prudentialLettering,prudentialWordLayout,splitPrudentialShell} from '../src/render/prudential.ts';

const city=JSON.parse(readFileSync(new URL('../public/data/city.json',import.meta.url),'utf8'));
const building=city.buildings.find(isPrudential);

/** The Prudential primitives from the bundled GLB, as non-indexed geometry. */
function sourcePrimitives(){
  const bytes=readFileSync(new URL('../public/data/city.glb',import.meta.url));
  const jsonSize=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonSize).toString()),binary=20+jsonSize+8;
  const node=gltf.nodes.find(n=>n.extras?.buildingId===PRUDENTIAL_ID);
  assert.ok(node,'the crown must target the existing Prudential complex');
  const attribute=index=>{
    const a=gltf.accessors[index],view=gltf.bufferViews[a.bufferView],start=binary+(view.byteOffset??0)+(a.byteOffset??0),size={SCALAR:1,VEC2:2,VEC3:3}[a.type];
    const values=new Float32Array(a.count*size);
    for(let i=0;i<values.length;i++)values[i]=a.componentType===5126?bytes.readFloatLE(start+i*4):a.componentType===5123?bytes.readUInt16LE(start+i*2):bytes.readUInt32LE(start+i*4);
    return new THREE.BufferAttribute(values,size);
  };
  return gltf.meshes[node.mesh].primitives.map(primitive=>{
    const geometry=new THREE.BufferGeometry();
    for(const [key,name]of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv']])if(primitive.attributes[key]!==undefined)geometry.setAttribute(name,attribute(primitive.attributes[key]));
    geometry.setIndex(Array.from(attribute(primitive.indices).array));
    const source=geometry.toNonIndexed();geometry.dispose();
    return {roof:gltf.materials[primitive.material].name==='roof',geometry:source};
  });
}
const toLocal=(x,z)=>{const dx=x-T.x,dz=z-T.z,c=Math.cos(T.yaw),s=Math.sin(T.yaw);return {u:dx*c-dz*s,v:dx*s+dz*c};};

test('crown frame sits on the surveyed shaft and clears the hidden source setback',()=>{
  assert.ok(building,'the Prudential complex is in the city package');
  assert.equal(city.buildings.filter(isPrudential).length,1);
  const primitives=sourcePrimitives();
  let shaftCorner=0,setback=0;
  for(const {geometry}of primitives){
    const p=geometry.getAttribute('position');
    for(let i=0;i<p.count;i++){
      const y=p.getY(i),{u,v}=toLocal(p.getX(i),p.getZ(i));
      if(Math.abs(u)>T.halfX+5||Math.abs(v)>T.halfZ+5||y<150)continue;
      // No source wall of the upper tower stands outside the measured shaft.
      assert.ok(Math.abs(u)<=T.halfX+.05&&Math.abs(v)<=T.halfZ+.05,`tower vertex (${u.toFixed(2)}, ${v.toFixed(2)}) lies outside the frame`);
      if(Math.abs(y-C.parapet)<.05&&Math.abs(Math.abs(u)-T.halfX)<.05&&Math.abs(Math.abs(v)-T.halfZ)<.05)shaftCorner++;
    }
    // Source walls spanning the crown band must stay well behind the new walls.
    for(let i=0;i<p.count;i+=3){
      const ys=[0,1,2].map(j=>p.getY(i+j)),low=Math.min(...ys),high=Math.max(...ys);
      if(high<C.parapet+.1||low>C.top-.35)continue;
      const inset=low<C.recessTop?C.recessInset:C.glassInset;
      for(let j=0;j<3;j++){
        const {u,v}=toLocal(p.getX(i+j),p.getZ(i+j));
        assert.ok(Math.abs(u)<T.halfX-inset-.12&&Math.abs(v)<T.halfZ-inset-.12,`source crown wall at (${u.toFixed(2)}, ${v.toFixed(2)}) would show through the new walls`);
      }
      setback++;
    }
  }
  assert.ok(shaftCorner>=4,'all four shaft corners meet the frame at the parapet');
  assert.ok(setback>8,'the source setback volume is present');
  primitives.forEach(p=>p.geometry.dispose());
});

test('PRUDENTIAL lettering fits the glass band on every face',()=>{
  const layout=prudentialWordLayout();
  assert.equal(layout.letters.map(l=>l.char).join(''),PRUDENTIAL_WORD);
  const {faces,returns,width}=prudentialLettering();
  for(const geometry of [faces,returns]){
    geometry.computeBoundingBox();const box=geometry.boundingBox;
    assert.ok(box.min.y>=C.slabTop&&box.max.y<=C.glassTop-.2,'letters hang inside the glass band below the roof slab');
    assert.ok(Math.abs(box.max.x+box.min.x)<.01,'the word is centred on its face');
    assert.ok(box.min.z>-1e-6&&box.max.z<=C.letterDepth+1e-6);
  }
  assert.ok(faces.getAttribute('position').count>0&&returns.getAttribute('position').count>0);
  const shortest=Math.min(...PRUDENTIAL_FACES.map(f=>2*(f.half-C.glassInset)));
  assert.ok(width>25&&width<shortest*.75,`a ${width.toFixed(1)}m word leaves clear glass at each end`);
  // The letters stand off the glass but stay behind the roof slab edge.
  assert.ok(C.letterStandoff+C.letterDepth<C.glassInset+C.overhang);
  faces.dispose();returns.dispose();
});

test('crown collider is a closed, outward box around both cantilevered slabs',()=>{
  const collider=prudentialCrownCollider(city);
  assert.ok(collider);
  assert.equal(collider.vertices.length,24);assert.equal(collider.indices.length,36);
  const v=i=>new THREE.Vector3(collider.vertices[i*3],collider.vertices[i*3+1],collider.vertices[i*3+2]);
  const centre=new THREE.Vector3();for(let i=0;i<8;i++)centre.add(v(i));centre.divideScalar(8);
  for(let t=0;t<12;t++){
    const [a,b,c]=[0,1,2].map(k=>v(collider.indices[t*3+k])),normal=b.clone().sub(a).cross(c.clone().sub(a));
    assert.ok(normal.dot(a.clone().add(b).add(c).divideScalar(3).sub(centre))>0,`triangle ${t} faces outward`);
  }
  const lift=(building.baseElevation??0)+building.height-236.914;
  for(let i=0;i<8;i++){
    const p=v(i),{u,v:w}=toLocal(p.x,p.z);
    assert.ok(Math.abs(Math.abs(u)-(T.halfX+C.overhang))<.01&&Math.abs(Math.abs(w)-(T.halfZ+C.overhang))<.01);
    assert.ok(p.y<=C.roof+lift+1e-3||p.y>=C.top+lift);
  }
});

test('penthouse cladding keeps every source triangle and only takes rooftop structures',()=>{
  const record=geometry=>{
    const names=['position','normal','uv'].filter(n=>geometry.hasAttribute(n)),p=geometry.getAttribute('position'),rows=[];
    for(let i=0;i<p.count;i+=3){const row=[];for(const n of names){const a=geometry.getAttribute(n);for(let j=0;j<3;j++)for(let k=0;k<a.itemSize;k++)row.push(a.getComponent(i+j,k));}rows.push(JSON.stringify(row));}
    return rows;
  };
  const facade=sourcePrimitives().find(p=>!p.roof).geometry,parts=splitPrudentialShell(facade,building);
  assert.deepEqual(parts.flatMap(p=>record(p.geometry)).sort(),record(facade).sort(),'the partition must not alter or drop source geometry');
  const penthouse=parts.find(p=>p.kind==='penthouse');
  assert.ok(penthouse,'the source rooftop structures receive cladding');
  const p=penthouse.geometry.getAttribute('position');
  for(let i=0;i<p.count;i+=3)assert.ok(Math.max(p.getY(i),p.getY(i+1),p.getY(i+2))>C.top-.3,'only structures rising above the crown roof are clad');
  assert.ok(p.count/3<parts.find(x=>x.kind==='facade').geometry.getAttribute('position').count/3,'the office shaft keeps its facade');
  facade.dispose();parts.forEach(x=>x.geometry.dispose());
});
