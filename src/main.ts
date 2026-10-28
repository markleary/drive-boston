import './style.css';
import * as THREE from 'three';
import { Ray } from '@dimforge/rapier3d-compat';
import { DrivingPhysics } from './physics/vehicle';
import { createCar } from './render/car';
import { createHelicopter } from './render/helicopter';
import { createHelicopterFlight, type FlightInput } from './simulation/helicopter';
import { sampleElevation, terrainRange } from './simulation/terrain';
import { prepareRoadTerrain } from './simulation/road-grading.ts';
import { sampleDriveSurface } from './simulation/road-surfaces';
import { createWorld } from './render/world';
import { addLandmarkDetails } from './render/landmarks';
import { addStreetscape } from './render/streetscape';
import { createGraphics, type QualityMode } from './render/graphics';
import { addFacadeDetails } from './render/facade-details';
import { addParkDetails } from './render/park-details';
import { addCityParkDetails } from './render/city-parks';
import { addCityLandmarkDetails } from './render/city-landmarks';
import { addNeighborhoodDetails } from './render/neighborhood-architecture';
import { updateFoliage } from './render/foliage';
import { createGroundCover } from './render/ground-cover';
import { addRooftopDetails } from './render/rooftops';
import { createStreetLife } from './render/street-life';
import { createInterface } from './ui/interface';
import { closestRoad, pointInside } from './simulation/roads';
import { createTraffic } from './simulation/traffic';
import { createTransit, type TransitData } from './simulation/transit';
import { meshBuildingIds } from './simulation/building-collisions';
import { reserveTransitCorridors } from './simulation/transit-corridors';
import { DriveAudio } from './simulation/audio';
import type { CameraMode, CityData, DriveInput, LightingMode, TravelMode } from './types';

