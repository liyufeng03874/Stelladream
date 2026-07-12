<template>
  <div id="app">
    <StarField
      v-if="starData.length > 0"
      :stars="starData"
      :config="config"
      @star-click="handleStarClick"
      @star-hover="handleStarHover"
      @ready="handleStarFieldReady"
    />

    <div v-else class="loading">
      <div class="spinner"></div>
      <p>加载星图数据中...</p>
    </div>

    <div v-if="starData.length > 0" class="ui-overlay">
      <div class="header">
        <h1 class="title">Stelladream</h1>
        <p class="subtitle">{{ starData.length }} 个星点</p>
      </div>

      <SearchBar @search="handleSearch" />

      <InfoPanel
        v-if="selectedStar && !showDebugPanel"
        :star="selectedStar"
        @close="selectedStar = null"
      />

      <!-- 调试面板：搜索后自动弹出 或 手动切换 -->
      <DebugPanel
        v-if="showDebugPanel && debugFinalStar"
        :final-star="debugFinalStar"
        @close="showDebugPanel = false"
        @reset="handleDebugReset"
      />

      <!-- 手动调试开关 -->
      <button class="debug-toggle" @click="toggleDebugPanel" :class="{ active: showDebugPanel }">
        {{ showDebugPanel ? '关闭调试' : '🔬 调试' }}
      </button>

      <!-- 评估回放面板 -->
      <button class="eval-toggle" @click="showEvalPanel = !showEvalPanel" :class="{ active: showEvalPanel }">
        {{ showEvalPanel ? '关闭回放' : '📊 评估回放' }}
      </button>

      <EvalReplay v-if="showEvalPanel" @highlight="handleEvalHighlight" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import * as THREE from 'three';
import StarField from './components/StarField.vue';
import SearchBar from './components/SearchBar.vue';
import InfoPanel from './components/InfoPanel.vue';
import DebugPanel from './components/DebugPanel.vue';
import EvalReplay from './components/EvalReplay.vue';
import type { FinalStarInfo } from './composables/useSearchAnimation';
import { getStarData, getConfig, search, type StarPoint } from './api';
import { useSearchAnimation } from './composables/useSearchAnimation';

// 星场上下文（用于构建调试信息）
let starSprites: THREE.Sprite[] = [];
let starDataMap: Map<string, { sprite: THREE.Sprite; data: StarPoint }> = new Map();
let animContext: ReturnType<typeof useSearchAnimation> | null = null;

const starData = ref<StarPoint[]>([]);
const config = ref<any>({});
const selectedStar = ref<StarPoint | null>(null);
const isSearching = ref(false);

// 调试面板
const showDebugPanel = ref(false);
const debugFinalStar = ref<FinalStarInfo | null>(null);

// 评估回放面板
const showEvalPanel = ref(false);

const handleEvalHighlight = (_payload: any) => {
  // 评估回放的高亮事件，后续可对接星场动画
};

const handleStarClick = (star: StarPoint) => {
  selectedStar.value = star;
};

const handleDebugReset = () => {
  animContext?.resetFinalStar();
  debugFinalStar.value = null;
  showDebugPanel.value = false;
};

const toggleDebugPanel = () => {
  if (!showDebugPanel.value) {
    // 打开调试面板：使用当前选中星或最后一颗搜索星
    const finalFromSearch = animContext?.getFinalStar?.();
    if (finalFromSearch) {
      debugFinalStar.value = finalFromSearch;
      showDebugPanel.value = true;
      return;
    }
    // 回退：用当前选中的星手动构建
    if (selectedStar.value) {
      debugFinalStar.value = buildFinalStarInfo(selectedStar.value);
      showDebugPanel.value = true;
    }
  } else {
    showDebugPanel.value = false;
  }
};

function buildFinalStarInfo(star: StarPoint): FinalStarInfo | null {
  const info = starDataMap.get(star.chunk_id);
  if (!info) return null;

  const origMat = info.sprite.material.clone() as THREE.SpriteMaterial;
  // 获取默认颜色（从领域配置）
  const domainColor = config.value.domains?.[star.domain]?.color || '#ffffff';

  return {
    sprite: info.sprite,
    data: info.data,
    originalScale: new THREE.Vector3(star.size * 0.06, star.size * 0.06, 1),
    originalMaterial: origMat,
    domainColor,
  };
}

const handleStarHover = (star: StarPoint | null) => {
  // TODO: 显示 tooltip
};

const handleSearch = async (query: string) => {
  if (isSearching.value || !animContext) return;

  try {
    isSearching.value = true;
    const results = await search(query);

    await animContext.animateSearch(results);

    if (results.reranker_final) {
      const finalStar = starData.value.find(
        s => s.chunk_id === results.reranker_final!.chunk_id
      );
      if (finalStar) {
        selectedStar.value = finalStar;
        // 自动打开调试面板
        const finalInfo = animContext.getFinalStar();
        if (finalInfo) {
          debugFinalStar.value = finalInfo;
          showDebugPanel.value = true;
        }
      }
    }
  } catch (error) {
    console.error('搜索失败:', error);
    alert('搜索失败，请检查后端服务');
  } finally {
    isSearching.value = false;
  }
};

const handleStarFieldReady = (context: any) => {
  starSprites = context.starSprites;
  starDataMap = context.starDataMap;
  animContext = useSearchAnimation(context);
};

onMounted(async () => {
  try {
    // 加载配置
    config.value = await getConfig();

    // 加载星图数据
    const result = await getStarData();
    starData.value = result.data;
  } catch (error) {
    console.error('Failed to load data:', error);
  }
});
</script>

<style scoped>
#app {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  margin: 0;
  padding: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #ffffff;
}

.loading {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #0a0e27;
  gap: 1rem;
  z-index: 1000;
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

.ui-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.ui-overlay > * {
  pointer-events: auto;
}

.header {
  position: absolute;
  top: 1.5rem;
  left: 2rem;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  padding: 1rem 1.5rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(90deg, #60a5fa 0%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.subtitle {
  margin: 0.3rem 0 0 0;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
}

.debug-toggle {
  position: absolute;
  bottom: 1.5rem;
  right: 1.5rem;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  color: #aaa;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.debug-toggle:hover {
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
}

.debug-toggle.active {
  background: rgba(52, 211, 153, 0.2);
  border-color: rgba(52, 211, 153, 0.4);
  color: #34d399;
}
</style>
