<template>
  <div class="info-panel">
    <div class="panel-header">
      <h3>文档详情</h3>
      <button @click="emit('close')" class="close-button">✕</button>
    </div>

    <div class="panel-content">
      <div class="info-row">
        <span class="label">领域:</span>
        <span class="value" :style="{ color: getDomainColor(star.domain) }">
          {{ getDomainName(star.domain) }}
        </span>
      </div>

      <div class="info-row">
        <span class="label">来源:</span>
        <span class="value">{{ star.source }}</span>
      </div>

      <div class="info-row">
        <span class="label">ID:</span>
        <span class="value mono">{{ star.chunk_id }}</span>
      </div>

      <div class="info-row">
        <span class="label">坐标:</span>
        <span class="value mono">
          ({{ star.x.toFixed(2) }}, {{ star.y.toFixed(2) }}, {{ star.z.toFixed(2) }})
        </span>
      </div>

      <div v-if="retrievalInsight" class="retrieval-section">
        <div class="retrieval-header">
          <span class="label">检索路径:</span>
          <span class="query-chip">{{ retrievalInsight.query }}</span>
        </div>

        <div class="retrieval-summary" :class="{ 'is-final': retrievalInsight.isCurrentFinal }">
          {{ retrievalInsight.summary }}
        </div>

        <div class="retrieval-stage-grid">
          <div
            v-for="stage in retrievalInsight.stages"
            :key="stage.key"
            class="retrieval-stage-card"
            :class="{ hit: stage.hit, final: stage.key === 'final' && stage.hit }"
          >
            <div class="retrieval-stage-head">
              <span class="retrieval-stage-name">{{ stage.label }}</span>
              <span class="retrieval-stage-status">{{ stage.hit ? '命中' : '未命中' }}</span>
            </div>

            <div v-if="stage.hit" class="retrieval-stage-meta">
              <span>排名 #{{ stage.rank }} / {{ stage.total }}</span>
              <span>{{ stage.scoreLabel }} {{ formatScore(stage.score) }}</span>
            </div>
            <div v-else class="retrieval-stage-meta retrieval-stage-meta-muted">
              {{ stage.total > 0 ? `候选池 ${stage.total} 条` : '本阶段无结果' }}
            </div>
          </div>
        </div>
      </div>

      <div class="content-section">
        <span class="label">内容:</span>
        <div class="content-text">{{ star.content }}</div>
      </div>

      <button @click="emit('jump')" class="jump-button">
        ⚡ 星跃
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { StarPoint } from '../api';
import type { RetrievalInsight } from '../types/retrieval';

interface Props {
  star: StarPoint;
  query?: string;
  retrievalInsight?: RetrievalInsight | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'close': [];
  'jump': [];
}>();

// 这些将从配置加载，现在先硬编码
const domainColors: Record<string, string> = {
  medical: '#4A9AF5',
  law: '#E74C3C',
  general: '#2ECC71',
  game: '#F5A623'
};

const domainNames: Record<string, string> = {
  medical: '医疗',
  law: '法律',
  general: '百科',
  game: '游戏攻略'
};

const getDomainColor = (domain: string) => domainColors[domain] || '#ffffff';
const getDomainName = (domain: string) => domainNames[domain] || domain;
const formatScore = (value: number | null) => (value == null ? '--' : value.toFixed(4));
</script>

<style scoped>
.info-panel {
  position: absolute;
  top: 8rem;
  right: 2rem;
  width: 420px;
  max-height: calc(100vh - 10rem);
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  overflow: hidden;
  z-index: 60;
  animation: slideIn 0.3s ease-out;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.panel-header h3 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
}

.close-button {
  background: transparent;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background 0.2s;
}

.close-button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.panel-content {
  padding: 1.5rem;
  overflow-y: auto;
  max-height: calc(100vh - 12rem);
}

.info-row {
  display: flex;
  margin-bottom: 1rem;
  gap: 0.5rem;
}

.label {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.6);
  min-width: 60px;
}

.value {
  color: white;
  flex: 1;
}

.mono {
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
}

.retrieval-section {
  margin-top: 1.4rem;
  padding-top: 1.4rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.retrieval-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.8rem;
}

.query-chip {
  min-width: 0;
  max-width: 100%;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.74rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retrieval-summary {
  padding: 0.72rem 0.8rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.82);
  line-height: 1.5;
  font-size: 0.84rem;
}

.retrieval-summary.is-final {
  border-color: rgba(96, 165, 250, 0.36);
  background: rgba(59, 130, 246, 0.12);
}

.retrieval-stage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin-top: 0.8rem;
}

.retrieval-stage-card {
  min-width: 0;
  padding: 0.7rem 0.78rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.retrieval-stage-card.hit {
  border-color: rgba(52, 211, 153, 0.24);
  background: rgba(16, 185, 129, 0.08);
}

.retrieval-stage-card.final {
  border-color: rgba(96, 165, 250, 0.38);
  background: rgba(59, 130, 246, 0.12);
}

.retrieval-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.retrieval-stage-name {
  font-size: 0.76rem;
  font-weight: 700;
}

.retrieval-stage-status {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.64);
}

.retrieval-stage-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.76rem;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.retrieval-stage-meta-muted {
  color: rgba(255, 255, 255, 0.44);
}

.content-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.content-text {
  margin-top: 0.75rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.9);
  max-height: 300px;
  overflow-y: auto;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.jump-button {
  width: 100%;
  margin-top: 1.5rem;
  padding: 0.75rem 0;
  background: linear-gradient(135deg, #6366F1, #8B5CF6, #A855F7);
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.jump-button:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
}
</style>
