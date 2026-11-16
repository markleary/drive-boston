import * as THREE from 'three';
import { finish, LandmarkModel, landmarkTexture, type Vertex } from './landmark-model.ts';

// Original rooftop marker: OSM node 7599402961 (42.34928, -71.09626),
// projected with the same EPSG:2249 origin as the city. The owner specifies
// a 120-foot eastward move and 30-foot rise for the 2026 restoration.
export const CITGO = {
  original: [-1766.321, 102.158] as [number, number],
  position: [-1729.745, 102.158] as [number, number],
  width: 18.288, height: 18.288, bottom: 47.743, frameBase: 33.935,
  normal: [.936, -.352] as [number, number],
};

/** The historic 28-second program, with the blue lettering always lit.
 * Drives the shader's white-row/triangle thresholds and final flashes. */
export function citgoSequence(seconds: number) {
  const t = ((seconds % 28) + 28) % 28;
  return { white: t < 4 ? 1 : t < 9 ? 1 - (t - 4) / 5 : t < 14 ? (t - 9) / 5 : 1,
    triangle: t < 14 ? 1 : t < 19 ? 1 - (t - 14) / 5 : t < 24 ? (t - 19) / 5 : 1,
    flash: t >= 24 && (t < 24.65 || t >= 25.3 && t < 25.95), letters: true };
}

// The front of the surveyed roof is oblique to the sign. Its southern upright
// cantilevers from an inset foot, rather than extending down beyond the facade.
export const citgoSupportX = (x: number, y: number) => x < 0 ? x + 3.5 * Math.max(0, 1 - (y - CITGO.frameBase) / 6.9) : x;

// Roof terraces beneath the three pairs of legs, sampled from the detailed
// BOS-HNZB1-9VG44-I6AIK mesh in tile -2_0. The building's maximum height is
// the upper frame datum, not the roof beneath these feet. Tests raycast the
// packaged mesh so a survey change cannot silently leave the frame floating.
export const CITGO_SUPPORT_COLUMNS = [
  { x: -6.3, roof: 25.395 },
  { x: 0, roof: 29.365 },
  { x: 6.3, roof: 29.665 },
];

function faceTexture(mobile: boolean) {
  const size = mobile ? 512 : 1024;
  return landmarkTexture(size, size, ctx => {
    ctx.scale(size / 1024, size / 1024);
    ctx.fillStyle = '#f4f0df'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.strokeStyle = '#cbcbbd'; ctx.lineWidth = 1.1;
    for (let y = 17; y < 1010; y += 25.4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
    const top = [512, 45], left = [98, 738], right = [926, 738], center = [512, 507];
    for (const [a, b, color] of [[top, left, '#e95627'], [right, top, '#d92635'], [left, right, '#e94038']] as [number[], number[], string][]) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(...a as [number, number]); ctx.lineTo(...b as [number, number]); ctx.lineTo(...center as [number, number]); ctx.closePath(); ctx.fill();
    }
    // Concentric tubing preserves the orange/red/red facets even in daylight.
    for (let ring = 0; ring < 18; ring++) {
      const scale = 1 - ring / 18, point = (p: number[]) => [center[0] + (p[0] - center[0]) * scale, center[1] + (p[1] - center[1]) * scale];
      const a = point(top), b = point(left), c = point(right);
      for (const [from, to, dark, bright] of [[a, b, '#9b2d18', '#ff9b4c'], [b, c, '#9c2228', '#ff7573'], [c, a, '#9b182d', '#ff465b']] as [number[], number[], string, string][]) {
        ctx.beginPath(); ctx.moveTo(...from as [number, number]); ctx.lineTo(...to as [number, number]); ctx.lineWidth = 7; ctx.strokeStyle = dark; ctx.stroke(); ctx.lineWidth = 3.5; ctx.strokeStyle = bright; ctx.stroke();
      }
    }
    ctx.save(); ctx.translate(512, 925); ctx.font = 'bold 190px Arial'; ctx.textAlign = 'center';
    ctx.scale(808 / ctx.measureText('CITGO').width, 1); ctx.fillStyle = '#086793'; ctx.fillText('CITGO', 0, 0);
    ctx.strokeStyle = '#2a9cba'; ctx.lineWidth = 2.2; ctx.strokeText('CITGO', 0, 0); ctx.restore();
    ctx.strokeStyle = '#d8dbd3'; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(9, 9, 1006, 1006, 57); ctx.stroke();
  });
}

