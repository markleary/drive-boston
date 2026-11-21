import type { BufferGeometry } from 'three';
import type { Building, CityData, Point2 } from '../types';
import { sampleElevation } from '../simulation/terrain.ts';
import { houseFloors } from './house-styles.ts';
import { HOUSE_GRID } from './house-materials.ts';
import { Shapes, door, frame, outward, railing, rectPoly, slope, wallFrame, type Frame, type SiteKit, type V3 } from './site-kit.ts';

export const MELROSE_SCHOOL = 'osm-way-135425346';
export const FLORENCE_HOUSE = 'osm-way-29627148';

// u runs along each street frontage, v goes back into the building. The corners
// are measured on the packaged school wings and the actual Florence gable wall.
const campus = frame([575.046, -12615.21], [743.125, -12640.637], [645, -12692]);
const house = frame([74.91, -11556.945], [71.444, -11550.973], [78, -11550]);

/** Fit whole windows to the mapped wall runs at 125 Florence. Each vertical
 * wall triangle spans its run; a recessed return faces the street too. Work
 * in the original texture coordinates so trim, glass and night lighting agree. */
export function fitFlorenceWindows(walls: BufferGeometry, b: Building) {
  const { position, normal, uv } = walls.attributes;
  const spacing = HOUSE_GRID.spacing, base = b.baseElevation!;
  const frontLimit = 1.5 * spacing - 1.12; // Leave the next bay's trim and shutters outside both corners.
  for (let i = 0; i < position.count; i += 3) {
    const vertices = [i, i + 1, i + 2];
    if (vertices.every(j => position.getY(j) > base + .05)) continue; // Gables keep their shingle mapping.
    const nx = normal.getX(i), nz = normal.getZ(i);
    if (nx * house.V[0] + nz * house.V[1] > .95) continue; // Rear elevation.
    const along = vertices.map(j => uv.getX(j) * 6);
    const min = Math.min(...along), max = Math.max(...along), width = max - min;
    if (width < .01) continue;
    const streetWall = vertices.every(j => Math.abs(house.vOf([position.getX(j), position.getZ(j)])) < .05);
    const leftWall = nx * house.U[0] + nz * house.U[1] < -.95;
    const bays = leftWall ? Math.round(width / spacing) : 0;
    for (const [k, j] of vertices.entries()) {
      let u;
      if (streetWall) {
        // Keep the front pair centered about the door, with bare boards beyond both casings.
        u = along[k] * Math.min(1, frontLimit / Math.max(-min, max));
      } else {
        const t = (along[k] - min) / width;
        // Each left-side run ends between bays. On the perpendicular returns and
        // opposite side, sample the strip of plain clapboard between painted windows.
        u = bays ? t * bays * spacing : (t - .5) * .5;
      }
      uv.setX(j, u / 6);
    }
  }
  uv.needsUpdate = true;
}

function point(f: Frame, u: number, v: number, y: number): V3 {
  const [x, z] = f.W(u, v);
  return [x, y, z];
}

/** Descend from the landing in even risers, sizing the flight against the
 * terrain at its toe. Long flights have a level rest halfway down. */
function entranceSteps(S: Shapes, k: SiteKit, city: CityData, f: Frame, u: number, v: number, width: number, top: number) {
  const tread = .34;
  const ground = (across: number, depth: number) => sampleElevation(city, ...f.W(u + across, v - depth));
  const highest = (depth: number) => Math.max(...[-width / 2, 0, width / 2].map(s => ground(s, depth)));
  let count = 1, rest = 0;
  // Both mapped sites have falling ground away from the front. Include the
  // width of the lower landing when measuring the final transition to grade.
  while (count < 60) {
    rest = count > 16 ? 1.6 : 0;
    if ((top - highest(count * tread + rest + .55) - .04) / count <= .18) break;
    count++;
  }
  const run = count * tread + rest + .55, rise = (top - highest(run) - .04) / count;
  const middle = Math.floor(count / 2);
  let from = 0;
  const railProfile: [number, number][] = [[0, top]];
  for (let i = 1; i <= count; i++) {
    const to = from + tread + (i === middle ? rest : 0) + (i === count ? .55 : 0);
    const h = top - i * rise;
    const [x, z] = f.W(u, v - (from + to) / 2);
    const bottom = Math.min(...[-width / 2, 0, width / 2].flatMap(s => [ground(s, from), ground(s, to)])) - .2;
    S.block(k.concrete, width, to - from, x, z, bottom, h, f.yaw);
    if (i === middle && rest) railProfile.push([from, h], [to, h]);
    from = to;
  }
  railProfile.push([run, top - count * rise]);
  if (width > 3) for (const s of [-width / 2 + .12, 0, width / 2 - .12]) {
    railing(S, k.iron, railProfile.map(([d, h]) => point(f, u + s, v - d, h)), .94);
  }
}

