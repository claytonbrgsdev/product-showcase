import * as THREE from 'three';

/**
 * Cinematic camera controller.
 * Handles time-based orbital motion, FOV pulsing, and optional DOF focus updates.
 */
export function createCinematicController(camera, controls) {
  let enabled = false;
  let timeSeconds = 0;
  /** @type {import('three/addons/postprocessing/BokehPass.js').BokehPass | null} */
  let bokehPass = null;

  function enable() {
    enabled = true;
    timeSeconds = 0;
    if (bokehPass) bokehPass.enabled = true;
  }

  function disable() {
    enabled = false;
    if (bokehPass) bokehPass.enabled = false;
  }

  function isEnabled() {
    return enabled;
  }

  function setBokehPass(pass) {
    bokehPass = pass || null;
    if (bokehPass) bokehPass.enabled = enabled;
  }

  /**
   * Update camera transform and DOF for the current frame.
   * @param {number} deltaSeconds
   * @param {THREE.Object3D | null} subjectRoot
   */
  function update(deltaSeconds, subjectRoot) {
    if (!enabled || !subjectRoot || !controls) return;
    timeSeconds += Math.max(0, deltaSeconds || 0);

    const box = new THREE.Box3().setFromObject(subjectRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

    const orbitRadius = radius * 1.1;
    const theta = timeSeconds * 0.25; // azimuth
    const basePhi = THREE.MathUtils.degToRad(50); // polar angle from +Y
    const phi = THREE.MathUtils.clamp(
      basePhi + Math.sin(timeSeconds * 0.4) * THREE.MathUtils.degToRad(6),
      THREE.MathUtils.degToRad(20),
      THREE.MathUtils.degToRad(70)
    );

    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const x = center.x + orbitRadius * sinPhi * Math.cos(theta);
    const z = center.z + orbitRadius * sinPhi * Math.sin(theta);
    const y = center.y + orbitRadius * cosPhi;
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);

    // FOV pulse
    const baseFov = 55;
    camera.fov = baseFov + Math.sin(timeSeconds * 0.6) * 6;
    camera.updateProjectionMatrix();
    camera.rotation.z = 0; // avoid roll

    // Update DOF uniforms if Bokeh is present
    if (bokehPass) {
      const dist = camera.position.distanceTo(center);
      bokehPass.materialBokeh.uniforms['focus'].value = dist * 0.9;
      bokehPass.materialBokeh.uniforms['aperture'].value = 0.00035;
      bokehPass.materialBokeh.uniforms['maxblur'].value = 0.015;
    }
  }

  return { enable, disable, isEnabled, setBokehPass, update };
}


