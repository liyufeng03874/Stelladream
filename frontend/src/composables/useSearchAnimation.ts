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

// 领域颜色（与 useEvalVisual 保持一致）
function getDomainColor(value: string): number {
  if (value === 'general' || value.startsWith('cmrc_')) return 0x34D399; // 百科：绿
  if (value === 'medical' || value.startsWith('doc_')) return 0x4A9AF5;  // 医疗：蓝
  if (value === 'law') return 0xE74C3C;
  return 0xF5A623;                                  // 游戏/小说：橙
}
import { EffectRegistry } from '../core/EffectRegistry';
import { EffectFactory } from '../core/EffectFactory';

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

interface HighlightOptions {
  withGlow?: boolean;
  glowScaleMultiplier?: number;
  glowMaxSize?: number;
  glowDelayMs?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function useSearchAnimation(context: SearchAnimationContext) {
  const { scene, camera, controls, starDataMap } = context;

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
  let flightToken = 0;
  let finalStarGlowSprites: THREE.Sprite[] = [];
  let trueOriginals = new Map<THREE.Sprite, {
    scale: THREE.Vector3;
    material: THREE.SpriteMaterial;
  }>();

  // 从 difference.log 提取：query 阶段所有辉光（叠加到 jumpToStar 目标星上）
  const FINAL_STAR_QUERY_GLOWS = [
    // bm25 辉光（10个）
    { color: 16766720, size: 1.7856828 },
    { color: 16766720, size: 1.4432484 },
    { color: 16766720, size: 1.4432484 },
    { color: 16766720, size: 1.4432484 },
    { color: 16766720, size: 1.217634 },
    { color: 16766720, size: 1.4432484 },
    { color: 16766720, size: 1.271127 },
    { color: 16766720, size: 1.6337178 },
    { color: 16766720, size: 1.5380772 },
    { color: 16766720, size: 1.1890956 },
    // knn 辉光（10个）
    { color: 6333946, size: 1.4432484 },
    { color: 6333946, size: 1.4432484 },
    { color: 6333946, size: 1.4432484 },
    { color: 6333946, size: 1.4432484 },
    { color: 6333946, size: 1.5936228 },
    { color: 6333946, size: 1.7064036 },
    { color: 6333946, size: 1.5974244 },
    { color: 6333946, size: 1.655115 },
    { color: 6333946, size: 1.3979526 },
    { color: 6333946, size: 1.2611544 },
    // rrf 辉光（5个）
    { color: 10980346, size: 1.9185936 },
    { color: 10980346, size: 1.9185936 },
    { color: 10980346, size: 1.9185936 },
    { color: 10980346, size: 1.9185936 },
    { color: 10980346, size: 2.1717864 },
  ];

  function isVectorValid(v: THREE.Vector3): boolean {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
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

  function highlightAndGrow(
    chunkIds: string[],
    color: number,
    scale: number = 2,
    phase: string = 'highlightAndGrow',
    options: HighlightOptions = {},
  ): THREE.Sprite[] {
    const sprites: THREE.Sprite[] = [];
    const source = 'highlightAndGrow';
    const {
      withGlow = true,
      glowScaleMultiplier = 1.8,
      glowMaxSize = 10,
      glowDelayMs = 240,
    } = options;

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

      if (withGlow) {
        setTimeout(() => {
          const glowSize = Math.min(glowMaxSize, Math.max(1.6, sprite.scale.x * scale * glowScaleMultiplier));
          createGlow(sprite.position, color, glowSize, targetId, source, phase);
        }, glowDelayMs);
      }

      sprites.push(sprite);
    });

    return sprites;
  }

  /** 清理辉光（通过 registry + factory，保留旧系统兼容） */
  function clearAllGlows() {
    // 旧系统：手动清理数组
    factory.disposeByType('glow');
    glowSprites = [];
    finalStarGlowSprites = [];

    // 新系统：通过 factory 场景级兜底
  }

  /** 清理（通过 registry 恢复 + factory 清理，保留旧系统兼容） */
  function cleanup() {
    flightToken += 1;
    gsap.killTweensOf(camera.position);
    gsap.killTweensOf(controls.target);
    if (breathingTween) {
      breathingTween.kill();
      breathingTween = null;
    }
    factory.disposeAll();
    glowSprites = [];
    finalStarGlowSprites = [];
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
    finalStarInfo = null;
  }

