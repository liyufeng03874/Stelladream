<template>
  <div class="eval-replay">
    <div class="tabs">
      <button
        v-for="domain in domains"
        :key="domain.key"
        :class="['tab', { active: currentDomain === domain.key }]"
        @click="switchDomain(domain.key)"
      >
        {{ domain.name }}
      </button>
    </div>

    <div v-if="datasetLabel" class="replay-meta">
      <span class="replay-dataset">{{ datasetLabel }}</span>
      <span v-if="runLabel">{{ runLabel }}</span>
      <span v-if="methodLabel">{{ methodLabel }}</span>
    </div>

    <div v-if="currentQuery" class="replay-query">
      <span class="replay-query-label">当前查询{{ currentQueryId ? ` · #${currentQueryId}` : '' }}</span>
      <span class="replay-query-text">{{ currentQuery }}</span>
    </div>

    <div class="controls">
      <button @click="togglePlay" class="play-button">
        {{ isPlaying ? '⏸' : '▶' }}
      </button>

      <input
        type="range"
        :value="currentStep"
        :min="0"
        :max="maxSteps - 1"
        class="progress-slider"
        @input="handleStepChange"
      />

      <span class="step-indicator">{{ currentStep + 1 }} / {{ maxSteps }}</span>
    </div>

    <section class="diagnosis-section">
      <div class="diagnosis-header">
        <div>
          <span class="diagnosis-title">样本诊断</span>
          <span class="diagnosis-count">{{ filteredSamples.length }} / {{ sampleSummaries.length }} 条</span>
        </div>
        <span v-if="sampleLoading" class="diagnosis-loading">加载中...</span>
      </div>

      <div class="diagnosis-controls">
        <select
          v-model="sampleFilter"
          class="diagnosis-select"
          aria-label="样本筛选"
          @change="handleSampleFilterChange"
        >
          <option value="all">全部样本</option>
          <option value="failed">失败样本</option>
          <option value="low">低分样本</option>
        </select>
        <input
          v-model="sampleQuery"
          class="diagnosis-search"
          type="search"
          placeholder="按 Query ID 或内容筛选"
          aria-label="按 Query ID 或内容筛选"
        />
        <select
          class="sample-select"
          :value="currentStep"
          aria-label="选择评估样本"
          @change="handleSampleSelect"
        >
          <option v-if="filteredSamples.length === 0" :value="currentStep">暂无匹配样本</option>
          <option v-for="sample in filteredSamples" :key="sample.step" :value="sample.step">
            #{{ sample.query_id }} · 第 {{ sample.step + 1 }} 条{{ sample.ndcg != null ? ` · NDCG ${sample.ndcg.toFixed(3)}` : '' }}
          </option>
        </select>
      </div>

      <div v-if="currentSampleSummary" class="diagnosis-summary">
        <span
          class="diagnosis-status"
          :class="currentSampleSummary.hit === false ? 'failed' : currentSampleSummary.hit === true ? 'passed' : 'unknown'"
        >
          {{ sampleStatusLabel(currentSampleSummary) }}
        </span>
        <span>Top-10 {{ currentSampleSummary.hit === true ? '已命中' : currentSampleSummary.hit === false ? '未命中' : '未提供' }}</span>
        <span>首个相关 #{{ currentSampleSummary.first_relevant_rank ?? '--' }}</span>
        <span>相关文档 {{ currentSampleSummary.relevant_count }} 条</span>
        <span v-if="currentSampleSummary.ndcg != null">NDCG {{ currentSampleSummary.ndcg.toFixed(4) }}</span>
      </div>

      <div v-if="currentResults.length > 0" class="diagnosis-results">
        <button
          v-for="result in currentResults"
          :key="result.chunkId"
          class="diagnosis-result"
          :class="{ relevant: result.relevant }"
          @click="emit('result-select', result.chunkId)"
        >
          <span class="result-rank">#{{ result.rank }}</span>
          <span class="result-id">{{ compactId(result.chunkId) }}</span>
          <span v-if="result.grade != null" class="result-grade">grade {{ result.grade }}</span>
          <span v-if="result.relevant" class="result-mark">相关</span>
        </button>
      </div>
    </section>

    <div class="metrics">
      <div class="metric-item" v-for="m in metricDefs" :key="m.key">
        <span class="metric-label">{{ m.label }}</span>
        <span class="metric-value" :style="{ color: m.color }">{{ formatMetric(m.key) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { getEvalData, getEvalSamples, type EvalSampleSummary } from '../api';

const emit = defineEmits<{
  highlight: [payload: {
    chunkIds: string[];
    ranks: number[];
    grades: number[];
    correctIds: string[];
    currentMetrics: Record<string, number>;
    cumulativeMetrics: Record<string, number>;
    query: string;
    queryId: string;
    domain: string;
    isBatch: boolean;
  }];
  reset: [];
  'fly-to-domain': [domain: string];
  'metrics-update': [payload: {
    step: number;
    currentMetrics: Record<string, number>;
    cumulativeMetrics: Record<string, number>;
    metricKeys: string[];
    totalSamples: number;
  }];
  'result-select': [chunkId: string];
}>();

interface MetricDefinition {
  key: string;
  label: string;
  color: string;
}

const defaultMetricDefs: MetricDefinition[] = [
  { key: 'ndcg_5', label: 'NDCG@5', color: '#60A5FA' },
  { key: 'hr_5', label: 'HR@5', color: '#34D399' },
  { key: 'mrr_5', label: 'MRR@5', color: '#F5A623' },
  { key: 'recall_5', label: 'Recall@5', color: '#A78BFA' },
  { key: 'precision_5', label: 'P@5', color: '#F472B6' },
  { key: 'hr_1', label: 'HR@1', color: '#FBBF24' },
];

const metricColors = ['#60A5FA', '#34D399', '#F5A623', '#A78BFA', '#F472B6', '#FBBF24', '#FB7185'];
const metricDefs = ref<MetricDefinition[]>(defaultMetricDefs);

const metricLabel = (key: string) => {
  const labels: Record<string, string> = {
    ndcg_5: 'NDCG@5',
    ndcg_10: 'NDCG@10',
    ndcg_20: 'NDCG@20',
    ndcg_30: 'NDCG@30',
    hr_1: 'HR@1',
    hr_3: 'HR@3',
    hr_5: 'HR@5',
    hr_10: 'HR@10',
    recall_5: 'Recall@5',
    recall_10: 'Recall@10',
    precision_5: 'P@5',
    p_5: 'P@5',
    precision_10: 'P@10',
    p_10: 'P@10',
    mrr_5: 'MRR@5',
    mrr_10: 'MRR@10',
    map: 'MAP',
  };
  return labels[key] ?? key.replace('_', '@').toUpperCase();
};

const updateMetricDefs = (keys: string[] | undefined) => {
  if (!keys?.length) {
    metricDefs.value = defaultMetricDefs;
    return;
  }
  metricDefs.value = keys.map((key, index) => ({
    key: key.replace('@', '_'),
    label: metricLabel(key.replace('@', '_')),
    color: metricColors[index % metricColors.length],
  }));
};

const domains = [
  { key: 'lecard', name: 'LeCaRD 专家评测 (Run 010)' },
  { key: 'medical', name: '医疗 (Run 007)' },
  { key: 'law', name: '法律 (Run 008)' },
  { key: 'general', name: '百科 (Run 009)' },
];

const currentDomain = ref('lecard');
const currentStep = ref(0);
const maxSteps = ref(500);
const isPlaying = ref(false);

const currentMetrics = ref<Record<string, number>>({});
const cumulativeMetrics = ref<Record<string, number>>({});
const datasetLabel = ref('');
const runLabel = ref('');
const methodLabel = ref('');
const currentQuery = ref('');
const currentQueryId = ref('');
const sampleSummaries = ref<EvalSampleSummary[]>([]);
const sampleFilter = ref<'all' | 'failed' | 'low'>('all');
const sampleQuery = ref('');
const sampleLoading = ref(false);
const currentRetrievedIds = ref<string[]>([]);
const currentCorrectIds = ref<string[]>([]);
const currentGrades = ref<number[]>([]);

let playInterval: number | null = null;
let playLaunchToken = 0;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const currentSampleSummary = computed(() =>
  sampleSummaries.value.find(sample => sample.step === currentStep.value) ?? null
);

const filteredSamples = computed(() => {
  const query = sampleQuery.value.trim().toLowerCase();
  return sampleSummaries.value.filter(sample => {
    const matchesFilter =
      sampleFilter.value === 'all'
      || (sampleFilter.value === 'failed' && sample.hit === false)
      || (sampleFilter.value === 'low' && sample.ndcg != null && sample.ndcg < 0.3);
    if (!matchesFilter) return false;
    if (!query) return true;
    return sample.query_id.toLowerCase().includes(query) || sample.query.toLowerCase().includes(query);
  });
});

const currentResults = computed(() => currentRetrievedIds.value.map((chunkId, index) => {
  const grade = currentGrades.value[index];
  return {
    chunkId,
    rank: index + 1,
    grade: typeof grade === 'number' ? grade : null,
    relevant: currentCorrectIds.value.includes(chunkId) || (typeof grade === 'number' && grade > 0),
  };
}));

const formatMetric = (key: string) => {
  const val = cumulativeMetrics.value[key] ?? 0;
  return val.toFixed(4);
};

const compactId = (value: string) => (
  value.length > 26 ? `${value.slice(0, 13)}...${value.slice(-8)}` : value
);

const sampleStatusLabel = (sample: EvalSampleSummary) => {
  if (sample.hit === true) return 'Top-10 命中';
  if (sample.hit === false) return 'Top-10 未命中';
  return '未提供命中标记';
};

const switchDomain = (domain: string) => {
  emit('reset');
  stopPlayback();
  currentDomain.value = domain;
  currentStep.value = 0;
  currentMetrics.value = {};
  cumulativeMetrics.value = {};
  metricDefs.value = defaultMetricDefs;
  datasetLabel.value = '';
  runLabel.value = '';
  methodLabel.value = '';
  currentQuery.value = '';
  currentQueryId.value = '';
  sampleSummaries.value = [];
  sampleQuery.value = '';
  sampleFilter.value = 'all';
  currentRetrievedIds.value = [];
  currentCorrectIds.value = [];
  currentGrades.value = [];
  loadSampleIndex();
  loadEvalData({ emitHighlight: false });
};

const stopPlayback = () => {
  isPlaying.value = false;
  playLaunchToken += 1;
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
};

const togglePlay = async () => {
  if (isPlaying.value) {
    stopPlayback();
    return;
  }

  if (currentStep.value === 0) {
    emit('fly-to-domain', currentDomain.value);
    const launchToken = ++playLaunchToken;
    await sleep(1800);
    if (launchToken !== playLaunchToken) return;
    await loadEvalData({ emitHighlight: true });
  }

  isPlaying.value = true;

  playInterval = window.setInterval(() => {
    if (currentStep.value < maxSteps.value - 1) {
      currentStep.value++;
      loadEvalData();
    } else {
      stopPlayback();
      emit('highlight', {
        chunkIds: [],
        ranks: [],
        grades: [],
        correctIds: [],
        currentMetrics: currentMetrics.value,
        cumulativeMetrics: cumulativeMetrics.value,
        query: '',
        queryId: '',
        domain: currentDomain.value,
        isBatch: true,
      });
    }
  }, 800);
};

const handleStepChange = (event: Event) => {
  const slider = event.target as HTMLInputElement;
  currentStep.value = parseInt(slider.value, 10);
  loadEvalData();
};

const handleSampleSelect = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const step = Number.parseInt(select.value, 10);
  if (!Number.isNaN(step)) {
    stopPlayback();
    currentStep.value = step;
    loadEvalData();
  }
};

const handleSampleFilterChange = () => {
  if (filteredSamples.value.some(sample => sample.step === currentStep.value)) return;
  const firstSample = filteredSamples.value[0];
  if (!firstSample) return;
  stopPlayback();
  currentStep.value = firstSample.step;
  loadEvalData();
};

const loadSampleIndex = async () => {
  sampleLoading.value = true;
  try {
    const data = await getEvalSamples(currentDomain.value);
    sampleSummaries.value = data.samples ?? [];
    updateMetricDefs(data.metric_keys);
    if (data.total_samples) {
      maxSteps.value = data.total_samples;
    }
  } catch (error) {
    console.error('Failed to load eval sample index:', error);
    sampleSummaries.value = [];
  } finally {
    sampleLoading.value = false;
  }
};

const loadEvalData = async (options: { emitHighlight?: boolean } = {}) => {
  try {
    const data = await getEvalData(currentDomain.value, currentStep.value);
    currentMetrics.value = data.current_metrics ?? {};
    cumulativeMetrics.value = data.cumulative_metrics ?? {};
    currentQuery.value = data.query ?? '';
    currentQueryId.value = data.query_id ?? '';
    currentRetrievedIds.value = data.retrieved_ids ?? [];
    currentCorrectIds.value = data.correct_ids ?? [];
    currentGrades.value = data.grades ?? [];
    updateMetricDefs(data.metric_keys);
    datasetLabel.value = data.dataset ?? '';
    runLabel.value = data.run ? `Run ${data.run}` : '';
    methodLabel.value = data.method ?? '';

    // 发出指标更新事件
    emit('metrics-update', {
      step: data.current_step,
      currentMetrics: data.current_metrics ?? {},
      cumulativeMetrics: data.cumulative_metrics ?? {},
      metricKeys: data.metric_keys ?? [],
      totalSamples: data.total_samples ?? 0,
    });

    if (data.total_samples) {
      maxSteps.value = data.total_samples;
      if (currentStep.value >= data.total_samples) {
        currentStep.value = data.total_samples - 1;
      }
    }
    if (options.emitHighlight !== false && data.retrieved_ids && Array.isArray(data.retrieved_ids) && data.retrieved_ids.length > 0) {
      emit('highlight', {
        chunkIds: data.retrieved_ids,
        ranks: data.ranks ?? [1, 2, 3, 4, 5].slice(0, data.retrieved_ids.length),
        grades: data.grades ?? [],
        correctIds: data.correct_ids ?? [],
        currentMetrics: data.current_metrics ?? {},
        cumulativeMetrics: data.cumulative_metrics ?? {},
        query: data.query ?? '',
        queryId: data.query_id ?? '',
        domain: currentDomain.value,
        isBatch: false,
      });
    }
  } catch (error) {
    console.error('Failed to load eval data:', error);
  }
};

onMounted(() => {
  loadSampleIndex();
  loadEvalData({ emitHighlight: false });
});

onUnmounted(() => {
  stopPlayback();
});
</script>

<style scoped>
.eval-replay {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  width: 85%;
  max-width: 1100px;
  background: rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 1rem 1.1rem;
  z-index: 50;
}

.tabs {
  display: flex;
  gap: 0.45rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.tab {
  flex: 1;
  min-width: 0;
  padding: 0.46rem 0.85rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.85rem;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.tab.active {
  background: rgba(96, 165, 250, 0.16);
  border-color: rgba(96, 165, 250, 0.55);
  color: white;
}

.controls {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.85rem;
}

.replay-meta {
  display: flex;
  gap: 0.7rem;
  align-items: center;
  margin: -0.25rem 0 0.7rem;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.replay-dataset {
  color: rgba(255, 255, 255, 0.82);
  font-weight: 700;
}

.replay-query {
  display: flex;
  gap: 0.55rem;
  align-items: baseline;
  margin: -0.15rem 0 0.75rem;
  min-width: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.72rem;
}

.replay-query-label {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.78);
  font-weight: 700;
}

.replay-query-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-button {
  width: 36px;
  height: 36px;
  background: rgba(96, 165, 250, 0.15);
  border: 1px solid rgba(96, 165, 250, 0.45);
  border-radius: 50%;
  color: white;
  font-size: 1rem;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease;
}

.play-button:hover {
  transform: scale(1.1);
  background: rgba(96, 165, 250, 0.24);
}

.progress-slider {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;
}

.progress-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: #93c5fd;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.16);
}

.step-indicator {
  min-width: 80px;
  text-align: right;
  color: rgba(255, 255, 255, 0.6);
  font-family: monospace;
  font-size: 0.85rem;
}

.diagnosis-section {
  margin-bottom: 0.85rem;
  padding: 0.75rem 0.85rem 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
}

.diagnosis-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.55rem;
}

.diagnosis-title {
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.78rem;
  font-weight: 700;
}

.diagnosis-count,
.diagnosis-loading {
  margin-left: 0.55rem;
  color: rgba(255, 255, 255, 0.42);
  font-size: 0.68rem;
}

.diagnosis-controls {
  display: grid;
  grid-template-columns: 125px minmax(180px, 1fr) minmax(260px, 1.5fr);
  gap: 0.5rem;
}

.diagnosis-select,
.diagnosis-search,
.sample-select {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.72rem;
  outline: none;
}

.diagnosis-select:focus,
.diagnosis-search:focus,
.sample-select:focus {
  border-color: rgba(147, 197, 253, 0.62);
}

.diagnosis-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  align-items: center;
  margin-top: 0.6rem;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.7rem;
}

