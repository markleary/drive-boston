import * as THREE from 'three';
import {registerContextTexture} from './context-resources.ts';

// Cover the local fleet and most of the fog range around the observer.
const CELL_SIZE=24, GRID_SIZE=80, SLOTS=16;
const BEAM_LENGTH=36, BEAM_SPREAD=.115, BEAM_EDGE=.8, BEAM_HEIGHT=1.4;
const headlightShaders=new WeakMap<THREE.Material,(material:THREE.Material)=>void>();

/** Keep the same lighting on alternate finishes and polygon-offset deck materials. */
export function inheritRoadHeadlights(source:THREE.Material|undefined,target:THREE.Material){
  if(source)headlightShaders.get(source)?.(target);
}

/** Project the fleet's low beams onto the visible pavement. Each fragment
 * checks only beams crossing its cell, with no extra scene lights or draws. */
export function createRoadHeadlights(capacity:number){
  const cells=new Uint8Array(GRID_SIZE*GRID_SIZE*SLOTS);
  const counts=new Uint8Array(GRID_SIZE*GRID_SIZE);
  const poses=new Float32Array(capacity*3*4);
  // Cell texels pack four one-based fleet indices. Zero ends the list.
  const cellTexture=new THREE.DataTexture(cells,GRID_SIZE*SLOTS/4,GRID_SIZE);
  const poseTexture=new THREE.DataTexture(poses,3,capacity,THREE.RGBAFormat,THREE.FloatType);
  const origin=new THREE.Vector2();
  const enabled={value:false};
  const upload=()=>{cellTexture.needsUpdate=true;poseTexture.needsUpdate=true;};
  upload();

  function apply(material:THREE.Material){
    headlightShaders.set(material,apply);
    registerContextTexture(material,cellTexture);
    registerContextTexture(material,poseTexture);
    material.onBeforeCompile=shader=>{
      shader.uniforms.roadHeadlightsEnabled=enabled;
      shader.uniforms.roadHeadlightCells={value:cellTexture};
      shader.uniforms.roadHeadlightPoses={value:poseTexture};
      shader.uniforms.roadHeadlightOrigin={value:origin};
      shader.vertexShader='varying vec3 vHeadlightRoadPosition;\n'+shader.vertexShader.replace('#include <project_vertex>',`
        #include <project_vertex>
        vec4 roadPosition=vec4(transformed,1.0);
        #ifdef USE_BATCHING
          roadPosition=batchingMatrix*roadPosition;
        #endif
        #ifdef USE_INSTANCING
          roadPosition=instanceMatrix*roadPosition;
        #endif
        vHeadlightRoadPosition=(modelMatrix*roadPosition).xyz;
      `);
      shader.fragmentShader=`
        varying vec3 vHeadlightRoadPosition;
        uniform bool roadHeadlightsEnabled;
        uniform sampler2D roadHeadlightCells;
        uniform highp sampler2D roadHeadlightPoses;
        uniform vec2 roadHeadlightOrigin;

        float roadHeadlightIrradiance(vec3 position) {
          ivec2 cell=ivec2(floor(position.xz/${CELL_SIZE}.0-roadHeadlightOrigin));
          if(any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,ivec2(${GRID_SIZE})))) return 0.0;
          float light=0.0;
          ivec4 ids;
          for(int slot=0;slot<${SLOTS};slot++){
            if(slot%4==0) ids=ivec4(texelFetch(roadHeadlightCells,ivec2(cell.x*${SLOTS/4}+slot/4,cell.y),0)*255.0+0.5);
            int id=ids[slot%4]-1;
            if(id<0) break;
            vec4 nose=texelFetch(roadHeadlightPoses,ivec2(0,id),0);
            vec3 forward=texelFetch(roadHeadlightPoses,ivec2(1,id),0).xyz;
            vec3 right=texelFetch(roadHeadlightPoses,ivec2(2,id),0).xyz;
            vec3 delta=position-nose.xyz;
            float along=dot(delta,forward);
            if(along<=0.0||along>=${BEAM_LENGTH}.0) continue;
            // The footprint follows the car's road plane. A stacked road
            // or tunnel ceiling must not pick up the beam through the deck.
            float height=abs(dot(delta,cross(forward,right)));
            if(height>=${BEAM_HEIGHT}) continue;
            float across=abs(abs(dot(delta,right))-nose.w);
            float edge=${BEAM_EDGE}+along*${BEAM_SPREAD};
            float beam=1.0-smoothstep(edge*0.25,edge,across);
            float falloff=smoothstep(0.0,4.0,along)*(1.0-smoothstep(8.0,${BEAM_LENGTH}.0,along));
            light+=beam*falloff*(1.0-smoothstep(0.35,${BEAM_HEIGHT},height));
          }
          return light;
        }
      `+shader.fragmentShader.replace('#include <opaque_fragment>',`
        if(roadHeadlightsEnabled){
          float headlight=roadHeadlightIrradiance(vHeadlightRoadPosition);
          outgoingLight+=diffuseColor.rgb*vec3(2.5,2.32,2.02)*headlight;
        }
        #include <opaque_fragment>
      `);
    };
  }

  return {
    apply,
    setNight(night:boolean){
      // Publish the last simulation step even when the settings menu is paused.
      if(night&&!enabled.value)upload();
      enabled.value=night;
    },
    beginFrame(x:number,z:number){
      origin.set(Math.floor(x/CELL_SIZE)-GRID_SIZE/2,Math.floor(z/CELL_SIZE)-GRID_SIZE/2);
      counts.fill(0);
      cells.fill(0);
    },
    add(index:number,matrix:THREE.Matrix4,halfLength:number,width:number){
      const [rx,ry,rz,,ux,uy,uz,,fx,fy,fz,,x,y,z]=matrix.elements;
      if(uy<.7)return; // overturned cars aren't aimed at the pavement
      const noseX=x+fx*halfLength,noseZ=z+fz*halfLength,spacing=width*.35;
      poses.set([noseX,y+fy*halfLength,noseZ,spacing,fx,fy,fz,0,rx,ry,rz,0],index*12);

      const nearWidth=spacing+BEAM_EDGE,farWidth=nearWidth+BEAM_LENGTH*BEAM_SPREAD;
      const tipX=noseX+fx*BEAM_LENGTH,tipZ=noseZ+fz*BEAM_LENGTH;
      const paddingX=Math.abs(ux)*BEAM_HEIGHT,paddingZ=Math.abs(uz)*BEAM_HEIGHT;
      const nearX=Math.abs(rx)*nearWidth+paddingX,nearZ=Math.abs(rz)*nearWidth+paddingZ;
      const farX=Math.abs(rx)*farWidth+paddingX,farZ=Math.abs(rz)*farWidth+paddingZ;
      const left=Math.max(0,Math.floor(Math.min(noseX-nearX,tipX-farX)/CELL_SIZE)-origin.x);
      const right=Math.min(GRID_SIZE-1,Math.floor(Math.max(noseX+nearX,tipX+farX)/CELL_SIZE)-origin.x);
      const top=Math.max(0,Math.floor(Math.min(noseZ-nearZ,tipZ-farZ)/CELL_SIZE)-origin.y);
      const bottom=Math.min(GRID_SIZE-1,Math.floor(Math.max(noseZ+nearZ,tipZ+farZ)/CELL_SIZE)-origin.y);
      for(let row=top;row<=bottom;row++)for(let col=left;col<=right;col++){
        const cell=row*GRID_SIZE+col,slot=counts[cell];
        if(slot===SLOTS)continue;
        cells[cell*SLOTS+slot]=index+1;
        counts[cell]++;
      }
    },
    endFrame(){if(enabled.value)upload();},
  };
}

export type RoadHeadlights=ReturnType<typeof createRoadHeadlights>;
