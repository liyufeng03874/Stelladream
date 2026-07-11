# Star Atlas (Cosmos) — Claude Code 执行手册

> 项目名称：Cosmos（Star Atlas）
> 项目目录：D:\code\star-map\
> 目标：AI 语义空间 3D 可视化，面试项目组合第三块
> 前置项目：D:\code\other-world（RAG 系统）

---

## 一、项目概览

### 1.1 定位
让 RAG 系统的语义空间"可见"。从 `other-world` 的 `unified_rag` ES 索引（33,919 条文档）导出 embedding，UMAP 降维到 3D，用 Three.js 渲染成可交互的星图。

### 1.2 核心价值
- **面试演示**：查询飞轮动画 → 两路召回 → RRF 融合 → Reranker 精排
- **评估回放**：Run 007-009 的 1500 条样本，按领域 Tab 切换，NDCG@5 指标曲线
- **知识宇宙**：按时间线入场动画（游戏 → 医疗 → 百科）

### 1.3 技术栈
| 层 | 技术 |
|---|------|
| 前端 | Vue 3 + TypeScript + Vite + Three.js |
| 后端 | FastAPI + Python |
| Embedding | BGE-large-zh（复用 other-world） |
| 降维 | UMAP (umap-learn) |
| 数据源 | ES `unified_rag` 索引（33,919 条） |

---

## 二、项目结构

```
D:\code\star-map\
├── shared/
│   └── config.json         # 颜色映射、领域配置、渲染参数
├── backend/
│   ├── export_from_es.py   # 从 unified_rag 导出文档 + embedding
│   ├── compute_tfidf_entropy.py  # TF-IDF 熵值
│   ├── umap_reduce.py      # UMAP 降维到 3D
│   ├── server.py           # FastAPI API（搜索 + Reranker）
│   └── requirements.txt
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.vue
│       ├── components/
│       │   ├── StarField.vue    # Three.js 3D 场景
│       │   ├── SearchBar.vue    # 搜索栏 + 查询飞轮
│       │   ├── InfoPanel.vue    # 详情面板
│       │   └── EvalReplay.vue   # 评估回放 + 进度条
│       └── api/index.ts
└── data/
    └── star_data.json       # [{x,y,z,domain,chunk_id,content,source,size,brightness}, ...]
```

---

## 三、视觉编码

### 3.1 领域颜色

| 领域 | 颜色 | Hex |
|------|------|-----|
| 医疗（KUAKE-QTR） | 蓝 | `#4A9AF5` |
| 法律（CAIL2018） | 红 | `#E74C3C` |
| 百科（CMRC2018） | 绿 | `#2ECC71` |
| 游戏攻略 | 金 | `#F5A623` |

### 3.2 视觉映射
- **大小**：chunk 长度 → 对数缩放 → [2, 12] 像素
- **亮度**：TF-IDF 信息熵 → 归一化 [0.3, 1.0]
- **渲染**：Sprite + canvas 生成的圆形纹理（32×32）

### 3.3 语义簇（星云）
- UMAP 降维后同领域文档自然聚簇
- KDE 核密度估计生成半透明外壳
- Hover 显示该区域关键词云

---

## 四、数据流（核心 Pipeline）

### Step 1：从 ES 导出

**数据源**：`http://localhost:9200`，索引名 `unified_rag`（33,919 条文档）

```python
from elasticsearch import Elasticsearch, helpers

es = Elasticsearch("http://localhost:9200")
docs = list(helpers.scan(es, index="unified_rag", size=2000))

# 每条文档字段：id, content, source
# domain 推断：
#   source 含 "kuake" → medical
#   source 含 "cail"  → law
#   source 含 "cmrc"  → general
#   其他 → game
```

**⚠️ 关键教训**：
- 用 `helpers.scan()` 而不是 `search(from_, size)`，因为 ES 默认限制 10,000 条深度分页
- `scan` 自动处理 scroll，不会超时

### Step 2：提取 Embedding

复用 `D:\code\other-world\backend\rag\embedder.py`：

