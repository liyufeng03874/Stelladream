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

      <div v-if="phaseTimeline.length > 0" class="phase-timeline">
        <button
          v-for="item in phaseTimeline"
          :key="item.phase"
          class="phase-chip"
          :class="{ active: phaseFilter === item.phase }"
          @click="handlePhaseFilter(item.phase)"
        >
          <span class="phase-chip-label">{{ item.label }}</span>
          <span class="phase-chip-count">{{ item.count }}</span>
        </button>
        <button
          class="phase-chip phase-chip-all"
          :class="{ active: phaseFilter === 'all' }"
          @click="handlePhaseFilter('all')"
        >
          ALL
        </button>
      </div>

      <InfoPanel
        v-if="selectedStar"
        :star="selectedStar"
        @close="selectedStar = null"
        @jump="handleStarJump"
      />

      <!-- 调试面板：搜索后自动弹出 或 手动切换 -->
      <DebugPanel
        v-if="showDebugPanel && debugFinalStar"
        :final-star="debugFinalStar"
        @close="showDebugPanel = false"
        @reset="handleDebugReset"
      />

      <!-- 手动调试开关 -->
      <button class="debug-toggle debug-hidden" @click="toggleDebugPanel" :class="{ active: showDebugPanel }">
        {{ showDebugPanel ? '关闭调试' : '🔬 调试' }}
      </button>

      <!-- lil-gui 调试面板开关 -->
      <button class="gui-toggle" @click="toggleGuiPanel">
        {{ debugGui ? '关闭面板' : '🎛️ 实时调参' }}
      </button>

      <!-- 评估回放面板 -->
      <button class="eval-toggle" @click="showEvalPanel = !showEvalPanel" :class="{ active: showEvalPanel }">
        {{ showEvalPanel ? '关闭回放' : '📊 评估回放' }}
      </button>

      <EvalReplay v-if="showEvalPanel" @highlight="handleEvalHighlight" @reset="handleEvalReset" @fly-to-domain="handleEvalFlyToDomain" @metrics-update="handleMetricsUpdate" />

      <MetricsTrendChart
        v-if="showTrendChart && evalMetricsHistory.length > 0"
        :history="evalMetricsHistory"
        :max-steps="evalMaxSteps"
      />
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
import MetricsTrendChart from './components/MetricsTrendChart.vue';
import type { FinalStarInfo, PhaseTimelineItem, SearchPhaseFilter } from './composables/useSearchAnimation';
import { getStarData, getConfig, search, type StarPoint } from './api';
import { useSearchAnimation } from './composables/useSearchAnimation';
import { useEvalVisual } from './composables/useEvalVisual';
import { GUI } from 'lil-gui';

// 星场上下文（用于构建调试信息）
let starSprites: THREE.Sprite[] = [];
let starDataMap: Map<string, { sprite: THREE.Sprite; data: StarPoint }> = new Map();
let animContext: ReturnType<typeof useSearchAnimation> | null = null;
let evalVisual: ReturnType<typeof useEvalVisual> | null = null;
let camera: THREE.Camera | null = null;
let scene: THREE.Scene | null = null;

const starData = ref<StarPoint[]>([]);
const config = ref<any>({});
const selectedStar = ref<StarPoint | null>(null);
const isSearching = ref(false);

// 评估回放相关
const showEvalPanel = ref(false);
const showTrendChart = ref(false);
const evalMetricsHistory = ref<Array<{ step: number; currentMetrics: Record<string, number>; cumulativeMetrics: Record<string, number> }>>([]);
let evalMaxSteps = 500;
const phaseTimeline = ref<PhaseTimelineItem[]>([]);
const phaseFilter = ref<SearchPhaseFilter>('all');

// 调试面板
const showDebugPanel = ref(false);
const debugFinalStar = ref<FinalStarInfo | null>(null);

