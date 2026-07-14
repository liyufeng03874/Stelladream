/**
 * EvalVisual Composable v7 — 极致锐利星尘
 *
 * 修复：
 * 1. 纹理：中心实心白点，0.05 半径内 100% alpha，之后归零 → 纯星点，零雾感
 * 2. 尺寸从 0.6 降到 0.3
 * 3. 去掉所有柔光 sprite，只用 Points
 * 4. 连线 opacity 降到 0.04
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
  const galaxyParticles: THREE.Points[] = [];
  const particleGroup = new THREE.Group();
  particleGroup.name = 'eval-galaxy';
  scene.add(particleGroup);

  const renderedClusters = new Set<string>();

  // ===== 星星本体微调 =====
  const originalColors = new Map<string, THREE.Color>();
  const originalOpacities = new Map<string, number>();

  // ===== 共现连线（几乎不可见） =====
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

  // ===== 纹理：极致锐利星点 =====
  let sharpParticleTexture: THREE.CanvasTexture | null = null;

  function getSharpParticleTexture(): THREE.CanvasTexture {
    if (!sharpParticleTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d')!;

      // 中心实心亮点，0.05 半径内 100% alpha，之后快速衰减
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

  // ===== 空间聚类 =====
  function buildClusters(): Array<{ center: THREE.Vector3; hitCount: number; memberCount: number }> {
    const positions: { id: string; pos: THREE.Vector3; hits: number }[] = [];
    hitCounts.forEach((count, id) => {
      const info = starDataMap.get(id);
      if (info && isFinite(info.sprite.position.x)) {
        positions.push({ id, pos: info.sprite.position.clone(), hits: count });
      }
    });

    if (positions.length === 0) return [];

    const clusters: Array<{ center: THREE.Vector3; hitCount: number; memberCount: number }> = [];
    const assigned = new Set<string>();
    positions.sort((a, b) => b.hits - a.hits);
    const CLUSTER_RADIUS = 15;

    for (const p of positions) {
      if (assigned.has(p.id)) continue;

      const members: string[] = [p.id];
      assigned.add(p.id);
      let totalHits = p.hits;
      const center = p.pos.clone();

      for (const q of positions) {
        if (assigned.has(q.id)) continue;
        if (p.pos.distanceTo(q.pos) < CLUSTER_RADIUS) {
          assigned.add(q.id);
          members.push(q.id);
          totalHits += q.hits;
          center.add(q.pos);
        }
      }

      center.divideScalar(members.length);
      clusters.push({ center, hitCount: totalHits, memberCount: members.length });
    }

    return clusters;
  }

  /** 为单个簇生成粒子 */
  function spawnClusterParticles(cluster: { center: THREE.Vector3; hitCount: number; memberCount: number }) {
    const clusterKey = `${cluster.center.x.toFixed(1)},${cluster.center.y.toFixed(1)},${cluster.center.z.toFixed(1)}`;
    if (renderedClusters.has(clusterKey)) return;
    if (cluster.hitCount < 2) return;

    console.log(`[eval] 生成簇粒子: center=(${cluster.center.x.toFixed(1)},${cluster.center.y.toFixed(1)},${cluster.center.z.toFixed(1)}), hits=${cluster.hitCount}, members=${cluster.memberCount}`);

    // 粒子数：少而精
    const particleCount = Math.min(20 + cluster.hitCount * 5, 100);
    const spread = cluster.memberCount * 1.2 + 6;

    // 颜色：低命中=冷蓝，高命中=暖紫
    let color: THREE.Color;
    if (cluster.hitCount < 5) color = new THREE.Color(0x6688bb);
    else if (cluster.hitCount < 10) color = new THREE.Color(0x7788aa);
    else if (cluster.hitCount < 20) color = new THREE.Color(0x8877aa);
    else color = new THREE.Color(0x9977aa);

    // THREE.Points 批量渲染
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.7) * spread; // 幂分布，中心更密
      // 盘状分布
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.3;
      const z = (Math.random() - 0.5) * 2;

      positions[i * 3] = cluster.center.x + x;
      positions[i * 3 + 1] = cluster.center.y + y;
      positions[i * 3 + 2] = cluster.center.z + z;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      map: getSharpParticleTexture(),
      color,
      size: 3.0, // 从 0.3 调到 3.0
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    particleGroup.add(points);
    galaxyParticles.push(points);

    console.log(`[eval] 已添加 ${particleCount} 个粒子到 particleGroup，当前共 ${galaxyParticles.length} 个对象`);

    renderedClusters.add(clusterKey);
  }

  /** 星星本体：只改颜色，不加辉光 */
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
      const warmth = Math.min(hitCount / 8, 1);
      const newColor = origColor.clone().lerp(new THREE.Color(0xffffff), warmth);
      const boost = 1 + hitCount * 0.08;
      newColor.r = Math.min(1, newColor.r * boost);
      newColor.g = Math.min(1, newColor.g * boost);
      newColor.b = Math.min(1, newColor.b * boost);
      sprite.material.color.copy(newColor);
      sprite.material.needsUpdate = true;
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

    const clusters = buildClusters();
    clusters.forEach(c => spawnClusterParticles(c));

    updateCoHitLines();
  }

  /** 处理一步 */
  function processStep(chunkIds: string[]) {
    recordHits(chunkIds);
    for (const id of chunkIds) {
      applyStarEffect(id);
    }
    const clusters = buildClusters();
    clusters.forEach(c => spawnClusterParticles(c));
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

    galaxyParticles.forEach(p => {
      particleGroup.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    });
    galaxyParticles.length = 0;
    renderedClusters.clear();

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
      clusterCount: renderedClusters.size,
    };
  }

  return { processStep, applyAllEffects, reset, getStats, hitCounts, coHitCounts };
}
