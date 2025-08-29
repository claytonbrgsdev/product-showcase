import * as THREE from 'three';

export function initializeLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 0.6);
  scene.add(hemi);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(3, 5, 2);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

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

  return { hemi, directionalLight };
}


