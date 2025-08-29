import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
 
import { initializeLights } from './lights.js';
import { createLoadingOverlay } from './overlay.js';
import { createScenarioManager } from './scenarios.js';
import { initializeCamera, enforceCameraDistanceClamp as clampCameraDistance, updateControlsTargetFromObject, frameObject, setPleasantCameraView as setPleasantView, applyZoomDelta as applyZoomDeltaExt } from './camera.js';
import { createCinematicController } from './camera_cinematic.js';
import { applyColorToModel as applyColorToModelExt, buildMaterialRegistry as buildMaterialRegistryExt, populateTextureTogglesFromMaterialRegistry as populateTextureTogglesFromMaterialRegistryExt } from './materials.js';
import { removeDefaultTextureMapsFromModel as removeDefaultTextureMapsFromModelExt, applyBakedTextureToModel as applyBakedTextureToModelExt, populateTextureTogglesFromModel as populateTextureTogglesFromModelExt, toggleTextureMapEnabled as toggleTextureMapEnabledExt } from './materials_baked.js';
import { loadImageElement, copyTextureTransform, createSquareFitCanvas, computeUvBoundsForMaterial, computeRawUvBoundsForMaterial, estimateBackgroundColorFromBorder, buildForegroundMask, largestMaskBoundingBox, material003OriginalMaps, material003OriginalImages, composeLogoIntoOriginalTexture, neutralizePbrMapsForUvRect, replaceMaterial003BaseMap as replaceMaterial003BaseMapExt, restoreMaterial003BaseMap as restoreMaterial003BaseMapExt } from './materials_logo.js';

