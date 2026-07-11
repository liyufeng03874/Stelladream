"""
计算文档的 TF-IDF 熵值用于亮度映射

输入：data/raw_docs.json
输出：data/docs_with_entropy.json
"""

import json
import numpy as np
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer

# 加载配置
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

VISUAL_CONFIG = config["visual"]


def compute_entropy(tfidf_row):
    """计算TF-IDF向量的信息熵"""
    if tfidf_row.nnz == 0:  # 空向量
        return 0.0

    probs = tfidf_row.data / tfidf_row.data.sum()
    entropy = -np.sum(probs * np.log(probs + 1e-10))
    return entropy


def compute_tfidf_entropy(docs):
    """计算所有文档的TF-IDF熵值"""
    print(f"计算 {len(docs):,} 条文档的 TF-IDF 熵值...")

    texts = [doc["content"] for doc in docs]

    # 构建 TF-IDF 矩阵
    print("构建 TF-IDF 矩阵...")
    vectorizer = TfidfVectorizer(max_features=10000, max_df=0.8, min_df=2)
    tfidf_matrix = vectorizer.fit_transform(texts)

    # 计算每个文档的熵
    print("计算熵值...")
    entropies = []
    for i in range(tfidf_matrix.shape[0]):
        entropy = compute_entropy(tfidf_matrix[i])
        entropies.append(entropy)

        if (i + 1) % 5000 == 0:
            print(f"已处理 {i + 1:,} / {len(docs):,}")

    # 归一化到 [min_brightness, max_brightness]
    entropies = np.array(entropies)
    min_val, max_val = entropies.min(), entropies.max()

    if max_val > min_val:
        normalized = (entropies - min_val) / (max_val - min_val)
        brightness_range = VISUAL_CONFIG["brightness"]["max"] - VISUAL_CONFIG["brightness"]["min"]
        normalized = normalized * brightness_range + VISUAL_CONFIG["brightness"]["min"]
    else:
        normalized = np.full_like(entropies, VISUAL_CONFIG["brightness"]["max"])

    print(f"熵值范围: [{min_val:.4f}, {max_val:.4f}]")
    print(f"亮度范围: [{normalized.min():.4f}, {normalized.max():.4f}]")

    return normalized.tolist()


def main():
    """主流程"""
    data_dir = Path(__file__).parent.parent / "data"

    # 加载原始文档
    input_path = data_dir / "raw_docs.json"
    print(f"加载文档: {input_path}")

    with open(input_path, "r", encoding="utf-8") as f:
        docs = json.load(f)

    # 计算熵值
    brightnesses = compute_tfidf_entropy(docs)

    # 添加到文档
    for doc, brightness in zip(docs, brightnesses):
        doc["brightness"] = brightness

    # 保存
    output_path = data_dir / "docs_with_entropy.json"
    print(f"\n保存到 {output_path}")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)

    print("完成！")


if __name__ == "__main__":
    main()
