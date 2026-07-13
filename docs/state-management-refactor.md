# 3D星图状态管理重构方案

## 目标
把散落在各处的视觉属性变更统一注册、统一管理，做到：
- 每一步改了什么、为谁改的、谁发起的，代码里一目了然
- 创建和清理生命周期可追踪
- 降低调试成本，减少肉眼比对和试错

## 架构总览

```
EffectRegistry    ← 变更注册中心，记录所有属性变更历史
EffectFactory     ← 对象创建/清理中心，自动注册、自动销毁
useSearchAnimation ← 改造现有动画逻辑，所有变更走注册入口
StarField.vue     ← 基本不动（只负责星点初始化渲染）
```

---

## 一、EffectRegistry 设计

### 1.1 数据结构

```typescript
// 变更状态
type EffectStatus = 'applied' | 'overridden' | 'restored' | 'disposed';

// 属性变更条目
interface EffectEntry {
  id: string;                    // 唯一ID
  targetId: string;              // 目标对象标识，如 'coreStar_chunk123', 'glow_white_1'
  effectType: string;            // 'glow' | 'meteor' | 'scale' | 'material' | 'opacity' | 'camera'
  property: string;              // 'size' | 'color' | 'scale' | 'opacity' | 'blending' | 'position'
  prevValue: any;                // 变更前的值
  value: any;                    // 变更后的值
  source: string;                // 发起函数，如 'jumpToStar', 'animateSearch', 'highlightAndGrow'
  phase: string;                 // 阶段，如 'init' | 'search' | 'flyToStar' | 'jumpToStar' | 'reset'
  timestamp: number;             // 变更时间戳
  status: EffectStatus;          // 当前状态
  chainId?: string;              // 同一属性的覆盖链ID（可选，用于关联历史）
}

// 注册表
class EffectRegistry {
  private entries: Map<string, EffectEntry[]>;  // targetId → 变更历史数组
  
  add(entry: Omit<EffectEntry, 'id' | 'timestamp' | 'status'>): string;
  getHistory(targetId: string): EffectEntry[];
  getLatest(targetId: string, property: string): EffectEntry | null;
  getOverrideChain(targetId: string, property: string): EffectEntry[];
  markOverridden(chainId: string): void;
  markRestored(targetId: string): void;
  export(): Record<string, EffectEntry[]>;  // 调试用，导出完整记录
}
```

### 1.2 使用方式

```typescript
const registry = new EffectRegistry();

// 示例：创建一个辉光
const glowId = registry.add({
  targetId: 'glow_white_core_1',
  effectType: 'glow',
  property: 'size',
  prevValue: null,
  value: 5,
  source: 'jumpToStar',
  phase: 'jumpToStar',
});

// 示例：修改材质颜色（覆盖前一条记录）
registry.add({
  targetId: 'coreStar_chunk123',
  effectType: 'material',
  property: 'color',
  prevValue: '#60A5FA',
  value: '#FFFFFF',
  source: 'jumpToStar',
  phase: 'jumpToStar',
  chainId: prevEntry.chainId || prevEntry.id,  // 关联覆盖链
});
```

### 1.3 核心能力

| 能力 | 说明 |
|---|---|
| 历史记录 | `getHistory()` 返回某个目标的所有变更 |
| 覆盖链 | `getOverrideChain()` 返回同一属性的变更链条 |
| 状态追踪 | `markOverridden()` / `markRestored()` 标记条目状态 |
| 差异比对 | 两个 targetId 的 `getHistory()` 一对比，差异一目了然 |

---

## 二、EffectFactory 设计

### 2.1 数据结构

