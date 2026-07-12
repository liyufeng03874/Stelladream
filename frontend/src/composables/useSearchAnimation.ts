/**
 * Search Animation Composable
 *
 * Meteor-style rays: bright head with trailing tail, like shooting stars
 * flying from your viewpoint to target stars.
 * ALL groups fire simultaneously with small stagger for visual ripple.
 */

import * as THREE from 'three';
import { gsap } from 'gsap';
import type { StarPoint } from '../api';

interface SearchAnimationContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls: any;
  starSprites: THREE.Sprite[];
  starDataMap: Map<string, {
    sprite: THREE.Sprite;
    data: StarPoint;
    originalMaterial: THREE.SpriteMaterial;
    originalScale: THREE.Vector3;
  }>;
}

const FALLBACK_ORIGIN = new THREE.Vector3(0, 100, 300);

export interface FinalStarAppliedStyle {
  coreColor: string;
  opacity: number;
  blending: number; // THREE blending constant
  scaleMultiplier: number;
  glowColor: number | null;
  glowSize: number | null;
  breathingActive: boolean;
}

export interface FinalStarInfo {
  sprite: THREE.Sprite;
  data: StarPoint;
  trueOriginalScale: THREE.Vector3;     // 在 highlightAndGrow 之前的真实原始 scale
  trueOriginalMaterial: THREE.SpriteMaterial; // 在 highlightAndGrow 之前的真实原始 material
  domainColor: string;
  appliedStyle: FinalStarAppliedStyle;
}

