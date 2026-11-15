import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData, Point2 } from '../types';
import { isFellsArea } from '../simulation/fells-trails.ts';
import { sampleElevation, sampleTerrainNormal } from '../simulation/terrain.ts';
import { canopyHitsDeck, PARK_CANOPY } from '../simulation/deck-canopy.ts';
import type { Bounds } from './city-parks.ts';
import { canvasTexture, seeded } from './materials.ts';
import { due, type Pace } from './pacing.ts';
import { spatialInstances } from './spatial-batches.ts';
import { createStreetTrees, type TreePlanting } from './foliage.ts';

export const isFellsWoodland = isFellsArea;

// Mapped footprint of osm-way-31364672 on Pine Hill. Aim at the lower half
// of the visible stonework so the opening exposes more than the parapet.
const TOWER: Point2 = [-2520.863, -9163.378];
export type FellsViewHeight = (p: Point2, reach: number) => number;

export function fellsViewHeight(city: CityData): FellsViewHeight {
  const targetY = sampleElevation(city, ...TOWER) + 5;
  const rays: { dx: number; dz: number; length: number; eye: number }[] = [];
  for (const road of city.roads) {
    if (!/^i93-(nb|sb)-/.test(road.id) || !road.elevations) continue;
    for (let i = 0; i < road.points.length; i += 3) {
      const [x, z] = road.points[i], dx = x - TOWER[0], dz = z - TOWER[1];
      const length = Math.hypot(dx, dz), eye = road.elevations[i] + 1.4;
      if (length < 110 || length > 440) continue;
      // Keep views which the hill already permits. A longer stretch of the
      // highway can see the parapet than can see all the way to the doorway.
      let visible = true;
      for (let d = 5; d < length - 5; d += 5) {
        const t = d / length;
        if (sampleElevation(city, TOWER[0] + dx * t, TOWER[1] + dz * t) > THREE.MathUtils.lerp(targetY + 2, eye, t)) {
          visible = false;
          break;
        }
      }
      if (visible) rays.push({ dx: dx / length, dz: dz / length, length, eye });
    }
  }
  return (p, reach) => {
    const x = p[0] - TOWER[0], z = p[1] - TOWER[1], distance = Math.hypot(x, z);
    if (distance < 13 + reach) return -Infinity;
    if (distance > 440 + reach) return Infinity;
    let ceiling = Infinity;
    for (const ray of rays) {
      const d = x * ray.dx + z * ray.dz;
      if (d <= 0 || d >= ray.length || Math.abs(x * ray.dz - z * ray.dx) > reach + 4) continue;
      ceiling = Math.min(ceiling, THREE.MathUtils.lerp(targetY, ray.eye, Math.min(1, (d + reach) / ray.length)));
    }
    return ceiling;
  };
}

function* sites(bounds: Bounds, spacing: number, salt: number) {
  for (let iz = Math.floor(bounds.minZ / spacing); iz < Math.ceil(bounds.maxZ / spacing); iz++) {
    for (let ix = Math.floor(bounds.minX / spacing); ix < Math.ceil(bounds.maxX / spacing); ix++) {
      const random = seeded(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ salt);
      const x = (ix + .16 + random() * .68) * spacing, z = (iz + .16 + random() * .68) * spacing;
      if (x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ) yield { p: [x, z] as Point2, random };
    }
  }
}

/** The established park tree field supplies actual branches, cutout leaves and
 * distance levels. Mature oaks and maples dominate, with occasional pine stands. */
