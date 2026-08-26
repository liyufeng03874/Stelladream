# Stelladream - 3D RAG 检索可视化系统

将 RAG 检索过程渲染成星空中的一段搜索旅程。当前版本已经包含 3D 星图、搜索动画、星点详情、评估回放和指标趋势图。

## 当前实现

- 33,919 个星点的 3D 星图
- Vue 3 + Three.js + GSAP 前端
- FastAPI + Elasticsearch 后端
- 通过 `other-world` HTTP API 做 embedding 和 rerank
- `EvalReplay` 评估回放，支持 medical / law / general 三个领域

## 运行方式

### 本地开发

```bash
# 后端
cd backend
pip install -r requirements.txt
python server.py

# 前端
cd frontend
npm install
npm run dev
```

- 前端开发地址: `http://localhost:5175`
- 后端开发地址: `http://localhost:8000`

### Docker

```bash
docker compose up --build
```

- 后端: `http://localhost:8002`
- 前端: `http://localhost:8012`

## 接口

- `GET /api/config`
- `GET /api/star-data`
- `POST /api/search`
- `GET /api/eval/{domain}?step=0`

## 项目结构

- `frontend/` 前端应用
- `backend/` FastAPI + RAG 检索
- `data/` 星图和评估数据
- `shared/` 共享配置
- `docs/` 设计和联动说明

## 数据说明

- `data/star_data.json` 使用 `source_path = ES _id`
- `data/eval/*.json` 每个领域 500 条样本

## 备注

- 前端开发代理默认把 `/api` 转到 `http://localhost:8000`
- 后端搜索依赖 Elasticsearch 和 `other-world` 服务
