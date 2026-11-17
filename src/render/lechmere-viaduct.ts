import * as THREE from 'three';
import type { Building, CityData } from '../types';
import { lechmereViaductParts, viaductLayout, SCIENCE_PARK_STATION, VIADUCT_SOLID, type ViaductMaterial } from '../simulation/lechmere-viaduct.ts';
import { canvasTexture, seeded } from './materials';

/** The pierced concrete balustrade: two metres of bays, slots a hand wide between plain posts. */
function balustradeTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256; const c = canvas.getContext('2d')!, random = seeded(4127);
  c.fillStyle = '#b4ad9c'; c.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 900; i++) { c.fillStyle = random() < .5 ? '#00000010' : '#ffffff12'; c.fillRect(random() * 512, random() * 256, 2 + random() * 5, 1 + random() * 3); }
  c.fillStyle = '#a39c8b'; c.fillRect(0, 0, 512, 34); c.fillRect(0, 214, 512, 42);
  for (let x = 0; x < 512; x += 256) { c.fillStyle = '#a8a190'; c.fillRect(x, 0, 30, 256); for (let k = 0; k < 7; k++) { const sx = x + 44 + k * 30; c.fillStyle = '#2a2a27'; c.fillRect(sx, 52, 13, 148); c.fillStyle = '#00000035'; c.fillRect(sx + 13, 52, 3, 148); c.fillStyle = '#ffffff25'; c.fillRect(sx - 2, 52, 2, 148); } }
  const map = canvasTexture(canvas, true); map.repeat.set(.5, 1); return map;
}
/** Board-formed concrete, weathered: four metres square. */
function concreteTexture(seed: number, base: string) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const c = canvas.getContext('2d')!, random = seeded(seed);
  c.fillStyle = base; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { c.fillStyle = random() < .55 ? '#00000009' : '#ffffff0b'; c.fillRect(random() * 256, random() * 256, 1 + random() * 9, 1 + random() * 3); }
  for (let i = 0; i < 26; i++) { const x = random() * 256, y = random() * 256; c.fillStyle = '#3a342a14'; c.fillRect(x, y, 2 + random() * 3, 20 + random() * 70); }
  for (let y = 0; y < 256; y += 64) { c.fillStyle = '#00000012'; c.fillRect(0, y, 256, 1); }
  const map = canvasTexture(canvas, true); map.repeat.set(.25, .25); return map;
}

const stationFinishes = new Map<boolean, THREE.MeshStandardMaterial>();
/** Science Park/West End station, where the viaduct lands: the survey's shell of its platforms, canopies and stair
 * towers is concrete and steel, not a neighbourhood's brick with windows. Undefined for any other building. */
export function stationShellMaterial(building: Building | undefined, isRoof: boolean): THREE.Material | undefined {
  if (building?.id !== SCIENCE_PARK_STATION) return undefined;
  let material = stationFinishes.get(isRoof);
  if (!material) { material = new THREE.MeshStandardMaterial(isRoof ? { color: '#55605b', roughness: .7, metalness: .25 } : { color: '#b4ae9f', roughness: .92 }); material.name = `Science Park station ${isRoof ? 'decks and canopies' : 'concrete'}`; stationFinishes.set(isRoof, material); }
  return material;
}

/** The Lechmere Viaduct beside Charles River Dam Road: drawn whole and always present, like the river's other bridges.
 * Its concrete, granite, steel and ballast are also the collision mesh. See simulation/lechmere-viaduct.ts. */
export function addLechmereViaduct(scene: THREE.Object3D, city: CityData, mobile = false) {
  const group = new THREE.Group(); group.name = 'Lechmere Viaduct'; const collisions: { id: string; vertices: Float32Array; indices: Uint32Array }[] = [];
  // Only beside the dam road the metro package carries.
  if (!city.roads.some(road => road.id === '10965-0-0')) return { group, collisions };
  const parts = lechmereViaductParts(city), plain = (color: string, roughness = .9, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
  const materials: Record<ViaductMaterial, THREE.Material> = {
    concrete: mobile ? plain('#b9b2a1') : new THREE.MeshStandardMaterial({ map: concreteTexture(811, '#bbb4a3'), roughness: .93, side: THREE.DoubleSide }),
    panel: mobile ? plain('#9f9887') : new THREE.MeshStandardMaterial({ map: concreteTexture(977, '#a19a89'), roughness: 1, side: THREE.DoubleSide }),
    granite: plain('#8b8882', .85), steel: plain('#3f5d4d', .6, .45), iron: plain('#1b1d1e', .55, .5), ballast: plain('#6f6a61', 1), rail: plain('#8d9093', .35, .85),
    balustrade: new THREE.MeshStandardMaterial({ map: balustradeTexture(), roughness: .93, side: THREE.DoubleSide }), apron: plain('#8f8c85', 1), louvre: plain('#3b423f', .7, .2),
  };
  let triangles = 0;
  for (const name of Object.keys(parts.positions) as ViaductMaterial[]) {
    const positions = new Float32Array(parts.positions[name]); if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(parts.uvs[name]), 2));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, materials[name]); mesh.name = `Lechmere Viaduct ${name}`; mesh.castShadow = name !== 'apron' && name !== 'rail'; mesh.receiveShadow = true; group.add(mesh); triangles += positions.length / 9;
    if (VIADUCT_SOLID.includes(name)) collisions.push({ id: 'lechmere-viaduct', vertices: positions, indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) });
  }
  const layout = viaductLayout();
  group.userData = { arches: parts.arches, spans: layout.spans.length, piers: layout.piers.length, poles: parts.poles, triangles, lengthMeters: layout.end - layout.start, accuracy: 'Alignment from the mapped tracks; spans, heights and details interpreted from photographs. No trains run on it.' };
  scene.add(group); return { group, collisions };
}
