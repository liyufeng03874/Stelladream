/**
 * EffectFactory — 对象创建/清理中心
 * 
 * 所有辉光、流星等视觉对象的统一入口。
 * 创建时自动注册 EffectRegistry，销毁时自动同步状态。
 */

import * as THREE from 'three';
import { gsap } from 'gsap';
import { EffectRegistry } from './EffectRegistry';

export interface ManagedEffect {
  id: string;            // EffectRegistry 中注册的 ID
  targetId: string;      // 所属目标标识
  type: string;          // 'glow' | 'meteor' | 'trail'
  threeObjects: THREE.Object3D[];
  status: 'active' | 'disposed';
}

export interface EffectFactoryContext {
  registry: EffectRegistry;
  scene: THREE.Scene;
}

/** 创建辉光纹理的共享函数 */
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
function createMeteorHeadTexture(color: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  const hexColor = new THREE.Color(color);
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, `rgba(${Math.round(hexColor.r * 255)},${Math.round(hexColor.g * 255)},${Math.round(hexColor.b * 255)},0.6)`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

let _glowSeq = 0;
function genGlowId(): string { return `glow_${++_glowSeq}`; }
let _meteorSeq = 0;
function genMeteorId(): string { return `meteor_${++_meteorSeq}`; }

export class EffectFactory {
  private registry: EffectRegistry;
  private scene: THREE.Scene;
  private managed: Map<string, ManagedEffect> = new Map();
  private tweenDisposers: Map<string, () => void> = new Map();

  constructor(ctx: EffectFactoryContext) {
    this.registry = ctx.registry;
    this.scene = ctx.scene;
  }

  /** 创建辉光（自动注册 registry + 关联对象映射） */
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

    // 注册到 registry
    const regId = this.registry.add({
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
      threeObjects: [glow],
      status: 'active',
    };
    this.managed.set(managedId, effect);
    return effect;
  }

  /** 创建流星（自动注册，动画结束后自动 dispose） */
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
    const hexColor = new THREE.Color(color);

    // 生成曲线点
    const segments = 40;
    const curvePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 3;
      curvePoints.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(curvePoints);

    // 创建流星头部
    const headTexture = createMeteorHeadTexture(color);
    const headMat = new THREE.SpriteMaterial({
      map: headTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    const head = new THREE.Sprite(headMat);
    head.scale.set(0.6, 0.6, 1);
    head.position.copy(from);
    this.scene.add(head);

    // 创建流星尾迹
    const trailMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const trailGeo = new THREE.BufferGeometry();
    const trail = new THREE.Line(trailGeo, trailMat);
    this.scene.add(trail);

    const managedId = genMeteorId();

    // 注册
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

    // 关联对象（注意：流星结束后会被销毁）
    this.registry.registerObject(managedId, { head, trail });

    const effect: ManagedEffect = {
      id: managedId,
      targetId,
      type: 'meteor',
      threeObjects: [head, trail],
      status: 'active',
    };
    this.managed.set(managedId, effect);

    // 执行动画
    return new Promise<ManagedEffect>(resolve => {
      setTimeout(() => {
        const startTimeMs = Date.now();

        const update = () => {
          const t = Math.min((Date.now() - startTimeMs) / (flightDuration * 1000), 1);

          const headPos = curve.getPoint(t);
          if (this._isVectorValid(headPos)) {
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
              // 自动 dispose
              this._disposeMeteorObjects(head, trail);
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

  /** 销毁单个 ManagedEffect */
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

  /** 按 targetId 批量清理 */
  disposeByTarget(targetId: string): void {
    const toDispose: string[] = [];
    this.managed.forEach((effect, id) => {
      if (effect.targetId === targetId && effect.status === 'active') {
        toDispose.push(id);
      }
    });
    toDispose.forEach(id => this.dispose(id));
  }

  /** 按 phase 批量清理 */
  disposeByPhase(phase: string): void {
    const toDispose: string[] = [];
    this.managed.forEach((effect, id) => {
      const entries = this.registry.getHistory(effect.targetId);
      const hasPhase = entries.some(e => e.phase === phase);
      if (hasPhase && effect.status === 'active') {
        toDispose.push(id);
      }
    });
    toDispose.forEach(id => this.dispose(id));
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

  /** 获取所有活跃对象 */
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

  private _disposeObject(obj: THREE.Object3D): void {
    if (obj instanceof THREE.Sprite) {
      if (obj.material) {
        const mat = obj.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    } else if (obj instanceof THREE.Line) {
      if (obj.material) (obj.material as THREE.Material).dispose();
      if (obj.geometry) obj.geometry.dispose();
    }
  }

  private _disposeMeteorObjects(head: THREE.Sprite, trail: THREE.Line): void {
    head.material.dispose();
    if (head.material instanceof THREE.SpriteMaterial && head.material.map) {
      head.material.map.dispose();
    }
    this.scene.remove(head);

    trail.material.dispose();
    trail.geometry.dispose();
    this.scene.remove(trail);
  }
}
