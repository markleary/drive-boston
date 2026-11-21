import * as THREE from 'three';
import type { Building, CityData } from '../types';
import { loadTile, resolveCity, type MetroCity } from '../simulation/city-tiles.ts';
import { closestRoad } from '../simulation/roads.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { setSiteNight } from '../render/site-kit.ts';
import { buildSite, hasSiteFinish, SITE_MODELS, replacesSiteShell, siteShellMaterial } from '../render/site-landmarks.ts';
import { tileShellGeometry } from '../render/tile-geometry.ts';

/** Development page (npm run dev, then /site-preview.html?site=<id>): one site landmark on its real terrain among
 * the grey hulls of its neighbours, drawn from four sides at once. Not part of the production build.
 * ?site=<id> the model; ?view=0..3 one view full size; ?night=1; ?list prints every site id; ?spin=1 turns slowly. */
const params = new URLSearchParams(location.search), label = document.getElementById('label')!;
const done = (stats: unknown) => { (window as unknown as { __site: unknown }).__site = stats; };
async function main() {
  if (params.has('list')) { label.textContent = SITE_MODELS.map(s => s.id).join(' '); done({ sites: SITE_MODELS.map(s => ({ id: s.id, name: s.name, place: s.place })) }); return; }
  const site = SITE_MODELS.find(s => s.id === params.get('site')); if (!site) { label.textContent = `No site "${params.get('site')}". Sites: ${SITE_MODELS.map(s => s.id).join(', ')}`; done({ error: 'unknown site' }); return; }
  const read = async (name: string) => (await fetch(`data/${name}`)).arrayBuffer();
  const city = await resolveCity(await (await fetch('data/city.json')).json() as CityData, read, false) as MetroCity;
  const [tx, tz] = site.tile.split('_').map(Number), tile = await loadTile(city, tx, tz, read), b = site.building ? tile.buildings.find(x => x.id === site.building) : undefined;
  if (site.building && !b) { label.textContent = `Building ${site.building} is not in tile ${site.tile}`; done({ error: 'missing building' }); return; }
  const night = params.get('night') === '1'; setSiteNight(night);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = night ? .55 : 1; document.body.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(night ? '#0b1220' : '#a9c1d6');
  scene.add(new THREE.HemisphereLight(night ? '#33415a' : '#dfeaf5', night ? '#101010' : '#6f6a5d', night ? .5 : 1.25));
  const model = buildSite(city, site, b, false); scene.add(model.group);
  const box = new THREE.Box3().setFromObject(model.group), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), radius = Math.max(size.x, size.z, size.y * .8, 6) * .5;
  const sun = new THREE.DirectionalLight('#fff3df', night ? .15 : 2.6); sun.position.set(centre.x - radius * 2.2, centre.y + radius * 3.2, centre.z + radius * 1.6); sun.target.position.copy(centre); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const reach = radius * 2.6; Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: radius * 12 }); sun.shadow.bias = -.0004; scene.add(sun, sun.target);
  // Real terrain about the model, the water plane where there is any, and the neighbours as plain hulls.
  const span = Math.max(90, radius * 3), cells = 80, ground = new THREE.PlaneGeometry(span * 2, span * 2, cells, cells).rotateX(-Math.PI / 2), gp = ground.getAttribute('position');
  for (let i = 0; i < gp.count; i++) { const x = gp.getX(i) + centre.x, z = gp.getZ(i) + centre.z; gp.setXYZ(i, x, sampleElevation(city, x, z), z); }
  ground.computeVertexNormals(); const terrain = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: '#7f8c6c', roughness: 1 })); terrain.receiveShadow = true; scene.add(terrain);
  for (const area of city.water ?? []) for (const s of area.surfaces ?? []) if (s.rings[0]?.some(p => Math.hypot(p[0] - centre.x, p[1] - centre.z) < span * 3)) { const w = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, span * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3d5d6e', roughness: .25, metalness: .2, transparent: true, opacity: .85 })); w.position.set(centre.x, s.level, centre.z); scene.add(w); break; }
  const grey = new THREE.MeshStandardMaterial({ color: '#b9b6ae', roughness: .95 });
  for (const o of tile.buildings) {
    if (replacesSiteShell(o) || Math.hypot(o.center[0] - centre.x, o.center[1] - centre.z) > span * 1.2 || o.footprint.length < 3) continue;
    // A shell a site keeps and dresses is drawn as the game draws it: its packaged triangles in the site's plain finish.
    const data = hasSiteFinish(o) ? tile.geometry.get(o.id) : undefined;
    if (data) { for (const isRoof of [false, true]) { const g = tileShellGeometry(data, o, isRoof); if (g) { const mesh = new THREE.Mesh(g, siteShellMaterial(o, isRoof) ?? grey); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); } } continue; }
    const shape = new THREE.Shape(o.footprint.map(p => new THREE.Vector2(p[0], -p[1]))), g = new THREE.ExtrudeGeometry(shape, { depth: o.height, bevelEnabled: false }).rotateX(-Math.PI / 2), mesh = new THREE.Mesh(g, grey);
    mesh.position.y = o.baseElevation ?? sampleElevation(city, ...o.center); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  }
  // A person for scale beside the model, on the side of the nearest street.
  const road = closestRoad(city, centre.x, centre.z), toRoad = Math.atan2(road.x - centre.x, road.z - centre.z), figure = new THREE.Mesh(new THREE.CapsuleGeometry(.24, 1.25, 4, 8), new THREE.MeshStandardMaterial({ color: '#c0392b' }));
  { const x = centre.x + Math.sin(toRoad) * (Math.max(size.x, size.z) * .5 + 2.5), z = centre.z + Math.cos(toRoad) * (Math.max(size.x, size.z) * .5 + 2.5); figure.position.set(x, sampleElevation(city, x, z) + .87, z); figure.castShadow = true; scene.add(figure); }
  const yaw0 = params.has('yaw') ? Number(params.get('yaw')) : toRoad, base = b?.baseElevation ?? sampleElevation(city, centre.x, centre.z), far = Math.max(radius * 2.7, size.y * 1.5, 16), mid = base + size.y * .45;
  // Four views: the street front, both front quarters from above, and the back from above.
  const views: [number, number, number][] = [[yaw0, far * .92, base + Math.max(1.7, size.y * .12)], [yaw0 + .75, far, base + size.y * .85 + 4], [yaw0 - .85, far, base + size.y * .7 + 3], [yaw0 + Math.PI + .5, far * 1.05, base + size.y * 1.1 + 6]];
  if (params.has('close')) views[0] = [yaw0 + Number(params.get('close')), radius * 1.15 + 6, base + 1.7];
  const camera = new THREE.PerspectiveCamera(46, 1, .3, 4000), only = params.has('view') ? Number(params.get('view')) : -1;
  const draw = (t = 0) => {
    const w = innerWidth, h = innerHeight; renderer.setScissorTest(true);
    views.forEach(([yaw, d, y], i) => {
      if (only >= 0 && i !== only) return;
      const vx = only >= 0 ? 0 : (i % 2) * w / 2, vy = only >= 0 ? 0 : (1 - Math.floor(i / 2)) * h / 2, vw = only >= 0 ? w : w / 2, vh = only >= 0 ? h : h / 2, a = yaw + t;
      renderer.setViewport(vx, vy, vw, vh); renderer.setScissor(vx, vy, vw, vh); camera.aspect = vw / vh; camera.updateProjectionMatrix();
      camera.position.set(centre.x + Math.sin(a) * d, y, centre.z + Math.cos(a) * d); camera.lookAt(centre.x, mid, centre.z); renderer.render(scene, camera);
    });
  };
  draw(); if (params.get('spin') === '1') { const tick = (ms: number) => { draw(ms / 4000); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  const solid = model.collisions.reduce((n, c) => n + c.indices.length / 3, 0);
  label.textContent = `${site.id} · ${site.name} · ${Math.round(model.triangles)} triangles · ${size.x.toFixed(1)} x ${size.z.toFixed(1)} x ${size.y.toFixed(1)} m · base ${base.toFixed(2)}`;
  done({ id: site.id, triangles: Math.round(model.triangles), solid, size: size.toArray().map(v => +v.toFixed(2)), min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)), base: +base.toFixed(2), ground: +sampleElevation(city, centre.x, centre.z).toFixed(2), materials: model.group.children.length });
}
main().catch(error => { label.textContent = String(error?.stack ?? error); done({ error: String(error?.stack ?? error) }); });