export function useSearchAnimation(context: SearchAnimationContext) {
  const { scene, camera, controls, starSprites, starDataMap } = context;

  let glowSprites: THREE.Sprite[] = [];
  let highlightedSprites = new Map<THREE.Sprite, {
    originalScale: THREE.Vector3;
    originalMaterial: THREE.SpriteMaterial;
  }>();
  let finalStarInfo: FinalStarInfo | null = null;
  let finalStarGlowSprites: THREE.Sprite[] = [];
  let trueOriginals = new Map<THREE.Sprite, {
    scale: THREE.Vector3;
    material: THREE.SpriteMaterial;
  }>();

  function isVectorValid(v: THREE.Vector3): boolean {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  }

  function getMeteorOrigin(): THREE.Vector3 {
    if (isVectorValid(controls.target)) {
      const center = controls.target.clone();
      if (isVectorValid(camera.position)) {
        const dir = new THREE.Vector3().subVectors(camera.position, center).normalize();
        return center.add(dir.multiplyScalar(20));
      }
      return center.add(new THREE.Vector3(0, 5, 20));
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

  function createMeteor(from: THREE.Vector3, to: THREE.Vector3, color: number, delayMs: number = 0): Promise<void> {
    if (!isVectorValid(from) || !isVectorValid(to)) {
      return Promise.resolve();
    }

    const hexColor = new THREE.Color(color);

    const curvePoints: THREE.Vector3[] = [];
    const segments = 40;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 3;
      curvePoints.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(curvePoints);

    const headCanvas = document.createElement('canvas');
    headCanvas.width = 16;
    headCanvas.height = 16;
    const headCtx = headCanvas.getContext('2d')!;
    const headGrad = headCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
    headGrad.addColorStop(0, 'rgba(255,255,255,1)');
    headGrad.addColorStop(0.4, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.6)`);
    headGrad.addColorStop(1, 'rgba(0,0,0,0)');
    headCtx.fillStyle = headGrad;
    headCtx.fillRect(0, 0, 16, 16);
    const headTexture = new THREE.CanvasTexture(headCanvas);
    const headMat = new THREE.SpriteMaterial({
      map: headTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0
    });
    const head = new THREE.Sprite(headMat);
    head.scale.set(0.6, 0.6, 1);
    head.position.copy(from);
    scene.add(head);

    const trailMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending
    });
    const trailGeo = new THREE.BufferGeometry();
    const trail = new THREE.Line(trailGeo, trailMat);
    scene.add(trail);

    const flightDuration = 0.8;

    return new Promise<void>(resolve => {
      setTimeout(() => {
        const startTimeMs = Date.now();

        const update = () => {
          const t = Math.min((Date.now() - startTimeMs) / (flightDuration * 1000), 1);

          const headPos = curve.getPoint(t);
          if (isVectorValid(headPos)) {
            head.position.copy(headPos);
            head.material.opacity = 1;
          }

          const trailSegments = Math.floor(t * segments);
          if (trailSegments > 0) {
            const positions: number[] = [];
            for (let i = 0; i <= trailSegments; i++) {
              const pt = curvePoints[i];
              positions.push(pt.x, pt.y, pt.z);
            }
            trail.geometry.dispose();
            trail.geometry = new THREE.BufferGeometry();
            trail.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          }
          trail.material.opacity = 0.6;

          if (t >= 1) {
            gsap.to(head.material, { opacity: 0, duration: 0.2 });
            gsap.to(trail.material, { opacity: 0, duration: 0.4 });
            setTimeout(() => {
              scene.remove(head);
              scene.remove(trail);
              head.geometry?.dispose();
              trail.geometry.dispose();
              head.material.dispose();
              trail.material.dispose();
              resolve();
            }, 400);
            return;
          }

          requestAnimationFrame(update);
        };

        update();
      }, delayMs);
    });
  }

  function highlightAndGrow(chunkIds: string[], color: number, scale: number = 2): THREE.Sprite[] {
    const sprites: THREE.Sprite[] = [];

    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;
      if (!sprite || !isVectorValid(sprite.position)) return;

      if (!trueOriginals.has(sprite)) {
        trueOriginals.set(sprite, {
          scale: starInfo.originalScale.clone(),
          material: starInfo.originalMaterial,
        });
      }

      if (!highlightedSprites.has(sprite)) {
        highlightedSprites.set(sprite, {
          originalScale: sprite.scale.clone(),
          originalMaterial: sprite.material.clone()
        });
      }

      const newMaterial = sprite.material.clone();
      newMaterial.color.setHex(color);
      newMaterial.opacity = 1;
      newMaterial.blending = THREE.AdditiveBlending;
      sprite.material = newMaterial;

      gsap.to(sprite.scale, {
        x: sprite.scale.x * scale,
        y: sprite.scale.y * scale,
        z: sprite.scale.z * scale,
        duration: 0.8,
        ease: 'power2.out',
        delay: 0.3
      });

      setTimeout(() => {
        const glow = createGlow(sprite.position, color, sprite.scale.x * scale * 3);
        glowSprites.push(glow); // 关键修复：添加到数组以便后续清理
      }, 400);

      sprites.push(sprite);
    });

    return sprites;
  }

  function clearAllGlows() {
    const allGlows = [...glowSprites, ...finalStarGlowSprites];


    allGlows.forEach(glow => {
      scene.remove(glow);
      (glow.material as THREE.Material).dispose();
      if (glow.material instanceof THREE.SpriteMaterial && glow.material.map) {
        glow.material.map.dispose();
      }
    });
    glowSprites = [];
    finalStarGlowSprites = [];

    // 额外的场景级清扫：移除所有可能遗漏的大光晕
    const toRemove: THREE.Object3D[] = [];
    scene.children.forEach(child => {
      if (child instanceof THREE.Sprite) {
        const maxDim = Math.max(child.scale.x, child.scale.y);
        // 大于20的sprite很可能是光晕（正常星点最大约1.5）
        if (maxDim > 20) {
          toRemove.push(child);
        }
      }
    });

    if (toRemove.length > 0) {

      toRemove.forEach(obj => {
        scene.remove(obj);
        if (obj instanceof THREE.Sprite) {
          (obj.material as THREE.Material).dispose();
          if (obj.material instanceof THREE.SpriteMaterial && obj.material.map) {
            obj.material.map.dispose();
          }
        }
      });
    }
  }

  function cleanup() {
    glowSprites.forEach(glow => {
      scene.remove(glow);
      (glow.material as THREE.Material).dispose();
      if (glow.material instanceof THREE.SpriteMaterial && glow.material.map) {
        glow.material.map.dispose();
      }
    });
    glowSprites = [];

    highlightedSprites.forEach((original, sprite) => {
      const trueOrig = trueOriginals.get(sprite);
      if (trueOrig) {
        sprite.material = trueOrig.material;
        sprite.scale.copy(trueOrig.scale);
      } else {
        sprite.material = original.originalMaterial;
        gsap.to(sprite.scale, {
          x: original.originalScale.x,
          y: original.originalScale.y,
          z: original.originalScale.z,
          duration: 0.3
        });
      }
      gsap.killTweensOf(sprite.scale);
    });
    highlightedSprites.clear();
    trueOriginals.clear();
  }

  function flyToStar(targetPos: THREE.Vector3, duration: number = 2.0) {
    const startPos = camera.position.clone();

    if (!isVectorValid(targetPos)) {
      return Promise.resolve();
    }

    const dir = new THREE.Vector3().subVectors(targetPos, startPos).normalize();

    // 自适应距离：根据相机到目标的实际距离计算
    const directDist = startPos.distanceTo(targetPos);
    const flightDist = THREE.MathUtils.clamp(directDist * 0.8, 25, 60);
    const finalCamPos = targetPos.clone().add(dir.clone().multiplyScalar(-flightDist));

    // 中间点：稍微向上偏移
    const midPoint = new THREE.Vector3().lerpVectors(startPos, finalCamPos, 0.5);
    midPoint.y += Math.min(8, directDist * 0.05);

    const curve = new THREE.QuadraticBezierCurve3(startPos, midPoint, finalCamPos);

    // 关键：不禁用 controls，让 OrbitControls 全程处理相机朝向
    // 只动画 camera.position + controls.target，朝向由 controls.update() 自动计算
    const startTarget = controls.target.clone();

    return new Promise<void>(resolve => {
      const startTime = Date.now();
      const durationMs = duration * 1000;

      const update = () => {
        const t = Math.min((Date.now() - startTime) / durationMs, 1);
        const point = curve.getPoint(t);

        // 相机位置沿曲线移动
        camera.position.copy(point);

        // controls.target 从起点平滑过渡到目标星
        controls.target.lerpVectors(startTarget, targetPos, t);

        if (t >= 1) {
          resolve();
          return;
        }

        requestAnimationFrame(update);
      };

      update();
    });
  }

  function getEmissionPoint(): THREE.Vector3 {
    const sceneCenter = isVectorValid(controls.target)
      ? controls.target.clone()
      : new THREE.Vector3(67.1, 96.2, 30.9);

    const fromCamera = camera.position.clone();
    const fromSceneCenter = sceneCenter.clone();

    const x = (fromCamera.x + fromSceneCenter.x) / 2;
    const z = (fromCamera.z + fromSceneCenter.z) / 2;
    const y = sceneCenter.y + 10;

    return new THREE.Vector3(x, y, z);
  }

  function shootMeteors(positions: THREE.Vector3[], color: number, staggerMs: number = 0): Promise<void[]> {
    const origin = getEmissionPoint();
    const promises = positions.map((pos, i) => createMeteor(origin, pos, color, i * staggerMs));
    return Promise.all(promises);
  }

  async function animateSearch(results: {
    bm25: Array<{ chunk_id: string }>;
    knn: Array<{ chunk_id: string }>;
    rrf_top5: Array<{ chunk_id: string }>;
    reranker_final: { chunk_id: string } | null;
  }) {
    cleanup();

    await new Promise(resolve => setTimeout(resolve, 200));
    await new Promise(resolve => setTimeout(resolve, 400));

    const bm25Ids = results.bm25.map(r => r.chunk_id);
    const knnIds = results.knn.map(r => r.chunk_id);
    const rrfIds = results.rrf_top5.map(r => r.chunk_id);

    const bm25Sprites = highlightAndGrow(bm25Ids.slice(0, 10), 0xFFD700, 2.2);
    const knnSprites = highlightAndGrow(knnIds.slice(0, 10), 0x60A5FA, 2.2);
    const rrfSprites = highlightAndGrow(rrfIds, 0xA78BFA, 2.8);

    const bm25Positions = bm25Sprites.map(s => s.position);
    const knnPositions = knnSprites.map(s => s.position);
    const rrfPositions = rrfSprites.map(s => s.position);

    shootMeteors(bm25Positions, 0xFFD700, 50);
    shootMeteors(knnPositions, 0x60A5FA, 50);
    shootMeteors(rrfPositions, 0xA78BFA, 50);

    await Promise.all([
      Promise.all(bm25Positions.map((_, i) => new Promise<void>(r => setTimeout(r, 800 + i * 50)))),
      Promise.all(knnPositions.map((_, i) => new Promise<void>(r => setTimeout(r, 800 + i * 50)))),
      Promise.all(rrfPositions.map((_, i) => new Promise<void>(r => setTimeout(r, 800 + i * 50)))),
    ]);

    if (results.reranker_final) {
      const finalId = results.reranker_final.chunk_id;
      const finalStar = starDataMap.get(finalId);

      if (!finalStar) {
        return;
      }

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

      const original = highlightedSprites.get(finalStar.sprite);
      if (!original) {
        return;
      }

      const trueOrig = trueOriginals.get(finalStar.sprite);
      if (!trueOrig) {
        return;
      }
      const trueOriginalScale = trueOrig.scale.clone();
      const trueOriginalMaterial = trueOrig.material;

      const finalSprite = finalStar.sprite;

      // 关键修复：克隆当前材质，不要直接修改（避免污染原始材质）
      const oldMat = finalSprite.material as THREE.SpriteMaterial;
      const finalMat = oldMat.clone();

      // 在新克隆的材质上修改
      finalMat.color.setHex(0xFFFFFF);
      finalMat.opacity = 1;
      finalMat.blending = THREE.AdditiveBlending;
      finalMat.needsUpdate = true;

      // 应用新材质
      finalSprite.material = finalMat;

      gsap.killTweensOf(finalSprite.scale);
      gsap.killTweensOf(finalMat);

      const finalGlow = createGlow(finalSprite.position, 0x34D399, 30);
      finalStarGlowSprites.push(finalGlow);

      const flightDuration = 1.8;

      const targetPos = finalSprite.position;
      console.log('[search-final] trueOriginalScale:', trueOriginalScale.x.toFixed(3), trueOriginalScale.y.toFixed(3), trueOriginalScale.z.toFixed(3));
      console.log('[search-final] finalSprite BEFORE:', finalSprite.scale.x.toFixed(3), finalSprite.scale.y.toFixed(3), finalSprite.scale.z.toFixed(3));
      // 列出所有光晕
      console.log('[search-final] glows on finalStar:');
      for (let i = 0; i < finalStarGlowSprites.length; i++) {
        const g = finalStarGlowSprites[i];
        console.log(`  glow[${i}] scale=${g.scale.x.toFixed(1)}x${g.scale.y.toFixed(1)}, pos=(${g.position.x.toFixed(1)},${g.position.y.toFixed(1)},${g.position.z.toFixed(1)})`);
      }
      console.log('[search-final] finalSprite material:', {
        color: '#' + finalSprite.material.color.getHexString(),
        opacity: finalSprite.material.opacity,
        blending: finalSprite.material.blending
      });
      if (isVectorValid(targetPos)) {
        shootMeteors([targetPos], 0x34D399, 0);
      }

      gsap.to(finalSprite.scale, {
        x: trueOriginalScale.x * 5,
        y: trueOriginalScale.y * 5,
        z: trueOriginalScale.z * 5,
        duration: flightDuration,
        ease: 'power3.out',
        onComplete: () => {
          console.log('[search-final] finalSprite AFTER tween:', finalSprite.scale.x.toFixed(3), finalSprite.scale.y.toFixed(3), finalSprite.scale.z.toFixed(3));
        }
      });

      gsap.to(finalSprite.material, {
        opacity: 0.7,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1
      });

      const domainColor = '#' + trueOriginalMaterial.color.getHexString();
      finalStarInfo = {
        sprite: finalSprite,
        data: finalStar.data,
        trueOriginalScale,
        trueOriginalMaterial,
        domainColor,
        appliedStyle: {
          coreColor: '#ffffff',
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          scaleMultiplier: 5,
          glowColor: 0x34D399,
          glowSize: 30,
          breathingActive: true,
        },
      };

      await flyToStar(targetPos, flightDuration);
    }
  }

  /**
   * 星跃：旧最终星恢复原样，新星星继承最终星样式，相机飞过去
   */
  function jumpToStar(targetSprite: THREE.Sprite) {
    // 打印搜索动画中最终星的光晕信息
    function printFinalGlowInfo() {
      if (!finalStarInfo) return;
      const { sprite } = finalStarInfo;
      console.log('[query-visual] finalSprite scale:', sprite.scale.x.toFixed(3), sprite.scale.y.toFixed(3), sprite.scale.z.toFixed(3));
      console.log('[query-visual] finalSprite material:', {
        color: '#' + sprite.material.color.getHexString(),
        opacity: sprite.material.opacity,
        blending: sprite.material.blending
      });
      console.log('[query-visual] glows:', finalStarGlowSprites.length);
      finalStarGlowSprites.forEach((g, i) => {
        console.log(`  glow[${i}] scale=${g.scale.x.toFixed(1)}x${g.scale.y.toFixed(1)}, color=0x${g.material.color.getHexString().toUpperCase()}`);
      });
    }

    // 从 sprite.userData 获取原始数据（StarField 创建时已存）
    const targetOrig = targetSprite.userData.trueOriginals;

    if (!targetOrig) return;
    const targetOrigScale = targetOrig.scale.clone();
    const targetOrigMat = targetOrig.material;

    // 情况1：没有最终星（还没搜索过），使用默认样式
    if (!finalStarInfo || !finalStarInfo.sprite) {
      const targetPos = targetSprite.position;

      // 立即换材质（白核心）
      gsap.killTweensOf(targetSprite.scale);
      gsap.killTweensOf(targetSprite.material);

      const oldMat = targetSprite.material as THREE.SpriteMaterial;
      const newMat = oldMat.clone();
      newMat.color.setHex(0xFFFFFF);
      newMat.opacity = 1;
      newMat.blending = THREE.AdditiveBlending;
      newMat.needsUpdate = true;
      targetSprite.material = newMat;

      // 辉光：和 query 完全一致，多层辉光叠加
      // 第一层：白色核心辉光（紧贴核心，让核心区域饱满）
      const coreGlow = createGlow(targetPos, 0xFFFFFF, 5);
      if (coreGlow) finalStarGlowSprites.push(coreGlow);

      // 第二层：小辉光（模拟 highlightAndGrow 阶段）
      const innerGlow = createGlow(targetPos, 0x34D399, 3);
      if (innerGlow) finalStarGlowSprites.push(innerGlow);

      // 第三层：大辉光（和 query reranker 阶段一致）
      const glow = createGlow(targetPos, 0x34D399, 30);
      if (glow) finalStarGlowSprites.push(glow);

      console.log('[jumpToStar-情况1] glows created: 3 layers (white5, green3, green30)');

      // 放大动画 — 和 query 完全一致 0.6，让辉光完全包裹核心
      const uniformFinalScale = 0.6;
      console.log('[jumpToStar-情况1] targetOrigScale:', targetOrigScale.x.toFixed(3), targetOrigScale.y.toFixed(3), targetOrigScale.z.toFixed(3));
      console.log('[jumpToStar-情况1] target BEFORE:', targetSprite.scale.x.toFixed(3), targetSprite.scale.y.toFixed(3), targetSprite.scale.z.toFixed(3));
      // 等动画完成打印
      // 先等流星飞完再移动相机（和搜索动画一致）
      (isVectorValid(targetPos) ? shootMeteors([targetPos], 0x34D399, 0) : Promise.resolve()).then(() => {
        flyToStar(targetPos, 1.5);
      });

      // 打印辉光信息
      gsap.to(targetSprite.scale, {
        x: uniformFinalScale,
        y: uniformFinalScale,
        z: 5,
        duration: 1.8,
        ease: 'power3.out',
        onComplete: () => {
          console.log('[jumpToStar-情况1] target AFTER tween:', targetSprite.scale.x.toFixed(3), targetSprite.scale.y.toFixed(3), targetSprite.scale.z.toFixed(3));
          console.log('[jumpToStar-情况1] target material:', {
            color: '#' + targetSprite.material.color.getHexString(),
            opacity: targetSprite.material.opacity,
            blending: targetSprite.material.blending
          });
          console.log('[jumpToStar-情况1] glows:', finalStarGlowSprites.length);
          finalStarGlowSprites.forEach((g, i) => {
            console.log(`  glow[${i}] scale=${g.scale.x.toFixed(1)}x${g.scale.y.toFixed(1)}, color=0x${g.material.color.getHexString().toUpperCase()}`);
          });
        },
      });

      gsap.to(newMat, {
        opacity: 0.7,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });

      finalStarInfo = {
        sprite: targetSprite,
        data: null,
        trueOriginalScale: targetOrigScale,
        trueOriginalMaterial: targetOrigMat,
        domainColor: '#34D399',
        appliedStyle: {
          coreColor: '#ffffff',
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          scaleMultiplier: 5,
          glowColor: 0x34D399,
          glowSize: 30,
          breathingActive: true,
        },
      };

      // 先等流星飞完再移动相机（和搜索动画一致）
      const meteorPromise = isVectorValid(targetPos) ? shootMeteors([targetPos], 0x34D399, 0) : Promise.resolve();
      meteorPromise.then(() => {
        flyToStar(targetPos, 1.5);
      });
      return;
    }

    // 情况2：有最终星，转移样式
    console.log('[jumpToStar-情况2] 开始星跃，有旧最终星');
    // 1. 清除最终星的辉光
    clearAllGlows();

    // 2. 恢复最终星
    resetFinalStar();

    // 3. 目标星：和搜索动画完全一致的两步扩散
    const targetPos = targetSprite.position;

    console.log('[jumpToStar-情况2] targetOrigScale:', targetOrigScale.x.toFixed(3), targetOrigScale.y.toFixed(3), targetOrigScale.z.toFixed(3));
    console.log('[jumpToStar-情况2] target BEFORE:', targetSprite.scale.x.toFixed(3), targetSprite.scale.y.toFixed(3), targetSprite.scale.z.toFixed(3));

    // 第一步：白核心 + 2.2x 放大（和 highlightAndGrow 一致）
    gsap.killTweensOf(targetSprite.scale);
    gsap.killTweensOf(targetSprite.material);

    const oldMat = targetSprite.material as THREE.SpriteMaterial;
    const newMat = oldMat.clone();
    newMat.color.setHex(0xFFFFFF);
    newMat.opacity = 1;
    newMat.blending = THREE.AdditiveBlending;
    newMat.needsUpdate = true;
    targetSprite.material = newMat;

    gsap.to(targetSprite.scale, {
      x: targetOrigScale.x * 2.2,
      y: targetOrigScale.y * 2.2,
      z: targetOrigScale.z * 2.2,
      duration: 0.8,
      ease: 'power2.out',
      delay: 0.3,
    });

    // 第二步：0.8s 后再 GSAP 到 5x
    setTimeout(() => {
      // 统一最终尺寸：和 query 完全一致 0.6×0.6×5
      const uniformFinalX = 0.6;
      const uniformFinalY = 0.6;
      const uniformFinalZ = 5;

      gsap.to(targetSprite.scale, {
        x: uniformFinalX,
        y: uniformFinalY,
        z: uniformFinalZ,
        duration: 1.8,
        ease: 'power3.out',
        onComplete: () => {
          console.log('[jumpToStar-情况2] target AFTER tween:', targetSprite.scale.x.toFixed(3), targetSprite.scale.y.toFixed(3), targetSprite.scale.z.toFixed(3));
          console.log('[jumpToStar-情况2] target material:', {
            color: '#' + targetSprite.material.color.getHexString(),
            opacity: targetSprite.material.opacity,
            blending: targetSprite.material.blending
          });
          console.log('[jumpToStar-情况2] glows:', finalStarGlowSprites.length);
          finalStarGlowSprites.forEach((g, i) => {
            console.log(`  glow[${i}] scale=${g.scale.x.toFixed(1)}x${g.scale.y.toFixed(1)}, color=0x${g.material.color.getHexString().toUpperCase()}`);
          });
        },
      });

      // 两层辉光：模拟 query 的 highlightAndGrow 小辉光 + reranker 大辉光
      // 第一层：小辉光（紧贴核心，白色，让核心区域饱满）
      const innerGlow = createGlow(targetSprite.position, 0xFFFFFF, 1);
      if (innerGlow) finalStarGlowSprites.push(innerGlow);

      // 第二层：大辉光（外层包裹，绿色，和 query 一致）
      const glow = createGlow(targetSprite.position, 0x34D399, 30);
      if (glow) finalStarGlowSprites.push(glow);

      gsap.to(newMat, {
        opacity: 0.7,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });

      finalStarInfo = {
        sprite: targetSprite,
        data: null,
        trueOriginalScale: targetOrigScale,
        trueOriginalMaterial: targetOrigMat,
        domainColor: domainColorFromSprite(targetOrigMat),
        appliedStyle: {
          coreColor: '#ffffff',
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          scaleMultiplier: 5,
          glowColor: 0x34D399,
          glowSize: 30,
          breathingActive: true,
        },
      };

      // 等流星飞完再移动相机
      (isVectorValid(targetPos) ? shootMeteors([targetPos], 0x34D399, 0) : Promise.resolve()).then(() => {
        flyToStar(targetPos, 1.5);
      });
    }, 1100);
  }

  function domainColorFromSprite(mat: THREE.SpriteMaterial): string {
    return '#' + mat.color.getHexString();
  }

  function resetFinalStar() {
    if (!finalStarInfo) return;
    const { sprite, trueOriginalScale, trueOriginalMaterial } = finalStarInfo;

    const oldMat = sprite.material as THREE.SpriteMaterial;

    // 先杀死旧材质上的所有tween（特别是无限循环的呼吸动画）
    gsap.killTweensOf(oldMat);
    gsap.killTweensOf(oldMat.color);
    gsap.killTweensOf(sprite.scale);
    gsap.killTweensOf(sprite);

    // 强制重置scale
    sprite.scale.set(trueOriginalScale.x, trueOriginalScale.y, trueOriginalScale.z);

    // 清理所有已知光晕
    clearAllGlows();

    // 场景级清扫：移除所有大尺寸sprite（光晕）
    scene.children.forEach(child => {
      if (child instanceof THREE.Sprite && child !== sprite) {
        const maxDim = Math.max(child.scale.x, child.scale.y);
        if (maxDim > 10) {
          scene.remove(child);
          (child.material as THREE.Material).dispose();
          if (child.material instanceof THREE.SpriteMaterial && child.material.map) {
            child.material.map.dispose();
          }
        }
      }
    });

    // 替换为原始材质
    sprite.material = trueOriginalMaterial;

    // 确保原始材质的属性正确
    trueOriginalMaterial.opacity = trueOriginalMaterial.opacity; // 触发setter
    trueOriginalMaterial.needsUpdate = true;

    // 销毁旧材质（防止内存泄漏和tween残留）
    if (oldMat !== trueOriginalMaterial) {
      // 不dispose map，因为可能被缓存共享
      oldMat.dispose();
    }

    finalStarInfo = null;

    console.log('[reset] 最终星已恢复到原始状态');
  }

  function getFinalStar(): FinalStarInfo | null {
    return finalStarInfo;
  }

  return { animateSearch, cleanup, getFinalStar, resetFinalStar, jumpToStar };
}
