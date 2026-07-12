# 星星的完整变化历程

> 以"最终星"（reranker_final 命中的那颗）为主线，从创建到搜索动画，再到重置恢复。

---

## 一、数据结构总览

### StarField.vue 维护的核心数据

| 数据结构 | 作用 |
|---|---|
| `starDataMap` | `chunk_id → { sprite, data, originalMaterial, originalScale }` |
| `starSprites` | 所有 sprite 的数组 |
| `textureCache` | `color → CanvasTexture` 缓存，同域颜色共享纹理 |

### useSearchAnimation.ts 维护的核心数据

| 数据结构 | 作用 |
|---|---|
| `trueOriginals` | `sprite → { scale, material }` 真正原始值（在 highlightAndGrow 之前保存） |
| `highlightedSprites` | `sprite → { originalScale, originalMaterial }` highlightAndGrow 时记录的"修改前快照" |
| `glowSprites` | 搜索阶段的光晕数组 |
| `finalStarGlowSprites` | 最终星的光晕数组 |
| `finalStarInfo` | 最终星的完整信息：sprite、trueOriginalScale、trueOriginalMaterial、domainColor、appliedStyle |

---

## 二、阶段详解

### 阶段 0：渲染初始化（StarField.vue → `renderStars`）

**触发时机**：数据加载完成，组件挂载时

**流程**：
1. 遍历 `props.stars`，每颗星：
   - 根据 `star.domain` 查 `config.domains` 得到领域颜色（如 `"#34D399"`）
   - `createStarTexture(color)` → 生成径向渐变 Canvas 纹理，中心白色 → 领域颜色 → 透明
     - 纹理按颜色字符串缓存，同域共享
   - 创建 `SpriteMaterial`：
     ```
     map: 领域色纹理
     opacity: star.brightness（由数据决定，如 0.6）
     blending: THREE.AdditiveBlending
     ```
   - 创建 `Sprite`，设置 position 和 scale：
     ```
     scale = star.size * 0.06  （通常很小，如 0.12）
     ```
   - **保存原始值**：
     ```ts
     const originalMat = material.clone()   // 克隆当前材质 → color 为 #FFFFFF（默认白色）
     const originalScale = new THREE.Vector3(scale, scale, 1)
     ```
   - `starDataMap.set(chunk_id, { sprite, data, originalMaterial: originalMat, originalScale })`

**此时星的状态**：
- `scale`: `star.size * 0.06`（小点）
- `material.map`: 领域色 Canvas 纹理（渐变，中心白 → 领域色 → 透明）
- `material.color`: `#FFFFFF`（白色，不对纹理产生乘法变色）
- `material.opacity`: `star.brightness`
- `material.blending`: `AdditiveBlending`
- **无光晕**

> **关键理解**：星星的领域颜色在纹理里，不在 `material.color` 上。`material.color` 是白色（乘法中性值），所以 `originalMat.color.getHexString()` 返回 `"ffffff"` 是正确行为。

---

### 阶段 1：搜索动画启动（`animateSearch` → `cleanup`）

**触发时机**：用户输入搜索词，后端返回结果后

**cleanup() 做的事**：
1. 移除并销毁所有 `glowSprites`（搜索阶段光晕）
2. 遍历 `highlightedSprites`，逐颗恢复：
   - 如果 `trueOriginals` 有记录 → `sprite.material = trueOrig.material; sprite.scale.copy(trueOrig.scale)`
   - 否则 → 恢复 `highlightedSprites` 中的 `originalMaterial`，用 GSAP 动画回缩 scale
   - `gsap.killTweensOf(sprite.scale)`
3. 清空 `highlightedSprites`、`trueOriginals`、`glowSprites`
4. **不清理** `finalStarGlowSprites`（留给 `resetFinalStar`）

**注意**：首次搜索时 `trueOriginals`、`highlightedSprites` 为空，cleanup 基本是空操作。

