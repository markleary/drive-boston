import * as THREE from 'three';
import { seeded } from './materials.ts';
import { waterTime } from './water-material.ts';

const night = { value: 0 };
export function setFellsmereLighting(dark: boolean) { night.value = Number(dark); }

const uniforms = () => ({ ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), clock: waterTime, night });
let spray: THREE.ShaderMaterial, ripples: THREE.ShaderMaterial;

function sprayMaterial() {
  return spray ??= new THREE.ShaderMaterial({
    uniforms: uniforms(), fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      #include <fog_pars_vertex>
      uniform float clock;
      attribute vec4 stream; // landing x/z, crest height, release phase
      attribute vec3 droplet; // size, crosswind drift, opacity
      varying vec2 stamp;
      varying float opacity;
      varying float height;
      void main(){
        float t = fract(stream.w + clock / sqrt(0.816 * stream.z));
        height = 4.0 * stream.z * t * (1.0-t);
        vec2 drift = droplet.y * t*t * vec2(sin(stream.w*93.0), cos(stream.w*71.0));
        vec3 p = vec3(stream.x*t+drift.x, height, stream.y*t+drift.y);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float size = droplet.x * (0.58 + 1.05*t) + .15*smoothstep(70.0,320.0,-mvPosition.z);
        // Align the streak with its flight path as the fan breaks into spray.
        vec3 tangent=vec3(stream.x,4.0*stream.z*(1.0-2.0*t),stream.y);
        vec2 dir=normalize((mat3(modelViewMatrix)*tangent).xy+vec2(.0001));
        mvPosition.xy += vec2(dir.y,-dir.x)*position.x*size
          +dir*position.y*(size + .012*length(tangent));
        gl_Position = projectionMatrix * mvPosition;
        stamp = uv*2.0-1.0;
        opacity = droplet.z * mix(1.0,.17,smoothstep(.36,.82,t));
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float night;
      varying vec2 stamp;
      varying float opacity;
      varying float height;
      void main(){
        float alpha = max(0.0, 1.0 - dot(stamp,stamp));
        vec3 day = vec3(.77,.88,.94);
        vec3 lit = mix(vec3(3.3,1.95,.93),vec3(.78,.82,.88),smoothstep(.1,5.8,height));
        gl_FragColor = vec4(mix(day,lit,night), alpha*alpha*opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function rippleMaterial() {
  return ripples ??= new THREE.ShaderMaterial({
    uniforms: uniforms(), fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 surface;
      void main(){
        surface=position.xy;
        vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      varying vec2 surface;
      uniform float clock;
      uniform float night;
      void main(){
        float r=length(surface),angle=atan(surface.y,surface.x);
        float broken=sin(3.0*surface.x+clock)*sin(4.1*surface.y-clock*.7);
        float wave=.5+.5*sin(8.0*r+broken*1.4+sin(4.0*angle+r)-clock*3.8);
        float fringe=1.0-smoothstep(4.0,11.0,r);
        float foam=exp(-.38*r*r)+.18*exp(-.9*(r-8.8)*(r-8.8))*(.55+.45*cos(8.0*angle));
        float alpha=fringe*(.025+.095*wave*wave)+foam*.32;
        vec3 tint=mix(vec3(.68,.82,.86),mix(vec3(2.4,1.38,.62),vec3(.28,.37,.49),smoothstep(0.0,7.5,r)),night);
        gl_FragColor=vec4(tint,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** A narrow, aerated vertical column and eight lower fan jets. Continuous
 * ballistic paths are evaluated on the GPU from the same clock as the pond. */
export function pondFountain(x: number, level: number, z: number, seed: number, mobile = false) {
  const group = new THREE.Group(), random = seeded(seed);
  group.name = 'Fellsmere Pond fountain';
  group.position.set(x, level, z);
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(base.index);
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('uv', base.getAttribute('uv'));
  const streams: number[] = [], droplets: number[] = [];
  const count = mobile ? 2200 : 4200;
  for (let i = 0; i < count; i++) {
    const jet = i % 16, column = jet >= 8, mist = random(), spread = random();
    const angle = column ? random()*2*Math.PI : jet*Math.PI/4 + (random()-.5)*(.08+.65*mist**3);
    const reach = column ? .1 + 1.4*spread**2 : 8.8 + (spread-.5)*(1.5+3*mist);
    const crest = column ? 8.6 + (random()-.5)*3.4 : 3.25 + (random()-.5)*1.15;
    streams.push(Math.cos(angle)*reach, Math.sin(angle)*reach, crest, random());
    // A fine veil of mist softens the individual streams at their crests.
    const veil = mist>.78;
    const size = (veil ? .45+.5*spread : .09+.12*mist)*(mobile?1.35:1);
    droplets.push(size, .12+mist**2*(column?2.5:1.5), veil ? .095 : .23+.39*(1-mist));
  }
  geometry.instanceCount = count;
  geometry.setAttribute('stream', new THREE.InstancedBufferAttribute(new Float32Array(streams), 4));
  geometry.setAttribute('droplet', new THREE.InstancedBufferAttribute(new Float32Array(droplets), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,4,0),12);
  const jet = new THREE.Mesh(geometry, sprayMaterial());
  jet.userData.noAO = true; jet.renderOrder = 3;
  const rings = new THREE.Mesh(new THREE.PlaneGeometry(22,22), rippleMaterial());
  rings.rotation.x = -Math.PI/2; rings.position.y = .055;
  rings.userData.noAO = true; rings.renderOrder = 2;
  group.add(rings, jet);
  return group;
}
