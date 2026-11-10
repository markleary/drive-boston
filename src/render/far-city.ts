import * as THREE from 'three';
import type { CityData } from '../types';
import type { MetroCity } from '../simulation/city-tiles.ts';
import { drawsFarMassing, type FarBuilding, type FarTile } from '../simulation/far-format.ts';
import { terrainGrid } from '../simulation/terrain.ts';
import { FACADE_STYLES } from './materials.ts';
import { HOUSE_FAR_STYLE, HOUSE_PALETTES } from './house-styles.ts';
import { clipPortalSurface } from './terrain-ground.ts';
import { farPassageFootprints, isTunnelPassageFar } from '../simulation/tunnel-passages.ts';

/** Distant representation of the whole metro: one flat-shaded box per hull
 * (its minimum-area oriented rectangle; a sprawling complex by its massing
 * fragments instead) and a coarse terrain sheet, both per 1 km chunk. The
 * streamer hides a chunk's pair once its detailed tile is built, and nothing
 * here depends on which tiles are loaded. A chunk's boxes are instances of one
 * unit box (a matrix and a wall colour each), not thirty vertices apiece. */
export interface FarCityView { group: THREE.Group; setChunkDetailed(key: string, detailed: boolean): void; update(position: THREE.Vector3, altitude: number): void; chunkCount: number; buildingCount: number; stats(): { residentChunks: number; buildings: number; geometryBytes: number }; }

const FAR_STEP = 5; // grid cells per coarse terrain vertex (30 m at 6 m cells)

export { orientedBox } from '../simulation/oriented-box.ts';
import { orientedBox } from '../simulation/oriented-box.ts';

function styleColor(style: number) {
  // From HOUSE_FAR_STYLE on, a style byte names a northern house palette (house-styles.ts).
  const house = style >= HOUSE_FAR_STYLE ? HOUSE_PALETTES[style - HOUSE_FAR_STYLE] : undefined;
  const base = new THREE.Color(house?.body ?? FACADE_STYLES[Math.min(style, FACADE_STYLES.length - 1)]?.base ?? '#8a8278');
  // Slightly lifted and desaturated: haze between the camera and a distant block.
  return base.lerp(new THREE.Color('#b9bcb8'), .22);
}

