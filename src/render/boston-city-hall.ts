import * as THREE from 'three';
import type { CityData, Point2 } from '../types.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { boardTexture, finish, LandmarkModel, landmarkTexture, lettering, rectangle, type Vertex } from './landmark-model.ts';

export const CITY_HALL_ID = 'BOS-6JW0O-0UKVU-EA9CP';
export const CITY_HALL_EAST_ID = 'BOS-AHI1L-9FEQK-LWD5F';

const X = 1382.142;
const Z = -1144.314;
const HEADING = Math.atan2(-.155, .988);

export function buildBostonCityHall(city: CityData) {
  const model = new LandmarkModel('Boston City Hall', CITY_HALL_ID, X, 0, Z, HEADING);
  const concrete = finish('#e1ddd4'), ledge = finish('#c4c2b9'), roof = finish('#848681');
  const concreteMap = boardTexture(false);
  concrete.map = ledge.map = concreteMap;
  const dark = finish('#494c48'), frames = finish('#686d67');
  const windows = ['#31434b', '#455559', '#516167'].map(color => finish(color, .29, .12));
  const brick = finish('#b06b56');
  brick.map = landmarkTexture(256, 256, ctx => {
    ctx.fillStyle = '#9b7770';
    ctx.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 48; row++) for (let col = -1; col < 17; col++) {
      const value = 142 + (row * 13 + col * 21 + row * col * 7 + 512) % 32;
      ctx.fillStyle = `rgb(${value + 54}, ${value + 24}, ${value + 13})`;
      ctx.fillRect(col * 16 + row % 2 * 8, row * 256 / 48, 15.5, 4.8);
    }
  }, true);
  const letters = lettering('BOSTON CITY HALL', '#545954', '600 48px Arial');

  // The hill drops sharply to Congress Street. The brick public floor
  // becomes visible below the columns on that side.
  const core = rectangle(-23, 24, -34, 43);
  model.prism(brick, core, -2.5, 13.4, true);
  model.prism(dark, rectangle(-27, 27, -39, 43), 13.4, 32.8, true);
  model.prism(brick, rectangle(-43.5, -22, -35, 18), 2.5, 8.6, true);
  model.prism(brick, rectangle(-38, -22, 23, 48), 2.5, 10.2, true);
  for (let tier = 0; tier < 3; tier++) {
    model.prism(brick, rectangle(21, 39 - tier * 4.2, -64 + tier * 5, -17 + tier * 2.6),
      -1.9, 7.1 + tier * 4.2, true);
  }
  model.prism(brick, rectangle(-21, 27, -52, -32), -.3, 11.7, true);
  // The west ramp and the steps at the south entrance rise from the plaza.
  const ground = (x: number, z: number) => sampleElevation(city, X + x * Math.cos(HEADING) - z * Math.sin(HEADING),
    Z + x * Math.sin(HEADING) + z * Math.cos(HEADING));
  for (let x = -65; x < -43.5; x += 3) for (let z = -34; z < 42; z += 3) {
    const corners = rectangle(x, Math.min(x + 3, -43.5), z, Math.min(z + 3, 42)).reverse();
    const plaza = corners.map(([u, v]) => [u, ground(u, v) + .13, v] as Vertex);
    model.quad(brick, plaza[0], plaza[1], plaza[2], plaza[3], false,
      corners.map(([u, v]) => [u / 4, v / 4]) as [[number, number], [number, number], [number, number], [number, number]]);
  }
  for (let step = 0; step < 8; step++) {
    const x = -45.8 + step * .95;
    const top = 5.1 + .37 * step;
    model.prism(brick, rectangle(x, x + .96, 20.5, 44.5), 2.5, top, true, ledge);
  }

  // Exposed structural piers and deep windows behind the elevated civic rooms.
  for (const x of [-36.8, 33.8]) for (const z of [-40, -23.5, -7, 9.5, 26, 45.8]) {
    model.prism(concrete, rectangle(x - 1.6, x + 1.6, z - 1.5, z + 1.5), x > 0 ? -.7 : 4.5, 33.8, true);
    model.box(ledge, x, 31.9, z, 4.45, 2.7, 4.1);
  }
  for (const z of [-39.4, 45.6]) for (const x of [-22, -5, 12, 28]) {
    model.prism(concrete, rectangle(x - 1.27, x + 1.27, z - 1.45, z + 1.45), 7.2, 33.5, true);
  }
  for (const x of [-27.2, 27.2]) for (let z = -38; z < 44; z += 3.15) {
    model.box(windows[1], x, 18.8, z, .3, 10.7, 2.99);
    model.box(frames, x + Math.sign(x) * .18, 19.8, z, .12, 10.9, .15);
  }

  // Ceremonial rooms read as separate concrete volumes, each with a thick
  // projecting hood, recessed glazing and angled reveals.
  function civicRoom(side: number, z: number, width: number, low: number, high: number, reach: number, bays: number) {
    const back = side * 24, outer = side * reach;
    const extent = (a: number, b: number, l: number, r: number) => rectangle(Math.min(a, b), Math.max(a, b), z + l, z + r);
    model.prism(concrete, extent(back, outer, -width / 2, width / 2), low, low + 1.1, true, ledge);
    model.prism(concrete, extent(back, outer, -width / 2, width / 2), high - 1.65, high, true);
    for (const edge of [-1, 1]) {
      model.prism(concrete, extent(back, outer, edge * (width / 2 - .18) - .68, edge * (width / 2 - .18) + .68), low, high, true);
    }
    const x = outer - side * 1.6;
    model.box(windows[0], x, (low + high) / 2, z, .42, high - low - .8, width - 1.65, true);
    for (let i = 1; i < bays; i++) {
      const offset = width * (i / bays - .5);
      model.box(concrete, x + side * .33, (low + high) / 2, z + offset, 1.04, high - low - 1.3, .52);
    }
    return outer;
  }
  civicRoom(-1, -17, 25, 16.5, 26.7, 40.2, 6);
  civicRoom(-1, 3.1, 12, 22, 32.8, 39.4, 3);
  const hood = civicRoom(-1, 23.7, 14.5, 17.8, 33.2, 46, 2);
  civicRoom(-1, 40.3, 12, 24.3, 31.3, 38.8, 4);
  civicRoom(1, 31, 26, 16, 31.2, 39, 5);
  civicRoom(1, 4.5, 13, 21.7, 32.5, 37.5, 3);
  civicRoom(1, -24.4, 26, 18.1, 28.5, 38.7, 6);
  model.quad(letters, [hood - .04, 31.65, 17.1], [hood - .04, 31.65, 30.3],
    [hood - .04, 33.05, 30.3], [hood - .04, 33.05, 17.1]);

  // Three tiers of deep precast fin pairs rise out and over the piers.
  const courtyard = { left: -17.5, right: 15.7, back: -24.2, front: 11 };
  for (let floor = 0; floor < 3; floor++) {
    const low = 32.7 + floor * 5.36, high = low + 5.36;
    const l = -38.8 - floor * .86, r = 35.8 + floor * .86, b = -44.4 - floor * 1.24, f = 51.1 + floor * 1.24;
    const sections = [
      rectangle(l, courtyard.left, b, f), rectangle(courtyard.right, r, b, f),
      rectangle(courtyard.left, courtyard.right, b, courtyard.back), rectangle(courtyard.left, courtyard.right, courtyard.front, f),
    ];
    for (const outline of sections) {
      model.prism(concrete, outline, low, low + .66, true);
      model.prism(ledge, outline, high - 1.02, high, true, roof);
    }
    for (const [length, fixed, sign, alongX] of [
      [r - l, b, -1, true], [r - l, f, 1, true], [f - b, l, -1, false], [f - b, r, 1, false],
    ] as const) {
      const start = alongX ? l : b;
      const bays = Math.round(length / 2.72), width = length / bays, y = (low + high) / 2 - .15;
      for (let bay = 0; bay < bays; bay++) {
        const s = start + (bay + .5) * width;
        const panel = fixed - sign * 1.25;
        const inset = fixed - sign * .02;
        const place = (m: THREE.Material, t: number, height: number, normal: number, w: number, h: number, d: number, solid = false) => {
          if (alongX) model.box(m, t, height, normal, w, h, d, solid);
          else model.box(m, normal, height, t, d, h, w, solid);
        };
        place(windows[(bay * 11 + floor * 7) % 13 < 3 ? 2 : bay % 3 === 0 ? 1 : 0], s, y, panel, width + .02, 4.5, .27, true);
        place(concrete, s + width / 2 - .29, y, inset, .49, 4.3, 2.55);
        place(ledge, s - .21, y, inset - sign * .26, .22, 4.04, 1.76);
        place(frames, s, low + 1.01, panel + sign * .14, width, .14, .12);
      }
    }
  }

  // Courtyard reveals, the low pyramidal skylight and the screened roof plant.
  for (const [a, b] of [
    [[courtyard.left, courtyard.back], [courtyard.right, courtyard.back]],
    [[courtyard.right, courtyard.back], [courtyard.right, courtyard.front]],
    [[courtyard.right, courtyard.front], [courtyard.left, courtyard.front]],
    [[courtyard.left, courtyard.front], [courtyard.left, courtyard.back]],
  ] as [Point2, Point2][]) model.wall(concrete, b, a, 32.5, 48.78, true);
  model.append(windows[2], new THREE.ConeGeometry(10, 3.5, 4).rotateY(Math.PI / 4).translate(-1.8, 32.3, -7.2), true);
  for (const [x, z, w, h, d] of [[-1, 30, 18, 9.8, 19], [-1, -33, 21, 5.6, 11], [11.9, 24, 3.4, 5.7, 15]]) {
    model.prism(concrete, rectangle(x - w / 2, x + w / 2, z - d / 2, z + d / 2), 48.7, 48.7 + h, true, roof);
    for (let s = -w / 2 + .5; s < w / 2; s += .63) {
      model.box(dark, x + s, 49.2 + h * .52, z + d / 2 + .025, .27, Math.min(h * .66, 3), .08);
    }
  }
  return model.build();
}
