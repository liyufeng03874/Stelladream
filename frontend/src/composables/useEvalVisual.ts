/**
 * EvalVisual Composable v9 — 涌现式银河
 *
 * 三层叠加：
 * 1. 恒星层：多层光晕 Sprite（亮核+柔光环），渐进变亮不变大
 * 2. 星云层：空间密度网格 → 半透明基底 blob，密集处自动泛光
 * 3. 粒子层：从命中星释放，螺旋漂移，多色交织（青/蓝/白）
 * 4. 连接层：近距离命中星之间的微弱发光线，织成网状
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

// ===== 空间密度网格 =====
const GRID_SIZE = 20;
const densityGrid = new Map<string, number>();

function gridKey(x: number, y: number, z: number): string {
  const gx = Math.floor(x / GRID_SIZE);
  const gy = Math.floor(y / GRID_SIZE);
  const gz = Math.floor(z / GRID_SIZE);
  return `${gx},${gy},${gz}`;
}

export function useEvalVisual(context: EvalVisualContext) {
  const { scene, starDataMap } = context;

  // ===== 数据层 =====
  const hitCounts = new Map<string, number>();
  const coHitCounts = new Map<string, number>();
  let totalSteps = 0;

  // ===== 1. 恒星层 =====
  const starHalos = new Map<string, { core: THREE.Sprite; halo: THREE.Sprite }>();

  // ===== 2. 星云层 =====
  const nebulaSprites = new Map<string, THREE.Sprite>();
  const nebulaGroup = new THREE.Group();
  nebulaGroup.name = 'eval-nebula';
  scene.add(nebulaGroup);

  // ===== 3. 粒子层 =====
  const spiralParticles: THREE.Points[] = [];
  const particleGroup = new THREE.Group();
  particleGroup.name = 'eval-particles';
  scene.add(particleGroup);

  // ===== 4. 连接层 =====
  const bridgeLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x66aacc,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  scene.add(bridgeLines);

  // ===== 纹理 =====
  let coreTexture: THREE.CanvasTexture | null = null;
  let haloTexture: THREE.CanvasTexture | null = null;
  let nebulaTexture: THREE.CanvasTexture | null = null;
  let particleTexture: THREE.CanvasTexture | null = null;

  function getCoreTexture(): THREE.CanvasTexture {
    if (!coreTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.1, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      coreTexture = new THREE.CanvasTexture(canvas);
      coreTexture.needsUpdate = true;
    }
    return coreTexture;
  }

  function getHaloTexture(): THREE.CanvasTexture {
    if (!haloTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.2, 'rgba(255,255,255,0.15)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      haloTexture = new THREE.CanvasTexture(canvas);
      haloTexture.needsUpdate = true;
    }
    return haloTexture;
  }

  function getNebulaTexture(): THREE.CanvasTexture {
    if (!nebulaTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,255,255,0.15)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.01)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      nebulaTexture = new THREE.CanvasTexture(canvas);
      nebulaTexture.needsUpdate = true;
    }
    return nebulaTexture;
  }

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

  /** 记录命中 + 密度网格 */
  function recordHits(chunkIds: string[]) {
    for (const id of chunkIds) {
      hitCounts.set(id, (hitCounts.get(id) || 0) + 1);
      const info = starDataMap.get(id);
      if (info) {
        const key = gridKey(info.sprite.position.x, info.sprite.position.y, info.sprite.position.z);
        densityGrid.set(key, (densityGrid.get(key) || 0) + 1);
      }
    }
    for (let i = 0; i < chunkIds.length; i++) {
      for (let j = i + 1; j < chunkIds.length; j++) {
        const [a, b] = chunkIds[i] < chunkIds[j] ? [chunkIds[i], chunkIds[j]] : [chunkIds[j], chunkIds[i]];
        const key = `${a}:${b}`;
        coHitCounts.set(key, (coHitCounts.get(key) || 0) + 1);
      }
    }
  }

  /** 颜色随阶段变化：蓝 → 青 → 白蓝 */
  function getPhaseColor(phase: number): THREE.Color {
    if (phase < 0.33) return new THREE.Color(0x4488cc);
    if (phase < 0.66) return new THREE.Color(0x66bbcc);
    return new THREE.Color(0xaabbdd);
  }

  /** 1. 恒星层：亮核 + 柔光环，渐进变亮 */
  function updateStarHalos() {
    hitCounts.forEach((count, chunkId) => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;
      const phase = Math.min(totalSteps / 500, 1);
      const haloScale = 3 + count * 2;

      if (!starHalos.has(chunkId)) {
        const core = new THREE.Sprite(new THREE.SpriteMaterial({
          map: getCoreTexture(),
          color: new THREE.Color(0xffffff),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.8,
        }));
        core.position.copy(sprite.position);
        core.scale.copy(sprite.scale).multiplyScalar(2);
        scene.add(core);

        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: getHaloTexture(),
          color: getPhaseColor(phase),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.3,
        }));
        halo.position.copy(sprite.position);
        halo.scale.copy(sprite.scale).multiplyScalar(haloScale);
        scene.add(halo);

        starHalos.set(chunkId, { core, halo });
      } else {
        const { core, halo } = starHalos.get(chunkId)!;
        core.material.opacity = Math.min(1, 0.5 + count * 0.15);
        halo.material.opacity = Math.min(0.6, 0.15 + count * 0.1);
        halo.material.color.copy(getPhaseColor(phase));
        halo.scale.copy(sprite.scale).multiplyScalar(haloScale);
      }

      const origColor = starInfo.originalMaterial.color;
      const warmth = Math.min(count / 5, 1) * phase;
      const newColor = origColor.clone().lerp(new THREE.Color(0xffffff), warmth);
      sprite.material.color.copy(newColor);
      sprite.material.opacity = Math.min(1, 0.5 + phase * 0.5);
      sprite.material.needsUpdate = true;
    });
  }

  /** 2. 星云层：密度网格 → 基底泛光 */
  function updateNebula() {
    const threshold = 3;
    const highDensityCells: { key: string; count: number; center: THREE.Vector3 }[] = [];

    densityGrid.forEach((count, key) => {
      if (count >= threshold) {
        const [gx, gy, gz] = key.split(',').map(Number);
        const center = new THREE.Vector3(
          (gx + 0.5) * GRID_SIZE,
          (gy + 0.5) * GRID_SIZE,
          (gz + 0.5) * GRID_SIZE
        );
        highDensityCells.push({ key, count, center });
      }
    });

    highDensityCells.forEach(({ key, count, center }) => {
      const phase = Math.min(totalSteps / 500, 1);
      const size = GRID_SIZE * 3 * (1 + count * 0.3);
      const opacity = Math.min(0.15, 0.03 + count * 0.015) * phase;

      if (!nebulaSprites.has(key)) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: getNebulaTexture(),
          color: getPhaseColor(phase),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity,
        }));
        sprite.position.copy(center);
        sprite.scale.set(size, size, 1);
        nebulaGroup.add(sprite);
        nebulaSprites.set(key, sprite);
      } else {
        const sprite = nebulaSprites.get(key)!;
        sprite.material.opacity = opacity;
        sprite.material.color.copy(getPhaseColor(phase));
        sprite.scale.set(size, size, 1);
      }
    });
  }

  /** 3. 粒子层：多色螺旋 */
  function spawnSpiralParticles(chunkIds: string[]) {
    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const pos = starInfo.sprite.position;
      const count = hitCounts.get(chunkId) || 0;
      const particleCount = 3 + count;

      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);

      const colorPool = [
        new THREE.Color(0x66bbcc),
        new THREE.Color(0x4488cc),
        new THREE.Color(0xaabbdd),
      ];

      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 2 + Math.random() * 8;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.4;
        const z = (Math.random() - 0.5) * 4;

        positions[i * 3] = pos.x + x;
        positions[i * 3 + 1] = pos.y + y;
        positions[i * 3 + 2] = pos.z + z;

        const c = colorPool[Math.floor(Math.random() * colorPool.length)];
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
        map: getParticleTexture(),
        size: 2.0,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: true,
      });

      const points = new THREE.Points(geometry, material);
      particleGroup.add(points);
      spiralParticles.push(points);
    });
  }

  /** 4. 连接层：星际桥梁 */
  function updateBridges() {
    const positions: number[] = [];
    const distanceThreshold = 25;

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

  /** 批量应用 */
  function applyAllEffects() {
    totalSteps = 500;
    hitCounts.forEach((_, chunkId) => {
      const info = starDataMap.get(chunkId);
      if (info) {
        const key = gridKey(info.sprite.position.x, info.sprite.position.y, info.sprite.position.z);
        densityGrid.set(key, (densityGrid.get(key) || 0) + (hitCounts.get(chunkId) || 0));
      }
    });
    updateStarHalos();
    updateNebula();
    updateBridges();
    hitCounts.forEach((_, chunkId) => {
      spawnSpiralParticles([chunkId]);
    });
  }

  /** 处理一步 */
  function processStep(chunkIds: string[]) {
    totalSteps++;
    recordHits(chunkIds);
    updateStarHalos();
    updateNebula();
    spawnSpiralParticles(chunkIds);
    updateBridges();
  }

  /** 重置 */
  function reset() {
    starHalos.forEach(({ core, halo }) => {
      scene.remove(core);
      scene.remove(halo);
      core.material.dispose();
      halo.material.dispose();
    });
    starHalos.clear();

    nebulaSprites.forEach(sprite => {
      nebulaGroup.remove(sprite);
      sprite.material.dispose();
    });
    nebulaSprites.clear();

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
        info.sprite.material.needsUpdate = true;
      }
    });

    densityGrid.clear();
    hitCounts.clear();
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
      nebulaCells: nebulaSprites.size,
      starHalos: starHalos.size,
      spiralParticleGroups: spiralParticles.length,
      totalSteps,
    };
  }

  return { processStep, applyAllEffects, reset, getStats, hitCounts, coHitCounts };
}