export function buildCitgoSign(mobile = false) {
  const heading = -Math.atan2(CITGO.normal[0], CITGO.normal[1]);
  const model = new LandmarkModel('CITGO sign · Kenmore Square', 'citgo-sign-restored', CITGO.position[0], 0, CITGO.position[1], heading);
  const steel = finish('#505957', .56, .55), rim = finish('#434a49', .4, .6);
  const map = faceTexture(mobile), face = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#fff', emissiveIntensity: 0, roughness: .56 });
  const phase = { value: new THREE.Vector3(1, 1, 0) };
  face.onBeforeCompile = shader => {
    shader.uniforms.citgoPhase = phase;
    shader.fragmentShader = 'uniform vec3 citgoPhase;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      // Atlas coordinates, bottom-up. Triangle barycentrics identify each
      // nested tube without per-frame canvas uploads or dozens of materials.
      vec2 p = vEmissiveMapUv;
      float apex = (p.y - 0.279296875) / 0.6767578125;
      float right = (p.x - 0.095703125 - apex * 0.404296875) / 0.80859375;
      float left = 1.0 - apex - right;
      float edge = min(apex, min(left, right));
      bool logo = edge >= 0.0;
      bool letters = p.y < 0.255 && p.y > 0.068 && texture2D(emissiveMap, p).b > texture2D(emissiveMap, p).r * 1.4;
      bool border = p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98;
      float lit = 1.0;
      if (!letters) {
        if (citgoPhase.z > 0.5) lit = 0.0;
        else if (logo) {
          float radius = 1.0 - edge * 3.0;
          lit = 1.0 - smoothstep(citgoPhase.y - 0.025, citgoPhase.y + 0.025, radius);
        } else if (!border) {
          float row = floor(p.y * 39.0) / 39.0;
          lit = step(1.0 - citgoPhase.x, row);
        }
      }
      // Keep saturated tubes instead of overexposing the painted artwork to
      // pastel pink/white in the game's tone mapper.
      vec3 tubes = letters ? vec3(0.002, 0.08, 0.65) :
        right < min(left, apex) ? vec3(0.95, 0.075, 0.001) :
        apex < left ? vec3(0.95, 0.012, 0.008) : vec3(0.9, 0.001, 0.012);
      if (logo || letters) totalEmissiveRadiance = tubes * emissive.r * lit;
      else totalEmissiveRadiance *= lit * 0.85;
    `);
  };
  face.customProgramCacheKey = () => 'citgo-tubes-v1';
  const middle = CITGO.bottom + CITGO.height / 2, half = CITGO.width / 2;
  const rounded = new THREE.Shape(); rounded.moveTo(-half + 1, -half); rounded.lineTo(half - 1, -half); rounded.quadraticCurveTo(half, -half, half, -half + 1); rounded.lineTo(half, half - 1); rounded.quadraticCurveTo(half, half, half - 1, half); rounded.lineTo(-half + 1, half); rounded.quadraticCurveTo(-half, half, -half, half - 1); rounded.lineTo(-half, -half + 1); rounded.quadraticCurveTo(-half, -half, -half + 1, -half);
  const caseGeometry = new THREE.ExtrudeGeometry(rounded, { depth: 1.35, bevelEnabled: false, curveSegments: 8 }); caseGeometry.translate(0, middle, -.675); model.append(rim, caseGeometry, true);
  for (const side of [-1, 1]) {
    const geometry = new THREE.ShapeGeometry(rounded, 8), p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + half) / CITGO.width, (p.getY(i) + half) / CITGO.height);
    // The shallow three-facet pyramid projects out of both faces. Remove the
    // flat triangle behind it through depth occlusion; both share the atlas.
    geometry.rotateY(side < 0 ? Math.PI : 0); geometry.translate(0, middle, side * .69); model.append(face, geometry);
    const a: Vertex = [0, middle + 8.34, side * .70], b: Vertex = [-7.394, middle - 4.036, side * .70], c: Vertex = [7.394, middle - 4.036, side * .70], d: Vertex = [0, middle + .089, side * 1.28];
    for (const [v1, v2] of [[a, b], [b, c], [c, a]]) {
      const g = new THREE.BufferGeometry(), points = side > 0 ? [v1, v2, d] : [v2, v1, d];
      // Back-face texture is read from its own viewer's right.
      g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(points.flatMap(p => [(side * p[0] + half) / CITGO.width, (p[1] - middle + half) / CITGO.height]), 2)); g.computeVertexNormals(); model.append(face, g);
    }
  }
  const strut = (a: Vertex, b: Vertex, thickness = .16) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const g = new THREE.BoxGeometry(thickness, direction.length(), thickness);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())); g.translate(...start.add(end).multiplyScalar(.5).toArray()); model.append(steel, g);
  };
  for (const z of [-1.55, 1.55]) {
    for (const { x, roof } of CITGO_SUPPORT_COLUMNS) {
      const footX = citgoSupportX(x, CITGO.frameBase);
      // Embed the leg and base plate slightly into the terrace to avoid a
      // visible seam from survey quantization or grazing camera angles.
      strut([footX, roof - .12, z], [footX, CITGO.frameBase, z], .23);
      model.box(steel, footX, roof + .05, z, .8, .18, .8);
      strut([footX, CITGO.frameBase, z], [x, CITGO.frameBase + 6.9, z], .23);
      strut([x, CITGO.frameBase + 6.9, z], [x, CITGO.bottom + .1, z], .23);
    }
    for (let i = 0; i < CITGO_SUPPORT_COLUMNS.length - 1; i++) {
      const a = CITGO_SUPPORT_COLUMNS[i], b = CITGO_SUPPORT_COLUMNS[i + 1];
      const left = citgoSupportX(a.x, CITGO.frameBase), right = citgoSupportX(b.x, CITGO.frameBase);
      const low = Math.max(a.roof, b.roof) + .3;
      strut([left, low, z], [right, low, z]);
      strut([left, low, z], [right, CITGO.frameBase, z], .12);
      strut([right, low, z], [left, CITGO.frameBase, z], .12);
    }
    for (let y = CITGO.frameBase; y < CITGO.bottom; y += 3.45) {
      strut([citgoSupportX(-6.3, y), y, z], [6.3, y, z]);
      for (const x of [-6.3, 0]) {
        const top = Math.min(y + 3.45, CITGO.bottom);
        strut([citgoSupportX(x, y), y, z], [citgoSupportX(x + 6.3, top), top, z], .12);
        strut([citgoSupportX(x + 6.3, y), y, z], [citgoSupportX(x, top), top, z], .12);
      }
    }
  }
  for (const { x, roof } of CITGO_SUPPORT_COLUMNS) {
    const footX = citgoSupportX(x, CITGO.frameBase);
    for (let y = roof + .3; y < CITGO.frameBase; y += 3.45) {
      const top = Math.min(y + 3.45, CITGO.frameBase);
      strut([footX, y, -1.55], [footX, y, 1.55]);
      strut([footX, y, -1.55], [footX, top, 1.55], .12);
      strut([footX, y, 1.55], [footX, top, -1.55], .12);
    }
    strut([footX, CITGO.frameBase, -1.55], [footX, CITGO.frameBase, 1.55]);
  }
  for (const y of [CITGO.frameBase + 6.9, CITGO.bottom - .45]) {
    model.box(steel, 0, y, 0, 14.2, .15, 4.1);
    for (const z of [-2, 2]) { strut([-7, y + 1, z], [7, y + 1, z], .07); for (let x = -7; x <= 7; x += 1.4) strut([x, y, z], [x, y + 1, z], .07); }
  }
  // A ladder and the slender maintenance rail above the rounded cabinet.
  const ladderRoof = CITGO_SUPPORT_COLUMNS[2].roof;
  for (const x of [5.6, 6.2]) strut([x, ladderRoof - .12, 1.8], [x, CITGO.bottom, 1.8], .065);
  for (let y = ladderRoof + .3; y < CITGO.bottom; y += .35) strut([5.6, y, 1.8], [6.2, y, 1.8], .045);
  strut([-8.9, CITGO.bottom + CITGO.height + .3, 0], [8.9, CITGO.bottom + CITGO.height + .3, 0], .1);
  const result = model.build();
  Object.assign(result.group.userData, { ...CITGO, faces: 2, night: false, sequenceSeconds: 28, restoration: '2026' });
  return { ...result, setLighting(night: boolean) { face.emissiveIntensity = night ? 1.8 : 0; result.group.userData.night = night; },
    update(time: number) { const next = citgoSequence(time); phase.value.set(next.white, next.triangle, next.flash ? 1 : 0); } };
}
