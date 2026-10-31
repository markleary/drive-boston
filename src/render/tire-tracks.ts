import * as THREE from 'three';
import type {CityData} from '../types';
import {sampleDriveSurface} from '../simulation/road-surfaces.ts';
import {TRACK_LIFETIME,type TireContact,type TireSurface} from '../simulation/tire-tracks.ts';

export const TRACK_CAPACITY=4096;
type Trail={contact:TireContact;surface:TireSurface;distance:number;across?:THREE.Vector3};

/** One bounded dynamic mesh for every tire. No per-mark objects or textures;
 * shader time fades old rubber and ragged soil back into the ground. */
export function createTireTracks(scene:THREE.Scene,city:CityData,surfaceAt:(x:number,y:number,z:number)=>TireSurface|null,capacity=TRACK_CAPACITY){
  const geometry=new THREE.BufferGeometry(),positions=new Float32Array(capacity*12),uvs=new Float32Array(capacity*8),data=new Float32Array(capacity*12),indices=new Uint16Array(capacity*6);
  for(let i=0;i<capacity;i++){const v=i*4;indices.set([v,v+2,v+1,v+1,v+2,v+3],i*6);}
  const position=new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage),uv=new THREE.BufferAttribute(uvs,2).setUsage(THREE.DynamicDrawUsage),track=new THREE.BufferAttribute(data,3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position',position);geometry.setAttribute('uv',uv);geometry.setAttribute('track',track);geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.setDrawRange(0,0);
  const clock={value:0},material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,side:THREE.DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.uniforms.trackTime=clock;
    shader.vertexShader='attribute vec3 track; varying vec3 vTrack; varying vec2 trackUv;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTrack=track; trackUv=uv;');
    shader.fragmentShader='uniform float trackTime; varying vec3 vTrack; varying vec2 trackUv;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float grass=vTrack.z;
      float life=mix(${TRACK_LIFETIME.pavement.toFixed(1)},${TRACK_LIFETIME.grass.toFixed(1)},grass);
      float fade=1.-smoothstep(life*.55,life,trackTime-vTrack.x);
      float grain=fract(sin(dot(floor(trackUv*vec2(37.,95.)),vec2(12.9898,78.233)))*43758.5453);
      float edge=abs(trackUv.x-.5)*2.;
      float border=1.-smoothstep(mix(.72,.48,grass),1.-grain*grass*.24,edge);
      float grooves=.72+.28*smoothstep(.12,.3,abs(sin(trackUv.x*38.)));
      float tread=mix(grooves,.5+.5*step(.32,fract(trackUv.y*12.+step(.5,trackUv.x)*.5)),grass);
      diffuseColor.rgb=mix(vec3(.045,.043,.04),mix(vec3(.075,.042,.018),vec3(.19,.17,.052),grain),grass);
      diffuseColor.a*=vTrack.y*fade*border*tread*mix(.64,.88,grass);
      if(diffuseColor.a<.008)discard;`);
  };
  material.customProgramCacheKey=()=>'temporary-tire-tracks-1';
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Temporary tire tracks';mesh.frustumCulled=false;mesh.renderOrder=3;mesh.userData.noAO=true;scene.add(mesh);
  const trails=new Map<number,Trail>(),births=new Float64Array(capacity),surfaces:(TireSurface|undefined)[]=new Array(capacity);
  let cursor=0,count=0,revision=-1,totalPavement=0,totalGrass=0;
  function update(contacts:TireContact[],time:number,poseRevision:number){
    clock.value=time;
    if(revision!==poseRevision){trails.clear();revision=poseRevision;}
    const active=new Set<number>();
    for(const contact of contacts){
      if(contact.intensity<.03){trails.delete(contact.wheel);continue;}
      const surface=surfaceAt(contact.x,contact.y,contact.z);if(!surface){trails.delete(contact.wheel);continue;}
      active.add(contact.wheel);
      const previous=trails.get(contact.wheel),dx=previous?contact.x-previous.contact.x:0,dz=previous?contact.z-previous.contact.z:0,length=Math.hypot(dx,dz);
      if(!previous||previous.surface!==surface||length>2||Math.abs(contact.y-previous.contact.y)>.7){trails.set(contact.wheel,{contact,surface,distance:0});continue;}
      if(length<.09)continue;
      const across=new THREE.Vector3(dz,0,-dx).normalize().multiplyScalar(contact.width*(surface==='grass'?.78:.5));
      const startAcross=previous.across??across;
      const ends=[previous.contact,contact],widths=[startAcross,across],distance=previous.distance+length,slot=cursor;
      for(let end=0;end<2;end++)for(let side=0;side<2;side++){
        const p=ends[end],a=widths[end],sign=side===0?-1:1,x=p.x+a.x*sign,z=p.z+a.z*sign;
        const height=sampleDriveSurface(city,x,z,p.y+.15).height;
        const vertex=slot*4+end*2+side;
        positions.set([x,height+.082,z],vertex*3);uvs.set([side,end===0?previous.distance:distance],vertex*2);data.set([time,Math.min(contact.intensity,previous.contact.intensity),surface==='grass'?1:0],vertex*3);
      }
      position.addUpdateRange(slot*12,12);uv.addUpdateRange(slot*8,8);track.addUpdateRange(slot*12,12);
      position.needsUpdate=true;uv.needsUpdate=true;track.needsUpdate=true;
      births[slot]=time;surfaces[slot]=surface;if(surface==='grass')totalGrass++;else totalPavement++;
      cursor=(cursor+1)%capacity;count=Math.min(capacity,count+1);geometry.setDrawRange(0,count*6);
      trails.set(contact.wheel,{contact,surface,distance,across});
    }
    for(const wheel of trails.keys())if(!active.has(wheel))trails.delete(wheel);
  }
  function stats(){let pavement=0,grass=0;for(let i=0;i<count;i++){const surface=surfaces[i];if(surface&&clock.value-births[i]<TRACK_LIFETIME[surface]){if(surface==='grass')grass++;else pavement++;}}return{pavement,grass,totalPavement,totalGrass,capacity};}
  return{mesh,update,stats,dispose(){scene.remove(mesh);geometry.dispose();material.dispose();trails.clear();}};
}
