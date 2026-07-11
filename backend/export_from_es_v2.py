"""
从 Elasticsearch unified_rag 索引导出文档数据和embedding
分批处理版本 - 避免内存溢出

数据源：http://localhost:9200/unified_rag (33,919条文档)
输出：data/raw_docs.json
"""

import json
import sys
import gc
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


def encode_embeddings_batched(docs: List[Dict[str, Any]], output_dir: Path):
    """分批编码并保存，避免内存溢出"""
    print("\n[WARNING] 使用分批处理模式")
    print("每批处理 1000 条文档，立即保存到磁盘")

    from rag.embedder import Embedder

    # 初始化 Embedder（只加载一次）
    print("\n加载 Embedding 模型...")
    try:
        embedder = Embedder()
    except Exception as e:
        print(f"无法加载模型: {e}")
        print("\n建议操作：")
        print("1. 关闭其他占用GPU/内存的程序")
        print("2. 重启Python环境")
        print("3. 如果仍然失败，考虑使用CPU模式或更小的模型")
        raise

    batch_size = 32  # 编码批次大小
    save_every = 1000  # 每处理1000条保存一次

    all_docs_with_embeddings = []
    temp_batch = []

    for i, doc in enumerate(docs):
        temp_batch.append(doc)

        # 每 save_every 条处理一次
        if len(temp_batch) >= save_every or i == len(docs) - 1:
            print(f"\n处理文档 {i - len(temp_batch) + 1} 到 {i + 1}...")

            # 编码当前批次
            texts = [d["content"] for d in temp_batch]
            batch_embeddings = []

            for j in range(0, len(texts), batch_size):
                mini_batch = texts[j:j + batch_size]
                try:
                    embeddings = embedder.encode(mini_batch).numpy()
                    batch_embeddings.extend(embeddings.tolist())

                    if (j + batch_size) % 256 == 0:
                        print(f"  已编码 {j + batch_size}/{len(texts)}")
                except Exception as e:
                    print(f"  [ERROR] 编码失败: {e}")
                    # 使用零向量占位
                    for _ in mini_batch:
                        batch_embeddings.append([0.0] * EMBEDDING_CONFIG["dimension"])

            # 添加 embedding 到文档
            for doc, embedding in zip(temp_batch, batch_embeddings):
                doc["embedding"] = embedding

            all_docs_with_embeddings.extend(temp_batch)

            # 保存中间结果
            checkpoint_path = output_dir / f"checkpoint_{i+1}.json"
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump(all_docs_with_embeddings, f, ensure_ascii=False)

            print(f"  [OK] 已保存到 {checkpoint_path} ({len(all_docs_with_embeddings):,} 条)")

            # 清理内存
            temp_batch = []
            gc.collect()

    return all_docs_with_embeddings


def main():
    """主流程"""
    output_dir = Path(__file__).parent.parent / "data"
    output_dir.mkdir(exist_ok=True)

    # Step 1: 从 ES 导出
    print("=" * 60)
    print("Step 1: 从 Elasticsearch 导出文档")
    print("=" * 60)

    docs = export_from_es()

    # Step 2: 分批编码 embedding
    print("\n" + "=" * 60)
    print("Step 2: 编码 Embedding（分批处理）")
    print("=" * 60)

    try:
        docs_with_embeddings = encode_embeddings_batched(docs, output_dir)
    except Exception as e:
        print(f"\n编码失败: {e}")
        print("\n已保存的检查点文件可以在 data/ 目录下找到")
        return

    # Step 3: 保存最终结果
    output_path = output_dir / "raw_docs.json"
    print(f"\n保存最终结果到 {output_path}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(docs_with_embeddings, f, ensure_ascii=False, indent=2)

    print(f"[OK] 完成！共处理 {len(docs_with_embeddings):,} 条文档")

    # 统计
    domain_counts = {}
    for doc in docs_with_embeddings:
        domain = doc["domain"]
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    print("\n领域分布:")
    for domain, count in sorted(domain_counts.items()):
        print(f"  {domain}: {count:,} 条")


if __name__ == "__main__":
    main()
