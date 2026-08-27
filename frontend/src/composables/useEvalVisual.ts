/**
 * EvalVisual Composable v12
 *
 * 1. 命中星直接放大+变白（主角）
 * 2. 粒子极小、不抢戏（配角）
 * 3. applyAllEffects 不重复生粒子，只放大星星
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

function getDomainFromChunkId(chunkId: string): string {
  if (chunkId.startsWith('cmrc_')) return 'general';
  if (chunkId.startsWith('doc_')) return 'medical';
  if (chunkId.includes('::')) return 'law';
  return 'game';
}

const DOMAIN_COLORS: Record<string, THREE.Color> = {
  'general': new THREE.Color(0x2ECC71),
  'medical': new THREE.Color(0x4A9AF5),
  'law': new THREE.Color(0xE74C3C),
  'game': new THREE.Color(0xF5A623),
};

export function useEvalVisual(context: EvalVisualContext) {
  const { scene, starDataMap } = context;

  const hitCounts = new Map<string, number>();
  const maxGrades = new Map<string, number>();
  const coHitCounts = new Map<string, number>();
  let totalSteps = 0;

  // 粒子层
  const spiralParticles: THREE.Points[] = [];
  const particleGroup = new THREE.Group();
  particleGroup.name = 'eval-particles';
  scene.add(particleGroup);

  // 连接层
  const bridgeLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x66aacc,
      transparent: true,
      opacity: 0.015,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  scene.add(bridgeLines);

  // 粒子纹理
  let particleTexture: THREE.CanvasTexture | null = null;

  function getParticleTexture(): THREE.CanvasTexture {
    if (!particleTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 16; canvas.height = 16;
      const ctx = canvas.getContext('2d')!;
      const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.15, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 16, 16);
      particleTexture = new THREE.CanvasTexture(canvas);
      particleTexture.needsUpdate = true;
    }
    return particleTexture;
  }

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

  /** 命中星提亮+放大：主角 */
  function brightenStars() {
    hitCounts.forEach((count, chunkId) => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;
      const grade = maxGrades.get(chunkId) ?? 3;
      const gradeFactor = grade <= 0 ? 0.72 : 0.82 + grade * 0.06;
      sprite.material.color.set(0xffffff);
      sprite.material.opacity = gradeFactor;
      const baseScale = starInfo.originalScale.x;
      const gradeScale = grade <= 0 ? 2.2 : 2.4 + grade * 0.35;
      const scale = baseScale * (gradeScale + Math.min(count, 3) * 0.35);
      sprite.scale.set(scale, scale, 1);
      sprite.material.needsUpdate = true;
    });
  }

  /** 粒子点缀：极小、同领域颜色统一、不抢主角 */
  function spawnSpiralParticles(chunkIds: string[]) {
    const byDomain: Map<string, number[]> = new Map();

    for (const chunkId of chunkIds) {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) continue;

      const domain = getDomainFromChunkId(chunkId);
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      const group = byDomain.get(domain)!;

      const pos = starInfo.sprite.position;
      // 每步每星只生 1 个粒子，极小
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 4;
      group.push(
        pos.x + Math.cos(angle) * radius,
        pos.y + Math.sin(angle) * radius * 0.3,
        pos.z + (Math.random() - 0.5) * 2
      );
    }

    byDomain.forEach((positions, domain) => {
      if (positions.length === 0) return;

      const color = DOMAIN_COLORS[domain] || new THREE.Color(0xaabbdd);
      const positionsArr = new Float32Array(positions);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positionsArr, 3));

      const material = new THREE.PointsMaterial({
        map: getParticleTexture(),
        size: 0.8,  // 比星星小得多，不喧宾夺主
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        color: color,
      });

      const points = new THREE.Points(geometry, material);
      particleGroup.add(points);
      spiralParticles.push(points);
    });
  }

  /** 极弱连线 */
  function updateBridges() {
    const positions: number[] = [];
    const distanceThreshold = 5;

    const hitStars: { id: string; pos: THREE.Vector3 }[] = [];
    hitCounts.forEach((_, chunkId) => {
      const info = starDataMap.get(chunkId);
      if (info) hitStars.push({ id: chunkId, pos: info.sprite.position });
    });

    for (let i = 0; i < hitStars.length; i++) {
      for (let j = i + 1; j < hitStars.length; j++) {
        const d = hitStars[i].pos.distanceTo(hitStars[j].pos);
        if (d < distanceThreshold) {
          positions.push(
            hitStars[i].pos.x, hitStars[i].pos.y, hitStars[i].pos.z,
            hitStars[j].pos.x, hitStars[j].pos.y, hitStars[j].pos.z
          );
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    if (positions.length > 0) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    }
    bridgeLines.geometry.dispose();
    bridgeLines.geometry = geometry;
  }

  function applyAllEffects() {
    brightenStars();
    updateBridges();
    // 不再重复生粒子——每步已经生过了
  }

  function processStep(chunkIds: string[], grades: number[] = []) {
    totalSteps++;
    recordHits(chunkIds);
    chunkIds.forEach((id, index) => {
      const grade = grades[index];
      if (typeof grade === 'number') {
        maxGrades.set(id, Math.max(maxGrades.get(id) ?? 0, grade));
      }
    });
    brightenStars();
    spawnSpiralParticles(chunkIds);
    updateBridges();
  }

  function reset() {
    spiralParticles.forEach(p => {
      particleGroup.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    });
    spiralParticles.length = 0;

    bridgeLines.geometry.dispose();
    bridgeLines.geometry = new THREE.BufferGeometry();

    hitCounts.forEach((_, chunkId) => {
      const info = starDataMap.get(chunkId);
      if (info) {
        info.sprite.material.color.copy(info.originalMaterial.color);
        info.sprite.material.opacity = info.originalMaterial.opacity;
        info.sprite.scale.copy(info.originalScale);
        info.sprite.material.needsUpdate = true;
      }
    });

    hitCounts.clear();
    maxGrades.clear();
    coHitCounts.clear();
    totalSteps = 0;
  }

  function getStats() {
    let maxHits = 0, maxHitId = '', totalHits = 0;
    hitCounts.forEach((count, id) => {
      totalHits += count;
      if (count > maxHits) { maxHits = count; maxHitId = id; }
    });
    return {
      totalHits, maxHits, maxHitId,
      uniqueStars: hitCounts.size,
      spiralParticleGroups: spiralParticles.length,
      totalSteps,
    };
  }

  return { processStep, applyAllEffects, reset, getStats, hitCounts, coHitCounts };
}
