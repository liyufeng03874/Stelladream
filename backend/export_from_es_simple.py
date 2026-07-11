"""
从 Elasticsearch unified_rag 索引导出文档数据（包含已有的embedding）

数据源：http://localhost:9200/unified_rag (33,919条文档)
输出：data/raw_docs.json

注意：ES中已经存储了embedding，无需重新计算！
"""

import json
from pathlib import Path
from typing import List, Dict, Any
from elasticsearch import Elasticsearch, helpers

# 加载配置
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

ES_CONFIG = config["elasticsearch"]
DOMAINS = config["domains"]


def infer_domain(source: str) -> str:
    """根据source推断领域"""
    source_lower = source.lower()

    for domain, info in DOMAINS.items():
        for src in info["sources"]:
            if src.lower() in source_lower:
                return domain

    # 默认为game
    return "game"


def export_from_es_with_embeddings() -> List[Dict[str, Any]]:
    """从ES导出文档和embedding"""
    print(f"连接到 Elasticsearch: {ES_CONFIG['host']}")
    es = Elasticsearch(ES_CONFIG["host"])

    # 检查索引是否存在
    if not es.indices.exists(index=ES_CONFIG["index"]):
        raise ValueError(f"索引 {ES_CONFIG['index']} 不存在")

    # 获取文档总数
    count = es.count(index=ES_CONFIG["index"])["count"]
    print(f"索引 {ES_CONFIG['index']} 共有 {count:,} 条文档")

    # 使用 scan 导出所有文档（包含embedding）
    docs = []
    print("开始导出文档（包含embedding）...")
    print("[提示] ES中已存储embedding，无需重新计算")

    for i, hit in enumerate(helpers.scan(
        es,
        index=ES_CONFIG["index"],
        size=ES_CONFIG["scroll_size"],
        _source=["content", "source", "embedding"]  # 包含embedding字段
    )):
        source = hit["_source"]

        # 提取embedding
        embedding = source.get("embedding", [])
        if not embedding or len(embedding) == 0:
            print(f"[WARNING] 文档 {hit['_id']} 缺少embedding，跳过")
            continue

        docs.append({
            "chunk_id": hit["_id"],
            "content": source.get("content", ""),
            "source": source.get("source", ""),
            "domain": infer_domain(source.get("source", "")),
            "embedding": embedding
        })

        if (i + 1) % 5000 == 0:
            print(f"已导出 {i + 1:,} 条文档")

    print(f"导出完成，共 {len(docs):,} 条文档")
    return docs


def main():
    """主流程"""
    output_dir = Path(__file__).parent.parent / "data"
    output_dir.mkdir(exist_ok=True)

    # 从 ES 导出（包含embedding）
    print("=" * 60)
    print("从 Elasticsearch 导出文档和 Embedding")
    print("=" * 60)

    docs = export_from_es_with_embeddings()

    # 保存
    output_path = output_dir / "raw_docs.json"
    print(f"\n保存到 {output_path}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)

    print(f"[OK] 完成！共处理 {len(docs):,} 条文档")

    # 统计
    domain_counts = {}
    for doc in docs:
        domain = doc["domain"]
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    print("\n领域分布:")
    for domain, count in sorted(domain_counts.items()):
        print(f"  {domain}: {count:,} 条")

    # 验证embedding
    if docs:
        sample_embedding = docs[0]["embedding"]
        print(f"\nEmbedding 维度: {len(sample_embedding)}")
        print(f"样本值: [{sample_embedding[0]:.4f}, {sample_embedding[1]:.4f}, ...]")


if __name__ == "__main__":
    main()