```python
import sys
sys.path.insert(0, "D:/code/other-world/backend")
from rag.embedder import Embedder

embedder = Embedder()  # 自动加载 E:/ai/models/bge-large-zh-v1.5
embeddings = embedder.encode(texts).numpy()  # N × 1024
```

**⚠️ 关键教训**：
- Embedder 加载模型需要 GPU，如果 GPU 内存不足（8GB），需分批 encode（每批 500 条）
- 模型路径 `E:/ai/models/bge-large-zh-v1.5` 硬编码在配置中，不要改

### Step 3：TF-IDF 熵值

```python
from sklearn.feature_extraction.text import TfidfVectorizer
import numpy as np

vectorizer = TfidfVectorizer(max_features=10000)
tfidf_matrix = vectorizer.fit_transform(texts)
# 对每行计算熵
entropies = []
for row in tfidf_matrix:
    probs = row.data / row.data.sum()
    entropy = -np.sum(probs * np.log(probs + 1e-10))
    entropies.append(entropy)
# 归一化到 [0.3, 1.0]
```

### Step 4：UMAP 降维

```python
import umap

reducer = umap.UMAP(n_components=3, n_neighbors=15, min_dist=0.1, random_state=42)
coords_3d = reducer.fit_transform(embeddings)  # N × 3
```

**⚠️ 关键教训**：
- UMAP 对 34K 条 1024 维数据需要约 15-30 分钟，CPU 模式即可
- `n_neighbors=15` 控制局部 vs 全局结构的平衡

### Step 5：导出 star_data.json

```json
[
  {
    "x": 12.3, "y": -5.6, "z": 8.9,
    "domain": "medical",
    "chunk_id": "doc_000123",
    "content": "感冒可服用复方北豆根...",
    "source": "kuake_qtr",
    "size": 5.2,
    "brightness": 0.78
  }
]
```

---

## 五、后端 API（server.py）

### 5.1 搜索接口

```
POST /api/search
{
  "query": "感冒吃什么药"
}
→
{
  "bm25": [{"chunk_id": "...", "score": 8.5}, ...],
  "knn": [{"chunk_id": "...", "score": 0.92}, ...],
  "rrf_top5": [{"chunk_id": "...", "rrf_score": 0.032}, ...],
  "reranker_final": {"chunk_id": "...", "rerank_score": 4.5}
}
```

**流程**：
1. query → BM25（ik_smart 分词）→ Top-3
2. query → BGE embedding → kNN（cosine）→ Top-3
3. RRF 融合（k=60）→ Top-5
4. Reranker 精排 → Top-1 最终答案

### 5.2 评估回放数据接口

```
GET /api/eval/{domain}?step=123
→
{
  "query": "...",
  "results": ["chunk_id_1", ...],
  "is_correct": true,
  "ndcg_at_5": 0.85,
  "cumulative_ndcg": 0.72
}
```

三个 domain：`medical`、`law`、`general`

---

## 六、前端交互

### 6.1 3D 场景（StarField.vue）

- Three.js 场景 + PerspectiveCamera + OrbitControls
- Sprite + canvas 纹理渲染 34K 星点
- Raycaster 检测 Hover/Click
- ShaderMaterial 实现高亮效果

### 6.2 搜索 + RAG 联动

1. 用户输入 query → 后端三阶段检索
2. **查询飞轮动画**：query 变临时星点，带引力效果
3. **淡蓝色线**：BM25 Top-3 结果
4. **淡紫色线**：kNN Top-3 结果
5. **汇聚**：两路结果合并到 RRF Top-5 候选区域
6. **粗白线**：Reranker 最终答案

### 6.3 评估回放（EvalReplay.vue）

- 三个 Tab：医疗（Run 007）、法律（Run 008）、百科（Run 009）
- 每个 Tab 500 条样本
- 统一指标：**NDCG@5**
- **进度条**：拖拽瞬间跳转，星图高亮同步
- 指标曲线实时更新

### 6.4 时间动画

- 星点按"索引时间"分三批入场：
  1. 游戏攻略（2026-07-08）
  2. 医疗（2026-07-10）
  3. 百科（2026-07-10）