export function schoolEntrance(city: CityData, b: Building, k: SiteKit): Shapes {
  const S = new Shapes(), y = b.baseElevation!, f = campus;
  // Fill the south forecourt between the two wings, up to the recessed wall.
  // The back edges tuck into those walls. The outer edge is on the original
  // raised campus frontage shown from Lynn Fells Parkway.
  const centre = 99, width = 8, left = centre - width / 2, right = centre + width / 2;
  // Recess the upper landing four metres so the bottom tread clears the
  // mapped east-west service lane in front of the school.
  const inset = 4;
  const loopSetback = 11; // The school parking loop turns back along the east wing.
  const court = [[28, 0], [left, 0], [left, inset], [right, inset], [right, loopSetback], [160, loopSetback],
    [160, 33], [112, 33], [112, 90], [102, 92], [85, 92], [83, 23], [28, 12]]
    .map(([u, v]) => f.W(u, v));
  S.prism(k.concrete, court, Math.min(...court.map(p => sampleElevation(city, ...p))) - .35, y, { top: k.grass });
  const path = rectPoly(f, { u0: left, u1: right, v0: inset, v1: 90.8 });
  S.cap(k.paving, path, y + .025, true, false);
  const doorWall = wallFrame([646.74, -12717.19], [662.88, -12720.16], [-f.V[0], -f.V[1]]);
  door(S, k, doorWall, centre - f.uOf(doorWall.a), y + .025, 2.6, 2.6, { glazed: true });
  railing(S, k.iron, [point(f, 28.6, .15, y), point(f, left - .12, .15, y), point(f, left - .12, inset, y)], 1.05);
  railing(S, k.iron, [point(f, right - .12, inset, y), point(f, right - .12, loopSetback + .15, y), point(f, 159, loopSetback + .15, y)], 1.05);
  entranceSteps(S, k, city, f, centre, inset, width, y);
  return S;
}

export function florenceEntrance(city: CityData, b: Building, k: SiteKit): Shapes {
  const S = new Shapes(), f = house, wall = wallFrame(f.W(0, 0), f.W(6.9, 0), [-f.V[0], -f.V[1]]);
  const floor = b.baseElevation! + houseFloors(b).foundation, soffit = floor + 2.59;
  // The porch turns down the right wall, leaving the small driveway on the left clear.
  const w = wall.length, depth = 1.65, sideEnd = 4.1, entry = f.uOf(b.center); // Between the facade's two window bays.
  const outline = [[0, 0], [0, -depth], [w + depth, -depth], [w + depth, sideEnd], [w, sideEnd], [w, 0]];
  const deck = outline.map(([u, v]) => f.W(u, v));
  S.prism(k.tint('planks', '#777a72'), deck, floor - .22, floor);
  const legs = [[.12, -depth + .12], [1.95, -depth + .12], [5.4, -depth + .12],
    [w + depth - .12, -depth + .12], [w + depth - .12, 1.1], [w + depth - .12, sideEnd - .12]];
  for (const [u, v] of legs) {
    const [x, z] = f.W(u, v);
    S.block(k.concrete, .28, .28, x, z, sampleElevation(city, x, z) - .1, floor - .12, f.yaw);
    S.box(k.cream, .14, soffit - floor, .14, x, (soffit + floor) / 2, z, f.yaw);
  }
  // Horizontal skirt boards enclose the deck between the masonry piers.
  for (const [a, b] of [[deck[0], deck[1]], [deck[1], deck[2]], [deck[2], deck[3]], [deck[3], deck[4]]]) {
    const groundA = sampleElevation(city, ...a), groundB = sampleElevation(city, ...b);
    const rows = Math.ceil((floor - .18 - Math.min(groundA, groundB)) / .15);
    for (let i = 0; i < rows; i++) {
      const y = floor - .25 - i * .15;
      S.beam(k.cream, [a[0], y, a[1]], [b[0], y, b[1]], .075, .095);
    }
  }
  const frontRail = (u: number) => point(f, u, -depth + .12, floor);
  railing(S, k.cream, [point(f, .12, -.05, floor), frontRail(.12), frontRail(entry - .8)], .84, { pickets: .16 });
  railing(S, k.cream, [frontRail(entry + .8), frontRail(w + depth - .12), point(f, w + depth - .12, sideEnd - .12, floor), point(f, w + .1, sideEnd - .12, floor)], .84, { pickets: .16 });
  door(S, k, wall, entry, floor, 1, 2.12, { leaf: k.redDoor, frame: k.cream });
  const [knobX, knobZ] = wall.at(entry + .37, .1);
  S.box(k.bronze, .06, .13, .08, knobX, floor + 1, knobZ, wall.yaw);
  entranceSteps(S, k, city, f, entry, -depth, 1.5, floor);
  // Two shed planes meet on one diagonal hip above the outside corner.
  const eave = depth + .2, roofTop = (p: Point2) => soffit + .45 - .35 * Math.max(0, -f.vOf(p), f.uOf(p) - w) / eave;
  const rim = [[0, 0], [0, -eave], [w + eave, -eave], [w + eave, sideEnd], [w, sideEnd], [w, 0]].map(([u, v]) => f.W(u, v));
  slope(S, k.shingle, [rim[0], rim[1], rim[2], rim[5]], roofTop, f.U, [0, 1, 0]);
  slope(S, k.shingle, [rim[5], rim[2], rim[3], rim[4]], roofTop, f.V, [0, 1, 0]);
  S.cap(k.cream, rim, soffit, false, false);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i], b = rim[(i + 1) % rim.length];
    S.wall(k.cream, a, b, soffit, roofTop(a), roofTop(b), outward(rim, i), false);
  }
  return S;
}
