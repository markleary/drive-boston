import * as THREE from 'three';
import type { Building, CityData } from '../types';
import { landmarkBuildings, isMetroCity } from '../simulation/city-tiles.ts';
import { closestRoad } from '../simulation/roads.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import type { createMaterials } from './materials';
import { textSign } from './materials';

type Materials = ReturnType<typeof createMaterials>;

/** Shell finishes for the metro landmarks the build tags by survey ID or by a
 * covering point. The original Copley Square three keep their authored
 * treatment in world.ts; everything else maps to a material family that
 * matches the real building's masonry, concrete or curtain wall. */
const SHELLS: Record<string, { style?: number; key?: 'glass' | 'library' | 'church'; color?: string; roofColor?: string }> = {
  'faneuil-hall': { style: 0, roofColor: '#5d6a5e' }, 'quincy-market': { style: 4 }, 'custom-house': { style: 4 }, 'old-north-church': { style: 0, roofColor: '#4a4f4c' },
  'old-state-house': { style: 0, roofColor: '#555b58' }, 'city-hall': { style: 8 }, 'museum-of-science': { style: 8 }, 'south-station': { style: 3 }, 'park-street-church': { style: 0, roofColor: '#4a4f4c' },
  'kings-chapel': { style: 4 }, 'old-south-meeting-house': { style: 0, roofColor: '#4a4f4c' }, 'millennium-tower': { key: 'glass' }, 'convention-center': { style: 9 }, 'zakim-bridge': { color: '#c5c9c6' },
  'mit-dome': { key: 'library', roofColor: '#9aa29f' }, 'widener-library': { key: 'library' }, 'stata-center': { style: 9, roofColor: '#8c9094' }, 'cambridge-city-hall': { style: 2, roofColor: '#4e4a44' }, 'massachusetts-hall': { style: 0, roofColor: '#4a4f4c' },
  'bunker-hill-monument': { color: '#9c9a92' }, 'td-garden': { style: 8 }, 'jfk-library': { color: '#e3e3dc', roofColor: '#cfd0ca' }, 'harvard-stadium': { color: '#b7b2a6' }, 'memorial-hall': { style: 1, roofColor: '#56504a' },
  'dorchester-heights-monument': { color: '#e8e6df' }, 'fort-independence': { color: '#8f8d85' }, 'prospect-hill-tower': { color: '#8a857a' }, 'logan-terminal': { style: 9 },
};
const plainMaterials = new Map<string, THREE.MeshStandardMaterial>();
const plain = (color: string) => { let m = plainMaterials.get(color); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: .88 }); plainMaterials.set(color, m); } return m; };

/** The shell material for a landmark building, or undefined for ordinary massing rules. */
export function landmarkShellMaterial(building: Building | undefined, isRoof: boolean, materials: Materials): THREE.Material | undefined {
  const shell = building?.landmark ? SHELLS[building.landmark] : undefined; if (!shell) return undefined;
  if (isRoof) return shell.roofColor ? plain(shell.roofColor) : undefined;
  if (shell.key) return materials[shell.key];
  if (shell.style !== undefined) return materials.facades[shell.style];
  return shell.color ? plain(shell.color) : undefined;
}

export interface MetroLandmarkDetails { group: THREE.Group; collisions: { id: string; vertices: Float32Array; indices: Uint32Array }[]; setNight(night: boolean): void; }

// South Station's headhouse carries its own lettering and lamps (south-station.ts).
const SIGNS: Record<string, string> = { 'td-garden': 'TD GARDEN', 'quincy-market': 'QUINCY MARKET', 'museum-of-science': 'MUSEUM OF SCIENCE', 'harvard-stadium': 'HARVARD STADIUM', 'jfk-library': 'JOHN F. KENNEDY LIBRARY', 'convention-center': 'BOSTON CONVENTION & EXHIBITION CENTER', 'logan-terminal': 'LOGAN AIRPORT' };
const CROWNS = new Set(['custom-house', 'millennium-tower', 'stata-center', 'td-garden', 'convention-center']);
const MONUMENTS: Record<string, { kind: 'obelisk' | 'tower' | 'round'; height: number; width: number; color: string; minimumSurveyed: number }> = {
  'bunker-hill-monument': { kind: 'obelisk', height: 67, width: 9.1, color: '#a09e96', minimumSurveyed: 40 },
  'dorchester-heights-monument': { kind: 'tower', height: 35, width: 7.5, color: '#e8e6df', minimumSurveyed: 20 },
  'prospect-hill-tower': { kind: 'round', height: 14, width: 7, color: '#8a857a', minimumSurveyed: 9 },
};