---

### 阶段 2：高亮并放大（`highlightAndGrow`）

**触发时机**：cleanup 完成后，对 bm25（金色）、knn（蓝色）、rrf（紫色）三组分别调用

**对每颗星执行**：

1. **保存真正原始值**（仅第一次遇到该 sprite 时）：
   ```ts
   trueOriginals.set(sprite, {
     scale: starInfo.originalScale.clone(),    // star.size * 0.06
     material: starInfo.originalMaterial,      // 领域色纹理 + 白色color
   })
   ```

2. **保存高亮前快照**（仅第一次遇到该 sprite 时）：
   ```ts
   highlightedSprites.set(sprite, {
     originalScale: sprite.scale.clone(),      // 当前 scale（可能是原始值）
     originalMaterial: sprite.material.clone() // 当前材质（可能是原始材质）
   })
   ```

3. **替换材质**：
   ```ts
   const newMaterial = sprite.material.clone()
   newMaterial.color.setHex(color)    // 搜索高亮色（金色/蓝色/紫色）
   newMaterial.opacity = 1            // 不透明
   newMaterial.blending = THREE.AdditiveBlending
   sprite.material = newMaterial
   ```

4. **放大动画**：
   ```ts
   gsap.to(sprite.scale, {
     x: sprite.scale.x * scale,   // scale 参数：bm25=2.2, knn=2.2, rrf=2.8
     y: sprite.scale.y * scale,
     z: sprite.scale.z * scale,
     duration: 0.8,
     delay: 0.3
   })
   ```

5. **创建光晕**（400ms 后）：
   ```ts
   createGlow(sprite.position, color, sprite.scale.x * scale * 3)
   ```

**最终星如果也在 rrf 中**：它会先被 `highlightAndGrow(rrfIds, 0xA78BFA, 2.8)` 处理 → 变紫色、放大 2.8x、有紫色光晕。

---

### 阶段 3：流星动画（`createMeteor` + `shootMeteors`）

**纯视觉特效，不修改星星状态**：
- 从 `getEmissionPoint()` 向每颗星发射流星
- 流星有头部（Sprite）和尾部（Line），飞行 0.8 秒
- 到达后淡出 0.2-0.4 秒，然后销毁

---

### 阶段 4：最终星锁定

**触发时机**：所有流星动画完成后，`results.reranker_final` 存在

**流程**：

1. **压暗其他星**：
   ```ts
   highlightedSprites.forEach((original, sprite) => {
     if (sprite !== finalStar.sprite) {
       gsap.to(sprite.material, { opacity: 0.15, duration: 0.4 })
       gsap.to(sprite.scale, { x: original.originalScale.x * 1.2, ... })
     }
   })
   ```

2. **获取真正原始值**：
   ```ts
   const trueOrig = trueOriginals.get(finalStar.sprite)
   const trueOriginalScale = trueOrig.scale.clone()    // star.size * 0.06 的 clone
   const trueOriginalMaterial = trueOrig.material      // StarField 创建时 clone 的材质
   ```

3. **覆盖当前材质**（此时材质还是 highlightAndGrow 设置的紫色）：
   ```ts
   finalMat.color.setHex(0xFFFFFF)  // 变白
   finalMat.opacity = 1
   finalMat.needsUpdate = true
   ```

4. **清除旧 tween**：
   ```ts
   gsap.killTweensOf(finalSprite.scale)
   gsap.killTweensOf(finalSprite.material)
   ```

5. **创建最终星光晕**：
   ```ts
   const finalGlow = createGlow(finalSprite.position, 0x34D399, 30)
   finalStarGlowSprites.push(finalGlow)
   ```
   - 绿色光晕，尺寸 30，添加到 `scene`（不在 sprite.parent 下）

6. **发射流星**：
   ```ts
   shootMeteors([targetPos], 0x34D399, 0)
   ```

