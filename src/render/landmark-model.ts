import * as THREE from 'three';
import type { Point2 } from '../types.ts';
import { canvasTexture, seeded } from './materials.ts';
import { TriangleWriter } from './geometry-writer.ts';

export type Vertex = [number, number, number];
type UV = [number, number];
export const finish = (color: string, roughness = .83, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

export function landmarkTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void, repeat = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d')!);
  return canvasTexture(canvas, repeat);
}

export function lettering(text: string, color: string, font: string, fill = false) {
  const map = landmarkTexture(512, 128, ctx => {
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.translate(256, 66);
    if (fill) {
      ctx.scale(478 / ctx.measureText(text).width, 1);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.strokeText(text, 0, 0, 500);
    }
    ctx.fillText(text, 0, 0, 500);
  });
  return new THREE.MeshBasicMaterial({ map, alphaTest: .45 });
}

/** Small tileable material studies. World-aligned UVs on the wall panels keep
 * board seams, timber grain and form tie marks at a consistent scale. */
export function boardTexture(wood: boolean) {
  const random = seeded(wood ? 6211 : 9182);
  return landmarkTexture(256, 256, ctx => {
    ctx.fillStyle = wood ? '#bd926c' : '#b6b2a7';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2700; i++) {
      ctx.fillStyle = random() < .5 ? 'rgba(20,14,8,.07)' : 'rgba(255,249,233,.13)';
      ctx.fillRect(random() * 256, random() * 256, wood ? 8 + random() * 64 : 1 + random() * 7, 1 + random() * 2);
    }
    for (let y = 0; y < 256; y += wood ? 16 : 64) {
      ctx.fillStyle = wood ? 'rgba(49,29,18,.34)' : 'rgba(35,34,29,.21)';
      ctx.fillRect(0, y, 256, 1);
      if (!wood) {
        ctx.fillRect(30, y + 25, 3, 3);
        ctx.fillRect(157, y + 25, 3, 3);
      }
    }
  }, true);
}

export function rectangle(left: number, right: number, back: number, front: number): Point2[] {
  return [[left, back], [right, back], [right, front], [left, front]];
}

/** Local metres, positive z to the right of the local x axis on a plan.
 * Batch by finish and keep a separate, simpler set of solid surfaces. */
export class LandmarkModel {
  readonly group = new THREE.Group();
  private readonly batches = new Map<THREE.Material, TriangleWriter>();
  private readonly solid = new TriangleWriter();
  private readonly placement = new THREE.Matrix4();
  private readonly part = new THREE.Matrix4();
  private readonly offset = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly unit = new THREE.Vector3(1, 1, 1);

  constructor(name: string, id: string, x: number, y: number, z: number, heading: number) {
    this.group.name = name;
    this.group.userData.buildingId = id;
    this.placement.makeRotationY(-heading).setPosition(x, y, z);
  }

  private batch(material: THREE.Material) {
    let writer = this.batches.get(material);
    if (!writer) { writer = new TriangleWriter(); this.batches.set(material, writer); }
    return writer;
  }

  box(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, solid = false, yaw = 0) {
    this.part.compose(this.offset.set(x, y, z), this.rotation.setFromAxisAngle(this.up, yaw), this.unit).premultiply(this.placement);
    this.batch(material).box({ w, h, d }, this.part);
    if (solid) this.solid.box({ w, h, d }, this.part);
  }

  append(material: THREE.Material, geometry: THREE.BufferGeometry, solid = false) {
    this.batch(material).append(geometry, this.placement);
    if (solid) this.solid.append(geometry, this.placement);
    geometry.dispose();
  }

  private triangle(material: THREE.Material, points: [Vertex, Vertex, Vertex], uv: [UV, UV, UV], solid: boolean) {
    const [a, b, c] = points.map(p => new THREE.Vector3(...p).applyMatrix4(this.placement));
    const [ta, tb, tc] = uv;
    this.batch(material).triangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, ...ta, ...tb, ...tc);
    if (solid) this.solid.triangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  quad(material: THREE.Material, a: Vertex, b: Vertex, c: Vertex, d: Vertex, solid = false,
    uv: [UV, UV, UV, UV] = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    this.triangle(material, [a, b, c], [uv[0], uv[1], uv[2]], solid);
    this.triangle(material, [a, c, d], [uv[0], uv[2], uv[3]], solid);
  }

  wall(material: THREE.Material, a: Point2, b: Point2, low: number, high: number, solid = false) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.quad(material, [b[0], low, b[1]], [a[0], low, a[1]], [a[0], high, a[1]], [b[0], high, b[1]], solid,
      [[0, low / 4], [length / 4, low / 4], [length / 4, high / 4], [0, high / 4]]);
  }

  cap(material: THREE.Material, outline: Point2[], y: number, up = true, solid = false) {
    const ring = outline.map(p => new THREE.Vector2(...p));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(ring, [])) {
      const a = outline[i], b = outline[j], c = outline[k];
      const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      const order = up === ccw ? [a, c, b] : [a, b, c];
      this.triangle(material, order.map(([x, z]) => [x, y, z]) as [Vertex, Vertex, Vertex],
        order.map(([x, z]) => [x / 4, z / 4]) as [UV, UV, UV], solid);
    }
  }

  /** Outline winds counterclockwise in the x/z plane, viewed as a 2D plot. */
  prism(material: THREE.Material, outline: Point2[], low: number, high: number, solid = false, roof = material) {
    for (let i = 0; i < outline.length; i++) this.wall(material, outline[i], outline[(i + 1) % outline.length], low, high, solid);
    this.cap(roof, outline, high, true, solid);
    this.cap(material, outline, low, false, solid);
  }

  build() {
    let triangles = 0;
    for (const [material, writer] of this.batches) {
      const mesh = new THREE.Mesh(writer.geometry(), material);
      mesh.name = this.group.name;
      mesh.castShadow = mesh.receiveShadow = !(material instanceof THREE.MeshBasicMaterial);
      triangles += writer.count / 3;
      this.group.add(mesh);
    }
    this.group.userData.triangles = triangles;
    return {
      group: this.group,
      collision: {
        id: this.group.userData.buildingId as string,
        vertices: this.solid.position.slice(0, this.solid.count * 3),
        indices: Uint32Array.from({ length: this.solid.count }, (_, i) => i),
      },
    };
  }
}
