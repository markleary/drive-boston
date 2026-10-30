import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleState } from '../types';

export type VehicleStyle = 'coupe' | 'sedan' | 'crossover' | 'van' | 'hatchback';
export type VehicleSurface = 'paint' | 'trim' | 'rubber' | 'chrome' | 'glass' | 'headlight' | 'taillight' | 'amber' | 'plate';
type Point3 = [number, number, number];
type RenderState = VehicleState & {
  rotation?: { x: number; y: number; z: number; w: number };
  wheelAngles?: number[]; suspension?: number[]; braking?: boolean;
};

interface Section { z: number; width: number; bottom: number; top: number; }

/** A bevelled, continuously shaped shell, rather than overlapping body boxes. */
function shell(sections: Section[]) {
  const vertices: number[] = [], indices: number[] = [];
  for (const s of sections) {
    const bevel = Math.min(.085, (s.top - s.bottom) * .25);
    const ring = [
      [-.86 * s.width, s.bottom], [.86 * s.width, s.bottom],
      [s.width, s.bottom + bevel], [s.width, s.top - bevel],
      [.94 * s.width, s.top], [.45 * s.width, s.top + bevel * .3],
      [-.45 * s.width, s.top + bevel * .3], [-.94 * s.width, s.top],
      [-s.width, s.top - bevel], [-s.width, s.bottom + bevel],
    ];
    for (const [x, y] of ring) vertices.push(x, y, s.z);
  }
  const count = 10;
  for (let n = 0; n < sections.length - 1; n++) for (let j = 0; j < count; j++) {
    const a = n * count + j, b = n * count + (j + 1) % count;
    indices.push(a, b, b + count, a, b + count, a + count);
  }
  for (let j = 1; j < count - 1; j++) {
    indices.push(0, j + 1, j);
    const end = (sections.length - 1) * count;
    indices.push(end, end + j, end + j + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function geometryParts() {
  const buckets = new Map<VehicleSurface, THREE.BufferGeometry[]>();
  const add = (surface: VehicleSurface, geometry: THREE.BufferGeometry) => {
    const normalized = geometry.index ? geometry.toNonIndexed() : geometry;
    if (normalized !== geometry) geometry.dispose();
    // Every primitive shares attributes, including custom shell/glazing meshes.
    if (normalized.hasAttribute('uv')) normalized.deleteAttribute('uv');
    const list = buckets.get(surface) ?? []; list.push(normalized); buckets.set(surface, list);
  };
  const box = (surface: VehicleSurface, size: Point3, position: Point3, rotation?: Point3) => {
    const geometry = new THREE.BoxGeometry(...size);
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position); add(surface, geometry);
  };
  const beam = (surface: VehicleSurface, start: Point3, end: Point3, radius = .015, sides = 6) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), sides);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP, direction.normalize()));
    geometry.translate(...a.add(b).multiplyScalar(.5).toArray() as Point3); add(surface, geometry);
  };
  const path = (surface: VehicleSurface, points: Point3[], radius = .008) => {
    for (let i = 1; i < points.length; i++) beam(surface, points[i - 1], points[i], radius, 5);
  };
  const quad = (surface: VehicleSurface, points: Point3[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3].flatMap(i => points[i]), 3));
    geometry.computeVertexNormals(); add(surface, geometry);
  };
  const finish = () => {
    const result = new Map<VehicleSurface, THREE.BufferGeometry>();
    for (const [surface, geometries] of buckets) {
      const merged = mergeGeometries(geometries, false);
      if (merged) result.set(surface, merged);
      geometries.forEach(geometry => geometry.dispose());
    }
    return result;
  };
  return { add, box, beam, path, quad, finish };
}

