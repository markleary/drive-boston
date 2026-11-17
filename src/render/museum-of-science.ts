import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building, CityData } from '../types';
import { sampleElevation } from '../simulation/terrain.ts';
import { MUSEUM, MUSEUM_ROLES, museumTurbines, museumStatue, type MuseumRole } from '../simulation/museum-of-science.ts';
import { canvasTexture, seeded } from './materials';
import { lettering } from './landmark-model.ts';

/** The Museum of Science on the Charles River Dam keeps its surveyed shells (fifteen of them: the 1951 east wing,
 * the 1961 central building and tower, the 1972 west wing, the planetarium, the Omni theater's drum, the garage in
 * Cambridge) and gets the finishes the survey has no word for, plus what it leaves out: the tower's white block,
 * steeple and lettering, the planetarium's dome, the roof turbines and the Tyrannosaurus by the drive.
 * Finishes and additions are an interpretation from photographs. */
export const isMuseumOfScience = (building?: Building) => !!building && building.id in MUSEUM_ROLES;

type Paint = (c: CanvasRenderingContext2D, e: CanvasRenderingContext2D, random: () => number) => void;
const S = 512 / 6;
function bricks(c: CanvasRenderingContext2D, random: () => number, base: string) {
  c.fillStyle = base; c.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 80; row++) for (let col = -1; col < 28; col++) {
    const x = col * 19 + (row % 2) * 9.5, y = row * 6.4, shade = random();
    c.fillStyle = shade < .16 ? '#00000026' : shade > .86 ? '#ffd9c21c' : '#0000000a'; c.fillRect(x + .6, y + .6, 17.8, 5.2);
  }
  c.fillStyle = '#cbb9a324'; for (let row = 0; row <= 80; row++) c.fillRect(0, row * 6.4, 512, .7);
}
const PAINT: Record<Exclude<MuseumRole, 'tower' | 'omni'> | 'brick', Paint> = {
  // Blank brick: the tower's shaft and the theater's drum.
  brick(c, _e, random) { bricks(c, random, '#7b4a3c'); },
  // The wings: red brick between white concrete bands, a strip of windows under the upper band of each storey pair.
  wing(c, e, random) {
    bricks(c, random, '#7d4b3d');
    for (const y of [0, 256]) {
      c.fillStyle = '#d9d5c9'; c.fillRect(0, y, 512, 26); c.fillStyle = '#00000022'; c.fillRect(0, y + 26, 512, 3);
      if (y === 0) continue;
      c.fillStyle = '#d2cec2'; c.fillRect(0, y + 60, 512, 112);
      for (let x = 6; x < 512; x += 64) { c.fillStyle = '#1c2a30'; c.fillRect(x, y + 68, 52, 96); c.fillStyle = '#5d7c8a40'; c.fillRect(x, y + 68, 52, 30); if (random() < .45) { e.fillStyle = '#ffe2a8'; e.fillRect(x, y + 68, 52, 96); } }
    }
  },
  // The central building: a white concrete frame, glass and grey spandrels in every bay.
  central(c, e, random) {
    c.fillStyle = '#e4e1d6'; c.fillRect(0, 0, 512, 512);
    for (let floor = 0; floor < 2; floor++) for (let bay = 0; bay < 3; bay++) {
      const x = bay * 512 / 3 + 13, y = floor * 256 + 22, w = 512 / 3 - 26;
      c.fillStyle = '#9aa3a2'; c.fillRect(x, y + 150, w, 84); c.fillStyle = '#20323a'; c.fillRect(x, y, w, 150); c.fillStyle = '#7fa2b02e'; c.fillRect(x, y, w, 52);
      c.fillStyle = '#cfccc0'; c.fillRect(x + w / 2 - 2, y, 4, 150);
      if (random() < .5) { e.fillStyle = '#ffe6b5'; e.fillRect(x, y, w, 150); }
    }
    c.fillStyle = '#00000018'; for (let i = 0; i < 500; i++) c.fillRect(random() * 512, random() * 512, 1 + random() * 4, 1);
  },
  // The planetarium's drum and the low rear buildings: smooth painted concrete.
  planetarium(c, _e, random) { c.fillStyle = '#e3e0d6'; c.fillRect(0, 0, 512, 512); for (let i = 0; i < 1400; i++) { c.fillStyle = random() < .5 ? '#0000000b' : '#ffffff12'; c.fillRect(random() * 512, random() * 512, 2 + random() * 7, 1 + random() * 2); } c.fillStyle = '#00000014'; for (let x = 0; x < 512; x += 128) c.fillRect(x, 0, 2, 512); },
  low(c, _e, random) { c.fillStyle = '#b9b4a6'; c.fillRect(0, 0, 512, 512); for (let i = 0; i < 1400; i++) { c.fillStyle = random() < .5 ? '#0000000b' : '#ffffff12'; c.fillRect(random() * 512, random() * 512, 2 + random() * 7, 1 + random() * 2); } c.fillStyle = '#00000018'; c.fillRect(0, 250, 512, 3); },
  // The garage: concrete spandrel bands, the open decks dark between them, a column every six metres.
  garage(c, e, random) {
    c.fillStyle = '#16191a'; c.fillRect(0, 0, 512, 512);
    for (let floor = 0; floor < 4; floor++) { const y = 512 - (floor + 1) * 128; c.fillStyle = '#c3bfb3'; c.fillRect(0, y + 78, 512, 50); c.fillStyle = '#00000030'; c.fillRect(0, y + 78, 512, 3); c.fillStyle = '#ffffff18'; c.fillRect(0, y + 122, 512, 6); if (random() < .5) { e.fillStyle = '#6b6450'; e.fillRect(0, y + 8, 512, 60); } }
    c.fillStyle = '#b7b3a7'; c.fillRect(0, 0, 3 * S / 10, 512); c.fillRect(512 - 3 * S / 10, 0, 3 * S / 10, 512);
    for (let i = 0; i < 700; i++) { c.fillStyle = '#0000000d'; c.fillRect(random() * 512, random() * 512, 2 + random() * 6, 1); }
  },
};
const finishes = new Map<string, THREE.MeshStandardMaterial>(); let night = false;
function finishFor(kind: keyof typeof PAINT) {
  let material = finishes.get(kind);
  if (!material) {
    const canvas = document.createElement('canvas'), glow = document.createElement('canvas'); canvas.width = canvas.height = glow.width = glow.height = 512;
    const c = canvas.getContext('2d')!, e = glow.getContext('2d')!; e.fillStyle = '#000'; e.fillRect(0, 0, 512, 512); PAINT[kind](c, e, seeded(7717 + kind.length * 131));
    material = new THREE.MeshStandardMaterial({ map: canvasTexture(canvas, true), emissiveMap: canvasTexture(glow, true), emissive: '#ffffff', emissiveIntensity: night ? .7 : .006, roughness: kind === 'central' ? .7 : .9 });
    material.name = `Museum of Science ${kind}`; finishes.set(kind, material);
  }
  return material;
}
const roofs = new Map<string, THREE.MeshStandardMaterial>();
const roof = (color: string) => { let m = roofs.get(color); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: .9 }); roofs.set(color, m); } return m; };
export function setMuseumNight(value: boolean) { night = value; for (const material of finishes.values()) material.emissiveIntensity = night ? .7 : .006; }