export function createFarCity(scene: THREE.Scene, city: CityData, mobile = false, replaced?: ReadonlySet<FarBuilding>): FarCityView | undefined {
  const metro = city as MetroCity; if (!metro.far || !metro.tiles) return undefined;
  const group = new THREE.Group(); group.name = 'Distant metro'; scene.add(group);
  const chunks = new Map<string, { buildings?: THREE.InstancedMesh; ground?: THREE.Mesh; detailed: boolean; center: THREE.Vector3; count: number }>();
  const size = metro.tiles.size;
  const groundMaterial = new THREE.MeshLambertMaterial({ color: '#b9bea8' });
  let buildingCount = 0;
  const colors = Array.from({ length: HOUSE_FAR_STYLE + HOUSE_PALETTES.length }, (_, i) => styleColor(i)), roofColor = new THREE.Color('#7d7a72');
  // Colours travel as bytes, walls per instance and the roof's in the shader, at the eight bits the vertex colours had.
  const byte = (value: number) => Math.floor(value * 255);
  const buildingMaterial = new THREE.MeshLambertMaterial();
  buildingMaterial.onBeforeCompile = shader => {
    shader.uniforms.farRoof = { value: new THREE.Vector3(byte(roofColor.r) / 255, byte(roofColor.g) / 255, byte(roofColor.b) / 255) };
    shader.vertexShader = 'attribute float roof;\nuniform vec3 farRoof;\n' + shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix( vColor.rgb, farRoof, roof );');
  };
  buildingMaterial.customProgramCacheKey = () => 'far-city-boxes-1';
  const grid = terrainGrid(city);
  for (const key of metro.tiles.keys) {
    const [tx, tz] = key.split('_').map(Number);
    chunks.set(key, { detailed: false, count: 0, center: new THREE.Vector3((tx + .5) * size, 0, (tz + .5) * size) });
  }
  // The unit box: x and z from -1 to 1 (along and across the hull's rectangle), y from 0 to 1. Five faces (no
  // floor), flat normals from a non-indexed layout: 30 vertices. Walls wind counter-clockwise seen from outside:
  // the per-building boxes this replaces wound them the other way, so a distant block showed the inside of its
  // far walls, lit by normals facing away from the viewer.
  const unitBox = new THREE.BufferGeometry();
  {
    const positions = new Float32Array(30 * 3), normals = new Float32Array(30 * 3), roof = new Float32Array(30); let v = 0;
    const put = (su: number, y: number, sv: number, nx: number, ny: number, nz: number, top = 0) => { positions[v * 3] = su; positions[v * 3 + 1] = y; positions[v * 3 + 2] = sv; normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz; roof[v++] = top; };
    for (const [su0, sv0, su1, sv1, nu, nv] of [[1, -1, 1, 1, 1, 0], [-1, 1, -1, -1, -1, 0], [-1, -1, 1, -1, 0, -1], [1, 1, -1, 1, 0, 1]]) {
      for (const [su, sv, y] of [[su0, sv0, 0], [su1, sv1, 1], [su1, sv1, 0], [su0, sv0, 0], [su0, sv0, 1], [su1, sv1, 1]]) put(su, y, sv, nu, 0, nv);
    }
    for (const [su, sv] of [[-1, -1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]) put(su, 1, sv, 0, 1, 0, 1);
    unitBox.setAttribute('position', new THREE.BufferAttribute(positions, 3)); unitBox.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); unitBox.setAttribute('roof', new THREE.BufferAttribute(roof, 1));
  }
  const placement = new THREE.Matrix4();
  function buildBuildings(tile: FarTile) {
    // A hidden complex is boxed by its massing fragments, which share its chunk and so hide with its tile.
    // A tunnel-passage building is boxed by the pieces its detailed shell keeps (see tunnel-passages.ts).
    const list = tile.buildings.filter(b => !replaced?.has(b) && drawsFarMassing(b) && b.height >= 3 && b.footprint.length >= 3).flatMap(b => isTunnelPassageFar(tile.key, b) ? farPassageFootprints(city, b).map(footprint => ({ ...b, footprint })) : [b]);
    if (!list.length) return;
    const count = list.length, mesh = new THREE.InstancedMesh(unitBox, buildingMaterial, count), tint = new Uint8Array(count * 3);
    list.forEach((b, i) => {
      // From a metre below the base to the top; the rectangle's axes carry its half lengths.
      const box = orientedBox(b.footprint), y0 = b.base - 1, wall = colors[Math.min(b.style, colors.length - 1)] ?? colors[0];
      placement.set(box.ux * box.half, 0, -box.uz * box.halfPerp, box.cx, 0, b.height + 1, 0, y0, box.uz * box.half, 0, box.ux * box.halfPerp, box.cz, 0, 0, 0, 1);
      mesh.setMatrixAt(i, placement); tint[i * 3] = byte(wall.r); tint[i * 3 + 1] = byte(wall.g); tint[i * 3 + 2] = byte(wall.b);
    });
    mesh.instanceColor = new THREE.InstancedBufferAttribute(tint, 3, true); mesh.computeBoundingSphere();
    mesh.name = `Distant blocks ${tile.key}`; mesh.userData.noAO = true; mesh.receiveShadow = false; mesh.castShadow = false;
    group.add(mesh); buildingCount += count;
    const chunk = chunks.get(tile.key)!; chunk.buildings = mesh; chunk.count = count;
  }
  // Coarse ground shares the full-resolution terrain's datum and chunk edges.
  function buildGround(key: string) {
    if (!grid) return;
    const step = grid.cellSize * FAR_STEP;
    const cellsX = Math.ceil(size / step), cellsZ = cellsX;
    const [tx, tz] = key.split('_').map(Number), x0 = tx * size, z0 = tz * size;
    const w = cellsX + 1, h = cellsZ + 1, positions = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2), indices = new Uint16Array(cellsX * cellsZ * 6);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = Math.min(x0 + i * step, x0 + size), z = Math.min(z0 + j * step, z0 + size), n = j * w + i;
      positions[n * 3] = x; positions[n * 3 + 1] = sampleGrid(grid, x, z) - .35; positions[n * 3 + 2] = z; uv[n * 2] = x / 4; uv[n * 2 + 1] = z / 4;
    }
    let o = 0;
    for (let j = 0; j < cellsZ; j++) for (let i = 0; i < cellsX; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; indices.set([a, c, b, b, c, d], o); o += 6; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    clipPortalSurface(city,geometry);
    const mesh = new THREE.Mesh(geometry, groundMaterial); mesh.name = `Distant ground ${key}`; mesh.renderOrder = -4; mesh.userData.noAO = true; group.add(mesh);
    chunks.get(key)!.ground = mesh;
  }
  function release(key: string) {
    const chunk = chunks.get(key)!;
    // The boxes' geometry is shared: a chunk owns only its instance buffers.
    if (chunk.buildings) { group.remove(chunk.buildings); chunk.buildings.dispose(); }
    if (chunk.ground) { group.remove(chunk.ground); chunk.ground.geometry.dispose(); }
    buildingCount -= chunk.count; chunk.count = 0; chunk.buildings = undefined; chunk.ground = undefined;
  }
  function build(key: string) {
    const tile = metro.far.tiles.get(key); if (tile) buildBuildings(tile); buildGround(key);
  }
  // Desktop retains its complete skyline. Mobile creates nearby chunks on
  // demand and releases geometry behind the observer, instead of retaining
  // the entire metro's vertex arrays and GPU buffers for the session.
  if (!mobile) for (const key of chunks.keys()) build(key);
  function setChunkDetailed(key: string, detailed: boolean) {
    const chunk = chunks.get(key); if (!chunk) return; chunk.detailed = detailed;
    if (mobile && detailed) release(key);
    if (chunk.buildings) chunk.buildings.visible = !detailed;
    if (chunk.ground) chunk.ground.visible = !detailed;
  }
  function update(position: THREE.Vector3, altitude: number) {
    const reach = mobile ? Math.min(3000, 1600 + altitude * .6) : 2300 + altitude * 1.5;
    // One new mobile chunk per frame, nearest first. Hysteresis prevents
    // repeated allocation/disposal when driving along a distance boundary.
    let next: { key: string; distance: number } | undefined;
    for (const [key, chunk] of chunks) {
      const distance = Math.hypot(chunk.center.x - position.x, chunk.center.z - position.z);
      if (mobile && distance > reach + 700 && (chunk.buildings || chunk.ground)) release(key);
      const visible = !chunk.detailed && distance < reach;
      if (chunk.buildings) chunk.buildings.visible = visible;
      if (chunk.ground) chunk.ground.visible = visible;
      if (mobile && visible && !chunk.buildings && !chunk.ground && (!next || distance < next.distance)) next = { key, distance };
    }
    if (next) build(next.key);
  }
  function stats() {
    let residentChunks = 0, geometryBytes = 0;
    for (const chunk of chunks.values()) {
      if (chunk.buildings || chunk.ground) residentChunks++;
      if (chunk.buildings) geometryBytes += chunk.buildings.instanceMatrix.array.byteLength + (chunk.buildings.instanceColor?.array.byteLength ?? 0);
      if (chunk.ground) {
        for (const attribute of Object.values(chunk.ground.geometry.attributes)) geometryBytes += attribute.array.byteLength;
        geometryBytes += chunk.ground.geometry.index?.array.byteLength ?? 0;
      }
    }
    return { residentChunks, buildings: buildingCount, geometryBytes };
  }
  return { group, setChunkDetailed, update, chunkCount: chunks.size, get buildingCount() { return buildingCount; }, stats };
}

function sampleGrid(grid: NonNullable<ReturnType<typeof terrainGrid>>, x: number, z: number) {
  const fx = Math.max(0, Math.min(grid.width - 1, (x - grid.originX) / grid.cellSize)), fz = Math.max(0, Math.min(grid.height - 1, (z - grid.originZ) / grid.cellSize));
  const i = Math.min(grid.width - 2, Math.floor(fx)), j = Math.min(grid.height - 2, Math.floor(fz)), tx = fx - i, tz = fz - j, k = j * grid.width + i;
  const a = grid.heights[k], b = grid.heights[k + 1], c = grid.heights[k + grid.width], d = grid.heights[k + grid.width + 1];
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}
export type { FarBuilding };