export function createVehicleWheelGeometry(side: number) {
  const parts = geometryParts();
  const tire = new THREE.LatheGeometry([
    new THREE.Vector2(.232, -.12), new THREE.Vector2(.285, -.14), new THREE.Vector2(.325, -.115),
    new THREE.Vector2(.34, -.065), new THREE.Vector2(.34, .065), new THREE.Vector2(.325, .115),
    new THREE.Vector2(.285, .14), new THREE.Vector2(.232, .12),
  ], 32);
  tire.rotateZ(Math.PI / 2); parts.add('rubber', tire);
  for (const x of [-.055, .055]) {
    const groove = new THREE.TorusGeometry(.339, .004, 4, 40);
    groove.rotateY(Math.PI / 2); groove.translate(x, 0, 0); parts.add('trim', groove);
  }
  // Small raised tread blocks catch moving highlights without a texture lookup.
  for (let i = 0; i < 32; i++) {
    const angle = i * Math.PI * 2 / 32;
    parts.box('rubber', [.16, .008, .018], [0, Math.cos(angle) * .339, Math.sin(angle) * .339], [angle, .16 * side, 0]);
  }
  const face = side * .145;
  const brake = new THREE.CylinderGeometry(.205, .205, .018, 32); brake.rotateZ(Math.PI / 2);
  brake.translate(side * .098, 0, 0); parts.add('trim', brake);
  const rotor = new THREE.TorusGeometry(.174, .013, 5, 28); rotor.rotateY(Math.PI / 2);
  rotor.translate(side * .111, 0, 0); parts.add('chrome', rotor);
  const lip = new THREE.TorusGeometry(.232, .013, 6, 32); lip.rotateY(Math.PI / 2);
  lip.translate(face, 0, 0); parts.add('chrome', lip);
  const hub = new THREE.CylinderGeometry(.055, .055, .045, 16); hub.rotateZ(Math.PI / 2);
  hub.translate(face, 0, 0); parts.add('chrome', hub);
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI * 2 / 10;
    parts.beam('chrome', [face, Math.cos(angle) * .047, Math.sin(angle) * .047],
      [face - side * .012, Math.cos(angle + .13) * .223, Math.sin(angle + .13) * .223], .014, 5);
  }
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5;
    const bolt = new THREE.SphereGeometry(.007, 5, 4);
    bolt.translate(face + side * .025, Math.cos(angle) * .035, Math.sin(angle) * .035);
    parts.add('trim', bolt);
  }
  return parts.finish();
}

