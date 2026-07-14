# 评估回放系统与3D星图联动方案

> **项目**: Stelladream  
> **阶段**: Phase 5 - 评估回放系统  
> **目标**: 将评估数据回放与3D星图实时联动，可视化RAG检索效果

---

## 一、当前实现状态

### 1.1 已完成的改动

#### 数据层
- ✅ **评估数据导出** (`backend/export_eval_data.py`)
  - Run 007: 医疗 (kuake_qtr, NDCG@5=0.5791, 100样本)
  - Run 008: 法律 (cail2018, NDCG@5=0.0112, 100样本)
  - Run 009: 百科 (cmrc2018, NDCG@5=0.9080, 100样本)
  - 输出格式: `data/eval/eval_{domain}.json`

#### 后端API
- ✅ **评估数据接口** (`GET /api/eval/{domain}`)
  - 返回: 摘要指标 + 100个样本详情
  - 每个样本包含: query, retrieved_ids, metrics (NDCG@5, MRR@5, Recall@5)

#### 前端组件
- ✅ **EvalReplay.vue** (基础版)
  - 3个Tab切换（医疗/法律/百科）
  - 进度条滑块（1-100）
  - 当前样本的Query显示
  - 指标显示（NDCG@5, MRR@5, Recall@5）
  - Top 5检索结果ID列表
  - NDCG@5曲线图（Canvas绘制）

#### 集成状态
- ✅ App.vue导入EvalReplay组件
- ✅ 添加"📊 评估回放"按钮
- ⚠️ `handleEvalHighlight`函数已定义但未实现
- ❌ **3D星图联动逻辑缺失**（核心待实现）

### 1.2 代码变更追踪

**最近主要提交**:
```
8becae8 - Implement Phase 5: Evaluation Replay System
866aa67 - Fix: Unified reset logic - delegate from DebugPanel to composable
f9ddab2 - Fix: Push glow sprites to array so they can be properly cleaned up
f8193d0 - Fix: Clone material before modifying final star
2f778e4 - Add comprehensive project documentation and star jump feature
```

**文件变更统计**:
- `frontend/src/App.vue`: +43 -17 (添加评估回放集成)
- `frontend/src/composables/useSearchAnimation.ts`: +71 -2 (添加getFinalStar等接口)
- `backend/server.py`: 新增 `/api/eval/{domain}` 接口
- `data/eval/`: 新增3个评估数据文件（132KB）

---

## 二、3D星图联动方案

### 2.1 联动目标

将评估回放的**检索结果**在3D星图上实时可视化：

1. **高亮检索到的星点** (Top 5 retrieved_ids)
2. **区分正确/错误召回** (ground truth对比)
3. **排名可视化** (1-5排名用不同大小/颜色)
4. **相机自动定位** (飞向检索结果中心)
5. **实时同步** (拖拽进度条→星图立即响应)

### 2.2 技术架构

```
EvalReplay.vue (UI层)
    ↓ emit('highlight', chunkIds, metrics)
App.vue (协调层)
    ↓ handleEvalHighlight()
StarField.vue (渲染层)
    ↓ highlightEvalResults(chunkIds)
useSearchAnimation.ts (动画层)
    ↓ highlightStars() / flyToCenter()
```

### 2.3 详细实现方案

#### 方案A：复用搜索动画逻辑（推荐）

**优点**: 
- 代码复用度高
- 已有成熟的高亮/光晕/飞行动画
- 开发速度快

**实现步骤**:

##### Step 1: 扩展EvalReplay事件

```typescript
// EvalReplay.vue
const emit = defineEmits<{
  'highlight': [{
    chunkIds: string[];
    ranks: number[];  // [1,2,3,4,5]
    correctIds: string[];  // ground truth IDs
    currentNdcg: number;
  }];
}>();

function highlightCurrentSample() {
  if (currentSample.value) {
    emit('highlight', {
      chunkIds: currentSample.value.retrieved_ids,
      ranks: [1, 2, 3, 4, 5],
      correctIds: [currentSample.value.id], // 简化版：ID本身是ground truth
      currentNdcg: currentSample.value['ndcg@5']
    });
  }
}
```

##### Step 2: 实现App.vue协调逻辑

