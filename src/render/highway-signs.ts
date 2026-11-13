import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { warningLegend, type HighwaySignPlacement } from '../simulation/highway-signs';

const WIDTH = 1.5, POST = 2.3;
const faces = new Map<string, THREE.MeshBasicMaterial>();

/** Black on yellow, as Storrow Drive posts them. One texture per legend, shared by every sign that carries it. */
function warningFace(lines: string[]) {
  const key = lines.join('|'), cached = faces.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas'), height = lines.length > 2 ? 320 : 224;
  canvas.width = 256; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f2c200'; ctx.fillRect(0, 0, 256, height);
  ctx.strokeStyle = '#17150f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.roundRect(9, 9, 238, height - 18, 14); ctx.stroke();
  ctx.fillStyle = '#17150f'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const row = (height - 36) / lines.length;
  lines.forEach((line, i) => {
    // The posted height is the line a driver has to read: it takes the largest type.
    ctx.font = `700 ${/\d/.test(line) ? 74 : line.length > 6 ? 40 : 66}px Arial, sans-serif`;
    ctx.fillText(line, 128, 18 + row * (i + .5) + 3, 222);
  });
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map, toneMapped: false });
  faces.set(key, material);
  return material;
}

/** A roadside warning on the right shoulder, its face turned toward traffic. The shared face material is the caller's to keep. */
export function createWarningSign(place: HighwaySignPlacement, groundAt: (x: number, z: number) => number, steel: THREE.Material) {
  const { x, y, z, yaw, edge } = place.approach, lines = warningLegend(place.sign), height = WIDTH * (lines.length > 2 ? 320 : 224) / 256;
  const group = new THREE.Group();
  group.name = `Warning sign: ${lines.join(' ')} on ${place.road.id}`;
  group.position.set(x, y, z);
  group.rotation.y = yaw + Math.PI;
  const shoulder = edge + .75, ground = Math.min(-.1, groundAt(x - Math.cos(yaw) * shoulder, z + Math.sin(yaw) * shoulder) - y), mid = POST + height / 2;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, height), warningFace(lines));
  face.name = lines.join(' ');
  face.position.set(shoulder, mid, .045);
  group.add(face);
  const hardware = [
    new THREE.BoxGeometry(WIDTH, height, .05).translate(shoulder, mid, 0),
    new THREE.CylinderGeometry(.055, .055, POST + height - ground, 8).translate(shoulder, (ground + POST + height) / 2, -.09),
  ];
  const support = new THREE.Mesh(mergeGeometries(hardware)!, steel);
  support.name = 'Post and sign backing'; support.castShadow = true;
  group.add(support);
  for (const geometry of hardware) geometry.dispose();
  return group;
}