.diagnosis-status {
  padding: 0.18rem 0.42rem;
  border-radius: 4px;
  font-weight: 700;
}

.diagnosis-status.passed {
  color: #86efac;
  background: rgba(34, 197, 94, 0.12);
}

.diagnosis-status.failed {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
}

.diagnosis-status.unknown {
  color: rgba(255, 255, 255, 0.62);
  background: rgba(255, 255, 255, 0.08);
}

.diagnosis-results {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.35rem;
  max-height: 92px;
  overflow-y: auto;
  margin-top: 0.6rem;
  padding-right: 0.15rem;
}

.diagnosis-result {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  height: 25px;
  padding: 0 0.42rem;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.035);
  color: rgba(255, 255, 255, 0.62);
  cursor: pointer;
  text-align: left;
  font-size: 0.65rem;
}

.diagnosis-result:hover,
.diagnosis-result.relevant {
  border-color: rgba(147, 197, 253, 0.48);
  color: rgba(255, 255, 255, 0.92);
  background: rgba(96, 165, 250, 0.1);
}

.result-rank {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.38);
  font-family: monospace;
}

.result-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}

.result-grade,
.result-mark {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.42);
  font-size: 0.6rem;
}

.result-mark {
  color: #fbbf24;
}

.metrics {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  flex-wrap: wrap;
}

.metric-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 70px;
}

.metric-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.15rem;
}

.metric-value {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
}

@media (max-width: 760px) {
  .diagnosis-controls {
    grid-template-columns: 1fr 1fr;
  }

  .sample-select {
    grid-column: 1 / -1;
  }

  .diagnosis-results {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
