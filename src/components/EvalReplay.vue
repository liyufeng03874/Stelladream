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
        v-model="currentStep"
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
import { ref, computed } from 'vue';
import { getEvalData } from '../api';

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
  currentDomain.value = domain;
  currentStep.value = 0;
  loadEvalData();
};

const togglePlay = () => {
  isPlaying.value = !isPlaying.value;

  if (isPlaying.value) {
    playInterval = window.setInterval(() => {
      if (currentStep.value < maxSteps.value - 1) {
        currentStep.value++;
        loadEvalData();
      } else {
        isPlaying.value = false;
        if (playInterval) clearInterval(playInterval);
      }
    }, 1000);
  } else {
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }
};

const handleStepChange = () => {
  loadEvalData();
};

const loadEvalData = async () => {
  try {
    const data = await getEvalData(currentDomain.value, currentStep.value);
    currentNdcg.value = data.ndcg_at_5;
    cumulativeNdcg.value = data.cumulative_ndcg;
    // TODO: 计算正确率
  } catch (error) {
    console.error('Failed to load eval data:', error);
  }
};
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
