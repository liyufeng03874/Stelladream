# Stelladream 技术架构文档

本文档详细说明Stelladream的技术架构、设计决策和实现细节。

## 📐 整体架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         用户层                               │
│                    Web浏览器 (Chrome/Firefox)                │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/WebSocket
┌────────────────────────┴────────────────────────────────────┐
│                        前端层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Vue 3 App   │  │  Three.js    │  │   GSAP       │      │
│  │  TypeScript  │  │  3D渲染      │  │   动画       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API
┌────────────────────────┴────────────────────────────────────┐
│                        后端层                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  FastAPI     │  │  RAG Engine  │  │  Models      │      │
│  │  Server      │  │  检索逻辑    │  │  BGE系列     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                        数据层                                │
│  ┌──────────────────────────┐  ┌──────────────────┐         │
│  │  Elasticsearch           │  │  静态文件        │         │
│  │  - 文档索引              │  │  star_data.json  │         │
│  │  - 向量索引 (kNN)        │  │  (33,919星点)    │         │
│  └──────────────────────────┘  └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## 🎨 前端架构

### 技术选型

| 技术 | 版本 | 用途 | 选型理由 |
|------|------|------|----------|
| Vue 3 | 3.5+ | MVVM框架 | 响应式系统、组合式API、TypeScript支持好 |
| TypeScript | 5.x | 类型系统 | 类型安全、IDE支持、减少运行时错误 |
| Three.js | r170 | 3D渲染 | 成熟的WebGL封装、性能优秀、社区活跃 |
| GSAP | 3.12+ | 动画引擎 | 高性能、时间轴控制、缓动函数丰富 |
| Vite | 6.0 | 构建工具 | 极速HMR、原生ESM、按需编译 |
| Axios | 1.7+ | HTTP客户端 | 拦截器、请求取消、超时控制 |

### 组件架构

```
App.vue (根组件)
├── SearchBar.vue (搜索框)
│   ├── 输入框
│   ├── 搜索按钮
│   └── 加载状态
├── StarField.vue (3D星图)
│   ├── Three.js场景
│   ├── OrbitControls
│   ├── 星点渲染 (Sprite)
│   ├── 射线检测 (Raycaster)
│   └── 事件处理
└── InfoPanel.vue (信息面板)
    ├── 文档详情
    ├── 星跃按钮
    └── 关闭按钮
```

### Composables设计

#### useSearchAnimation.ts

负责搜索动画的核心逻辑：

```typescript
interface SearchAnimationContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  controls: OrbitControls;
  starSprites: THREE.Sprite[];
  starDataMap: Map<string, StarInfo>;
}

export function useSearchAnimation(context: SearchAnimationContext) {
  // 状态管理
  let finalStarState: FinalStarState | null = null;
  let glowSprites: THREE.Sprite[] = [];
  let highlightedSprites: Map<...>;

  // 核心函数
  function animateSearch(results: SearchResults): Promise<void>
  function jumpToStar(chunkId: string): void
  function cleanup(): void

  return { animateSearch, jumpToStar, cleanup };
}
```

**设计要点**：
- 使用闭包管理动画状态
- Promise-based异步流程
- 清理函数防止内存泄漏
- 状态持久化支持星跃功能

### 3D渲染优化

#### 性能优化策略

1. **限制渲染数量**
   ```typescript
   const RENDER_LIMIT = 5000; // 只渲染前5000个
   props.stars.slice(0, RENDER_LIMIT).forEach(...)
   ```

2. **纹理缓存**
   ```typescript
   const textureCache = new Map<string, THREE.CanvasTexture>();
   if (textureCache.has(color)) {
     return textureCache.get(color)!;
   }
   ```

3. **射线检测节流**
   ```typescript
   let lastRaycast = 0;
   const RAYCAST_THROTTLE = 100; // 100ms
   if (now - lastRaycast < RAYCAST_THROTTLE) return;
   ```

4. **关闭抗锯齿**
   ```typescript
   renderer = new THREE.WebGLRenderer({
     antialias: false, // 提升性能
     powerPreference: 'high-performance'
   });
   ```

#### 相机设置

```typescript
// 窄FOV = 望远镜效果
camera = new THREE.PerspectiveCamera(25, aspect, 0.1, 2000);

// 相机位置：数据中心上方
camera.position.set(67.1, 146.2, 330.9);

// OrbitControls限制
controls.minDistance = 100;
controls.maxDistance = 800;
```

### 动画系统

