import * as THREE from 'three';

export const material003OriginalMaps = new Map();
export const material003OriginalImages = new Map();

export async function loadImageElement(url) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

export function copyTextureTransform(src, dst) {
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

export function createSquareFitCanvas(img, size = 1200) {
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

export function computeUvBoundsForMaterial(mesh, materialIndex, texture) {
  const geom = mesh.geometry;
  const uvAttr = geom?.attributes?.uv;
  if (!uvAttr) return null;
  const applyTransform = (u, v) => {
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

export function computeRawUvBoundsForMaterial(mesh, materialIndex) {
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

export function estimateBackgroundColorFromBorder(imageData) {
  const { data, width, height } = imageData;
  let r = 0, g = 0, b = 0, n = 0;
  const add = (x, y) => { const i = (y * width + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { add(0, y); add(width - 1, y); }
  if (!n) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

export function buildForegroundMask(imageData, bg, threshold = 28) {
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

export function largestMaskBoundingBox(maskObj) {
  const { width, height, mask } = maskObj;
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

// Compose the uploaded logo into the original texture at the mesh's UV rect
export function composeLogoIntoOriginalTexture({ mesh, materialIndex, originalTexture, logoImage }) {
  const img = originalTexture.image;
  const width = img.width || img.videoWidth || 0;
  const height = img.height || img.videoHeight || 0;
  if (!width || !height) throw new Error('Original texture image not ready');

  const bounds = computeUvBoundsForMaterial(mesh, materialIndex, originalTexture);
  if (!bounds) throw new Error('UV bounds unavailable');
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const minU = clamp01(bounds.minU), minV = clamp01(bounds.minV);
  const maxU = clamp01(bounds.maxU), maxV = clamp01(bounds.maxV);

  const vToY = (v) => (originalTexture.flipY === false ? Math.round(v * height) : Math.round((1 - v) * height));
  const y1 = vToY(minV);
  const y2 = vToY(maxV);
  const rectX = Math.round(minU * width);
  const rectY = Math.min(y1, y2);
  const rectW = Math.max(1, Math.round((maxU - minU) * width));
  const rectH = Math.max(1, Math.abs(y2 - y1));

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.drawImage(img, 0, 0, width, height);

  const safeRectW = Math.max(8, rectW);
  const safeRectH = Math.max(8, rectH);
  const safeRectX = Math.max(0, Math.min(width - safeRectW, rectX));
  const safeRectY = Math.max(0, Math.min(height - safeRectH, rectY));
  const sub = ctx.getImageData(safeRectX, safeRectY, safeRectW, safeRectH);
  const bg = estimateBackgroundColorFromBorder(sub);
  const mask = buildForegroundMask(sub, bg, 28);
  const bbox = largestMaskBoundingBox(mask);
  const target = bbox || { x: 0, y: 0, w: safeRectW, h: safeRectH };

  // Scale larger and center within the safe rectangle
  const coverage = 2.5; // aggressively overfill beyond the safe rect
  const availW = Math.max(1, Math.round(safeRectW * coverage));
  const availH = Math.max(1, Math.round(safeRectH * coverage));
  const scale = Math.min(availW / logoImage.width, availH / logoImage.height);
  const drawW = Math.max(1, Math.round(logoImage.width * scale));
  const drawH = Math.max(1, Math.round(logoImage.height * scale));
  const dx = safeRectX + Math.round((safeRectW - drawW) / 2);
  const dy = safeRectY + Math.round((safeRectH - drawH) / 2);

  try {
    const data = sub.data;
    const m = mask.mask;
    const mw = mask.width;
    const mh = mask.height;
    const br = Math.round(bg.r);
    const bgG = Math.round(bg.g);
    const bb = Math.round(bg.b);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (m[y * mw + x]) {
          const i = (y * mw + x) * 4;
          data[i] = br; data[i + 1] = bgG; data[i + 2] = bb; data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(sub, safeRectX, safeRectY);
  } catch (_) {}

  try { /* background padding removed intentionally */ } catch (_) {}

  ctx.drawImage(logoImage, dx, dy, drawW, drawH);
  return canvas;
}

export function neutralizePbrMapsForUvRect(mesh, materialIndex, bounds) {
  const mat = Array.isArray(mesh.material) ? mesh.material[materialIndex] : mesh.material;
  if (!mat) return;
  const { minU, minV, maxU, maxV } = bounds || {};
  if (minU == null || minV == null || maxU == null || maxV == null) return;

  const handle = (tex, kind) => {
    if (!tex || !tex.image) return;
    const img = tex.image;
    const ew = img.width || img.videoWidth || 0;
    const eh = img.height || img.videoHeight || 0;
    if (!ew || !eh) return;
    const eVToY = (v) => (tex.flipY === false ? Math.round(v * eh) : Math.round((1 - v) * eh));
    const eY1 = eVToY(minV);
    const eY2 = eVToY(maxV);
    const eRectX = Math.round(Math.max(0, Math.min(1, minU)) * ew);
    const eRectY = Math.min(eY1, eY2);
    const eRectW = Math.max(1, Math.round((Math.max(0, Math.min(1, maxU)) - Math.max(0, Math.min(1, minU))) * ew));
    const eRectH = Math.max(1, Math.abs(eY2 - eY1));

    const eCanvas = document.createElement('canvas');
    eCanvas.width = ew; eCanvas.height = eh;
    const eCtx = eCanvas.getContext('2d');
    if (!eCtx) return;
    eCtx.drawImage(img, 0, 0, ew, eh);

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const bx = clamp(eRectX, 0, ew - 1);
    const by = clamp(eRectY, 0, eh - 1);
    const bw = clamp(eRectW, 1, ew - bx);
    const bh = clamp(eRectH, 1, eh - by);

    if (kind === 'normal') {
      const neutral = { r: 128, g: 128, b: 255 };
      const imgData = eCtx.getImageData(bx, by, bw, bh);
      const data = imgData.data;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = (y * bw + x) * 4;
          data[i] = neutral.r; data[i + 1] = neutral.g; data[i + 2] = neutral.b; data[i + 3] = 255;
        }
      }
      eCtx.putImageData(imgData, bx, by);
    } else {
      const border = 2;
      const sampleRects = [
        { x: bx, y: by, w: bw, h: Math.min(border, bh) },
        { x: bx, y: by + Math.max(0, bh - border), w: bw, h: Math.min(border, bh) },
        { x: bx, y: by, w: Math.min(border, bw), h: bh },
        { x: bx + Math.max(0, bw - border), y: by, w: Math.min(border, bw), h: bh },
      ];
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (const r of sampleRects) {
        if (r.w <= 0 || r.h <= 0) continue;
        const id = eCtx.getImageData(r.x, r.y, r.w, r.h);
        const d = id.data;
        for (let i = 0; i < d.length; i += 4) { sumR += d[i]; sumG += d[i + 1]; sumB += d[i + 2]; count++; }
      }
      const avgR = count ? Math.round(sumR / count) : 0;
      const avgG = count ? Math.round(sumG / count) : 0;
      const avgB = count ? Math.round(sumB / count) : 0;
      const id = eCtx.getImageData(bx, by, bw, bh);
      const d = id.data;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = (y * bw + x) * 4;
          if (kind === 'roughness') d[i + 1] = avgG;
          else if (kind === 'metalness') d[i + 2] = avgB;
          else if (kind === 'ao') d[i] = avgR;
          d[i + 3] = 255;
        }
      }
      eCtx.putImageData(id, bx, by);
    }

    tex.image = eCanvas;
    tex.needsUpdate = true;
  };

  try { handle(mat.normalMap, 'normal'); } catch (_) {}
  try { handle(mat.roughnessMap, 'roughness'); } catch (_) {}
  try { handle(mat.metalnessMap, 'metalness'); } catch (_) {}
  try { handle(mat.aoMap, 'ao'); } catch (_) {}
}

export async function replaceMaterial003BaseMap(modelRoot, imageUrl) {
  if (!modelRoot) return;
  const uploadedImg = await loadImageElement(imageUrl);
  const re = /material[\s._-]*0*03/i;
  modelRoot.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) continue;
      const name = (m.name || '').toString();
      if (!re.test(name)) continue;
      if (!m.userData || !m.userData._clonedForLogo) {
        const cloned = m.clone();
        cloned.userData = { ...(m.userData || {}), _clonedForLogo: true };
        if (Array.isArray(child.material)) mats[i] = cloned; else child.material = cloned;
      }
      const mat = Array.isArray(child.material) ? child.material[i] : child.material;
      if (!mat.userData) mat.userData = {};
      if (!mat.userData._origEmissiveSnap) {
        mat.userData._origEmissiveSnap = {
          hasEmissive: ('emissive' in mat),
          emissiveHex: (mat.emissive && typeof mat.emissive.getHex === 'function') ? mat.emissive.getHex() : null,
          emissiveIntensity: (typeof mat.emissiveIntensity === 'number') ? mat.emissiveIntensity : null,
          emissiveMap: ('emissiveMap' in mat) ? (mat.emissiveMap || null) : null,
        };
      }
      if ('emissiveMap' in mat) mat.emissiveMap = null;
      if ('emissive' in mat && mat.emissive && typeof mat.emissive.set === 'function') mat.emissive.set(0x000000);
      if ('emissiveIntensity' in mat && typeof mat.emissiveIntensity === 'number') mat.emissiveIntensity = 0;
      mat.needsUpdate = true;
      const original = mat.map || null;
      if (!material003OriginalMaps.has(mat)) material003OriginalMaps.set(mat, original);

      if (original && child.geometry?.attributes?.uv) {
        try {
          const rawUv = computeRawUvBoundsForMaterial(child, i);
          const boundsTransformed = computeUvBoundsForMaterial(child, i, original);
          const texW = original.image?.width || 1024;
          const texH = original.image?.height || 1024;
          const islandPxW = rawUv ? Math.round(Math.abs(rawUv.maxU - rawUv.minU) * texW) : 0;
          const islandPxH = rawUv ? Math.round(Math.abs(rawUv.maxV - rawUv.minV) * texH) : 0;
          let tinyIsland = islandPxW * islandPxH > 0 && (islandPxW < 64 || islandPxH < 64);
          try {
            if (boundsTransformed) {
              const bw = Math.round(Math.abs(boundsTransformed.maxU - boundsTransformed.minU) * texW);
              const bh = Math.round(Math.abs(boundsTransformed.maxV - boundsTransformed.minV) * texH);
              if (bw > 0 && bh > 0 && (bw < 96 || bh < 96)) tinyIsland = true;
            }
          } catch (_) {}

          let composed;
          if (tinyIsland) {
            const side = 512;
            const aux = document.createElement('canvas');
            aux.width = side; aux.height = side;
            const c2 = aux.getContext('2d');
            if (!c2) throw new Error('Canvas 2D context not available');
            try {
              if (boundsTransformed && original.image) {
                const iw = original.image.width || original.image.videoWidth || 0;
                const ih = original.image.height || original.image.videoHeight || 0;
                const vToY = (v) => (original.flipY === false ? Math.round(v * ih) : Math.round((1 - v) * ih));
                const minU = Math.max(0, Math.min(1, boundsTransformed.minU));
                const maxU = Math.max(0, Math.min(1, boundsTransformed.maxU));
                const minV = Math.max(0, Math.min(1, boundsTransformed.minV));
                const maxV = Math.max(0, Math.min(1, boundsTransformed.maxV));
                const rx = Math.max(0, Math.min(iw - 1, Math.round(minU * iw)));
                const ry = Math.max(0, Math.min(ih - 1, Math.min(vToY(minV), vToY(maxV))));
                const rw = Math.max(1, Math.round((maxU - minU) * iw));
                const rh = Math.max(1, Math.abs(vToY(maxV) - vToY(minV)));
                const tmp = document.createElement('canvas'); tmp.width = iw; tmp.height = ih;
                const tctx = tmp.getContext('2d');
                if (tctx) {
                  tctx.drawImage(original.image, 0, 0, iw, ih);
                  const sub = tctx.getImageData(rx, ry, rw, rh);
                  const bg = estimateBackgroundColorFromBorder(sub);
                  c2.fillStyle = `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`;
                  c2.fillRect(0, 0, side, side);
                }
              }
            } catch (_) { c2.clearRect(0, 0, side, side); }
            const overfill = 1.8; // aggressively scale up and allow cropping
            const s = Math.max(side / uploadedImg.width, side / uploadedImg.height) * overfill;
            const dw = Math.round(uploadedImg.width * s);
            const dh = Math.round(uploadedImg.height * s);
            const ox = Math.round((side - dw) / 2);
            const oy = Math.round((side - dh) / 2);
            c2.drawImage(uploadedImg, ox, oy, dw, dh);
            composed = aux;
          } else {
            composed = composeLogoIntoOriginalTexture({ mesh: child, materialIndex: i, originalTexture: original, logoImage: uploadedImg });
          }
          if (tinyIsland) {
            try { neutralizePbrMapsForUvRect(child, i, boundsTransformed || rawUv); } catch (_) {}
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
            if (rawUv) {
              const du = Math.max(1e-6, Math.abs(rawUv.maxU - rawUv.minU));
              const dv = Math.max(1e-6, Math.abs(rawUv.maxV - rawUv.minV));
              mat.map.repeat.set(du, dv);
              mat.map.offset.set(rawUv.minU, rawUv.minV);
              mat.map.rotation = 0;
              mat.map.center.set(0, 0);
              mat.map.needsUpdate = true;
            }
          } else {
            if (!material003OriginalImages.has(original)) material003OriginalImages.set(original, original.image);
            original.image = composed; original.needsUpdate = true; mat.map = original;
          }
          if ('color' in mat) mat.color.set('#ffffff');
          mat.needsUpdate = true;
          console.log('[logo] applied to material', { mesh: child.name, materialName: mat.name, method: (tinyIsland ? 'dedicated-texture' : 'uv-composite') });
        } catch (e) {
          const baseTex = new THREE.CanvasTexture(createSquareFitCanvas(uploadedImg, 1200));
          baseTex.colorSpace = THREE.SRGBColorSpace; baseTex.anisotropy = 8; baseTex.flipY = typeof original?.flipY === 'boolean' ? original.flipY : true; baseTex.generateMipmaps = true; baseTex.needsUpdate = true; if (original) copyTextureTransform(original, baseTex); mat.map = baseTex;
          console.warn('[logo] fallback canvas used for', { mesh: child.name, materialName: mat.name, error: String(e) });
        }
      } else {
        const baseTex = new THREE.CanvasTexture(createSquareFitCanvas(uploadedImg, 1200));
        baseTex.colorSpace = THREE.SRGBColorSpace; baseTex.anisotropy = 8; baseTex.flipY = true; baseTex.generateMipmaps = true; baseTex.needsUpdate = true; if (original) copyTextureTransform(original, baseTex); mat.map = baseTex;
        console.log('[logo] applied to material', { mesh: child.name, materialName: mat.name, method: 'fallback-square' });
      }
      if ('color' in mat) mat.color.set('#ffffff');
      mat.needsUpdate = true;
    }
  });
}

export function restoreMaterial003BaseMap(modelRoot) {
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
      if (original !== undefined) { m.map = original; m.needsUpdate = true; }
      if (m.map && material003OriginalImages.has(m.map)) {
        const img = material003OriginalImages.get(m.map);
        m.map.image = img; m.map.needsUpdate = true;
      }
      if (m.userData && m.userData._origEmissiveSnap) {
        const s = m.userData._origEmissiveSnap;
        if ('emissiveMap' in m) m.emissiveMap = s.emissiveMap || null;
        if ('emissive' in m && m.emissive && s.emissiveHex != null && typeof m.emissive.setHex === 'function') m.emissive.setHex(s.emissiveHex);
        if ('emissiveIntensity' in m && typeof s.emissiveIntensity === 'number') m.emissiveIntensity = s.emissiveIntensity;
        m.needsUpdate = true; m.userData._origEmissiveSnap = null;
      }
    }
  });
  modelRoot.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mm of mats) { if (!mm || !mm.userData) continue; if (mm.userData._clonedForLogo) mm.userData._clonedForLogo = false; }
  });
  material003OriginalMaps.clear(); material003OriginalImages.clear();
}



