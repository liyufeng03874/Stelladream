# Stelladream - 3D RAG检索可视化系统

> 将RAG（检索增强生成）的搜索过程可视化为星空中的检索旅程

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 📖 项目简介

Stelladream 是一个创新的3D可视化系统，将RAG检索流程转化为星空中的视觉体验。每个文档块是一颗星星，搜索过程通过流星、高亮、相机飞行等动画呈现，让复杂的检索算法变得直观易懂。

### 核心特性

- 🌌 **3D星图渲染** - 33,919个文档映射到3D空间，基于UMAP降维
- 🔍 **完整RAG流程** - BM25关键词召回 + kNN向量召回 + RRF融合 + Reranker精排
- ✨ **流星动画** - 检索过程以流星效果呈现，富有科幻感
- 🎯 **星跃功能** - 将搜索结果状态转移到任意星点
- 🎨 **领域着色** - 不同领域用不同颜色区分
- 🚀 **弧线飞行** - 相机以贝塞尔曲线飞向目标

## 🏗️ 技术架构

### 前端技术栈

- **框架**: Vue 3 + TypeScript + Vite
- **3D渲染**: Three.js + OrbitControls
- **动画**: GSAP (GreenSock Animation Platform)
- **HTTP**: Axios
- **构建**: Vite 6.0

### 后端技术栈

- **框架**: FastAPI (Python)
- **搜索引擎**: Elasticsearch 8.x
- **向量模型**: BGE-large-zh-v1.5 (BAAI)
- **Reranker**: BGE-reranker-large
- **降维**: UMAP
- **文本处理**: jieba, TF-IDF

### 数据流程

```
原始文档 (33,919)
    ↓
Elasticsearch 索引 (content + embedding)
    ↓
UMAP降维 (768维 → 3维)
    ↓
坐标放大 (×15)
    ↓
Three.js 渲染 (5000星点)
```

### RAG检索流程

```
用户查询
    ↓
1. BM25召回 (20条) ────┐
                        ├─→ RRF融合 (Top 5)
2. kNN召回 (20条) ─────┘        ↓
                         BGE Reranker精排
                                ↓
                         最终结果 (1条)
```

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 18.0
- **Python**: >= 3.10
- **Elasticsearch**: 8.x
- **CUDA**: 可选，用于GPU加速

### 安装步骤

#### 1. 克隆项目

```bash
git clone <repository-url>
cd Stelladream
```

#### 2. 后端配置

```bash
# 创建conda环境
conda create -n stelladream python=3.12
conda activate stelladream

# 安装依赖
cd backend
pip install -r requirements.txt

# 配置Elasticsearch
# 编辑 shared/config.json
{
  "elasticsearch": {
    "host": "http://localhost:9200",
    "index": "unified_rag"
  }
}

# 启动后端
python server.py
# 后端运行在 http://localhost:8000
```

#### 3. 前端配置

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
# 前端运行在 http://localhost:5175
```

#### 4. 数据准备

如果需要重新生成星图数据：

```bash
cd backend
python export_full_data.py
# 生成 data/star_data.json (24MB, 33,919个星点)
```

## 📊 使用说明

### 基础操作

- **旋转视角**: 鼠标左键拖动
- **缩放**: 鼠标滚轮
- **平移**: 鼠标右键拖动
- **搜索**: 输入查询词，按回车

### 搜索动画

1. **输入查询** - 在搜索框输入关键词（如："感冒"）
2. **观察动画** - 依次展示：
   - BM25召回（黄色流星）
   - kNN召回（蓝色流星）
   - RRF Top5（紫色高亮）
   - Reranker最终结果（绿色辉光）
3. **相机飞行** - 自动飞向最终结果
4. **查看详情** - 点击星点查看文档内容

### 星跃功能

1. **搜索完成** - 等待搜索动画结束
2. **点击其他星点** - 查看另一个文档
3. **点击"⚡ 星跃"** - 将最终状态转移到新星点
4. **观察效果** - 旧星点恢复，新星点变为最终状态

## 🎨 配置说明

### 视觉配置 (shared/config.json)

```json
{
  "visual": {
    "size": {
      "min": 0.1,
      "max": 1.5,
      "logBase": 10
    },
    "brightness": {
      "min": 0.3,
      "max": 1.0
    }
  },
  "domains": {
    "medical": {
      "name": "医疗",
      "color": "#FF6B6B"
    },
    "finance": {
      "name": "金融",
      "color": "#4ECDC4"
    }
  }
}
```

### 渲染性能

当前配置渲染5000个星点（从33,919中选取前5000）：

- **调整渲染数量**: 修改 `frontend/src/components/StarField.vue` 第130行
- **降低**: `const RENDER_LIMIT = 1000` (更流畅)
- **提高**: `const RENDER_LIMIT = 10000` (更完整)

### 动画参数

修改 `frontend/src/composables/useSearchAnimation.ts`:

```typescript
// 流星速度
duration: 0.15  // 越小越快

