import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENTRANCE_CLEARANCE, ENTRANCE_PANEL, entranceGantry, type EntranceSign } from '../simulation/entrance-signs.ts';

const FACE_WIDTH = 576, FACE_HEIGHT = FACE_WIDTH * ENTRANCE_PANEL.height / ENTRANCE_PANEL.width;
const GREEN = '#006347', WHITE = '#f3f4e9';

/** The Massachusetts Turnpike's marker, drawn from plain shapes: a pilgrim's hat on a white square. */
function pikeMarker(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = WHITE; ctx.beginPath(); ctx.roundRect(x, y, size, size, size * .1); ctx.fill();
  ctx.strokeStyle = '#161b1a'; ctx.lineWidth = size * .03; ctx.beginPath(); ctx.roundRect(x + size * .05, y + size * .05, size * .9, size * .9, size * .07); ctx.stroke();
  const at = (u: number, v: number): [number, number] => [x + size * u, y + size * v];
  ctx.fillStyle = '#161b1a';
  // the crown, narrower at its top, and the brim under it
  ctx.beginPath(); ctx.moveTo(...at(.34, .22)); ctx.lineTo(...at(.66, .22)); ctx.lineTo(...at(.74, .66)); ctx.lineTo(...at(.26, .66)); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.roundRect(...at(.12, .64), size * .76, size * .11, size * .05); ctx.fill();
  // the band and its buckle
  ctx.fillStyle = WHITE; ctx.beginPath(); ctx.moveTo(...at(.285, .49)); ctx.lineTo(...at(.715, .49)); ctx.lineTo(...at(.73, .58)); ctx.lineTo(...at(.27, .58)); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#161b1a'; ctx.fillRect(...at(.44, .465), size * .12, size * .14);
  ctx.fillStyle = WHITE; ctx.fillRect(...at(.475, .5), size * .05, size * .07);
}