/** The finish of one of the Museum's surveyed shells, or undefined for any other building. */
export function museumShellMaterial(building: Building | undefined, isRoof: boolean): THREE.Material | undefined {
  const role = building ? MUSEUM_ROLES[building.id] : undefined; if (!role) return undefined;
  if (isRoof) return roof(role === 'planetarium' ? '#deddd6' : role === 'garage' ? '#6d6f6c' : '#5b5d5a');
  return finishFor(role === 'tower' || role === 'omni' ? 'brick' : role);
}

/** What the survey leaves out. World coordinates measured on the packaged shells (tests hold them to the tiles). */
export function addMuseumOfScience(scene: THREE.Object3D, city: CityData) {
  const group = new THREE.Group(); group.name = 'Museum of Science details';
  if (!city.landmarks.some(l => l.id === 'museum-of-science')) return { group };
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>(), add = (g: THREE.BufferGeometry, m: THREE.Material) => { const list = batches.get(m) ?? []; list.push(g); batches.set(m, list); };
  const white = new THREE.MeshStandardMaterial({ color: '#e9e7de', roughness: .8 }), aluminium = new THREE.MeshStandardMaterial({ color: '#c3c8ca', metalness: .85, roughness: .32 });
  const dome = new THREE.MeshStandardMaterial({ color: '#eceae2', roughness: .55 }), hide = new THREE.MeshStandardMaterial({ color: '#66705a', roughness: .85 }), dark = new THREE.MeshStandardMaterial({ color: '#2c302f', roughness: .7 });
  const steel = new THREE.MeshStandardMaterial({ color: '#d9dcdc', metalness: .5, roughness: .45 }), plinth = new THREE.MeshStandardMaterial({ color: '#a7a399', roughness: .95 });
  /** A vertical prism on a convex outline. */
  const prism = (outline: readonly (readonly [number, number])[], y0: number, y1: number, scale = 1) => {
    const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cz = outline.reduce((s, p) => s + p[1], 0) / outline.length, points = outline.map(p => [cx + (p[0] - cx) * scale, cz + (p[1] - cz) * scale]), positions: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      positions.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1], cx, y1, cz, a[0], y1, a[1], b[0], y1, b[1]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3)); return g;
  };
  // The tower: a white block over the brick shaft, an aluminium steeple and its weathervane, and the name on three faces.
  const tower = MUSEUM.tower, [tx, tz] = tower.centre, heading = Math.atan2(tower.faces[0].normal[0], tower.faces[0].normal[1]);
  add(prism(tower.outline, tower.top - .25, tower.top + .3, 1.05), white); add(prism(tower.outline, tower.top + .3, tower.top + 3.4, .9), white); add(prism(tower.outline, tower.top + 3.4, tower.top + 3.75, .96), white);
  add(new THREE.ConeGeometry(2.6, 9.5, 4, 1).rotateY(heading + Math.PI / 4).translate(tx, tower.top + 3.75 + 4.75, tz), aluminium);
  add(new THREE.CylinderGeometry(.07, .1, 4.2, 6).translate(tx, tower.top + 13.25 + 2.1, tz), aluminium); add(new THREE.SphereGeometry(.28, 10, 8).translate(tx, tower.top + 15.6, tz), aluminium);
  add(new THREE.BoxGeometry(1.7, .16, .05).rotateY(.6).translate(tx, tower.top + 16.6, tz), aluminium); add(new THREE.ConeGeometry(.22, .6, 4).rotateZ(-Math.PI / 2).rotateY(.6).translate(tx + Math.cos(.6) * 1.05, tower.top + 16.6, tz - Math.sin(.6) * 1.05), aluminium);
  const letters = [lettering('MUSEUM', '#f3f0e4', '700 96px Georgia, serif'), lettering('OF', '#f3f0e4', '700 96px Georgia, serif'), lettering('SCIENCE', '#f3f0e4', '700 96px Georgia, serif')];
  for (const face of tower.faces) for (const [i, material] of letters.entries()) {
    const width = Math.min(face.length - 1.4, 6.2), plate = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), material);
    plate.position.set(face.mid[0] + face.normal[0] * .09, tower.top - 2.2 - i * (width / 4 + .15), face.mid[1] + face.normal[1] * .09); plate.rotation.y = Math.atan2(face.normal[0], face.normal[1]); plate.name = 'Museum of Science tower lettering'; group.add(plate);
  }
  // The Charles Hayden Planetarium: a white dome on its drum.
  const [px, pz] = MUSEUM.planetarium.centre, drum = MUSEUM.planetarium.top, radius = MUSEUM.planetarium.radius;
  add(new THREE.CylinderGeometry(radius + .25, radius + .25, .5, 40).translate(px, drum + .1, pz), white);
  add(new THREE.SphereGeometry(radius - .7, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .72, 1).translate(px, drum + .3, pz), dome);
  // The Wind Turbine Lab: small machines on masts along the roofs.
  for (const turbine of museumTurbines()) {
    const [x, y, z] = turbine.position, hub = y + turbine.mast;
    add(new THREE.CylinderGeometry(.07, .11, turbine.mast, 8).translate(x, y + turbine.mast / 2, z), steel);
    add(new THREE.CylinderGeometry(.16, .16, .9, 8).rotateX(Math.PI / 2).rotateY(turbine.yaw).translate(x, hub, z), steel);
    for (let blade = 0; blade < 3; blade++) add(new THREE.BoxGeometry(.2, turbine.rotor, .04).translate(0, turbine.rotor / 2, 0).rotateZ(blade * Math.PI * 2 / 3 + turbine.phase).translate(0, 0, .5).rotateY(turbine.yaw).translate(x, hub, z), steel);
  }
  // The Tyrannosaurus by the drive: the old upright, tail-dragging pose, on a low plinth, looking at the road.
  const statue = museumStatue(), ground = sampleElevation(city, statue.x, statue.z), rex: [THREE.BufferGeometry, THREE.Material][] = [];
  const part = (g: THREE.BufferGeometry, m: THREE.Material = hide) => rex.push([g, m]);
  part(new THREE.BoxGeometry(3.2, .35, 7.2).translate(0, .175, -.6), plinth);
  part(new THREE.SphereGeometry(1, 14, 10).scale(1.05, 1.9, 1.25).rotateX(-.62).translate(0, 3.25, .2));
  part(new THREE.ConeGeometry(.85, 5.6, 10).rotateX(-Math.PI / 2 - .5).translate(0, 1.45, -3.1));
  part(new THREE.CylinderGeometry(.5, .78, 1.7, 10).rotateX(-.35).translate(0, 4.85, 1.05));
  part(new THREE.BoxGeometry(.95, .95, 1.9).translate(0, 5.65, 1.9)); part(new THREE.BoxGeometry(.8, .3, 1.5).rotateX(.22).translate(0, 5.02, 1.95)); part(new THREE.BoxGeometry(.84, .12, 1.2).translate(0, 5.22, 2.15), dark);
  for (const side of [-1, 1]) {
    part(new THREE.CylinderGeometry(.42, .3, 1.9, 8).rotateX(.35).translate(side * .72, 2.05, .35)); part(new THREE.CylinderGeometry(.24, .2, 1.5, 8).rotateX(-.3).translate(side * .72, .95, .5));
    part(new THREE.BoxGeometry(.6, .28, 1.25).translate(side * .72, .49, .95)); part(new THREE.CylinderGeometry(.1, .07, .8, 6).rotateX(1.1).translate(side * .55, 3.9, 1.35));
    part(new THREE.SphereGeometry(.09, 6, 5).translate(side * .34, 5.86, 2.45), dark);
  }
  for (const [g, m] of rex) add(g.translate(0, 0, .6).rotateY(statue.yaw).translate(statue.x, ground, statue.z), m);
  for (const [material, geometries] of batches) {
    const flat = geometries.map(g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); if (!n.getAttribute('normal')) n.computeVertexNormals(); return n; }), merged = mergeGeometries(flat, false)!;
    new Set([...geometries, ...flat]).forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, material); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Museum of Science details'; group.add(mesh);
  }
  group.userData = { turbines: museumTurbines().length, statue: [statue.x, statue.z], towerTop: tower.top + 17, accuracy: 'Surveyed shells; finishes, the tower crown, dome, turbines and statue interpreted from photographs' };
  scene.add(group); return { group };
}