// 星点放大倍数
scale: number = 5  // 最终星点放大5倍

// 相机飞行时长
flightDuration = 1.8  // 秒
```

## 📁 项目结构

```
Stelladream/
├── frontend/                  # 前端项目
│   ├── src/
│   │   ├── components/       # Vue组件
│   │   │   ├── StarField.vue        # 3D星图
│   │   │   ├── SearchBar.vue        # 搜索框
│   │   │   └── InfoPanel.vue        # 信息面板
│   │   ├── composables/      # 组合式函数
│   │   │   └── useSearchAnimation.ts  # 搜索动画
│   │   ├── api/              # API接口
│   │   │   └── index.ts
│   │   ├── App.vue           # 主应用
│   │   └── main.ts           # 入口
│   └── package.json
├── backend/                   # 后端项目
│   ├── server.py             # FastAPI服务器
│   ├── rag_search.py         # RAG检索引擎
│   └── export_full_data.py   # 数据导出脚本
├── data/                      # 数据文件
│   └── star_data.json        # 星图数据 (24MB)
├── shared/                    # 共享配置
│   └── config.json           # 配置文件
└── README.md                 # 项目文档
```

## 🔧 故障排除

### 常见问题

**Q: 页面空白，没有星点？**

A: 检查以下几点：
1. 确认 `data/star_data.json` 存在且大小正确（~24MB）
2. 打开浏览器控制台查看错误信息
3. 确认后端 `/api/star-data` 接口返回正常

**Q: 搜索超时？**

A: 第一次搜索需要加载模型（约30-40秒），后续搜索会快很多（<5秒）。如果仍然超时：
1. 检查Elasticsearch是否正常运行
2. 确认GPU可用或使用CPU模式
3. 查看后端日志中的错误信息

**Q: 搜索结果的星点找不到？**

A: 这是因为前端只渲染了5000个星点，而搜索结果可能在剩余的28,919个中。解决方案：
1. 增加 `RENDER_LIMIT` 到更大值
2. 或者实现动态加载机制

**Q: 动画卡顿？**

A: 性能优化建议：
1. 降低 `RENDER_LIMIT` 到1000-2000
2. 关闭浏览器其他标签页
3. 使用独立显卡
4. 降低屏幕分辨率

## 📝 开发日志

### Git提交历史 (33次提交)

- `8e437db` - Merge fixes from expert reviewer
- `66903e2` - Optimize search animation flow and meteor trail effect
- `6ac223e` - Fix: Increase render count and add arc flight animation
- `d92da0b` - Fix search animation issues
- `6df4fa2` - Fix: Remove duplicate 15x coordinate scaling
- `b7983d9` - Replace with full 33,919 star dataset
- `fdd9fd9` - Implement Phase 4: RAG search visualization
- `41a87a9` - Apply final visual adjustments from expert review
- `71d2d47` - Fix star field to look like real space

## 🎯 未来规划

### Phase 5: 评估回放系统

- [ ] 导出评估数据（NDCG@5）
- [ ] 实现进度条控制
- [ ] NDCG@5曲线可视化
- [ ] 时间轴回放

### 性能优化

- [ ] LOD (Level of Detail) 渲染
- [ ] 视锥剔除 (Frustum Culling)
- [ ] Web Worker 并行计算
- [ ] 星点实例化渲染

### UI增强

- [ ] 领域筛选器
- [ ] 搜索历史
- [ ] 动画速度控制
- [ ] 自定义配色方案
- [ ] 键盘快捷键

## 👥 贡献者

- **开发**: Claude Opus 4.8 (1M context)
- **代码审查**: Expert Reviewer (通过Openclaw接入Qwen)

## 📄 许可证

MIT License

## 🙏 致谢

- **BAAI**: BGE系列模型
- **Elasticsearch**: 搜索引擎
- **Three.js**: 3D渲染库
- **Vue.js**: 前端框架
- **GSAP**: 动画库

---

**最后更新**: 2026-07-11

如有问题或建议，欢迎提issue或PR！
