import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
 
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

(function () {
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
  /** @type {HTMLInputElement} */
  let colorInputEl;
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
  /** @type {string} */
  let currentColorHex = '#38bdf8';
  
  let isModelSpinning = false;
  /** @type {OrbitControls | null} */
  let controls = null;
  /** @type {THREE.Mesh | null} */
  let floorMesh = null;
  /** @type {THREE.Group | null} */
  let scenarioRoot = null;
  // Cinematic camera state
  let composer = null; // EffectComposer
  let renderPass = null; // RenderPass
  let bokehPass = null; // BokehPass
  let cinematicEnabled = false;
  let cinematicTime = 0;
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
  /** @type {THREE.Object3D | null} */
  let regionGroup = null;
  /** @type {THREE.MeshStandardMaterial} */
  let regionHighlightMaterial = new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.35 });
  /** @type {THREE.Object3D | null} */
  let activeRegion = null;
  /** @type {Record<string, THREE.Mesh[]>} */
  let regionNameToMeshes = {};
  /** @type {string} */
  let activeRegionKey = 'none';
  /** @type {Record<string, THREE.Mesh[]>} */
  let regionKeyToDecals = {}; // store decal meshes per region for cleanup
  /** @type {HTMLElement | null} */
  let loadingOverlayEl = null;
  /** @type {HTMLElement | null} */
  let loadingTextEl = null;
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

  function initialize() {
    console.log('[init] starting');
    // DOM refs
    viewportEl = document.getElementById('viewport');
    colorInputEl = /** @type {HTMLInputElement} */ (document.getElementById('colorControl'));
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

    // Camera
    const fieldOfView = 60;
    const { width: vw, height: vh } = getViewportSize();
    const aspectRatio = vw / vh;
    const nearPlane = 0.1;
    const farPlane = 100;
    camera = new THREE.PerspectiveCamera(fieldOfView, aspectRatio, nearPlane, farPlane);
    camera.position.set(0, 0, 3);
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

    // Basic orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 0.2;
    controls.maxDistance = 100;
    // Gentler zoom for trackpads
    controls.zoomSpeed = 0.35;
    if ('zoomToCursor' in controls) controls.zoomToCursor = true;
    // Prevent flipping upside down by clamping polar angle (vertical tilt)
    controls.minPolarAngle = THREE.MathUtils.degToRad(15); // don't look straight down
    controls.maxPolarAngle = THREE.MathUtils.degToRad(75); // keep camera above horizon
    controls.screenSpacePanning = false; // keep world-up stable
    if (enableOrbitEl) {
      controls.enabled = enableOrbitEl.checked;
      enableOrbitEl.addEventListener('change', () => {
        if (controls) controls.enabled = !!enableOrbitEl.checked;
      });
    }
    if (toggleCinematicBtn) {
      toggleCinematicBtn.addEventListener('click', () => {
        cinematicEnabled = !cinematicEnabled;
        if (bokehPass) bokehPass.enabled = cinematicEnabled;
        toggleCinematicBtn.textContent = cinematicEnabled ? 'Stop cinematic camera' : 'Start cinematic camera';
        cinematicTime = 0;
      });
    }

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 0.6);
    scene.add(hemi);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(3, 5, 2);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Loading overlay refs
    loadingOverlayEl = document.getElementById('loadingOverlay');
    loadingTextEl = document.getElementById('loadingText');
    const showLoading = () => { if (loadingOverlayEl) loadingOverlayEl.style.display = 'flex'; };
    const hideLoading = () => { if (loadingOverlayEl) loadingOverlayEl.style.display = 'none'; };
    const setLoadingProgress = (pct) => { if (loadingTextEl) loadingTextEl.textContent = `Loading… ${Math.max(0, Math.min(100, Math.round(pct)))}%`; };
    showLoading();
    setLoadingProgress(0);

    // Load model (from selector if present)
    modelSelectEl = /** @type {HTMLSelectElement} */ (document.getElementById('modelSelect'));
    textureTogglesEl = document.getElementById('textureToggles');
    logoImageInputEl = /** @type {HTMLInputElement} */ (document.getElementById('logoImageInput'));
    resetLogoBtnEl = /** @type {HTMLButtonElement} */ (document.getElementById('resetLogoBtn'));
    const initialModelUrl = (modelSelectEl && modelSelectEl.value) || '/assets/models/covered_car/scene.gltf';
    console.log('[loader] loading', initialModelUrl);
    loadGltfModel(initialModelUrl, setLoadingProgress, hideLoading);

    // UI events
    if (colorInputEl) {
      colorInputEl.addEventListener('input', (e) => {
        const value = colorInputEl.value; // hex like #rrggbb
        currentColorHex = value;
        applyColorToModel(currentColorHex);
      });
    }
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

    // Light controls
    const hemiIntensity = /** @type {HTMLInputElement} */ (document.getElementById('hemiIntensity'));
    const hemiSky = /** @type {HTMLInputElement} */ (document.getElementById('hemiSky'));
    const hemiGround = /** @type {HTMLInputElement} */ (document.getElementById('hemiGround'));
    const dirIntensity = /** @type {HTMLInputElement} */ (document.getElementById('dirIntensity'));
    const dirColor = /** @type {HTMLInputElement} */ (document.getElementById('dirColor'));
    const dirAzimuth = /** @type {HTMLInputElement} */ (document.getElementById('dirAzimuth'));
    const dirElevation = /** @type {HTMLInputElement} */ (document.getElementById('dirElevation'));

    if (hemiIntensity) hemiIntensity.addEventListener('input', () => { hemi.intensity = Number(hemiIntensity.value); });
    if (hemiSky) hemiSky.addEventListener('input', () => { hemi.color.set(hemiSky.value); });
    if (hemiGround) hemiGround.addEventListener('input', () => { hemi.groundColor.set(hemiGround.value); });
    if (dirIntensity) dirIntensity.addEventListener('input', () => { directionalLight.intensity = Number(dirIntensity.value); });
    if (dirColor) dirColor.addEventListener('input', () => { directionalLight.color.set(dirColor.value); });
    function updateDirPositionFromAngles() {
      const az = (Number(dirAzimuth?.value || '35') * Math.PI) / 180;
      const el = (Number(dirElevation?.value || '50') * Math.PI) / 180;
      const r = 10;
      const x = Math.cos(el) * Math.cos(az) * r;
      const y = Math.sin(el) * r;
      const z = Math.cos(el) * Math.sin(az) * r;
      directionalLight.position.set(x, y, z);
    }
    if (dirAzimuth) dirAzimuth.addEventListener('input', updateDirPositionFromAngles);
    if (dirElevation) dirElevation.addEventListener('input', updateDirPositionFromAngles);
    updateDirPositionFromAngles();

    // Scenario controls
    const scenarioSelect = /** @type {HTMLSelectElement} */ (document.getElementById('scenarioSelect'));
    const showFloorCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('showFloor'));
    if (scenarioSelect) {
      scenarioSelect.addEventListener('change', () => {
        setScenario(scenarioSelect.value);
        // after scenario changes, keep orbit target centered on model
        updateControlsTargetFromModel();
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
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyZoomDelta(-0.2));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyZoomDelta(+0.2));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'PageUp') { nudgeY(e.shiftKey ? +0.001 : e.altKey ? +0.1 : +0.01); e.preventDefault(); }
      if (e.code === 'PageDown') { nudgeY(e.shiftKey ? -0.001 : e.altKey ? -0.1 : -0.01); e.preventDefault(); }
    });
    updateReadoutsLocal();

    // Region mapping UI
    const regionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('regionSelect'));
    if (regionSelect) {
      regionSelect.addEventListener('change', () => {
        setActiveRegion(regionSelect.value);
      });
    }
    // Region color control
    const regionColorEl = /** @type {HTMLInputElement} */ (document.getElementById('regionColor'));
    if (regionColorEl) {
      regionColorEl.addEventListener('input', () => {
        applyColorToRegion(regionColorEl.value);
      });
    }
    // Decal image upload
    const decalInput = /** @type {HTMLInputElement} */ (document.getElementById('decalImage'));
    const clearRegionImageBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clearRegionImageBtn'));
    if (decalInput) {
      decalInput.addEventListener('change', async () => {
        const file = decalInput.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        await applyDecalToActiveRegion(url);
        URL.revokeObjectURL(url);
      });
    }
    if (clearRegionImageBtn) {
      clearRegionImageBtn.addEventListener('click', () => clearRegionDecals());
    }

    // Resize handling
    window.addEventListener('resize', onWindowResize);

    // Start loop
    requestAnimationFrame(animate);
  }

  // Zoom helper using spherical distance to target
  function applyZoomDelta(factor = -0.2) {
    if (!controls) return;
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const distance = offset.length();
    const radius = Math.max(1e-6, distance * (1 + factor));
    const clamped = Math.min(Math.max(radius, controls.minDistance), controls.maxDistance);
    offset.setLength(clamped);
    camera.position.copy(new THREE.Vector3().addVectors(controls.target, offset));
    camera.updateProjectionMatrix();
    controls.update();
  }

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
      enforceCameraDistanceClamp();
    }
    if (cinematicEnabled) {
      animateCinematicCamera();
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);
  }

  function animateCinematicCamera() {
    if (!modelRoot || !controls) return;
    cinematicTime += 0.016; // approx; actual frame delta is not critical for smoothness here
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const forwardSign = inferForwardSign();

    // Cinematic orbit using spherical coordinates with polar clamp (never flips)
    const r = radius * 1.1;
    const theta = cinematicTime * 0.25; // azimuth
    const basePhi = THREE.MathUtils.degToRad(50); // polar angle from +Y
    const phi = THREE.MathUtils.clamp(basePhi + Math.sin(cinematicTime * 0.4) * THREE.MathUtils.degToRad(6),
      THREE.MathUtils.degToRad(20), THREE.MathUtils.degToRad(70));
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const x = center.x + r * sinPhi * Math.cos(theta);
    const z = center.z + r * sinPhi * Math.sin(theta) * forwardSign;
    const y = center.y + r * cosPhi;
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0); // lock roll
    camera.lookAt(center);

    // Angled lens look via FOV and slight roll
    const baseFov = 55;
    camera.fov = baseFov + Math.sin(cinematicTime * 0.6) * 6;
    camera.updateProjectionMatrix();
    // No roll to avoid upside-down feelings
    camera.rotation.z = 0;

    // Update DOF focus to the subject
    if (bokehPass) {
      const dist = camera.position.distanceTo(center);
      bokehPass.materialBokeh.uniforms['focus'].value = dist * 0.9;
      bokehPass.materialBokeh.uniforms['aperture'].value = 0.00035; // stronger bokeh
      bokehPass.materialBokeh.uniforms['maxblur'].value = 0.015;
    }
  }

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
          const isKosha2 = typeof path === 'string' && path.includes('/assets/models/kosha2/');
          const isKosha3 = typeof path === 'string' && path.includes('/assets/models/kosha3/');
          if (isKosha2) {
            applyBakedTextureToModel('/assets/models/kosha2/light_bake.png');
            populateTextureTogglesFromModel({ baked: true });
          } else if (isKosha3) {
            // Kosha3: expose per-material texture maps for toggling
            removeDefaultTextureMapsFromModel(false); // keep existing maps
            applyColorToModel('#ffffff');
            populateTextureTogglesFromModel({ baked: false, fromMaterials: true });
          } else if (typeof path === 'string' && path.includes('/assets/models/kosha4/')) {
            // Kosha4: full per-material controls
            removeDefaultTextureMapsFromModel(false);
            applyColorToModel('#ffffff');
            buildMaterialRegistry();
            populateTextureTogglesFromMaterialRegistry();
          } else {
            removeDefaultTextureMapsFromModel(true);
            applyColorToModel(currentColorHex);
          }
        } catch (e) { /* non-fatal */ }
        
        frameObject3D(modelRoot);
        
        onProgress?.(85);
        // After model is ready, load default scenario if any
        if (currentScenarioKey && currentScenarioKey !== 'none') {
          setScenario(currentScenarioKey, onProgress, onDone);
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
    // Clear region helpers and decals
    if (regionGroup) { scene.remove(regionGroup); regionGroup = null; }
    activeRegion = null;
    activeRegionKey = 'none';
    regionNameToMeshes = {};
    regionKeyToDecals = {};
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
    if (loadingOverlayEl) loadingOverlayEl.style.display = 'flex';
    if (loadingTextEl) loadingTextEl.textContent = 'Loading… 0%';

    // Dispose previous model
    disposeModel();

    // Choose proper loader based on file extension
    const lower = url.toLowerCase();
    const isGlb = lower.endsWith('.glb');
    const isGltf = lower.endsWith('.gltf');
    const progress = (p) => { if (loadingTextEl) loadingTextEl.textContent = `Loading… ${Math.round(p)}%`; };
    const done = () => { if (loadingOverlayEl) loadingOverlayEl.style.display = 'none'; };

    if (isGlb || isGltf) {
      loadGltfModel(url, progress, done);
    } else {
      console.warn('[switchModel] unsupported format for', url);
      done();
    }
  }

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
  function removeDefaultTextureMapsFromModel(remove = true) {
    if (!modelRoot) return;
    modelRoot.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (!m) continue;
        if (remove && 'map' in m && m.map) { m.map = null; m.needsUpdate = true; }
      }
    });
  }

  // Apply a single baked texture to all meshes of the current model
  function applyBakedTextureToModel(textureUrl) {
    if (!modelRoot) return;
    const texLoader = new THREE.TextureLoader();
    texLoader.load(
      textureUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        modelRoot.traverse((child) => {
          if (!child.isMesh || !child.material) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (let i = 0; i < materials.length; i++) {
            const m = materials[i];
            if (!m) continue;
            if (!m.userData || !m.userData._clonedForBaked) {
              const cloned = m.clone();
              cloned.userData = { ...(m.userData || {}), _clonedForBaked: true };
              if (Array.isArray(child.material)) materials[i] = cloned; else child.material = cloned;
            }
          }
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mm of mats) {
            if (!mm) continue;
            if ('map' in mm) mm.map = tex;
            if ('color' in mm) mm.color.set('#ffffff');
            mm.needsUpdate = true;
          }
        });
      },
      undefined,
      (err) => {
        console.warn('[texture] failed to load', textureUrl, err);
      }
    );
  }

  // Build texture toggles UI by inspecting materials of the current model.
  // Supports standard maps: map, normalMap, roughnessMap, metalnessMap, aoMap, emissiveMap.
  function populateTextureTogglesFromModel(opts = { baked: false, fromMaterials: true }) {
    if (!textureTogglesEl) return;
    while (textureTogglesEl.firstChild) textureTogglesEl.removeChild(textureTogglesEl.firstChild);

    const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
    /** @type {Record<string, boolean>} */
    const hasKey = Object.create(null);

    // Discover which keys exist
    if (modelRoot && opts.fromMaterials) {
      modelRoot.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          if (!m) continue;
          for (const k of textureKeys) hasKey[k] = hasKey[k] || !!m[k];
        }
      });
    }

    // If baked only, at least expose 'map'
    if (opts.baked) hasKey['map'] = true;

    const keys = textureKeys.filter((k) => hasKey[k]);
    if (!keys.length) {
      const hint = document.createElement('div');
      hint.style.fontSize = '12px';
      hint.style.opacity = '0.8';
      hint.textContent = 'No texture maps detected for this model.';
      textureTogglesEl.appendChild(hint);
      return;
    }

    const makeRow = (key, label, checked) => {
      const row = document.createElement('div');
      row.className = 'control';
      const id = `tex-${key}`;
      const lbl = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = checked;
      lbl.htmlFor = id;
      lbl.textContent = `${label}`;
      row.appendChild(lbl);
      row.appendChild(input);
      input.addEventListener('change', () => toggleTextureMapEnabled(key, input.checked));
      textureTogglesEl.appendChild(row);
    };

    for (const k of keys) {
      const pretty = k
        .replace('Map', '')
        .replace(/^./, (c) => c.toUpperCase())
        .replace('Ao', 'AO');
      // Enabled if any mesh currently has this map set
      let enabled = false;
      if (modelRoot) {
        modelRoot.traverse((child) => {
          if (!child.isMesh || !child.material) return;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) enabled = enabled || !!m[k];
        });
      }
      makeRow(k, `${pretty} map`, enabled);
    }
  }

  function toggleTextureMapEnabled(key, enabled) {
    if (!modelRoot) return;
    modelRoot.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        // Ensure unique material instance per mesh when we first toggle
        if (!m.userData || !m.userData._clonedForToggle) {
          const cloned = m.clone();
          cloned.userData = { ...(m.userData || {}), _clonedForToggle: true };
          if (Array.isArray(child.material)) mats[i] = cloned; else child.material = cloned;
        }
      }
      const arr = Array.isArray(child.material) ? child.material : [child.material];
      for (const mm of arr) {
        if (!mm) continue;
        if (enabled) {
          // no-op: keep whatever map it originally had
          // if model was baked kosha2, enabling 'map' retains baked texture already applied
        } else {
          if (key in mm) {
            mm[key] = null;
            mm.needsUpdate = true;
          }
        }
      }
    });
  }

  // Replace/reset base color map for materials named "Material 003" (e.g., "Material 003", "Material.003")
  /** @type {Map<any, any>} */
  const material003OriginalMaps = new Map();
  /** @type {Map<any, any>} */
  const material003OriginalImages = new Map();
  async function replaceMaterial003BaseMap(imageUrl) {
    if (!modelRoot) return;
    // Load the uploaded image once; we will composite it into each mesh's
    // original base map using that mesh's UV bounds so placement is correct.
    const uploadedImg = await loadImageElement(imageUrl);
    // Match "Material 003", "Material.003", "Material-003", etc.
    const re = /material[\s._-]*0*03/i;
    modelRoot.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        const name = (m.name || '').toString();
        if (!re.test(name)) continue;
        // Ensure unique instance before modifying
        if (!m.userData || !m.userData._clonedForLogo) {
          const cloned = m.clone();
          cloned.userData = { ...(m.userData || {}), _clonedForLogo: true };
          if (Array.isArray(child.material)) mats[i] = cloned; else child.material = cloned;
        }
        const mat = Array.isArray(child.material) ? child.material[i] : child.material;
        const original = mat.map || null;
        if (!material003OriginalMaps.has(mat)) material003OriginalMaps.set(mat, original);

        // If there is an original texture with an image, composite the logo into
        // that texture at the UV bounds for this mesh + material index. This keeps
        // size/position/orientation correct across different atlas layouts.
        if (original && original.image && child.geometry?.attributes?.uv) {
          try {
            // If UV island is tiny, create a dedicated high-resolution texture and
            // retarget repeat/offset so the logo has usable resolution.
            const rawUv = computeRawUvBoundsForMaterial(child, i);
            const texW = original.image?.width || 1024;
            const texH = original.image?.height || 1024;
            const islandPxW = rawUv ? Math.round(Math.abs(rawUv.maxU - rawUv.minU) * texW) : 0;
            const islandPxH = rawUv ? Math.round(Math.abs(rawUv.maxV - rawUv.minV) * texH) : 0;
            const tinyIsland = islandPxW * islandPxH > 0 && (islandPxW < 64 || islandPxH < 64);

            let composed;
            if (tinyIsland) {
              // Build a standalone 512x512 texture with the logo centered
              const side = 512;
              const aux = document.createElement('canvas');
              aux.width = side; aux.height = side;
              const c2 = aux.getContext('2d');
              if (!c2) throw new Error('Canvas 2D context not available');
              c2.clearRect(0, 0, side, side);
              const s = Math.min(side / uploadedImg.width, side / uploadedImg.height);
              const dw = Math.round(uploadedImg.width * s);
              const dh = Math.round(uploadedImg.height * s);
              c2.drawImage(uploadedImg, Math.round((side - dw) / 2), Math.round((side - dh) / 2), dw, dh);
              composed = aux;
            } else {
              composed = composeLogoIntoOriginalTexture({
                mesh: child,
                materialIndex: i,
                originalTexture: original,
                logoImage: uploadedImg,
              });
            }
            if (tinyIsland) {
              // Use a dedicated texture so repeat/offset changes don't affect siblings
              const newTex = new THREE.CanvasTexture(composed);
              newTex.colorSpace = THREE.SRGBColorSpace;
              newTex.anisotropy = Math.max(8, original.anisotropy || 1);
              newTex.flipY = typeof original.flipY === 'boolean' ? original.flipY : true;
              newTex.minFilter = original.minFilter ?? THREE.LinearMipmapLinearFilter;
              newTex.magFilter = original.magFilter ?? THREE.LinearFilter;
              newTex.wrapS = original.wrapS ?? THREE.ClampToEdgeWrapping;
              newTex.wrapT = original.wrapT ?? THREE.ClampToEdgeWrapping;
              newTex.generateMipmaps = true;
              newTex.needsUpdate = true;
              copyTextureTransform(original, newTex);
              mat.map = newTex;
            } else {
              // Mutate the original shared texture image so sampling region stays intact
              try {
                if (!material003OriginalImages) { /* declared below */ }
              } catch (_) {}
              if (!material003OriginalImages.has(original)) material003OriginalImages.set(original, original.image);
              original.image = composed;
              original.needsUpdate = true;
              mat.map = original;
            }
            if (tinyIsland && rawUv) {
              // Retarget repeat/offset so the 0..1 UV range maps to the raw island rect
              const du = Math.max(1e-6, Math.abs(rawUv.maxU - rawUv.minU));
              const dv = Math.max(1e-6, Math.abs(rawUv.maxV - rawUv.minV));
              mat.map.repeat.set(du, dv);
              mat.map.offset.set(rawUv.minU, rawUv.minV);
              mat.map.rotation = 0;
              mat.map.center.set(0, 0);
              mat.map.needsUpdate = true;
              console.log('[logo] tiny island upscale', { mesh: child.name, material: mat.name, islandPxW, islandPxH, repeat: mat.map.repeat.toArray(), offset: mat.map.offset.toArray() });
            }
            // Force material to recompile if necessary
            mat.needsUpdate = true;
            console.log('[logo] applied to material', { mesh: child.name, materialName: mat.name, method: 'uv-composite' });
          } catch (e) {
            // Fallback: if anything goes wrong, use the centered 1200x1200 canvas path
            const baseTex = new THREE.CanvasTexture(createSquareFitCanvas(uploadedImg, 1200));
            baseTex.colorSpace = THREE.SRGBColorSpace;
            baseTex.anisotropy = 8;
            baseTex.flipY = typeof original?.flipY === 'boolean' ? original.flipY : true;
            baseTex.generateMipmaps = true;
            baseTex.needsUpdate = true;
            if (original) copyTextureTransform(original, baseTex);
            mat.map = baseTex;
            console.warn('[logo] fallback canvas used for', { mesh: child.name, materialName: mat.name, error: String(e) });
          }
        } else {
          // No original texture/image; fallback to centered 1200x1200 canvas
          const baseTex = new THREE.CanvasTexture(createSquareFitCanvas(uploadedImg, 1200));
          baseTex.colorSpace = THREE.SRGBColorSpace;
          baseTex.anisotropy = 8;
          baseTex.flipY = true;
          baseTex.generateMipmaps = true;
          baseTex.needsUpdate = true;
          if (original) copyTextureTransform(original, baseTex);
          mat.map = baseTex;
          console.log('[logo] applied to material', { mesh: child.name, materialName: mat.name, method: 'fallback-square' });
        }
        if ('color' in mat) mat.color.set('#ffffff');
        mat.needsUpdate = true;
        
      }
    });
  }

  function restoreMaterial003BaseMap() {
    if (!modelRoot) return;
    const re = /material[\s._-]*0*03/i;
    modelRoot.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        const name = (m.name || '').toString();
        if (!re.test(name)) continue;
        const original = material003OriginalMaps.get(m);
        if (original !== undefined) {
          m.map = original;
          m.needsUpdate = true;
        }
        if (m.map && material003OriginalImages.has(m.map)) {
          const img = material003OriginalImages.get(m.map);
          m.map.image = img;
          m.map.needsUpdate = true;
        }
      }
    });
    material003OriginalMaps.clear();
    material003OriginalImages.clear();
  }

  function copyTextureTransform(src, dst) {
    try {
      if (src.offset && dst.offset) dst.offset.copy(src.offset);
      if (src.repeat && dst.repeat) dst.repeat.copy(src.repeat);
      if (typeof src.rotation === 'number') dst.rotation = src.rotation;
      if (src.center && dst.center) dst.center.copy(src.center);
      if (typeof src.matrixAutoUpdate === 'boolean') dst.matrixAutoUpdate = src.matrixAutoUpdate;
      if (src.matrix && dst.matrix && typeof src.matrix.copy === 'function') {
        dst.matrix.copy(src.matrix);
      }
      if (typeof src.wrapS === 'number') dst.wrapS = src.wrapS;
      if (typeof src.wrapT === 'number') dst.wrapT = src.wrapT;
      if (typeof src.minFilter === 'number') dst.minFilter = src.minFilter;
      if (typeof src.magFilter === 'number') dst.magFilter = src.magFilter;
      if (typeof src.anisotropy === 'number') dst.anisotropy = Math.max(dst.anisotropy, src.anisotropy);
      dst.needsUpdate = true;
    } catch (_) { /* ignore */ }
  }

  // Helper: load an HTMLImageElement
  async function loadImageElement(url) {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  // Helper: create a square canvas that fits the image (no rotation)
  function createSquareFitCanvas(img, size = 1200) {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    ctx.clearRect(0, 0, size, size);
    const scale = Math.min(size / img.width, size / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    ctx.drawImage(img, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);
    return canvas;
  }

  // Compute the UV bounds in texture space (after applying texture transform)
  function computeUvBoundsForMaterial(mesh, materialIndex, texture) {
    const geom = mesh.geometry;
    const uvAttr = geom?.attributes?.uv;
    if (!uvAttr) return null;

    const applyTransform = (u, v) => {
      // rotation around center, then repeat and offset (mirrors three.js usage)
      let uu = u, vv = v;
      const center = texture.center || new THREE.Vector2(0, 0);
      const rot = texture.rotation || 0;
      if (rot) {
        const x = uu - center.x;
        const y = vv - center.y;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        uu = x * cos - y * sin + center.x;
        vv = x * sin + y * cos + center.y;
      }
      const rep = texture.repeat || new THREE.Vector2(1, 1);
      const off = texture.offset || new THREE.Vector2(0, 0);
      uu = uu * rep.x + off.x;
      vv = vv * rep.y + off.y;
      return [uu, vv];
    };

    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    const index = geom.index ? geom.index.array : null;
    let processed = 0;
    const groups = Array.isArray(geom.groups) && geom.groups.length ? geom.groups : [{ start: 0, count: (index ? index.length : uvAttr.count), materialIndex: materialIndex }];
    for (const g of groups) {
      if (typeof g.materialIndex === 'number' && g.materialIndex !== materialIndex) continue;
      const start = g.start || 0;
      const count = g.count || 0;
      // Iterate triangle vertices within group
      for (let a = start; a < start + count; a++) {
        const vi = index ? index[a] : a;
        if (vi == null) continue;
        const u = uvAttr.getX(vi);
        const v = uvAttr.getY(vi);
        const [uu, vv] = applyTransform(u, v);
        if (uu < minU) minU = uu; if (uu > maxU) maxU = uu;
        if (vv < minV) minV = vv; if (vv > maxV) maxV = vv;
        processed++;
      }
    }
    if (!processed || !isFinite(minU) || !isFinite(minV) || !isFinite(maxU) || !isFinite(maxV)) return null;
    return { minU, minV, maxU, maxV };
  }

  // Compose the uploaded logo into the original texture at the mesh's UV rect
  function composeLogoIntoOriginalTexture({ mesh, materialIndex, originalTexture, logoImage }) {
    const img = originalTexture.image;
    const width = img.width || img.videoWidth || 0;
    const height = img.height || img.videoHeight || 0;
    if (!width || !height) throw new Error('Original texture image not ready');

    const bounds = computeUvBoundsForMaterial(mesh, materialIndex, originalTexture);
    if (!bounds) throw new Error('UV bounds unavailable');
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const minU = clamp01(bounds.minU), minV = clamp01(bounds.minV);
    const maxU = clamp01(bounds.maxU), maxV = clamp01(bounds.maxV);

    // Convert to pixel rect (treat V as bottom-up to match image top-left origin)
    const rectX = Math.round(minU * width);
    const rectY = Math.round((1 - maxV) * height);
    const rectW = Math.max(1, Math.round((maxU - minU) * width));
    const rectH = Math.max(1, Math.round((maxV - minV) * height));

    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    // Draw the original texture first
    ctx.drawImage(img, 0, 0, width, height);

    // Within that UV rectangle, detect the salient logo region by color difference from borders
    // If the rect is degenerate (too tiny), expand a minimal area to ensure visibility
    const safeRectW = Math.max(8, rectW);
    const safeRectH = Math.max(8, rectH);
    const safeRectX = Math.max(0, Math.min(width - safeRectW, rectX));
    const safeRectY = Math.max(0, Math.min(height - safeRectH, rectY));
    const sub = ctx.getImageData(safeRectX, safeRectY, safeRectW, safeRectH);
    const bg = estimateBackgroundColorFromBorder(sub);
    const mask = buildForegroundMask(sub, bg, 28); // threshold in RGB distance
    const bbox = largestMaskBoundingBox(mask);
    // Choose target rect: detected bbox or full rect fallback
    const target = bbox || { x: 0, y: 0, w: safeRectW, h: safeRectH };

    // Fit the logo proportionally into the target rect
    const scale = Math.min(target.w / logoImage.width, target.h / logoImage.height);
    const drawW = Math.max(1, Math.round(logoImage.width * scale));
    const drawH = Math.max(1, Math.round(logoImage.height * scale));
    const dx = safeRectX + target.x + Math.round((target.w - drawW) / 2);
    const dy = safeRectY + target.y + Math.round((target.h - drawH) / 2);
    // Debug fill to confirm overlay is visible
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'magenta';
    ctx.fillRect(safeRectX + target.x, safeRectY + target.y, target.w, target.h);
    ctx.restore();

    ctx.drawImage(logoImage, dx, dy, drawW, drawH);

    // Debug border and placement visualization (draw after logo so it's visible)
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,0,0.9)';
    ctx.lineWidth = Math.max(1, Math.round(Math.min(width, height) * 0.002));
    ctx.strokeRect(safeRectX + target.x + 0.5, safeRectY + target.y + 0.5, target.w - 1, target.h - 1);
    ctx.restore();

    try {
      console.log('[logo] uv rect + target', {
        mesh: mesh.name,
        materialIndex,
        texSize: { w: width, h: height },
        uvRect: { x: safeRectX, y: safeRectY, w: safeRectW, h: safeRectH },
        target,
        draw: { x: dx, y: dy, w: drawW, h: drawH },
        texTransform: {
          offset: originalTexture.offset?.toArray?.(),
          repeat: originalTexture.repeat?.toArray?.(),
          rotation: originalTexture.rotation,
          center: originalTexture.center?.toArray?.(),
          flipY: originalTexture.flipY,
        },
      });
    } catch (_) { /* noop */ }

    return canvas;
  }

  // Raw UV bounds (no texture transform) in [0,1]
  function computeRawUvBoundsForMaterial(mesh, materialIndex) {
    const geom = mesh.geometry;
    const uvAttr = geom?.attributes?.uv;
    if (!uvAttr) return null;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    const index = geom.index ? geom.index.array : null;
    let processed = 0;
    const groups = Array.isArray(geom.groups) && geom.groups.length ? geom.groups : [{ start: 0, count: (index ? index.length : uvAttr.count), materialIndex: materialIndex }];
    for (const g of groups) {
      if (typeof g.materialIndex === 'number' && g.materialIndex !== materialIndex) continue;
      const start = g.start || 0;
      const count = g.count || 0;
      for (let a = start; a < start + count; a++) {
        const vi = index ? index[a] : a;
        if (vi == null) continue;
        const u = uvAttr.getX(vi);
        const v = uvAttr.getY(vi);
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
        processed++;
      }
    }
    if (!processed || !isFinite(minU) || !isFinite(minV) || !isFinite(maxU) || !isFinite(maxV)) return null;
    return { minU, minV, maxU, maxV };
  }

  function estimateBackgroundColorFromBorder(imageData) {
    const { data, width, height } = imageData;
    let r = 0, g = 0, b = 0, n = 0;
    const add = (x, y) => {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    };
    for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { add(0, y); add(width - 1, y); }
    if (!n) return { r: 0, g: 0, b: 0 };
    return { r: r / n, g: g / n, b: b / n };
  }

  function buildForegroundMask(imageData, bg, threshold = 28) {
    const { data, width, height } = imageData;
    const mask = new Uint8Array(width * height);
    const thr2 = threshold * threshold;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dr = data[i] - bg.r;
        const dg = data[i + 1] - bg.g;
        const db = data[i + 2] - bg.b;
        const dist2 = dr * dr + dg * dg + db * db;
        mask[y * width + x] = dist2 > thr2 ? 1 : 0;
      }
    }
    return { width, height, mask };
  }

  function largestMaskBoundingBox(maskObj) {
    const { width, height, mask } = maskObj;
    // simple bounding box of all foreground pixels; optional: expand/shrink
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    if (!count || !isFinite(minX)) return null;
    const padX = Math.round((maxX - minX + 1) * 0.08);
    const padY = Math.round((maxY - minY + 1) * 0.08);
    const x = Math.max(0, minX - padX);
    const y = Math.max(0, minY - padY);
    const w = Math.min(width - x, maxX - minX + 1 + 2 * padX);
    const h = Math.min(height - y, maxY - minY + 1 + 2 * padY);
    return { x, y, w, h };
  }

  // Build a registry of unique material instances for per-material control
  function buildMaterialRegistry() {
    materialRegistry = [];
    if (!modelRoot) return;
    modelRoot.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mesh = child;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        // Ensure unique instance to not affect siblings when toggling
        if (!m.userData || !m.userData._clonedForPerMaterial) {
          const cloned = m.clone();
          cloned.userData = { ...(m.userData || {}), _clonedForPerMaterial: true };
          if (Array.isArray(mesh.material)) mats[i] = cloned; else mesh.material = cloned;
        }
        const resolved = Array.isArray(mesh.material) ? mesh.material[i] : mesh.material;
        materialRegistry.push({
          meshId: mesh.uuid,
          meshName: mesh.name || 'mesh',
          materialIndex: i,
          materialName: resolved.name || `material_${i}`,
          material: resolved,
        });
      }
    });
  }

  function populateTextureTogglesFromMaterialRegistry() {
    if (!textureTogglesEl) return;
    while (textureTogglesEl.firstChild) textureTogglesEl.removeChild(textureTogglesEl.firstChild);
    const title = document.createElement('div');
    title.style.fontSize = '12px';
    title.style.opacity = '0.85';
    title.textContent = 'Per-material controls';
    textureTogglesEl.appendChild(title);

    const keys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
    for (const entry of materialRegistry) {
      const box = document.createElement('div');
      box.style.border = '1px solid rgba(148,163,184,0.15)';
      box.style.borderRadius = '6px';
      box.style.padding = '8px';
      box.style.marginBottom = '8px';
      const header = document.createElement('div');
      header.style.fontSize = '12px';
      header.style.fontWeight = '600';
      header.textContent = `${entry.meshName} • ${entry.materialName}`;
      box.appendChild(header);

      // If this is Material 003, show a subtle note under header
      if (/material\s*0*03/i.test(entry.materialName)) {
        const note = document.createElement('div');
        note.style.fontSize = '11px';
        note.style.opacity = '0.7';
        note.textContent = 'Logo target (use Replace logo below)';
        box.appendChild(note);
      }

      // Visibility toggle
      const visRow = document.createElement('div');
      visRow.className = 'row';
      const visLbl = document.createElement('label');
      const visCb = document.createElement('input');
      visCb.type = 'checkbox';
      visCb.checked = entry.material.visible !== false;
      visLbl.textContent = 'Visible';
      visRow.appendChild(visLbl);
      visRow.appendChild(visCb);
      visCb.addEventListener('change', () => {
        entry.material.visible = visCb.checked;
        entry.material.needsUpdate = true;
      });
      box.appendChild(visRow);

      for (const k of keys) {
        const has = !!entry.material[k];
        const row = document.createElement('div');
        row.className = 'row';
        const lbl = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = has;
        lbl.textContent = `${k}`;
        row.appendChild(lbl);
        row.appendChild(cb);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            // Can't restore original without snapshot; leave as is if missing
            // Users can reload or switch model to reset maps.
          } else {
            if (k in entry.material) {
              entry.material[k] = null;
              entry.material.needsUpdate = true;
            }
          }
        });
        box.appendChild(row);
      }

      textureTogglesEl.appendChild(box);
    }
  }

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

    // Build regions from Blender-authored metadata; fallback to heuristic boxes
    buildRegionsFromMetadata();
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

  // Keep camera from getting too close to the target (entering geometry)
  function enforceCameraDistanceClamp() {
    if (!controls) return;
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const distance = offset.length();
    const clamped = Math.min(Math.max(distance, controls.minDistance), controls.maxDistance);
    if (Math.abs(clamped - distance) > 1e-6) {
      offset.setLength(clamped);
      camera.position.copy(new THREE.Vector3().addVectors(controls.target, offset));
    }
  }

  function frameObject3D(object3D) {
    const box = new THREE.Box3().setFromObject(object3D);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxSize = Math.max(size.x, size.y, size.z);
    const halfSizeToFitOnScreen = maxSize * 0.5;
    const halfFovY = (camera.fov * Math.PI) / 360;
    const distance = halfSizeToFitOnScreen / Math.tan(halfFovY);

    const direction = new THREE.Vector3(0, 0, 1);
    const newPosition = direction.multiplyScalar(distance + maxSize * 0.5).add(center);

    camera.position.copy(newPosition);
    camera.near = Math.max(0.1, distance / 100);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    updateControlsTargetFromModel(center);
  }

  // Choose a pleasant front-biased 3/4 camera view on the model
  function setPleasantCameraView() {
    if (!modelRoot) return;
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const radius = Math.max(size.x, size.y, size.z) || 1;
    // Determine forward direction along Z using name heuristics; default +Z
    const forwardSign = inferForwardSign();
    // Front-biased up-diagonal view
    const offset = new THREE.Vector3(
      radius * 0.4,
      radius * 0.6,
      forwardSign * radius * 0.9
    );
    camera.position.copy(center.clone().add(offset));
    camera.near = Math.max(0.1, radius / 100);
    camera.far = Math.max(100, radius * 50);
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    updateControlsTargetFromModel(center);
  }

  // Keep orbit controls target aligned with the model center
  function updateControlsTargetFromModel(precomputedCenter) {
    if (!controls || !modelRoot) return;
    const center = precomputedCenter || new THREE.Vector3();
    if (!precomputedCenter) {
      const box = new THREE.Box3().setFromObject(modelRoot);
      box.getCenter(center);
    }
    controls.target.copy(center);
    controls.update();
  }

  

  function getFloorYAt(x, z) {
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3(x, 10000, z);
    const dir = new THREE.Vector3(0, -1, 0);
    raycaster.set(origin, dir);
    const candidates = [];
    if (scenarioRoot) candidates.push(scenarioRoot);
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

  // Heuristic fallback volumes when no metadata exists in the GLB
  function buildRegionVolumes() {
    if (!modelRoot) return;
    if (regionGroup) { scene.remove(regionGroup); regionGroup = null; }
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    regionGroup = new THREE.Group();
    regionGroup.name = 'RegionVolumes';

    const mkBox = (name, cx, cy, cz, sx, sy, sz) => {
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const mesh = new THREE.Mesh(geo, regionHighlightMaterial.clone());
      mesh.position.set(cx, cy, cz);
      mesh.visible = false;
      mesh.name = name;
      regionGroup.add(mesh);
      return mesh;
    };

    // Determine forward direction along Z using name heuristics; default +Z
    const forwardSign = inferForwardSign();

    // Heuristic splits based on bounding box and forward direction
    const hood = mkBox(
      'hood',
      center.x,
      center.y,
      center.z + forwardSign * (size.z * 0.25),
      size.x * 0.9,
      size.y * 0.6,
      size.z * 0.5
    );
    const trunk = mkBox(
      'trunk',
      center.x,
      center.y,
      center.z - forwardSign * (size.z * 0.25),
      size.x * 0.9,
      size.y * 0.6,
      size.z * 0.5
    );
    const roof = mkBox('roof', center.x, center.y + size.y * 0.25, center.z, size.x * 0.9, size.y * 0.5, size.z * 0.6);
    const leftDoor = mkBox('leftDoor', center.x - size.x * 0.25, center.y, center.z, size.x * 0.5, size.y * 0.6, size.z * 0.6);
    const rightDoor = mkBox('rightDoor', center.x + size.x * 0.25, center.y, center.z, size.x * 0.5, size.y * 0.6, size.z * 0.6);

    scene.add(regionGroup);
  }

  // Try to infer the model's forward Z sign using node names; default +1 (front toward +Z)
  function inferForwardSign() {
    if (!modelRoot) return 1;
    const frontRe = /(hood|front|bumper|bonnet)/i;
    const backRe = /(trunk|rear|back|boot)/i;
    let frontSum = 0;
    let backSum = 0;
    const tmp = new THREE.Vector3();
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(modelRoot).getCenter(center);
    modelRoot.traverse((n) => {
      if (!n.isMesh) return;
      const name = String(n.name || '');
      n.getWorldPosition(tmp);
      const relZ = tmp.z - center.z;
      if (frontRe.test(name)) frontSum += Math.sign(relZ) || 0;
      if (backRe.test(name)) backSum += Math.sign(relZ) || 0;
    });
    const vote = frontSum - backSum; // if front at +Z, vote tends positive
    if (vote > 0) return 1;
    if (vote < 0) return -1;
    return 1;
  }

  // Build regions from model metadata (node.userData or name inference)
  function buildRegionsFromMetadata() {
    regionNameToMeshes = {};
    if (!modelRoot) return;

    /** @param {string} name */
    const inferRegionFromName = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('hood')) return 'hood';
      if (n.includes('trunk') || n.includes('boot') || n.includes('back')) return 'trunk';
      if (n.includes('roof') || n.includes('top')) return 'roof';
      if (n.includes('door') && (n.includes('left') || n.includes('_l') || n.endsWith('l'))) return 'leftDoor';
      if (n.includes('door') && (n.includes('right') || n.includes('_r') || n.endsWith('r'))) return 'rightDoor';
      if (n === 'leftdoor') return 'leftDoor';
      if (n === 'rightdoor') return 'rightDoor';
      return null;
    };

    modelRoot.traverse((child) => {
      if (!child.isMesh) return;
      const mesh = /** @type {THREE.Mesh} */ (child);
      const ud = mesh.userData || {};
      // Look for metadata on mesh or ancestor chain
      let explicit = ud.region || ud.part || ud.partName;
      if (!explicit) {
        let p = mesh.parent;
        while (p && !explicit) {
          const pud = p.userData || {};
          explicit = pud.region || pud.part || pud.partName;
          p = p.parent;
        }
      }
      const inferred = explicit ? String(explicit) : inferRegionFromName(mesh.name);
      if (!inferred) return;
      const key = String(inferred);
      if (!regionNameToMeshes[key]) regionNameToMeshes[key] = [];
      regionNameToMeshes[key].push(mesh);
    });

    // If nothing discovered, fallback to heuristic volumes
    const discoveredRegionNames = Object.keys(regionNameToMeshes);
    if (!discoveredRegionNames.length) {
      buildRegionVolumes();
    }

    // Populate UI with discovered regions when available
    populateRegionSelect(discoveredRegionNames.length ? discoveredRegionNames : ['roof','hood','trunk','leftDoor','rightDoor']);
  }

  function populateRegionSelect(regionKeys) {
    const select = /** @type {HTMLSelectElement} */ (document.getElementById('regionSelect'));
    if (!select) return;
    // Preserve current value to keep selection when possible
    const prev = select.value;
    while (select.firstChild) select.removeChild(select.firstChild);
    const addOpt = (value, label) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label; select.appendChild(opt);
    };
    addOpt('none', 'None');
    const pretty = (k) => {
      if (k === 'leftDoor') return 'Left door';
      if (k === 'rightDoor') return 'Right door';
      if (k === 'trunk') return 'Back';
      return k.charAt(0).toUpperCase() + k.slice(1);
    };
    for (const k of regionKeys) addOpt(k, pretty(k));
    select.value = regionKeys.includes(prev) ? prev : 'none';
  }

  function setActiveRegion(key) {
    // If we have metadata-driven regions
    const discovered = Object.keys(regionNameToMeshes).length > 0;

    if (discovered) {
      // Clear previous highlight
      if (activeRegionKey && activeRegionKey !== 'none') {
        const prevMeshes = regionNameToMeshes[activeRegionKey] || [];
        for (const mesh of prevMeshes) restoreMeshHighlight(mesh);
      }
      activeRegionKey = 'none';
      if (!key || key === 'none') return;
      const meshes = regionNameToMeshes[key] || [];
      for (const mesh of meshes) applyMeshHighlight(mesh);
      if (meshes.length) activeRegionKey = key;
      return;
    }

    // Fallback: toggle heuristic volume boxes
    if (!regionGroup) return;
    if (activeRegion) activeRegion.visible = false;
    activeRegion = null;
    if (!key || key === 'none') return;
    const region = regionGroup.children.find(c => c.name === key);
    if (region) {
      // If decals already applied for this region, keep box hidden
      const hasDecals = (regionKeyToDecals[key] || []).length > 0;
      region.visible = !hasDecals;
      activeRegion = region;
    }
  }

  /** @param {THREE.Mesh} mesh */
  function applyMeshHighlight(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !('emissive' in m)) continue;
      const mm = /** @type {THREE.MeshStandardMaterial} */ (m);
      mm.userData._origEmissive = mm.emissive ? mm.emissive.getHex() : 0x000000;
      mm.userData._origEmissiveIntensity = mm.emissiveIntensity ?? 1.0;
      mm.emissive?.setHex(0xf59e0b);
      mm.emissiveIntensity = 0.8;
      mm.needsUpdate = true;
    }
  }

  /** @param {THREE.Mesh} mesh */
  function restoreMeshHighlight(mesh) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !('emissive' in m)) continue;
      const mm = /** @type {THREE.MeshStandardMaterial} */ (m);
      const orig = mm.userData._origEmissive;
      const origIntensity = mm.userData._origEmissiveIntensity;
      if (typeof orig === 'number') mm.emissive?.setHex(orig);
      if (typeof origIntensity === 'number') mm.emissiveIntensity = origIntensity;
      mm.needsUpdate = true;
    }
  }

  async function applyDecalToActiveRegion(imageUrl) {
    if (!modelRoot) return;
    if (!activeRegionKey || activeRegionKey === 'none') return;
    const discovered = Object.keys(regionNameToMeshes).length > 0;
    const targets = discovered ? (regionNameToMeshes[activeRegionKey] || []) : [];

    const texLoader = new THREE.TextureLoader();
    const map = await new Promise((resolve, reject) => {
      texLoader.load(imageUrl, resolve, undefined, reject);
    });
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;

    // Determine placement box
    const regionCenter = new THREE.Vector3();
    const bbox = new THREE.Box3();
    let normal = new THREE.Vector3(0, 0, 1);
    if (discovered && targets.length) {
      for (const m of targets) bbox.expandByObject(m);
      bbox.getCenter(regionCenter);
      normal = estimateRegionNormal(targets) || normal;
    } else {
      // Fallback: use heuristic region volume box
      if (!regionGroup) return;
      const regionMesh = regionGroup.children.find((c) => c.name === activeRegionKey);
      if (!regionMesh) return;
      new THREE.Box3().setFromObject(regionMesh).getCenter(regionCenter);
      bbox.setFromObject(regionMesh);
      // Estimate normal heuristically for the region
      normal = getHeuristicNormalForRegion(activeRegionKey);
      // Hide the box to reveal decal
      regionMesh.visible = false;
    }

    const size = bbox.getSize(new THREE.Vector3());
    const decalSize = new THREE.Vector3(size.x * 0.98, size.y * 0.98, Math.max(size.z * 0.05, 0.02));

    const material = new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 1.0,
      metalness: 0.0,
    });

    const orientation = new THREE.Euler();
    orientation.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize()));

    // Project decals onto car meshes intersecting the region bbox
    const carMeshes = [];
    modelRoot.traverse((c) => { if (c.isMesh) carMeshes.push(c); });
    if (!regionKeyToDecals[activeRegionKey]) regionKeyToDecals[activeRegionKey] = [];
    const tmpBox = new THREE.Box3();
    for (const m of carMeshes) {
      tmpBox.setFromObject(m);
      if (!tmpBox.intersectsBox(bbox)) continue;
      try {
        const g = new DecalGeometry(m, regionCenter, orientation, decalSize);
        const decalMesh = new THREE.Mesh(g, material.clone());
        decalMesh.renderOrder = 10;
        scene.add(decalMesh);
        regionKeyToDecals[activeRegionKey].push(decalMesh);
      } catch (e) { /* ignore */ }
    }
  }

  function estimateRegionNormal(meshes) {
    for (const m of meshes) {
      const pos = m.geometry?.attributes?.position;
      if (!pos) continue;
      // approximate using triangle (0,1,2)
      const a = new THREE.Vector3().fromBufferAttribute(pos, 0).applyMatrix4(m.matrixWorld);
      const b = new THREE.Vector3().fromBufferAttribute(pos, 1).applyMatrix4(m.matrixWorld);
      const c = new THREE.Vector3().fromBufferAttribute(pos, 2).applyMatrix4(m.matrixWorld);
      return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    }
    return null;
  }

  function clearRegionDecals() {
    if (!activeRegionKey || activeRegionKey === 'none') return;
    const decals = regionKeyToDecals[activeRegionKey] || [];
    for (const d of decals) {
      scene.remove(d);
      d.geometry?.dispose?.();
      if (Array.isArray(d.material)) { d.material.forEach((m) => m.dispose?.()); }
      else { d.material?.dispose?.(); }
    }
    regionKeyToDecals[activeRegionKey] = [];
    // If we are on fallback regions, show the helper box again for guidance
    if (regionGroup) {
      const region = regionGroup.children.find((c) => c.name === activeRegionKey);
      if (region) region.visible = true;
    }
  }

  function getHeuristicNormalForRegion(key) {
    const f = inferForwardSign();
    switch (key) {
      case 'hood': return new THREE.Vector3(0, 0, f);
      case 'trunk': return new THREE.Vector3(0, 0, -f);
      case 'roof': return new THREE.Vector3(0, 1, 0);
      case 'leftDoor': return new THREE.Vector3(-1, 0, 0);
      case 'rightDoor': return new THREE.Vector3(1, 0, 0);
      default: return new THREE.Vector3(0, 0, 1);
    }
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
    if (scenarioRoot) candidates.push(scenarioRoot);
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

  function applyColorToModel(hex) {
    if (!modelRoot) return;
    modelRoot.traverse((child) => {
      if (child.isMesh && child.material) {
        const material = child.material;
        // Handle multi-materials and single materials
        const materials = Array.isArray(material) ? material : [material];
        for (const m of materials) {
          if (m.color) m.color.set(hex);
          m.needsUpdate = true;
        }
      }
    });
  }

  function applyColorToRegion(hex) {
    const discovered = Object.keys(regionNameToMeshes).length > 0;
    if (discovered) {
      if (!activeRegionKey || activeRegionKey === 'none') return;
      const meshes = regionNameToMeshes[activeRegionKey] || [];
      for (const mesh of meshes) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (let i = 0; i < mats.length; i++) {
          const m = mats[i];
          if (!m) continue;
          // Ensure per-region material by cloning once
          if (!m.userData._clonedForRegion) {
            const cloned = m.clone();
            cloned.userData._clonedForRegion = true;
            if (Array.isArray(mesh.material)) {
              mesh.material[i] = cloned;
            } else {
              mesh.material = cloned;
            }
          }
        }
        const ensureArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mm of ensureArray) {
          if (mm && 'color' in mm) {
            mm.color.set(hex);
            mm.needsUpdate = true;
          }
        }
      }
      return;
    }
    // Fallback: if only heuristic volume exists, tint whole model to give feedback
    applyColorToModel(hex);
  }

  function getViewportSize() {
    const rect = viewportEl.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    return { width, height };
  }

  function setScenario(key, onProgress, onDone) {
    if (scenarioRoot) {
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
    currentScenarioKey = key || 'none';
    userYOffset = 0;
    modelYOffsetBase = 0;
    updateYOffsetUI();
    if (!key || key === 'none') return;

    const base = '/assets/scenarios/';
    const url = `${base}${key}/scene.gltf`;
    console.log('[scenario] load', url);

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
        console.log('[scenario] added');
        onProgress?.(90);
        // Defer snapping a bit to ensure GLTF scene & bounds are ready
        const finalizePlacement = () => {
          try {
            // If scenario is modern_garage, force to provided coordinates
            if (currentScenarioKey === 'modern_garage' && modelRoot) {
              modelRoot.position.set(0, 0.3931981944627143, 0);
              modelYOffsetBase = modelRoot.position.y;
            }
            // If scenario is sci-fi_garage, force to provided coordinates (pre-snap)
            if (currentScenarioKey === 'sci-fi_garage' && modelRoot) {
              // Pre-place model near intended height, then let snapping finalize
              modelRoot.position.set(0, 0.46088310371321484, 0);
              modelYOffsetBase = modelRoot.position.y; // mirror modern_garage flow
            }
            snapModelToScenarioFloor();
            applyVerticalOffset();
            // Start with a pleasant front-biased 3/4 view of the model
            setPleasantCameraView();
            
          } catch (e) {
            console.error('[scenario] finalize error', e);
          } finally {
            onProgress?.(100);
            onDone?.();
          }
        };
        // Run after next couple of frames and with a small timeout as fallback
        requestAnimationFrame(() => requestAnimationFrame(finalizePlacement));
        setTimeout(finalizePlacement, 350);
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

  // Kick things off
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();