/** Original vehicle meshes. Local +Z is forward; the road lies near y = −0.66. */
export function createVehicleGeometry(style: VehicleStyle, includeWheels = true) {
  const parts = geometryParts();
  const coupe = style === 'coupe', suv = style === 'crossover', van = style === 'van', hatch=style==='hatchback';
  const width = coupe ? .93 : .88;
  const nose = coupe ? 2.15 : 2.08, tail = coupe ? -2.16 : -2.08;
  const belt = suv || van ? .36 : .29;
  parts.add('paint', shell([
    { z: tail, width: width * .85, bottom: -.18, top: .13 },
    { z: tail + .25, width: width * .97, bottom: -.24, top: belt - .02 },
    { z: -1.33, width, bottom: -.27, top: belt },
    { z: -.55, width, bottom: -.28, top: belt },
    { z: .65, width, bottom: -.28, top: belt - .02 },
    { z: 1.35, width: width * .99, bottom: -.23, top: .23 },
    { z: nose - .24, width: width * .96, bottom: -.17, top: .15 },
    { z: nose, width: width * .84, bottom: -.10, top: .07 },
  ]));
  parts.box('trim', [1.48, .08, 3.5], [0, -.255, -.03]);
  for (const side of [-1, 1]) {
    parts.box('trim', [.07, .065, 2.10], [side * (width - .015), -.22, 0]);
    for (const z of [-1.33, 1.33]) {
      const recess = new THREE.CircleGeometry(.382, 32); recess.rotateY(side * Math.PI / 2);
      recess.translate(side * (width + .009), -.34, z); parts.add('trim', recess);
      const arch = new THREE.TorusGeometry(.389, suv ? .032 : .017, 5, 32, Math.PI);
      arch.rotateY(Math.PI / 2); arch.translate(side * (width + .014), -.34, z);
      parts.add(suv ? 'trim' : 'paint', arch);
    }
  }

  const top = van ? 1.27 : suv ? 1.13 : hatch ? .99 : coupe ? .85 : .92;
  const frontBottom = van ? 1.14 : suv ? 1.02 : .9;
  const frontTop = van ? .59 : suv ? .38 : .24;
  const rearTop = van ? -1.72 : suv ? -1.25 : hatch ? -1.28 : coupe ? -.68 : -.82;
  const rearBottom = van ? -1.87 : suv ? -1.69 : hatch ? -1.72 : -1.28;
  const bottomWidth = width * .89, topWidth = width * .75;
  const lower = belt + .018;
  // The van's long upper shell is painted sheet metal; passenger cars have
  // independently inset glass and narrow pillars around an opaque roof.
  if (van) parts.add('paint', shell([
    { z: rearBottom, width: bottomWidth, bottom: belt - .01, top: top - .03 },
    { z: rearTop + .13, width: bottomWidth, bottom: belt - .01, top },
    { z: frontTop - .05, width: bottomWidth, bottom: belt - .01, top },
    { z: frontBottom, width: bottomWidth, bottom: belt - .01, top: belt + .03 },
  ]));
  parts.add(coupe ? 'trim' : 'paint', shell([
    { z: rearTop - .03, width: topWidth * .96, bottom: top - .018, top: top + .035 },
    { z: rearTop + .12, width: topWidth, bottom: top, top: top + .055 },
    { z: frontTop - .12, width: topWidth, bottom: top, top: top + .05 },
    { z: frontTop + .035, width: topWidth * .97, bottom: top - .018, top: top + .025 },
  ]));
  const windshield: Point3[] = [[-bottomWidth, lower, frontBottom], [bottomWidth, lower, frontBottom], [topWidth, top, frontTop], [-topWidth, top, frontTop]];
  parts.quad('glass', windshield);
  parts.path('trim', [...windshield, windshield[0]], .026);
  parts.path('chrome', [windshield[3], windshield[2]], .008);
  // Two distinct wiper arms sit along the lower windscreen edge.
  parts.beam('trim', [-.53, lower + .02, frontBottom + .014], [.03, lower + .038, frontBottom - .012], .009);
  parts.beam('trim', [.14, lower + .025, frontBottom + .014], [.60, lower + .055, frontBottom - .035], .009);
  if (!van) {
    const rearGlass: Point3[] = [[bottomWidth, lower, rearBottom], [-bottomWidth, lower, rearBottom], [-topWidth, top, rearTop], [topWidth, top, rearTop]];
    parts.quad('glass', rearGlass); parts.path('trim', [...rearGlass, rearGlass[0]], .023);
    // Fine defroster lines add a recognizable rear-windshield scale cue.
    for (let i = 1; i < 6; i++) {
      const t = i / 6, x = THREE.MathUtils.lerp(bottomWidth, topWidth, t);
      parts.beam('trim', [-x * .91, THREE.MathUtils.lerp(lower, top, t) + .003, THREE.MathUtils.lerp(rearBottom, rearTop, t) - .006],
        [x * .91, THREE.MathUtils.lerp(lower, top, t) + .003, THREE.MathUtils.lerp(rearBottom, rearTop, t) - .006], .003, 3);
    }
  }

  for (const side of [-1, 1]) {
    const sx = side * (bottomWidth + (van ? .008 : 0)), tx = side * (topWidth + (van ? .11 : 0));
    const split = van ? -.17 : coupe ? -.29 : -.18;
    const frontWindow: Point3[] = [[sx, lower + .025, frontBottom - .08], [sx, lower + .025, split], [tx, top - .045, split], [tx, top - .045, frontTop - .04]];
    parts.quad('glass', frontWindow); parts.path('trim', [...frontWindow, frontWindow[0]], .021);
    if (!van) {
      const rearWindow: Point3[] = [[sx, lower + .025, split - .07], [sx, lower + .025, rearBottom + .08], [tx, top - .045, rearTop + .07], [tx, top - .045, split - .07]];
      parts.quad('glass', rearWindow); parts.path('trim', [...rearWindow, rearWindow[0]], .021);
      parts.beam('paint', [sx, lower, rearBottom], [tx, top + .01, rearTop], suv ? .06 : .045);
      parts.beam('chrome', [sx, lower + .008, rearBottom + .06], [sx, lower + .008, frontBottom - .03], .009);
    } else {
      parts.path('trim', [[side * (bottomWidth + .012), lower + .015, -.28], [side * (bottomWidth + .012), top - .09, -.28],
        [side * (bottomWidth + .012), top - .09, -1.68], [side * (bottomWidth + .012), lower + .015, -1.68]], .007);
      parts.beam('trim', [side * (bottomWidth + .018), lower + .14, -.49], [side * (bottomWidth + .018), lower + .14, -1.53], .012);
    }
    parts.beam(coupe ? 'trim' : 'paint', [sx, lower, frontBottom], [tx, top + .015, frontTop], .039);
    // Door shut lines, recessed handles, a shoulder crease and a mirror shell.
    const doorEnd = coupe ? -.88 : -.28;
    parts.path('trim', [[side * (width + .005), belt - .09, .73], [side * (width + .006), -.18, .60],
      [side * (width + .006), -.19, doorEnd], [side * (width + .005), belt - .09, doorEnd]], .005);
    if (!coupe) parts.path('trim', [[side * (width + .005), belt - .09, -.37], [side * (width + .006), -.18, -.38],
      [side * (width + .006), -.18, -1.0]], .005);
    parts.beam('chrome', [side * (width + .007), belt - .075, -.71], [side * (width + .007), belt - .075, -.47], .011);
    if (!coupe) parts.beam('chrome', [side * (width + .007), belt - .075, -.99], [side * (width + .007), belt - .075, -.82], .011);
    parts.beam('paint', [side * (width * .97), belt - .04, -.89], [side * (width * .97), belt - .04, .83], .012);
    parts.beam('trim', [side * (width * .83), lower + .08, .68], [side * (width + .035), lower + .1, .66], .024);
    const mirror = new THREE.SphereGeometry(.11, 10, 7); mirror.scale(1.07, .62, 1.25); mirror.translate(side * (width + .065), lower + .11, .64); parts.add('paint', mirror);
    parts.box('glass', [.006, .082, .165], [side * (width + .165), lower + .11, .62]);
    if (suv) parts.beam('trim', [side * topWidth, top + .09, -1.10], [side * topWidth, top + .09, .28], .024);
  }

  // Hood and boot seams follow the sloping body; a narrow grille has real fins.
  for (const side of [-1, 1]) {
    parts.path('trim', [[side * .68, .285, .83], [side * .66, .246, 1.25], [side * .60, .172, 1.78]], .0045);
    parts.path('trim', [[side * .63, belt + .01, -1.35], [side * .62, belt - .035, -1.82]], .005);
  }
  parts.box('trim', [1.03, .15, .035], [0, -.02, nose + .006]);
  for (let i = 0; i < 4; i++) parts.box('chrome', [.91, .009, .018], [0, -.075 + i * .035, nose + .027]);
  parts.box('trim', [1.40, .085, .09], [0, -.18, nose - .03]);
  parts.box('chrome', [.12, .04, .018], [0, .13, nose - .10]);
  parts.box('trim', [1.46, .1, .09], [0, -.20, tail - .015]);
  for (const x of [-.53, -.27, 0, .27, .53]) parts.box('trim', [.018, .11, .20], [x, -.235, tail + .02]);
  parts.box('chrome', [1.41, .023, .025], [0, -.125, tail - .055]);
  for (const side of [-1, 1]) {
    parts.box('trim', [.48, .13, .06], [side * .58, .065, nose - .018]);
    parts.box('headlight', [.365, .065, .018], [side * .55, .075, nose + .021]);
    parts.box('headlight', [.37, .012, .024], [side * .55, .027, nose + .026]);
    parts.box('amber', [.065, .074, .024], [side * .77, .075, nose - .018]);
    parts.box('trim', [.54, .16, .055], [side * .55, .085, tail - .012]);
    parts.box('taillight', [.40, .09, .022], [side * .54, .107, tail - .046]);
    parts.box('amber', [.085, .04, .026], [side * .72, .038, tail - .05]);
    parts.box('plate', [.075, .035, .023], [side * .36, .04, tail - .05]);
    parts.box('taillight', [.055, .055, .13], [side * (width * .90), .065, tail + .16]);
    const exhaust = new THREE.CylinderGeometry(.055, .055, .16, 14, 1, true);
    exhaust.rotateX(Math.PI / 2); exhaust.translate(side * .58, -.25, tail - .035); parts.add('chrome', exhaust);
    const interior = new THREE.CircleGeometry(.044, 12); interior.rotateY(Math.PI);
    interior.translate(side * .58, -.25, tail - .117); parts.add('trim', interior);
  }
  parts.box('trim', [.335, .178, .035], [0, .035, tail - .062]);
  parts.box('plate', [.305, .1524, .012], [0, .035, tail - .085]);
  parts.box('trim', [.335, .178, .022], [0, -.02, nose + .025]);
  parts.box('plate', [.305, .1524, .012], [0, -.02, nose + .038]);
  parts.box('chrome', [.23, .025, .015], [0, .164, tail - .032]);
  if (van) {
    parts.path('trim', [[0, .32, rearBottom - .008], [0, top - .05, rearBottom - .008]], .008);
    for (const side of [-1, 1]) {
      parts.box('glass', [.52, .39, .018], [side * .36, .94, rearBottom - .017]);
      parts.box('trim', [.11, .027, .025], [side * .12, .55, rearBottom - .025]);
    }
  } else parts.box('taillight', [.31, .025, .032], [0, lower + .03, rearBottom - .018]);

  if (includeWheels) for (const [surface, geometry] of createVehicleWheelsGeometry()) parts.add(surface, geometry);
  return parts.finish();
}

