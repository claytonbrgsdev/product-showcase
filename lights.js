import * as THREE from 'three';

export function initializeLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 3);
  scene.add(hemi);

  // Subtle ambient fill to lift overall darkness
  const ambient = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(ambient);

  // Window sunlight simulation: a warm hemisphere light entering from one side
  // Position biases the incoming "sky" direction toward the window side
  const windowHemisphere = new THREE.HemisphereLight(0xffedd5, 0x0b1220, 3);
  windowHemisphere.position.set(8, 6, -3);
  scene.add(windowHemisphere);

  const directionalLight = new THREE.DirectionalLight(0x0091FF, 2);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(2048, 2048);
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -90;
  directionalLight.shadow.camera.right = 90;
  directionalLight.shadow.camera.top = 20;
  directionalLight.shadow.camera.bottom = -20;
  scene.add(directionalLight);
  scene.add(directionalLight.target);

  // Second directional light on the opposite side
  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight2.castShadow = true;
  directionalLight2.shadow.mapSize.set(2048, 2048);
  directionalLight2.shadow.camera.near = 0.1;
  directionalLight2.shadow.camera.far = -20;
  directionalLight2.shadow.camera.left = -20;
  directionalLight2.shadow.camera.right = 20;
  directionalLight2.shadow.camera.top = 20;
  directionalLight2.shadow.camera.bottom = -80;
  scene.add(directionalLight2);
  scene.add(directionalLight2.target);

  // Strong focused key directional light (static), casting sharper shadows
  const directionalKey = new THREE.DirectionalLight(0x0091FF, 2);
  directionalKey.castShadow = true;
  directionalKey.shadow.mapSize.set(4096, 4096);
  directionalKey.shadow.camera.near = 0.1;
  directionalKey.shadow.camera.far = 80;
  directionalKey.shadow.camera.left = -25;
  directionalKey.shadow.camera.right = 25;
  directionalKey.shadow.camera.top = 25;
  directionalKey.shadow.camera.bottom = -25;
  directionalKey.position.set(6, 10, 3);
  scene.add(directionalKey);
  scene.add(directionalKey.target);

  // Extremely focused close directional light aimed at the car
  const directionalClose = new THREE.DirectionalLight(0xFF8800, 1.4);
  directionalClose.castShadow = true;
  directionalClose.shadow.mapSize.set(4096, 4096);
  directionalClose.shadow.camera.near = 0.01;
  directionalClose.shadow.camera.far = 20;
  directionalClose.shadow.camera.left = -3;
  directionalClose.shadow.camera.right = 3;
  directionalClose.shadow.camera.top = 3;
  directionalClose.shadow.camera.bottom = -3;
  directionalClose.shadow.bias = -0.00015;
  scene.add(directionalClose);
  scene.add(directionalClose.target);

  // Upward spotlight from floor to ceiling (opposite direction: bottom -> top)
  const upwardSpot = new THREE.SpotLight(0xffffff, 0.85, 35, Math.PI / 8, 0.25, 1.0);
  upwardSpot.castShadow = true;
  upwardSpot.visible = true;
  upwardSpot.position.set(0, 0.05, 0);
  scene.add(upwardSpot);
  scene.add(upwardSpot.target);

  // Orbiting state
  let baseAzimuthDeg = 35;
  let baseElevationDeg = 50;
  let elapsedSeconds = 0;
  let orbitSpeedDegPerSec = 15; // gentle constant spin
  const radius = 3;

  const hemiIntensity = /** @type {HTMLInputElement | null} */ (document.getElementById('hemiIntensity'));
  const hemiSky = /** @type {HTMLInputElement | null} */ (document.getElementById('hemiSky'));
  const hemiGround = /** @type {HTMLInputElement | null} */ (document.getElementById('hemiGround'));
  const dirIntensity = /** @type {HTMLInputElement | null} */ (document.getElementById('dirIntensity'));
  const dirColor = /** @type {HTMLInputElement | null} */ (document.getElementById('dirColor'));
  const dirAzimuth = /** @type {HTMLInputElement | null} */ (document.getElementById('dirAzimuth'));
  const dirElevation = /** @type {HTMLInputElement | null} */ (document.getElementById('dirElevation'));

  if (hemiIntensity) hemiIntensity.addEventListener('input', () => { hemi.intensity = Number(hemiIntensity.value); });
  if (hemiSky) hemiSky.addEventListener('input', () => { hemi.color.set(hemiSky.value); });
  if (hemiGround) hemiGround.addEventListener('input', () => { hemi.groundColor.set(hemiGround.value); });
  if (dirIntensity) dirIntensity.addEventListener('input', () => {
    const v = Number(dirIntensity.value);
    directionalLight.intensity = v;
    directionalLight2.intensity = v;
  });
  if (dirColor) dirColor.addEventListener('input', () => {
    directionalLight.color.set(dirColor.value);
    directionalLight2.color.set(dirColor.value);
  });

  function updateBaseAnglesFromUI() {
    baseAzimuthDeg = Number(dirAzimuth?.value || '35');
    baseElevationDeg = Number(dirElevation?.value || '50');
    // immediate update
    updateLightsOrbit(0);
  }
  if (dirAzimuth) dirAzimuth.addEventListener('input', updateBaseAnglesFromUI);
  if (dirElevation) dirElevation.addEventListener('input', updateBaseAnglesFromUI);

  function computePositions(azimuthDeg, elevationDeg) {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const x = Math.cos(el) * Math.cos(az) * radius;
    const y = Math.sin(el) * radius;
    const z = Math.cos(el) * Math.sin(az) * radius;
    return { x, y, z };
  }

  function updateLightsOrbit(deltaSeconds = 0, modelRoot) {
    elapsedSeconds += Math.max(0, deltaSeconds || 0);
    const azNow = baseAzimuthDeg + orbitSpeedDegPerSec * elapsedSeconds;
    const pos1 = computePositions(azNow, baseElevationDeg);
    const pos2 = computePositions(azNow + 180, baseElevationDeg);
    directionalLight.position.set(pos1.x, pos1.y, pos1.z);
    directionalLight2.position.set(pos2.x, pos2.y, pos2.z);
    // Aim towards the model center if provided
    try {
      if (modelRoot) {
        const box = new THREE.Box3().setFromObject(modelRoot);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
        directionalLight.target.position.copy(center);
        directionalLight2.target.position.copy(center);
        directionalKey.target.position.copy(center);
        // Place the close light near the car with a tight offset that scales with size
        const closeOffset = new THREE.Vector3(radius * 0.6, radius * 0.8, radius * 0.3);
        directionalClose.position.copy(center.clone().add(closeOffset));
        directionalClose.target.position.copy(center);
        // Place the upward spotlight near the model bottom, pointing upward past center
        const bottomY = box.min.y;
        const upHeight = Math.max(0.02, radius * 0.06);
        upwardSpot.position.set(center.x, bottomY + upHeight, center.z);
        upwardSpot.target.position.set(center.x, center.y + radius * 1.2, center.z);
        directionalLight.target.updateMatrixWorld();
        directionalLight2.target.updateMatrixWorld();
        directionalKey.target.updateMatrixWorld();
        directionalClose.target.updateMatrixWorld();
        upwardSpot.target.updateMatrixWorld();
      }
    } catch (_) {}
  }
  // Initialize once
  updateLightsOrbit(0);

  return { hemi, ambient, windowHemisphere, directionalLight, directionalLight2, directionalKey, directionalClose, upwardSpot, updateLightsOrbit };
}

