/**
 * EvalVisual Composable v8 — 方案A：星星先亮，粒子从星出
 *
 * 核心：
 * 1. 命中星星明显提亮 + 加薄辉光（星星本身先有信号）
 * 2. 粒子从每颗命中星星位置出发，向外环绕扩散（星周盘）
 * 3. 不聚类，每颗星自给自足，叠加出银河感
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

  // ===== 粒子层 =====
  const starParticles = new Map<string, THREE.Points>(); // chunkId -> 该星的粒子群
  const particleGroup = new THREE.Group();
  particleGroup.name = 'eval-galaxy';
  scene.add(particleGroup);

  // ===== 星星本体 =====
  const originalColors = new Map<string, THREE.Color>();
  const originalOpacities = new Map<string, number>();

  // ===== 共现连线 =====
  const coHitLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x4466aa,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  scene.add(coHitLines);

  // ===== 纹理 =====
  let sharpParticleTexture: THREE.CanvasTexture | null = null;

  function getSharpParticleTexture(): THREE.CanvasTexture {
    if (!sharpParticleTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d')!;

      const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.05, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.15, 'rgba(255,255,255,0.6)');
      gradient.addColorStop(0.3, 'rgba(255,255,255,0.08)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 16, 16);

      sharpParticleTexture = new THREE.CanvasTexture(canvas);
      sharpParticleTexture.needsUpdate = true;
    }
    return sharpParticleTexture;
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

  /** 为单颗命中星星生成星周粒子盘 */
  function spawnStarParticles(chunkId: string) {
    if (starParticles.has(chunkId)) return; // 已生成过

    const starInfo = starDataMap.get(chunkId);
    if (!starInfo) return;

    const hitCount = hitCounts.get(chunkId) || 0;
    if (hitCount < 1) return;

    const pos = starInfo.sprite.position;

    // 粒子数随命中数增长
    const particleCount = Math.min(5 + hitCount * 3, 30);
    const spread = 4 + hitCount * 1.5; // 扩散范围

    // 颜色
    let color: THREE.Color;
    if (hitCount === 1) color = new THREE.Color(0x6688bb);
    else if (hitCount === 2) color = new THREE.Color(0x7788aa);
    else if (hitCount < 5) color = new THREE.Color(0x8877aa);
    else color = new THREE.Color(0x9977aa);

    // 生成盘状粒子
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.5) * spread; // 幂分布，中心更密
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.3; // 椭圆压缩成盘
      const z = (Math.random() - 0.5) * 2.5;

      positions[i * 3] = pos.x + x;
      positions[i * 3 + 1] = pos.y + y;
      positions[i * 3 + 2] = pos.z + z;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      map: getSharpParticleTexture(),
      color,
      size: 3.0,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    particleGroup.add(points);
    starParticles.set(chunkId, points);
  }

  /** 星星本体：明显提亮 + 薄辉光 */
  function applyStarEffect(chunkId: string) {
    const starInfo = starDataMap.get(chunkId);
    if (!starInfo) return;

    const hitCount = hitCounts.get(chunkId) || 0;
    const sprite = starInfo.sprite;

    if (!originalColors.has(chunkId)) {
      originalColors.set(chunkId, starInfo.originalMaterial.color.clone());
    }
    if (!originalOpacities.has(chunkId)) {
      originalOpacities.set(chunkId, starInfo.originalMaterial.opacity);
    }

    if (hitCount > 0) {
      const origColor = originalColors.get(chunkId)!;
      const warmth = Math.min(hitCount / 5, 1);
      const newColor = origColor.clone().lerp(new THREE.Color(0xffffff), warmth);
      const boost = 1 + hitCount * 0.2;
      newColor.r = Math.min(1, newColor.r * boost);
      newColor.g = Math.min(1, newColor.g * boost);
      newColor.b = Math.min(1, newColor.b * boost);
      sprite.material.color.copy(newColor);
      sprite.material.opacity = Math.min(1, 0.5 + hitCount * 0.1);
      sprite.material.needsUpdate = true;

      // 粒子从星星位置出发
      spawnStarParticles(chunkId);
    }
  }

  /** 更新共现连线 */
  function updateCoHitLines() {
    const positions: number[] = [];
    coHitCounts.forEach((count, key) => {
      if (count < 4) return;
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
    });

    // 清除所有粒子
    starParticles.forEach(points => {
      particleGroup.remove(points);
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    });
    starParticles.clear();

    coHitLines.geometry.dispose();
    coHitLines.geometry = new THREE.BufferGeometry();

    hitCounts.clear();
    coHitCounts.clear();
    originalColors.clear();
    originalOpacities.clear();
    sharpParticleTexture = null;
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
    return {
      totalHits, maxHits, maxHitId, maxCoHits, maxCoHitKey,
      uniqueStars: hitCounts.size,
      coHitPairs: coHitCounts.size,
      starParticleGroups: starParticles.size,
    };
  }

  return { processStep, applyAllEffects, reset, getStats, hitCounts, coHitCounts };
}
