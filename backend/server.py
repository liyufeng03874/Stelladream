"""
FastAPI 后端服务器

提供：
1. /api/search - RAG 搜索接口（BM25 + kNN + RRF + Reranker）
2. /api/eval/{domain} - 评估回放数据接口
3. /api/star-data - 获取星图数据
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Stelladream API")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 加载配置
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)


# ===== 数据模型 =====

class SearchRequest(BaseModel):
    query: str


class SearchResponse(BaseModel):
    bm25: List[Dict[str, Any]]
    knn: List[Dict[str, Any]]
    rrf_top5: List[Dict[str, Any]]
    reranker_final: Optional[Dict[str, Any]]


# ===== API 端点 =====

@app.get("/")
async def root():
    return {"message": "Stelladream API", "version": "0.1.0"}


@app.get("/api/star-data")
async def get_star_data(limit: int = 0):
    """获取星图数据（limit=0 表示返回全部）"""
    data_path = Path(__file__).parent.parent / "data" / "star_data.json"

    if not data_path.exists():
        raise HTTPException(status_code=404, detail="星图数据未生成，请先运行数据处理脚本")

    with open(data_path, "r", encoding="utf-8") as f:
        star_data = json.load(f)

    # limit=0 返回全部数据
    if limit <= 0:
        return_data = star_data
    else:
        return_data = star_data[:limit]

    return {"count": len(return_data), "data": return_data}


@app.post("/api/search")
async def search(request: SearchRequest) -> SearchResponse:
    """RAG 搜索接口"""
    # Support both project-root module startup and direct server.py execution.
    if __package__:
        from .rag_search import get_search_engine
    else:
        from rag_search import get_search_engine

    try:
        engine = get_search_engine()
        results = engine.search(request.query)

        return SearchResponse(
            bm25=results["bm25"],
            knn=results["knn"],
            rrf_top5=results["rrf_top5"],
            reranker_final=results["reranker_final"]
        )
    except Exception as e:
        import traceback
        print(f"\n========== 检索错误 ==========")
        print(f"Query: {request.query}")
        print(f"Error: {e}")
        traceback.print_exc()
        print(f"================================\n")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/eval/{domain}")
async def get_eval_data(domain: str, step: int = 0):
    """获取评估回放数据：按 step 返回前 step+1 个样本的累计指标"""
    eval_path = Path(__file__).parent.parent / "data" / "eval" / f"eval_{domain}.json"

    if not eval_path.exists():
        raise HTTPException(status_code=404, detail=f"评估数据不存在: {domain}")

    with open(eval_path, "r", encoding="utf-8") as f:
        eval_data = json.load(f)

    samples = eval_data.get("samples", [])
    summary = eval_data.get("summary", {})

    # step 为当前回放进度（从 0 开始），返回前 step+1 个样本的累计指标
    step = min(max(step, 0), len(samples) - 1) if samples else 0
    current_sample = samples[step] if samples else {}

    # Each evaluation source owns its metric vocabulary.  Older replay files
    # use @5 metrics while LeCaRD Run 010 uses @10 metrics plus MAP.
    metric_keys = list(eval_data.get("metric_keys", [])) or list(summary.keys())
    if not metric_keys and samples:
        metric_keys = list(samples[0].get("metrics", {}).keys())

    # 当前样本指标
    current_metrics = {k.replace("@", "_"): current_sample.get("metrics", {}).get(k, 0) for k in metric_keys}

    # 累计指标：前 step+1 个样本的平均
    cumulative_metrics = {}
    for k in metric_keys:
        values = [s.get("metrics", {}).get(k, 0) for s in samples[: step + 1]]
        cumulative_metrics[k.replace("@", "_")] = sum(values) / len(values) if values else 0

    return {
        "dataset": eval_data.get("dataset", domain),
        "run": eval_data.get("run"),
        "index": eval_data.get("index"),
        "method": eval_data.get("method"),
        "summary": summary,
        "metric_keys": metric_keys,
        "current_metrics": current_metrics,
        "cumulative_metrics": cumulative_metrics,
        "total_samples": len(samples),
        "current_step": step,
        "query_id": current_sample.get("id", current_sample.get("qid", "")),
        "retrieved_ids": current_sample.get("retrieved_ids", []),
        "parent_ids": current_sample.get("parent_ids", []),
        "grades": current_sample.get("grades", []),
        "correct_ids": current_sample.get("correct_ids", []),
        "query": current_sample.get("query", ""),
        "ranks": current_sample.get("ranks", list(range(1, len(current_sample.get("retrieved_ids", [])) + 1))),
    }


@app.get("/api/eval/{domain}/samples")
async def get_eval_samples(domain: str):
    """返回评估样本的轻量索引，用于筛选和定位诊断样本。"""
    eval_path = Path(__file__).parent.parent / "data" / "eval" / f"eval_{domain}.json"

    if not eval_path.exists():
        raise HTTPException(status_code=404, detail=f"评估数据不存在: {domain}")

    with open(eval_path, "r", encoding="utf-8") as f:
        eval_data = json.load(f)

    samples = eval_data.get("samples", [])
    metric_keys = list(eval_data.get("metric_keys", [])) or list(eval_data.get("summary", {}).keys())
    if not metric_keys and samples:
        metric_keys = list(samples[0].get("metrics", {}).keys())

    sample_index = []
    for index, sample in enumerate(samples):
        metrics = sample.get("metrics", {})
        retrieved_ids = sample.get("retrieved_ids", [])
        correct_ids = set(sample.get("correct_ids", []))
        grades = sample.get("grades", [])
        relevant_count = sum(
            1
            for grade in grades
            if isinstance(grade, (int, float)) and grade > 0
        )

        if not relevant_count and correct_ids:
            relevant_count = len(correct_ids)

        first_relevant_rank = None
        for rank, chunk_id in enumerate(retrieved_ids, 1):
            if chunk_id in correct_ids or (
                rank <= len(grades)
                and isinstance(grades[rank - 1], (int, float))
                and grades[rank - 1] > 0
            ):
                first_relevant_rank = rank
                break

        hit_key = next(
            (key for key in ("hr@10", "hr@5", "hr@3", "hr@1") if key in metrics),
            None,
        )
        ndcg_key = next(
            (key for key in ("ndcg@10", "ndcg@5", "ndcg@3", "ndcg@1") if key in metrics),
            None,
        )
        hit_value = metrics.get(hit_key) if hit_key else None
        ndcg_value = metrics.get(ndcg_key) if ndcg_key else None

        sample_index.append(
            {
                "step": index,
                "query_id": str(sample.get("id", sample.get("qid", index))),
                "query": sample.get("query", ""),
                "retrieved_count": len(retrieved_ids),
                "relevant_count": relevant_count,
                "first_relevant_rank": first_relevant_rank,
                "hit_key": hit_key,
                "hit": bool(hit_value) if hit_value is not None else None,
                "ndcg_key": ndcg_key,
                "ndcg": ndcg_value,
                "metrics": {
                    key.replace("@", "_"): metrics.get(key, 0)
                    for key in metric_keys
                },
            }
        )

    return {
        "dataset": eval_data.get("dataset", domain),
        "run": eval_data.get("run"),
        "index": eval_data.get("index"),
        "method": eval_data.get("method"),
        "metric_keys": metric_keys,
        "total_samples": len(sample_index),
        "samples": sample_index,
    }


@app.get("/api/config")
async def get_config():
    """获取配置信息"""
    return config


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
