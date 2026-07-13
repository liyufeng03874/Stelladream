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
import { EffectRegistry } from '../core/EffectRegistry';
import { EffectFactory, type ManagedEffect } from '../core/EffectFactory';

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

  // ===== 状态管理基础设施 =====
  const registry = new EffectRegistry();
  const factory = new EffectFactory({ registry, scene });

  // 旧系统数组（过渡期保留，确保向后兼容）
  let glowSprites: THREE.Sprite[] = [];
  let highlightedSprites = new Map<THREE.Sprite, {
    originalScale: THREE.Vector3;
    originalMaterial: THREE.SpriteMaterial;
  }>();
  let finalStarInfo: FinalStarInfo | null = null;
  let breathingTween: any = null;
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

  /** 创建辉光（通过 EffectFactory，同时兼容旧系统） */
  function createGlow(position: THREE.Vector3, color: number, size: number, targetId: string = 'default', source: string = 'createGlow', phase: string = 'default'): THREE.Sprite | null {
    const effect = factory.createGlow(position, color, size, targetId, source, phase);
    const glow = effect.threeObjects[0] as THREE.Sprite;
    // 兼容旧系统：同时加入 glowSprites 数组
    glowSprites.push(glow);
    return glow;
  }

  /** 创建流星（通过 EffectFactory） */
  function createMeteor(from: THREE.Vector3, to: THREE.Vector3, color: number, delayMs: number = 0, targetId: string = 'default', source: string = 'createMeteor', phase: string = 'default'): Promise<void> {
    if (!isVectorValid(from) || !isVectorValid(to)) {
      return Promise.resolve();
    }
    return factory.createMeteor(from, to, color, targetId, source, phase, delayMs).then(() => {});
  }

  function highlightAndGrow(chunkIds: string[], color: number, scale: number = 2, phase: string = 'highlightAndGrow'): THREE.Sprite[] {
    const sprites: THREE.Sprite[] = [];
    const source = 'highlightAndGrow';

    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;
      if (!sprite || !isVectorValid(sprite.position)) return;

      const targetId = `coreStar_${chunkId}`;

      if (!trueOriginals.has(sprite)) {
        trueOriginals.set(sprite, {
          scale: starInfo.originalScale.clone(),
          material: starInfo.originalMaterial.clone(),
        });
      }

      if (!highlightedSprites.has(sprite)) {
        highlightedSprites.set(sprite, {
          originalScale: sprite.scale.clone(),
          originalMaterial: sprite.material.clone()
        });
      }

      const oldMat = sprite.material as THREE.SpriteMaterial;
      const oldColor = '#' + oldMat.color.getHexString();
      const oldOpacity = oldMat.opacity;
      const oldBlending = oldMat.blending;

      const newMaterial = oldMat.clone();
      newMaterial.color.setHex(color);
      newMaterial.opacity = 1;
      newMaterial.blending = THREE.AdditiveBlending;
      sprite.material = newMaterial;

      // 注册材质变更
      registry.add({ targetId, effectType: 'material', property: 'color', prevValue: oldColor, value: '#' + new THREE.Color(color).getHexString(), source, phase });
      registry.add({ targetId, effectType: 'material', property: 'opacity', prevValue: oldOpacity, value: 1, source, phase });
      registry.add({ targetId, effectType: 'material', property: 'blending', prevValue: oldBlending, value: THREE.AdditiveBlending, source, phase });

      const origScale = sprite.scale.clone();
      registry.add({ targetId, effectType: 'scale', property: 'scale', prevValue: { x: origScale.x, y: origScale.y, z: origScale.z }, value: { x: origScale.x * scale, y: origScale.y * scale, z: origScale.z * scale }, source, phase });

      gsap.to(sprite.scale, {
        x: origScale.x * scale,
        y: origScale.y * scale,
        z: origScale.z * scale,
        duration: 0.8,
        ease: 'power2.out',
        delay: 0.3
      });

      setTimeout(() => {
        createGlow(sprite.position, color, sprite.scale.x * scale * 3, targetId, source, phase);
      }, 400);

      sprites.push(sprite);
    });

    return sprites;
  }

  /** 清理辉光（通过 registry + factory，保留旧系统兼容） */
  function clearAllGlows() {
    // 旧系统：手动清理数组
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

    // 新系统：通过 factory 场景级兜底
    factory.sweepOrphanGlows(20);
  }

  /** 清理（通过 registry 恢复 + factory 清理，保留旧系统兼容） */
  function cleanup() {
    // 旧系统：手动恢复
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

    // 新系统：通过 factory 清理所有活跃对象
    factory.sweepOrphanGlows(10);
  }

  /** 相机飞向目标（通过 registry 记录相机变更） */
  function flyToStar(targetPos: THREE.Vector3, duration: number = 2.0, source: string = 'flyToStar', phase: string = 'flyToStar') {
    const startPos = camera.position.clone();

    if (!isVectorValid(targetPos)) {
      return Promise.resolve();
    }

    // 注册相机起始状态
    registry.add({
      targetId: '_camera',
      effectType: 'camera',
      property: 'position',
      prevValue: { x: startPos.x, y: startPos.y, z: startPos.z },
      value: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
      source,
      phase,
    });

    const dir = new THREE.Vector3().subVectors(targetPos, startPos).normalize();
    const directDist = startPos.distanceTo(targetPos);
    const flightDist = THREE.MathUtils.clamp(directDist * 0.8, 25, 60);
    const finalCamPos = targetPos.clone().add(dir.clone().multiplyScalar(-flightDist));

    const midPoint = new THREE.Vector3().lerpVectors(startPos, finalCamPos, 0.5);
    midPoint.y += Math.min(8, directDist * 0.05);

    const curve = new THREE.QuadraticBezierCurve3(startPos, midPoint, finalCamPos);
    const startTarget = controls.target.clone();

    return new Promise<void>(resolve => {
      const startTime = Date.now();
      const durationMs = duration * 1000;

      const update = () => {
        const t = Math.min((Date.now() - startTime) / durationMs, 1);
        const point = curve.getPoint(t);

        camera.position.copy(point);
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

  function shootMeteors(positions: THREE.Vector3[], color: number, staggerMs: number = 0, source: string = 'shootMeteors', phase: string = 'meteor'): Promise<void[]> {
    const origin = getEmissionPoint();
    const promises = positions.map((pos, i) => createMeteor(origin, pos, color, i * staggerMs, `meteor_${i}`, source, phase));
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

    const bm25Sprites = highlightAndGrow(bm25Ids.slice(0, 10), 0xFFD700, 2.2, 'bm25');
    const knnSprites = highlightAndGrow(knnIds.slice(0, 10), 0x60A5FA, 2.2, 'knn');
    const rrfSprites = highlightAndGrow(rrfIds, 0xA78BFA, 2.8, 'rrf');

    const bm25Positions = bm25Sprites.map(s => s.position);
    const knnPositions = knnSprites.map(s => s.position);
    const rrfPositions = rrfSprites.map(s => s.position);

    shootMeteors(bm25Positions, 0xFFD700, 50, 'animateSearch', 'bm25');
    shootMeteors(knnPositions, 0x60A5FA, 50, 'animateSearch', 'knn');
    shootMeteors(rrfPositions, 0xA78BFA, 50, 'animateSearch', 'rrf');

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

      const finalTargetId = `coreStar_final_${finalId}`;
      // 注册最终星的变更
      registry.add({ targetId: finalTargetId, effectType: 'material', property: 'color', prevValue: '#34D399', value: '#FFFFFF', source: 'animateSearch', phase: 'finalStar' });
      registry.add({ targetId: finalTargetId, effectType: 'material', property: 'opacity', prevValue: 1, value: 0.7, source: 'animateSearch', phase: 'finalStar' });
      registry.add({ targetId: finalTargetId, effectType: 'scale', property: 'scale', prevValue: { x: trueOriginalScale.x, y: trueOriginalScale.y, z: trueOriginalScale.z }, value: { x: trueOriginalScale.x * 5, y: trueOriginalScale.y * 5, z: trueOriginalScale.z * 5 }, source: 'animateSearch', phase: 'finalStar' });

      gsap.killTweensOf(finalSprite.scale);
      gsap.killTweensOf(finalMat);

      createGlow(finalSprite.position, 0x34D399, 30, finalTargetId, 'animateSearch', 'finalStar');

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
        shootMeteors([targetPos], 0x34D399, 0, 'animateSearch', 'finalStar');
      }

      gsap.to(finalSprite.scale, {
        x: trueOriginalScale.x * 5,
        y: trueOriginalScale.y * 5,
        z: trueOriginalScale.z * 5,
        duration: flightDuration,
        ease: 'power3.out',
        onComplete: () => {
          console.log('[search-final] finalSprite AFTER tween:', finalSprite.scale.x.toFixed(3), finalSprite.scale.y.toFixed(3), finalSprite.scale.z.toFixed(3));
          console.log('[search-final] camera pos:', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
          const camDist = camera.position.distanceTo(finalSprite.position);
          console.log('[search-final] camera distance to target:', camDist.toFixed(2));
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

      await flyToStar(targetPos, flightDuration, 'animateSearch', 'finalStar');
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
      const targetId = `coreStar_${targetSprite.userData.chunk_id || 'unknown'}`;
      const source = 'jumpToStar';
      const phase = 'jumpToStar';

      // 立即换材质（白核心）
      gsap.killTweensOf(targetSprite.scale);
      gsap.killTweensOf(targetSprite.material);

      const oldMat = targetSprite.material as THREE.SpriteMaterial;
      const oldColor = '#' + oldMat.color.getHexString();
      const oldOpacity = oldMat.opacity;
      const newMat = oldMat.clone();
      newMat.color.setHex(0xFFFFFF);
      newMat.opacity = 1;
      newMat.blending = THREE.AdditiveBlending;
      newMat.needsUpdate = true;
      targetSprite.material = newMat;

      // 注册变更
      registry.add({ targetId, effectType: 'material', property: 'color', prevValue: oldColor, value: '#FFFFFF', source, phase });
      registry.add({ targetId, effectType: 'material', property: 'opacity', prevValue: oldOpacity, value: 0.7, source, phase });
      const oldScale = targetSprite.scale.clone();
      registry.add({ targetId, effectType: 'scale', property: 'scale', prevValue: { x: oldScale.x, y: oldScale.y, z: oldScale.z }, value: { x: 0.6, y: 0.6, z: 5 }, source, phase });

      // 辉光：和 query 完全一致（单层绿色30，tween前立即创建）
      createGlow(targetPos, 0x34D399, 30, targetId, source, phase);

      // 放大动画 — 和 query 完全一致 0.6，让辉光完全包裹核心
      const uniformFinalScale = 0.6;
      console.log('[jumpToStar-情况1] targetOrigScale:', targetOrigScale.x.toFixed(3), targetOrigScale.y.toFixed(3), targetOrigScale.z.toFixed(3));
      console.log('[jumpToStar-情况1] target BEFORE:', targetSprite.scale.x.toFixed(3), targetSprite.scale.y.toFixed(3), targetSprite.scale.z.toFixed(3));

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
          console.log('[jumpToStar-情况1] targetOrigScale:', targetOrigScale.x.toFixed(3), targetOrigScale.y.toFixed(3), targetOrigScale.z.toFixed(3));
          console.log('[jumpToStar-情况1] camera pos:', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
          console.log('[jumpToStar-情况1] target pos:', targetPos.x.toFixed(2), targetPos.y.toFixed(2), targetPos.z.toFixed(2));
          const camDist = camera.position.distanceTo(targetPos);
          console.log('[jumpToStar-情况1] camera distance to target:', camDist.toFixed(2));
          console.log('[jumpToStar-情况1] glows:', finalStarGlowSprites.length);
          finalStarGlowSprites.forEach((g, i) => {
            console.log(`  glow[${i}] scale=${g.scale.x.toFixed(1)}x${g.scale.y.toFixed(1)}, color=0x${g.material.color.getHexString().toUpperCase()}`);
          });
        },
      });

      breathingTween = gsap.to(newMat, {
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
      const meteorPromise = isVectorValid(targetPos) ? shootMeteors([targetPos], 0x34D399, 0, source, phase) : Promise.resolve();
      meteorPromise.then(() => {
        flyToStar(targetPos, 1.5, source, phase);
      });
      return;
    }

    // 情况2：有最终星，转移样式
    console.log('[jumpToStar-情况2] 开始星跃，有旧最终星');
    const targetId = `coreStar_${targetSprite.userData.chunk_id || 'unknown'}`;
    const source = 'jumpToStar';
    const phase = 'jumpToStar';

    // 1. 清除最终星的辉光
    clearAllGlows();

    // 2. 恢复最终星
    resetFinalStar();

    // 3. 目标星
    const targetPos = targetSprite.position;

    // 和 query 一致：先改材质 + 创建辉光 + 再启动 tween
    gsap.killTweensOf(targetSprite.scale);
    gsap.killTweensOf(targetSprite.material);

    const oldMat2 = targetSprite.material as THREE.SpriteMaterial;
    const oldColor2 = '#' + oldMat2.color.getHexString();
    const oldOpacity2 = oldMat2.opacity;
    const newMat = oldMat2.clone();
    newMat.color.setHex(0xFFFFFF);
    newMat.opacity = 1;
    newMat.blending = THREE.AdditiveBlending;
    newMat.needsUpdate = true;
    targetSprite.material = newMat;

    registry.add({ targetId, effectType: 'material', property: 'color', prevValue: oldColor2, value: '#FFFFFF', source, phase });
    registry.add({ targetId, effectType: 'material', property: 'opacity', prevValue: oldOpacity2, value: 1, source, phase });
    const oldScale2 = targetOrigScale.clone();
    registry.add({ targetId, effectType: 'scale', property: 'scale', prevValue: { x: oldScale2.x, y: oldScale2.y, z: oldScale2.z }, value: { x: oldScale2.x * 2.2, y: oldScale2.y * 2.2, z: oldScale2.z * 2.2 }, source, phase });

    // 和 query 完全一致：改完材质后先创建辉光，再启动 tween
    const glow = createGlow(targetSprite.position, 0x34D399, 30, targetId, source, phase);
    if (glow) finalStarGlowSprites.push(glow);
    console.log('[jumpToStar-情况2] glow created at scale:', targetSprite.scale.x.toFixed(3));

    gsap.to(targetSprite.scale, {
      x: targetOrigScale.x * 2.2,
      y: targetOrigScale.y * 2.2,
      z: targetOrigScale.z * 2.2,
      duration: 0.8,
      ease: 'power2.out',
      delay: 0.3,
    });

    // 第二步：0.8s 后再 GSAP 到最终尺寸
    setTimeout(() => {
      const uniformFinalX = 0.6;
      const uniformFinalY = 0.6;
      const uniformFinalZ = 5;

      registry.add({ targetId, effectType: 'scale', property: 'scale', prevValue: { x: targetOrigScale.x * 2.2, y: targetOrigScale.y * 2.2, z: targetOrigScale.z * 2.2 }, value: { x: uniformFinalX, y: uniformFinalY, z: uniformFinalZ }, source, phase });

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
          console.log('[jumpToStar-情况2] camera pos:', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
          const camDist = camera.position.distanceTo(targetPos);
          console.log('[jumpToStar-情况2] camera distance to target:', camDist.toFixed(2));
        },
      });

      breathingTween = gsap.to(newMat, {
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

      (isVectorValid(targetPos) ? shootMeteors([targetPos], 0x34D399, 0, source, phase) : Promise.resolve()).then(() => {
        flyToStar(targetPos, 1.5, source, phase);
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

  function getFinalStarGlows(): THREE.Sprite[] {
    return [...finalStarGlowSprites];
  }

  function setBreathingActive(active: boolean) {
    if (breathingTween) {
      if (active) {
        breathingTween.resume();
      } else {
        breathingTween.pause();
      }
    }
    if (finalStarInfo?.appliedStyle) {
      finalStarInfo.appliedStyle.breathingActive = active;
    }
  }

  return {
    animateSearch,
    cleanup,
    getFinalStar,
    getFinalStarGlows,
    setBreathingActive,
    resetFinalStar,
    jumpToStar,
    getRegistry: () => registry,
    getFactory: () => factory,
  };
}
