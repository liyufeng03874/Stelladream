"""
导出完整的 ES 数据（33,919 条）

使用 helpers.scan() 分页获取所有文档，避免 max_result_window 限制
"""

import json
import numpy as np
from pathlib import Path
from elasticsearch import Elasticsearch
from elasticsearch import helpers
import sys

# 添加 other-world 路径
sys.path.insert(0, "D:/code/other-world/backend")

from rag.embedder import Embedder
from sklearn.feature_extraction.text import TfidfVectorizer

# 加载配置
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

ES_CONFIG = config["elasticsearch"]
VISUAL_CONFIG = config["visual"]

# 初始化
es = Elasticsearch(ES_CONFIG["host"])
embedder = Embedder()


def compute_size(content_length: int) -> float:
    """根据内容长度计算星点大小"""
    min_size = VISUAL_CONFIG["size"]["min"]
    max_size = VISUAL_CONFIG["size"]["max"]
    log_base = VISUAL_CONFIG["size"]["logBase"]

    log_len = np.log(content_length + 1) / np.log(log_base)
    log_min = np.log(10) / np.log(log_base)
    log_max = np.log(10000) / np.log(log_base)

    normalized = (log_len - log_min) / (log_max - log_min)
    normalized = np.clip(normalized, 0, 1)

    return float(normalized * (max_size - min_size) + min_size)


def main():
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    print(f"开始导出完整数据...")
    print(f"ES: {ES_CONFIG['host']}")
    print(f"Index: {ES_CONFIG['index']}")

    # 使用 scan 获取所有文档
    query = {"query": {"match_all": {}}}

    docs = []
    print("\n使用 helpers.scan() 获取所有文档...")

    for hit in helpers.scan(
        es,
        index=ES_CONFIG["index"],
        query=query,
        scroll="5m",
        size=1000
    ):
        doc = {
            "chunk_id": hit["_id"],  # UUID格式
            "source_path": hit["_source"].get("source_path", hit["_id"]),  # doc_XXXXX格式，用于评估映射
            "content": hit["_source"].get("content", ""),
            "source": hit["_source"].get("source", ""),
            "domain": hit["_source"].get("domain", "general"),
            "embedding": hit["_source"].get("embedding", [])
        }
        docs.append(doc)

        if len(docs) % 1000 == 0:
            print(f"  已获取 {len(docs)} 条...")

    print(f"\n总计获取 {len(docs)} 条文档")

    # 计算 TF-IDF 熵值（亮度）
    print("\n计算 TF-IDF 熵值...")
    texts = [doc["content"] for doc in docs]
    vectorizer = TfidfVectorizer(max_features=10000, max_df=0.8, min_df=2)
    tfidf_matrix = vectorizer.fit_transform(texts)

    entropies = []
    for i in range(tfidf_matrix.shape[0]):
        row = tfidf_matrix[i]
        if row.nnz == 0:
            entropies.append(0.0)
        else:
            probs = row.data / row.data.sum()
            entropy = -np.sum(probs * np.log(probs + 1e-10))
            entropies.append(entropy)

    # 归一化亮度
    entropies = np.array(entropies)
    min_val, max_val = entropies.min(), entropies.max()
    if max_val > min_val:
        normalized = (entropies - min_val) / (max_val - min_val)
        brightness_range = VISUAL_CONFIG["brightness"]["max"] - VISUAL_CONFIG["brightness"]["min"]
        brightnesses = normalized * brightness_range + VISUAL_CONFIG["brightness"]["min"]
    else:
        brightnesses = np.full(len(entropies), VISUAL_CONFIG["brightness"]["max"])

    for doc, brightness in zip(docs, brightnesses):
        doc["brightness"] = float(brightness)

    print("TF-IDF 计算完成")

    # UMAP 降维
    print("\n开始 UMAP 降维...")
    from umap import UMAP

    embeddings = np.array([doc["embedding"] for doc in docs])
    print(f"Embedding shape: {embeddings.shape}")

    reducer = UMAP(
        n_components=3,
        n_neighbors=15,
        min_dist=0.1,
        random_state=42,
        verbose=True,
        n_jobs=1
    )

    coords_3d = reducer.fit_transform(embeddings)
    print(f"降维完成，输出 shape: {coords_3d.shape}")

    # 坐标放大（根据妹妹的建议）
    SCALE = 15
    coords_3d = coords_3d * SCALE

    # 构建星图数据
    print("\n构建星图数据...")
    star_data = []
    for doc, coord in zip(docs, coords_3d):
        star_data.append({
            "x": float(coord[0]),
            "y": float(coord[1]),
            "z": float(coord[2]),
            "domain": doc["domain"],
            "chunk_id": doc["chunk_id"],
            "source_path": doc["source_path"],  # 新增：用于评估映射
            "content": doc["content"],
            "source": doc["source"],
            "size": compute_size(len(doc["content"])),
            "brightness": doc.get("brightness", 0.7)
        })

    # 统计
    domain_counts = {}
    for item in star_data:
        domain = item["domain"]
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    print("\n领域分布:")
    for domain, count in sorted(domain_counts.items()):
        print(f"  {domain}: {count:,} 条")

    # 坐标范围
    xs = [p["x"] for p in star_data]
    ys = [p["y"] for p in star_data]
    zs = [p["z"] for p in star_data]
    print(f"\n坐标范围:")
    print(f"  X: [{min(xs):.2f}, {max(xs):.2f}]")
    print(f"  Y: [{min(ys):.2f}, {max(ys):.2f}]")
    print(f"  Z: [{min(zs):.2f}, {max(zs):.2f}]")

    # 保存
    output_path = data_dir / "star_data_full.json"
    print(f"\n保存到 {output_path}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(star_data, f, ensure_ascii=False, indent=2)

    print(f"[OK] 完成！共 {len(star_data):,} 个星点")
    print(f"\n备份旧文件并替换:")
    print(f"  mv data/star_data.json data/star_data_10k_backup.json")
    print(f"  mv data/star_data_full.json data/star_data.json")


if __name__ == "__main__":
    main()
