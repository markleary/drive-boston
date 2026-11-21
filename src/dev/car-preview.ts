import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createCar } from '../render/car.ts';
import { DrivingPhysics } from '../physics/vehicle.ts';
import { PLAYER_CARS, isPlayerCarId, type PlayerCarId } from '../simulation/player-cars.ts';

/** Development page (npm run dev, then /car-preview.html?car=<id>): one player car on level ground from six sides at
 * once, standing on its springs as the physics rests it. Not part of the production build.
 * ?car=<id> the car; ?view=0..5 one view full size; ?yaw=&pitch=&dist= a free view (radians, metres), or ?eye=<m>
 * for the camera's height over the road in place of the pitch; ?fov=<degrees>; ?tx=&ty=&tz= move the point looked at;
 * ?night=1; ?steer=<rad> turns the front wheels; ?brake=1 lights the brake lamps; ?spin=1 turns slowly; ?sky=1 lights
 * the car under an open sky as the game does, where the default is a studio, and ?sun=<rad> turns that sun round the car. */
const params = new URLSearchParams(location.search), label = document.getElementById('label')!;
const done = (stats: unknown) => { (window as unknown as { __car: unknown }).__car = stats; };
async function main() {
  const wanted = params.get('car') ?? '', ids = Object.keys(PLAYER_CARS);
  if (!isPlayerCarId(wanted)) { label.textContent = `No car "${wanted}". Cars: ${ids.join(', ')}`; done({ error: 'unknown car', cars: ids }); return; }
  const id: PlayerCarId = wanted, spec = PLAYER_CARS[id], night = params.get('night') === '1';
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = night ? .6 : 1; document.body.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(night ? '#0b1220' : '#a9c1d6');
  const pmrem = new THREE.PMREMGenerator(renderer), open = params.get('sky') === '1' && !night;
  const sun = new THREE.DirectionalLight('#fff3df', night ? .1 : open ? 3.4 : 2.4); sun.position.set(-5, 9, 6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  if (open) {
    // The game's day: its sky as the only reflection, at the game's intensity and exposure, with its sun and sky light.
    const sky = new Sky(), air = new THREE.Scene(), uniforms = sky.material.uniforms; sky.scale.setScalar(1000); air.add(sky);
    sun.position.set(-200, 570, -240).normalize().multiplyScalar(11); if (params.has('sun')) sun.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), Number(params.get('sun')));
    uniforms.sunPosition.value.copy(sun.position).normalize(); uniforms.rayleigh.value = 2; uniforms.turbidity.value = 2;
    scene.environment = pmrem.fromScene(air, .04, .1, 2000).texture; scene.environmentIntensity = .16; renderer.toneMappingExposure = .93;
    scene.add(new THREE.HemisphereLight(0xb8d9f1, 0x625343, .68)); scene.background = new THREE.Color('#9fc3e6');
  } else {
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = night ? .25 : .85;
    scene.add(new THREE.HemisphereLight(night ? '#33415a' : '#dfeaf5', night ? '#101010' : '#6f6a5d', night ? .3 : .7));
  }
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 }); sun.shadow.bias = -.0003; scene.add(sun);
  const car = createCar(id); scene.add(car.group);
  // The car as the physics rests it on level ground at the origin: the road is y = 0.
  const physics = await DrivingPhysics.create({ bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, buildings: [], spawn: { x: 0, z: 0, yaw: 0 } } as never); physics.setCar(id);
  for (let i = 0; i < 180; i++) physics.step({ throttle: 0, brake: 0, steer: 0, handbrake: false }, 1 / 60);
  const rest = physics.getState(), ground = 0;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: night ? '#2b2e31' : '#6f7376', roughness: .92 })); floor.position.y = ground; floor.receiveShadow = true; scene.add(floor);
  const state = { ...rest, x: 0, z: 0, speed: 0, steering: Number(params.get('steer') ?? 0), braking: params.get('brake') === '1' };
  car.update(state as never, night);
  const box = new THREE.Box3().setFromObject(car.group), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  let triangles = 0, meshes = 0; car.group.traverse(o => { if (o instanceof THREE.Mesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
  label.textContent = `${spec.name} · ${size.z.toFixed(3)} × ${size.x.toFixed(3)} × ${(box.max.y - ground).toFixed(3)} m · ${Math.round(triangles)} triangles in ${meshes} meshes`;
  const far = Number(params.get('dist') ?? 7.2), eye = 1.15;
  // Front quarter, side, rear quarter, straight rear, straight front, and from above.
  const views: [number, number, number][] = [[.62, far, eye], [Math.PI / 2, far, .75], [Math.PI - .6, far, eye + .25], [Math.PI, far * .8, .8], [0, far * .8, .8], [.001, .01, far * 1.25]];
  if (params.has('yaw')) views[0] = [Number(params.get('yaw')), far, params.has('eye') ? Number(params.get('eye')) : centre.y + far * Math.sin(Number(params.get('pitch') ?? .2))];
  const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 32), 1, .1, 200), only = params.has('yaw') ? 0 : params.has('view') ? Number(params.get('view')) : -1, target = new THREE.Vector3(Number(params.get('tx') ?? 0), centre.y + Number(params.get('ty') ?? -.05), Number(params.get('tz') ?? 0));
  const draw = (t = 0) => {
    const w = innerWidth, h = innerHeight; renderer.setScissorTest(true);
    views.forEach(([yaw, d, y], i) => {
      if (only >= 0 && i !== only) return;
      const vx = only >= 0 ? 0 : (i % 3) * w / 3, vy = only >= 0 ? 0 : (1 - Math.floor(i / 3)) * h / 2, vw = only >= 0 ? w : w / 3, vh = only >= 0 ? h : h / 2, a = yaw + t;
      renderer.setViewport(vx, vy, vw, vh); renderer.setScissor(vx, vy, vw, vh); camera.aspect = vw / vh; camera.updateProjectionMatrix();
      camera.position.set(target.x + Math.sin(a) * d, y, target.z + Math.cos(a) * d); camera.lookAt(target); renderer.render(scene, camera);
    });
  };
  draw();
  if (params.get('spin') === '1') { const turn = (ms: number) => { draw(ms / 4000); requestAnimationFrame(turn); }; requestAnimationFrame(turn); }
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); draw(); });
  done({ id, size: size.toArray(), height: box.max.y - ground, triangles, meshes });
}
main();
