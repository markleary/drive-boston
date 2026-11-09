import * as THREE from 'three';
import type { Point2 } from '../types.ts';
import { registerContextTexture } from './context-resources.ts';
import { seeded } from './materials.ts';
import { finish, LandmarkModel, landmarkTexture, lettering, rectangle } from './landmark-model.ts';

export const ENCORE_ID = 'osm-way-687795571';

const PODIUM: Point2[] = [
  [-244, -70], [189, -70], [189, -16], [87, 110.7], [51, 119.4], [33, 120], [30, 111],
  [-20, 110], [-36, 114], [-45, 114.7], [-60, 109], [-70, 95.5], [-71, 79.7],
  [-61.6, 58.5], [-72, -4.1], [-88, -1.6], [-102.5, -3.7], [-114, -14],
  [-115.2, -23.5], [-241.6, -10.1], [-244.2, -34.1], [-250, -39], [-251.4, -47.1],
];

// Inset the aerial trace along the podium's rail-aligned frame so its roof
// projects past both tower ends. Both long faces bow away from the Mystic.
const TOWER_SETBACK = 24;
function curve(t: number, river: boolean, offset = 0): Point2 {
  const bow = 4 * t * (1 - t);
  return river
    ? [-18.1 + 10.8 * t + 14.1 * bow - offset, 5 + 114.5 * t - TOWER_SETBACK]
    : [1.8 + 10.2 * t + 14.4 * bow + offset, -7.9 + 129.4 * t - TOWER_SETBACK];
}

const LEVELS = 24;
const COLUMNS = 47;
const SEGMENTS = 40;
const GLASS_BOTTOM = 15.6;
const CROWN = 97.8;
const STOREY = 3.16;
const haze = (material: THREE.Material) => {
  // Preserve the landmark's silhouette across the Mystic on the I-93 approach.
  // A covered tunnel keeps the normal short fog range.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>',
      `#if defined( USE_FOG ) && !defined( FOG_EXP2 )
        float landmarkFog = smoothstep(fogNear, fogFar * (fogFar > 500.0 ? 2.1 : 1.0), vFogDepth);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, landmarkFog);
      #endif`);
  };
};

function glassTexture(lit: boolean) {
  const random = seeded(lit ? 1794 : 2761);
  const size = 16;
  return landmarkTexture(COLUMNS * size, LEVELS * size, ctx => {
    ctx.fillStyle = lit ? '#000000' : '#38251d';
    ctx.fillRect(0, 0, COLUMNS * size, LEVELS * size);
    for (let row = 0; row < LEVELS; row++) for (let col = 0; col < COLUMNS; col++) {
      const variation = random();
      if (lit && variation > .19) continue;
      const x = col * size, y = row * size;
      ctx.fillStyle = lit ? (variation > .11 ? '#9b5225' : '#dba264') :
        ['#5f4639', '#604539', '#584033', '#63493a', '#594237'][Math.floor(variation * 5)];
      ctx.fillRect(x + 1, y, size - 1, size);
      ctx.fillStyle = lit ? '#33170a' : '#49362e';
      ctx.fillRect(x + 9, y, 1, size);
      ctx.fillRect(x + 1, y + size - 1, size - 1, 1);
    }
  });
}

function nightGlassTexture() {
  const random = seeded(7049), size = 16;
  const glass = ['#2b2421', '#302520', '#332924', '#292529'];
  const curtains = ['#766650', '#8d7c65', '#ad9c82', '#737b7e'];
  return landmarkTexture(COLUMNS * size, LEVELS * size, ctx => {
    ctx.fillStyle = '#241e1c';
    ctx.fillRect(0, 0, COLUMNS * size, LEVELS * size);
    for (let row = 0; row < LEVELS; row++) for (let col = 0; col < COLUMNS; col++) {
      const x = col * size, y = row * size;
      ctx.fillStyle = glass[Math.floor(random() * glass.length)];
      ctx.fillRect(x + 1, y, size - 1, size - 1);
      // Bronze glass and shades conceal most rooms. Let a little light through
      // part of a pane, with a dimmer spill on the glass around the opening.
      if (random() > .085) continue;
      const left = x + 3 + Math.floor(random() * 5), top = y + 3 + Math.floor(random() * 3);
      const width = 2 + Math.floor(random() * 5), height = 5 + Math.floor(random() * 4);
      ctx.fillStyle = '#463b33';
      ctx.fillRect(left - 1, top - 1, width + 2, height + 2);
      ctx.fillStyle = curtains[Math.floor(random() * curtains.length)];
      ctx.fillRect(left, top, width, height);
    }
  });
}

