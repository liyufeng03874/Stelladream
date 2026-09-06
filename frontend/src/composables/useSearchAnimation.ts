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

// 妫板棗鐓欐０婊嗗閿涘牅绗?useEvalVisual 娣囨繃瀵旀稉鈧懛杈剧礆
function getDomainColor(value: string): number {
  if (value === 'general' || value.startsWith('cmrc_')) return 0x6FD7FF; // 閻у墽顫栭敍姘辫雹
  if (value === 'medical' || value.startsWith('doc_')) return 0x4AA8FF;  // 閸栬崵鏋熼敍姘虫憫
  if (value === 'law') return 0x23C9E6;
  return 0x89D7FF;                                  // 濞撳憡鍨?鐏忓繗顕╅敍姘煻
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
  trueOriginalScale: THREE.Vector3;     // 閸?highlightAndGrow 娑斿澧犻惃鍕埂鐎圭偛甯慨?scale
  trueOriginalMaterial: THREE.SpriteMaterial; // 閸?highlightAndGrow 娑斿澧犻惃鍕埂鐎圭偛甯慨?material
  domainColor: string;
  appliedStyle: FinalStarAppliedStyle;
}

interface HighlightOptions {
  withGlow?: boolean;
  glowScaleMultiplier?: number;
  glowMaxSize?: number;
  glowDelayMs?: number;
  materialOpacity?: number;
  glowOpacity?: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const METEOR_FLIGHT_DURATION = 0.8;
const PHASE_BADGES: Record<string, string> = {
  bm25: 'BM25',
  knn: 'kNN',
  rrf: 'RRF',
};
const FINAL_STAR_SCALE_MULTIPLIER = 3.4;
const FINAL_STAR_OPACITY = 0.82;
const FINAL_STAR_GLOW_OPACITY = 0.4;
const FINAL_STAR_FLIGHT_DURATION = 1.5;
const FINAL_NEIGHBOR_RADIUS = 5.5;
const ANNOTATION_MIN_SPACING = 5.5;
export type SearchPhaseFilter = 'all' | 'bm25' | 'knn' | 'rrf' | 'finalStar';

export interface PhaseTimelineItem {
  phase: SearchPhaseFilter;
  label: string;
  count: number;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compactId(value: string, head: number = 8, tail: number = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function buildStarTitle(data: StarPoint): string {
  const sourceName = data.source.split(/[\\/]/).pop() ?? '';
  const sourceTitle = sourceName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (sourceTitle && sourceTitle.length >= 4) {
    return compactText(sourceTitle, 28);
  }

  return compactText(data.content || data.chunk_id, 28);
}

export function useSearchAnimation(context: SearchAnimationContext) {
  const { scene, camera, controls, starDataMap } = context;

  // ===== 閻樿埖鈧胶顓搁悶鍡楃唨绾偓鐠佺偓鏌?=====
  const registry = new EffectRegistry();
  const factory = new EffectFactory({ registry, scene, camera });

  // 閺冄呴兇缂佺喐鏆熺紒鍕剁礄鏉╁洦娴張鐔剁箽閻ｆ瑱绱濈涵顔荤箽閸氭垵鎮楅崗鐓庮啇閿?
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
  let annotationAnchors: THREE.Vector3[] = [];
  let currentPhaseFilter: SearchPhaseFilter = 'all';
  let phaseTimeline: PhaseTimelineItem[] = [
    { phase: 'bm25', label: 'BM25', count: 0 },
    { phase: 'knn', label: 'kNN', count: 0 },
    { phase: 'rrf', label: 'RRF', count: 0 },
    { phase: 'finalStar', label: 'FINAL', count: 0 },
  ];
  let phaseFocusTargets = new Map<SearchPhaseFilter, THREE.Vector3[]>();

  function applyPhaseFilter(filter: SearchPhaseFilter) {
    currentPhaseFilter = filter;
    const visibleSet = filter === 'all' ? null : new Set<SearchPhaseFilter>([filter]);
    const phases: SearchPhaseFilter[] = ['bm25', 'knn', 'rrf', 'finalStar'];
    phases.forEach(phase => {
      const visible = !visibleSet || visibleSet.has(phase);
      factory.setPhaseVisibility(phase, visible);
    });

    if (finalStarInfo?.sprite) {
      finalStarInfo.sprite.visible = filter === 'all' || filter === 'finalStar';
    }
    finalStarGlowSprites.forEach(sprite => {
      sprite.visible = filter === 'all' || filter === 'finalStar';
    });
  }

  function setPhaseFilter(filter: SearchPhaseFilter) {
    applyPhaseFilter(filter);
  }

  function getPhaseTimeline(): PhaseTimelineItem[] {
    return phaseTimeline.map(item => ({ ...item }));
  }

  async function focusPhase(filter: SearchPhaseFilter) {
    if (filter === 'all') return;

    const positions = phaseFocusTargets.get(filter) || [];
    if (!positions.length) {
      if (filter === 'finalStar' && finalStarInfo?.sprite) {
        const pos = finalStarInfo.sprite.position.clone();
        await flyToStar(pos, 0.85, 'phaseFilter', 'phaseFilter', {
          cameraDistance: getFinalStarVisuals(finalStarInfo.trueOriginalScale).cameraDistance,
          arcLift: 2,
        });
      }
      return;
    }

    await frameTargetCluster(positions, 0.65);
  }

  function isVectorValid(v: THREE.Vector3): boolean {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  }

  /** 閸掓稑缂撴潏澶婂帨閿涘牓鈧俺绻?EffectFactory閿涘苯鎮撻弮璺哄悑鐎硅妫化鑽ょ埠閿?*/
  function createGlow(position: THREE.Vector3, color: number, size: number, targetId: string = 'default', source: string = 'createGlow', phase: string = 'default'): THREE.Sprite | null {
    const effect = factory.createGlow(position, color, size, targetId, source, phase);
    const glow = effect.threeObjects[0] as THREE.Sprite;
    // 閸忕厧顔愰弮褏閮寸紒鐕傜窗閸氬本妞傞崝鐘插弳 glowSprites 閺佹壆绮?
    glowSprites.push(glow);
    return glow;
  }

  /** 閸掓稑缂撳ù浣规Е閿涘牓鈧俺绻?EffectFactory閿?*/
  function createMeteor(from: THREE.Vector3, to: THREE.Vector3, color: number, delayMs: number = 0, targetId: string = 'default', source: string = 'createMeteor', phase: string = 'default'): Promise<void> {
    if (!isVectorValid(from) || !isVectorValid(to)) {
      return Promise.resolve();
    }
    return factory.createMeteor(from, to, color, targetId, source, phase, delayMs, METEOR_FLIGHT_DURATION).then(() => {});
  }

  function resolveAnnotationPosition(starPosition: THREE.Vector3, baseHeight: number, index: number, avoidPosition?: THREE.Vector3 | null): THREE.Vector3 {
    const away = avoidPosition
      ? new THREE.Vector3().subVectors(starPosition, avoidPosition)
      : new THREE.Vector3().subVectors(starPosition, controls.target);

    away.y = 0;
    if (away.lengthSq() < 0.001) {
      away.set(index % 2 === 0 ? 1 : -1, 0, 0.35);
    }
    away.normalize();

    const lateral = new THREE.Vector3(-away.z, 0, away.x).normalize();
    const vertical = new THREE.Vector3(0, 1, 0);
    const lift = THREE.MathUtils.clamp(baseHeight * 0.22, 0.55, 1.1);
    const candidates = [
      starPosition.clone().add(vertical.clone().multiplyScalar(lift)),
      starPosition.clone().add(lateral.clone().multiplyScalar(0.7)).add(vertical.clone().multiplyScalar(lift + 0.16)),
      starPosition.clone().add(lateral.clone().multiplyScalar(-0.7)).add(vertical.clone().multiplyScalar(lift + 0.22)),
      starPosition.clone().add(away.clone().multiplyScalar(0.9)).add(vertical.clone().multiplyScalar(lift + 0.28)),
      starPosition.clone().add(away.clone().multiplyScalar(-0.8)).add(vertical.clone().multiplyScalar(lift + 0.34)),
      starPosition.clone().add(lateral.clone().multiplyScalar(index % 2 === 0 ? 1.05 : -1.05)).add(vertical.clone().multiplyScalar(lift + 0.5)),
    ];

    let best = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      let score = 0;
      for (const anchor of annotationAnchors) {
        const dist = candidate.distanceTo(anchor);
        if (dist < ANNOTATION_MIN_SPACING) {
          score += (ANNOTATION_MIN_SPACING - dist) * 50;
        }
      }
      const offsetXZ = new THREE.Vector2(candidate.x - starPosition.x, candidate.z - starPosition.z).length();
      score += offsetXZ * 28;
      if (avoidPosition) {
        const distToAvoid = candidate.distanceTo(avoidPosition);
        if (distToAvoid < 7.5) {
          score += (7.5 - distToAvoid) * 24;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    annotationAnchors.push(best.clone());
    return best;
  }

  function createImpactAnnotation(chunkId: string, phase: string, color: number, index: number, avoidPosition?: THREE.Vector3 | null) {
    const starInfo = starDataMap.get(chunkId);
    if (!starInfo) return;
    const distanceLabel = avoidPosition
      ? `d ${starInfo.sprite.position.distanceTo(avoidPosition).toFixed(1)}`
      : null;

    const labelPosition = resolveAnnotationPosition(
      starInfo.sprite.position,
      Math.max(3.4, starInfo.originalScale.y * 9),
      index,
      avoidPosition,
    );

    factory.createAnnotationLabel(
      labelPosition,
      {
        badge: PHASE_BADGES[phase] ?? phase.toUpperCase(),
        title: buildStarTitle(starInfo.data),
        subtitle: distanceLabel ? `${compactId(chunkId)}  ${distanceLabel}` : `ID ${compactId(chunkId)}`,
        accentColor: color,
        interaction: {
          starData: starInfo.data,
          chunkId,
          kind: 'search-hit',
        },
      },
      `annotation_${phase}_${chunkId}`,
      'animateSearch',
      phase,
    );
  }

  function createFinalAnnotation(starInfo: { sprite: THREE.Sprite; data: StarPoint; originalScale: THREE.Vector3 }, color: number) {
    const labelPosition = resolveAnnotationPosition(
      starInfo.sprite.position,
      Math.max(4.2, starInfo.originalScale.y * 10.5),
      annotationAnchors.length + 1,
      null,
    );

    factory.createAnnotationLabel(
      labelPosition,
      {
        badge: 'FINAL',
        title: buildStarTitle(starInfo.data),
        subtitle: `ID ${compactId(starInfo.data.chunk_id)}`,
        accentColor: color,
        scale: { width: 3.6, height: 1.67 },
        interaction: {
          starData: starInfo.data,
          chunkId: starInfo.data.chunk_id,
          kind: 'final-hit',
        },
      },
      `annotation_final_${starInfo.data.chunk_id}`,
      'animateSearch',
      'finalStar',
    );
  }

  function disposeFinalAnnotations() {
    factory.getActive().forEach(effect => {
      if (effect.type === 'annotation' && effect.targetId.startsWith('annotation_final_')) {
        factory.dispose(effect.id);
      }
    });
  }

  function applyWaveImpact(
    chunkId: string,
    color: number,
    phase: string,
    options: { scale: number; glowMaxSize: number; labelCount: number; index: number; finalAnchor?: THREE.Vector3 | null },
  ) {
    const starInfo = starDataMap.get(chunkId);
    if (!starInfo) return;

    const distanceToFinal = options.finalAnchor ? starInfo.sprite.position.distanceTo(options.finalAnchor) : Number.POSITIVE_INFINITY;
    const nearFinal = distanceToFinal < FINAL_NEIGHBOR_RADIUS;

    highlightAndGrow([chunkId], color, nearFinal ? Math.min(options.scale, 1.12) : options.scale, phase, {
      withGlow: !nearFinal,
      glowScaleMultiplier: 1.15,
      glowMaxSize: nearFinal ? 1.8 : options.glowMaxSize,
      glowDelayMs: 50,
      materialOpacity: nearFinal ? 0.62 : 0.88,
      glowOpacity: nearFinal ? 0.12 : 0.24,
    });

    if (options.index < options.labelCount) {
      createImpactAnnotation(chunkId, phase, color, options.index, options.finalAnchor);
    }
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
      materialOpacity = 1,
      glowOpacity = 0.3,
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
      newMaterial.opacity = materialOpacity;
      newMaterial.blending = THREE.AdditiveBlending;
      sprite.material = newMaterial;

      // 濞夈劌鍞介弶鎰窛閸欐ɑ娲?
      registry.add({ targetId, effectType: 'material', property: 'color', prevValue: oldColor, value: '#' + new THREE.Color(color).getHexString(), source, phase });
      registry.add({ targetId, effectType: 'material', property: 'opacity', prevValue: oldOpacity, value: materialOpacity, source, phase });
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
          const glow = createGlow(sprite.position, color, glowSize, targetId, source, phase);
          if (glow) {
            glow.material.opacity = glowOpacity;
          }
        }, glowDelayMs);
      }

      sprites.push(sprite);
    });

