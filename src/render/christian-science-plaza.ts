import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { CityArea, CityData, Point2 } from '../types';
import { pointInside } from '../simulation/roads.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { parkSurfaceSteps } from './area-surfaces.ts';
import type { ParkOptions } from './city-parks.ts';
import { createGrassMaterial } from './ground-cover.ts';
import { box, PartBatches } from './geometry-writer.ts';
import { brickPaving, paving } from './materials.ts';
import { applyWaterMotion } from './water-motion.ts';
import { createWaterMaterial, waterTime } from './water-material.ts';

// OSM way 117744713, projected to the city grid and squared on its long axis.
// The Boston hydro polygon it replaces includes parts of the plaza paving.
const [westX, westZ] = [-828.361, 693.310];
const angle = Math.atan2(136.524, -153.164);
const alongX = Math.sin(angle), alongZ = Math.cos(angle);
const width = 32.7, length = 205.2;
const waterY = -.045, copingTop = .12, copingWidth = .48;
const point = (u: number, v: number): Point2 => [westX - alongZ * u + alongX * v, westZ + alongX * u + alongZ * v];
const local = (x: number, z: number): Point2 => [-(x - westX) * alongZ + (z - westZ) * alongX, (x - westX) * alongX + (z - westZ) * alongZ];
const rect = (u0: number, v0: number, u1: number, v1: number) => [point(u0,v0), point(u1,v0), point(u1,v1), point(u0,v1)];
const center = point(width / 2, length / 2);
const apron = 1.55;
const apronOuter = rect(-apron,-apron,width+apron,length+apron);
const copingOuter = rect(-copingWidth,-copingWidth,width+copingWidth,length+copingWidth);
const westBand = rect(-7,-1.55,-6.1,length+1.55);
const eastBand = rect(width+6.1,-1.55,width+7,length+1.55);
const promenade = [point(-13,-5.5),point(43,-5.5),point(55,3),point(57,113),point(54,154),point(42,174),point(42,216),point(-15,216),point(-15,76)];
const plazaRings = [promenade, apronOuter, westBand, eastBand];

export function isChristianSciencePool(area: CityArea) {
  // The hydro union's numbered IDs can change on a data rebuild. Match the
  // pool geographically and allow for the source outline's oversized ends.
  const ring = area.rings[0];
  return ring?.length >= 3 && ring.every(([x,z]) => {
    const [u,v] = local(x,z);
    return u >= -12 && u <= width+24 && v >= -12 && v <= length+44;
  }) && pointInside(center,ring);
}

export function ownsChristianSciencePlaza(bounds: ParkOptions['bounds']) {
  return !bounds || (center[0] >= bounds.minX && center[0] < bounds.maxX && center[1] >= bounds.minZ && center[1] < bounds.maxZ);
}

export function christianScienceTrees(city: CityData) {
  // The formal avenue of lindens along Huntington leaves the inner walks open.
  return Array.from({ length: 14 }, (_, i) => {
    const [x,z] = point(51, 9 + i * 10.9);
    return new THREE.Vector3(x,sampleElevation(city,x,z)+.08,z);
  });
}

function plazaMaterials() {
  const brick = brickPaving();
  brick.color.set('#d9c6c1');
  const stone = paving();
  stone.map!.repeat.setScalar(1.75);
  const planterWall = new THREE.MeshStandardMaterial({ color: '#bcb4a3', roughness: .88 });
  const coping = new THREE.MeshStandardMaterial({ color: '#9b766a', roughness: .43 });
  const plants = createGrassMaterial('#8d9669');
  const water = createWaterMaterial(1.25);
  water.color.set('#32434f');
  water.roughness = .072;
  water.transparent = false;
  water.depthWrite = true;
  return { brick, stone, planterWall, coping, plants, water };
}
let materials: ReturnType<typeof plazaMaterials> | undefined;