```typescript
// App.vue
function handleEvalHighlight(data: {
  chunkIds: string[];
  ranks: number[];
  correctIds: string[];
  currentNdcg: number;
}) {
  console.log('[eval] 高亮检索结果:', data);

  if (!animContext) return;

  // 清理之前的高亮
  animContext.cleanup();

  // 根据排名分配颜色和大小
  const rankColors = [
    0xFFD700,  // Rank 1: 金色
    0xFFA500,  // Rank 2: 橙色
    0xFFFF00,  // Rank 3: 黄色
    0x90EE90,  // Rank 4: 浅绿
    0x87CEEB   // Rank 5: 浅蓝
  ];

  data.chunkIds.forEach((chunkId, idx) => {
    const rank = data.ranks[idx];
    const color = rankColors[rank - 1];
    const scale = 3 - (rank - 1) * 0.3; // Rank 1最大(3x)，Rank 5最小(1.8x)

    // 调用动画系统高亮
    animContext.highlightStars([chunkId], color, scale);

    // 如果是正确召回，添加绿色光晕
    if (data.correctIds.includes(chunkId)) {
      const starInfo = starDataMap.get(chunkId);
      if (starInfo) {
        animContext.createGlow(starInfo.sprite.position, 0x00FF00, 20);
      }
    }
  });

  // 计算检索结果的中心点，相机飞过去
  const positions = data.chunkIds
    .map(id => starDataMap.get(id)?.sprite.position)
    .filter(pos => pos);

  if (positions.length > 0) {
    const center = new THREE.Vector3();
    positions.forEach(pos => center.add(pos));
    center.divideScalar(positions.length);

    animContext.flyToPosition(center, 1.5); // 1.5秒飞行
  }
}
```

##### Step 3: 扩展useSearchAnimation接口

```typescript
// useSearchAnimation.ts
export function useSearchAnimation(context: SearchAnimationContext) {
  // ... 现有代码 ...

  /**
   * 通用高亮函数（供评估回放使用）
   */
  function highlightStars(chunkIds: string[], color: number, scale: number = 2) {
    chunkIds.forEach(chunkId => {
      const starInfo = starDataMap.get(chunkId);
      if (!starInfo) return;

      const sprite = starInfo.sprite;

      // 保存原始状态
      if (!highlightedSprites.has(sprite)) {
        highlightedSprites.set(sprite, {
          originalScale: sprite.scale.clone(),
          originalMaterial: sprite.material.clone()
        });
      }

      // 高亮材质
      const newMat = sprite.material.clone();
      newMat.color.setHex(color);
      newMat.opacity = 1;
      newMat.blending = THREE.AdditiveBlending;
      sprite.material = newMat;

      // 放大动画
      gsap.to(sprite.scale, {
        x: sprite.scale.x * scale,
        y: sprite.scale.y * scale,
        z: sprite.scale.z * scale,
        duration: 0.5,
        ease: 'back.out'
      });
    });
  }

  /**
   * 飞向指定位置
   */
  function flyToPosition(targetPos: THREE.Vector3, duration: number = 1.5) {
    const startPos = camera.position.clone();
    const distance = startPos.distanceTo(targetPos);

    const midPoint = new THREE.Vector3().lerpVectors(startPos, targetPos, 0.5);
    midPoint.y += distance * 0.2;

    const finalPos = targetPos.clone().add(new THREE.Vector3(0, 0, 50));
    const curve = new THREE.QuadraticBezierCurve3(startPos, midPoint, finalPos);

    let progress = 0;
    const startTime = Date.now();

    return new Promise<void>(resolve => {
      const animate = () => {
        const elapsed = Date.now() - startTime;
        progress = Math.min(elapsed / (duration * 1000), 1);

        const point = curve.getPoint(progress);
        camera.position.copy(point);
        camera.lookAt(targetPos);
        controls.target.copy(targetPos);
        controls.update();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };
      animate();
    });
  }

  return {
    animateSearch,
    cleanup,
    getFinalStar,
    resetFinalStar,
    highlightStars,    // 新增
    flyToPosition      // 新增
  };
}
```

##### Step 4: 添加实时清理逻辑

```typescript
// App.vue
watch(showEvalPanel, (newVal) => {
  if (!newVal && animContext) {
    // 关闭评估面板时，清理所有高亮
    animContext.cleanup();
  }
});

// EvalReplay.vue
watch(currentIndex, () => {
  // 每次切换样本时，先通知清理旧的高亮
  emit('cleanup');
  highlightCurrentSample();
});
```

---

#### 方案B：独立评估可视化系统

**优点**:
- 完全独立，不影响搜索动画
- 可以定制专门的评估视觉效果
- 支持更复杂的评估指标可视化

**缺点**:
- 代码重复度高
- 开发时间长
- 维护成本高

**适用场景**: 如果评估回放需要特殊的视觉效果（如热力图、连线图等）

