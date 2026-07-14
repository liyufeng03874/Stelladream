# 评估联动方案：数据沉淀式星云效果

> 2026-07-14 确定，替代之前的"逐帧回放"方案

## 核心转变

**不是"逐帧回放"**，而是**"数据沉淀"**。500 步跑完，看哪些星星被反复点亮，哪些区域自然亮成星带。

## 播放节奏

- 500 步，25 秒播完（每步间隔 **50ms**）
- 无 query 动画、无飞线、无相机定位
- 切换领域 → 自动重置命中数据
- 播完 500 步 → 自动停止，展示最终效果

## 命中效果（全部 AdditiveBlending）

| 命中次数 | 效果 |
|---------|------|
| 1 次 | 星星微微变亮（亮度 +0.15） |
| 3-5 次 | 周围出现 1-3 个小光晕粒子 |
| 6-10 次 | 光晕数量增多，向外扩散 |
| 10+ 次 | 明显变亮，与相邻命中星产生半透明连线 |
| 20+ 次 | 光晕叠加成星云效果 |

## 核心设计原则

**不手动算重叠。** 所有光晕、连线全部使用 AdditiveBlending，Three.js 光栅化管线自己处理叠加——密集区自然亮成星云，稀疏区就几颗孤星。

## 共现连线

- 统计每对星星在 Top-5 中**同时出现的次数**
- 共现 ≥3 次的星星之间画半透明线
- 线也用 AdditiveBlending，靠近密集区域自动提亮

## 数据层

```
hitCounts: Map<chunkId, number>          // 每颗星被命中的次数
coHitCounts: Map<"idA:idB", number>      // 两星同时被检索到的次数
```

每步 Top-5 命中更新计数，不触发全量渲染。每步只更新该步 5 颗星的局部效果（亮度 + 光晕）。

## 重置时机

- 切换领域 → 自动清空命中数据
- 重新播放 → 自动清空

## 待实现

1. ~~useSearchAnimation.ts evalHighlight/clearEvalHighlight~~（已写，需重构）
2. useEvalVisual.ts（命中统计 + 渲染逻辑）
3. EvalReplay.vue 自动播放（50ms 间隔）
4. App.vue handleEvalHighlight 对接 evalVisual
5. 共现连线层（LineSegments + AdditiveBlending）
6. 光晕粒子层（Sprite + AdditiveBlending）

---

## 辉光叠加方案决策（2026-07-14 15:45）

### 背景
昨晚辉光对齐 bug 的根因：query 最终星叠加了 bm25 + knn + rrf + finalStar 共 4 层辉光，jumpToStar 只有绿色 30。
最终修复：从 difference.log 提取辉光数据写死为 `FINAL_STAR_QUERY_GLOWS` 常量，jumpToStar 时复现。

### 问题
三个搜索模式（knn/rrf/bm25）的辉光同时加载时，方案选择：
- A：封装为方法，预计算叠加效果
- B：各自独立创建辉光 + AdditiveBlending，让 GPU 自动叠加

### 决策：选 B

**原因：**
1. **封装方法 = 预测叠加**——需要手动算颜色混合、光晕尺寸、透明度权重，参数一变常量就过时
2. **AdditiveBlending 恰好匹配场景**——bm25/knn/rrf 各自独立创建，管线解耦，GPU 光栅化自动加法混合，密集区自然变亮
3. **和评估联动理念同源**——让系统自己呈现结果，不要提前预测（"数据沉淀"的核心思想）

### 两套路径各取所长
- **query 流程**：AdditiveBlending（各自独立创建，GPU 自动叠加）
- **jumpToStar**：用 `FINAL_STAR_QUERY_GLOWS` 常量预计算（因为不经过 bm25/knn/rrf 阶段）
