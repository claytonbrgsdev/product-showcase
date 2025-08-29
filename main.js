import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
 
import { initializeLights, createFloorUplight, createShowRoomLights } from './lights.js';
import { createLoadingOverlay } from './overlay.js';
import { createScenarioManager } from './scenarios.js';
import { initializeCamera, enforceCameraDistanceClamp as clampCameraDistance, updateControlsTargetFromObject, frameObject, setPleasantCameraView as setPleasantView, applyZoomDelta as applyZoomDeltaExt } from './camera.js';
import { createCinematicController } from './camera_cinematic.js';
import { applyColorToModel as applyColorToModelExt, applyColorToSpecificTarget as applyColorToSpecificTargetExt, disableMapForSpecificTarget as disableMapForSpecificTargetExt, buildMaterialRegistry as buildMaterialRegistryExt, populateTextureTogglesFromMaterialRegistry as populateTextureTogglesFromMaterialRegistryExt } from './materials.js';
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
    'sci-fi_garage': 0.0
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
  /** @type {HTMLInputElement | null} */
  let lineColorInputEl = null;
  /** @type {HTMLInputElement | null} */
  let modelColorInputEl = null;

  // Logo regions UI
  /** @type {HTMLInputElement | null} */
  let logoRegionFrenteEl = null;
  /** @type {HTMLInputElement | null} */
  let logoRegionTrasEl = null;
  /** @type {HTMLInputElement | null} */
  let logoRegionLateral1El = null;
  /** @type {HTMLInputElement | null} */
  let logoRegionLateral2El = null;
  // Store original base maps for per-region toggle
  /** @type {WeakMap<any, any>} */
  const regionOriginalBaseMap = new WeakMap();

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
    const restartCinematicBtn = /** @type {HTMLButtonElement} */ (document.getElementById('restartCinematicBtn'));
    
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
      focus: 8.0,
      aperture: 0.00025, // smaller = less blur; aperture is in terms of luminance
      maxblur: 0.01
    });
    bokehPass.enabled = false;
    composer.addPass(bokehPass);
    composer.setSize(width, height);

    // Cinematic controller
    cinematic = createCinematicController(camera, controls);
    cinematic.setBokehPass(bokehPass);
    // Faster orbit defaults for cinematic mode
    try { cinematic.setOrbitParams({ speed: 0.3, radius: 1.8, elevation: 50, elevationSway: 4, dwellDriftSpeed: 0.045, radiusSwayAmp: 0.2, radiusSwayHz: 0.35 }); } catch (_) {}
    try { cinematic.setFovPulse({ enabled: false, base: 55, amplitudeDeg: 0 }); } catch (_) {}
    // Longer resume blend after manual drag (couple of seconds)
    try { cinematic.setResumeBlendSeconds(3.0); } catch (_) {}
    try {
      // Default takes: front 3/4, rear 3/4, side, low front, high front
      cinematic.setTakes([
        { azimuthDeg:   50, elevationDeg: 150, radiusFactor: 1.5, fovDeg: 90, dwellSeconds: 5.5, transitionSeconds: 3 },
        { azimuthDeg:  70, elevationDeg: 70, radiusFactor: 1.9, fovDeg: 40, dwellSeconds: 5.5, transitionSeconds: 3 },
        { azimuthDeg:   100, elevationDeg: 80, radiusFactor: 3, fovDeg: 70, dwellSeconds: 5.0, transitionSeconds: 3 },
        { azimuthDeg:   50, elevationDeg: 100, radiusFactor: 5, fovDeg: 50, dwellSeconds: 6, transitionSeconds: 5 },
        // { azimuthDeg:   25, elevationDeg: 22, radiusFactor: 2.1, fovDeg: 56, dwellSeconds: 4.0, transitionSeconds: 1.4 },
        // { azimuthDeg:   45, elevationDeg: 55, radiusFactor: 2.0, fovDeg: 55, dwellSeconds: 4.0, transitionSeconds: 1.4 },
      ]);
    } catch (_) {}
    // Start with cinematic enabled by default
    try {
      cinematic.enable();
      if (toggleCinematicBtn) toggleCinematicBtn.textContent = 'Stop cinematic camera';
    } catch (_) {}

    // Orbit enable/disable toggle via checkbox
    if (enableOrbitEl) {
      controls.enabled = enableOrbitEl.checked;
      enableOrbitEl.addEventListener('change', () => {
        if (controls) controls.enabled = !!enableOrbitEl.checked;
      });
    }
    // Allow temporary manual orbit while in cinematic mode: pause cinematic when pointer is down,
    // resume with a smooth blend when released.
    try {
      renderer.domElement.addEventListener('pointerdown', () => {
        if (!cinematic) return;
        // Pause cinematic motion but keep it enabled (lights/DOF remain)
        cinematic.setManualControlActive(true);
        if (restartCinematicBtn) restartCinematicBtn.style.display = '';
        if (controls) controls.enabled = true;
      });
      if (restartCinematicBtn) restartCinematicBtn.addEventListener('click', () => {
        if (!cinematic) return;
        // Resume cinematic motion smoothly
        cinematic.setManualControlActive(false);
        if (restartCinematicBtn) restartCinematicBtn.style.display = 'none';
      });
    } catch (_) {}
    if (toggleCinematicBtn) {
      toggleCinematicBtn.addEventListener('click', () => {
        if (!cinematic) return;
        if (cinematic.isEnabled()) {
          cinematic.disable();
          toggleCinematicBtn.textContent = 'Start cinematic camera';
          // Keep main lights active
          try { if (directionalLight) directionalLight.visible = true; } catch (_) {}
          try { if (directionalLight2) directionalLight2.visible = true; } catch (_) {}
          try { if (floorUplight) floorUplight.visible = false; } catch (_) {}
        } else {
          cinematic.enable();
          toggleCinematicBtn.textContent = 'Stop cinematic camera';
          // Ensure both main directional lights are active during cinematic mode
          try { if (directionalLight) directionalLight.visible = true; } catch (_) {}
          try { if (directionalLight2) directionalLight2.visible = true; } catch (_) {}
          try { if (floorUplight) floorUplight.visible = true; } catch (_) {}
        }
      });
    }

    // Lights (setup and UI bindings moved to lights.js)
    const { hemi, ambient, windowHemisphere, directionalLight, directionalLight2, directionalKey, updateLightsOrbit } = initializeLights(scene);
    const { uplight: floorUplight, updateFloorUplight } = createFloorUplight(scene);
    const { showRoomGroup, updateShowRoomLights } = createShowRoomLights(scene);

    // Main lights only; no cinematic-only lights to keep consistent lighting

    // Loading overlay
    overlay = createLoadingOverlay();
    overlay.show();
    overlay.setProgress(0);

    // Load model (from selector if present)
    modelSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('modelSelect'));
    textureTogglesEl = document.getElementById('textureToggles');
    lineColorInputEl = /** @type {HTMLInputElement} */ (document.getElementById('lineColorControl'));
    modelColorInputEl = /** @type {HTMLInputElement} */ (document.getElementById('modelColorControl'));
    logoImageInputEl = /** @type {HTMLInputElement} */ (document.getElementById('logoImageInput'));
    resetLogoBtnEl = /** @type {HTMLButtonElement} */ (document.getElementById('resetLogoBtn'));
    // Logo region controls
    logoRegionFrenteEl = /** @type {HTMLInputElement} */ (document.getElementById('logoRegionFrente'));
    logoRegionTrasEl = /** @type {HTMLInputElement} */ (document.getElementById('logoRegionTras'));
    logoRegionLateral1El = /** @type {HTMLInputElement} */ (document.getElementById('logoRegionLateral1'));
    logoRegionLateral2El = /** @type {HTMLInputElement} */ (document.getElementById('logoRegionLateral2'));
    const initialModelUrl = (modelSelectEl && modelSelectEl.value) || './assets/models/kosha4/teste11.glb';
    console.log('[loader] loading', initialModelUrl);
    loadGltfModel(initialModelUrl, (p) => overlay.setProgress(p), () => overlay.hide());

    // UI events
    // Global model color UI removed
    if (modelSelectEl) {
      modelSelectEl.addEventListener('change', () => {
        if (modelSelectEl) switchModel(modelSelectEl.value);
      });
    }

    if (lineColorInputEl) {
      lineColorInputEl.addEventListener('input', () => {
        const hex = lineColorInputEl.value || '#ffffff';
        applyLineColor(hex);
      });
    }
    if (modelColorInputEl) {
      modelColorInputEl.addEventListener('input', () => {
        const hex = modelColorInputEl.value || '#ffffff';
        // Ensure base color map is disabled so color is visible
        disableMapForSpecificTargetExt(modelRoot);
        applyModelTargetColor(hex);
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
    // Region toggles: apply per-mesh Material 003 map on/off
    const onRegionChange = () => applyLogoRegionsFromUI();
    if (logoRegionFrenteEl) logoRegionFrenteEl.addEventListener('change', onRegionChange);
    if (logoRegionTrasEl) logoRegionTrasEl.addEventListener('change', onRegionChange);
    if (logoRegionLateral1El) logoRegionLateral1El.addEventListener('change', onRegionChange);
    if (logoRegionLateral2El) logoRegionLateral2El.addEventListener('change', onRegionChange);
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
    if (scenarioSelect) {
      scenarioSelect.addEventListener('change', () => {
        setScenarioManaged(scenarioSelect.value);
        // after scenario changes, keep orbit target centered on model
        if (modelRoot) updateControlsTargetFromObject(camera, controls, modelRoot);
        // For sci‑fi garage, also snap immediately using validated constants
        if (modelRoot && scenarioSelect.value === 'sci-fi_garage') {
          try { snapModelToScenarioFloor(); } catch (_) {}
        }
        // Toggle showroom lights visibility per scenario (only in Show Room)
        try { if (showRoomGroup) showRoomGroup.visible = (scenarioSelect.value === 'sci-fi_garage'); } catch (_) {}
      });
    }
    // Floor plane is always hidden now
    if (floorMesh) floorMesh.visible = false;

    // Vertical offset UI removed; keep defaults and programmatic snapping only
    yOffsetRange = null; yOffsetValue = null; nudgeDownBtn = null; nudgeUpBtn = null; saveScenarioOffsetBtn = null;

    // Remove position readouts and manual nudge controls
    const zoomInBtn = /** @type {HTMLButtonElement} */ (document.getElementById('zoomInBtn'));
    const zoomOutBtn = /** @type {HTMLButtonElement} */ (document.getElementById('zoomOutBtn'));

    function updateReadoutsLocal() { /* removed UI */ }
    updateReadouts = updateReadoutsLocal;
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
    // Update lights orbiting (use fixed timestep ~16ms)
    try { updateLightsOrbit && updateLightsOrbit(0.016, modelRoot); } catch (_) {}
    try { updateFloorUplight && updateFloorUplight(modelRoot); } catch (_) {}
    try { updateShowRoomLights && updateShowRoomLights(0.016, modelRoot); } catch (_) {}
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
          if (typeof path === 'string' && path.includes('assets/models/kosha4/')) {
            // Kosha4: full per-material controls
            removeDefaultTextureMapsFromModel(false);
            applyColorToModel('#ffffff');
            buildMaterialRegistry();
            populateTextureTogglesFromMaterialRegistry();
            // Apply initial line color if control exists
            if (lineColorInputEl) applyLineColor(lineColorInputEl.value || '#ffffff');
            // Apply initial model color for specific target if control exists
            if (modelColorInputEl) applyModelTargetColor(modelColorInputEl.value || '#ffffff');
            // Apply logo regions UI state if present
            applyLogoRegionsFromUI();
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

  // Apply color only to the material named exactly 'LINHAS • Linha'
  function applyLineColor(hex) {
    if (!modelRoot) return;
    try {
      const norm = (s) => (s || '').toString().trim().toLowerCase();
      modelRoot.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const meshName = norm(child.name);
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (!m || typeof m.name !== 'string') continue;
          const matName = norm(m.name);
          const isTargetMesh = meshName === 'linhas' || meshName.includes('linhas');
          const isTargetMat = matName === 'linha' || /^linha\b/.test(matName);
          if (isTargetMesh && isTargetMat && m.color) {
            m.color.set(hex);
            m.needsUpdate = true;
          }
        }
      });
    } catch (_) { /* ignore */ }
  }

  // Apply solid color to all materials
  function applyColorToModel(hex) { applyColorToModelExt(modelRoot, hex); }

  // Apply color to the specific target (CUBE001 - Material.002)
  function applyModelTargetColor(hex) { applyColorToSpecificTargetExt(modelRoot, hex); }

  // Build a registry of unique material instances for per-material control
  function buildMaterialRegistry() {
    materialRegistry = buildMaterialRegistryExt(modelRoot) || [];
  }

  function populateTextureTogglesFromMaterialRegistry() {
    populateTextureTogglesFromMaterialRegistryExt(textureTogglesEl, materialRegistry);
  }

  // ===== Logo Regions: enable/disable Material 003 per mesh =====
  const regionNameMap = {
    frente: /\bcube[\s._-]*0*04(?!\d)/i,
    tras: /\bcube[\s._-]*0*03(?!\d)/i,
    lateral1: /\bcube[\s._-]*0*02(?!\d)/i,
    lateral2: /^\s*cube\s*$/i,
  };

  function setMaterial003EnabledOnMesh(mesh, enabled) {
    if (!mesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m || typeof m.name !== 'string') continue;
      const isMat003 = /material[\s._-]*0*03/i.test(m.name);
      if (!isMat003) continue;
      // Ensure per-mesh isolation so toggling visibility doesn't affect other meshes
      if (!m.userData || !m.userData._clonedForLogoRegion) {
        const cloned = m.clone();
        cloned.userData = { ...(m.userData || {}), _clonedForLogoRegion: true };
        if (Array.isArray(mesh.material)) mesh.material[i] = cloned; else mesh.material = cloned;
      }
      const mat = Array.isArray(mesh.material) ? mesh.material[i] : mesh.material;
      mat.visible = !!enabled; // only affect visualization, keep maps intact
      mat.needsUpdate = true;
    }
  }

  function applyLogoRegionsFromUI() {
    if (!modelRoot) return;
    const frenteOn = logoRegionFrenteEl ? !!logoRegionFrenteEl.checked : true;
    const trasOn = logoRegionTrasEl ? !!logoRegionTrasEl.checked : true;
    const lat1On = logoRegionLateral1El ? !!logoRegionLateral1El.checked : true;
    const lat2On = logoRegionLateral2El ? !!logoRegionLateral2El.checked : true;
    const norm = (s) => (s || '').toString();
    modelRoot.traverse((child) => {
      if (!child.isMesh) return;
      const name = norm(child.name);
      // Some exporters use uppercase/lowercase variations; normalize for regex test
      const lname = name.toLowerCase();
      if (regionNameMap.frente.test(name)) setMaterial003EnabledOnMesh(child, frenteOn);
      else if (regionNameMap.tras.test(name)) setMaterial003EnabledOnMesh(child, trasOn);
      else if (regionNameMap.lateral1.test(name)) setMaterial003EnabledOnMesh(child, lat1On);
      else if (regionNameMap.lateral2.test(name)) setMaterial003EnabledOnMesh(child, lat2On);
    });
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
    floorMesh.visible = false; // keep disabled in UI
    floorMesh.scale.set(scaledSizeX, scaledSizeZ, 1);
    floorMesh.position.set(center.x, floorY, center.z);
  }


  function snapModelToScenarioFloor() {
    if (!modelRoot) return;
    const scenarioKey = scenarioManager?.getCurrentScenarioKey?.();
    // Sci‑fi garage: use validated placement constants supplied
    if (scenarioKey === 'sci-fi_garage') {
      modelRoot.position.set(0, -0.54391561635228, 0);
      // Baseline after contact should equal current world Y
      modelYOffsetBase = -0.54391561635228;
      updateFloorUnderModel();
      frameObject3D(modelRoot);
      updateControlsTargetFromModel();
      return;
    }
    // 1) Find scenario floor Y using a downward ray from above the model center
    const box = new THREE.Box3().setFromObject(modelRoot);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const raycaster = new THREE.Raycaster();
    let rayOrigin;
    let rayDirection;
    if (scenarioKey === 'sci-fi_garage') {
      // Cast DOWN from just below the model to find the first surface beneath it (platform)
      rayOrigin = new THREE.Vector3(center.x, box.min.y - 0.01, center.z);
      rayDirection = new THREE.Vector3(0, -1, 0);
    } else {
      // Default: cast UP from below to intersect helper floor plane
      rayOrigin = new THREE.Vector3(center.x, box.min.y - 1000, center.z);
      rayDirection = new THREE.Vector3(0, 1, 0);
    }
    raycaster.set(rayOrigin, rayDirection);

    const candidates = [];
    const scenarioRoot = scenarioManager?.getScenarioRoot?.();
    // For sci-fi garage, prefer scenario geometry for accurate floor snap
    if (scenarioKey === 'sci-fi_garage' && scenarioRoot) {
      candidates.push(scenarioRoot);
    } else if (floorMesh && floorMesh.visible) {
      candidates.push(floorMesh);
    }
    if (candidates.length === 0) return;

    const intersections = raycaster.intersectObjects(candidates, true);
    if (!intersections.length) return;
    let hit = intersections[0];
    if (scenarioKey === 'sci-fi_garage') {
      // Choose the closest upward-facing hit that is below the model bottom
      for (const i of intersections) {
        const below = i.point.y <= box.min.y + 0.05;
        const face = i.face;
        let up = false;
        if (face) {
          const n = face.normal.clone();
          i.object.updateMatrixWorld(true);
          n.transformDirection(i.object.matrixWorld);
          up = n.y > 0.3;
        }
        if (below && up) { hit = i; break; }
      }
    }
    let targetY = hit.point.y;
    if (scenarioKey === 'sci-fi_garage') {
      // Fine-tuned lift so the model rests on the platform without floating
      targetY += 0.025;
    }

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
              // Place to validated pose first
              modelRoot.position.set(0, -0.54391561635228, 0);
              modelYOffsetBase = -0.54391561635228;
              updateFloorUnderModel();
              // Delay snap slightly to ensure scenario meshes are ready
              setTimeout(() => { try { snapModelToScenarioFloor(); } catch (_) {} }, 350);
            } else {
              snapModelToScenarioFloor();
            }
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


