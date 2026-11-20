import * as THREE from 'three';
import type { Building, CityData } from '../types';
import { LOGAN_COMPLEX, loganComplexPart, loganRole, type AirfieldData, type LoganFinish, type LoganPart } from '../simulation/logan-airfield.ts';
export { LOGAN_COMPLEX };
import { canvasTexture, seeded } from './materials';

/** Finishes for Logan's surveyed buildings. The survey has their forms (the terminals and their piers, the central
 * garage, the hangars and cargo sheds, the control tower); the ordinary massing rules gave them office windows and
 * brick. A building whose centre lies inside the airport's outline (`airfield.json`) is finished here instead:
 *
 * - the terminal complex, one survey mesh, is split triangle by triangle: glazed curtain wall and a pale roof inside
 *   a terminal's mapped outline, the red roof of Terminal E's 2023 extension west of `E_EXTENSION`, and concrete
 *   parking decks everywhere else (the central garage and the walkways to it);
 * - the control tower is board-marked concrete with its glazed levels at the top;
 * - a low building over `HANGAR_AREA` is a hangar or a cargo shed in ribbed metal; the small ones are plant and
 *   service buildings in the same siding;
 * - anything taller than `KEEP_HEIGHT` (the hotels, the office buildings) keeps its ordinary facade.
 * Textures sit on the shells' stabilised wall UVs: six metres a repeat, v from the base. */
type Finish = LoganFinish;

const PAINT: Record<Finish, (c: CanvasRenderingContext2D, e: CanvasRenderingContext2D, random: () => number) => void> = {
  // Curtain wall: a dark glazed band a storey between pale metal spandrels, a mullion every metre and a half.
  terminal(c, e, random) {
    c.fillStyle = '#d3d6d4'; c.fillRect(0, 0, 512, 512);
    for (let floor = 0; floor < 2; floor++) {
      const y = floor * 256;
      c.fillStyle = '#3a5868'; c.fillRect(0, y + 34, 512, 168); c.fillStyle = '#8fb4c64d'; c.fillRect(0, y + 34, 512, 70); c.fillStyle = '#1a2b3540'; c.fillRect(0, y + 150, 512, 52); c.fillStyle = '#00000030'; c.fillRect(0, y + 202, 512, 4);
      c.fillStyle = '#aeb3b2'; for (let x = 0; x < 512; x += 128) c.fillRect(x, y + 34, 5, 168); c.fillStyle = '#b9bdbb'; c.fillRect(0, y + 116, 512, 3);
      for (let x = 0; x < 512; x += 128) if (random() < .45) { e.fillStyle = random() < .5 ? '#8f7f5c' : '#73808a'; e.fillRect(x + 5, y + 34, 123, 168); }
    }
    c.fillStyle = '#0000000c'; for (let i = 0; i < 500; i++) c.fillRect(random() * 512, random() * 512, 2 + random() * 5, 1);
  },
  // Parking decks: concrete spandrels, the open levels dark between them, a column every six metres.
  garage(c, e, random) {
    c.fillStyle = '#15181a'; c.fillRect(0, 0, 512, 512);
    for (let floor = 0; floor < 2; floor++) { const y = floor * 256; c.fillStyle = '#bdbab0'; c.fillRect(0, y + 150, 512, 106); c.fillStyle = '#00000030'; c.fillRect(0, y + 150, 512, 4); c.fillStyle = '#ffffff16'; c.fillRect(0, y + 248, 512, 8); if (random() < .6) { e.fillStyle = '#5a5444'; e.fillRect(0, y + 12, 512, 120); } }
    c.fillStyle = '#b3b0a6'; c.fillRect(0, 0, 26, 512); c.fillRect(486, 0, 26, 512);
    for (let i = 0; i < 700; i++) { c.fillStyle = '#0000000d'; c.fillRect(random() * 512, random() * 512, 2 + random() * 6, 1); }
  },
  // The tower's pylons: pale concrete in lifts, a recessed joint down each face.
  tower(c, _e, random) {
    c.fillStyle = '#cfccc2'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1600; i++) { c.fillStyle = random() < .5 ? '#0000000a' : '#ffffff10'; c.fillRect(random() * 512, random() * 512, 1, 6 + random() * 26); }
    c.fillStyle = '#00000022'; for (const y of [0, 170, 341]) c.fillRect(0, y, 512, 3); c.fillStyle = '#00000018'; c.fillRect(254, 0, 4, 512);
  },
  // Hangars and cargo sheds: white ribbed metal over a grey base course.
  hangar(c, _e, random) {
    c.fillStyle = '#e0e2e1'; c.fillRect(0, 0, 512, 512); c.fillStyle = '#00000012'; for (let x = 0; x < 512; x += 16) c.fillRect(x, 0, 2, 512); c.fillStyle = '#ffffff20'; for (let x = 4; x < 512; x += 16) c.fillRect(x, 0, 2, 512);
    c.fillStyle = '#00000014'; c.fillRect(0, 0, 512, 3); c.fillRect(0, 256, 512, 2);
    for (let i = 0; i < 300; i++) { c.fillStyle = '#0000000a'; c.fillRect(random() * 512, random() * 512, 2, 10 + random() * 60); }
  },
  shed(c, _e, random) {
    c.fillStyle = '#c3c6c4'; c.fillRect(0, 0, 512, 512); c.fillStyle = '#00000014'; for (let x = 0; x < 512; x += 21) c.fillRect(x, 0, 2, 512);
    c.fillStyle = '#00000018'; c.fillRect(0, 0, 512, 3);
    for (let i = 0; i < 300; i++) { c.fillStyle = '#0000000a'; c.fillRect(random() * 512, random() * 512, 2, 10 + random() * 60); }
  },
};
const finishes = new Map<string, THREE.MeshStandardMaterial>(); let night = false;
const GLOW: Partial<Record<Finish, number>> = { terminal: .55, garage: .4 };
function finishFor(kind: Finish) {
  let material = finishes.get(kind);
  if (!material) {
    const canvas = document.createElement('canvas'), glow = document.createElement('canvas'); canvas.width = canvas.height = glow.width = glow.height = 512;
    const c = canvas.getContext('2d')!, e = glow.getContext('2d')!; e.fillStyle = '#000'; e.fillRect(0, 0, 512, 512); PAINT[kind](c, e, seeded(4409 + kind.length * 173));
    material = new THREE.MeshStandardMaterial({ map: canvasTexture(canvas, true), emissiveMap: canvasTexture(glow, true), emissive: '#ffffff', emissiveIntensity: night ? GLOW[kind] ?? 0 : .004, roughness: kind === 'terminal' ? .45 : .88, metalness: kind === 'terminal' ? .2 : 0 });
    material.name = `Logan ${kind}`; finishes.set(kind, material);
  }
  return material;
}
const plains = new Map<string, THREE.MeshStandardMaterial>();
const plain = (color: string, roughness = .9) => { let m = plains.get(color); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness }); m.name = `Logan roof ${color}`; plains.set(color, m); } return m; };
export function setLoganNight(value: boolean) { night = value; for (const [kind, material] of finishes) material.emissiveIntensity = night ? GLOW[kind as Finish] ?? 0 : .004; }