const SPECIES = ['red oak', 'maple', 'elm', 'white pine'];
export const fellsRockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98 });
fellsRockMaterial.onBeforeCompile = shader => {
  shader.vertexShader = 'varying vec3 fellsRockPosition;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nfellsRockPosition = (modelMatrix * vec4(transformed, 1.)).xyz;');
  shader.fragmentShader = `varying vec3 fellsRockPosition;
    float fellsGrain(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float fellsNoise(vec3 p) {
      vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(mix(fellsGrain(i),fellsGrain(i+vec3(1,0,0)),f.x),mix(fellsGrain(i+vec3(0,1,0)),fellsGrain(i+vec3(1,1,0)),f.x),f.y),
        mix(mix(fellsGrain(i+vec3(0,0,1)),fellsGrain(i+vec3(1,0,1)),f.x),mix(fellsGrain(i+vec3(0,1,1)),fellsGrain(i+vec3(1,1,1)),f.x),f.y),f.z);
    }\n` + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    vec3 stoneP=fellsRockPosition;
    float weather=fellsNoise(stoneP*.48), grain=fellsNoise(stoneP*19.);
    float joint=abs(sin(dot(stoneP,vec3(.42,1.65,.61))+fellsNoise(stoneP*.9)*1.7));
    float crossJoint=abs(sin(dot(stoneP,vec3(1.3,-.38,.77))+fellsNoise(stoneP*.4)*2.2));
    float fissure=1.-smoothstep(.018,.08,min(joint,crossJoint));
    diffuseColor.rgb*=.8+weather*.35+grain*.19;
    diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.68,.54,.39),smoothstep(.61,.84,weather)*.45);
    diffuseColor.rgb*=1.-fissure*.43;`);
};
fellsRockMaterial.customProgramCacheKey = () => 'fells-fractured-rock-1';

let shrubResources: { geometry: THREE.BufferGeometry; material: THREE.MeshLambertMaterial } | undefined;

/** Five intersecting leafy branches, rather than solid green balls. Shared
 * textures stay small; tile-owned geometry and near-only batches bound cost. */
function shrubs() {
  if (shrubResources) return shrubResources;
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=256;
  const c=canvas.getContext('2d')!, random=seeded(73107);
  for (let branch=0;branch<9;branch++) {
    const bx=128+(random()-.5)*205, by=16+random()*132;
    c.strokeStyle='#675e3e'; c.lineWidth=1.5;
    c.beginPath(); c.moveTo(128,250); c.lineTo(bx,by); c.stroke();
    for (let leaf=0;leaf<48;leaf++) {
      const t=.15+random()*.85, x=128+(bx-128)*t+(random()-.5)*55, y=250+(by-250)*t+(random()-.5)*36;
      const size=4+random()*5;
      c.save(); c.translate(x,y); c.rotate(random()*6.28);
      c.fillStyle=`hsl(${77+random()*25},${27+random()*26}%,${25+random()*24}%)`;
      c.beginPath(); c.ellipse(0,0,size*.48,size,0,0,Math.PI*2); c.fill();
      c.strokeStyle='#b9c38d66'; c.lineWidth=.5; c.beginPath(); c.moveTo(0,-size*.8); c.lineTo(0,size*.8); c.stroke(); c.restore();
    }
  }
  const map=canvasTexture(canvas);
  // A small texture-shaped indirect contribution keeps backlit understory
  // readable below the closed canopy without changing the city's lighting.
  const material=new THREE.MeshLambertMaterial({ map, color:'#d0dcb9', emissive:'#637b43', emissiveMap:map, emissiveIntensity:.32, side:THREE.DoubleSide, alphaTest:.43 });
  material.forceSinglePass=true;
  const cards:THREE.BufferGeometry[]=[];
  for (let i=0;i<5;i++) {
    const angle=i*Math.PI/5, card=new THREE.PlaneGeometry(3.6,2.8).translate(0,1.32,0);
    card.rotateY(angle).rotateZ((i%2?1:-1)*.12);
    cards.push(card);
  }
  const geometry=mergeGeometries(cards)!; cards.forEach(g=>g.dispose());
  return shrubResources={geometry,material};
}

function paint(geometry: THREE.BufferGeometry, tint: string, shade: (x: number, y: number, z: number) => number) {
  const position = geometry.getAttribute('position'), colors = new Float32Array(position.count * 3), color = new THREE.Color(tint);
  for (let i = 0; i < position.count; i++) {
    const k = shade(position.getX(i), position.getY(i), position.getZ(i));
    colors.set([color.r * k, color.g * k, color.b * k], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

interface Ledge { p: Point2; rx: number; rz: number; rise: number; yaw: number; }
const GRANITE = ['#898a80', '#a39b88', '#aaa698', '#848b85'];

/** A fractured slab with a beveled top and a skirt that follows the ground.
 * Each part of a ledge uses the same strike, with the exposed edge downhill. */
function granite(city: CityData, ledge: Ledge, random: () => number) {
  const { p, rx, rz, rise, yaw } = ledge, sin = Math.sin(yaw), cos = Math.cos(yaw);
  const points: number[][][] = [[], [], []], sides = 7;
  for (let i = 0; i < sides; i++) {
    const angle = (i + (random() - .5) * .4) / sides * 2 * Math.PI;
    const u = Math.cos(angle) * rx * (.76 + random() * .24), v = Math.sin(angle) * rz * (.8 + random() * .2);
    const top = rise * (.67 + random() * .38);
    for (let ring = 0; ring < 3; ring++) {
      const inset = ring === 2 ? .71 : ring === 1 ? 1 : .94;
      const x = p[0] + (u * cos - v * sin) * inset, z = p[1] + (u * sin + v * cos) * inset;
      const ground = sampleElevation(city, x, z);
      points[ring].push([x, ground + (ring === 2 ? top : ring === 1 ? top * .48 : -.7), z]);
    }
  }
  const positions: number[] = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    for (let ring = 0; ring < 2; ring++) {
      const a = points[ring][i], b = points[ring + 1][i], c = points[ring + 1][j], d = points[ring][j];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    if (i > 0 && j > 0) positions.push(...points[2][0], ...points[2][j], ...points[2][i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return paint(g, GRANITE[Math.floor(random() * GRANITE.length)], (x, y, z) =>
    .91 + .12 * Math.sin(x * .67 + z * .3) + .1 * Math.cos(y * 1.8 + x * .12));
}

interface WoodlandOptions {
  bounds: Bounds;
  contains(p: Point2): boolean;
  clear(p: Point2, reach: number, solid: boolean): boolean;
  /** Understory may fill the shoulder while its leaves still clear the travel surface. */
  clearBrush?(p: Point2, reach: number): boolean;
  viewHeight: FellsViewHeight;
  onRock?: (vertices: Float32Array, indices: Uint32Array) => void;
  onTrees?: (trees: TreePlanting[]) => void;
  pace?: Pace;
}

export function* fellsWoodlandSteps(city: CityData, group: THREE.Group, options: WoodlandOptions) {
  const { bounds, contains, clear, clearBrush, viewHeight, onRock, onTrees, pace } = options;
  const woodland = new THREE.Group();
  woodland.name = 'Middlesex Fells woodland';
  group.add(woodland);
  const outcrops: { p: Point2; radius: number }[] = [], stone: THREE.BufferGeometry[] = [], footprints:Ledge[]=[];
  const inRock=(p:Point2,margin:number)=>footprints.some(r=>{
    const dx=p[0]-r.p[0], dz=p[1]-r.p[1], c=Math.cos(r.yaw), s=Math.sin(r.yaw);
    return ((dx*c+dz*s)/(r.rx+margin))**2+((-dx*s+dz*c)/(r.rz+margin))**2<1;
  });
  for (const { p, random } of sites(bounds, 53, 72935)) {
    if (due(pace)) yield;
    const [x, z] = p;
    if (x < bounds.minX + 22 || x > bounds.maxX - 22 || z < bounds.minZ + 22 || z > bounds.maxZ - 22 || !contains(p)) continue;
    const normal = sampleTerrainNormal(city, x, z);
    if (normal.y > .975 && random() > .32) continue;
    const yaw = Math.atan2(-normal.x, normal.z) + (random() - .5) * 1.5;
    const start = stone.length, count = 2 + Math.floor(random() * 4);
    for (let i = 0; i < count; i++) {
      const along = i ? (random() - .5) * 21 : 0, across = i ? (random() - .5) * 13 : 0;
      const center: Point2 = [x + along * Math.cos(yaw) - across * Math.sin(yaw), z + along * Math.sin(yaw) + across * Math.cos(yaw)];
      const rx = i ? 2.2 + random() * 4.4 : 6 + random() * 5, rz = rx * (.42 + random() * .38);
      const rise = (i ? .8 : 2.2) + random() * (i ? 1.8 : 3.2);
      if (!contains(center) || !clear(center, rx, true)) continue;
      const ledge={ p: center, rx, rz, rise, yaw: yaw + (random() - .5) * .45 };
      const rock = granite(city, ledge, random);
      rock.computeBoundingBox();
      const positions = rock.getAttribute('position');
      let inside = true;
      for (let j = 0; j < positions.count; j++) {
        if (!contains([positions.getX(j), positions.getZ(j)])) { inside = false; break; }
      }
      if (!inside || rock.boundingBox!.max.y > viewHeight(center, rx)) { rock.dispose(); continue; }
      stone.push(rock); footprints.push(ledge);
    }
    if (stone.length > start) outcrops.push({ p, radius: 13 + random() * 7 });
  }
  if (stone.length) {
    const geometry = mergeGeometries(stone)!;
    stone.forEach(rock => rock.dispose());
    const rock = new THREE.Mesh(geometry, fellsRockMaterial);
    rock.name = 'Granite ledges and boulders';
    rock.castShadow = rock.receiveShadow = true;
    woodland.add(rock);
    const vertices = geometry.getAttribute('position').array as Float32Array;
    onRock?.(vertices, Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i));
  }

  const trees:TreePlanting[]=[];
  for (const { p, random } of sites(bounds, 9.8, 42037)) {
    if (due(pace)) yield;
    if (!contains(p)) continue;
    const [x,z]=p, stand=Math.sin(x*.018+Math.sin(z*.014))*Math.cos(z*.019);
    if (random()<.04+.13*Math.max(0,-stand) || inRock(p,.55)) continue;
    const choice=random()+stand*.13, species=choice<.43?0:choice<.75?1:choice<.84?2:3;
    const y=sampleElevation(city,x,z);
    let scale=random()<.14?.28+random()*.22:.76+random()*.34;
    // PARK_CANOPY already includes the field's 1.65 scale and its maximum
    // random tree scale 1.12. Explicit scales here use the same world bounds.
    const topAtUnit=PARK_CANOPY.top/1.12, reachAtUnit=PARK_CANOPY.reach/1.12;
    if (y+topAtUnit*scale>viewHeight(p,reachAtUnit*scale)) {
      scale=Math.min(.4,(viewHeight(p,reachAtUnit*.4)-y-.1)/topAtUnit);
      if (scale<.13) continue;
    }
    const reach=reachAtUnit*scale, top=topAtUnit*scale;
    if (y+top>viewHeight(p,reach)||!clear(p,reach,false)||canopyHitsDeck(city,x,z,y,{reach,top})) continue;
    trees.push({position:new THREE.Vector3(x,y+.025,z),species:SPECIES[species],scale});
  }
  if (trees.length) {
    if (onTrees) onTrees(trees);
    else woodland.add(createStreetTrees(trees,{scale:1.65,grates:false}));
  }

  const brush:{p:Point2;y:number;scale:number;yaw:number;tint:number}[]=[];
  for (const {p,random} of sites(bounds,3.9,87251)) {
    if (due(pace)) yield;
    if (!contains(p)) continue;
    const [x,z]=p, patch=Math.sin(x*.071+Math.cos(z*.048))*Math.cos(z*.063);
    if (random()<.04+.19*Math.max(0,-patch)) continue;
    const y=sampleElevation(city,x,z), scale=.62+random()*.72;
    const reach=2.3*scale, top=3*scale;
    if (y+top>viewHeight(p,reach)||!(clearBrush?.(p,reach)??clear(p,reach,true))||canopyHitsDeck(city,x,z,y,{reach,top})) continue;
    if (inRock(p,reach*.6)) continue;
    brush.push({p,y,scale,yaw:random()*Math.PI*2,tint:.9+random()*.27});
  }
  const shrubBatches:THREE.InstancedMesh[]=[];
  if (brush.length) {
    const resources=shrubs(), mesh=new THREE.InstancedMesh(resources.geometry.clone(),resources.material,brush.length);
    mesh.name='Fells shrubs and saplings'; mesh.castShadow=mesh.receiveShadow=true; mesh.userData.noAO=true;
    const transform=new THREE.Object3D(), color=new THREE.Color();
    brush.forEach(({p:[x,z],y,scale,yaw,tint},i)=>{
      transform.position.set(x,y-.04,z); transform.rotation.set(0,yaw,0); transform.scale.set(scale,scale,scale);
      transform.updateMatrix(); mesh.setMatrixAt(i,transform.matrix); mesh.setColorAt(i,color.setScalar(tint));
    });
    shrubBatches.push(...spatialInstances(mesh,100)); woodland.add(...shrubBatches);
  }
  woodland.userData = { trees:trees.length, shrubs:brush.length, outcrops:outcrops.length, rocks:stone.length,
    updateFoliage:(observer:THREE.Vector3,_time:number,high=true)=>{
      const reach=high?240:165;
      for (const mesh of shrubBatches) {
        const sphere=mesh.boundingSphere!;
        const distance=observer.distanceTo(sphere.center)-sphere.radius;
        mesh.visible=distance<reach;
        mesh.castShadow=distance<(high?85:45);
      }
    },
  };
  return trees.length;
}
