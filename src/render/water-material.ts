import * as THREE from 'three';

// Shared by every streamed sheet: animation and world-space ripples continue
// across tile boundaries without per-tile textures or another render pass.
const waterTime={value:0};
export function updateWater(time:number){waterTime.value=time;}

const WATER_PARS=/* glsl */`
uniform float waterTime;
varying vec3 vWaterWorld;
`;
const WATER_NORMAL=/* glsl */`
{
  vec2 p=vWaterWorld.xz;
  // Different scales and drift speeds break the repeating tile into wind
  // ripples. Mipmaps filter distant waves instead of sparkling at the horizon.
  vec2 a=texture2D(normalMap,p/18.0+waterTime*vec2(-0.012,0.004)).xy*2.0-1.0;
  vec2 b=texture2D(normalMap,p/7.3+waterTime*vec2(-0.018,-0.009)).xy*2.0-1.0;
  mat2 rotate=mat2(0.8,-0.6,0.6,0.8);
  vec2 c=texture2D(normalMap,rotate*p/3.1+waterTime*vec2(0.013,0.021)).xy*2.0-1.0;
  vec2 slope=a*0.7+b*0.22+transpose(rotate)*c*0.08;
  // Shading moves, but the geometric surface/shoreline remain horizontal.
  normal=normalize(mat3(viewMatrix)*normalize(vec3(slope.x,1.0,slope.y)));
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  roughnessFactor=clamp(roughnessFactor+0.055*smoothstep(0.12,1.5,footprint),0.0,1.0);
}
`;

/** A seamless normal texture made from a small wind-wave spectrum. Phase
 * modulation breaks long straight crests; integer frequencies keep both axes
 * periodic. The same 256 KiB texture is shared by all water in the city. */
function rippleTexture(){
  const size=256,data=new Uint8Array(size*size*4),waves:{x:number;z:number;phase:number;warp:number;slope:number}[]=[];
  let seed=731;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  for(let i=0;i<28;i++){
    const frequency=3+random()*30,angle=(random()-.5)*1.7;
    waves.push({x:Math.max(1,Math.round(Math.cos(angle)*frequency)),z:Math.round(Math.sin(angle)*frequency),phase:random()*Math.PI*2,warp:random()*Math.PI*2,slope:.018+random()*.018});
  }
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const u=i/size*Math.PI*2,v=j/size*Math.PI*2;let dx=0,dz=0;
    for(const wave of waves){
      const bend=u-v+wave.warp,phase=wave.x*u+wave.z*v+wave.phase+1.3*Math.sin(bend);
      const amplitude=wave.slope/Math.hypot(wave.x,wave.z),c=Math.cos(phase)*amplitude,warp=1.3*Math.cos(bend);
      dx+=c*(wave.x+warp);dz+=c*(wave.z-warp);
    }
    const length=Math.hypot(dx,dz,1),o=(j*size+i)*4;
    data[o]=Math.round((-.5*dx/length+.5)*255);data[o+1]=Math.round((-.5*dz/length+.5)*255);data[o+2]=Math.round((.5/length+.5)*255);data[o+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.name='Wind ripple normals';
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}
let ripples:THREE.DataTexture|undefined;

/** Dielectric water uses Three's Fresnel reflection, sun glints, shadows and
 * the world's existing sky/local reflection probe (sky only on mobile). */
export function createWaterMaterial(){
  const material=new THREE.MeshPhysicalMaterial({color:'#26494a',roughness:.16,metalness:0,ior:1.333,normalMap:ripples??=rippleTexture()});
  material.name='Rippling water';
  material.onBeforeCompile=shader=>{
    shader.uniforms.waterTime=waterTime;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWaterWorld;')
      .replace('#include <project_vertex>','#include <project_vertex>\nvWaterWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+WATER_PARS)
      .replace('#include <normal_fragment_maps>',WATER_NORMAL)
      // scene.environment overrides material.envMapIntensity. Boost only the
      // water's reflected radiance, leaving the city's diffuse lighting alone.
      .replace('#include <lights_fragment_maps>','#include <lights_fragment_maps>\n#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )\nradiance *= 3.5;\n#endif');
  };
  material.customProgramCacheKey=()=>'boston-rippling-water-1';
  return material;
}
