<template>
  <div v-if="result" class="retrieval-summary">
    <div class="summary-header">
      <span class="summary-title">检索结果</span>
      <span class="summary-query">查询：{{ query }}</span>
    </div>

    <div class="summary-grid">
      <div
        v-for="stage in stages"
        :key="stage.key"
        class="summary-card"
        :class="{ active: activePhase === stage.phase }"
        @click="emit('phase-select', stage.phase)"
      >
        <div class="summary-card-head">
          <span class="summary-stage">{{ stage.label }}</span>
          <span class="summary-count">命中 {{ stage.count }}</span>
        </div>
        <div v-if="stage.top" class="summary-top">
          <div class="summary-id-block">
            <div class="summary-meta-label">Top1 文档</div>
            <div class="summary-id">{{ stage.top.id }}</div>
          </div>
          <div class="summary-score-block">
            <div class="summary-meta-label">分数</div>
            <div class="summary-score">{{ stage.top.score }}</div>
          </div>
        </div>
        <button
          v-if="stage.top && stage.phase !== 'finalStar'"
          class="summary-action"
          @click.stop="emit('result-select', stage.top.chunkId)"
        >
          查看 Top1 文档
        </button>
        <div v-else-if="stage.phase !== 'finalStar'" class="summary-empty">暂无命中</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SearchResult } from '../api';
import type { SearchPhaseFilter } from '../composables/useSearchAnimation';

interface Props {
  result: SearchResult | null;
  query: string;
  activePhase: SearchPhaseFilter;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'phase-select': [phase: SearchPhaseFilter];
  'result-select': [chunkId: string];
}>();

const fmtScore = (value: number) => value.toFixed(4);
const compactId = (value: string) => (value.length > 20 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value);

const stages = computed(() => [
  {
    key: 'bm25',
    phase: 'bm25' as SearchPhaseFilter,
    label: 'BM25',
    count: props.result?.bm25.length ?? 0,
    top: props.result?.bm25[0]
      ? {
          id: compactId(props.result.bm25[0].chunk_id),
          chunkId: props.result.bm25[0].chunk_id,
          score: fmtScore(props.result.bm25[0].score),
        }
      : null,
  },
  {
    key: 'knn',
    phase: 'knn' as SearchPhaseFilter,
    label: 'kNN',
    count: props.result?.knn.length ?? 0,
    top: props.result?.knn[0]
      ? {
          id: compactId(props.result.knn[0].chunk_id),
          chunkId: props.result.knn[0].chunk_id,
          score: fmtScore(props.result.knn[0].score),
        }
      : null,
  },
  {
    key: 'rrf',
    phase: 'rrf' as SearchPhaseFilter,
    label: 'RRF',
    count: props.result?.rrf_top5.length ?? 0,
    top: props.result?.rrf_top5[0]
      ? {
          id: compactId(props.result.rrf_top5[0].chunk_id),
          chunkId: props.result.rrf_top5[0].chunk_id,
          score: fmtScore(props.result.rrf_top5[0].rrf_score),
        }
      : null,
  },
  {
    key: 'final',
    phase: 'finalStar' as SearchPhaseFilter,
    label: 'FINAL',
    count: props.result?.reranker_final ? 1 : 0,
    top: props.result?.reranker_final
      ? {
          id: compactId(props.result.reranker_final.chunk_id),
          chunkId: props.result.reranker_final.chunk_id,
          score: fmtScore(props.result.reranker_final.rerank_score),
        }
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
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.summary-card:hover {
  border-color: rgba(147, 197, 253, 0.36);
  background: rgba(255, 255, 255, 0.055);
  transform: translateY(-1px);
}

.summary-card.active {
  border-color: rgba(96, 165, 250, 0.75);
  background: rgba(59, 130, 246, 0.12);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.12);
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
  align-items: flex-end;
}

.summary-id-block,
.summary-score-block {
  min-width: 0;
}

.summary-score-block {
  flex-shrink: 0;
  text-align: right;
}

.summary-meta-label {
  margin-bottom: 0.18rem;
  font-size: 0.67rem;
  color: rgba(255, 255, 255, 0.42);
}

.summary-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.9);
  font-family: monospace;
  font-size: 0.84rem;
}

.summary-score {
  color: rgba(147, 197, 253, 0.95);
  font-family: monospace;
  font-size: 0.84rem;
}

.summary-empty {
  color: rgba(255, 255, 255, 0.38);
  font-size: 0.8rem;
}

.summary-action {
  margin-top: 0.55rem;
  padding: 0;
  border: none;
  background: transparent;
  color: rgba(147, 197, 253, 0.95);
  font-size: 0.73rem;
  cursor: pointer;
}

.summary-action:hover {
  color: rgba(191, 219, 254, 1);
}

@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