// lil-gui 调试面板
let debugGui: GUI | null = null;
const guiParams = {
  coreScale: 0.6,
  coreScaleZ: 5,
  coreOpacity: 1.0,
  coreColor: '#ffffff',
  coreDepthTest: true,
  coreRenderOrder: 0,
  glowSize: 30,
  glowOpacity: 1.0,
  glowColor: '#34d399',
  glowDepthTest: false,
  glowRenderOrder: 0,
  glowPosOffsetX: 0,
  glowPosOffsetY: 0,
  glowPosOffsetZ: 0,
  cameraZ: 100,
  breathing: true,
  // 快照对比
  lastSnapshot: null as any,
  resetToDefaults() {
    this.coreScale = 0.6;
    this.coreScaleZ = 5;
    this.coreOpacity = 1.0;
    this.coreColor = '#ffffff';
    this.coreDepthTest = true;
    this.coreRenderOrder = 0;
    this.glowSize = 30;
    this.glowOpacity = 1.0;
    this.glowColor = '#34d399';
    this.glowDepthTest = false;
    this.glowRenderOrder = 0;
    this.glowPosOffsetX = 0;
    this.glowPosOffsetY = 0;
    this.glowPosOffsetZ = 0;
    this.cameraZ = 100;
    Object.values(guiControls).forEach(ctrl => ctrl?.updateDisplay());
  },
};
const guiControls: Record<string, any> = {};

function snapshotState(label: string): any {
  const finalStar = animContext?.getFinalStar?.();
  if (!finalStar?.sprite) return null;
  const coreSprite = finalStar.sprite;
  const coreMat = coreSprite.material as THREE.SpriteMaterial;
  const glows = animContext?.getFinalStarGlows?.() || [];

  const snap = {
    label,
    timestamp: Date.now(),
    core: {
      scale: { x: coreSprite.scale.x, y: coreSprite.scale.y, z: coreSprite.scale.z },
      position: { x: coreSprite.position.x, y: coreSprite.position.y, z: coreSprite.position.z },
      material: {
        opacity: coreMat.opacity,
        color: '0x' + coreMat.color.getHexString(),
        blending: coreMat.blending,
        depthWrite: coreMat.depthWrite,
        depthTest: coreMat.depthTest,
        transparent: coreMat.transparent,
      },
      renderOrder: coreSprite.renderOrder,
      textureSize: coreMat.map?.image ? `${coreMat.map.image.width}x${coreMat.map.image.height}` : 'none',
    },
    glows: glows.map((g, i) => ({
      index: i,
      scale: { x: g.scale.x, y: g.scale.y, z: g.scale.z },
      position: { x: g.position.x, y: g.position.y, z: g.position.z },
      material: {
        opacity: g.material.opacity,
        color: '0x' + g.material.color.getHexString(),
        blending: g.material.blending,
        depthWrite: g.material.depthWrite,
        depthTest: g.material.depthTest,
        transparent: g.material.transparent,
      },
      renderOrder: g.renderOrder,
      textureSize: g.material.map?.image ? `${g.material.map.image.width}x${g.material.map.image.height}` : 'none',
    })),
    camera: { x: camera?.position.x, y: camera?.position.y, z: camera?.position.z },
  };
  console.log(`[snapshot ${label}]`, snap);
  return snap;
}

function compareSnapshots(a: any, b: any) {
  if (!a || !b) { console.warn('请先做两个快照'); return; }
  console.log(`\n===== 快照对比: "${a.label}" vs "${b.label}" =====`);
  // 核心对比
  console.log('--- core ---');
  ['scale.x', 'scale.y', 'scale.z', 'material.opacity', 'material.color', 'material.blending', 'material.depthWrite', 'material.depthTest', 'material.transparent', 'renderOrder'].forEach(k => {
    const parts = k.split('.');
    let va: any = a.core;
    let vb: any = b.core;
    for (const p of parts) {
      if (typeof va === 'object' && va !== null) va = va[p];
      if (typeof vb === 'object' && vb !== null) vb = vb[p];
    }
    const diff = JSON.stringify(va) !== JSON.stringify(vb) ? ' ← 差异!' : '';
    console.log(`  ${k}: ${JSON.stringify(va)} vs ${JSON.stringify(vb)}${diff}`);
  });
  // 辉光对比
  console.log('--- glows ---');
  if (a.glows.length !== b.glows.length) {
    console.log(`  glow count: ${a.glows.length} vs ${b.glows.length} ← 差异!`);
  }
  a.glows.forEach((ga: any, i: number) => {
    const gb = b.glows[i];
    if (!gb) { console.log(`  glow[${i}]: missing in B ← 差异!`); return; }
    ['scale.x', 'scale.y', 'scale.z', 'position.x', 'position.y', 'position.z', 'material.opacity', 'material.color', 'material.blending', 'material.depthWrite', 'material.depthTest', 'renderOrder'].forEach(k => {
      const parts = k.split('.');
      let va: any = ga;
      let vb: any = gb;
      for (const p of parts) {
        if (typeof va === 'object' && va !== null) va = va[p];
        if (typeof vb === 'object' && vb !== null) vb = vb[p];
      }
      const diff = JSON.stringify(va) !== JSON.stringify(vb) ? ' ← 差异!' : '';
      if (diff) console.log(`  ${k}: ${JSON.stringify(va)} vs ${JSON.stringify(vb)}${diff}`);
    });
  });
  console.log('--- camera ---');
  ['x', 'y', 'z'].forEach(k => {
    const va = (a.camera as any)[k];
    const vb = (b.camera as any)[k];
    const diff = Math.abs(va - vb) > 0.1 ? ' ← 差异!' : '';
    console.log(`  camera.${k}: ${va.toFixed(2)} vs ${vb.toFixed(2)}${diff}`);
  });
  console.log('===== 对比完成 =====\n');
}