```typescript
interface ManagedEffect {
  id: string;                    // 与 registry 关联的 ID
  type: string;                  // 'glow' | 'meteor' | 'trail' | 'particle'
  targetId: string;              // 所属目标
  threeObject: THREE.Object3D;   // Three.js 对象引用
  status: 'active' | 'disposed';
}

class EffectFactory {
  private registry: EffectRegistry;
  private scene: THREE.Scene;
  private managed: Map<string, ManagedEffect>;
  
  // 创建辉光（自动注册）
  createGlow(position: THREE.Vector3, color: number, size: number, 
             targetId: string, source: string, phase: string): ManagedEffect;
  
  // 创建流星（自动注册）
  createMeteor(from: THREE.Vector3, to: THREE.Vector3, color: number,
               targetId: string, source: string, phase: string, 
               delayMs?: number): ManagedEffect;
  
  // 销毁单个
  dispose(id: string): void;
  
  // 批量清理
  disposeByTarget(targetId: string): void;
  disposeByPhase(phase: string): void;
  disposeBySource(source: string): void;
  
  // 获取活跃对象
  getActive(): ManagedEffect[];
}
```

### 2.2 关键行为

| 行为 | 说明 |
|---|---|
| 创建时自动注册 | `createGlow` 内部调用 `registry.add()` |
| 销毁时自动更新状态 | `dispose()` 同步 registry 状态为 'disposed' |
| 批量清理 | 按 target/phase/source 批量清理，不遗漏 |
| 场景级兜底 | 可选：清理时扫描 scene.children，移除孤儿对象 |

---

## 三、useSearchAnimation.ts 改造计划

### 3.1 改造范围

不改造的：`isVectorValid()`, `getMeteorOrigin()`, `getEmissionPoint()` — 纯工具函数

需要改造的（按优先级）：

| 函数 | 当前问题 | 改造内容 |
|---|---|---|
| `createGlow` | 直接 scene.add，没有注册 | 改为 EffectFactory.createGlow |
| `createMeteor` | 直接创建/销毁 Three.js 对象 | 改为 EffectFactory.createMeteor |
| `highlightAndGrow` | 直接改 material/scale，散落各处 | 通过 registry 记录每个属性变更 |
| `clearAllGlows` | 手动遍历 + 场景级兜底 | 改为 EffectFactory.disposeByPhase/Target |
| `cleanup` | 手动恢复材质/scale | 通过 registry 历史记录恢复 |
| `flyToStar` | 相机变更无记录 | 通过 registry 记录 camera 变更 |
| `animateSearch` | 多阶段变更混合，无统一入口 | 协调 registry + factory |
| `jumpToStar` | 情况1/2 逻辑分散，辉光创建不统一 | 统一走 EffectFactory |
| `resetFinalStar` | 手动恢复 + 场景级兜底 | 通过 registry 恢复历史记录 |

### 3.2 逐函数改造方案

#### `createGlow` → 整合进 EffectFactory.createGlow

**改造前：**
```typescript
function createGlow(position, color, size): THREE.Sprite {
  // ...创建 canvas、texture、material...
  scene.add(glow);
  glowSprites.push(glow);
  return glow;
}
```

**改造后：**
```typescript
// 在 EffectFactory 中
factory.createGlow(position, color, size, targetId, source, phase);
// 返回 ManagedEffect，内部自动 scene.add + registry.add
```

**变更属性记录：**
- `effectType: 'glow'`, `property: 'size'`, `value: 5/30`
- `effectType: 'glow'`, `property: 'color'`, `value: 0xFFFFFF/0x34D399`
- `effectType: 'glow'`, `property: 'position'`, `value: position`

#### `createMeteor` → 整合进 EffectFactory.createMeteor

**改造前：**
```typescript
function createMeteor(from, to, color, delayMs): Promise<void> {
  // 创建 head + trail → scene.add → 动画结束手动 dispose
}
```

**改造后：**
```typescript
factory.createMeteor(from, to, color, targetId, source, phase, delayMs);
// 返回 Promise<ManagedEffect>，内部自动创建、动画结束后自动 dispose + registry 更新状态
```

#### `highlightAndGrow` → 属性变更走 registry

