# 搜索动画调试诊断

> 时间：2026-07-11 22:00
> 状态：后端搜索正常，前端动画不触发
> 发现者：妹妹

---

## 问题描述

用户输入"感冒"后：
- ✅ 后端 `/api/search` 返回了数据（kNN 20 条、RRF 5 条、Reranker 1 条）
- ❌ 前端没有任何视觉变化（视角没动、星点没高亮、没有动画）

---

## 根因分析

### 问题 1：chunk_id 不匹配（致命）

**前端 mock 数据**（`data/star_data.json`）只有 **10,000 条**，是从 ES 导出的前 10K 文档。

**后端搜索**是从完整的 `unified_rag`（**33,919 条**）里搜的。

后端搜索返回的 chunk_id **不在**前端的 10K mock 数据里。

具体例子：
- 后端返回 `doc_019297`（医疗域）
- 前端 mock 数据里医疗域只有 3,174 个 doc_ ID（`doc_000001` ~ `doc_003174`）
- `doc_019297` 超出了范围，`starDataMap.get()` 返回 `undefined`

前端 `useSearchAnimation.ts` 的逻辑：
```javascript
const target = starDataMap.get(chunkId);  // ← undefined
if (target) { ... }  // ← 永远不执行
```

所以动画静默失败，没有任何视觉反馈。

### 问题 2：BM25 返回空

搜索"感冒"时 BM25 返回空数组。

可能原因：
- ES 的 `ik_smart` 分词器把"感冒"分词后匹配不到文档
- 或者 unified_rag 索引里的 `content` 字段用的是 `text` 类型但没有 ik 分词器
- 需要检查索引 mapping 的 analyzer

### 问题 3：数据不完整（根本原因）

`data/star_data.json` 只有 10K，分布：
- game: 6,532（UUID 格式 ID）
- medical: 3,174（doc_ 格式 ID，编号到 doc_003174）
- general: 294（UUID 格式 ID）

但 ES 完整数据 33,919 条，包含所有领域的文档。

---

## 修复方案

### 方案 A：导出完整 34K 数据（推荐）

**步骤**：
1. 修改 `export_from_es.py`，使用 `helpers.scan()` 分页获取所有文档
2. 导出完整的 33,919 条到 `data/star_data.json`
3. 重新生成 `data/checkpoint_*.json`
4. 前端加载完整数据，搜索动画就能找到匹配的 chunk_id

**注意**：ES `helpers.scan()` 可能也需要调大 `max_result_window`，或者直接用 scroll API。

### 方案 B：临时限制后端搜索范围（快速验证）

如果导出 34K 太慢，可以先让后端只搜索 mock 数据里存在的文档：

1. 从 `star_data.json` 提取所有 `chunk_id`
2. 后端搜索时加 filter：`{"terms": {"_id": [所有 mock chunk_id]}}`
3. 这样搜索结果一定在前端数据里

这只是临时方案，最终还是要用完整数据。

---

## BM25 修复

检查 ES 索引的 analyzer：

```bash
GET /unified_rag/_mapping
```

如果 `content` 字段没有配置 `ik_smart` 分词器，BM25 搜索会匹配很差。

**修复**：
1. 确认 `content` 字段的 analyzer 是 `ik_smart`（中文搜索）或 `ik_max_word`（更细粒度）
2. 如果不是，需要重建索引或更新 mapping
3. 测试：`POST /unified_rag/_search` 用 `{"query":{"match":{"content":"感冒"}}}` 验证

---

## 后续检查清单

- [ ] 导出完整 34K 数据
- [ ] 确认 chunk_id 格式统一（ES `_id` 和 star_data.json `chunk_id` 一致）
- [ ] 修复 BM25 搜索
- [ ] 验证搜索动画：输入 query → 三管线动画 → Reranker 高亮