---

### 2.4 推荐实施路线

**优先级排序**:

1. **P0 - 基础高亮** (30分钟)
   - 实现handleEvalHighlight基本逻辑
   - 复用highlightStars函数
   - 单一颜色高亮所有检索结果

2. **P1 - 排名可视化** (1小时)
   - 根据排名分配颜色（金→橙→黄→绿→蓝）
   - 根据排名缩放大小（Rank 1最大）
   - 添加文字标签显示排名

3. **P2 - 相机自动定位** (30分钟)
   - 计算检索结果中心点
   - 飞行动画过去
   - 合适的观察距离

4. **P3 - 正确性标识** (1小时)
   - 对比ground truth
   - 正确召回：绿色光晕
   - 错误召回：红色边框
   - NDCG@5值映射到整体亮度

5. **P4 - 动画优化** (1小时)
   - 平滑过渡（拖拽进度条时）
   - 防抖处理（快速拖动时）
   - 性能优化（只渲染可见星点）

---

## 三、数据结构设计

### 3.1 评估样本数据格式

```typescript
interface EvalSample {
  id: string;              // 查询ID
  query: string;           // 查询文本
  retrieved_ids: string[]; // 检索到的Top 5文档ID (doc_XXXXX格式)
  metrics: {
    'ndcg@5': number;      // 0-1
    'mrr@5': number;       // 0-1
    'recall@5': number;    // 0-1
    'hr@1': number;        // 0或1
  };
  'ndcg@5': number;        // 快捷访问
}
```

### 3.2 高亮数据结构

```typescript
interface EvalHighlightData {
  chunkIds: string[];      // 要高亮的文档ID列表
  ranks: number[];         // [1, 2, 3, 4, 5]
  correctIds: string[];    // ground truth IDs
  currentNdcg: number;     // 当前样本的NDCG@5
  domain: string;          // medical/law/general
}
```

### 3.3 **关键问题：ID格式不匹配**

#### 问题描述

**数据源冲突**:
- `star_data.json` 的 `chunk_id`: **ES _id (UUID格式)**
  - 例如: `"f31fd23f-2b40-40f4-a3c3-50674ebf4803"`
  - 来自: `hit["_id"]` (Elasticsearch文档ID)
  
- `eval数据` 的 `retrieved_ids`: **ES _source字段 (doc_XXXXX格式)**
  - 例如: `"doc_014916"`, `"cmrc_002493"`, `"law_116278"`
  - 来自: 评估脚本使用的 `_source.source_path` 或自定义字段

**根本原因**:
```python
# export_full_data.py (第71行)
"chunk_id": hit["_id"],  # UUID格式

# 评估脚本 (other-world项目)
retrieved_ids = [doc["_source"]["source_path"] for doc in results]  # doc_XXXXX格式
```

#### 解决方案对比

##### 方案1: 重新导出star_data.json（推荐）

**优点**: 一劳永逸，数据源统一  
**缺点**: 需要重新导出24MB数据，UMAP降维耗时约5分钟  

**实施步骤**:

```python
# 修改 backend/export_full_data.py 第65-75行
for hit in response["hits"]["hits"]:
    doc = {
        "chunk_id": hit["_id"],  # 保留UUID作为唯一标识
        "source_path": hit["_source"].get("source_path", hit["_id"]),  # 新增
        "content": hit["_source"]["content"],
        "domain": hit["_source"]["domain"],
        "source": hit["_source"]["source"],
        "embedding": hit["_source"]["embedding"]
    }
    docs.append(doc)

# 导出时两个ID都保存
output_data.append({
    "chunk_id": doc["chunk_id"],        # UUID (主键)
    "source_path": doc["source_path"],  # doc_XXXXX (用于eval映射)
    "x": coords[i, 0] * 15,
    # ... 其他字段
})
```

**前端使用**:
```typescript
// 构建反向索引
const sourcePathToUuid = new Map<string, string>();
starData.forEach(star => {
  if (star.source_path) {
    sourcePathToUuid.set(star.source_path, star.chunk_id);
  }
});

// 评估高亮时转换
function handleEvalHighlight(data: EvalHighlightData) {
  const uuidList = data.chunkIds
    .map(sourcePath => sourcePathToUuid.get(sourcePath))
    .filter(uuid => uuid !== undefined);
  
  animContext.highlightStars(uuidList, color, scale);
}
```

##### 方案2: 创建映射文件（快速方案）

**优点**: 不需要重新导出，立即可用  
**缺点**: 需要额外维护映射文件，数据不同步风险  

