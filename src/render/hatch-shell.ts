import * as THREE from 'three';
import type { LightingMode, Point2 } from '../types.ts';
import { finish, LandmarkModel, landmarkTexture, rectangle, type Vertex } from './landmark-model.ts';
import { seeded } from './materials.ts';

export const HATCH_SHELL_ID = 'BOS-E8BPX-5IKAI-U40PV';
export const HATCH_SHELL_FIRST: Point2 = [71.725, -796.081];
// Surveyed front-wall plane, facing south-southwest across the concert lawn.
const X = 88.06, Z = -791.29, HEADING = Math.atan2(5.62, 23.038);
const C = Math.cos(HEADING), S = Math.sin(HEADING);
const BASE = -1.55, STAGE = 2.55;
const WIDTH = 16.05, HEIGHT = 12.2, DEPTH = 18.2;
const ARCH_SEGMENTS = 72;
export const hatchShellWorld = (u: number, v: number): Point2 => [X + u * C - v * S, Z + u * S + v * C];
export const hatchShellFrame = (x: number, z: number): Point2 => [(x - X) * C + (z - Z) * S, -(x - X) * S + (z - Z) * C];

export function insideHatchShellApron(x: number, z: number) {
  if (Math.abs(x - X) > 66 || z < Z - 36 || z > Z + 132) return false;
  const [u, v] = hatchShellFrame(x, z);
  // The performance lawn is open, with trees around its perimeter. Exclude
  // incidental procedural trees/benches from its central audience sightline.
  return (u / 34) ** 2 + ((v - 65) / 62) ** 2 < 1
    || (v >= -6 ? Math.abs(u) < 28 && v < 14 : (u / 22) ** 2 + (v / 25) ** 2 < 1);
}

/** An open quarter ellipsoid: the two skins have opposite winding and normals.
 * Unlike an extruded building or a half sphere capped at its mouth, this keeps
 * the entire performance opening empty. UVs follow the curved wood lining. */
function shellSurface(offset: number, inward: boolean) {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const around = ARCH_SEGMENTS, deep = 28, w = WIDTH + offset, h = HEIGHT + offset, d = DEPTH + offset;
  for (let j = 0; j <= deep; j++) for (let i = 0; i <= around; i++) {
    const a = i / around * Math.PI, b = j / deep * Math.PI / 2;
    const x = Math.cos(a) * Math.cos(b), y = Math.sin(a) * Math.cos(b), z = -Math.sin(b);
    positions.push(w * x, STAGE + h * y, d * z);
    const n = new THREE.Vector3(x / w, y / h, z / d).normalize().multiplyScalar(inward ? -1 : 1);
    normals.push(n.x, n.y, n.z); uvs.push(a * WIDTH / 4, b * DEPTH / 4);
  }
  for (let j = 0; j < deep; j++) for (let i = 0; i < around; i++) {
    const a = j * (around + 1) + i, b = a + 1, c = b + around + 1, d = c - 1;
    // The last row closes at one point; omit its degenerate second triangle.
    if (inward) { indices.push(a, b, c); if (j < deep - 1) indices.push(a, c, d); }
    else { indices.push(a, c, b); if (j < deep - 1) indices.push(a, d, c); }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    .setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)).setIndex(indices);
}

function woodInlay() {
  const random = seeded(1940);
  return landmarkTexture(512, 512, ctx => {
    ctx.fillStyle = '#65331c'; ctx.fillRect(0, 0, 512, 512);
    // Interlocking 4:1 planks, with grain along each individual piece. The
    // integer lattice tiles seamlessly and avoids a generic wall/window atlas.
    const plank = (x: number, y: number, vertical: boolean) => {
      ctx.save(); ctx.translate(x, y); if (vertical) ctx.rotate(Math.PI / 2);
      const tone = random();
      ctx.fillStyle = `rgb(${130 + tone * 47},${65 + tone * 32},${29 + tone * 22})`;
      ctx.fillRect(.4, .4, 63.2, 15.2);
      for (let k = 0; k < 15; k++) {
        ctx.strokeStyle = random() < .5 ? 'rgba(51,21,7,.17)' : 'rgba(249,192,108,.15)';
        ctx.lineWidth = .4 + random() * .5;
        const gy = 1 + random() * 14;
        ctx.beginPath(); ctx.moveTo(1, gy); ctx.bezierCurveTo(20, gy + random() * 2, 43, gy - random() * 2, 63, gy); ctx.stroke();
      }
      ctx.restore();
    };
    for (let a = -10; a < 15; a++) for (let b = -40; b < 40; b++) {
      const x = (4 * a + b) * 16, y = (4 * a - b) * 16;
      if (x < -80 || y < -80 || x > 528 || y > 528) continue;
      plank(x + 16, y, true); plank(x + 16, y + 48, false);
    }
  }, true);
}

