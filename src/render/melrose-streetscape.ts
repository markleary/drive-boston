import * as THREE from 'three';
import type { Point2 } from '../types';
import { mainStreetCrossingPosts, mainStreetEast, mainStreetLamps, mainStreetPoint, MAIN_STREET_HEADING, MAIN_STREET_PARKLET } from '../simulation/melrose-main-street.ts';
import { americanFlagTexture, landmarkTexture } from './landmark-model.ts';
import { lathe, Shapes, siteKit, type SiteKit, type V3 } from './site-kit.ts';

type Height = (x: number, z: number) => number;
const alongYaw = MAIN_STREET_HEADING - Math.PI / 2;
const fluorescent = '#d2e73a';
let flagMaterial: THREE.MeshStandardMaterial | undefined, pedestrianMaterial: THREE.MeshStandardMaterial | undefined;

function crossingSign() {
  if (pedestrianMaterial) return pedestrianMaterial;
  const map = typeof document !== 'undefined' ? landmarkTexture(160, 210, c => {
    const polygon = (points: Point2[], fill: string) => {
      c.beginPath(); c.moveTo(...points[0]);
      for (const p of points.slice(1)) c.lineTo(...p);
      c.closePath(); c.fillStyle = fill; c.fill();
    };
    polygon([[80, 1], [157, 78], [80, 155], [3, 78]], fluorescent);
    c.strokeStyle = '#232924'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#222824'; c.beginPath(); c.arc(85, 43, 7, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#222824'; c.lineCap = 'round'; c.lineJoin = 'round';
    const stroke = (width: number, points: Point2[]) => {
      c.lineWidth = width; c.beginPath(); c.moveTo(...points[0]); for (const p of points.slice(1)) c.lineTo(...p); c.stroke();
    };
    stroke(10, [[82, 57], [76, 78]]);
    stroke(7, [[65, 72], [73, 58], [82, 56], [89, 70], [100, 77]]);
    stroke(8, [[77, 77], [87, 93], [98, 108]]);
    stroke(8, [[77, 79], [70, 95], [61, 107]]);
    c.fillStyle = fluorescent; c.fillRect(31, 163, 98, 43); c.lineWidth = 2; c.strokeRect(32, 164, 96, 41);
    polygon([[55, 196], [61, 174], [67, 181], [99, 169], [104, 180], [71, 191], [78, 197]], '#222824');
  }) : null;
  pedestrianMaterial = new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : fluorescent, alphaTest: .5, roughness: .62, side: THREE.DoubleSide });
  return pedestrianMaterial;
}

function lampFixture(kit: SiteKit, lampMat: THREE.Material) {
  const s = new Shapes(), iron = kit.blackPaint;
  lathe(s, iron, [[.31, 0], [.31, .08], [.27, .12], [.26, .22], [.19, .27], [.16, .38], [.13, .64], [.17, .69], [.17, .75], [.12, .81], [.095, .91], [.08, 3.66], [.13, 3.70], [.13, 3.8], [.095, 3.86], [.095, 4.03], [.04, 4.13], [0, 4.17]], 0, 0, 0, 12);
  for (const side of [-1, 1]) {
    const x = .36 * side;
    s.rod(iron, [0, 3.68, 0], [x, 3.83, 0], .054);
    s.rod(iron, [0, 3.92, 0], [x, 3.92, 0], .066);
    lathe(s, iron, [[0, 3.59], [.055, 3.66], [.07, 3.77], [.077, 3.87], [.09, 3.94], [.115, 3.98], [.095, 4.04], [.14, 4.09]], x, 0, 0, 10);
    lathe(s, lampMat, [[.105, 4.07], [.125, 4.13], [.17, 4.24], [.18, 4.35], [.145, 4.44], [.09, 4.50], [.055, 4.55]], x, 0, 0, 12);
    lathe(s, iron, [[.064, 4.53], [.065, 4.56], [.03, 4.6], [0, 4.64]], x, 0, 0, 8);
  }

  // Cloth hangs from an angled staff. Its hoist follows the rod and the free edge folds forward.
  s.rod(kit.steel, [0, 3.47, -.04], [.77, 4.82, -.45], .018, .013, 6);
  flagMaterial ??= new THREE.MeshStandardMaterial({ map: typeof document === 'undefined' ? null : americanFlagTexture(), side: THREE.DoubleSide, roughness: .93 });
  const cloth = new THREE.PlaneGeometry(1, 1, 7, 2), p = cloth.getAttribute('position'), uv = cloth.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i), down = 1 - uv.getY(i);
    p.setXYZ(i, .74 - .30 * down + .94 * u, 4.77 - .53 * down - .49 * u - .08 * Math.sin(u * Math.PI),
      -.43 + .16 * down - .21 * u + .12 * Math.sin(u * 8 + down * .8) * u);
  }
  cloth.computeVertexNormals(); s.place(flagMaterial, cloth, 0, 0, 0);
  return s.meshes('Main Street twin-globe lamps');
}