// Create an uplight near the scenario floor aimed at the model center.
// Visible can be toggled externally (e.g., only during cinematic mode).
export function createFloorUplight(scene) {
  const uplight = new THREE.SpotLight(0xffffff, 0.7, 25, Math.PI / 3, 0.35, 1.0);
  uplight.castShadow = false;
  uplight.visible = false;
  uplight.position.set(0, 0.1, 0);
  scene.add(uplight);
  scene.add(uplight.target);

  function updateFloorUplight(modelRoot) {
    if (!modelRoot) return;
    try {
      const box = new THREE.Box3().setFromObject(modelRoot);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const bottomY = box.min.y;
      // Place just above the bottom to simulate a bounce from the floor
      const y = bottomY + Math.max(0.02, size.y * 0.02);
      uplight.position.set(center.x, y, center.z);
      uplight.target.position.set(center.x, center.y, center.z);
      uplight.target.updateMatrixWorld();
    } catch (_) {}
  }

  return { uplight, updateFloorUplight };
}

// Create three warm, low-intensity ambient floor point lights around the model.
export function createFloorAmberLights() { return { amberLights: [], updateFloorAmbers: () => {} }; }



// Show Room specific lights: isolated group not used in Galpão
export function createShowRoomLights(scene) {
  const group = new THREE.Group();
  group.visible = false; // off by default; enabled only for Show Room

  // Clean, bright showroom key/fill/rim
  const srAmbient = new THREE.AmbientLight(0xFF0000, 4);
  group.add(srAmbient);

  const srKey = new THREE.DirectionalLight(0xffffff, 3);
  srKey.position.set(2.5, 4.5, 2.0);
  srKey.castShadow = true;
  srKey.shadow.mapSize.set(2048, 2048);
  group.add(srKey);
  group.add(srKey.target);

  const srFill = new THREE.DirectionalLight(0xffffff, 3);
  srFill.position.set(-2.0, 3.0, -1.5);
  group.add(srFill);
  group.add(srFill.target);

  const srRim = new THREE.DirectionalLight(0xffffff, 3);
  srRim.position.set(0.0, 3.5, -3.5);
  group.add(srRim);
  group.add(srRim.target);

  // Subtle floor up-spot for underglow accent
  const srUp = new THREE.SpotLight(0xffffff, 0.5, 20, Math.PI / 6, 0.3, 1.0);
  srUp.position.set(0, 0.08, 0);
  group.add(srUp);
  group.add(srUp.target);

  // Wall wash spotlights to illuminate inner walls (cardinal directions)
  const wallIntensity = 0.45;
  const wallAngle = Math.PI / 5;
  const wallDistance = 40;
  const spWallPosX = new THREE.SpotLight(0xffffff, wallIntensity, wallDistance, wallAngle, 0.35, 1.0);
  const spWallNegX = new THREE.SpotLight(0xffffff, wallIntensity, wallDistance, wallAngle, 0.35, 1.0);
  const spWallPosZ = new THREE.SpotLight(0xffffff, wallIntensity, wallDistance, wallAngle, 0.35, 1.0);
  const spWallNegZ = new THREE.SpotLight(0xffffff, wallIntensity, wallDistance, wallAngle, 0.35, 1.0);
  [spWallPosX, spWallNegX, spWallPosZ, spWallNegZ].forEach((s) => { s.castShadow = false; group.add(s); group.add(s.target); });

  scene.add(group);

  function updateShowRoomLights(deltaSeconds = 0, modelRoot) {
    if (!group.visible || !modelRoot) return;
    try {
      const box = new THREE.Box3().setFromObject(modelRoot);
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
      srKey.target.position.copy(center);
      srFill.target.position.copy(center);
      srRim.target.position.copy(center);
      srUp.target.position.set(center.x, center.y + radius * 0.6, center.z);
      // Position wall wash spots near center, aiming outwards toward the walls
      const yWash = center.y + Math.max(1.5, radius * 0.7);
      const reach = Math.max(8, radius * 4);
      spWallPosX.position.set(center.x, yWash, center.z);
      spWallPosX.target.position.set(center.x + reach, yWash, center.z);
      spWallNegX.position.set(center.x, yWash, center.z);
      spWallNegX.target.position.set(center.x - reach, yWash, center.z);
      spWallPosZ.position.set(center.x, yWash, center.z);
      spWallPosZ.target.position.set(center.x, yWash, center.z + reach);
      spWallNegZ.position.set(center.x, yWash, center.z);
      spWallNegZ.target.position.set(center.x, yWash, center.z - reach);
      srKey.target.updateMatrixWorld();
      srFill.target.updateMatrixWorld();
      srRim.target.updateMatrixWorld();
      srUp.target.updateMatrixWorld();
      spWallPosX.target.updateMatrixWorld();
      spWallNegX.target.updateMatrixWorld();
      spWallPosZ.target.updateMatrixWorld();
      spWallNegZ.target.updateMatrixWorld();
    } catch (_) {}
  }

  return { showRoomGroup: group, updateShowRoomLights };
}

