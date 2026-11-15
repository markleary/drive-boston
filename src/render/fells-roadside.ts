import * as THREE from 'three';
import type { CityData, Point2 } from '../types';
import { sampleElevation } from '../simulation/terrain.ts';
import { FELLS_TRAILHEAD, fellsRoadsideSpans, fellsRockCutPlan, type FellsBounds, type FellsRoadsideSpan } from '../simulation/fells-roadside.ts';
import { box, PartBatches, TriangleWriter } from './geometry-writer.ts';
import { canvasTexture, seeded } from './materials.ts';
import { due, type Pace } from './pacing.ts';
import type { SolidBox } from './commonwealth-mall.ts';
import { fellsRockMaterial } from './fells-woodland.ts';
export { fellsRoadsideReserved, fellsRoadsideRockAt } from '../simulation/fells-roadside.ts';

interface Options {
  bounds?: FellsBounds;
  onSolids?: (boxes: SolidBox[]) => void;
  onRock?: (vertices: Float32Array, indices: Uint32Array) => void;
  pace?: Pace;
}
const steel = new THREE.MeshStandardMaterial({ color: '#a2aaa7', metalness: .58, roughness: .6, side: THREE.DoubleSide });
const posts = new THREE.MeshStandardMaterial({ color: '#716a55', roughness: .95 });
const timber = new THREE.MeshStandardMaterial({ color: '#66503a', roughness: .94 });
const roof = new THREE.MeshStandardMaterial({ color: '#8a8776', roughness: .98 });
let mapMaterial: THREE.MeshStandardMaterial | undefined;

/** The metal rail has a corrugated W profile rather than a rectangular beam. */
export function guardrailGeometry(length: number, rise: number) {
  const writer = new TriangleWriter();
  const profile: Point2[] = [[0, -.16], [.055, -.125], [.09, -.075], [.025, 0], [.09, .075], [.055, .125], [0, .16]];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    writer.triangle(a[0], a[1] - rise / 2, -length / 2, b[0], b[1] - rise / 2, -length / 2, a[0], a[1] + rise / 2, length / 2);
    writer.triangle(b[0], b[1] - rise / 2, -length / 2, b[0], b[1] + rise / 2, length / 2, a[0], a[1] + rise / 2, length / 2);
  }
  return writer.geometry();
}

/** A jagged bedrock lobe embedded in the bank. Its perimeter sits below the
 * soil, avoiding the straight edges of a draped rectangular apron. */
export function fellsRockCutGeometry(city: CityData, span: FellsRoadsideSpan) {
  const writer = new TriangleWriter(), cut = fellsRockCutPlan(city, span);
  if (!cut) return writer.geometry();
  const { center, along, outward, halfLength, halfDepth, rise, seed } = cut, sides = 11, rings: number[][][] = [[], []];
  for (let i = 0; i < sides; i++) {
    const angle = (i + .16 * Math.sin(i * 2.3 + seed)) / sides * Math.PI * 2;
    const edge = .78 + .21 * Math.sin(i * 3.7 + seed * 8) ** 2;
    for (let ring = 0; ring < 2; ring++) {
      const radius = ring ? .53 : 1, u = Math.cos(angle) * halfLength * edge * radius, v = Math.sin(angle) * halfDepth * edge * radius;
      const x = center[0] + along[0] * u + outward[0] * v, z = center[1] + along[1] * u + outward[1] * v;
      const relief = ring ? rise * (.65 + .3 * Math.sin(i * 1.7 + seed) ** 2) : -.19;
      rings[ring].push([x, sampleElevation(city, x, z) + relief, z]);
    }
  }
  const top = [center[0], sampleElevation(city, ...center) + rise, center[1]];
  const triangle = (a: number[], b: number[], c: number[]) => {
    if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) [b, c] = [c, b];
    writer.triangle(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    triangle(rings[0][i], rings[1][i], rings[0][j]);
    triangle(rings[0][j], rings[1][i], rings[1][j]);
    triangle(rings[1][i], top, rings[1][j]);
  }
  const geometry = writer.geometry(), p = geometry.getAttribute('position'), colors = new Float32Array(p.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    color.set(Math.sin(x * .13 + z * .19) > .3 ? '#817d69' : '#777a70');
    color.multiplyScalar(.93 + .12 * Math.sin(y * 1.3 + x * .41));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function kioskMap() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
  const ctx = canvas.getContext('2d')!, random = seeded(5352);
  ctx.fillStyle = '#ede9da'; ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = '#264935'; ctx.fillRect(0, 0, 512, 56);
  ctx.fillStyle = '#f1eedb'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('MIDDLESEX FELLS', 256, 26);
  ctx.font = '15px sans-serif'; ctx.fillText('RESERVATION  ·  FELLSWAY EAST', 256, 47);
  ctx.fillStyle = '#bdc99d'; ctx.fillRect(18, 72, 313, 215);
  // An original small trail diagram, not a reproduction of a map image.
  for (let i = 0; i < 18; i++) { ctx.fillStyle = i % 2 ? '#a5b58c' : '#cbd4ad'; ctx.beginPath(); ctx.ellipse(40 + random() * 270, 92 + random() * 170, 15 + random() * 28, 10 + random() * 24, random() * 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#f6f0d7'; ctx.lineWidth = 4;
  for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.moveTo(40 + random() * 50, 90 + random() * 170); for (let j = 0; j < 5; j++) ctx.lineTo(65 + j * 48, 92 + random() * 170); ctx.stroke(); }
  ctx.strokeStyle = '#747d73'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(300, 80); ctx.bezierCurveTo(263, 142, 316, 210, 284, 282); ctx.stroke();
  ctx.fillStyle = '#a94f32'; ctx.beginPath(); ctx.arc(286, 213, 7, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'left'; ctx.fillStyle = '#354832'; ctx.font = 'bold 15px sans-serif'; ctx.fillText('TRAILHEAD', 350, 91);
  ctx.font = '13px sans-serif'; ['Cross Fells Trail', 'Rock Circuit Trail', 'Jerry Jingle Road'].forEach((text, i) => ctx.fillText(text, 350, 122 + i * 25));
  ctx.fillStyle = '#aa5739'; ctx.fillText('YOU ARE HERE', 350, 213);
  ctx.fillStyle = '#596147'; ctx.font = '12px sans-serif'; ctx.fillText('Explore the woods', 350, 258); ctx.fillText('Leave no trace', 350, 279);
  return new THREE.MeshStandardMaterial({ map: canvasTexture(canvas), roughness: .9 });
}

function trailheadKiosk(city: CityData, group: THREE.Group, solids: SolidBox[]) {
  const { x, z, yaw } = FELLS_TRAILHEAD, y = sampleElevation(city, x, z), kiosk = new THREE.Group();
  kiosk.name = 'Fellsway East roofed trailhead kiosk'; kiosk.position.set(x, y, z); kiosk.rotation.y = yaw;
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, mat = timber, tilt = 0) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); part.position.set(x, y, z); part.rotation.x = tilt; part.castShadow = part.receiveShadow = true; kiosk.add(part);
  };
  for (const side of [-1, 1]) add(.19, 2.6, .2, side * 1.03, 1.2, 0);
  add(2.36, .16, .24, 0, 2.4, 0); add(2.26, .16, .24, 0, .76, 0); add(2.12, 1.45, .13, 0, 1.57, 0);
  for (const side of [-1, 1]) add(2.66, .105, .93, 0, 2.74, side * .35, roof, side * .49);
  // Narrow shingle courses catch the light along the pitched roof.
  for (const side of [-1, 1]) for (let i = 1; i < 5; i++) add(2.67, .035, .045, 0, 2.98 - i * .084, side * i * .155, timber, side * .49);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 1.23), mapMaterial ??= kioskMap()); panel.position.set(0, 1.58, .075); kiosk.add(panel);
  group.add(kiosk);
  // Posts remain passable between them below the board; the visible board and
  // roof get their own boxes rather than an invisible full-height enclosure.
  for (const side of [-1, 1]) solids.push({ x: x + Math.cos(yaw) * side * 1.03, y: y + 1.2, z: z - Math.sin(yaw) * side * 1.03, yaw, slope: 0, length: .2, width: .19, height: 2.6 });
  solids.push({ x, y: y + 1.57, z, yaw, slope: 0, length: .15, width: 2.12, height: 1.45 });
  for (const side of [-1, 1]) solids.push({ x: x + Math.sin(yaw) * side * .35, y: y + 2.74, z: z + Math.cos(yaw) * side * .35, yaw, slope: -side * .49, length: .93, width: 2.66, height: .105 });
}

