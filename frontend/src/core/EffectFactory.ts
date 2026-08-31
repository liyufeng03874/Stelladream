/**
 * EffectFactory �?对象创建/清理中心
 * 
 * 所有辉光、流星等视觉对象的统一入口�?
 * 创建时自动注�?EffectRegistry，销毁时自动同步状态�?
 */

import * as THREE from 'three';
import { gsap } from 'gsap';
import { EffectRegistry } from './EffectRegistry';

export interface ManagedEffect {
  id: string;            // EffectRegistry 中注册的 ID
  targetId: string;      // 所属目标标�?
  type: string;          // 'glow' | 'meteor' | 'trail'
  phase: string;
  threeObjects: THREE.Object3D[];
  status: 'active' | 'disposed';
}

export interface EffectFactoryContext {
  registry: EffectRegistry;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

export interface AnnotationLabelOptions {
  badge: string;
  title: string;
  subtitle: string;
  accentColor: number;
  opacity?: number;
  rise?: number;
  scale?: { width: number; height: number };
  interaction?: {
    starData: unknown;
    chunkId: string;
    kind?: string;
  };
}

/** 创建辉光纹理的共享函�?*/
function createGlowTexture(color: number, size: number = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  const hexColor = new THREE.Color(color);
  gradient.addColorStop(0, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.8)`);
  gradient.addColorStop(0.4, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.3)`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** 创建流星头部纹理 */
function createMeteorStreakTexture(color: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const hexColor = new THREE.Color(color);
  const rgb = `${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)}`;
  const streak = ctx.createLinearGradient(0, 16, 128, 16);
  streak.addColorStop(0, 'rgba(0,0,0,0)');
  streak.addColorStop(0.2, `rgba(${rgb},0.02)`);
  streak.addColorStop(0.55, `rgba(${rgb},0.16)`);
  streak.addColorStop(0.82, `rgba(${rgb},0.62)`);
  streak.addColorStop(0.94, `rgba(${rgb},0.95)`);
  streak.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = streak;
  ctx.beginPath();
  ctx.moveTo(4, 16);
  ctx.quadraticCurveTo(18, 3, 122, 11);
  ctx.lineTo(126, 16);
  ctx.lineTo(122, 21);
  ctx.quadraticCurveTo(18, 29, 4, 16);
  ctx.closePath();
  ctx.fill();

  const headGlow = ctx.createRadialGradient(112, 16, 1, 112, 16, 14);
  headGlow.addColorStop(0, 'rgba(255,255,255,1)');
  headGlow.addColorStop(0.25, `rgba(${rgb},0.95)`);
  headGlow.addColorStop(0.7, `rgba(${rgb},0.18)`);
  headGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = headGlow;
  ctx.fillRect(92, 2, 34, 28);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function createAnnotationTexture(options: AnnotationLabelOptions): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;

  const ctx = canvas.getContext('2d')!;
  const accent = new THREE.Color(options.accentColor);
  const accentRgb = `${Math.round(accent.r * 255)},${Math.round(accent.g * 255)},${Math.round(accent.b * 255)}`;
  const bubbleX = 24;
  const bubbleY = 20;
  const bubbleW = 464;
  const bubbleH = 184;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.shadowColor = `rgba(${accentRgb},0.28)`;
  ctx.shadowBlur = 20;
  ctx.fillStyle = 'rgba(5, 10, 18, 0.88)';
  roundRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 28);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(${accentRgb},0.9)`;
  ctx.lineWidth = 3;
  roundRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, 28);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(228, 204);
  ctx.lineTo(256, 238);
  ctx.lineTo(284, 204);
  ctx.closePath();
  ctx.fillStyle = 'rgba(5, 10, 18, 0.88)';
  ctx.fill();
  ctx.strokeStyle = `rgba(${accentRgb},0.75)`;
  ctx.stroke();

  const badgeText = options.badge.toUpperCase();
  ctx.font = '600 22px Inter, Arial, sans-serif';
  const badgeW = Math.max(120, ctx.measureText(badgeText).width + 28);
  ctx.fillStyle = `rgba(${accentRgb},0.16)`;
  roundRect(ctx, 46, 40, badgeW, 36, 18);
  ctx.fill();
  ctx.strokeStyle = `rgba(${accentRgb},0.45)`;
  ctx.lineWidth = 2;
  roundRect(ctx, 46, 40, badgeW, 36, 18);
  ctx.stroke();

  ctx.fillStyle = `rgba(${accentRgb},1)`;
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, 60, 58);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = '600 32px Inter, Arial, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(options.title, 46, 126);

  ctx.fillStyle = 'rgba(191, 219, 254, 0.9)';
  ctx.font = '24px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.fillText(options.subtitle, 46, 168);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

let _glowSeq = 0;
function genGlowId(): string { return `glow_${++_glowSeq}`; }
let _meteorSeq = 0;
function genMeteorId(): string { return `meteor_${++_meteorSeq}`; }
let _annotationSeq = 0;
function genAnnotationId(): string { return `annotation_${++_annotationSeq}`; }

export class EffectFactory {
  private registry: EffectRegistry;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private managed: Map<string, ManagedEffect> = new Map();

  constructor(ctx: EffectFactoryContext) {
    this.registry = ctx.registry;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
  }

  /** 创建辉光（自动注�?registry + 关联对象映射�?*/
  createGlow(
    position: THREE.Vector3,
    color: number,
    size: number,
    targetId: string,
    source: string,
    phase: string,
    textureSize: number = 64,
  ): ManagedEffect {
    const texture = createGlowTexture(color, textureSize);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(material);
    glow.position.copy(position);
    glow.scale.set(size, size, 1);
    this.scene.add(glow);

    const managedId = genGlowId();

    // 注册�?registry
    this.registry.add({
      targetId,
      effectType: 'glow',
      property: 'size',
      prevValue: null,
      value: size,
      source,
      phase,
    });
    this.registry.add({
      targetId,
      effectType: 'glow',
      property: 'color',
      prevValue: null,
      value: '#' + new THREE.Color(color).getHexString(),
      source,
      phase,
    });
    this.registry.add({
      targetId,
      effectType: 'glow',
      property: 'position',
      prevValue: null,
      value: { x: position.x, y: position.y, z: position.z },
      source,
      phase,
    });

    // 关联对象
    this.registry.registerObject(managedId, glow);

    const effect: ManagedEffect = {
      id: managedId,
      targetId,
      type: 'glow',
      phase,
      threeObjects: [glow],
      status: 'active',
    };
    this.managed.set(managedId, effect);
    return effect;
  }

  /** 创建流星（自动注册，动画结束后自�?dispose�?*/
  createMeteor(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    targetId: string,
    source: string,
    phase: string,
    delayMs: number = 0,
    flightDuration: number = 0.8,
  ): Promise<ManagedEffect> {
    const segments = 40;
    const curvePoints: THREE.Vector3[] = [];
    const arcHeight = THREE.MathUtils.clamp(from.distanceTo(to) * 0.08, 2.5, 8);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * arcHeight;
      curvePoints.push(new THREE.Vector3(x, y, z));
    }

    const curve = new THREE.CatmullRomCurve3(curvePoints);
    const streakTexture = createMeteorStreakTexture(color);
    const headMat = new THREE.SpriteMaterial({
      map: streakTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    const head = new THREE.Sprite(headMat);
    head.scale.set(3.4, 0.7, 1);
    head.position.copy(from);
    this.scene.add(head);

    const tailCount = 5;
    const tailSprites: THREE.Sprite[] = [];
    for (let i = 0; i < tailCount; i++) {
      const tailMat = new THREE.SpriteMaterial({
        map: streakTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      });
      const tail = new THREE.Sprite(tailMat);
      const width = 2.8 - i * 0.35;
      const height = 0.5 - i * 0.05;
      tail.scale.set(width, height, 1);
      tail.position.copy(from);
      this.scene.add(tail);
      tailSprites.push(tail);
    }

    const managedId = genMeteorId();

    this.registry.add({
      targetId,
      effectType: 'meteor',
      property: 'position',
      prevValue: null,
      value: { from: { x: from.x, y: from.y, z: from.z }, to: { x: to.x, y: to.y, z: to.z } },
      source,
      phase,
    });
    this.registry.add({
      targetId,
      effectType: 'meteor',
      property: 'color',
      prevValue: null,
      value: '#' + new THREE.Color(color).getHexString(),
      source,
      phase,
    });

    this.registry.registerObject(managedId, { head, tailSprites });

    const effect: ManagedEffect = {
      id: managedId,
      targetId,
      type: 'meteor',
      phase,
      threeObjects: [head, ...tailSprites],
      status: 'active',
    };
    this.managed.set(managedId, effect);

    return new Promise<ManagedEffect>(resolve => {
      setTimeout(() => {
        if (effect.status !== 'active') {
          resolve(effect);
          return;
        }

        const startTimeMs = Date.now();

        const update = () => {
          if (effect.status !== 'active') {
            resolve(effect);
            return;
          }

          const t = Math.min((Date.now() - startTimeMs) / (flightDuration * 1000), 1);
          const headPos = curve.getPoint(t);
          if (this._isVectorValid(headPos)) {
            head.position.copy(headPos);
            head.material.opacity = 1;
          }

          const tangentStart = curve.getPoint(Math.max(0, t - 0.015));
          const tangentEnd = curve.getPoint(Math.min(1, t + 0.015));
          const rotation = this._getProjectedRotation(tangentStart, tangentEnd);
          head.material.rotation = rotation;

          tailSprites.forEach((tail, index) => {
            const trailT = Math.max(0, t - (index + 1) * 0.038);
            const visible = trailT > 0 && t < 1.02;
            if (!visible) {
              tail.material.opacity = 0;
              return;
            }

            tail.position.copy(curve.getPoint(trailT));
            tail.material.rotation = rotation;
            tail.material.opacity = Math.max(0, 0.42 - index * 0.08) * Math.min(1, t * 3.2);
          });

          if (t >= 1) {
            gsap.to(head.material, { opacity: 0, duration: 0.2 });
            tailSprites.forEach((tail, index) => {
              gsap.to(tail.material, { opacity: 0, duration: 0.18 + index * 0.03 });
            });

            setTimeout(() => {
              if (effect.status !== 'active') {
                resolve(effect);
                return;
              }

              this._disposeMeteorObjects(head, tailSprites);
              effect.status = 'disposed';
              this.registry.markDisposed(targetId);
              this.managed.delete(managedId);
              resolve(effect);
            }, 400);
            return;
          }

          requestAnimationFrame(update);
        };

        update();
      }, delayMs);
    });
  }
  /** 销毁单�?ManagedEffect */
  createAnnotationLabel(
    position: THREE.Vector3,
    options: AnnotationLabelOptions,
    targetId: string,
    source: string,
    phase: string,
  ): ManagedEffect {
    const texture = createAnnotationTexture(options);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    const width = options.scale?.width ?? 3.2;
    const height = options.scale?.height ?? 1.53;
    const rise = options.rise ?? 0.18;
    const maxOpacity = options.opacity ?? 0.96;
    const initialScale = 0.78;
    const baseDistance = Math.max(this.camera.position.distanceTo(position), 1);

    sprite.position.copy(position).add(new THREE.Vector3(0, -rise, 0));
    sprite.scale.set(width * initialScale, height * initialScale, 1);
    sprite.renderOrder = 40;
    sprite.userData = {
      ...sprite.userData,
      interactiveType: options.interaction?.kind ?? 'annotation',
      interactiveChunkId: options.interaction?.chunkId,
      interactiveStar: options.interaction?.starData,
    };
    this.scene.add(sprite);

    const managedId = genAnnotationId();
    this.registry.add({
      targetId,
      effectType: 'annotation',
      property: 'content',
      prevValue: null,
      value: {
        badge: options.badge,
        title: options.title,
        subtitle: options.subtitle,
      },
      source,
      phase,
    });
    this.registry.add({
      targetId,
      effectType: 'annotation',
      property: 'position',
      prevValue: null,
      value: { x: position.x, y: position.y, z: position.z },
      source,
      phase,
    });

    this.registry.registerObject(managedId, sprite);

    const effect: ManagedEffect = {
      id: managedId,
      targetId,
      type: 'annotation',
      phase,
      threeObjects: [sprite],
      status: 'active',
    };
    this.managed.set(managedId, effect);

    gsap.to(sprite.position, {
      y: position.y,
      duration: 0.35,
      ease: 'power2.out',
    });
    gsap.to(sprite.scale, {
      x: width,
      y: height,
      duration: 0.35,
      ease: 'back.out(1.3)',
    });
    gsap.to(material, {
      opacity: maxOpacity,
      duration: 0.28,
      ease: 'power2.out',
    });

    const updateScale = () => {
      if (effect.status !== 'active') return;
      const currentDistance = Math.max(this.camera.position.distanceTo(sprite.position), 1);
      const factor = THREE.MathUtils.clamp(currentDistance / baseDistance, 0.42, 1);
      sprite.scale.set(width * factor, height * factor, 1);
      requestAnimationFrame(updateScale);
    };

    window.setTimeout(() => {
      if (effect.status === 'active') {
        updateScale();
      }
    }, 380);

    return effect;
  }

  dispose(id: string): void {
    const effect = this.managed.get(id);
    if (!effect || effect.status === 'disposed') return;

    effect.threeObjects.forEach(obj => {
      this.scene.remove(obj);
      this._disposeObject(obj);
    });

    effect.status = 'disposed';
    this.registry.markDisposed(effect.targetId);
    this.registry.unregisterObject(id);
    this.managed.delete(id);
  }

  disposeAll(): void {
    Array.from(this.managed.keys()).forEach(id => this.dispose(id));
  }

  disposeByType(type: string): void {
    Array.from(this.managed.entries())
      .filter(([, effect]) => effect.type === type && effect.status === 'active')
      .forEach(([id]) => this.dispose(id));
  }

  /** �?targetId 批量清理 */
  disposeByTarget(targetId: string): void {
    const toDispose: string[] = [];
    this.managed.forEach((effect, id) => {
      if (effect.targetId === targetId && effect.status === 'active') {
        toDispose.push(id);
      }
    });
    toDispose.forEach(id => this.dispose(id));
  }

  /** �?phase 批量清理 */
  disposeByPhase(phase: string): void {
    const toDispose: string[] = [];
    this.managed.forEach((effect, id) => {
      if (effect.phase === phase && effect.status === 'active') {
        toDispose.push(id);
      }
    });
    toDispose.forEach(id => this.dispose(id));
  }

  setPhaseVisibility(phase: string, visible: boolean): void {
    this.managed.forEach(effect => {
      if (effect.phase !== phase || effect.status !== 'active') return;
      effect.threeObjects.forEach(obj => {
        obj.visible = visible;
      });
    });
  }

  /** 场景级兜底：移除所有大尺寸 sprite（光晕残留） */
  sweepOrphanGlows(minSize: number = 10): void {
    const toRemove: THREE.Object3D[] = [];
    this.scene.children.forEach(child => {
      if (child instanceof THREE.Sprite) {
        const maxDim = Math.max(child.scale.x, child.scale.y);
        if (maxDim > minSize) {
          toRemove.push(child);
        }
      }
    });
    toRemove.forEach(obj => {
      this.scene.remove(obj);
      this._disposeObject(obj);
    });
  }

  /** 获取所有活跃对�?*/
  getActive(): ManagedEffect[] {
    return Array.from(this.managed.values()).filter(e => e.status === 'active');
  }

  /** 获取活跃数量 */
  getActiveCount(): number {
    return this.getActive().length;
  }

  // ===== 内部方法 =====

  private _isVectorValid(v: THREE.Vector3): boolean {
    return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  }

  private _getProjectedRotation(from: THREE.Vector3, to: THREE.Vector3): number {
    const a = from.clone().project(this.camera);
    const b = to.clone().project(this.camera);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private _disposeObject(obj: THREE.Object3D): void {
    if (obj instanceof THREE.Sprite) {
      if (obj.material) {
        const mat = obj.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    } else if (obj instanceof THREE.Line) {
      if (obj.material && !Array.isArray(obj.material)) obj.material.dispose();
      if (obj.geometry) obj.geometry.dispose();
    }
  }

  private _disposeMeteorObjects(head: THREE.Sprite, tailSprites: THREE.Sprite[]): void {
    head.material.dispose();
    if (head.material instanceof THREE.SpriteMaterial && head.material.map) {
      head.material.map.dispose();
    }
    this.scene.remove(head);

    tailSprites.forEach(tail => {
      tail.material.dispose();
      this.scene.remove(tail);
    });
  }
}
