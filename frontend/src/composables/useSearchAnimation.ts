/**
 * 搜索动画 Composable
 *
 * 负责 RAG 检索过程的 3D 可视化：
 * 1. BM25 召回高亮
 * 2. kNN 召回高亮
 * 3. RRF 融合动画
 * 4. Reranker 最终结果
 */

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { StarPoint } from '../api';

interface SearchAnimationContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls: any;
  starSprites: THREE.Sprite[];
  starDataMap: Map<string, { sprite: THREE.Sprite; data: StarPoint }>;
}

export function useSearchAnimation(context: SearchAnimationContext) {
  const { scene, camera, controls, starSprites, starDataMap } = context;

  // 动画对象存储
  let queryOrb: THREE.Mesh | null = null;
  let lines: THREE.Line[] = [];
  let highlightedSprites = new Map<THREE.Sprite, {
    originalScale: THREE.Vector3;
    originalMaterial: THREE.SpriteMaterial;
  }>();

  /**
   * 创建查询球体
   */
  function createQueryOrb(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(2, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      wireframe: true
    });
    const orb = new THREE.Mesh(geometry, material);
    orb.position.copy(camera.position);
    scene.add(orb);

    // 脉冲动画
    gsap.to(orb.scale, {
      x: 1.5,
      y: 1.5,
      z: 1.5,
      duration: 0.5,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut'
    });

    return orb;
  }

  /**
   * 高亮星点
   */
  function highlightStars(chunkIds: string[], color: number, scale: number = 2) {
    const highlighted: THREE.Sprite[] = [];

    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;

      // 保存原始状态
      if (!highlightedSprites.has(sprite)) {
        highlightedSprites.set(sprite, {
          originalScale: sprite.scale.clone(),
          originalMaterial: sprite.material.clone()
        });
      }

      // 创建新材质（高亮）
      const newMaterial = sprite.material.clone();
      newMaterial.color.setHex(color);
      newMaterial.opacity = Math.min(newMaterial.opacity * 1.5, 1);
      sprite.material = newMaterial;

      // 放大
      gsap.to(sprite.scale, {
        x: sprite.scale.x * scale,
        y: sprite.scale.y * scale,
        z: sprite.scale.z * scale,
        duration: 0.3,
        ease: 'back.out'
      });

      highlighted.push(sprite);
    });

    return highlighted;
  }

  /**
   * 绘制连线
   */
  function drawLines(from: THREE.Vector3, targets: THREE.Vector3[], color: number, opacity: number = 0.6) {
    targets.forEach(target => {
      const points = [from.clone(), target.clone()];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0
      });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      lines.push(line);

      // 渐显动画
      gsap.to(material, {
        opacity,
        duration: 0.3,
        ease: 'sine.out'
      });
    });
  }

  /**
   * 清理动画对象
   */
  function cleanup() {
    // 移除查询球体
    if (queryOrb) {
      gsap.killTweensOf(queryOrb.scale);
      scene.remove(queryOrb);
      queryOrb = null;
    }

    // 移除连线
    lines.forEach(line => {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    lines = [];

    // 恢复星点状态
    highlightedSprites.forEach((original, sprite) => {
      sprite.material = original.originalMaterial;
      gsap.to(sprite.scale, {
        x: original.originalScale.x,
        y: original.originalScale.y,
        z: original.originalScale.z,
        duration: 0.3
      });
    });
    highlightedSprites.clear();
  }

  /**
   * 相机飞向目标
   */
  function flyToStar(targetPos: THREE.Vector3, duration: number = 1.5) {
    const offset = new THREE.Vector3(0, 0, 10);
    const newPos = targetPos.clone().add(offset);

    return new Promise<void>(resolve => {
      gsap.to(camera.position, {
        x: newPos.x,
        y: newPos.y,
        z: newPos.z,
        duration,
        ease: 'power2.inOut',
        onUpdate: () => {
          controls.target.copy(targetPos);
          controls.update();
        },
        onComplete: () => resolve()
      });
    });
  }

  /**
   * 执行完整搜索动画
   */
  async function animateSearch(results: {
    bm25: Array<{ chunk_id: string }>;
    knn: Array<{ chunk_id: string }>;
    rrf_top5: Array<{ chunk_id: string }>;
    reranker_final: { chunk_id: string } | null;
  }) {
    // 清理之前的动画
    cleanup();

    // Step 1: 创建查询球体
    queryOrb = createQueryOrb();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 2: BM25 召回（黄色）
    const bm25Ids = results.bm25.map(r => r.chunk_id);
    const bm25Sprites = highlightStars(bm25Ids.slice(0, 10), 0xffff00, 1.8);

    const bm25Positions = bm25Sprites.map(s => s.position);
    drawLines(queryOrb.position, bm25Positions, 0xffff00, 0.4);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: kNN 召回（蓝色）
    const knnIds = results.knn.map(r => r.chunk_id);
    const knnSprites = highlightStars(knnIds.slice(0, 10), 0x4A9AF5, 1.8);

    const knnPositions = knnSprites.map(s => s.position);
    drawLines(queryOrb.position, knnPositions, 0x4A9AF5, 0.6);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 4: RRF Top 5（紫色，更大）
    const rrfIds = results.rrf_top5.map(r => r.chunk_id);
    highlightStars(rrfIds, 0xa78bfa, 2.5);

    await new Promise(resolve => setTimeout(resolve, 800));

    // Step 5: Reranker 最终结果（绿色，最大）
    if (results.reranker_final) {
      const finalId = results.reranker_final.chunk_id;
      highlightStars([finalId], 0x2ECC71, 3.5);

      // 脉冲动画
      const finalStar = starDataMap.get(finalId);
      if (finalStar) {
        gsap.to(finalStar.sprite.material, {
          opacity: 1,
          duration: 0.3,
          yoyo: true,
          repeat: 3,
          ease: 'sine.inOut'
        });

        await new Promise(resolve => setTimeout(resolve, 600));

        // 飞向最终结果
        await flyToStar(finalStar.sprite.position, 1.5);
      }
    }
  }

  return {
    animateSearch,
    cleanup
  };
}
