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

interface Props {
  star: StarPoint;
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
