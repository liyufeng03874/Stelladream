"""
RAG 搜索逻辑封装（解耦版）

不再直接 import other-world 的代码，改为通过 HTTP 调用 other-world 的 API：
- /api/embed  → 文本向量化（BGE）
- /api/rerank → Cross-Encoder 精排

完整检索流程：
1. BM25 关键词召回（本地 ES）
2. kNN 向量召回（调 other-world /api/embed + 本地 ES）
3. RRF 融合（本地）
4. Reranker 精排（调 other-world /api/rerank）
"""

import os
import httpx
from typing import List, Dict, Any
from pathlib import Path
import json

from elasticsearch import Elasticsearch

# ===== 配置加载 =====
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

ES_CONFIG = config["elasticsearch"]
RRF_K = config["rrf"]["k"]

# other-world API 地址（Docker 内网 or 本机开发）
OTHER_WORLD_API = os.environ.get('OTHER_WORLD_API_URL', 'http://localhost:5000')


class RAGSearchEngine:
    """RAG 检索引擎（HTTP 解耦版）"""

    def __init__(self):
        print("初始化 RAG 检索引擎（HTTP 版）...")
        self.es = Elasticsearch(ES_CONFIG["host"])
        self.index = ES_CONFIG["index"]
        # HTTP 客户端，30 秒超时（embedding 和 rerank 比较耗时）
        # 注意：显式设置 trust_env=False 绕过系统代理，localhost 直连
        self.client = httpx.Client(
            base_url=OTHER_WORLD_API,
            timeout=30.0,
            trust_env=False
        )
        print(f"RAG 检索引擎初始化完成，other-world API: {OTHER_WORLD_API}")

    def search_bm25(self, query: str, top_k: int = 20) -> List[Dict[str, Any]]:
        """BM25 关键词召回"""
        body = {
            "query": {
                "match": {
                    "content": {
                        "query": query,
                        "operator": "or"
                    }
                }
            },
            "size": top_k,
            "_source": ["content", "source"]
        }

        response = self.es.search(index=self.index, body=body)
        results = []

        for i, hit in enumerate(response["hits"]["hits"]):
            results.append({
                "chunk_id": hit["_id"],
                "score": hit["_score"],
                "rank": i + 1,
                "content": hit["_source"].get("content", ""),
                "source": hit["_source"].get("source", "")
            })

        return results

    def search_knn(self, query: str, top_k: int = 20) -> List[Dict[str, Any]]:
        """
        kNN 向量召回
        
        调 other-world /api/embed 获取查询向量，然后在本地 ES 做向量检索。
        """
        # 调 other-world 获取 query 的 embedding
        resp = self.client.post("/api/embed", json={"texts": [query]})
        resp_data = resp.json()
        query_vec = resp_data["embeddings"][0]  # 1024 维向量

        body = {
            "knn": {
                "field": "embedding",
                "query_vector": query_vec,
                "k": top_k,
                "num_candidates": top_k * 5
            },
            "_source": ["content", "source"],
            "size": top_k
        }

        response = self.es.search(index=self.index, body=body)
        results = []

        for i, hit in enumerate(response["hits"]["hits"]):
            results.append({
                "chunk_id": hit["_id"],
                "score": hit["_score"],
                "rank": i + 1,
                "content": hit["_source"].get("content", ""),
                "source": hit["_source"].get("source", "")
            })

        return results

    def rrf_fusion(self, bm25_results: List[Dict], knn_results: List[Dict], k: int = 60) -> List[Dict]:
        """RRF (Reciprocal Rank Fusion) 融合"""
        # 构建 rank 字典
        bm25_ranks = {r["chunk_id"]: r["rank"] for r in bm25_results}
        knn_ranks = {r["chunk_id"]: r["rank"] for r in knn_results}

        # 收集所有 chunk_id
        all_ids = set(bm25_ranks.keys()) | set(knn_ranks.keys())

        # 计算 RRF 分数
        rrf_scores = {}
        for chunk_id in all_ids:
            score = 0.0
            if chunk_id in bm25_ranks:
                score += 1.0 / (k + bm25_ranks[chunk_id])
            if chunk_id in knn_ranks:
                score += 1.0 / (k + knn_ranks[chunk_id])
            rrf_scores[chunk_id] = score

        # 按分数排序
        sorted_ids = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)

        # 构建结果（需要找回 content 和 source）
        id_to_doc = {}
        for r in bm25_results + knn_results:
            if r["chunk_id"] not in id_to_doc:
                id_to_doc[r["chunk_id"]] = r

        results = []
        for rank, (chunk_id, rrf_score) in enumerate(sorted_ids, 1):
            doc = id_to_doc.get(chunk_id, {})
            results.append({
                "chunk_id": chunk_id,
                "rrf_score": rrf_score,
                "rank": rank,
                "content": doc.get("content", ""),
                "source": doc.get("source", "")
            })

        return results

    def search(self, query: str) -> Dict[str, Any]:
        """完整检索流程"""
        print(f"\n开始检索: {query}")

        # Step 1: BM25 召回
        print("Step 1: BM25 召回...")
        bm25_results = self.search_bm25(query, top_k=20)
        print(f"  -> 召回 {len(bm25_results)} 条")

        # Step 2: kNN 召回
        print("Step 2: kNN 向量召回...")
        knn_results = self.search_knn(query, top_k=20)
        print(f"  -> 召回 {len(knn_results)} 条")

        # Step 3: RRF 融合
        print("Step 3: RRF 融合...")
        rrf_results = self.rrf_fusion(bm25_results, knn_results, k=RRF_K)
        rrf_top5 = rrf_results[:5]
        print(f"  -> Top 5: {[r['chunk_id'][:8] for r in rrf_top5]}")

        # Step 4: Reranker 精排（调 other-world /api/rerank）
        print("Step 4: Reranker 精排...")
        if rrf_top5:
            resp = self.client.post("/api/rerank", json={
                "query": query,
                "passages": rrf_top5,
                "top_n": 1
            })
            reranked = resp.json()["results"]
            reranker_final = reranked[0] if reranked else None
            print(f"  -> 最终结果: {reranker_final['chunk_id'][:8] if reranker_final else 'None'}")
        else:
            reranker_final = None

        return {
            "bm25": bm25_results,
            "knn": knn_results,
            "rrf_top5": rrf_top5,
            "reranker_final": reranker_final
        }


# 全局单例
_search_engine = None


def get_search_engine() -> RAGSearchEngine:
    """获取检索引擎单例"""
    global _search_engine
    if _search_engine is None:
        _search_engine = RAGSearchEngine()
    return _search_engine
