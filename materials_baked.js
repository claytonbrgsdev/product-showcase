import * as THREE from 'three';

export function removeDefaultTextureMapsFromModel(modelRoot, remove = true) {
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

export function applyBakedTextureToModel(modelRoot, textureUrl) {
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

export function toggleTextureMapEnabled(modelRoot, key, enabled) {
  if (!modelRoot) return;
  modelRoot.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) continue;
      if (!m.userData || !m.userData._clonedForToggle) {
        const cloned = m.clone();
        cloned.userData = { ...(m.userData || {}), _clonedForToggle: true };
        if (Array.isArray(child.material)) mats[i] = cloned; else child.material = cloned;
      }
    }
    const arr = Array.isArray(child.material) ? child.material : [child.material];
    for (const mm of arr) {
      if (!mm) continue;
      if (!enabled && key in mm) {
        mm[key] = null;
        mm.needsUpdate = true;
      }
    }
  });
}

export function populateTextureTogglesFromModel(modelRoot, textureTogglesEl, opts = { baked: false, fromMaterials: true }) {
  if (!textureTogglesEl) return;
  while (textureTogglesEl.firstChild) textureTogglesEl.removeChild(textureTogglesEl.firstChild);

  const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
  const hasKey = Object.create(null);

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
    input.addEventListener('change', () => toggleTextureMapEnabled(modelRoot, key, input.checked));
    textureTogglesEl.appendChild(row);
  };

  for (const k of keys) {
    const pretty = k.replace('Map', '').replace(/^./, (c) => c.toUpperCase()).replace('Ao', 'AO');
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


