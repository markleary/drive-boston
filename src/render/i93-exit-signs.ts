import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EXIT_SIGN_POST, type I93ExitSign } from '../simulation/i93-exit-signs';
import { roadsidePoint } from '../simulation/highway-signs';

const PANEL_FULL_WIDTH = 7.5;
const PANEL_FULL_HEIGHT = PANEL_FULL_WIDTH * 320 / 768;
const TAB_FULL_WIDTH = PANEL_FULL_WIDTH * 238 / 768;
const TAB_FULL_HEIGHT = PANEL_FULL_HEIGHT * 64 / 320;
const CLEARANCE = 5.4;

function exitFace(sign: I93ExitSign) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  const green = '#006347', white = '#f3f4e9';
  const panel = (x: number, y: number, w: number, h: number, radius: number) => {
    ctx.fillStyle = green;
    ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 6, w - 12, h - 12, radius);
    ctx.strokeStyle = white;
    ctx.lineWidth = 4;
    ctx.stroke();
  };
  const text = (value: string, x: number, y: number, size: number, width: number, color = white) => {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y, width);
  };

  if (sign.number) panel(530, 0, 238, 69, 5);
  panel(0, 64, 768, 256, 16);
  if (sign.number) { text('EXIT', 594, 34, 31, 95); text(sign.number, 699, 35, 43, 82); }
  if (sign.routes?.length) {
    // Massachusetts uses a square white state-route marker with black numerals.
    const routeRowWidth = sign.routes.length * 73 + (sign.direction ? 111 : 0);
    const left = 369 - routeRowWidth / 2;
    sign.routes.forEach((route, i) => {
      const x = left + i * 73;
      ctx.fillStyle = white;
      ctx.fillRect(x, 91, 64, 64);
      text(route, x + 32, 124, 48, 55, '#161b1a');
    });
    if (sign.direction) text(sign.direction, left + 131, 122, 36, 108);
  }
  sign.lines.forEach((line, i) => {
    const y = sign.routes?.length ? 196 + i * 68 : 113 + i * 77;
    text(line, 360, y, 57, 644);
  });

  // Draw the arrow as a shape so its weight matches the lettering everywhere.
  ctx.save();
  ctx.translate(707, 253);
  ctx.rotate(Math.PI / 5);
  ctx.fillStyle = white;
  ctx.beginPath();
  ctx.moveTo(0, -39);
  ctx.lineTo(27, -11);
  ctx.lineTo(9, -11);
  ctx.lineTo(9, 38);
  ctx.lineTo(-9, 38);
  ctx.lineTo(-9, -11);
  ctx.lineTo(-27, -11);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map, alphaTest: .45, toneMapped: false });
}

/** A right-shoulder cantilever, with the printed face turned toward traffic. Its pole stands `EXIT_SIGN_POST` beyond the road's edge, or where the caller found it a place clear of the lanes beside the road (`approach.post`, clearRoadside): the panel stays over the right lane and the truss is as long as that takes. */
export function createI93ExitSign(sign: I93ExitSign, groundAt: (x: number, z: number) => number, steel: THREE.Material) {
  const { x, y, z, yaw, edge, post } = sign.approach;
  const group = new THREE.Group();
  group.name = `${sign.rampId.startsWith('i93-') ? 'I-93 advance' : 'Advance exit'} sign: ${sign.rampId}`;
  group.position.set(x, y, z);
  group.rotation.y = yaw + Math.PI;

  // A smaller panel (Storrow Drive) hangs over the right lane of a narrower road.
  const scale = sign.scale ?? 1, PANEL_WIDTH = PANEL_FULL_WIDTH * scale, PANEL_HEIGHT = PANEL_FULL_HEIGHT * scale, TAB_WIDTH = TAB_FULL_WIDTH * scale, TAB_HEIGHT = TAB_FULL_HEIGHT * scale;
  const center = Math.max(edge - 4.8, edge + .3 - PANEL_WIDTH / 2 - .35);
  const shoulder = post ?? edge + EXIT_SIGN_POST, foot = roadsidePoint({ x, z, yaw }, shoulder);
  const ground = Math.min(-.12, groundAt(foot.x, foot.z) - y);
  const mid = CLEARANCE + PANEL_HEIGHT / 2;
  const material = exitFace(sign);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT), material);
  face.name = `${sign.number ? `Exit ${sign.number}` : 'Exit'} · ${sign.lines.join(' / ')}`;
  face.position.set(center, mid, .05);
  group.add(face);

  const railStart = center - PANEL_WIDTH / 2 + .4, railEnd = shoulder;
  const railLength = railEnd - railStart, railCenter = (railStart + railEnd) / 2;
  const beamY = mid - .25, beamHeight = .82, poleTop = beamY + beamHeight / 2 + .17;
  const hardware = [
    new THREE.BoxGeometry(PANEL_WIDTH, PANEL_HEIGHT - TAB_HEIGHT, .08).translate(center, mid - TAB_HEIGHT / 2, 0),
    ...(sign.number ? [new THREE.BoxGeometry(TAB_WIDTH, TAB_HEIGHT, .08).translate(center + (PANEL_WIDTH - TAB_WIDTH) / 2, mid + (PANEL_HEIGHT - TAB_HEIGHT) / 2, 0)] : []),
    new THREE.CylinderGeometry(.22, .27, poleTop - ground, 10).translate(shoulder, (ground + poleTop) / 2, -.36),
    new THREE.CylinderGeometry(.33, .33, .22, 10).translate(shoulder, ground + .11, -.36),
    new THREE.BoxGeometry(railLength, .13, .24).translate(railCenter, beamY + beamHeight / 2, -.16),
    new THREE.BoxGeometry(railLength, .13, .24).translate(railCenter, beamY - beamHeight / 2, -.16),
  ];
  const bays = 7, bay = railLength / bays;
  for (let i = 0; i < bays; i++) {
    hardware.push(new THREE.BoxGeometry(Math.hypot(bay, beamHeight), .07, .10)
      .rotateZ((i % 2 ? -1 : 1) * Math.atan2(beamHeight, bay))
      .translate(railStart + (i + .5) * bay, beamY, -.16));
  }
  const support = new THREE.Mesh(mergeGeometries(hardware)!, steel);
  support.name = 'Cantilever and sign backing';
  support.castShadow = true;
  group.add(support);
  for (const geometry of hardware) geometry.dispose();

  return { group, material };
}
