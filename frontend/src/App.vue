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
      <button class="debug-toggle" @click="toggleDebugPanel" :class="{ active: showDebugPanel }">
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
import { GUI } from 'lil-gui';

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
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
  };
  console.log(`[snapshot ${label}]`, snap);
  return snap;
}

function compareSnapshots(a: any, b: any) {
  if (!a || !b) { console.warn('请先做两个快照'); return; }
  console.log(`\n===== 快照对比: "${a.label}" vs "${b.label}" =====`);
  // 核心对比
  const coreKeys = ['scale', 'material.opacity', 'material.color', 'material.blending', 'material.depthWrite', 'material.depthTest', 'material.transparent', 'renderOrder'];
  coreKeys.forEach(k => {
    const va = k.includes('.') ? (a.core as any)[k.split('.')[0]][k.split('.')[1]] : (a.core as any)[k];
    const vb = k.includes('.') ? (b.core as any)[k.split('.')[0]][k.split('.')[1]] : (b.core as any)[k];
    const diff = va !== vb ? ' ← 差异!' : '';
    console.log(`  core.${k}: ${JSON.stringify(va)} vs ${JSON.stringify(b.core as any)[k.split('.')[0]]?.[k.split('.')[1]] ?? 'n/a'}${diff}`);
  });
  // 辉光对比
  if (a.glows.length !== b.glows.length) {
    console.log(`  glow count: ${a.glows.length} vs ${b.glows.length} ← 差异!`);
  }
  a.glows.forEach((ga: any, i: number) => {
    const gb = b.glows[i];
    if (!gb) return;
    ['scale', 'position', 'material.opacity', 'material.color', 'material.blending', 'material.depthWrite', 'material.depthTest'].forEach(k => {
      const va = k.includes('.') ? ga[k.split('.')[0]][k.split('.')[1]] : ga[k];
      const vb = k.includes('.') ? gb[k.split('.')[0]][k.split('.')[1]] : gb[k];
      const diff = JSON.stringify(va) !== JSON.stringify(vb) ? ' ← 差异!' : '';
      if (diff) console.log(`  glow[${i}].${k}: ${JSON.stringify(va)} vs ${JSON.stringify(vb)}${diff}`);
    });
  });
  console.log('===== 对比完成 =====');
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
  guiParams.cameraZ = camera.position.z;

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

.gui-toggle {
  position: absolute;
  bottom: 1.5rem;
  right: 8rem;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  color: #a78bfa;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.gui-toggle:hover {
  background: rgba(0, 0, 0, 0.7);
  color: #c4b5fd;
}
</style>