**实施步骤**:

```python
# 新建 backend/build_id_mapping.py
import json
from elasticsearch import Elasticsearch

es = Elasticsearch("http://localhost:9200")
mapping = {}

# 查询所有文档
response = es.search(
    index="unified_rag",
    body={"query": {"match_all": {}}, "size": 10000, "_source": ["source_path"]},
    scroll="5m"
)

while response["hits"]["hits"]:
    for hit in response["hits"]["hits"]:
        uuid = hit["_id"]
        source_path = hit["_source"].get("source_path", "")
        if source_path:
            mapping[source_path] = uuid
    
    scroll_id = response["_scroll_id"]
    response = es.scroll(scroll_id=scroll_id, scroll="5m")

# 保存映射
with open("../data/id_mapping.json", "w", encoding="utf-8") as f:
    json.dump(mapping, f, indent=2)

print(f"Mapping built: {len(mapping)} entries")
```

**前端加载**:
```typescript
// App.vue
const idMapping = ref<Map<string, string>>(new Map());

onMounted(async () => {
  const response = await axios.get('/api/id-mapping');
  Object.entries(response.data).forEach(([sourcePath, uuid]) => {
    idMapping.value.set(sourcePath, uuid as string);
  });
});
```

##### 方案3: 修改评估数据导出（中间方案）

**优点**: 评估数据直接使用UUID，无需前端转换  
**缺点**: 需要修改other-world项目的评估逻辑  

**实施步骤**:

```python
# 修改 backend/export_eval_data.py
def convert_source_path_to_uuid(source_path: str, es: Elasticsearch) -> str:
    """从source_path查询对应的UUID"""
    response = es.search(
        index="unified_rag",
        body={
            "query": {"term": {"source_path": source_path}},
            "size": 1,
            "_source": False
        }
    )
    
    if response["hits"]["hits"]:
        return response["hits"]["hits"][0]["_id"]
    return None

# 在导出时转换
for sample in samples[:100]:
    # 原始: retrieved_ids = ["doc_014916", "doc_014922", ...]
    # 转换后: retrieved_ids = ["uuid1", "uuid2", ...]
    
    uuid_list = []
    for source_path in sample["retrieved_ids"]:
        uuid = convert_source_path_to_uuid(source_path, es)
        if uuid:
            uuid_list.append(uuid)
    
    export_data["samples"].append({
        "id": query_id,
        "query": query_info.get("query", ""),
        "retrieved_ids": uuid_list,  # 使用UUID
        # ...
    })
```

#### 推荐实施方案（修正版）

**⚠️ 原方案错误分析**:
- ❌ 文档原建议: Phase 5用方案2（映射文件），Phase 6迁移到方案1
- ❌ 问题1: 方案2需要ES在线查询或维护额外映射文件，增加依赖
- ❌ 问题2: 重新导出只需5分钟，比维护映射逻辑更简单
- ❌ 问题3: 当前star_data只有5000星点，但eval检索范围是全部34K

**✅ 正确执行顺序**:

**第一步: 重新导出star_data.json（方案1）** - **必须先做**
- 修改`export_full_data.py`添加`source_path`字段
- **导出全部34K星点**（不是5000子集）
- 前端渲染时按需显示（性能优化留给Phase 6）
- 实施时间: 10分钟修改 + 5分钟UMAP
- 一劳永逸，无运行时依赖

**第二步: 前端构建反向索引**
```typescript
// App.vue - 加载完star_data后
const sourcePathToUuid = new Map<string, string>();
starData.value.forEach(star => {
  if (star.source_path) {
    sourcePathToUuid.set(star.source_path, star.chunk_id);
  }
});

// handleEvalHighlight中转换
const uuidList = data.chunkIds
  .map(sourcePath => sourcePathToUuid.get(sourcePath))
  .filter(uuid => uuid !== undefined);

console.log(`[eval] 映射成功: ${uuidList.length}/${data.chunkIds.length}`);
```

**第三步: 实现评估联动**
- P0基础高亮（30分钟）
- P1-P4完整功能（3小时）

**关键修正点**:

1. **ID映射范围问题**
   - 当前star_data: 仅5000星点
   - eval检索范围: 全部34K文档
   - **解决**: 重新导出时导出全部34K
   - 前端渲染: 先渲染5000（性能），找不到的静默跳过

2. **样本数量不一致**
   - `eval_report.json`: 500样本
   - 当前导出脚本: `samples[:100]` (限制100)
   - **解决**: 修改为`samples[:500]`或全部

