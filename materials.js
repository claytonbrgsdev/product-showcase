import * as THREE from 'three';

export function applyColorToModel(modelRoot, hex) {
  if (!modelRoot) return;
  modelRoot.traverse((child) => {
    if (child.isMesh && child.material) {
      const material = child.material;
      const materials = Array.isArray(material) ? material : [material];
      for (const m of materials) {
        if (m && m.color) m.color.set(hex);
        if (m) m.needsUpdate = true;
      }
    }
  });
}

/**
 * Apply color to the specific mesh/material target: CUBE001 - Material.002
 * Matches mesh name includes "CUBE001" and material name includes "Material.002" (case-insensitive).
 */
export function applyColorToSpecificTarget(modelRoot, hex) {
  if (!modelRoot) return;
  const norm = (s) => (s || '').toString().trim().toLowerCase();
  modelRoot.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const meshName = norm(child.name);
    if (!meshName.includes('cube001')) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (!m) continue;
      const matName = norm(m.name);
      if (matName.includes('material.002') || /material\s*0*02/.test(matName)) {
        if (m.color) m.color.set(hex);
        m.needsUpdate = true;
      }
    }
  });
}

/**
 * Disable the base color map for the specific target (CUBE001 - Material.002)
 * so that color changes are visible immediately.
 */
export function disableMapForSpecificTarget(modelRoot) {
  if (!modelRoot) return;
  const norm = (s) => (s || '').toString().trim().toLowerCase();
  modelRoot.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const meshName = norm(child.name);
    if (!meshName.includes('cube001')) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) continue;
      const matName = norm(m.name);
      if (matName.includes('material.002') || /material\s*0*02/.test(matName)) {
        // Ensure we don't mutate shared instances
        if (!m.userData || !m.userData._clonedForTargetColor) {
          const cloned = m.clone();
          cloned.userData = { ...(m.userData || {}), _clonedForTargetColor: true };
          if (Array.isArray(child.material)) mats[i] = cloned; else child.material = cloned;
        }
        const mat = Array.isArray(child.material) ? child.material[i] : child.material;
        if ('map' in mat && mat.map) { mat.map = null; }
        mat.needsUpdate = true;
      }
    }
  });
}

export function buildMaterialRegistry(modelRoot) {
  /** @type {Array<{ meshId: string, meshName: string, materialIndex: number, materialName: string, material: any }>} */
  const materialRegistry = [];
  if (!modelRoot) return materialRegistry;
  modelRoot.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mesh = child;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) continue;
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
  return materialRegistry;
}

export function populateTextureTogglesFromMaterialRegistry(textureTogglesEl, materialRegistry) {
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

    if (/material\s*0*03/i.test(entry.materialName)) {
      const note = document.createElement('div');
      note.style.fontSize = '11px';
      note.style.opacity = '0.7';
      note.textContent = 'Logo target (use Replace logo below)';
      box.appendChild(note);
    }

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
        if (!cb.checked && k in entry.material) {
          entry.material[k] = null;
          entry.material.needsUpdate = true;
        }
      });
      box.appendChild(row);
    }

    textureTogglesEl.appendChild(box);
  }
}


