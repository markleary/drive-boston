import * as THREE from 'three';
import type {Building,CityData,ParkPath,Point2} from '../types';
import {pointInside} from '../simulation/roads.ts';
import {sampleElevation,sampleTerrainNormal} from '../simulation/terrain.ts';
import {FROG_POND,frogPondApron} from '../simulation/boston-common.ts';
import {MALL_MONUMENTS,MALL_WALK_HALF,WOMENS_MEMORIAL_RADIUS,mallPathTest} from '../simulation/commonwealth-mall.ts';
import {seeded,canvasTexture} from './materials';
import {mergeSpatialGeometries} from './spatial-batches';
import {insideEmbracePlaza} from './the-embrace';

let grassMaps:{color:THREE.Texture;relief:THREE.Texture}|undefined;
export function createGrassMaterial(tint='#a2af84'){
  if(!grassMaps){
    const canvas=document.createElement('canvas'),relief=document.createElement('canvas');canvas.width=canvas.height=relief.width=relief.height=512;
    const c=canvas.getContext('2d')!,b=relief.getContext('2d')!,random=seeded(6271);c.fillStyle='#7e8c5d';c.fillRect(0,0,512,512);b.fillStyle='#808080';b.fillRect(0,0,512,512);
    for(let i=0;i<68000;i++){
      const x=random()*512,y=random()*512,length=.8+random()*4,dx=(random()-.5)*2;
      c.strokeStyle=`hsl(${64+random()*29},${16+random()*25}%,${28+random()*29}%)`;c.lineWidth=.55+random()*.75;c.beginPath();c.moveTo(x,y);c.lineTo(x+dx,y-length);c.stroke();
      b.strokeStyle=random()>.5?'#9d9d9d':'#656565';b.lineWidth=.7;b.beginPath();b.moveTo(x,y);b.lineTo(x+dx,y-length);b.stroke();
    }
    const color=canvasTexture(canvas,true),height=canvasTexture(relief,true);height.colorSpace=THREE.NoColorSpace;grassMaps={color,relief:height};
  }
  const material=new THREE.MeshStandardMaterial({color:tint,map:grassMaps.color,bumpMap:grassMaps.relief,bumpScale:.026,roughness:.98});
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 grassWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\ngrassWorld=(modelMatrix*vec4(transformed,1.)).xz;');
    shader.fragmentShader='varying vec2 grassWorld;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float broad=sin(grassWorld.x*.037+sin(grassWorld.y*.041)*2.)*cos(grassWorld.y*.031);
      float fine=sin(grassWorld.x*.29)*sin(grassWorld.y*.21+grassWorld.x*.13);
      float mown=sin((grassWorld.x*.57+grassWorld.y)*.37);
      diffuseColor.rgb*=1.03+broad*.13+fine*.045+mown*.035;`);
  };material.customProgramCacheKey=()=>'boston-grass-2';return material;
}
function segmentDistance(p:Point2,a:Point2,b:Point2){const dx=b[0]-a[0],dz=b[1]-a[1],t=THREE.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);}
function polygonContains(p:Point2,rings:Point2[][]){return!!rings[0]&&pointInside(p,rings[0])&&!rings.slice(1).some(r=>pointInside(p,r));}
type Segment={a:Point2;b:Point2;radius:number};
/** Streamed tiles carry the park paths, buildings and surveyed sidewalks that a metro city.json leaves out. */
export interface GroundCoverTiles{readonly loaded:ReadonlyMap<string,{tile:{parkPaths:ParkPath[];buildings:Building[];sidewalks?:{rings:Point2[][]}[]}}>}
type Paved={rings:Point2[][];minX:number;maxX:number;minZ:number;maxZ:number};
export function createGroundCover(scene:THREE.Scene,city:CityData,tiles?:GroundCoverTiles){
  const group=new THREE.Group();group.name='Close grass and roadside puddles';scene.add(group);
  const parks=(city.parks??[]).filter(p=>/Boston Common|Public Garden|Back Bay Fens|Riverway|McLaughlin|Commonwealth Avenue Mall/i.test(p.name)).map(p=>({...p,minX:Math.min(...p.rings[0].map(v=>v[0])),maxX:Math.max(...p.rings[0].map(v=>v[0])),minZ:Math.min(...p.rings[0].map(v=>v[1])),maxZ:Math.max(...p.rings[0].map(v=>v[1]))}));
  const cell=40;
  const addPath=(barriers:Map<string,Segment[]>,points:Point2[],radius:number)=>{for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];for(let x=Math.floor((Math.min(a[0],b[0])-radius)/cell);x<=Math.floor((Math.max(a[0],b[0])+radius)/cell);x++)for(let z=Math.floor((Math.min(a[1],b[1])-radius)/cell);z<=Math.floor((Math.max(a[1],b[1])+radius)/cell);z++){const key=`${x},${z}`,list=barriers.get(key)??[];list.push({a,b,radius});barriers.set(key,list);}}};
  const addBuildings=(cells:Map<string,Building[]>,buildings:Building[])=>{for(const b of buildings){for(let x=Math.floor(Math.min(...b.footprint.map(p=>p[0]))/cell);x<=Math.floor(Math.max(...b.footprint.map(p=>p[0]))/cell);x++)for(let z=Math.floor(Math.min(...b.footprint.map(p=>p[1]))/cell);z<=Math.floor(Math.max(...b.footprint.map(p=>p[1]))/cell);z++){const key=`${x},${z}`,list=cells.get(key)??[];list.push(b);cells.set(key,list);}}};
  // Paths are drawn at their full width; the margin keeps blades off the ribbon's edge. A walk on the Commonwealth
  // Avenue Mall is drawn no wider than its surveyed 6.3 m. Sidewalk polygons the inventory surveyed inside these
  // parks (the Mall's walk, the paving round its monuments) are paved too, whatever the mapped path's line says.
  const onMall=mallPathTest(city.parks??[]);
  const indexArea=(paths:ParkPath[],buildings:Building[],sidewalks:{rings:Point2[][]}[]=[])=>{
    const barriers=new Map<string,Segment[]>(),buildingCells=new Map<string,Building[]>(),paved=new Map<string,Paved[]>();
    for(const path of paths)addPath(barriers,path.points,(onMall(path)?Math.min(path.width,MALL_WALK_HALF*2):path.width)/2+.4);addBuildings(buildingCells,buildings);
    for(const walk of sidewalks){
      const ring=walk.rings[0];if(!ring||ring.length<3)continue;
      let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const [x,z] of ring){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
      if(!parks.some(a=>minX<a.maxX&&maxX>a.minX&&minZ<a.maxZ&&maxZ>a.minZ&&ring.some(p=>pointInside(p,a.rings[0]))))continue;
      const entry={rings:walk.rings,minX,maxX,minZ,maxZ};
      for(let x=Math.floor(minX/cell);x<=Math.floor(maxX/cell);x++)for(let z=Math.floor(minZ/cell);z<=Math.floor(maxZ/cell);z++){const key=`${x},${z}`,list=paved.get(key)??[];list.push(entry);paved.set(key,list);}
    }
    return{barriers,buildingCells,paved};
  };
  // The granite round of the Women's Memorial and each monument's own footing are not lawn either.
  const monuments=MALL_MONUMENTS.map(m=>({x:m.at[0],z:m.at[1],radius:m.id==='women'?WOMENS_MEMORIAL_RADIUS+.2:1.6}));
  const roadBarriers=new Map<string,Segment[]>();for(const road of city.roads)addPath(roadBarriers,road.points,road.width/2+3.1);
  // A metro package streams paths and buildings per tile, so each loaded tile gets its own index.
  const areas=new Map<string,ReturnType<typeof indexArea>>();if(!tiles)areas.set('city',indexArea(city.parkPaths??[],city.buildings));
  const syncTiles=()=>{if(!tiles)return false;let changed=false;for(const key of areas.keys())if(!tiles.loaded.has(key)){areas.delete(key);changed=true;}for(const [key,built]of tiles.loaded)if(!areas.has(key)){areas.set(key,indexArea(built.tile.parkPaths,built.tile.buildings,built.tile.sidewalks));changed=true;}return changed;};
  const blocked=(p:Point2,key:string)=>{
    if((roadBarriers.get(key)??[]).some(s=>segmentDistance(p,s.a,s.b)<s.radius)||monuments.some(m=>Math.hypot(p[0]-m.x,p[1]-m.z)<m.radius))return true;
    for(const area of areas.values())if((area.barriers.get(key)??[]).some(s=>segmentDistance(p,s.a,s.b)<s.radius)||(area.buildingCells.get(key)??[]).some(b=>pointInside(p,b.footprint))
      ||(area.paved.get(key)??[]).some(w=>p[0]>=w.minX&&p[0]<=w.maxX&&p[1]>=w.minZ&&p[1]<=w.maxZ&&polygonContains(p,w.rings)))return true;
    return false;
  };
  const waterExclusions=(city.water??[]).map(w=>{
    const rings=w.name===FROG_POND?[frogPondApron]:w.rings;
    return {rings,minX:Math.min(...rings[0].map(p=>p[0])),maxX:Math.max(...rings[0].map(p=>p[0])),minZ:Math.min(...rings[0].map(p=>p[1])),maxZ:Math.max(...rings[0].map(p=>p[1]))};
  });
  const grassGeometry=new THREE.BufferGeometry(),positions:number[]=[],colors:number[]=[];
  for(let blade=0;blade<5;blade++){
    const angle=blade*2.39996,dx=Math.cos(angle),dz=Math.sin(angle),spread=blade*.025,base=[dx*spread,0,dz*spread],height=.055+(blade%3)*.025,width=.012;
    for(const [x,y,z]of [[base[0]-dz*width,0,base[2]+dx*width],[base[0]+dz*width,0,base[2]-dx*width],[base[0]+dx*.06,height,base[2]+dz*.06]]){positions.push(x,y,z);colors.push(.36+y*.8,.49+y*.8,.22+y*.6);}
  }
  grassGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));grassGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));grassGeometry.computeVertexNormals();
  const grassMaterial=new THREE.MeshStandardMaterial({color:'#c3cc9d',vertexColors:true,roughness:.95,side:THREE.DoubleSide});
  const tuft=new THREE.InstancedMesh(grassGeometry,grassMaterial,6500);tuft.name='Near grass blades';tuft.frustumCulled=false;tuft.receiveShadow=true;tuft.userData.noAO=true;tuft.count=0;group.add(tuft);
  const dummy=new THREE.Object3D();let previousX=Infinity,previousZ=Infinity,previousHigh=true;
  function update(observer:THREE.Vector3,_time:number,high=true){
    if(observer.y-sampleElevation(city,observer.x,observer.z)>60){tuft.visible=false;return;}tuft.visible=true;
    const tilesChanged=syncTiles();
    if(!tilesChanged&&Math.hypot(observer.x-previousX,observer.z-previousZ)<10&&high===previousHigh)return;previousX=observer.x;previousZ=observer.z;previousHigh=high;
    const radius=high?57:36,budget=high?6500:2500;let count=0;
    for(let iz=Math.floor((observer.z-radius)/1.1);iz<=Math.ceil((observer.z+radius)/1.1)&&count<budget;iz++)for(let ix=Math.floor((observer.x-radius)/1.1);ix<=Math.ceil((observer.x+radius)/1.1)&&count<budget;ix++){
      const random=seeded(Math.imul(ix,73856093)^Math.imul(iz,19349663)),x=ix*1.1+(random()-.5)*.8,z=iz*1.1+(random()-.5)*.8,p:Point2=[x,z];
      if(Math.hypot(x-observer.x,z-observer.z)>radius||!parks.some(a=>x>a.minX&&x<a.maxX&&z>a.minZ&&z<a.maxZ&&polygonContains(p,a.rings)))continue;
      if(insideEmbracePlaza(x,z,-.6))continue;
      if(waterExclusions.some(w=>x>w.minX&&x<w.maxX&&z>w.minZ&&z<w.maxZ&&polygonContains(p,w.rings)))continue;
      const key=`${Math.floor(x/cell)},${Math.floor(z/cell)}`;
      if(blocked(p,key))continue;
      dummy.position.set(x,sampleElevation(city,x,z)+.027,z);dummy.rotation.set(0,random()*Math.PI*2,0);dummy.scale.setScalar(.7+random()*.8);dummy.updateMatrix();tuft.setMatrixAt(count++,dummy.matrix);
    }
    tuft.count=count;tuft.instanceMatrix.needsUpdate=true;group.userData.visibleTufts=count;
  }
  const puddles:THREE.BufferGeometry[]=[],random=seeded(7073),puddleSites:{x:number;z:number;road:string}[]=[];
  for(const road of city.roads){
    if(road.elevations||road.width<8||random()>.09)continue;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<38)continue;
      const t=.3+random()*.4,offset=(road.width/2-.65)*(random()>.5?1:-1),x=a[0]+dx*t-dz/length*offset,z=a[1]+dz*t+dx/length*offset;
      const normal=sampleTerrainNormal(city,x,z);if(normal.y<.999)continue;
      const shape=new THREE.Shape();for(let j=0;j<18;j++){const angle=j/18*Math.PI*2,r=.7+random()*.28,xx=Math.cos(angle)*r*(.65+random()*.12),zz=Math.sin(angle)*r*(1.3+random()*.25);if(j===0)shape.moveTo(xx,zz);else shape.lineTo(xx,zz);}shape.closePath();
      const g=new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2).rotateY(Math.atan2(dx,dz));const attr=g.attributes.position;for(let j=0;j<attr.count;j++){const xx=attr.getX(j)+x,zz=attr.getZ(j)+z;attr.setXYZ(j,xx,sampleElevation(city,xx,zz)+.057,zz);}g.computeVertexNormals();puddles.push(g);puddleSites.push({x,z,road:road.name});break;
    }
  }
  const wet=new THREE.MeshPhysicalMaterial({color:'#737e80',metalness:.68,roughness:.035,clearcoat:1,clearcoatRoughness:.025,transparent:true,opacity:.75,depthWrite:false,envMapIntensity:2.2,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  for(const mesh of mergeSpatialGeometries(puddles,wet)){mesh.name='Reflective rain puddles';mesh.renderOrder=2;mesh.receiveShadow=true;group.add(mesh);}
  group.userData.puddles=puddleSites.length;group.userData.puddleSites=puddleSites;return{group,update};
}
