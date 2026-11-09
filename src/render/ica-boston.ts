import * as THREE from 'three';
import { boardTexture, finish, LandmarkModel, landmarkTexture, lettering, rectangle, type Vertex } from './landmark-model.ts';

export const ICA_ID = 'BOS-69K2W-XW6WZ-JJGRN';
const X = 2620.58, Z = -321.009, HEADING = Math.atan2(.456, .89);
const U = Math.cos(HEADING), V = Math.sin(HEADING);
const [l, r, b, f] = [-22.5, 22.2, -27.2, 26.8];
const deckBack = -32.1;

export function insideIcaForecourt(x: number, z: number) {
  if (Math.abs(x - X) > 50 || Math.abs(z - Z) > 50) return false;
  const u = (x - X) * U + (z - Z) * V, v = -(x - X) * V + (z - Z) * U;
  // Keep the boardwalk and the full tree canopies clear of the gallery and stair.
  return u > l - 8 && u < r + 7 && v > deckBack - 4 && v < f + 3;
}

export function buildIcaBoston() {
  const model = new LandmarkModel('Institute of Contemporary Art', ICA_ID, X, .09, Z, HEADING);
  const fascia = finish('#afb6b5', .57, .16), roof = finish('#d6d6cd');
  const frame = finish('#515f61', .45, .35), dark = finish('#30434b', .5, .1), foundation = finish('#989287');
  const wood = finish('#dfc4a3');
  wood.map = boardTexture(true);
  const channel = finish('#e1e9e7', .42, .09);
  channel.map = landmarkTexture(256, 64, ctx => {
    for (let x = 0; x < 256; x += 8) {
      const pane = (x * 13 / 8) % 17;
      ctx.fillStyle = `rgb(${194 + pane}, ${206 + pane}, ${206 + pane})`;
      ctx.fillRect(x, 0, 8, 64);
      ctx.fillStyle = 'rgba(255,255,252,.34)';
      ctx.fillRect(x + 1, 0, 2, 64);
      ctx.fillStyle = 'rgba(52,76,82,.32)';
      ctx.fillRect(x + 7, 0, 1, 64);
    }
  }, true);
  const glass = ['#3f5d64', '#4c6870', '#385156', '#576e70', '#6f898d'].map(color => finish(color, .17, .36));
  const sign = lettering('ICA', '#435359', '900 125px Arial', true);
  const floor = 15.25, top = 23.85;
  const end = -5.6;

  // The glass-and-metal gallery wraps north of the theater and entry.
  // Its underside is a single exposed wood soffit with a thin metal edge.
  model.prism(wood, rectangle(l, r, b, f), floor - .72, floor, true, fascia);
  model.prism(roof, rectangle(l + .25, r - .25, b + .18, f - .18), top - .4, top, true);
  model.wall(channel, [l, f], [l, b], floor, top, true);
  model.wall(channel, [r, b], [r, f], floor, top, true);
  model.wall(channel, [r, f], [l, f], floor, top, true);
  model.wall(channel, [l, b], [r, b], floor, floor + 1.25, true);
  model.wall(channel, [l, b], [r, b], top - 1.2, top, true);

  function panes(a: [number, number], c: [number, number], low: number, high: number, bays: number, levels: number) {
    const dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
    const px = dz / length, pz = -dx / length, yaw = -Math.atan2(dz, dx);
    for (let i = 0; i < bays; i++) {
      const u = i / bays, v = (i + 1) / bays;
      model.wall(glass[(i * 7 + levels) % glass.length], [a[0] + dx * u, a[1] + dz * u],
        [a[0] + dx * v, a[1] + dz * v], low, high, true);
      model.box(frame, a[0] + dx * u + px * .04, (low + high) / 2, a[1] + dz * u + pz * .04, .09, high - low, .12, false, yaw);
    }
    for (let row = 0; row <= levels; row++) {
      model.box(frame, (a[0] + c[0]) / 2 + px * .04, low + (high - low) * row / levels,
        (a[1] + c[1]) / 2 + pz * .04, length, .1, .11, false, yaw);
    }
  }
  panes([l, b], [r, b], floor + 1.25, top - 1.2, 30, 2);
  for (const y of [floor + .06, floor + 4.14, top - .14]) {
    model.box(fascia, l - .035, y, 0, .13, .19, f - b + .22);
    model.box(fascia, r + .035, y, 0, .13, .19, f - b + .22);
    model.box(fascia, 0, y, f + .04, r - l, .19, .13);
    model.box(fascia, 0, y, b - .04, r - l, .19, .13);
  }
  model.quad(sign, [l - .085, 15.7, 16.9], [l - .085, 15.7, 25.2],
    [l - .085, 19.5, 25.2], [l - .085, 19.5, 16.9]);

  // The sloping glass theater and lobby support only the landward end.
  model.prism(foundation, rectangle(l + 2.3, r - 1.4, end, f - .7), -3, .22, true);
  panes([l + 1.05, f - 1.15], [l + 1.05, end], .22, 14.54, 15, 5);
  panes([l + 1.05, end], [r - .98, end], 5.8, 14.54, 20, 3);
  panes([r - .98, end], [r - .98, f - 1.15], .22, 14.54, 16, 5);
  panes([r - .98, f - 1.15], [l + 1.05, f - 1.15], .22, 14.54, 23, 4);
  model.box(dark, -1, 6.05, 10, 40, .34, 29.8, true);
  for (const x of [l + 1.3, -8, 7, r - 1.25]) model.box(frame, x, 7.25, end + .35, .43, 14.1, .56, true);
  for (const x of [-10.7, -8.7, 5.5, 7.5]) {
    model.box(fascia, x, 1.44, f - 1.23, .08, 2.75, .12);
    model.box(fascia, x + .36, 1.46, f - 1.05, .6, .075, .16);
  }
  model.box(fascia, -1.5, 4.18, f + .55, 18, .34, 3.5, true);

  // The dark, canted media room hangs clear of the grandstand below.
  const ml = -10.7, mr = 1.1, aft = -5.6, nose = -18.6;
  const wedgeLeft: [Vertex, Vertex, Vertex, Vertex] = [[ml, 9.6, nose], [ml, 12.35, aft], [ml, floor - .72, aft], [ml, floor - .72, nose]];
  const wedgeRight = wedgeLeft.map(([, y, z]) => [mr, y, z]) as [Vertex, Vertex, Vertex, Vertex];
  model.quad(dark, wedgeLeft[0], wedgeLeft[1], wedgeLeft[2], wedgeLeft[3], true);
  model.quad(dark, wedgeRight[3], wedgeRight[2], wedgeRight[1], wedgeRight[0], true);
  model.quad(frame, wedgeLeft[0], wedgeRight[0], wedgeRight[1], wedgeLeft[1], true);
  panes([ml, nose], [mr, nose], 9.6, floor - .72, 8, 1);

  // HarborWalk timber continues up the outdoor seating and into the theater.
  const deckFront = -5.55;
  model.prism(wood, rectangle(l - 4.3, r + 2.8, deckBack, deckFront), -.34, .24, true);
  model.prism(wood, rectangle(l - 4.3, l + 1.05, deckFront, f - 1.5), -.32, .22, true);
  model.box(foundation, 0, -1.72, deckBack + .65, r - l + 5.3, 3.4, 1.4, true);
  const standLeft = -17.8, standRight = 14.7;
  for (let row = 0; row < 14; row++) {
    const z = -22.7 + row * 1.19, y = .54 + row * .388;
    model.prism(wood, rectangle(standLeft, standRight, z, z + 1.195), .18, y, true);
    model.box(fascia, standLeft + 1, y + .011, z + .13, 1.76, .038, .15);
  }
  model.prism(wood, rectangle(standLeft, standRight, -6.05, end + .1), .18, 5.8, true);
  for (let x = l - 2; x < r + 2.4; x += 2.6) {
    model.box(frame, x, .76, deckBack + .15, .095, 1.04, .095);
  }
  model.box(frame, 0, 1.28, deckBack + .15, r - l + 4.6, .065, .065);
  model.box(frame, 0, .65, deckBack + .15, r - l + 4.6, .035, .035);

  // Exterior west stair, seen as a ribbon rising diagonally across the glass.
  const stairX = l - .67, stairW = 3.6;
  for (let step = 0; step < 28; step++) {
    const z = 1.6 + step * .68, y = 3.15 + step * .164;
    model.box(wood, stairX, y, z, stairW, .23, .7, true);
    if (step % 3 === 0) model.box(frame, stairX - stairW / 2, y + .57, z, .075, 1.09, .07);
  }
  model.quad(fascia, [stairX - stairW / 2 - .015, 2.74, 1.25], [stairX - stairW / 2 - .015, 7.14, 20.3],
    [stairX - stairW / 2 - .015, 7.64, 20.3], [stairX - stairW / 2 - .015, 3.24, 1.25]);
  const rail = new THREE.CylinderGeometry(.052, .052, Math.hypot(19, 4.4), 8)
    .rotateX(Math.atan2(19, 4.4)).translate(stairX - stairW / 2, 6.42, 10.95);
  model.append(frame, rail);
  model.box(wood, stairX, 3.05, -2.7, stairW, .33, 8.1, true);
  model.box(fascia, stairX, 7.52, 22.6, stairW, .36, 4.6, true);
  for (let step = 0; step < 18; step++) {
    const z = -13.3 + step * .35, y = .23 + step * .159;
    model.box(wood, stairX, y, z, stairW, .29, .37, true);
  }

  // Repeated sawtooth skylights and the central roof service spine.
  model.prism(fascia, rectangle(-4.45, 7.1, -24, 23.3), top, 27.68, true, roof);
  for (let z = -23; z < 23; z += 3.7) for (const [left, right] of [[l + 2.6, -4.45], [7.1, r - 2.7]]) {
    model.quad(roof, [left, top, z + 1.4], [right, top, z + 1.4], [right, top + .87, z], [left, top + .87, z], true);
    model.wall(glass[4], [left, z], [right, z], top, top + .87, true);
  }
  return model.build();
}
