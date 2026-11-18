import type * as THREE from 'three';
import type { CityData, Point2 } from '../types.ts';
import { waterHeight } from '../simulation/water-level.ts';
import { FROG_POND, FROG_POND_LEVEL, frogPondApron } from '../simulation/boston-common.ts';
import { isChristianSciencePool } from './christian-science-plaza.ts';
import { waterShore, type WaterShore } from './water-shore.ts';
import { clipWaterfrontTerrainSteps } from './waterfront-terrain.ts';
import { due, type Pace } from './pacing.ts';

const frogPondCut=[ [frogPondApron] ];
const masks = new WeakMap<WaterShore, Point2[][][]>();
const extents = new WeakMap<Point2[][], { minX: number; maxX: number; minZ: number; maxZ: number }>();

/** Replace DEM wedges inside mapped water with the matching sloping bank.
 * Use exactly the rounded surface rings, including islands and basin seams.
 * Underwater terrain and road/path foundations remain physical supports.
 * Shared masks retain the clipping index across streamed tiles and lawn layers. */
export function* clipShoreTerrainSteps(city: CityData, geometry: THREE.BufferGeometry, pace?: Pace): Generator<void, THREE.BufferGeometry> {
  const positions = geometry.getAttribute('position');
  if (!positions?.count || !city.water?.length) return geometry;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    if (i % 8192 === 0 && due(pace)) yield;
    minX = Math.min(minX, positions.getX(i)); maxX = Math.max(maxX, positions.getX(i));
    minZ = Math.min(minZ, positions.getZ(i)); maxZ = Math.max(maxZ, positions.getZ(i)); maxY = Math.max(maxY, positions.getY(i));
  }
  for (const water of city.water ?? []) {
    if (isChristianSciencePool(water)) continue;
    if(water.name===FROG_POND){
      yield* clipWaterfrontTerrainSteps(city,geometry,pace,frogPondCut,{level:FROG_POND_LEVEL,preserveGround:true});
      continue;
    }
    for (const surface of water.surfaces ?? [{ rings: water.rings, level: waterHeight(city, water) }]) {
      if (due(pace)) yield;
      if (maxY <= surface.level + .03) continue;
      let extent = extents.get(surface.rings);
      if (!extent) {
        extent = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const [x, z] of surface.rings[0] ?? []) {
          extent.minX = Math.min(extent.minX, x); extent.maxX = Math.max(extent.maxX, x);
          extent.minZ = Math.min(extent.minZ, z); extent.maxZ = Math.max(extent.maxZ, z);
        }
        extents.set(surface.rings, extent);
      }
      if (extent.maxX < minX || extent.minX > maxX || extent.maxZ < minZ || extent.minZ > maxZ) continue;
      const shore = waterShore(water, surface.rings);
      let polygons = masks.get(shore);
      if (!polygons) { polygons = [shore.rings]; masks.set(shore, polygons); }
      yield* clipWaterfrontTerrainSteps(city, geometry, pace, polygons, { level: surface.level, preserveGround: true });
    }
  }
  return geometry;
}
