<template>
  <div v-if="result" class="retrieval-summary">
    <div class="summary-header">
      <span class="summary-title">Search Results</span>
      <span class="summary-query">{{ query }}</span>
    </div>

    <div class="summary-grid">
      <div v-for="stage in stages" :key="stage.key" class="summary-card">
        <div class="summary-card-head">
          <span class="summary-stage">{{ stage.label }}</span>
          <span class="summary-count">{{ stage.count }}</span>
        </div>
        <div v-if="stage.top" class="summary-top">
          <div class="summary-id">{{ stage.top.id }}</div>
          <div class="summary-score">{{ stage.top.score }}</div>
        </div>
        <div v-else class="summary-empty">No hit</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SearchResult } from '../api';

interface Props {
  result: SearchResult | null;
  query: string;
}

const props = defineProps<Props>();

const fmtScore = (value: number) => value.toFixed(4);
const compactId = (value: string) => (value.length > 20 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value);

const stages = computed(() => [
  {
    key: 'bm25',
    label: 'BM25',
    count: props.result?.bm25.length ?? 0,
    top: props.result?.bm25[0]
      ? { id: compactId(props.result.bm25[0].chunk_id), score: fmtScore(props.result.bm25[0].score) }
      : null,
  },
  {
    key: 'knn',
    label: 'kNN',
    count: props.result?.knn.length ?? 0,
    top: props.result?.knn[0]
      ? { id: compactId(props.result.knn[0].chunk_id), score: fmtScore(props.result.knn[0].score) }
      : null,
  },
  {
    key: 'rrf',
    label: 'RRF',
    count: props.result?.rrf_top5.length ?? 0,
    top: props.result?.rrf_top5[0]
      ? { id: compactId(props.result.rrf_top5[0].chunk_id), score: fmtScore(props.result.rrf_top5[0].rrf_score) }
      : null,
  },
  {
    key: 'final',
    label: 'FINAL',
    count: props.result?.reranker_final ? 1 : 0,
    top: props.result?.reranker_final
      ? { id: compactId(props.result.reranker_final.chunk_id), score: fmtScore(props.result.reranker_final.rerank_score) }
      : null,
  },
]);
</script>

<style scoped>
.retrieval-summary {
  position: absolute;
  top: 8.35rem;
  left: 50%;
  transform: translateX(-50%);
  width: min(1120px, calc(100vw - 2.5rem));
  padding: 0.8rem 0.95rem 0.9rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px);
  z-index: 44;
}

.summary-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.7rem;
}

.summary-title {
  font-size: 0.84rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
}

.summary-query {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.52);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem;
}

.summary-card {
  min-width: 0;
  padding: 0.62rem 0.7rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.035);
}

.summary-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.42rem;
}

.summary-stage {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0;
}

.summary-count {
  font-size: 0.74rem;
  color: rgba(255, 255, 255, 0.52);
}

.summary-top {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  font-family: monospace;
}

.summary-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.9);
}

.summary-score {
  color: rgba(147, 197, 253, 0.95);
  flex-shrink: 0;
}

.summary-empty {
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.8rem;
}

@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