function openDebugGui() {
  if (debugGui) {
    debugGui.destroy();
    debugGui = null;
  }

  const finalStar = animContext?.getFinalStar?.();
  if (!finalStar?.sprite) {
    console.warn('[debug-gui] 没有当前最终星，请先做一次 query 或星跃');
    return;
  }

  debugGui = new GUI({ title: '🌸 最终星调试', width: 300 });

  const coreSprite = finalStar.sprite;
  const coreMat = coreSprite.material as THREE.SpriteMaterial;
  const glows = animContext?.getFinalStarGlows?.() || [];

  // 读取当前值
  guiParams.coreScale = coreSprite.scale.x;
  guiParams.coreScaleZ = coreSprite.scale.z;
  guiParams.coreOpacity = coreMat.opacity;
  guiParams.coreColor = '#' + coreMat.color.getHexString();
  guiParams.coreDepthTest = coreMat.depthTest;
  guiParams.coreRenderOrder = coreSprite.renderOrder;
  guiParams.glowColor = '#' + (glows[0]?.material.color?.getHexString() || '34d399');
  guiParams.glowSize = glows[0]?.scale.x || 30;
  guiParams.glowOpacity = glows[0]?.material.opacity ?? 1.0;
  guiParams.glowDepthTest = glows[0]?.material.depthTest ?? false;
  guiParams.glowRenderOrder = glows[0]?.renderOrder ?? 0;
  guiParams.glowPosOffsetX = glows[0] ? glows[0].position.x - coreSprite.position.x : 0;
  guiParams.glowPosOffsetY = glows[0] ? glows[0].position.y - coreSprite.position.y : 0;
  guiParams.glowPosOffsetZ = glows[0] ? glows[0].position.z - coreSprite.position.z : 0;
  guiParams.cameraZ = camera?.position.z || 100;

  // 核心
  const coreFolder = debugGui.addFolder('⭐ 核心');
  guiControls.coreScale = coreFolder.add(guiParams, 'coreScale', 0.01, 3.0, 0.01).name('scale XY').onChange((v: number) => {
    coreSprite.scale.set(v, v, guiParams.coreScaleZ);
  });
  guiControls.coreScaleZ = coreFolder.add(guiParams, 'coreScaleZ', 0.1, 20, 0.1).name('scale Z').onChange((v: number) => {
    coreSprite.scale.set(coreSprite.scale.x, coreSprite.scale.y, v);
  });
  guiControls.coreOpacity = coreFolder.add(guiParams, 'coreOpacity', 0, 1, 0.01).name('opacity').onChange((v: number) => {
    coreMat.opacity = v;
  });
  guiControls.coreColor = coreFolder.addColor(guiParams, 'coreColor').name('颜色').onChange((v: string) => {
    const color = parseInt(v.replace('#', ''), 16);
    coreMat.color.setHex(color);
  });
  guiControls.coreDepthTest = coreFolder.add(guiParams, 'coreDepthTest').name('depthTest').onChange((v: boolean) => {
    coreMat.depthTest = v;
  });
  guiControls.coreRenderOrder = coreFolder.add(guiParams, 'coreRenderOrder', -10, 10, 1).name('renderOrder').onChange((v: number) => {
    coreSprite.renderOrder = v;
  });

  // 辉光
  const glowFolder = debugGui.addFolder('✨ 辉光');
  guiControls.glowSize = glowFolder.add(guiParams, 'glowSize', 1, 100, 0.5).name('size').onChange((v: number) => {
    glows.forEach(g => { g.scale.set(v, v, 1); });
  });
  guiControls.glowOpacity = glowFolder.add(guiParams, 'glowOpacity', 0, 1, 0.01).name('opacity').onChange((v: number) => {
    glows.forEach(g => { g.material.opacity = v; });
  });
  guiControls.glowColor = glowFolder.addColor(guiParams, 'glowColor').name('颜色').onChange((v: string) => {
    const color = parseInt(v.replace('#', ''), 16);
    glows.forEach(g => { g.material.color.setHex(color); });
  });
  guiControls.glowDepthTest = glowFolder.add(guiParams, 'glowDepthTest').name('depthTest').onChange((v: boolean) => {
    glows.forEach(g => { g.material.depthTest = v; });
  });
  guiControls.glowRenderOrder = glowFolder.add(guiParams, 'glowRenderOrder', -10, 10, 1).name('renderOrder').onChange((v: number) => {
    glows.forEach(g => { g.renderOrder = v; });
  });
  guiControls.glowPosOffsetX = glowFolder.add(guiParams, 'glowPosOffsetX', -5, 5, 0.1).name('pos offset X').onChange((v: number) => {
    glows.forEach(g => { g.position.x = coreSprite.position.x + v; });
  });
  guiControls.glowPosOffsetY = glowFolder.add(guiParams, 'glowPosOffsetY', -5, 5, 0.1).name('pos offset Y').onChange((v: number) => {
    glows.forEach(g => { g.position.y = coreSprite.position.y + v; });
  });
  guiControls.glowPosOffsetZ = glowFolder.add(guiParams, 'glowPosOffsetZ', -5, 5, 0.1).name('pos offset Z').onChange((v: number) => {
    glows.forEach(g => { g.position.z = coreSprite.position.z + v; });
  });

  // 相机
  const camFolder = debugGui.addFolder('📷 相机');
  guiControls.cameraZ = camFolder.add(guiParams, 'cameraZ', 10, 500, 1).name('Z 距离').onChange((v: number) => {
    camera.position.z = v;
  });

  // 呼吸动画
  const animFolder = debugGui.addFolder('🔄 动画');
  guiControls.breathing = animFolder.add(guiParams, 'breathing').name('呼吸动画').onChange((v: boolean) => {
    if (animContext?.setBreathingActive !== undefined) {
      animContext.setBreathingActive(v);
    }
  });

  // 快照与对比
  const snapFolder = debugGui.addFolder('📸 快照对比');
  snapFolder.add({ snapshot() {
    guiParams.lastSnapshot = snapshotState(`snapshot_${Object.keys(guiControls).length}`);
  }}, 'snapshot').name('拍快照 (Console)');
  snapFolder.add({ compare() {
    if (!guiParams.lastSnapshot) { console.warn('请先拍一次快照'); return; }
    const current = snapshotState('current');
    compareSnapshots(guiParams.lastSnapshot, current);
  }}, 'compare').name('对比上次快照');

  // 重置
  debugGui.add(guiParams, 'resetToDefaults').name('🔄 重置为默认');

  console.log('[debug-gui] 已打开，glow count:', glows.length);
  console.log('[debug-gui] 提示: 分别做 query 和 jumpToStar 后各拍一次快照，然后点对比');
  (window as any).__stelladream.gui = debugGui;
  (window as any).__stelladream.snapshot = snapshotState;
  (window as any).__stelladream.compare = compareSnapshots;
}