7. **放大到 5x**（从当前 scale 动画到 trueOriginalScale * 5）：
   ```ts
   gsap.to(finalSprite.scale, {
     x: trueOriginalScale.x * 5,
     y: trueOriginalScale.y * 5,
     z: trueOriginalScale.z * 5,
     duration: 1.8,
     ease: 'power3.out'
   })
   ```

8. **呼吸动画**（无限循环）：
   ```ts
   gsap.to(finalSprite.material, {
     opacity: 0.7,
     duration: 0.8,
     ease: 'sine.inOut',
     yoyo: true,
     repeat: -1  // 无限 yoyo
   })
   ```

9. **记录 FinalStarInfo**：
   ```ts
   finalStarInfo = {
     sprite: finalSprite,
     data: finalStar.data,
     trueOriginalScale,
     trueOriginalMaterial,
     domainColor: '#' + trueOriginalMaterial.color.getHexString(),  // "#ffffff"
     appliedStyle: {
       coreColor: '#ffffff',
       opacity: 0.7,
       blending: THREE.AdditiveBlending,
       scaleMultiplier: 5,
       glowColor: 0x34D399,
       glowSize: 30,
       breathingActive: true,
     },
   }
   ```

10. **相机飞行**：
    ```ts
    await flyToStar(targetPos, 1.8)
    ```

**最终星在动画结束后的状态**：
- `scale`: `trueOriginalScale * 5`（如 0.12 * 5 = 0.60）
- `material.color`: `#FFFFFF`
- `material.opacity`: 在 0.7 ~ 1.0 之间 yoyo 循环
- `material.blending`: `AdditiveBlending`
- `material.map`: 领域色纹理（和原始一样，因为只是改了 color，没换 map）
- 有一个尺寸 30 的绿色光晕在 scene 中

---

### 阶段 5：重置恢复（`resetFinalStar`）

**触发时机**：DebugPanel 点击"恢复原始"按钮 → 调用 `resetFinalStar()`

**流程**：

1. **杀死所有 tween**：
   ```ts
   gsap.killTweensOf(sprite.scale)
   gsap.killTweensOf(mat)
   gsap.killTweensOf(sprite)
   ```

2. **强制还原 scale**：
   ```ts
   sprite.scale.set(trueOriginalScale.x, trueOriginalScale.y, trueOriginalScale.z)
   ```
   - 回到 `star.size * 0.06`（如 0.12）
   - 用 `.set()` 而非 `.copy()`，避免 GSAP proxy 干扰

3. **清理已知光晕**：
   ```ts
   clearAllGlows()  // 移除 glowSprites + finalStarGlowSprites
   ```

4. **全场景清扫孤儿光晕**：
   ```ts
   scene.children.forEach(child => {
     if (child instanceof THREE.Sprite && child !== sprite) {
       const maxDim = Math.max(child.scale.x, child.scale.y)
       if (maxDim > 10) {  // 光晕通常 > 10
         scene.remove(child)
         child.material.dispose()
       }
     }
   })
   ```

5. **恢复原始材质**：
   ```ts
   sprite.material = trueOriginalMaterial
   sprite.material.needsUpdate = true
   ```

6. **清空记录**：
   ```ts
   finalStarInfo = null
   ```

**恢复后的状态**：
- `scale`: `star.size * 0.06`（原始小点）
- `material`: 回到 StarField 创建时 clone 的 `originalMaterial`
  - `material.map`: 领域色纹理（与初始渲染相同）
  - `material.color`: `#FFFFFF`
  - `material.opacity`: **注意** → 恢复的是 `originalMat` 的 opacity，即 `material.clone()` 时的值。由于 clone 是在创建时立即执行的，此时 opacity 是 `star.brightness`。但后续 `highlightAndGrow` 替换过材质，`originalMat` 并未被修改过。
  - `material.blending`: `AdditiveBlending`
- **无光晕**
- **无呼吸动画**

