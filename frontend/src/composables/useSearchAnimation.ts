/**
 * Search Animation Composable
 *
 * Each step is a continuous motion:
 *   ray shoots out → star lights up and grows → next step
 * No stepping/PPT effect. Everything flows.
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

const FALLBACK_ORIGIN = new THREE.Vector3(0, 100, 300);

export function useSearchAnimation(context: SearchAnimationContext) {
  const { scene, camera, controls, starSprites, starDataMap } = context;

  let lines: THREE.Line[] = [];
  let lineMaterials: THREE.Material[] = [];
  let glowSprites: THREE.Sprite[] = [];
  let highlightedSprites = new Map<THREE.Sprite, {
    originalScale: THREE.Vector3;
    originalMaterial: THREE.SpriteMaterial;
  }>();

  function isVectorValid(v: THREE.Vector3): boolean {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  }

  function getSafePosition(): THREE.Vector3 {
    if (isVectorValid(camera.position)) {
      return camera.position.clone();
    }
    return FALLBACK_ORIGIN.clone();
  }

  function createGlow(position: THREE.Vector3, color: number, size: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const hexColor = new THREE.Color(color);
    gradient.addColorStop(0, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.8)`);
    gradient.addColorStop(0.4, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.3)`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glow = new THREE.Sprite(material);
    glow.position.copy(position);
    glow.scale.set(size, size, 1);
    scene.add(glow);
    glowSprites.push(glow);
    return glow;
  }

  /**
   * One continuous animation for one set of results:
   * Ray shoots + star grows happen SIMULTANEOUSLY from start
   * Ray has meteor trail effect with gradient
   */
  function showResults(positions: THREE.Vector3[], color: number, scale: number): Promise<void> {
    if (!positions.length) return Promise.resolve();

    const from = getSafePosition();
    const animationPromises: Promise<void>[] = [];

    positions.forEach(target => {
      if (!isVectorValid(target)) return;

      // === 流星尾迹效果的射线 ===
      const geometry = new THREE.BufferGeometry();
      const posArr = new Float32Array([
        from.x, from.y, from.z,
        target.x, target.y, target.z
      ]);
      geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

      // 使用渐变材质模拟流星尾迹
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        linewidth: 2,
        blending: THREE.AdditiveBlending
      });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      lines.push(line);
      lineMaterials.push(material);

      // 流星效果：快速射出，然后淡出
      const promise = new Promise<void>((resolve) => {
        gsap.timeline()
          .to(material, {
            opacity: 0.9,
            duration: 0.15,
            ease: 'power2.out'
          })
          .to(material, {
            opacity: 0.3,
            duration: 0.6,
            ease: 'power1.in'
          })
          .eventCallback('onComplete', resolve);
      });

      animationPromises.push(promise);
    });

    // 等待所有射线动画完成
    return Promise.all(animationPromises).then(() => {});
  }

  /**
   * Highlight stars: INSTANT color change + SMOOTH continuous grow
   * Starts immediately, no delay
   */
  function highlightAndGrow(chunkIds: string[], color: number, scale: number = 2): THREE.Sprite[] {
    const sprites: THREE.Sprite[] = [];

    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;
      if (!sprite || !isVectorValid(sprite.position)) return;

      if (!highlightedSprites.has(sprite)) {
        highlightedSprites.set(sprite, {
          originalScale: sprite.scale.clone(),
          originalMaterial: sprite.material.clone()
        });
      }

      // 立即改变颜色（无延迟）
      const newMaterial = sprite.material.clone();
      newMaterial.color.setHex(color);
      newMaterial.opacity = 1;
      newMaterial.blending = THREE.AdditiveBlending;
      sprite.material = newMaterial;

      // 平滑连续放大（无延迟，使用更长时间确保连续）
      gsap.to(sprite.scale, {
        x: sprite.scale.x * scale,
        y: sprite.scale.y * scale,
        z: sprite.scale.z * scale,
        duration: 1.0, // 更长时间，更平滑
        ease: 'power1.out' // 更平滑的缓动
      });

      // 辉光在放大到一半时出现
      setTimeout(() => {
        createGlow(sprite.position, color, sprite.scale.x * scale * 3);
      }, 500);

      sprites.push(sprite);
    });

    return sprites;
  }

  function cleanup() {
    lines.forEach(line => {
      scene.remove(line);
      line.geometry.dispose();
    });
    lines = [];

    lineMaterials.forEach(mat => {
      gsap.killTweensOf(mat);
      (mat as THREE.Material).dispose();
    });
    lineMaterials = [];

    glowSprites.forEach(glow => {
      scene.remove(glow);
      (glow.material as THREE.Material).dispose();
      if (glow.material instanceof THREE.SpriteMaterial && glow.material.map) {
        glow.material.map.dispose();
      }
    });
    glowSprites = [];

    highlightedSprites.forEach((original, sprite) => {
      sprite.material = original.originalMaterial;
      gsap.killTweensOf(sprite.scale);
      gsap.to(sprite.scale, {
        x: original.originalScale.x,
        y: original.originalScale.y,
        z: original.originalScale.z,
        duration: 0.3
      });
    });
    highlightedSprites.clear();
  }

  function flyToStar(targetPos: THREE.Vector3, duration: number = 2.0) {
    const startPos = getSafePosition();

    if (!isVectorValid(targetPos)) {
      console.warn('[search] flyToStar: invalid targetPos', targetPos);
      return Promise.resolve();
    }

    const dir = new THREE.Vector3().subVectors(targetPos, startPos).normalize();
    const finalCamPos = targetPos.clone().add(dir.clone().multiplyScalar(-30));

    const midPoint = new THREE.Vector3().lerpVectors(startPos, finalCamPos, 0.5);
    midPoint.y += Math.min(15, Math.abs(finalCamPos.y - startPos.y) * 0.2);

    const curve = new THREE.QuadraticBezierCurve3(startPos, midPoint, finalCamPos);

    return new Promise<void>(resolve => {
      const startTime = Date.now();
      const durationMs = duration * 1000;

      const update = () => {
        const t = Math.min((Date.now() - startTime) / durationMs, 1);
        const point = curve.getPoint(t);
        camera.position.copy(point);
        camera.lookAt(targetPos);

        if (t >= 1) {
          resolve();
          return;
        }

        requestAnimationFrame(update);
      };

      update();
    });
  }

  async function animateSearch(results: {
    bm25: Array<{ chunk_id: string }>;
    knn: Array<{ chunk_id: string }>;
    rrf_top5: Array<{ chunk_id: string }>;
    reranker_final: { chunk_id: string } | null;
  }) {
    console.log('[search] animateSearch start', {
      bm25: results.bm25.length,
      knn: results.knn.length,
      rrf: results.rrf_top5.length,
      reranker: results.reranker_final?.chunk_id || null
    });

    cleanup();

    await new Promise(resolve => setTimeout(resolve, 200));

    // === BM25: ray + grow (continuous) ===
    const bm25Ids = results.bm25.map(r => r.chunk_id);
    const bm25Sprites = highlightAndGrow(bm25Ids.slice(0, 10), 0xFFD700, 2.2);
    const bm25Positions = bm25Sprites.map(s => s.position);
    await showResults(bm25Positions, 0xFFD700, 2.2);

    // === kNN: ray + grow (continuous) ===
    const knnIds = results.knn.map(r => r.chunk_id);
    const knnSprites = highlightAndGrow(knnIds.slice(0, 10), 0x60A5FA, 2.2);
    const knnPositions = knnSprites.map(s => s.position);
    await showResults(knnPositions, 0x60A5FA, 2.2);

    // === RRF: ray + grow (continuous) ===
    const rrfIds = results.rrf_top5.map(r => r.chunk_id);
    const rrfSprites = highlightAndGrow(rrfIds, 0xA78BFA, 2.8);
    const rrfPositions = rrfSprites.map(s => s.position);
    await showResults(rrfPositions, 0xA78BFA, 2.8);

    // === Final: ray + grow + fly seamless ===
    if (results.reranker_final) {
      const finalId = results.reranker_final.chunk_id;
      const finalStar = starDataMap.get(finalId);

      if (!finalStar) {
        console.warn('[search] reranker result not in starDataMap!');
        return;
      }

      // Dim other stars
      highlightedSprites.forEach((original, sprite) => {
        if (sprite !== finalStar.sprite) {
          gsap.to(sprite.material, { opacity: 0.15, duration: 0.4 });
          gsap.to(sprite.scale, {
            x: original.originalScale.x * 1.2,
            y: original.originalScale.y * 1.2,
            z: original.originalScale.z * 1.2,
            duration: 0.4
          });
        }
      });

      gsap.killTweensOf(finalStar.sprite.scale);
      gsap.killTweensOf(finalStar.sprite.material);

      createGlow(finalStar.sprite.position, 0x34D399, 30);

      // Everything starts together
      const flightDuration = 1.8;

      // Ray
      const from = getSafePosition();
      const targetPos = finalStar.sprite.position;
      if (isVectorValid(targetPos)) {
        const geo = new THREE.BufferGeometry();
        const posArr = new Float32Array([
          from.x, from.y, from.z,
          targetPos.x, targetPos.y, targetPos.z
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        const mat = new THREE.LineBasicMaterial({
          color: 0x34D399,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending
        });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        lines.push(line);
        lineMaterials.push(mat);

        gsap.to(mat, { opacity: 0.9, duration: 0.3, ease: 'power2.out' });
      }

      // Star grows
      gsap.to(finalStar.sprite.scale, {
        x: finalStar.sprite.scale.x * 5,
        y: finalStar.sprite.scale.y * 5,
        z: finalStar.sprite.scale.z * 5,
        duration: flightDuration,
        ease: 'power3.out'
      });

      // Pulsing glow
      gsap.to(finalStar.sprite.material, {
        opacity: 0.7,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: Math.floor(flightDuration / 0.8)
      });

      await flyToStar(targetPos, flightDuration);
    }
  }

  return { animateSearch, cleanup };
}