function closeDebugGui() {
  if (debugGui) {
    debugGui.destroy();
    debugGui = null;
  }
}

const handleEvalHighlight = (payload: any) => {
  if (!evalVisual) return;

  // 批量模式：播完 500 步后展示最终效果
  if (payload.isBatch) {
    evalVisual.applyAllEffects();
    console.log('[eval] 播放完成，展示最终效果:', evalVisual.getStats());
    return;
  }

  // 正常模式：逐步处理
  if (payload.chunkIds?.length) {
    evalVisual.processStep(payload.chunkIds.slice(0, 5));  // 只取 Top-5
  }
};

// 评估开始时相机飞向对应领域簇
const handleEvalFlyToDomain = (domain: string) => {
  if (!animContext || !starDataMap) return;

  // 计算该领域所有星的平均位置
  const domainStars = Array.from(starDataMap.entries()).filter(
    ([_, { data }]) => data.domain === domain
  );

  if (domainStars.length === 0) return;

  let cx = 0, cy = 0, cz = 0;
  for (const [_, { sprite }] of domainStars) {
    cx += sprite.position.x;
    cy += sprite.position.y;
    cz += sprite.position.z;
  }
  cx /= domainStars.length;
  cy /= domainStars.length;
  cz /= domainStars.length;

  // 飞到领域中心上方一定距离
  const targetPos = new THREE.Vector3(cx, cy + 50, cz + 100);
  console.log(`[eval] 飞向 ${domain} 簇中心: (${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)})`);
  animContext.flyToStar(targetPos, 2.0, 'eval-fly', 'initial');
};

