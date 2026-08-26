# Stelladream 架构说明

Stelladream 是一个前后端分离的 RAG 可视化系统，把检索过程映射成 3D 星图里的动画。

## 总体链路

```text
浏览器
  -> Vue 3 前端
  -> FastAPI 后端
  -> Elasticsearch + other-world HTTP API
  -> 返回星图、检索结果和评估数据
```

## 前端

- 入口: `frontend/src/main.ts`
- 根组件: `frontend/src/App.vue`
- 3D 场景: `frontend/src/components/StarField.vue`
- 搜索动画: `frontend/src/composables/useSearchAnimation.ts`
- 评估回放: `frontend/src/components/EvalReplay.vue` + `frontend/src/composables/useEvalVisual.ts`

前端负责：

- 加载星图配置和星点数据
- 渲染 Three.js 星空
- 处理搜索、星点详情、星跃和评估回放

## 后端

- 启动文件: `backend/server.py`
- 检索引擎: `backend/rag_search.py`

后端负责：

- `GET /api/config`
- `GET /api/star-data`
- `POST /api/search`
- `GET /api/eval/{domain}`

检索流程是：

1. Elasticsearch BM25 召回
2. `other-world` 提供 embedding，ES 做 kNN 召回
3. 本地做 RRF 融合
4. `other-world` 提供 rerank

## 数据

- `data/star_data.json`: 33,919 个星点
- `data/eval/*.json`: medical / law / general，每个 500 条样本
- `shared/config.json`: 领域颜色、视觉参数、ES 和 RRF 配置

## 现状

- 当前前端会直接渲染全部加载到内存的星点
- 仓库根目录的 `src/` 是旧入口，当前实际使用的是 `frontend/src/`
- 文档和代码之间存在少量历史漂移，以上内容以当前代码为准
