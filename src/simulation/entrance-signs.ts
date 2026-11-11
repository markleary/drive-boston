import type { CityData, Road } from '../types';
import { buildingAt } from './city-tiles.ts';
import { deckUndersideAt } from './road-surfaces.ts';
import { tunnelCoveredAt, tunnelPointAt, tunnelStations } from './tunnels.ts';

/** The overhead sign at a highway entrance: a green panel on a gantry over the ramp's mouth, as the Turnpike posts
 * them where a ramp leaves a city street. The legends are reviewed, one row an entrance, like the exit legends
 * of `i93-exit-signs.ts`; a ramp without a row keeps whatever its tunnel signs overhead. */
interface EntranceLegend {
  rampId: string;
  /** Interstate number in the red, white and blue shield. */
  shield: string;
  direction: string;
  /** Destinations under the shield row. */
  lines: readonly string[];
  /** The Massachusetts Turnpike's marker (a pilgrim's hat) beside the shield. */
  pike?: boolean;
  /** Metres from the end of the ramp's street landing to the gantry (GANTRY_SETBACK). */
  setback?: number;
}

const entrances: EntranceLegend[] = [
  // Dartmouth Street at Copley Square, beside the Boston Public Library: the gantry at the mouth of the slot
  // between Huntington Avenue's carriageways reads 90 WEST, New York, with an arrow down onto the ramp.
  { rampId: 'i90-wb-entrance-copley', shield: '90', direction: 'WEST', lines: ['New York'], pike: true },
];

/** The gantry stands this far beyond the ramp's street landing: where the walls of its slot have risen to their height. */
export const GANTRY_SETBACK = 9;
/** Panel size (metres) and the headroom under it over the ramp. */
export const ENTRANCE_PANEL = { width: 3.6, height: 3 };
export const ENTRANCE_CLEARANCE = 5.1;
/** A post stands this far outside the ramp's pavement edge: behind the wall of its slot. */
export const POST_OFFSET = .55;

export interface EntranceSign extends EntranceLegend {
  road: Road;
  station: number;
  approach: ReturnType<typeof tunnelPointAt>;
}

/** The reviewed entrance signs on the records that carry them: `setback` beyond the street landing of the ramp
 * (its first metres, where it has no landing), in the open. One that would stand under a roof is left out. */
export function planEntranceSigns(roads: readonly Road[]): EntranceSign[] {
  const ramps = new Map(roads.filter(road => road.kind === 'motorway_link').map(road => [road.id, road]));
  const signs: EntranceSign[] = [];
  for (const legend of entrances) {
    const road = ramps.get(legend.rampId);
    if (!road?.elevations || road.points.length < 2) continue;
    const total = tunnelStations(road).at(-1)!, landing = road.tunnel?.surfaceLandings?.find(([a]) => a < .01)?.[1] ?? 0;
    const station = landing + (legend.setback ?? GANTRY_SETBACK);
    if (station > total - 1 || (road.tunnel && tunnelCoveredAt(road, station))) continue;
    signs.push({ ...legend, road, station, approach: tunnelPointAt(road, station) });
  }
  return signs;
}

/** Where a sign's two posts stand (world x, z; `across` metres left of travel) and the heights of its panel over the datum. */
export function entranceGantry(sign: EntranceSign) {
  const { x, y, z, yaw, width } = sign.approach, reach = width / 2 + POST_OFFSET;
  const posts = [1, -1].map(side => ({ x: x + Math.cos(yaw) * side * reach, z: z - Math.sin(yaw) * side * reach, across: side * reach }));
  return { posts, reach, bottom: y + ENTRANCE_CLEARANCE, top: y + ENTRANCE_CLEARANCE + ENTRANCE_PANEL.height };
}

/** Whether a sign can stand where it is planned: no bridge in its panel's way and no building on a post's place
 * (a building is its stored hull here, as for street furniture, so a sprawling complex beside the ramp counts). */
export function entranceSignStands(city: CityData, sign: EntranceSign) {
  const gantry = entranceGantry(sign), { x, y, z } = sign.approach;
  return deckUndersideAt(city, x, z, y + 2.5) >= gantry.top + 1 && !gantry.posts.some(post => buildingAt(city, post.x, post.z));
}
