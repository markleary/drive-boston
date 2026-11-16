import * as THREE from 'three';
import type { CityData, Point2 } from '../types.ts';
import { sampleElevation } from '../simulation/terrain.ts';
import { finish, LandmarkModel, landmarkTexture, rectangle } from './landmark-model.ts';

/** Surveyed owners, not a radius match: the small pier utility buildings and
 * neighboring Commonwealth Pier retain their own source meshes. */
export const FISH_PIER_BUILDINGS = [
  { id: 'BOS-J5CID-VEXTU-F7LOA', tile: '2_-1', first: [2926.82, -5.906] as Point2, name: 'Fish Pier West' },
  { id: 'BOS-UJJRR-NN2MB-M3QNM', tile: '3_-1', first: [2966.644, 16.422] as Point2, name: 'Fish Pier East' },
  { id: 'BOS-4K78V-JFNIC-EHC3N', tile: '3_-1', first: [3061.056, -211.035] as Point2, name: 'Exchange Conference Center' },
] as const;

const X = 2956.658, Z = 8.99, HEADING = Math.atan2(.4805, .877), BASE = -.32;
const C = Math.cos(HEADING), S = Math.sin(HEADING);
export const fishPierWorld = (u: number, v: number): Point2 => [X + C * u - S * v, Z + S * u + C * v];
export const fishPierFrame = (x: number, z: number): Point2 => [(x - X) * C + (z - Z) * S, -(x - X) * S + (z - Z) * C];

/** Keep incidental trees/planters out of this active loading and fishing apron. */
export function insideFishPierWorkingArea(x: number, z: number) {
  if (x < 2860 || x > 3140 || z < -290 || z > 90) return false;
  const [u, v] = fishPierFrame(x, z);
  return u > -46 && u < 48 && v > -280 && v < 55;
}

const chamfered = (l: number, r: number, b: number, f: number): Point2[] =>
  [[l + 2.5, b], [r - 2.5, b], [r, b + 1.6], [r, f - 1.7], [r - 2.5, f], [l + 2.5, f], [l, f - 1.7], [l, b + 1.6]];

/** The source footprints set placement/scale; facade and roof details are a
 * restrained interpretation of the supplied November 2026 Street View and
 * Massport's M658 building survey. This is a working pier, with loading docks
 * along the halls, rather than a landscaped public HarborWalk. */
