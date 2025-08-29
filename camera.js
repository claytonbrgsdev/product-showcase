import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Initialize camera and orbit controls.
 * Returns helpers commonly used by the app.
 *
 * @param {HTMLElement} canvasEl - Renderer DOM element
 * @param {{ fov?: number, near?: number, far?: number, aspect?: number }} opts
 */
export function initializeCamera(canvasEl, opts = {}) {
  const fieldOfView = opts.fov ?? 60;
  const aspect = opts.aspect ?? 1;
  const near = opts.near ?? 0.1;
  const far = opts.far ?? 100;
  const camera = new THREE.PerspectiveCamera(fieldOfView, aspect, near, far);
  camera.position.set(0, 0, 3);

  const controls = new OrbitControls(camera, canvasEl);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 0.2;
  controls.maxDistance = 100;
  controls.zoomSpeed = 0.35;
  if ('zoomToCursor' in controls) controls.zoomToCursor = true;
  controls.minPolarAngle = THREE.MathUtils.degToRad(15);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(75);
  controls.screenSpacePanning = false;

  return { camera, controls };
}

/**
 * Clamp camera distance between controls.minDistance and controls.maxDistance.
 */
export function enforceCameraDistanceClamp(camera, controls) {
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const distance = offset.length();
  const clamped = Math.min(Math.max(distance, controls.minDistance), controls.maxDistance);
  if (Math.abs(clamped - distance) > 1e-6) {
    offset.setLength(clamped);
    camera.position.copy(new THREE.Vector3().addVectors(controls.target, offset));
  }
}

/**
 * Update controls target to the center of the given object.
 */
export function updateControlsTargetFromObject(camera, controls, object3D) {
  if (!controls || !object3D) return;
  const center = new THREE.Vector3();
  new THREE.Box3().setFromObject(object3D).getCenter(center);
  controls.target.copy(center);
  controls.update();
}

/**
 * Frame the object with the camera in a pleasant view and update controls target.
 */
export function frameObject(camera, controls, object3D) {
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
  updateControlsTargetFromObject(camera, controls, object3D);
}

/**
 * Choose a pleasant front-biased 3/4 camera view.
 */
export function setPleasantCameraView(camera, controls, object3D) {
  if (!object3D) return;
  const box = new THREE.Box3().setFromObject(object3D);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const radius = Math.max(size.x, size.y, size.z) || 1;
  const forwardSign = 1;
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
  updateControlsTargetFromObject(camera, controls, object3D);
}

/**
 * Helper to adjust zoom by a factor relative to distance to controls target.
 */
export function applyZoomDelta(camera, controls, factor = -0.2) {
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const distance = offset.length();
  const radius = Math.max(1e-6, distance * (1 + factor));
  const clamped = Math.min(Math.max(radius, controls.minDistance), controls.maxDistance);
  offset.setLength(clamped);
  camera.position.copy(new THREE.Vector3().addVectors(controls.target, offset));
  camera.updateProjectionMatrix();
  controls.update();
}


