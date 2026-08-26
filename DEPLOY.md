# Stelladream 部署指南

## 依赖

- Python 3.10+
- Node.js 18+
- Elasticsearch 8.x
- `other-world` 服务

## 本地开发

### 后端

```bash
cd backend
pip install -r requirements.txt
python server.py
```

默认端口: `8000`

### 前端

```bash
cd frontend
npm install
npm run dev
```

默认端口: `5175`

## Docker

```bash
docker compose up --build
```

- 后端: `http://localhost:8002`
- 前端: `http://localhost:8012`

当前 `docker-compose.yml` 还依赖以下条件：

- 后端容器通过 `ES_URL=http://es:9200` 访问 Elasticsearch
- 后端容器通过 `OTHER_WORLD_API_URL=http://otherworld-backend:8000` 访问 embedding / rerank 服务
- Compose 使用外部网络 `projects_default`

## 环境变量

- `ES_URL`
- `OTHER_WORLD_API_URL`
- `VITE_API_BASE_URL`（前端可选）

## 共享配置

`shared/config.json` 里包含：

- 领域颜色
- 视觉参数
- Elasticsearch 地址与索引名
- RRF 参数

## 备注

- 当前后端检索不是本地直连模型，而是调用 `other-world` 的 embedding / rerank 接口
- 前端开发环境会把 `/api` 代理到后端