---

## 七、执行步骤（按 Phase 顺序）

### Phase 0：环境搭建
- `mkdir D:\code\star-map`
- `cd frontend && npm create vite@latest . -- --template vue-ts`
- 安装 Three.js、vue-router、axios
- 初始化后端 FastAPI + requirements.txt
- 创建 `shared/config.json`

### Phase 1：数据准备
- 写 `export_from_es.py`（从 unified_rag 导出）
- 写 `compute_tfidf_entropy.py`（TF-IDF 熵值）
- 写 `umap_reduce.py`（UMAP 降维）
- 运行完整 Pipeline → 生成 `data/star_data.json`

### Phase 2：3D 星图基础
- Three.js 场景搭建
- Sprite + canvas 纹理渲染
- OrbitControls
- 颜色/大小/亮度映射

### Phase 3：交互
- Hover 高亮 + tooltip
- Click 详情面板
- 语义簇星云渲染

### Phase 4：搜索 + RAG 联动
- 搜索栏 UI
- 后端 BM25 + kNN + RRF + Reranker
- 查询飞轮动画
- 两叉线 → 汇聚 → 粗线锁定

### Phase 5：评估回放
- 导出 Run 007-009 数据
- 三个 Tab + NDCG@5 曲线
- 进度条拖拽 + 瞬间跳转

### Phase 6：优化
- 时间入场动画
- FPS 监控
- UI 美化

---

## 八、中途教训汇总（重要！）

### 8.1 从 other-world 继承的教训

| 问题 | 教训 |
|------|------|
| OOM（页面文件不足） | Embedder 编码大数据集时分批（500 条/批） |
| BM25 ID 不匹配 | BM25Index 的 doc_id 必须和测评集一致 |
| ES scroll 超时 | 用 `helpers.scan()` 自动处理 scroll |
| 索引隔离 | 每个领域独立索引路径，不混用 |
| 中文编码乱码 | print 不要用 emoji（✅❌），Windows GBK 不兼容 |
| Git push 网络断开 | 提交后及时 push，避免堆积 |
| 标注循环偏差 | Ground Truth 必须独立于检索结果 |
| BM25.save() 路径 | save() 方法需要接受 path 参数 |

### 8.2 不要做的事

- ❌ 不要用 `search(from_=N, size=1000)` 读取大量 ES 数据（深度分页限制 10K）
- ❌ 不要一次性向量化 150K 条文本（OOM）
- ❌ 不要用 Mesh 渲染 34K 个球体（卡死）
- ❌ 不要混用三个 FAISS 索引（统一用 `unified_rag`）

### 8.3 必须做的事

- ✅ 每步验证中间结果（导出后检查条数）
- ✅ 用 `helpers.scan()` 读取 ES
- ✅ 分批 Embedding（500 条/批）
- ✅ 进度条反馈（UMAP 可能需要 30 分钟）

---

## 九、关键依赖路径

```
# Embedding 模型
E:/ai/models/bge-large-zh-v1.5/
E:/ai/models/bge-reranker-large/

# Conda 环境
D:\miniconda3\envs\aivenv\python.exe

# 数据源
ES: http://localhost:9200
索引名: unified_rag (33,919 条)

# 前置项目代码复用
D:\code\other-world\backend\rag\embedder.py        # Embedding
D:\code\other-world\backend\rag\retriever\reranker.py  # Reranker
```

---

## 十、验证清单

- [ ] `data/star_data.json` 存在，33,919 条
- [ ] 3D 场景渲染 34K 星点，FPS > 30
- [ ] Hover 高亮 + tooltip 正常
- [ ] Click 显示详情面板
- [ ] 搜索 query 返回 BM25 + kNN + RRF + Reranker 结果
- [ ] 查询飞轮动画流畅
- [ ] 评估回放三个 Tab 切换正常
- [ ] 进度条拖拽瞬间跳转
- [ ] 时间入场动画按顺序播放

---

_这份文档包含项目全部上下文和执行步骤。按 Phase 顺序执行，每步验证后再进入下一步。_
