import * as THREE from 'three';
import type { CityData } from '../types.ts';
import { CONLEY_BERTH_10_LENGTH, CONLEY_CRANES, CONLEY_EXTENSION, CONLEY_QUAY_LENGTH, CONLEY_YAW, conleyPoint, conleyStacks } from '../simulation/conley-terminal.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { PartBatches, TriangleWriter, box } from './geometry-writer.ts';
import { spatialInstances } from './spatial-batches.ts';

/** Low-profile sliding-boom cranes are essential to Conley's silhouette: no
 * tower or raised A-frame breaches Logan's airspace. All repeated cargo uses
 * one shared corrugated container geometry, batched into local instance cells. */
export function addConleyTerminal(scene: THREE.Object3D, city: CityData, options: { mobile?: boolean } = {}) {
  const group = new THREE.Group(); group.name = 'Paul W. Conley Container Terminal';
  const collisions: { id: string; vertices: Float32Array; indices: Uint32Array }[] = [];
  if (city.bounds.maxX < 3710 || city.bounds.minX > 5000 || city.bounds.maxZ < 870 || city.bounds.minZ > 1250) return { group, collisions, setLighting: (_night: boolean) => {} };
  const finish = (color: string, metalness = .12) => new THREE.MeshStandardMaterial({ color, roughness: .76, metalness });
  const concrete = finish('#aaa99c', 0), pale = finish('#a4bcc0', .35), blue = finish('#245e91', .35);
  const dark = finish('#333f43', .55), steel = finish('#6b7473', .7), yellow = finish('#d6a842', .2), orange = finish('#bb6b2c', .3);
  const white = finish('#e1deca', 0), rubber = finish('#272e30', .02), glass = finish('#263c49', .4);
  const lights = new THREE.MeshStandardMaterial({ color: '#f6e8b5', emissive: '#ffe3a0', emissiveIntensity: .15, roughness: .5 });
  const batches = new PartBatches(240), solids = new TriangleWriter(), matrix = new THREE.Matrix4();
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), CONLEY_YAW), unit = new THREE.Vector3(1, 1, 1);
  const at = (along: number, inland: number, y: number) => { const p = conleyPoint(along, inland); return new THREE.Vector3(p[0], y, p[1]); };
  const part = (w: number, h: number, d: number, p: THREE.Vector3, q: THREE.Quaternion, material: THREE.Material, solid = false) => {
    matrix.compose(p, q, unit); batches.part(box(w, h, d), material, matrix); if (solid) solids.box(box(w, h, d), matrix);
  };
  const place = (w: number, h: number, d: number, s: number, t: number, y: number, material: THREE.Material, solid = false) => part(w, h, d, at(s, t, y), yaw, material, solid);
  const beam = (a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, material: THREE.Material, solid = false) => {
    const delta = b.clone().sub(a); if (delta.lengthSq() < .0001) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.clone().normalize());
    part(w, h, delta.length(), a.clone().add(b).multiplyScalar(.5), q, material, solid);
  };
  const ground = (s: number, t: number) => sampleElevation(city, ...conleyPoint(s, t));
  // Modern Berth 10 replaces the survey's old indented Coastal Oil shoreline.
  // A low pile-supported deck bridges that water; its rear tapers to the DEM,
  // so both render and physics join the existing terminal yard.
  const deckY = -.12, bottom = -1.05;
  for (let s = 0; s < CONLEY_BERTH_10_LENGTH + 3; s += 12) {
    const end = Math.min(CONLEY_BERTH_10_LENGTH + 3, s + 12), mid = (s + end) / 2;
    place(end - s, deckY - bottom, 39, mid, 19.5, (deckY + bottom) / 2, concrete, true);
    const a = at(s, 39, deckY), b = at(end, 39, deckY), c = at(s, 78, ground(s, 78) + .035), d = at(end, 78, ground(end, 78) + .035);
    const surface = batches.at(concrete, a.x, a.z);
    for (const writer of [surface, solids]) {
      writer.triangle(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
      writer.triangle(b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
    for (const t of [3, 20, 36]) place(.7, 5.3, .7, mid, t, -3.55, dark);
    place(1.35, 3.1, .9, mid, -.38, -2.2, rubber);
  }
  // Fender rhythm, mooring bollards and twin rails distinguish the working
  // apron without duplicating the waterfront layer's full yard pavement.
  for (let s = 8; s < CONLEY_QUAY_LENGTH - 8; s += 18) {
    const y = s < CONLEY_BERTH_10_LENGTH ? deckY : ground(s, 22) + .04;
    place(1.35, 2.5, .7, s, -.3, y - 1.8, rubber);
    place(.5, .65, .5, s, 2.3, y + .33, yellow, true);
    place(1.1, .18, .48, s, 2.3, y + .68, yellow);
  }
  for (let s = 0; s < 1000; s += 12) for (const t of [7, 37]) {
    const y = s < CONLEY_BERTH_10_LENGTH ? deckY : ground(s, t) + .045;
    const end = Math.min(s + 12, 1000), y2 = end < CONLEY_BERTH_10_LENGTH ? deckY : ground(end, t) + .045;
    beam(at(s, t, y + .06), at(end, t, y2 + .06), .14, .12, steel);
  }
  for (const crane of CONLEY_CRANES) {
    const s = crane.along, y = s < CONLEY_BERTH_10_LENGTH ? deckY : ground(s, 37) + .04, material = crane.color === 'blue' ? blue : pale;
    const height = crane.height, boomY = y + height - 6.8, halfWidth = 11.6, reach = -crane.outreach, rear = 51;
    for (const side of [-1, 1]) for (const t of [7, 37]) {
      place(6.8, 1.4, 1.9, s + side * halfWidth, t, y + 1, dark, true);
      for (const offset of [-2.4, -1.2, 0, 1.2, 2.4]) place(.78, .82, 2.1, s + side * halfWidth + offset, t, y + .5, rubber);
      beam(at(s + side * halfWidth, t, y + 1.6), at(s + side * 8.2, t, boomY + 5.9), 1.25, 1.45, material, true);
    }
    for (const t of [7, 37]) {
      beam(at(s - halfWidth, t, y + 14), at(s + halfWidth, t, y + 14), 1.1, 1.2, material);
      beam(at(s - 8.2, t, boomY + 5.9), at(s + 8.2, t, boomY + 5.9), 1.2, 1.6, material);
    }
    for (const side of [-1, 1]) {
      const a = s + side * 8.2;
      beam(at(s + side * halfWidth, 7, y + 14), at(a, 37, boomY + 4.3), .7, .85, material);
      beam(at(s + side * halfWidth, 37, y + 14), at(a, 7, boomY + 4.3), .7, .85, material);
      beam(at(a, reach, boomY), at(a, rear, boomY), .7, .85, material);
      beam(at(a, reach, boomY + 4), at(a, rear, boomY + 4), .7, .85, material);
      for (let t = reach; t < rear - .1; t += 6) {
        const end = Math.min(rear, t + 6);
        beam(at(a, t, boomY), at(a, end, boomY + 4), .22, .28, material);
        beam(at(a, end, boomY), at(a, end, boomY + 4), .24, .28, material);
        beam(at(s - 8.2, t, boomY), at(s + 8.2, t, boomY), .22, .3, material);
      }
    }
    place(10, 4.2, 9, s, 43, boomY + 1.8, material);
    place(9.6, .6, 8.6, s, 43, boomY + 4.2, white);
    // Trolley, glazed cab, hanging hoist cables and orange ISO spreader.
    const trolley = crane.number % 2 ? -20 : 14, hoist = 13 + crane.number * 1.5;
    place(15, 1.2, 4.4, s, trolley, boomY - 1, dark);
    place(2.8, 3.6, 3.8, s - 6.3, trolley - 1, boomY - 3.4, pale);
    place(2.86, 2.4, 3.86, s - 6.3, trolley - 1, boomY - 3.2, glass);
    for (const a of [-4.8, 4.8]) for (const b of [-1, 1]) beam(at(s + a, trolley + b, boomY - 1.7), at(s + a, trolley + b, y + hoist), .055, .055, dark);
    place(12.3, .65, 2.7, s, trolley, y + hoist, orange);
    for (const side of [-1, 1]) place(1.1, .2, .8, s + side * 8.2, 6.2, boomY + 6.8, lights);
  }

  const stacks = conleyStacks(city), colors = ['#a0503a', '#315b6d', '#386759', '#aa814b', '#c7c2ad', '#5c6c78', '#a74332', '#647149'];
  const cargo = new TriangleWriter(), identity = new THREE.Matrix4();
  cargo.box(box(12.19, 2.59, 2.44));
  // Real ISO dimensions. Ribs/door bars share the same geometry and instance
  // colors as the body, eliminating hundreds of individually allocated meshes.
  if (!options.mobile) {
    for (let x = -5.7; x < 5.8; x += .59) for (const side of [-1, 1]) cargo.box(box(.07, 2.38, .055), identity.makeTranslation(x, 0, side * 1.237));
    for (const side of [-1, 1]) for (const z of [-.85, -.25, .25, .85]) cargo.box(box(.06, 2.3, .055), identity.makeTranslation(side * 6.12, 0, z));
  }
  const cargoMaterial = finish('#ffffff', .18), count = stacks.reduce((sum, stack) => sum + stack.tiers, 0);
  const containers = new THREE.InstancedMesh(cargo.geometry(), cargoMaterial, count); containers.name = 'Conley corrugated ISO containers'; containers.castShadow = true; containers.receiveShadow = true;
  let cursor = 0;
  for (const stack of stacks) {
    for (let tier = 0; tier < stack.tiers; tier++) {
      matrix.compose(new THREE.Vector3(stack.x, stack.base + 1.295 + tier * 2.61, stack.z), yaw, unit);
      containers.setMatrixAt(cursor, matrix); containers.setColorAt(cursor++, new THREE.Color(colors[(stack.color + tier * 3) % colors.length]));
    }
    matrix.compose(new THREE.Vector3(stack.x, stack.base + stack.tiers * 2.61 / 2, stack.z), yaw, unit);
    solids.box(box(12.19, stack.tiers * 2.61, 2.44), matrix);
  }
  for (const mesh of spatialInstances(containers, 240)) group.add(mesh);
  // Yellow rubber-tyred gantries straddle the six east-west cargo rows.
  for (let row = 0; row < 6; row++) for (const s of [555 + (row % 2) * 42, 1020 - (row % 3) * 25]) {
    const t = 100.35 + row * 29, y = ground(s, t), top = y + 15.2;
    for (const ds of [-6, 6]) for (const dt of [-7.5, 7.5]) {
      place(2.2, 1.4, .9, s + ds, t + dt, y + .8, rubber, true);
      place(.75, 13.1, .85, s + ds, t + dt, y + 7.45, yellow, true);
    }
    for (const ds of [-6, 6]) {
      beam(at(s + ds, t - 8, top), at(s + ds, t + 8, top), .9, 1.35, yellow);
    }
    for (const dt of [-7.5, 7.5]) {
      beam(at(s - 6, t + dt, top), at(s + 6, t + dt, top), .7, 1, yellow);
      beam(at(s - 6, t + dt, y + 3), at(s + 6, t + dt, top - 2), .26, .3, yellow);
    }
    place(3.4, 1.2, 3, s, t, top, dark); place(1.8, 2.1, 2.1, s + 5.2, t - 5, top - 2.1, pale);
  }
  // Container work lanes stay visually separate from the public freight road.
  for (let row = 0; row < 6; row++) for (let s = 420; s < 1160; s += 12) {
    const t = 110 + row * 29, y = ground(s, t) + .055;
    place(4, .012, .15, s, t, y, white);
  }
  for (const s of [100, 360, 650, 940, 1190]) {
    const t = 263, y = ground(s, t);
    place(.32, 25, .32, s, t, y + 12.5, steel, true);
    place(4.4, .22, 2.2, s, t, y + 25, dark);
    for (const ds of [-1.5, 0, 1.5]) place(.95, .12, 1.5, s + ds, t, y + 24.83, lights);
  }
  for (const mesh of batches.meshes()) { mesh.castShadow = mesh.material !== white; mesh.receiveShadow = true; group.add(mesh); }
  const geometry = solids.geometry();
  collisions.push({ id: 'conley-terminal-structures', vertices: new Float32Array(geometry.attributes.position.array), indices: Uint32Array.from({ length: solids.count }, (_, i) => i) }); geometry.dispose();
  group.userData = { cranes: CONLEY_CRANES.length, containers: count, cargoStacks: stacks.length, yardGantries: 12, berth10Length: CONLEY_BERTH_10_LENGTH, extension: CONLEY_EXTENSION, interpretation: 'Source quay alignment; documented crane types and dimensions; illustrative parking and cargo inventory' };
  scene.add(group);
  return { group, collisions, setLighting: (night: boolean) => { lights.emissiveIntensity = night ? 3 : .15; } };
}