> **恢复效果 = 视觉回到初始渲染状态**。由于 `material.color` 本来就是白色（领域色在纹理里），所以恢复后看起来和刚渲染出来时一样。

---

## 三、关键设计决策

### 为什么需要两套原始值（trueOriginals vs highlightedSprites）？

| | trueOriginals | highlightedSprites |
|---|---|---|
| 保存时机 | highlightAndGrow 首次遇到 sprite 时 | highlightAndGrow 首次遇到 sprite 时 |
| scale 来源 | `starDataMap.originalScale` | `sprite.scale.clone()`（当前值） |
| material 来源 | `starDataMap.originalMaterial` | `sprite.material.clone()`（当前值） |
| 用途 | **恢复真正原始状态** | **cleanup 时恢复** |
| 为什么不同 | 如果一颗星被多次 highlightAndGrow，`highlightedSprites` 记录的是**第一次高亮前**的值，但此时 sprite.scale 可能已经被之前的操作改过了。`trueOriginals` 始终从 `starDataMap` 读取，保证是 StarField 创建时的值。 |

实际上在当前流程中，每颗星只会被 highlightAndGrow 一次，两套值基本相同。但 `trueOriginals` 提供了更强的安全保障。

### 为什么 domainColor 是 "#ffffff"？

`SpriteMaterial.color` 是乘法因子，不是绘制颜色。领域颜色在 Canvas 纹理中。默认 `SpriteMaterial.color = white`（#FFFFFF），所以 `originalMaterial.color.getHexString()` 返回 `"ffffff"`。这是 Three.js 的正常行为。

### 光晕为什么需要场景级清扫？

`createGlow` 把光晕 `scene.add(glow)`，不在 sprite 的父节点下。`sprite.parent` 通常不是 scene，所以通过 `sprite.parent` 找不到光晕。必须：
1. 从 sprite 向上遍历到 scene：`while (node.parent) node = node.parent`
2. 遍历 scene.children
3. 用尺寸判断（`maxDim > 10`）区分光晕和正常星星

---

## 四、状态变化总览表

| 阶段 | scale | material.color | material.opacity | material.map | 光晕 | 呼吸动画 |
|---|---|---|---|---|---|---|
| 0. 初始渲染 | `size * 0.06` | `#FFFFFF` | `brightness` | 领域色纹理 | 无 | 无 |
| 2. highlightAndGrow | `→ × 高亮倍率` | 高亮色（金/蓝/紫） | 1.0 | 不变 | 有（高亮色） | 无 |
| 4. 最终星锁定 | `→ trueOriginal × 5` | `#FFFFFF` | 0.7~1.0 yoyo | 不变 | 有（绿色, 30） | 有（无限） |
| 5. resetFinalStar | `size * 0.06` | `#FFFFFF` | `brightness` | 领域色纹理 | 无 | 无 |

---

## 五、涉及的文件与函数

| 文件 | 函数 | 职责 |
|---|---|---|
| StarField.vue | `renderStars` | 创建 sprite、保存 originalMaterial/originalScale |
| StarField.vue | `createStarTexture` | 生成领域色 Canvas 纹理（缓存） |
| useSearchAnimation.ts | `animateSearch` | 搜索动画主流程 |
| useSearchAnimation.ts | `highlightAndGrow` | 高亮+放大+光晕，保存 trueOriginals |
| useSearchAnimation.ts | `createGlow` | 创建光晕 sprite，加入 scene |
| useSearchAnimation.ts | `createMeteor` | 流星动画（纯视觉） |
| useSearchAnimation.ts | `cleanup` | 清理搜索阶段状态 |
| useSearchAnimation.ts | `resetFinalStar` | 重置最终星到原始状态 |
| DebugPanel.vue | `resetToOriginal` | 面板中的重置按钮 → 调用 composable |
| App.vue | `handleSearch` | 搜索入口，自动打开调试面板 |
