import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { HelicopterState } from '../simulation/helicopter';

type Point = [number, number, number];

/** Original light utility helicopter; cabin center is the origin, nose points +Z. */
export function createHelicopter() {
  const group = new THREE.Group(); group.name = 'BackBayHelicopter';
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xbd9c65, metalness: .25, roughness: .29, clearcoat: .75, clearcoatRoughness: .18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202d32, metalness: .32, roughness: .4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x163440, metalness: .36, roughness: .1, clearcoat: 1, clearcoatRoughness: .08, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa7b2b2, metalness: .82, roughness: .25 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xe2dfce, metalness: .12, roughness: .4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa92b25, emissive: 0xe73e2d, emissiveIntensity: 1.1, roughness: .25 });
  const green = new THREE.MeshStandardMaterial({ color: 0x2b8b68, emissive: 0x45d89a, emissiveIntensity: 1.1, roughness: .25 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xd3ddd7, emissive: 0xe9e7c8, emissiveIntensity: .55, roughness: .2 });
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const normalized = geometry.index ? geometry.toNonIndexed() : geometry;
    if (geometry !== normalized) geometry.dispose(); normalized.deleteAttribute('uv');
    const list = buckets.get(material) ?? []; list.push(normalized); buckets.set(material, list);
  };
  const box = (size: Point, position: Point, material: THREE.Material, rotation?: Point) => {
    const geometry = new THREE.BoxGeometry(...size);
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(...position); add(geometry, material);
  };
  const beam = (a: Point, b: Point, radius: number, material: THREE.Material, endRadius = radius) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(endRadius, radius, direction.length(), 10);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP, direction.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(.5).toArray() as Point); add(geometry, material);
  };
  const path = (points: Point[], radius: number, material: THREE.Material) => {
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), points.length * 5, radius, 6, false);
    add(geometry, material);
  };
  const quad = (points: Point[], material: THREE.Material) => {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3].flatMap(i => points[i]), 3));
    geometry.computeVertexNormals(); add(geometry, material);
  };
  const body = new THREE.SphereGeometry(1, 32, 18); body.scale(.88, .73, 1.72); body.translate(0, -.05, -.1); add(body, paint);
  const belly = new THREE.SphereGeometry(1, 24, 12); belly.scale(.72, .26, 1.25); belly.translate(0, -.55, -.15); add(belly, dark);
  const canopy = new THREE.SphereGeometry(1, 32, 18, 0, Math.PI); canopy.scale(.845, .71, 1.62); canopy.translate(0, .05, .2); add(canopy, glass);
  const engine = new THREE.SphereGeometry(1, 20, 12); engine.scale(.49, .33, .79); engine.translate(0, .64, -.48); add(engine, paint);
  beam([0, .15, -1.27], [0, .50, -4.58], .255, paint, .075);
  beam([0, .74, -.19], [0, 1.40, -.19], .073, metal);
  beam([0, 1.17, -.19], [0, 1.31, -.19], .17, dark);
  for (const side of [-1, 1]) {
    const window: Point[] = [[side * .82, -.19, .17], [side * .80, -.19, -.82], [side * .67, .49, -.82], [side * .70, .55, .17]];
    quad(window, glass); path([...window, window[0]], .022, dark);
    path([[side * .82, -.22, .12], [side * .86, -.32, -.7], [side * .70, -.47, -1.0]], .008, dark);
    beam([side * .86, -.25, -.62], [side * .86, -.25, -.42], .012, metal);
    path([[side * .81, -.33, .7], [side * .84, -.3, -.15], [side * .69, -.3, -1.11]], .025, cream);
    // Windscreen frame follows the compound curve of the canopy.
    path([[side * .75, -.17, .9], [side * .76, .25, .9], [side * .49, .63, .83], [0, .76, .63]], .026, dark);
    path([[side * .84, -1.04, -1.43], [side * .84, -1.06, .75], [side * .84, -.98, 1.40], [side * .84, -.80, 1.61]], .05, metal);
    for (const z of [-.75, .70]) beam([side * .49, -.48, z], [side * .84, -1.04, z], .045, dark);
    beam([side * .12, .65, -.60], [side * .44, .93, -.45], .035, metal);
    for (let i = 0; i < 6; i++) box([.012, .09, .036], [side * .47, .67, -.85 + i * .07], dark);
    const nav = new THREE.SphereGeometry(.06, 10, 7); nav.translate(side * .91, .02, -.23); add(nav, side === 1 ? red : green);
  }
  path([[0, -.13, 1.79], [0, .30, 1.67], [0, .61, 1.19], [0, .76, .63]], .026, dark);
  beam([-.46, -.27, 1.31], [-.03, .04, 1.76], .012, dark);
  beam([.49, -.27, 1.28], [.15, .0, 1.74], .012, dark);
  box([.21, .12, .08], [0, -.44, 1.49], lamp, [.12, 0, 0]);
  beam([0, .80, -.92], [0, 1.16, -1.10], .009, dark);
  const beacon = new THREE.SphereGeometry(.055, 10, 7); beacon.translate(0, .97, -.57); add(beacon, red);
  // A thin, swept tail fin and stabilizer retain a recognizable helicopter profile.
  for (const side of [-1, 1]) {
    const fin: Point[] = [[side * .035, .38, -4.72], [side * .035, 1.42, -4.78], [side * .035, 1.48, -4.35], [side * .035, .48, -4.09]];
    quad(side === -1 ? fin.reverse() : fin, paint);
  }
  quad([[-.035, 1.42, -4.78], [.035, 1.42, -4.78], [.035, 1.48, -4.35], [-.035, 1.48, -4.35]], cream);
  box([1.48, .045, .38], [0, .43, -3.76], paint, [0, .08, 0]);
  box([.09, .055, .39], [-.72, .43, -3.76], cream); box([.09, .055, .39], [.72, .43, -3.76], cream);
  beam([-.25, .54, -4.49], [.10, .54, -4.49], .055, metal);
  for (let i = 0; i < 3; i++) {
    const stripe = new THREE.CylinderGeometry(.106 - i * .008, .11 - i * .008, .11, 12);
    stripe.rotateX(-Math.PI / 2); stripe.translate(0, .46 + i * .008, -4.0 - i * .18); add(stripe, cream);
  }
  for (const [material, geometries] of buckets) {
    const geometry = mergeGeometries(geometries, false);
    if (geometry) { const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
    geometries.forEach(geometry => geometry.dispose());
  }
  const mainRotor = new THREE.Group(); mainRotor.name = 'MainRotor'; mainRotor.position.set(0, 1.40, -.19); group.add(mainRotor);
  const rotorMaterial = new THREE.MeshStandardMaterial({ color: 0x29373a, metalness: .35, roughness: .38, side: THREE.DoubleSide });
  const tipMaterial = new THREE.MeshStandardMaterial({ color: 0xbdb99a, roughness: .47, side: THREE.DoubleSide });
  const blades: THREE.BufferGeometry[] = [], tips: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.BoxGeometry(4.35, .024, .19); blade.translate(2.4, 0, .03); blade.rotateY(i * Math.PI / 2 + .07); blades.push(blade);
    const tip = new THREE.BoxGeometry(.25, .026, .19); tip.translate(4.63, 0, .03); tip.rotateY(i * Math.PI / 2 + .07); tips.push(tip);
  }
  for (const [geometries, material] of [[blades, rotorMaterial], [tips, tipMaterial]] as const) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false)!, material); mainRotor.add(mesh); geometries.forEach(geometry => geometry.dispose());
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(.15, 12, 8), metal); hub.scale.set(1, .55, 1); mainRotor.add(hub);
  const rotorBlurMaterial = new THREE.MeshBasicMaterial({ color: 0x7d8985, transparent: true, opacity: .055, depthWrite: false, side: THREE.DoubleSide });
  const rotorBlur = new THREE.Mesh(new THREE.RingGeometry(.25, 4.76, 64), rotorBlurMaterial); rotorBlur.rotation.x = -Math.PI / 2; rotorBlur.position.y = .012; mainRotor.add(rotorBlur);
  const tailRotor = new THREE.Group(); tailRotor.name = 'TailRotor'; tailRotor.position.set(-.25, .54, -4.49); group.add(tailRotor);
  const tailBlades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.BoxGeometry(.025, .63, .11); blade.translate(0, .36, 0); blade.rotateX(i * Math.PI * 2 / 3); tailBlades.push(blade);
  }
  tailRotor.add(new THREE.Mesh(mergeGeometries(tailBlades, false)!, rotorMaterial)); tailBlades.forEach(geometry => geometry.dispose());
  const tailHub = new THREE.Mesh(new THREE.SphereGeometry(.083, 10, 7), metal); tailRotor.add(tailHub);
  let rpm = 1;
  return {
    group,
    update(state: HelicopterState, dt: number, active: boolean) {
      group.position.set(state.x, state.y, state.z); group.rotation.set(state.pitch, state.yaw, state.bank, 'YXZ');
      const step = Math.max(0, Math.min(.1, dt)); rpm += ((active ? 1 : 0) - rpm) * (1 - Math.exp(-2 * step));
      mainRotor.rotation.y += step * 38 * rpm; tailRotor.rotation.x -= step * 72 * rpm;
      rotorBlurMaterial.opacity = .055 * rpm; rotorBlur.visible = rpm > .15;
      red.emissiveIntensity = active ? .8 + Math.max(0, Math.sin(mainRotor.rotation.y * .055)) * 1.1 : .15;
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      group.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material)); } });
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    },
  };
}