function addReflection(group: THREE.Group, ripples: THREE.Texture, detailed?: () => boolean) {
  // A small planar pass preserves the alignment of the actual church and
  // skyline. The opaque water underneath also works without a reflection pass.
  const plane = new THREE.PlaneGeometry(width, length);
  const reflection = new Reflector(plane, {
    textureWidth: 768, textureHeight: 480, multisample: 0, clipBias: .001,
    shader: {
      uniforms: {
        color: { value: new THREE.Color() }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
        reflectionStrength: { value: 0 }, ripples: { value: null }, waterTime: { value: 0 },
      },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix;
        varying vec4 reflectionUV;
        varying vec3 worldPoint;
        void main() {
          reflectionUV = textureMatrix * vec4(position, 1.0);
          worldPoint = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D ripples;
        uniform float reflectionStrength;
        uniform float waterTime;
        varying vec4 reflectionUV;
        varying vec3 worldPoint;
        void main() {
          if (reflectionStrength <= 0.0) discard;
          vec2 uv = reflectionUV.xy / reflectionUV.w;
          vec2 wave = texture2D(ripples, worldPoint.xz / 9.0 + waterTime * vec2(0.0015, -0.0007)).xy - 0.5;
          vec3 reflected = texture2D(tDiffuse, uv + wave * 0.028).rgb;
          float facing = normalize(cameraPosition - worldPoint).y;
          float fresnel = pow(1.0 - clamp(facing, 0.0, 1.0), 4.0);
          gl_FragColor = vec4(reflected * vec3(0.67, 0.76, 0.83), reflectionStrength * mix(0.24, 0.87, fresnel));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    },
  });
  reflection.name = 'Christian Science Pool planar reflection';
  reflection.rotation.order = 'YXZ';
  reflection.rotation.set(-Math.PI/2, angle - Math.PI, 0);
  reflection.position.set(center[0],waterY+.004,center[1]);
  const material = reflection.material as THREE.ShaderMaterial;
  material.transparent = true;
  material.depthWrite = false;
  reflection.renderOrder = 1;
  reflection.userData.noAO = true;
  // Reflector clones the uniforms it receives. Share the original time and
  // texture so the plaza uses the same clock and ripple asset as the river.
  material.uniforms.waterTime = waterTime;
  material.uniforms.ripples.value = ripples;
  const strength = material.uniforms.reflectionStrength;
  const capture = reflection.onBeforeRender;
  reflection.onBeforeRender = (renderer, scene, camera, geometry, material, batch) => {
    // The scene's cube probe already captures an inexpensive water fallback.
    // The mirror pass is only useful in the nearby main view.
    const [u,v] = local(camera.position.x,camera.position.z);
    const distance = Math.hypot(u-width/2,(v-length/2)*.6,camera.position.y);
    strength.value = !camera.parent && camera.position.y > waterY && (detailed?.() ?? true)
      ? 1-THREE.MathUtils.smoothstep(distance,155,195) : 0;
    if (strength.value > 0) capture.call(reflection,renderer,scene,camera,geometry,material,batch);
  };
  plane.addEventListener('dispose', () => reflection.dispose());
  group.add(reflection);
}

export function* christianSciencePlazaSteps(city: CityData, target: THREE.Group, options: ParkOptions) {
  const { pace, onShore, mobile, detailed } = options;
  const { brick, stone, planterWall, coping, plants, water } = materials ??= plazaMaterials();
  const group = new THREE.Group();
  group.name = 'Christian Science Plaza';
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(geometry,material);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const solid = (geometry: THREE.BufferGeometry) => {
    const position = geometry.getAttribute('position');
    onShore?.(position.array as Float32Array, Uint32Array.from({ length: position.count }, (_, i) => i));
  };
  for (const [rings, material, name] of [
    [plazaRings, brick, 'Plaza brick promenade'],
    [[apronOuter,copingOuter], stone, 'Pool stone apron'],
    [[westBand], stone, 'Church-side stone band'],
    [[eastBand], stone, 'Huntington-side stone band'],
  ] as const) {
    const geometry = yield* parkSurfaceSteps(city,[...rings],{ offset: .068, pace });
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    for (let i=0; i<positions.count; i++) {
      const [u,v] = local(positions.getX(i),positions.getZ(i));
      const setback = Math.max(-u,u-width,-v,v-length);
      positions.setY(i,Math.max(positions.getY(i),copingTop-.022-(setback-copingWidth)*.055));
      uv.setXY(i,u/7,v/7);
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    add(geometry,material,name);
    // The paved margin smooths out the DEM's sampled basin slope.
    solid(geometry);
  }

  const batches = new PartBatches(300);
  const matrix = new THREE.Matrix4();
  const block = (material: THREE.Material,u: number,v: number,y: number,w: number,h: number,d: number) => {
    const [x,z] = point(u,v);
    batches.part(box(w,h,d),material,matrix.makeRotationY(angle).setPosition(x,y,z));
  };
  const copingRun = (side: boolean, span: number, across: number) => {
    const segments = Math.round(span / 1.85), step = span / segments;
    for (let i=0; i<segments; i++) {
      const station = (i+.5)*step;
      block(coping,side?across:station-copingWidth,side?station:across,copingTop-.145,
        side?copingWidth:step-.009,.29,side?step-.009:copingWidth);
    }
  };
  copingRun(true,length,-copingWidth/2);
  copingRun(true,length,width+copingWidth/2);
  copingRun(false,width+2*copingWidth,-copingWidth/2);
  copingRun(false,width+2*copingWidth,length+copingWidth/2);
  for (let v=10; v<=163; v+=11.6) {
    const u = 42, y = sampleElevation(city,...point(u,v))+.07;
    block(planterWall,u,v,y+.18,3.35,.46,8.6);
    block(plants,u,v,y+.423,2.68,.04,7.93);
  }
  for (const mesh of batches.meshes()) {
    mesh.name = mesh.material === coping ? 'Segmented granite pool coping' : 'Huntington Avenue planters';
    mesh.castShadow = mesh.material !== plants;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (mesh.material !== plants) solid(mesh.geometry);
  }

  const waterGeometry = yield* parkSurfaceSteps(city,[rect(0,0,width,length)],{ flatHeight: waterY, offset: 0 });
  waterGeometry.setAttribute('waterEdge', new THREE.Float32BufferAttribute(new Float32Array(waterGeometry.attributes.position.count).fill(1),1));
  applyWaterMotion(waterGeometry,{ strength: .035, speed: .095 });
  const pool = add(waterGeometry,water,'Christian Science reflecting pool');
  pool.userData.noAO = true;
  if (!mobile) addReflection(group,water.normalMap!,detailed);
  target.add(group);
}
