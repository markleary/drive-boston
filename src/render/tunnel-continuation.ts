import * as THREE from 'three';
import type {Road} from '../types';
import {deckEdgeElevation} from '../simulation/road-surfaces.ts';
import {tunnelPointAt,tunnelStations} from '../simulation/tunnels.ts';
import {tiledTunnelCeiling} from './tunnel-ceiling.ts';

export const TUNNEL_CONTINUATION_LENGTH=90;
export const TUNNEL_DARKNESS_DISTANCE=60;
type Vertex=[number,number,number];

/** A closed scenery passage beyond the physical stop. The real caps remain
 * in Rapier, while this shell provides depth and a gradual loss of visibility. */
export function tunnelContinuation(road:Road,atStart:boolean,materials:{walls:THREE.MeshStandardMaterial;ceiling:THREE.MeshStandardMaterial;asphalt:THREE.MeshStandardMaterial}){
  const length=tunnelStations(road).at(-1)!,station=atStart?0:length,p=tunnelPointAt(road,station),yaw=p.yaw+(atStart?Math.PI:0),clearance=road.tunnel!.clearance;
  const direction=new THREE.Vector2(Math.sin(yaw),Math.cos(yaw)),origin=new THREE.Vector2(p.x,p.z),across=new THREE.Vector2(Math.cos(yaw),-Math.sin(yaw));
  const index=atStart?0:road.points.length-1,leftY=deckEdgeElevation(road,index,atStart?-1:1),rightY=deckEdgeElevation(road,index,atStart?1:-1);
  const point=(x:number,y:number,d:number):Vertex=>[p.x+across.x*x+direction.x*d,y,p.z+across.y*x+direction.y*d];
  const end=point(0,p.y,TUNNEL_CONTINUATION_LENGTH),extension:Road={...road,points:[[p.x,p.z],[end[0],end[2]]],elevations:[p.y,p.y],deckWidths:undefined,deckTangents:undefined,deckEdgeElevations:[[rightY,leftY],[rightY,leftY]],tunnel:{clearance}};
  const group=new THREE.Group();group.name=`${road.name} unlit continuation`;
  group.userData={terminalRoadId:road.id,atStart,length:TUNNEL_CONTINUATION_LENGTH,darknessDistance:TUNNEL_DARKNESS_DISTANCE,visualOnly:true};
  const dim=(source:THREE.MeshStandardMaterial)=>{
    const material=source.clone();material.fog=false;
    // Local optical depth, independent of the daylight/surface fog. Apply it
    // after tone mapping so distant concrete cannot brighten into a gray wall.
    material.onBeforeCompile=shader=>{
      shader.uniforms.terminalOrigin={value:origin};shader.uniforms.terminalDirection={value:direction};
      shader.vertexShader='uniform vec2 terminalOrigin; uniform vec2 terminalDirection; varying float terminalDepth;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nterminalDepth=max(0.0,dot(position.xz-terminalOrigin,terminalDirection));');
      shader.fragmentShader='varying float terminalDepth;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>\nfloat darkness=1.0-smoothstep(0.0,${TUNNEL_DARKNESS_DISTANCE.toFixed(1)},terminalDepth);\ngl_FragColor.rgb*=darkness*darkness;`);
    };
    material.customProgramCacheKey=()=>`tunnel-terminal-darkness-v1-${TUNNEL_DARKNESS_DISTANCE}`;
    return material;
  };
  const build=(name:string,material:THREE.Material,quads:{points:Vertex[];uv:number[]}[],roof=false)=>{
    const vertices:number[]=[],indices:number[]=[],uv:number[]=[];
    for(const quad of quads){const i=vertices.length/3;for(const v of quad.points)vertices.push(...v);uv.push(...quad.uv);indices.push(i,i+1,i+2,i,i+2,i+3);}
    const data={vertices:new Float32Array(vertices),indices:new Uint32Array(indices)},geometry=roof?tiledTunnelCeiling(data,extension):new THREE.BufferGeometry();
    if(!roof){geometry.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();geometry.computeBoundingSphere();}
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=false;group.add(mesh);
  };
  const w=p.width/2,d=TUNNEL_CONTINUATION_LENGTH,wallQuads=[];
  // Subdivision is modest, but also keeps the depth cue correct for render
  // passes that use vertex attributes and for future local lighting changes.
  for(let a=0;a<d;a+=6){const b=Math.min(d,a+6);
    wallQuads.push({points:[point(-w,leftY,a),point(-w,leftY+clearance,a),point(-w,leftY+clearance,b),point(-w,leftY,b)],uv:[a/6,0,a/6,clearance/6,b/6,clearance/6,b/6,0]});
    wallQuads.push({points:[point(w,rightY,a),point(w,rightY,b),point(w,rightY+clearance,b),point(w,rightY+clearance,a)],uv:[a/6,0,b/6,0,b/6,clearance/6,a/6,clearance/6]});
  }
  build('Unlit tunnel walls',dim(materials.walls),wallQuads);
  build('Unlit tunnel roadway',dim(materials.asphalt),[{points:[point(-w,leftY,0),point(-w,leftY,d),point(w,rightY,d),point(w,rightY,0)],uv:[0,0,0,d/5,p.width/5,d/5,p.width/5,0]}]);
  build('Unlit tiled tunnel ceiling',dim(materials.ceiling),[{points:[point(-w,leftY+clearance,0),point(w,rightY+clearance,0),point(w,rightY+clearance,d),point(-w,leftY+clearance,d)],uv:[]}],true);
  build('Distant tunnel darkness',new THREE.MeshBasicMaterial({color:0,fog:false}),[{points:[point(-w,leftY,d),point(-w,leftY+clearance,d),point(w,rightY+clearance,d),point(w,rightY,d)],uv:[0,0,0,1,1,1,1,0]}]);
  return group;
}