const ROOFS: Record<'roof' | 'red-roof' | 'deck', [string, number]> = { roof: ['#c5c8c4', .85], 'red-roof': ['#b8281f', .5], deck: ['#8d8f8b', .95] };
export const loganPartMaterial = (part: LoganPart): THREE.Material => part === 'roof' || part === 'red-roof' || part === 'deck' ? plain(...ROOFS[part]) : finishFor(part);
/** The finish of an airport building other than the terminal complex, or undefined for any other building. */
export function loganShellMaterial(city: CityData, building: Building | undefined, isRoof: boolean): THREE.Material | undefined {
  const role = loganRole(city.airfield, building); if (!role || role === 'complex') return undefined;
  if (isRoof) return plain(role === 'tower' ? '#70736f' : role === 'hangar' ? '#d2d4d1' : '#a9aca8');
  return finishFor(role);
}

/** The terminal complex's shell by part: each triangle goes by where its middle lies. */
export function splitLoganShell(airfield: AirfieldData, geometry: THREE.BufferGeometry, isRoof: boolean): { kind: LoganPart; geometry: THREE.BufferGeometry }[] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry, p = source.getAttribute('position'), groups = new Map<LoganPart, number[]>();
  for (let i = 0; i < p.count; i += 3) {
    const kind = loganComplexPart(airfield, (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3, isRoof);
    let list = groups.get(kind); if (!list) groups.set(kind, list = []); list.push(i, i + 1, i + 2);
  }
  const parts = [...groups].map(([kind, indices]) => {
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const size = attribute.itemSize, values = new Float32Array(indices.length * size);
      indices.forEach((index, j) => { for (let k = 0; k < size; k++) values[j * size + k] = attribute.getComponent(index, k); });
      part.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    return { kind, geometry: part };
  });
  if (source !== geometry) source.dispose();
  return parts;
}
