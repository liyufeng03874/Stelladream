# Stelladream - 3D RAG 星图可视化系统

Stelladream 是一个把检索过程可视化到 3D 星图中的 RAG 解释系统。它把查询、BM25、kNN、RRF、最终命中和评估回放串成一条可观察的链路，方便理解“为什么是这个结果”。

## 当前状态

- 前端：Vue 3 + Three.js + GSAP
- 后端：FastAPI + Elasticsearch
- 当前实际使用的索引：`lecard_m3_doc`
- 支持单次查询的检索可视化、阶段切换、文档详情、星跃
- 支持评估回放、趋势图、命中关系展示、回放清理
- 蓝青科技风主题已统一到主界面和回放链路

## 核心功能

- 3D 星图检索展示
- 查询后按阶段展示 BM25 / kNN / RRF / FINAL 命中
- 星星高亮、飞线、标签、文档详情联动
- 评估回放与趋势图同步
- 回放中命中星星的关联关系可视化
- 支持按领域和样本步进回放

## 运行方式

### 本地开发

后端：

```bash
cd backend
conda activate aivenv
pip install -r requirements.txt
python server.py
```

前端：

```bash
cd frontend
npm install
npm run dev
```

- 前端地址：`http://localhost:5175`
- 后端地址：`http://localhost:8000`

### Docker

```bash
docker compose up --build
```

## 接口

- `GET /api/config`
- `GET /api/star-data`
- `POST /api/search`
- `GET /api/eval/{domain}?step=0`

## 项目结构

- `frontend/` 前端应用
- `backend/` FastAPI 服务与检索逻辑
- `data/` 星图数据与评估数据
- `shared/` 共享配置
- `docs/` 设计说明、路线图、优化总结

## 数据说明

- 星图数据由真实索引 `lecard_m3_doc` 生成
- 评估数据位于 `data/eval/`
- 相关生成脚本位于 `backend/`

## 文档

- [产品路线图](docs/product-roadmap.md)
- [评估回放优化总结](docs/eval-replay-optimization-summary.md)
- [评估回放联动说明](docs/eval-replay-linkage.md)
- [星跃生命周期](docs/star-lifecycle.md)