#### GSAP时间轴

搜索动画使用GSAP实现流畅的时序控制：

```typescript
// 流星效果：快速射出 → 渐变淡出
gsap.timeline()
  .to(material, {
    opacity: 0.9,
    duration: 0.15,
    ease: 'power2.out'
  })
  .to(material, {
    opacity: 0.3,
    duration: 0.6,
    ease: 'power1.in'
  });
```

#### 贝塞尔曲线飞行

```typescript
// 创建弧线飞行路径
const midPoint = new THREE.Vector3().lerpVectors(start, end, 0.5);
midPoint.y += distance * 0.3; // 向上抬高30%

const curve = new THREE.QuadraticBezierCurve3(start, midPoint, end);

// requestAnimationFrame平滑更新
const point = curve.getPoint(progress);
camera.position.copy(point);
camera.lookAt(targetPos);
```

## 🔧 后端架构

### FastAPI服务

#### 路由设计

```python
# 健康检查
GET  /              → {"message": "Stelladream API"}

# 配置信息
GET  /api/config    → 领域配置、颜色映射

# 星图数据
GET  /api/star-data?limit=1000 → 星点坐标数据

# RAG检索
POST /api/search    → BM25+kNN+RRF+Reranker结果

# 评估数据（预留）
GET  /api/eval/{domain} → 评估回放数据
```

#### CORS配置

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发环境允许所有源
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### RAG检索引擎

#### 模块设计

```python
class RAGSearchEngine:
    def __init__(self):
        self.embedder = Embedder()      # BGE-large-zh-v1.5
        self.reranker = Reranker()      # BGE-reranker-large
        self.es = Elasticsearch(...)
        
    def search_bm25(query, top_k=20) → List[Result]
    def search_knn(query, top_k=20) → List[Result]
    def rrf_fusion(bm25, knn, k=60) → List[Result]
    def search(query) → SearchResults
```

#### RRF算法实现

```python
def rrf_fusion(bm25_results, knn_results, k=60):
    """Reciprocal Rank Fusion"""
    rrf_scores = {}
    
    for chunk_id in all_ids:
        score = 0.0
        if chunk_id in bm25_ranks:
            score += 1.0 / (k + bm25_ranks[chunk_id])
        if chunk_id in knn_ranks:
            score += 1.0 / (k + knn_ranks[chunk_id])
        rrf_scores[chunk_id] = score
    
    return sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
```

### 模型加载

#### 单例模式

```python
_search_engine = None

def get_search_engine() -> RAGSearchEngine:
    global _search_engine
    if _search_engine is None:
        _search_engine = RAGSearchEngine()
    return _search_engine
```

**优点**：
- 模型只加载一次
- 后续请求复用已加载模型
- 第一次请求慢（30-40s），后续快（<5s）

## 💾 数据处理

### 数据准备流程

```
原始文档 (33,919个)
    ↓
分词 + 向量化 (BGE-large-zh-v1.5, 768维)
    ↓
写入Elasticsearch (content + embedding)
    ↓
TF-IDF计算 (亮度值)
    ↓
UMAP降维 (768维 → 3维)
    ↓
坐标缩放 (×15)
    ↓
导出JSON (star_data.json, 24MB)
```

### UMAP降维

```python
from umap import UMAP

reducer = UMAP(
    n_components=3,
    n_neighbors=15,
    min_dist=0.1,
    random_state=42,
    verbose=True
)

coords_3d = reducer.fit_transform(embeddings)
coords_3d = coords_3d * 15  # 放大坐标
```

**参数说明**：
- `n_neighbors=15`: 保留局部结构
- `min_dist=0.1`: 允许点更紧密
- `random_state=42`: 可复现

### 数据结构

#### star_data.json

```json
[
  {
    "x": 52.87,
    "y": -80.91,
    "z": 96.97,
    "domain": "medical",
    "chunk_id": "doc_000001",
    "content": "文档内容...",
    "source": "来源文件.html",
    "size": 7.84,
    "brightness": 0.83
  },
  ...
]
```

#### Elasticsearch映射

```json
{
  "mappings": {
    "properties": {
      "content": {
        "type": "text",
        "analyzer": "ik_smart"
      },
      "embedding": {
        "type": "dense_vector",
        "dims": 768,
        "index": true,
        "similarity": "cosine"
      },
      "domain": { "type": "keyword" },
      "source": { "type": "keyword" }
    }
  }
}
```

## 🔍 检索流程

### 完整流程图

