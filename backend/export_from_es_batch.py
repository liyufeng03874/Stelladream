"""
从 Elasticsearch unified_rag 索引分批导出文档数据（包含已有的embedding）

数据源：http://localhost:9200/unified_rag (33,919条文档)
输出：data/raw_docs.json

策略：每1000条保存一次，避免内存溢出
"""

import json
from pathlib import Path
from typing import List, Dict, Any
from elasticsearch import Elasticsearch

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

    return "game"


def export_in_batches(batch_size=1000):
    """分批导出，避免内存溢出"""
    print(f"连接到 Elasticsearch: {ES_CONFIG['host']}")
    es = Elasticsearch(ES_CONFIG["host"])

    # 检查索引
    if not es.indices.exists(index=ES_CONFIG["index"]):
        raise ValueError(f"索引 {ES_CONFIG['index']} 不存在")

    # 获取文档总数
    count_result = es.count(index=ES_CONFIG["index"])
    total = count_result["count"]
    print(f"索引 {ES_CONFIG['index']} 共有 {total:,} 条文档")

    output_dir = Path(__file__).parent.parent / "data"
    output_dir.mkdir(exist_ok=True)

    all_docs = []
    from_index = 0

    print(f"\n开始导出（每批 {batch_size} 条）...")

    while from_index < total:
        print(f"\n导出 {from_index} 到 {min(from_index + batch_size, total)}...")

        try:
            # 使用search API而不是scan，手动控制分页
            result = es.search(
                index=ES_CONFIG["index"],
                body={
                    "from": from_index,
                    "size": batch_size,
                    "_source": ["content", "source", "embedding"]
                }
            )

            hits = result["hits"]["hits"]
            if not hits:
                break

            # 处理这批数据
            for hit in hits:
                source = hit["_source"]
                embedding = source.get("embedding", [])

                if not embedding:
                    continue

                all_docs.append({
                    "chunk_id": hit["_id"],
                    "content": source.get("content", ""),
                    "source": source.get("source", ""),
                    "domain": infer_domain(source.get("source", "")),
                    "embedding": embedding
                })

            print(f"  已收集 {len(all_docs):,} 条文档")

            # 每5000条保存一次中间结果
            if len(all_docs) % 5000 == 0:
                checkpoint_path = output_dir / f"checkpoint_{len(all_docs)}.json"
                with open(checkpoint_path, "w", encoding="utf-8") as f:
                    json.dump(all_docs, f, ensure_ascii=False)
                print(f"  [保存检查点] {checkpoint_path}")

            from_index += batch_size

        except Exception as e:
            print(f"错误: {e}")
            print(f"当前已收集 {len(all_docs):,} 条，继续...")
            from_index += batch_size
            continue

    return all_docs


def main():
    """主流程"""
    print("=" * 60)
    print("从 Elasticsearch 分批导出文档")
    print("=" * 60)

    # 使用更小的批次大小（500条）避免超过ES的10000限制
    docs = export_in_batches(batch_size=500)

    # 保存最终结果
    output_dir = Path(__file__).parent.parent / "data"
    output_path = output_dir / "raw_docs.json"

    print(f"\n保存最终结果到 {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)

    print(f"[OK] 完成！共 {len(docs):,} 条文档")

    # 统计
    domain_counts = {}
    for doc in docs:
        domain = doc["domain"]
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    print("\n领域分布:")
    for domain, count in sorted(domain_counts.items()):
        print(f"  {domain}: {count:,} 条")

    if docs:
        sample_embedding = docs[0]["embedding"]
        print(f"\nEmbedding 维度: {len(sample_embedding)}")


if __name__ == "__main__":
    main()
