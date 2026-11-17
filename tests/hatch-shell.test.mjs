import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildHatchShell, HATCH_SHELL_ID, HATCH_SHELL_FIRST, hatchShellWorld, insideHatchShellApron } from '../src/render/hatch-shell.ts';
import { loadMetroCity } from './helpers/metro-city.mjs';

const city = await loadMetroCity({ tiles: ['0_-1'] }), model = buildHatchShell();
const collision = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(model.collision.vertices, 3))
  .setIndex(new THREE.BufferAttribute(model.collision.indices, 1)), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
collision.updateMatrixWorld();
const down = (u, v) => {
  const [x, z] = hatchShellWorld(u, v);
  return new THREE.Raycaster(new THREE.Vector3(x, 2.5, z), new THREE.Vector3(0, -1, 0), 0, 5).intersectObject(collision);
};

test('Hatch Shell replaces exactly its surveyed building at near and far distances', () => {
  const source = city.buildings.find(b => b.id === HATCH_SHELL_ID);
  assert.equal(source.name, 'Hatch Memorial Shell');
  assert.deepEqual(source.footprint[0], HATCH_SHELL_FIRST);
  const hulls = city.far.tiles.get('0_-1').buildings.filter(b => !b.fragment && Math.hypot(b.footprint[0][0] - HATCH_SHELL_FIRST[0], b.footprint[0][1] - HATCH_SHELL_FIRST[1]) < .14);
  assert.equal(hulls.length, 1);
  assert.ok(insideHatchShellApron(...source.center));
  const neighbor = city.buildings.find(b => b.id === 'BOS-OFLH4-VHJQQ-6U2BF');
  assert.equal(insideHatchShellApron(...neighbor.center), false, 'the separate curved building behind the shell is preserved');
  assert.ok(insideHatchShellApron(...hatchShellWorld(0, 50)), 'the audience lawn stays clear');
  assert.equal(insideHatchShellApron(...hatchShellWorld(45, 50)), false, 'perimeter trees stay');
});

test('the concert mouth is open with solid stage, low side steps and a curved back', () => {
  const front = hatchShellWorld(0, 8), back = hatchShellWorld(0, -10);
  const direction = new THREE.Vector3(back[0] - front[0], 0, back[1] - front[1]).normalize();
  const ray = new THREE.Raycaster(new THREE.Vector3(front[0], 3.2, front[1]), direction, 0, 18);
  assert.equal(ray.intersectObject(collision).length, 0, 'no building facade or convex hull spans the opening');
  ray.far = 30;
  assert.ok(ray.intersectObject(collision).length > 0, 'the concave shell encloses the rear of the stage');
  for (const u of [-10, 0, 10]) assert.ok(Math.abs(down(u, 1.5)[0].point.y - 1) < .002);
  let previous = -Infinity;
  for (let v = 7.8; v >= 1.1; v -= .15) {
    const hits = down(15.4, v);
    assert.ok(hits.length, `continuous solid side stair at ${v}`);
    const y = hits[0].point.y;
    assert.ok(y >= previous - .003 && y - previous < .2 || previous === -Infinity, 'walkable risers, no hidden tall wall');
    previous = y;
  }
});

test('shell skins face the audience and sky correctly within a small geometry budget', () => {
  assert.ok(model.group.children.length <= 12);
  assert.ok(model.group.userData.triangles < 16500);
  for (const mesh of model.group.children) {
    for (const attribute of Object.values(mesh.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      const cross = b.sub(a).cross(c.sub(a));
      if (cross.lengthSq() > 1e-9) assert.ok(cross.dot(normal.fromBufferAttribute(n, i)) > 0, `${mesh.material.name}: winding matches lighting normals`);
    }
  }
});