```
用户输入："感冒的治疗方法"
    ↓
┌─────────────────────────────────────────┐
│ Step 1: BM25关键词召回                   │
│ - 分词：["感冒", "治疗", "方法"]        │
│ - ES match查询                           │
│ - Top 20结果                             │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────┴───────────────────────┐
│ Step 2: kNN向量召回                      │
│ - BGE-large-zh-v1.5编码查询              │
│ - ES kNN搜索 (cosine相似度)              │
│ - Top 20结果                             │
└─────────────────┬───────────────────────┘
                  │
                  ├────────┬────────┐
                  ↓        ↓        ↓
              BM25结果  kNN结果
                  └────────┴────────┘
                          ↓
┌─────────────────────────────────────────┐
│ Step 3: RRF融合                          │
│ - 计算RRF分数                            │
│ - score = Σ(1/(k+rank))                 │
│ - Top 5结果                              │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ Step 4: Reranker精排                     │
│ - BGE-reranker-large重排序               │
│ - 计算query-doc相关性                    │
│ - Top 1最终结果                          │
└─────────────────┬───────────────────────┘
                  ↓
            最终文档
```

### 动画映射

| 检索阶段 | 动画效果 | 颜色 | 时长 |
|---------|---------|------|------|
| BM25召回 | 黄色流星 + 星点放大2.2倍 | #FFD700 | 0.8s |
| kNN召回 | 蓝色流星 + 星点放大2.2倍 | #60A5FA | 0.8s |
| RRF Top5 | 紫色流星 + 星点放大2.8倍 | #A78BFA | 0.8s |
| Reranker | 绿色辉光 + 星点放大5倍 + 相机飞行 | #34D399 | 1.8s |

## 🎯 性能指标

### 前端性能

| 指标 | 1000星点 | 5000星点 | 10000星点 |
|------|----------|----------|-----------|
| 初始加载 | 2s | 4s | 8s |
| 帧率 (FPS) | 60 | 45-60 | 30-45 |
| 内存占用 | 200MB | 350MB | 600MB |
| 搜索动画 | 流畅 | 流畅 | 较卡顿 |

### 后端性能

| 操作 | 首次 | 后续 | 优化方案 |
|------|------|------|----------|
| 模型加载 | 30-40s | - | 预热 |
| BM25检索 | 200ms | 100ms | 索引优化 |
| kNN检索 | 500ms | 300ms | GPU加速 |
| Reranker | 2s | 1s | 批量推理 |
| 总计 | 35s | 3-5s | - |

## 🔐 安全考虑

### 输入验证

```python
class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
```

### 速率限制（建议）

```python
from slowapi import Limiter

limiter = Limiter(key_func=get_remote_address)

@app.post("/api/search")
@limiter.limit("10/minute")
async def search(...):
    ...
```

### CORS配置

生产环境建议：

```python
allow_origins=[
    "https://your-domain.com",
    "https://www.your-domain.com"
]
```

## 📈 扩展性

### 水平扩展

```
                    Nginx负载均衡
                         │
         ┌───────────────┼───────────────┐
         ↓               ↓               ↓
    Backend 1       Backend 2       Backend 3
         │               │               │
         └───────────────┴───────────────┘
                         │
                   Elasticsearch集群
```

### 模型服务化

```
FastAPI Backend
    ↓ HTTP
Model Service (独立部署)
    ├── BGE Embedder
    └── BGE Reranker
```

## 🧪 测试策略

### 单元测试

```python
# backend/tests/test_rag_search.py
def test_bm25_recall():
    engine = RAGSearchEngine()
    results = engine.search_bm25("感冒", top_k=20)
    assert len(results) <= 20
    assert all('chunk_id' in r for r in results)
```

### 集成测试

```typescript
// frontend/tests/e2e/search.spec.ts
test('search animation completes', async ({ page }) => {
  await page.goto('/');
  await page.fill('input[type="text"]', '感冒');
  await page.press('input[type="text"]', 'Enter');
  await page.waitForTimeout(6000);
  // 验证相机位置改变
});
```

## 📚 参考资料

- [Three.js Documentation](https://threejs.org/docs/)
- [GSAP Documentation](https://greensock.com/docs/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Elasticsearch Guide](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)
- [BGE Model](https://github.com/FlagOpen/FlagEmbedding)
- [UMAP](https://umap-learn.readthedocs.io/)

---

**文档版本**: 1.0.0  
**最后更新**: 2026-07-11
