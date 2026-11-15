import * as THREE from 'three';
import type { CityData, Point2 } from '../types';
import { trailEdges } from '../simulation/fells-trails.ts';
import { canvasTexture, seeded } from './materials.ts';
import { drapedStripInto } from './terrain-ground.ts';
import type { TriangleSink } from './geometry-writer.ts';

let maps: { leaves: THREE.Texture; relief: THREE.Texture; soil: THREE.Texture } | undefined;

function forestMaps() {
  if (maps) return maps;
  const color = document.createElement('canvas'), height = document.createElement('canvas'), soil = document.createElement('canvas');
  color.width = color.height = height.width = height.height = 512;
  soil.width = soil.height = 256;
  const c = color.getContext('2d')!, h = height.getContext('2d')!, s = soil.getContext('2d')!, random = seeded(819247);
  c.fillStyle = '#514337'; c.fillRect(0, 0, 512, 512);
  h.fillStyle = '#666666'; h.fillRect(0, 0, 512, 512);
  s.fillStyle = '#8a7960'; s.fillRect(0, 0, 256, 256);
  const leaves = ['#796043', '#92754e', '#63503b', '#a18a60', '#584c38', '#77664c', '#a18c6b'];
  for (let i = 0; i < 5200; i++) {
    const x = random() * 512, y = random() * 512, length = 2 + random() * 8, w = length * (.35 + random() * .3), angle = random() * Math.PI * 2;
    const tint = leaves[Math.floor(random() * leaves.length)], gray = 90 + Math.floor(random() * 95);
    // Wrap the drawing too, so the tiled leaf bed has no seams.
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      if (x + ox < -12 || x + ox > 524 || y + oy < -12 || y + oy > 524) continue;
      for (const ctx of [c, h]) {
        ctx.save(); ctx.translate(x + ox, y + oy); ctx.rotate(angle);
        ctx.fillStyle = ctx === c ? tint : `rgb(${gray},${gray},${gray})`;
        ctx.beginPath(); ctx.moveTo(-length, 0); ctx.lineTo(-length * .35, -w * .5); ctx.lineTo(-length * .1, -w);
        ctx.lineTo(length * .4, -w * .55); ctx.lineTo(length, 0); ctx.lineTo(length * .4, w * .6);
        ctx.lineTo(-length * .1, w); ctx.lineTo(-length * .35, w * .5); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ctx === c ? '#44392c' : '#666666'; ctx.lineWidth = .55;
        ctx.beginPath(); ctx.moveTo(-length, 0); ctx.lineTo(length * .7, 0); ctx.stroke(); ctx.restore();
      }
    }
  }
  for (let i = 0; i < 15000; i++) {
    const x = random() * 256, y = random() * 256, v = 33 + random() * 26;
    s.fillStyle = `hsl(${31 + random() * 9},${13 + random() * 13}%,${v}%)`;
    s.fillRect(x, y, .4 + random() * 1.7, .4 + random() * 1.4);
  }
  for (let i = 0; i < 210; i++) {
    const x = random() * 256, y = random() * 256;
    s.fillStyle = ['#aaa28d', '#69675c', '#887c68'][i % 3];
    s.beginPath(); s.ellipse(x, y, .6 + random() * 1.8, .5 + random() * 1.2, random() * Math.PI, 0, Math.PI * 2); s.fill();
  }
  maps = { leaves: canvasTexture(color, true), relief: canvasTexture(height, true), soil: canvasTexture(soil, true) };
  maps.relief.colorSpace = THREE.NoColorSpace;
  return maps;
}

/** Original leaf litter/soil textures shared by all streamed Fells tiles. */
export function createFellsGroundMaterial(trail = false) {
  const textures = forestMaps();
  const material = new THREE.MeshStandardMaterial({ map: textures.leaves, bumpMap: textures.relief, bumpScale: trail ? .012 : .055, roughness: 1 });
  material.name = trail ? 'Compacted earth with leaf-strewn edges' : 'Dry oak leaves and forest humus';
  material.onBeforeCompile = shader => {
    shader.uniforms.fellsSoil = { value: textures.soil };
    shader.vertexShader = 'varying vec2 fellsWorld;\nvarying float fellsAcross;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      fellsWorld=(modelMatrix*vec4(position,1.)).xz;
      fellsAcross=uv.x;
      vMapUv=fellsWorld*.25;
      vBumpMapUv=fellsWorld*.25;`);
    shader.fragmentShader = 'varying vec2 fellsWorld;\nvarying float fellsAcross;\nuniform sampler2D fellsSoil;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float broad=sin(fellsWorld.x*.053+sin(fellsWorld.y*.067))*cos(fellsWorld.y*.071);
      ${trail ? `float edge=min(fellsAcross,1.-fellsAcross);
      float scatter=.025*sin(fellsWorld.x*18.+fellsWorld.y*9.)+.035*sin(fellsWorld.y*23.-fellsWorld.x*11.);
      float tread=smoothstep(.025,.19,edge+scatter);
      diffuseColor.rgb=mix(diffuseColor.rgb,texture2D(fellsSoil,fellsWorld*.5).rgb,tread);` : ''}
      diffuseColor.rgb*=.94+broad*.12;`);
  };
  material.customProgramCacheKey = () => `fells-${trail ? 'soil-trail' : 'leaf-floor'}-1`;
  return material;
}

export function naturalTrailInto(sink: TriangleSink, city: CityData, points: Point2[], width: number) {
  const { left, right } = trailEdges(points, width);
  // Smooth normals over the entire ribbon. Across UV stays 0..1 for the
  // soil/leaf transition; the color and bump maps use world coordinates.
  drapedStripInto(sink, city, left, right, .052, undefined, true);
}