function addLamps(group: THREE.Group, kit: SiteKit, lampMat: THREE.Material, height: Height) {
  const matrix = new THREE.Matrix4();
  for (const part of lampFixture(kit, lampMat)) {
    const row = new THREE.InstancedMesh(part.geometry, part.material, mainStreetLamps.length);
    mainStreetLamps.forEach(([x, z], i) => {
      const yaw = mainStreetEast(x, z) < 0 ? MAIN_STREET_HEADING : MAIN_STREET_HEADING + Math.PI;
      row.setMatrixAt(i, matrix.makeRotationY(yaw).setPosition(x, height(x, z) + .025, z));
    });
    row.name = part.name; row.castShadow = row.receiveShadow = true;
    row.computeBoundingSphere(); group.add(row);
  }
}

function addParklet(s: Shapes, kit: SiteKit, height: Height) {
  const [start, end] = MAIN_STREET_PARKLET, iron = kit.blackPaint;
  const wood = kit.tint('planks', '#967d65'), seat = kit.tint('planks', '#b79a77');
  const foliage = [kit.tint('grass', '#738049'), kit.tint('grass', '#94a45b'), kit.tint('grass', '#733f3e')];
  const ground = (u: number, v: number) => height(...mainStreetPoint(u, v));
  const point = (u: number, v: number, h: number): V3 => { const [x, z] = mainStreetPoint(u, v); return [x, height(x, z) + h, z]; };
  const box = (m: THREE.Material, u: number, v: number, h: number, w: number, d: number, tall: number) => {
    const [x, y, z] = point(u, v, h); s.box(m, w, tall, d, x, y, z, alongYaw);
  };
  // The raised dining deck follows the road grade, with the shop-side edge open to the sidewalk.
  const inner = 4.14, outer = 6.12;
  for (let u = start; u < end; u++) {
    s.poly(seat, [point(u, inner, .16), point(u + 1, inner, .16), point(u + 1, outer, .16), point(u, outer, .16)], [0, 1, 0]);
    box(wood, u + .5, inner, .09, 1, .06, .18);
  }
  const planter = (u: number, v: number, length: number, depth: number) => {
    const [x, z] = mainStreetPoint(u, v), y = ground(u, v);
    for (let i = 0; i < 4; i++) box(i % 2 ? seat : wood, u, v, .235 + .137 * i, length, depth, .13);
    box(kit.timber, u, v, .711, length - .08, depth - .06, .035);
    const n = Math.ceil(length / .45);
    for (let i = 0; i < n; i++) {
      const uv = point(u + ((i + .5) / n - .5) * length, v + .055 * Math.sin(i * 7.3), .74 + .045 * (i % 3));
      s.place(foliage[i % 3], new THREE.IcosahedronGeometry(1, 0), ...uv, i * .91, 0, 0, [.26, .15 + .05 * (i % 3), .22]);
    }
    s.solidBox(length, depth, x, z, y + .10, y + .74, alongYaw);
  };
  for (const u of [start + .23, end - .23]) planter(u, (inner + outer) / 2, .46, outer - inner);
  for (const u of [start + 2.4, start + 6.5, end - 2.4]) {
    planter(u, inner + .23, 3.75, .46);
    const v = 5.35, [x, y, z] = point(u, v, .16);
    s.drum(iron, x, z, .055, .042, y, y + .69, 8, { solid: false });
    s.drum(seat, x, z, .38, .38, y + .69, y + .75, 12, { solid: false });
    for (const side of [-1, 1]) {
      const chair = u + side * .61;
      box(iron, chair, v, .53, .35, .42, .055);
      box(seat, chair + side * .18, v, .79, .05, .42, .24);
      for (const a of [-.13, .13]) for (const b of [-.16, .16]) box(iron, chair + a, v + b, .34, .035, .035, .36);
      box(iron, chair + side * .16, v, .63, .04, .055, .26);
    }
  }
  const poles = [start + .35, (start + end) / 2, end - .35];
  for (const u of poles) s.rod(iron, point(u, inner + .16, .17), point(u, inner + .16, 2.55), .032);
  for (let i = 1; i < poles.length; i++) {
    const low = (poles[i] + poles[i - 1]) / 2;
    s.rod(iron, point(poles[i - 1], inner + .16, 2.54), point(low, inner + .16, 2.32), .011, .011, 4);
    s.rod(iron, point(low, inner + .16, 2.32), point(poles[i], inner + .16, 2.54), .011, .011, 4);
    for (let j = 1; j <= 5; j++) {
      const t = j / 6, u = poles[i - 1] + t * (poles[i] - poles[i - 1]);
      s.place(kit.bulb, new THREE.SphereGeometry(.047, 6, 4), ...point(u, inner + .16, 2.28 + .22 * Math.abs(2 * t - 1)));
    }
  }
}

