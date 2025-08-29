export function createLoadingOverlay() {
  /** @type {HTMLElement | null} */
  const loadingOverlayEl = document.getElementById('loadingOverlay');
  /** @type {HTMLElement | null} */
  const loadingTextEl = document.getElementById('loadingText');

  const show = () => { if (loadingOverlayEl) loadingOverlayEl.style.display = 'flex'; };
  const hide = () => { if (loadingOverlayEl) loadingOverlayEl.style.display = 'none'; };
  const setProgress = (pct) => {
    if (loadingTextEl) {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      loadingTextEl.textContent = `Loading… ${clamped}%`;
    }
  };

  return { show, hide, setProgress };
}


