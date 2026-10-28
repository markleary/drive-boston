import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import type { CityData, LightingMode, Point2 } from '../types';
import { closestRoad, pointInside } from '../simulation/roads';
import { createMaterials, facadeStyleIndex, seeded, stabilizeFacadeUVs } from './materials';
import { createStreetTrees } from './foliage';
import { createStreetSign } from './signs';
import { sampleElevation } from '../simulation/terrain';
import { drapedRibbon, terrainTiles, foundationGeometry, backBayPaving } from './terrain-ground';
import { mergeSpatialGeometries, spatialInstances } from './spatial-batches';
import { createTrafficSignals } from './traffic-signals';
import { createGrassMaterial } from './ground-cover';
import { prepareNeighborhoodArchitecture } from './neighborhood-profiles';
import { isFenwayBuilding, createFenwayShellMaterials } from './fenway-park';
import { addRoadStructures } from './bridges';
import { meshBuildingIds } from '../simulation/building-collisions';
import { inTransitCorridor } from '../simulation/transit-corridors';
import { addSourceFooting } from './source-footings';
import {isStateHouse,createStateHouseShellMaterials,splitStateHouseShell} from './state-house';
import {createPrudentialPenthouseMaterial,isPrudential,prudentialCrownCollider,splitPrudentialShell} from './prudential';