function addBanner(s: Shapes, kit: SiteKit, height: Height) {
  // Tension cable from the street-facing walls of the oriel block and Rising Eagle.
  const point = (east: number, up: number): V3 => { const [x, z] = mainStreetPoint(60, east); return [x, height(x, z) + up, z]; };
  const top = 6.3, width = 4.9;
  for (const [wall, edge] of [[-10.86, -width / 2], [9.25, width / 2]]) s.rod(kit.iron, point(wall, top + .48), point(edge, top), .014, .014, 5);
  const label = kit.sign('DOWNTOWN MELROSE', { color: '#ffefce', background: '#304969', aspect: 7.4, border: true });
  for (const face of [-1, 1]) {
    const [x, z] = mainStreetPoint(60 + face * .009, 0);
    s.place(label, new THREE.PlaneGeometry(width, .66), x, height(x, z) + top - .33, z, MAIN_STREET_HEADING + (face < 0 ? Math.PI : 0));
  }
}

export function buildMainStreetFurniture(height: Height, lampMat: THREE.Material, mobile: boolean) {
  const group = new THREE.Group(), kit = siteKit(mobile), s = new Shapes();
  group.name = 'Downtown Melrose street furniture';
  addLamps(group, kit, lampMat, height);
  for (const [i, [x, z]] of mainStreetCrossingPosts.entries()) {
    const y = height(x, z) + .02, yaw = MAIN_STREET_HEADING + (i ? Math.PI : 0);
    s.rod(kit.steel, [x, y, z], [x, y + 3.17, z], .045, .039, 7);
    s.place(crossingSign(), new THREE.PlaneGeometry(1.0, 1.31), x + Math.sin(yaw) * .06, y + 2.39, z + Math.cos(yaw) * .06, yaw);
  }
  addParklet(s, kit, height);
  addBanner(s, kit, height);
  group.add(...s.meshes('Main Street parklet, pedestrian signs and banner'));
  return { group, solid: Float32Array.from(s.solid) };
}
