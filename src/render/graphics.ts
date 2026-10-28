import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type QualityMode = 'high' | 'balanced';

/** Desktop lighting finish, with an inexpensive mode for integrated/mobile GPUs. */
export function createGraphics(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, initial: QualityMode) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const beauty = new RenderPass(scene, camera);
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.blendIntensity = .9;
  ao.updateGtaoMaterial({ radius: 1.5, thickness: 1.2, distanceExponent: 2, distanceFallOff: .7, scale: 1, samples: 12, screenSpaceRadius: false });
  ao.updatePdMaterial({ radius: 5, rings: 2, samples: 8, depthPhi: 2, normalPhi: 3 });
  // The normal override used by GTAO cannot preserve alpha-cutout leaves. Keep
  // their opaque cards out of that buffer while retaining their real shadows.
  const exclusions: THREE.Object3D[] = [];
  scene.traverse(object => { if (object.userData.noAO) exclusions.push(object); });
  const renderAO = ao.render.bind(ao);
  ao.render = (r, write, read, dt, mask) => {
    const visible = exclusions.filter(object => object.visible);
    const autoShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    visible.forEach(object => { object.visible = false; });
    try { renderAO(r, write, read, dt, mask); }
    finally { visible.forEach(object => { object.visible = true; }); r.shadowMap.autoUpdate = autoShadow; }
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
  return {
    setQuality, resize,
    render(dt: number) { composer.render(dt); },
    get quality() { return quality; },
    dispose() { ao.dispose(); bloom.dispose(); composer.dispose(); },
  };
}
