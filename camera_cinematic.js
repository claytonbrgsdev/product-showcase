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

  // Orbit parameters (defaults chosen for a slow, steady orbit)
  let orbitSpeedRadPerSec = 0.05; // ~2.86 deg/s
  let radiusFactor = 1.2; // distance relative to subject radius
  let elevationDeg = 40; // camera elevation in degrees
  let elevationSwayDeg = 0; // set > 0 to add subtle vertical sway

  // FOV pulsing (disabled by default for a calmer look)
  let fovPulseEnabled = false;
  let baseFovDeg = 55;
  let fovPulseAmplitudeDeg = 0; // set > 0 to enable subtle pulsing

  // Continuous azimuth drift so the camera is never perfectly still during takes
  let dwellDriftSpeedRadPerSec = 0.03; // very slow drift
  let continuousAzimuthOffset = 0; // accumulates over time

  // Subtle radius sway for breathing motion
  let radiusSwayAmplitude = 0.03; // fraction of orbit radius (e.g., 0.03 = 3%)
  let radiusSwaySpeed = 0.35; // speed multiplier for sway animation

  // Takes system: queue of camera angles with dwell and transition timings
  /** @type {Array<{ azimuthDeg: number, elevationDeg?: number, radiusFactor?: number, fovDeg?: number, dwellSeconds?: number, transitionSeconds?: number }>} */
  let takes = [];
  let takesActive = false;
  let currentTakeIndex = 0;
  let phase = /** @type {'dwell' | 'transition'} */ ('dwell');
  let phaseTime = 0; // seconds within current phase
  const defaultDwell = 4.0;
  const defaultTransition = 1.6;

  // Manual override while user drags: pause updates and blend back after release
  let manualOverride = false;
  let resumeBlendDuration = 1.2;
  let resumeBlendRemaining = 0;
  const resumeStartPos = new THREE.Vector3();
  let resumeStartFov = 55;

  function enable() {
    enabled = true;
    timeSeconds = 0;
    phaseTime = 0;
    phase = 'dwell';
    if (takes && takes.length) {
      takesActive = true;
      currentTakeIndex = 0;
    }
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
   * Adjust orbit behavior at runtime.
   * @param {{ speed?: number, radius?: number, elevation?: number, elevationSway?: number }} params
   */
  function setOrbitParams(params = {}) {
    const { speed, radius, elevation, elevationSway, dwellDriftSpeed, radiusSwayAmp, radiusSwayHz } = params;
    if (typeof speed === 'number' && isFinite(speed)) orbitSpeedRadPerSec = Math.max(0, speed);
    if (typeof radius === 'number' && isFinite(radius)) radiusFactor = Math.max(0.1, radius);
    if (typeof elevation === 'number' && isFinite(elevation)) elevationDeg = Math.max(5, Math.min(85, elevation));
    if (typeof elevationSway === 'number' && isFinite(elevationSway)) elevationSwayDeg = Math.max(0, Math.min(20, elevationSway));
    if (typeof dwellDriftSpeed === 'number' && isFinite(dwellDriftSpeed)) dwellDriftSpeedRadPerSec = Math.max(0, dwellDriftSpeed);
    if (typeof radiusSwayAmp === 'number' && isFinite(radiusSwayAmp)) radiusSwayAmplitude = Math.max(0, Math.min(0.2, radiusSwayAmp));
    if (typeof radiusSwayHz === 'number' && isFinite(radiusSwayHz)) radiusSwaySpeed = Math.max(0, Math.min(5, radiusSwayHz));
  }

  /**
   * Configure field-of-view pulsing.
   * @param {{ enabled?: boolean, base?: number, amplitudeDeg?: number }} params
   */
  function setFovPulse(params = {}) {
    const { enabled, base, amplitudeDeg } = params;
    if (typeof enabled === 'boolean') fovPulseEnabled = enabled;
    if (typeof base === 'number' && isFinite(base)) baseFovDeg = Math.max(10, Math.min(120, base));
    if (typeof amplitudeDeg === 'number' && isFinite(amplitudeDeg)) fovPulseAmplitudeDeg = Math.max(0, Math.min(25, amplitudeDeg));
  }

  /** Enable/disable manual control override during drag. */
  function setManualControlActive(active) {
    manualOverride = !!active;
    if (!manualOverride) {
      resumeBlendRemaining = resumeBlendDuration;
      resumeStartPos.copy(camera.position);
      resumeStartFov = camera.fov;
    }
  }

  /** Configure the blend time used when resuming after manual drag. */
  function setResumeBlendSeconds(seconds) {
    if (typeof seconds === 'number' && isFinite(seconds)) {
      resumeBlendDuration = Math.max(0, seconds);
    }
  }

  /**
   * Define a sequence of takes (angles) for cinematic mode.
   * @param {Array<{ azimuthDeg: number, elevationDeg?: number, radiusFactor?: number, fovDeg?: number, dwellSeconds?: number, transitionSeconds?: number }>} list
   */
  function setTakes(list = []) {
    takes = Array.isArray(list) ? list.filter(Boolean) : [];
    currentTakeIndex = 0;
    phase = 'dwell';
    phaseTime = 0;
    takesActive = takes.length > 0;
  }

  /**
   * Update camera transform and DOF for the current frame.
   * @param {number} deltaSeconds
   * @param {THREE.Object3D | null} subjectRoot
   */
  function update(deltaSeconds, subjectRoot) {
    if (!enabled || !subjectRoot || !controls) return;
    timeSeconds += Math.max(0, deltaSeconds || 0);
    continuousAzimuthOffset += Math.max(0, deltaSeconds || 0) * dwellDriftSpeedRadPerSec;

    // If the user is manually controlling, skip cinematic updates
    if (manualOverride) return;

    const box = new THREE.Box3().setFromObject(subjectRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

    // Helper easing
    const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    // Resolve cinematic angles either from takes or continuous orbit
    let azimuthRad;
    let phi; // polar angle
    let orbitRadius;
    let fovNow = baseFovDeg;

    if (takesActive && takes.length) {
      let a = takes[currentTakeIndex];
      let nextIndex = (currentTakeIndex + 1) % takes.length;
      let b = takes[nextIndex];
      let dwell = (a.dwellSeconds != null ? a.dwellSeconds : defaultDwell);
      let tdur = (a.transitionSeconds != null ? a.transitionSeconds : defaultTransition);

      // Advance phase timing
      phaseTime += Math.max(0, deltaSeconds || 0);
      if (phase === 'dwell' && phaseTime >= dwell) {
        phase = 'transition';
        phaseTime = 0;
      } else if (phase === 'transition' && phaseTime >= tdur) {
        // Finish transition: advance to next take for the dwell phase
        phase = 'dwell';
        currentTakeIndex = nextIndex;
        phaseTime = 0;
        // Refresh references so this frame uses the new current take
        a = takes[currentTakeIndex];
        nextIndex = (currentTakeIndex + 1) % takes.length;
        b = takes[nextIndex];
        dwell = (a.dwellSeconds != null ? a.dwellSeconds : defaultDwell);
        tdur = (a.transitionSeconds != null ? a.transitionSeconds : defaultTransition);
      }

      const azA = THREE.MathUtils.degToRad(a.azimuthDeg || 0);
      const azB = THREE.MathUtils.degToRad(b.azimuthDeg || 0);
      const elA = THREE.MathUtils.degToRad((a.elevationDeg != null ? a.elevationDeg : elevationDeg));
      const elB = THREE.MathUtils.degToRad((b.elevationDeg != null ? b.elevationDeg : elevationDeg));
      const rfA = (a.radiusFactor != null ? a.radiusFactor : radiusFactor);
      const rfB = (b.radiusFactor != null ? b.radiusFactor : radiusFactor);
      const fovA = (a.fovDeg != null ? a.fovDeg : baseFovDeg);
      const fovB = (b.fovDeg != null ? b.fovDeg : baseFovDeg);

      if (phase === 'transition' && tdur > 1e-3) {
        const p = easeInOut(Math.max(0, Math.min(1, phaseTime / tdur)));
        // Shortest-way azimuth interpolation
        let d = azB - azA;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        azimuthRad = azA + d * p + continuousAzimuthOffset;
        phi = elA + (elB - elA) * p;
        const swayR = 1 + (radiusSwayAmplitude > 0 ? Math.sin(timeSeconds * radiusSwaySpeed) * radiusSwayAmplitude : 0);
        orbitRadius = Math.max(1e-6, radius * (rfA + (rfB - rfA) * p) * swayR);
        fovNow = fovA + (fovB - fovA) * p;
      } else {
        // Dwell: hold angle, allow a subtle micro sway if configured
        const sway = elevationSwayDeg > 0 ? Math.sin(timeSeconds * 0.4) * THREE.MathUtils.degToRad(elevationSwayDeg) : 0;
        azimuthRad = azA + continuousAzimuthOffset;
        phi = elA + sway;
        const swayR = 1 + (radiusSwayAmplitude > 0 ? Math.sin(timeSeconds * radiusSwaySpeed) * radiusSwayAmplitude : 0);
        orbitRadius = Math.max(1e-6, radius * rfA * swayR);
        fovNow = fovA;
      }
    } else {
      // Legacy continuous orbit
      const swayR = 1 + (radiusSwayAmplitude > 0 ? Math.sin(timeSeconds * radiusSwaySpeed) * radiusSwayAmplitude : 0);
      orbitRadius = Math.max(1e-6, radius * radiusFactor * swayR);
      const theta = timeSeconds * orbitSpeedRadPerSec; // azimuth angle over time
      const basePhi = THREE.MathUtils.degToRad(elevationDeg);
      const sway = elevationSwayDeg > 0 ? Math.sin(timeSeconds * 0.4) * THREE.MathUtils.degToRad(elevationSwayDeg) : 0;
      phi = THREE.MathUtils.clamp(basePhi + sway, THREE.MathUtils.degToRad(15), THREE.MathUtils.degToRad(80));
      azimuthRad = theta;
    }

    phi = THREE.MathUtils.clamp(phi, THREE.MathUtils.degToRad(15), THREE.MathUtils.degToRad(80));

    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const x = center.x + orbitRadius * sinPhi * Math.cos(azimuthRad);
    const z = center.z + orbitRadius * sinPhi * Math.sin(azimuthRad);
    const y = center.y + orbitRadius * cosPhi;
    if (resumeBlendRemaining > 0) {
      const t = 1 - Math.max(0, resumeBlendRemaining / Math.max(1e-6, resumeBlendDuration));
      const tt = easeInOut(Math.max(0, Math.min(1, t)));
      const target = new THREE.Vector3(x, y, z);
      camera.position.set(
        THREE.MathUtils.lerp(resumeStartPos.x, target.x, tt),
        THREE.MathUtils.lerp(resumeStartPos.y, target.y, tt),
        THREE.MathUtils.lerp(resumeStartPos.z, target.z, tt)
      );
      resumeBlendRemaining -= Math.max(0, deltaSeconds || 0);
    } else {
      camera.position.set(x, y, z);
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(center);

    // FOV (optional pulsing)
    if (fovPulseEnabled && fovPulseAmplitudeDeg > 0) {
      camera.fov = (fovNow || baseFovDeg) + Math.sin(timeSeconds * 0.6) * fovPulseAmplitudeDeg;
    } else {
      const targetFov = (fovNow || baseFovDeg);
      if (resumeBlendRemaining > 0) {
        const t = 1 - Math.max(0, resumeBlendRemaining / Math.max(1e-6, resumeBlendDuration));
        const tt = easeInOut(Math.max(0, Math.min(1, t)));
        camera.fov = THREE.MathUtils.lerp(resumeStartFov, targetFov, tt);
      } else {
        camera.fov = targetFov;
      }
    }
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

  return { enable, disable, isEnabled, setBokehPass, setOrbitParams, setFovPulse, setTakes, setManualControlActive, setResumeBlendSeconds, update };
}