/** Shared wheel set allows the traffic fleet to render all tires in one draw. */
export function createVehicleWheelsGeometry() {
  const parts = geometryParts();
  for (const z of [1.33, -1.33]) for (const side of [-1, 1]) {
    for (const [surface, geometry] of createVehicleWheelGeometry(side)) {
      geometry.translate(side * .86, -.34, z); parts.add(surface, geometry);
    }
  }
  return parts.finish();
}

/** Front and rear US-size plates, facing outwards so lettering never reverses. */
export function createVehiclePlateGeometry(style: VehicleStyle) {
  const front = new THREE.PlaneGeometry(.305, .1524);
  front.translate(0, -.02, (style === 'coupe' ? 2.15 : 2.08) + .047);
  const rear = new THREE.PlaneGeometry(.305, .1524);
  rear.rotateY(Math.PI);
  rear.translate(0, .035, (style === 'coupe' ? -2.16 : -2.08) - .094);
  const geometry = mergeGeometries([front, rear], false)!;
  front.dispose(); rear.dispose();
  return geometry;
}

/** Original artwork based on the RMV passenger plate layout; registrations are fictional. */
export function massachusettsPlateTexture(registration = '4BK 026') {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f1f1e8'; ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#bac0bb'; ctx.lineWidth = 4; ctx.strokeRect(7, 7, 498, 242);
  ctx.textAlign = 'center'; ctx.fillStyle = '#233b72';
  ctx.font = 'italic bold 35px Georgia'; ctx.fillText('Massachusetts', 256, 49, 350);
  ctx.font = 'italic 24px Georgia'; ctx.fillText('The Spirit of America', 256, 230, 390);
  ctx.font = 'bold 18px Arial'; ctx.fillText('OCT', 43, 39);
  ctx.fillStyle = '#b58f4b'; ctx.fillRect(449, 20, 41, 33);
  ctx.fillStyle = '#28343f'; ctx.font = 'bold 18px Arial'; ctx.fillText('26', 469, 44);
  // Independently positioned glyphs keep the centered registration readable.
  const serial = registration.replace(/\s/g, '').slice(0, 6);
  const spacing = 60, start = 256 - (serial.length - 1) * spacing / 2;
  ctx.font = 'bold 112px Arial Narrow, monospace'; ctx.fillStyle = '#a32632';
  for (let i = 0; i < serial.length; i++) ctx.fillText(serial[i], start + i * spacing, 177, 57);
  ctx.fillStyle = '#6b7379';
  for (const x of [78, 434]) { ctx.beginPath(); ctx.ellipse(x, 16, 9, 4, 0, 0, Math.PI * 2); ctx.fill(); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createMassachusettsPlateMaterial(registration = '4BK 026') {
  return new THREE.MeshStandardMaterial({ map: massachusettsPlateTexture(registration) ?? null, color: 0xffffff, roughness: .49, metalness: .04 });
}

export function createCar() {
  const group = new THREE.Group(); group.name = 'PlayerCoupe';
  const materials: Record<VehicleSurface, THREE.MeshStandardMaterial> = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xc8c5b0, metalness: .28, roughness: .26, clearcoat: .75, clearcoatRoughness: .19 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x151b1e, metalness: .24, roughness: .48, side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x171a1b, roughness: .94 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bec0, metalness: .9, roughness: .21 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x142b35, metalness: .36, roughness: .11, clearcoat: 1, clearcoatRoughness: .09, side: THREE.DoubleSide }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xdde5df, emissive: 0xffedce, emissiveIntensity: .45, roughness: .2 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x8e1d16, emissive: 0xe5281d, emissiveIntensity: .35, roughness: .27, metalness: .15 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xb0651d, emissive: 0xd37817, emissiveIntensity: .15, roughness: .3 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xdadacb, roughness: .48 }),
  };
  for (const [surface, geometry] of createVehicleGeometry('coupe', false)) {
    const mesh = new THREE.Mesh(geometry, materials[surface]); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  // Keep plate UVs separate from merged geometry so the tiny lettering stays crisp.
  const plateMaterial = createMassachusettsPlateMaterial();
  group.add(new THREE.Mesh(createVehiclePlateGeometry('coupe'), plateMaterial));
  const wheels: { pivot: THREE.Group; spin: THREE.Group }[] = [];
  for (const z of [1.33, -1.33]) for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * .86, -.34, z); group.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    for (const [surface, geometry] of createVehicleWheelGeometry(side)) {
      const mesh = new THREE.Mesh(geometry, materials[surface]); mesh.castShadow = true; spin.add(mesh);
    }
    wheels.push({ pivot, spin });
  }
  const lights: THREE.SpotLight[] = [];
  for (const x of [-.55, .55]) {
    const light = new THREE.SpotLight(0xffedc4, 0, 45, .42, .65, 1.5); light.visible = false;
    light.position.set(x, .075, 2.18); light.target.position.set(x, -.4, 24);
    group.add(light, light.target); lights.push(light);
  }
  // A short chase boom can end inside the coupe when a wall/parked vehicle
  // blocks it. Hide bodywork at that distance, keeping the headlight objects
  // active so avoiding a beige near-plane flash does not change light counts.
  const bodyParts=group.children.filter(object=>!(object instanceof THREE.Light)&&!lights.some(light=>light.target===object));
  const bodyBounds=new THREE.Box3().setFromObject(group).expandByScalar(.25),localCamera=new THREE.Vector3();
  let bodyVisible=true;
  function setCameraPosition(position:THREE.Vector3){
    const visible=!bodyBounds.containsPoint(group.worldToLocal(localCamera.copy(position)));
    if(visible===bodyVisible)return;bodyVisible=visible;for(const part of bodyParts)part.visible=visible;
  }
  let fallbackWheelAngle = 0;
  return {
    group,setCameraPosition,get bodyVisible(){return bodyVisible;},
    update(state: VehicleState, night: boolean, dt = 1 / 60) {
      const s = state as RenderState;
      group.position.set(s.x, s.y, s.z);
      if (s.rotation) group.quaternion.set(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w);
      else group.rotation.set(0, s.yaw, 0);
      fallbackWheelAngle += s.speed * Math.min(dt, .1) / .34;
      wheels.forEach((wheel, i) => {
        wheel.pivot.rotation.y = i < 2 ? s.steering : 0;
        wheel.pivot.position.y = -.08 - (s.suspension?.[i] ?? .26);
        wheel.spin.rotation.x = s.wheelAngles?.[i] ?? fallbackWheelAngle;
      });
      materials.headlight.emissiveIntensity = night ? 3 : .45;
      materials.taillight.emissiveIntensity = s.braking ? 4 : night ? 1.8 : .35;
      materials.amber.emissiveIntensity = night ? .45 : .12;
      for (const light of lights) { light.intensity = night ? 38 : 0; light.visible = night; }
    },
    dispose() {
      const ownedMaterials = new Set<THREE.Material>();
      group.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => ownedMaterials.add(material));
        }
      });
      ownedMaterials.forEach(material => material.dispose()); plateMaterial.map?.dispose();
    },
  };
}
