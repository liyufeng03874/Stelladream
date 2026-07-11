# Stelladream - 3D Star Atlas for AI Semantic Space

> 让RAG系统的语义空间"可见" - 将33,919条文档的embedding通过UMAP降维渲染成可交互的3D星图

## 项目概述

这是一个将RAG检索系统的语义空间可视化的项目，通过3D星图的形式展示文档的语义分布、检索过程和评估结果。

### 核心功能

- **3D星图渲染**：34K+文档点，按领域着色，支持缩放、旋转、悬停
- **RAG流程可视化**：BM25 + kNN + RRF + Reranker 四阶段检索动画
- **评估回放**：医疗/法律/百科三个领域的NDCG@5指标动画展示
- **语义星云**：同领域文档自动聚簇，KDE密度估计生成半透明外壳

## 技术栈

- **前端**：Vue 3 + TypeScript + Vite + Three.js
- **后端**：FastAPI + Python
- **AI模型**：BGE-large-zh (embedding) + BGE-reranker-large
- **降维算法**：UMAP
- **数据源**：Elasticsearch unified_rag索引

## 项目结构

```
Stelladream/
├── shared/          # 前后端共享配置
├── backend/         # Python后端（数据处理+API）
├── frontend/        # Vue前端（3D渲染+交互）
└── data/           # 生成的星图数据（gitignore）
```

## 快速开始

详见 [CLAUDE_CODE_EXECUTION.md](./CLAUDE_CODE_EXECUTION.md)

## 视觉编码

| 属性 | 映射规则 |
|------|----------|
| **颜色** | 医疗(蓝) / 法律(红) / 百科(绿) / 游戏(金) |
| **大小** | chunk长度 → 对数缩放 [2,12]px |
| **亮度** | TF-IDF熵值 → [0.3, 1.0] |

## 开发计划

- [x] Phase 0: 项目初始化
- [ ] Phase 1: 数据准备（ES导出 + UMAP降维）
- [ ] Phase 2: 3D星图基础渲染
- [ ] Phase 3: 交互功能（hover/click）
- [ ] Phase 4: RAG检索可视化
- [ ] Phase 5: 评估回放系统
- [ ] Phase 6: 性能优化与美化

## License

MIT
