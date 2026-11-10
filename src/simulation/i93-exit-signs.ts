import type { Road } from '../types';
import { tunnelPointAt, tunnelStations } from './tunnels.ts';

// MassDOT's mileage-based numbers and the Boston MPO ramp diagrams, checked
// against i93-north-source.json. Exit 22 northbound follows the Medford photo.
interface ExitLegend {
  rampId: string;
  number: string;
  routes?: readonly string[];
  direction?: string;
  lines: readonly string[];
  setback?: number;
}

const medfordSquare = { number: '23', routes: ['60'], lines: ['Medford Sq', 'Malden'] };
const fellswayWest = { number: '24', routes: ['28'], lines: ['Fellsway West', 'Winchester'] };
const exits: ExitLegend[] = [
  { rampId: 'i93-sb-exit-20', number: '20', lines: ['Sullivan Square', 'Charlestown', 'Assembly Square'] },
  { rampId: 'i93-nb-exit-21', number: '21', routes: ['28', '38'], lines: ['Somerville', 'Medford'], setback: 95 },
  { rampId: 'i93-sb-exit-21', number: '21', routes: ['38'], lines: ['Mystic Ave', 'Medford / Somerville'] },
  { rampId: 'i93-nb-exit-22', number: '22', routes: ['16'], direction: 'WEST', lines: ['Mystic Valley Pkwy', 'Arlington'] },
  { rampId: 'i93-sb-exit-22', number: '22', routes: ['16'], direction: 'EAST', lines: ['Revere Beach Pkwy', 'Everett / Revere'] },
  { rampId: 'i93-nb-exit-23', ...medfordSquare },
  { rampId: 'i93-sb-exit-23', ...medfordSquare },
  { rampId: 'i93-nb-exit-24', ...fellswayWest },
  { rampId: 'i93-sb-exit-24', ...fellswayWest },
];

export interface I93ExitSign extends ExitLegend {
  road: Road;
  station: number;
  approach: ReturnType<typeof tunnelPointAt>;
}

/** The generator splits each carriageway at its gores. Walk back from the
 * ramp's start along that carriageway, across lane-count and deck seams. */
export function planI93ExitSigns(roads: readonly Road[]): I93ExitSign[] {
  const ramps = new Map(roads.filter(road => road.kind === 'motorway_link').map(road => [road.id, road]));
  const inbound = new Map<string, Road>();
  for (const road of roads) {
    const direction = /^i93-(nb|sb)-\d+$/.exec(road.id)?.[1];
    if (direction && road.elevations && road.points.length >= 2) {
      inbound.set(`${direction}:${road.points.at(-1)}`, road);
    }
  }

  const signs: I93ExitSign[] = [];
  for (const exit of exits) {
    const ramp = ramps.get(exit.rampId);
    if (!ramp?.points.length) continue;
    const direction = ramp.id.split('-')[1];
    let road = inbound.get(`${direction}:${ramp.points[0]}`);
    let remaining = exit.setback ?? 120;
    while (road) {
      const length = tunnelStations(road).at(-1)!;
      if (length <= 0) break;
      if (length >= remaining) {
        const station = length - remaining;
        signs.push({ ...exit, road, station, approach: tunnelPointAt(road, station) });
        break;
      }
      remaining -= length;
      road = inbound.get(`${direction}:${road.points[0]}`);
    }
  }
  return signs;
}
