import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityArea, CityData, Point2 } from '../types';
import { sampleElevation, sampleTerrainNormal } from '../simulation/terrain.ts';
import { canopyHitsDeck } from '../simulation/deck-canopy.ts';
import type { Bounds } from './city-parks.ts';
import { canvasTexture, seeded } from './materials.ts';
import { due, type Pace } from './pacing.ts';
import { spatialInstances } from './spatial-batches.ts';

export const isFellsWoodland = (area: CityArea) =>
  area.name === 'Middlesex Fells Reservation' || area.name === "Wright's Pond";

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

// Crown lobes are shared by instances of each tree type. Keeping the crowns
// opaque avoids the layers of overlapping alpha cards in a continuous canopy.
type Lobe = [x: number, y: number, z: number, rx: number, ry: number, rz: number];
const SPECIES: { name: string; colors: string[]; bark: string; trunk: number; lobes: Lobe[] }[] = [
  { name: 'Oak', colors: ['#3e6537', '#4c7041', '#537843'], bark: '#605748', trunk: 10,
    lobes: [[0, 12, 0, 6.2, 5.1, 5.8], [-3.7, 10.3, 1, 4.4, 3.9, 4.3], [3.1, 11.4, 1.4, 4.6, 4.2, 4.3], [.5, 11.5, -3.4, 4, 4.1, 4.3]] },
  { name: 'Maple', colors: ['#557840', '#63894b', '#6e8d4b'], bark: '#685a4b', trunk: 11,
    lobes: [[0, 13, 0, 5.4, 6, 5.3], [-2.7, 11.2, 1.7, 3.8, 4.6, 3.4], [3.3, 12.6, -.9, 3.9, 4.9, 4]] },
  { name: 'Birch', colors: ['#738d4d', '#809851', '#64824a'], bark: '#a9a497', trunk: 9,
    lobes: [[-.5, 11.6, 0, 3.9, 4.5, 3.7], [2, 10.6, -1.1, 3.2, 3.7, 3.2], [-1.9, 9.5, 1.4, 3.2, 3.3, 3.6]] },
  { name: 'White pine', colors: ['#3e664f', '#477053', '#537957'], bark: '#5b5144', trunk: 16,
    lobes: [[0, 7, 0, 4.6, 3.1, 4.1], [.4, 10.3, -.2, 4.1, 3.5, 3.9], [-.2, 13.9, .5, 3.4, 4, 3.2], [.3, 17.1, 0, 2.1, 4.1, 2.3]] },
];
const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .98 });
let treeForms: ReturnType<typeof treeForm>[] | undefined;
let treeMaterial: THREE.MeshLambertMaterial | undefined;

function canopyMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!, random = seeded(4209);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1850; i++) {
    const gray = 174 + Math.floor(random() * 81);
    ctx.fillStyle = `rgba(${gray},${gray},${gray},.4)`;
    ctx.beginPath();
    ctx.ellipse(random() * 128, random() * 128, 1 + random() * 3, 1 + random() * 2, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = canvasTexture(canvas, true);
  map.repeat.set(2, 1);
  return new THREE.MeshLambertMaterial({ vertexColors: true, map });
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

function treeForm(species: typeof SPECIES[number]) {
  const trunk = new THREE.CylinderGeometry(.14, .37, species.trunk + .8, 5, 1, true).toNonIndexed().translate(0, species.trunk / 2 - .4, 0);
  const parts = [paint(trunk, species.bark, (x, y, z) => .88 + .12 * Math.sin(y * 4 + x * 5 + z))];
  for (const [i, [x, y, z, rx, ry, rz]] of species.lobes.entries()) {
    const crown = new THREE.IcosahedronGeometry(1, i === 0 ? 1 : 0);
    const p = crown.getAttribute('position'), normals = crown.getAttribute('normal');
    const radial = new THREE.Vector3();
    for (let j = 0; j < p.count; j++) {
      const u = p.getX(j), v = p.getY(j), w = p.getZ(j);
      const warp = 1 + .12 * Math.sin(u * 8 + v * 3 + i) * Math.cos(w * 9 - v * 4);
      p.setXYZ(j, x + u * rx * warp, y + v * ry * warp, z + w * rz * warp);
      radial.set(u / rx, v / ry, w / rz).normalize();
      normals.setXYZ(j, radial.x, radial.y, radial.z);
    }
    parts.push(paint(crown, species.colors[i % species.colors.length], (x, y, z) =>
      .78 + .22 * Math.min(1, y / 16) + .17 * Math.sin(x * 2 + y * 3) * Math.cos(z * 2.8)));
  }
  // The lobes start as triangle soup. Share vertices across their smooth faces
  // so each of the many instances transforms fewer vertices, including in shadows.
  const merged = mergeGeometries(parts)!;
  const geometry = mergeVertices(merged);
  merged.dispose();
  parts.forEach(part => part.dispose());
  const p = geometry.getAttribute('position');
  let reach = 0, top = 0;
  for (let i = 0; i < p.count; i++) {
    reach = Math.max(reach, Math.hypot(p.getX(i), p.getZ(i)));
    top = Math.max(top, p.getY(i));
  }
  return { geometry, reach, top };
}

interface Ledge { p: Point2; rx: number; rz: number; rise: number; yaw: number; }
const GRANITE = ['#8a8980', '#a29e94', '#b2ada0', '#96958b'];

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
  viewHeight: FellsViewHeight;
  onRock?: (vertices: Float32Array, indices: Uint32Array) => void;
  pace?: Pace;
}

export function* fellsWoodlandSteps(city: CityData, group: THREE.Group, options: WoodlandOptions) {
  const { bounds, contains, clear, viewHeight, onRock, pace } = options;
  const woodland = new THREE.Group();
  woodland.name = 'Middlesex Fells woodland';
  group.add(woodland);
  const outcrops: { p: Point2; radius: number }[] = [], stone: THREE.BufferGeometry[] = [];
  for (const { p, random } of sites(bounds, 69, 72935)) {
    if (due(pace)) yield;
    const [x, z] = p;
    if (x < bounds.minX + 22 || x > bounds.maxX - 22 || z < bounds.minZ + 22 || z > bounds.maxZ - 22 || !contains(p)) continue;
    if (Math.hypot(x - TOWER[0], z - TOWER[1]) > 240 && random() < .49) continue;
    const normal = sampleTerrainNormal(city, x, z);
    if (normal.y > .975 && random() > .17) continue;
    const yaw = Math.atan2(-normal.x, normal.z) + (random() - .5) * 1.5;
    const start = stone.length, count = 2 + Math.floor(random() * 4);
    for (let i = 0; i < count; i++) {
      const along = i ? (random() - .5) * 21 : 0, across = i ? (random() - .5) * 13 : 0;
      const center: Point2 = [x + along * Math.cos(yaw) - across * Math.sin(yaw), z + along * Math.sin(yaw) + across * Math.cos(yaw)];
      const rx = i ? 2.2 + random() * 4.4 : 6 + random() * 5, rz = rx * (.42 + random() * .38);
      const rise = (i ? .8 : 1.7) + random() * (i ? 1.6 : 2.2);
      if (!contains(center) || !clear(center, rx, true)) continue;
      const rock = granite(city, { p: center, rx, rz, rise, yaw: yaw + (random() - .5) * .45 }, random);
      rock.computeBoundingBox();
      const positions = rock.getAttribute('position');
      let inside = true;
      for (let j = 0; j < positions.count; j++) {
        if (!contains([positions.getX(j), positions.getZ(j)])) { inside = false; break; }
      }
      if (!inside || rock.boundingBox!.max.y > viewHeight(center, rx)) { rock.dispose(); continue; }
      stone.push(rock);
    }
    if (stone.length > start) outcrops.push({ p, radius: 13 + random() * 7 });
  }
  if (stone.length) {
    const geometry = mergeGeometries(stone)!;
    stone.forEach(rock => rock.dispose());
    const rock = new THREE.Mesh(geometry, rockMaterial);
    rock.name = 'Granite ledges and boulders';
    rock.castShadow = rock.receiveShadow = true;
    woodland.add(rock);
    const vertices = geometry.getAttribute('position').array as Float32Array;
    onRock?.(vertices, Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i));
  }

  const forms = treeForms ??= SPECIES.map(treeForm);
  const trees: { p: Point2; y: number; scale: number; yaw: number; tint: number }[][] = forms.map(() => []);
  for (const { p, random } of sites(bounds, 13.5, 42037)) {
    if (due(pace)) yield;
    if (!contains(p)) continue;
    const [x, z] = p, stand = Math.sin(x * .018 + Math.sin(z * .014)) * Math.cos(z * .019);
    if (random() < .09 + .22 * Math.max(0, -stand) || outcrops.some(o => Math.hypot(x - o.p[0], z - o.p[1]) < o.radius)) continue;
    const choice = random() + stand * .13;
    const species = choice < .36 ? 0 : choice < .68 ? 1 : choice < .82 ? 2 : 3;
    const form = forms[species];
    const y = sampleElevation(city, x, z);
    let scale = .73 + random() * .57;
    if (y + form.top * scale > viewHeight(p, form.reach * scale)) {
      // Low saplings and scrub soften the opening where a full crown would
      // cross the view. The smaller crown still has to fit the sightline.
      scale = Math.min(.54, (viewHeight(p, form.reach * .45) - y - .1) / form.top);
      if (scale < .13) continue;
    }
    const reach = form.reach * scale, top = form.top * scale;
    if (y + top > viewHeight(p, reach) || !clear(p, reach, false) || canopyHitsDeck(city, x, z, y, { reach, top })) continue;
    trees[species].push({ p, y, scale, yaw: random() * 2 * Math.PI, tint: .82 + random() * .34 });
  }
  const transform = new THREE.Object3D(), tint = new THREE.Color();
  for (const [i, stand] of trees.entries()) {
    if (!stand.length) continue;
    if (due(pace)) yield;
    // The base is tile-owned because the streamer disposes instance geometry.
    const mesh = new THREE.InstancedMesh(forms[i].geometry.clone(), treeMaterial ??= canopyMaterial(), stand.length);
    mesh.name = `Fells ${SPECIES[i].name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    stand.forEach(({ p: [x, z], y, scale, yaw, tint: shade }, j) => {
      transform.position.set(x, y, z);
      transform.rotation.y = yaw;
      transform.scale.setScalar(scale);
      transform.updateMatrix();
      mesh.setMatrixAt(j, transform.matrix);
      mesh.setColorAt(j, tint.setScalar(shade));
    });
    woodland.add(...spatialInstances(mesh, 500));
  }
  const count = trees.reduce((sum, stand) => sum + stand.length, 0);
  woodland.userData = { trees: count, outcrops: outcrops.length, rocks: stone.length };
  return count;
}
