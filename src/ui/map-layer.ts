import type {CityData, Point2} from '../types';

type Bounds = CityData['bounds'];

export function pointBounds(points: readonly Point2[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return {minX, maxX, minZ, maxZ};
}

export function overlaps(view: Bounds, item: Bounds) {
  return item.maxX > view.minX && item.minX < view.maxX && item.maxZ > view.minZ && item.minZ < view.maxZ;
}

/** The minimap moves a few metres between draws. Keep the static features around it
 * in paint order, then apply the exact viewport bounds on every draw. */
export function mapLayer<T extends Bounds>(items: T[]) {
  let region: Bounds | undefined, nearby: T[] = [];
  return (view: Bounds, atlas: boolean): T[] => {
    if (atlas) return items.filter(item => overlaps(view, item));
    if (!region || view.minX < region.minX || view.maxX > region.maxX ||
        view.minZ < region.minZ || view.maxZ > region.maxZ) {
      const margin = 250;
      const next = {minX: view.minX - margin, maxX: view.maxX + margin, minZ: view.minZ - margin, maxZ: view.maxZ + margin};
      nearby = items.filter(item => overlaps(next, item));
      region = next;
    }
    return nearby.filter(item => overlaps(view, item));
  };
}
