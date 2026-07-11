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

app = FastAPI(title="Stelladream API")

# CORS 配置 — 不能用 * + credentials，必须指定具体域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
    ],
    allow_credentials=True,
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
async def get_star_data(limit: int = 1000):
    """获取星图数据（限制返回数量）"""
    data_path = Path(__file__).parent.parent / "data" / "star_data.json"

    if not data_path.exists():
        raise HTTPException(status_code=404, detail="星图数据未生成，请先运行数据处理脚本")

    with open(data_path, "r", encoding="utf-8") as f:
        star_data = json.load(f)

    # 只返回前N个星点，避免传输过大
    limited_data = star_data[:limit]

    return {"count": len(star_data), "data": limited_data, "displayed": len(limited_data)}


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
async def get_eval_data(domain: str, step: int):
    """评估回放数据接口"""
    # TODO: 实现评估数据加载
    # 这将在 Phase 5 实现

    if domain not in ["medical", "law", "general"]:
        raise HTTPException(status_code=400, detail="Invalid domain")

    return {
        "query": "",
        "results": [],
        "is_correct": False,
        "ndcg_at_5": 0.0,
        "cumulative_ndcg": 0.0
    }


@app.get("/api/config")
async def get_config():
    """获取配置信息"""
    return config


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
