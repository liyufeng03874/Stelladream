"""
使用 UMAP 将 1024 维 embedding 降维到 3D

输入：data/docs_with_entropy.json
输出：data/star_data.json
"""

import json
import numpy as np
from pathlib import Path
from umap import UMAP

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

    # 对数缩放
    log_len = np.log(content_length + 1) / np.log(log_base)

    # 归一化到 [min_size, max_size]
    # 假设内容长度范围大致是 [10, 10000]
    log_min = np.log(10) / np.log(log_base)
    log_max = np.log(10000) / np.log(log_base)

    normalized = (log_len - log_min) / (log_max - log_min)
    normalized = np.clip(normalized, 0, 1)

    size = normalized * (max_size - min_size) + min_size
    return float(size)


def umap_reduce(docs):
    """UMAP 降维到 3D"""
    print(f"UMAP 降维：{len(docs):,} 条文档")
    print(f"参数: n_components={UMAP_CONFIG['n_components']}, "
          f"n_neighbors={UMAP_CONFIG['n_neighbors']}, "
          f"min_dist={UMAP_CONFIG['min_dist']}")

    # 提取 embedding
    embeddings = np.array([doc["embedding"] for doc in docs])
    print(f"Embedding shape: {embeddings.shape}")

    # UMAP 降维
    print("\n开始降维（预计需要 15-30 分钟）...")
    reducer = UMAP(
        n_components=UMAP_CONFIG["n_components"],
        n_neighbors=UMAP_CONFIG["n_neighbors"],
        min_dist=UMAP_CONFIG["min_dist"],
        random_state=UMAP_CONFIG["random_state"],
        verbose=True
    )

    coords_3d = reducer.fit_transform(embeddings)
    print(f"\n降维完成，输出 shape: {coords_3d.shape}")

    return coords_3d


def build_star_data(docs, coords_3d):
    """构建最终的星图数据"""
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
            "brightness": doc["brightness"]
        })

    # 统计
    domain_counts = {}
    for item in star_data:
        domain = item["domain"]
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    print("\n领域分布:")
    for domain, count in sorted(domain_counts.items()):
        print(f"  {domain}: {count:,} 条")

    return star_data


def main():
    """主流程"""
    data_dir = Path(__file__).parent.parent / "data"

    # 加载文档
    input_path = data_dir / "docs_with_entropy.json"
    print(f"加载文档: {input_path}")

    with open(input_path, "r", encoding="utf-8") as f:
        docs = json.load(f)

    # UMAP 降维
    coords_3d = umap_reduce(docs)

    # 构建星图数据
    star_data = build_star_data(docs, coords_3d)

    # 保存
    output_path = data_dir / "star_data.json"
    print(f"\n保存到 {output_path}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(star_data, f, ensure_ascii=False, indent=2)

    print("完成！")


if __name__ == "__main__":
    main()