async function boot(){
  const response=await fetch(`${import.meta.env.BASE_URL}data/city.json`);if(!response.ok)throw new Error('The neighborhood data could not be loaded. Please reload.');
  const city:CityData=await response.json();
  let cameraMode:CameraMode='chase',lighting:LightingMode='golden';
  let travelMode:TravelMode='drive';
  let flight:ReturnType<typeof createHelicopterFlight>|undefined;
  let quality:QualityMode=matchMedia('(pointer: coarse)').matches?'balanced':'high';
  let graphics:ReturnType<typeof createGraphics>|undefined;
  let physics:DrivingPhysics|undefined;let world:Awaited<ReturnType<typeof createWorld>>|undefined;let traffic:ReturnType<typeof createTraffic>|undefined;
  let transit:ReturnType<typeof createTransit>|undefined;
  let populateNeighborhood=()=>{};
  const keys=new Set<string>(),audio=new DriveAudio();let cameraSnap=true,lookOffset=0,orbitPitch=.3,zoom=1;
  const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.15,2200);
  const scene=new THREE.Scene();
  const ui=createInterface(city,{
    onReset(){if(travelMode==='helicopter')flight?.reset();else physics?.reset(city.spawn.x,city.spawn.z,city.spawn.yaw);populateNeighborhood();cameraSnap=true;lookOffset=0;},
    onCamera(mode){cameraMode=mode;cameraSnap=true;lookOffset=0;},
    onTravelMode(mode){
      if(!flight||!physics||mode===travelMode)return;
      if(mode==='helicopter'){const car=physics.getState();flight.reset({x:car.x,y:Math.max(20,car.y+18),z:car.z},car.yaw);}
      travelMode=mode;keys.clear();audio.setMode(mode);cameraMode='chase';ui.setCamera(cameraMode);cameraSnap=true;lookOffset=0;orbitPitch=.3;zoom=1;
    },
    onLighting(mode){lighting=mode;world?.setLighting(mode);traffic?.setNight(mode==='night');transit?.setNight(mode==='night');},
    onPause(){keys.clear();},
    onStart(){audio.start();},
    onSound(enabled){audio.enabled=enabled;},
    onQuality(mode){quality=mode;graphics?.setQuality(mode);world?.setQuality(mode==='high');},
    onDestination(id){
      const landmark=city.landmarks.find(l=>l.id===id);if(!landmark||!physics)return;
      if(travelMode==='drive'&&landmark.driveStart){physics.reset(landmark.driveStart.x,landmark.driveStart.z,landmark.driveStart.yaw,landmark.driveStart.roadId);populateNeighborhood();cameraSnap=true;lookOffset=0;return;}
      const arrival:Record<string,[number,number]>={library:[-195,57],trinity:[-155,52]};
      const road=closestRoad(city,...(arrival[id]??landmark.position),true);
      const rightX=-Math.cos(road.yaw),rightZ=Math.sin(road.yaw);
      let x=road.x+rightX*1.7,z=road.z+rightZ*1.7;
      if(city.buildings.some(b=>pointInside([x,z],b.footprint))){x=road.x;z=road.z;}
      if(travelMode==='helicopter')flight?.reset({x,y:sampleElevation(city,x,z)+Math.max(45,flight.state.y-sampleElevation(city,flight.state.x,flight.state.z)),z},road.yaw);else physics.reset(x,z,road.yaw,road.road.elevations?road.road.id:undefined);
      populateNeighborhood();
      cameraSnap=true;lookOffset=0;
    },
  });
  ui.setQuality(quality);
  ui.setLoading('Preparing the streets',.06);
  // Paint the welcome screen before the one-time roadbed preparation. Complete
  // grading before either world rendering or physics caches the ground mesh.
  await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  const roadGrading=prepareRoadTerrain(city);
  ui.setLoading('Preparing the neighborhood',.12);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.info.autoReset=false;
  const container=document.querySelector('#scene')!;container.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D driving view');
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();ui.setError('The graphics connection was interrupted. Reload to continue your drive.');});
  try{
    const transitResponse=await fetch(`${import.meta.env.BASE_URL}data/transit.json`);if(!transitResponse.ok)throw new Error('Transit data could not be loaded. Please reload.');
    const transitData:TransitData=await transitResponse.json();reserveTransitCorridors(city,transitData.routes);
    const results=await Promise.all([DrivingPhysics.create(city,{meshBuildingIds}),createWorld(renderer,scene,city)]);physics=results[0];world=results[1];
    for(const mesh of world.buildingCollisions)physics.addStaticMesh(mesh.vertices,mesh.indices);
    // Populate Rapier's query structures before aircraft spawn/clearance checks.
    physics.world.step();
    ui.setLoading('Opening the streets',.82);addLandmarkDetails(scene,city);const cityLandmarks=addCityLandmarkDetails(scene,city);const streetscape=addStreetscape(scene,city);const facadeDetails=addFacadeDetails(scene,city);const neighborhoodDetails=addNeighborhoodDetails(scene,city);const park=addParkDetails(scene,city);const cityParks=addCityParkDetails(scene,city);const groundCover=createGroundCover(scene,city);const rooftops=addRooftopDetails(scene,city);
    const car=createCar();scene.add(car.group);traffic=createTraffic(scene,city,physics);
    transit=createTransit(scene,city,physics,transitData);
    flight=createHelicopterFlight(city,physics);const helicopter=createHelicopter();scene.add(helicopter.group);helicopter.group.visible=false;
    const streetLife=createStreetLife(scene,city,physics);
    graphics=createGraphics(renderer,scene,camera,quality);world.setQuality(quality==='high');
    // Saved locations are restored only when still near a drivable road and outside a building.
    try{const saved=JSON.parse(localStorage.getItem('backbay-drive-v1')??'null');if(saved&&[saved.x,saved.z,saved.yaw].every(Number.isFinite)&&saved.x>city.bounds.minX+10&&saved.x<city.bounds.maxX-10&&saved.z>city.bounds.minZ+10&&saved.z<city.bounds.maxZ-10&&closestRoad(city,saved.x,saved.z).distance<10&&!city.buildings.some(b=>!meshBuildingIds.has(b.id)&&pointInside([saved.x,saved.z],b.footprint)))physics.reset(saved.x,saved.z,saved.yaw,typeof saved.roadId==='string'?saved.roadId:undefined);}catch{/* Storage is optional. */}
    populateNeighborhood=()=>{
      const player=physics!.getState(),observer=travelMode==='helicopter'?flight!.state:player;
      traffic!.populateAt(observer,player,transit!.obstacles());streetLife.populateAt(observer,player);
    };
    populateNeighborhood();
    const save=()=>{if(!physics)return;const s=physics.getState();try{localStorage.setItem('backbay-drive-v1',JSON.stringify({x:s.x,z:s.z,yaw:s.yaw,roadId:sampleDriveSurface(city,s.x,s.z,s.y).road?.id}));}catch{/* Optional. */}};
    window.addEventListener('pagehide',save);
    window.addEventListener('keydown',event=>{
      if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement)return;
      if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyF'].includes(event.code)){
        event.preventDefault();if(ui.isPaused())return;keys.add(event.code);if(event.code==='KeyF'&&!event.repeat&&travelMode==='drive')audio.horn();
      }
    });
    window.addEventListener('keyup',event=>keys.delete(event.code));window.addEventListener('blur',()=>keys.clear());
    document.addEventListener('visibilitychange',()=>{keys.clear();if(document.hidden)save();});
    let dragging=false,lastX=0,lastY=0;
    renderer.domElement.addEventListener('pointerdown',event=>{if(ui.isPaused())return;dragging=true;lastX=event.clientX;lastY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);});
    renderer.domElement.addEventListener('pointermove',event=>{if(dragging&&!ui.isPaused()){lookOffset-=(event.clientX-lastX)*.005;if(travelMode==='helicopter')orbitPitch=THREE.MathUtils.clamp(orbitPitch+(event.clientY-lastY)*.005,-.15,1.4);lastX=event.clientX;lastY=event.clientY;}});
    renderer.domElement.addEventListener('pointerup',()=>dragging=false);renderer.domElement.addEventListener('pointercancel',()=>dragging=false);
    renderer.domElement.addEventListener('wheel',event=>{if(!ui.isPaused()){event.preventDefault();zoom=THREE.MathUtils.clamp(zoom+event.deltaY*.001,.65,2);}}, {passive:false});
    function input():DriveInput{
      const touch=ui.getTouchInput();let throttle=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)+touch.throttle;
      let steer=(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')?1:0)+touch.steer;
      let brake=touch.brake,handbrake=keys.has('Space')||touch.handbrake;
      const pad=navigator.getGamepads?.()[0];if(pad){if(Math.abs(pad.axes[0])>.13)steer=-pad.axes[0];throttle+=pad.buttons[7]?.value??0;brake=Math.max(brake,pad.buttons[6]?.value??0);if(pad.buttons[0]?.pressed)handbrake=true;if(pad.buttons[1]?.pressed)throttle=-1;}
      return {throttle:THREE.MathUtils.clamp(throttle,-1,1),steer:THREE.MathUtils.clamp(steer,-1,1),brake,handbrake};
    }
    function flightInput():FlightInput{
      const touch=ui.getFlightTouchInput();
      let forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))+touch.forward;
      let strafe=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+touch.strafe;
      let turn=Number(keys.has('KeyE'))-Number(keys.has('KeyQ'))+touch.yaw;
      let lift=Number(keys.has('Space'))-Number(keys.has('ShiftLeft')||keys.has('ShiftRight'))+touch.lift;
      const pad=navigator.getGamepads?.()[0];if(pad){const dead=(n:number)=>Math.abs(n)>.13?n:0;strafe+=dead(pad.axes[0]??0);forward-=dead(pad.axes[1]??0);turn+=dead(pad.axes[2]??0);lift+=(pad.buttons[7]?.value??0)-(pad.buttons[6]?.value??0);}
      const clamp=(n:number)=>THREE.MathUtils.clamp(n,-1,1);
      return{forward:clamp(forward),strafe:clamp(strafe),turn:clamp(turn),lift:clamp(lift)};
    }
    const target=new THREE.Vector3(),desired=new THREE.Vector3(),look=new THREE.Vector3(),cameraDirection=new THREE.Vector3();
    const cameraRay=new Ray(target,cameraDirection);
    let previous=performance.now(),accumulator=0,elapsed=0,saveTimer=0,frameCount=0,fpsTimer=0,fps=0,distance=0,frameMs=0,averageFrameMs=0;
    const tick=(now:number)=>{
      const raw=(now-previous)/1000;previous=now;const dt=Math.min(.05,Math.max(0,raw));const paused=ui.isPaused()||document.hidden;
      const flying=travelMode==='helicopter';
      const controls=paused||flying?{throttle:0,brake:flying?1:0,steer:0,handbrake:flying}:input();
      const flightControls=paused||!flying?{forward:0,strafe:0,turn:0,lift:0}:flightInput();
      if(!paused){accumulator+=dt;while(accumulator>=1/60){const before=physics!.getState(),observer=flying?flight!.state:before;transit!.update(1/60,before,observer,traffic!.obstacles());traffic!.update(1/60,before,observer,transit!.obstacles());physics!.step(controls,1/60);if(flying)flight!.update(1/60,flightControls);elapsed+=1/60;accumulator-=1/60;distance+=Math.abs(flying?flight!.state.speed:before.speed)/60;}}else accumulator=0;
      const carState=physics!.getState();car.update(carState,lighting==='night',paused?0:dt);car.group.visible=flying||cameraMode!=='hood';
      helicopter.update(flight!.state,paused?0:dt,flying);helicopter.group.visible=flying&&cameraMode!=='hood';
      const state=flying?{...flight!.state,steering:0}:carState;
      const yaw=state.yaw+lookOffset;target.set(state.x,state.y+.5,state.z);
      if(cameraMode==='hood'){
        desired.set(state.x+Math.sin(yaw)*.5,state.y+.9,state.z+Math.cos(yaw)*.5);look.set(state.x+Math.sin(yaw)*40,state.y+(flying?-7-(orbitPitch-.3)*35:.7),state.z+Math.cos(yaw)*40);camera.fov=65;
      }else if(cameraMode==='aerial'){
        desired.set(state.x,state.y+(flying?65:150)*zoom,state.z+(flying?.01:20*zoom));look.copy(target);camera.fov=52;
        cameraDirection.subVectors(desired,target);const aerialDistance=cameraDirection.length();cameraDirection.normalize();
        if(physics!.world.castRay(cameraRay,aerialDistance,true,undefined,undefined,physics!.chassisCollider,physics!.body,collider=>collider.parent()===null))desired.set(state.x,state.y+150*zoom,state.z+.01);
      }else if(flying){
        const follow=(19+Math.min(8,Math.abs(state.speed)*.2))*zoom;
        desired.set(state.x-Math.sin(yaw)*Math.cos(orbitPitch)*follow,state.y+Math.sin(orbitPitch)*follow+2,state.z-Math.cos(yaw)*Math.cos(orbitPitch)*follow);
        look.set(state.x+Math.sin(state.yaw)*3,state.y+.3,state.z+Math.cos(state.yaw)*3);camera.fov=58;
      }else{
        const follow=(7.8+Math.min(5,Math.abs(state.speed)*.16))*zoom;
        desired.set(state.x-Math.sin(yaw)*follow,state.y+2.8*zoom,state.z-Math.cos(yaw)*follow);look.set(state.x+Math.sin(state.yaw)*9,state.y+1.5,state.z+Math.cos(state.yaw)*9);camera.fov=55+Math.min(5,Math.abs(state.speed)*.13);
      }
      camera.position.lerp(desired,cameraSnap?1:1-Math.exp(-7*dt));
      // Pull the chase camera forward when a façade blocks its view. Query the
      // static collision world so orbiting alongside buildings stays readable.
      if(cameraMode==='chase'){
        cameraDirection.subVectors(camera.position,target);const cameraDistance=cameraDirection.length();cameraDirection.normalize();
        const obstruction=physics!.world.castRay(cameraRay,cameraDistance,true,undefined,undefined,physics!.chassisCollider,physics!.body,collider=>collider.parent()===null);
        if(obstruction)camera.position.copy(target).addScaledVector(cameraDirection,Math.max(.6,obstruction.timeOfImpact-.4));
      }
      // A meter-scale near plane preserves ground-layer depth precision from
      // above; the close driving view retains its dashboard-friendly near plane.
      camera.near=flying?1:.15;camera.lookAt(look);camera.updateProjectionMatrix();cameraSnap=false;
      world!.update(target,elapsed);park.update(elapsed);streetLife.update(paused?0:dt,elapsed,state,carState);updateFoliage(scene,target,elapsed,quality==='high');groundCover.update(target,elapsed,quality==='high');
      audio.update(state.speed,flying?flightControls.forward:controls.throttle,paused,{...controls,gear:carState.gear,rpm:carState.rpm,lift:flightControls.lift,verticalSpeed:flying?flight!.state.verticalSpeed:0});
      renderer.info.reset();world!.updateReflections(target,elapsed,flying?helicopter.group:car.group);graphics!.render(dt);frameCount++;fpsTimer+=raw;frameMs=raw*1000;if(fpsTimer>=.5){fps=Math.round(frameCount/fpsTimer);averageFrameMs=fpsTimer/frameCount*1000;frameCount=0;fpsTimer=0;}
      ui.update(state,{fps,distance,travelMode,quality,groundHeight:sampleElevation(city,state.x,state.z),performance:{fps,frameMs:averageFrameMs,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,traffic:traffic!.count,transit:transit!.count,pedestrians:streetLife.count},gear:carState.gear,rpm:carState.rpm,altitude:flying?state.y-sampleElevation(city,state.x,state.z):0,verticalSpeed:flying?flight!.state.verticalSpeed:0});saveTimer+=dt;if(saveTimer>5){saveTimer=0;save();}
      requestAnimationFrame(tick);
    };
    window.addEventListener('resize',()=>{graphics!.resize();camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
    const population=()=>{
      const observer=travelMode==='helicopter'?flight!.state:physics!.getState();
      return {traffic:traffic!.population(observer),pedestrians:streetLife.population(observer)};
    };
    const diagnostic={get ready(){return true;},snapshot:()=>({state:physics!.getState(),flight:flight!.state,terrain:terrainRange(city),groundHeight:sampleElevation(city,physics!.getState().x,physics!.getState().z),roadGrading,flightGroundHeight:sampleElevation(city,flight!.state.x,flight!.state.z),travelMode,paused:ui.isPaused(),camera:cameraMode,lighting,quality,fps,frameMs,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,buildings:city.buildings.length,roads:city.roads.length,landmarks:city.landmarks.length,neighborhoods:city.neighborhoods?.length??0,storefronts:streetscape.userData.storefrontCount,facades:facadeDetails.userData,rooftops:rooftops.userData,park:park.group.userData,cityParks:cityParks.userData,cityLandmarks:cityLandmarks.userData,neighborhoodArchitecture:neighborhoodDetails.userData,groundCover:groundCover.group.userData,signalCount:world!.signals.length,bridges:world!.roadStructures.userData,transit:transit!.snapshot(),transitCount:transit!.count,trafficCount:traffic!.count,traffic:traffic!.snapshot(),population:population(),exactBuildingColliders:world!.buildingCollisions.length,pedestrians:streetLife.count,pedestrianRelocations:streetLife.relocations,parkedCars:streetLife.parkedCount,audio:audio.getStatus(),distance}),city};
    Object.assign(window,{__backbay:diagnostic});
    ui.setReady();requestAnimationFrame(tick);
  }catch(error){console.error(error);ui.setError(error instanceof Error?error.message:'Unable to prepare the drive. Reload to try again.');}
}
boot().catch(error=>{console.error(error);const host=document.querySelector('#interface');if(host)host.textContent='Unable to load Boston. Check your connection and reload.';});
