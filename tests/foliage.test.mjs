import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createTreeField, treeLodBands, updateFoliage } from '../src/render/foliage.ts';

/** Tree assets paint their leaf textures on a canvas: a stand-in context is enough for geometry and pools. */
function withCanvas(run) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const context = Object.fromEntries(['save', 'restore', 'translate', 'rotate', 'beginPath', 'lineTo', 'moveTo', 'ellipse', 'fill', 'stroke'].map(name => [name, () => {}]));
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try { return run(); } finally { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; }
}
/** A leaf geometry's cards: four corners each, with the fade tag and centre they share. */
function cards(geometry) {
  const p = geometry.getAttribute('position'), centre = geometry.getAttribute('cardCentre'), fade = geometry.getAttribute('cardFade'), list = [];
  assert.equal(p.count % 4, 0);
  for (let i = 0; i < p.count; i += 4) {
    const corners = [0, 1, 2, 3].map(k => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]);
    for (let k = 1; k < 4; k++) { assert.equal(fade.getX(i + k), fade.getX(i), 'one tag a card'); assert.deepEqual([centre.getX(i + k), centre.getY(i + k), centre.getZ(i + k)], [centre.getX(i), centre.getY(i), centre.getZ(i)]); }
    list.push({ corners, centre: [centre.getX(i), centre.getY(i), centre.getZ(i)], fade: fade.getX(i) });
  }
  return list;
}
/** What the vertex shader does to a card at `blend` of its level's transition: scaled about its centre by the root of its share of the area. */
const drawn = (card, blend) => { const s = Math.sqrt(card.fade > 0 ? 1 - blend : card.fade < 0 ? blend : 1); return card.corners.map(corner => corner.map((v, k) => card.centre[k] + (v - card.centre[k]) * s)); };
const area = corners => { const [a, b, c] = corners.map(v => new THREE.Vector3(...v)); return b.clone().sub(a).cross(c.clone().sub(a)).length(); };
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

test('each detail level carries the next level\'s leaf cards, so the pools show the same tree where one hands over to the other', () => withCanvas(() => {
  const field = createTreeField({ grates: false }), leaves = name => field.group.children.find(m => m.name === name).geometry;
  for (const species of field.group.userData.species) {
    const levels = [0, 1, 2].map(lod => cards(leaves(`${species} foliage LOD${lod}`)));
    assert.deepEqual(levels.map(level => level.filter(c => c.fade >= 0).length), [48, 24, 12], `${species}: each level's own cards`);
    assert.deepEqual(levels.map(level => level.filter(c => c.fade < 0).length), [24, 12, 0], `${species}: and the next level's`);
    assert.deepEqual(levels.map(level => [...new Set(level.map(c => c.fade))].sort((a, b) => a - b)), [[-1, 1], [-2, 2], [0]]);
    for (const lod of [0, 1]) {
      const incoming = levels[lod].filter(c => c.fade < 0), next = levels[lod + 1].filter(c => c.fade >= 0);
      assert.deepEqual(incoming.map(c => c.corners), next.map(c => c.corners), `${species}: level ${lod} ends as level ${lod + 1} begins, card for card`);
      // At the end of its blend the nearer pool draws exactly what the farther pool draws before its own blend starts.
      const atEnd = levels[lod].map(c => drawn(c, 1)), beyond = levels[lod + 1].map(c => drawn(c, 0));
      assert.ok(atEnd.filter((_, i) => levels[lod][i].fade > 0).every(corners => area(corners) === 0), 'its own cards have closed to nothing');
      assert.deepEqual(atEnd.filter((_, i) => levels[lod][i].fade < 0), beyond.filter((_, i) => levels[lod + 1][i].fade >= 0));
      assert.ok(beyond.filter((_, i) => levels[lod + 1][i].fade < 0).every(corners => area(corners) === 0), 'and the level after next has not begun');
      // Before the blend the level is what it always was: its own cards whole, nothing of the next.
      const before = levels[lod].map(c => drawn(c, 0));
      assert.deepEqual(before.filter((_, i) => levels[lod][i].fade > 0), levels[lod].filter(c => c.fade > 0).map(c => c.corners));
      // Half way, each card set holds half its area: the crown keeps its cover instead of thinning.
      for (const share of [.25, .5, .8]) {
        const own = levels[lod].filter(c => c.fade > 0), total = list => list.reduce((sum, c) => sum + area(c.corners), 0), scaled = (list, blend) => list.reduce((sum, c) => sum + area(drawn(c, blend)), 0);
        assert.ok(Math.abs(scaled(own, share) / total(own) - (1 - share)) < 1e-6 && Math.abs(scaled(incoming, share) / total(incoming) - share) < 1e-6);
      }
    }
  }
}));