  /** 相机飞向目标（通过 registry 记录相机变更） */
  /** 相机飞向目标（通过 registry 记录相机变更） */
  function flyToStar(
    targetPos: THREE.Vector3,
    duration: number = 2.0,
    source: string = 'flyToStar',
    phase: string = 'flyToStar',
    options: { cameraDistance?: number; arcLift?: number } = {},
  ) {
    const startPos = camera.position.clone();
    const currentFlightToken = ++flightToken;

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
    const flightDist = options.cameraDistance ?? THREE.MathUtils.clamp(directDist * 0.8, 25, 60);
    const finalCamPos = targetPos.clone().add(dir.clone().multiplyScalar(-flightDist));

    const midPoint = new THREE.Vector3().lerpVectors(startPos, finalCamPos, 0.5);
    midPoint.y += options.arcLift ?? Math.min(8, directDist * 0.05);

    const curve = new THREE.QuadraticBezierCurve3(startPos, midPoint, finalCamPos);
    const startTarget = controls.target.clone();

    return new Promise<void>(resolve => {
      const startTime = Date.now();
      const durationMs = duration * 1000;

      const update = () => {
        if (currentFlightToken !== flightToken) {
          resolve();
          return;
        }

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
    const focus = isVectorValid(controls.target)
      ? controls.target.clone()
      : new THREE.Vector3(67.1, 96.2, 30.9);

    const viewDir = new THREE.Vector3().subVectors(focus, camera.position).normalize();
    const focusDistance = camera.position.distanceTo(focus);
    const launchDistance = THREE.MathUtils.clamp(focusDistance * 0.08, 10, 24);

    return camera.position
      .clone()
      .add(viewDir.multiplyScalar(launchDistance))
      .add(new THREE.Vector3(0, -Math.max(1.2, launchDistance * 0.08), 0));
  }

  function shootMeteors(positions: THREE.Vector3[], color: number, staggerMs: number = 0, source: string = 'shootMeteors', phase: string = 'meteor'): Promise<void[]> {
    const origin = getEmissionPoint();
    const viewDir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    const side = new THREE.Vector3().crossVectors(viewDir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3(0, 1, 0);

    const promises = positions.map((pos, i) => {
      const sideOffset = side.clone().multiplyScalar((i % 2 === 0 ? -1 : 1) * Math.min(1.8, i * 0.18));
      const upOffset = up.clone().multiplyScalar(((i % 3) - 1) * 0.35);
      return createMeteor(origin.clone().add(sideOffset).add(upOffset), pos, color, i * staggerMs, `meteor_${i}`, source, phase);
    });
    return Promise.all(promises);
  }

  function collectPositions(chunkIds: string[], maxTargets: number): THREE.Vector3[] {
    return chunkIds
      .slice(0, maxTargets)
      .map(chunkId => starDataMap.get(chunkId)?.sprite.position.clone())
      .filter((pos): pos is THREE.Vector3 => pos !== undefined && isVectorValid(pos));
  }

  async function frameTargetCluster(positions: THREE.Vector3[], duration: number = 0.9) {
    if (!positions.length) return;

    const box = new THREE.Box3();
    positions.forEach(pos => box.expandByPoint(pos));

    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.degToRad(perspectiveCamera.fov || 25);
    const aspect = perspectiveCamera.aspect || 1;
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const viewDir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const framedRadius = Math.max(sphere.radius, 6);
    const framedDistance = Math.max(
      framedRadius / Math.tan(fov / 2),
      framedRadius / Math.tan(horizontalFov / 2),
    ) * 1.2;
    const targetCameraPos = center
      .clone()
      .add(viewDir.multiplyScalar(THREE.MathUtils.clamp(framedDistance, 55, 180)));
    targetCameraPos.y += Math.min(10, framedRadius * 0.06);

    await new Promise<void>(resolve => {
      let completed = 0;
      const done = () => {
        completed += 1;
        if (completed === 2) resolve();
      };

      gsap.to(camera.position, {
        x: targetCameraPos.x,
        y: targetCameraPos.y,
        z: targetCameraPos.z,
        duration,
        ease: 'power2.inOut',
        onComplete: done,
      });

      gsap.to(controls.target, {
        x: center.x,
        y: center.y,
        z: center.z,
        duration,
        ease: 'power2.inOut',
        onComplete: done,
      });
    });
  }

  async function playMeteorWave(
    chunkIds: string[],
    color: number,
    phase: string,
    options: {
      maxTargets: number;
      scale: number;
      staggerMs: number;
      withGlow?: boolean;
      glowMaxSize?: number;
      holdMs?: number;
    },
  ) {
    const ids = chunkIds.slice(0, options.maxTargets);
    const sprites = highlightAndGrow(ids, color, options.scale, phase, {
      withGlow: options.withGlow ?? false,
      glowScaleMultiplier: 1.5,
      glowMaxSize: options.glowMaxSize ?? 5,
      glowDelayMs: 180,
    });

    if (!sprites.length) return;

    const positions = sprites
      .map(sprite => sprite.position.clone())
      .filter((pos): pos is THREE.Vector3 => isVectorValid(pos));

    await shootMeteors(positions, color, options.staggerMs, 'animateSearch', phase);
    await sleep(options.holdMs ?? 120);
  }

  async function animateSearch(results: {
    bm25: Array<{ chunk_id: string }>;
    knn: Array<{ chunk_id: string }>;
    rrf_top5: Array<{ chunk_id: string }>;
    reranker_final: { chunk_id: string } | null;
  }) {
    cleanup();
    clearAllGlows();

    await sleep(120);

    const bm25Ids = results.bm25.map(r => r.chunk_id);
    const knnIds = results.knn.map(r => r.chunk_id);
    const rrfIds = results.rrf_top5.map(r => r.chunk_id);

    const framingPositions = [
      ...collectPositions(bm25Ids, 6),
      ...collectPositions(knnIds, 6),
      ...collectPositions(rrfIds, 5),
    ];

    await frameTargetCluster(framingPositions, 0.95);

    await playMeteorWave(bm25Ids, 0xFFD700, 'bm25', {
      maxTargets: 6,
      scale: 1.75,
      staggerMs: 70,
      withGlow: false,
      holdMs: 90,
    });

    await playMeteorWave(knnIds, 0x60A5FA, 'knn', {
      maxTargets: 6,
      scale: 1.75,
      staggerMs: 70,
      withGlow: false,
      holdMs: 90,
    });

    await playMeteorWave(rrfIds, 0xA78BFA, 'rrf', {
      maxTargets: 5,
      scale: 2.1,
      staggerMs: 90,
      withGlow: true,
      glowMaxSize: 4.2,
      holdMs: 120,
    });

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
      clearAllGlows();

      const trueOriginalScale = trueOrig.scale.clone();
      const trueOriginalMaterial = trueOrig.material;

      const finalSprite = finalStar.sprite;

      // 关键修复：克隆当前材质，不要直接修改（避免污染原始材质）
      const oldMat = finalSprite.material as THREE.SpriteMaterial;
      const finalMat = oldMat.clone();

      // 在新克隆的材质上修改
      finalMat.color.setHex(0xFFFFFF);
      finalMat.opacity = 0.92;
      finalMat.blending = THREE.AdditiveBlending;
      finalMat.needsUpdate = true;

      // 应用新材质
      finalSprite.material = finalMat;

      const finalTargetId = `coreStar_final_${finalId}`;
      const finalScaleMultiplier = 2.7;
      const finalGlowSize = THREE.MathUtils.clamp(trueOriginalScale.x * 10, 4.5, 9);
      const finalCameraDistance = THREE.MathUtils.clamp(22 + trueOriginalScale.x * 10, 20, 30);
      // 注册最终星的变更
      registry.add({ targetId: finalTargetId, effectType: 'material', property: 'color', prevValue: '#34D399', value: '#FFFFFF', source: 'animateSearch', phase: 'finalStar' });
      registry.add({ targetId: finalTargetId, effectType: 'material', property: 'opacity', prevValue: 1, value: 0.72, source: 'animateSearch', phase: 'finalStar' });
      registry.add({ targetId: finalTargetId, effectType: 'scale', property: 'scale', prevValue: { x: trueOriginalScale.x, y: trueOriginalScale.y, z: trueOriginalScale.z }, value: { x: trueOriginalScale.x * finalScaleMultiplier, y: trueOriginalScale.y * finalScaleMultiplier, z: trueOriginalScale.z * finalScaleMultiplier }, source: 'animateSearch', phase: 'finalStar' });

      gsap.killTweensOf(finalSprite.scale);
      gsap.killTweensOf(finalMat);

      const domainColor = getDomainColor(finalStar.data.domain);
      const finalGlow = createGlow(finalSprite.position, domainColor, finalGlowSize, finalTargetId, 'animateSearch', 'finalStar');
      if (finalGlow) {
        finalGlow.material.opacity = 0.48;
        finalStarGlowSprites.push(finalGlow);
      }

      const flightDuration = 1.5;

      const targetPos = finalSprite.position;
      // 列出所有光晕

      gsap.to(finalSprite.scale, {
        x: trueOriginalScale.x * finalScaleMultiplier,
        y: trueOriginalScale.y * finalScaleMultiplier,
        z: trueOriginalScale.z * finalScaleMultiplier,
        duration: flightDuration,
        ease: 'power3.out',
      });

      gsap.to(finalSprite.material, {
        opacity: 0.72,
        duration: 0.95,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1
      });

      const dcHex = '#' + trueOriginalMaterial.color.getHexString();
      finalStarInfo = {
        sprite: finalSprite,
        data: finalStar.data,
        trueOriginalScale,
        trueOriginalMaterial,
        domainColor: dcHex,
        appliedStyle: {
          coreColor: '#ffffff',
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          scaleMultiplier: finalScaleMultiplier,
          glowColor: domainColor,
          glowSize: finalGlowSize,
          breathingActive: true,
        },
      };

      if (isVectorValid(targetPos)) {
        const finalMeteor = shootMeteors([targetPos], domainColor, 0, 'animateSearch', 'finalStar');
        await sleep(120);
        await Promise.all([
          finalMeteor,
          flyToStar(targetPos, flightDuration, 'animateSearch', 'finalStar', {
            cameraDistance: finalCameraDistance,
            arcLift: 5,
          }),
        ]);
      }
    }
  }

  /**
   * 星跃：旧最终星恢复原样，新星星继承最终星样式，相机飞过去
   */
  async function jumpToStar(targetSprite: THREE.Sprite) {
    // 打印搜索动画中最终星的光晕信息
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

      // 辉光铺垫：先对目标星调用 highlightAndGrow，让它获得白色核心和辉光
      // const chunkId = targetSprite.userData.chunk_id;
      // if (chunkId) {
      //   const sprites = highlightAndGrow([chunkId], 0xFFFFFF, 2.2, phase);
      //   // 等一小段时间让辉光创建完成
      //   await new Promise<void>(r => setTimeout(r, 200));
      // }

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

      // 辉光：根据目标星领域色
      const targetChunkId = targetSprite.userData.chunk_id;
      const domainColor = getDomainColor(targetSprite.userData.domain || targetChunkId);
      const glow = createGlow(targetPos, domainColor, 30, targetId, source, phase);
      if (glow) finalStarGlowSprites.push(glow);

      // 2) 复现 query 阶段最终星的 bm25/knn/rrf 辉光（从 difference.log 提取）
      FINAL_STAR_QUERY_GLOWS.forEach(g => {
        const g2 = createGlow(targetPos.clone(), g.color, g.size, targetId, source, 'jumpToStar-replay');
        if (g2) finalStarGlowSprites.push(g2);
      });

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
        data: targetSprite.userData as StarPoint,
        trueOriginalScale: targetOrigScale,
        trueOriginalMaterial: targetOrigMat,
        domainColor: '#' + domainColor.toString(16).padStart(6, '0'),
        appliedStyle: {
          coreColor: '#ffffff',
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          scaleMultiplier: 5,
          glowColor: domainColor,
          glowSize: 30,
          breathingActive: true,
        },
      };

      // 先等流星飞完再移动相机（和搜索动画一致）
      const meteorPromise = isVectorValid(targetPos) ? shootMeteors([targetPos], domainColor, 0, source, phase) : Promise.resolve();
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

    // 3. 辉光铺垫：先对目标星调用 highlightAndGrow，让它获得白色核心和辉光
    // const chunkId = targetSprite.userData.chunk_id;
    // if (chunkId) {
    //   const sprites = highlightAndGrow([chunkId], 0xFFFFFF, 2.2, phase);
    //   // 等一小段时间让辉光创建完成
    //   await new Promise<void>(r => setTimeout(r, 200));
    // }

    // 4. 目标星
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

    // 和 query 完全一致：改完材质后先创建领域色辉光，再启动 tween
    const targetChunkId2 = targetSprite.userData.chunk_id;
    const domainColor2 = getDomainColor(targetSprite.userData.domain || targetChunkId2);
    const glow = createGlow(targetSprite.position, domainColor2, 30, targetId, source, phase);
    if (glow) finalStarGlowSprites.push(glow);

    // 复现 query 阶段最终星的 bm25/knn/rrf 辉光（从 difference.log 提取）
    FINAL_STAR_QUERY_GLOWS.forEach(g => {
      const g2 = createGlow(targetSprite.position.clone(), g.color, g.size, targetId, source, 'jumpToStar-replay');
      if (g2) finalStarGlowSprites.push(g2);
    });

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
        data: targetSprite.userData as StarPoint,
        trueOriginalScale: targetOrigScale,
        trueOriginalMaterial: targetOrigMat,
        domainColor: domainColorFromSprite(targetOrigMat),
        appliedStyle: {
          coreColor: '#ffffff',
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          scaleMultiplier: 5,
          glowColor: domainColor2,
          glowSize: 30,
          breathingActive: true,
        },
      };

      (isVectorValid(targetPos) ? shootMeteors([targetPos], domainColor2, 0, source, phase) : Promise.resolve()).then(() => {
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

  // ===== 评估回放联动 =====
  let evalHighlightedSprites = new Map<THREE.Sprite, {
    originalMaterial: THREE.SpriteMaterial;
    originalScale: THREE.Vector3;
  }>();

  /** 评估高亮：传入 UUID chunk_id 列表，按排名着色 */
  function evalHighlight(chunkIds: string[], color: number, scale: number = 2) {
    // 先清理之前的高亮
    clearEvalHighlight();

    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return; // 静默跳过（评估ID可能不在渲染的星点中）

      const sprite = starInfo.sprite;
      if (!sprite || !isVectorValid(sprite.position)) return;

      const targetId = `eval_${chunkId}`;

      if (!trueOriginals.has(sprite)) {
        trueOriginals.set(sprite, {
          scale: starInfo.originalScale.clone(),
          material: starInfo.originalMaterial.clone(),
        });
      }

      if (!evalHighlightedSprites.has(sprite)) {
        evalHighlightedSprites.set(sprite, {
          originalScale: sprite.scale.clone(),
          originalMaterial: sprite.material.clone(),
        });
      }

      const oldMat = sprite.material as THREE.SpriteMaterial;
      const oldColor = '#' + oldMat.color.getHexString();
      const oldOpacity = oldMat.opacity;

      const newMaterial = oldMat.clone();
      newMaterial.color.setHex(color);
      newMaterial.opacity = 1;
      newMaterial.blending = THREE.AdditiveBlending;
      sprite.material = newMaterial;

      registry.add({ targetId, effectType: 'material', property: 'color', prevValue: oldColor, value: '#' + new THREE.Color(color).getHexString(), source: 'evalHighlight', phase: 'eval' });
      registry.add({ targetId, effectType: 'material', property: 'opacity', prevValue: oldOpacity, value: 1, source: 'evalHighlight', phase: 'eval' });

      const origScale = sprite.scale.clone();
      registry.add({ targetId, effectType: 'scale', property: 'scale', prevValue: { x: origScale.x, y: origScale.y, z: origScale.z }, value: { x: origScale.x * scale, y: origScale.y * scale, z: origScale.z * scale }, source: 'evalHighlight', phase: 'eval' });

      gsap.to(sprite.scale, {
        x: origScale.x * scale,
        y: origScale.y * scale,
        z: origScale.z * scale,
        duration: 0.5,
        ease: 'back.out'
      });

      // 领域色光晕表示正确召回
      setTimeout(() => {
        createGlow(sprite.position, color, sprite.scale.x * 2, targetId, 'evalHighlight', 'eval');
      }, 300);
    });
  }

  /** 清除评估高亮，恢复原样 */
  function clearEvalHighlight() {
    evalHighlightedSprites.forEach((original, sprite) => {
      gsap.killTweensOf(sprite.scale);
      gsap.killTweensOf(sprite.material);

      // 恢复原始材质和缩放
      sprite.material = original.originalMaterial;
      sprite.scale.copy(original.originalScale);

      // 场景级清扫该 sprite 的所有光晕
      scene.children.forEach(child => {
        if (child instanceof THREE.Sprite && child !== sprite) {
          const maxDim = Math.max(child.scale.x, child.scale.y);
          if (maxDim > 5 && maxDim < 50) { // 光晕范围
            const childPos = child.position;
            const spritePos = sprite.position;
            if (childPos.distanceTo(spritePos) < 3) { // 距离近的视为光晕
              scene.remove(child);
              (child.material as THREE.Material).dispose();
              if (child.material instanceof THREE.SpriteMaterial && child.material.map) {
                child.material.map.dispose();
              }
            }
          }
        }
      });
    });
    evalHighlightedSprites.clear();
  }

  return {
    animateSearch,
    cleanup,
    getFinalStar,
    getFinalStarGlows,
    setBreathingActive,
    resetFinalStar,
    jumpToStar,
    evalHighlight,
    clearEvalHighlight,
    flyToStar,
    getRegistry: () => registry,
    getFactory: () => factory,
  };
}