export async function createWorld(renderer:THREE.WebGLRenderer,scene:THREE.Scene,city:CityData) {
  prepareNeighborhoodArchitecture(city);
  const materials=createMaterials();
  const ribbon=(points:Point2[],width:number,y:number)=>drapedRibbon(city,points,width,y);
  const height=(x:number,z:number)=>sampleElevation(city,x,z);
  const buildingChunks:THREE.Mesh[]=[];
  const buildingCollisions:{id:string;vertices:Float32Array;indices:Uint32Array}[]=[];
  scene.background=null;scene.fog=new THREE.Fog('#aeb9bc',250,1050);
  const hemi=new THREE.HemisphereLight(0xb8d9f1,0x625343,.6);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffdfad,3.8);sun.position.set(-270,255,330);sun.castShadow=true;
  sun.shadow.mapSize.set(4096,4096);sun.shadow.camera.left=-105;sun.shadow.camera.right=105;sun.shadow.camera.top=105;sun.shadow.camera.bottom=-105;sun.shadow.camera.near=1;sun.shadow.camera.far=1100;sun.shadow.normalBias=.055;sun.shadow.bias=-.000045;
  scene.add(sun,sun.target);
  const sky=new Sky();sky.scale.setScalar(1800);sky.userData.noAO=true;scene.add(sky);
  // Keep the analytic sun's extreme radiance out of the bloom buffer: otherwise
  // looking southwest washes out the street, even when buildings hide the sun.
  sky.material.fragmentShader=sky.material.fragmentShader.replace('vec4( texColor, 1.0 )','vec4( min( texColor * 0.65, vec3( 1.2 ) ), 1.0 )');
  const skyUniforms=sky.material.uniforms;skyUniforms.turbidity.value=3;skyUniforms.rayleigh.value=1.5;skyUniforms.mieCoefficient.value=.004;skyUniforms.mieDirectionalG.value=.82;
  const environmentScene=new THREE.Scene(),environmentSky=sky.clone();environmentScene.add(environmentSky);
  const pmrem=new THREE.PMREMGenerator(renderer);let skyEnvironment:THREE.WebGLRenderTarget|undefined,reflectionEnvironment:THREE.WebGLRenderTarget|undefined;
  const probeTarget=new THREE.WebGLCubeRenderTarget(256,{type:THREE.HalfFloatType,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
  const probe=new THREE.CubeCamera(.4,900,probeTarget);scene.add(probe);
  const probePosition=new THREE.Vector3(Infinity,Infinity,Infinity);let reflectionDirty=true,lastProbeTime=-100;
  let highQuality=true;
  const groundMaterial=createGrassMaterial('#c6cbb2');groundMaterial.polygonOffset=true;groundMaterial.polygonOffsetFactor=1;groundMaterial.polygonOffsetUnits=4;
  for(const geometry of terrainTiles(city)){const ground=new THREE.Mesh(geometry,groundMaterial);ground.position.y=-.04;ground.receiveShadow=true;ground.renderOrder=-3;scene.add(ground);}
  const {minX,maxX,minZ,maxZ}=city.bounds;
  // These survey layers are only centimeters apart. Explicit order plus a bias
  // away from the camera prevents the underlay overwriting roads at altitude.
  materials.sidewalk.polygonOffset=true;materials.sidewalk.polygonOffsetFactor=1;materials.sidewalk.polygonOffsetUnits=2;
  for(const paint of [materials.paint,materials.yellow]){paint.polygonOffset=true;paint.polygonOffsetUnits=-1;}
  materials.sidewalk.map?.repeat.set(1,1);
  const oldDistrictPaving=new THREE.Mesh(backBayPaving(city),materials.sidewalk);oldDistrictPaving.receiveShadow=true;oldDistrictPaving.renderOrder=-2;scene.add(oldDistrictPaving);
  const streets:THREE.BufferGeometry[]=[],sidewalks:THREE.BufferGeometry[]=[],lines:THREE.BufferGeometry[]=[],yellow:THREE.BufferGeometry[]=[];
  const crossingKeys=new Set<string>();
  for(const road of city.roads){
    if(road.elevations)continue;
    sidewalks.push(ribbon(road.points,road.width+5.8,.012));
    streets.push(ribbon(road.points,road.width,.045));
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<8)continue;
      const tx=dx/len,tz=dz/len;
      if(road.width>=9)for(let d=8;d<len-7;d+=9){const end=Math.min(d+3,len-7);(road.oneway?lines:yellow).push(ribbon([[a[0]+tx*d,a[1]+tz*d],[a[0]+tx*end,a[1]+tz*end]],.12,.065));}
    }
    if(road.width<7||/alley|unnamed/i.test(road.name))continue;
    for(const reverse of [false,true]){
      const a=road.points[reverse?road.points.length-1:0],b=road.points[reverse?road.points.length-2:1];if(!b)continue;
      const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<18)continue;
      const tx=(b[0]-a[0])/len,tz=(b[1]-a[1])/len,key=`${Math.round(a[0]/3)},${Math.round(a[1]/3)},${Math.round(Math.atan2(tx,tz)*2)}`;
      if(crossingKeys.has(key))continue;crossingKeys.add(key);
      for(let side=-road.width/2+.8;side<road.width/2-.5;side+=1.35){
        const x=a[0]+tx*8-tz*side,z=a[1]+tz*8+tx*side;
        lines.push(ribbon([[x,z],[x+tx*3,z+tz*3]],.65,.068));
      }
    }
  }
  const mergeAdd=(geometries:THREE.BufferGeometry[],material:THREE.Material)=>{for(const m of mergeSpatialGeometries(geometries,material)){m.receiveShadow=true;if(material===materials.asphalt)m.renderOrder=-1;else if(material===materials.sidewalk)m.renderOrder=-2;scene.add(m);}};
  mergeAdd(sidewalks,materials.sidewalk);mergeAdd(streets,materials.asphalt);mergeAdd(lines,materials.paint);mergeAdd(yellow,materials.yellow);
  const roadStructures=addRoadStructures(scene,city,materials.asphalt);
  // Surveyed curb paths follow terrain; their raised faces remain visual detail.
  const curbFaces:THREE.BufferGeometry[]=[];
  for(const points of city.curbs)for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.05)continue;
    const n=Math.max(1,Math.ceil(length/3));
    for(let j=0;j<n;j++){
      const t=(j+.5)/n,x=a[0]+dx*t,z=a[1]+dz*t;
      const g=new THREE.BoxGeometry(.18,.17,length/n).rotateY(Math.atan2(dx,dz)).translate(x,.085,z),p=g.attributes.position;
      for(let k=0;k<p.count;k++)p.setY(k,p.getY(k)+height(p.getX(k),p.getZ(k)));
      g.computeVertexNormals();curbFaces.push(g);
    }
  }
  mergeAdd(curbFaces,materials.curb);

  const gltf=await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}data/city.glb`);
  gltf.scene.updateMatrixWorld(true);
  const buildingMap=new Map(city.buildings.map(b=>[b.id,b]));
  const fenwayMaterials=createFenwayShellMaterials();
  const stateHouseMaterials=createStateHouseShellMaterials();
  const prudentialPenthouse=createPrudentialPenthouseMaterial();
  // Source tiles include park monuments, shelters and utility structures among
  // the building meshes. Keep their measured forms without residential windows.
  const principalParks=(city.parks??[]).filter(p=>/^(Boston Common|Public Garden)$/.test(p.name));
  const parkStructures=new Set(city.buildings.filter(b=>b.height<30&&principalParks.some(p=>p.rings[0]&&pointInside(b.center,p.rings[0])&&!p.rings.slice(1).some(r=>pointInside(b.center,r)))).map(b=>b.id));
  const parkStone=new THREE.MeshStandardMaterial({color:'#a5a397',roughness:.9});
  const buckets=new Map<string,{material:THREE.Material,geometries:THREE.BufferGeometry[]}>();
  gltf.scene.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    let owner:THREE.Object3D|null=object;while(owner&&!owner.userData.buildingId)owner=owner.parent;
    const b=buildingMap.get(owner?.userData.buildingId??object.name);
    const old=Array.isArray(object.material)?object.material[0]:object.material;
    const isRoof=old.name==='roof';
    let material:THREE.Material=isRoof?materials.roof:materials.facades[facadeStyleIndex(b)];
    if(!isRoof&&b?.landmark==='hancock')material=materials.glass;
    else if(!isRoof&&b?.landmark==='library')material=materials.library;
    else if(!isRoof&&b?.landmark==='trinity')material=materials.church;
    if(b&&parkStructures.has(b.id))material=parkStone;
    if(b&&isFenwayBuilding(b))material=isRoof?fenwayMaterials.roof:fenwayMaterials.wall;
    const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld);
    const footing=!isRoof&&b&&meshBuildingIds.has(b.id)?addSourceFooting(scene,city,b,geometry):undefined;
    if(footing)buildingCollisions.push(footing);
    if(b&&meshBuildingIds.has(b.id)){
      const positions=geometry.getAttribute('position');
      const vertices=new Float32Array(positions.count*3);
      for(let i=0;i<positions.count;i++){vertices[i*3]=positions.getX(i);vertices[i*3+1]=positions.getY(i);vertices[i*3+2]=positions.getZ(i);}
      const indices=geometry.index?new Uint32Array(geometry.index.array):Uint32Array.from({length:positions.count},(_,i)=>i);
      buildingCollisions.push({id:b.id,vertices,indices});
    }
    const normalized=geometry.index?geometry.toNonIndexed():geometry;
    if(!isRoof)stabilizeFacadeUVs(normalized,b);
    if(isStateHouse(b)){
      for(const part of splitStateHouseShell(normalized,isRoof)){
        const stateMaterial=stateHouseMaterials[part.kind],key=`${stateMaterial.uuid}:state-house`;
        const bucket=buckets.get(key)??{material:stateMaterial,geometries:[]};bucket.geometries.push(part.geometry);buckets.set(key,bucket);
      }
      normalized.dispose();if(normalized!==geometry)geometry.dispose();return;
    }
    const parts=!isRoof&&b&&isPrudential(b)?splitPrudentialShell(normalized,b):[{kind:'facade',geometry:normalized}];
    for(const part of parts){
      const partMaterial=part.kind==='penthouse'?prudentialPenthouse:material;
      const key=`${partMaterial.uuid}:${Math.floor((b?.center[0]??0)/240)}:${Math.floor((b?.center[1]??0)/240)}`;
      const bucket=buckets.get(key)??{material:partMaterial,geometries:[]};bucket.geometries.push(part.geometry);buckets.set(key,bucket);
    }
    if(parts[0].geometry!==normalized){normalized.dispose();if(normalized!==geometry)geometry.dispose();}
  });
  const prudentialCrown=prudentialCrownCollider(city);if(prudentialCrown)buildingCollisions.push(prudentialCrown);
  for(const {material,geometries} of buckets.values()){
    const geometry=mergeGeometries(geometries,false);if(!geometry)continue;
    const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='Boston surveyed buildings';geometry.computeBoundingSphere();buildingChunks.push(mesh);scene.add(mesh);
    for(const g of geometries)g.dispose();
  }

  const foundations=new THREE.Mesh(foundationGeometry({...city,buildings:city.buildings.filter(b=>!meshBuildingIds.has(b.id))}),new THREE.MeshStandardMaterial({color:'#827c6d',roughness:.95,side:THREE.DoubleSide}));foundations.receiveShadow=true;scene.add(foundations);

  const treePositions:THREE.Vector3[]=[];const lampPositions:THREE.Vector3[]=[];const signRecords:{position:THREE.Vector3,name:string,yaw:number}[]=[];
  const random=seeded(342);
  const buildingCells=new Map<string,CityData['buildings']>();
  for(const b of city.buildings){
    const xs=b.footprint.map(p=>p[0]),zs=b.footprint.map(p=>p[1]);
    for(let x=Math.floor(Math.min(...xs)/128);x<=Math.floor(Math.max(...xs)/128);x++)for(let z=Math.floor(Math.min(...zs)/128);z<=Math.floor(Math.max(...zs)/128);z++){
      const key=`${x},${z}`,list=buildingCells.get(key)??[];list.push(b);buildingCells.set(key,list);
    }
  }
  const occupied=(x:number,z:number)=>inTransitCorridor(city,x,z)||(buildingCells.get(`${Math.floor(x/128)},${Math.floor(z/128)}`)??[]).some(b=>pointInside([x,z],b.footprint));
  const roadCells=new Map<string,{a:Point2;b:Point2;radius:number}[]>();
  for(const road of city.roads)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],radius=road.width/2+.8,segment={a,b,radius};
    for(let x=Math.floor((Math.min(a[0],b[0])-radius)/64);x<=Math.floor((Math.max(a[0],b[0])+radius)/64);x++)for(let z=Math.floor((Math.min(a[1],b[1])-radius)/64);z<=Math.floor((Math.max(a[1],b[1])+radius)/64);z++){
      const key=`${x},${z}`,list=roadCells.get(key)??[];list.push(segment);roadCells.set(key,list);
    }
  }
  const inRoad=(x:number,z:number)=>(roadCells.get(`${Math.floor(x/64)},${Math.floor(z/64)}`)??[]).some(({a,b,radius})=>{
    const dx=b[0]-a[0],dz=b[1]-a[1],t=THREE.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<radius;
  });
  const taken=new Set<string>(),signCells=new Map<string,number>();
  for(const road of city.roads){
    if(road.elevations||road.width<7||/alley|unnamed/i.test(road.name))continue;
    let run=0;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.1)continue;
      const tx=dx/length,tz=dz/length;
      for(let d=14;d<length-8;d+=25){
        for(const side of [-1,1]){
          const x=a[0]+tx*d-tz*(road.width/2+2)*side,z=a[1]+tz*d+tx*(road.width/2+2)*side;
          const key=`${Math.round(x/8)},${Math.round(z/8)}`;if(occupied(x,z)||inRoad(x,z)||taken.has(key))continue;taken.add(key);
          if(!/Boylston/.test(road.name)||random()>.5)treePositions.push(new THREE.Vector3(x,height(x,z),z));
          if(side===1&&!inRoad(x-tx*5,z-tz*5)&&!occupied(x-tx*5,z-tz*5))lampPositions.push(new THREE.Vector3(x-tx*5,height(x-tx*5,z-tz*5),z-tz*5));
        }
      }
      if(run===0&&length>15){const x=a[0]+tx*10-tz*(road.width/2+1.2),z=a[1]+tz*10+tx*(road.width/2+1.2),cell=`${Math.floor(x/320)},${Math.floor(z/320)}`;if((signCells.get(cell)??0)<3&&!occupied(x,z)&&!inRoad(x,z)){signRecords.push({position:new THREE.Vector3(x,height(x,z),z),name:road.name.replace('Street','ST').replace('Avenue','AVE').toUpperCase(),yaw:Math.atan2(tx,tz)});signCells.set(cell,(signCells.get(cell)??0)+1);}}
      run+=length;
    }
  }
  const dummy=new THREE.Object3D();
  scene.add(createStreetTrees(treePositions));
  const iron=new THREE.MeshStandardMaterial({color:'#34443f',metalness:.45,roughness:.55});
  const lampMat=new THREE.MeshStandardMaterial({color:'#fff0cc',emissive:'#ffca76',emissiveIntensity:.15});
  const poles=new THREE.InstancedMesh(new THREE.CylinderGeometry(.055,.1,5.7,6),iron,lampPositions.length);
  const lamps=new THREE.InstancedMesh(new THREE.SphereGeometry(.27,8,6),lampMat,lampPositions.length);
  lampPositions.forEach((p,i)=>{dummy.position.copy(p).add(new THREE.Vector3(0,2.85,0));dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);dummy.updateMatrix();poles.setMatrixAt(i,dummy.matrix);dummy.position.y=p.y+5.85;dummy.updateMatrix();lamps.setMatrixAt(i,dummy.matrix);});poles.castShadow=true;scene.add(...spatialInstances(poles),...spatialInstances(lamps));
  const signHardware:THREE.BufferGeometry[]=[];
  for(const sign of signRecords){
    signHardware.push(new THREE.CylinderGeometry(.04,.04,3.2,6).translate(sign.position.x,sign.position.y+1.6,sign.position.z));
    signHardware.push(new THREE.BoxGeometry(2.67,.5,.045).rotateY(sign.yaw).translate(sign.position.x,sign.position.y+3,sign.position.z));
    const plate=createStreetSign(sign.name);plate.position.set(sign.position.x,sign.position.y+3,sign.position.z);plate.rotation.y=sign.yaw;scene.add(plate);
  }
  mergeAdd(signHardware,iron);
  const signalSystem=createTrafficSignals(scene,city);
  const localLights:THREE.PointLight[]=[];for(let i=0;i<8;i++){const light=new THREE.PointLight(0xffcc89,0,21,2);scene.add(light);localLights.push(light);}
  let mode:LightingMode='golden';
  const direction=new THREE.Vector3(-270,255,330);
  function setLighting(next:LightingMode){
    mode=next;const night=mode==='night';materials.setNight(night);lampMat.emissiveIntensity=night?5:.1;
    sky.visible=!night;environmentSky.visible=!night;
    scene.background=night?new THREE.Color('#07111e'):null;
    environmentScene.background=night?new THREE.Color('#152638'):null;
    (scene.fog as THREE.Fog).color.set(night?'#162536':mode==='golden'?'#b5b7b2':'#b6c9d5');
    direction.set(...(mode==='golden'?[-270,255,330]:[-200,570,-240]) as [number,number,number]);
    skyUniforms.sunPosition.value.copy(direction).normalize();
    skyUniforms.rayleigh.value=mode==='golden'?1.45:2;
    skyUniforms.turbidity.value=mode==='golden'?3:2;
    skyUniforms.showSunDisc.value=false;
    skyEnvironment?.dispose();skyEnvironment=pmrem.fromScene(environmentScene,.04,.1,2000);
    scene.environment=skyEnvironment.texture;skyUniforms.showSunDisc.value=true;
    sun.color.set(mode==='golden'?0xffd5a6:mode==='day'?0xfff3df:0x8eaad8);
    sun.intensity=night?.16:mode==='golden'?3.6:3.4;hemi.intensity=night?.24:.68;
    scene.environmentIntensity=night?.22:.16;renderer.toneMappingExposure=night?1.05:.93;
    reflectionDirty=true;
  }
  setLighting('golden');
  function update(position:THREE.Vector3,time:number){
    // Keep the shadow focus on the ground as the helicopter climbs. Widen the
    // coverage from street detail to the district without moving the world datum.
    const groundY=height(position.x,position.z);
    sun.target.position.set(position.x,groundY,position.z);sun.position.copy(sun.target.position).add(direction);sky.position.copy(position);
    const shadowExtent=Math.max(105,Math.min(330,105+Math.max(0,position.y-groundY)*.72));
    if(Math.abs(sun.shadow.camera.right-shadowExtent)>2){sun.shadow.camera.left=-shadowExtent;sun.shadow.camera.right=shadowExtent;sun.shadow.camera.top=shadowExtent;sun.shadow.camera.bottom=-shadowExtent;sun.shadow.camera.updateProjectionMatrix();}
    for(const mesh of buildingChunks){const sphere=mesh.geometry.boundingSphere!;mesh.visible=Math.hypot(sphere.center.x-position.x,sphere.center.z-position.z)<1100+Math.max(0,position.y-groundY)*2+sphere.radius;}
    const near=lampPositions.map(p=>({p,d:p.distanceToSquared(position)})).sort((a,b)=>a.d-b.d).slice(0,8);
    localLights.forEach((l,i)=>{if(near[i]){l.position.copy(near[i].p);l.position.y+=5.6;}l.intensity=mode==='night'?70:0;});
    signalSystem.update(time);
  }
  function updateReflections(position:THREE.Vector3,time:number,player:THREE.Object3D){
    // Let the main view allocate the depth-comparison shadow texture before a
    // probe capture; a shadow sampler cannot use an uninitialized color texture.
    if(!sun.shadow.map)return;
    if(!reflectionDirty&&(!highQuality||time-lastProbeTime<2.5||probePosition.distanceToSquared(position)<144))return;
    const visible=player.visible,autoShadow=renderer.shadowMap.autoUpdate;
    player.visible=false;renderer.shadowMap.autoUpdate=false;scene.environment=skyEnvironment!.texture;
    skyUniforms.showSunDisc.value=false;probe.position.copy(position);probe.position.y=Math.max(height(position.x,position.z)+2.1,position.y);
    try{probe.update(renderer,scene);}finally{player.visible=visible;renderer.shadowMap.autoUpdate=autoShadow;skyUniforms.showSunDisc.value=true;}
    reflectionEnvironment=pmrem.fromCubemap(probeTarget.texture,reflectionEnvironment);
    scene.environment=reflectionEnvironment.texture;probePosition.copy(position);lastProbeTime=time;reflectionDirty=false;
  }
  function setQuality(high:boolean){
    highQuality=high;const size=high?4096:2048;
    if(sun.shadow.mapSize.x!==size){sun.shadow.mapSize.set(size,size);sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;}
  }
  return {setLighting,update,updateReflections,setQuality,materials,buildings:buildingMap,buildingCollisions,signals:signalSystem.placements,roadStructures};
}
