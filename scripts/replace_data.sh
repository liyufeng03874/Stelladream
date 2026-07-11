#!/bin/bash
# 替换星图数据脚本

echo "=========================================="
echo "替换星图数据为完整版本"
echo "=========================================="
echo ""

DATA_DIR="D:/code/Stelladream/data"
OLD_FILE="$DATA_DIR/star_data.json"
NEW_FILE="$DATA_DIR/star_data_full.json"
BACKUP_FILE="$DATA_DIR/star_data_10k_backup.json"

# 检查新文件是否存在
if [ ! -f "$NEW_FILE" ]; then
    echo "❌ 错误: $NEW_FILE 不存在"
    echo "请先运行 export_full_data.py"
    exit 1
fi

# 显示文件大小
echo "文件大小对比:"
ls -lh "$OLD_FILE" | awk '{print "  当前 (10K): " $5}'
ls -lh "$NEW_FILE" | awk '{print "  新版 (34K): " $5}'
echo ""

# 备份
echo "备份旧文件..."
cp "$OLD_FILE" "$BACKUP_FILE"
echo "✓ 备份到: $BACKUP_FILE"
echo ""

# 替换
echo "替换为新文件..."
mv "$NEW_FILE" "$OLD_FILE"
echo "✓ 替换完成"
echo ""

# 验证
echo "验证新数据:"
python -c "import json; d=json.load(open('$OLD_FILE','r',encoding='utf-8')); print(f'  星点数量: {len(d):,}'); domains={}; [domains.update({p['domain']:domains.get(p['domain'],0)+1}) for p in d]; [print(f'  {k}: {v:,}') for k,v in sorted(domains.items())]"
echo ""

echo "=========================================="
echo "✅ 数据替换成功！"
echo "=========================================="
echo ""
echo "下一步操作:"
echo "1. 重启前端服务器（让它加载新数据）"
echo "2. 刷新浏览器"
echo "3. 测试搜索功能"
echo ""
