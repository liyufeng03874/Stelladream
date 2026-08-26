# Stelladream 项目状态

最后更新: 2026-08-26

## 当前结论

项目主链路已经成型：

- 3D 星图可用
- RAG 搜索动画可用
- 星点详情和星跃可用
- 评估回放和指标趋势图可用

## 当前数据

- 星图数据: `33,919` 个星点
- 评估数据:
  - `medical`: 500 条
  - `law`: 500 条
  - `general`: 500 条

## 当前运行口径

- 本地开发前端: `http://localhost:5175`
- 本地开发后端: `http://localhost:8000`
- Docker 前端: `http://localhost:8012`
- Docker 后端: `http://localhost:8002`

## 已完成

- Vue 3 + TypeScript + Vite 前端骨架
- FastAPI 后端
- Three.js 星图渲染
- ES BM25 + kNN + RRF + rerank 检索链路
- `EvalReplay` 回放面板
- `MetricsTrendChart` 指标趋势图
- Docker 基本部署脚本

## 待继续完善

- Hover tooltip 仍未完成
- 星图全量渲染还有性能优化空间
- 文档曾有较多历史漂移，现已开始对齐

## 近期建议

1. 明确并统一本地开发与 Docker 的端口说明
2. 做星图性能优化，比如 LOD、视锥剔除、实例化
3. 完成 hover tooltip 和筛选类交互
