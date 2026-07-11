# Phase 4: RAG 检索可视化实现计划

## 目标
实现完整的 RAG 检索流程，并在 3D 星图中可视化整个检索过程，包括：
- BM25 关键词召回
- kNN 向量召回
- RRF 融合
- Reranker 精排
- 动画效果展示检索路径

## 架构设计

### 后端实现 (Python/FastAPI)

**文件结构：**
```
backend/
  ├── server.py (修改 /api/search 端点)
  ├── rag_search.py (新建：封装检索逻辑)
  └── requirements.txt (更新依赖)
```

**核心逻辑：**

1. **复用 other-world 的 RAG 组件**
   - 使用 `ESRetrievalPipeline` 而非 `RetrievalPipeline`
   - 原因：数据在 Elasticsearch，不在 FAISS
   - 路径：`D:/code/other-world/backend/rag/`

2. **检索流程 (分步返回)**
   ```python
   # Step 1: Query Rewriting
   queries = rewrite_query(query)
   
   # Step 2: BM25 召回 (ES)
   bm25_results = es_search_bm25(query, top_k=20)
   
   # Step 3: kNN 召回 (ES vector search)
   query_embedding = embedder.encode([query])
   knn_results = es_search_knn(query_embedding, top_k=20)
   
   # Step 4: RRF 融合
   rrf_merged = rrf_fusion(bm25_results, knn_results, k=60)
   
   # Step 5: Reranker 精排
   final = reranker.rerank(query, rrf_merged[:10], top_n=5)
   ```

3. **返回格式**
   ```json
   {
     "bm25": [
       {"chunk_id": "xxx", "score": 0.85, "rank": 1},
       ...
     ],
     "knn": [
       {"chunk_id": "yyy", "score": 0.92, "rank": 1},
       ...
     ],
     "rrf_top5": [
       {"chunk_id": "zzz", "rrf_score": 0.75, "rank": 1},
       ...
     ],
     "reranker_final": {
       "chunk_id": "aaa",
       "rerank_score": 0.95,
       "content": "..."
     }
   }
   ```

### 前端可视化 (Vue 3/Three.js)

**文件结构：**
```
frontend/src/
  ├── components/
  │   ├── StarField.vue (修改：添加高亮和连线)
  │   ├── SearchBar.vue (已存在)
  │   └── SearchResultPanel.vue (新建：显示结果详情)
  └── composables/
      └── useSearchAnimation.ts (新建：搜索动画逻辑)
```

**可视化效果：**

1. **查询飞轮动画**
   - 用户输入查询 → 在相机位置创建"查询球体"
   - 查询球体向外发射光波（表示检索开始）
   - 持续时间：500ms

2. **BM25 召回可视化**
   - 高亮匹配的星点（变大 + 黄色光晕）
   - 从查询球体到星点画虚线（表示关键词匹配）
   - 显示前 20 个结果
   - 持续时间：1s

3. **kNN 召回可视化**
   - 高亮匹配的星点（变大 + 蓝色光晕）
   - 从查询球体到星点画实线（表示语义相似）
   - 显示前 20 个结果
   - 持续时间：1s
   - 可能与 BM25 重叠（用紫色表示）

4. **RRF 融合动画**
   - 两路召回的星点开始闪烁
   - 融合后的 Top 5 变得更亮更大
   - 其他星点逐渐变暗
   - 持续时间：800ms

5. **Reranker 精排**
   - Top 5 中选出最终结果
   - 最终结果星点：
     - 最大、最亮
     - 绿色脉冲动画
     - 从查询球体拉一条粗实线
   - 持续时间：600ms

6. **相机动画**
   - 自动飞向最终结果星点
   - 使用 GSAP 或 Three.js Tween
   - 持续时间：1.5s

**技术实现：**

```typescript
// useSearchAnimation.ts
export function useSearchAnimation(scene: THREE.Scene, camera: THREE.Camera) {
  // 1. 创建查询球体
  const createQuerySphere = () => { ... }
  
  // 2. 高亮星点
  const highlightStars = (chunkIds: string[], color: number) => { ... }
  
  // 3. 绘制连线
  const drawLines = (from: Vector3, targets: Vector3[], style: LineStyle) => { ... }
  
  // 4. 相机飞行
  const flyToStar = (target: Vector3) => { ... }
  
  // 5. 清理动画
  const cleanup = () => { ... }
  
  return {
    animateSearch: async (results: SearchResult) => {
      // 执行完整动画序列
    }
  }
}
```

## 实现步骤

### Step 1: 后端 RAG 接口实现
1. 创建 `backend/rag_search.py`
2. 实现检索逻辑（复用 other-world 组件）
3. 更新 `server.py` 的 `/api/search` 端点
4. 测试接口返回数据