/** An Interstate route shield: a red crown over a blue field with the number in white. */
function interstateShield(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, number: string) {
  const at = (u: number, v: number): [number, number] => [x + size * u, y + size * v];
  const outline = () => {
    ctx.beginPath(); ctx.moveTo(...at(.5, .02));
    ctx.quadraticCurveTo(...at(.74, .1), ...at(.94, .03)); ctx.bezierCurveTo(...at(1.06, .42), ...at(.9, .8), ...at(.5, .99));
    ctx.bezierCurveTo(...at(.1, .8), ...at(-.06, .42), ...at(.06, .03)); ctx.quadraticCurveTo(...at(.26, .1), ...at(.5, .02)); ctx.closePath();
  };
  ctx.save(); outline(); ctx.clip();
  ctx.fillStyle = '#0b3c8a'; ctx.fillRect(x - size * .1, y, size * 1.2, size);
  ctx.fillStyle = '#b3202d'; ctx.fillRect(x - size * .1, y, size * 1.2, size * .27);
  ctx.fillStyle = WHITE; ctx.fillRect(x - size * .1, y + size * .26, size * 1.2, size * .035);
  ctx.restore();
  outline(); ctx.strokeStyle = WHITE; ctx.lineWidth = size * .045; ctx.stroke();
  ctx.fillStyle = WHITE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${size * .15}px Arial, sans-serif`; ctx.fillText('INTERSTATE', x + size * .5, y + size * .165, size * .7);
  ctx.font = `700 ${size * .52}px Arial, sans-serif`; ctx.fillText(number, x + size * .5, y + size * .6, size * .78);
}

/** The printed face: the markers and the direction in a row, the destinations under them and an arrow down onto the ramp. */
function entranceFace(sign: EntranceSign) {
  // Headless geometry tests do not need a canvas; the game always has one.
  if (typeof document === 'undefined') return new THREE.MeshBasicMaterial({ color: GREEN });
  const canvas = document.createElement('canvas');
  canvas.width = FACE_WIDTH; canvas.height = FACE_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = GREEN; ctx.fillRect(0, 0, FACE_WIDTH, FACE_HEIGHT);
  ctx.strokeStyle = WHITE; ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect(9, 9, FACE_WIDTH - 18, FACE_HEIGHT - 18, 24); ctx.stroke();
  // The row is centred as a whole: marker, shield, direction.
  const marker = 122, gap = 20, top = 44;
  ctx.font = '600 66px Arial, sans-serif';
  const word = ctx.measureText(sign.direction).width, row = (sign.pike ? marker + gap : 0) + marker + gap + word;
  let x = (FACE_WIDTH - row) / 2;
  if (sign.pike) { pikeMarker(ctx, x, top, marker); x += marker + gap; }
  interstateShield(ctx, x, top, marker, sign.shield); x += marker + gap;
  ctx.fillStyle = WHITE; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '600 66px Arial, sans-serif';
  ctx.fillText(sign.direction, x, top + marker / 2 + 3);
  // Destinations share the band between the row and the arrow.
  const band = [top + marker + 18, FACE_HEIGHT - 150], step = (band[1] - band[0]) / sign.lines.length;
  ctx.textAlign = 'center';
  sign.lines.forEach((line, i) => { ctx.font = `600 ${Math.min(108, step * .82)}px Arial, sans-serif`; ctx.fillText(line, FACE_WIDTH / 2, band[0] + step * (i + .5) + 4, FACE_WIDTH - 70); });
  // The arrow is a shape, so its weight matches the lettering: straight down onto the ramp beneath.
  const cx = FACE_WIDTH / 2, tip = FACE_HEIGHT - 32;
  ctx.beginPath(); ctx.moveTo(cx - 16, tip - 108); ctx.lineTo(cx + 16, tip - 108); ctx.lineTo(cx + 16, tip - 50); ctx.lineTo(cx + 50, tip - 50); ctx.lineTo(cx, tip); ctx.lineTo(cx - 50, tip - 50); ctx.lineTo(cx - 16, tip - 50); ctx.closePath(); ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map, toneMapped: false });
}

/** A gantry over the ramp's mouth: a post behind each wall of its slot, a truss between them and the panel on it,
 * its face turned toward the traffic coming off the street. The face material is the caller's to dispose. */
export function createEntranceSign(sign: EntranceSign, groundAt: (x: number, z: number) => number, steel: THREE.Material) {
  const { x, y, z, yaw } = sign.approach, gantry = entranceGantry(sign), { width, height } = ENTRANCE_PANEL;
  const group = new THREE.Group();
  group.name = `Entrance sign: ${sign.rampId}`;
  group.position.set(x, y, z);
  // Local +x is the right of travel and +z faces the approaching traffic.
  group.rotation.y = yaw + Math.PI;
  const mid = ENTRANCE_CLEARANCE + height / 2, beamY = mid + .2, beamHeight = .8, top = beamY + beamHeight / 2 + .18;
  const material = entranceFace(sign);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  face.name = `I-${sign.shield} ${sign.direction} · ${sign.lines.join(' / ')}`;
  face.position.set(0, mid, .05);
  group.add(face);

  const span = 2 * gantry.reach, hardware: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(width, height, .08).translate(0, mid, 0),
    new THREE.BoxGeometry(span, .13, .22).translate(0, beamY + beamHeight / 2, -.2),
    new THREE.BoxGeometry(span, .13, .22).translate(0, beamY - beamHeight / 2, -.2),
    // the hangers that carry the panel on the truss
    ...[-1, 1].map(side => new THREE.BoxGeometry(.1, height * .92, .1).translate(side * width * .3, mid, -.09)),
  ];
  for (const post of gantry.posts) {
    // (a post's foot is on the ground behind the wall, which stands over the ramp once it has gone down)
    const foot = Math.min(0, groundAt(post.x, post.z) - y) - .2, at = -post.across;
    hardware.push(new THREE.CylinderGeometry(.13, .16, top - foot, 10).translate(at, (foot + top) / 2, -.2), new THREE.CylinderGeometry(.3, .3, .24, 10).translate(at, groundAt(post.x, post.z) - y + .1, -.2));
  }
  const bays = Math.max(6, Math.round(span / .95)), bay = span / bays;
  for (let i = 0; i < bays; i++) {
    hardware.push(new THREE.BoxGeometry(Math.hypot(bay, beamHeight), .07, .1)
      .rotateZ((i % 2 ? -1 : 1) * Math.atan2(beamHeight, bay))
      .translate(-span / 2 + (i + .5) * bay, beamY, -.2));
  }
  const support = new THREE.Mesh(mergeGeometries(hardware)!, steel);
  support.name = 'Gantry and sign backing';
  support.castShadow = true;
  group.add(support);
  for (const geometry of hardware) geometry.dispose();
  return { group, material };
}
