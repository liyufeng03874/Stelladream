"""
FastAPI 后端服务器

提供：
1. /api/search - RAG 搜索接口（BM25 + kNN + RRF + Reranker）
2. /api/eval/{domain} - 评估回放数据接口
3. /api/star-data - 获取星图数据
"""

import json
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 添加 other-world 项目路径以复用 RAG 组件
sys.path.insert(0, "D:/code/other-world/backend")
# 添加 Stelladream 自己的 backend 路径
sys.path.insert(0, str(Path(__file__).parent))

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

    return {"count": len(star_data), "data": return_data, "displayed": len(return_data)}


@app.post("/api/search")
async def search(request: SearchRequest) -> SearchResponse:
    """RAG 搜索接口"""
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

    # step 为当前回放进度（从 0 开始），返回前 step+1 个样本的累计 NDCG 和当前 NDCG
    step = min(max(step, 0), len(samples) - 1) if samples else 0
    current_sample = samples[step] if samples else {}
    current_ndcg = current_sample.get("ndcg@5", 0)

    # 累计 NDCG：前 step+1 个样本的平均
    if step + 1 > 0:
        cumulative_ndcg = sum(s.get("ndcg@5", 0) for s in samples[: step + 1]) / (step + 1)
    else:
        cumulative_ndcg = current_ndcg

    # 正确率：ndcg@5 > 0 视为正确
    correct = sum(1 for s in samples[: step + 1] if s.get("ndcg@5", 0) > 0)
    rate = (correct / (step + 1) * 100) if step + 1 > 0 else 0

    return {
        "ndcg_at_5": current_ndcg,
        "cumulative_ndcg": cumulative_ndcg,
        "correct_rate": round(rate, 2),
        "total_samples": len(samples),
        "current_step": step,
    }


@app.get("/api/config")
async def get_config():
    """获取配置信息"""
    return config


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
