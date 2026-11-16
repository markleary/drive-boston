import * as THREE from 'three';
import shell from '../data/schrafft-shell.json' with { type: 'json' };
import { finish, LandmarkModel, landmarkTexture } from './landmark-model.ts';
import { seeded } from './materials.ts';

export const SCHRAFFT_ID = shell.building.id;
export const SCHRAFFT_FIRST = shell.building.footprint[0] as [number, number];
// Surveyed Main Street corner. u runs southeast across the short front;
// v runs northeast down the factory's long I-93-facing side.
const O = [174.263, -3812.411], ANGLE = Math.atan2(.7251, .6886);
const C = Math.cos(ANGLE), S = Math.sin(ANGLE);
export const schrafftWorld = (u: number, v: number): [number, number] => [O[0] + C * u + S * v, O[1] + S * u - C * v];
export const schrafftFrame = (x: number, z: number): [number, number] => [(x - O[0]) * C + (z - O[1]) * S, (x - O[0]) * S - (z - O[1]) * C];

/** Original painted elevations, in metres; not photographic textures.
 * The seven-storey mill has five tall window rows above its striped base.
 * See the supplied Main Street photos and the historic resource study. */
function elevation(kind: 'front' | 'west' | 'bay', lit: boolean, mobile: boolean) {
  const width = kind === 'front' ? 56 : kind === 'west' ? 148 : 6;
  const height = 52, pixels = kind === 'west' ? 2048 : kind === 'front' ? 1024 : 128;
  const resolution = (mobile ? .5 : 1) * (lit ? .5 : 1);
  return landmarkTexture(pixels * resolution, 1024 * resolution, ctx => {
    const canvas = ctx.canvas, random = seeded(529);
    ctx.scale(canvas.width / width, canvas.height / height);
    const rect = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, height - y - h, w, h); };
    rect(0, 0, width, height, lit ? '#000' : '#a69a7f');
    if (!lit) {
      // Tapestry brick, small enough to read as masonry rather than a grid.
      for (let y = 0; y < height; y += .2) for (let x = -.5; x < width; x += .47) {
        const shade = Math.floor(random() * 23);
        rect(x + (Math.round(y * 5) % 2) * .235, y, .44, .18, `rgb(${151 + shade},${139 + shade},${110 + shade})`);
      }
      rect(0, 0, width, 5.7, '#d7d4c5');
      for (const y of [6, 7.3, 8.6]) rect(0, y, width, .62, '#dcd9cb');
      rect(0, 34.7, width, .34, '#d5d3c5');
    }
    const window = (x: number, y: number, w: number, h: number, arched = false) => {
      const on = random() > .7;
      if (lit && !on) return;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(x, height - y); ctx.lineTo(x + w, height - y); ctx.lineTo(x + w, height - y - h + (arched ? .55 : 0));
      if (arched) ctx.quadraticCurveTo(x + w / 2, height - y - h - .45, x, height - y - h + .55);
      else ctx.lineTo(x, height - y - h);
      ctx.closePath(); ctx.clip();
      const gradient = ctx.createLinearGradient(0, height - y - h, 0, height - y);
      gradient.addColorStop(0, lit ? '#d9d7b4' : '#697f88'); gradient.addColorStop(1, lit ? '#797961' : '#293337');
      ctx.fillStyle = gradient; ctx.fillRect(x, height - y - h - 1, w, h + 1);
      for (let dx = 0; dx <= w; dx += w / 3) rect(x + dx - .045, y, .09, h, lit ? '#101414' : '#303c3b');
      for (let dy = 0; dy <= h; dy += h / 4) rect(x, y + dy - .045, w, .09, lit ? '#101414' : '#303c3b');
      ctx.restore();
      if (!lit) { ctx.strokeStyle = '#c6c8bb'; ctx.lineWidth = .1; ctx.stroke(); }
    };
    const bay = (x: number, w: number) => {
      for (let row = 0; row < 5; row++) {
        const y = 10.1 + row * 5.05;
        if (!lit) {
          rect(x, y - 1.0, w, .96, '#6d815b');
          for (let tile = x; tile < x + w; tile += .17) rect(tile, y - .94, .035, .82, '#a5ad87');
          rect(x - .08, y - .12, w + .16, .16, '#d3cfbd');
        }
        window(x, y, w, 4.02, row === 4);
      }
      window(x, 1.2, w, 3.4);
    };
    if (kind === 'bay') bay(.65, 4.7);
    else {
      for (let x = 14.4; x < width - 2; x += 6.05) bay(x, Math.min(4.65, width - x - 1.1));
      // Narrow tower window shafts framed by full-height limestone piers.
      for (const x of [0.65, 9.65]) rect(x, 9.2, 3.0, 35.0, lit ? '#14140e' : '#deddd0');
      rect(3.6, 38.0, 6.1, 6.4, lit ? '#0a100a' : '#74896b');
      for (const x of [4.05, 5.95, 7.85]) {
        for (let row = 0; row < 5; row++) window(x, 10.5 + row * 5.05, 1.4, 4.65);
        rect(x, 35.7, 1.4, 2.3, lit ? '#14140e' : '#e0dfd1');
        window(x, 47.0, 1.0, 2.4);
      }
      if (!lit) {
        for (const x of [1.4, 10.2]) rect(x, 47.0, 1.8, 2.8, '#d9d8c9');
        rect(0, 50.35, 13.36, .33, '#dfddcc');
      }
    }
  });
}