export function buildEncore(base: number) {
  const model = new LandmarkModel('Encore Boston Harbor', ENCORE_ID, 414.147, base, -5040.204, Math.atan2(-.763, .646));
  const stone = finish('#d8c4a4'), cream = finish('#eddbba'), coping = finish('#bca482');
  const membrane = finish('#d7ccba'), roof = finish('#b7aca0'), vent = finish('#777169');
  const solar = finish('#303b4c', .32, .18), baseGlass = finish('#665347', .23, .28);
  const dayGlow = glassTexture(true), nightGlow = nightGlassTexture();
  const bronze = new THREE.MeshStandardMaterial({
    color: '#d5ad94', map: glassTexture(false), emissive: '#ffae69', emissiveMap: dayGlow,
    emissiveIntensity: .025, metalness: .64, roughness: .115, envMapIntensity: 1.17,
  });
  for (const texture of [dayGlow, nightGlow]) registerContextTexture(bronze, texture);
  const crown = finish('#50352c', .135, .62);
  crown.envMapIntensity = 1.25;
  crown.emissive.set('#30231f');
  crown.emissiveIntensity = 0;
  const bands = new THREE.MeshStandardMaterial({ color: '#e8cea5', roughness: .5, emissive: '#ffc573', emissiveIntensity: .11 });
  const name = lettering('Encore', '#ffe6b0', '600 106px "Snell Roundhand", "Brush Script MT", cursive', true);
  for (const material of [bronze, crown, bands, name]) haze(material);

  model.prism(stone, PODIUM, -3.5, 13.7, true, membrane);
  for (let i = 0; i < PODIUM.length; i++) {
    const a = PODIUM[i], b = PODIUM[(i + 1) % PODIUM.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
    const yaw = -Math.atan2(dz, dx);
    model.box(cream, (a[0] + b[0]) / 2, 13.9, (a[1] + b[1]) / 2, length + .1, .55, .65, false, yaw);
    model.box(coping, (a[0] + b[0]) / 2 + dz * .16, 10.2, (a[1] + b[1]) / 2 - dx * .16, length, .34, .58, false, yaw);
    if (dz > 0 || length < 7) continue;
    for (let s = 3; s < length - 2.5; s += 5.6) {
      const x = a[0] + dx * s, z = a[1] + dz * s;
      model.box(coping, x + dz * .2, 5.8, z - dx * .2, .52, 8.6, .63, false, yaw);
      model.box(baseGlass, x + dx * 2.35 + dz * .14, 6.7, z + dz * 2.35 - dx * .14, 3.6, 3.9, .31, false, yaw);
    }
  }

  // Event wing, service penthouses and roof-mounted solar arrays.
  for (const [x, z, w, d, h] of [[104, -24, 96, 58, 5], [86, 22, 56, 23, 4], [56, 79, 32, 19, 4.6], [-143, -48, 48, 30, 3.6]]) {
    model.prism(stone, rectangle(x - w / 2, x + w / 2, z - d / 2, z + d / 2), 13.7, 13.7 + h, true, roof);
    model.box(vent, x, 14.1 + h, z, w * .48, .85, d * .48);
  }
  for (const [x, z, rows, cols] of [[-213, -42, 5, 12], [-163, -40, 3, 9], [-99, -37, 5, 6], [-81, -48, 4, 5]]) {
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      model.box(solar, x + col * 3.45, 14.2, z + row * 3.8, 3.18, .14, 2.85);
    }
  }

  // Front motor court and the smaller conservatory cupolas on the Harborwalk.
  for (const [x, z, radius, top] of [[-74, 42, 14.2, 8.5], [-95, -13, 7, 13.6], [-179, -17, 6.5, 13.6], [56, 111, 7, 13.6]]) {
    const sides = 16;
    const outline: Point2[] = Array.from({ length: sides }, (_, i) => {
      const a = i * Math.PI * 2 / sides;
      return [x + radius * Math.cos(a), z + radius * Math.sin(a)];
    });
    model.prism(cream, outline, top - .95, top, true);
    model.append(coping, new THREE.SphereGeometry(radius * .86, sides, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .44, 1).translate(x, top, z), true);
    for (const [px, pz] of outline.filter((_, i) => i % 2 === 0)) {
      const bottom = top > 10 ? 7.2 : -1;
      model.box(stone, px, (top + bottom) / 2, pz, .7, top - bottom, .7, true);
    }
  }

  const glassTop = GLASS_BOTTOM + LEVELS * STOREY;
  for (const river of [false, true]) {
    for (let i = 0; i < SEGMENTS; i++) {
      const t0 = i / SEGMENTS, t1 = (i + 1) / SEGMENTS;
      const [a, b, u0, u1] = river ? [curve(t1, river), curve(t0, river), t1, t0] :
        [curve(t0, river), curve(t1, river), t0, t1];
      model.quad(bronze, [b[0], GLASS_BOTTOM, b[1]], [a[0], GLASS_BOTTOM, a[1]],
        [a[0], glassTop, a[1]], [b[0], glassTop, b[1]], true, [[u1, 0], [u0, 0], [u0, 1], [u1, 1]]);
      model.wall(crown, a, b, glassTop, CROWN, true);
      model.wall(crown, a, b, 13.65, GLASS_BOTTOM, true);
      const aa = curve(u0, river, .24), bb = curve(u1, river, .24);
      for (let floor = 0; floor <= LEVELS; floor++) {
        const y = GLASS_BOTTOM + floor * STOREY;
        model.wall(bands, aa, bb, y - .12, y + .12);
      }
    }
    const signCenter = river ? .23 : .77, direction = river ? 1 : -1;
    for (let i = 0; i < 12; i++) {
      const u = i / 12, v = (i + 1) / 12;
      const a = curve(signCenter + direction * .27 * (u - .5), river, .29);
      const b = curve(signCenter + direction * .27 * (v - .5), river, .29);
      model.quad(name, [a[0], 91.5, a[1]], [b[0], 91.5, b[1]],
        [b[0], 97.35, b[1]], [a[0], 97.35, a[1]], false, [[u, 0], [v, 0], [v, 1], [u, 1]]);
    }
  }
  const front = Array.from({ length: SEGMENTS + 1 }, (_, i) => curve(i / SEGMENTS, false));
  const back = Array.from({ length: SEGMENTS + 1 }, (_, i) => curve(1 - i / SEGMENTS, true));
  const outline = [...front, ...back];
  model.wall(crown, front.at(-1)!, back[0], 13.65, CROWN, true);
  model.wall(crown, back.at(-1)!, front[0], 13.65, CROWN, true);
  for (const t of [0, 1]) {
    const [x, z] = curve(t, true, .24);
    model.box(bands, x, (GLASS_BOTTOM + glassTop) / 2, z, .34, glassTop - GLASS_BOTTOM, .66);
  }
  model.cap(roof, outline, CROWN - 2.2, true, true);
  for (let i = 0; i < 9; i++) {
    const [x, z] = curve(.11 + .087 * i, false, -7);
    model.box(i % 2 ? vent : cream, x, CROWN - 1.52, z, 4.5, 1.35, 3.4, true);
  }

  return {
    ...model.build(),
    setReflection(environment: THREE.Texture) { bronze.envMap = crown.envMap = environment; },
    setLighting(night: boolean) {
      bronze.emissiveMap = night ? nightGlow : dayGlow;
      bronze.emissive.set(night ? '#ffffff' : '#ffae69');
      bronze.emissiveIntensity = night ? .58 : .025;
      crown.emissiveIntensity = night ? .56 : 0;
      bands.emissive.set(night ? '#ffe6c7' : '#ffc573');
      bands.emissiveIntensity = night ? 1.16 : .11;
      name.color.setScalar(night ? 2.25 : 1);
    },
  };
}
