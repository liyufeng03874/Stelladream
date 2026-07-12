# Stelladream API 文档

本文档详细说明Stelladream后端提供的所有API接口。

## 📡 基础信息

- **Base URL**: `http://localhost:8000`
- **协议**: HTTP/1.1
- **Content-Type**: `application/json`
- **超时时间**: 120秒（搜索接口）

## 🔗 接口列表

### 1. 健康检查

检查API服务是否正常运行。

**请求**

```http
GET / HTTP/1.1
Host: localhost:8000
```

**响应**

```json
{
  "message": "Stelladream API",
  "version": "0.1.0"
}
```

**状态码**

- `200 OK`: 服务正常运行

---

### 2. 获取配置信息

获取领域配置、颜色映射等前端配置信息。

**请求**

```http
GET /api/config HTTP/1.1
Host: localhost:8000
```

**响应**

```json
{
  "domains": {
    "medical": {
      "name": "医疗",
      "color": "#FF6B6B"
    },
    "finance": {
      "name": "金融",
      "color": "#4ECDC4"
    },
    "legal": {
      "name": "法律",
      "color": "#95E1D3"
    },
    "general": {
      "name": "通用",
      "color": "#F8B195"
    }
  },
  "visual": {
    "size": {
      "min": 0.1,
      "max": 1.5,
      "logBase": 10
    },
    "brightness": {
      "min": 0.3,
      "max": 1.0
    }
  }
}
```

**状态码**

- `200 OK`: 成功获取配置
- `500 Internal Server Error`: 配置文件读取失败

---

### 3. 获取星图数据

获取用于3D渲染的星点坐标数据。

**请求**

```http
GET /api/star-data?limit=1000 HTTP/1.1
Host: localhost:8000
```

**查询参数**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| limit | integer | 否 | 1000 | 返回的星点数量，范围1-33919 |

**响应**

```json
{
  "count": 33919,
  "displayed": 1000,
  "data": [
    {
      "x": 52.87,
      "y": -80.91,
      "z": 96.97,
      "domain": "medical",
      "chunk_id": "doc_000001",
      "content": "文档内容片段...",
      "source": "document.html",
      "size": 7.84,
      "brightness": 0.83
    },
    ...
  ]
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| count | integer | 总星点数量 |
| displayed | integer | 实际返回的星点数量 |
| data | array | 星点数据数组 |
| data[].x | float | X坐标 |
| data[].y | float | Y坐标 |
| data[].z | float | Z坐标 |
| data[].domain | string | 领域标识 |
| data[].chunk_id | string | 文档块ID |
| data[].content | string | 文档内容 |
| data[].source | string | 来源文件名 |
| data[].size | float | 星点大小（对数缩放） |
| data[].brightness | float | 星点亮度（TF-IDF熵值） |

**状态码**

- `200 OK`: 成功获取数据
- `404 Not Found`: 星图数据文件不存在
- `500 Internal Server Error`: 文件读取失败

**示例**

```bash
# 获取默认1000个星点
curl http://localhost:8000/api/star-data

# 获取5000个星点
curl "http://localhost:8000/api/star-data?limit=5000"
```

---

### 4. RAG搜索

执行完整的RAG检索流程，返回BM25、kNN、RRF和Reranker的结果。

**请求**

```http
POST /api/search HTTP/1.1
Host: localhost:8000
Content-Type: application/json

{
  "query": "感冒的治疗方法"
}
```

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索查询词，长度1-200字符 |

**响应**

```json
{
  "bm25": [
    {
      "chunk_id": "doc_023330",
      "score": 15.342,
      "rank": 1,
      "content": "感冒是由病毒引起的上呼吸道感染...",
      "source": "medical_wiki.html"
    },
    ...
  ],
  "knn": [
    {
      "chunk_id": "doc_019297",
      "score": 0.892,
      "rank": 1,
      "content": "感冒的治疗主要是对症治疗...",
      "source": "treatment_guide.html"
    },
    ...
  ],
  "rrf_top5": [
    {
      "chunk_id": "doc_023330",
      "rrf_score": 0.0326,
      "rank": 1,
      "content": "感冒是由病毒引起的上呼吸道感染...",
      "source": "medical_wiki.html"
    },
    ...
  ],
  "reranker_final": {
    "chunk_id": "doc_023330",
    "rrf_score": 0.0326,
    "rank": 1,
    "content": "感冒是由病毒引起的上呼吸道感染...",
    "source": "medical_wiki.html",
    "rerank_score": 0.945
  }
}
```

**响应字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| bm25 | array | BM25关键词召回结果（最多20条） |
| bm25[].chunk_id | string | 文档块ID |
| bm25[].score | float | BM25分数（越高越相关） |
| bm25[].rank | integer | 排名（1为最高） |
| bm25[].content | string | 文档内容 |
| bm25[].source | string | 来源文件 |
| knn | array | kNN向量召回结果（最多20条） |
| knn[].score | float | 余弦相似度（0-1，越高越相关） |
| rrf_top5 | array | RRF融合后的Top 5结果 |
| rrf_top5[].rrf_score | float | RRF分数（越高越相关） |
| reranker_final | object/null | Reranker精排后的最终结果 |
| reranker_final.rerank_score | float | Reranker分数（0-1，越高越相关） |

**检索流程**

1. **BM25召回** (200ms)
   - 使用Elasticsearch的match查询
   - 基于TF-IDF的关键词匹配
   - 返回Top 20

2. **kNN召回** (500ms)
   - 使用BGE-large-zh-v1.5编码查询
   - Elasticsearch kNN搜索
   - 余弦相似度排序
   - 返回Top 20

3. **RRF融合** (10ms)
   - Reciprocal Rank Fusion算法
   - 公式: `score = Σ(1/(k+rank))`，k=60
   - 合并BM25和kNN结果
   - 返回Top 5

4. **Reranker精排** (2s)
   - 使用BGE-reranker-large重排序
   - 计算query-document相关性
   - 返回Top 1

**状态码**

- `200 OK`: 搜索成功
- `400 Bad Request`: 请求参数错误
- `500 Internal Server Error`: 搜索失败（详见detail）
- `504 Gateway Timeout`: 搜索超时（>120秒）

**错误响应**

```json
{
  "detail": "错误描述信息"
}
```

**性能指标**

| 阶段 | 首次请求 | 后续请求 | 说明 |
|------|----------|----------|------|
| 模型加载 | 30-40s | 0s | 首次需加载BGE模型 |
| BM25检索 | 200ms | 100ms | - |
| kNN检索 | 500ms | 300ms | - |
| RRF融合 | 10ms | 10ms | - |
| Reranker | 2s | 1s | GPU加速可提升 |
| **总计** | **35-40s** | **3-5s** | - |

**示例**

```bash
# cURL请求
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"感冒的治疗方法"}'

