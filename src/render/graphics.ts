import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPacedUploads, type Upload } from './paced-upload.ts';

export type QualityMode = 'high' | 'balanced';

/** Desktop lighting finish, with an inexpensive mode for integrated/mobile GPUs. */
export function createGraphics(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, initial: QualityMode, mobile = false) {
  // Render straight to the canvas on touch devices: no HDR/MSAA composer,
  // ambient-occlusion buffers, or bloom targets, even if Detailed is selected.
  if (mobile) {
    // Alpha-to-coverage needs MSAA. Without samples, leaf-edge pixels must
    // use the material's alpha-test cutout instead of an opaque fringe. The
    // tree fields keep these shared materials when their instance pools grow.
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material.alphaToCoverage) { material.alphaToCoverage = false; material.needsUpdate = true; }
      }
    });
    let quality = initial;
    const resize = () => { renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); };
    resize();
    return {
      setQuality(mode: QualityMode) { quality = mode; resize(); }, resize,
      render(_dt: number) { renderer.render(scene, camera); },
      // Phones keep their tiles' meshes as built (no static batches to prepare).
      warm(_mesh: THREE.Mesh) { return () => true; }, warmPasses(_root: THREE.Object3D) {}, settlePrograms() { return Promise.resolve(); }, prepare(_root: THREE.Object3D) { return { meshes: 0, textures: 0 }; },
      // and upload each mesh when it is first drawn: their vertex arrays are freed then (upload-release.ts).
      upload: undefined as Upload | undefined,
      get quality() { return quality; },
      dispose() {},
    };
  }
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  // Only the geometry pass needs MSAA/depth. AO composition and bloom operate
  // on already anti-aliased pixels; multisampling those buffers repeats the
  // resolve and attachment bandwidth without improving an edge.
  composer.renderTarget2.samples = 0; composer.renderTarget2.depthBuffer = false;
  const beauty = new RenderPass(scene, camera);
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.blendIntensity = .9;
  ao.updateGtaoMaterial({ radius: 1.5, thickness: 1.2, distanceExponent: 2, distanceFallOff: .7, scale: 1, samples: 12, screenSpaceRadius: false });
  ao.updatePdMaterial({ radius: 5, rings: 2, samples: 8, depthPhi: 2, normalPhi: 3 });
  // The normal override used by GTAO cannot preserve alpha-cutout leaves. Keep
  // their opaque cards out of that buffer while retaining their real shadows.
  // Streamed tiles add and remove such objects; `scene.userData.version` says when to look again.
  let exclusions: THREE.Object3D[] = [], strokes: THREE.Object3D[] = [], version: unknown = Symbol('unscanned');
  const refresh = () => {
    if (scene.userData.version === version) return; version = scene.userData.version; exclusions = []; strokes = [];
    scene.traverse(object => { if (object.userData.noAO) exclusions.push(object); if ((object as THREE.Points).isPoints || (object as THREE.Line).isLine) strokes.push(object); });
  };
  // GTAO keeps points and lines out of its normal buffer by walking the whole
  // scene before that pass, every frame; the list changes only when the scene
  // does, so it is taken in the same scan as the exclusions above.
  const pass = ao as unknown as { _overrideVisibility?: () => void; _restoreVisibility?: () => void };
  if (pass._overrideVisibility && pass._restoreVisibility) {
    let hidden: THREE.Object3D[] = [];
    pass._overrideVisibility = () => { hidden = strokes.filter(object => object.visible); for (const object of hidden) object.visible = false; };
    pass._restoreVisibility = () => { for (const object of hidden) object.visible = true; hidden = []; };
  }
  // A material draws batched, instanced and plain meshes with different program
  // variants, and switching variant costs a parameter scan and cache-key build.
  // three keeps instanced and skinned draws of a material together but not
  // batched ones; here each kind runs together within its material. Under GTAO's
  // single override material the kinds come first, since every mesh shares it.
  // Among opaque draws the depth test, not their order, decides each pixel.
  type Item = { groupOrder: number; renderOrder: number; material: { id: number }; object: THREE.Object3D; z: number; id: number };
  const kind = (object: THREE.Object3D) => (object as THREE.BatchedMesh).isBatchedMesh ? 4 : ((object as THREE.InstancedMesh).isInstancedMesh ? 2 : 0) + ((object as THREE.SkinnedMesh).isSkinnedMesh ? 1 : 0);
  const byMaterial = (a: Item, b: Item) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || a.material.id - b.material.id || kind(a.object) - kind(b.object) || a.z - b.z || a.id - b.id;
  const byKind = (a: Item, b: Item) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || kind(a.object) - kind(b.object) || a.z - b.z || a.id - b.id;
  renderer.setOpaqueSort(byMaterial);
  const renderAO = ao.render.bind(ao);
  ao.render = (r, write, read, dt, mask) => {
    refresh();
    const visible = exclusions.filter(object => object.visible);
    const autoShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    visible.forEach(object => { object.visible = false; });
    r.setOpaqueSort(byKind);
    try { renderAO(r, write, read, dt, mask); }
    finally { r.setOpaqueSort(byMaterial); visible.forEach(object => { object.visible = true; }); r.shadowMap.autoUpdate = autoShadow; }
  };
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .13, .32, 1.35);
  composer.addPass(beauty); composer.addPass(ao); composer.addPass(bloom); composer.addPass(new OutputPass());
  let quality = initial;
  function resize() {
    const ratio = Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1);
    renderer.setPixelRatio(ratio); renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(ratio); composer.setSize(innerWidth, innerHeight);
    ao.setSize(Math.max(1, Math.round(innerWidth * ratio * .65)), Math.max(1, Math.round(innerHeight * ratio * .65)));
  }
  function setQuality(mode: QualityMode) {
    quality = mode; ao.enabled = mode === 'high'; bloom.enabled = mode === 'high'; resize();
  }
  setQuality(initial);
  // The shadow map draws casters with a shared MeshDepthMaterial carrying each
  // material's side and cutout maps. Programs are shared by cache key, so a
  // stand-in set up the same way links the shadow pass's variant too.
  const depth = new THREE.MeshDepthMaterial(), shadowSide = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
  /** Start linking every program the passes will draw `mesh` with: its own
   * material (the beauty pass, and by day the reflection probe), GTAO's normal
   * override and the shadow map's depth material. With KHR_parallel_shader_compile
   * the driver links them off the main thread; the result says when all are
   * ready, since a draw before then would wait for the link. */
  const warmed = new Map<string, () => boolean>();
  function warm(mesh: THREE.Mesh) {
    if (Array.isArray(mesh.material)) return () => true;
    // Programs are shared by material and variant: a second mesh of the same kind waits on the first one's link, or
    // not at all. The key holds what selects a variant here (the kind of mesh, its shadow flags and attributes, the
    // passes in use, the lights in the scene); a changed material, quality or time of day warms again.
    let lights = 0; for (const child of scene.children) if ((child as THREE.Light).isLight && child.visible) lights += child.castShadow ? 17 : 1;
    const key = [mesh.material.uuid, mesh.material.version, kindOf(mesh), mesh.castShadow, mesh.receiveShadow, Object.keys(mesh.geometry.attributes).sort().join(','), ao.enabled, renderer.shadowMap.enabled, lights].join('|');
    const known = warmed.get(key); if (known) return known;
    const ready = link(mesh); warmed.set(key, ready); if (warmed.size > 4096) warmed.clear();
    return ready;
  }
  type Mapped = THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
  function link(mesh: THREE.Mesh, own = true) {
    const material = mesh.material as Mapped, fog = scene.fog, previous = renderer.getRenderTarget();
    const passes: [THREE.Material, THREE.Scene['fog']][] = own ? [[material, fog]] : [], programs: Program[] = [];
    if (ao.enabled) passes.push([ao.normalMaterial, fog]);
    if (mesh.castShadow && renderer.shadowMap.enabled) {
      // As WebGLShadowMap sets its depth material from each caster: the map is passed on whether or not it cuts anything out.
      depth.side = material.shadowSide ?? shadowSide[material.side]; depth.map = material.map ?? null; depth.alphaMap = material.alphaMap ?? null; depth.alphaTest = material.alphaToCoverage ? .5 : material.alphaTest;
      passes.push([depth, null]); // the shadow pass draws without a scene, so without fog
    }
    // Every pass renders offscreen (no tone mapping, linear output); any target selects that variant.
    renderer.setRenderTarget(target);
    try {
      for (const [pass, passFog] of passes) {
        mesh.material = pass; scene.fog = passFog;
        for (const compiled of renderer.compile(mesh, camera, scene)) { const program = (renderer.properties.get(compiled) as { currentProgram?: Program }).currentProgram; if (program) programs.push(program); }
      }
    } finally { mesh.material = material; scene.fog = fog; renderer.setRenderTarget(previous); }
    let used = false;
    return () => { if (!used && programs.every(program => program.isReady())) { firstUse(programs); used = true; } return used; };
  }
  type Program = { isReady(): boolean; getUniforms?(): unknown };
  /** three reads a program's link log and uniforms on its first draw: calls that wait for the GPU process to finish
   * what it has queued, however long ago the link completed. Asked here, before the frame's own commands are queued,
   * the wait is short; in the middle of a shadow or view pass it was 30 to 40 ms. */
  function firstUse(programs: Program[]) { for (const program of programs) program.getUniforms?.(); }
  /** Resolves once every program the renderer holds has linked (or after `limit` ms) and been through its first use. */
  function settlePrograms(limit = 5000) {
    return new Promise<void>(resolve => {
      const end = performance.now() + limit;
      const poll = () => {
        const list = (renderer.info.programs ?? []) as unknown as Program[], linked = list.every(program => program.isReady());
        if (linked || performance.now() > end) { firstUse(list.filter(program => program.isReady())); resolve(); } else setTimeout(poll, 16);
      };
      poll();
    });
  }
  const kindOf = (mesh: THREE.Mesh) => { const m = mesh as THREE.Mesh & { isBatchedMesh?: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean }; return m.isBatchedMesh ? 'batched' : m.isInstancedMesh ? 'instanced' : m.isSkinnedMesh ? 'skinned' : 'plain'; };
  /** Start linking the shadow and normal pass programs of everything under `root`, in view or not. The startup
   * compile covers each material's own program; these two passes draw with stand-ins whose variants (kind of mesh,
   * side, cutout map) otherwise link in the frame a mesh first falls inside the shadow map or the view: a landmark's
   * cutout sign held one for 37 ms a kilometre into a flight. One compile per distinct variant, a few dozen in all. */
  function warmPasses(root: THREE.Object3D) {
    const seen = new Set<string>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material) || !mesh.geometry?.attributes.position) return;
      const material = mesh.material as Mapped, casts = mesh.castShadow;
      const key = [kindOf(mesh), casts && (material.shadowSide ?? material.side), casts && !!material.map, casts && !!material.alphaMap, casts && (material.alphaToCoverage || material.alphaTest > 0), !!mesh.geometry.attributes.uv].join('|');
      if (seen.has(key)) return; seen.add(key);
      link(mesh, false);
    });
  }
  const upload = createPacedUploads(renderer, camera);
  /** Send to the GPU, while the game is still loading, what its first frames will not draw: the textures and large
   * vertex arrays of everything under `root`. three uploads each on first use, so a landmark modelled at startup
   * held the frame that first brought it into the view or the shadow map (the arena's cutout sign texture: 35 ms a
   * kilometre into a flight). A mesh with its own render hook (a reflector) is left to its first draw. */
  function prepare(root: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [], textures = new Set<THREE.Texture>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh & { isBatchedMesh?: boolean }; if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (material) for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
      if (mesh.isBatchedMesh || !Object.prototype.hasOwnProperty.call(mesh, 'onBeforeRender')) meshes.push(mesh);
    });
    for (const texture of textures) {
      const kind = texture as THREE.Texture & { isRenderTargetTexture?: boolean; isVideoTexture?: boolean; isDepthTexture?: boolean }, image = texture.image as { width?: number } | null;
      if (image?.width && !kind.isRenderTargetTexture && !kind.isVideoTexture && !kind.isDepthTexture) renderer.initTexture(texture);
    }
    for (const _ of upload(meshes)); // not paced: every slice now
    return { meshes: meshes.length, textures: textures.size };
  }
  return {
    setQuality, resize, warm, warmPasses, settlePrograms, prepare, upload: upload as Upload | undefined,
    render(dt: number) {
      // GTAO swaps the buffers. Start each frame with the same MSAA beauty
      // target, then compose into the single-sample buffer.
      composer.readBuffer = composer.renderTarget1; composer.writeBuffer = composer.renderTarget2;
      composer.render(dt);
    },
    get quality() { return quality; },
    dispose() { renderer.setOpaqueSort(null); for(const pass of composer.passes)pass.dispose(); composer.dispose(); depth.dispose(); },
  };
}