const handleEvalReset = () => {
  if (evalVisual) {
    evalVisual.reset();
    console.log('[eval] 重置评估数据');
  }
  evalMetricsHistory.value = [];
  showTrendChart.value = false;
};

const handleMetricsUpdate = (payload: { step: number; currentMetrics: Record<string, number>; cumulativeMetrics: Record<string, number> }) => {
  showTrendChart.value = true;
  evalMetricsHistory.value.push({
    step: payload.step,
    currentMetrics: payload.currentMetrics,
    cumulativeMetrics: payload.cumulativeMetrics,
  });
};

const handleStarClick = (star: StarPoint) => {
  showDebugPanel.value = false;
  selectedStar.value = star;
};

const handleDebugReset = () => {
  animContext?.resetFinalStar();
  debugFinalStar.value = null;
  showDebugPanel.value = false;
};

const handleStarJump = () => {
  console.log('[handleStarJump] called, selectedStar:', selectedStar.value);
  if (!selectedStar.value || !animContext) return;
  const targetInfo = starDataMap.get(selectedStar.value.chunk_id);
  console.log('[handleStarJump] targetInfo found:', !!targetInfo, 'chunk_id:', selectedStar.value.chunk_id);
  if (!targetInfo) return;
  console.log('[handleStarJump] targetSprite:', !!targetInfo.sprite);
  animContext.jumpToStar(targetInfo.sprite);
  selectedStar.value = null;
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

const toggleGuiPanel = () => {
  if (debugGui) {
    closeDebugGui();
  } else {
    openDebugGui();
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
    phaseTimeline.value = animContext.getPhaseTimeline?.() ?? [];
    phaseFilter.value = animContext.getPhaseFilter?.() ?? 'all';

    if (results.reranker_final) {
      const finalStar = starData.value.find(
        s => s.chunk_id === results.reranker_final!.chunk_id
      );
      if (finalStar) {
        selectedStar.value = finalStar;
        debugFinalStar.value = animContext.getFinalStar();
        showDebugPanel.value = false;
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
  camera = context.camera;
  scene = context.scene;
  animContext = useSearchAnimation(context);
  evalVisual = useEvalVisual(context);

  // 暴露到 window 方便调试
  (window as any).__stelladream = {
    animContext,
    getRegistry: () => animContext?.getRegistry(),
    getFactory: () => animContext?.getFactory(),
    registry: () => animContext?.getRegistry(),
    factory: () => animContext?.getFactory(),
    openDebugGui,
    closeDebugGui,
  };
};

const handlePhaseFilter = (filter: SearchPhaseFilter) => {
  phaseFilter.value = filter;
  animContext?.setPhaseFilter?.(filter);
  void animContext?.focusPhase?.(filter);
};

onMounted(async () => {
  try {
    // 加载配置
    config.value = await getConfig();

    // 加载星图数据
    const result = await getStarData();
    starData.value = result;
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

.phase-timeline {
  position: absolute;
  top: 6.3rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.45rem;
  align-items: center;
  z-index: 45;
}

.phase-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.18s ease;
}

.phase-chip:hover {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.3);
  background: rgba(0, 0, 0, 0.72);
}

.phase-chip.active {
  color: #fff;
  border-color: rgba(96, 165, 250, 0.55);
  background: rgba(59, 130, 246, 0.18);
}

.phase-chip-label {
  font-weight: 600;
  letter-spacing: 0;
}

.phase-chip-count {
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
}

.phase-chip-all {
  padding-inline: 0.8rem;
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

.debug-hidden {
  display: none;
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

.gui-toggle {
  position: absolute;
  bottom: 1.35rem;
  right: 1.35rem;
  padding: 0.55rem 0.9rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(12px);
  color: #a78bfa;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.gui-toggle:hover {
  background: rgba(0, 0, 0, 0.58);
  color: #c4b5fd;
}

.eval-toggle {
  position: absolute;
  bottom: 1.35rem;
  right: 8.2rem;
  padding: 0.55rem 0.9rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(12px);
  color: #f59e0b;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.eval-toggle:hover {
  background: rgba(0, 0, 0, 0.58);
  color: #fbbf24;
}

.eval-toggle.active {
  border-color: rgba(245, 158, 11, 0.4);
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}
</style>