    return sprites;
  }

  /** 濞撳懐鎮婃潏澶婂帨閿涘牓鈧俺绻?registry + factory閿涘奔绻氶悾娆愭＋缁崵绮洪崗鐓庮啇閿?*/
  function clearAllGlows() {
    // 閺冄呴兇缂佺噦绱伴幍瀣З濞撳懐鎮婇弫鎵矋
    factory.disposeByType('glow');
    glowSprites = [];
    finalStarGlowSprites = [];

    // 閺傛壆閮寸紒鐕傜窗闁俺绻?factory 閸︾儤娅欑痪褍鍘规惔?
  }

  /** 濞撳懐鎮婇敍鍫モ偓姘崇箖 registry 閹垹顦?+ factory 濞撳懐鎮婇敍灞肩箽閻ｆ瑦妫化鑽ょ埠閸忕厧顔愰敍?*/
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
    annotationAnchors = [];
    highlightedSprites.forEach((original, sprite) => {
      const currentMaterial = sprite.material as THREE.SpriteMaterial;
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
      if (currentMaterial !== sprite.material) {
        currentMaterial.dispose();
      }
    });
    highlightedSprites.clear();
    trueOriginals.clear();

    // 閺傛壆閮寸紒鐕傜窗闁俺绻?factory 濞撳懐鎮婇幍鈧張澶嬫た鐠哄啫顕挒?
    finalStarInfo = null;
    currentPhaseFilter = 'all';
    phaseTimeline = [
      { phase: 'bm25', label: 'BM25', count: 0 },
      { phase: 'knn', label: 'kNN', count: 0 },
      { phase: 'rrf', label: 'RRF', count: 0 },
      { phase: 'finalStar', label: 'FINAL', count: 0 },
    ];
    phaseFocusTargets = new Map();
  }

  /** 閻╁憡婧€妞嬬偛鎮滈惄顔界垼閿涘牓鈧俺绻?registry 鐠佹澘缍嶉惄鍛婃簚閸欐ɑ娲块敍?*/
  /** 閻╁憡婧€妞嬬偛鎮滈惄顔界垼閿涘牓鈧俺绻?registry 鐠佹澘缍嶉惄鍛婃簚閸欐ɑ娲块敍?*/
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

    // 濞夈劌鍞介惄鍛婃簚鐠у嘲顫愰悩鑸碘偓?
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

  function getFinalStarVisuals(trueOriginalScale: THREE.Vector3) {
    return {
      scaleMultiplier: FINAL_STAR_SCALE_MULTIPLIER,
      glowSize: THREE.MathUtils.clamp(trueOriginalScale.x * 8.4, 4.2, 7.8),
      cameraDistance: THREE.MathUtils.clamp(22 + trueOriginalScale.x * 10, 20, 30),
      opacity: FINAL_STAR_OPACITY,
      glowOpacity: FINAL_STAR_GLOW_OPACITY,
      flightDuration: FINAL_STAR_FLIGHT_DURATION,
    };
  }

  function getFinalStar(): FinalStarInfo | null {
    if (!finalStarInfo) return null;
    return {
      ...finalStarInfo,
      trueOriginalScale: finalStarInfo.trueOriginalScale.clone(),
      trueOriginalMaterial: finalStarInfo.trueOriginalMaterial,
      appliedStyle: { ...finalStarInfo.appliedStyle },
    };
  }

  function getFinalStarGlows(): THREE.Sprite[] {
    return finalStarGlowSprites.slice();
  }

  function setBreathingActive(active: boolean) {
    if (!finalStarInfo) return;
    finalStarInfo.appliedStyle.breathingActive = active;
    if (!breathingTween) return;
    if (active) {
      breathingTween.resume?.();
    } else {
      breathingTween.pause?.();
    }
  }

  function applyFinalStarVisual(
    sprite: THREE.Sprite,
    data: StarPoint,
    trueOriginalScale: THREE.Vector3,
    trueOriginalMaterial: THREE.SpriteMaterial,
    source: string,
    phase: string,
  ) {
    const targetId = `coreStar_final_${data.chunk_id}`;
    const visuals = getFinalStarVisuals(trueOriginalScale);
    const oldMat = sprite.material as THREE.SpriteMaterial;
    const oldColor = '#' + oldMat.color.getHexString();
    const oldOpacity = oldMat.opacity;
    const finalMat = oldMat.clone();
    finalMat.color.setHex(0xF2FDFF);
    finalMat.opacity = 1;
    finalMat.blending = THREE.AdditiveBlending;
    finalMat.needsUpdate = true;
    sprite.material = finalMat;

    registry.add({ targetId, effectType: 'material', property: 'color', prevValue: oldColor, value: '#FFFFFF', source, phase });
    registry.add({ targetId, effectType: 'material', property: 'opacity', prevValue: oldOpacity, value: visuals.opacity, source, phase });
    registry.add({
      targetId,
      effectType: 'scale',
      property: 'scale',
      prevValue: { x: trueOriginalScale.x, y: trueOriginalScale.y, z: trueOriginalScale.z },
      value: {
        x: trueOriginalScale.x * visuals.scaleMultiplier,
        y: trueOriginalScale.y * visuals.scaleMultiplier,
        z: trueOriginalScale.z * visuals.scaleMultiplier,
      },
      source,
      phase,
    });

    gsap.killTweensOf(sprite.scale);
    gsap.killTweensOf(finalMat);

    const domainColor = getDomainColor(data.domain);
    const glow = createGlow(sprite.position, domainColor, visuals.glowSize, targetId, source, phase);
    if (glow) {
      glow.material.opacity = visuals.glowOpacity;
      finalStarGlowSprites.push(glow);
    }

    gsap.to(sprite.scale, {
      x: trueOriginalScale.x * visuals.scaleMultiplier,
      y: trueOriginalScale.y * visuals.scaleMultiplier,
      z: trueOriginalScale.z * visuals.scaleMultiplier,
      duration: visuals.flightDuration,
      ease: 'power3.out',
    });

    if (breathingTween) {
      breathingTween.kill();
    }
    breathingTween = gsap.to(finalMat, {
      opacity: visuals.opacity,
      duration: 0.95,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });

    finalStarInfo = {
      sprite,
      data,
      trueOriginalScale,
      trueOriginalMaterial,
      domainColor: '#' + trueOriginalMaterial.color.getHexString(),
      appliedStyle: {
        coreColor: '#f2fdff',
        opacity: visuals.opacity,
        blending: THREE.AdditiveBlending,
        scaleMultiplier: visuals.scaleMultiplier,
        glowColor: domainColor,
        glowSize: visuals.glowSize,
        breathingActive: true,
      },
    };

    return {
      domainColor,
      targetPos: sprite.position,
      targetId,
      visuals,
    };
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
      glowMaxSize: number;
      holdMs?: number;
      labelCount: number;
      finalAnchor?: THREE.Vector3 | null;
    },
  ) {
    const ids = chunkIds.slice(0, options.maxTargets);
    if (!ids.length) return;

    const positions = collectPositions(ids, ids.length);
    if (!positions.length) return;

    const sequenceToken = flightToken;
    ids.forEach((chunkId, index) => {
      const impactDelayMs = index * options.staggerMs + Math.round(METEOR_FLIGHT_DURATION * 1000) - 80;
      setTimeout(() => {
        if (sequenceToken !== flightToken) return;
        applyWaveImpact(chunkId, color, phase, {
          scale: options.scale,
          glowMaxSize: options.glowMaxSize,
          labelCount: options.labelCount,
          index,
          finalAnchor: options.finalAnchor,
        });
      }, impactDelayMs);
    });

    await shootMeteors(positions, color, options.staggerMs, 'animateSearch', phase);
    await sleep(options.holdMs ?? 220);
  }

  async function animateSearch(results: {
    bm25: Array<{ chunk_id: string }>;
    knn: Array<{ chunk_id: string }>;
    rrf_top5: Array<{ chunk_id: string }>;
    reranker_final: { chunk_id: string } | null;
  }) {
    cleanup();

    await sleep(120);

    const bm25Ids = results.bm25.map(r => r.chunk_id);
    const knnIds = results.knn.map(r => r.chunk_id);
    const rrfIds = results.rrf_top5.map(r => r.chunk_id);
    phaseTimeline = [
      { phase: 'bm25', label: 'BM25', count: bm25Ids.length },
      { phase: 'knn', label: 'kNN', count: knnIds.length },
      { phase: 'rrf', label: 'RRF', count: rrfIds.length },
      { phase: 'finalStar', label: 'FINAL', count: results.reranker_final ? 1 : 0 },
    ];
    applyPhaseFilter(currentPhaseFilter);
    const finalAnchor = results.reranker_final
      ? starDataMap.get(results.reranker_final.chunk_id)?.sprite.position.clone() ?? null
      : null;
    phaseFocusTargets = new Map([
      ['bm25', collectPositions(bm25Ids, 6)],
      ['knn', collectPositions(knnIds, 6)],
      ['rrf', collectPositions(rrfIds, 5)],
      ['finalStar', finalAnchor ? [finalAnchor.clone()] : []],
    ]);

    const framingPositions = [
      ...collectPositions(bm25Ids, 6),
      ...collectPositions(knnIds, 6),
      ...collectPositions(rrfIds, 5),
    ];

    await frameTargetCluster(framingPositions, 0.95);

    await playMeteorWave(bm25Ids, 0x6FD7FF, 'bm25', {
      maxTargets: 6,
      scale: 1.4,
      staggerMs: 70,
      glowMaxSize: 2.7,
      labelCount: 3,
      holdMs: 240,
      finalAnchor,
    });

    await playMeteorWave(knnIds, 0x4AA8FF, 'knn', {
      maxTargets: 6,
      scale: 1.4,
      staggerMs: 70,
      glowMaxSize: 2.7,
      labelCount: 3,
      holdMs: 240,
      finalAnchor,
    });

    await playMeteorWave(rrfIds, 0x23C9E6, 'rrf', {
      maxTargets: 5,
      scale: 1.6,
      staggerMs: 90,
      glowMaxSize: 3.2,
      labelCount: 4,
      holdMs: 280,
      finalAnchor,
    });

    if (results.reranker_final) {
      const finalId = results.reranker_final.chunk_id;
      const finalStar = starDataMap.get(finalId);

      if (!finalStar) {
        return;
      }

      highlightedSprites.forEach((original, sprite) => {
        if (sprite !== finalStar.sprite) {
          const distanceToFinal = sprite.position.distanceTo(finalStar.sprite.position);
          const nearFinal = distanceToFinal < FINAL_NEIGHBOR_RADIUS;
          const spriteChunkId = sprite.userData.chunk_id as string | undefined;

          if (nearFinal && spriteChunkId) {
            factory.disposeByTarget(`coreStar_${spriteChunkId}`);
          }

          gsap.to(sprite.material, { opacity: nearFinal ? 0.14 : 0.32, duration: 0.4 });
          gsap.to(sprite.scale, {
            x: original.originalScale.x * (nearFinal ? 1.06 : 1.28),
            y: original.originalScale.y * (nearFinal ? 1.06 : 1.28),
            z: original.originalScale.z * (nearFinal ? 1.06 : 1.28),
            duration: 0.4
          });
        }
      });

      const trueOrig = trueOriginals.get(finalStar.sprite) ?? {
        scale: finalStar.originalScale.clone(),
        material: finalStar.originalMaterial.clone(),
      };

      const trueOriginalScale = trueOrig.scale.clone();
      const trueOriginalMaterial = trueOrig.material;

      const promoted = applyFinalStarVisual(
        finalStar.sprite,
        finalStar.data,
        trueOriginalScale,
        trueOriginalMaterial,
        'animateSearch',
        'finalStar',
      );
      disposeFinalAnnotations();
      createFinalAnnotation(finalStar, promoted.domainColor);
      applyPhaseFilter(currentPhaseFilter);

    if (isVectorValid(promoted.targetPos)) {
      const finalMeteor = shootMeteors([promoted.targetPos], promoted.domainColor, 0, 'animateSearch', 'finalStar');
      await sleep(120);
      await Promise.all([
        finalMeteor,
          flyToStar(promoted.targetPos, promoted.visuals.flightDuration, 'animateSearch', 'finalStar', {
            cameraDistance: promoted.visuals.cameraDistance,
            arcLift: 5,
          }),
        ]);
      }
    }
  }

  /**
   * 閺勭喕绌敍姘＋閺堚偓缂佸牊妲﹂幁銏狀槻閸樼喐鐗遍敍灞炬煀閺勭喐妲︾紒褎澹欓張鈧紒鍫熸Е閺嶅嘲绱￠敍宀€娴夐張娲棧鏉╁洤骞?
   */
  async function jumpToStar(targetSprite: THREE.Sprite) {
    const targetOrig = targetSprite.userData.trueOriginals;
    if (!targetOrig) return;
    const targetOrigScale = targetOrig.scale.clone();
    const targetOrigMat = targetOrig.material;
    const targetData = targetSprite.userData as StarPoint;

    if (finalStarInfo?.sprite && finalStarInfo.sprite !== targetSprite) {
      resetFinalStar(true);
      disposeFinalAnnotations();
    }

    const promoted = applyFinalStarVisual(
      targetSprite,
      targetData,
      targetOrigScale,
      targetOrigMat,
      'jumpToStar',
      'finalStar',
    );
    createFinalAnnotation({
      sprite: targetSprite,
      data: targetData,
      originalScale: targetOrigScale,
    }, promoted.domainColor);
    applyPhaseFilter(currentPhaseFilter);

    if (!isVectorValid(promoted.targetPos)) return;

    const finalMeteor = shootMeteors([promoted.targetPos], promoted.domainColor, 0, 'jumpToStar', 'finalStar');
    await sleep(120);
    await Promise.all([
      finalMeteor,
      flyToStar(promoted.targetPos, promoted.visuals.flightDuration, 'jumpToStar', 'finalStar', {
        cameraDistance: promoted.visuals.cameraDistance,
        arcLift: 5,
      }),
    ]);
  }

  function resetFinalStar(preserveQueryArtifacts: boolean = false) {
    if (!finalStarInfo) return;
    const { sprite, trueOriginalScale, trueOriginalMaterial } = finalStarInfo;

    const oldMat = sprite.material as THREE.SpriteMaterial;

    gsap.killTweensOf(oldMat);
    gsap.killTweensOf(oldMat.color);
    gsap.killTweensOf(sprite.scale);
    gsap.killTweensOf(sprite);

    sprite.scale.set(trueOriginalScale.x, trueOriginalScale.y, trueOriginalScale.z);

    if (preserveQueryArtifacts) {
      finalStarGlowSprites.forEach(glow => {
        scene.remove(glow);
        const mat = glow.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
      finalStarGlowSprites = [];
    } else {
      clearAllGlows();
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
    }

    sprite.material = trueOriginalMaterial;
    trueOriginalMaterial.opacity = trueOriginalMaterial.opacity;
    trueOriginalMaterial.needsUpdate = true;

    if (oldMat !== trueOriginalMaterial) {
      oldMat.dispose();
    }

    finalStarInfo = null;

    console.log('[reset] final star restored');
  }

  // ===== 鐠囧嫪鍙婇崶鐐存杹閼辨柨濮?=====
  let evalHighlightedSprites = new Map<THREE.Sprite, {
    originalMaterial: THREE.SpriteMaterial;
    originalScale: THREE.Vector3;
  }>();

  /** 鐠囧嫪鍙婃妯瑰瘨閿涙矮绱堕崗?UUID chunk_id 閸掓銆冮敍灞惧瘻閹烘帒鎮曢惈鈧懝?*/
  function evalHighlight(chunkIds: string[], color: number, scale: number = 2) {
    // 閸忓牊绔婚悶鍡曠閸撳秶娈戞妯瑰瘨
    clearEvalHighlight();

    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return; // 闂堟瑩绮捄瀹犵箖閿涘牐鐦庢导鐧怐閸欘垵鍏樻稉宥呮躬濞撳弶鐓嬮惃鍕Е閻愰€涜厬閿?

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

      // 妫板棗鐓欓懝鎻掑帨閺呮洝銆冪粈鐑橆劀绾喖褰崶?
      setTimeout(() => {
        createGlow(sprite.position, color, sprite.scale.x * 2, targetId, 'evalHighlight', 'eval');
      }, 300);
    });
  }

  /** 濞撳懘娅庣拠鍕強妤傛ü瀵掗敍灞句划婢跺秴甯弽?*/
  function clearEvalHighlight() {
    evalHighlightedSprites.forEach((original, sprite) => {
      gsap.killTweensOf(sprite.scale);
      gsap.killTweensOf(sprite.material);

      // 閹垹顦查崢鐔奉潗閺夋劘宸濋崪宀€缂夐弨?
      sprite.material = original.originalMaterial;
      sprite.scale.copy(original.originalScale);

      // 閸︾儤娅欑痪褎绔婚幍顐ヮ嚉 sprite 閻ㄥ嫭澧嶉張澶婂帨閺?
      scene.children.forEach(child => {
        if (child instanceof THREE.Sprite && child !== sprite) {
          const maxDim = Math.max(child.scale.x, child.scale.y);
          if (maxDim > 5 && maxDim < 50) { // 閸忓妾块懠鍐ㄦ纯
            const childPos = child.position;
            const spritePos = sprite.position;
            if (childPos.distanceTo(spritePos) < 3) { // 鐠烘繄顬囨潻鎴犳畱鐟欏棔璐熼崗澶嬫
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
    getPhaseTimeline,
    setPhaseFilter,
    focusPhase,
    getPhaseFilter: () => currentPhaseFilter,
  };
}
