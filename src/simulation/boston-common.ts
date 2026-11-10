import data from '../data/boston-common.json' with {type:'json'};
import type {CityArea, Point2} from '../types.ts';

export const BOSTON_COMMON = 'Boston Common';
export const FROG_POND = 'Frog Pond';
export const commonTrees = data.trees as [x: number, z: number, species: string, scale: number][];
export const frogPondApron = data.apron as Point2[];
const basin = [data.basin as Point2[]];

// The paved basin sits above the small height variations in the 6 m DEM.
export const FROG_POND_LEVEL = 5.66;

/** The city hydro layer maps only a small part of the wading pool. Publish the
 * refined outline to the map and ground-surface queries as well as the renderer. */
export function refineFrogPond(water: CityArea): CityArea {
  if (water.name !== FROG_POND) return water;
  return {
    ...water,
    rings: basin,
    surfaces: [{source: 'osm-way-23787089', name: FROG_POND, level: FROG_POND_LEVEL, rings: basin}],
  };
}