function clockTexture() {
  return landmarkTexture(256, 256, ctx => {
    ctx.fillStyle = '#efeeda'; ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#343f3b'; ctx.lineWidth = 5; ctx.stroke();
    const roman = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ctx.fillStyle = '#303a38'; ctx.font = 'bold 24px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.save(); ctx.translate(128 + Math.sin(a) * 91, 128 - Math.cos(a) * 91); ctx.rotate(a); ctx.fillText(roman[i], 0, 0); ctx.restore(); }
    ctx.lineCap = 'round'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(83, 107); ctx.moveTo(128, 128); ctx.lineTo(151, 61); ctx.stroke();
    ctx.beginPath(); ctx.arc(128, 128, 8, 0, Math.PI * 2); ctx.fill();
  });
}

function signTexture(halo = false) {
  return landmarkTexture(1024, 256, ctx => {
    ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    ctx.translate(24, 0); ctx.font = 'bold 124px Arial';
    ctx.scale(976 / (136 + ctx.measureText('CHRAFFT’S').width), 1);
    if (halo) { ctx.shadowColor = '#ff8dcb'; ctx.shadowBlur = 18; }
    const letter = (text: string, font: string, x: number, y: number) => {
      ctx.font = font;
      ctx.strokeStyle = halo ? '#ff92cc' : '#453233'; ctx.lineWidth = halo ? 11 : 15; ctx.strokeText(text, x, y);
      ctx.fillStyle = '#9e404a'; ctx.fillText(text, x, y);
      ctx.strokeStyle = '#ec929f'; ctx.lineWidth = 3; ctx.strokeText(text, x, y);
    };
    letter('S', 'italic bold 219px Georgia', 0, 205);
    letter('CHRAFFT’S', 'bold 124px Arial', 136, 180);
  });
}

