import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/**
 * Scenario manager: load and swap scene environments under /assets/scenarios.
 * Provides setScenario and utilities to snap a model to the scenario floor.
 */
export function createScenarioManager(scene) {
  /** @type {THREE.Group | null} */
  let scenarioRoot = null;
  let currentScenarioKey = 'none';

  // Explicit URL mapping for scenarios that don't follow the default scene.gltf path
  /** @type {Record<string, string>} */
  const scenarioUrlMap = {
    // Uses GLB instead of scene.gltf
    'vr_moody_lighting_art_gallery_scene_06': '/assets/scenarios/vr_moody_lighting_art_gallery_scene_06/vr_moody_lighting_art_gallery_scene_06.glb',
  };

  function disposeScenario() {
    if (!scenarioRoot) return;
    scene.remove(scenarioRoot);
    scenarioRoot.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of materials) m.dispose?.();
        }
      }
    });
    scenarioRoot = null;
  }

  function setScenario(key, { onProgress, onDone } = {}) {
    disposeScenario();
    currentScenarioKey = key || 'none';
    if (!key || key === 'none') return;

    const url = scenarioUrlMap[key] || `/assets/scenarios/${key}/scene.gltf`;
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
    loader.setDRACOLoader(draco);

    loader.load(
      url,
      (gltf) => {
        const root = gltf.scene || gltf.scenes[0];
        if (!root) return;
        scenarioRoot = new THREE.Group();
        scenarioRoot.add(root);
        scene.add(scenarioRoot);
        onProgress?.(90);
        onDone?.();
      },
      (ev) => {
        if (ev && ev.total) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          onProgress?.(90 + Math.round(pct * 0.09));
        } else {
          onProgress?.(95);
        }
      },
      (err) => { console.error('[scenario] error', err); onProgress?.(100); onDone?.(); }
    );
  }

  function getScenarioRoot() { return scenarioRoot; }
  function getCurrentScenarioKey() { return currentScenarioKey; }

  return { setScenario, getScenarioRoot, getCurrentScenarioKey };
}