# Python请求
import requests

response = requests.post(
    'http://localhost:8000/api/search',
    json={'query': '感冒的治疗方法'},
    timeout=120
)
results = response.json()

# JavaScript请求
const response = await fetch('http://localhost:8000/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '感冒的治疗方法' })
});
const results = await response.json();
```

---

### 5. 获取评估数据（预留）

获取特定领域的评估回放数据。

**请求**

```http
GET /api/eval/{domain} HTTP/1.1
Host: localhost:8000
```

**路径参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| domain | string | 领域标识（medical/finance/legal/general） |

**响应**

```json
{
  "domain": "medical",
  "metrics": {
    "ndcg@5": 0.842,
    "mrr": 0.765,
    "precision@5": 0.880
  },
  "samples": [
    {
      "query": "糖尿病治疗",
      "ground_truth": "doc_012345",
      "retrieved": ["doc_012345", "doc_067890", ...],
      "ndcg@5": 0.95
    },
    ...
  ]
}
```

**状态码**

- `200 OK`: 成功获取数据
- `404 Not Found`: 领域不存在或数据未生成
- `501 Not Implemented`: 功能未实现

---

## 🔧 错误处理

### 标准错误响应

所有错误都返回统一格式：

```json
{
  "detail": "错误描述信息"
}
```

### 常见错误

#### 1. 请求参数错误

```json
{
  "detail": [
    {
      "loc": ["body", "query"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

#### 2. 超时错误

前端配置了120秒超时，如果搜索超过此时间会抛出：

```javascript
{
  "message": "timeout of 120000ms exceeded"
}
```

#### 3. Elasticsearch连接失败

```json
{
  "detail": "ConnectionError: Unable to connect to Elasticsearch"
}
```

#### 4. 模型加载失败

```json
{
  "detail": "ModuleNotFoundError: No module named 'rag'"
}
```

---

## 🔐 安全建议

### 生产环境配置

1. **启用CORS白名单**
   ```python
   allow_origins=[
       "https://your-domain.com"
   ]
   ```

2. **添加速率限制**
   ```python
   @limiter.limit("10/minute")
   async def search(...):
   ```

3. **启用HTTPS**
   - 使用Nginx反向代理
   - 配置SSL证书

4. **添加API密钥**
   ```python
   @app.post("/api/search")
   async def search(
       request: SearchRequest,
       api_key: str = Header(...)
   ):
   ```

5. **输入验证**
   - 限制查询长度（1-200字符）
   - 过滤特殊字符
   - 防止SQL注入（虽然使用ES）

---

## 📊 监控指标

### 推荐监控项

1. **请求指标**
   - QPS（每秒查询数）
   - 响应时间（P50, P95, P99）
   - 错误率

2. **资源指标**
   - CPU使用率
   - 内存使用率
   - GPU使用率（如果有）

3. **业务指标**
   - 搜索成功率
   - 平均检索时长
   - 模型推理延迟

### 日志格式

```python
import logging

logging.info(f"[search] query={query}, duration={duration}s, results={count}")
```

---

## 🧪 测试用例

### 搜索功能测试

```python
def test_search_api():
    # 正常搜索
    response = client.post('/api/search', json={'query': '感冒'})
    assert response.status_code == 200
    data = response.json()
    assert 'bm25' in data
    assert 'knn' in data
    assert 'rrf_top5' in data
    assert 'reranker_final' in data
    
    # 空查询
    response = client.post('/api/search', json={'query': ''})
    assert response.status_code == 422
    
    # 超长查询
    response = client.post('/api/search', json={'query': 'a' * 300})
    assert response.status_code == 422
```

---

## 📞 联系支持

如遇到API问题，请提供以下信息：

1. 请求URL和参数
2. 完整的错误响应
3. 后端日志输出
4. Elasticsearch状态

---

**API文档版本**: 1.0.0  
**最后更新**: 2026-07-11