**改造前：**
```typescript
newMaterial.color.setHex(color);
newMaterial.opacity = 1;
newMaterial.blending = THREE.AdditiveBlending;
sprite.material = newMaterial;
gsap.to(sprite.scale, { x: ..., y: ..., z: ... });
```

**改造后：**
```typescript
// 记录材质变更
registry.add({ targetId, effectType: 'material', property: 'color', prevValue: oldColor, value: newColor, source, phase });
registry.add({ targetId, effectType: 'material', property: 'opacity', prevValue: oldOpacity, value: 1, source, phase });
registry.add({ targetId, effectType: 'material', property: 'blending', prevValue: oldBlending, value: THREE.AdditiveBlending, source, phase });

// 记录 scale 变更（起始值 + 目标值）
registry.add({ targetId, effectType: 'scale', property: 'scale', prevValue: originalScale, value: originalScale * scale, source, phase });

// 实际变更
sprite.material = newMaterial;
gsap.to(sprite.scale, { ... });
```

#### `cleanup` / `resetFinalStar` → 通过 registry 恢复

**改造前：**
```typescript
highlightedSprites.forEach((original, sprite) => {
  sprite.material = original.originalMaterial;
  sprite.scale.copy(original.originalScale);
});
```

**改造后：**
```typescript
registry.getHistory(targetId).reverse().forEach(entry => {
  // 按变更历史反向恢复
  if (entry.property === 'material') sprite.material = entry.prevValue;
  if (entry.property === 'scale') sprite.scale.copy(entry.prevValue);
});
factory.disposeByTarget(targetId);
```

### 3.3 改造顺序

1. **新建 `EffectRegistry.ts`** — 纯逻辑，无副作用
2. **新建 `EffectFactory.ts`** — 整合 `createGlow` 和 `createMeteor`
3. **替换 `createGlow` 调用点** — `highlightAndGrow`、`jumpToStar` 中的 createGlow 改为 factory 调用
4. **替换 `createMeteor` 调用点** — `shootMeteors` 改为 factory 调用
5. **改造 `highlightAndGrow`** — 属性变更走 registry
6. **改造 `jumpToStar`** — 统一走 factory + registry
7. **改造 `cleanup` / `resetFinalStar`** — 通过 registry 恢复
8. **改造 `animateSearch`** — 协调全局流程
9. **清理旧代码** — 删除 `glowSprites`、`highlightedSprites`、`finalStarGlowSprites` 等散落数组

---

## 四、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 破坏现有动画效果 | 中 | 高 | 逐函数替换，每个改完本地验证；git 分支开发，随时可回滚 |
| 注册遗漏 | 低 | 中 | 代码 review 逐个排查；导出 registry 日志比对 |
| gsap tween 冲突 | 中 | 中 | 改造期间 kill 旧 tween 再注册新变更 |
| 性能开销 | 低 | 低 | registry 只在关键帧触发，不在每帧记录 |
| EffectFactory 与 scene.children 不一致 | 低 | 中 | dispose 时自动同步；可选场景级兜底扫描 |

---

## 五、验证方式

1. **注册表导出**：改完后在控制台 `registry.export()`，输出完整变更历史
2. **两颗星比对**：query 搜索的最终星 vs jumpToStar 的目标星，导出各自的 registry 历史，逐条比对
3. **效果验证**：运行项目，确认视觉效果和改造前一致
4. **清理验证**：多次搜索 + 星跃，确认无光晕残留

---

## 六、工作量估算

| 步骤 | 预估时间 |
|---|---|
| EffectRegistry.ts | 2-3h |
| EffectFactory.ts | 2-3h |
| 替换 createGlow / createMeteor | 1-2h |
| 改造 highlightAndGrow | 2-3h |
| 改造 jumpToStar | 2-3h |
| 改造 cleanup / resetFinalStar | 1-2h |
| 改造 animateSearch | 1-2h |
| 测试验证 | 2-3h |
| **总计** | **约 13-21h** |

考虑到代码量有限（核心文件 650 行），实际可能更短。但保守估计是 **1-2 个工作日**。
