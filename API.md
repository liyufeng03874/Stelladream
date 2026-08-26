# Stelladream API 文档

Base URL: `http://localhost:8000`

## `GET /`

健康检查。

```json
{ "message": "Stelladream API", "version": "0.1.0" }
```

## `GET /api/config`

返回共享配置，包含领域颜色、视觉参数、Elasticsearch 配置和 RRF 参数。

## `GET /api/star-data?limit=0`

返回星图数据。

- `limit=0` 表示返回全部
- 返回结构：

```json
{
  "count": 33919,
  "data": [
    {
      "x": 0,
      "y": 0,
      "z": 0,
      "domain": "medical",
      "chunk_id": "doc_000001",
      "source_path": "doc_000001",
      "content": "...",
      "source": "...",
      "size": 1.2,
      "brightness": 0.8
    }
  ]
}
```

## `POST /api/search`

请求体：

```json
{ "query": "感冒治疗" }
```

返回：

```json
{
  "bm25": [],
  "knn": [],
  "rrf_top5": [],
  "reranker_final": null
}
```

## `GET /api/eval/{domain}?step=0`

`domain` 可取 `medical`、`law`、`general`。

返回：

```json
{
  "current_metrics": {},
  "cumulative_metrics": {},
  "total_samples": 500,
  "current_step": 0,
  "retrieved_ids": [],
  "correct_ids": [],
  "query": "",
  "ranks": []
}
```

## 说明

- 前端开发代理默认把 `/api` 转发到 `http://localhost:8000`
- 搜索流程是 `BM25 + kNN + RRF + reranker`
- `kNN` 和 `rerank` 通过 `other-world` HTTP API 提供
