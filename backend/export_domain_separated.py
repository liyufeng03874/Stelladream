"""
按 chunk_id 前缀重新分配领域，加上领域偏移量
先还原原始 UMAP 坐标，再应用新偏移
"""
import json
from collections import defaultdict

INPUT = r"D:\code\Stelladream\data\star_data.json"
OUTPUT = r"D:\code\Stelladream\data\star_data.json"

# 领域中心偏移：远离、不平行、错落排列
DOMAIN_POSITIONS = {
    "general": (-200, 40, -150),    # 百科：左前上
    "medical": (200, -30, -150),    # 医疗：右前下
    "game": (0, 60, 200),           # 游戏/小说：正后上
}

# 之前用的偏移量
OLD_POSITIONS = {
    "general": (-80, 0, -80),
    "medical": (80, 0, -80),
    "game": (0, 0, 80),
}

def classify_domain(chunk_id):
    if chunk_id.startswith("cmrc_"):
        return "general"
    elif chunk_id.startswith("doc_"):
        return "medical"
    else:
        return "game"

def main():
    print("读取 star_data.json...")
    with open(INPUT, "r", encoding="utf-8") as f:
        star_data = json.load(f)
    print(f"共 {len(star_data)} 条")

    # 按新规则分类 domain
    for star in star_data:
        star["domain"] = classify_domain(star["chunk_id"])

    # 统计当前文件中的领域中心
    domain_centers = defaultdict(lambda: {"x": 0, "y": 0, "z": 0, "count": 0})
    for star in star_data:
        domain = star["domain"]
        dc = domain_centers[domain]
        dc["x"] += star["x"]
        dc["y"] += star["y"]
        dc["z"] += star["z"]
        dc["count"] += 1

    for domain, dc in domain_centers.items():
        dc["x"] /= dc["count"]
        dc["y"] /= dc["count"]
        dc["z"] /= dc["count"]
        print(f"  {domain}: 当前中心=({dc['x']:.1f}, {dc['y']:.1f}, {dc['z']:.1f}), count={dc['count']}")

    # 还原到原始 UMAP 中心，再应用新偏移
    # 当前坐标 = 原始坐标 - 旧偏移 + 之前的偏移
    # 假设上次偏移是 OLD_POSITIONS，那么：
    # 原始中心 = 当前中心 - 旧偏移 = 0（上次居中过）
    # 所以原始坐标就是当前坐标 + 旧偏移中心
    # 但我们不知道上次用了哪个偏移... 简化：直接用当前坐标，计算差值偏移

    for star in star_data:
        domain = star["domain"]
        # 差值 = 新偏移 - 旧偏移
        # 但我们无法精确知道旧偏移，直接用当前中心来还原
        dc = domain_centers[domain]
        new_offset = DOMAIN_POSITIONS.get(domain, (0, 0, 0))
        # 当前坐标是以旧中心为中心的，先回到原点，再到新位置
        star["x"] = star["x"] - dc["x"] + new_offset[0]
        star["y"] = star["y"] - dc["y"] + new_offset[1]
        star["z"] = star["z"] - dc["z"] + new_offset[2]

    # 最终统计
    domain_counts = defaultdict(int)
    for star in star_data:
        domain_counts[star["domain"]] += 1

    print("\n最终分布:")
    for d, c in sorted(domain_counts.items()):
        print(f"  {d}: {c:,}")

    new_centers = defaultdict(lambda: {"x": 0, "y": 0, "z": 0, "count": 0})
    for star in star_data:
        dc = new_centers[star["domain"]]
        dc["x"] += star["x"]
        dc["y"] += star["y"]
        dc["z"] += star["z"]
        dc["count"] += 1

    print("\n新中心:")
    for d, dc in sorted(new_centers.items()):
        print(f"  {d}: ({dc['x']/dc['count']:.1f}, {dc['y']/dc['count']:.1f}, {dc['z']/dc['count']:.1f})")

    xs = [s["x"] for s in star_data]
    ys = [s["y"] for s in star_data]
    zs = [s["z"] for s in star_data]
    print(f"\n坐标范围:")
    print(f"  X: [{min(xs):.1f}, {max(xs):.1f}]")
    print(f"  Y: [{min(ys):.1f}, {max(ys):.1f}]")
    print(f"  Z: [{min(zs):.1f}, {max(zs):.1f}]")

    print(f"\n保存到 {OUTPUT}")
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(star_data, f, ensure_ascii=False, indent=2)
    print("[OK] 完成！")

if __name__ == "__main__":
    main()
