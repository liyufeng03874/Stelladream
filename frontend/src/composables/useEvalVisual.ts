/**
 * EvalVisual Composable - 数据沉淀式星云效果（v2 调参）
 *
 * 设计原则：
 * - 每颗星只挂一层薄薄的辉光，让 GPU AdditiveBlending 自然叠加出星云感
 * - 亮度变化在星星本体上体现，不用大光球覆盖
 * - 不放大星星，只改亮度和辉光
 */

import * as THREE from 'three';

interface EvalVisualContext {
  scene: THREE.Scene;
  starDataMap: Map<string, {
    sprite: THREE.Sprite;
    originalMaterial: THREE.SpriteMaterial;
    originalScale: THREE.Vector3;
  }>;
}

export function useEvalVisual(context: EvalVisualContext) {
  const { scene, starDataMap } = context;

  // ===== 数据层 =====
  const hitCounts = new Map<string, number>();
  const coHitCounts = new Map<string, number>();

  // ===== 渲染层 =====
  const glowSprites = new Map<string, THREE.Sprite>(); // 每颗星只保留 1 个光晕
  const coHitLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x6688cc,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  scene.add(coHitLines);

  // 缓存原始值
  const originalColors = new Map<string, THREE.Color>();
  const originalOpacities = new Map<string, number>();

  // 共享辉光纹理（避免为每颗星创建 canvas）
  let sharedGlowTexture: THREE.CanvasTexture | null = null;

  function getSharedGlowTexture(color: number): THREE.CanvasTexture {
    if (!sharedGlowTexture) {
      // 创建中性白色辉光纹理
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255,255,255,0.6)');
      gradient.addColorStop(0.2, 'rgba(255,255,255,0.25)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.06)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      sharedGlowTexture = new THREE.CanvasTexture(canvas);
      sharedGlowTexture.needsUpdate = true;
    }
    return sharedGlowTexture;
  }

  /** 记录命中 */
  function recordHits(chunkIds: string[]) {
    for (const id of chunkIds) {
      hitCounts.set(id, (hitCounts.get(id) || 0) + 1);
    }
    for (let i = 0; i < chunkIds.length; i++) {
      for (let j = i + 1; j < chunkIds.length; j++) {
        const [a, b] = chunkIds[i] < chunkIds[j] ? [chunkIds[i], chunkIds[j]] : [chunkIds[j], chunkIds[i]];
        const key = `${a}:${b}`;
        coHitCounts.set(key, (coHitCounts.get(key) || 0) + 1);
      }
    }
  }

  /** 星星本体亮度 → 命中即提亮，颜色往白走 */
  function getStarColor(hitCount: number, origColor: THREE.Color): THREE.Color {
    if (hitCount <= 0) return origColor.clone();
    const warmth = Math.min(hitCount / 10, 1);
    const result = origColor.clone().lerp(new THREE.Color(0xffffff), warmth);
    const boost = 1 + hitCount * 0.3;
    result.r = Math.min(1, result.r * boost);
    result.g = Math.min(1, result.g * boost);
    result.b = Math.min(1, result.b * boost);
    return result;
  }

  /** 光晕尺寸（相对场景尺度很小） */
  function getGlowSize(hitCount: number): number {
    if (hitCount <= 0) return 0;
    if (hitCount === 1) return 1.5;
    if (hitCount === 2) return 2.0;
    if (hitCount <= 5) return 2.0 + hitCount * 0.3;
    return 3.5;
  }

  /** 光晕颜色（命中越多越暖） */
  function getGlowColor(hitCount: number): number {
    if (hitCount === 1) return 0x99bbff;
    if (hitCount === 2) return 0xaabbdd;
    if (hitCount <= 5) return 0xbb99dd;
    return 0xddaaff;
  }

  /** 为单颗星应用效果 */
  function applyStarEffect(chunkId: string) {
    const starInfo = starDataMap.get(chunkId);
    if (!starInfo) return;

    const hitCount = hitCounts.get(chunkId) || 0;
    const sprite = starInfo.sprite;

    // 缓存原始值
    if (!originalColors.has(chunkId)) {
      originalColors.set(chunkId, starInfo.originalMaterial.color.clone());
    }
    if (!originalOpacities.has(chunkId)) {
      originalOpacities.set(chunkId, starInfo.originalMaterial.opacity);
    }

    // 1) 星星本体：颜色提亮 + 不透明度不变
    const newColor = getStarColor(hitCount, originalColors.get(chunkId)!);
    sprite.material.color.copy(newColor);
    sprite.material.needsUpdate = true;

    // 2) 单层辉光（替换式，不叠加多个）
    clearGlow(chunkId);
    if (hitCount > 0) {
      const glowSize = getGlowSize(hitCount);
      const glowColor = getGlowColor(hitCount);
      const glow = createSingleGlow(sprite.position.clone(), glowColor, glowSize, hitCount);
      glowSprites.set(chunkId, glow);
    }
  }

  function clearGlow(chunkId: string) {
    const existing = glowSprites.get(chunkId);
    if (existing) {
      scene.remove(existing);
      if (existing.material instanceof THREE.SpriteMaterial) {
        existing.material.dispose();
      }
      glowSprites.delete(chunkId);
    }
  }

  /** 创建单个辉光（薄层柔光） */
  function createSingleGlow(position: THREE.Vector3, color: number, size: number, hitCount: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: getSharedGlowTexture(color),
      color: new THREE.Color(color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: Math.min(0.15 + hitCount * 0.03, 0.4), // 低 opacity，靠叠加出效果
    });

    const glow = new THREE.Sprite(material);
    glow.position.copy(position);
    glow.scale.set(size, size, 1);
    scene.add(glow);
    return glow;
  }

  /** 更新共现连线 */
  function updateCoHitLines() {
    const positions: number[] = [];
    const threshold = 2;

    coHitCounts.forEach((count, key) => {
      if (count < threshold) return;
      const [idA, idB] = key.split(':');
      const starA = starDataMap.get(idA);
      const starB = starDataMap.get(idB);
      if (!starA || !starB) return;

      positions.push(
        starA.sprite.position.x, starA.sprite.position.y, starA.sprite.position.z,
        starB.sprite.position.x, starB.sprite.position.y, starB.sprite.position.z
      );
    });

    const geometry = new THREE.BufferGeometry();
    if (positions.length > 0) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    }
    coHitLines.geometry.dispose();
    coHitLines.geometry = geometry;
  }

  /** 批量应用 */
  function applyAllEffects() {
    hitCounts.forEach((_, chunkId) => {
      applyStarEffect(chunkId);
    });
    updateCoHitLines();
  }

  /** 处理一步 */
  function processStep(chunkIds: string[]) {
    recordHits(chunkIds);
    for (const id of chunkIds) {
      applyStarEffect(id);
    }
    updateCoHitLines();
  }

  /** 重置 */
  function reset() {
    hitCounts.forEach((_, chunkId) => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;
      const origColor = originalColors.get(chunkId);
      if (origColor) starInfo.sprite.material.color.copy(origColor);
      const origOpacity = originalOpacities.get(chunkId);
      if (origOpacity !== undefined) starInfo.sprite.material.opacity = origOpacity;
      starInfo.sprite.material.needsUpdate = true;
      clearGlow(chunkId);
    });

    coHitLines.geometry.dispose();
    coHitLines.geometry = new THREE.BufferGeometry();

    hitCounts.clear();
    coHitCounts.clear();
    originalColors.clear();
    originalOpacities.clear();
    glowSprites.clear();
    sharedGlowTexture = null; // 重建纹理
  }

  function getStats() {
    let maxHits = 0, maxHitId = '', totalHits = 0;
    hitCounts.forEach((count, id) => {
      totalHits += count;
      if (count > maxHits) { maxHits = count; maxHitId = id; }
    });

    let maxCoHits = 0, maxCoHitKey = '';
    coHitCounts.forEach((count, key) => {
      if (count > maxCoHits) { maxCoHits = count; maxCoHitKey = key; }
    });

    return { totalHits, maxHits, maxHitId, maxCoHits, maxCoHitKey, uniqueStars: hitCounts.size, coHitPairs: coHitCounts.size };
  }

  return { processStep, applyAllEffects, reset, getStats, hitCounts, coHitCounts };
}