export function buildFishPier(city: CityData) {
  const model = new LandmarkModel('Boston Fish Pier', 'boston-fish-pier', X, BASE, Z, HEADING);
  const brick = finish('#a8664e'), stone = finish('#d9cfb5'), coping = finish('#a89f89');
  const copper = finish('#557e72', .65, .2), roof = finish('#7f847e');
  const iron = finish('#34423e', .7, .3), concrete = finish('#a39e91');
  const window = finish('#45616a', .25, .25), windowDark = finish('#293f45', .4, .2);
  const shutter = finish('#758183'), rubber = finish('#292b28'), white = finish('#ece9dc');
  const yellow = finish('#e7b92c'), blue = finish('#346e85'), timber = finish('#8d7151');

  if (typeof document !== 'undefined') {
    brick.map = landmarkTexture(128, 128, ctx => {
      ctx.fillStyle = '#c1947b'; ctx.fillRect(0, 0, 128, 128);
      for (let row = 0; row < 16; row++) for (let col = -1; col < 5; col++) {
        const n = (row * 31 + col * 13 + 97) % 21;
        ctx.fillStyle = `rgb(${174 + n},${105 + n},${80 + n})`;
        ctx.fillRect(col * 32 + row % 2 * 16 + 1, row * 8 + 1, 30, 6);
      }
    }, true);
    // Wall UVs use 4 m per unit; keep masonry courses a plausible 8 cm high.
    brick.map.repeat.set(3, 3);
    brick.color.set('#ffffff');
  }

  function sign(lines: string[], width: number, height: number) {
    const material = finish('#12577c', .9);
    if (typeof document !== 'undefined') {
      material.map = landmarkTexture(512, 384, ctx => {
        ctx.fillStyle = '#155675'; ctx.fillRect(0, 0, 512, 384);
        ctx.strokeStyle = '#d6c685'; ctx.lineWidth = 7; ctx.strokeRect(10, 10, 492, 364);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e8d293';
        lines.forEach((line, i) => {
          ctx.font = `${i === 1 ? 'bold 76px Georgia' : 'bold 33px Arial'}`;
          ctx.fillText(line, 256, 85 + i * 85, 466);
        });
      });
      material.color.set('#ffffff');
    }
    return { material, width, height };
  }
  const nameSigns = [sign(['THE', 'BOSTON', 'FISH PIER · EST. 1914'], 13.5, 8.2), sign(['GENERATIONS OF', 'SEAFOOD', 'INNOVATION · SINCE 1914'], 13.5, 8.2)];
  const directionSigns = [sign(['FISH PIER', 'WEST', 'BOSTON'], 2.4, 3.3), sign(['FISH PIER', 'EAST', 'BOSTON'], 2.4, 3.3)];

  const ground = (u: number, v: number) => sampleElevation(city, ...fishPierWorld(u, v)) - BASE;
  const bollard = (u: number, v: number) => {
    const y = ground(u, v);
    model.box(yellow, u, y + .63, v, .2, 1.26, .2, true);
    model.box(iron, u, y + 1.2, v, .22, .08, .22);
  };

  const halls = [{ l: -33.5, r: -9.7, side: 0 }, { l: 12.3, r: 36, side: 1 }];
  for (const { l, r, side } of halls) {
    const b = -225.65, f = 3, center = (l + r) / 2, depth = f - b;
    model.prism(brick, chamfered(l, r, b, f), -.6, 16.3, true, roof);
    // A light terra-cotta upper wall, brick piers and bands under the green
    // copper cornice give the two industrial halls their recognizable rhythm.
    for (const x of [l - .035, r + .035]) {
      model.box(stone, x, 10.4, (f + b) / 2, .1, 8.3, depth - 3.2);
      for (let v = -220; v < -1; v += 10.2) {
        model.box(brick, x + (x < center ? -.055 : .055), 10.35, v, .18, 8.6, 1.08);
        for (const y of [8.35, 12.15]) for (const dz of [-3.15, 0, 3.15]) {
          model.box(windowDark, x + (x < center ? -.13 : .13), y, v + dz + 4.6, .12, 2.08, 1.65);
          model.box(stone, x + (x < center ? -.2 : .2), y, v + dz + 4.6, .09, 2.22, .09);
          model.box(stone, x + (x < center ? -.2 : .2), y, v + dz + 4.6, .09, .08, 1.75);
        }
      }
      for (let v = -217; v < -2; v += 10.2) {
        model.box(shutter, x + (x < center ? -.09 : .09), 2.64, v, .14, 3.1, 5.5);
        for (const y of [1.4, 2.05, 2.7, 3.35, 4]) model.box(iron, x + (x < center ? -.18 : .18), y, v, .04, .035, 5.5);
        model.box(stone, x + (x < center ? -.16 : .16), 4.43, v, .16, .26, 6.2);
      }
      const outward = x < center ? -1 : 1;
      // Raised loading platforms remain alongside the building. The central
      // truck lane stays over 15 m wide, without invented park furniture.
      model.box(concrete, x + outward * 1.16, .38, (f + b) / 2, 2.4, .8, depth - 3, true);
      model.box(copper, x + outward * 1.65, 5.27, (f + b) / 2, 3.35, .23, depth + .5, true);
      model.box(iron, x + outward * 3.26, 5.12, (f + b) / 2, .12, .28, depth + .6);
      for (let v = -218; v < 0; v += 20.4) {
        const brace = new THREE.CylinderGeometry(.055, .055, 3.05, 5)
          .rotateZ(outward * .86).translate(x + outward * 1.05, 6.25, v);
        model.append(iron, brace);
      }
    }
    for (const y of [6.1, 14.6, 15.65]) {
      const h = y === 15.65 ? .48 : .35;
      model.box(stone, center, y, f + .09, r - l + .36, h, .3);
      model.box(stone, center, y, b - .09, r - l + .36, h, .3);
      for (const x of [l - .1, r + .1]) model.box(stone, x, y, (b + f) / 2, .3, h, depth);
    }
    for (const x of [l - .13, r + .13]) {
      model.box(copper, x, 16.85, (b + f) / 2, .46, 1.65, depth + .5);
      model.box(coping, x, 17.72, (b + f) / 2, .7, .15, depth + .9);
    }
    for (const v of [b - .14, f + .14]) {
      model.box(copper, center, 16.85, v, r - l, 1.65, .46);
      model.box(coping, center, 17.72, v, r - l + .9, .15, .7);
    }
    // Brick end pavilions, inset buff panels and blue/gold anniversary boards.
    for (const x of [l + 2.9, r - 2.9]) model.box(stone, x, 10.45, f + .17, .65, 8.2, .4);
    model.box(stone, center, 10.45, f + .09, r - l - 6.8, 8.1, .2);
    const plaque = nameSigns[side];
    model.quad(plaque.material, [center - plaque.width / 2, 6.35, f + .23], [center + plaque.width / 2, 6.35, f + .23],
      [center + plaque.width / 2, 6.35 + plaque.height, f + .23], [center - plaque.width / 2, 6.35 + plaque.height, f + .23]);
    for (const x of [center - 8, center + 8]) {
      model.box(stone, x, 10.3, f + 1.25, .11, 20.1, .11);
    }
    const near = side === 0 ? r - 1.4 : l + 1.4, directional = directionSigns[side];
    model.quad(directional.material, [near - 1.2, 5.45, f + 1.34], [near + 1.2, 5.45, f + 1.34],
      [near + 1.2, 8.75, f + 1.34], [near - 1.2, 8.75, f + 1.34]);
    for (let v = -200; v < -10; v += 45) {
      model.box(roof, center, 17, v, 5.2, 1.4, 7);
      model.box(iron, center, 17.75, v, 5.5, .18, 7.2);
    }
    for (const x of [l - 1.8, r + 1.8]) for (const v of [6, -228]) bollard(x, v);
  }

  // The Exchange closes the long view down the loading lane. Its terracotta
  // entrance bay and arched glazing differ from the utilitarian side halls.
  const el = -14.15, er = 16.3, eb = -264.95, ef = -240;
  model.prism(brick, rectangle(el, er, eb, ef), -.55, 13.8, true, roof);
  model.prism(stone, [[-8.4, ef], [10.6, ef], [7, -237], [-4.8, -237]], -.5, 13.9, true, roof);
  model.box(stone, 1.05, 13.65, -251.5, 31.8, .65, 28.3);
  model.box(copper, 1.05, 14.12, -251.5, 31.3, .32, 27.8);
  const top = 17.4, ridgeZ = -252.4;
  model.quad(roof, [el - .4, 14.3, ef + .6], [er + .4, 14.3, ef + .6], [er - 5, top, ridgeZ], [el + 5, top, ridgeZ], true);
  model.quad(roof, [er + .4, 14.3, eb - .6], [el - .4, 14.3, eb - .6], [el + 5, top, ridgeZ], [er - 5, top, ridgeZ], true);
  model.quad(roof, [el - .4, 14.3, eb - .6], [el - .4, 14.3, ef + .6], [el + 5, top, ridgeZ], [el + 5, top, ridgeZ], true);
  model.quad(roof, [er + .4, 14.3, ef + .6], [er + .4, 14.3, eb - .6], [er - 5, top, ridgeZ], [er - 5, top, ridgeZ], true);
  for (const x of [-11.5, 13.6]) for (const y of [4, 8.8]) {
    model.box(stone, x, y, ef + .09, 2.5, 3.5, .2);
    model.box(window, x, y, ef + .22, 1.9, 2.95, .12);
    model.box(stone, x, y, ef + .3, .1, 3, .1);
  }
  const arch = (x: number, low: number, spring: number, radius: number) => {
    const z = -236.96;
    model.quad(windowDark, [x - radius, low, z], [x + radius, low, z], [x + radius, spring, z], [x - radius, spring, z]);
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI, b = (k + 1) / 12 * Math.PI;
      model.quad(windowDark, [x, spring, z], [x + Math.cos(a) * radius, spring + Math.sin(a) * radius, z],
        [x + Math.cos(b) * radius, spring + Math.sin(b) * radius, z], [x, spring, z]);
    }
    model.box(stone, x, (low + spring) / 2, z + .06, .12, spring - low, .12);
    model.box(stone, x, spring - 1.2, z + .06, radius * 2, .12, .12);
  };
  arch(1.05, .15, 6.7, 2.75);
  for (const x of [-4.6, 6.7]) model.box(stone, x, 7, -236.82, .7, 13.9, .55);
  model.box(stone, 1.05, 11.8, -236.85, 12, .45, .6);
  for (const x of [-3.2, 1.05, 5.3]) model.box(window, x, 10.4, -236.9, 1.7, 1.6, .12);

  // Seafood bins, timber pallets and a handful of parked refrigerated trucks.
  // Props are terrain seated and kept outside the continuous central drive aisle.
  for (const [u, v] of [[-37, -34], [-37, -101], [-37, -182], [40, -64], [40, -141], [40, -208]]) {
    const y = ground(u, v);
    for (let k = 0; k < 3; k++) {
      model.box(white, u, y + .6, v + k * 1.8, 1.25, 1.05, 1.5);
      model.box(blue, u, y + 1.15, v + k * 1.8, 1.32, .12, 1.58);
      model.box(timber, u, y + .08, v + k * 1.8, 1.4, .16, 1.6);
    }
  }
  for (const [u, v] of [[-6, -29], [8.5, -86], [-6, -154], [41, -34]]) {
    const y = ground(u, v);
    model.box(white, u, y + 2.15, v - 1.05, 2.3, 2.5, 6.3, true);
    model.box(white, u, y + 1.52, v + 3.05, 2.25, 2.1, 2.1, true);
    model.box(window, u, y + 1.94, v + 4.12, 1.9, .85, .035);
    model.box(iron, u, y + .72, v, 2.2, .2, 9.2);
    model.box(shutter, u, y + 3.03, v + 2.18, 1.35, .7, .48);
    for (const x of [u - 1.16, u + 1.16]) for (const z of [v - 3, v + 3.05]) {
      model.append(rubber, new THREE.CylinderGeometry(.46, .46, .28, 10).rotateZ(Math.PI / 2).translate(x, y + .48, z));
    }
  }

  const built = model.build();
  built.group.userData.fishPier = { halls: 2, exchange: true, sourceBuildings: FISH_PIER_BUILDINGS.map(b => b.id) };
  return built;
}
