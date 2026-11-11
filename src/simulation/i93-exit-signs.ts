import type { Road } from '../types';
import { tunnelCoveredAt, tunnelPointAt, tunnelStations } from './tunnels.ts';

// MassDOT's mileage-based numbers and the Boston MPO ramp diagrams, checked
// against i93-north-source.json. Exit 22 northbound follows the Medford photo.
interface ExitLegend {
  rampId: string;
  /** Exit number on the tab; Storrow Drive's exits carry none. */
  number?: string;
  routes?: readonly string[];
  direction?: string;
  lines: readonly string[];
  setback?: number;
  /** Panel size against the Interstate one: Storrow Drive's two lanes take a smaller sign. */
  scale?: number;
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
  // The Massachusetts Turnpike's mileage-based numbers (2021). Exits 133 and 137 leave inside its tunnels,
  // which sign their own exits overhead (tunnelExitSigns), as does every exit whose advance sign would hang under a roof.
  { rampId: 'i90-eb-exit-131', number: '131', lines: ['Cambridge', 'Brighton'] },
  { rampId: 'i90-wb-exit-131', number: '131', lines: ['Brighton', 'Cambridge'] },
  { rampId: 'i90-eb-exit-133', number: '133', lines: ['Prudential Ctr', 'Copley Sq'] },
  { rampId: 'i90-eb-exit-134', number: '134', lines: ['South Station', 'I-93'] },
  { rampId: 'i90-eb-exit-135', number: '135', lines: ['South Boston'] },
  { rampId: 'i90-wb-exit-135', number: '135', lines: ['South Boston'] },
  { rampId: 'i90-eb-exit-137', number: '137', lines: ['Logan Airport'] },
  { rampId: 'route1a-nb-exit-neptune', lines: ['Neptune Rd', 'East Boston'] },
  { rampId: 'route1a-sb-exit-logan', lines: ['Logan Airport'] },
  // Storrow Drive: unnumbered exits on a parkway signed for cars only.
  { rampId: 'storrow-eb-exit-university', lines: ['University Rd', 'Boston University'], scale: .7, setback: 70 },
  { rampId: 'storrow-wb-exit-charlesgate', lines: ['Fenway', 'Kenmore Sq'], scale: .7, setback: 80 },
  { rampId: 'storrow-wb-exit-massachusetts-avenue', routes: ['2A'], lines: ['Mass Ave', 'Cambridge'], scale: .7, setback: 80 },
  { rampId: 'storrow-eb-exit-clarendon', lines: ['Copley Sq', 'Back Bay'], scale: .7, setback: 80 },
  { rampId: 'storrow-eb-exit-beacon', lines: ['Beacon St', 'Arlington St'], scale: .7, setback: 80 },
];
/** A carriageway record: its family (`i90-eb`) is its id less the piece number. */
const CARRIAGEWAY = /^(i93-(?:nb|sb)|i90-(?:eb|wb)|storrow-(?:eb|wb))-\d+$/;

export interface I93ExitSign extends ExitLegend {
  road: Road;
  station: number;
  approach: ReturnType<typeof tunnelPointAt>;
}

/** The generators split each carriageway (I-93, the Turnpike, Storrow Drive) at
 * its gores. Walk back from the ramp's start along the carriageway it leaves,
 * across lane-count, deck and tunnel seams. A sign that would stand under a
 * tunnel's roof is left to the tunnel's own overhead signs. */
export function planI93ExitSigns(roads: readonly Road[]): I93ExitSign[] {
  const ramps = new Map(roads.filter(road => road.kind === 'motorway_link').map(road => [road.id, road]));
  const inbound = new Map<string, Road>(), ending = new Map<string, string>();
  for (const road of roads) {
    const family = CARRIAGEWAY.exec(road.id)?.[1];
    if (family && road.elevations && road.points.length >= 2) {
      inbound.set(`${family}:${road.points.at(-1)}`, road); ending.set(`${road.points.at(-1)}`, family);
    }
  }

  const signs: I93ExitSign[] = [];
  for (const exit of exits) {
    const ramp = ramps.get(exit.rampId);
    if (!ramp?.points.length) continue;
    const family = ending.get(`${ramp.points[0]}`);
    let road = family && inbound.get(`${family}:${ramp.points[0]}`);
    let remaining = exit.setback ?? 120;
    while (road) {
      const length = tunnelStations(road).at(-1)!;
      if (length <= 0) break;
      if (length >= remaining) {
        const station = length - remaining;
        if (!(road.tunnel && tunnelCoveredAt(road, station))) signs.push({ ...exit, road, station, approach: tunnelPointAt(road, station) });
        break;
      }
      remaining -= length;
      road = inbound.get(`${family}:${road.points[0]}`);
    }
  }
  return signs;
}