export function* fellsRoadsideSteps(city: CityData, parent: THREE.Group, options: Options = {}) {
  const group = new THREE.Group(); group.name = 'Fellsway East roadside';
  const hardware = new PartBatches(250), stone: THREE.BufferGeometry[] = [], solids: SolidBox[] = [];
  const transform = new THREE.Matrix4(); let rails = 0;
  for (const span of fellsRoadsideSpans(city, options.bounds)) {
    if (due(options.pace)) yield;
    const { a, b } = span, x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
    if (span.kind === 'rock') {
      const cut = fellsRockCutGeometry(city, span);
      if (cut.getAttribute('position').count) stone.push(cut); else cut.dispose();
      continue;
    }
    const ay = sampleElevation(city, ...a), by = sampleElevation(city, ...b), length = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const beam = guardrailGeometry(length + .025, by - ay);
    hardware.part(beam, steel, transform.makeRotationY(yaw).setPosition(x, (ay + by) / 2 + .72, z)); beam.dispose();
    const n = Math.ceil(length / 3.8);
    for (let i = 0; i < n; i++) {
      const t = (i + .5) / n, px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
      hardware.part(box(.14, 1.07, .18), posts, transform.makeRotationY(yaw).setPosition(px, sampleElevation(city, px, pz) + .34, pz));
    }
    solids.push({ x, y: (ay + by) / 2 + .69, z, yaw, slope: Math.atan2(by - ay, length), length: Math.hypot(length, by - ay), width: .18, height: .4 }); rails++;
  }
  for (const mesh of hardware.meshes()) { mesh.name = 'Fellsway East steel guardrail'; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); }
  // One terrain-aligned collision mesh per local cut avoids long invisible
  // boxes, while the tiled parent owns every geometry through unload.
  if (stone.length) {
    const writer = new TriangleWriter(); const colors: number[] = [];
    for (const g of stone) { writer.append(g); colors.push(...g.getAttribute('color').array); g.dispose(); }
    const geometry = writer.geometry(); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, fellsRockMaterial); mesh.name = 'Fellsway East exposed rock cuts'; mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    const vertices = geometry.getAttribute('position').array as Float32Array;
    options.onRock?.(vertices, Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i));
  }
  const b = options.bounds, { x, z } = FELLS_TRAILHEAD;
  const kiosk = (!b || x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ) && city.roads.some(r => r.name === 'Fellsway East');
  if (kiosk) trailheadKiosk(city, group, solids);
  options.onSolids?.(solids);
  group.userData = { guardrailSpans: rails, rockCuts: stone.length, trailheadKiosks: Number(kiosk) };
  if (group.children.length) parent.add(group);
  return group;
}