test('the blend ends before a tree changes pool, by more than the observer can travel between two sortings', () => withCanvas(() => {
  for (const [high, near, mid] of [[true, 100, 320], [false, 60, 210]]) {
    const [start0, end0, start1, end1] = treeLodBands(high);
    assert.ok(0 < start0 && start0 < end0 && end0 < start1 && start1 < end1, 'two separate stretches, nearest first');
    assert.equal(end0, near - 15); assert.equal(end1, mid - 15);
    // Pools are sorted every quarter second or 25 m: a helicopter at 54 m/s covers 13.5 m in between, a car less.
    for (const travelled of [0, 7, 13.5, 15]) { assert.equal(smoothstep(start0, end0, near - travelled), 1); assert.equal(smoothstep(start1, end1, mid - travelled), 1); }
    // The sorting itself is by those distances: a tree just inside a level's edge is in that level's pool.
    const scene = new THREE.Scene(), field = createTreeField({ grates: false }), observer = new THREE.Vector3(0, 0, 0);
    scene.add(field.group);
    field.add('fixture', [near - 1, near + 1, mid - 1, mid + 1].map(x => new THREE.Vector3(x, 0, 0)));
    updateFoliage(scene, observer, 0, high, false);
    const count = lod => field.group.children.filter(m => m.name.endsWith(`foliage LOD${lod}`)).reduce((n, m) => n + m.count, 0);
    assert.deepEqual([count(0), count(1), count(2)], [1, 2, 1], `${high ? 'Detailed' : 'Balanced'}: one tree inside ${near} m, two inside ${mid} m, one beyond`);
  }
}));

test('leaf materials blend by the observer\'s distance in the view and in the shadow pass alike; bark is left alone', () => withCanvas(() => {
  const scene = new THREE.Scene(), field = createTreeField({ grates: false }); scene.add(field.group);
  const leaf = field.group.children.find(m => m.name.endsWith('foliage LOD1')), wood = field.group.children.find(m => m.name.endsWith('branches LOD1'));
  const compile = material => { const shader = { uniforms: {}, vertexShader: '#include <begin_vertex>' }; material.onBeforeCompile(shader); return shader; };
  updateFoliage(scene, new THREE.Vector3(12, 160, -40), 3, true, true);
  for (const material of [leaf.material, leaf.customDepthMaterial]) {
    const shader = compile(material);
    assert.match(shader.vertexShader, /attribute float cardFade/); assert.match(shader.vertexShader, /distance\(treeObserver/);
    assert.deepEqual(shader.uniforms.treeObserver.value.toArray(), [12, 160, -40], 'the observer, not the pass\'s own camera');
    assert.deepEqual(shader.uniforms.treeLod.value.toArray(), treeLodBands(true));
    assert.ok(shader.vertexShader.indexOf('cardFade>0.') < shader.vertexShader.indexOf('windPhase='), 'cards are sized before the wind moves them');
  }
  assert.doesNotMatch(compile(wood.material).vertexShader, /cardFade/);
  updateFoliage(scene, new THREE.Vector3(), 4, false, false);
  assert.deepEqual(compile(leaf.material).uniforms.treeLod.value.toArray(), treeLodBands(false), 'Balanced blends over its own, shorter stretches');
  assert.notEqual(leaf.material.customProgramCacheKey(), wood.material.customProgramCacheKey());
}));