export function buildSchrafftCenter(mobile = false) {
  const group = new THREE.Group(); group.name = 'Schrafft Center';
  const finishes = (['front', 'west', 'bay'] as const).map(kind => new THREE.MeshStandardMaterial({
    map: elevation(kind, false, mobile), emissiveMap: elevation(kind, true, mobile), emissive: '#fff', emissiveIntensity: 0, roughness: .86,
  }));
  const roof = finish('#92948c');
  const positions = shell.positions, buffers = finishes.map(() => ({ p: [] as number[], uv: [] as number[] }));
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < shell.facade.length; i += 3) {
    const ids = shell.facade.slice(i, i + 3);
    va.fromArray(positions, ids[0] * 3); vb.fromArray(positions, ids[1] * 3); vc.fromArray(positions, ids[2] * 3);
    n.crossVectors(vb.sub(va), vc.sub(va)).normalize();
    const front = n.x * -S + n.z * C > .85, west = n.x * -C + n.z * -S > .85;
    const kind = front ? 0 : west ? 1 : 2, buffer = buffers[kind];
    for (const id of ids) {
      const [x, y, z] = positions.slice(id * 3, id * 3 + 3), [u, v] = schrafftFrame(x, z);
      buffer.p.push(x, y, z);
      buffer.uv.push(kind === 0 ? u / 56 : kind === 1 ? v / 148 : ((Math.abs(n.x) > .7 ? z : x) / 6), y / 52);
    }
  }
  finishes[2].map!.wrapS = finishes[2].emissiveMap!.wrapS = THREE.RepeatWrapping;
  for (let i = 0; i < buffers.length; i++) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers[i].p, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers[i].uv, 2)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, finishes[i]); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  const roofGeometry = new THREE.BufferGeometry(); roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); roofGeometry.setIndex(shell.roof); roofGeometry.computeVertexNormals();
  const roofMesh = new THREE.Mesh(roofGeometry, roof); roofMesh.castShadow = roofMesh.receiveShadow = true; group.add(roofMesh);

  // Local z is the negative of v, so a +z face looks toward Main Street.
  const details = new LandmarkModel('Schrafft clock tower details', SCHRAFFT_ID, O[0], 0, O[1], ANGLE);
  const stone = finish('#dddaca'), iron = finish('#4b514c', .55, .4);
  const dialMap = clockTexture(), dial = new THREE.MeshStandardMaterial({ map: dialMap, emissiveMap: dialMap, emissive: '#ffffed', emissiveIntensity: 0, roughness: .55 });
  const signMap = signTexture(), neon = new THREE.MeshStandardMaterial({ map: signMap, emissiveMap: signMap, emissive: '#ffb6d9', emissiveIntensity: 0, transparent: true, alphaTest: .06, roughness: .55 });
  const halo = new THREE.MeshBasicMaterial({ map: signTexture(true), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  // Four outward-facing clocks and signs. Their local right vectors keep the
  // lettering readable from either side, including the highway approach.
  const faces = [{ x: 6.68, z: .12, yaw: 0 }, { x: -.25, z: -6.55, yaw: -Math.PI / 2 }, { x: 6.5, z: -13.2, yaw: Math.PI }, { x: 13.5, z: -6.5, yaw: Math.PI / 2 }];
  for (const f of faces) {
    const at = (g: THREE.BufferGeometry, m: THREE.Material, y: number, out = 0) => { g.rotateY(f.yaw); g.translate(f.x + Math.sin(f.yaw) * out, y, f.z + Math.cos(f.yaw) * out); details.append(m, g); };
    at(new THREE.PlaneGeometry(13.8, 3.45), neon, 45.9, .38);
    at(new THREE.PlaneGeometry(14.15, 3.55), halo, 45.9, .4);
    at(new THREE.CircleGeometry(2.05, 48), dial, 41.25, .18);
    at(new THREE.TorusGeometry(2.13, .13, 5, 48), iron, 41.25, .2);
    for (const y of [44.5, 47.2]) at(new THREE.BoxGeometry(13.7, .12, .2), iron, y, .2);
  }
  for (let x = .9; x < 13; x += 3.2) for (const z of [.1, -13]) details.box(stone, x, 51.35, z, 2.1, .55, .5);
  for (let z = -2.3; z > -12; z -= 3.2) for (const x of [0, 13.3]) details.box(stone, x, 51.35, z, .5, .55, 2.1);
  details.box(iron, 6.6, 57.1, -6.55, .16, 11.2, .16);
  const detail = details.build(); group.add(detail.group);
  const flagMap = landmarkTexture(512, 270, ctx => {
    for (let stripe = 0; stripe < 13; stripe++) { ctx.fillStyle = stripe % 2 ? '#f3eee1' : '#bd3443'; ctx.fillRect(0, stripe * 270 / 13, 512, 270 / 13 + 1); }
    ctx.fillStyle = '#213b68'; ctx.fillRect(0, 0, 205, 270 * 7 / 13); ctx.fillStyle = '#fff9e8';
    for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) {
      const x = 17 + col * 34 + (row % 2 ? 17 : 0), y = 9 + row * 16;
      ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5 - Math.PI / 2, r = k % 2 ? 2.5 : 6; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
    }
  });
  const flagMaterial = new THREE.MeshStandardMaterial({ map: flagMap, side: THREE.DoubleSide, roughness: .85, emissiveMap: flagMap, emissive: '#fff', emissiveIntensity: 0 });
  const flagGeometry = new THREE.PlaneGeometry(6.2, 3.26, 20, 8); flagGeometry.translate(3.1, -1.63, 0);
  const flag = new THREE.Mesh(flagGeometry, flagMaterial); const [fx, fz] = schrafftWorld(6.6, 6.55); flag.position.set(fx, 62.4, fz); flag.rotation.y = .35; flag.frustumCulled = false; group.add(flag);
  const flagPoints = flagGeometry.getAttribute('position');
  group.userData = { buildingId: SCHRAFFT_ID, clocks: 4, signs: 4, flag: true, towerHeight: 51.131, night: false, triangles: shell.facade.length / 3 + shell.roof.length / 3 + detail.group.userData.triangles + 320 };
  return {
    group,
    collision: { id: SCHRAFFT_ID, vertices: Float32Array.from(positions), indices: Uint32Array.from([...shell.facade, ...shell.roof]) },
    setLighting(night: boolean) {
      group.userData.night = night; finishes.forEach(m => m.emissiveIntensity = night ? .55 : 0);
      dial.emissiveIntensity = night ? 2.0 : 0; neon.emissiveIntensity = night ? 4.2 : 0; halo.opacity = night ? .28 : 0; flagMaterial.emissiveIntensity = night ? .3 : 0;
    },
    update(time: number) {
      for (let i = 0; i < flagPoints.count; i++) { const x = flagPoints.getX(i), y = flagPoints.getY(i); flagPoints.setZ(i, (Math.sin(x * 1.8 - time * 3.8) * .32 + Math.sin(x * 3.1 + y * 1.4 - time * 5) * .1) * x / 6.2); }
      flagPoints.needsUpdate = true; flagGeometry.computeVertexNormals();
    },
  };
}
