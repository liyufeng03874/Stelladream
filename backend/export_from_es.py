"""
从 Elasticsearch unified_rag 索引导出文档数据和embedding

数据源：http://localhost:9200/unified_rag (33,919条文档)
输出：data/raw_docs.json
"""

import json
import sys
from pathlib import Path
from typing import List, Dict, Any
from elasticsearch import Elasticsearch, helpers

# 添加 other-world 项目路径以复用 Embedder
sys.path.insert(0, "D:/code/other-world/backend")

# 加载配置
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

ES_CONFIG = config["elasticsearch"]
EMBEDDING_CONFIG = config["embedding"]
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


def export_from_es() -> List[Dict[str, Any]]:
    """从ES导出所有文档"""
    print(f"连接到 Elasticsearch: {ES_CONFIG['host']}")
    es = Elasticsearch(ES_CONFIG["host"])

    # 检查索引是否存在
    if not es.indices.exists(index=ES_CONFIG["index"]):
        raise ValueError(f"索引 {ES_CONFIG['index']} 不存在")

    # 获取文档总数
    count = es.count(index=ES_CONFIG["index"])["count"]
    print(f"索引 {ES_CONFIG['index']} 共有 {count:,} 条文档")

    # 使用 scan 导出所有文档
    docs = []
    print("开始导出文档...")

    for i, hit in enumerate(helpers.scan(
        es,
        index=ES_CONFIG["index"],
        size=ES_CONFIG["scroll_size"],
        _source=["content", "source"]
    )):
        source = hit["_source"]
        docs.append({
            "chunk_id": hit["_id"],
            "content": source.get("content", ""),
            "source": source.get("source", ""),
            "domain": infer_domain(source.get("source", ""))
        })

        if (i + 1) % 5000 == 0:
            print(f"已导出 {i + 1:,} 条文档")

    print(f"导出完成，共 {len(docs):,} 条文档")
    return docs


def encode_embeddings(docs: List[Dict[str, Any]]) -> List[List[float]]:
    """使用 BGE-large-zh 编码文档"""
    print("\n加载 Embedding 模型...")

    try:
        from rag.embedder import Embedder
        embedder = Embedder()
    except Exception as e:
        print(f"无法加载 Embedder: {e}")
        print("请确保 D:/code/other-world/backend 存在且包含 rag/embedder.py")
        raise

    texts = [doc["content"] for doc in docs]
    batch_size = EMBEDDING_CONFIG["batch_size"]

    print(f"开始编码 {len(texts):,} 条文档，批次大小: {batch_size}")

    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        embeddings = embedder.encode(batch).numpy()
        all_embeddings.extend(embeddings.tolist())

        print(f"已编码 {min(i + batch_size, len(texts)):,} / {len(texts):,}")

    print("编码完成")
    return all_embeddings


def main():
    """主流程"""
    output_dir = Path(__file__).parent.parent / "data"
    output_dir.mkdir(exist_ok=True)

    # Step 1: 从 ES 导出
    docs = export_from_es()

    # Step 2: 编码 embedding
    embeddings = encode_embeddings(docs)

    # Step 3: 合并并保存
    for doc, embedding in zip(docs, embeddings):
        doc["embedding"] = embedding

    output_path = output_dir / "raw_docs.json"
    print(f"\n保存到 {output_path}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)

    print("完成！")


if __name__ == "__main__":
    main()