### Step 2: 前端数据映射
1. 修改 `api/index.ts` 添加 chunk_id 到星点的映射
2. 创建 `starDataMap: Map<chunk_id, StarPoint>`
3. 确保能通过 chunk_id 快速找到对应星点

### Step 3: 基础高亮功能
1. 在 `StarField.vue` 添加星点高亮方法
2. 实现颜色变化、大小变化
3. 添加简单的点击测试

### Step 4: 搜索动画实现
1. 创建 `useSearchAnimation.ts`
2. 实现查询球体创建
3. 实现连线绘制（Three.js Line）
4. 实现高亮动画

### Step 5: 完整流程串联
1. 用户输入查询 → 调用 API
2. 按顺序执行动画：
   - BM25 → kNN → RRF → Reranker
3. 显示最终结果面板

### Step 6: 性能优化
1. 连线使用 BufferGeometry
2. 动画帧率优化
3. 添加可中断机制

## 技术要点

### 1. 星点高亮
```typescript
// 保存原始材质
const originalMaterials = new Map<THREE.Sprite, THREE.SpriteMaterial>();

// 高亮
function highlightStar(sprite: THREE.Sprite, color: number) {
  originalMaterials.set(sprite, sprite.material);
  sprite.material = sprite.material.clone();
  sprite.material.color.setHex(color);
  sprite.scale.multiplyScalar(2);
}

// 恢复
function resetStar(sprite: THREE.Sprite) {
  const original = originalMaterials.get(sprite);
  if (original) {
    sprite.material = original;
    sprite.scale.divideScalar(2);
  }
}
```

### 2. 连线绘制
```typescript
const geometry = new THREE.BufferGeometry().setFromPoints([
  queryPosition,
  starPosition
]);
const material = new THREE.LineBasicMaterial({
  color: 0xffff00,
  transparent: true,
  opacity: 0.6
});
const line = new THREE.Line(geometry, material);
scene.add(line);
```

### 3. 相机飞行
```typescript
import { gsap } from 'gsap';

function flyToStar(target: THREE.Vector3, duration: number = 1.5) {
  gsap.to(camera.position, {
    x: target.x,
    y: target.y,
    z: target.z + 10,
    duration,
    ease: 'power2.inOut'
  });
}
```

## 数据流

```
用户输入 "医疗问题"
    ↓
SearchBar.vue emit('search')
    ↓
App.vue handleSearch()
    ↓
api.search(query) → 后端 /api/search
    ↓
后端执行检索流程
    ↓
返回 {bm25, knn, rrf_top5, reranker_final}
    ↓
前端 useSearchAnimation.animateSearch()
    ↓
依次执行动画：BM25 → kNN → RRF → Reranker
    ↓
相机飞向最终结果
    ↓
显示 SearchResultPanel
```

## 需要的依赖

**后端新增：**
- elasticsearch (已有)
- transformers (已有)
- torch (已有)

**前端新增：**
```json
{
  "gsap": "^3.12.0"  // 用于相机动画
}
```

## 预期效果

用户搜索 "糖尿病治疗方法"：
1. 查询球体出现（0.5s）
2. 20个星点变黄 + 虚线连接（BM25，1s）
3. 15个星点变蓝 + 实线连接（kNN，1s）
4. Top 5 星点闪烁变亮（RRF，0.8s）
5. 1个星点变绿脉冲（Reranker，0.6s）
6. 相机飞向该星点（1.5s）
7. 显示文档详情面板

总时长：约 5.4 秒

## 待确认问题

1. **是否需要实时流式返回？**
   - 选项 A: 一次性返回所有结果，前端分步动画
   - 选项 B: SSE 流式返回，后端每完成一步发送一次
   - 建议：选 A（简单、可控）

2. **性能考虑**
   - 当前只渲染 1000 个星点
   - 检索可能返回不在渲染列表中的星点
   - 处理方式：
     - 方案 A: 只高亮已渲染的星点
     - 方案 B: 动态添加未渲染的星点
     - 建议：方案 A

3. **动画可中断性**
   - 用户在动画过程中发起新搜索
   - 处理：立即清理旧动画，开始新动画

## 时间估计

- Step 1 后端实现: 2小时
- Step 2 数据映射: 30分钟
- Step 3 基础高亮: 1小时
- Step 4 动画实现: 3小时
- Step 5 流程串联: 1小时
- Step 6 优化调试: 1.5小时

**总计**: 约 9 小时

## 成功标准

- [x] 后端 `/api/search` 返回正确的检索结果
- [x] 前端能根据 chunk_id 找到对应星点
- [x] 动画流畅，无卡顿（60fps）
- [x] 视觉效果清晰，易于理解检索过程
- [x] 最终结果准确展示
