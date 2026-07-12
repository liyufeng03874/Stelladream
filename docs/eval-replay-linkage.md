# 评估回放联动方案 - 轻量高亮（方案 B）

> 版本：v1.0 | 2026-07-12

## 核心思路

拖动进度条或点击播放时，**即时高亮**当前 step 对应的检索结果，不做复杂动画。用最少的视觉变化传递最大信息量。

## 数据流

```
EvalReplay 组件
  ↓ emit('highlight', { query, retrieved_ids, metrics, currentStep, maxSteps })
App.vue handleEvalHighlight()
  ↓ 调用 useSearchAnimation.evalHighlight(retrieved_ids, query)
StarField 高亮对应 chunk_id 的星星
```

## 交互行为

### 拖动进度条（即时响应）

1. **清空**上次高亮的星星（恢复原始大小、颜色、无辉光）
2. **高亮**当前 step 的 `retrieved_ids` 对应的 5 颗星星：
   - 放大到 2.5 倍（比搜索动画的最终高亮小一些）
   - 领域色发光（与正常搜索一致）
   - 按排名顺序添加序号标签（Top 1~5）
3. **顶部 Query 栏**显示当前查询文本（可选）

### 点击播放（自动推进）

1. 每秒推进一个 step
2. 每个 step 先清空 → 再高亮新星星
3. 指标数字实时刷新
4. 到达末尾自动停止

### 切换领域

1. 重置进度条到 step 0
2. 清空所有高亮
3. 加载新领域数据

## 视觉规范

### 高亮星星样式

| 属性 | 值 | 说明 |
|------|------|------|
| 缩放倍数 | 2.5x | 小于搜索动画的 5x，避免喧宾夺主 |
| 发光颜色 | 领域色 | 医疗=红，法律=青，百科=蓝 |
| 发光强度 | 中等 | opacity 0.6，比搜索动画稍弱 |
| 序号标签 | 小字叠加 | Top 1~5，白色半透明 |

### 排名区分（可选）

- Top 1：最大最亮（2.5x，opacity 0.8）
- Top 2-3：中等（2.0x，opacity 0.6）
- Top 4-5：较小（1.5x，opacity 0.5）

### 错误搜索标记

当 `ndcg@5 < 0.1` 时：
- 星星边框变为红色闪烁（频率 1Hz）
- 视觉上提示"这个查询没检索到好结果"

## API 接口

### useSearchAnimation 新增方法

```typescript
// 高亮检索结果
function evalHighlight(
  chunkIds: string[],
  options?: {
    scale?: number;       // 缩放倍数，默认 2.5
    glowIntensity?: number; // 发光强度，默认 0.6
    showRank?: boolean;   // 是否显示排名，默认 true
  }
): void;

// 清除评估高亮
function clearEvalHighlight(): void;
```

### App.vue 事件处理

```typescript
const handleEvalHighlight = (payload: {
  query: string;
  retrieved_ids: string[];
  metrics: Record<string, number>;
  currentStep: number;
  maxSteps: number;
}) => {
  animContext?.clearEvalHighlight();
  
  if (payload.retrieved_ids.length > 0) {
    const isBadSearch = (payload.metrics['ndcg@5'] ?? 0) < 0.1;
    animContext?.evalHighlight(payload.retrieved_ids, {
      glowIntensity: isBadSearch ? 0.3 : 0.6,
    });
  }
};
```

## 实现优先级

### P0（立即实现）
- [ ] `useSearchAnimation.evalHighlight()` 方法
- [ ] `useSearchAnimation.clearEvalHighlight()` 方法
- [ ] App.vue 对接 `@highlight` 事件
- [ ] EvalReplay 显示当前 query

### P1（后续优化）
- [ ] 按排名区分大小/亮度
- [ ] 低 NDCG 红色警示
- [ ] 序号标签（DOM overlay 或 SpriteText）

### P2（锦上添花）
- [ ] 迷你 NDCG 趋势折线图
- [ ] 播放速度调节（0.5x / 1x / 2x / 5x）
- [ ] 搜索历史时间轴

## 技术要点

### 性能考虑

- 高亮 5 颗星星是 O(1) 操作，不会卡顿
- 拖动进度条时 `@input` 触发频率高，需要节流（50ms）
- 播放模式下每秒切换一次，无性能压力

### 状态管理

- 评估高亮与搜索高亮**互斥**：评估模式下暂停搜索动画
- 高亮状态独立存储（`evalHighlightedSprites`），不与搜索的 `highlightedSprites` 混用
- 每次切换 step 先清空再高亮，不累积
