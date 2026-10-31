import {inLongfellowCorridor} from '../simulation/longfellow.ts';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, hash, seeded } from './materials.ts';

const windTime={value:0};
const SPECIES=[
  {name:'maple',height:7.8,spread:3.1,tall:2.5,hue:.23,color:'#aabf85'},
  {name:'elm',height:9.4,spread:3.4,tall:3.7,hue:.25,color:'#9fb484'},
  {name:'honey locust',height:7.2,spread:3.5,tall:2.0,hue:.20,color:'#b7c78c'},
  {name:'white pine',height:10.8,spread:2.7,tall:4.4,hue:.29,color:'#9ab396'},
];
let resources:{bark:THREE.MeshStandardMaterial;leaves:THREE.MeshStandardMaterial[];depth:THREE.MeshDepthMaterial[];geometries:{wood:THREE.BufferGeometry;leaves:THREE.BufferGeometry}[][]}|undefined;
function wind(material:THREE.Material,flutter=false){
  material.onBeforeCompile=shader=>{shader.uniforms.treeTime=windTime;shader.vertexShader='uniform float treeTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    float windPhase=instanceMatrix[3].x*.041+instanceMatrix[3].z*.037;
    float windWeight=pow(clamp(position.y/11.,0.,1.),2.);
    transformed.x+=sin(treeTime*.85+windPhase)*windWeight*.12;
    transformed.z+=cos(treeTime*.61+windPhase)*windWeight*.065;
    ${flutter?'transformed.y+=sin(treeTime*2.4+position.x*1.7+position.z)*windWeight*.035;':''}`);};
  material.customProgramCacheKey=()=>`boston-trees-2-${flutter}`;
}
function leafTexture(species:number){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d')!,random=seeded(1207+species*391);
  // Small individual leaves form a dense, irregular branch silhouette rather
  // than an opaque geometric crown. Species share no copied bitmap artwork.
  for(let i=0;i<(species===2?260:170);i++){
    const angle=random()*Math.PI*2,r=Math.sqrt(random())*108,x=128+Math.cos(angle)*r,y=128+Math.sin(angle)*r;
    const size=species===2?4+random()*5:8+random()*10;
    c.save();c.translate(x,y);c.rotate(random()*Math.PI*2);
    c.fillStyle=`hsl(${70+species*9+random()*22},${29+random()*24}%,${30+random()*23}%)`;
    c.beginPath();
    if(species===0){for(let j=0;j<10;j++){const a=j*Math.PI/5,radius=size*(j%2?.48:1);c.lineTo(Math.cos(a)*radius,Math.sin(a)*radius);}}
    else if(species===3){c.moveTo(0,-size*1.3);c.lineTo(size*.25,size);c.lineTo(-size*.25,size);}
    else c.ellipse(0,0,size*(species===2?.5:.57),size,0,0,Math.PI*2);
    c.fill();c.strokeStyle='#d4d99855';c.lineWidth=.65;c.beginPath();c.moveTo(0,-size*.7);c.lineTo(0,size*.7);c.stroke();c.restore();
  }
  return canvasTexture(canvas);
}
function geometryFor(species:number,lod:number){
  const s=SPECIES[species],random=seeded(5103+species*713),wood:THREE.BufferGeometry[]=[],leaves:THREE.BufferGeometry[]=[];
  const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0);
  function branch(a:THREE.Vector3,b:THREE.Vector3,r:number){const d=b.clone().sub(a);q.setFromUnitVectors(up,d.clone().normalize());matrix.compose(a.clone().add(b).multiplyScalar(.5),q,new THREE.Vector3(1,1,1));wood.push(new THREE.CylinderGeometry(r*.5,r,d.length(),lod===0?7:5).applyMatrix4(matrix));}
  branch(new THREE.Vector3(),new THREE.Vector3(.12,s.height,0),species===1?.24:.19);
  if(lod<2)for(let j=0;j<(lod===0?8:5);j++){
    const angle=j*2.39996,startY=s.height*(species===1?.35:.5),endY=s.height+Math.sin(j)*.5;
    const a=new THREE.Vector3(.08,startY+j*.23,0),b=new THREE.Vector3(Math.cos(angle)*s.spread*.6,endY,Math.sin(angle)*s.spread*.6);
    branch(a,b,.075);if(lod===0){const end=b.clone().add(new THREE.Vector3(Math.cos(angle+.4)*s.spread*.35,-.3,Math.sin(angle+.4)*s.spread*.35));branch(b,end,.032);}
  }
  const count=[48,24,12][lod];
  for(let j=0;j<count;j++){
    const a=j*2.399963,unit=(j+.5)/count,vertical=1-2*unit,radius=Math.sqrt(Math.max(0,1-vertical*vertical));
    const tier=species===3?unit:1,spread=species===3?s.spread*(.25+.75*tier):s.spread;
    const x=Math.cos(a)*radius*spread,z=Math.sin(a)*radius*spread,y=s.height+vertical*s.tall-(species===3?1.2:0);
    const card=new THREE.PlaneGeometry([2.6,3.8,5.1][lod]*(species===2?.85:1),[2.4,3.5,4.8][lod]);
    const euler=new THREE.Euler((random()-.5)*1.9,a,(random()-.5)*1.2);q.setFromEuler(euler);matrix.compose(new THREE.Vector3(x,y,z),q,new THREE.Vector3(1,1,1));card.applyMatrix4(matrix);leaves.push(card);
  }
  const result={wood:mergeGeometries(wood,false)!,leaves:mergeGeometries(leaves,false)!};for(const g of [...wood,...leaves])g.dispose();return result;
}
function assets(){
  if(resources)return resources;
  const bark=new THREE.MeshStandardMaterial({color:'#665949',roughness:.98});wind(bark);
  const leaves=SPECIES.map((s,i)=>{const m=new THREE.MeshStandardMaterial({map:leafTexture(i),color:s.color,roughness:.92,alphaTest:.42,side:THREE.DoubleSide,alphaToCoverage:true});m.forceSinglePass=true;wind(m,true);return m;});
  const depth=leaves.map(m=>{const d=new THREE.MeshDepthMaterial({map:m.map,alphaTest:.42,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking});wind(d,true);return d;});
  resources={bark,leaves,depth,geometries:SPECIES.map((_,i)=>[0,1,2].map(lod=>geometryFor(i,lod)))};return resources;
}

/** Instance scale range applied to every site (see TreeField.add). */
export const TREE_SCALE_RANGE=[.82,1.12] as const;
/** Widest horizontal reach from the trunk and highest point of the drawn tree
 * geometry at scale 1, over the given species and distance levels: what
 * src/simulation/deck-canopy.ts must keep clear of raised decks. */
export function crownExtent(species:number[],lods:number[]){
  let reach=0,top=0;
  for(const i of species)for(const lod of lods){const g=geometryFor(i,lod);for(const part of [g.wood,g.leaves]){const p=part.getAttribute('position');for(let k=0;k<p.count;k++){reach=Math.max(reach,Math.hypot(p.getX(k),p.getZ(k)));top=Math.max(top,p.getY(k));}part.dispose();}}
  return{reach,top};
}
export interface TreeField { group:THREE.Group; add(owner:string,positions:THREE.Vector3[]):void; remove(owner:string):void; readonly count:number; }
type Site={p:THREE.Vector3;species:number;scale:number;yaw:number;owner:string};
let grateMaterial:THREE.Material|undefined,grateGeometry:THREE.BufferGeometry|undefined;

/** Species silhouettes and three distance levels share geometry/materials.
 * A bounded active field keeps city-wide foliage out of distant shadow passes;
 * high-quality flight also shadows the distant, low-detail silhouettes.
 * Owners (streamed tiles) add and remove their sites; the instanced batches
 * grow to fit and shrink only on disposal. */
export function createTreeField(options:{scale?:number;grates?:boolean}={}):TreeField{
  const group=new THREE.Group();group.name='Boston varied trees';const shared=assets(),scale=options.scale??1;
  let sites:Site[]=[];
  const make=(species:number,lod:number,capacity:number)=>{
    const wood=new THREE.InstancedMesh(shared.geometries[species][lod].wood,shared.bark,capacity),leaf=new THREE.InstancedMesh(shared.geometries[species][lod].leaves,shared.leaves[species],capacity);
    wood.name=`${SPECIES[species].name} branches LOD${lod}`;leaf.name=`${SPECIES[species].name} foliage LOD${lod}`;
    leaf.customDepthMaterial=shared.depth[species];leaf.userData.noAO=true;
    for(const mesh of [wood,leaf]){mesh.castShadow=lod<2;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=0;group.add(mesh);}
    return{wood,leaf,count:0,capacity};
  };
  const batches=SPECIES.map((_,species)=>[0,1,2].map(lod=>make(species,lod,8)));
  const ensure=(species:number,lod:number,needed:number)=>{
    const b=batches[species][lod];if(needed<=b.capacity)return b;
    group.remove(b.wood,b.leaf);b.wood.dispose();b.leaf.dispose();
    return batches[species][lod]=make(species,lod,Math.max(needed,Math.ceil(b.capacity*1.6)));
  };
  const dummy=new THREE.Object3D();let last=-Infinity,lastX=Infinity,lastZ=Infinity,lastHigh=true,lastFlightShadows=false,dirty=true;
  const pending:Site[][][]=SPECIES.map(()=>[[],[],[]]);
  group.userData.updateFoliage=(observer:THREE.Vector3,time:number,high=true,flightShadows=false)=>{
    if(!dirty&&high===lastHigh&&flightShadows===lastFlightShadows&&time-last<.25&&Math.hypot(observer.x-lastX,observer.z-lastZ)<25)return;
    last=time;lastX=observer.x;lastZ=observer.z;lastHigh=high;lastFlightShadows=flightShadows;dirty=false;
    for(const row of pending)for(const list of row)list.length=0;
    for(const site of sites){
      const d=Math.hypot(site.p.x-observer.x,site.p.z-observer.z),near=high?100:60,mid=high?320:210;if(d>900)continue;
      pending[site.species][d<near?0:d<mid?1:2].push(site);
    }
    pending.forEach((row,species)=>row.forEach((list,lod)=>{
      const b=ensure(species,lod,list.length);
      list.forEach((site,i)=>{dummy.position.copy(site.p);dummy.rotation.set(0,site.yaw,0);dummy.scale.setScalar(site.scale);dummy.updateMatrix();b.wood.setMatrixAt(i,dummy.matrix);b.leaf.setMatrixAt(i,dummy.matrix);});
      b.count=list.length;for(const mesh of [b.wood,b.leaf]){mesh.count=b.count;mesh.visible=b.count>0;mesh.castShadow=lod<2||(high&&flightShadows);mesh.instanceMatrix.needsUpdate=true;}
    }));
  };
  let grates:THREE.InstancedMesh|undefined;
  const refreshGrates=()=>{
    if(options.grates===false)return;
    if(!grates||grates.instanceMatrix.count<sites.length){
      if(grates){group.remove(grates);grates.dispose();}
      grateGeometry??=new THREE.BoxGeometry(1.7,.035,1.7);grateMaterial??=new THREE.MeshStandardMaterial({color:'#45483c',roughness:.9});
      grates=new THREE.InstancedMesh(grateGeometry,grateMaterial,Math.max(8,Math.ceil(sites.length*1.5)));grates.name='Tree grates';grates.receiveShadow=true;grates.frustumCulled=false;group.add(grates);
    }
    sites.forEach((site,i)=>{dummy.position.copy(site.p);dummy.position.y+=.035;dummy.rotation.set(0,.3,0);dummy.scale.setScalar(1);dummy.updateMatrix();grates!.setMatrixAt(i,dummy.matrix);});
    grates.count=sites.length;grates.visible=sites.length>0;grates.instanceMatrix.needsUpdate=true;
  };
  const field:TreeField={group,
    add(owner,positions){
      const random=seeded(owner==='all'?9311:9311+hash(owner)%100000);
      for(const p of positions.filter(p=>!inLongfellowCorridor(p.x,p.z)))sites.push({p,species:options.grates===false?Math.floor(random()*4):Math.floor(random()*3),scale:scale*(TREE_SCALE_RANGE[0]+random()*(TREE_SCALE_RANGE[1]-TREE_SCALE_RANGE[0])),yaw:random()*Math.PI*2,owner});
      dirty=true;refreshGrates();group.userData.treeCount=sites.length;
    },
    remove(owner){sites=sites.filter(s=>s.owner!==owner);dirty=true;refreshGrates();group.userData.treeCount=sites.length;},
    get count(){return sites.length;},
  };
  group.userData.treeCount=0;group.userData.species=SPECIES.map(s=>s.name);return field;
}
export function createStreetTrees(positions:THREE.Vector3[],options:{scale?:number;grates?:boolean}={}){
  const field=createTreeField(options);field.add('all',positions);return field.group;
}
const fields=new WeakMap<THREE.Scene,{list:THREE.Group[];version:unknown}>();
/** Fields are found by one scene scan, repeated whenever `scene.userData.version` changes (streamed tiles). */
export function updateFoliage(scene:THREE.Scene,observer:THREE.Vector3,time:number,high=true,flightShadows=false){
  windTime.value=time;let cached=fields.get(scene);
  if(!cached||cached.version!==scene.userData.version){const list:THREE.Group[]=[];scene.traverse(o=>{if(o instanceof THREE.Group&&o.userData.updateFoliage)list.push(o);});cached={list,version:scene.userData.version};fields.set(scene,cached);}
  for(const field of cached.list)field.userData.updateFoliage(observer,time,high,flightShadows);
}
