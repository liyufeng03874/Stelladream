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

    <div class="metrics">
      <div class="metric-item" v-for="m in metricDefs" :key="m.key">
        <span class="metric-label">{{ m.label }}</span>
        <span class="metric-value" :style="{ color: m.color }">{{ formatMetric(m.key) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getEvalData } from '../api';

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

let playInterval: number | null = null;

const formatMetric = (key: string) => {
  const val = cumulativeMetrics.value[key] ?? 0;
  return val.toFixed(4);
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
  loadEvalData();
};

const stopPlayback = () => {
  isPlaying.value = false;
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
};

const togglePlay = () => {
  if (isPlaying.value) {
    stopPlayback();
    return;
  }

  if (currentStep.value === 0) {
    emit('fly-to-domain', currentDomain.value);
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
  }, 50);
};

const handleStepChange = (event: Event) => {
  const slider = event.target as HTMLInputElement;
  currentStep.value = parseInt(slider.value, 10);
  loadEvalData();
};

const loadEvalData = async () => {
  try {
    const data = await getEvalData(currentDomain.value, currentStep.value);
    currentMetrics.value = data.current_metrics ?? {};
    cumulativeMetrics.value = data.cumulative_metrics ?? {};
    currentQuery.value = data.query ?? '';
    currentQueryId.value = data.query_id ?? '';
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
    if (data.retrieved_ids && Array.isArray(data.retrieved_ids) && data.retrieved_ids.length > 0) {
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
  loadEvalData();
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
</style>
