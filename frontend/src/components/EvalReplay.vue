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
      <div class="metric-item">
        <span class="metric-label">NDCG@5:</span>
        <span class="metric-value">{{ currentNdcg.toFixed(4) }}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">累计 NDCG:</span>
        <span class="metric-value">{{ cumulativeNdcg.toFixed(4) }}</span>
      </div>
      <div class="metric-item">
        <span class="metric-label">正确率:</span>
        <span class="metric-value">{{ correctRate.toFixed(2) }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getEvalData } from '../api';

const emit = defineEmits<{
  highlight: [payload: {
    chunkIds: string[];
    ranks: number[];
    correctIds: string[];
    currentNdcg: number;
    query: string;
    domain: string;
    isBatch: boolean;
  }];
  reset: [];
  'fly-to-domain': [domain: string];  // 新增：评估开始时飞向领域簇
}>();

const domains = [
  { key: 'medical', name: '医疗 (Run 007)' },
  { key: 'law', name: '法律 (Run 008)' },
  { key: 'general', name: '百科 (Run 009)' }
];

const currentDomain = ref('medical');
const currentStep = ref(0);
const maxSteps = ref(500);
const isPlaying = ref(false);

const currentNdcg = ref(0);
const cumulativeNdcg = ref(0);
const correctRate = ref(0);

let playInterval: number | null = null;

const switchDomain = (domain: string) => {
  // 切换领域时重置
  emit('reset');
  stopPlayback();
  currentDomain.value = domain;
  currentStep.value = 0;
  currentNdcg.value = 0;
  cumulativeNdcg.value = 0;
  correctRate.value = 0;
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

  // 第一次播放时飞向领域簇
  if (currentStep.value === 0) {
    emit('fly-to-domain', currentDomain.value);
  }

  isPlaying.value = true;

  // 50ms 间隔，25秒播完 500 步
  playInterval = window.setInterval(() => {
    if (currentStep.value < maxSteps.value - 1) {
      currentStep.value++;
      loadEvalData();
    } else {
      stopPlayback();
      // 播完最后一帧后发出完整数据
      emit('highlight', {
        chunkIds: [],
        ranks: [],
        correctIds: [],
        currentNdcg: cumulativeNdcg.value,
        query: '',
        domain: currentDomain.value,
        isBatch: true,  // 标识为批量模式
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
    currentNdcg.value = data.ndcg_at_5 ?? 0;
    cumulativeNdcg.value = data.cumulative_ndcg ?? 0;
    correctRate.value = data.correct_rate ?? 0;
    if (data.total_samples) {
      maxSteps.value = data.total_samples;
      if (currentStep.value >= data.total_samples) {
        currentStep.value = data.total_samples - 1;
      }
    }
    // 发出高亮事件：传递 Top-5 数据
    if (data.retrieved_ids && Array.isArray(data.retrieved_ids) && data.retrieved_ids.length > 0) {
      emit('highlight', {
        chunkIds: data.retrieved_ids,
        ranks: data.ranks ?? [1, 2, 3, 4, 5].slice(0, data.retrieved_ids.length),
        correctIds: data.correct_ids ?? [],
        currentNdcg: currentNdcg.value,
        query: data.query ?? '',
        domain: currentDomain.value,
        isBatch: false,
      });
    }
  } catch (error) {
    console.error('Failed to load eval data:', error);
  }
};

// 挂载时自动加载第一步
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
  width: 80%;
  max-width: 900px;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 1.5rem;
  z-index: 50;
}

.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tab {
  flex: 1;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tab.active {
  background: rgba(96, 165, 250, 0.3);
  border-color: #60a5fa;
  color: white;
}

.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.play-button {
  width: 40px;
  height: 40px;
  background: #60a5fa;
  border: none;
  border-radius: 50%;
  color: white;
  font-size: 1.2rem;
  cursor: pointer;
  transition: transform 0.2s;
}

.play-button:hover {
  transform: scale(1.1);
}

.progress-slider {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  outline: none;
  -webkit-appearance: none;
}

.progress-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  background: #60a5fa;
  border-radius: 50%;
  cursor: pointer;
}

.step-indicator {
  min-width: 80px;
  text-align: right;
  color: rgba(255, 255, 255, 0.7);
  font-family: monospace;
}

.metrics {
  display: flex;
  gap: 2rem;
  justify-content: center;
}

.metric-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.metric-label {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0.25rem;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #60a5fa;
  font-family: monospace;
}
</style>