3. **渲染策略**
   ```typescript
   // 34K星点数据，只渲染前5000
   const RENDER_LIMIT = 5000;
   const starsToRender = starData.value.slice(0, RENDER_LIMIT);
   
   // 但sourcePathToUuid包含全部34K的映射
   // 高亮时如果ID在34K但不在5000，静默跳过
   ```

**为什么方案1是第一步**:
- ✅ 数据源统一，无额外依赖
- ✅ 运行时零成本（映射在内存，O(1)查找）
- ✅ 支持全部34K文档的评估回放
- ✅ 一次导出，永久使用
- ✅ 比维护映射文件简单得多

**方案2的问题**:
- ❌ 需要ES实时可用（部署依赖）
- ❌ 或者维护`id_mapping.json`（数据同步风险）
- ❌ 前端需要加载额外映射文件（100KB+）
- ❌ 仍然没解决5000 vs 34K的问题

---

## 四、自测验证清单

### 4.1 功能测试

- [ ] **Tab切换**: 医疗→法律→百科，星图高亮对应领域的星点
- [ ] **进度条拖拽**: 拖动到任意位置，星图立即响应
- [ ] **相机飞行**: 自动飞向检索结果中心
- [ ] **排名可视化**: Rank 1最大最亮，Rank 5最小
- [ ] **多样本连续播放**: 点击播放按钮，自动遍历100个样本
- [ ] **清理逻辑**: 关闭评估面板，所有高亮恢复正常

### 4.2 性能测试

- [ ] **FPS保持**: 高亮5个星点时，FPS > 45
- [ ] **拖拽流畅度**: 快速拖动进度条不卡顿
- [ ] **内存占用**: 连续播放100个样本，内存增长 < 50MB

### 4.3 视觉效果

- [ ] **颜色区分**: 5个排名的颜色清晰可辨
- [ ] **大小渐变**: 排名大小梯度自然
- [ ] **光晕效果**: 正确召回的绿色光晕明显
- [ ] **飞行路径**: 相机弧线飞行平滑

---

## 五、已知问题与解决方案

### 5.1 chunk_id映射问题

**问题**: 评估数据中的`doc_XXXXXX`可能不在渲染的5000个星点中

**解决方案**:
1. 增加渲染数量到10000（性能允许）
2. 动态加载：检测到ID不存在时，临时渲染该星点
3. 忽略不存在的ID，在UI上标注"未渲染"

### 5.2 性能瓶颈

**问题**: 连续高亮100个样本，可能导致大量光晕sprite堆积

**解决方案**:
1. 每次高亮前，强制`cleanup()`清理旧的
2. 使用对象池复用光晕sprite
3. 降低光晕分辨率（64x64 → 32x32）

### 5.3 NDCG@5曲线与星图不同步

**问题**: 曲线更新了但星图没变，或反之

**解决方案**:
1. 使用Vue的`watch`统一触发
2. 事件驱动：EvalReplay发出一个事件，App.vue和Chart同时响应
3. 添加loading状态，确保数据加载完成后再渲染

---

## 六、扩展功能（Phase 5+）

### 6.1 时间轴回放

**描述**: 播放按钮 + 自动遍历100个样本  
**实现**: `setInterval` + `currentIndex++`  
**预计**: 30分钟

### 6.2 领域颜色分组

**描述**: 医疗用红色系、法律用蓝色系、百科用绿色系  
**实现**: 扩展`rankColors`数组，根据`domain`选择色系  
**预计**: 15分钟

### 6.3 检索路径连线

**描述**: 从查询起点到5个结果，绘制连线  
**实现**: 使用`THREE.Line`绘制5条射线  
**预计**: 1小时

### 6.4 NDCG热力图

**描述**: 用颜色深浅表示整个星图的NDCG分布  
**实现**: 基于历史评估数据，给每个星点着色  
**预计**: 2小时

---

## 七、总结

**当前进度**: Phase 5基础架构完成，核心联动逻辑待实现

**推荐方案**: 方案A（复用搜索动画逻辑）

**预计工时**:
- P0基础高亮: 30分钟
- P1-P4完整实现: 3.5小时
- 测试调试: 1小时
- **总计: 5小时**

**下一步**:
1. 实现`handleEvalHighlight`核心逻辑
2. 扩展`useSearchAnimation`导出接口
3. 自测三个领域的回放效果
4. 优化性能和动画细节

---

**文档版本**: 1.0  
**最后更新**: 2026-07-12  
**作者**: Claude Opus 4.8 (1M context)
