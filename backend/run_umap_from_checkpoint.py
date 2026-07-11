"""
直接使用checkpoint数据运行UMAP降维
因为checkpoint已经包含了embedding
"""

import json
import numpy as np
from pathlib import Path
from umap import UMAP
import sys

# 加载配置
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

UMAP_CONFIG = config["umap"]
VISUAL_CONFIG = config["visual"]


def compute_size(content_length: int) -> float:
    """根据内容长度计算星点大小（对数缩放）"""
    min_size = VISUAL_CONFIG["size"]["min"]
    max_size = VISUAL_CONFIG["size"]["max"]
    log_base = VISUAL_CONFIG["size"]["logBase"]

    log_len = np.log(content_length + 1) / np.log(log_base)
    log_min = np.log(10) / np.log(log_base)
    log_max = np.log(10000) / np.log(log_base)

    normalized = (log_len - log_min) / (log_max - log_min)
    normalized = np.clip(normalized, 0, 1)

    size = normalized * (max_size - min_size) + min_size
    return float(size)


def main():
    """主流程"""
    data_dir = Path(__file__).parent.parent / "data"

    # 使用checkpoint_10000作为输入
    input_path = data_dir / "checkpoint_10000.json"

    print(f"加载数据: {input_path}")
    with open(input_path, "r", encoding="utf-8") as f:
        docs = json.load(f)

    print(f"文档数量: {len(docs):,}")

    # 检查是否有brightness字段，如果没有则需要计算
    if "brightness" not in docs[0]:
        print("\n计算TF-IDF熵值...")
        from sklearn.feature_extraction.text import TfidfVectorizer

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

        # 归一化
        entropies = np.array(entropies)
        min_val, max_val = entropies.min(), entropies.max()
        if max_val > min_val:
            normalized = (entropies - min_val) / (max_val - min_val)
            brightness_range = VISUAL_CONFIG["brightness"]["max"] - VISUAL_CONFIG["brightness"]["min"]
            brightnesses = normalized * brightness_range + VISUAL_CONFIG["brightness"]["min"]
        else:
            brightnesses = np.full(len(entropies), VISUAL_CONFIG["brightness"]["max"])

        # 添加到文档
        for doc, brightness in zip(docs, brightnesses):
            doc["brightness"] = float(brightness)

    # UMAP降维
    print(f"\nUMAP降维: {len(docs):,} 条文档")
    print(f"参数: n_components={UMAP_CONFIG['n_components']}, "
          f"n_neighbors={UMAP_CONFIG['n_neighbors']}, "
          f"min_dist={UMAP_CONFIG['min_dist']}")

    embeddings = np.array([doc["embedding"] for doc in docs])
    print(f"Embedding shape: {embeddings.shape}")

    print("\n开始降维（预计需要 5-15 分钟）...")
    reducer = UMAP(
        n_components=UMAP_CONFIG["n_components"],
        n_neighbors=UMAP_CONFIG["n_neighbors"],
        min_dist=UMAP_CONFIG["min_dist"],
        random_state=UMAP_CONFIG["random_state"],
        verbose=True,
        n_jobs=1  # 单线程避免内存问题
    )

    coords_3d = reducer.fit_transform(embeddings)
    print(f"\n降维完成，输出 shape: {coords_3d.shape}")

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
    output_path = data_dir / "star_data.json"
    print(f"\n保存到 {output_path}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(star_data, f, ensure_ascii=False, indent=2)

    print(f"[OK] 完成！共 {len(star_data):,} 个星点")


if __name__ == "__main__":
    main()
