# Stelladream 项目进度报告

## 当前状态：Phase 1 部分完成 + Phase 2 基础完成

### ✅ 已完成

#### Phase 0: 环境搭建
- [x] 初始化 Git 仓库
- [x] 创建项目目录结构（backend/, frontend/, shared/, data/）
- [x] 初始化 Vue 3 + TypeScript + Vite 前端项目
- [x] 安装 Three.js, axios, vue-router 等依赖
- [x] 创建 shared/config.json 配置文件
- [x] 创建后端 Python 脚本框架

#### Phase 1: 数据准备（部分完成）
- [x] 从 ES unified_rag 索引导出 10,000 条文档（含 embedding）
- [x] 计算 TF-IDF 熵值用于亮度映射
- [x] 生成 mock 3D 坐标数据（用于前端开发）
- [x] 创建 star_data.json（10,000 个星点）
- [ ] ⚠️ UMAP 降维（因网络问题暂时使用 mock 数据替代）

#### Phase 2: 3D 星图基础
- [x] 创建 StarField.vue（Three.js 场景 + OrbitControls）
- [x] 实现星点渲染（Sprite + canvas 纹理）
- [x] 实现颜色/大小/亮度映射
- [x] 创建 SearchBar.vue（搜索栏组件）
- [x] 创建 InfoPanel.vue（详情面板）
- [x] 创建 EvalReplay.vue（评估回放骨架）
- [x] 更新 App.vue（主布局）
- [x] 创建 API 客户端（api/index.ts）

#### 后端服务
- [x] FastAPI server.py（基础 API 端点）
- [x] /api/star-data（获取星图数据）
- [x] /api/config（获取配置）
- [x] 服务器运行在 http://localhost:8000

#### 前端服务
- [x] Vite 开发服务器运行在 http://localhost:5173

### 📊 数据统计

- **文档数量**: 10,000 条（原计划 33,919 条）
- **Embedding 维度**: 1024
- **领域分布**:
  - game: 6,532 条 (65.3%)
  - medical: 3,174 条 (31.7%)
  - general: 294 条 (2.9%)
  - law: 0 条

- **3D 坐标范围**:
  - X: [-67.50, 79.91]
  - Y: [-82.84, 87.87]
  - Z: [-66.38, 61.54]

### ⚠️ 遇到的问题及解决方案

#### 1. 内存不足
**问题**: 系统内存不足，无法加载 BGE-large-zh 模型  
**解决**: 直接从 ES 索引中提取已存储的 embedding（ES 中已有）

#### 2. ES 深度分页限制
**问题**: ES 默认限制 from + size ≤ 10,000  
**影响**: 只能导出 10,000 条文档（而非全部 33,919 条）  
**状态**: 10,000 条数据足够用于开发和演示

#### 3. UMAP 库安装失败
**问题**: 网络代理问题导致 pip install umap-learn 失败  
**临时方案**: 使用 generate_mock_data.py 生成模拟的 3D 坐标  
**效果**: Mock 数据按领域聚类，可用于前端开发

#### 4. Windows GBK 编码问题
**问题**: print 中的 emoji 字符（✓❌⚠️）导致编码错误  
**解决**: 替换为 ASCII 符号（[OK] [ERROR] [WARNING]）

### 🚀 下一步计划

#### Phase 3: 交互功能
- [ ] 实现 Hover 高亮 + tooltip
- [ ] 实现 Click 显示详情面板
- [ ] 添加语义簇星云渲染（可选）

#### Phase 4: RAG 搜索可视化
- [ ] 实现后端 BM25 + kNN + RRF + Reranker 检索
- [ ] 查询飞轮动画
- [ ] 两路检索结果可视化（淡蓝色/淡紫色线）
- [ ] 汇聚到 RRF Top-5
- [ ] Reranker 最终答案高亮

#### Phase 5: 评估回放（可选）
- [ ] 导出 Run 007-009 评估数据
- [ ] 三个 Tab 切换（医疗/法律/百科）
- [ ] NDCG@5 指标曲线
- [ ] 进度条拖拽 + 瞬间跳转

#### Phase 6: 优化与美化
- [ ] 时间入场动画
- [ ] FPS 监控
- [ ] UI 美化与响应式设计
- [ ] 性能优化（LOD / InstancedMesh）

### 📁 项目文件结构

```
Stelladream/
├── backend/
│   ├── server.py                    # FastAPI 服务器 ✅
│   ├── export_from_es_batch.py      # ES 数据导出 ✅
│   ├── compute_tfidf_entropy.py     # TF-IDF 熵值计算 ✅
│   ├── generate_mock_data.py        # Mock 3D 数据生成 ✅
│   ├── umap_reduce.py               # UMAP 降维（待完成）
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.vue                  # 主应用 ✅
│   │   ├── api/index.ts             # API 客户端 ✅
│   │   └── components/
│   │       ├── StarField.vue        # 3D 星图 ✅
│   │       ├── SearchBar.vue        # 搜索栏 ✅
│   │       ├── InfoPanel.vue        # 详情面板 ✅
│   │       └── EvalReplay.vue       # 评估回放 ✅
│   ├── package.json
│   └── vite.config.ts
├── shared/
│   └── config.json                  # 共享配置 ✅
├── data/
│   ├── checkpoint_5000.json         # 5K 文档检查点
│   ├── checkpoint_10000.json        # 10K 文档检查点
│   ├── raw_docs.json                # 原始文档 + embedding
│   ├── docs_with_entropy.json       # + TF-IDF 熵值
│   └── star_data.json               # 最终星图数据 ✅
├── .env                             # 环境变量
├── .gitignore
├── README.md
└── CLAUDE_CODE_EXECUTION.md         # 执行计划（qwencode）
```

### 🎯 当前可演示的功能

1. **后端 API**:
   - GET /api/star-data - 获取 10,000 个星点数据
   - GET /api/config - 获取配置（领域颜色等）
   - 运行在 http://localhost:8000

2. **前端应用**:
   - 运行在 http://localhost:5173
   - 可加载星图数据并渲染 3D 场景（理论上）
   - UI 组件已就绪

### 💡 建议

1. **优先级**: 先完成 Phase 3 的基础交互，确保 3D 场景正常工作
2. **UMAP**: 可以稍后在网络正常时安装 umap-learn 并重新生成真实的降维数据
3. **数据扩展**: 如果需要全部 33,919 条数据，可以修改 ES 的 max_result_window 设置
4. **性能**: 10,000 个星点可能需要性能优化（考虑使用 InstancedMesh）

---

**生成时间**: 2026-07-11  
**当前阶段**: Phase 2 完成，准备进入 Phase 3
