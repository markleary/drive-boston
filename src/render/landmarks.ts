import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData } from '../types';
import { landmarkBuildings } from '../simulation/city-tiles.ts';

/** Original architectural detailing placed on measured Boston model surfaces.
 * Positions below are taken from the compiled mesh footprint/front-wall planes.
 * These embellishments are interpretive—not photographic or measured facade scans.
 */
export function addLandmarkDetails(scene: THREE.Scene, city: CityData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Back Bay landmark architecture';
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const stone = new THREE.MeshStandardMaterial({ color: '#c7b28c', roughness: .87 });
  const paleStone = new THREE.MeshStandardMaterial({ color: '#d3c7ac', roughness: .86 });
  const sandstone = new THREE.MeshStandardMaterial({ color: '#a16c50', roughness: .93 });
  const sandstoneLight = new THREE.MeshStandardMaterial({ color: '#d0af85', roughness: .9 });
  const bronze = new THREE.MeshStandardMaterial({ color: '#494b42', metalness: .45, roughness: .53 });
  const glass = new THREE.MeshStandardMaterial({ color: '#283c3d', roughness: .24, metalness: .35, emissive: '#9e7843', emissiveIntensity: .16 });
  const dark = new THREE.MeshStandardMaterial({ color: '#292329', roughness: .85 });
  const mullion = new THREE.MeshStandardMaterial({ color: '#759aab', metalness: .65, roughness: .36 });
  const stained = new THREE.MeshStandardMaterial({ color: '#683e65', emissive: '#813862', emissiveIntensity: .33, roughness: .3, metalness: .1 });
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  let baseElevation=0;

  function add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rotation = 0, rz = 0) {
    q.setFromEuler(new THREE.Euler(0, rotation, rz));
    matrix.compose(pos.set(x, y+baseElevation, z), q, one);
    geometry.applyMatrix4(matrix);
    const list = batches.get(material) ?? [];
    list.push(geometry); batches.set(material, list);
  }
  function facade(cx: number, cz: number, nx: number, nz: number) {
    const angle = Math.atan2(nx, nz);
    return (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, depth = .2, rz = 0) => {
      add(geometry, material, cx + Math.cos(angle) * x + nx * depth, y, cz - Math.sin(angle) * x + nz * depth, angle, rz);
    };
  }
  function opening(width: number, spring: number) {
    const r = width / 2;
    const s = new THREE.Shape();
    s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, spring);
    s.absarc(0, spring, r, 0, Math.PI, false); s.lineTo(-r, 0);
    return new THREE.ShapeGeometry(s, 12);
  }
  function arch(draw: ReturnType<typeof facade>, x: number, bottom: number, width: number, spring: number, trim: THREE.Material, face: THREE.Material, depth = .24) {
    draw(opening(width, spring), face, x, bottom, depth);
    // Individual wedge-shaped stones produce flat masonry faces and mortar
    // joints, instead of the rounded pipe silhouette of a torus arch.
    const inner=width/2,outer=inner+.34,stones=13;
    for(let i=0;i<stones;i++){
      const start=i*Math.PI/stones+.007,end=(i+1)*Math.PI/stones-.007;
      const shape=new THREE.Shape();
      shape.moveTo(Math.cos(start)*inner,Math.sin(start)*inner);
      shape.lineTo(Math.cos(start)*outer,Math.sin(start)*outer);
      shape.absarc(0,0,outer,start,end,false);
      shape.lineTo(Math.cos(end)*inner,Math.sin(end)*inner);
      shape.absarc(0,0,inner,end,start,true);
      const stoneGeometry=new THREE.ExtrudeGeometry(shape,{depth:.3,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.018,bevelThickness:.018,curveSegments:2});
      stoneGeometry.translate(0,0,-.15);
      draw(stoneGeometry,trim,x,bottom+spring,depth+.18);
    }
    for (const s of [-1, 1]) {
      draw(new THREE.BoxGeometry(.32, spring, .35), trim, x + s * (width / 2 + .17), bottom + spring / 2, depth + .12);
      draw(new THREE.BoxGeometry(.51,.18,.51),trim,x+s*(width/2+.17),bottom+spring-.08,depth+.2);
    }
    draw(new THREE.BoxGeometry(width + .7, .22, .6), trim, x, bottom, depth + .23);
  }

  if (city.landmarks.some(l => l.id === 'library')) {
    baseElevation=landmarkBuildings(city).find(b=>b.landmark==='library')?.baseElevation??0;
    // McKim's east facade on Dartmouth: the source wall runs from
    // (-228.929,32.233) to (-204.414,98.186), length 70.36 metres.
    const draw = facade(-216.6715, 65.2095, .9373, -.3484);
    for (const y of [1.1, 8.3, 21.5, 23.3]) draw(new THREE.BoxGeometry(70.0, y > 20 ? .55 : .3, .8), paleStone, 0, y, .28);
    for (let i = -6; i <= 6; i++) {
      const x = i * 5.08;
      arch(draw, x, 10.1, 3.25, 5.9, paleStone, glass);
      draw(new THREE.BoxGeometry(.11, 7.4, .12), bronze, x, 13.8, .45);
      draw(new THREE.BoxGeometry(3.15, .11, .12), bronze, x, 13.6, .45);
      if (Math.abs(i) > 1) {
        draw(new THREE.PlaneGeometry(2.45, 3.65), glass, x, 4.55, .25);
        draw(new THREE.BoxGeometry(2.9, .4, .7), paleStone, x, 6.6, .4);
      }
    }
    for (const x of [-5.1, 0, 5.1]) {
      arch(draw, x, .85, 3.7, 4.45, stone, dark, .32);
      draw(new THREE.BoxGeometry(.13, 4.25, .15), bronze, x, 3.0, .55);
      draw(new THREE.BoxGeometry(3.6, .13, .15), bronze, x, 4.0, .55);
    }
    for (let i = -7; i < 7; i++) {
      draw(new THREE.BoxGeometry(.75, 12.2, .38), paleStone, i * 5.08 + 2.54, 14.75, .35);
    }
    // Three shallow steps stay on the plaza side, clear of the mapped road.
    for (let i = 0; i < 3; i++) draw(new THREE.BoxGeometry(21.5, .17, 1.2 + i * .8), stone, 0, .17 * (3-i), 1.1 + i * .3);
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '48px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#665947';
    ctx.fillText('THE PUBLIC LIBRARY OF THE CITY OF BOSTON', 1024, 48);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const lettering = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    draw(new THREE.PlaneGeometry(58, 2.7), lettering, 0, 22.0, .72);

    // McKim's long Boylston wall is independently measured from its vertical
    // source triangles: (-295.822,57.097) to (-228.929,32.233). The convex
    // footprint is slightly oblique here and would put trim in front of the wall.
    const north=facade(-262.3755,44.665,-.3484,-.9373);
    for(const y of [1.1,8.3,21.5,23.3])north(new THREE.BoxGeometry(70.6,y>20?.55:.3,.72),paleStone,0,y,.25);
    for(let i=-6;i<=6;i++){
      const x=i*5.08;
      arch(north,x,10.1,3.25,5.9,paleStone,glass);
      north(new THREE.BoxGeometry(.11,7.4,.12),bronze,x,13.8,.45);
      north(new THREE.BoxGeometry(3.15,.11,.12),bronze,x,13.6,.45);
      north(new THREE.PlaneGeometry(2.45,3.65),glass,x,4.55,.25);
      for(const side of [-1,1])north(new THREE.BoxGeometry(.18,3.85,.3),paleStone,x+side*1.34,4.55,.37);
      north(new THREE.BoxGeometry(2.98,.32,.58),paleStone,x,6.6,.4);
      north(new THREE.BoxGeometry(2.98,.22,.57),paleStone,x,2.62,.4);
      north(new THREE.BoxGeometry(.09,3.65,.12),bronze,x,4.55,.45);
    }
    for(let i=-7;i<7;i++)north(new THREE.BoxGeometry(.75,12.2,.38),paleStone,i*5.08+2.54,14.75,.35);
    for(let x=-34;x<34;x+=.75)north(new THREE.BoxGeometry(.3,.32,.4),paleStone,x,22.9,.48);
  }

  if (city.landmarks.some(l => l.id === 'trinity')) {
    baseElevation=landmarkBuildings(city).find(b=>b.landmark==='trinity')?.baseElevation??0;
    // West-facing Copley facade: original hull's closing edge, not an arbitrary axis-aligned box.
    const draw = facade(-83.0725, 30.055, -.9380, .3467);
    for (const x of [-10.4, -5.2, 0, 5.2, 10.4]) arch(draw, x, .65, 3.1, 3.5, sandstoneLight, dark, .45);
    // Triangle-plane sampling of the source mesh shows the upper west wall is
    // recessed 5.17m behind the porch. Keep upper decoration on that real wall.
    const upper: ReturnType<typeof facade> = (g, m, x, y, depth = .2, rz = 0) => draw(g, m, x, y, depth - 5.17, rz);
    for (const y of [6.3, 8.4, 11.9, 18.8]) (y > 10 ? upper : draw)(new THREE.BoxGeometry(y > 10 ? 20.5 : 28.3, .24, .42), sandstoneLight, 0, y, .3);
    // West rose window, with stone tracery and colored glass petals.
    upper(new THREE.CircleGeometry(2.95, 40), dark, 0, 14.9, .36);
    upper(new THREE.CircleGeometry(2.55, 40), stained, 0, 14.9, .39);
    upper(new THREE.TorusGeometry(2.8, .23, 6, 40), sandstoneLight, 0, 14.9, .55);
    upper(new THREE.TorusGeometry(.68, .13, 5, 24), sandstoneLight, 0, 14.9, .57);
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5;
      const x = Math.sin(a) * 1.69, y = 14.9 + Math.cos(a) * 1.69;
      upper(new THREE.TorusGeometry(.58, .09, 4, 16), sandstoneLight, x, y, .57);
      upper(new THREE.BoxGeometry(.095, 2.0, .16), sandstoneLight, Math.sin(a) * 1.63, 14.9 + Math.cos(a) * 1.63, .56, -a);
    }
    for (const x of [-8.3, 8.3]) arch(upper, x, 10.7, 1.75, 4.8, sandstone, glass, .36);
    for (const x of [-14.0, 14.0]) {
      draw(new THREE.CylinderGeometry(.48, .54, 6.15, 8), sandstone, x, 3.1, .8);
      draw(new THREE.BoxGeometry(1.35, .42, 1.1), sandstoneLight, x, 6.35, .8);
    }
  }

  if (city.landmarks.some(l => l.id === 'hancock')) {
    baseElevation=landmarkBuildings(city).find(b=>b.landmark==='hancock')?.baseElevation??0;
    // Four outer tower corners sampled from the source mesh above 100m;
    // the low podium footprint is intentionally not used for curtain-wall fins.
    const corners: [number, number][] = [[-73.881,70.866],[-40.221,58.678],[23.882,118.764],[-9.342,131.477]];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i+1)%corners.length];
      const dx=b[0]-a[0], dz=b[1]-a[1], len=Math.hypot(dx,dz);
      const nx=dz/len,nz=-dx/len,angle=Math.atan2(nx,nz);
      const cx=(a[0]+b[0])/2+nx*.12, cz=(a[1]+b[1])/2+nz*.12;
      // Thin framing remains subtle at street distance, leaving glass dominant.
      for (let y=8; y<240; y+=4.05) add(new THREE.BoxGeometry(len,.085,.14),mullion,cx,y,cz,angle);
      const divisions=Math.round(len/3.1);
      for (let j=0;j<=divisions;j++) {
        const t=j/divisions;
        add(new THREE.BoxGeometry(.075,234,.16),mullion,a[0]+dx*t+nx*.14,122,a[1]+dz*t+nz*.14,angle);
      }
    }
  }

  for (const [material, geometries] of batches) {
    const normalized=geometries.map(g=>g.index?g.toNonIndexed():g);
    const geometry = mergeGeometries(normalized, false);
    if (geometry) {
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'Landmark trim'; group.add(mesh);
    }
    new Set([...geometries,...normalized]).forEach(g => g.dispose());
  }
  group.userData.drawCalls=group.children.length;
  group.userData.provenance='Original masonry/tracery detail on measured source facade planes';
  scene.add(group);
  return group;
}
