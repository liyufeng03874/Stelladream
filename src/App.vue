<template>
  <div id="app">
    <div class="container">
      <header class="header">
        <h1 class="title">✨ Stelladream</h1>
        <p class="subtitle">AI语义空间 3D 可视化</p>
      </header>

      <div class="main-content">
        <StarField
          v-if="starData.length > 0"
          :stars="starData"
          :config="config"
          @star-click="handleStarClick"
          @star-hover="handleStarHover"
        />

        <div v-else class="loading">
          <div class="spinner"></div>
          <p>加载星图数据中...</p>
        </div>

        <SearchBar
          v-if="starData.length > 0"
          @search="handleSearch"
        />

        <InfoPanel
          v-if="selectedStar"
          :star="selectedStar"
          @close="selectedStar = null"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import StarField from './components/StarField.vue';
import SearchBar from './components/SearchBar.vue';
import InfoPanel from './components/InfoPanel.vue';
import { getStarData, getConfig, type StarPoint } from './api';

const starData = ref<StarPoint[]>([]);
const config = ref<any>({});
const selectedStar = ref<StarPoint | null>(null);

const handleStarClick = (star: StarPoint) => {
  selectedStar.value = star;
};

const handleStarHover = (star: StarPoint | null) => {
  // TODO: 显示 tooltip
};

const handleSearch = async (query: string) => {
  // TODO: 实现搜索可视化
  console.log('Search:', query);
};

onMounted(async () => {
  try {
    // 加载配置
    config.value = await getConfig();

    // 加载星图数据
    const result = await getStarData();
    starData.value = result.data;

    console.log(`加载 ${result.count} 个星点`);
  } catch (error) {
    console.error('Failed to load data:', error);
  }
});
</script>

<style scoped>
#app {
  width: 100vw;
  height: 100vh;
  background: linear-gradient(135deg, #0a0e27 0%, #1a1a2e 100%);
  color: #ffffff;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow: hidden;
}

.container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 1.5rem 2rem;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 100;
}

.title {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 700;
  background: linear-gradient(90deg, #60a5fa 0%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.subtitle {
  margin: 0.5rem 0 0 0;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.6);
}

.main-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-top-color: #60a5fa;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