/** Photo-informed architectural reconstruction; sources and the distinction
 * between surveyed placement and interpreted details: docs/hatch-shell.md. */
export function buildHatchShell() {
  const model = new LandmarkModel('Hatch Memorial Shell', HATCH_SHELL_ID, X, BASE, Z, HEADING);
  const stone = finish('#ad9083', .91), coping = finish('#c4aca0', .86);
  const terrazzo = finish('#b39b90', .89), joints = finish('#776c66', .91);
  const wood = finish('#a36131', .65), rib = finish('#78472a', .74);
  const floor = finish('#9b7056', .89), roof = finish('#837b71', .94);
  const bronze = finish('#4c493d', .6, .42), speaker = finish('#303432', .91);
  stone.name = 'Hatch Shell pink granite'; terrazzo.name = 'Hatch Shell rustic terrazzo';
  wood.name = 'Hatch Shell herringbone wood';
  if (typeof document !== 'undefined') {
    wood.map = woodInlay(); wood.color.set('#ffffff');
    terrazzo.map = landmarkTexture(256, 256, ctx => {
      const random = seeded(673);
      ctx.fillStyle = '#b39b90'; ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 7000; i++) {
        ctx.fillStyle = ['#d3c4b7', '#95877e', '#c0a59a', '#7f7872'][i % 4];
        ctx.fillRect(random() * 256, random() * 256, 1 + random() * 2, 1 + random() * 2);
      }
    }, true);
    terrazzo.color.set('#ffffff');
    stone.map = terrazzo.map; stone.color.set('#f2e4df');
    wood.emissiveMap = wood.map; stone.emissiveMap = stone.map;
  }

  // Approximate light reflected from the open lawn into the deep concavity.
  // It follows the diffuse pattern and time of day, without extra GPU lights
  // or a permanently glowing concert interior after dark.
  wood.emissive.set('#ffffff'); stone.emissive.set('#ffffff'); floor.emissive.set('#9b7056');
  const setLighting = (mode: LightingMode) => {
    wood.emissiveIntensity = mode === 'night' ? .006 : mode === 'day' ? .25 : .12;
    stone.emissiveIntensity = mode === 'night' ? .002 : .065;
    floor.emissiveIntensity = mode === 'night' ? .003 : .12;
  };
  setLighting('golden');

  model.append(wood, shellSurface(0, true), true);
  model.append(terrazzo, shellSurface(.55, false), true);
  // Fine seams between the exterior precast terrazzo panels remain readable
  // from Storrow Drive and from above; no copper roof or office facade.
  const outer = (a: number, b: number): Vertex => [16.608 * Math.cos(a) * Math.cos(b), STAGE + 12.758 * Math.sin(a) * Math.cos(b), -18.758 * Math.sin(b)];
  for (let row = 1; row < 12; row++) {
    const b = row / 12 * Math.PI / 2;
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * Math.PI, next = (i + 1) / 72 * Math.PI;
      model.quad(joints, outer(a, b), outer(a, b + .0012), outer(next, b + .0012), outer(next, b));
    }
  }
  for (let column = 1; column < 28; column++) {
    const a = column / 28 * Math.PI;
    for (let j = 0; j < 27; j++) {
      const b = j / 28 * Math.PI / 2, next = (j + 1) / 28 * Math.PI / 2;
      model.quad(joints, outer(a, b), outer(a, next), outer(a + .0012, next), outer(a + .0012, b));
    }
  }

  const archPoint = (a: number, offset: number, z: number): Vertex =>
    [(WIDTH + offset) * Math.cos(a), STAGE + (HEIGHT + offset) * Math.sin(a), z];
  // Broad flat stone archivolt with thin bronze/recessed borders, not a tube.
  for (let i = 0; i < ARCH_SEGMENTS; i++) {
    const a = i * Math.PI / ARCH_SEGMENTS, b = (i + 1) * Math.PI / ARCH_SEGMENTS;
    for (const [lo, hi, z, material] of [[0, .08, .025, bronze], [.08, .49, .035, terrazzo], [.49, .55, .045, coping]] as const) {
      model.quad(material, archPoint(a, lo, z), archPoint(a, hi, z), archPoint(b, hi, z), archPoint(b, lo, z));
    }
    // Use the same vertices as the shell and close the short lip returns so
    // the sky cannot sparkle through a gap along the top of the opening.
    model.quad(bronze, archPoint(a, 0, 0), archPoint(a, 0, .025), archPoint(b, 0, .025), archPoint(b, 0, 0));
    model.quad(coping, archPoint(b, .55, 0), archPoint(b, .55, .045), archPoint(a, .55, .045), archPoint(a, .55, 0));
    if (i % 3 === 0) model.quad(joints, archPoint(a, .09, .041), archPoint(a + .0012, .09, .041), archPoint(a + .0012, .49, .041), archPoint(a, .49, .041));
  }
  // Narrow recessed acoustic-panel divisions follow the concave shell.
  for (const b of [.18, .36, .54, .72, .9, 1.08]) for (let i = 0; i < 64; i++) {
    const at = (a: number, t: number): Vertex => [15.99 * Math.cos(a) * Math.cos(t), STAGE + 12.14 * Math.sin(a) * Math.cos(t), -18.14 * Math.sin(t)];
    const a = i * Math.PI / 64, next = (i + 1) * Math.PI / 64;
    model.quad(rib, at(a, b), at(next, b), at(next, b + .009), at(a, b + .009));
  }
  // Low stone service enclosure behind the shell, leaving the mouth open.
  const arc = (w: number, d: number): Point2[] => Array.from({ length: 49 }, (_, i) => {
    const a = i / 48 * Math.PI; return [w * Math.cos(a), -d * Math.sin(a)];
  });
  model.prism(stone, [...arc(19, 21), ...arc(16.4, 18.6).reverse()].reverse(), -.5, 3.45, true, roof);
  const stageOutline: Point2[] = [...arc(WIDTH, DEPTH), [-14.3, 0], [-14.3, 2.9], [14.3, 2.9], [14.3, 0]];
  model.prism(stone, stageOutline.reverse(), -.55, STAGE, true, floor);
  // The curved low orchestra tiers recede towards the back, with an open
  // central performing floor. Each is a solid stage surface for walking.
  for (let row = 0; row < 4; row++) {
    const width = 13.8 - row * 1.8, depth = 14.9 - row * 1.8;
    const outline = arc(width, depth).map(([x, z]): Point2 => [x, z - 2.3 - row * .3]);
    model.prism(floor, outline.reverse(), STAGE, STAGE + (row + 1) * .16, true);
  }
  // Full 160 ft stone terrace. Low broad risers and independent end stairs
  // connect the lawn apron to the elevated performance stage.
  model.prism(stone, rectangle(-24.38, 24.38, -3.8, 4.2), -.6, 1.08, true, coping);
  for (let step = 0; step < 6; step++) {
    const front = 8.2 - step * .62, top = (step + 1) * .18;
    model.prism(stone, rectangle(-24.38, 24.38, 4.19, front), -.6, top, true, coping);
  }
  for (const side of [-1, 1]) {
    model.prism(stone, rectangle(side < 0 ? -24.38 : 16.7, side < 0 ? -16.7 : 24.38, -5.7, 1.9), -.5, 3.75, true, coping);
    // Stepped Art Deco end piers and simple black speaker cabinets.
    model.box(stone, side * 22.4, 4.4, .1, 2.5, 1.3, 2.4, true);
    model.box(coping, side * 22.4, 5.1, .1, 2.7, .16, 2.6);
    model.box(speaker, side * 22.4, 6.45, .1, 1.55, 2.6, 1.2, true);
    for (let n = 0; n < 10; n++) model.box(bronze, side * 22.4, 5.35 + n * .23, .71, 1.42, .025, .025);
    for (let step = 0; step < 9; step++) {
      const front = 4.15 - step * .35, top = 1.08 + (step + 1) * (STAGE - 1.08) / 9;
      model.prism(stone, rectangle(side < 0 ? -16.7 : 14.3, side < 0 ? -14.3 : 16.7, 0, front), 1.08, top, true, coping);
    }
  }
  // Backstage bronze double doors, set into the low rear service wall.
  for (const x of [-.65, .65]) model.box(bronze, x, 1.25, -21.015, 1.25, 2.45, .09);

  if (typeof document !== 'undefined') {
    const names = finish('#ffffff');
    names.name = 'Hatch Shell composer inscriptions';
    names.map = landmarkTexture(2048, 256, ctx => {
      ctx.clearRect(0, 0, 2048, 256); ctx.fillStyle = '#575046';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '42px Georgia';
      ctx.fillText('BACH     HANDEL     HAYDN     MOZART     BEETHOVEN     SCHUBERT', 1024, 63, 1960);
      ctx.font = '38px Georgia';
      ctx.fillText('MENDELSSOHN     SCHUMANN     CHOPIN     WAGNER     BRAHMS     TCHAIKOVSKY', 1024, 178, 1960);
    });
    names.alphaTest = .4;
    model.quad(names, [-13.85, 1.22, 2.915], [13.85, 1.22, 2.915], [13.85, 2.32, 2.915], [-13.85, 2.32, 2.915]);
  }
  model.group.userData.openStage = true;
  model.group.userData.stageElevation = BASE + STAGE;
  const result = model.build();
  // The exterior skin already casts the shell's complete shadow. Avoid
  // duplicate self-shadowing from the closely spaced interior skin and seams.
  for (const mesh of result.group.children as THREE.Mesh[]) {
    if (mesh.material === wood || mesh.material === rib || mesh.material === joints) mesh.castShadow = false;
  }
  return { ...result, setLighting };
}
