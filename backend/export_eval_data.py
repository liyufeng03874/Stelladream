"""
导出评估数据用于前端回放

从 other-world 项目的评估结果中提取数据，生成前端可用的格式
包含：查询文本、检索结果、NDCG@5指标
"""

import json
import sys
from pathlib import Path

# 添加 other-world 路径
sys.path.insert(0, "D:/code/other-world/backend")

# 评估数据路径
EVAL_BASE = Path("D:/code/other-world/eval-data")
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "eval"
OUTPUT_DIR.mkdir(exist_ok=True)

# 数据集路径
DATASET_PATHS = {
    "medical": EVAL_BASE / "datasets/medical/eval_500.json",
    "law": EVAL_BASE / "datasets/law/eval_500.json",
    "general": EVAL_BASE / "datasets/general/eval_500.json"
}

# 评估结果路径
RESULT_PATHS = {
    "medical": EVAL_BASE / "results/kuake_run_007/eval_report.json",
    "law": EVAL_BASE / "results/cail_run_008/eval_report.json",
    "general": EVAL_BASE / "results/cmrc_run_009/eval_report.json"
}


def load_dataset(domain: str):
    """加载评估数据集（查询+ground truth）"""
    with open(DATASET_PATHS[domain], "r", encoding="utf-8") as f:
        return json.load(f)


def load_results(domain: str):
    """加载评估结果（检索结果+指标）"""
    with open(RESULT_PATHS[domain], "r", encoding="utf-8") as f:
        return json.load(f)


def export_domain(domain: str):
    """导出单个领域的评估数据"""
    print(f"\n处理 {domain}...")

    # 加载数据集和结果
    dataset = load_dataset(domain)
    results = load_results(domain)

    # 使用 FAISS 结果（如果有 ES 结果可以切换）
    pipeline_results = results.get("faiss", results.get("es", {}))
    summary = pipeline_results.get("summary", {})
    samples = pipeline_results.get("samples", [])

    # 构建查询映射
    query_map = {item["id"]: item for item in dataset}

    # 构建导出数据
    export_data = {
        "domain": domain,
        "summary": summary,
        "samples": []
    }

    for sample in samples:  # 导出全部样本
        query_id = sample["id"]
        query_info = query_map.get(query_id, {})

        export_data["samples"].append({
            "id": query_id,
            "query": query_info.get("query", ""),
            "retrieved_ids": sample.get("retrieved_ids", []),
            "metrics": sample.get("metrics", {}),
            "ndcg@5": sample["metrics"].get("ndcg@5", 0.0)
        })

    # 保存
    output_file = OUTPUT_DIR / f"eval_{domain}.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)

    print(f"[OK] 导出 {len(export_data['samples'])} 个样本")
    print(f"  Overall NDCG@5: {summary.get('ndcg@5', 0):.4f}")
    print(f"  输出: {output_file}")


def main():
    print("========================================")
    print("Eval Data Export")
    print("========================================")

    for domain in ["medical", "law", "general"]:
        export_domain(domain)

    print("\n[OK] Export Complete!")
    print(f"Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