(function () {
  // ===== App State =====
  /** @type {THREE.WebGLRenderer} */
  let renderer;
  /** @type {THREE.PerspectiveCamera} */
  let camera;
  /** @type {THREE.Scene} */
  let scene;
  /** @type {THREE.Object3D | null} */
  let modelRoot = null;
  /** @type {HTMLElement} */
  let viewportEl;
  /** @type {HTMLButtonElement} */
  let toggleModelSpinBtnEl;
  /** @type {HTMLInputElement} */
  let enableOrbitEl;
  /** @type {HTMLSelectElement | null} */
  let modelSelectEl = null;
  
  /** @type {HTMLButtonElement} */
  let recenterBtnEl;
  /** @type {HTMLButtonElement} */
  let snapToFloorBtnEl;
  // Removed global model color control
  
  let isModelSpinning = false;
  /** @type {any | null} */
  let controls = null;
  /** @type {THREE.Mesh | null} */
  let floorMesh = null;
  // Scenario manager
  let scenarioManager = null;
  // Cinematic camera state
  let composer = null; // EffectComposer
  let renderPass = null; // RenderPass
  let bokehPass = null; // BokehPass
  let cinematic = null;
  /** @type {Record<string, number>} */
  const scenarioYOffsetDefaults = {
    none: 0,
    modern_garage: 0.0,
    office_garage: -0.10,
    parking_lot: 0.12,
    parking_lot_uf: 0.18,
    'sci-fi_garage': 0.6608831037132148
  };
  let currentScenarioKey = 'modern_garage';
  let userYOffset = 0; // live override via UI
  let modelYOffsetBase = 0; // baseline after snapping to scenario floor
  // Loading overlay API
  let overlay = null;
  // Expose readouts updater to outer scope (avoid ReferenceError)
  /** @type {null | (() => void)} */
  let updateReadouts = null;

  // Texture toggles UI
  /** @type {HTMLElement | null} */
  let textureTogglesEl = null;
  /** @type {Array<{ meshId: string, meshName: string, materialIndex: number, materialName: string, material: any }>} */
  let materialRegistry = [];
  /** @type {HTMLInputElement | null} */
  let logoImageInputEl = null;
  /** @type {HTMLButtonElement | null} */
  let resetLogoBtnEl = null;

  // Y offset UI refs (assigned in initialize)
  /** @type {HTMLInputElement | null} */
  let yOffsetRange = null;
  /** @type {HTMLElement | null} */
  let yOffsetValue = null;
  /** @type {HTMLButtonElement | null} */
  let nudgeDownBtn = null;
  /** @type {HTMLButtonElement | null} */
  let nudgeUpBtn = null;
  /** @type {HTMLButtonElement | null} */
  let saveScenarioOffsetBtn = null;

  function updateYOffsetUI() {
    if (yOffsetRange) yOffsetRange.value = String(userYOffset);
    if (yOffsetValue) yOffsetValue.textContent = userYOffset.toFixed(3);
  }

  function applyVerticalOffset() {
    if (!modelRoot) return;
    const base = scenarioYOffsetDefaults[currentScenarioKey] ?? 0;
    const total = base + userYOffset;
    modelRoot.position.y = modelYOffsetBase + total;
    updateFloorUnderModel();
    updateReadouts && updateReadouts();
    updateControlsTargetFromModel();
  }

  // ===== Initialization (DOM, Three.js, PostFX, UI) =====
  function initialize() {
    console.log('[init] starting');
    // DOM refs
    viewportEl = document.getElementById('viewport');
    toggleModelSpinBtnEl = /** @type {HTMLButtonElement} */ (document.getElementById('toggleModelSpinBtn'));
    enableOrbitEl = /** @type {HTMLInputElement} */ (document.getElementById('enableOrbit'));
    const toggleCinematicBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggleCinematicBtn'));
    
    recenterBtnEl = /** @type {HTMLButtonElement} */ (document.getElementById('recenterBtn'));
    snapToFloorBtnEl = /** @type {HTMLButtonElement} */ (document.getElementById('snapToFloorBtn'));
    if (!viewportEl) throw new Error('Viewport element not found');

    // Renderer inside viewport container
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const { width, height } = getViewportSize();
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    viewportEl.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    // Scenario manager
    scenarioManager = createScenarioManager(scene);

    // Camera and controls
    const { width: vw, height: vh } = getViewportSize();
    const { camera: cam, controls: ctrls } = initializeCamera(
      /** @type {HTMLCanvasElement} */ (undefined) || renderer.domElement,
      { fov: 60, near: 0.1, far: 100, aspect: vw / vh }
    );
    camera = cam;
    controls = ctrls;
    scene.add(camera);

    // Postprocessing setup (needs scene and camera ready)
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    bokehPass = new BokehPass(scene, camera, {
      focus: 3.0,
      aperture: 0.00025, // smaller = less blur; aperture is in terms of luminance
      maxblur: 0.01
    });
    bokehPass.enabled = false;
    composer.addPass(bokehPass);
    composer.setSize(width, height);

    // Cinematic controller
    cinematic = createCinematicController(camera, controls);
    cinematic.setBokehPass(bokehPass);

    // Orbit enable/disable toggle via checkbox
    if (enableOrbitEl) {
      controls.enabled = enableOrbitEl.checked;
      enableOrbitEl.addEventListener('change', () => {
        if (controls) controls.enabled = !!enableOrbitEl.checked;
      });
    }
    if (toggleCinematicBtn) {
      toggleCinematicBtn.addEventListener('click', () => {
        if (!cinematic) return;
        if (cinematic.isEnabled()) {
          cinematic.disable();
          toggleCinematicBtn.textContent = 'Start cinematic camera';
        } else {
          cinematic.enable();
          toggleCinematicBtn.textContent = 'Stop cinematic camera';
        }
      });
    }

    // Lights (setup and UI bindings moved to lights.js)
    const { hemi, directionalLight } = initializeLights(scene);

    // Loading overlay
    overlay = createLoadingOverlay();
    overlay.show();
    overlay.setProgress(0);

    // Load model (from selector if present)
    modelSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('modelSelect'));
    textureTogglesEl = document.getElementById('textureToggles');
    logoImageInputEl = /** @type {HTMLInputElement} */ (document.getElementById('logoImageInput'));
    resetLogoBtnEl = /** @type {HTMLButtonElement} */ (document.getElementById('resetLogoBtn'));
    const initialModelUrl = (modelSelectEl && modelSelectEl.value) || '/assets/models/kosha4/teste%2012.glb';
    console.log('[loader] loading', initialModelUrl);
    loadGltfModel(initialModelUrl, (p) => overlay.setProgress(p), () => overlay.hide());

    // UI events
    // Global model color UI removed
    if (modelSelectEl) {
      modelSelectEl.addEventListener('change', () => {
        if (modelSelectEl) switchModel(modelSelectEl.value);
      });
    }

    if (logoImageInputEl) {
      logoImageInputEl.addEventListener('change', async () => {
        const file = logoImageInputEl.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        await replaceMaterial003BaseMap(url);
        URL.revokeObjectURL(url);
      });
    }
    if (resetLogoBtnEl) {
      resetLogoBtnEl.addEventListener('click', () => restoreMaterial003BaseMap());
    }
    if (toggleModelSpinBtnEl) {
      toggleModelSpinBtnEl.addEventListener('click', () => {
        isModelSpinning = !isModelSpinning;
        toggleModelSpinBtnEl.textContent = isModelSpinning ? 'Pause object spin' : 'Resume object spin';
      });
    }
    
    if (recenterBtnEl) {
      recenterBtnEl.addEventListener('click', () => {
        if (modelRoot) setPleasantCameraView();
      });
    }
    if (snapToFloorBtnEl) {
      snapToFloorBtnEl.addEventListener('click', () => {
        if (modelRoot) snapModelToScenarioFloor();
      });
    }

    // Light controls are handled within lights.js

    // Scenario controls
    const scenarioSelect = /** @type {HTMLSelectElement} */ (document.getElementById('scenarioSelect'));
    const showFloorCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('showFloor'));
    if (scenarioSelect) {
      scenarioSelect.addEventListener('change', () => {
        setScenarioManaged(scenarioSelect.value);
        // after scenario changes, keep orbit target centered on model
        if (modelRoot) updateControlsTargetFromObject(camera, controls, modelRoot);
      });
    }
    if (showFloorCheckbox) {
      showFloorCheckbox.addEventListener('change', () => {
        if (floorMesh) floorMesh.visible = showFloorCheckbox.checked;
      });
    }

    // Vertical offset controls
    yOffsetRange = /** @type {HTMLInputElement} */ (document.getElementById('yOffsetRange'));
    yOffsetValue = /** @type {HTMLElement} */ (document.getElementById('yOffsetValue'));
    nudgeDownBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nudgeDownBtn'));
    nudgeUpBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nudgeUpBtn'));
    saveScenarioOffsetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('saveScenarioOffsetBtn'));

    if (yOffsetRange) yOffsetRange.addEventListener('input', () => { userYOffset = Number(yOffsetRange.value); applyVerticalOffset(); updateYOffsetUI(); });
    if (nudgeDownBtn) nudgeDownBtn.addEventListener('click', () => { userYOffset = Number((userYOffset - 0.01).toFixed(3)); applyVerticalOffset(); updateYOffsetUI(); });
    if (nudgeUpBtn) nudgeUpBtn.addEventListener('click', () => { userYOffset = Number((userYOffset + 0.01).toFixed(3)); applyVerticalOffset(); updateYOffsetUI(); });
    if (saveScenarioOffsetBtn) saveScenarioOffsetBtn.addEventListener('click', () => {
      scenarioYOffsetDefaults[currentScenarioKey] = (scenarioYOffsetDefaults[currentScenarioKey] ?? 0) + userYOffset;
      userYOffset = 0;
      updateYOffsetUI();
      applyVerticalOffset();
      console.log('[offset] saved default for', currentScenarioKey, '->', scenarioYOffsetDefaults[currentScenarioKey]);
    });
    updateYOffsetUI();

    // Extra position readouts and manual nudge
    const yAbsEl = document.getElementById('yAbs');
    const yBaseEl = document.getElementById('yBase');
    const yDecBtn = /** @type {HTMLButtonElement} */ (document.getElementById('yDecBtn'));
    const yIncBtn = /** @type {HTMLButtonElement} */ (document.getElementById('yIncBtn'));
    const copyPosBtn = /** @type {HTMLButtonElement} */ (document.getElementById('copyPosBtn'));
    const zoomInBtn = /** @type {HTMLButtonElement} */ (document.getElementById('zoomInBtn'));
    const zoomOutBtn = /** @type {HTMLButtonElement} */ (document.getElementById('zoomOutBtn'));

    function updateReadoutsLocal() {
      if (!modelRoot) return;
      if (yAbsEl) yAbsEl.textContent = modelRoot.position.y.toFixed(3);
      if (yBaseEl) yBaseEl.textContent = modelYOffsetBase.toFixed(3);
    }
    updateReadouts = updateReadoutsLocal;
    function nudgeY(amount) {
      if (!modelRoot) return;
      userYOffset = Number((userYOffset + amount).toFixed(3));
      applyVerticalOffset();
      updateYOffsetUI();
    }
    if (yDecBtn) yDecBtn.addEventListener('click', () => nudgeY(-0.01));
    if (yIncBtn) yIncBtn.addEventListener('click', () => nudgeY(+0.01));
    if (copyPosBtn) copyPosBtn.addEventListener('click', () => {
      if (!modelRoot) return;
      const pos = modelRoot.position;
      const payload = JSON.stringify({ scenario: currentScenarioKey, position: { x: pos.x, y: pos.y, z: pos.z }, baseY: modelYOffsetBase }, null, 2);
      navigator.clipboard?.writeText(payload);
      console.log('[position copied]', payload);
    });
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyZoomDeltaExt(camera, controls, -0.2));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyZoomDeltaExt(camera, controls, +0.2));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'PageUp') { nudgeY(e.shiftKey ? +0.001 : e.altKey ? +0.1 : +0.01); e.preventDefault(); }
      if (e.code === 'PageDown') { nudgeY(e.shiftKey ? -0.001 : e.altKey ? -0.1 : -0.01); e.preventDefault(); }
    });
    updateReadoutsLocal();

    // Regions and decal UI removed

    // Resize handling
    window.addEventListener('resize', onWindowResize);

    // Start loop
    requestAnimationFrame(animate);
  }

  // Zoom helper moved to camera.js

  // ===== Resize & Animation Loop =====
  function onWindowResize() {
    const { width, height } = getViewportSize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer?.setSize(width, height);
  }

  function animate(nowMs) {
    // Rotate model for visual feedback
    if (modelRoot && isModelSpinning) {
      modelRoot.rotation.y += 0.01;
    }

    if (controls) {
      controls.update();
      // Enforce distance clamp after control updates
      clampCameraDistance(camera, controls);
    }
    if (cinematic && cinematic.isEnabled()) {
      // Approx delta since requestAnimationFrame gives timestamp in ms
      cinematic.update(0.016, modelRoot);
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);
  }

  // ===== Model: Loading & Lifecycle =====
  function loadGltfModel(path, onProgress, onDone) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);

    console.log('[loader] load', path);
    loader.load(
      path,
      (gltf) => {
        const root = gltf.scene || gltf.scenes[0];
        if (!root) { onProgress?.(100); onDone?.(); return; }
        normalizeAndAddToScene(root);
        // Update control limits based on model size
        updateControlDistanceLimitsFromModel();
        // Apply materials/textures per model
        try {
          if (typeof path === 'string' && path.includes('/assets/models/kosha4/')) {
            // Kosha4: full per-material controls
            removeDefaultTextureMapsFromModel(false);
            applyColorToModel('#ffffff');
            buildMaterialRegistry();
            populateTextureTogglesFromMaterialRegistry();
          } else {
            removeDefaultTextureMapsFromModel(true);
            applyColorToModel('#ffffff');
          }
        } catch (e) { /* non-fatal */ }
        
        frameObject3D(modelRoot);
        
        onProgress?.(85);
        // After model is ready, load default scenario if any
        if (currentScenarioKey && currentScenarioKey !== 'none') {
          setScenarioManaged(currentScenarioKey, onProgress, onDone);
        } else {
          onProgress?.(100); onDone?.();
        }
      },
      (ev) => {
        if (ev && ev.total) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          onProgress?.(Math.min(80, Math.round(pct * 0.8)));
        } else {
          onProgress?.(50);
        }
      },
      (err) => { console.error('[loader] error', err); onProgress?.(100); onDone?.(); }
    );
  }

  function disposeModel() {
    if (!modelRoot) return;
    scene.remove(modelRoot);
    modelRoot.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of materials) m?.dispose?.();
      }
    });
    modelRoot = null;
    clearTextureTogglesUI();
    materialRegistry = [];
  }

  function switchModel(url) {
    if (!url) return;
    // Reset offsets when changing model
    userYOffset = 0;
    modelYOffsetBase = 0;
    updateYOffsetUI();
    clearTextureTogglesUI();

    // Show loading UI
    overlay && overlay.show();
    overlay && overlay.setProgress(0);

    // Dispose previous model
    disposeModel();

    // Choose proper loader based on file extension
    const lower = url.toLowerCase();
    const isGlb = lower.endsWith('.glb');
    const isGltf = lower.endsWith('.gltf');
    const progress = (p) => overlay && overlay.setProgress(Math.round(p));
    const done = () => overlay && overlay.hide();

    if (isGlb || isGltf) {
      loadGltfModel(url, progress, done);
    } else {
      console.warn('[switchModel] unsupported format for', url);
      done();
    }
  }

  // ===== Materials: Texture UI & Controls =====
  function clearTextureTogglesUI() {
    if (!textureTogglesEl) return;
    while (textureTogglesEl.firstChild) textureTogglesEl.removeChild(textureTogglesEl.firstChild);
    const hint = document.createElement('div');
    hint.style.fontSize = '12px';
    hint.style.opacity = '0.8';
    hint.textContent = 'Appears when a model includes baked textures.';
    textureTogglesEl.appendChild(hint);
    // also reset logo controls file input
    if (logoImageInputEl) logoImageInputEl.value = '';
  }

  // Remove default base color textures so the model shows solid colors
  const removeDefaultTextureMapsFromModel = (remove = true) => removeDefaultTextureMapsFromModelExt(modelRoot, remove);

  // Apply a single baked texture to all meshes of the current model
  const applyBakedTextureToModel = (textureUrl) => applyBakedTextureToModelExt(modelRoot, textureUrl);

  // Build texture toggles UI by inspecting materials of the current model.
  // Supports standard maps: map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap.
  const populateTextureTogglesFromModel = (opts = { baked: false, fromMaterials: true }) => populateTextureTogglesFromModelExt(modelRoot, textureTogglesEl, opts);

  const toggleTextureMapEnabled = (key, enabled) => toggleTextureMapEnabledExt(modelRoot, key, enabled);

  // Replace/reset base color map for materials named "Material 003" (e.g., "Material 003", "Material.003")
  // maps imported from materials_logo.js
  async function replaceMaterial003BaseMap(imageUrl) { if (!modelRoot) return; await replaceMaterial003BaseMapExt(modelRoot, imageUrl); }

  function restoreMaterial003BaseMap() { if (!modelRoot) return; restoreMaterial003BaseMapExt(modelRoot); }

  // (logo helper functions moved to materials_logo.js)

  // Apply solid color to all materials
  function applyColorToModel(hex) { applyColorToModelExt(modelRoot, hex); }

  // Build a registry of unique material instances for per-material control
  function buildMaterialRegistry() {
    materialRegistry = buildMaterialRegistryExt(modelRoot) || [];
  }

  function populateTextureTogglesFromMaterialRegistry() {
    populateTextureTogglesFromMaterialRegistryExt(textureTogglesEl, materialRegistry);
  }

  // ===== Model: Normalize & Camera Bounds =====
  function normalizeAndAddToScene(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const wrapper = new THREE.Group();
    // Move the model so its center is at the origin
    root.position.sub(center);
    wrapper.add(root);

    // Scale to a comfortable size
    const maxSize = Math.max(size.x, size.y, size.z) || 1;
    const targetSize = 2.0; // fit within ~2 units
    const scale = targetSize / maxSize;
    wrapper.scale.setScalar(scale);

    scene.add(wrapper);
    modelRoot = wrapper;

    updateFloorUnderModel();
  }

  // Compute reasonable min/max zoom based on model radius
  function updateControlDistanceLimitsFromModel() {
    if (!controls || !modelRoot) return;
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    controls.minDistance = Math.max(0.15, radius * 0.3);
    controls.maxDistance = Math.max(5, radius * 8);
  }

  // ===== Camera Helpers =====
  function frameObject3D(object3D) {
    frameObject(camera, controls, object3D);
  }

  // Choose a pleasant front-biased 3/4 camera view on the model
  function setPleasantCameraView() {
    if (!modelRoot) return;
    setPleasantView(camera, controls, modelRoot);
  }

  // Keep orbit controls target aligned with the model center
  function updateControlsTargetFromModel(precomputedCenter) {
    if (!controls || !modelRoot) return;
    if (precomputedCenter) {
      controls.target.copy(precomputedCenter);
    controls.update();
    } else {
      updateControlsTargetFromObject(camera, controls, modelRoot);
    }
  }

  

  // ===== Floor Helpers =====
  function getFloorYAt(x, z) {
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3(x, 10000, z);
    const dir = new THREE.Vector3(0, -1, 0);
    raycaster.set(origin, dir);
    const candidates = [];
    const scenarioRoot = scenarioManager?.getScenarioRoot?.();
    if (floorMesh && floorMesh.visible) candidates.push(floorMesh);
    const hits = candidates.length ? raycaster.intersectObjects(candidates, true) : [];
    if (hits && hits.length) return hits[0].point.y;
    return 0;
  }

  

  function updateFloorUnderModel() {
    if (!modelRoot) return;
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const padding = 1.2;
    const scaledSizeX = Math.max(1, size.x * padding);
    const scaledSizeZ = Math.max(1, size.z * padding);
    const offset = Math.max(0.005, size.y * 0.01);
    const floorY = box.min.y - offset; // slightly below the lowest point in world space

    if (!floorMesh) {
      const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
      const material = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1.0, metalness: 0.0 });
      floorMesh = new THREE.Mesh(geometry, material);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);
    }

    floorMesh.scale.set(scaledSizeX, scaledSizeZ, 1);
    floorMesh.position.set(center.x, floorY, center.z);
  }


  function snapModelToScenarioFloor() {
    if (!modelRoot) return;
    // 1) Find scenario floor Y using a downward ray from above the model center
    const box = new THREE.Box3().setFromObject(modelRoot);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const raycaster = new THREE.Raycaster();
    // Cast UP from below the model to find the first surface above – typically the floor
    const rayOrigin = new THREE.Vector3(center.x, box.min.y - 1000, center.z);
    const rayDirection = new THREE.Vector3(0, 1, 0);
    raycaster.set(rayOrigin, rayDirection);

    const candidates = [];
    const scenarioRoot = scenarioManager?.getScenarioRoot?.();
    if (floorMesh && floorMesh.visible) candidates.push(floorMesh);
    if (candidates.length === 0) return;

    const intersections = raycaster.intersectObjects(candidates, true);
    if (!intersections.length) return;
    const hit = intersections[0];
    const targetY = hit.point.y;

    // 2) Move model so its bottom sits just above targetY
    const epsilon = 0.002; // slight lift to avoid z-fight
    const bottomY = box.min.y;
    const deltaY = targetY + epsilon - bottomY;
    modelRoot.position.y += deltaY;
    modelYOffsetBase = modelRoot.position.y; // establish baseline at floor contact

    // 3) Update helper floor to match new pose
    updateFloorUnderModel();
    // 4) Keep camera target aligned with model center
    frameObject3D(modelRoot);
    updateControlsTargetFromModel();
  }

  // Removed per-region coloring; keep global color only

  // ===== Utilities =====
  function getViewportSize() {
    const rect = viewportEl.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    return { width, height };
  }

  // ===== Scenario Management =====
  function setScenarioManaged(key, onProgress, onDone) {
    currentScenarioKey = key || 'none';
    userYOffset = 0;
    modelYOffsetBase = 0;
    updateYOffsetUI();
    scenarioManager.setScenario(key, {
      onProgress: (p) => {
        overlay && overlay.setProgress(p);
        onProgress?.(p);
      },
      onDone: () => {
        try {
            if (currentScenarioKey === 'modern_garage' && modelRoot) {
              modelRoot.position.set(0, 0.3931981944627143, 0);
              modelYOffsetBase = modelRoot.position.y;
            }
            if (currentScenarioKey === 'sci-fi_garage' && modelRoot) {
              modelRoot.position.set(0, 0.46088310371321484, 0);
            modelYOffsetBase = modelRoot.position.y;
            }
            snapModelToScenarioFloor();
            applyVerticalOffset();
            setPleasantCameraView();
          } catch (e) {
            console.error('[scenario] finalize error', e);
          } finally {
            onDone?.();
          }
      },
    });
  }

  // ===== Bootstrapping =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();