/** Night-lit crowns, entrance signage, dome finials and the monuments the
 * survey models omit. Everything here is anchored to the real footprint or
 * mapped point; the decoration itself is an interpretation. */
export function addMetroLandmarkDetails(scene: THREE.Scene, city: CityData): MetroLandmarkDetails {
  const group = new THREE.Group(); group.name = 'Metro landmark treatment'; scene.add(group);
  const collisions: MetroLandmarkDetails['collisions'] = [];
  const crownMaterial = new THREE.MeshStandardMaterial({ color: '#f1e3c3', emissive: '#ffd58a', emissiveIntensity: .08, roughness: .45 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a455', metalness: .75, roughness: .3 });
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const list = batches.get(m) ?? []; list.push(g); batches.set(m, list); };
  const buildings = landmarkBuildings(city), byLandmark = new Map(buildings.filter(b => b.landmark).map(b => [b.landmark!, b]));
  let crowns = 0, signs = 0, monuments = 0, finials = 0;
  const top = (b: Building) => (b.baseElevation ?? sampleElevation(city, ...b.center)) + b.height;
  const edges = (b: Building) => b.footprint.map((a, i) => { const c = b.footprint[(i + 1) % b.footprint.length]; const dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz); return { a, c, dx, dz, length, mx: (a[0] + c[0]) / 2, mz: (a[1] + c[1]) / 2, nx: dz / (length || 1), nz: -dx / (length || 1) }; }).filter(e => e.length > .5);
  for (const [key, b] of byLandmark) {
    if (CROWNS.has(key) && b.height > 12) {
      // A continuous light band just under the parapet, outside the surveyed wall.
      const y = top(b) - Math.min(2.2, b.height * .08);
      for (const e of edges(b)) {
        const g = new THREE.BoxGeometry(e.length + .3, .35, .22).rotateY(Math.atan2(e.dx, e.dz) + Math.PI / 2).translate(e.mx + e.nx * .28, y, e.mz + e.nz * .28);
        add(g, crownMaterial);
      }
      crowns++;
    }
    const text = SIGNS[key];
    if (text && b.height > 6) {
      // The sign faces the street: the long wall whose outward normal points at the nearest major road.
      let best: ReturnType<typeof edges>[number] | undefined, score = -Infinity;
      for (const e of edges(b)) {
        if (e.length < 14) continue;
        const road = closestRoad(city, e.mx + e.nx * 6, e.mz + e.nz * 6, true), facing = ((road.x - e.mx) * e.nx + (road.z - e.mz) * e.nz) / Math.max(1, road.distance);
        const value = facing * 40 + Math.min(e.length, 80) * .3 - road.distance * .2; if (value > score) { score = value; best = e; }
      }
      if (best) {
        const width = Math.min(best.length * .7, Math.max(10, text.length * .9)), height = width / text.length * 1.9;
        const y = (b.baseElevation ?? sampleElevation(city, ...b.center)) + Math.min(b.height - height, Math.max(6.5, b.height * .35));
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(width, height), textSign(text, '#efe6cf', '#1f2b2a', 1024, Math.round(1024 * height / width)));
        plate.position.set(best.mx + best.nx * .32, y, best.mz + best.nz * .32); plate.rotation.y = Math.atan2(best.nx, best.nz); plate.name = `Landmark sign: ${text}`; group.add(plate);
        add(new THREE.BoxGeometry(width + .4, height + .4, .12).rotateY(Math.atan2(best.nx, best.nz)).translate(best.mx + best.nx * .2, y, best.mz + best.nz * .2), plain('#2b2f2d'));
        signs++;
      }
    }
    if (key === 'mit-dome' || key === 'cambridge-city-hall') {
      const y = top(b); add(new THREE.SphereGeometry(key === 'mit-dome' ? .9 : .5, 12, 8).translate(b.center[0], y + (key === 'mit-dome' ? 1.4 : 1.1), b.center[1]), brass);
      add(new THREE.CylinderGeometry(.18, .32, key === 'mit-dome' ? 1.6 : 1.2, 8).translate(b.center[0], y + .6, b.center[1]), brass); finials++;
    }
  }
  for (const [key, spec] of Object.entries(MONUMENTS)) {
    const surveyed = byLandmark.get(key), landmark = city.landmarks.find(l => l.id === key);
    if (!landmark || (surveyed && surveyed.height >= spec.minimumSurveyed)) continue;
    const [x, z] = landmark.position, ground = sampleElevation(city, x, z), material = plain(spec.color), parts: THREE.BufferGeometry[] = [];
    if (spec.kind === 'obelisk') {
      const base = spec.width * 1.6;
      parts.push(new THREE.BoxGeometry(base, 1.2, base).translate(x, ground + .6, z));
      parts.push(new THREE.CylinderGeometry(spec.width * .32, spec.width * .5, spec.height - 4, 4, 1).rotateY(Math.PI / 4).translate(x, ground + 1.2 + (spec.height - 4) / 2, z));
      parts.push(new THREE.ConeGeometry(spec.width * .33, 3, 4).rotateY(Math.PI / 4).translate(x, ground + spec.height - 2.8 + 1.5, z));
    } else if (spec.kind === 'tower') {
      parts.push(new THREE.BoxGeometry(spec.width * 1.5, 2.5, spec.width * 1.5).translate(x, ground + 1.25, z));
      parts.push(new THREE.BoxGeometry(spec.width, spec.height - 8, spec.width).translate(x, ground + 2.5 + (spec.height - 8) / 2, z));
      parts.push(new THREE.CylinderGeometry(spec.width * .36, spec.width * .36, 3.6, 10).translate(x, ground + spec.height - 5.5 + 1.8, z));
      parts.push(new THREE.ConeGeometry(spec.width * .4, 3.2, 10).translate(x, ground + spec.height - 1.9 + 1.6, z));
    } else {
      parts.push(new THREE.CylinderGeometry(spec.width / 2, spec.width / 2 + .4, spec.height, 14).translate(x, ground + spec.height / 2, z));
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; parts.push(new THREE.BoxGeometry(1.1, 1.3, 1).rotateY(-a).translate(x + Math.sin(a) * (spec.width / 2 - .2), ground + spec.height + .65, z + Math.cos(a) * (spec.width / 2 - .2))); }
    }
    for (const g of parts) {
      add(g, material);
      const p = g.getAttribute('position'), vertices = new Float32Array(p.array as Float32Array), indices = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: p.count }, (_, i) => i);
      collisions.push({ id: key, vertices, indices });
    }
    monuments++;
  }
  for (const [material, geometries] of batches) {
    const normalized = geometries.map(g => g.index ? g.toNonIndexed() : g), merged = normalized.length ? mergeAll(normalized) : undefined;
    new Set([...geometries, ...normalized]).forEach(g => { if (g !== merged) g.dispose(); });
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material); mesh.castShadow = material !== crownMaterial; mesh.receiveShadow = true; mesh.name = 'Metro landmark accents'; group.add(mesh);
  }
  group.userData = { crowns, signs, monuments, finials, metro: isMetroCity(city), accuracy: 'Finishes by landmark identity; signage, crown lighting and the three monument masses are interpretive' };
  return { group, collisions, setNight(night) { crownMaterial.emissiveIntensity = night ? 2.6 : .08; } };
}

function mergeAll(geometries: THREE.BufferGeometry[]) {
  let count = 0; for (const g of geometries) count += g.getAttribute('position').count;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3); let offset = 0;
  for (const g of geometries) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    positions.set(g.getAttribute('position').array as Float32Array, offset * 3); normals.set(g.getAttribute('normal').array as Float32Array, offset * 3); offset += g.getAttribute('position').count;
  }
  const merged = new THREE.BufferGeometry(); merged.setAttribute('position', new THREE.BufferAttribute(positions, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); merged.computeBoundingSphere(); return merged;
}
