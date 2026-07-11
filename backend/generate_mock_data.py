"""
生成mock星图数据用于前端开发
使用随机3D坐标模拟UMAP降维结果
"""

import json
import random
from pathlib import Path

# 加载配置
CONFIG_PATH = Path(__file__).parent.parent / "shared" / "config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

def generate_mock_star_data():
    """生成mock数据"""
    # 加载文档数据
    data_dir = Path(__file__).parent.parent / "data"
    with open(data_dir / "docs_with_entropy.json", "r", encoding="utf-8") as f:
        docs = json.load(f)

    print(f"生成 {len(docs):,} 个星点的mock 3D坐标...")

    # 为每个领域生成聚类中心
    domain_centers = {
        "medical": (30, 20, 10),
        "law": (-20, 30, -10),
        "general": (10, -25, 20),
        "game": (-15, -15, -15)
    }

    star_data = []
    for i, doc in enumerate(docs):
        domain = doc["domain"]
        center = domain_centers.get(domain, (0, 0, 0))

        # 在中心点周围生成随机偏移（形成聚类效果）
        spread = 15  # 聚类的扩散范围
        x = center[0] + random.gauss(0, spread)
        y = center[1] + random.gauss(0, spread)
        z = center[2] + random.gauss(0, spread)

        # 计算大小
        content_length = len(doc["content"])
        import math
        size = 2 + 10 * (math.log(content_length + 1) / math.log(10000))
        size = max(2, min(12, size))

        star_data.append({
            "x": round(x, 2),
            "y": round(y, 2),
            "z": round(z, 2),
            "domain": domain,
            "chunk_id": doc["chunk_id"],
            "content": doc["content"][:500],  # 截断内容以减小文件大小
            "source": doc["source"],
            "size": round(size, 2),
            "brightness": doc["brightness"]
        })

        if (i + 1) % 2000 == 0:
            print(f"已生成 {i + 1:,} / {len(docs):,}")

    return star_data


def main():
    """主流程"""
    print("=" * 60)
    print("生成 Mock 星图数据")
    print("=" * 60)

    star_data = generate_mock_star_data()

    # 保存
    output_dir = Path(__file__).parent.parent / "data"
    output_path = output_dir / "star_data.json"

    print(f"\n保存到 {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(star_data, f, ensure_ascii=False, indent=2)

    print(f"[OK] 完成！生成 {len(star_data):,} 个星点")

    # 统计
    domain_counts = {}
    for item in star_data:
        domain = item["domain"]
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    print("\n领域分布:")
    for domain, count in sorted(domain_counts.items()):
        print(f"  {domain}: {count:,} 条")

    # 坐标范围
    xs = [s["x"] for s in star_data]
    ys = [s["y"] for s in star_data]
    zs = [s["z"] for s in star_data]

    print(f"\n3D坐标范围:")
    print(f"  X: [{min(xs):.2f}, {max(xs):.2f}]")
    print(f"  Y: [{min(ys):.2f}, {max(ys):.2f}]")
    print(f"  Z: [{min(zs):.2f}, {max(zs):.2f}]")


if __name__ == "__main__":
    main()
