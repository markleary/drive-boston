import type { Road } from '../types';

export type RoadBox = { minX: number; maxX: number; minZ: number; maxZ: number };
/** The roads of a metro by 250 m cell: the box of each, and those whose box meets a query box, each once, in an
 * order that depends on the query alone (cell by cell, then as the city lists them). The tile builder, and whatever
 * plans a tile as it does (tests, the street furniture audit), draw a tile's roads from here in the same order. */
export function roadCells(roads: readonly Road[], cell = 250) {
  const cells = new Map<string, Road[]>(), boxes = new Map<Road, RoadBox>();
  for (const road of roads) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of road.points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    boxes.set(road, { minX, maxX, minZ, maxZ });
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) { const key = `${cx},${cz}`, list = cells.get(key); if (list) list.push(road); else cells.set(key, [road]); }
  }
  const near = (box: RoadBox): Road[] => {
    const seen = new Set<Road>(), result: Road[] = [];
    for (let cx = Math.floor(box.minX / cell); cx <= Math.floor(box.maxX / cell); cx++) for (let cz = Math.floor(box.minZ / cell); cz <= Math.floor(box.maxZ / cell); cz++) for (const road of cells.get(`${cx},${cz}`) ?? []) {
      if (seen.has(road)) continue; seen.add(road);
      const b = boxes.get(road)!; if (b.minX <= box.maxX && b.maxX >= box.minX && b.minZ <= box.maxZ && b.maxZ >= box.minZ) result.push(road);
    }
    return result;
  };
  return { boxes, near };
}
export type RoadCells = ReturnType<typeof roadCells>;
